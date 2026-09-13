#!/usr/bin/env python3
"""
ops/mcp_tool_selection_patch4_20260913.py  (patch3 の続き。hs-mcp 1.0.8 -> 1.0.9)

「さらに強く」。フロント LLM に選ばれた後、**使い続けられる・繋がる・英語でも当たる・測れる** の 4 つ。

  A  英語の工事名を日本語に写す(normalizeWork)。今まで "exterior wall painting" は該当なしで終わっとった。
     get_price_range / audit_estimate / preview / verify_fair_price / search_cost_category に適用。
     写したら normalized_from に元の語を出す(黙って変えん)。日本語が 1 字でも入っとれば触らん。
     地域も romaji(kanagawa, nagoya, osaka ...)を受ける(matched_by: romaji)。
  B  次の呼び出しを機械可読で返す(next_calls)。tool 名と、埋めた引数と、埋めるべき引数(fill)。
     get_price_range -> audit_estimate / find_verified_contractor / check_red_flags
     audit_estimate  -> find_verified_contractor / verify_fair_price / check_red_flags
     find_verified_contractor -> get_price_range / audit_estimate
     URL の next_actions は残す。next_calls は「同じサーバーの次の一手」。
  C  測る。usage:region:applied / usage:normalize:en を数え、usage-stats.json に主要 tool と一緒に出す。
     (別 AI の言う「外部シグナル = 実際の tool call」を、自分の側で数えられるようにする)
  D  instructions に英語の工事名と romaji を受ける旨。version 1.0.9。

既定は dry-run。--apply で書く(.bak を先に残す)。各 anchor は count==1 を assert。
"""
import sys, os, re, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGET = os.path.join(ROOT, "workers", "hs-mcp", "src", "mcp.js")
TEST1 = os.path.join(ROOT, "workers", "hs-mcp", "test", "tool_selection.test.mjs")
APPLY = "--apply" in sys.argv

src = open(TARGET, encoding="utf-8").read(); orig = src

def rep(anchor, new, label):
    global src
    n = src.count(anchor)
    assert n == 1, "%s: anchor count %d != 1" % (label, n)
    src = src.replace(anchor, new)
    print("ok   " + label)

rep('const SERVER = { name: "horizon-shield", version: "1.0.8" };',
    'const SERVER = { name: "horizon-shield", version: "1.0.9" };', "D version 1.0.8 -> 1.0.9")

# ---------- A helpers ----------
HELPERS = '''// [2026-09-13 patch4] 英語の工事名を日本語の照会語に写す。順番が効く(屋根塗装は屋根より先、内窓は窓より先)。
// 日本語が 1 字でも入っとる入力は触らん。写したら normalized_from で元の語を返す。黙って変えん。
const EN_WORK_ALIASES = [
  [/exterior\\s*(wall\\s*)?paint|outside\\s*wall|siding\\s*paint|facade\\s*paint|house\\s*paint|external\\s*wall/i, "外壁塗装"],
  [/roof\\s*(re)?paint|paint\\w*\\s*(the\\s*)?roof/i, "屋根塗装"],
  [/re-?roof|roof\\s*(replace|cover|overlay)|new\\s*roof|\\broof\\b/i, "屋根"],
  [/eco\\s*-?cute|heat\\s*pump\\s*water/i, "エコキュート"],
  [/water\\s*heater|boiler|hot\\s*water/i, "給湯器"],
  [/unit\\s*bath|bath\\s*(room|tub)?|shower\\s*room/i, "浴室"],
  [/kitchen/i, "キッチン"], [/toilet|lavatory|\\bwc\\b/i, "トイレ"], [/wash\\s*basin|vanity|washroom|washstand/i, "洗面"],
  [/wall\\s*paper|wallpaper/i, "クロス"], [/floor|hardwood|laminate/i, "フローリング"], [/tatami/i, "畳"],
  [/termite|white\\s*ant/i, "シロアリ"], [/rain\\s*leak|roof\\s*leak|\\bleak/i, "雨漏り"], [/waterproof/i, "防水"],
  [/inner\\s*window|double\\s*glaz|secondary\\s*glaz/i, "内窓"], [/window|sash/i, "窓"], [/front\\s*door|entrance\\s*door|entry\\s*door/i, "玄関ドア"], [/\\bglass\\b/i, "ガラス"],
  [/insulation/i, "断熱"], [/demolition|tear\\s*down|knock\\s*down/i, "解体"], [/foundation/i, "基礎"], [/scaffold/i, "足場"],
  [/electric|wiring|outlet|breaker/i, "電気工事"], [/plumb|water\\s*pipe|drain|sewer|water\\s*supply/i, "水道"], [/air\\s*con|\\bhvac\\b|\\bac\\s*unit/i, "エアコン"], [/induction|ih\\s*cook/i, "IH"],
  [/fence|carport|driveway|garden|landscap|\\bgate\\b|\\byard\\b/i, "外構"], [/seismic|earthquake|quake/i, "耐震"], [/barrier\\s*-?free|accessib|handrail|grab\\s*bar/i, "バリアフリー"],
  [/full\\s*renovation|whole\\s*house|gut\\s*reno|full\\s*remodel/i, "リノベ"], [/condo|apartment|mansion/i, "マンション"], [/shop\\s*fit|store\\s*fit|tenant\\s*fit|restaurant/i, "店舗"],
  [/plaster|stucco/i, "左官"], [/\\btile/i, "タイル"], [/sheet\\s*metal|gutter/i, "板金"], [/dishwasher/i, "食洗機"],
  [/screen\\s*door|insect\\s*screen|shutter/i, "網戸"], [/security\\s*bar|window\\s*grille|grille/i, "面格子"]
];
function normalizeWork(q) {
  const raw = String(q || "").trim();
  if (!raw || /[\\u3040-\\u30ff\\u4e00-\\u9fff]/.test(raw) || !/[A-Za-z]/.test(raw)) return { q: raw, from: null };
  for (const [re, ja] of EN_WORK_ALIASES) { if (re.test(raw)) return { q: ja, from: raw }; }
  return { q: raw, from: null };
}
const REGION_ROMAJI = {
  kanto: ["tokyo", "kanagawa", "chiba", "saitama", "ibaraki", "tochigi", "gunma", "yokohama", "kawasaki", "hiratsuka", "fujisawa", "chigasaki", "kamakura", "odawara"],
  kinki: ["osaka", "kyoto", "hyogo", "nara", "shiga", "wakayama", "mie", "kobe", "himeji"],
  chubu: ["aichi", "gifu", "shizuoka", "nagano", "yamanashi", "niigata", "toyama", "ishikawa", "fukui", "nagoya", "hamamatsu", "kanazawa"],
  tohoku: ["aomori", "iwate", "miyagi", "akita", "yamagata", "fukushima", "sendai"],
  other: ["hokkaido", "sapporo", "okayama", "hiroshima", "fukuoka", "okinawa", "kumamoto", "kagoshima", "tottori", "shimane", "yamaguchi", "ehime", "kagawa", "tokushima", "kochi", "saga", "nagasaki", "oita", "miyazaki"]
};
// [2026-09-13 patch4] 使用計数。handleTool 冒頭の _bump と同じ形(payload 無し・IP 無し・件数だけ)。待たん。
function bumpUsage(env, opts, key) {
  try {
    if (!(env && env.RL_KV)) return;
    const p = (async () => {
      const c = parseInt(await env.RL_KV.get(key) || "0", 10);
      await env.RL_KV.put(key, String(c + 1), { expirationTtl: 60 * 60 * 24 * 400 });
    })().catch(() => {});
    if (opts && opts.ctx && typeof opts.ctx.waitUntil === "function") opts.ctx.waitUntil(p);
  } catch (_e) { /* counters are best-effort */ }
}
function txt(s) {'''
rep('function txt(s) {', HELPERS, "A helpers (EN_WORK_ALIASES, normalizeWork, REGION_ROMAJI, bumpUsage)")

rep('''  const key = raw.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(m, key)) return { requested: raw, key, multiplier: Number(m[key]) || 1, matched_by: "key" };
  for (const table of [REGION_PREFS, REGION_CITIES]) {''',
    '''  const key = raw.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(m, key)) return { requested: raw, key, multiplier: Number(m[key]) || 1, matched_by: "key" };
  if (/^[a-z\\s,.-]+$/.test(key)) {
    for (const k of Object.keys(REGION_ROMAJI)) {
      if (REGION_ROMAJI[k].some(n => key.includes(n))) {
        if (!Object.prototype.hasOwnProperty.call(m, k)) return { requested: raw, key: null, multiplier: 1, matched_by: "unknown", note: "region " + k + " is not present in souba-db region_multipliers; base values returned." };
        return { requested: raw, key: k, multiplier: Number(m[k]) || 1, matched_by: "romaji" };
      }
    }
  }
  for (const table of [REGION_PREFS, REGION_CITIES]) {''',
    "A resolveRegion に romaji")

# ---------- A+B get_price_range ----------
rep('''    const q = String(args.query || "").trim();
    if (!q) return txt("query(工事名・キーワード)を指定してください。");
    try {
      const r = await fetch(SOUBA_DB_URL, { cf: { cacheTtl: 3600 } });''',
    '''    const _nw = normalizeWork(args.query);
    const q = _nw.q;
    if (!q) return txt("query(工事名・キーワード)を指定してください。");
    if (_nw.from) bumpUsage(env, opts, "usage:normalize:en");
    try {
      const r = await fetch(SOUBA_DB_URL, { cf: { cacheTtl: 3600 } });''',
    "A get_price_range に normalizeWork")

rep('''        query: q, currency: "JPY", count: out.length, prices: out,''',
    '''        query: q, ...(_nw.from ? { normalized_from: _nw.from } : {}), currency: "JPY", count: out.length, prices: out,
        // [patch4] 同じサーバーの次の一手。tool 名・埋めた引数・埋めるべき引数(fill)。
        next_calls: [
          { tool: "audit_estimate", when: "the user has a quoted amount for this work / 見積額がある", arguments: { work: (out[0] && out[0].work) || q, ...((reg && reg.key) ? { region: reg.requested } : {}) }, fill: { quoted_price: "number, JPY" } },
          { tool: "find_verified_contractor", when: "the user asks who to hire / 業者を探している", arguments: { work: q, ...(reg ? { area: reg.requested } : {}) } },
          { tool: "check_red_flags", when: "the user quotes wording from an estimate or a sales pitch / 見積書や営業トークの文言がある", arguments: {}, fill: { text: "the wording" } }
        ],''',
    "B get_price_range に next_calls")

rep('''      const reg = resolveRegion(args.region, ((d && d._meta) || {}).region_multipliers);
      let anyApplied = false;''',
    '''      const reg = resolveRegion(args.region, ((d && d._meta) || {}).region_multipliers);
      let anyApplied = false;
      if (reg && reg.key) bumpUsage(env, opts, "usage:region:requested");''',
    "C get_price_range で region 要求を数える")

# ---------- A+B audit_estimate ----------
rep('''    const work = String(args.work || "").trim();
    const price = Number(args.quoted_price);
    if (!work || !Number.isFinite(price) || price <= 0) return txt("work(工事名)と、1以上の quoted_price(金額・円, 数値)を指定してください。 / quoted_price must be a positive number in JPY.");''',
    '''    const _nw = normalizeWork(args.work);
    const work = _nw.q;
    const price = Number(args.quoted_price);
    if (!work || !Number.isFinite(price) || price <= 0) return txt("work(工事名)と、1以上の quoted_price(金額・円, 数値)を指定してください。 / quoted_price must be a positive number in JPY.");
    if (_nw.from) bumpUsage(env, opts, "usage:normalize:en");''',
    "A audit_estimate に normalizeWork")

rep('''      cand = cand.map(c => { const ar = applyRegion(c, reg); if (ar.applied) regionApplied = true; return ar.e; });''',
    '''      cand = cand.map(c => { const ar = applyRegion(c, reg); if (ar.applied) regionApplied = true; return ar.e; });
      if (regionApplied) bumpUsage(env, opts, "usage:region:applied");''',
    "C audit_estimate で region 適用を数える")

rep('''      resp.claim = claim;''',
    '''      if (_nw.from) resp.normalized_from = _nw.from;
      resp.next_calls = [
        { tool: "find_verified_contractor", when: "the user asks who to hire for this work / この工事の業者を探している", arguments: { work: resp.work_query, ...(resp.region ? { area: resp.region.requested } : {}) } },
        { tool: "verify_fair_price", when: "the user needs a hash-verifiable fair-price record / 検証可能な記録が要る", arguments: { work: resp.work } },
        { tool: "check_red_flags", when: "the user quotes wording from the estimate / 見積書の文言がある", arguments: {}, fill: { text: "the wording" } }
      ];
      resp.claim = claim;''',
    "B audit_estimate に next_calls + normalized_from")

# ---------- A preview / verify_fair_price / search_cost_category ----------
rep('''    const work = String(args.work || "").trim();
    const price = Number(args.quoted_price);
    if (!work || !Number.isFinite(price) || price <= 0) return txt("work(工事名)と、1以上の quoted_price(概算額・円, 数値)を指定してください。 / quoted_price must be a positive number in JPY.");''',
    '''    const work = normalizeWork(args.work).q;
    const price = Number(args.quoted_price);
    if (!work || !Number.isFinite(price) || price <= 0) return txt("work(工事名)と、1以上の quoted_price(概算額・円, 数値)を指定してください。 / quoted_price must be a positive number in JPY.");''',
    "A preview に normalizeWork")

rep('''    const work = String(args.work || "").trim();
    if (!work) return txt("work(工事名)を指定してください。");
    try {
      const d = await fetchSouba();''',
    '''    const work = normalizeWork(args.work).q;
    if (!work) return txt("work(工事名)を指定してください。");
    try {
      const d = await fetchSouba();''',
    "A verify_fair_price に normalizeWork")

rep('''    const q = String(args.query || "").trim();
    if (!q) return txt("query(工事名・キーワード)を指定してください。");
    const hit = CATEGORIES.filter(c =>''',
    '''    const _nw = normalizeWork(args.query);
    const q = _nw.q;
    if (!q) return txt("query(工事名・キーワード)を指定してください。");
    const hit = CATEGORIES.filter(c =>''',
    "A search_cost_category に normalizeWork")

rep('''    return txt({ query: q, matches: hit, note: "red_flags = HORIZON SHIELDが整備済みの過剰請求の懸念点の数", next_actions: NEXT_ACTIONS });''',
    '''    return txt({ query: q, ...(_nw.from ? { normalized_from: _nw.from } : {}), matches: hit, note: "red_flags = HORIZON SHIELDが整備済みの過剰請求の懸念点の数", next_actions: NEXT_ACTIONS });''',
    "A search_cost_category に normalized_from")

# ---------- B find_verified_contractor next_calls ----------
rep('''      source: srcLabel, next_actions: NEXT_ACTIONS
    });''',
    '''      next_calls: [
        ...(work ? [{ tool: "get_price_range", when: "the user wants the fair range for this work / この工事の相場が要る", arguments: { query: work, ...(area ? { region: area } : {}) } }] : []),
        { tool: "audit_estimate", when: "the user has a quoted amount / 見積額がある", arguments: { ...(work ? { work } : {}), ...(area ? { region: area } : {}) }, fill: { quoted_price: "number, JPY", ...(work ? {} : { work: "work name" }) } }
      ],
      source: srcLabel, next_actions: NEXT_ACTIONS
    });''',
    "B find_verified_contractor に next_calls")

# ---------- C usage-stats keys ----------
rep('''          "usage:skill:ap2_fairness_attestation"];''',
    '''          "usage:skill:ap2_fairness_attestation",
          "usage:skill:get_price_range", "usage:skill:check_red_flags", "usage:skill:find_verified_contractor",
          "usage:region:requested", "usage:region:applied", "usage:normalize:en"];''',
    "C usage-stats.json に新しい鍵")

# ---------- D instructions ----------
rep('''base values are returned alongside. " +''',
    '''base values are returned alongside. English work names (exterior wall painting, water heater, termite) and romaji place names (kanagawa, nagoya) are mapped to Japanese automatically and the mapping is disclosed as normalized_from. Every price answer also carries next_calls: the next tool on this server with its arguments already filled. " +''',
    "D instructions (EN)")

rep('''基準値も併せて返す。返答には''',
    '''基準値も併せて返す。英語の工事名(exterior wall painting, water heater)と romaji の地名(kanagawa, nagoya)は日本語に写して照会し、写した事は normalized_from で開示する。価格の返答には next_calls(同じサーバーの次の tool と埋めた引数)も付く。返答には''',
    "D instructions (JA)")

# ---------- 検査 ----------
DASH = re.compile("[" + "".join(chr(c) for c in (0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xFF0D)) + "]")
new_lines = [l for l in src.splitlines() if l not in set(orig.splitlines())]
bad = [l for l in new_lines if DASH.search(l)]
assert not bad, "追加行にダッシュ: " + "\n".join(bad[:5])
print("ok   追加行 %d 本、ダッシュ無し" % len(new_lines))
assert src.count("normalizeWork(") == 6, src.count("normalizeWork(")
assert src.count("next_calls") >= 3

t = open(TEST1, encoding="utf-8").read()
t_new = t.replace('chk("serverInfo.version は 1.0.8", r.serverInfo && r.serverInfo.version === "1.0.8", JSON.stringify(r.serverInfo));',
                  'chk("serverInfo.version は 1.0.9", r.serverInfo && r.serverInfo.version === "1.0.9", JSON.stringify(r.serverInfo));')
assert t_new != t and "1.0.8" not in t_new
print("ok   test1 の固定値 1.0.9")

if not APPLY:
    print("\nDRY RUN。書いてへん。--apply で書く。"); sys.exit(0)
stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
open(TARGET + "." + stamp + "-toolsel4.bak", "w", encoding="utf-8").write(orig)
open(TARGET, "w", encoding="utf-8").write(src)
open(TEST1, "w", encoding="utf-8").write(t_new)
print("\nAPPLIED  mcp.js / test1  (bak stamp " + stamp + ")")
