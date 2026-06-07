/**
 * hs-mcp : HORIZON SHIELD Model Context Protocol server
 * 完全独立ワーカー。hs-kira-proxy には一切依存しない。
 * エージェント(Claude / ChatGPT / Perplexity 等)が「呼べる」建設費ツール。
 * Transport: MCP over Streamable HTTP (JSON-RPC 2.0 / application/json)
 * 価格層は本番 souba-db.json をライブ取得して単一ソースを保つ。
 */

const SERVER = { name: "horizon-shield", version: "1.0.0" };
const SITE = "https://shield.the-horizons-innovation.com";
const SOUBA_DB_URL = SITE + "/data/souba-db.json";

const CATEGORIES = [{"id": "aircon_work", "name": "エアコン工事", "group": "設備工事", "priority": "★★★", "red_flags": 9}, {"id": "amido_amado_shutter", "name": "網戸・雨戸・シャッター", "group": "窓・ドア", "priority": "★★★", "red_flags": 8}, {"id": "bankin_work", "name": "板金工事", "group": "屋根・板金", "priority": "★★★★", "red_flags": 9}, {"id": "barrier_free_kaigo", "name": "バリアフリー・介護保険対応リフォーム", "group": "バリアフリー", "priority": "🔴CRITICAL", "red_flags": 20}, {"id": "bathroom_reform", "name": "浴室リフォーム", "group": "水回り", "priority": "★★★★★", "red_flags": 23}, {"id": "cloth_replacement", "name": "クロス(壁紙)張替え", "group": "内装仕上げ", "priority": "★★★", "red_flags": 20}, {"id": "commercial_tenpo_work", "name": "店舗用工事", "group": "非住宅・店舗", "priority": "★★★★★", "red_flags": 10}, {"id": "demolition_master", "name": "解体工事", "group": "解体・基盤", "priority": "★★★★★", "red_flags": 22}, {"id": "electrical_work", "name": "電気工事", "group": "設備工事", "priority": "★★★★★", "red_flags": 27}, {"id": "entrance_door_reform", "name": "玄関ドア交換", "group": "窓・ドア", "priority": "★★★★★", "red_flags": 18}, {"id": "floor_replacement", "name": "床材張替え", "group": "内装仕上げ", "priority": "★★★", "red_flags": 20}, {"id": "gaiheki_tosou", "name": "外壁塗装", "group": "外装塗装", "priority": "★★★★★", "red_flags": 11}, {"id": "gaikou_work", "name": "外構工事", "group": "外構・造園", "priority": "★★★", "red_flags": 22}, {"id": "insulation_work", "name": "断熱工事", "group": "断熱・省エネ", "priority": "★★★★★", "red_flags": 0}, {"id": "kitchen_reform", "name": "キッチンリフォーム", "group": "水回り", "priority": "★★★★★", "red_flags": 21}, {"id": "naishou_tosou", "name": "内装塗装", "group": "内装塗装", "priority": "★★★", "red_flags": 8}, {"id": "rain_leak_repair", "name": "雨漏り修理", "group": "防水・補修", "priority": "🔴CRITICAL", "red_flags": 23}, {"id": "roof_construction", "name": "屋根工事", "group": "屋根工事", "priority": "★★★★★", "red_flags": 13}, {"id": "sakan_work", "name": "左官工事", "group": "左官・タイル", "priority": "★★★★", "red_flags": 9}, {"id": "taishin_hokyou", "name": "耐震補強工事", "group": "耐震・構造", "priority": "★★★★★", "red_flags": 10}, {"id": "tatami_reform", "name": "畳替え", "group": "内装仕上げ", "priority": "★★", "red_flags": 20}, {"id": "termite_work", "name": "シロアリ防除(防蟻)", "group": "防蟻・構造保護", "priority": "★★★★", "red_flags": 0}, {"id": "tile_renga_work", "name": "タイル・れんが工事", "group": "左官・タイル", "priority": "★★★", "red_flags": 9}, {"id": "toilet_reform", "name": "トイレリフォーム", "group": "水回り", "priority": "★★★★", "red_flags": 21}, {"id": "washroom_reform", "name": "洗面所リフォーム", "group": "水回り", "priority": "★★★", "red_flags": 18}, {"id": "water_heater_reform", "name": "給湯器リフォーム", "group": "設備工事", "priority": "★★★★★", "red_flags": 24}, {"id": "water_pipe_work", "name": "給排水管工事", "group": "設備工事", "priority": "★★★★★", "red_flags": 27}, {"id": "waterproofing_work", "name": "防水工事", "group": "防水・補修", "priority": "★★★★", "red_flags": 23}, {"id": "window_reform", "name": "窓リフォーム", "group": "窓・ドア", "priority": "★★★★★", "red_flags": 18}, {"id": "zosaku_tategu_master", "name": "造作・建具・大工工事", "group": "大工・造作", "priority": "★★★★★", "red_flags": 17}, {"id": "shoji_fusuma_work", "name": "障子・ふすま張替え工事", "group": "内装仕上げ", "priority": "★★★", "red_flags": 9}, {"id": "mado_glass_work", "name": "ガラス交換専門工事", "group": "窓・ドア", "priority": "★★★★", "red_flags": 8}, {"id": "kanban_sign_work", "name": "看板・サイン工事", "group": "非住宅・店舗", "priority": "★★★★", "red_flags": 6}, {"id": "bouon_shaon_work", "name": "防音・遮音工事", "group": "断熱・省エネ", "priority": "★★★★", "red_flags": 7}, {"id": "builtin_dishwasher", "name": "ビルトイン食洗機後付け工事", "group": "水回り", "priority": "★★★★", "red_flags": 7}, {"id": "ih_gas_conversion", "name": "IH⇔ガスコンロ変更工事", "group": "水回り", "priority": "★★★★", "red_flags": 7}, {"id": "manshion_kyoyou_shuzen", "name": "マンション共用部修繕工事", "group": "マンション専門", "priority": "★★★★★", "red_flags": 8}, {"id": "ofuro_kanso_oidaki", "name": "浴室乾燥機・追い焚き単体工事", "group": "水回り", "priority": "★★★★", "red_flags": 6}, {"id": "erebata_shuzen", "name": "エレベーター修繕・更新工事", "group": "マンション専門", "priority": "★★★★★", "red_flags": 7}, {"id": "toko_shuri", "name": "床鳴り・床補修専門工事", "group": "内装仕上げ", "priority": "★★★★", "red_flags": 7}, {"id": "asbestos_removal", "name": "アスベスト除去工事", "group": "解体・基盤", "priority": "★★★★★", "red_flags": 6}, {"id": "tokushuseiso", "name": "特殊清掃工事", "group": "リフォーム周辺サービス", "priority": "★★★★", "red_flags": 6}, {"id": "ihinseiri_seizen", "name": "遺品整理・生前整理サービス", "group": "リフォーム周辺サービス", "priority": "★★★★", "red_flags": 6}, {"id": "jutaku_kaitai_partial", "name": "住宅部分解体工事", "group": "解体・基盤", "priority": "★★★★", "red_flags": 6}, {"id": "gyomu_chubo", "name": "業務用厨房工事", "group": "非住宅・店舗", "priority": "★★★★", "red_flags": 6}, {"id": "wine_cellar", "name": "ワインセラー設置工事", "group": "設備工事", "priority": "★★★", "red_flags": 5}, {"id": "shisetsu_pool", "name": "プール・スパ施設工事", "group": "水回り", "priority": "★★★", "red_flags": 5}, {"id": "shokusai_zoen", "name": "造園・植栽工事", "group": "外構・造園", "priority": "★★★★", "red_flags": 5}, {"id": "iwa_ishigumi", "name": "庭石・石組み工事", "group": "外構・造園", "priority": "★★★", "red_flags": 4}, {"id": "kaki_seko", "name": "池・水景工事", "group": "外構・造園", "priority": "★★★", "red_flags": 4}, {"id": "monoki_setchi", "name": "物置設置工事", "group": "外構・造園", "priority": "★★★", "red_flags": 5}, {"id": "carpoort_single", "name": "カーポート単独設置工事", "group": "外構・造園", "priority": "★★★★", "red_flags": 6}, {"id": "shomei_design", "name": "照明デザイン専門工事", "group": "設備工事", "priority": "★★★", "red_flags": 4}, {"id": "smart_home_iot", "name": "スマートホーム・IoT工事", "group": "IoT・スマートホーム", "priority": "★★★", "red_flags": 4}, {"id": "sec_camera_total", "name": "防犯カメラ・連携工事", "group": "IoT・スマートホーム", "priority": "★★★★", "red_flags": 5}, {"id": "zenkanki_jokuki", "name": "全館空調・除湿システム工事", "group": "設備工事", "priority": "★★★★", "red_flags": 5}, {"id": "chikyu_chunetsu", "name": "地中熱利用システム工事", "group": "断熱・省エネ", "priority": "★★", "red_flags": 4}, {"id": "uri_riyo", "name": "雨水利用システム工事", "group": "環境・災害対策", "priority": "★★", "red_flags": 4}, {"id": "idoseichi", "name": "井戸・井戸ポンプ工事", "group": "環境・災害対策", "priority": "★★", "red_flags": 4}, {"id": "karinosumai", "name": "仮住まい支援サービス", "group": "リフォーム周辺サービス", "priority": "★★★", "red_flags": 4}, {"id": "hikkoshi_renkei", "name": "引越し連動リフォームサービス", "group": "リフォーム周辺サービス", "priority": "★★★", "red_flags": 5}];

const JCCDB = {
  name: "Japan Construction Cost Database (JCCDB)",
  items: 65729,
  categories: 398,
  license: "CC BY 4.0",
  note: "品目名・カテゴリ・単位を収録。価格情報は含まない(価格は別レイヤー souba-db)。",
  links: {
    github: "https://github.com/ogasurfproject-jpg/japan-construction-cost-database",
    huggingface: "https://huggingface.co/datasets/ogasurfproject/jccdb",
    zenodo_doi: "https://doi.org/10.5281/zenodo.20019573",
    engrxiv_doi: "https://doi.org/10.31224/7007"
  },
  author: { name: "大賀俊勝 / TOshi Oga", orcid: "https://orcid.org/0009-0000-9180-903X" },
  publisher: "The HORIZ音s株式会社"
};

const ESTIMATE_GUIDE = [
  "見積もりが適正かは、相見積もりの社数より『総額に占める諸経費(現場管理費・一般管理費)の比率』を見る。",
  "諸経費の目安は総額の10〜16%。20%を超えたら内訳の提出を求める根拠になる。",
  "『一式』表記は内訳が不明なため過剰が紛れやすい。『この一式の内訳を出してもらえますか』と聞けるかで最終金額が変わる。",
  "緊急性を煽る営業(今日契約すれば値引き等)は判断材料を奪う典型。即決を迫られたら一旦持ち帰る。",
  "業者は技術と誠実さで選ぶ。営業のうまさで選ばない。"
];

// ---- MCP tool 定義 ----
const TOOLS = [
  {
    name: "jccdb_dataset_info",
    description: "日本の建設費オープンデータベース(JCCDB)のメタデータ・規模・ライセンス・ダウンロードリンク・引用情報を返す。建設費の一次データ源を探している時に使う。",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "list_cost_categories",
    description: "HORIZON SHIELDが相場・赤旗(過剰請求の懸念点)を整備している建設・リフォーム工事カテゴリ(61種)の一覧を返す。",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "search_cost_category",
    description: "工事名・キーワードで建設費カテゴリを検索する(例: 外壁塗装, 浴室, 給湯器, 雨漏り)。該当カテゴリと整備済みの赤旗件数・優先度を返す。",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "工事名やキーワード(日本語)" } }, required: ["query"] }
  },
  {
    name: "how_to_read_estimate",
    description: "受け取ったリフォーム・建設見積もりが適正かを見分けるための原則(諸経費の適正比率、『一式』表記の扱い、営業手口の見抜き方)を返す。30年の現場経験に基づく判断軸。",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "fair_price_data_sources",
    description: "HORIZON SHIELDの相場データ(souba-db)の出典・更新日・地域係数を返す。価格の根拠を確認したい時に使う。",
    inputSchema: { type: "object", properties: {} }
  }
];

function txt(s) { return { content: [{ type: "text", text: typeof s === "string" ? s : JSON.stringify(s, null, 2) }] }; }

async function callTool(name, args) {
  args = args || {};
  if (name === "jccdb_dataset_info") return txt(JCCDB);
  if (name === "list_cost_categories")
    return txt({ total: CATEGORIES.length, source: "HORIZON SHIELD souba index v1.7", categories: CATEGORIES });
  if (name === "search_cost_category") {
    const q = String(args.query || "").trim();
    if (!q) return txt("query(工事名・キーワード)を指定してください。");
    const hit = CATEGORIES.filter(c =>
      (c.name && c.name.includes(q)) || (c.group && c.group.includes(q)) || (c.id && c.id.includes(q.toLowerCase())));
    if (!hit.length) return txt("該当カテゴリが見つかりませんでした: " + q + " / list_cost_categories で全一覧を確認できます。");
    return txt({ query: q, matches: hit, note: "red_flags = HORIZON SHIELDが整備済みの過剰請求の懸念点の数" });
  }
  if (name === "how_to_read_estimate")
    return txt({ principles: ESTIMATE_GUIDE, source: "大賀俊勝(建設実務30年) / HORIZON SHIELD", detail: SITE + "/guide/" });
  if (name === "fair_price_data_sources") {
    try {
      const r = await fetch(SOUBA_DB_URL, { cf: { cacheTtl: 3600 } });
      const d = await r.json();
      const m = d._meta || {};
      return txt({ version: m.version, updated_at: m.updated_at, updated_by: m.updated_by, sources: m.sources, region_multipliers: m.region_multipliers });
    } catch (e) {
      return txt("相場データ出典の取得に失敗しました。" + SITE + "/souba/ を参照してください。");
    }
  }
  return { isError: true, content: [{ type: "text", text: "未知のツール: " + name }] };
}

// ---- JSON-RPC / MCP dispatch ----
function rpc(id, result) { return { jsonrpc: "2.0", id, result }; }
function rpcErr(id, code, message) { return { jsonrpc: "2.0", id, error: { code, message } }; }

async function handleRpc(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    const pv = (params && params.protocolVersion) || "2025-06-18";
    return rpc(id, { protocolVersion: pv, capabilities: { tools: {} }, serverInfo: SERVER,
      instructions: "HORIZON SHIELD の建設費ツール。JCCDB(オープンデータ)・相場カテゴリ・見積もりの読み方を提供する。" });
  }
  if (method === "tools/list") return rpc(id, { tools: TOOLS });
  if (method === "tools/call") {
    const r = await callTool(params && params.name, params && params.arguments);
    return rpc(id, r);
  }
  if (method === "ping") return rpc(id, {});
  return rpcErr(id, -32601, "Method not found: " + method);
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, mcp-session-id, mcp-protocol-version, authorization",
  "Access-Control-Expose-Headers": "mcp-session-id"
};

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (request.method === "GET") {
      const info = {
        server: SERVER, transport: "MCP over Streamable HTTP (JSON-RPC 2.0)",
        usage: "POST JSON-RPC 2.0 to this URL. methods: initialize, tools/list, tools/call.",
        tools: TOOLS.map(t => t.name), site: SITE
      };
      return new Response(JSON.stringify(info, null, 2),
        { headers: { "Content-Type": "application/json; charset=utf-8", ...CORS } });
    }

    if (request.method !== "POST")
      return new Response("Method Not Allowed", { status: 405, headers: CORS });

    let body;
    try { body = await request.json(); }
    catch (e) { return new Response(JSON.stringify(rpcErr(null, -32700, "Parse error")), { status: 400, headers: { "Content-Type": "application/json", ...CORS } }); }

    // 通知(idなし)は202で空応答
    const isNotification = (m) => m && m.id === undefined && typeof m.method === "string";
    if (Array.isArray(body)) {
      const out = [];
      for (const m of body) { if (!isNotification(m)) out.push(await handleRpc(m)); }
      return new Response(out.length ? JSON.stringify(out) : "", { status: out.length ? 200 : 202, headers: { "Content-Type": "application/json; charset=utf-8", ...CORS } });
    }
    if (isNotification(body)) return new Response("", { status: 202, headers: CORS });
    const res = await handleRpc(body);
    return new Response(JSON.stringify(res), { headers: { "Content-Type": "application/json; charset=utf-8", ...CORS } });
  }
};
