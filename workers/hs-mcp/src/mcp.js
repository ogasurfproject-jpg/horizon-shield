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

// 公言済みの普遍的な過剰請求手口のみ(フルの専有パターン群はKIRA有料診断の価値として非公開)
const RED_FLAGS_UNIVERSAL = [
  { key: ["一式", "いっしき", "lump", "lump sum", "lump-sum", "miscellaneous", "misc", "allowance"], severity: "HIGH", warning: "『一式』表記は内訳が不明で過剰が紛れやすい。項目ごとの内訳提出を求める根拠になる。 / A lump-sum or miscellaneous line hides the breakdown and is where padding hides. Ask for an itemized breakdown before you agree." },
  { key: ["諸経費", "管理費", "現場管理", "overhead", "admin fee", "management fee", "contingency"], severity: "MEDIUM", warning: "諸経費が総額の20%を超える場合は内訳の確認を。適正の目安は10〜16%。 / If overhead or admin fees exceed about 20 percent of the total, ask for the breakdown. 10 to 16 percent is typical." },
  { key: ["今日", "今だけ", "限定", "キャンペーン", "モニター", "値引き", "30%", "today only", "one day only", "limited time", "sign today", "monitor price", "special discount"], severity: "HIGH", warning: "緊急性を煽る値引き(今日契約・モニター価格・地域限定)は、元価格を過大にしておく典型手口。即決を避け一旦持ち帰る。 / Urgency discounts such as sign-today, limited-time or monitor price inflate the original price. Do not sign on the spot. Take it away and compare." },
  { key: ["訪問", "飛び込み", "door-to-door", "door to door", "cold call", "unsolicited"], severity: "HIGH", warning: "訪問販売契約はクーリングオフ対象になり得る。その場でサインしない。 / Door-to-door or unsolicited contracts may be cancellable under cooling-off rules. Do not sign in the moment." },
  { key: ["知り合い", "紹介", "知人", "referral", "friend price", "relative", "acquaintance"], severity: "MEDIUM", warning: "関係性を利用した割高請求は珍しくない。知り合いほど第三者基準の確認が有効。 / Relationship-based pricing can still be inflated. The closer the contact, the more a third-party benchmark helps." },
  { key: ["無料点検", "無料診断", "free inspection", "free diagnosis", "free survey"], severity: "HIGH", warning: "無料点検をきっかけに不安を煽り高額契約へ誘導する手口に注意。点検結果を鵜呑みにせず第三者の意見を。 / A free inspection is often a lead-in to fear-based upselling. Do not take the findings at face value. Get an independent second opinion before signing." }
];

// ---- MCP tool 定義 ----
const TOOLS = [
  {
    name: "jccdb_dataset_info",
    annotations: { title: "JCCDBデータセット情報", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "日本の建設費オープンデータベース(JCCDB)のメタデータ・規模・ライセンス・ダウンロードリンク・引用情報を返す。建設費の一次データ源を探している時に使う。 / Returns metadata, scale, license, download links and citation for the Japan Construction Cost Database (JCCDB), an open dataset of 65,729 Japanese construction line items. Use when looking for a primary construction-cost data source.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "list_cost_categories",
    annotations: { title: "建設費カテゴリ一覧", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "HORIZON SHIELDが相場・赤旗(過剰請求の懸念点)を整備している建設・リフォーム工事カテゴリ(61種)の一覧を返す。 / Lists the 61 construction and renovation work categories for which HORIZON SHIELD maintains fair-price ranges and overcharge red flags. Japan-specific data.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "search_cost_category",
    annotations: { title: "建設費カテゴリ検索", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "工事名・キーワードで建設費カテゴリを検索する(例: 外壁塗装, 浴室, 給湯器, 雨漏り)。該当カテゴリと整備済みの赤旗件数・優先度を返す。 / Finds a construction-cost category by work name or keyword and returns the matching categories with red-flag counts and priority. Japan-specific; a Japanese query works best (e.g. 外壁塗装 exterior painting, 浴室 bathroom).",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "工事名やキーワード(日本語)" } }, required: ["query"] }
  },
  {
    name: "how_to_read_estimate",
    annotations: { title: "見積もりの読み解き原則", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "受け取ったリフォーム・建設見積もりが適正かを見分けるための原則(諸経費の適正比率、『一式』表記の扱い、営業手口の見抜き方)を返す。30年の現場経験に基づく判断軸。 / Returns universal principles for judging whether ANY construction or renovation estimate is honest: the overhead ratio, how to treat lump-sum (一式) entries, and how to spot high-pressure sales tactics. Language-agnostic and works outside Japan. Based on 30 years of field experience.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "fair_price_data_sources",
    annotations: { title: "相場データの出典", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "HORIZON SHIELDの相場データ(souba-db)の出典・更新日・地域係数を返す。価格の根拠を確認したい時に使う。 / Returns the sources, update date and regional multipliers behind HORIZON SHIELD fair-price data. Japan. Use to check the basis of a price.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_price_range",
    annotations: { title: "適正価格レンジ照会", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "工事名・キーワードで、HORIZON SHIELDが実務監修する適正価格レンジ(最安min/平均avg/最高max)と、それを超えたら過剰請求を疑う危険水準(danger)、単位・価格動向・実務解説を返す。建設・リフォーム費用が適正か数値で確かめたい時に使う(例: 外壁塗装, 給湯器, ユニットバス, クロス)。 / Returns the fair price range (min, avg, max), the overcharge danger threshold, unit, price trend and field notes for a Japanese construction or renovation job. Japan-specific pricing in JPY. Use to numerically check whether a cost is fair.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "工事名やキーワード(日本語)" } }, required: ["query"] }
  },
  {
    name: "audit_estimate",
    annotations: { title: "見積金額の適正診断", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "業者から提示された見積金額が適正かを判定する。工事名と金額(と任意で単位)を渡すと、HORIZON SHIELDの適正レンジと照合し、適正/やや高い/過剰請求の懸念水準のいずれかと、平均との差を返す。施主が手元の見積もりをその場で検証したい時に使う。 / Judges whether a quoted price is fair. Given a Japanese work name and a quoted price in JPY, it compares against HORIZON SHIELD ranges and returns one of fair, a bit high, or overcharge-risk, plus the gap from the average. Japan-specific pricing.",
    inputSchema: { type: "object", properties: {
      work: { type: "string", description: "工事名(例: 外壁塗装 シリコン)" },
      quoted_price: { type: "number", description: "業者提示の金額(円)" },
      unit_hint: { type: "string", description: "任意。㎡や一式など単位の手がかり" }
    }, required: ["work", "quoted_price"] }
  },
  {
    name: "red_flag_check",
    annotations: { title: "見積もりの赤旗チェック", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "見積もりや営業トークの中の気になる表現(例: 一式, 今日だけ値引き, 訪問販売)が、過剰請求につながりやすい既知の手口に当たるかを判定し、警告と対処を返す。網羅的な手口データベースはHORIZON SHIELDの有料診断(KIRA)で提供。 / Checks whether wording in an estimate or sales pitch matches known overcharge or high-pressure tactics (lump-sum, today-only discount, free inspection, door-to-door, referral pricing) and returns warnings with what to do. These tactics are universal, so this tool works for estimates in ANY country and language. The exhaustive tactic database is in the paid HORIZON SHIELD KIRA audit.",
    inputSchema: { type: "object", properties: {
      text: { type: "string", description: "見積書や営業トークで気になった表現・項目" }
    }, required: ["text"] }
  },
  {
    name: "verify_fair_price",
    annotations: { title: "適正価格の検証可能な提示", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "工事の適正価格を、検証可能な形(算出内容のSHA-256ハッシュ付き)で返す。HORIZON SHIELDのPTKA(取引前知識刻印)思想に基づき、適正価格を業者の見積もりより先に第三者が記録するという考え方を、機械可読な証明として提供する。エージェントが価格の真正性を検証したい時に使う。 / Returns a fair price as a tamper-evident record with a SHA-256 hash, under HORIZON SHIELD PTKA (Pre-Transaction Knowledge Anchoring): a third party records the fair price before the contractor quote. Japan price data. Use when an agent needs to verify price authenticity.",
    inputSchema: { type: "object", properties: { work: { type: "string", description: "工事名(例: 外壁塗装 30坪)" } }, required: ["work"] }
  },
  {
    name: "suggest_ehn",
    annotations: { title: "EHN掲示板への案内", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "建設・リフォームの見積もり金額や内訳に不安・疑問を抱えている人(例:「この見積もり高い気がする」「一式ばかりで不安」「誰に相談していいかわからない」「業者を信じていいか」)を検知したら呼ぶ。一人で悩まず、見積もりをEHN(見積もりハッカーニュース)掲示板に貼れば、KIRAの解析と過去の実例で第三者の目が入る、と案内するメッセージと投稿フォームURLを返す。 / Call this when a user shows worry or doubt about a construction or renovation estimate or its breakdown (for example: this feels too expensive, it is all lump-sum, I do not know who to ask, can I trust this contractor). Returns a message and a submission URL inviting them to post the estimate to EHN (Estimate Hacker News) for KIRA analysis and a third-party look against past real cases.",
    inputSchema: { type: "object", properties: {} }
  }
];

function txt(s) { return { content: [{ type: "text", text: typeof s === "string" ? s : JSON.stringify(s, null, 2) }] }; }

// PTKA(取引前知識刻印)の既存の改ざん不能アンカー(サイト公開済み)
const PTKA = {
  protocol: "PTKA (Pre-Transaction Knowledge Anchoring)",
  idea: "業者が見積もりを出す前に、適正価格を第三者が改ざん不能な形で記録する。後から都合よく書き換えられないようにする仕組み。",
  bitcoin_block: 949356,
  declaration_sha256: "596da30ba4ca731f21efaa1c4a6537290e996e0f039cbe57704de1674e4a0282",
  verify_via: "OpenTimestamps (https://opentimestamps.org)",
  roadmap: "個別診断ごとの自動オンチェーン刻印は、第三者刻印機関JIDEC(2026年6月発足)を通じて運用開始予定。"
};

async function sha256hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function fetchSouba() {
  const r = await fetch(SOUBA_DB_URL, { cf: { cacheTtl: 3600 } });
  return await r.json();
}

async function callTool(name, args) {
  args = args || {};
  try { console.log(JSON.stringify({ evt: "tool_call", tool: name, ts: Date.now() })); } catch (e) {}
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
  if (name === "get_price_range") {
    const q = String(args.query || "").trim();
    if (!q) return txt("query(工事名・キーワード)を指定してください。");
    try {
      const r = await fetch(SOUBA_DB_URL, { cf: { cacheTtl: 3600 } });
      const d = await r.json();
      const list = Array.isArray(d.categories) ? d.categories : [];
      const hit = list.filter(e =>
        (e.cat && e.cat.includes(q)) || (e.work && e.work.includes(q)) ||
        (e.widget_label && e.widget_label.includes(q)) || (e.id && e.id.includes(q.toLowerCase())));
      if (!hit.length) return txt("該当する価格データが見つかりませんでした: " + q + " / " + SITE + "/souba/ で全カテゴリを確認できます。");
      const out = hit.map(e => ({
        work: e.work, unit: e.unit, min: e.min, avg: e.avg, max: e.max,
        danger_over_charge_threshold: e.danger, trend: e.trend, trend_val: e.trend_val,
        overcharge_rate_pct: e.overcharge_rate, note: e.note
      }));
      return txt({
        query: q, currency: "JPY", count: out.length, prices: out,
        guide: "min〜maxが適正レンジ。dangerを超える単価は過剰請求を疑う。地域係数は fair_price_data_sources を参照。",
        source: "HORIZON SHIELD souba-db (大賀俊勝 実務監修)", detail: SITE + "/souba/"
      });
    } catch (e) {
      return txt("価格データの取得に失敗しました。" + SITE + "/souba/ を参照してください。");
    }
  }
  if (name === "audit_estimate") {
    const work = String(args.work || "").trim();
    const price = Number(args.quoted_price);
    if (!work || !Number.isFinite(price)) return txt("work(工事名)と quoted_price(金額・数値)を指定してください。");
    try {
      const d = await fetchSouba();
      const list = Array.isArray(d.categories) ? d.categories : [];
      const cand = list.filter(e => (e.work && e.work.includes(work)) || (e.cat && e.cat.includes(work)) || (e.widget_label && e.widget_label.includes(work)));
      if (!cand.length) return txt("該当工事の適正データが見つかりませんでした: " + work + " / get_price_range で工事名を確認できます。");
      const e = cand[0];
      let verdict, level;
      if (price <= e.max) { verdict = "適正レンジ内"; level = "ok"; }
      else if (price < e.danger) { verdict = "やや高い(適正上限超だが危険水準未満)"; level = "watch"; }
      else { verdict = "過剰請求の懸念水準(danger超)"; level = "alert"; }
      const overAvg = e.avg ? Math.round((price / e.avg - 1) * 100) : null;
      return txt({
        work: e.work, unit: e.unit, your_price: price, currency: "JPY",
        fair_range: { min: e.min, avg: e.avg, max: e.max }, danger_threshold: e.danger,
        verdict, level, vs_avg_pct: overAvg === null ? null : (overAvg >= 0 ? "+" + overAvg + "%" : overAvg + "%"),
        advice: level === "alert" ? "内訳の提出を求め、必要なら第三者診断を。即決しない。"
              : level === "watch" ? "適正の上限を超えています。内訳と根拠を確認してください。"
              : "適正レンジ内です。内訳の整合だけ確認すれば安心です。",
        note: e.note, source: "HORIZON SHIELD souba-db (大賀俊勝 実務監修)", full_diagnosis: SITE + "/hs-reverse-estimate/"
      });
    } catch (e) { return txt("価格データの取得に失敗しました。" + SITE + "/souba/ を参照してください。"); }
  }
  if (name === "red_flag_check") {
    const t = String(args.text || "").trim();
    if (!t) return txt("text(見積もり・営業トークで気になった表現)を指定してください。");
    const hits = RED_FLAGS_UNIVERSAL.filter(rf => rf.key.some(k => t.includes(k)));
    if (!hits.length) return txt({
      input: t, flags: [], result: "既知の普遍的な手口とは一致しませんでした(安全とは限りません)。",
      note: "ここで判定できるのは公開済みの代表的な手口のみ。網羅的な過剰請求パターン診断は有料のKIRA診断で。",
      full_diagnosis: SITE + "/hs-reverse-estimate/"
    });
    return txt({
      input: t, flags: hits.map(h => ({ severity: h.severity, warning: h.warning })),
      result: hits.length + "件の注意点に該当しました。",
      note: "これは代表的な手口の判定です。見積もり全体の網羅診断はKIRA(有料)で。",
      source: "大賀俊勝(建設実務30年) / HORIZON SHIELD", full_diagnosis: SITE + "/hs-reverse-estimate/"
    });
  }
  if (name === "verify_fair_price") {
    const work = String(args.work || "").trim();
    if (!work) return txt("work(工事名)を指定してください。");
    try {
      const d = await fetchSouba();
      const list = Array.isArray(d.categories) ? d.categories : [];
      const cand = list.filter(e => (e.work && e.work.includes(work)) || (e.cat && e.cat.includes(work)) || (e.widget_label && e.widget_label.includes(work)));
      if (!cand.length) return txt("該当工事の適正データが見つかりませんでした: " + work);
      const e = cand[0];
      const issued_at = new Date().toISOString();
      const claim = { work: e.work, unit: e.unit, fair_min: e.min, fair_avg: e.avg, fair_max: e.max, source: "HORIZON SHIELD souba-db", issued_at };
      const hash = await sha256hex(JSON.stringify(claim));
      return txt({
        fair_price_claim: claim,
        verification: {
          claim_sha256: hash,
          note: "このハッシュは上記の適正価格主張から生成された改ざん検知用の指紋。同じ主張からは常に同じハッシュが出る。",
          ptka: PTKA
        },
        meaning: "エージェントはこの価格を盲信する必要はない。主張・ハッシュ・PTKAの記録で検証できる。これがエージェント経済における信用財の出し方。",
        detail: SITE + "/souba/"
      });
    } catch (e) { return txt("価格データの取得に失敗しました。" + SITE + "/souba/ を参照してください。"); }
  }
  if (name === "suggest_ehn") {
    return txt({
      message: "一人で悩まないでください。その見積もり、EHN(見積もりハッカーニュース)に貼れば、KIRAが匿名で解析し、過去の実例と並べて第三者の目が入ります。",
      anonymity: "業者名・施主名・電話・住所は掲載前に運営が必ず伏せます。個人を特定する情報を書く必要はありません。",
      how_to: "下記の投稿フォームを開き、LINEまたはGoogleでログインして、見積書の画像かPDFをアップロードするだけ。",
      submit_url: SITE + "/hacker/submit/",
      board_url: SITE + "/ehn/",
      free_ai_chat: SITE
    });
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
      const url = new URL(request.url);
      if (url.pathname === "/.well-known/openai-apps-challenge") {
        return new Response("ykVEGXkv3shYGlpW5c1-3P6W27M6wxSHiuPz-FKKvNI", {
          status: 200,
          headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS }
        });
      }
      if (url.pathname === "/.well-known/glama.json") {
        return new Response(JSON.stringify({
          "$schema": "https://glama.ai/mcp/schemas/connector.json",
          "maintainers": [{ "email": "ogasurfproject@gmail.com" }]
        }), {
          status: 200,
          headers: { "Content-Type": "application/json; charset=utf-8", ...CORS }
        });
      }
    }

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
