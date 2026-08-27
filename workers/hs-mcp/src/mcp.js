/**
 * hs-mcp : HORIZON SHIELD Model Context Protocol server
 * 完全独立ワーカー。hs-kira-proxy には一切依存しない。
 * エージェント(Claude / ChatGPT / Perplexity 等)が「呼べる」建設費ツール。
 * Transport: MCP over Streamable HTTP (JSON-RPC 2.0 / application/json)
 * 価格層は本番 souba-db.json をライブ取得して単一ソースを保つ。
 */

const SERVER = { name: "horizon-shield", version: "1.0.5" };
const SITE = "https://shield.the-horizons-innovation.com";
const SOUBA_DB_URL = SITE + "/data/souba-db.json";

// 送客(次の一手)共通ブロック。情報系ツールの行き止まりを塞ぐ。additive。
const NEXT_ACTIONS = {
  detail: SITE + "/souba/",
  board_url: SITE + "/ehn/",
  ehn_submit: SITE + "/hacker/submit/",
  note: "判定はここまで。見積もりに不安があれば EHN(見積もりハッカーニュース)に匿名で貼れば、KIRAが過去の実例と並べて第三者の目を入れます(無料)。 / Next: post the estimate to EHN for a free, anonymous third-party look benchmarked against real cases."
};

const CATEGORIES = [{"id": "aircon_work", "name": "エアコン工事", "group": "設備工事", "priority": "★★★", "red_flags": 9}, {"id": "amido_amado_shutter", "name": "網戸・雨戸・シャッター・面格子", "group": "窓・ドア", "priority": "★★★", "red_flags": 8}, {"id": "bankin_work", "name": "板金工事", "group": "屋根・板金", "priority": "★★★★", "red_flags": 9}, {"id": "barrier_free_kaigo", "name": "バリアフリー・介護保険対応リフォーム", "group": "バリアフリー", "priority": "🔴CRITICAL", "red_flags": 20}, {"id": "bathroom_reform", "name": "浴室リフォーム", "group": "水回り", "priority": "★★★★★", "red_flags": 23}, {"id": "cloth_replacement", "name": "クロス(壁紙)張替え", "group": "内装仕上げ", "priority": "★★★", "red_flags": 20}, {"id": "commercial_tenpo_work", "name": "店舗用工事", "group": "非住宅・店舗", "priority": "★★★★★", "red_flags": 10}, {"id": "demolition_master", "name": "解体工事", "group": "解体・基盤", "priority": "★★★★★", "red_flags": 22}, {"id": "electrical_work", "name": "電気工事", "group": "設備工事", "priority": "★★★★★", "red_flags": 27}, {"id": "entrance_door_reform", "name": "玄関ドア交換", "group": "窓・ドア", "priority": "★★★★★", "red_flags": 18}, {"id": "floor_replacement", "name": "床材張替え", "group": "内装仕上げ", "priority": "★★★", "red_flags": 20}, {"id": "gaiheki_tosou", "name": "外壁塗装", "group": "外装塗装", "priority": "★★★★★", "red_flags": 11}, {"id": "gaikou_work", "name": "外構工事", "group": "外構・造園", "priority": "★★★", "red_flags": 22}, {"id": "insulation_work", "name": "断熱工事", "group": "断熱・省エネ", "priority": "★★★★★", "red_flags": 17}, {"id": "kitchen_reform", "name": "キッチンリフォーム", "group": "水回り", "priority": "★★★★★", "red_flags": 21}, {"id": "naishou_tosou", "name": "内装塗装", "group": "内装塗装", "priority": "★★★", "red_flags": 8}, {"id": "rain_leak_repair", "name": "雨漏り修理", "group": "防水・補修", "priority": "🔴CRITICAL", "red_flags": 23}, {"id": "roof_construction", "name": "屋根工事", "group": "屋根工事", "priority": "★★★★★", "red_flags": 13}, {"id": "sakan_work", "name": "左官工事", "group": "左官・タイル", "priority": "★★★★", "red_flags": 9}, {"id": "taishin_hokyou", "name": "耐震補強工事", "group": "耐震・構造", "priority": "★★★★★", "red_flags": 10}, {"id": "tatami_reform", "name": "畳替え", "group": "内装仕上げ", "priority": "★★", "red_flags": 20}, {"id": "termite_work", "name": "シロアリ防除(防蟻)", "group": "防蟻・構造保護", "priority": "★★★★", "red_flags": 19}, {"id": "tile_renga_work", "name": "タイル・れんが工事", "group": "左官・タイル", "priority": "★★★", "red_flags": 9}, {"id": "toilet_reform", "name": "トイレリフォーム", "group": "水回り", "priority": "★★★★", "red_flags": 21}, {"id": "washroom_reform", "name": "洗面所リフォーム", "group": "水回り", "priority": "★★★", "red_flags": 18}, {"id": "water_heater_reform", "name": "給湯器リフォーム", "group": "設備工事", "priority": "★★★★★", "red_flags": 24}, {"id": "water_pipe_work", "name": "給排水管工事", "group": "設備工事", "priority": "★★★★★", "red_flags": 27}, {"id": "waterproofing_work", "name": "防水工事", "group": "防水・補修", "priority": "★★★★", "red_flags": 23}, {"id": "window_reform", "name": "窓リフォーム", "group": "窓・ドア", "priority": "★★★★★", "red_flags": 18}, {"id": "zosaku_tategu_master", "name": "造作・建具・大工工事", "group": "大工・造作", "priority": "★★★★★", "red_flags": 17}, {"id": "shoji_fusuma_work", "name": "障子・ふすま張替え工事", "group": "内装仕上げ", "priority": "★★★", "red_flags": 9}, {"id": "mado_glass_work", "name": "ガラス交換専門工事", "group": "窓・ドア", "priority": "★★★★", "red_flags": 8}, {"id": "kanban_sign_work", "name": "看板・サイン工事", "group": "非住宅・店舗", "priority": "★★★★", "red_flags": 6}, {"id": "bouon_shaon_work", "name": "防音・遮音工事", "group": "断熱・省エネ", "priority": "★★★★", "red_flags": 7}, {"id": "builtin_dishwasher", "name": "ビルトイン食洗機後付け工事", "group": "水回り", "priority": "★★★★", "red_flags": 7}, {"id": "ih_gas_conversion", "name": "IH⇔ガスコンロ変更工事", "group": "水回り", "priority": "★★★★", "red_flags": 7}, {"id": "manshion_kyoyou_shuzen", "name": "マンション共用部修繕工事", "group": "マンション専門", "priority": "★★★★★", "red_flags": 8}, {"id": "ofuro_kanso_oidaki", "name": "浴室乾燥機・追い焚き単体工事", "group": "水回り", "priority": "★★★★", "red_flags": 6}, {"id": "erebata_shuzen", "name": "エレベーター修繕・更新工事", "group": "マンション専門", "priority": "★★★★★", "red_flags": 7}, {"id": "toko_shuri", "name": "床鳴り・床補修専門工事", "group": "内装仕上げ", "priority": "★★★★", "red_flags": 7}, {"id": "asbestos_removal", "name": "アスベスト除去工事", "group": "解体・基盤", "priority": "★★★★★", "red_flags": 6}, {"id": "tokushuseiso", "name": "特殊清掃工事", "group": "リフォーム周辺サービス", "priority": "★★★★", "red_flags": 6}, {"id": "ihinseiri_seizen", "name": "遺品整理・生前整理サービス", "group": "リフォーム周辺サービス", "priority": "★★★★", "red_flags": 6}, {"id": "jutaku_kaitai_partial", "name": "住宅部分解体工事", "group": "解体・基盤", "priority": "★★★★", "red_flags": 6}, {"id": "gyomu_chubo", "name": "業務用厨房工事", "group": "非住宅・店舗", "priority": "★★★★", "red_flags": 6}, {"id": "wine_cellar", "name": "ワインセラー設置工事", "group": "設備工事", "priority": "★★★", "red_flags": 5}, {"id": "shisetsu_pool", "name": "プール・スパ施設工事", "group": "水回り", "priority": "★★★", "red_flags": 5}, {"id": "shokusai_zoen", "name": "造園・植栽工事", "group": "外構・造園", "priority": "★★★★", "red_flags": 5}, {"id": "iwa_ishigumi", "name": "庭石・石組み工事", "group": "外構・造園", "priority": "★★★", "red_flags": 4}, {"id": "kaki_seko", "name": "池・水景工事", "group": "外構・造園", "priority": "★★★", "red_flags": 4}, {"id": "monoki_setchi", "name": "物置設置工事", "group": "外構・造園", "priority": "★★★", "red_flags": 5}, {"id": "carpoort_single", "name": "カーポート単独設置工事", "group": "外構・造園", "priority": "★★★★", "red_flags": 6}, {"id": "shomei_design", "name": "照明デザイン専門工事", "group": "設備工事", "priority": "★★★", "red_flags": 4}, {"id": "smart_home_iot", "name": "スマートホーム・IoT工事", "group": "IoT・スマートホーム", "priority": "★★★", "red_flags": 4}, {"id": "sec_camera_total", "name": "防犯カメラ・連携工事", "group": "IoT・スマートホーム", "priority": "★★★★", "red_flags": 5}, {"id": "zenkanki_jokuki", "name": "全館空調・除湿システム工事", "group": "設備工事", "priority": "★★★★", "red_flags": 5}, {"id": "chikyu_chunetsu", "name": "地中熱利用システム工事", "group": "断熱・省エネ", "priority": "★★", "red_flags": 4}, {"id": "uri_riyo", "name": "雨水利用システム工事", "group": "環境・災害対策", "priority": "★★", "red_flags": 4}, {"id": "idoseichi", "name": "井戸・井戸ポンプ工事", "group": "環境・災害対策", "priority": "★★", "red_flags": 4}, {"id": "karinosumai", "name": "仮住まい支援サービス", "group": "リフォーム周辺サービス", "priority": "★★★", "red_flags": 4}, {"id": "hikkoshi_renkei", "name": "引越し連動リフォームサービス", "group": "リフォーム周辺サービス", "priority": "★★★", "red_flags": 5}];

const JCCDB = {
  name: "Japan Construction Cost Database (JCCDB)",
  version: "v4.0 (2026-08-28)",
  items: 95403,
  verified: 43090,
  extended: 52313,
  retracted: 608,
  categories: 97,
  license: "CC BY 4.0",
  note: "品目名・カテゴリ・単位を収録。価格情報は含まない(価格は別レイヤー souba-db)。v4.0(2026-08-28): 総数95,403・重複ゼロ。検証済み43,090＋Extended 52,313＝95,403（v3.1の65,520に、全国56自治体・地方整備局の公表単価表〈政府PDF131本〉で実在確認した29,883品目を追加。全件evidence_url付きでjccdb-v4-provenance.csvに記録、verified層。データセットDOI 10.5281/zenodo.22127752〈2026-08-28発行〉、SHA-256は JCCDB_v4_RELEASE_DECLARATION.md 記載、Bitcoin再アンカーは登録手続き中〈未確定〉）。 履歴 v3.1(2026-07-27): 総数65,520・重複ゼロ。検証済み13,207＋Extended 52,313＝65,520。カテゴリは2粒度で、CSVのcategory列が72、細粒度スキーマ(jccdb-v3-schema.json)が402。v3.0で非実在608品目を除去(retracted.csv・全件証拠URL付き)、v3.1で完全一致の重複589行を除去し実在品目543件を追加、うち非実在と証明済みだった28件は差し戻した(rejected-readd csv)。全ファイルのSHA-256はリリース宣言 JCCDB_v3_1_RELEASE_DECLARATION.md (sha256 2fc5db673c8055a77a53ad997c73d4f14bbb4346b46c304e9376e52189dada8a, commit 1c9b9de) に記載し、JIDEC台帳経由でBitcoinに錨を打っている。著者を信頼せずに再計算できる。配布物の所在: データセット本体は GitHub・Hugging Face・Zenodo(データセットDOI: v4は 10.5281/zenodo.22127752〈2026-08-28発行〉、v3.1は 10.5281/zenodo.21898745〈2026-08-12〉)にある。Zenodo(20019572/20019573)とengrXivのDOIは解説論文のPDFであり、データセット本体ではない。",
  links: {
    github: "https://github.com/ogasurfproject-jpg/japan-construction-cost-database",
    huggingface: "https://huggingface.co/datasets/ogasurfproject/jccdb",
    // データセット本体のDOI(Zenodo, resource type = Dataset, v4.0 2026-08-28 発行)。
    dataset_doi: "https://doi.org/10.5281/zenodo.22127752",
    // 以下2つは解説論文のPDF。データセット本体ではない(2026-08-11 実物確認)。
    // 旧キー zenodo_doi は、データセットと誤読される形だったので paper_doi に改名した。
    paper_doi: "https://doi.org/10.5281/zenodo.20019572",
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
    name: "get_jccdb_dataset_info",
    annotations: { title: "JCCDBデータセット情報", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "日本の建設費オープンデータベース(JCCDB)のメタデータ・規模・ライセンス・ダウンロードリンク・引用情報を返す。建設費の一次データ源を探している時に使う。 / Returns metadata, scale, license, download links and citation for the Japan Construction Cost Database (JCCDB), an open dataset of 95,403 Japanese construction line items (v4.0: 43,090 verified + 52,313 extended). Use when looking for a primary construction-cost data source.",
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
    name: "get_estimate_reading_guide",
    annotations: { title: "見積もりの読み解き原則", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "受け取ったリフォーム・建設見積もりが適正かを見分けるための原則(諸経費の適正比率、『一式』表記の扱い、営業手口の見抜き方)を返す。30年の現場経験に基づく判断軸。 / Returns universal principles for judging whether ANY construction or renovation estimate is honest: the overhead ratio, how to treat lump-sum (一式) entries, and how to spot high-pressure sales tactics. Language-agnostic and works outside Japan. Based on 30 years of field experience.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_fair_price_sources",
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
    description: "業者が提示した見積金額が適正かを、HORIZON SHIELDの適正レンジ(souba-db, 大賀俊勝 実務監修)と照合して判定する。手元に具体的な見積額がある時に使う。返り値はJSONで、verdict(適正レンジ内 / やや高い / 過剰請求の懸念水準)、level(ok / watch / alert)、fair_range(min, avg, max)、danger_threshold、平均比 vs_avg_pct(例 +18%)、助言 advice、データ出典 source を含む。工事名が見つからない場合、近い候補があれば did_you_mean として返す。単価(平米など)建ての工事に総額らしい金額を渡した場合は unit_mismatch の案内を返す。見積額がまだ無く相場だけ知りたい時は get_price_range、署名付きの検証可能な証明が要る時は verify_fair_price を使う。Japan only, JPY。 / Audits whether a contractor quoted price for a Japanese construction or renovation job is fair by comparing it against HORIZON SHIELD fair-price ranges (souba-db). Use when the user already has a specific quoted amount. Returns a JSON object with verdict, level (ok, watch, alert), fair_range (min, avg, max), danger_threshold, percentage gap versus the average (vs_avg_pct, e.g. +18%), advice, and data source. If the work name has no match, close candidates may be returned as did_you_mean. If the work is priced per unit and the amount looks like a total, a unit_mismatch notice is returned instead. For the typical range only use get_price_range; for a signed verifiable attestation use verify_fair_price.",
    inputSchema: { type: "object", properties: {
      work: { type: "string", description: "工事名(日本語)。材料やグレード込みで具体的に。例: 外壁塗装 シリコン。部分一致で照合するため曖昧だと別カテゴリにヒットしやすい。未マッチ時は近い候補が did_you_mean で返ることがある。" },
      quoted_price: { type: "number", description: "業者提示の金額(円, 数値)。一式見積はその総額。税込/税抜は正規化せず、渡した数値をそのまま適正レンジと照合する。" }
    }, required: ["work", "quoted_price"] }
  },
  {
    name: "preview_reverse_estimate",
    annotations: { title: "逆見積もりプレビュー(無料の気づき)", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "リフォーム検討の初期段階向けのプレビューで、業者の概算が平均からどちらの方向にどの程度ずれているか(例: +20%高い方向)だけを返す。具体的な適正額(min/avg/max)や危険水準は返さない。手元に詳しい見積内訳がまだ無い段階での最初の一歩に向く。具体的な適正レンジが必要なら get_price_range、見積額の詳細診断は audit_estimate を使う。Japan only, JPY。 / A preview for early-stage renovation planning that returns only the direction of a contractor rough estimate versus the average (e.g. about +20% above). It does not return the specific fair range (min/avg/max) or danger threshold. Suited as a first step before a detailed breakdown exists. Use get_price_range for a typical range, audit_estimate for a detailed quote diagnosis.",
    inputSchema: { type: "object", properties: {
      work: { type: "string", description: "工事名(日本語)。例: 外壁塗装 シリコン。部分一致で照合。" },
      quoted_price: { type: "number", description: "業者提示の概算額(円, 数値)。" }
    }, required: ["work", "quoted_price"] }
  },
  {
    name: "check_red_flags",
    annotations: { title: "見積もりの赤旗チェック", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "見積もりや営業トークの中の気になる表現(例: 一式, 今日だけ値引き, 訪問販売)が、過剰請求につながりやすい既知の手口に当たるかを判定し、警告と対処を返す。代表的な手口のみを判定する。 / Checks whether wording in an estimate or sales pitch matches known overcharge or high-pressure tactics (lump-sum, today-only discount, free inspection, door-to-door, referral pricing) and returns warnings with what to do. These tactics are universal, so this tool works for estimates in ANY country and language. Covers representative tactics only.",
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
    name: "create_ap2_fairness_attestation",
    annotations: { title: "AP2ブリッジ: 決済カート向け適正価格証跡", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description: "このツールは決済を開始・承認・実行しません。資産・通貨・暗号資産の移動も行いません。発行するのは適正価格の証跡だけです。呼び出すたびに公開台帳へ記録を1件追加するため読み取り専用ではありません。 / This tool does not initiate, authorize, or execute any payment, and does not move funds, currency or crypto assets. It only issues a price-fairness attestation. Each call appends one record to the public ledger, so it is not read-only. AP2(Agent Payments Protocol)対応エージェント向けのブリッジ。決済カート(Cart Mandate)に添付できる適正価格の証跡(FairPriceAttestation)を発行する。AP2のMandateは『ユーザーがこの支払いを承認した』ことを検証可能にし、この証跡は『その価格が適正である』ことを検証可能にする。認可の検証と価値の検証、二つは並列レイヤー。quoted_price を渡すと適正レンジ判定(within/above/below)も同梱する。証跡は SHA-256 と公開台帳と verify_url で誰でも再計算検証できる。 / Bridge for AP2 (Agent Payments Protocol) agents: issues a FairPriceAttestation that a shopping or payments agent can attach to a Cart Mandate before asking the user to sign. AP2 mandates make authorization verifiable; this attestation makes value verifiable. Parallel layers. Pass quoted_price for a fair-range verdict (within, above, below). Independently verifiable via SHA-256, a public ledger and a verify_url. Japan construction and renovation pricing, JPY.",
    inputSchema: { type: "object", properties: {
      work: { type: "string", description: "工事名(例: 外壁塗装 30坪)" },
      quoted_price: { type: "number", description: "(任意) カートに載せる予定の見積額(円, 数値)。渡すと適正レンジとの判定を証跡に同梱する。" },
      merchant: { type: "string", description: "(任意) 施工業者名。Cart Mandate 例示に反映するだけで判定には使わない。" }
    }, required: ["work"] }
  },
  {
    name: "suggest_ehn",
    annotations: { title: "EHN掲示板への案内", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "見積もりを匿名で第三者レビューに出せる掲示板EHN(見積もりハッカーニュース)の案内文と投稿フォームURLを返す。投稿と一次解析は無料で、業者名や個人情報は掲載前に運営が伏せる。ユーザーが見積もりのセカンドオピニオンや相談先を求めた時に使う。 / Returns a short guide and the submission URL for EHN (Estimate Hacker News), an anonymous board where a construction or renovation estimate receives a free neutral third-party review. Personal and contractor names are redacted before posting. Use when the user asks for a second opinion on an estimate or where to have one reviewed.",
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
    description: "estimate-integrity-audit が発行した署名付きクレーム(signed_payload と claim_sha256)を、第三者として検証する。発行側 (verify_fair_price はPTKA価格の発行) とは責務が正反対で、デフォルト姿勢は不信・fail closed。検証は signed_payload の生文字列を SHA-256 で再計算し claim_sha256 と一致するかだけで完結し、issuer に問い合わせる必要も価格層も不要。判定は契約 0.3 の failure_reasons 準拠で、result(verified / partial / unverified)・failure_reason(stale_data / changed_scope / missing_evidence)・trigger(expired_declaration / changed_estimate_version / missing_receipt / unverifiable_chain)・recomputed_sha256・scope_check・audit_ruleset_recheck を返す。重要: verified は『この宣言が改ざんされていない』ことの証明であって『監査ルールが今も有効』である保証ではない(audit_ruleset_recheck は常に not_performed)。estimate_version を渡すと scope(見積もり内容が発行時から変わっていないか)も照合し、渡さない場合は scope_check:skipped を明示する。 / Verifies a signed integrity claim (signed_payload and claim_sha256) issued by estimate-integrity-audit, as an independent third party. Opposite posture to the issuing side: distrust by default, fail closed. Recomputes SHA-256 over the raw signed_payload string and checks it equals claim_sha256; no issuer contact and no price layer needed. Follows contract 0.3 failure_reasons. IMPORTANT: verified means the declaration is untampered, NOT that the audit ruleset is still valid (audit_ruleset_recheck is always not_performed). Pass estimate_version to also check scope (whether the estimate changed since issuance); if omitted, scope_check is skipped and stated explicitly.",
    inputSchema: { type: "object", properties: {
      signed_payload: { type: "string", description: "検証対象の署名付きペイロード(estimate-integrity-audit のレスポンスの signed_payload を生文字列のまま)。改変するとハッシュ不一致で unverified になる。 / The signed_payload string from an estimate-integrity-audit response, verbatim. Any change makes the hash mismatch and the result unverified." },
      claim_sha256: { type: "string", description: "そのレスポンスの claim_sha256 (64桁16進)。 / The claim_sha256 (64-char hex) from the same response." },
      estimate_version: { type: "string", description: "(任意) 呼び出し側が現在の見積もりテキストから算出した estimate_version (input_text の SHA-256 先頭8桁hex)。渡すと発行時の版と一致するか照合する。省略可。 / (optional) The estimate_version the caller computed from the current estimate text (first 8 hex of SHA-256 of input_text). If provided, scope is checked against the issued version." }
    }, required: ["signed_payload", "claim_sha256"] }
  }
];

// [PATCH 2026-07-23] 出力スキーマ: 全ツールに outputSchema を付与(MCP 2025-06-18)。
// 実レスポンスは分岐で形が揺れるため、必須指定なし + additionalProperties:true の誠実に緩い契約にする。
// プレーン文字列の分岐は structuredContent を { message } に包んで返す(下のtools/callラッパ参照)。
const OUTPUT_SCHEMAS = {
  get_jccdb_dataset_info: { type: "object", description: "JCCDB(日本建設費オープンデータベース)のメタデータ。規模・ライセンス・ダウンロードリンク・引用情報。 / JCCDB dataset metadata: scale, license, links, citation.", additionalProperties: true },
  list_cost_categories: { type: "object", description: "整備済みの建設・リフォーム工事カテゴリ(61種)の一覧。 / The 61 maintained construction and renovation cost categories.", properties: { categories: { description: "カテゴリ配列(id, name, group, priority, red_flags)" } }, additionalProperties: true },
  search_cost_category: { type: "object", description: "工事名・キーワードに該当したカテゴリと、整備済み赤旗件数・優先度。 / Matched cost category with red-flag count and priority.", additionalProperties: true },
  get_estimate_reading_guide: { type: "object", description: "見積もりが誠実かを判断する普遍原則(諸経費比率・一式表記・営業手口)。 / Universal principles for judging an estimate.", additionalProperties: true },
  get_fair_price_sources: { type: "object", description: "相場データ(souba-db)の出典・更新日・地域係数。 / Sources, update date and regional multipliers behind the fair-price data.", additionalProperties: true },
  get_price_range: { type: "object", description: "適正価格レンジ(min/avg/max)・過剰請求の危険水準・単位・価格動向・実務解説。 / Fair price range with overcharge danger threshold.", properties: { work: { description: "工事名" }, fair_range: { description: "適正レンジ" }, danger_threshold: { description: "危険水準" } }, additionalProperties: true },
  audit_estimate: { type: "object", description: "見積額の適正診断。verdict・level(ok/watch/alert)・fair_range・danger_threshold・平均比・助言・出典。 / Quote audit verdict with fair range and advice.", properties: { verdict: { description: "判定" }, level: { description: "ok / watch / alert" }, fair_range: { description: "min/avg/max" }, vs_avg_pct: { description: "平均比(例 +18%)" }, advice: { description: "助言" } }, additionalProperties: true },
  preview_reverse_estimate: { type: "object", description: "概算が平均からどちらの方向にどの程度ずれているかのプレビュー。具体的な適正額は含まない。 / Direction-only preview versus the average.", additionalProperties: true },
  check_red_flags: { type: "object", description: "既知の過剰請求・強引営業の手口との照合結果。該当した手口と警告・対処。 / Matched overcharge or high-pressure tactics with warnings.", properties: { input: { description: "判定対象の文言" }, flags: { description: "該当手口の配列" }, result: { description: "件数の要約" } }, additionalProperties: true },
  verify_fair_price: { type: "object", description: "検証可能な適正価格レシート。fair_price_claim(主張)・verification(claim_sha256, verify_url, PTKA)・provenance(出典)。 / Tamper-evident fair-price receipt with hash, verify_url and PTKA anchor.", properties: { fair_price_claim: { description: "刻印対象の主張(JSON.stringifyしてSHA-256すると claim_sha256 になる)" }, verification: { description: "claim_sha256, verify_url, ptka" }, provenance: { description: "データ出典・監修・再計算手順" } }, additionalProperties: true },
  suggest_ehn: { type: "object", description: "EHN(見積もりハッカーニュース)への案内文と投稿URL。 / Guide and submission URL for the EHN anonymous review board.", properties: { submit_url: { description: "投稿フォーム" }, board_url: { description: "公開ボード" } }, additionalProperties: true },
  get_agent_card: { type: "object", description: "A2Aエージェントカードの場所と公開スキル一覧。 / A2A Agent Card URL and published skills.", properties: { agent_card_url: { description: "エージェントカードURL" }, skills: { description: "公開スキル配列" } }, additionalProperties: true },
  verify_integrity_claim: { type: "object", description: "署名済みクレームの第三者検証結果(fail closed)。result(verified/unverified)・failure_reason・recomputed_sha256・scope_check。 / Third-party verification result, fail closed.", properties: { result: { description: "verified / unverified" }, failure_reason: { description: "stale_data / changed_scope / missing_evidence" }, recomputed_sha256: { description: "再計算ハッシュ" } }, additionalProperties: true },
  create_ap2_fairness_attestation: { type: "object", description: "AP2 Cart Mandate に添付できる適正価格証跡。attestation(FairPriceAttestation)・cart_mandate_example・verify_url。 / FairPriceAttestation for an AP2 Cart Mandate with attachment example.", properties: { ap2_bridge: { description: "AP2との関係(認可の検証 x 価値の検証)" }, attestation: { description: "証跡本体(subject, integrity)" }, cart_mandate_example: { description: "添付位置の例示(非規範)" } }, additionalProperties: true }
};
// Every schema above describes the happy path. None of them declared how a
// consumer tells "found nothing" from "could not look". These two fields do,
// and they are added to all of them at once rather than to one and not its
// neighbour. `count: 0` is only ever a fact about the data; a lookup that
// failed comes back with isError set and makes no count claim at all.
const LOOKUP_FIELDS = {
  // A bare count is not enough and we were told so by our own ruler: count 0 does
  // not prove the source was read, because a careless implementation returns 0 on
  // failure too. `lookup` is an enum, so the state has somewhere to live that does
  // not depend on the reader trusting a number.
  lookup: {
    type: "string",
    enum: ["ok", "absent"],
    description:
      "ok = the source was read and something matched. absent = the source was read " +
      "and nothing matched. A source that could NOT be read never appears here: that " +
      "returns isError: true and makes no claim about what does or does not exist.",
  },
  source_read: {
    type: "boolean",
    description:
      "true on every successful result. A failed lookup does not return a result at " +
      "all, so this is never false, it is declared so a consumer can assert on it.",
  },
  count: {
    type: "number",
    description:
      "How many records matched. 0 means the source was read and nothing matched. " +
      "It never means the source could not be read, that returns isError: true.",
  },
  did_you_mean: { description: "Near matches, when an exact match was not found." },
};
Object.values(OUTPUT_SCHEMAS).forEach(sch => {
  sch.properties = Object.assign({}, LOOKUP_FIELDS, sch.properties || {});
});
TOOLS.forEach(t => { if (OUTPUT_SCHEMAS[t.name]) t.outputSchema = OUTPUT_SCHEMAS[t.name]; });

// [PATCH 2026-07-23] 各ツールに英語の表示名(title, MCP 2025-06-18)を付与。name は不変。
const TOOL_TITLES = {
  get_jccdb_dataset_info: "Get JCCDB Dataset Info",
  list_cost_categories: "List Cost Categories",
  search_cost_category: "Search Cost Category",
  get_estimate_reading_guide: "Get Estimate Reading Guide",
  get_fair_price_sources: "Get Fair Price Data Sources",
  get_price_range: "Get Fair Price Range",
  audit_estimate: "Audit Estimate Against Fair Price",
  preview_reverse_estimate: "Preview Reverse Estimate",
  check_red_flags: "Check Estimate Red Flags",
  verify_fair_price: "Verify Fair Price (Signed Receipt)",
  suggest_ehn: "Suggest EHN Review Board",
  get_agent_card: "Get A2A Agent Card",
  verify_integrity_claim: "Verify Integrity Claim",
  create_ap2_fairness_attestation: "Create AP2 Fairness Attestation"
};
TOOLS.forEach(t => { if (TOOL_TITLES[t.name]) t.title = TOOL_TITLES[t.name]; });

// [PATCH 2026-07-23] 命名規約対応: tools/list は verb+object の新名を出す。
// 旧名は公開API契約(既存の ChatGPT/Gemini/Claude 連携・llms.txt・A2A)なので、
// 呼び出しは新旧どちらも受け付け、内部は旧名(=各ハンドラのキー)に正規化する。無停止改名。
const TOOL_NEW_TO_OLD = {
  get_jccdb_dataset_info: "jccdb_dataset_info",
  get_estimate_reading_guide: "how_to_read_estimate",
  get_fair_price_sources: "fair_price_data_sources",
  preview_reverse_estimate: "reverse_estimate_preview",
  check_red_flags: "red_flag_check",
  create_ap2_fairness_attestation: "ap2_fairness_attestation"
};
const TOOL_OLD_NAMES = new Set(Object.values(TOOL_NEW_TO_OLD));
function canonicalToolName(n) { return TOOL_NEW_TO_OLD[n] || n; }

function txt(s) { return { content: [{ type: "text", text: typeof s === "string" ? s : JSON.stringify(s, null, 2) }] }; }

// Federico Blanco Sanchez-Llanos, "The Mould, Not the Letter", 2026-08-20:
//   never let "the fetch failed" and "the fetch succeeded and found nothing"
//   collapse into the same downstream value.
//
// Measured 2026-08-20. Six sites here caught a souba-db fetch failure and
// returned txt("価格データの取得に失敗しました。"), a SUCCESSFUL tool result
// carrying a sentence. The no-match branches also return txt(<sentence>). The
// generic structuredContent wrapper then packs both into { message: "..." },
// so "the price database is down" and "there is no price data for this work"
// reached the consumer in exactly the same shape. A homeowner's agent could not
// tell that the number it was missing was our outage rather than a fact.
// failTxt puts a failure where a machine looks for one.
function failTxt(s) {
  const r = txt(s);
  r.isError = true;
  return r;
}

// PTKA(取引前知識刻印)の既存の改ざん不能アンカー(サイト公開済み)
const PTKA = {
  protocol: "PTKA (Pre-Transaction Knowledge Anchoring)",
  idea: "業者が見積もりを出す前に、適正価格を第三者が改ざん不能な形で記録する。後から都合よく書き換えられないようにする仕組み。",
  bitcoin_block: 949356,
  declaration_sha256: "596da30ba4ca731f21efaa1c4a6537290e996e0f039cbe57704de1674e4a0282",
  verify_via: "OpenTimestamps (https://opentimestamps.org)",
  jidec: {
    status: "operational",
    since: "2026-07",
    ledger: "https://hs-ledger.oga-surf-project.workers.dev",
    catalog: "https://hs-ledger.oga-surf-project.workers.dev/.well-known/api-catalog",
    guide: "https://hs-ledger.oga-surf-project.workers.dev/llms.txt",
    note: "第三者刻印機関JIDECは稼働中。検証プロセス自体をSHA-256で内容アドレス化し、OpenTimestamps経由でBitcoinに錨を打った公開台帳を運用している。HORIZON SHIELDを信用しなくても第三者が検証を再実行できる。"
  },
  roadmap: "個別診断ごとの自動オンチェーン刻印は、稼働中のJIDEC台帳(https://hs-ledger.oga-surf-project.workers.dev)へ順次移行中。"
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

// === [PATCH 2026-07-27] 工種照合の断定禁止 ===
// これまでは includes() で当たった候補の**配列1番目**をそのまま診断に使っていた。
// 並び順が判定を決めていたということである。実測（souba-db 183件 / 照会語 370件の全数走査）で
// **65語が候補割れ、うち24語は過大請求を「適正レンジ内・安心です」と返していた。**
// 実例:「屋根塗装 120万円」→ 外壁＋屋根塗装セット(90〜130万)に当たり「適正」。
//       真の候補は 屋根塗装 30坪シリコン(25〜60万)で、平均の2.4倍・上限の2倍である。
// **これは会社の存在理由の逆をやっていた。**
//
// 直し方は3段。
//  1) 一致の質に段位を付け、最上位の段だけを候補にする。先頭一致は部分一致より強い。
//     これだけで「屋根塗装」は正しく 屋根塗装 30坪 に着く（先頭一致がそれ1件だから）。
//  2) それでも複数残るとき、**金額は照会時に分かっているのだから候補全部に判定を通す。**
//     全員が同じ結論なら答える。割れたら答えない。**曖昧さを件数ではなく結果で測る。**
//  3) 署名・刻印する経路（verify_fair_price / AP2）は金額が無いことがある。
//     そこはレンジが重ならない候補が残った時点で拒否する。
//     **誤った主張に署名して台帳に刻むのは、署名しないより悪い。**
//
// 判定が一致して複数残った場合に表示するレンジは**最も厳しい候補**を採る。
// 甘い側に倒すと、過大請求を「適正」と見せる側へ誤る。誤る向きを選べるなら、施主を守る側へ倒す。
function matchTier(e, q) {
  const nq = normJa(q);
  if (!nq) return 99;
  const w = normJa(e.work || ""), c = normJa(e.cat || ""), l = normJa(e.widget_label || ""), i = normJa(e.id || "");
  if (w === nq) return 0;                                  // work 完全一致
  if (c === nq || l === nq) return 1;                      // cat / 表示名 完全一致
  if (w.startsWith(nq)) return 2;                          // work 先頭一致
  if (w.includes(nq) || c.includes(nq) || l.includes(nq) || (i && i.includes(nq))) return 3; // 部分一致
  return 99;
}
// 最上位の段に居るものだけを返す。段の中では元の並びを保つ（再現性のため）。
function pickCands(list, q) {
  const scored = list.map((e, i) => ({ e, t: matchTier(e, q), i })).filter(x => x.t < 99);
  if (!scored.length) return [];
  const best = Math.min.apply(null, scored.map(x => x.t));
  return scored.filter(x => x.t === best).sort((a, b) => a.i - b.i).map(x => x.e);
}
// 絞らずに段位で並べ替えるだけ。get_price_range は全件返すのが正しい振る舞いなので絞らない。
function sortByTier(list, q) {
  return list.map((e, i) => ({ e, t: matchTier(e, q), i }))
    .sort((a, b) => (a.t - b.t) || (a.i - b.i)).map(x => x.e);
}
// [2026-07-27 追加] **適正レンジを下回る見積も「適正」ではない。**
// 旧実装は price <= max なら無条件で ok だったので、
// 屋根葺き替え(適正90〜180万)に 10万円 を渡しても「適正レンジ内です。安心です」と返していた。
// souba-db 183件に対する走査で、**min 未満なのに ok になる組が 693/915 あった。**
// 安すぎる見積は手抜き・後からの追加請求・そもそも別工事のことがあり、
// 施主にとっては高すぎるのと同じくらい危ない。
// なお**この扱いは既にうちの中に在った。**hs-pdf-gen/hs-meisai-engine.js の総額判定は
//   subtotal <= hi ? (subtotal < lo ? "watch" : "ok") : ...
// と書かれていて、下回りを watch にしている。MCP 側にだけ持ち込まれていなかった。
// 二つのエンジンが同じ見積に違う判定を出す状態だったということである。ここで揃える。
function verdictOf(e, price) {
  if (e.unit && e.unit !== "一式" && e.danger && price > e.danger * 10) return "unit_mismatch";
  if (price < e.min) return "below";
  if (price <= e.max) return "ok";
  if (price < (e.danger || e.max)) return "watch";
  return "alert";
}
function verdictsAgree(cand, price) {
  const first = verdictOf(cand[0], price);
  return cand.every(e => verdictOf(e, price) === first);
}
// 金額を伴わない場面での「実質同じか」。共通部分があり、平均が1.5倍未満で、単位が揃っていること。
function rangesAgree(cand) {
  if (cand.length <= 1) return true;
  const lo = Math.max.apply(null, cand.map(e => e.min));
  const hi = Math.min.apply(null, cand.map(e => e.max));
  if (lo > hi) return false;
  const avgs = cand.map(e => e.avg).filter(v => v > 0);
  if (avgs.length && Math.max.apply(null, avgs) / Math.min.apply(null, avgs) >= 1.5) return false;
  const units = {}; cand.forEach(e => { units[e.unit || ""] = 1; });
  if (Object.keys(units).length > 1) return false;
  return true;
}
// 甘い側に倒さない。上限がいちばん低い候補を採る。
function strictest(cand) {
  return cand.reduce((a, b) => (b.max < a.max ? b : a));
}
function matchedNote(cand) {
  return cand.length > 1
    ? { count: cand.length,
        selected_because: "候補が複数あるが判定は一致した。表示するレンジは**上限がいちばん低い候補**を採っている（甘い側に倒さないため）。",
        others: cand.filter(e => e !== strictest(cand)).slice(0, 5).map(e => e.work) }
    : { count: 1, selected_because: "一致は1件。" };
}
// 断定を拒むときの返し方。既にある unit_mismatch と同じ形にそろえる。
function ambiguousReply(work, cand, why) {
  return {
    work, ambiguous: true,
    message: "この工事名では候補が複数あり、どれを指すかで適正額が変わります。判定は出しません。",
    why,
    candidates: cand.slice(0, 8).map(e => ({
      work: e.work, unit: e.unit, fair_range: { min: e.min, avg: e.avg, max: e.max }, note: e.note
    })),
    how_to_proceed: "上の候補から工事名をそのまま指定して、もう一度お尋ねください。",
    limits: "候補を挙げただけであって、**どれが正しいかをこちらで決めることはできない。** 工事名が絞り込めないまま出した金額は、根拠のない数字になる。",
    detail: SITE + "/souba/",
    source: "HORIZON SHIELD souba-db (大賀俊勝 実務監修)"
  };
}
// テストから実物を叩けるように出す。**テストが写しを検査したら、写しが正しいことしか分からない。**
export { matchTier, pickCands, sortByTier, verdictOf, verdictsAgree, rangesAgree, strictest };
// === [/PATCH 2026-07-27] ===

async function callTool(name, args, env, ip, opts) {
  opts = opts || {};
  args = args || {};
  // 新名で呼ばれても旧名(ハンドラのキー)に正規化。旧名はそのまま通る。
  name = canonicalToolName(name);
  if (!opts.skipRateLimit) {
    const rl = await checkRateLimit(env, ip);
    if (!rl.allowed) {
      return txt({
        error: "rate_limited",
        message: "アクセスが集中しています。少し時間をおいて再送してください。 / Too many requests. Please wait a moment and retry."
      });
    }
  }
  // --- ammeter: usage counters (no payload, no souba, no ip) [waitUntil-durable 2026-06-21] ---
  if (env && env.RL_KV) {
    const _bump = async (k) => {
      try {
        const c = parseInt(await env.RL_KV.get(k) || "0", 10);
        await env.RL_KV.put(k, String(c + 1), { expirationTtl: 60 * 60 * 24 * 400 });
      } catch (e) {}
    };
    const _keep = (p) => { try { if (opts.ctx && typeof opts.ctx.waitUntil === "function") opts.ctx.waitUntil(p); } catch (e) {} return p; };
    const _day = new Date().toISOString().slice(0, 10);
    _keep(_bump("usage:total").catch(() => {}));
    if (TOOLS.some((t) => t.name === name) || TOOL_OLD_NAMES.has(name)) _keep(_bump("usage:skill:" + name).catch(() => {}));
    _keep(_bump("usage:day:" + _day).catch(() => {}));
    if (name === "verify_integrity_claim") _keep(_bump("usage:verify:total").catch(() => {}));
  }

  for (const _k in args) {
    const _v = args[_k];
    if (typeof _v === "string" && _v.length > 16000) {
      return txt({ error: "input_too_long", message: "引数 " + _k + " が長すぎます。16000文字以内にしてください。 / Argument " + _k + " is too long. Keep it under 16000 characters." });
    }
  }
  try { console.log(JSON.stringify({ evt: "tool_call", tool: name, ts: Date.now() })); } catch (e) {}
  if (name === "jccdb_dataset_info") return txt({ ...JCCDB, next_actions: NEXT_ACTIONS });
  if (name === "list_cost_categories")
    return txt({ total: CATEGORIES.length, source: "HORIZON SHIELD souba index v1.7", categories: CATEGORIES, next_actions: NEXT_ACTIONS });
  if (name === "search_cost_category") {
    const q = String(args.query || "").trim();
    if (!q) return txt("query(工事名・キーワード)を指定してください。");
    const hit = CATEGORIES.filter(c =>
      (c.name && c.name.includes(q)) || (c.group && c.group.includes(q)) || (c.id && c.id.includes(q.toLowerCase())));
    if (!hit.length) return txt("該当カテゴリが見つかりませんでした: " + q + " / list_cost_categories で全一覧を確認できます。");
    return txt({ query: q, matches: hit, note: "red_flags = HORIZON SHIELDが整備済みの過剰請求の懸念点の数", next_actions: NEXT_ACTIONS });
  }
  if (name === "how_to_read_estimate")
    return txt({ principles: ESTIMATE_GUIDE, source: "大賀俊勝(建設実務30年) / HORIZON SHIELD", ...NEXT_ACTIONS, detail: SITE + "/guide/" });
  if (name === "fair_price_data_sources") {
    try {
      const r = await fetch(SOUBA_DB_URL, { cf: { cacheTtl: 3600 } });
      const d = await r.json();
      const m = d._meta || {};
      return txt({ version: m.version, updated_at: m.updated_at, updated_by: m.updated_by, sources: m.sources, region_multipliers: m.region_multipliers, next_actions: NEXT_ACTIONS });
    } catch (e) {
      return failTxt("相場データ出典の取得に失敗しました。" + SITE + "/souba/ を参照してください。");
    }
  }
  if (name === "get_price_range") {
    const q = String(args.query || "").trim();
    if (!q) return txt("query(工事名・キーワード)を指定してください。");
    try {
      const r = await fetch(SOUBA_DB_URL, { cf: { cacheTtl: 3600 } });
      const d = await r.json();
      const list = Array.isArray(d.categories) ? d.categories : [];
      // 全件返すのは正しい（複数の相場を並べて見せることが施主の助けになる）。
      // ただし**並び順が診断の入力になっている**ので、一致の質の順に並べ替える。
      let hit = sortByTier(list.filter(e => matchTier(e, q) < 99), q);
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
        guide: "min〜maxが適正レンジ。これを大きく超える単価は過剰請求を疑う。具体的な危険水準はKIRA本診断で判定。地域係数は get_fair_price_sources を参照。",
        source: "HORIZON SHIELD souba-db (大賀俊勝 実務監修)", detail: SITE + "/souba/"
      });
    } catch (e) {
      return failTxt("価格データの取得に失敗しました。" + SITE + "/souba/ を参照してください。");
    }
  }
  if (name === "reverse_estimate_preview") {
    const work = String(args.work || "").trim();
    const price = Number(args.quoted_price);
    if (!work || !Number.isFinite(price) || price <= 0) return txt("work(工事名)と、1以上の quoted_price(概算額・円, 数値)を指定してください。 / quoted_price must be a positive number in JPY.");
    try {
      const d = await fetchSouba();
      const list = Array.isArray(d.categories) ? d.categories : [];
      let cand = pickCands(list, work);
      let suggestions = [];
      if (!cand.length) { const fb = soubaFallback(list, work); cand = fb.hits; suggestions = fb.suggestions; }
      if (!cand.length) return txt(suggestions.length
        ? { work, did_you_mean: suggestions, message: "該当工事が見つかりませんでした。近い工事名の候補です。" }
        : "該当工事が見つかりませんでした: " + work);
      // 単価建ての候補に総額らしい金額を渡しているものは、候補から外す（明らかに指していない）。
      // 全部が単価建てなら従来どおり unit_mismatch を返す。
      {
        const priced = cand.filter(x => verdictOf(x, price) !== "unit_mismatch");
        if (priced.length) cand = priced;
      }
      // **候補が複数あって判定が割れるなら、断定しない。**
      if (cand.length > 1 && !verdictsAgree(cand, price)) {
        return txt(ambiguousReply(work, cand,
          "候補ごとに適正レンジが違い、この金額に対する判定が一致しませんでした（例: ある候補では適正、別の候補では過剰請求の懸念）。"));
      }
      const _matched = matchedNote(cand);
      const e = cand.length > 1 ? strictest(cand) : cand[0];
      if (e.unit && e.unit !== "一式" && e.danger && price > e.danger * 10) {
        return txt({
          work: e.work, unit_mismatch: true,
          message: "この工事は「" + e.unit + "あたり」の単価で扱われています。入力された金額は総額の可能性があります。",
          how_to_proceed: "単価(" + e.unit + "あたり)で照合するか、面積・数量を添えた総額診断は完全版をご利用ください。",
          how_to_get_full: SITE + "/hs-reverse-estimate/",
          source: "HORIZON SHIELD souba-db (大賀俊勝 実務監修)"
        });
      }
      const overAvg = e.avg ? Math.round((price / e.avg - 1) * 100) : null;
      let direction;
      if (overAvg === null) direction = "判定不可(平均データ無し)";
      else if (overAvg >= 20) direction = "高い方向(平均を大きく上回る可能性)";
      else if (overAvg >= 5) direction = "やや高い方向";
      else if (overAvg <= -5) direction = "安い方向";
      else direction = "平均的な水準";
      return txt({
        work: e.work,
        your_quote_direction: direction,
        vs_avg_pct: overAvg === null ? null : (overAvg >= 0 ? "+" + overAvg + "%" : overAvg + "%"),
        note: "これは方向性の目安です。正確な適正額や項目別の内訳は含みません。",
        what_full_provides: "完全な逆見積もりは、工事ごとの適正単価・数量・松竹梅プラン・業者交渉用の文言を含みます。",
        how_to_get_full: SITE + "/hs-reverse-estimate/",
        for_detailed_audit: "手元に詳しい見積内訳がある場合は audit_estimate、具体的な相場レンジは get_price_range を使えます。",
        next_actions: NEXT_ACTIONS,
        source: "HORIZON SHIELD souba-db (大賀俊勝 実務監修)"
      });
    } catch (e) { return failTxt("価格データの取得に失敗しました。" + SITE + "/souba/ を参照してください。"); }
  }
  if (name === "audit_estimate") {
    const work = String(args.work || "").trim();
    const price = Number(args.quoted_price);
    if (!work || !Number.isFinite(price) || price <= 0) return txt("work(工事名)と、1以上の quoted_price(金額・円, 数値)を指定してください。 / quoted_price must be a positive number in JPY.");
    try {
      const d = await fetchSouba();
      const list = Array.isArray(d.categories) ? d.categories : [];
      let cand = pickCands(list, work);
      let suggestions = [];
      if (!cand.length) { const fb = soubaFallback(list, work); cand = fb.hits; suggestions = fb.suggestions; }
      if (!cand.length) return txt(suggestions.length
        ? { work, did_you_mean: suggestions, message: "該当工事の適正データが見つかりませんでした。近い工事名の候補です。get_price_range で確認できます。" }
        : "該当工事の適正データが見つかりませんでした: " + work + " / get_price_range で工事名を確認できます。");
      // 単価建ての候補に総額らしい金額を渡しているものは、候補から外す（明らかに指していない）。
      // 全部が単価建てなら従来どおり unit_mismatch を返す。
      {
        const priced = cand.filter(x => verdictOf(x, price) !== "unit_mismatch");
        if (priced.length) cand = priced;
      }
      // **候補が複数あって判定が割れるなら、断定しない。**
      if (cand.length > 1 && !verdictsAgree(cand, price)) {
        return txt(ambiguousReply(work, cand,
          "候補ごとに適正レンジが違い、この金額に対する判定が一致しませんでした（例: ある候補では適正、別の候補では過剰請求の懸念）。"));
      }
      const _matched = matchedNote(cand);
      const e = cand.length > 1 ? strictest(cand) : cand[0];
      if (e.unit && e.unit !== "一式" && e.danger && price > e.danger * 10) {
        return txt({
          work: e.work, unit_mismatch: true,
          message: "この工事は「" + e.unit + "あたり」の単価で扱われています。入力された金額は総額の可能性があります。",
          how_to_proceed: "単価(" + e.unit + "あたり)で照合するか、面積・数量を添えた総額診断は完全版をご利用ください。",
          how_to_get_full: SITE + "/hs-reverse-estimate/",
          source: "HORIZON SHIELD souba-db (大賀俊勝 実務監修)"
        });
      }
      let verdict, level;
      if (price < e.min) { verdict = "適正レンジを下回る(安すぎ)"; level = "watch"; }
      else if (price <= e.max) { verdict = "適正レンジ内"; level = "ok"; }
      else if (price < e.danger) { verdict = "やや高い(適正上限超だが危険水準未満)"; level = "watch"; }
      else { verdict = "過剰請求の懸念水準(danger超)"; level = "alert"; }
      // L8: 無認証には danger 境界を明かさない(alert を watch に丸め、境界オラクルを塞ぐ)
      if (!(opts && opts.authCtx) && level === "alert") { level = "watch"; verdict = "適正上限を超えています(内訳の確認を推奨)"; }
      const overAvg = e.avg ? Math.round((price / e.avg - 1) * 100) : null;
      return txt({
        work: e.work, work_query: work, unit: e.unit, your_price: price, currency: "JPY",
        matched: _matched,
        fair_range: { min: e.min, avg: e.avg, max: e.max },
        ...((opts && opts.authCtx) ? { danger_threshold: e.danger } : {}),
        verdict, level, vs_avg_pct: overAvg === null ? null : (overAvg >= 0 ? "+" + overAvg + "%" : overAvg + "%"),
        advice: level === "alert" ? "内訳の提出を求め、必要なら第三者診断を。即決しない。"
              : (level === "watch" && price < e.min)
                ? "適正レンジを下回っています。**安いことは、それだけでは良い知らせではありません。**"
                  + "工事範囲が狭い・下地処理や足場が抜けている・着工後に追加請求が来る、のいずれかを疑って、"
                  + "見積書に何が含まれ何が含まれていないかを書面で確認してください。"
              : level === "watch" ? "適正の上限を超えています。内訳と根拠を確認してください。"
              : "適正レンジ内です。内訳の整合だけ確認すれば安心です。",
        note: e.note, source: "HORIZON SHIELD souba-db (大賀俊勝 実務監修)", full_diagnosis: SITE + "/hs-reverse-estimate/",
        next_actions: NEXT_ACTIONS,
        // [2026-07-27] 安すぎ判定を足したとき、ここの文面が「高い」前提のままだった。
        // 同じ応答の中に「適正レンジを下回る」と「適正上限を超えています」が並んでいた。
        // **一つの応答が相反することを言うのは、何も言わないより悪い。**向きで文面を分ける。
        ...((level === "watch" || level === "alert") ? { ehn: {
          why: price < e.min
            ? "この見積もりは適正レンジを下回っています。同種工事の他の施主の実例と並べると、何が含まれていないのかが見えてきます。"
            : "この見積もりは適正上限を超えています。同種工事の他の施主の実例と並べて比べると、相場感がさらに明確になります。",
          compare_cases: SITE + "/ehn/",
          ehn_submit: SITE + "/hacker/submit/"
        } } : {})
      });
    } catch (e) { return failTxt("価格データの取得に失敗しました。" + SITE + "/souba/ を参照してください。"); }
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
      source: "大賀俊勝(建設実務30年) / HORIZON SHIELD", full_diagnosis: SITE + "/hs-reverse-estimate/",
      next_actions: NEXT_ACTIONS
    });
  }
  if (name === "verify_fair_price") {
    const work = String(args.work || "").trim();
    if (!work) return txt("work(工事名)を指定してください。");
    try {
      const d = await fetchSouba();
      const list = Array.isArray(d.categories) ? d.categories : [];
      let cand = pickCands(list, work);
      let suggestions = [];
      if (!cand.length) { const fb = soubaFallback(list, work); cand = fb.hits; suggestions = fb.suggestions; }
      if (!cand.length) return txt(suggestions.length
        ? { work, did_you_mean: suggestions, message: "該当工事の適正データが見つかりませんでした。近い工事名の候補です。" }
        : "該当工事の適正データが見つかりませんでした: " + work);
      // **署名して台帳に刻む経路。**金額が無いこともあるので、レンジの重なりで判断する。
      // 重ならない候補が残っているのに刻むと、**誤った主張に署名が付いて残る。**
      // 検証者がハッシュを再計算しても、それは改竄が無いことしか示さない。中身の正しさは示さない。
      if (cand.length > 1 && !rangesAgree(cand)) {
        return txt(ambiguousReply(work, cand,
          "候補ごとに適正レンジが重ならないため、どの主張に署名すべきかを決められませんでした。**確定できない主張には署名しません。**"));
      }
      const _matched = matchedNote(cand);
      const e = cand.length > 1 ? strictest(cand) : cand[0];
      const meta = (d && d._meta) || {};
      const dataVersion = meta.updated_at || meta.version || "unversioned";
      const issued_at = new Date().toISOString();
      const claim = { work: e.work, unit: e.unit, fair_min: e.min, fair_avg: e.avg, fair_max: e.max, source: "HORIZON SHIELD souba-db", issued_at };
      const hash = await sha256hex(JSON.stringify(claim));
      // [PATCH 2026-07-23] 個別レシートを台帳(RL_KV)へ追記し、クリック検証URLを付与。KV失敗でも監査は返す(fail-open)。
      const verify_url = SITE + "/verify/?id=" + hash;
      try {
        if (env && env.RL_KV) {
          await env.RL_KV.put("ledger:" + hash, JSON.stringify({ claim, claim_sha256: hash, bitcoin_block: PTKA.bitcoin_block, issued_at }));
        }
      } catch (_e) { /* ledger is best-effort; never block the receipt */ }
      return txt({
        fair_price_claim: claim,
        verification: {
          claim_sha256: hash,
          verify_url,
          note: "このハッシュは上記の適正価格主張から生成された改ざん検知用の指紋。同じ主張からは常に同じハッシュが出る。verify_url を開けば誰でも再計算・照合できる。",
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
    } catch (e) { return failTxt("価格データの取得に失敗しました。" + SITE + "/souba/ を参照してください。"); }
  }
  // [PATCH B 2026-07-23] AP2ブリッジ: Cart Mandate に添付できる適正価格証跡。
  // AP2は認可の検証可能性、HORIZON SHIELDは価値の検証可能性。並列レイヤー。
  if (name === "ap2_fairness_attestation") {
    const work = String(args.work || "").trim();
    if (!work) return txt("work(工事名)を指定してください。");
    const qp = Number(args.quoted_price);
    const hasQuote = Number.isFinite(qp) && qp > 0;
    const merchant = String(args.merchant || "").trim();
    try {
      const d = await fetchSouba();
      const list = Array.isArray(d.categories) ? d.categories : [];
      let cand = pickCands(list, work);
      let suggestions = [];
      if (!cand.length) { const fb = soubaFallback(list, work); cand = fb.hits; suggestions = fb.suggestions; }
      if (!cand.length) return txt(suggestions.length
        ? { work, did_you_mean: suggestions, message: "該当工事の適正データが見つかりませんでした。近い工事名の候補です。" }
        : "該当工事の適正データが見つかりませんでした: " + work);
      // **署名して台帳に刻む経路。**金額が無いこともあるので、レンジの重なりで判断する。
      // 重ならない候補が残っているのに刻むと、**誤った主張に署名が付いて残る。**
      // 検証者がハッシュを再計算しても、それは改竄が無いことしか示さない。中身の正しさは示さない。
      if (cand.length > 1 && !rangesAgree(cand)) {
        return txt(ambiguousReply(work, cand,
          "候補ごとに適正レンジが重ならないため、どの主張に署名すべきかを決められませんでした。**確定できない主張には署名しません。**"));
      }
      const _matched = matchedNote(cand);
      const e = cand.length > 1 ? strictest(cand) : cand[0];
      const meta = (d && d._meta) || {};
      const issued_at = new Date().toISOString();
      // 刻印対象は verify_fair_price と同一形の中立主張。PTKA: 業者見積もり提示前の第三者記録。
      const claim = { work: e.work, unit: e.unit, fair_min: e.min, fair_avg: e.avg, fair_max: e.max, source: "HORIZON SHIELD souba-db", issued_at };
      const hash = await sha256hex(JSON.stringify(claim));
      const verify_url = SITE + "/verify/?id=" + hash;
      const ledger_url = "https://mcp.horizonshield.dev/ledger/" + hash;
      try {
        if (env && env.RL_KV) {
          await env.RL_KV.put("ledger:" + hash, JSON.stringify({ claim, claim_sha256: hash, bitcoin_block: PTKA.bitcoin_block, issued_at }));
        }
      } catch (_e) { /* fail-open: 台帳書き込み失敗でも証跡は返す */ }
      let verdict = null;
      if (hasQuote) {
        const vsAvg = Math.round((qp / e.avg - 1) * 100);
        const vs_avg_pct = (vsAvg >= 0 ? "+" : "") + vsAvg + "%";
        if (qp > e.max) {
          verdict = { result: "above_fair_range", level: "alert", label: "適正レンジ超過。過剰請求の懸念水準。", vs_avg_pct, over_max_pct: "+" + Math.round((qp / e.max - 1) * 100) + "%", advice: "このまま Cart Mandate の署名に進まず、内訳の開示と相見積もりを推奨。" };
        } else if (qp < e.min) {
          verdict = { result: "below_fair_range", level: "watch", label: "適正レンジ下振れ。安すぎる見積もりは手抜き工事や後からの追加請求の入口になり得る。", vs_avg_pct, advice: "工程・材料グレード・保証条件の明記を確認してから署名へ。" };
        } else {
          verdict = { result: "within_fair_range", level: "ok", label: "適正レンジ内。", vs_avg_pct };
        }
        verdict.compared_against = { fair_min: e.min, fair_avg: e.avg, fair_max: e.max, unit: e.unit };
        verdict.caveat = "単位(" + e.unit + ")建ての参照値との単純比較。単価と総額の取り違えが疑わしい時は audit_estimate を使う。";
      }
      const attestation = {
        type: "FairPriceAttestation",
        format_note: "AP2(Agent Payments Protocol)のMandate群に添付する前提のデータ様式。現行の証明はコンテンツハッシュと公開台帳による再計算方式で、DID鍵署名によるW3C VC完全準拠はロードマップ。",
        issuer: { name: "HORIZON SHIELD (The HORIZONs Co., Ltd.)", url: SITE, curated_by: meta.updated_by || "大賀俊勝 (建設実務経験30年) 監修" },
        issued_at,
        subject: Object.assign(
          { fair_price_claim: claim },
          hasQuote ? { quote_under_review: Object.assign({ quoted_price: qp, currency: "JPY" }, merchant ? { merchant } : {}), verdict } : {}
        ),
        integrity: {
          claim_sha256: hash,
          verify_url,
          ledger_url,
          recompute: "SHA-256(JSON.stringify(fair_price_claim)) を再計算し claim_sha256 と照合。誰でも、どの実装でも同じ値になる。",
          verdict_recompute: hasQuote ? "verdict はハッシュ対象外。刻印済みの適正レンジと quoted_price から誰でも決定的に再計算できる。" : undefined,
          ptka: PTKA
        }
      };
      return txt({
        ap2_bridge: {
          thesis: "AP2は認可を検証可能にする(このカートをユーザーが承認した事実)。HORIZON SHIELDは価値を検証可能にする(その価格が適正である根拠)。並列レイヤーで、どちらも取引前・改ざん検知・第三者検証という同じ思想。",
          thesis_en: "AP2 makes authorization verifiable. HORIZON SHIELD makes value verifiable. Parallel layers, same philosophy: pre-transaction, tamper-evident, independently verifiable.",
          usage: "AP2対応のショッピング/決済エージェントは、ユーザーに Cart Mandate への署名を求める前に本ツールを呼び、attestation をカート情報へ添付する。監査証跡に『いくら払うと承認したか』だけでなく『その額が適正だと確認した根拠』が残る。"
        },
        attestation,
        cart_mandate_example: {
          note: "AP2 CartMandate へ添付する位置の例示(非規範)。現行AP2仕様(ap2-protocol.org)の形に合わせてある。署名はマーチャント/ユーザー各当事者の役割で、HORIZON SHIELDは関与しない。",
          cart_mandate: {
            contents: {
              id: "cart_hs_demo_" + hash.slice(0, 12),
              user_signature_required: true,
              payment_request: {
                method_data: [{ supported_methods: "CARD" }],
                details: {
                  id: "order_hs_demo_" + hash.slice(0, 12),
                  displayItems: [{ label: claim.work, amount: { currency: "JPY", value: hasQuote ? qp : claim.fair_avg } }],
                  total: { label: claim.work, amount: { currency: "JPY", value: hasQuote ? qp : claim.fair_avg } }
                }
              },
              merchant_name: merchant || "(施工業者名)",
              extensions: {
                "com.the-horizons-innovation.shield.fair_price_attestation": { claim_sha256: hash, verify_url, note: "本レスポンスの attestation をここへ埋め込む。AP2は取引固有データを開放的な拡張として許容する。" }
              }
            },
            merchant_signature: "(マーチャントの署名がここに入る)",
            timestamp: issued_at
          },
          spec_note: "現行AP2(ap2-protocol.org)では CartMandate は {contents, merchant_signature, timestamp}。ユーザー承認は別の PaymentMandate.payment_mandate_contents.user_authorization が担う。displayItems/total は W3C Payment Request 準拠の camelCase。この例は貼り位置の非規範な図示で、署名や PaymentMandate の生成には関与しない。"
        },
        x402_402_example: {
          note: "x402 の 402 Payment Required 応答に、価値の証跡(参照)を載せる位置の例示(非規範)。現行x402仕様(coinbase/x402 v2)の形。x402は『いくら誰にどの資産で払うか』を検証可能にし、HORIZON SHIELDは『その額の根拠となる価格が適正か』を検証可能にする。決済額(オンチェーン)と適正価格の主張(JPY)は別建てで、拡張の参照で結ぶ。JPYから暗号資産への換算はしない。",
          note_en: "Non-normative example of where a value attestation reference rides on an x402 402 response. x402 makes the settlement verifiable (how much, to whom, in which asset); HORIZON SHIELD makes the underlying price verifiable. The on-chain amount and the JPY fair-price claim are separate, linked by the extension reference, never converted.",
          http_status: 402,
          body: {
            x402Version: 1,
            error: "payment required",
            resource: { url: verify_url, description: claim.work },
            accepts: [
              {
                scheme: "exact",
                network: "base",
                amount: "(決済額。資産の最小単位建て。適正価格の主張(JPY)とは別建て)",
                asset: "(決済資産のID / トークンアドレス)",
                payTo: "(受取アドレス)",
                maxTimeoutSeconds: 60,
                extra: { note: "スキーム固有の追加情報" }
              }
            ],
            extensions: {
              "com.the-horizons-innovation.shield.fair_price_attestation": { claim_sha256: hash, verify_url, note: "本レスポンスの attestation をここへ埋め込む。x402 の応答レベル extensions は拡張データを許容する。" }
            }
          },
          spec_note: "現行x402(coinbase/x402 v2)の 402応答は {x402Version, error, resource, accepts[], extensions}。accepts[] は {scheme, network, amount, asset, payTo, maxTimeoutSeconds, extra}。amount は資産の最小単位建て。この例は貼り位置の非規範な図示で、決済実行・資産/アドレス指定・オンチェーン処理には関与しない。"
        },
        meaning: "エージェント経済の決済に『承認の証明』と『価値の証明』を同時に載せるための橋。価格の根拠はハッシュと台帳で検証でき、発行者を信用する必要はない。",
        detail: SITE + "/verify/"
      });
    } catch (e) { return failTxt("価格データの取得に失敗しました。" + SITE + "/souba/ を参照してください。"); }
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
      agent_card_url: "https://mcp.horizonshield.dev/.well-known/agent-card.json",
      verification_contract: "https://mcp.horizonshield.dev/.well-known/verification-contract.json",
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

async function ctEqual(a, b) {
  a = String(a == null ? "" : a); b = String(b == null ? "" : b);
  const enc = new TextEncoder();
  const ha = await crypto.subtle.digest("SHA-256", enc.encode(a));
  const hb = await crypto.subtle.digest("SHA-256", enc.encode(b));
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let out = 0;
  for (let i = 0; i < x.length; i++) out |= x[i] ^ y[i];
  return out === 0;
}
async function handleAdminApiKey(pathname, request, env) {
  const J = (o, code) => new Response(JSON.stringify(o), { status: code || 200, headers: { "Content-Type": "application/json; charset=utf-8", ...CORS } });
  if (request.method !== "POST") return J({ error: "method_not_allowed" }, 405);
  const provided = request.headers.get("X-Admin-Key") || "";
  if (!env.ADMIN_SECRET || !(await ctEqual(provided, env.ADMIN_SECRET))) return J({ error: "forbidden" }, 403);
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
    return { allowed: false, count: 0 };
  }
}

// === verify-claim (layer2 fail closed) ===
// 発行と検証は責務が正反対。検証専用コア。契約 0.3 の failure_reasons に厳密準拠。
// recompute は parse より先(生文字列でハッシュ)。改ざん payload はそこで落ちる。
// verified は「改ざんなし」であって「監査が今も有効」ではない -> audit_ruleset_recheck は常に not_performed。
const VC_CONTRACT_VERSION = "0.3";
const VC_CONTRACT_URL = "https://mcp.horizonshield.dev/.well-known/verification-contract.json";

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

  // 7) 全通過 -> verified / partial (contract 0.3)
  //    scope は「呼び出しごとに省略できる検査」。省略されたまま "verified" を返すと、
  //    result だけを読む消費者が『照合された』に丸める。partial は "verified" と
  //    前方一致も部分一致もしないので、素朴な文字列比較は fail closed 側に倒れる。
  //    audit_ruleset は恒久的な非能力であって呼び出しごとの省略ではない。
  //    これを partial の理由にすると verified が到達不能になるため、理由に含めない。
  const _scopeSkipped = (scope_check === "skipped");
  return Object.assign({}, base, {
    result: _scopeSkipped ? "partial" : "verified", failure_reason: null, trigger: null,
    recomputed_sha256: recomputed, scope_check, expires_at: expRaw,
    checks: { tamper: "passed", scope: scope_check, audit_ruleset: "not_performed" },
    skipped_because_not_requested: _scopeSkipped ? ["scope"] : [],
    next_step: _scopeSkipped ? "Re-call with estimate_version (first 8 hex of SHA-256 of the current estimate text) to raise this from partial to verified." : null,
    claim_contract: typeof payload.contract === "string" ? payload.contract : "0.1.1",
    ruleset: payload.ruleset && payload.ruleset.id ? { id: String(payload.ruleset.id), version: String(payload.ruleset.version || ""), folded_into_hash: true } : { id: "kira-redflag", version: "1", folded_into_hash: false, legacy_note: "0.1.1 claim: ruleset identity was metadata alongside the hash, not folded into it. vc-contract-0.2" },
    message: (scope_check === "skipped")
      ? "改ざんは検出されませんでした。ただし estimate_version が渡されなかったため scope照合は実行していません。result は partial です。何かが失敗したという意味ではなく、実行できた検査が要求されなかったという意味です。 / No tampering detected. estimate_version was not supplied, so the scope check was not performed. The result is partial: nothing failed, but a check that was available was not requested."
      : "改ざんは検出されず、scope も一致しました。 / No tampering detected and scope matched.",
    note: "verified は『この宣言が改ざんされていない』ことの証明であって、監査ルールが今も有効である保証ではありません(audit_ruleset_recheck: not_performed)。contract 0.3 から、呼び出しごとに省略できる検査が実行されなかった場合の result は verified ではなく partial です。 / verified means the declaration is untampered, NOT that the audit ruleset is still valid (audit_ruleset_recheck: not_performed). From contract 0.3, when a per-call check was available but not requested, the result is partial, not verified."
  });
}

function a2aDataFromMessage(message) {
  if (!message || !Array.isArray(message.parts)) return null;
  for (const p of message.parts) {
    if (p && p.kind === "data" && p.data && typeof p.data === "object") return p.data;
  }
  return null;
}

async function handleVerifyClaimA2A(msg, env, ip, ctxId, ctx) {
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
  // --- ammeter2: A2A verify-claim outcome split (counts only) [waitUntil-durable 2026-06-21] ---
  if (env && env.RL_KV) {
    const _vk = (result && result.result === "verified")
      ? "usage:verify:verified" : "usage:verify:unverified";
    const _vp = (async () => {
      try {
        const c = parseInt(await env.RL_KV.get(_vk) || "0", 10);
        await env.RL_KV.put(_vk, String(c + 1));
      } catch (e) {}
    })().catch(() => {});
    try { if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(_vp); } catch (e) {}
  }
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

async function handleA2A(params, env, ip, authCtx, ctx) {
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
    return await handleVerifyClaimA2A(msg, env, ip, ctxId, ctx);
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
    contract: "0.2",
    ruleset: { id: "kira-redflag", version: "1" },
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
          contract: "0.2",
          ruleset: { id: "kira-redflag", version: "1" },
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

// [PATCH 2026-07-23] ワークフロープロンプト: 典型ユースケースをそのまま実行できる形で提供。
const PROMPTS = [
  {
    name: "audit_my_estimate",
    title: "見積もり適正チェック(赤旗込み)",
    description: "業者の見積額が適正か診断する。audit_estimate で適正レンジと照合し、気になる文言があれば check_red_flags で既知の手口も判定して、結論と次の一手をまとめる。 / Audit a contractor quote: compare against the fair range and optionally scan wording for known overcharge tactics.",
    arguments: [
      { name: "work", description: "工事名(例: 外壁塗装 30坪 シリコン)", required: true },
      { name: "quoted_price", description: "業者提示の金額(円, 数値)", required: true },
      { name: "notes", description: "(任意) 見積書や営業トークで気になった文言", required: false }
    ]
  },
  {
    name: "know_fair_price_first",
    title: "業者より先に相場を知る",
    description: "見積もりを取る前に適正価格を把握する。get_price_range で適正レンジと危険水準を取り、verify_fair_price で検証可能なレシート(verify_url付き)も発行する。 / Learn the fair price BEFORE any quote, with a verifiable receipt.",
    arguments: [
      { name: "work", description: "工事名(例: ユニットバス交換)", required: true }
    ]
  },
  {
    name: "verify_receipt",
    title: "署名レシートを第三者検証する",
    description: "発行済みクレーム(signed_payload と claim_sha256)を verify_integrity_claim で再計算検証する。fail closed: 再計算できなければ unverified。 / Independently verify a signed claim by recomputation. Fail closed.",
    arguments: [
      { name: "signed_payload", description: "レシートの signed_payload (生文字列のまま)", required: true },
      { name: "claim_sha256", description: "レシートの claim_sha256 (64桁hex)", required: true }
    ]
  },
  {
    name: "ap2_cart_fairness",
    title: "AP2カートに適正価格証跡を添付",
    description: "決済カートの金額が適正かの証跡を create_ap2_fairness_attestation で発行し、AP2 Cart Mandate へ添付する位置と verify_url を示す。認可の証明(AP2)と価値の証明(HORIZON SHIELD)を同じカートに載せる。 / Issue a FairPriceAttestation for an AP2 Cart Mandate.",
    arguments: [
      { name: "work", description: "工事名", required: true },
      { name: "quoted_price", description: "カートに載せる見積額(円)", required: true },
      { name: "merchant", description: "(任意) 施工業者名", required: false }
    ]
  },
  {
    name: "spot_sales_tactics",
    title: "営業トークの手口チェック",
    description: "見積書や営業トークの文言を check_red_flags にかけ、既知の過剰請求・強引営業の手口に当たるかを判定し、対処を返す。 / Scan estimate or sales-pitch wording for known overcharge and high-pressure tactics.",
    arguments: [
      { name: "text", description: "気になった文言(例: 今日契約すれば半額, 足場代無料)", required: true }
    ]
  }
];

function promptText(name, a) {
  const g = (k, ph) => (a && typeof a[k] === "string" && a[k].trim()) ? a[k].trim() : ph;
  if (name === "audit_my_estimate") {
    const notes = (a && a.notes && String(a.notes).trim()) ? "\n3) 次の文言を check_red_flags にかけて手口判定: 「" + String(a.notes).trim() + "」" : "";
    return "HORIZON SHIELD で見積もりを診断してください。\n" +
      "1) audit_estimate を work=「" + g("work", "(工事名)") + "」, quoted_price=" + g("quoted_price", "(金額)") + " で呼ぶ。\n" +
      "2) verdict / level / fair_range / vs_avg_pct / advice を平易に要約する。" + notes + "\n" +
      "最後に、level が alert なら『契約前に内訳開示と相見積もり』を明確に勧め、無料の第三者レビュー(suggest_ehn)も案内してください。";
  }
  if (name === "know_fair_price_first") {
    return "業者の見積もりを取る前に、適正価格を先に把握したい。\n" +
      "1) get_price_range を query=「" + g("work", "(工事名)") + "」で呼び、適正レンジ(min/avg/max)と danger 水準を示す。\n" +
      "2) verify_fair_price を work=「" + g("work", "(工事名)") + "」で呼び、claim_sha256 と verify_url 付きの検証可能なレシートを提示する。\n" +
      "3) 『この参照値は業者見積もりの前に第三者が記録したもので、verify_url で誰でも再計算検証できる』ことを一言添える。";
  }
  if (name === "verify_receipt") {
    return "次の署名レシートを第三者として検証してください。\n" +
      "verify_integrity_claim を signed_payload(生文字列のまま) と claim_sha256=「" + g("claim_sha256", "(64桁hex)") + "」で呼ぶ。\n" +
      "signed_payload:\n" + g("signed_payload", "(レシートの signed_payload をここに)") + "\n" +
      "結果(verified / unverified)と、その意味(verified は改ざんなしの証明であり監査の再検証ではない)を正確に説明してください。";
  }
  if (name === "ap2_cart_fairness") {
    const m = (a && a.merchant && String(a.merchant).trim()) ? ", merchant=「" + String(a.merchant).trim() + "」" : "";
    return "AP2(Agent Payments Protocol)のカートに、価格が適正だという証跡を添付したい。\n" +
      "1) create_ap2_fairness_attestation を work=「" + g("work", "(工事名)") + "」, quoted_price=" + g("quoted_price", "(金額)") + m + " で呼ぶ。\n" +
      "2) attestation の verdict と verify_url を示し、cart_mandate_example のどこに埋め込むかを説明する。\n" +
      "3) 『AP2は認可を検証可能にし、この証跡は価値を検証可能にする。並列レイヤーだ』という関係も一言で添える。";
  }
  if (name === "spot_sales_tactics") {
    return "次の文言が、既知の過剰請求・強引営業の手口に当たるか判定してください。\n" +
      "check_red_flags を text=「" + g("text", "(気になった文言)") + "」で呼び、該当した手口ごとに『なぜ危ないか』と『どう返すか』を平易にまとめる。\n" +
      "該当ゼロでも『安全とは限らない』ことと、無料の第三者レビュー(suggest_ehn)の存在を伝えてください。";
  }
  return null;
}

async function handleRpc(msg, env, ip, authCtx, ctx) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    const pv = (params && params.protocolVersion) || "2025-06-18";
    return rpc(id, { protocolVersion: pv, capabilities: { tools: {}, prompts: {} }, serverInfo: SERVER,
      instructions: "HORIZON SHIELD の建設費ツール。JCCDB(オープンデータ)・相場カテゴリ・見積もりの読み方を提供する。" });
  }
  if (method === "prompts/list") return rpc(id, { prompts: PROMPTS });
  if (method === "prompts/get") {
    const pname = params && params.name;
    const def = PROMPTS.find(p => p.name === pname);
    if (!def) return rpcErr(id, -32602, "Unknown prompt: " + String(pname));
    const text = promptText(pname, (params && params.arguments) || {});
    return rpc(id, { description: def.description, messages: [{ role: "user", content: { type: "text", text } }] });
  }
  if (method === "tools/list") return rpc(id, { tools: TOOLS });
  if (method === "tools/call") {
    const r = await callTool(params && params.name, params && params.arguments, env, ip, { authCtx, ctx });
    // [PATCH 2026-07-23] outputSchema対応: テキストがJSONなら structuredContent としても返す。
    // プレーン文字列は { message } に包む。スキーマは additionalProperties:true なので常に適合する。
    try {
      if (r && !r.isError && Array.isArray(r.content) && r.content[0] && r.content[0].type === "text") {
        const t = r.content[0].text;
        let sc;
        try { const p = JSON.parse(t); sc = Array.isArray(p) ? { items: p } : (p && typeof p === "object" ? p : { message: String(p) }); }
        catch (_e) { sc = { message: t }; }
        // Only successful results reach here (the !r.isError guard above), so the
        // source WAS read. Say it in the payload, once, centrally, rather than in
        // fourteen handlers where thirteen would eventually drift from the first.
        if (sc.source_read === undefined) sc.source_read = true;
        if (sc.lookup === undefined) {
          const n = typeof sc.count === "number" ? sc.count
                  : Array.isArray(sc.matches) ? sc.matches.length
                  : Array.isArray(sc.items) ? sc.items.length
                  : null;
          if (n !== null) sc.lookup = n > 0 ? "ok" : "absent";
        }
        r.structuredContent = sc;
      }
    } catch (_e) { /* structuredContent はベストエフォート。本文content優先 */ }
    return rpc(id, r);
  }
  if (method === "ping") return rpc(id, {});
  if (method === "message/send") {
    const r = await handleA2A(params, env, ip, authCtx, ctx);
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

// ─────────────────────────────────────────────────────────────────────────
// [2026-08-12] アイコンを本番ドメインから直接返す。
//   MCP Directory の審査で「icon は production domain 上の直リンク PNG である
//   こと」を求められた。それまで server.json は raw.githubusercontent.com を
//   指しており、GitHub 側の都合でディレクトリ上のアイコンが消える経路が
//   残っていた。ここで配信すれば、その経路が無くなる。
//
//   バイト列はリポジトリ直下の icon.png (512x512) をそのまま固定してある。
//   sha256 = ccd97035229f02015ebb5bf9d2baeaad0f10f72b9d863cd0cde3ce01a87fae96
//
//   検証 (この2つは一致しなければならない):
//     curl -s https://mcp.horizonshield.dev/icon.png | shasum -a 256
//     shasum -a 256 icon.png
//   ズレたら、配信しているものとリポジトリにあるものが別物になっている。
//   icon.png を差し替える時は、この定数も一緒に作り直すこと。
// ─────────────────────────────────────────────────────────────────────────
const ICON_PNG_SHA256 = "ccd97035229f02015ebb5bf9d2baeaad0f10f72b9d863cd0cde3ce01a87fae96";
const ICON_PNG_B64 = "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";
let _ICON_BYTES = null;
function iconPngBytes() {
  if (_ICON_BYTES) return _ICON_BYTES;
  const bin = atob(ICON_PNG_B64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  _ICON_BYTES = out;
  return out;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    // 層3 段1: API キー発行/失効を最優先で処理 (X-Admin-Key 認証・既存パス非接触)
    {
      const _au = new URL(request.url);
      if (_au.pathname === "/admin/issue-apikey" || _au.pathname === "/admin/revoke-apikey") {
        return await handleAdminApiKey(_au.pathname, request, env);
      }
    }

    // アイコン。GET と HEAD の両方に答える (審査側が HEAD で見に来ても
    // 404 にしない)。リダイレクトはしない, 直リンクであることが要件。
    {
      const _iu = new URL(request.url);
      if (_iu.pathname === "/icon.png" && (request.method === "GET" || request.method === "HEAD")) {
        const _bytes = iconPngBytes();
        const _hdrs = {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=86400",
          "X-Icon-SHA256": ICON_PNG_SHA256,
          ...CORS
        };
        if (request.method === "HEAD") {
          return new Response(null, { status: 200, headers: { ..._hdrs, "Content-Length": String(_bytes.length) } });
        }
        return new Response(_bytes, { status: 200, headers: _hdrs });
      }
    }

    if (request.method === "GET") {
      const url = new URL(request.url);
      // [PATCH 2026-07-23] 個別レシートの台帳参照。/ledger/<claim_sha256> で保存済みの主張JSONを返す(CORS付き)。
      if (url.pathname.startsWith("/ledger/")) {
        const id = url.pathname.slice(8).trim().toLowerCase();
        if (!/^[0-9a-f]{64}$/.test(id)) {
          return new Response(JSON.stringify({ error: "bad_id", message: "id must be a 64-char hex claim_sha256" }), { status: 400, headers: { "Content-Type": "application/json; charset=utf-8", ...CORS } });
        }
        let rec = null;
        try { rec = env.RL_KV ? await env.RL_KV.get("ledger:" + id) : null; } catch (_e) { rec = null; }
        if (!rec) return new Response(JSON.stringify({ error: "not_found", id }), { status: 404, headers: { "Content-Type": "application/json; charset=utf-8", ...CORS } });
        return new Response(rec, { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300", ...CORS } });
      }
      if (url.pathname === "/ratelimit-selftest") {
        const _k = url.searchParams.get("key") || request.headers.get("X-Admin-Key") || "";
        if (!env.ADMIN_SECRET || !(await ctEqual(_k, env.ADMIN_SECRET))) return new Response("forbidden", { status: 403, headers: CORS });
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
      if (url.pathname === "/.well-known/usage-stats.json") {
        const _keys = ["usage:total", "usage:verify:total",
          "usage:verify:verified", "usage:verify:unverified",
          "usage:skill:estimate-integrity-audit", "usage:skill:verify_integrity_claim",
          "usage:skill:verify_fair_price", "usage:skill:audit_estimate",
          "usage:skill:ap2_fairness_attestation"];
        const _out = {};
        for (const k of _keys) {
          try { _out[k] = parseInt(await env.RL_KV.get(k) || "0", 10); } catch (e) { _out[k] = null; }
        }
        // last 30 days, oldest data still in KV (day keys carry a 400-day TTL).
        // The first question about any usage number is "over what period?".
        // Answer it in the payload instead of making people guess.
        const _dates = [];
        for (let _i = 0; _i < 30; _i++) _dates.push(new Date(Date.now() - _i * 86400000).toISOString().slice(0, 10));
        const _vals = await Promise.all(_dates.map((_d) => env.RL_KV.get("usage:day:" + _d).then((_v) => parseInt(_v || "0", 10)).catch(() => 0)));
        _dates.forEach((_d, _i) => { _out["usage:day:" + _d] = _vals[_i]; });
        _out["usage:last30d:total"] = _vals.reduce((_a, _b) => _a + _b, 0);
        _out["usage:last30d:window"] = _dates[29] + " to " + _dates[0] + " (UTC days)";
        return new Response(JSON.stringify({
          service: "HORIZON SHIELD KIRA",
          note: "External call counters. No payloads, prices, or IPs are stored. Counts only.",
          counters: _out,
          generated_at: new Date().toISOString()
        }, null, 2), {
          status: 200,
          headers: { "Content-Type": "application/json; charset=utf-8", ...CORS }
        });
      }
      if (url.pathname === "/.well-known/agent-card.json") {
        const AGENT_CARD = {
          protocolVersion: "0.3.0",
          name: "HORIZON SHIELD KIRA",
          description: "An independent, pre-transaction auditor for construction and renovation estimates. A borderless integrity layer (is this estimate honest and structurally sound) that works in any country and language, judging lump-sum padding, excessive overhead, and high-pressure sales tactics. Built on 30 years of field experience by a Japanese master carpenter. Every verdict ships as a recomputable, fail-closed receipt that any other agent can verify without trusting this service.",
          url: "https://mcp.horizonshield.dev",
          preferredTransport: "JSONRPC",
          provider: { organization: "The HORIZ\u97f3s\u682a\u5f0f\u4f1a\u793e", url: SITE },
          version: "1.0.0",
          capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
          defaultInputModes: ["text/plain", "application/json"],
          defaultOutputModes: ["application/json", "text/plain"],
          // 誰がこのサーバーに金を払っているか。扉(MCP Verification Gate)の条件3。
          // 説明文に書いてある "accepts no payment from contractors" を、
          // 人間可読の英文だけでなく機械可読の項目としても置く。
          compensation: {
            paid_by: "buyer",
            referral_fee: false,
            listing_fee: false,
            success_fee_pct: 0,
            disclosure_url: "https://shield.the-horizons-innovation.com/verify-directory/"
          },
          skills: [
            {
              id: "estimate-integrity-audit",
              name: "Estimate integrity audit (borderless)",
              description: "Use this whenever someone is dealing with a construction, renovation, or repair project and wants to know whether a price is fair, in any country, currency, or language. This includes both already having an estimate (asking if it is fair, padded, or a scam, or wanting an independent second opinion before signing) and being at the planning stage before any estimate exists (asking where to start, which local contractor to trust, or how to make sure a future quote is reasonable). Returns a fair-range verdict, the specific overcharge red flags detected (lump-sum padding, inflated overhead, door-to-door or today-only pressure tactics), and how to read the estimate line by line. Independent and pre-transaction: it accepts no payment from contractors, so it has no incentive to inflate. Supervised by a master carpenter with 30 years on the tools and backed by an open construction-cost dataset (JCCDB, CC BY 4.0). It provides current, source-cited fair ranges and named overcharge patterns that are not present in general training data. Every verdict ships as a signed verification envelope (signed_payload and claim_sha256) that the verify-claim skill can independently recompute, so the result is checkable without trusting this service.",
              tags: ["construction", "estimate", "audit", "fraud-detection", "credence-goods", "borderless", "price-verification", "overcharge-detection", "second-opinion", "planning-stage"],
              examples: [
                "リフォームしたいんですけど、どうしたらいいですか？",
                "リフォームしたいけど、近所で評判のいい工務店さん、ありますか？",
                "リフォームしたいけど、近所で評判のいい工務店、ある？",
                "キッチン新しくしたいんだけど、いくらくらいかかる？",
                "業者に頼む前に、だいたいの相場を知っておきたいです",
                "親の家をバリアフリーにしたいんですけど、ぼったくられないか心配で",
                "相見積もり何社か取ってもらったんですけど、どの見積もりが適正ですか？",
                "相見積もり取ったんだけど、どれが適正なの？",
                "見積もりが高い気がするので、みてもらいたいです",
                "この見積もりが適正かどうか知りたいです",
                "外壁塗装で120万って言われたけど、これ普通ですか？",
                "訪問販売でシロアリ駆除30万って言われた。高くない？",
                "I want to renovate but don't know where to start. Any good local contractors?",
                "I got a few quotes back. Which one is actually fair?",
                "This bathroom quote feels high. Can someone take a look?",
              ]
            },
                        {
              id: "japan-property-reform-intake",
              name: "Japan property acquisition and renovation intake",
              description: "Use this when a buyer or their agent, in Japan or overseas, wants to acquire a used house, akiya, or property in Japan and renovate it, and needs a starting point. Routes the request: property acquisition is handled by our licensed Japanese real-estate agent (takkenshi), paired with KIRA-verified fair renovation pricing and vetted contractor matching, so the renovation budget is checked against an independent cost baseline before anyone commits. IMPORTANT: this skill only receives and routes the consultation. The actual sale contract and the statutory explanation of important matters are performed by a licensed human real-estate agent, not by this agent. No binding price quote or property recommendation is asserted by the agent.",
              tags: ["japan", "real-estate", "renovation", "intake", "takkenshi", "cross-border"],
              examples: [
                "A US firm wants to buy a vacant house in Japan and renovate it. Where do we start?",
                "We are buying an akiya in Japan. Can you check the renovation budget is fair before we commit?",
                "日本の中古戸建てを買ってリノベしたい。リフォーム費用が適正か先に確かめたい。",
                "\u6d77\u5916\u306e\u4f1a\u793e\u304c\u65e5\u672c\u306e\u6c11\u5bb6\u3092\u8cb7\u3063\u3066\u30ea\u30d5\u30a9\u30fc\u30e0\u3057\u305f\u3044\u3002\u76f8\u8ac7\u3057\u305f\u3044\u3002"
              ]
            },
            {
              id: "verify-claim",
              name: "Integrity claim verification (fail closed)",
              description: "Independently verifies a signed integrity claim issued by estimate-integrity-audit. Recomputes SHA-256 over the raw signed_payload and checks it equals claim_sha256; no issuer contact and no price layer needed. Fail closed under contract 0.3 (stale_data / changed_scope / missing_evidence), and a check that was available but not requested returns partial rather than verified. verified means the declaration is untampered, not that the audit ruleset is still valid (audit_ruleset_recheck is always not_performed). Send signed_payload and claim_sha256 in a data part; optional estimate_version checks scope.",
              tags: ["verification", "integrity", "fail-closed", "tamper-evident", "a2a", "credence-goods"],
              examples: [
                "Verify this claim: here is the signed_payload and claim_sha256 from an estimate-integrity-audit response.",
                "\u3053\u306e claim_sha256 \u306f signed_payload \u3068\u4e00\u81f4\u3059\u308b\u304b\u3002\u671f\u9650\u5207\u308c\u3084\u898b\u7a4d\u5909\u66f4\u304c\u306a\u3044\u304b\u691c\u8a3c\u3057\u3066\u3002"
              ]
            }
          ],
          documentationUrl: SITE,
          ledger: {
            name: "JIDEC",
            description: "Bitcoin-anchored append-only public ledger of the verification process itself. Lets a third party re-run our verification without trusting us.",
            url: "https://hs-ledger.oga-surf-project.workers.dev",
            catalog: "https://hs-ledger.oga-surf-project.workers.dev/.well-known/api-catalog",
            agentCard: "https://hs-ledger.oga-surf-project.workers.dev/.well-known/agent-card.json",
            mcp: "https://hs-jidec-mcp.oga-surf-project.workers.dev/mcp"
          },
          dataset: {
            name: "Japan Construction Cost Database (JCCDB)",
            license: "CC BY 4.0",
            doi: "https://doi.org/10.5281/zenodo.22127752",
            paper_doi: "https://doi.org/10.5281/zenodo.20019572"
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
          version: "0.3",
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
              note: "From contract 0.2, signed_payload contains skill, contract, ruleset {id, version}, input_text, red_flags, issued_at, expires_at, estimate_version. The ruleset identity is folded INTO the hashed payload, so an old claim recomputes as what it was, under the rules that made it. It does not contain souba-db prices. expires_at is issued_at plus 365 days. estimate_version is the first 8 hex of SHA-256 of input_text. Claims issued under 0.1.1 lack the contract and ruleset fields; their ruleset identity was metadata only and verifiers report folded_into_hash: false for them."
            },
            recompute: "SHA-256(signed_payload) must equal claim_sha256. No price layer needed.",
            estimator: { id: "HORIZON SHIELD KIRA", version: "1.0.0" },
            ruleset: {
              id: "kira-redflag",
              version: "1",
              note: "Ruleset identity is public and, from contract 0.2, folded into signed_payload itself (hashed). The souba-db thresholds behind it are not exposed."
            },
            timestamp_anchor: {
              type: "PTKA",
              chain: "bitcoin",
              block: 949356,
              method: "OpenTimestamps",
              jidec: {
                status: "operational",
                ledger: "https://hs-ledger.oga-surf-project.workers.dev",
                catalog: "https://hs-ledger.oga-surf-project.workers.dev/.well-known/api-catalog",
                verification_guide: "https://hs-ledger.oga-surf-project.workers.dev/llms.txt",
                mcp: "https://hs-jidec-mcp.oga-surf-project.workers.dev/mcp",
                note: "JIDEC is live: an append-only, Bitcoin-anchored public ledger of the verification process itself. Resolve any citation at /cite/{citation}; recompute the hash yourself from /ledger/{n}?format=raw. No trust in HORIZON SHIELD is required.",
                limits: "JIDEC is NOT a conformant SCITT Transparency Service and OpenTimestamps has no RFC/ISO/ETSI/eIDAS standing. See https://hs-ledger.oga-surf-project.workers.dev/health for the full self-declared limits."
              },
              per_diagnosis_roadmap: "Per-diagnosis receipts are being migrated onto the live JIDEC ledger at https://hs-ledger.oga-surf-project.workers.dev."
            }
          },
          failure_model: {
            policy: "Fail closed. If the claim cannot be recomputed or the chain cannot be verified, the result is unverified. Never a soft pass. From 0.3, a check that was available for this call but not requested does not round up either: the result is partial.",
            result_on_failure: "unverified",
            result_when_check_not_requested: "partial",
            result_values: {
              verified: "every check available for this call ran and passed",
              partial: "nothing failed, but at least one check available for this call was not requested (see skipped_because_not_requested)",
              unverified: "a check failed, or the claim could not be recomputed"
            },
            partial_scope_note: "audit_ruleset_recheck is a permanent non-capability of this endpoint, not a per-call abstention, so it never causes partial. It is disclosed separately and always.",
            failure_reasons: {
              stale_data: { user_meaning: "recheck later", triggers: ["expired_declaration"] },
              changed_scope: { user_meaning: "re-audit required", triggers: ["changed_estimate_version"] },
              missing_evidence: { user_meaning: "do not trust", triggers: ["missing_receipt", "unverifiable_chain"] }
            }
          },
          credits: "Failure-reason taxonomy (stale data / changed scope / missing evidence) proposed by Symon Baikov (@symonbaikov.bsky.social). Folding the ruleset identity into the hashed payload (contract 0.2) prompted by Federico Blanco Sanchez-Llanos. Separating a not-requested check from a passed one (contract 0.3) prompted by Federico Blanco Sanchez-Llanos.",
          changelog: {
            "0.3": "Verifier-side only: the signed_payload format is unchanged from 0.2, so claims issued today still carry contract 0.2 and still recompute identically. result gains a third value, partial. Previously a call that omitted estimate_version returned result: verified with scope_check: skipped, so a consumer reading only result rounded an unperformed check up into a pass. partial shares no prefix with verified, so naive string comparison now fails closed. Prompted by Federico Blanco Sanchez-Llanos. vc-contract-0.3",
            "0.2": "contract and ruleset {id, version} folded INTO signed_payload (hashed). Prevents silent reinterpretation of old claims under a newer ruleset. Prompted by Federico Blanco Sanchez-Llanos. vc-contract-0.2",
            "0.1.1": "ruleset identity as metadata alongside claim_sha256 (outside the hash)."
          },
          url: "https://mcp.horizonshield.dev/.well-known/verification-contract.json"
        };
        return new Response(JSON.stringify(VERIFICATION_CONTRACT, null, 2), {
          status: 200,
          headers: { "Content-Type": "application/json; charset=utf-8", ...CORS }
        });
      }
    }

    if (request.method === "GET") {
      // ★2026-08-14: ここは「知らないパス」にも 200 + server info を返していた。
      //   実測で /sse が毎秒1回叩かれ続けており、200 が返るので SSE クライアントが
      //   永久に再接続していた。HTTP は成功、ログは Ok、エラー率にも出ない。
      //   実装していないものに OK を返すのは、この事業の原則に反する。
      //   注: 手前のブロックの url はスコープ外なので、ここで取り直す。
      const _u = new URL(request.url);
      const _p = (_u.pathname.replace(/\/+$/, "") || "/");
      const _isEndpoint = (_p === "/" || _p === "/mcp");

      if (_p === "/health") {
        // 測ったものだけを書く。KV に実際に触れて、その結果を報告する。
        let kv = "not_checked";
        try { await env.RL_KV.get("__health"); kv = "reachable"; }
        catch (e) { kv = "unreachable: " + String((e && e.message) || e).slice(0, 120); }
        const ok = (kv === "reachable");
        return new Response(JSON.stringify({
          ok,
          server: SERVER,
          checked: { worker: "running", kv },
          not_checked: ["data freshness", "tool output correctness"],
          note: "This reports only what it actually tested. It does not assert that any tool returns correct data."
        }, null, 2), {
          status: ok ? 200 : 503,
          headers: { "Content-Type": "application/json; charset=utf-8", ...CORS }
        });
      }

      if (!_isEndpoint) {
        const _sse = (_p === "/sse" || _p.endsWith("/sse"));
        return new Response(JSON.stringify({
          error: _sse ? "sse_not_supported" : "not_found",
          path: _u.pathname,
          message: _sse
            ? ("This server does not implement the legacy SSE transport and does not open an event stream on GET. " +
               "Use MCP over Streamable HTTP: POST JSON-RPC 2.0 to " + _u.origin + "/ . " +
               "Until 2026-08-14 this path answered 200 with server metadata, which made SSE clients reconnect " +
               "in a loop without ever surfacing an error. That was our bug, not yours.")
            : ("No such path on this server. The MCP endpoint is " + _u.origin + "/ (POST JSON-RPC 2.0)."),
          endpoint: _u.origin + "/",
          transport: "MCP over Streamable HTTP (JSON-RPC 2.0)",
          known_paths: ["/", "/health", "/icon.png", "/ledger/<claim_sha256>",
                        "/.well-known/agent-card.json", "/.well-known/verification-contract.json",
                        "/.well-known/glama.json", "/.well-known/usage-stats.json"]
        }, null, 2), {
          status: _sse ? 405 : 404,
          headers: { "Content-Type": "application/json; charset=utf-8", ...(_sse ? { "Allow": "POST" } : {}), ...CORS }
        });
      }

      // ★2026-08-14: MCP の Streamable HTTP 仕様は「このエンドポイントで SSE ストリームを
      //   提供しないサーバーは GET に 405 を返さなければならない」としている。
      //   このサーバーは SSE を提供しないので、200 は仕様違反だった。
      //   適合性を測る道具を売っている側が MUST を破っているのは筋が通らないので直した。
      //   本文は従来とまったく同じ info のまま。減らしたのは情報ではなく、番号だけ。
      //   戻すときは status: 405 と Allow を消せば元の 200 に戻る。
      const info = {
        server: SERVER, transport: "MCP over Streamable HTTP (JSON-RPC 2.0)",
        usage: "POST JSON-RPC 2.0 to this URL. methods: initialize, tools/list, tools/call, prompts/list, prompts/get.",
        sse: "not offered. This endpoint does not open an event stream on GET.",
        spec_note: "GET returns 405 because the MCP Streamable HTTP specification requires it of a server that does not open an SSE stream on this endpoint. The body below is the same information a 200 used to carry; nothing was removed. POST JSON-RPC 2.0 to this same URL to use the server.",
        tools: TOOLS.map(t => t.name), site: SITE
      };
      return new Response(JSON.stringify(info, null, 2),
        { status: 405, headers: { "Content-Type": "application/json; charset=utf-8", "Allow": "POST", ...CORS } });
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
      for (const m of body) { if (!isNotification(m)) out.push(await handleRpc(m, env, clientIp, authCtx, ctx)); }
      return new Response(out.length ? JSON.stringify(out) : "", { status: out.length ? 200 : 202, headers: { "Content-Type": "application/json; charset=utf-8", ...CORS } });
    }
    if (isNotification(body)) return new Response("", { status: 202, headers: CORS });
    const res = await handleRpc(body, env, clientIp, authCtx, ctx);
    return new Response(JSON.stringify(res), { headers: { "Content-Type": "application/json; charset=utf-8", ...CORS } });
  }
};
