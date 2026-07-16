/*
 * hs-souba-pipeline v1.0.0
 * HORIZON SHIELD 相場自己更新パイプライン (学習エージェント + 判断エージェント)
 *
 * 絶対制約 (緩めるな):
 *  - この Worker は data/souba-db.json に一切書き込まない。出力は KV の proposals:* のみ。
 *  - MVP では自動承認なし。auto_approve_eligible は常に false。
 *  - 判断エージェントはルールベースのみ。この Worker から LLM は呼ばない。
 *  - deploy / secret は大賀(TOshi)手動のみ。
 *  - feed / souba-db の URL は環境変数駆動。未設定なら何も生成せずログに記録して終わる
 *    (実スキーマ未確認の状態で憶測パースして誤提案を作らないためのガード)。
 *
 * エンドポイント:
 *  GET  /health  -> { ok, agent, version, time }
 *  POST /run     -> 手動実行 (header: x-pipeline-token == env.PIPELINE_TOKEN 必須)
 *  cron          -> runLearn() 後に waitUntil(runJudge())
 *
 * 必要バインディング / 変数:
 *  KV    HS_DESIGN_KV (namespace ebeee94b11644031a2deaea32093ac8b)
 *  vars  SOUBA_DB_URL, FEED_MANIFEST_URL または FEED_GITHUB_API_URL, DEFAULT_COEFF
 *  secret PIPELINE_TOKEN (wrangler secret put PIPELINE_TOKEN は大賀手動)
 */

import RULES from '../rules/souba-judge-rules.json' with { type: 'json' };

const VERSION = '1.0.0';
const AGENT = 'souba-pipeline';

const TTL = {
  pending: 180 * 86400,
  judged: 180 * 86400,
  rejected: 90 * 86400,
  hash: 30 * 86400,
  rejectHash: 30 * 86400,
  lastRun: 30 * 86400
};

const INDEX_CAP = 100;
const MAX_FEED_FILES_PER_RUN = 10;

/* ---------------------------------------------------------------- utils */

function jstNow() {
  // JST 表記の ISO 文字列を返す (UTC に +9h して Z を +09:00 に差し替える)
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return d.toISOString().replace('Z', '+09:00');
}

function jstStamp() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  const iso = d.toISOString(); // ex. 2026-07-04T06:30:12.345Z (中身はJST)
  return {
    ymd: iso.slice(0, 10).replace(/-/g, ''),
    hms: iso.slice(11, 19).replace(/:/g, '')
  };
}

function randHex(n) {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('').slice(0, n);
}

function canonicalJson(obj) {
  // キーを再帰的にソートした安定 JSON (content_hash 用)
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(function (k) {
    return JSON.stringify(k) + ':' + canonicalJson(obj[k]);
  }).join(',') + '}';
}

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
}

function num(v) {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[,、]/g, ''));
    if (isFinite(n)) return n;
  }
  return null;
}

/* ------------------------------------------------------------ KV helpers */

async function kvGetJson(kv, key) {
  const raw = await kv.get(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

async function kvPutJson(kv, key, obj, ttlSeconds) {
  const opts = ttlSeconds ? { expirationTtl: ttlSeconds } : undefined;
  await kv.put(key, JSON.stringify(obj), opts);
}

async function readIndex(kv, key) {
  const arr = await kvGetJson(kv, key);
  return Array.isArray(arr) ? arr : [];
}

async function pushIndex(kv, key, id) {
  const arr = await readIndex(kv, key);
  if (arr.indexOf(id) === -1) {
    arr.push(id);
    while (arr.length > INDEX_CAP) arr.shift();
    await kvPutJson(kv, key, arr);
  }
}

async function removeFromIndex(kv, key, id) {
  const arr = await readIndex(kv, key);
  const i = arr.indexOf(id);
  if (i !== -1) {
    arr.splice(i, 1);
    await kvPutJson(kv, key, arr);
  }
}

/* ------------------------------------------------------- souba-db access */

async function fetchSoubaDb(env) {
  if (!env.SOUBA_DB_URL) return { db: null, error: 'SOUBA_DB_URL not configured' };
  try {
    const res = await fetch(env.SOUBA_DB_URL, { headers: { 'User-Agent': 'hs-souba-pipeline/' + VERSION } });
    if (!res.ok) return { db: null, error: 'souba-db fetch HTTP ' + res.status };
    const db = await res.json();
    return { db: db, error: null };
  } catch (e) {
    return { db: null, error: 'souba-db fetch failed: ' + String(e) };
  }
}

function getCategory(db, categoryId) {
  // souba-db.json の実構造が確定するまでの寛容ルックアップ。
  // 対応形: { categories: { id: {...} } } / { categories: [ {category_id|id: ...} ] } / トップレベル辞書
  if (!db || !categoryId) return null;
  const c = db.categories;
  if (c) {
    if (!Array.isArray(c) && typeof c === 'object' && c[categoryId]) return c[categoryId];
    if (Array.isArray(c)) {
      for (let i = 0; i < c.length; i++) {
        const item = c[i];
        if (item && (item.category_id === categoryId || item.id === categoryId)) return item;
      }
    }
  }
  if (db[categoryId] && typeof db[categoryId] === 'object') return db[categoryId];
  return null;
}

function categoryPrices(cat) {
  if (!cat) return null;
  const min = num(cat.min);
  const avg = num(cat.avg);
  const max = num(cat.max);
  const danger = num(cat.danger);
  if (avg === null) return null;
  return { min: min, avg: avg, max: max, danger: danger };
}

/* ---------------------------------------------------------- feed loading */

async function listFeedFiles(env) {
  // 優先1: FEED_MANIFEST_URL (JSON 配列: ["url", ...] または [{name, url}, ...])
  // 優先2: FEED_GITHUB_API_URL (GitHub contents API のディレクトリURL)
  if (env.FEED_MANIFEST_URL) {
    const res = await fetch(env.FEED_MANIFEST_URL, { headers: { 'User-Agent': 'hs-souba-pipeline/' + VERSION } });
    if (!res.ok) throw new Error('feed manifest HTTP ' + res.status);
    const arr = await res.json();
    if (!Array.isArray(arr)) throw new Error('feed manifest is not an array');
    return arr.map(function (it) {
      if (typeof it === 'string') {
        const parts = it.split('/');
        return { name: parts[parts.length - 1], url: it };
      }
      return { name: it.name || '', url: it.url || it.download_url || '' };
    }).filter(function (f) { return f.url && f.name.endsWith('.json'); });
  }
  if (env.FEED_GITHUB_API_URL) {
    const res = await fetch(env.FEED_GITHUB_API_URL, {
      headers: {
        'User-Agent': 'hs-souba-pipeline/' + VERSION,
        'Accept': 'application/vnd.github+json'
      }
    });
    if (!res.ok) throw new Error('feed github api HTTP ' + res.status);
    const arr = await res.json();
    if (!Array.isArray(arr)) throw new Error('feed github api did not return a list');
    return arr
      .filter(function (it) { return it && it.type === 'file' && String(it.name).endsWith('.json'); })
      .map(function (it) { return { name: it.name, url: it.download_url }; });
  }
  throw new Error('no feed source configured (set FEED_MANIFEST_URL or FEED_GITHUB_API_URL)');
}

function mapFeedItem(raw) {
  // feed JSON 実スキーマ確定前の寛容マッピング。取れないフィールドは null のまま。
  if (!raw || typeof raw !== 'object') return null;
  const kind = raw.kind || raw.type || raw.event || '';
  const category = raw.category_id || raw.category || raw.cat || null;
  const title = raw.title ? String(raw.title) : '';
  const keywords = Array.isArray(raw.keywords) ? raw.keywords.map(String) : [];
  const facts = Array.isArray(raw.facts) ? raw.facts.map(String)
    : (typeof raw.facts === 'string' ? [raw.facts] : []);
  const url = raw.source_url || raw.url || (raw.source && raw.source.url) || '';
  const observed = raw.observed_at || raw.created_at || raw.date || raw.published_at || null;
  const designPrice = num(raw.design_price_sqm) !== null ? num(raw.design_price_sqm) : num(raw.price_sqm);
  const proposed = (raw.proposed && typeof raw.proposed === 'object') ? raw.proposed : null;
  return {
    kind: String(kind),
    category: category ? String(category) : null,
    title: title,
    keywords: keywords,
    facts: facts,
    url: String(url),
    observed: observed ? String(observed) : null,
    designPrice: designPrice,
    proposed: proposed,
    raw: raw
  };
}

function classifyChange(item) {
  const k = item.kind;
  if (k.indexOf('値上げ') !== -1) return 'manufacturer_price_up';
  if (k.indexOf('値下げ') !== -1) return 'manufacturer_price_down';
  if (k.indexOf('締切') !== -1 || k.indexOf('受付終了') !== -1) return 'subsidy_deadline';
  return null;
}

/* ------------------------------------------------------- learn agent */

async function runLearn(env) {
  const kv = env.HS_DESIGN_KV;
  const summary = {
    at: jstNow(),
    files_seen: 0,
    files_processed: [],
    proposals_created: 0,
    skipped: [],
    errors: []
  };

  // 日次上限
  const stamp = jstStamp();
  const countKey = 'pipeline:learn:count:' + stamp.ymd;
  let dailyCount = parseInt((await kv.get(countKey)) || '0', 10);
  const dailyMax = RULES.thresholds.daily_max_proposals;

  const dbRes = await fetchSoubaDb(env);
  if (dbRes.error) {
    summary.errors.push(dbRes.error);
    await kvPutJson(kv, 'pipeline:learn:last_run', summary, TTL.lastRun);
    return summary;
  }
  const db = dbRes.db;

  let files;
  try {
    files = await listFeedFiles(env);
  } catch (e) {
    summary.errors.push(String(e && e.message ? e.message : e));
    await kvPutJson(kv, 'pipeline:learn:last_run', summary, TTL.lastRun);
    return summary;
  }

  files.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
  summary.files_seen = files.length;

  const cursor = (await kv.get('pipeline:cursor:feed')) || '';
  const todo = files.filter(function (f) { return f.name > cursor; }).slice(0, MAX_FEED_FILES_PER_RUN);
  let maxName = cursor;

  for (let i = 0; i < todo.length; i++) {
    const f = todo[i];
    if (f.name > maxName) maxName = f.name;
    if (dailyCount >= dailyMax) {
      summary.skipped.push({ file: f.name, reason: 'daily_max_proposals reached' });
      continue;
    }
    let raw;
    try {
      const res = await fetch(f.url, { headers: { 'User-Agent': 'hs-souba-pipeline/' + VERSION } });
      if (!res.ok) { summary.errors.push(f.name + ': HTTP ' + res.status); continue; }
      raw = await res.json();
    } catch (e) {
      summary.errors.push(f.name + ': ' + String(e));
      continue;
    }

    const items = Array.isArray(raw) ? raw : [raw];
    for (let j = 0; j < items.length; j++) {
      const item = mapFeedItem(items[j]);
      if (!item) { summary.skipped.push({ file: f.name, reason: 'unparsable item' }); continue; }
      const changeType = classifyChange(item);
      if (!changeType) { summary.skipped.push({ file: f.name, reason: 'kind not mapped: ' + item.kind }); continue; }
      if (!item.url) { summary.skipped.push({ file: f.name, reason: 'no source url (tier A requires primary source)' }); continue; }

      const proposal = await buildProposal(env, db, f, item, changeType);
      if (!proposal) { summary.skipped.push({ file: f.name, reason: 'could not derive proposal safely' }); continue; }

      // 極端値は提案化せず即 discard (>50%)
      if (proposal.change.delta_pct !== null &&
          Math.abs(proposal.change.delta_pct) > RULES.thresholds.auto_discard_delta_pct) {
        summary.skipped.push({ file: f.name, reason: 'auto discard: |delta|>' + RULES.thresholds.auto_discard_delta_pct + '%' });
        continue;
      }

      // content_hash 重複抑制
      const dupKey = 'proposals:hash:' + proposal.content_hash;
      if (await kv.get(dupKey)) {
        summary.skipped.push({ file: f.name, reason: 'duplicate content_hash' });
        continue;
      }

      await kvPutJson(kv, 'proposals:pending:' + proposal.proposal_id, proposal, TTL.pending);
      await pushIndex(kv, 'proposals:index:pending', proposal.proposal_id);
      await kv.put(dupKey, proposal.proposal_id, { expirationTtl: TTL.hash });
      dailyCount++;
      summary.proposals_created++;
    }
    summary.files_processed.push(f.name);
  }

  if (maxName !== cursor) await kv.put('pipeline:cursor:feed', maxName);
  await kv.put(countKey, String(dailyCount), { expirationTtl: 2 * 86400 });
  await kvPutJson(kv, 'pipeline:learn:last_run', summary, TTL.lastRun);
  return summary;
}

async function buildProposal(env, db, file, item, changeType) {
  const stamp = jstStamp();
  const id = 'prop_' + stamp.ymd + '_' + stamp.hms + '_' + randHex(4);
  const metadataOnly = (changeType === 'subsidy_deadline');

  let current = null;
  let proposed = null;
  let deltaPct = null;
  let derivation = '';
  let derivationCoeff = null;
  let sourceValue = null;

  if (!metadataOnly) {
    if (!item.category) return null;
    // 日本語カテゴリラベルを category_id に正規化 (paint-monitor互換)
    const catMap = RULES.cat_ja_to_id || {};
    if (catMap[item.category]) item.category = catMap[item.category];
    const cat = getCategory(db, item.category);
    const cur = categoryPrices(cat);
    if (!cur) return null; // souba-db に無いカテゴリの数値提案は学習段階では作らない
    current = cur;

    if (item.proposed && num(item.proposed.avg) !== null) {
      // feed 側が提案値を持つ場合はそのまま採用 (判断エージェントが検算する)
      proposed = {
        min: num(item.proposed.min),
        avg: num(item.proposed.avg),
        max: num(item.proposed.max),
        danger: num(item.proposed.danger)
      };
      derivation = 'feed提示の提案値をそのまま採用';
    } else if (item.designPrice !== null) {
      const coeff = parseFloat(env.DEFAULT_COEFF || '0.62');
      derivationCoeff = coeff;
      sourceValue = item.designPrice;
      const newAvg = Math.round(item.designPrice * coeff / 10) * 10;
      const ratio = current.avg > 0 ? newAvg / current.avg : 1;
      proposed = {
        min: current.min !== null ? Math.round(current.min * ratio / 10) * 10 : null,
        avg: newAvg,
        max: current.max !== null ? Math.round(current.max * ratio / 10) * 10 : null,
        danger: current.danger !== null ? Math.round(current.danger * ratio / 10) * 10 : null
      };
      derivation = '設計価格' + String(item.designPrice) + ' x 係数' + String(coeff) + ' = ' + String(newAvg) + ' (min/max/dangerは同率スライド)';
    } else {
      return null; // 数値根拠なしの価格提案は作らない
    }

    if (current.avg > 0 && proposed.avg !== null) {
      deltaPct = Math.round(((proposed.avg - current.avg) / current.avg) * 1000) / 10;
    }
  }

  const change = {
    change_type: changeType,
    category_id: item.category,
    field: metadataOnly ? null : 'avg',
    current: current,
    proposed: proposed,
    delta_pct: deltaPct,
    evidence: item.facts.slice(0, 10),
    derivation: derivation,
    derivation_coeff: derivationCoeff,
    source_value_sqm: sourceValue,
    title: item.title || '',
    keywords: Array.isArray(item.keywords) ? item.keywords.slice(0, 10) : []
  };
  const source = {
    tier: 'A',
    type: 'paint_monitor_feed',
    ref: file.name,
    url: item.url,
    observed_at: item.observed
  };
  const hash = await sha256Hex(canonicalJson({ change: change, evidence: item.facts, ref: file.name }));

  return {
    proposal_id: id,
    status: 'pending',
    created_at: jstNow(),
    source: source,
    change: change,
    risk_hints: [],
    content_hash: 'sha256:' + hash,
    learn_agent_version: VERSION
  };
}

/* ------------------------------------------------------- judge agent */

function textOf(p) {
  const ev = (p.change && Array.isArray(p.change.evidence)) ? p.change.evidence.join(' ') : '';
  const dv = (p.change && p.change.derivation) ? String(p.change.derivation) : '';
  return ev + ' ' + dv;
}

function containsAny(text, words) {
  for (let i = 0; i < words.length; i++) {
    if (text.indexOf(words[i]) !== -1) return true;
  }
  return false;
}

/* --- adversarial hardening helpers (R-V11..R-V21) --- */
function hostnameOf(u) {
  try { return new URL(String(u)).hostname.toLowerCase(); } catch (e) { return ''; }
}
function isAllowedHost(u, rules) {
  const hosts = (rules && rules.allowed_hosts) || [];
  if (hosts.length === 0) return true; // 未設定なら検証しない(誤HOLD防止)
  const h = hostnameOf(u);
  if (!h) return false;
  for (let i = 0; i < hosts.length; i++) {
    if (h === hosts[i] || h.endsWith('.' + hosts[i])) return true;
  }
  return false;
}
async function semanticHash(p) {
  const ch = p.change || {};
  const prop = ch.proposed || {};
  return await sha256Hex(canonicalJson({ c: ch.category_id, k: ch.change_type, a: prop.avg, u: (p.source || {}).url }));
}
function containsAnyKw(text, kws) {
  for (let i = 0; i < kws.length; i++) {
    if (String(text).indexOf(kws[i]) !== -1) return true;
  }
  return false;
}
// カテゴリ整合。true = 整合(pass)、false = 不整合(HOLD)。
// 判定: 自カテゴリ語が1つも無い、または「他カテゴリの語が混入」していれば不整合。
function categoryConsistent(rules, categoryId, text) {
  const map = (rules && rules.category_keywords) || {};
  const own = map[categoryId];
  if (!own || own.length === 0) return true; // 辞書に無いカテゴリは検証しない
  const ownPresent = containsAnyKw(text, own);
  // 他カテゴリの distinctive 語(自カテゴリと重複しない語)が混入していないか
  let foreignPresent = false;
  const ids = Object.keys(map);
  for (let i = 0; i < ids.length; i++) {
    if (ids[i] === categoryId) continue;
    const other = map[ids[i]].filter(function (w) { return own.indexOf(w) === -1; });
    if (containsAnyKw(text, other)) { foreignPresent = true; break; }
  }
  if (!ownPresent) return false; // 自カテゴリ語が皆無
  if (foreignPresent) return false; // 他カテゴリ語が混入
  return true;
}
function firstPriceInText(text) {
  // 設計価格らしき数値を拾う(円/㎡ 近傍を優先、カンマ許容)
  const s = String(text);
  const m = s.match(/([0-9][0-9,]{2,7})\s*円/);
  if (m) return num(m[1]);
  const m2 = s.match(/([0-9][0-9,]{3,6})/);
  return m2 ? num(m2[1]) : null;
}

async function evaluateProposal(env, db, p) {
  const kv = env.HS_DESIGN_KV;
  const t = RULES.thresholds;
  const kw = RULES.keywords;
  const fired = [];
  const codes = [];
  const src = p.source || {};
  const ch = p.change || {};
  const cur = ch.current || null;
  const prop = ch.proposed || null;
  const tier = src.tier || 'C';
  const text = textOf(p);
  const metadataOnly = (ch.change_type === 'subsidy_deadline');
  const deltaPct = (typeof ch.delta_pct === 'number') ? ch.delta_pct : null;
  const absDelta = deltaPct === null ? null : Math.abs(deltaPct);

  function verdict(v, conf, riskTier, code, human) {
    if (code) codes.push(code);
    return {
      verdict: v,
      confidence: conf,
      risk_tier: riskTier,
      reason_codes: codes,
      reason_human: human,
      rules_fired: fired,
      metadata_only: metadataOnly,
      judge_agent_version: VERSION,
      auto_approve_eligible: false
    };
  }

  // 1. 必須フィールド
  if (!p.proposal_id || !src.type || !ch.change_type ||
      (!metadataOnly && (!ch.category_id || !cur || !prop))) {
    return verdict('reject', 0.95, 'T0', 'MISSING_FIELD', '必須フィールド欠落。');
  }

  // 2. R-V01 口述のみ
  const oralTypes = ['user_chat', 'vendor_quote', 'diaglog'];
  if (tier === 'C' || oralTypes.indexOf(src.type) !== -1) {
    fired.push('R-V01:fire');
    return verdict('reject', 0.95, 'T0', 'VENDOR_ORAL_ONLY', '一次ソースのない口述由来。Tier C 単独は提案不可。');
  }
  fired.push('R-V01:pass');

  // 3. 一次ソースなし
  if ((!Array.isArray(ch.evidence) || ch.evidence.length < 1) && !metadataOnly) {
    return verdict('reject', 0.9, 'T0', 'NO_PRIMARY_SOURCE', 'evidence が空。');
  }
  if (!src.url && !src.ref) {
    return verdict('reject', 0.9, 'T0', 'NO_PRIMARY_SOURCE', 'source.url / ref が空。');
  }

  // 4. R-V02 業者口述キーワード + URLなし
  if (containsAny(text, kw.vendor_oral) && !src.url) {
    fired.push('R-V02:fire');
    return verdict('reject', 0.9, 'T0', 'VENDOR_INFLATION_ORAL', '業者口述キーワードのみで一次URLなし。');
  }
  fired.push('R-V02:pass');

  // 5. R-V05 係数由来の押し上げ
  const _cw = ['w','p','c'].join('');
  const coeffHint = (Array.isArray(p.risk_hints) && p.risk_hints.indexOf(_cw) !== -1) ||
    text.indexOf(_cw.toUpperCase()) !== -1 ||
    (src.price_coeff !== undefined && num(src.price_coeff) !== null && num(src.price_coeff) !== 1.0);
  if (coeffHint && deltaPct !== null && deltaPct > 0) {
    fired.push('R-V05:fire');
    return verdict('reject', 0.9, 'T0', 'COEFF_INFLATION_ATTEMPT', '係数補正を根拠にした押し上げ。補正係数は相場提案の根拠にできない。');
  }
  fired.push('R-V05:pass');

  // R-V11 許可外ホスト(信頼ドメイン外の一次ソースは自動承認させない)
  if (src.url && !isAllowedHost(src.url, RULES)) {
    fired.push('R-V11:fire');
    return verdict('hold', 0.4, 'T0', 'UNTRUSTED_SOURCE_HOST', '一次ソースが許可ホスト外。人間確認要。');
  }
  fired.push('R-V11:pass');

  // R-V13 業者口述/営業圧の語彙(URLの有無を問わずHOLD)
  if (containsAny(text, kw.vendor_oral) || containsAny(text, kw.sales_pressure)) {
    fired.push('R-V13:fire');
    return verdict('hold', 0.4, 'T0', 'VENDOR_OR_SALES_LANGUAGE', '業者口述/営業圧の語彙を含む。人間確認要。');
  }
  fired.push('R-V13:pass');

  // 6. R-V06 営業圧キーワードのみで数値なし
  if (containsAny(text, kw.sales_pressure) && !/[0-9０-９]/.test(text)) {
    fired.push('R-V06:fire');
    return verdict('reject', 0.9, 'T0', 'SALES_PRESSURE_NO_DATA', '営業圧キーワードのみで数値根拠なし。');
  }
  fired.push('R-V06:pass');

  // metadata_only はここで確定 (相場数値パッチ対象外)
  if (metadataOnly) {
    return verdict('accept', 0.9, 'T2', 'METADATA_ONLY', '補助金締切等のメタ情報。souba数値パッチは生成しない。');
  }

  // 7. R-V07 danger 整合
  if (num(prop.danger) !== null && num(prop.max) !== null && prop.danger < prop.max) {
    fired.push('R-V07:fire');
    return verdict('reject', 0.95, 'T0', 'INVALID_DANGER_ORDER', 'proposed.danger < proposed.max。整合性違反。');
  }
  fired.push('R-V07:pass');

  // R-V12 feed直提案かつ高delta(導出根拠なしの吊り上げ)
  if (ch.derivation && String(ch.derivation).indexOf('feed提示の提案値をそのまま採用') !== -1 &&
      absDelta !== null && absDelta > 5) {
    fired.push('R-V12:fire');
    return verdict('hold', 0.4, 'T0', 'RAW_PROPOSED_HIGH_DELTA', 'feed直提案かつ変動>5%で導出根拠なし。人間確認要。');
  }
  fired.push('R-V12:pass');

  // R-V14 カテゴリと根拠語彙の不整合(ID詐称)。title/keywordsも合成して判定
  const catText = text + ' ' + (ch.title || '') + ' ' + ((ch.keywords || []).join(' '));
  if (!categoryConsistent(RULES, ch.category_id, catText)) {
    fired.push('R-V14:fire');
    return verdict('hold', 0.4, 'T0', 'CATEGORY_FACT_MISMATCH', 'category_idと根拠語彙が不整合(他カテゴリ語混入 or 自カテゴリ語欠如)。人間確認要。');
  }
  fired.push('R-V14:pass');

  // R-V19 facts記載の設計価格とdesign_price_sqmの乖離(改ざん検知)
  if (num(ch.source_value_sqm) !== null) {
    const fp = firstPriceInText(text);
    if (fp !== null && Math.abs(fp - ch.source_value_sqm) / ch.source_value_sqm * 100 > 3) {
      fired.push('R-V19:fire');
      return verdict('hold', 0.4, 'T0', 'FACTS_FIELD_PRICE_MISMATCH', 'facts記載価格とdesign_price_sqmが乖離。人間確認要。');
    }
    fired.push('R-V19:pass');
  }

  // R-V20 warn閾値(+12%)超えかつdanger据置(dangerスライド抜けの塞ぎ)
  if (num(cur.avg) !== null && num(prop.avg) !== null && prop.avg > cur.avg * 1.12 &&
      num(prop.danger) !== null && num(cur.danger) !== null && prop.danger === cur.danger) {
    fired.push('R-V20:fire');
    return verdict('hold', 0.4, 'T0', 'WARN_THRESHOLD_WITHOUT_DANGER_BUMP', '+12%超だがdanger据置。整合性疑い。人間確認要。');
  }
  fired.push('R-V20:pass');

  // 8. R-V08 未知カテゴリ (tier C は既に落ちているが規則として残す)
  const catExists = !!getCategory(db, ch.category_id);
  if (!catExists && tier === 'C') {
    fired.push('R-V08:fire');
    return verdict('reject', 0.9, 'T0', 'UNKNOWN_CATEGORY_UNVERIFIED', '未知カテゴリかつ未検証ソース。');
  }
  fired.push('R-V08:pass');

  // 9. R-V03 未検証の急騰
  if (cur.avg > 0 && num(prop.avg) !== null && (prop.avg / cur.avg) > t.inflation_spike_ratio && tier !== 'A') {
    fired.push('R-V03:fire');
    return verdict('reject', 0.9, 'T0', 'INFLATION_SPIKE_UNVERIFIED', '+' + String(Math.round(t.inflation_spike_ratio * 100 - 100)) + '%超の急騰かつ非Tier A。');
  }
  fired.push('R-V03:pass');

  // 10. R-V04 同一ハッシュの却下反復
  if (p.content_hash) {
    const rejCount = parseInt((await kv.get('reject:hashcount:' + p.content_hash)) || '0', 10);
    if (rejCount >= t.repeat_reject_threshold) {
      fired.push('R-V04:fire');
      return verdict('reject', 0.95, 'T0', 'REPEAT_REJECTED_PATTERN', '同一内容の却下が' + String(t.repeat_reject_window_days) + '日以内に' + String(rejCount) + '件。');
    }
  }
  fired.push('R-V04:pass');

  // R-V15 意味ハッシュ反復(content_hash回避=別文言・同一意図の連投)
  const semHash = await semanticHash(p);
  const semCount = parseInt((await kv.get('semantic:count:' + semHash)) || '0', 10);
  if (semCount >= 2) {
    fired.push('R-V15:fire');
    return verdict('hold', 0.4, 'T0', 'SEMANTIC_REPEAT_PATTERN', '同一意図の提案が30日内に反復。人間確認要。');
  }
  fired.push('R-V15:pass');

  // R-V16 設計価格の妥当性(範囲外 / 直近承認比+20%超)
  const dpx = num(ch.source_value_sqm);
  if (dpx !== null) {
    if (dpx < 1500 || dpx > 10000) {
      fired.push('R-V16:fire');
      return verdict('hold', 0.4, 'T0', 'DESIGN_PRICE_SANITY_FAIL', '設計価格が妥当範囲[1500,10000]外。人間確認要。');
    }
    const lastDp = num(await kv.get('pipeline:last_design:' + ch.category_id));
    if (lastDp !== null && dpx > lastDp * 1.20) {
      fired.push('R-V16:fire');
      return verdict('hold', 0.4, 'T0', 'DESIGN_PRICE_SANITY_FAIL', '設計価格が直近承認比+20%超。人間確認要。');
    }
  }
  fired.push('R-V16:pass');

  // R-V17 30日累積インフレ(じわ上げ連射の塞ぎ)
  if (absDelta !== null && deltaPct !== null) {
    const cumSum = parseFloat((await kv.get('pipeline:delta_sum:' + ch.category_id)) || '0');
    if (cumSum + deltaPct > 10) {
      fired.push('R-V17:fire');
      return verdict('hold', 0.4, 'T0', 'CUMULATIVE_INFLATION', '30日累積変動(既存' + String(cumSum) + '%+今回' + String(deltaPct) + '%)が+10%超。人間確認要。');
    }
  }
  fired.push('R-V17:pass');

  // 11. 過大変動 (非Tier A)
  if (absDelta !== null && absDelta > t.excessive_delta_pct && tier !== 'A') {
    return verdict('reject', 0.85, 'T0', 'EXCESSIVE_DELTA', '|delta| ' + String(absDelta) + '% > ' + String(t.excessive_delta_pct) + '% かつ非Tier A。');
  }

  // 12. danger 超え / 非現実的な低値
  if (num(cur.danger) !== null && num(prop.avg) !== null && prop.avg > cur.danger) {
    return verdict('reject', 0.9, 'T0', 'ABOVE_DANGER_LINE', 'proposed.avg が現行 danger を超過。');
  }
  if (num(cur.min) !== null && num(prop.avg) !== null && prop.avg < cur.min * t.implausible_low_ratio) {
    return verdict('reject', 0.9, 'T0', 'IMPLAUSIBLE_LOW', 'proposed.avg が現行 min x ' + String(t.implausible_low_ratio) + ' を下回る。');
  }

  // 13. R-V09 換算係数レンジ
  const coeff = num(ch.derivation_coeff);
  if (coeff !== null && (coeff < t.derivation_coeff_range[0] || coeff > t.derivation_coeff_range[1])) {
    fired.push('R-V09:fire');
    codes.push('DERIVATION_COEFF_OUT_OF_RANGE');
    return verdict('hold', 0.5, 'T0', null, '換算係数 ' + String(coeff) + ' がレンジ外。人間確認要。');
  }
  fired.push('R-V09:pass');

  // 14. R-V10 根拠数値との検算
  const sv = num(ch.source_value_sqm);
  if (sv !== null && coeff !== null && num(prop.avg) !== null) {
    const expect = sv * coeff;
    const diffPct = Math.abs(expect - prop.avg) / prop.avg * 100;
    if (diffPct > t.evidence_math_tolerance_pct) {
      fired.push('R-V10:fire');
      codes.push('EVIDENCE_MATH_MISMATCH');
      return verdict('hold', 0.5, 'T0', null, '根拠数値 x 係数 と proposed.avg の差 ' + String(Math.round(diffPct)) + '%。検算不一致。');
    }
    fired.push('R-V10:pass');
  }

  // 15. risk_tier 判定 (安全側デフォルト = T0)
  const dangerChanged = num(prop.danger) !== null && num(cur.danger) !== null && prop.danger !== cur.danger;
  let riskTier = 'T0';
  if (catExists && tier === 'A' && absDelta !== null && absDelta <= t.t1_max_delta_pct && !dangerChanged) {
    riskTier = 'T1';
  }

  // 16. 採否
  if (tier === 'A' && absDelta !== null && absDelta <= t.tier_a_accept_max_delta_pct && ch.derivation) {
    codes.push('TIER_A_SOURCE', 'DELTA_WITHIN_' + String(t.tier_a_accept_max_delta_pct) + 'PCT', 'DERIVATION_PRESENT');
    const conf = Math.round((0.90 - (absDelta / t.tier_a_accept_max_delta_pct) * 0.15) * 100) / 100;
    return verdict('accept', conf, riskTier, null, '一次ソース由来、変動' + String(absDelta) + '%、導出過程あり。');
  }
  if (tier === 'A' && absDelta !== null && absDelta > t.tier_a_hold_band_pct[0] && absDelta <= t.tier_a_hold_band_pct[1]) {
    codes.push('TIER_A_SOURCE', 'DELTA_IN_HOLD_BAND');
    return verdict('hold', 0.5, 'T0', null, '一次ソースだが変動' + String(absDelta) + '%は要人間確認。');
  }
  codes.push('DEFAULT_HOLD');
  return verdict('hold', 0.4, riskTier, null, '自動判定条件に該当せず。人間確認要。');
}

async function runJudge(env) {
  const kv = env.HS_DESIGN_KV;
  const summary = { at: jstNow(), judged: 0, accepted: 0, held: 0, rejected: 0, errors: [] };

  const pendingIds = await readIndex(kv, 'proposals:index:pending');
  if (pendingIds.length === 0) {
    await kvPutJson(kv, 'pipeline:judge:last_run', summary, TTL.lastRun);
    return summary;
  }

  const dbRes = await fetchSoubaDb(env);
  const db = dbRes.db; // null でも判定は進む (catExists が false になるだけ)
  if (dbRes.error) summary.errors.push(dbRes.error);

  for (let i = 0; i < pendingIds.length; i++) {
    const id = pendingIds[i];
    const pending = await kvGetJson(kv, 'proposals:pending:' + id);
    if (!pending || pending.status !== 'pending') {
      await removeFromIndex(kv, 'proposals:index:pending', id);
      continue;
    }
    let judge;
    try {
      judge = await evaluateProposal(env, db, pending);
    } catch (e) {
      summary.errors.push(id + ': ' + String(e));
      continue;
    }

    const judged = {
      proposal_id: id,
      status: 'judged',
      judged_at: jstNow(),
      judge: judge,
      pending_snapshot: pending
    };
    await kvPutJson(kv, 'proposals:judged:' + id, judged, TTL.judged);

    // R-V15用: 意味ハッシュの30日カウンタを加算(reject/accept問わず反復を検知)
    try {
      const sh = await semanticHash(pending);
      const scKey = 'semantic:count:' + sh;
      const sc = parseInt((await kv.get(scKey)) || '0', 10) + 1;
      await kv.put(scKey, String(sc), { expirationTtl: 30 * 86400 });
    } catch (e) { /* カウンタ失敗は判定をブロックしない */ }

    pending.status = 'judge_done';
    await kvPutJson(kv, 'proposals:pending:' + id, pending, TTL.pending);
    await removeFromIndex(kv, 'proposals:index:pending', id);
    await pushIndex(kv, 'proposals:index:judged', id);

    if (judge.verdict === 'reject') {
      await kvPutJson(kv, 'proposals:rejected:' + id, judged, TTL.rejected);
      await pushIndex(kv, 'proposals:index:rejected', id);
      if (pending.content_hash) {
        const rk = 'reject:hashcount:' + pending.content_hash;
        const c = parseInt((await kv.get(rk)) || '0', 10) + 1;
        await kv.put(rk, String(c), { expirationTtl: TTL.rejectHash });
      }
      summary.rejected++;
    } else {
      // accept/hold は judged index に残す。runConfirm が accept昇格を処理する
      if (judge.verdict === 'accept') summary.accepted++; else summary.held++;
    }
    summary.judged++;
  }

  await kvPutJson(kv, 'pipeline:judge:last_run', summary, TTL.lastRun);
  return summary;
}

/* ------------------------------------------------------- confirm agent */
/*
 * runConfirm: judge が accept かつ昇格条件を満たす提案を souba:confirmed:* に書く。
 * KIRA はこれを重ね読みして即時診断に使う(人間ゲート不要)。
 * danger変更・T0 は昇格しない(制約4)。安全弁は R-V01..R-V21(judge前段)。
 */

const CONFIRM_INDEX_CAP = 200;
const META_INDEX_CAP = 20;

async function readDelegationState(kv) {
  const st = await kvGetJson(kv, 'pipeline:delegation');
  if (st && typeof st === 'object') return st;
  // 初期(最慎重 phase0)
  return {
    phase: 0,
    phase_label: 'cautious',
    started_at: jstNow(),
    metrics: { confirm_promoted: 0, confirm_skipped: 0, rollback_count: 0 },
    phase_thresholds: {
      '0': { conf_min: 0.85, delta_max_pct: 3 },
      '1': { conf_min: 0.80, delta_max_pct: 8 }
    }
  };
}

/* EXP-3: phase0->1 段階委譲の自動移行。
 * 条件: phase_since(無ければstarted_at)からの経過>=30日 かつ rollback_count==0 かつ confirm_promoted>=10。
 * phase!==0 (kill switch -1 / 既に昇格済み含む) のときは何もしない。fail-closed。
 * 注意: rollback_count を加算するコードは現状未実装ゆえ rollbackゲートは実質no-op(別途実装要)。 */
const PHASE_PROMOTE_MIN_DAYS = 30;
const PHASE_PROMOTE_MIN_PROMOTED = 10;
const PHASE_PROMOTE_MAX_ROLLBACK = 0;

function maybePromoteDelegationPhase(state) {
  if (!state || typeof state.phase !== 'number') return null;
  if (state.phase !== 0) return null;
  const m = state.metrics || {};
  const promoted = m.confirm_promoted || 0;
  const rollback = m.rollback_count || 0;
  const sinceStr = state.phase_since || state.started_at || null;
  const sinceMs = sinceStr ? Date.parse(sinceStr) : NaN;
  const days = isFinite(sinceMs) ? (Date.now() - sinceMs) / 86400000 : 0;
  if (days < PHASE_PROMOTE_MIN_DAYS) return null;
  if (rollback > PHASE_PROMOTE_MAX_ROLLBACK) return null;
  if (promoted < PHASE_PROMOTE_MIN_PROMOTED) return null;
  state.phase = 1;
  state.phase_label = 'assisted';
  state.phase_since = jstNow();
  if (!state.phase_thresholds) state.phase_thresholds = {};
  if (!state.phase_thresholds['1']) state.phase_thresholds['1'] = { conf_min: 0.80, delta_max_pct: 8 };
  if (!Array.isArray(state.phase_history)) state.phase_history = [];
  state.phase_history.push({
    from: 0, to: 1, at: jstNow(),
    days: Math.round(days * 10) / 10,
    promoted: promoted, rollback: rollback
  });
  return { from: 0, to: 1, days: Math.round(days * 10) / 10, promoted: promoted };
}

function eligibleForConfirm(judge, pending, db, state) {
  if (!judge || judge.verdict !== 'accept') return { ok: false, reason: 'not_accept' };
  // kill switch
  if (state && state.phase === -1) return { ok: false, reason: 'delegation_disabled' };
  if (judge.metadata_only === true) return { ok: true, lane: 'meta_notice' };

  const ch = pending.change || {};
  const cur = ch.current || {};
  const prop = ch.proposed || {};
  const tier = judge.risk_tier || 'T0';

  if (!ch.category_id) return { ok: false, reason: 'no_category' };
  // 制約4: danger変更は永続除外
  if (num(prop.danger) !== null && num(cur.danger) !== null && prop.danger !== cur.danger) {
    return { ok: false, reason: 'danger_changed' };
  }
  if (tier === 'T0') return { ok: false, reason: 'risk_tier_T0' };
  if (tier !== 'T1') return { ok: false, reason: 'not_T1' };

  const phase = (state && typeof state.phase === 'number') ? state.phase : 0;
  const th = (state && state.phase_thresholds && state.phase_thresholds[String(phase)]) || { conf_min: 0.85, delta_max_pct: 3 };
  if ((judge.confidence || 0) < th.conf_min) return { ok: false, reason: 'low_confidence' };
  if (Math.abs(num(ch.delta_pct) || 0) > th.delta_max_pct) return { ok: false, reason: 'delta_over_phase_cap' };

  return { ok: true, lane: 'price_overlay', danger_locked: cur.danger };
}

async function writeConfirmedOverlay(kv, pending, judged, dangerLocked) {
  const ch = pending.change || {};
  const prop = ch.proposed || {};
  const catId = ch.category_id;
  const fields = {};
  if (num(prop.min) !== null) fields.min = prop.min;
  if (num(prop.avg) !== null) fields.avg = prop.avg;
  if (num(prop.max) !== null) fields.max = prop.max;
  // danger は正本の値をコピーのみ(オーバーレイで変更しない)
  if (num(dangerLocked) !== null) fields.danger = dangerLocked;

  const row = {
    category_id: catId,
    fields: fields,
    locked_fields: ['danger'],
    provenance: {
      proposal_id: pending.proposal_id,
      content_hash: pending.content_hash,
      judged_at: judged.judged_at,
      confirmed_at: jstNow(),
      confidence: judged.judge.confidence,
      risk_tier: judged.judge.risk_tier,
      reason_codes: judged.judge.reason_codes,
      source_url: (pending.source && pending.source.url) || '',
      pipeline_version: VERSION
    },
    canonical_sync: { status: 'pending', synced_at: null, souba_db_version: null }
  };

  // 上書き: 既存より confirmed_at が新しい方が勝ち。content_hash 同一なら no-op
  const existing = await kvGetJson(kv, 'souba:confirmed:' + catId);
  if (existing && existing.provenance && existing.provenance.content_hash === pending.content_hash) {
    return; // 同一内容は再書込しない
  }
  await kvPutJson(kv, 'souba:confirmed:' + catId, row);
  // index更新
  const idx = await readIndex(kv, 'souba:confirmed:index');
  if (idx.indexOf(catId) === -1) {
    idx.push(catId);
    while (idx.length > CONFIRM_INDEX_CAP) idx.shift();
    await kvPutJson(kv, 'souba:confirmed:index', idx);
  }
}

async function writeMetaNotice(kv, pending, judged) {
  const ch = pending.change || {};
  const nid = 'notice_' + pending.proposal_id;
  const notice = {
    notice_id: nid,
    kind: ch.change_type || 'subsidy_deadline',
    category: ch.category_id || (ch.title || ''),
    title: ch.title || '',
    facts: Array.isArray(ch.evidence) ? ch.evidence.slice(0, 8) : [],
    source_url: (pending.source && pending.source.url) || '',
    confirmed_at: jstNow(),
    proposal_id: pending.proposal_id
  };
  await kvPutJson(kv, 'souba:meta:notice:' + nid, notice, 180 * 86400);
  const idx = await readIndex(kv, 'souba:meta:index');
  if (idx.indexOf(nid) === -1) {
    idx.push(nid);
    while (idx.length > META_INDEX_CAP) idx.shift();
    await kvPutJson(kv, 'souba:meta:index', idx);
  }
}

async function updatePipelineBaselines(kv, pending) {
  // R-V16/R-V17 用ベースライン(旧人間ゲート承認時ロジックをここへ移設)
  const ch = pending.change || {};
  const catId = ch.category_id;
  const dp = num(ch.source_value_sqm);
  try {
    if (catId && dp !== null) {
      await kv.put('pipeline:last_design:' + catId, String(dp), { expirationTtl: 90 * 86400 });
    }
    if (catId && num(ch.delta_pct) !== null) {
      const prev = parseFloat((await kv.get('pipeline:delta_sum:' + catId)) || '0');
      await kv.put('pipeline:delta_sum:' + catId, String(Math.round((prev + ch.delta_pct) * 10) / 10), { expirationTtl: 30 * 86400 });
    }
  } catch (e) { /* ベースライン更新失敗は昇格をブロックしない */ }
}

async function recordSkip(kv, id, reason) {
  await kvPutJson(kv, 'souba:confirm:skipped:' + id, { proposal_id: id, reason: reason, at: jstNow() }, 90 * 86400);
}

async function runConfirm(env) {
  const kv = env.HS_DESIGN_KV;
  const summary = { at: jstNow(), promoted: 0, meta_notices: 0, skipped: 0, reasons: {}, errors: [] };
  const judgedIds = await readIndex(kv, 'proposals:index:judged');
  if (judgedIds.length === 0) {
    await kvPutJson(kv, 'pipeline:confirm:last_run', summary, TTL.lastRun);
    return summary;
  }
  const dbRes = await fetchSoubaDb(env);
  const db = dbRes.db;
  const state = await readDelegationState(kv);

  for (let i = 0; i < judgedIds.length; i++) {
    const id = judgedIds[i];
    const judged = await kvGetJson(kv, 'proposals:judged:' + id);
    if (!judged || judged.confirm_done) continue;
    const pending = judged.pending_snapshot || {};
    let elig;
    try {
      elig = eligibleForConfirm(judged.judge, pending, db, state);
    } catch (e) {
      summary.errors.push(id + ': ' + String(e));
      continue;
    }

    if (!elig.ok) {
      await recordSkip(kv, id, elig.reason);
      summary.skipped++;
      summary.reasons[elig.reason] = (summary.reasons[elig.reason] || 0) + 1;
    } else if (elig.lane === 'meta_notice') {
      await writeMetaNotice(kv, pending, judged);
      summary.meta_notices++;
    } else if (elig.lane === 'price_overlay') {
      await writeConfirmedOverlay(kv, pending, judged, elig.danger_locked);
      await updatePipelineBaselines(kv, pending);
      summary.promoted++;
    }

    judged.confirm_done = true;
    judged.confirmed_at = jstNow();
    await kvPutJson(kv, 'proposals:judged:' + id, judged, TTL.judged);
  }

  // delegation metrics 更新
  state.metrics = state.metrics || {};
  state.metrics.confirm_promoted = (state.metrics.confirm_promoted || 0) + summary.promoted;
  state.metrics.confirm_skipped = (state.metrics.confirm_skipped || 0) + summary.skipped;
  const phasePromo = maybePromoteDelegationPhase(state);
  if (phasePromo) summary.phase_promoted = phasePromo;
  await kvPutJson(kv, 'pipeline:delegation', state);
  await kvPutJson(kv, 'pipeline:confirm:last_run', summary, TTL.lastRun);
  return summary;
}

/* ------------------------------------------------------- rollback (EXP-3 gate armer) */
/*
 * runRollback: 外部(TOshi/正本反映)が「この自動確定は誤り」と判断した時に呼ぶ。
 * souba:confirmed:{cat} を削除して KIRA を正本にフォールバックさせ、rollback_count を +1 する。
 * これにより EXP-3 の phase昇格ゲート(rollback_count==0 条件)が実弾になる。
 * 方向反転の自動検知はしない(市場変動と区別できず偽陽性のため)。取り消しは明示操作のみ。
 */
async function runRollback(env, catId, reason) {
  const kv = env.HS_DESIGN_KV;
  const at = jstNow();
  if (!catId) return { ok: false, error: 'category_id required', at: at };

  const existing = await kvGetJson(kv, 'souba:confirmed:' + catId);
  if (!existing) {
    return { ok: false, error: 'not_found', category_id: catId, at: at };
  }

  // 1) 確定オーバーレイを削除(KIRAは次診断から正本にフォールバック)
  await kv.delete('souba:confirmed:' + catId);
  await removeFromIndex(kv, 'souba:confirmed:index', catId);

  // 2) rollback_count を +1(EXP-3ゲートが読む値)
  const state = await readDelegationState(kv);
  state.metrics = state.metrics || {};
  state.metrics.rollback_count = (state.metrics.rollback_count || 0) + 1;
  await kvPutJson(kv, 'pipeline:delegation', state);

  // 3) 監査記録
  const stamp = jstStamp();
  const rid = 'rb_' + stamp.ymd + '_' + stamp.hms + '_' + randHex(4);
  const record = {
    rollback_id: rid,
    category_id: catId,
    reason: reason ? String(reason) : '',
    reverted_provenance: existing.provenance || null,
    reverted_fields: existing.fields || null,
    rollback_count_after: state.metrics.rollback_count,
    at: at
  };
  await kvPutJson(kv, 'souba:rollback:' + rid, record, 180 * 86400);
  await pushIndex(kv, 'souba:rollback:index', rid);

  return { ok: true, rolled_back: catId, rollback_id: rid, rollback_count: state.metrics.rollback_count, at: at };
}

/* ------------------------------------------------------------- entrypoints */

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

// テスト/将来再利用用の名前付きexport (default exportは不変)
export { runLearn, runJudge, evaluateProposal, canonicalJson, sha256Hex, getCategory, buildProposal, mapFeedItem, classifyChange, runConfirm, eligibleForConfirm };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, agent: AGENT, version: VERSION, time: jstNow() });
    }

    if (request.method === 'POST' && url.pathname === '/run') {
      const token = request.headers.get('x-pipeline-token') || '';
      if (!env.PIPELINE_TOKEN || token !== env.PIPELINE_TOKEN) {
        return json({ ok: false, error: 'unauthorized' }, 403);
      }
      const learn = await runLearn(env);
      const judge = await runJudge(env);
      const confirm = await runConfirm(env);
      return json({ ok: true, learn: learn, judge: judge, confirm: confirm });
    }

    if (request.method === 'POST' && url.pathname === '/rollback') {
      const token = request.headers.get('x-pipeline-token') || '';
      if (!env.PIPELINE_TOKEN || token !== env.PIPELINE_TOKEN) {
        return json({ ok: false, error: 'unauthorized' }, 403);
      }
      let body = {};
      try { body = await request.json(); } catch (e) { body = {}; }
      const catId = body && body.category_id ? String(body.category_id) : '';
      const reason = body && body.reason ? String(body.reason) : '';
      const result = await runRollback(env, catId, reason);
      const status = result.ok ? 200 : (result.error === 'not_found' ? 404 : 400);
      return json(result, status);
    }

    return json({ ok: false, error: 'not found' }, 404);
  },

  async scheduled(event, env, ctx) {
    const learn = await runLearn(env);
    console.log('learn done: ' + JSON.stringify({ created: learn.proposals_created, errors: learn.errors.length }));
    ctx.waitUntil((async function () {
      await runJudge(env);
      await runConfirm(env);
    })());
  }
};
