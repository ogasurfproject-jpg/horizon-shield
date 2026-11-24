'use strict';
/**
 * note の連載『大工ムニョスは「一式」を許さない』の中身を決める部品。
 * ブラウザで note に投稿するのは post_to_note.js の役目。ここは次のことだけをする。
 *   1) 次に出す話を選ぶ(本編 → 外伝の種 → 外伝の自由題。在庫が切れない)
 *   2) 書き置きの回があればそれを使い、無ければ設定書と筋書きから書く人への指示を組む
 *   3) 書かれた本文を整え(見出し・記号・ダッシュを落とす)、門に通す
 *   4) note に載せる全文、LINE に流す文を組み立てる
 *   5) 公開した回を story/state.json と story/posted/ に残す(翌朝の続きの手がかり)
 * ネットワークに出るのは generate だけ。
 */
const fs = require('fs');
const path = require('path');

const STORY_DIR = path.join(__dirname, 'story');
const LP_URL = 'https://shield.the-horizons-innovation.com';
const LINE_URL = 'https://line.me/R/ti/p/@172piime';
const DEFAULT_MODELS = ['claude-opus-5-5', 'claude-sonnet-5', 'claude-sonnet-4-6'];

// 長いダッシュの類(文字コードで持つ。ソースに字そのものを置かない)
const DASH_CODES = [0x2012, 0x2013, 0x2014, 0x2015, 0x2E3A, 0x2E3B, 0x2500, 0x2501];
const DASH_CLASS = '[' + DASH_CODES.map((c) => String.fromCharCode(c)).join('') + ']';
const DASH_RE = new RegExp(DASH_CLASS + '+', 'g');
const DASH_TEST = new RegExp(DASH_CLASS);

// 本文に出してはいけない語(機械が書いた痕跡、作り手の顔、宣伝)
const MACHINE_RE = /(^|[^A-Za-z])(AI|A\.I\.)(?![A-Za-z])|ＡＩ|人工知能|ChatGPT|GPT|Claude|クロード|Gemini|ジェミニ|言語モデル|チャットボット|プロンプト/;
const PREAMBLE_RE = /^(はい|承知|了解|以下|では、|もちろん|かしこまり|こちらが|第\s*\d+\s*話を)/;
const META_RE = /(いかがでしたか|この物語は|この話では|本話|読者の皆|フィクション|あとがき|筆者|作者|本文)/;
const BRAND_RE = /(HORIZON\s*SHIELD|ホライゾン|ホライズン)/i;
const URL_RE = /https?:\/\//;
const MARK_RE = /[#＃*＊_＿]/;

const pad3 = (n) => String(n).padStart(3, '0');

function loadOutline(dir = STORY_DIR) { return JSON.parse(fs.readFileSync(path.join(dir, 'outline.json'), 'utf8')); }
function loadBible(dir = STORY_DIR) { return fs.readFileSync(path.join(dir, 'bible.md'), 'utf8'); }
function loadState(dir = STORY_DIR) {
  try { const s = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')); return Array.isArray(s.posted) ? s : { posted: [] }; }
  catch (_e) { return { posted: [] }; }
}

/* 本編の全話を一列に(部の情報を付けて) */
function mainEpisodes(outline) {
  const out = [];
  for (const part of outline.parts || []) {
    for (const e of part.episodes || []) {
      out.push(Object.assign({}, e, { kind: 'main', key: 'main-' + pad3(e.no), part: { no: part.no, title: part.title, time: part.time, summary: part.summary } }));
    }
  }
  return out;
}
function gaidenSeeds(outline) {
  return (outline.gaiden || []).map((g) => Object.assign({}, g, { kind: 'gaiden', key: 'gaiden-' + pad3(g.no) }));
}

/* 次に出す話。本編を順に、尽きたら外伝の種、尽きたら外伝の自由題(題と目盛りはその朝に書く)。 */
function nextEpisode(outline, state) {
  const done = new Set((state.posted || []).map((p) => p.key));
  for (const e of mainEpisodes(outline)) if (!done.has(e.key)) return e;
  for (const g of gaidenSeeds(outline)) if (!done.has(g.key)) return g;
  const n = (state.posted || []).filter((p) => p.kind === 'gaiden').length + 1;
  const topics = outline.gaiden_topics || ['住まいの小さな修理'];
  const topic = topics[(n - 1) % topics.length];
  return { kind: 'gaiden', free: true, key: 'gaiden-' + pad3(n), no: n, topic, title: null, line: null, must: ['ムニョス'], beats: '' };
}
function episodeByKey(outline, state, key) {
  for (const e of mainEpisodes(outline).concat(gaidenSeeds(outline))) if (e.key === key) return e;
  return null;
}
/* この話の次(予告に使う)。自由題の外伝は題が決まっていないので null。 */
function peekNext(outline, state, ep) {
  if (ep.kind === 'main') {
    const m = mainEpisodes(outline);
    const i = m.findIndex((e) => e.key === ep.key);
    if (i >= 0 && i + 1 < m.length) return m[i + 1];
    return gaidenSeeds(outline)[0] || null;
  }
  if (ep.free) return null;
  const g = gaidenSeeds(outline);
  const j = g.findIndex((e) => e.key === ep.key);
  return (j >= 0 && j + 1 < g.length) ? g[j + 1] : null;
}
function remaining(outline, state) {
  const done = new Set((state.posted || []).map((p) => p.key));
  const main = mainEpisodes(outline).filter((e) => !done.has(e.key)).length;
  const seeds = gaidenSeeds(outline).filter((g) => !done.has(g.key)).length;
  return { main, seeds };
}

function label(ep) { return ep.kind === 'main' ? ('第' + ep.no + '話') : ('外伝' + ep.no); }
function fullTitle(outline, ep) { return '『' + outline.series + '』' + label(ep) + '「' + ep.title + '」'; }

function prewritten(ep, dir = STORY_DIR) {
  const p = path.join(dir, 'episodes', ep.key + '.txt');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}
function postedBody(key, dir = STORY_DIR) {
  const p = path.join(dir, 'posted', key + '.txt');
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  const q = path.join(dir, 'episodes', key + '.txt');
  return fs.existsSync(q) ? fs.readFileSync(q, 'utf8') : null;
}
/* 前の話の本文(文体と続きの手がかり)。本編は一つ前の話、外伝は最後に出した話。 */
function previousBody(outline, state, ep, dir = STORY_DIR) {
  if (ep.kind === 'main' && ep.no > 1) return postedBody('main-' + pad3(ep.no - 1), dir);
  const last = (state.posted || [])[state.posted.length - 1];
  return last ? postedBody(last.key, dir) : null;
}

/* 書かれた本文を整える。見出し・記号・ダッシュを落とし、段落を空行で区切る。 */
function cleanBody(text) {
  let t = String(text || '').replace(/\r/g, '');
  const cut = t.indexOf('今日の目盛り');
  if (cut >= 0) t = t.slice(0, cut);
  const lines = t.split('\n').map((l) => l.trim()).filter((l) => l.length);
  const out = [];
  lines.forEach((l, i) => {
    if (i === 0 && /^(第\s*\d+\s*話|外伝|題[:：]|タイトル[:：]|『)/.test(l)) return;
    if (/^#{1,6}\s/.test(l)) return;
    if (/^[*＊\-=_~・◇◆〜]+$/.test(l)) { out.push('◇'); return; }
    let s = l.replace(/\*\*/g, '').replace(/[*＊]/g, '').replace(/^#+\s*/, '').replace(/__/g, '');
    s = s.replace(DASH_RE, '……').replace(/…{3,}/g, '……');
    out.push(s);
  });
  while (out.length && out[out.length - 1] === '◇') out.pop();
  return out.join('\n\n').trim();
}

/* 門。本文として出してよいかを見る。理由を全部返す。 */
function gateBody(body, ep) {
  const b = String(body || '');
  const reasons = [];
  const len = b.replace(/\s/g, '').length;
  if (len < 1400) reasons.push('短すぎる(' + len + '字)');
  if (len > 3800) reasons.push('長すぎる(' + len + '字)');
  if (MACHINE_RE.test(b)) reasons.push('機械や道具の名前が出ている');
  if (PREAMBLE_RE.test(b.slice(0, 20))) reasons.push('前置きがある');
  if (META_RE.test(b)) reasons.push('作り手の顔が出ている');
  if (!ep.allow_brand && BRAND_RE.test(b)) reasons.push('社名が本文に出ている');
  if (URL_RE.test(b)) reasons.push('URL が本文にある');
  if (MARK_RE.test(b)) reasons.push('記号が残っている');
  if (DASH_TEST.test(b)) reasons.push('長いダッシュが残っている');
  for (const m of ep.must || []) if (!b.includes(m)) reasons.push('「' + m + '」が出てこない');
  return { ok: reasons.length === 0, reasons };
}

/* 書く人への指示 */
function buildPrompt(bible, outline, state, ep, prevBody) {
  const lines = [];
  const next = peekNext(outline, state, ep);
  if (ep.kind === 'main') {
    const parts = outline.parts || [];
    const past = parts.filter((p) => p.no < ep.part.no).map((p) => '第' + p.no + '部「' + p.title + '」: ' + p.summary);
    const partNow = parts.find((p) => p.no === ep.part.no) || { episodes: [] };
    const sofar = (partNow.episodes || []).filter((e) => e.no < ep.no).map((e) => '第' + e.no + '話「' + e.title + '」: ' + e.beats);
    lines.push('これから書くのは、第' + ep.no + '話「' + ep.title + '」。');
    lines.push('第' + ep.part.no + '部「' + ep.part.title + '」。作中の時期は' + ep.part.time + '。');
    lines.push('この部のあらすじ: ' + ep.part.summary);
    if (past.length) lines.push('前の部までの流れ:\n' + past.join('\n'));
    if (sofar.length) lines.push('この部のこれまで:\n' + sofar.join('\n'));
  } else if (ep.free) {
    lines.push('これから書くのは、本編とは別の一話完結の外伝。本編の途中のどこかの一日、潮見町の誰かの家の話。');
    lines.push('題材: ' + ep.topic + '。住む人が見積もりか営業の言葉で困り、ムニョスたちが住む人の隣に座って一緒に確かめる。');
    lines.push('一行目に「題: 」に続けて、この話の題(十五字以内)を書く。最後の行に「目盛り: 」に続けて、読後に残る一行(三十字以内)を書く。その二行のあいだが本文。');
  } else {
    lines.push('これから書くのは、本編とは別の一話完結の外伝' + ep.no + '「' + ep.title + '」。本編の途中のどこかの一日の話。');
  }
  if (prevBody) lines.push('前の話の本文(文体と続き具合の手がかり。同じ文をくり返さない):\n<<<\n' + String(prevBody).slice(0, 6000) + '\n>>>');
  if (!ep.free) {
    lines.push('この話で起きること:\n' + ep.beats);
    lines.push('この話の最後のあたりで、次の言葉の意味が物語の中から自然に伝わるようにする。見出しとしては書かない(見出しはこちらで付ける): ' + ep.line);
  }
  if (next) lines.push('次の話の題(引きの参考。中身は書かない): ' + next.title);
  if ((ep.must || []).length) lines.push('必ず出す名前: ' + ep.must.join('、'));
  lines.push('長さは1800字から2400字。本文だけを書く。' + (ep.free ? '' : '題、見出し、今日の目盛り、あとがき、注意書きは書かない。') + '記号の * # _ と長いダッシュは使わない。');
  return { system: bible, user: lines.join('\n\n') };
}

/* 自由題の外伝の出力から、題・本文・目盛りを取り出す */
function parseFree(text) {
  const ls = String(text || '').replace(/\r/g, '').split('\n');
  let title = null, line = null;
  const body = [];
  for (const l of ls) {
    const s = l.trim();
    let m;
    if (!title && (m = s.match(/^題[:：]\s*(.+)$/))) { title = m[1].replace(/[「」『』]/g, '').trim(); continue; }
    if ((m = s.match(/^目盛り[:：]\s*(.+)$/))) { line = m[1].replace(/[「」]/g, '').trim(); continue; }
    body.push(l);
  }
  return { title, line, body: body.join('\n') };
}

async function callModel({ apiKey, model, system, user, fetchImpl }) {
  const r = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 4096, system, messages: [{ role: 'user', content: user }] }),
  });
  let data = null; try { data = await r.json(); } catch (_e) { data = null; }
  if (!r.ok) return { ok: false, status: r.status, why: (data && data.error && (data.error.type + ': ' + data.error.message)) || ('HTTP ' + r.status) };
  const text = ((data && data.content) || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  return { ok: true, text };
}

/* 門に落ちた稿の理由を、次の書き直しの指示に足す文。1 回目の指示には入れない。 */
function retryNote(reasons) {
  const rs = (reasons || []).filter(Boolean);
  if (!rs.length) return '';
  let t = '前の稿は出せなかった。直す所: ' + rs.join('、') + '。';
  if (rs.some((x) => /」が出てこない$/.test(x))) t += '必ず出す名前は、呼びかけや地の文で、本文の中に文字で書く。';
  if (rs.some((x) => /^(短すぎる|長すぎる)/.test(x))) t += '長さは1800字から2400字(空白を除いて数える)。';
  return t;
}

/* 書く。門を通るまで最大4回。モデルが無い・混んでいるときは次のモデルへ。門に落ちたら、落ちた理由を次の指示に足す。 */
async function generate(ep, ctx, opts) {
  const o = opts || {};
  const fetchImpl = o.fetchImpl || fetch;
  const models = o.models || (process.env.NOTE_STORY_MODEL ? [process.env.NOTE_STORY_MODEL].concat(DEFAULT_MODELS) : DEFAULT_MODELS);
  const sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const { system, user: user0 } = buildPrompt(ctx.bible, ctx.outline, ctx.state, ep, ctx.prevBody);
  let user = user0;
  const tried = [];
  let mi = 0, gateTries = 0;
  for (let attempt = 0; attempt < 10 && mi < models.length && gateTries < 4; attempt++) {
    const model = models[mi];
    const r = await callModel({ apiKey: o.apiKey, model, system, user, fetchImpl });
    if (!r.ok) {
      tried.push(model + ': ' + r.why);
      if (r.status === 529 || r.status === 503 || r.status === 429) { await sleep(8000 * (attempt + 1)); if (attempt % 2 === 1) mi++; continue; }
      mi++; continue;
    }
    let title = ep.title, line = ep.line, raw = r.text;
    if (ep.free) {
      const f = parseFree(r.text);
      title = f.title; line = f.line; raw = f.body;
    }
    const body = cleanBody(raw);
    const g = gateBody(body, ep);
    const extra = [];
    if (ep.free) {
      if (!title || title.length > 20) extra.push('題が無いか長すぎる');
      if (!line || line.length > 40) extra.push('目盛りが無いか長すぎる');
      if ((ctx.usedTitles || []).includes(title)) extra.push('題が前の話と同じ');
      const t2 = String(title || '') + String(line || '');
      if (MACHINE_RE.test(t2) || DASH_TEST.test(t2) || BRAND_RE.test(t2)) extra.push('題か目盛りに出してはいけない語');
    }
    gateTries++;
    if (g.ok && !extra.length) return { ok: true, body, title, line, model, tries: gateTries };
    tried.push(model + ': 門 ' + g.reasons.concat(extra).join(' / '));
    user = user0 + '\n\n' + retryNote(g.reasons.concat(extra));
  }
  return { ok: false, reasons: tried };
}

/* note に載せる全文 */
function composePost(outline, ep, body, next) {
  const parts = [String(body).trim(), '今日の目盛り\n「' + ep.line + '」'];
  if (ep.kind === 'main' && ep.no === mainEpisodes(outline).length) parts.push('本編 完\n明日の朝からは、外伝をお届けします。');
  else if (next) parts.push('次回 ' + label(next) + '「' + next.title + '」\n明日の朝に公開します。');
  else parts.push('次の話は、明日の朝に公開します。');
  parts.push('この連載はフィクションです。登場する人物、団体、出来事は創作です。');
  parts.push('物語の中の物差しは、現実にもあります。\nHORIZON SHIELD は、住む人の側に立って工事の見積もりを確かめる仕組みです。業者から紹介料も掲載料も受け取りません。\n' + LP_URL);
  parts.push('LINE で見積もりの相談\n' + LINE_URL);
  return parts.join('\n\n');
}

/* LINE の友だちに流す文 */
function broadcastText(outline, ep, url) {
  return '【連載】' + outline.series + '\n' + label(ep) + '「' + ep.title + '」\n\n「' + ep.line + '」\n\n続きを読む\n' + url
    + '\n\n見積もりの確認はこちら\n' + LP_URL;
}
/* X に貼る文 */
function xText(outline, ep, url) {
  return '「' + ep.line + '」\n\n' + outline.series + ' ' + label(ep) + '「' + ep.title + '」\n' + url + '\n\n#連載小説 #リフォーム';
}
/* TOshi への知らせ */
function ownerNotice(outline, ep, url, rem, source) {
  const how = source === 'prewritten' ? '書き置きの回' : 'その朝に書いた回';
  return '✅ note 連載を公開(' + how + ')\n' + label(ep) + '「' + ep.title + '」\n' + url
    + '\n残り: 本編 ' + rem.main + ' 話 / 外伝の種 ' + rem.seeds + '\n\nX に貼る文:\n' + xText(outline, ep, url);
}

/* note のハッシュタグ。共通のタグ + 部のタグ + 話のタグ(重ねない、20まで) */
function hashtagsFor(outline, ep) {
  const part = ep.kind === 'main' ? (outline.parts || []).find((p) => p.no === ep.part.no) : null;
  const all = [].concat(outline.hashtags || [], (part && part.tags) || [], ep.kind === 'gaiden' ? (outline.gaiden_tags || []) : [], ep.tags || []);
  const seen = new Set();
  return all.map((t) => String(t).replace(/^#/, '').trim()).filter((t) => t && !seen.has(t) && seen.add(t)).slice(0, 20);
}

/* 見出し画像(1280x670)の HTML。文字と図だけで組む(写真や描画の生成は使わない)。
   物差しの端の八つの雲は、物語の進み具合で漆の数が変わる(第59話で七つ、第70話で八つ)。 */
const KANJI_NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
function lacquered(ep) {
  if (ep.kind !== 'main') return 8;
  if (ep.no >= 70) return 8;
  if (ep.no >= 59) return 7;
  return 6;
}
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function cloudSvg(x, y, filled) {
  const f = filled ? '#16110c' : 'none';
  const st = filled ? '#16110c' : '#6b4a22';
  return '<g transform="translate(' + x + ',' + y + ')" fill="' + f + '" stroke="' + st + '" stroke-width="1.6">'
    + '<path d="M3 20 C0 20 0 14 4 13 C3 8 9 5 12 8 C14 3 22 3 24 8 C28 6 33 9 31 14 C35 15 34 20 30 20 Z"/></g>';
}
/* 絵があるときの見出し画像: 絵を一面に敷き、左上に話数の札、下に題の帯、最下段に物差しの細い帯。 */
function mangaCoverHtml(outline, ep, artDataUrl) {
  const W = 1280, H = 670;
  const title = String(ep.title || '');
  const n = title.length;
  const fs = n <= 10 ? 64 : n <= 14 ? 56 : n <= 18 ? 48 : n <= 24 ? 42 : 36;
  const lab = ep.kind === 'main' ? ('第' + ep.no + '話') : ('外伝 ' + ep.no);
  const k = lacquered(ep);
  let clouds = '';
  for (let i = 0; i < 8; i++) clouds += cloudSvg(W - 72 - 8 * 30 + i * 30, 646, i < k);
  let ticks = '';
  for (let i = 0; i <= 60; i++) {
    const x = (72 + 820 * i / 60).toFixed(1);
    const h = i % 10 === 0 ? 14 : i % 5 === 0 ? 10 : 6;
    ticks += '<line x1="' + x + '" y1="648" x2="' + x + '" y2="' + (648 + h) + '" stroke="#5a3d1a" stroke-width="' + (i % 10 === 0 ? 1.6 : 1) + '"/>';
  }
  const svg = '<svg width="' + W + '" height="' + H + '" xmlns="http://www.w3.org/2000/svg" style="position:absolute;left:0;top:0">'
    + '<rect x="0" y="642" width="' + W + '" height="28" fill="#d4a766"/>' + ticks + clouds + '</svg>';
  return '<!doctype html><html lang="ja"><head><meta charset="utf-8">'
    + '<style>html,body{margin:0;padding:0}body{width:' + W + 'px;height:' + H + 'px;overflow:hidden;background:#0b0f17;position:relative;'
    + 'font-family:"Noto Sans CJK JP","Noto Sans JP","Hiragino Sans",sans-serif;color:#fff}'
    + '.art{position:absolute;left:0;top:0;width:' + W + 'px;height:642px;object-fit:cover;object-position:center 35%}'
    + '.tag{position:absolute;left:40px;top:34px;background:#0b0f17;color:#fff;padding:10px 18px 12px;border:3px solid #fff}'
    + '.tag .k{font-size:14px;letter-spacing:.3em;color:#e2b877;display:block;margin-bottom:2px}.tag .n{font-size:40px;font-weight:900;letter-spacing:.04em;line-height:1}'
    + '.band{position:absolute;left:0;right:0;top:482px;height:160px;background:rgba(8,11,18,.86);border-top:3px solid #fff}'
    + '.series{position:absolute;left:40px;top:500px;font-size:20px;letter-spacing:.06em;color:#e2b877;font-weight:700}'
    + '.title{position:absolute;left:40px;right:230px;top:530px;height:104px;display:flex;align-items:center;font-family:"Noto Serif CJK JP","Noto Serif JP",serif;font-weight:900;font-size:' + fs + 'px;line-height:1.2;letter-spacing:.02em;text-shadow:0 0 1px #000}'
    + '.brand{position:absolute;right:40px;top:604px;font-size:13px;letter-spacing:.3em;color:#9fb0c4}'
    + '</style></head><body>'
    + '<img class="art" src="' + artDataUrl + '">' + svg
    + '<div class="tag"><span class="k">連載小説</span><span class="n">' + esc(lab) + '</span></div>'
    + '<div class="band"></div><div class="series">' + esc(outline.series) + '</div>'
    + '<div class="title"><div>「' + esc(title) + '」</div></div><div class="brand">HORIZON SHIELD</div>'
    + '</body></html>';
}

function eyecatchHtml(outline, ep, artDataUrl) {
  if (artDataUrl) return mangaCoverHtml(outline, ep, artDataUrl);
  const W = 1280, H = 670;
  const title = String(ep.title || '');
  const n = title.length;
  const fs = n <= 10 ? 84 : n <= 14 ? 72 : n <= 18 ? 60 : n <= 24 ? 52 : 44;
  const lab = ep.kind === 'main' ? ('第' + ep.no + '話') : ('外伝 ' + ep.no);
  const partLab = ep.kind === 'main' ? ('第' + (KANJI_NUM[ep.part.no] || ep.part.no) + '部 ' + ep.part.title) : '外伝';
  // 物差し: 幅1136、高さ64。左の860に目盛り、右に八つの雲
  const RX = 72, RY = 520, RW = 1136, RH = 64;
  let ticks = '';
  const n10 = 50, span = 840, x0 = RX + 18;
  for (let i = 0; i <= n10; i++) {
    const x = (x0 + span * i / n10).toFixed(1);
    const h = i % 10 === 0 ? 34 : i % 5 === 0 ? 24 : 14;
    ticks += '<line x1="' + x + '" y1="' + RY + '" x2="' + x + '" y2="' + (RY + h) + '" stroke="#5a3d1a" stroke-width="' + (i % 10 === 0 ? 2 : 1.2) + '"/>';
  }
  let clouds = '';
  const k = lacquered(ep);
  for (let i = 0; i < 8; i++) clouds += cloudSvg(RX + RW - 8 * 36 - 6 + i * 36, RY + 20, i < k);
  const svg = '<svg width="' + W + '" height="' + H + '" xmlns="http://www.w3.org/2000/svg" style="position:absolute;left:0;top:0">'
    + '<defs><linearGradient id="hinoki" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e2b877"/><stop offset="1" stop-color="#c7964f"/></linearGradient></defs>'
    + '<line x1="0" y1="470" x2="' + W + '" y2="470" stroke="#26384f" stroke-width="1"/>'
    + '<rect x="' + RX + '" y="' + RY + '" width="' + RW + '" height="' + RH + '" rx="3" fill="url(#hinoki)"/>'
    + ticks + clouds + '</svg>';
  return '<!doctype html><html lang="ja"><head><meta charset="utf-8">'
    + '<style>html,body{margin:0;padding:0}body{width:' + W + 'px;height:' + H + 'px;overflow:hidden;background:#0f1b2d;position:relative;'
    + 'font-family:"Noto Sans CJK JP","Noto Sans JP","Hiragino Sans",sans-serif;color:#f4ede0}'
    + '.top{position:absolute;left:72px;right:72px;top:60px;display:flex;justify-content:space-between;align-items:baseline}'
    + '.series{font-size:26px;letter-spacing:.04em;color:#f4ede0;font-weight:500}.kind{font-size:17px;letter-spacing:.3em;color:#8fa3b8;margin-bottom:10px}'
    + '.no{font-size:40px;font-weight:700;color:#e2b877;letter-spacing:.06em;white-space:nowrap}'
    + '.title{position:absolute;left:72px;right:72px;top:190px;height:250px;display:flex;align-items:center;'
    + 'font-family:"Noto Serif CJK JP","Noto Serif JP","Hiragino Mincho ProN",serif;font-weight:700;font-size:' + fs + 'px;line-height:1.32;letter-spacing:.02em}'
    + '.part{position:absolute;left:72px;top:482px;font-size:18px;color:#8fa3b8;letter-spacing:.08em}'
    + '.brand{position:absolute;right:72px;top:482px;font-size:15px;color:#5f7690;letter-spacing:.28em}'
    + '.foot{position:absolute;left:72px;top:612px;font-size:15px;color:#5f7690;letter-spacing:.1em}'
    + '</style></head><body>' + svg
    + '<div class="top"><div><div class="kind">連載小説</div><div class="series">' + esc(outline.series) + '</div></div><div class="no">' + esc(lab) + '</div></div>'
    + '<div class="title"><div>「' + esc(title) + '」</div></div>'
    + '<div class="part">' + esc(partLab) + '</div><div class="brand">HORIZON SHIELD</div>'
    + '<div class="foot">毎朝、一話ずつ</div>'
    + '</body></html>';
}

/* JST の日付(YYYY-MM-DD) */
function jstDate(d) { return new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, 10); }
function alreadyPostedToday(state, now) {
  const last = (state.posted || [])[state.posted.length - 1];
  return !!(last && last.at && jstDate(new Date(last.at)) === jstDate(now));
}

/* 公開した回を残す。state.json と posted/<key>.txt */
function savePosted(ep, body, url, now, source, dir = STORY_DIR) {
  const st = loadState(dir);
  st.posted = (st.posted || []).filter((p) => p.key !== ep.key);
  st.posted.push({ key: ep.key, kind: ep.kind, no: ep.no, title: ep.title, line: ep.line, url, at: now.toISOString(), source });
  fs.mkdirSync(path.join(dir, 'posted'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'posted', ep.key + '.txt'), String(body).trim() + '\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(st, null, 2) + '\n', 'utf8');
  return st;
}

module.exports = {
  STORY_DIR, LP_URL, LINE_URL, DEFAULT_MODELS, DASH_RE, DASH_TEST, MACHINE_RE,
  loadOutline, loadBible, loadState, mainEpisodes, gaidenSeeds, nextEpisode, episodeByKey, peekNext, remaining,
  label, fullTitle, prewritten, previousBody, cleanBody, gateBody, buildPrompt, parseFree, retryNote, generate,
  composePost, broadcastText, xText, ownerNotice, jstDate, alreadyPostedToday, savePosted,
  hashtagsFor, eyecatchHtml, lacquered,
};
