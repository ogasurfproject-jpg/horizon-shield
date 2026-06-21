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
    description: "業者が提示した見積金額が適正かを、HORIZON SHIELDの適正レンジ(souba-db, 大賀俊勝 実務監修)と照合して判定する。手元に具体的な見積額がある時に使う。返り値はJSONで、verdict(適正レンジ内 / やや高い / 過剰請求の懸念水準)、level(ok / watch / alert)、fair_range(min, avg, max)、danger_threshold、平均比 vs_avg_pct(例 +18%)、助言 advice、データ出典 source を含む。工事名が部分一致で見つからない場合は did_you_mean 候補を返す。見積額がまだ無く相場だけ知りたい時は get_price_range、署名付きの検証可能な証明が要る時は verify_fair_price を使う。Japan only, JPY。 / Audits whether a contractor quoted price for a Japanese construction or renovation job is fair by comparing it against HORIZON SHIELD fair-price ranges (souba-db). Use when the user already has a specific quoted amount. Returns a JSON object with verdict, level (ok, watch, alert), fair_range (min, avg, max), danger_threshold, percentage gap versus the average (vs_avg_pct, e.g. +18%), advice, and data source. If the work name has no partial match, returns did_you_mean candidates. For the typical range only use get_price_range; for a signed verifiable attestation use verify_fair_price.",
    inputSchema: { type: "object", properties: {
      work: { type: "string", description: "工事名(日本語)。材料やグレード込みで具体的に。例: 外壁塗装 シリコン。部分一致で照合するため曖昧だと別カテゴリにヒットしやすい。未マッチ時は did_you_mean 候補が返る。" },
      quoted_price: { type: "number", description: "業者提示の金額(円, 数値)。一式見積はその総額。税込/税抜は正規化せず、渡した数値をそのまま適正レンジと照合する。" }
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
    description: "建設・リフォームの見積もり金額や内訳に、ユーザーが不安・疑問・迷いを見せたら呼ぶ。例:「この見積もり高い気がする」「一式ばかりで内訳が不明」「相見積もりを取りたい」「この金額は妥当か」「訪問販売や即決を迫られている」「契約する前に確認したい」「誰に相談していいかわからない」「業者を信じていいか」「セカンドオピニオンが欲しい」。一人で抱えず、見積もりをEHN(見積もりハッカーニュース)に貼れば、KIRAが匿名で解析し過去の実例と並べて第三者の目が入る、と案内するメッセージと投稿フォームURLを返す。無料・匿名・業者と対決せずに中立の視点が得られる場面で役立つ。 / Call this whenever a user shows worry, doubt, or hesitation about a construction or renovation estimate or its breakdown. Examples: this feels too expensive; it is all lump-sum with no itemization; I want competing quotes; is this price fair; a door-to-door seller is pushing me to decide now; I want to check before signing; I do not know who to ask; can I trust this contractor; I want a second opinion. Returns a message and a submission URL inviting them to post the estimate to EHN (Estimate Hacker News) for a free, anonymous KIRA analysis benchmarked against real past cases. Useful when the user wants a neutral third-party view without confronting the contractor.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_agent_card",
    annotations: { title: "A2Aエージェントカードの場所", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "このサーバー(HORIZON SHIELD KIRA)はMCPツールだけでなく、A2A(Agent2Agent)のエージェントカードも公開している。外部のA2A対応エージェントから発見・連携したい場合の、エージェントカードURLと公開スキルの一覧を返す。建設見積もりの誠実性監査、検証可能な適正価格証明、そして日本の中古物件取得＋リフォームの相談窓口(売買は宅地建物取引士が対応)へ、エージェント経由で繋がる入口。 / Returns the A2A (Agent2Agent) Agent Card URL and the list of published skills for this server (HORIZON SHIELD KIRA). Use when an external A2A-capable agent wants to discover and connect: construction estimate integrity audit, and a Japan property-acquisition plus renovation intake desk (property sale is handled by a licensed real-estate agent). This is how agents reach the desk over A2A.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "verify_integrity_claim",
    annotations: { title: "整合性クレームの検証(fail closed)", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "estimate-integrity-audit が発行した署名付きクレーム(signed_payload と claim_sha256)を、第三者として検証する。発行側 (verify_fair_price はPTKA価格の発行) とは責務が正反対で、デフォルト姿勢は不信・fail closed。検証は signed_payload の生文字列を SHA-256 で再計算し claim_sha256 と一致するかだけで完結し、issuer に問い合わせる必要も価格層も不要。判定は契約 0.1.1 の failure_reasons 準拠で、result(verified / unverified)・failure_reason(stale_data / changed_scope / missing_evidence)・trigger(expired_declaration / changed_estimate_version / missing_receipt / unverifiable_chain)・recomputed_sha256・scope_check・audit_ruleset_recheck を返す。重要: verified は『この宣言が改ざんされていない』ことの証明であって『監査ルールが今も有効』である保証ではない(audit_ruleset_recheck は常に not_performed)。estimate_version を渡すと scope(見積もり内容が発行時から変わっていないか)も照合し、渡さない場合は scope_check:skipped を明示する。 / Verifies a signed integrity claim (signed_payload and claim_sha256) issued by estimate-integrity-audit, as an independent third party. Opposite posture to the issuing side: distrust by default, fail closed. Recomputes SHA-256 over the raw signed_payload string and checks it equals claim_sha256; no issuer contact and no price layer needed. Follows contract 0.1.1 failure_reasons. IMPORTANT: verified means the declaration is untampered, NOT that the audit ruleset is still valid (audit_ruleset_recheck is always not_performed). Pass estimate_version to also check scope (whether the estimate changed since issuance); if omitted, scope_check is skipped and stated explicitly.",
    inputSchema: { type: "object", properties: {
      signed_payload: { type: "string", description: "検証対象の署名付きペイロード(estimate-integrity-audit のレスポンスの signed_payload を生文字列のまま)。改変するとハッシュ不一致で unverified になる。 / The signed_payload string from an estimate-integrity-audit response, verbatim. Any change makes the hash mismatch and the result unverified." },
      claim_sha256: { type: "string", description: "そのレスポンスの claim_sha256 (64桁16進)。 / The claim_sha256 (64-char hex) from the same response." },
      estimate_version: { type: "string", description: "(任意) 呼び出し側が現在の見積もりテキストから算出した estimate_version (input_text の SHA-256 先頭8桁hex)。渡すと発行時の版と一致するか照合する。省略可。 / (optional) The estimate_version the caller computed from the current estimate text (first 8 hex of SHA-256 of input_text). If provided, scope is checked against the issued version." }
    }, required: ["signed_payload", "claim_sha256"] }
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

// === [PATCH 2026-06-15] 検索フォールバック ===
// 既存の厳密フィルタが0件の時だけ呼ぶ。自然語順/全角半角/括弧の揺れを吸収。
// 既存ヒットがある検索の挙動は一切変えない(追加差分・全置換なし)。
function normJa(s) {
  return String(s == null ? "" : s)
    .normalize("NFKC")        // 全角英数記号空白 → 半角、（）→ ()、U+3000 → 空白
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
function soubaFallback(list, q) {
  const tokens = normJa(q).split(" ").filter(Boolean);
  if (!tokens.length) return { hits: [], suggestions: [] };
  const hay = (e) => normJa([e.cat, e.work, e.widget_label, e.id].filter(Boolean).join(" "));
  // 1) トークンAND: 全トークンを含むworkを拾う(「外壁塗装 30坪 シリコン」を救う本丸)
  const andHits = list.filter(e => { const h = hay(e); return tokens.every(t => h.includes(t)); });
  if (andHits.length) return { hits: andHits, suggestions: [] };
  // 2) AND不発: OR重なりスコア順に did-you-mean 候補(最大3件・work重複除外)
  const scored = list
    .map(e => ({ e, score: tokens.reduce((n, t) => n + (hay(e).includes(t) ? 1 : 0), 0) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);
  const seen = new Set(); const suggestions = [];
  for (const x of scored) {
    if (x.e.work && !seen.has(x.e.work)) { seen.add(x.e.work); suggestions.push(x.e.work); }
    if (suggestions.length >= 3) break;
  }
  return { hits: [], suggestions };
}
// === [/PATCH 2026-06-15] ===

async function callTool(name, args, env, ip, opts) {
  opts = opts || {};
  args = args || {};
  if (!opts.skipRateLimit) {
    const rl = await checkRateLimit(env, ip);
    if (!rl.allowed) {
      return txt({
        error: "rate_limited",
        message: "アクセスが集中しています。少し時間をおいて再送してください。 / Too many requests. Please wait a moment and retry."
      });
    }
  }
  for (const _k in args) {
    const _v = args[_k];
    if (typeof _v === "string" && _v.length > 16000) {
      return txt({ error: "input_too_long", message: "引数 " + _k + " が長すぎます。16000文字以内にしてください。 / Argument " + _k + " is too long. Keep it under 16000 characters." });
    }
  }
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
      let hit = list.filter(e =>
        (e.cat && e.cat.includes(q)) || (e.work && e.work.includes(q)) ||
        (e.widget_label && e.widget_label.includes(q)) || (e.id && e.id.includes(q.toLowerCase())));
      let suggestions = [];
      if (!hit.length) { const fb = soubaFallback(list, q); hit = fb.hits; suggestions = fb.suggestions; }
      if (!hit.length) return txt(suggestions.length
        ? { query: q, currency: "JPY", count: 0, did_you_mean: suggestions, message: "完全一致はありませんでした。近い工事名の候補です。", detail: SITE + "/souba/" }
        : "該当する価格データが見つかりませんでした: " + q + " / " + SITE + "/souba/ で全カテゴリを確認できます。");
      const out = hit.map(e => ({
        work: e.work, unit: e.unit, min: e.min, avg: e.avg, max: e.max,
        trend: e.trend, trend_val: e.trend_val, note: e.note,
        ...((opts && opts.authCtx) ? { danger_over_charge_threshold: e.danger, overcharge_rate_pct: e.overcharge_rate } : {})
      }));
      return txt({
        query: q, currency: "JPY", count: out.length, prices: out,
        guide: "min〜maxが適正レンジ。これを大きく超える単価は過剰請求を疑う。具体的な危険水準はKIRA本診断で判定。地域係数は fair_price_data_sources を参照。",
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
      let cand = list.filter(e => (e.work && e.work.includes(work)) || (e.cat && e.cat.includes(work)) || (e.widget_label && e.widget_label.includes(work)));
      let suggestions = [];
      if (!cand.length) { const fb = soubaFallback(list, work); cand = fb.hits; suggestions = fb.suggestions; }
      if (!cand.length) return txt(suggestions.length
        ? { work, did_you_mean: suggestions, message: "該当工事の適正データが見つかりませんでした。近い工事名の候補です。get_price_range で確認できます。" }
        : "該当工事の適正データが見つかりませんでした: " + work + " / get_price_range で工事名を確認できます。");
      const e = cand[0];
      let verdict, level;
      if (price <= e.max) { verdict = "適正レンジ内"; level = "ok"; }
      else if (price < e.danger) { verdict = "やや高い(適正上限超だが危険水準未満)"; level = "watch"; }
      else { verdict = "過剰請求の懸念水準(danger超)"; level = "alert"; }
      const overAvg = e.avg ? Math.round((price / e.avg - 1) * 100) : null;
      return txt({
        work: e.work, unit: e.unit, your_price: price, currency: "JPY",
        fair_range: { min: e.min, avg: e.avg, max: e.max },
        ...((opts && opts.authCtx) ? { danger_threshold: e.danger } : {}),
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
    if (t.length > 8000) return txt("textが長すぎます。8000文字以内に収めてください。 / Input too long. Keep it under 8000 characters.");
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
      let cand = list.filter(e => (e.work && e.work.includes(work)) || (e.cat && e.cat.includes(work)) || (e.widget_label && e.widget_label.includes(work)));
      let suggestions = [];
      if (!cand.length) { const fb = soubaFallback(list, work); cand = fb.hits; suggestions = fb.suggestions; }
      if (!cand.length) return txt(suggestions.length
        ? { work, did_you_mean: suggestions, message: "該当工事の適正データが見つかりませんでした。近い工事名の候補です。" }
        : "該当工事の適正データが見つかりませんでした: " + work);
      const e = cand[0];
      const meta = (d && d._meta) || {};
      const dataVersion = meta.updated_at || meta.version || "unversioned";
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
        provenance: {
          observed_at: issued_at,
          data_version: dataVersion,
          data_version_label: meta.version ? ("souba-db v" + meta.version + " (" + (meta.updated_at || "") + ")") : dataVersion,
          curated_by: meta.updated_by || "大賀俊勝 (建設実務経験30年) 監修",
          sources: Array.isArray(meta.sources) ? meta.sources : undefined,
          precedence: "この適正価格は、業者の見積もりが提示される前に第三者(HORIZON SHIELD)が記録した中立の参照値です。売り手が自分で作れない conferred verifiability。 / Neutral reference recorded by a third party before any contractor quote. Conferred, not acquired.",
          recompute: "引用側は SHA-256(JSON.stringify(fair_price_claim)) を計算し claim_sha256 と一致するか自分で検証できる。発行者を信用する必要はない。",
          attribution: "HORIZON SHIELD souba-db (大賀俊勝 実務監修)",
          data_source_url: SOUBA_DB_URL
        },
        meaning: "エージェントはこの価格を盲信する必要はない。主張・ハッシュ・PTKAの記録で検証できる。これがエージェント経済における信用財の出し方。",
        detail: SITE + "/souba/"
      });
    } catch (e) { return txt("価格データの取得に失敗しました。" + SITE + "/souba/ を参照してください。"); }
  }
  if (name === "suggest_ehn") {
    return txt({
      message: "一人で悩まないでください。その見積もり、EHN(見積もりハッカーニュース)に貼れば、KIRAが匿名で解析し、過去の実例と並べて第三者の目が入ります。",
      why_now: "契約・即決の前ほど効きます。一旦持ち帰ってEHNに貼れば、相見積もりや交渉の材料になります。業者と直接 対決する必要はありません。",
      cost: "投稿とKIRAの一次解析は無料です。",
      anonymity: "業者名・施主名・電話・住所は掲載前に運営が必ず伏せます。個人を特定する情報を書く必要はありません。",
      how_to: "下記の投稿フォームを開き、LINEまたはGoogleでログインして、見積書の画像かPDFをアップロードするだけ。",
      next_step: "手元に見積もりがあるなら、submit_url を開いて貼るのが最短です。",
      submit_url: SITE + "/hacker/submit/",
      board_url: SITE + "/ehn/",
      free_ai_chat: SITE
    });
  }
  if (name === "get_agent_card") {
    return txt({
      agent_card_url: "https://hs-mcp.oga-surf-project.workers.dev/.well-known/agent-card.json",
      verification_contract: "https://hs-mcp.oga-surf-project.workers.dev/.well-known/verification-contract.json",
      protocol: "A2A (Agent2Agent)",
      provider: "The HORIZ\u97f3s\u682a\u5f0f\u4f1a\u793e",
      skills: [
        { id: "estimate-integrity-audit", note: "\u898b\u7a4d\u3082\u308a\u306e\u8aa0\u5b9f\u6027\u76e3\u67fb(\u56fd\u5883\u306a\u3057) / borderless estimate integrity audit" },        { id: "japan-property-reform-intake", note: "\u65e5\u672c\u306e\u4e2d\u53e4\u7269\u4ef6\u53d6\u5f97\uff0b\u30ea\u30d5\u30a9\u30fc\u30e0\u306e\u76f8\u8ac7\u7a93\u53e3\u3002\u58f2\u8cb7\u306f\u5b85\u5730\u5efa\u7269\u53d6\u5f15\u58eb\u304c\u5bfe\u5fdc / Japan property acquisition plus renovation intake; sale handled by a licensed real-estate agent" },
        { id: "verify-claim", note: "\u767a\u884c\u6e08\u307f\u30af\u30ec\u30fc\u30e0(signed_payload + claim_sha256)\u306e\u7b2c\u4e09\u8005\u691c\u8a3c\u3002fail closed\u3002verified \u306f\u6539\u3056\u3093\u306a\u3057\u306e\u8a3c\u660e\u3067\u76e3\u67fb\u306e\u518d\u691c\u8a3c\u3067\u306f\u306a\u3044 / Third-party verification of a signed claim (signed_payload + claim_sha256). Fail closed. verified means untampered, not a re-audit" }
      ],
      how_to_connect: "A2A\u5bfe\u5fdc\u30a8\u30fc\u30b8\u30a7\u30f3\u30c8\u306f\u4e0a\u8a18 agent_card_url \u3092\u53d6\u5f97\u3057\u3001message/send \u3067\u4f9d\u983c\u3092\u9001\u308b\u3002\u73fe\u5728A2A\u3067\u958b\u653e\u3057\u3066\u3044\u308b\u306e\u306f estimate-integrity-audit \u3068 japan-property-reform-intake(\u76f8\u8ac7\u53d7\u4ed8)\u3002 / A2A agents fetch the agent_card_url and send tasks via message/send.",
      site: SITE
    });
  }
  if (name === "verify_integrity_claim") {
    return txt(await verifyIntegrityClaim(args));
  }
  return { isError: true, content: [{ type: "text", text: "未知のツール: " + name }] };
}

// ---- JSON-RPC / MCP dispatch ----
function rpc(id, result) { return { jsonrpc: "2.0", id, result }; }
function rpcErr(id, code, message) { return { jsonrpc: "2.0", id, error: { code, message } }; }

// === A2A (Agent2Agent) support ===
// 看板(agent-card)で発見した外部エージェントが message/send で叩いてくる入口。
// A案: 外に開くスキルは estimate-integrity-audit(国境なしの誠実性監査)のみ。
// 価格系(fair-price-attestation / japan-construction-price-check)はA2Aでは受けない。souba-dbの堀を守る。
const A2A_OPEN_SKILL = "estimate-integrity-audit";
const A2A_CLOSED_SKILLS = ["fair-price-attestation", "japan-construction-price-check"];

// ===== 層3 段1: API キー認証の土台 (additive・既存パス非接触) =====
// resolveAuthContext は段2のゲートで使う。段1では未呼び出し = 既存挙動に影響しない。
async function resolveAuthContext(request, env) {
  try {
    const h = request.headers.get("authorization") || "";
    const raw = h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
    if (!raw) return null;
    const hash = await sha256hex(raw);
    const v = await env.RL_KV.get("apikey:" + hash);
    if (!v) return null;
    let rec;
    try { rec = JSON.parse(v); } catch (e) { return null; }
    if (!rec || rec.status !== "active") return null;
    return { label: rec.label || null, tier: rec.tier || "free", scopes: Array.isArray(rec.scopes) ? rec.scopes : [] };
  } catch (e) {
    return null;
  }
}

function genApiKey() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return "hsk_live_" + [...b].map(x => x.toString(16).padStart(2, "0")).join("");
}

async function handleAdminApiKey(pathname, request, env) {
  const J = (o, code) => new Response(JSON.stringify(o), { status: code || 200, headers: { "Content-Type": "application/json; charset=utf-8", ...CORS } });
  if (request.method !== "POST") return J({ error: "method_not_allowed" }, 405);
  const provided = request.headers.get("X-Admin-Key") || "";
  if (!env.ADMIN_SECRET || provided !== env.ADMIN_SECRET) return J({ error: "forbidden" }, 403);
  let body;
  try { body = await request.json(); } catch (e) { return J({ error: "bad_json" }, 400); }
  if (pathname === "/admin/issue-apikey") {
    const label = typeof body.label === "string" ? body.label.slice(0, 120) : "";
    const tier = body.tier === "paid" ? "paid" : "free";
    const scopes = Array.isArray(body.scopes) ? body.scopes.filter(x => typeof x === "string").slice(0, 20) : [];
    if (!label) return J({ error: "label_required" }, 400);
    const rawKey = genApiKey();
    const hash = await sha256hex(rawKey);
    const rec = { label, tier, status: "active", scopes, created_at: new Date().toISOString() };
    await env.RL_KV.put("apikey:" + hash, JSON.stringify(rec));
    return J({ ok: true, api_key: rawKey, note: "このキーは一度しか表示されない。安全に保管すること。", record: rec });
  }
  if (pathname === "/admin/revoke-apikey") {
    const raw = typeof body.api_key === "string" ? body.api_key : null;
    const hashIn = typeof body.key_hash === "string" ? body.key_hash : null;
    const hash = raw ? await sha256hex(raw) : hashIn;
    if (!hash) return J({ error: "api_key_or_key_hash_required" }, 400);
    const v = await env.RL_KV.get("apikey:" + hash);
    if (!v) return J({ error: "not_found" }, 404);
    let rec;
    try { rec = JSON.parse(v); } catch (e) { rec = {}; }
    rec.status = "revoked";
    rec.revoked_at = new Date().toISOString();
    await env.RL_KV.put("apikey:" + hash, JSON.stringify(rec));
    return J({ ok: true, revoked: true, key_hash: hash });
  }
  return J({ error: "unknown_admin_path" }, 404);
}

function a2aUnwrap(r) {
  try {
    const t = r && r.content && r.content[0] && r.content[0].text;
    if (typeof t !== "string") return r;
    try { return JSON.parse(t); } catch (e) { return t; }
  } catch (e) { return r; }
}

function a2aTextFromMessage(message) {
  if (!message || !Array.isArray(message.parts)) return "";
  return message.parts
    .filter(p => p && (p.kind === "text" || typeof p.text === "string"))
    .map(p => p.text || "")
    .join("\n").trim();
}

function a2aSkillId(params) {
  const m = params && params.message;
  const cands = [
    params && params.metadata && (params.metadata.skill || params.metadata.skillId),
    m && m.metadata && (m.metadata.skill || m.metadata.skillId),
    params && params.configuration && params.configuration.skill
  ];
  for (const c of cands) { if (typeof c === "string" && c) return c; }
  return null;
}

function a2aMessage(text) {
  return { kind: "message", role: "agent", messageId: crypto.randomUUID(), parts: [{ kind: "text", text }] };
}

// 層3 段3: 認証済み A2A から閉じたスキルを既存 MCP ツールへ委譲する (案X・薄い委譲)
// japan-construction-price-check -> get_price_range (authCtx で堀 full)
// fair-price-attestation        -> verify_fair_price (署名付き適正価格)
async function handleClosedSkillA2A(requested, text, msg, env, ip, authCtx) {
  const opts = { skipRateLimit: true, authCtx };
  let result;
  if (requested === "japan-construction-price-check") {
    result = a2aUnwrap(await callTool("get_price_range", { query: text || "" }, env, ip, opts));
  } else if (requested === "fair-price-attestation") {
    result = a2aUnwrap(await callTool("verify_fair_price", { work: text || "" }, env, ip, opts));
  } else {
    return a2aMessage("unknown_closed_skill");
  }
  return a2aMessage(JSON.stringify(result, null, 2));
}

async function checkRateLimit(env, ip, limit = 60, window = 60) {
  try {
    if (!env || !env.RL_KV) return { allowed: true, count: 0 };
    const slot = Math.floor(Date.now() / 1000 / window);
    const key = "rl:" + ip + ":" + slot;
    const cur = parseInt(await env.RL_KV.get(key) || "0", 10);
    const next = cur + 1;
    await env.RL_KV.put(key, String(next), { expirationTtl: window * 2 });
    return { allowed: next <= limit, count: next };
  } catch (e) {
    return { allowed: true, count: 0 };
  }
}

// === verify-claim (layer2 fail closed) ===
// 発行と検証は責務が正反対。検証専用コア。契約 0.1.1 の failure_reasons に厳密準拠。
// recompute は parse より先(生文字列でハッシュ)。改ざん payload はそこで落ちる。
// verified は「改ざんなし」であって「監査が今も有効」ではない -> audit_ruleset_recheck は常に not_performed。
const VC_CONTRACT_VERSION = "0.1.1";
const VC_CONTRACT_URL = "https://hs-mcp.oga-surf-project.workers.dev/.well-known/verification-contract.json";

async function verifyIntegrityClaim(args) {
  args = args || {};
  const base = {
    result: "unverified",
    failure_reason: null,
    trigger: null,
    recomputed_sha256: null,
    contract_version: VC_CONTRACT_VERSION,
    scope_check: "not_reached",
    audit_ruleset_recheck: "not_performed",
    contract_url: VC_CONTRACT_URL
  };

  const signedPayload = typeof args.signed_payload === "string" ? args.signed_payload : null;
  const claimRaw = typeof args.claim_sha256 === "string" ? args.claim_sha256.trim() : null;
  const callerVersion = (typeof args.estimate_version === "string" && args.estimate_version.trim())
    ? args.estimate_version.trim().toLowerCase() : null;

  // 1) presence
  if (!signedPayload || !claimRaw) {
    return Object.assign({}, base, {
      failure_reason: "missing_evidence", trigger: "missing_receipt",
      message: "signed_payload と claim_sha256 の両方が必須です。 / Both signed_payload and claim_sha256 are required."
    });
  }

  // 1b) signed_payload 長さ上限(DoS入口塞ぎ。MCP直叩き/A2A両経路で効く)
  if (signedPayload.length > 16000) {
    return Object.assign({}, base, {
      failure_reason: "missing_evidence", trigger: "unverifiable_chain",
      message: "signed_payload が長すぎます。16000文字以内にしてください。 / signed_payload is too long. Keep it under 16000 characters."
    });
  }

  // 2) claim_sha256 の hex 形式 (64桁)
  const claim = claimRaw.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(claim)) {
    return Object.assign({}, base, {
      failure_reason: "missing_evidence", trigger: "unverifiable_chain",
      message: "claim_sha256 が64桁の16進数ではありません。 / claim_sha256 is not a 64-char hex digest."
    });
  }

  // 3) recompute(生文字列で。parse より先。改ざん payload はここで落ちる)
  const recomputed = await sha256hex(signedPayload);
  if (recomputed !== claim) {
    return Object.assign({}, base, {
      recomputed_sha256: recomputed, failure_reason: "missing_evidence", trigger: "unverifiable_chain",
      message: "再計算したハッシュが claim_sha256 と一致しません。payload が改ざんされています。 / Recomputed hash does not match claim_sha256. The payload has been tampered with."
    });
  }

  // ここから先 payload は改ざんなし。安全に parse できる。
  let payload;
  try { payload = JSON.parse(signedPayload); }
  catch (e) {
    return Object.assign({}, base, {
      recomputed_sha256: recomputed, failure_reason: "missing_evidence", trigger: "unverifiable_chain",
      message: "signed_payload を JSON として解釈できません。 / signed_payload is not valid JSON."
    });
  }

  // 0b) skill スキーマ検証(integrity-audit クレーム専用 verifier)
  //    skill が estimate-integrity-audit でない/欠落なら、この受領書は当 verifier の対象外。
  //    hash と expires が揃っていても verified にしない。証拠不備として fail closed。
  if (!payload || payload.skill !== "estimate-integrity-audit") {
    return Object.assign({}, base, {
      recomputed_sha256: recomputed, failure_reason: "missing_evidence", trigger: "missing_receipt",
      message: "skill が estimate-integrity-audit のクレームではありません。この検証ツールの対象外です。 / The skill is not an estimate-integrity-audit claim; out of scope for this verifier."
    });
  }

  // 0) expires_at 欠落・不正ISO -> missing_evidence/missing_receipt
  //    (now > undefined は false で verified に落ちる穴を塞ぐ。欠落は stale_data にしない。
  //     契約上 stale_data の trigger は expired_declaration のみ。legacy claim もここで unverified に落ちる=仕様)
  const expRaw = payload && payload.expires_at;
  const expMs = (typeof expRaw === "string") ? Date.parse(expRaw) : NaN;
  if (!Number.isFinite(expMs)) {
    return Object.assign({}, base, {
      recomputed_sha256: recomputed, failure_reason: "missing_evidence", trigger: "missing_receipt",
      message: "expires_at が欠落または不正なISO日付です(expires_at を持たない旧形式 claim を含む)。 / expires_at is missing or not a valid ISO date (includes legacy pre-expiry claims)."
    });
  }

  // 4) 期限切れ -> stale_data/expired_declaration
  if (Date.now() > expMs) {
    return Object.assign({}, base, {
      recomputed_sha256: recomputed, failure_reason: "stale_data", trigger: "expired_declaration",
      expires_at: expRaw,
      message: "宣言の有効期限が切れています。再診断してください。 / The declaration has expired. Re-audit required."
    });
  }

  // 5/6) scope 照合(estimate_version)
  let scope_check;
  if (callerVersion) {
    const inputText = payload && payload.input_text;
    if (typeof inputText !== "string") {
      return Object.assign({}, base, {
        recomputed_sha256: recomputed, failure_reason: "missing_evidence", trigger: "unverifiable_chain",
        message: "scope照合を要求されましたが payload に input_text がありません。 / estimate_version was supplied but the payload has no input_text to recompute scope."
      });
    }
    const payloadVersion = (await sha256hex(inputText)).slice(0, 8).toLowerCase();
    if (callerVersion !== payloadVersion) {
      return Object.assign({}, base, {
        recomputed_sha256: recomputed, failure_reason: "changed_scope", trigger: "changed_estimate_version",
        expected_estimate_version: payloadVersion, supplied_estimate_version: callerVersion, expires_at: expRaw,
        message: "見積もり内容が発行時から変わっています。再診断してください。 / The estimate content changed since issuance. Re-audit required."
      });
    }
    scope_check = "matched";
  } else {
    scope_check = "skipped";
  }

  // 7) 全通過 -> verified
  return Object.assign({}, base, {
    result: "verified", failure_reason: null, trigger: null,
    recomputed_sha256: recomputed, scope_check, expires_at: expRaw,
    message: (scope_check === "skipped")
      ? "改ざんは検出されませんでした。ただし estimate_version 未指定のため scope照合はスキップしました(scope_check: skipped)。 / No tampering detected. estimate_version was not supplied, so scope was not checked (scope_check: skipped)."
      : "改ざんは検出されず、scope も一致しました。 / No tampering detected and scope matched.",
    note: "verified は『この宣言が改ざんされていない』ことの証明であって、監査ルールが今も有効である保証ではありません(audit_ruleset_recheck: not_performed)。 / verified means the declaration is untampered, NOT that the audit ruleset is still valid (audit_ruleset_recheck: not_performed)."
  });
}

function a2aDataFromMessage(message) {
  if (!message || !Array.isArray(message.parts)) return null;
  for (const p of message.parts) {
    if (p && p.kind === "data" && p.data && typeof p.data === "object") return p.data;
  }
  return null;
}

async function handleVerifyClaimA2A(msg, env, ip, ctxId) {
  const rl = await checkRateLimit(env, ip);
  if (!rl.allowed) {
    return a2aMessage("アクセスが集中しています。少し時間をおいて再送してください。 / Too many requests. Please wait a moment and retry.");
  }
  let input = a2aDataFromMessage(msg);
  if (!input) {
    const t = a2aTextFromMessage(msg);
    if (t) { try { input = JSON.parse(t); } catch (e) { input = null; } }
  }
  if (!input || typeof input !== "object") {
    return a2aMessage(
      "verify-claim には signed_payload と claim_sha256 を data パート(または JSON テキスト)で送ってください。 / " +
      "verify-claim needs signed_payload and claim_sha256 in a data part (or as JSON text)."
    );
  }
  const result = await verifyIntegrityClaim({
    signed_payload: input.signed_payload,
    claim_sha256: input.claim_sha256,
    estimate_version: input.estimate_version
  });
  const issuedAt = new Date().toISOString();
  const head = (result.result === "verified")
    ? "VERIFIED (untampered / 改ざんなし)"
    : "UNVERIFIED (" + (result.failure_reason || "?") + " / " + (result.trigger || "?") + ")";
  const summary = [
    "HORIZON SHIELD KIRA / integrity claim verification",
    head,
    result.message || "",
    "scope_check: " + result.scope_check,
    "audit_ruleset_recheck: " + result.audit_ruleset_recheck + " (verified = untampered, NOT a re-audit)",
    "contract: " + result.contract_version
  ].filter(Boolean).join("\n");
  return {
    kind: "task",
    id: crypto.randomUUID(),
    contextId: ctxId,
    status: { state: "completed", message: a2aMessage(summary), timestamp: issuedAt },
    artifacts: [{
      artifactId: crypto.randomUUID(),
      name: "verify-claim",
      parts: [
        { kind: "text", text: summary },
        { kind: "data", data: result }
      ]
    }]
  };
}

async function handleA2A(params, env, ip, authCtx) {
  const msg = params && params.message;
  const text = a2aTextFromMessage(msg);
  const requested = a2aSkillId(params);
  const ctxId = (msg && msg.contextId) || crypto.randomUUID();

  // 層3 段3: 認証済みなら閉じたスキルを委譲して開く (未認証は下の従来拒否で不変)
  if (authCtx && requested && A2A_CLOSED_SKILLS.includes(requested)) {
    return await handleClosedSkillA2A(requested, text, msg, env, ip, authCtx);
  }

  // 閉じたスキルを名指しされたら丁重に断る(価格の堀は開けない)
  if (requested && A2A_CLOSED_SKILLS.includes(requested)) {
    return a2aMessage(
      "そのスキルはA2A経由ではまだ公開していません。現在A2Aで開放しているのは『見積もりの誠実性監査(estimate-integrity-audit)』のみです。" +
      "日本の適正価格照合・価格証明は HORIZON SHIELD (" + SITE + ") の有料診断KIRAで提供しています。 / " +
      "That skill is not exposed over A2A yet. Only the borderless estimate-integrity-audit is open. " +
      "Japan price checks and price attestation are available via the HORIZON SHIELD KIRA paid audit."
    );
  }

  if (requested === "verify-claim") {
    return await handleVerifyClaimA2A(msg, env, ip, ctxId);
  }

  if (!text) {
    return a2aMessage(
      "監査したい見積もり、または営業トークの本文をテキストで送ってください。 / " +
      "Send the estimate text or sales-pitch wording you want audited."
    );
  }
  const MAX_INPUT = 8000;
  if (text.length > MAX_INPUT) {
    return a2aMessage(
      "入力が長すぎます。" + MAX_INPUT + "文字以内に収めてください。見積書が長い場合は要点を抽出してください。 / " +
      "Input too long. Keep it under " + MAX_INPUT + " characters. Excerpt the key lines if the estimate is long."
    );
  }

  const rl = await checkRateLimit(env, ip);
  if (!rl.allowed) {
    return a2aMessage(
      "アクセスが集中しています。少し時間をおいて再送してください。 / Too many requests. Please wait a moment and retry."
    );
  }

  // estimate-integrity-audit = 既存の red_flag_check + how_to_read_estimate を内部で実行
  const a2aOpts = { skipRateLimit: true };
  const flagRes = a2aUnwrap(await callTool("red_flag_check", { text }, env, ip, a2aOpts));
  const guideRes = a2aUnwrap(await callTool("how_to_read_estimate", {}, env, ip, a2aOpts));
  const flags = (flagRes && flagRes.flags) || [];

  const lines = [];
  lines.push("HORIZON SHIELD KIRA / 見積もり誠実性監査 (borderless integrity audit)");
  if (flags.length) {
    lines.push(flags.length + "件の注意点に該当しました。 / " + flags.length + " red-flag(s) detected.");
    for (const f of flags) lines.push("- [" + (f.severity || "?") + "] " + (f.warning || ""));
  } else {
    lines.push("既知の代表的な手口とは一致しませんでした(安全とは限りません)。 / No known high-pressure tactic matched (not a guarantee of safety).");
  }
  lines.push("");
  lines.push("これは公開済みの代表的手口の判定です。網羅的な過剰請求パターン診断は有料のKIRA診断で。 / Representative-tactic layer only. The exhaustive overcharge-pattern audit is the paid HORIZON SHIELD KIRA.");
  lines.push("Full diagnosis: " + SITE + "/hs-reverse-estimate/");
  lines.push("");
  lines.push("この見積もりを EHN(見積もりハッカーニュース)に貼れば、匿名で第三者の目が入り、過去の実例と並べられます(無料)。 / Post this estimate to EHN (Estimate Hacker News) for a free, anonymous third-party look against real past cases.");
  lines.push("EHN: " + SITE + "/hacker/submit/");
  const summary = lines.join("\n");

  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const estimateVersion = (await sha256hex(text)).slice(0, 8);
  const signedPayload = JSON.stringify({
    skill: A2A_OPEN_SKILL,
    input_text: text,
    red_flags: flags,
    issued_at: issuedAt,
    expires_at: expiresAt,
    estimate_version: estimateVersion
  });
  const claimSha256 = await sha256hex(signedPayload);

  return {
    kind: "task",
    id: crypto.randomUUID(),
    contextId: ctxId,
    status: { state: "completed", message: a2aMessage(summary), timestamp: issuedAt },
    artifacts: [{
      artifactId: crypto.randomUUID(),
      name: "estimate-integrity-audit",
      parts: [
        { kind: "text", text: summary },
        { kind: "data", data: {
          skill: A2A_OPEN_SKILL,
          red_flags: flags,
          how_to_read_estimate: (guideRes && guideRes.principles) || guideRes,
          issued_at: issuedAt,
          expires_at: expiresAt,
          estimate_version: estimateVersion,
          signed_payload: signedPayload,
          claim_sha256: claimSha256,
          verify: "Recompute: SHA-256 of signed_payload must equal claim_sha256. No price layer needed.",
          disclaimer: "Representative-tactic layer only. Exhaustive audit is the paid KIRA. souba-db price layer is not exposed over A2A.",
          source: "大賀俊勝 (30 years field experience) / HORIZON SHIELD",
          full_diagnosis: SITE + "/hs-reverse-estimate/",
          ehn_submit: SITE + "/hacker/submit/"
        } }
      ]
    }]
  };
}

async function handleRpc(msg, env, ip, authCtx) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    const pv = (params && params.protocolVersion) || "2025-06-18";
    return rpc(id, { protocolVersion: pv, capabilities: { tools: {} }, serverInfo: SERVER,
      instructions: "HORIZON SHIELD の建設費ツール。JCCDB(オープンデータ)・相場カテゴリ・見積もりの読み方を提供する。" });
  }
  if (method === "tools/list") return rpc(id, { tools: TOOLS });
  if (method === "tools/call") {
    const r = await callTool(params && params.name, params && params.arguments, env, ip, { authCtx });
    return rpc(id, r);
  }
  if (method === "ping") return rpc(id, {});
  if (method === "message/send") {
    const r = await handleA2A(params, env, ip, authCtx);
    return rpc(id, r);
  }
  return rpcErr(id, -32601, "Method not found: " + method);
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, mcp-session-id, mcp-protocol-version, authorization",
  "Access-Control-Expose-Headers": "mcp-session-id"
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    // 層3 段1: API キー発行/失効を最優先で処理 (X-Admin-Key 認証・既存パス非接触)
    {
      const _au = new URL(request.url);
      if (_au.pathname === "/admin/issue-apikey" || _au.pathname === "/admin/revoke-apikey") {
        return await handleAdminApiKey(_au.pathname, request, env);
      }
    }

    if (request.method === "GET") {
      const url = new URL(request.url);
      if (url.pathname === "/ratelimit-selftest") {
        try {
          const ip = request.headers.get("CF-Connecting-IP") || "unknown";
          const LIMIT = 60, WINDOW = 60;
          const slot = Math.floor(Date.now() / 1000 / WINDOW);
          const key = "rl:" + ip + ":" + slot;
          const cur = parseInt(await env.RL_KV.get(key) || "0", 10);
          const next = cur + 1;
          await env.RL_KV.put(key, String(next), { expirationTtl: 120 });
          const success = next <= LIMIT;
          return new Response(JSON.stringify({ ok: true, ip, count: next, limit: LIMIT, success, engine: "kv" }), {
            status: 200, headers: { "Content-Type": "application/json; charset=utf-8", ...CORS }
          });
        } catch (e) {
          return new Response(JSON.stringify({ ok: false, error: String(e && e.message || e), engine: "kv" }), {
            status: 500, headers: { "Content-Type": "application/json; charset=utf-8", ...CORS }
          });
        }
      }
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
      if (url.pathname === "/.well-known/agent-card.json") {
        const AGENT_CARD = {
          protocolVersion: "1.0",
          name: "HORIZON SHIELD KIRA",
          description: "An independent, pre-transaction auditor for construction and renovation estimates. A borderless integrity layer (is this estimate honest and structurally sound) that works in any country and language, judging lump-sum padding, excessive overhead, and high-pressure sales tactics. Built on 30 years of field experience by a Japanese master carpenter.",
          url: "https://hs-mcp.oga-surf-project.workers.dev",
          preferredTransport: "JSONRPC",
          provider: { organization: "The HORIZ\u97f3s\u682a\u5f0f\u4f1a\u793e", url: SITE },
          version: "1.0.0",
          capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
          defaultInputModes: ["text/plain", "application/json"],
          defaultOutputModes: ["application/json", "text/plain"],
          skills: [
            {
              id: "estimate-integrity-audit",
              name: "Estimate integrity audit (borderless)",
              description: "Judges whether a construction or renovation estimate is honest and structurally sound, independent of country or currency. Flags lump-sum padding, excessive overhead, and high-pressure sales tactics, and explains how to read the estimate. The universal credence-goods layer.",
              tags: ["construction", "estimate", "audit", "fraud-detection", "credence-goods", "borderless"],
              examples: [
                "Is this renovation estimate honest? It is mostly one lump-sum line with a today-only discount.",
                "\u3053\u306e\u898b\u7a4d\u3082\u308a\u306f\u8aa0\u5b9f\u304b\u3002\u4e00\u5f0f\u8868\u8a18\u3070\u304b\u308a\u3067\u8af8\u7d4c\u8cbb\u304c\u9ad8\u3044\u3002"
              ]
            },
                        {
              id: "japan-property-reform-intake",
              name: "Japan property acquisition and renovation intake",
              description: "Intake desk for buyers (domestic or overseas, via their agents) who want to acquire a used house or property in Japan and renovate it. Provides initial consultation: connects property acquisition (handled by our licensed real-estate agent / takkenshi) with KIRA-verified fair renovation pricing and vetted contractor matching. IMPORTANT: this skill only receives the consultation and routes it. The actual sale contract and statutory explanation of important matters are performed by a licensed real-estate agent (a human), not by this agent. No binding price quote or property recommendation is asserted by the agent.",
              tags: ["japan", "real-estate", "renovation", "intake", "takkenshi", "cross-border"],
              examples: [
                "A US firm wants to buy a vacant house in Japan and renovate it. Where do we start?",
                "\u6d77\u5916\u306e\u4f1a\u793e\u304c\u65e5\u672c\u306e\u6c11\u5bb6\u3092\u8cb7\u3063\u3066\u30ea\u30d5\u30a9\u30fc\u30e0\u3057\u305f\u3044\u3002\u76f8\u8ac7\u3057\u305f\u3044\u3002"
              ]
            },
            {
              id: "verify-claim",
              name: "Integrity claim verification (fail closed)",
              description: "Independently verifies a signed integrity claim issued by estimate-integrity-audit. Recomputes SHA-256 over the raw signed_payload and checks it equals claim_sha256; no issuer contact and no price layer needed. Fail closed under contract 0.1.1 (stale_data / changed_scope / missing_evidence). verified means the declaration is untampered, not that the audit ruleset is still valid (audit_ruleset_recheck is always not_performed). Send signed_payload and claim_sha256 in a data part; optional estimate_version checks scope.",
              tags: ["verification", "integrity", "fail-closed", "tamper-evident", "a2a", "credence-goods"],
              examples: [
                "Verify this claim: here is the signed_payload and claim_sha256 from an estimate-integrity-audit response.",
                "\u3053\u306e claim_sha256 \u306f signed_payload \u3068\u4e00\u81f4\u3059\u308b\u304b\u3002\u671f\u9650\u5207\u308c\u3084\u898b\u7a4d\u5909\u66f4\u304c\u306a\u3044\u304b\u691c\u8a3c\u3057\u3066\u3002"
              ]
            }
          ],
          documentationUrl: SITE,
          dataset: {
            name: "Japan Construction Cost Database (JCCDB)",
            license: "CC BY 4.0",
            doi: "https://doi.org/10.5281/zenodo.20019573"
          }
        };
        return new Response(JSON.stringify(AGENT_CARD, null, 2), {
          status: 200,
          headers: { "Content-Type": "application/json; charset=utf-8", ...CORS }
        });
      }
      if (url.pathname === "/.well-known/verification-contract.json") {
        const VERIFICATION_CONTRACT = {
          contract: "horizon-shield-verification-contract",
          version: "0.1.1",
          issuer: {
            organization: "The HORIZ\u97f3s\u682a\u5f0f\u4f1a\u793e",
            service: "HORIZON SHIELD KIRA",
            url: SITE
          },
          trust_model: "Conferred, not assumed. Any agent recomputes the claim itself from the response. No trust in the UI or the issuer is required.",
          verified_result: {
            description: "Fields present in every estimate-integrity-audit response that let a third party verify the claim without contacting the issuer.",
            claim_hash: {
              field: "claim_sha256",
              algorithm: "SHA-256",
              source_field: "signed_payload",
              note: "signed_payload contains skill, input_text, red_flags, issued_at, expires_at, estimate_version. It does not contain souba-db prices. expires_at is issued_at plus 365 days. estimate_version is the first 8 hex of SHA-256 of input_text."
            },
            recompute: "SHA-256(signed_payload) must equal claim_sha256. No price layer needed.",
            estimator: { id: "HORIZON SHIELD KIRA", version: "1.0.0" },
            ruleset: {
              id: "kira-redflag",
              version: "1",
              note: "Only the ruleset identity is public. The souba-db thresholds behind it are not exposed."
            },
            timestamp_anchor: {
              type: "PTKA",
              chain: "bitcoin",
              block: 949356,
              method: "OpenTimestamps",
              per_diagnosis_roadmap: "Individual on-chain receipts per diagnosis are roadmapped via JIDEC."
            }
          },
          failure_model: {
            policy: "Fail closed. If the claim cannot be recomputed or the chain cannot be verified, the result is unverified. Never a soft pass.",
            result_on_failure: "unverified",
            failure_reasons: {
              stale_data: { user_meaning: "recheck later", triggers: ["expired_declaration"] },
              changed_scope: { user_meaning: "re-audit required", triggers: ["changed_estimate_version"] },
              missing_evidence: { user_meaning: "do not trust", triggers: ["missing_receipt", "unverifiable_chain"] }
            }
          },
          credits: "Failure-reason taxonomy (stale data / changed scope / missing evidence) proposed by Symon Baikov (@symonbaikov.bsky.social).",
          url: "https://hs-mcp.oga-surf-project.workers.dev/.well-known/verification-contract.json"
        };
        return new Response(JSON.stringify(VERIFICATION_CONTRACT, null, 2), {
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
    const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
    const authCtx = await resolveAuthContext(request, env);
    if (Array.isArray(body)) {
      const out = [];
      for (const m of body) { if (!isNotification(m)) out.push(await handleRpc(m, env, clientIp, authCtx)); }
      return new Response(out.length ? JSON.stringify(out) : "", { status: out.length ? 200 : 202, headers: { "Content-Type": "application/json; charset=utf-8", ...CORS } });
    }
    if (isNotification(body)) return new Response("", { status: 202, headers: CORS });
    const res = await handleRpc(body, env, clientIp, authCtx);
    return new Response(JSON.stringify(res), { headers: { "Content-Type": "application/json; charset=utf-8", ...CORS } });
  }
};
