/**
 * hs-law-watch : 改正ウォッチャー。
 *
 * 何をするか:
 *   訪問看護の告示・省令・通知・疑義解釈・審議会・パブコメ・官報と、建設の単価表を毎日2回見に行き、
 *   前回から増えたもの・変わったものを『出来事(event)』として D1 に積む。出来事には、読み直しが要りそうな
 *   JHNRD の項目の候補と、人がやる手順を付ける。LINE と GitHub Issue へは、鍵が入っているときだけ知らせる。
 *
 * 何をしないか:
 *   ・JHNRD / JCCDB の中身を書き換えない。規則を読むのは人(番人)で、二つの資料で一致したときだけ確定にする掟は変わらない。
 *     機械が告示を読んで数字を差し替えると、PDF の表の列の取り違え(3回起きた)がそのまま本番に入る。
 *   ・『取りに行けなかった』と『取りに行って何も変わっていなかった』を同じにしない。失敗は失敗として出来事にする。
 *   ・法令等データベースが別の法令を返したとき(URL は同じでも中身が違うことがある)、それを改正と呼ばない。
 *
 * 『法律が変わると同時に』について正直に書く:
 *   検知の遅れは最大で cron の間隔(12時間)。ただし告示・省令は公布から施行まで普通は数か月あるので、
 *   公布(官報・e-Gov の施行前改正)で拾えば、施行日より前に DB を直せる。施行日が先に分かっている変更は schedule.js が
 *   60/30/7/0 日前に知らせる。
 */
import { SOURCES } from "./sources.js";
import { impactOf } from "./impact.js";
import { SCHEDULED, dueNotices } from "./schedule.js";

const UA = "hs-law-watch/0.1 (+https://shield.the-horizons-innovation.com; contact via site)";
const FAIL_STREAK_ALERT = 3;

async function sha256hex(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function jstParts(now) {
  const d = new Date(now.getTime() + 9 * 3600 * 1000);
  const y = d.getUTCFullYear(), m = String(d.getUTCMonth() + 1).padStart(2, "0"), dd = String(d.getUTCDate()).padStart(2, "0");
  return { y, m, d: dd, ymd: `${y}${m}${dd}`, iso: `${y}-${m}-${dd}` };
}

export function resolveUrl(src, now) {
  const p = jstParts(now);
  let u = src.url.replaceAll("{YYYYMMDD}", p.ymd);
  if (src.month_offset) {
    const d = new Date(Date.UTC(p.y, Number(p.m) - 1 + src.month_offset, 1));
    u = u.replaceAll("{YYYY}", String(d.getUTCFullYear())).replaceAll("{MM}", String(d.getUTCMonth() + 1).padStart(2, "0"));
  }
  return u;
}

const decode = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
const strip = (s) => decode(String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

export function parseLinks(html, base, filter) {
  const re = /<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const f = filter ? new RegExp(filter) : null;
  const out = new Map();
  let m;
  while ((m = re.exec(html))) {
    let url;
    try { url = new URL(decode(m[1]), base).toString(); } catch { continue; }
    if (f && !f.test(url)) continue;
    const title = strip(m[2]).slice(0, 300);
    if (!title) continue;
    out.set(url + "\u001f" + title, { key: url + "\u001f" + title, url, title });
  }
  return [...out.values()];
}

export function parseRss(xml) {
  const out = [];
  const re = /<item\b[\s\S]*?<\/item>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const it = m[0];
    const title = strip((it.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || "").replace(/^<!\[CDATA\[|\]\]>$/g, "");
    const link = strip((it.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || "") || ((it.match(/rdf:about="([^"]+)"/i) || [])[1] || "");
    if (title || link) out.push({ key: link + "\u001f" + title, url: link, title });
  }
  return out;
}

export function parseEgovLaw(jsonText) {
  const j = JSON.parse(jsonText);
  const law = (j.laws || [])[0];
  if (!law) return { error: "no law in response" };
  const r = law.current_revision_info || law.revision_info || {};
  return { title: r.law_title, law_revision_id: r.law_revision_id, amendment_law_num: r.amendment_law_num,
    promulgate: r.amendment_promulgate_date, enforce: r.amendment_enforcement_date,
    scheduled: r.amendment_scheduled_enforcement_date, status: r.current_revision_status, updated: r.updated };
}

export function parseEgovRevs(jsonText) {
  // 返り値の形は版によって変わりうるので、law_revision_id と状態の組だけを文字列から拾う(形に寄りかからない)。
  const ids = [...new Set((jsonText.match(/"law_revision_id"\s*:\s*"([^"]+)"/g) || []).map((s) => s.split('"')[3]))];
  const statuses = [...new Set((jsonText.match(/"current_revision_status"\s*:\s*"([^"]+)"/g) || []).map((s) => s.split('"')[3]))];
  return { ids: ids.sort(), statuses };
}

export function parseKanpo(html, base, keywords) {
  return parseLinks(html, base, null).filter((l) => keywords.some((k) => l.title.includes(k)));
}

// 題名の確かめ方(2026-09-26 独立検証 V3 の指摘で直した): 本文全体ではなく <title>(無ければ本文の先頭 400 字)で見る。
// 「厚生労働大臣が定める基準」のような句は別の告示の本文にも出てくるので、本文全体で探すと、別の告示が返っても気づけない。
// title_must は文字列か配列(配列なら全部が題名にあること。告示の番号を入れる)。
export function titleOk(html, must) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(html || ""));
  const head = m ? m[1] : strip(String(html || "")).slice(0, 400);
  const need = Array.isArray(must) ? must : [must];
  return need.every((x) => head.includes(x));
}

export function extractSection(text, section) {
  if (!section) return text;
  const s = text.indexOf(section[0]);
  if (s < 0) return null;
  const e = text.indexOf(section[1], s + section[0].length);
  return e < 0 ? text.slice(s) : text.slice(s, e);
}

async function fetchText(url, method) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(url, { method: method || "GET", headers: { "user-agent": UA, accept: "*/*" }, signal: ctl.signal, redirect: "follow" });
    const text = method === "HEAD" ? "" : await r.text();
    return { ok: r.ok, status: r.status, text, ctype: r.headers.get("content-type") || "" };
  } catch (e) {
    return { ok: false, status: 0, text: "", error: String(e && e.message || e).slice(0, 200) };
  } finally { clearTimeout(t); }
}

function nextSteps(ev) {
  const base = [
    "1. url を開き、何が出たか(告示・通知・疑義解釈・事務連絡・審議会資料・パブコメ)を確かめる。",
    "2. 告示・通知なら本文(PDF は pdftotext、法令等データベースは本文)で読む。要約経由で数字を読まない。",
    "3. 数字は二つの資料(告示の改正文と統合版、又は告示と算定構造)で一致させてから confirmed:true にする。",
    "4. JHNRD の候補項目を直し、tools/validate.py を緑にし、版(seed)を切る。旧版は消さない。",
    "5. hs-nursing-mcp の rules.js を作り直す(tools/nursing/build_mcp_rules.py --write)。deploy は TOshi。",
  ];
  if (ev.domain === "construction") return ["1. 新しい単価表の PDF を取り、sha256 を控える。", "2. jccdb の観測層の parser(座標で読む)を当て、前の月と差分を取る。", "3. obs_*.csv を作り直し、hs-jccdb-obs の D1 に流す(TOshi)。"];
  if (ev.kind === "instrument") return ["1. 取りに行けていない、又は別の中身が返っている。0件ではない。", "2. 手で url を開いて確かめ、sources.js の url を直すか、様子を見る。"];
  return base;
}

async function putEvent(env, ev) {
  const r = await env.DB.prepare(
    "INSERT OR IGNORE INTO events (event_id, source_id, domain, kind, detected_at, title, url, impact_json, status, note) VALUES (?,?,?,?,?,?,?,?, 'open', ?)")
    .bind(ev.event_id, ev.source_id, ev.domain, ev.kind, ev.detected_at, ev.title, ev.url || null, JSON.stringify(ev.impact || {}), ev.note || null).run();
  return (r.meta && r.meta.changes) ? 1 : 0;
}

async function checkSource(env, src, now) {
  const url = resolveUrl(src, now);
  const prev = await env.DB.prepare("SELECT * FROM snapshots WHERE source_id = ?").bind(src.id).first();
  const detected_at = now.toISOString();
  const res = await fetchText(url, src.kind === "probe" ? "HEAD" : "GET");
  const events = [];
  const failStreak = (prev && prev.fail_streak) || 0;

  if (src.kind === "probe") {
    const key = url;
    if (res.status === 200) {
      events.push({ event_id: await sha256hex("probe|" + url), source_id: src.id, domain: src.domain, kind: "new_document",
        detected_at, title: src.title + " が公開された: " + url.split("/").pop(), url, impact: { items: [], triage: "construction" } });
    }
    await env.DB.prepare("INSERT OR REPLACE INTO snapshots (source_id, fetched_at, http_status, ok, hash, items_json, fail_streak, url) VALUES (?,?,?,?,?,?,?,?)")
      .bind(src.id, detected_at, res.status, res.status === 200 ? 1 : 0, key, "[]", 0, url).run();
    return { events, status: res.status };
  }

  if (!res.ok && src.kind === "kanpo" && res.status === 404) {
    // 官報は土日祝に出ない。その日の頁が無いのは失敗ではない。
    return { events, status: 404, count: 0, no_issue_today: true };
  }
  if (!res.ok) {
    const streak = failStreak + 1;
    await env.DB.prepare("INSERT INTO snapshots (source_id, fetched_at, http_status, ok, hash, items_json, fail_streak, url) VALUES (?,?,?,?,?,?,?,?) " +
      "ON CONFLICT(source_id) DO UPDATE SET fetched_at=excluded.fetched_at, http_status=excluded.http_status, ok=0, fail_streak=excluded.fail_streak, url=excluded.url")
      .bind(src.id, detected_at, res.status, 0, prev ? prev.hash : null, prev ? prev.items_json : "[]", streak, url).run();
    if (streak === FAIL_STREAK_ALERT) {
      events.push({ event_id: await sha256hex(`fail|${src.id}|${detected_at.slice(0, 10)}`), source_id: src.id, domain: src.domain, kind: "instrument",
        detected_at, title: `${src.title} に ${streak} 回続けて届いていない(HTTP ${res.status}${res.error ? " " + res.error : ""})`, url,
        impact: { items: [], triage: "instrument" }, note: "取りに行けていない。変わっていない、ではない。" });
    }
    return { events, status: res.status, failed: true };
  }

  let items = [], hash, extra = {};
  if (src.kind === "list") items = parseLinks(res.text, url, src.link_filter);
  else if (src.kind === "rss") {
    items = parseRss(res.text);
    if (src.keywords && src.keywords.length) items = items.filter((i) => src.keywords.some((k) => i.title.includes(k)));
  } else if (src.kind === "kanpo") items = parseKanpo(res.text, url, src.keywords);
  else if (src.kind === "egov_law") {
    const r = parseEgovLaw(res.text);
    extra = r;
    items = r.law_revision_id ? [{ key: r.law_revision_id, url, title: `${r.title}: 現行 ${r.law_revision_id}(${r.amendment_law_num || "?"}, 施行 ${r.enforce || "?"})` +
      (r.scheduled ? ` / 施行予定の改正あり ${r.scheduled}` : "") }] : [];
  } else if (src.kind === "egov_revs") {
    const r = parseEgovRevs(res.text);
    items = r.ids.map((id) => ({ key: id, url, title: `${src.title}: ${id}` }));
  } else if (src.kind === "text") {
    if (!titleOk(res.text, src.title_must)) {
      events.push({ event_id: await sha256hex(`mismatch|${src.id}|${detected_at.slice(0, 10)}`), source_id: src.id, domain: src.domain, kind: "instrument",
        detected_at, title: `${src.title}: 同じ URL が別の法令を返した(題名が一致しない)。改正ではない`, url, impact: { items: [], triage: "instrument" },
        note: "法令等データベースの t_doc は同じ dataId でも別の告示を返すことがある(2026-08-24 に3回)。" });
      return { events, status: res.status, mismatch: true };
    }
    const body = extractSection(strip(res.text), src.section ? src.section.map((x) => x.replace(/\s+/g, " ")) : null) || strip(res.text);
    items = [{ key: await sha256hex(body), url, title: src.title + " 本文" }];
  }
  hash = await sha256hex(JSON.stringify(items.map((i) => i.key).sort()));

  if (prev && prev.ok !== null && prev.hash && prev.hash !== hash && src.kind !== "kanpo") {
    const before = new Set(JSON.parse(prev.items_json || "[]"));
    const added = items.filter((i) => !before.has(i.key));
    const list = (src.kind === "text" || src.kind === "egov_law") ? items : added;
    for (const it of list.slice(0, 40)) {
      events.push({ event_id: await sha256hex(`${src.id}|${it.key}`), source_id: src.id, domain: src.domain,
        kind: src.kind === "text" ? "text_changed" : (src.kind === "egov_law" || src.kind === "egov_revs" ? "revision" : "new_link"),
        detected_at, title: it.title, url: it.url, impact: src.domain === "nursing" ? impactOf(it.title) : { items: [], triage: "construction" } });
      const imp = events[events.length - 1].impact;
      if (src.impacts) { imp.items = [...new Set([...(imp.items || []), ...src.impacts])].sort(); if (imp.triage !== "candidate_items") imp.triage = "candidate_items"; }
    }
  }
  if (src.kind === "kanpo") {
    for (const it of items) {
      events.push({ event_id: await sha256hex(`kanpo|${it.key}`), source_id: src.id, domain: src.domain, kind: "gazette",
        detected_at, title: "官報: " + it.title, url: it.url, impact: impactOf(it.title) });
    }
  }
  await env.DB.prepare("INSERT OR REPLACE INTO snapshots (source_id, fetched_at, http_status, ok, hash, items_json, fail_streak, url) VALUES (?,?,?,?,?,?,?,?)")
    .bind(src.id, detected_at, res.status, 1, hash, JSON.stringify(items.map((i) => i.key)), 0, url).run();
  return { events, status: res.status, count: items.length, baseline: !prev || !prev.hash, ...extra };
}

export async function runAll(env, now, only) {
  const report = { at: now.toISOString(), sources: {}, new_events: 0 };
  const fresh = [];
  for (const src of SOURCES) {
    if (only && !only.includes(src.id)) continue;
    try {
      const r = await checkSource(env, src, now);
      for (const ev of r.events) if (await putEvent(env, ev)) { fresh.push(ev); report.new_events++; }
      report.sources[src.id] = { status: r.status, count: r.count, baseline: r.baseline, failed: !!r.failed, mismatch: !!r.mismatch, events: r.events.length };
    } catch (e) {
      report.sources[src.id] = { error: String(e && e.message || e).slice(0, 200) };
    }
  }
  const today = jstParts(now).iso;
  for (const n of dueNotices(today)) {
    const ev = { event_id: await sha256hex("sched|" + n.key), source_id: "schedule", domain: n.domain || "nursing", kind: "scheduled",
      detected_at: now.toISOString(), title: `${n.days >= 0 ? n.days + "日後" : "施行済み"} ${n.date}: ${n.title}`, url: null,
      impact: { items: n.items, triage: n.basis }, note: n.source };
    if (await putEvent(env, ev)) { fresh.push(ev); report.new_events++; }
  }
  await env.DB.prepare("INSERT INTO runs (at, summary_json) VALUES (?, ?)").bind(report.at, JSON.stringify(report)).run();
  report.notify = await notify(env, fresh);
  return report;
}

async function notify(env, all) {
  const out = { line: "skipped", github: "skipped" };
  // 訪問看護とも建設とも言えない一般の最新情報は D1 には残すが、知らせは飛ばさない(鳴りすぎると誰も見なくなる)
  const events = all.filter((e) => !(e.impact && e.impact.triage === "not_nursing_or_unknown"));
  out.suppressed = all.length - events.length;
  if (!events.length) return out;
  if (env.LINE_TOKEN && env.LINE_TO) {
    const lines = events.slice(0, 10).map((e) => `・[${e.kind}] ${e.title}${e.impact && e.impact.items && e.impact.items.length ? " → " + e.impact.items.join(", ") : ""}`);
    const text = `改正ウォッチャー: 新しい出来事 ${events.length} 件\n` + lines.join("\n") + (events.length > 10 ? `\nほか ${events.length - 10} 件` : "") +
      "\n一覧: /events?status=open";
    const r = await fetch("https://api.line.me/v2/bot/message/push", { method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + env.LINE_TOKEN },
      body: JSON.stringify({ to: env.LINE_TO, messages: [{ type: "text", text: text.slice(0, 4900) }] }) }).catch((e) => ({ ok: false, status: 0 }));
    out.line = r.ok ? "sent" : "failed:" + r.status;
  }
  if (env.GITHUB_TOKEN && env.GITHUB_REPO) {
    let n = 0;
    for (const e of events.filter((x) => x.domain === "nursing" && x.kind !== "instrument").slice(0, 5)) {
      const body = [`検知: ${e.detected_at}`, `出どころ: ${e.source_id}`, e.url ? `URL: ${e.url}` : "", "",
        "読み直し候補の項目: " + ((e.impact && e.impact.items && e.impact.items.join(", ")) || "(当たりなし。人が振り分ける)"), "",
        "手順:", ...nextSteps(e), "", "この Issue は hs-law-watch が自動で立てた。規則は書き換えていない。"].join("\n");
      const r = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/issues`, { method: "POST",
        headers: { authorization: "Bearer " + env.GITHUB_TOKEN, "user-agent": UA, accept: "application/vnd.github+json", "content-type": "application/json" },
        body: JSON.stringify({ title: "[改正ウォッチャー] " + e.title.slice(0, 200), body, labels: ["law-change"] }) }).catch(() => ({ ok: false }));
      if (r.ok) n++;
    }
    out.github = `opened ${n}`;
  }
  return out;
}

function json(b, s) { return new Response(JSON.stringify(b, null, 1), { status: s || 200, headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" } }); }

function adminOk(request, env) {
  const k = request.headers.get("x-admin-key") || "";
  if (!env.ADMIN_KEY || k.length !== env.ADMIN_KEY.length) return false;
  let d = 0; for (let i = 0; i < k.length; i++) d |= k.charCodeAt(i) ^ env.ADMIN_KEY.charCodeAt(i);
  return d === 0;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAll(env, new Date(event.scheduledTime || Date.now())));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    if (request.method === "GET" && p === "/health") {
      const last = await env.DB.prepare("SELECT at, summary_json FROM runs ORDER BY rowid DESC LIMIT 1").first();
      const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE status='open'").first();
      return json({ ok: true, sources: SOURCES.length, scheduled: SCHEDULED.length, last_run: last ? last.at : null, open_events: open.n });
    }
    if (request.method === "GET" && p === "/events") {
      const st = url.searchParams.get("status"), dom = url.searchParams.get("domain");
      const lim = Math.min(200, parseInt(url.searchParams.get("limit") || "50", 10) || 50);
      const where = [], b = [];
      if (st) { where.push("status = ?"); b.push(st); }
      if (dom) { where.push("domain = ?"); b.push(dom); }
      const rows = (await env.DB.prepare("SELECT * FROM events" + (where.length ? " WHERE " + where.join(" AND ") : "") + " ORDER BY detected_at DESC LIMIT ?").bind(...b, lim).all()).results;
      return json({ count: rows.length, events: rows.map((r) => ({ ...r, impact: JSON.parse(r.impact_json || "{}"), impact_json: undefined, next_steps: nextSteps(r) })) });
    }
    if (request.method === "GET" && p === "/sources") {
      const snaps = (await env.DB.prepare("SELECT source_id, fetched_at, http_status, ok, fail_streak, url FROM snapshots").all()).results;
      const by = Object.fromEntries(snaps.map((s) => [s.source_id, s]));
      return json({ sources: SOURCES.map((s) => ({ ...s, last: by[s.id] || null })) });
    }
    if (request.method === "GET" && p === "/schedule") return json({ scheduled: SCHEDULED, due_today: dueNotices(jstParts(new Date()).iso) });
    if (p.startsWith("/admin/")) {
      if (!adminOk(request, env)) return json({ error: "forbidden" }, 403);
      if (request.method === "POST" && p === "/admin/run") {
        const only = url.searchParams.get("only");
        return json(await runAll(env, new Date(), only ? only.split(",") : null));
      }
      if (request.method === "POST" && p === "/admin/event") {
        const b = await request.json().catch(() => ({}));
        if (!b.event_id || !["open", "triaged", "applied", "dismissed"].includes(b.status)) return json({ error: "event_id and status(open|triaged|applied|dismissed) required" }, 400);
        const r = await env.DB.prepare("UPDATE events SET status = ?, note = COALESCE(?, note) WHERE event_id = ?").bind(b.status, b.note || null, b.event_id).run();
        return json({ ok: true, changed: r.meta ? r.meta.changes : null });
      }
    }
    if (request.method === "GET" && (p === "/" || p === "")) {
      return json({ name: "hs-law-watch", what: "訪問看護の告示・通知・疑義解釈と建設の単価表の変化を拾い、JHNRD / JCCDB の読み直し候補を出す。規則は書き換えない。",
        endpoints: ["/health", "/events?status=open&domain=nursing", "/sources", "/schedule", "POST /admin/run (X-Admin-Key)", "POST /admin/event (X-Admin-Key)"] });
    }
    return json({ error: "not found" }, 404);
  },
};
