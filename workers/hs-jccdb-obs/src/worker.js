/**
 * hs-jccdb-obs v0.3 : JCCDB の品目(v4, 95,403行)と観測層 v2(日本と米国、同じ列)を、AI からも人からも引ける口。
 *
 * v0.2 からの変更(2026-09-26):
 *   ・D1 を国で2つに分けた: DB(日本の観測 + v0.1 の items / obs)と DB_US(米国の観測)。表の形は schema/0003_obs3.sql。
 *     道具は country(か地域)で DB を選ぶ。country を受けない道具や country の無い呼び出しは両方に聞いて束ねる
 *     (件数は足す、行は並べ直して limit、coverage は両方)。
 *   ・片方の DB が binding されていない・読めない・入れ直しの途中のときは、その国の部分だけを fetch_failed として返し
 *     (parts と partial)、読めた国の結果は返す。0 件のときも lookup を absent にせず unknown にする(読めなかった側の 0 件ではない)。
 *   ・米国の品目の検索は FTS5(obs2_fts: item_name・spec・category を英語の単語で引く、単語の頭で一致)。FTS5 が無い D1 では LIKE に落ちる。
 *     日本は v0.2 と同じ norm の LIKE。どちらで引いたかは search に書く。
 *   ・note と area_members の本文は notes / members 表に1回だけ持ち、evidence_url と license は台帳と同じなら持たない。
 *     返す JSON の形(各行の note, area_members, evidence_url, license, attribution)は v0.2 と同じ。
 *   ・既存の9本は引数と返りの形を保ち、引数を足しただけ。jccdb_us_prices は米国の全 layer と geo(州・郡 FIPS・都市圏 CBSA・市)を受ける。
 *   ・新しい3本: jccdb_us_prevailing_wage(Davis-Bacon)、jccdb_us_permits(建築許可)、jccdb_us_area_factor(DoD ACF と USACE の州係数)。
 *
 * 返答の約束(v0.2 と同じ):
 *   ・呼べなかった(D1 が読めない、表が無い)と 0 件を同じ値にしない。読めなかったときは error + fetch_failed:true、
 *     0 件のときは count:0 / lookup:"absent" / source_read:true。引数の誤りは invalid_argument:true。
 *   ・値の行には license と attribution と evidence_url を添える。
 *   ・公共工事の設計単価・入札単価・法定賃金・許可の申告額は、施主の見積の単価ではない(BASIS_NOTE と各道具の basis)。
 *   ・値の無い状態の意味は STATUS_LEGEND。値の無いところに値を作らない。
 *   ・このサービスが計算した値(前年同期比、1m2 あたり、中央値、基本時給 + 付加給付、千ドルからドル)は computed:true。
 *   ・書き込み口を持たない。D1 の中身は tools/make_d1_sql.py(v0.1)と tools/make_d1_sql_v3.py の生成物だけ。
 */

const PROTOCOL_VERSION = "2025-11-25";
const SERVER = { name: "hs-jccdb-obs", version: "0.3.0" };

export const STATUS_LEGEND = {
  published_pdl: "出典が値を公開しており、利用条件(PDL1.0)が再配布を許すので値を載せている。帰属表示(attribution)が要る。/ Published by the source under PDL1.0 (CC BY 4.0 compatible); value included, attribution required.",
  published_cc_by: "出典が値を公開しており、政府標準利用規約(第2.0版)か CC BY 4.0 で再配布できるので値を載せている。帰属表示が要る。/ Published under the Japanese Government Standard Terms of Use 2.0 or CC BY 4.0; value included, attribution required.",
  public_domain: "米連邦政府の著作物など、著作権の保護が無い(17 U.S.C. 105)ので値を載せている。/ U.S. federal government work (17 U.S.C. 105) or otherwise public domain; value included.",
  published_open_terms: "出典の利用条件が再利用を明示的に許している(条文は jccdb_sources の ledger の license_quote)ので値を載せている。/ The source's terms expressly permit reuse (quoted in the ledger); value included.",
  published_restricted_not_copied: "出典は値を公開しているが、利用条件が再配布を許さない(私的使用・引用のみ等)ので値は写していない。evidence_url の原本で見ること。/ Published, but the terms do not allow redistribution, so the value is not copied. Read it at evidence_url.",
  publication_based_not_public: "出典の表が市販の物価資料(建設物価・積算資料・RSMeans など)の値を使い、値を公開していない。公的に公開された値は存在しない。/ The source uses a commercial price publication and publishes no value; no public value exists.",
  not_set: "出典の表で空欄か『-』。その地区・時点では単価を設定していない。0 ではない。/ Blank or '-' in the source: no value is set there. Not zero.",
};
const OPEN_STATUSES = new Set(["published_pdl", "published_cc_by", "public_domain", "published_open_terms"]);

export const BASIS_NOTE = {
  JP: "日本の値は公共工事の設計単価(大口需要者向けの市場取引価格の調査値、消費税抜き)、公共工事設計労務単価(所定労働時間内8時間あたりの賃金)、施工パッケージ型積算の標準単価、公的な指数である。" +
    "リフォームの施主が支払う額や、業者の見積単価とは別物。見積が高いかどうかの判定には hs-mcp の audit_estimate を使うこと。" +
    " / Japanese values are public-works design unit prices (large-buyer market survey, excl. consumption tax), public-works design labor rates (wage per 8 hours), standard unit prices for public-works cost estimating, and public indexes. They are not retail or contractor quote prices.",
  US: "米国の値は公的な統計と公共工事の数字である: 州 DOT の入札単価、BLS OEWS と QCEW の賃金(調査と保険記録の平均で、請求単価ではない)、Davis-Bacon の法定賃金(連邦の資金が入る工事の最低の基本時給と付加給付)、" +
    "FEMA と USACE の機械損料、Census の工事支出と建築許可の工事額(申請者の申告で、契約額ではない)と面積あたり工事費、市の建築許可の申告工事額の分布、HUD の 1 戸あたり上限額、DoD の施設単価と地域係数、FTA の出来形原価、BLS PPI・FHWA NHCCI などの指数。" +
    "住宅リフォームの見積単価や業者の小売価格ではない。/ U.S. values are public statistics and public-works figures: state DOT bid prices, BLS OEWS and QCEW wages (survey and insurance-record means, not billing rates), Davis-Bacon prevailing wages (minimums for federally funded work), FEMA and USACE equipment rates, Census spending, permit valuations (declared by applicants, not contract prices) and cost per square foot, city permit valuation distributions, HUD cost limits, DoD unit costs and area factors, FTA as-built costs, and BLS PPI and FHWA NHCCI indexes. They are not residential remodeling quotes or contractor retail prices.",
};
export const US_BASIS = {
  prevailing_wage: "Davis-Bacon の一般賃金決定は、連邦の資金が入る建設工事で払うべき最低の基本時給と付加給付(労働省 賃金時間局が郡と工事の種類ごとに決める)。民間の住宅工事の相場や業者の請求単価ではない。/ Davis-Bacon general wage determinations set the minimum base wage and fringe benefits for federally funded construction, by county and construction type; they are not market rates for private residential work or contractor billing rates.",
  permits: "建築許可の工事額は、申請者が許可の申請に書いた額である(Census BPS は民間の新築住宅の許可の集計と推計、市のデータは許可ごとの申告額の分布)。契約額でも施主の見積の単価でもない。/ Permit valuations are what applicants declare on permit applications (Census BPS: new privately owned residential construction; city data: distributions of declared valuations); they are neither contract prices nor quotes.",
  area_factor: "DoD の Area Cost Factor は軍の建設(MILCON)の予算に使う場所の係数(96 基準都市の平均 = 1.00)、USACE の州の調整係数は土木工事の予算に使う係数。見積の良し悪しを判定する係数ではない。/ DoD Area Cost Factors locate military construction budgets (96 base-city average = 1.00); USACE state adjustment factors serve civil-works budgeting. Neither is a test of whether a quote is fair.",
};
const LICENSE_NOTE = "値を使うときは各行の attribution を表示すること(PDL1.0 / CC BY / 政府標準利用規約 / OPEN-TERMS)。public_domain は表示義務は無いが出典を添えるのが望ましい。/ When reusing a value, show the row's attribution; for public_domain rows, citing the source is still recommended.";
const COMPUTED_NOTE = "computed:true の値はこのサービスが原本の値から計算したもので、原本には無い。computed:false の値は原本の値そのまま。/ computed:true marks values calculated by this service; computed:false values are copied from the source.";

// 既知の layer(SCHEMA.md の9つと、extra_enums で足された house_price と cost_limit)。これ以外でも、データにある layer なら受ける(layerOk)。
export const LAYERS = ["material", "labor", "work", "equipment", "index", "wage", "bid_item", "cost_sqft", "spending", "house_price", "cost_limit"];
export const US_PRICE_LAYERS = ["labor", "wage", "work", "equipment", "index", "spending", "cost_sqft", "cost_limit", "bid_item", "house_price", "material"];
const GEO_LEVELS = ["national", "bureau_area", "pref", "pref_area", "city", "census_region", "state", "metro", "county", "district", "usace_ep_region", "country"];
const COUNTRY_LABEL = { JP: "日本", US: "米国" };
const DB_LABEL = { JP: "日本の D1(DB)", US: "米国の D1(DB_US)" };

const PREFS = ["北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県","茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県","新潟県","富山県","石川県","福井県","山梨県","長野県","岐阜県","静岡県","愛知県","三重県","滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県","鳥取県","島根県","岡山県","広島県","山口県","徳島県","香川県","愛媛県","高知県","福岡県","佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県"];
const ROMAJI = ["hokkaido","aomori","iwate","miyagi","akita","yamagata","fukushima","ibaraki","tochigi","gunma","saitama","chiba","tokyo","kanagawa","niigata","toyama","ishikawa","fukui","yamanashi","nagano","gifu","shizuoka","aichi","mie","shiga","kyoto","osaka","hyogo","nara","wakayama","tottori","shimane","okayama","hiroshima","yamaguchi","tokushima","kagawa","ehime","kochi","fukuoka","saga","nagasaki","kumamoto","oita","miyazaki","kagoshima","okinawa"];

const US_STATES = {
  "01": "Alabama", "02": "Alaska", "04": "Arizona", "05": "Arkansas", "06": "California", "08": "Colorado", "09": "Connecticut",
  "10": "Delaware", "11": "District of Columbia", "12": "Florida", "13": "Georgia", "15": "Hawaii", "16": "Idaho", "17": "Illinois",
  "18": "Indiana", "19": "Iowa", "20": "Kansas", "21": "Kentucky", "22": "Louisiana", "23": "Maine", "24": "Maryland",
  "25": "Massachusetts", "26": "Michigan", "27": "Minnesota", "28": "Mississippi", "29": "Missouri", "30": "Montana",
  "31": "Nebraska", "32": "Nevada", "33": "New Hampshire", "34": "New Jersey", "35": "New Mexico", "36": "New York",
  "37": "North Carolina", "38": "North Dakota", "39": "Ohio", "40": "Oklahoma", "41": "Oregon", "42": "Pennsylvania",
  "44": "Rhode Island", "45": "South Carolina", "46": "South Dakota", "47": "Tennessee", "48": "Texas", "49": "Utah",
  "50": "Vermont", "51": "Virginia", "53": "Washington", "54": "West Virginia", "55": "Wisconsin", "56": "Wyoming",
  "60": "American Samoa", "66": "Guam", "69": "Northern Mariana Islands", "72": "Puerto Rico", "78": "U.S. Virgin Islands",
};
const US_ABBR = {
  AL: "01", AK: "02", AZ: "04", AR: "05", CA: "06", CO: "08", CT: "09", DE: "10", DC: "11", FL: "12", GA: "13", HI: "15", ID: "16",
  IL: "17", IN: "18", IA: "19", KS: "20", KY: "21", LA: "22", ME: "23", MD: "24", MA: "25", MI: "26", MN: "27", MS: "28", MO: "29",
  MT: "30", NE: "31", NV: "32", NH: "33", NJ: "34", NM: "35", NY: "36", NC: "37", ND: "38", OH: "39", OK: "40", OR: "41", PA: "42",
  RI: "44", SC: "45", SD: "46", TN: "47", TX: "48", UT: "49", VT: "50", VA: "51", WA: "53", WV: "54", WI: "55", WY: "56",
  AS: "60", GU: "66", MP: "69", PR: "72", VI: "78",
};
// 日本語の州名(カタカナ)。末尾の「州」は外してから引く。
const US_KANA = {
  "アラバマ": "01", "アラスカ": "02", "アリゾナ": "04", "アーカンソー": "05", "カリフォルニア": "06", "コロラド": "08", "コネチカット": "09",
  "デラウェア": "10", "ワシントンdc": "11", "コロンビア特別区": "11", "フロリダ": "12", "ジョージア": "13", "ハワイ": "15", "アイダホ": "16",
  "イリノイ": "17", "インディアナ": "18", "アイオワ": "19", "カンザス": "20", "ケンタッキー": "21", "ルイジアナ": "22", "メイン": "23",
  "メリーランド": "24", "マサチューセッツ": "25", "ミシガン": "26", "ミネソタ": "27", "ミシシッピ": "28", "ミズーリ": "29", "モンタナ": "30",
  "ネブラスカ": "31", "ネバダ": "32", "ニューハンプシャー": "33", "ニュージャージー": "34", "ニューメキシコ": "35", "ニューヨーク": "36",
  "ノースカロライナ": "37", "ノースダコタ": "38", "オハイオ": "39", "オクラホマ": "40", "オレゴン": "41", "ペンシルベニア": "42",
  "ロードアイランド": "44", "サウスカロライナ": "45", "サウスダコタ": "46", "テネシー": "47", "テキサス": "48", "ユタ": "49",
  "バーモント": "50", "バージニア": "51", "ワシントン": "53", "ウェストバージニア": "54", "ウィスコンシン": "55", "ワイオミング": "56",
  "プエルトリコ": "72", "グアム": "66",
};

// ---------------------------------------------------------------- 正規化

export function normPref(p) {
  if (!p) return null;
  const s = String(p).normalize("NFKC").trim();
  const low0 = s.toLowerCase();
  if (ROMAJI.indexOf(low0) >= 0) return PREFS[ROMAJI.indexOf(low0)]; // kyoto / gifu は接尾辞を外す前に引く(v0.1 は外してから引いて落ちていた)
  const low = low0.replace(/[-\s]*(prefecture|ken|fu|to)$/, "");
  const ri = ROMAJI.indexOf(low);
  if (ri >= 0) return PREFS[ri];
  for (const x of PREFS) if (x === s || x.replace(/[都道府県]$/, "") === s) return x;
  return undefined; // 分からない県名は黙って無視せず、呼び出し側で弾く
}

export function norm(s) {
  return String(s || "").normalize("NFKC").replace(/\s+/g, "").replace(/[\u2010-\u2015\u2212\uff0d]/g, "-").toLowerCase();
}

// 郡・市の名前の照合用の鍵(tools/make_d1_sql_v3.py の county_base と同じ規則)
export function countyBase(s) {
  let t = String(s || "").normalize("NFKC").toLowerCase().replace(/,.*$/, "").trim();
  t = t.replace(/\s+(county|parish|borough|census area|municipality|city and borough|municipio)$/, "");
  return t.replace(/[^\p{L}\p{N}]+/gu, "");
}

// 生コンの規格を局をまたいで比べるための鍵(compare の normalize: "namacon")。v0.2 と同じ。
export function namaconKey(itemName, spec) {
  const s = (String(itemName || "") + " " + String(spec || "")).normalize("NFKC").replace(/[\u2010-\u2015\u2212\uff0d]/g, "-");
  if (!/生コン/.test(s)) return null;
  const d = /(\d{2})\s*-\s*(\d{1,2}(?:\.\d)?)\s*-\s*(\d{2})(?:\s*\(\s*(\d{2})\s*\))?/.exec(s);
  if (!d) return null;
  const cement = /高炉/.test(s) ? "高炉" : /早強/.test(s) ? "早強" : /中庸熱/.test(s) ? "中庸熱" : /低熱/.test(s) ? "低熱" : /フライアッシュ/.test(s) ? "フライアッシュ" : "普通";
  const designation = `${d[1]}-${d[2]}-${d[3]}` + (d[4] ? `(${d[4]})` : "");
  const wc = /W\s*\/\s*C\s*[=≦<]?\s*(\d{2})\s*%?/i.exec(s);
  const cm = /C\s*[=≧>]\s*(\d{3})\s*(?:kg)?\s*以上/i.exec(s);
  return { cement, designation, wc_max: wc ? Number(wc[1]) : null, c_min: cm ? Number(cm[1]) : null };
}

function terms(q) {
  return String(q || "").normalize("NFKC").split(/\s+/).map(norm).filter(Boolean).slice(0, 6);
}

// FTS5 unicode61 と同じ切り方(文字 L*・数字 N*・私用 Co の連なりが1語、ほかは区切り)。小文字にする。
export function ftsTokens(term) {
  return (String(term || "").normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}\p{Co}]+/gu) || []);
}
// 語ごとに AND。2文字以上の語は頭で一致("carpent"* は carpenter / carpenters に当たる)。detail=none なので句は使わない。
export function ftsQuery(tokens) {
  return tokens.map((t) => '"' + t.replace(/"/g, '""') + '"' + (t.length >= 2 ? "*" : "")).join(" AND ");
}

function likeArg(t) {
  return "%" + t.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
}

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const clamp = (n, lo, hi, d) => { const x = parseInt(n, 10); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d; };
const bool = (v) => v === true || v === 1 || (typeof v === "string" && /^(1|true|yes|on)$/i.test(v.trim()));
const pad2 = (s) => String(s).padStart(2, "0");
const blank = (v) => v === undefined || v === null || String(v).trim() === "";

export function normCountry(c) {
  if (c == null || String(c).trim() === "") return null;
  const s = String(c).normalize("NFKC").trim().toLowerCase();
  if (["jp", "jpn", "japan", "日本", "にほん", "nippon"].includes(s)) return "JP";
  if (["us", "usa", "u.s.", "u.s.a.", "united states", "united states of america", "米国", "アメリカ", "アメリカ合衆国"].includes(s)) return "US";
  return undefined;
}

function usStateCode(s) {
  const t = String(s).normalize("NFKC").trim();
  if (/^[A-Za-z]{2}$/.test(t) && own(US_ABBR, t.toUpperCase())) return US_ABBR[t.toUpperCase()];
  if (/^\d{2}$/.test(t) && own(US_STATES, t)) return t;
  const low = t.toLowerCase().replace(/\s+state$/, "").replace(/\./g, "").trim();
  for (const [code, name] of Object.entries(US_STATES)) if (name.toLowerCase().replace(/\./g, "") === low) return code;
  if (low === "washington dc" || low === "washington, dc") return "11";
  const kana = t.replace(/\s+/g, "").replace(/州$/, "").toLowerCase();
  if (own(US_KANA, kana)) return US_KANA[kana];
  return null;
}

/**
 * 地域の正規化(DB を見ない)。都道府県名・コード(JIS 2桁、JP-29)、州名・略号・FIPS(US-CA, US-06)、郡 FIPS 5桁、市区町村コード、国(JP / US)を受ける。
 * 前置きで種類を決められる: county:06037 / cbsa:31080(metro:)/ state:CA。
 * 返り: { country, level, code, name, from } / { error, code, candidates? } / null(空)
 */
export function normGeo(input, country) {
  if (input == null || String(input).trim() === "") return null;
  const raw = String(input).trim();
  const s = raw.normalize("NFKC").trim();
  const low = s.toLowerCase();
  let m;
  if ((m = /^(county|cbsa|metro|state)\s*[:=]\s*(.+)$/i.exec(s))) {
    const kind = m[1].toLowerCase(), v = m[2].trim();
    if (country && country !== "US") return { error: `地域 ${raw} は country=${country} の中に無い。/ region ${raw} is not in ${country}`, code: "unknown_region" };
    if (kind === "county") {
      if (/^\d{5}$/.test(v) && US_STATES[v.slice(0, 2)]) return { country: "US", level: "county", code: v, name: US_STATES[v.slice(0, 2)] + " county FIPS " + v, from: raw };
      return { error: `郡は FIPS 5桁で渡すこと(county:06037)。名前なら jccdb_us_* の道具で 'Los Angeles County, CA' の形。/ county needs a 5-digit FIPS: ${raw}`, code: "unknown_region" };
    }
    if (kind === "cbsa" || kind === "metro") {
      if (/^\d{5}$/.test(v)) return { country: "US", level: "metro", code: v, name: "CBSA " + v, from: raw };
      return { error: `都市圏は CBSA 5桁で渡すこと(cbsa:31080)。/ metro needs a 5-digit CBSA code: ${raw}`, code: "unknown_region" };
    }
    const st = usStateCode(v) || (/^\d{1,2}$/.test(v) && US_STATES[pad2(v)] ? pad2(v) : null);
    if (st) return { country: "US", level: "state", code: st, name: US_STATES[st], from: raw };
    return { error: `州が分からない: ${raw} / unknown state`, code: "unknown_region" };
  }
  const c = [];
  const jpPref = (code) => ({ country: "JP", level: "pref", code, name: PREFS[parseInt(code, 10) - 1] });
  const usState = (code) => ({ country: "US", level: "state", code, name: US_STATES[code] });
  if (normCountry(s) === "JP" || ["全国"].includes(s)) c.push({ country: "JP", level: "national", code: "JP", name: "日本" });
  if (normCountry(s) === "US") c.push({ country: "US", level: "national", code: "US", name: "United States" });
  if ((m = low.match(/^jp-(\d{1,2})$/)) && +m[1] >= 1 && +m[1] <= 47) c.push(jpPref(pad2(m[1])));
  if ((m = low.match(/^us-([a-z]{2})$/)) && US_ABBR[m[1].toUpperCase()]) c.push(usState(US_ABBR[m[1].toUpperCase()]));
  if ((m = low.match(/^us-(\d{2})$/)) && US_STATES[m[1]]) c.push(usState(m[1]));
  if (/^\d{1,2}$/.test(s)) {
    const code = pad2(s);
    if (+code >= 1 && +code <= 47) c.push(jpPref(code));
    if (US_STATES[code]) c.push(usState(code));
  }
  if (/^\d{5,6}$/.test(s)) {
    const p = s.slice(0, 2);
    if (+p >= 1 && +p <= 47) c.push({ country: "JP", level: "city", code: s.slice(0, 5), name: PREFS[+p - 1] + " の市区町村コード " + s.slice(0, 5) });
    if (s.length === 5 && US_STATES[p]) c.push({ country: "US", level: "county", code: s, name: US_STATES[p] + " county FIPS " + s });
  }
  const pn = normPref(s);
  if (pn) c.push(jpPref(pad2(PREFS.indexOf(pn) + 1)));
  const us = usStateCode(s);
  if (us) c.push(usState(us));
  const seen = new Set();
  let cands = c.filter((x) => { const k = x.country + x.level + x.code; if (seen.has(k)) return false; seen.add(k); return true; });
  if (country) cands = cands.filter((x) => x.country === country);
  if (!cands.length) {
    return { error: c.length ? `地域 ${raw} は country=${country} の中に無い。/ region ${raw} is not in ${country}` : `地域名が分からない: ${raw} / unknown region (都道府県名・JIS コード、州名・略号・FIPS を受ける)`, code: "unknown_region" };
  }
  if (cands.length > 1) {
    return { error: `地域 ${raw} は ${cands.map((x) => x.name + "(" + x.country + ")").join(" とも ")} とも読める。country を渡すこと。/ ambiguous region; pass country`, code: "ambiguous_region", candidates: cands };
  }
  return { ...cands[0], from: raw };
}

// 地域の条件(o. は obs2)。索引(geo_code, layer, geo_level)に乗るように、前方一致は範囲で書く(v0.2 の substr は全行を読んでいた)。
function geoCond(g) {
  switch (g.level) {
    case "national": return { sql: "(o.geo_code = ? AND o.geo_level = 'national')", binds: [g.code] };
    case "pref": return { sql: "(o.geo_code = ? OR (o.geo_code > ? AND o.geo_code < ? AND length(o.geo_code) >= 5))", binds: [g.code, g.code, g.code + ":"] };
    case "state": return { sql: "(o.geo_code = ? OR (o.geo_code > ? AND o.geo_code < ? AND o.geo_level = 'county'))", binds: [g.code, g.code, g.code + ":"] };
    case "county": return { sql: "(o.geo_code = ? AND o.geo_level = 'county')", binds: [g.code] };
    case "metro": return { sql: "(o.geo_code = ? AND o.geo_level = 'metro')", binds: [g.code] };
    case "country": return { sql: "(o.geo_code = ? AND o.geo_level = 'country')", binds: [g.code] };
    case "place": {
      const ls = g.labels.slice(0, 20);
      const ph = ls.map(() => "?").join(",");
      return { sql: `(o.geo_code = ? AND o.geo_level = 'city' AND (o.area_label IN (${ph}) OR (o.area_label = '' AND o.geo_name IN (${ph}))))`, binds: [g.code, ...ls, ...ls] };
    }
    case "city": return { sql: "(o.geo_code >= ? AND o.geo_code < ?)", binds: [g.code, g.code + ":"] };
    default: return { sql: "o.geo_code = ?", binds: [g.code] };
  }
}

// ---------------------------------------------------------------- 時点

const PERIOD_RE = /^(\d{4}(-\d{2}(-\d{2})?)?|\d{4}Q[1-4]|FY\d{4}|\d{4}H[12])$/;
export function normPeriod(p) {
  if (p == null || String(p).trim() === "") return null;
  const s = String(p).normalize("NFKC").replace(/\s+/g, "").replace(/\//g, "-").toUpperCase();
  return PERIOD_RE.test(s) ? s : undefined;
}
function addMonths(key, n) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, d)).toISOString().slice(0, 10);
}
export function periodStart(p, country) {
  let m;
  if ((m = p.match(/^(\d{4})$/))) return m[1] + "-01-01";
  if ((m = p.match(/^(\d{4})-(\d{2})$/))) return `${m[1]}-${m[2]}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(p)) return p;
  if ((m = p.match(/^(\d{4})Q([1-4])$/))) return `${m[1]}-${pad2(3 * +m[2] - 2)}-01`;
  if ((m = p.match(/^(\d{4})H([12])$/))) return `${m[1]}-${m[2] === "1" ? "01" : "07"}-01`;
  if ((m = p.match(/^FY(\d{4})$/))) return country === "US" ? `${+m[1] - 1}-10-01` : `${m[1]}-04-01`;
  return null;
}
export function periodEnd(p, country) {
  const st = periodStart(p, country);
  if (/^\d{4}$/.test(p) || /^FY/.test(p)) return addMonths(st, 12);
  if (/^\d{4}-\d{2}$/.test(p)) return addMonths(st, 1);
  if (/Q/.test(p)) return addMonths(st, 3);
  if (/H/.test(p)) return addMonths(st, 6);
  const [y, mo, d] = st.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d + 1)).toISOString().slice(0, 10);
}
export function prevYearPeriod(p) {
  let m;
  if ((m = p.match(/^FY(\d{4})$/))) return "FY" + (+m[1] - 1);
  if ((m = p.match(/^(\d{4})(.*)$/))) return (+m[1] - 1) + m[2];
  return null;
}

// ---------------------------------------------------------------- DB の部分(国ごと)

function argErr(msg, extra) {
  return { error: msg, code: "invalid_argument", invalid_argument: true, fetch_failed: false, source_read: false, ...(extra || {}) };
}

const V01_TABLES = ["items", "obs", "sources"];
function readFail(e, c) {
  const msg = String((e && e.message) || e);
  const m = /no such table:\s*(\w+)/i.exec(msg);
  const table = m ? m[1] : null;
  const where = DB_LABEL[c] || "D1";
  const v01 = V01_TABLES.includes(table);
  const error = !table
    ? `${where}を読めなかった。0件ではなく、読めていない。/ The database could not be read; this is not an empty result.`
    : v01
      ? "v0.1 の表(" + table + ")が無い(schema/0001_init.sql と sql/ が当たっていない)。0件ではなく、読めていない。/ The v0.1 table " + table + " is missing; this is a failure to read, not an empty result."
      : `${where}に観測層の表(${table})が無い(schema/0003_obs3.sql が当たっていない)。0件ではなく、読めていない。/ The observation tables are missing (schema 0003 not applied); this is a failure to read, not an empty result.`;
  return { error, code: !table ? "db_unavailable" : v01 ? "v01_not_loaded" : "obs2_not_loaded", fetch_failed: true, source_read: false, country: c || null, detail: msg.slice(0, 200) };
}
function notBound(c) {
  return {
    error: `${DB_LABEL[c]}が binding されていない(wrangler.jsonc の d1_databases)。0件ではなく、読めていない。/ The ${c === "US" ? "U.S." : "Japan"} D1 database (${c === "US" ? "DB_US" : "DB"}) is not bound; this is a failure to read, not an empty result.`,
    code: c === "US" ? "db_us_not_bound" : "db_not_bound", fetch_failed: true, source_read: false, country: c,
  };
}
function loadingFail(c) {
  return {
    error: `${DB_LABEL[c]}の観測層を入れ直している途中か、途中で止まっている(meta の built_v3 が無い)。0件ではなく、読めていない。/ The observation layer is being reloaded or the load stopped midway; this is not an empty result.`,
    code: "obs2_loading", fetch_failed: true, source_read: false, country: c,
  };
}

// 国ごとの DB を開く。meta の built_v3(本体の最後の文)が無ければ「入れ直しの途中」。FTS5 は built_v3_fts(FTS の最後の文)があって指紋が同じときだけ使う。
async function part(ctx, c) {
  if (ctx.parts[c]) return ctx.parts[c];
  const db = ctx.env ? (c === "JP" ? ctx.env.DB : ctx.env.DB_US) : null;
  let p;
  if (!db) p = { country: c, fail: notBound(c) };
  else {
    try {
      const m = await db.prepare("SELECT v FROM meta WHERE k='built_v3'").first();
      if (!m) {
        await db.prepare("SELECT 1 AS one FROM obs2 LIMIT 1").first(); // 表が無ければここで no such table(= 0003 が当たっていない)
        p = { country: c, fail: loadingFail(c) };
      } else {
        const built = JSON.parse(m.v);
        let fts = false;
        if (built.fts) {
          try {
            const f = await db.prepare("SELECT v FROM meta WHERE k='built_v3_fts'").first();
            fts = !!(f && JSON.parse(f.v).obs2_fingerprint_sha256 === built.obs2_fingerprint_sha256);
          } catch (_e) { fts = false; }
        }
        p = { country: c, db, built, fts, fts_expected: !!built.fts };
      }
    } catch (e) { p = { country: c, fail: readFail(e, c) }; }
  }
  ctx.parts[c] = p;
  return p;
}

// 国ごとに fn を走らせる。FTS5 が壊れていたら LIKE で1度だけやり直す。
async function across(ctx, targets, fn) {
  const res = {}, fails = {};
  for (const c of targets) {
    const p = await part(ctx, c);
    if (p.fail) { fails[c] = p.fail; continue; }
    try {
      try { res[c] = await fn(p, c); }
      catch (e) {
        if (p.fts && /fts5|obs2_fts|no such module/i.test(String(e && e.message))) {
          p.fts = false; p.fts_error = String(e.message).slice(0, 200);
          res[c] = await fn(p, c);
        } else throw e;
      }
    } catch (e) { fails[c] = readFail(e, c); }
  }
  return { res, fails, ok: targets.filter((c) => own(res, c)) };
}

function allFailed(fails, targets) {
  const fs = targets.map((c) => fails[c]).filter(Boolean);
  if (fs.length === 1) return fs[0];
  return { error: fs.map((f) => f.error).join(" / "), code: fs[0].code, fetch_failed: true, source_read: false, parts: Object.fromEntries(targets.map((c) => [c, fails[c]])) };
}

// 片方の国が読めなかったときの印。読めた国の結果はそのまま返し、読めなかった国は parts に理由を書く。
function withParts(out, ok, fails) {
  const fc = Object.keys(fails);
  if (!fc.length) return out;
  out.partial = true;
  out.parts = {};
  for (const c of ok) out.parts[c] = { source_read: true, fetch_failed: false };
  for (const c of fc) out.parts[c] = { ...fails[c] };
  out.partial_reading = `${fc.map((c) => COUNTRY_LABEL[c]).join("・")}の部分は読めなかった(parts の fetch_failed)。件数と行は${ok.map((c) => COUNTRY_LABEL[c]).join("・")}の分だけで、読めなかった側が 0 件という意味ではない。/ The ${fc.join("/")} part could not be read; counts and rows cover ${ok.join("/")} only and say nothing about the missing part.`;
  return out;
}

function targetsOf(country, g) {
  if (g) return [g.country];
  if (country) return [country];
  return ["JP", "US"];
}

// ---------------------------------------------------------------- 行の読み方

// 行の形は v0.2 と同じ。note / area_members は辞書の表から、evidence_url / license / attribution は台帳から埋める。
const FULL_SEL = "o.rid, o.obs_id, o.country, o.layer, o.category, o.item_name, o.spec, o.unit, o.geo_level, o.geo_code, o.geo_name, o.area_label, o.area_code, " +
  "COALESCE(m.text, '') AS area_members, o.price, o.currency, o.price_basis, o.price_status, o.ref_value, o.ref_note, o.period, o.effective_from, " +
  "o.source_id, o.source_page, COALESCE(o.evidence_url, s.url) AS evidence_url, COALESCE(o.license, s.license) AS license, s.attribution AS attribution, " +
  "o.jccdb_v4_item_id, COALESCE(n.text, '') AS note, o.computed, o.period_key, o.members_id";
const FULL_FROM = "obs2 o LEFT JOIN notes n ON n.note_id = o.note_id LEFT JOIN members m ON m.members_id = o.members_id LEFT JOIN sources2 s ON s.source_id = o.source_id";
// 集計用の細い列(長い area_members と note を読まない)
const SLIM_SEL = "o.rid, o.obs_id, o.country, o.layer, o.category, o.item_name, o.spec, o.unit, o.geo_level, o.geo_code, o.geo_name, o.area_label, o.area_code, " +
  "o.price, o.currency, o.price_basis, o.price_status, o.ref_value, o.ref_note, o.period, o.effective_from, o.source_id, o.source_page, " +
  "COALESCE(o.evidence_url, s.url) AS evidence_url, COALESCE(o.license, s.license) AS license, s.attribution AS attribution, o.jccdb_v4_item_id, o.computed, o.period_key";
const SLIM_FROM = "obs2 o LEFT JOIN sources2 s ON s.source_id = o.source_id";

function shapeRow(r) {
  const jpy = r.currency === "JPY";
  return {
    obs_id: r.obs_id, country: r.country, layer: r.layer, category: r.category, item_name: r.item_name, spec: r.spec, unit: r.unit,
    geo_level: r.geo_level, geo_code: r.geo_code, geo_name: r.geo_name, pref: r.country === "JP" ? (r.geo_name || null) : null,
    area_label: r.area_label, area_code: r.area_code, area_members: r.area_members ?? null,
    price: r.price ?? null, currency: r.currency || null, price_basis: r.price_basis, price_status: r.price_status, has_value: r.price != null,
    price_yen: jpy ? (r.price ?? null) : null,
    ref_value: r.ref_value ?? null, ref_value_yen: jpy ? (r.ref_value ?? null) : null, ref_note: r.ref_note || null,
    period: r.period, effective_from: r.effective_from || null,
    source_id: r.source_id, source_page: r.source_page, evidence_url: r.evidence_url, license: r.license, attribution: r.attribution || null,
    jccdb_v4_item_id: r.jccdb_v4_item_id || null, note: r.note ?? null,
    computed: r.computed === 1, // 1 = 原本に無い値(観測層の組み立てで計算した。note に式)。0 = 原本の値そのまま
  };
}

const intList = (xs) => { if (!xs.every((x) => Number.isInteger(x))) throw new Error("rid is not an integer"); return xs.join(","); };

// rid の並びのとおりに、全部の列(note・area_members・台帳の埋め戻しつき)を読む。
async function fetchByRids(db, rids, slim) {
  if (!rids.length) return [];
  const out = new Map();
  for (let i = 0; i < rids.length; i += 500) {
    const ch = rids.slice(i, i + 500);
    const rs = (await db.prepare(`SELECT ${slim ? SLIM_SEL : FULL_SEL} FROM ${slim ? SLIM_FROM : FULL_FROM} WHERE o.rid IN (${intList(ch)})`).all()).results;
    for (const r of rs) out.set(r.rid, r);
  }
  return rids.map((r) => out.get(r)).filter(Boolean);
}

// 並べてから rid だけを取り、そのページの行だけを全部の列で読む(並べ替えで結合を全行に回さない)。
async function pageRows(db, w, order, lim, off, slim) {
  const where = w.sql.length ? " WHERE " + w.sql.join(" AND ") : "";
  const ids = (await db.prepare(`SELECT o.rid FROM obs2 o${where} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(...w.binds, lim, off).all()).results.map((r) => r.rid);
  return fetchByRids(db, ids, slim);
}

// 台帳(タイトル等と、本文から数項目)を必要な出典だけ読む。D1 の bind は 100 個までなので 90 個ずつ。
async function sourcesInfo(db, ids) {
  const out = {};
  const u = [...new Set(ids)].filter(Boolean);
  for (let i = 0; i < u.length; i += 90) {
    const ch = u.slice(i, i + 90);
    const rs = (await db.prepare("SELECT source_id, country, title, publisher, url, retrieved_at, license, values_copied, attribution, " +
      "json_extract(body, '$.effective_from') AS effective_from, json_extract(body, '$.published') AS published, " +
      "json_extract(body, '$.row_listing_reason') AS row_listing_reason, json_extract(body, '$.landing') AS landing " +
      `FROM sources2 WHERE source_id IN (${ch.map(() => "?").join(",")})`).bind(...ch).all()).results;
    for (const r of rs) out[r.source_id] = r;
  }
  return out;
}

// 品目の語の条件。日本は norm の LIKE(v0.2 と同じ)、米国は FTS5(無ければ item_name・spec・category の LIKE)。
function textCond(p, t) {
  if (!t.length) return { sql: [], binds: [], mode: null };
  if (p.country === "JP") return { sql: t.map(() => "o.norm LIKE ? ESCAPE '\\'"), binds: t.map(likeArg), mode: "like" };
  const hay = "lower(o.item_name || ' ' || COALESCE(o.spec, '') || ' ' || COALESCE(o.category, ''))";
  if (!p.fts) return { sql: t.map(() => hay + " LIKE ? ESCAPE '\\'"), binds: t.map(likeArg), mode: p.fts_expected ? "like_fallback" : "like" };
  const toks = [], likeTerms = [];
  for (const x of t) { const k = ftsTokens(x); if (k.length) toks.push(...k); else likeTerms.push(x); }
  const sql = [], binds = [];
  if (toks.length) { sql.push("o.rid IN (SELECT rowid FROM obs2_fts WHERE obs2_fts MATCH ?)"); binds.push(ftsQuery([...new Set(toks)].slice(0, 12))); }
  for (const x of likeTerms) { sql.push(hay + " LIKE ? ESCAPE '\\'"); binds.push(likeArg(x)); }
  return { sql, binds, mode: "fts5" };
}

const SEARCH_NOTE = "search: JP は品目名+規格の部分一致(LIKE)。US は FTS5 で item_name・spec・category を英語の単語で引く(各語の頭で一致、語はすべて含む)。like_fallback は FTS5 が使えない D1 で LIKE に落ちたことを示す。/ JP: substring match; US: FTS5 word-prefix match on item_name, spec and category (like_fallback when FTS5 is unavailable).";

// ---------------------------------------------------------------- 絞り込み

// layer は既知の11個か、データ(coverage)にあるもの。
async function layerOk(ctx, l, targets) {
  const x = String(l);
  if (LAYERS.includes(x)) return true;
  if (!/^[a-z_]{1,40}$/.test(x)) return false;
  for (const c of targets) {
    const p = await part(ctx, c);
    if (p.fail) continue;
    try { if (await p.db.prepare("SELECT 1 AS one FROM coverage WHERE layer = ? LIMIT 1").bind(x).first()) return true; } catch (_e) { /* 読めなければ後で fetch_failed になる */ }
  }
  return false;
}
async function geoLevelOk(ctx, l, targets) {
  const x = String(l);
  if (GEO_LEVELS.includes(x)) return true;
  if (!/^[a-z_]{1,40}$/.test(x)) return false;
  for (const c of targets) {
    const p = await part(ctx, c);
    if (p.fail) continue;
    try { if (await p.db.prepare("SELECT 1 AS one FROM coverage WHERE geo_level = ? LIMIT 1").bind(x).first()) return true; } catch (_e) { /* 同上 */ }
  }
  return false;
}

// 米国の地域を DB を見て決める: 5桁が郡 FIPS か CBSA か、郡の名前(Los Angeles County, CA)、市の名前(Austin, TX)、ZIP、外国(OCONUS)。
async function resolveUsGeo(p, input, opts) {
  const o = opts || {};
  if (blank(input)) return null;
  const raw = String(input).trim();
  const s = raw.normalize("NFKC").trim();
  const pm = /^(county|cbsa|metro|place|city|zip|state|country)\s*[:=]\s*(.+)$/i.exec(s);
  const kind = pm ? pm[1].toLowerCase() : null;
  const val = pm ? pm[2].trim() : s;
  const unknown = (msg) => ({ error: msg || `地域名が分からない: ${raw} / unknown region`, code: "unknown_region" });
  const namesFor = async (level, code) => (await p.db.prepare("SELECT name, n FROM geo_names WHERE geo_level = ? AND geo_code = ? ORDER BY n DESC").bind(level, code).all()).results;
  const countyByName = async (name, st) => {
    const b = countyBase(name);
    if (!b) return null;
    const rs = (await p.db.prepare("SELECT geo_code, name, n FROM geo_names WHERE base_key = ? AND geo_level = 'county' AND geo_code > ? AND geo_code < ? ORDER BY n DESC").bind(b, st, st + ":").all()).results;
    const codes = [...new Set(rs.map((r) => r.geo_code))];
    if (codes.length !== 1) return codes.length ? { error: `郡の名前 ${raw} が複数の郡に当たる(${codes.join(", ")})。FIPS で渡すこと。/ ambiguous county`, code: "ambiguous_region", candidates: codes } : null;
    return { country: "US", level: "county", code: codes[0], name: rs[0].name, state: st, from: raw };
  };
  const placeByName = async (name, st) => {
    const b = countyBase(name);
    const rs = b ? (await p.db.prepare("SELECT name, n FROM geo_names WHERE base_key = ? AND geo_level = 'city' AND geo_code = ? ORDER BY n DESC").bind(b, st).all()).results : [];
    if (!rs.length) return null;
    return { country: "US", level: "place", code: st, name: rs[0].name + ", " + US_STATES[st], labels: [...new Set(rs.map((r) => r.name))], place_key: b, state: st, from: raw };
  };
  const splitNameState = (v) => {
    const m = /^(.+?),\s*([^,]+)$/.exec(v);
    if (!m) return null;
    const st = usStateCode(m[2]);
    return st ? { name: m[1].trim(), st } : null;
  };
  if (kind === "zip") {
    if (!o.allowZip) return argErr("zip は jccdb_us_area_factor だけで使える。/ zip is accepted only by jccdb_us_area_factor");
    return /^\d{5}$/.test(val) ? { country: "US", level: "zip", code: val, name: "ZIP " + val, from: raw } : unknown("ZIP は5桁: " + raw);
  }
  if (kind === "country") {
    if (!o.allowCountry) return argErr("country: は jccdb_us_area_factor(米軍の国外の施設)だけで使える。/ country: is accepted only by jccdb_us_area_factor");
    return resolveOconus(p, val, raw);
  }
  if (kind === "state") {
    const g = normGeo("state:" + val, "US");
    return g.error ? g : { ...g, from: raw };
  }
  if (kind === "cbsa" || kind === "metro") {
    if (!/^\d{5}$/.test(val)) return unknown("都市圏は CBSA 5桁: " + raw);
    const ns = await namesFor("metro", val);
    return { country: "US", level: "metro", code: val, name: ns.length ? ns[0].name : "CBSA " + val, from: raw };
  }
  if (kind === "county") {
    if (/^\d{5}$/.test(val)) {
      if (!US_STATES[val.slice(0, 2)]) return unknown("郡 FIPS の頭2桁が州でない: " + raw);
      const ns = await namesFor("county", val);
      return { country: "US", level: "county", code: val, name: ns.length ? ns[0].name : US_STATES[val.slice(0, 2)] + " county FIPS " + val, state: val.slice(0, 2), from: raw };
    }
    const ns = splitNameState(val);
    if (!ns) return unknown("郡は FIPS 5桁か『Multnomah County, OR』の形: " + raw);
    return (await countyByName(ns.name, ns.st)) || unknown(`郡 ${raw} はこの DB の郡の名前に無い。/ county not found`);
  }
  if (kind === "place" || kind === "city") {
    const ns = splitNameState(val);
    if (!ns) return unknown("市は『Austin, TX』の形: " + raw);
    if (o.placeAsText) return { country: "US", level: "place_text", code: ns.st, name: ns.name, state: ns.st, from: raw };
    return (await placeByName(ns.name, ns.st)) || unknown(`市 ${raw} はこの DB の市の名前に無い(Census BPS の place、HUD、市の許可データの名前で引く)。/ place not found`);
  }
  // 前置き無し
  const g = normGeo(s, "US");
  if (g && !g.error) {
    if (g.level === "county" && /^\d{5}$/.test(s)) {
      const rs = (await p.db.prepare("SELECT geo_level, name, n FROM geo_names WHERE geo_code = ? AND geo_level IN ('county', 'metro') ORDER BY n DESC").bind(s).all()).results;
      const lv = [...new Set(rs.map((r) => r.geo_level))];
      const nm = (l) => (rs.find((r) => r.geo_level === l) || {}).name;
      if (lv.length === 2) {
        return { error: `${raw} は郡 FIPS(${nm("county")})とも都市圏 CBSA(${nm("metro")})とも読める。county:${s} か cbsa:${s} で渡すこと。/ ambiguous: county or CBSA`, code: "ambiguous_region",
          candidates: [{ country: "US", level: "county", code: s, name: nm("county") }, { country: "US", level: "metro", code: s, name: nm("metro") }] };
      }
      if (lv[0] === "metro") return { country: "US", level: "metro", code: s, name: nm("metro"), from: raw };
      if (!lv.length && o.allowZip) return { country: "US", level: "zip", code: s, name: "ZIP " + s, from: raw };
      return { ...g, name: nm("county") || g.name, state: s.slice(0, 2) };
    }
    return g;
  }
  const ns = splitNameState(s);
  if (ns) {
    if (/\s(county|parish|borough|census area|municipality)$/i.test(ns.name)) return (await countyByName(ns.name, ns.st)) || unknown(`郡 ${raw} はこの DB の郡の名前に無い。/ county not found`);
    if (o.placeAsText) return { country: "US", level: "place_text", code: ns.st, name: ns.name, state: ns.st, from: raw };
    return (await placeByName(ns.name, ns.st)) || (await countyByName(ns.name, ns.st)) || unknown(`${raw} はこの DB の市・郡の名前に無い。/ place or county not found`);
  }
  if (o.allowCountry) { const oc = await resolveOconus(p, s, raw); if (!oc.error) return oc; }
  return g && g.error ? g : unknown();
}

// 米軍の国外の施設の国(DoD ACF の geo_level country。ISO 3166-1 alpha-2 か国名)
async function resolveOconus(p, v, raw) {
  const rs = (await p.db.prepare("SELECT DISTINCT geo_code, geo_name FROM coverage WHERE geo_level = 'country'").all()).results;
  const t = String(v).normalize("NFKC").trim().toLowerCase();
  const hit = rs.find((r) => r.geo_code.toLowerCase() === t || String(r.geo_name || "").toLowerCase() === t || (t === "日本" && r.geo_code === "JP"));
  return hit ? { country: "US", level: "country", code: hit.geo_code, name: hit.geo_name, from: raw } : { error: `国外の施設の国が分からない: ${raw}(DoD ACF にある国: ${rs.map((r) => r.geo_code).sort().join(" ")})`, code: "unknown_region" };
}

// query / pref / geo / country / layer / status / period / source_id から、国ごとの WHERE を組む。誤りは { err } で返す。
async function buildFilter(ctx, a, opts) {
  const o = opts || {};
  const t = terms(a.query);
  let country = normCountry(a.country);
  if (country === undefined) return { err: argErr("country は JP か US: " + a.country + " / country must be JP or US") };
  let g = null;
  if (a.pref) {
    const pr = normPref(a.pref);
    if (pr === undefined) return { err: argErr("都道府県名が分からない: " + a.pref + " / unknown prefecture", { code: "unknown_region" }) };
    g = { country: "JP", level: "pref", code: pad2(PREFS.indexOf(pr) + 1), name: pr, from: a.pref };
  }
  if (!blank(a.geo)) {
    let g2 = normGeo(a.geo, country || (g ? g.country : null));
    if (g2 && g2.error && g2.code === "unknown_region" && (country || (g && g.country)) !== "JP") {
      // 郡・市の名前(Los Angeles County, CA / Austin, TX)は米国の DB で引く
      const pu = await part(ctx, "US");
      if (!pu.fail) { const g3 = await resolveUsGeo(pu, a.geo); if (g3 && !g3.error) g2 = g3; }
    } else if (g2 && !g2.error && g2.country === "US" && g2.level === "county" && /^\d{5}$/.test(String(a.geo).trim())) {
      const pu = await part(ctx, "US");
      if (!pu.fail) g2 = await resolveUsGeo(pu, a.geo);
    }
    if (g2 && g2.error) return { err: argErr(g2.error, { code: g2.code, candidates: g2.candidates }) };
    if (g && g2 && (g.country !== g2.country || g.code !== g2.code)) return { err: argErr(`pref(${a.pref})と geo(${a.geo})が別の地域を指している。/ pref and geo disagree`) };
    g = g2;
  }
  if (g && country && g.country !== country) return { err: argErr(`地域 ${g.name} は country=${country} ではない。/ region is not in ${country}`) };
  if (g) country = g.country;
  const targets = targetsOf(country, g);
  if (a.layer && !(await layerOk(ctx, a.layer, targets))) return { err: argErr("layer が分からない: " + a.layer + " / layer must be one of " + LAYERS.join(", ")) };
  if (a.status && !own(STATUS_LEGEND, String(a.status))) return { err: argErr("status が分からない: " + a.status + " / status must be one of " + Object.keys(STATUS_LEGEND).join(", ")) };
  let period = null;
  if (!blank(a.period)) {
    period = normPeriod(a.period);
    if (period === undefined) return { err: argErr("period の形が分からない: " + a.period + " / use YYYY, YYYY-MM, YYYY-MM-DD, YYYYQn, YYYYHn or FYYYYY") };
  }
  const nfilters = t.length + (g ? 1 : 0) + (country ? 1 : 0) + (a.layer ? 1 : 0) + (a.source_id ? 1 : 0) + (a.status ? 1 : 0) + (period ? 1 : 0);
  // 国ごとの条件(FTS5 が使えるかは国の DB で決まるので、呼ぶたびに組む)
  const whereFor = (p, extra) => {
    const x = extra || {};
    const tc = textCond(p, x.terms || t);
    const sql = [...tc.sql], binds = [...tc.binds];
    if (g && g.country === p.country) {
      const gc = geoCond(g);
      sql.push(gc.sql); binds.push(...gc.binds);
    }
    // 地域か出典で絞るときは、layer・時点の索引を使わせない(単項の +)。D1 には ANALYZE の統計が無く、放っておくと
    // 行の多い layer の索引(米国の spending は 147 万行)を選んでしまう。地域・出典の索引のほうがずっと狭い。
    const nx = (g && g.country === p.country) || x.geoGiven || a.source_id ? "+" : "";
    if (a.layer) { sql.push(nx + "o.layer = ?"); binds.push(String(a.layer)); }
    if (x.layers) { sql.push(nx + "o.layer IN (" + x.layers.map(() => "?").join(",") + ")"); binds.push(...x.layers); }
    if (a.status) { sql.push("o.price_status = ?"); binds.push(String(a.status)); }
    if (a.source_id) { sql.push("o.source_id = ?"); binds.push(String(a.source_id)); }
    if (period) { sql.push(nx + "o.period_key >= ? AND " + nx + "o.period_key < ?"); binds.push(periodStart(period, p.country), periodEnd(period, p.country)); }
    return { sql, binds, mode: tc.mode };
  };
  // 件数を coverage(組み立て時の集計、正確)から出せる条件か(語・地域・時点が無い)
  const covOk = !t.length && !g && !period;
  return { g, country, period, t, targets, nfilters, whereFor, covOk };
}

// coverage から (layer, price_status) ごとの件数(listed の行だけ)。条件は layer / status / source_id / layers。
async function covCounts(p, a, layers) {
  const where = ["listed = 1", "country = ?"], binds = [p.country];
  if (a.layer) { where.push("layer = ?"); binds.push(String(a.layer)); }
  if (layers) { where.push("layer IN (" + layers.map(() => "?").join(",") + ")"); binds.push(...layers); }
  if (a.status) { where.push("price_status = ?"); binds.push(String(a.status)); }
  if (a.source_id) { where.push("source_id = ?"); binds.push(String(a.source_id)); }
  return (await p.db.prepare("SELECT country, layer, price_status, SUM(n) AS n FROM coverage WHERE " + where.join(" AND ") + " GROUP BY layer, price_status").bind(...binds).all()).results;
}

// 何十万行を並べ替えないための閾値。語・地域・時点の絞り込みが無く、この行数を超えるときは、索引の順(layer, price_basis, 取り込み順)で返す。
const BROAD_ROWS = 200000;
const BROAD_ORDER = "o.layer, o.price_basis, o.rid";
const BROAD_NOTE = "絞り込みが layer・状態・出典だけで行が多いので、並べ替えずに索引の順(layer, price_basis, 取り込み順)で返した。地域・語・時点で絞ると v0.2 と同じ順(値のある行が先)になる。/ Broad query: rows are returned in index order (layer, price_basis, load order) instead of being sorted.";

// 行を載せていない出典(coverage.listed = 0)。件数と理由と原本の URL だけ(2026-09-26 番人の判断)。
async function notListed(p, { g, layer, source_id }) {
  const where = ["listed = 0", "country = ?"], binds = [p.country];
  if (g && g.country === p.country) {
    const gc = geoCond(g);
    where.push(gc.sql.replace(/o\./g, "")); binds.push(...gc.binds);
  }
  if (layer) { where.push("layer = ?"); binds.push(String(layer)); }
  if (source_id) { where.push("source_id = ?"); binds.push(String(source_id)); }
  const rs = (await p.db.prepare("SELECT source_id, price_status, SUM(n) AS n, MIN(period_min) AS pmin, MAX(period_max) AS pmax FROM coverage WHERE " + where.join(" AND ") + " GROUP BY source_id, price_status ORDER BY source_id").bind(...binds).all()).results;
  if (!rs.length) return [];
  const led = await sourcesInfo(p.db, rs.map((r) => r.source_id));
  const out = {};
  for (const r of rs) {
    const d = led[r.source_id] || {};
    const x = (out[r.source_id] = out[r.source_id] || { source_id: r.source_id, title: d.title || null, publisher: d.publisher || null, url: d.url || null,
      landing: d.landing || null, cells_in_source: 0, by_status: {}, period: r.pmax || r.pmin || null, rows_in_db: 0,
      why_not_listed: d.row_listing_reason || null,
      reading: "この出典は表の複製・転載・電子媒体への加工を禁じているので、値も行の一覧も載せていない。数(何セルが刊行物単価か、何セルに値があるか)だけを持つ。値は原本で見ること。/ The source forbids copying its table; only counts are kept here. Read values in the original." });
    x.cells_in_source += r.n; x.by_status[r.price_status] = (x.by_status[r.price_status] || 0) + r.n;
  }
  return Object.values(out);
}

async function absenceOne(p, layer) {
  const where = ["listed = 1", "country = ?"], binds = [p.country];
  if (layer) { where.push("layer = ?"); binds.push(layer); }
  const r = await p.db.prepare("SELECT COALESCE(SUM(n), 0) AS n FROM coverage WHERE " + where.join(" AND ")).bind(...binds).first();
  const scope = [p.country, layer].filter(Boolean).join(" x ");
  if (!r || !r.n) return `${scope} の観測はこの DB にまだ1行も無い(取り込んでいない)。無いことは『世界に存在しない』ではない。何があるかは jccdb_coverage。/ Nothing for ${scope} has been ingested yet; see jccdb_coverage.`;
  return `${scope} の観測は ${r.n} 行あるが、この条件に合う行は無い。まだ取り込んでいないだけかもしれない。何があるかは jccdb_coverage。/ ${r.n} rows exist for ${scope}, none match these filters; see jccdb_coverage.`;
}
async function absence(ctx, targets, layer) {
  const out = [];
  for (const c of targets) {
    const p = await part(ctx, c);
    if (p.fail) continue;
    try { out.push(await absenceOne(p, layer)); } catch (_e) { /* 読めない国は parts に出る */ }
  }
  return out.join(" ");
}

function countBy(rows, f) {
  const o = {};
  for (const r of rows) { const k = f(r); o[k] = (o[k] || 0) + 1; }
  return o;
}
function basisFor(countries) {
  const cs = [...new Set(countries)].filter(Boolean);
  if (!cs.length) cs.push("JP");
  return cs.sort().map((c) => BASIS_NOTE[c]).join(" ");
}
function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (!n) return null;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

// 2つの国の並び(それぞれ SQL で並べた rid と並べ替えの鍵)を JS で束ねる。keys: [[列, "asc"|"desc"], ...]
function cmpBy(keys) {
  return (x, y) => {
    for (const [k, dir] of keys) {
      const a = x[k], b = y[k];
      if (a === b) continue;
      if (a === null || a === undefined) return dir === "desc" ? 1 : -1;
      if (b === null || b === undefined) return dir === "desc" ? -1 : 1;
      const c = a < b ? -1 : 1;
      return dir === "desc" ? -c : c;
    }
    return 0;
  };
}

// ---------------------------------------------------------------- 既存4本

async function searchItems(ctx, a) {
  const t = terms(a.query);
  if (!t.length) return argErr("query が空です。/ query is empty.");
  const lim = clamp(a.limit, 1, 50, 20);
  const pj = await part(ctx, "JP");
  if (pj.fail) return pj.fail;
  const jdb = pj.db;
  let cnt, rows;
  try {
    let sql = "SELECT row_key,item_id,category,item_name,unit,tier,verification_method,evidence_url FROM items WHERE " + t.map(() => "norm LIKE ? ESCAPE '\\'").join(" AND ");
    const binds = t.map(likeArg);
    if (a.category) { sql += " AND category = ?"; binds.push(String(a.category)); }
    cnt = await jdb.prepare(sql.replace(/^SELECT .* FROM/, "SELECT COUNT(*) AS n FROM")).bind(...binds).first();
    rows = (await jdb.prepare(sql + " ORDER BY tier DESC, category, item_name LIMIT ?").bind(...binds, lim).all()).results;
  } catch (e) { return readFail(e, "JP"); }
  const R = await across(ctx, ["JP", "US"], async (p) => {
    const tc = textCond(p, t);
    const ob = (await p.db.prepare("SELECT o.layer AS layer, COUNT(*) AS n FROM obs2 o WHERE " + tc.sql.join(" AND ") + " GROUP BY o.layer").bind(...tc.binds).all()).results;
    return { ob, mode: tc.mode };
  });
  const byLayer = {};
  let obsN = 0;
  for (const c of R.ok) for (const r of R.res[c].ob) { byLayer[c + ":" + r.layer] = r.n; obsN += r.n; }
  const out = {
    query: a.query, matched: cnt.n, count: cnt.n, returned: rows.length, items: rows,
    observations_available: obsN,
    observations_by_layer: byLayer,
    search: Object.fromEntries(R.ok.map((c) => [c, R.res[c].mode])),
    next: obsN ? "地域・時点・価格(または非公開の理由)は jccdb_observations、地域の並びは jccdb_compare_regions で引ける。/ Use jccdb_observations or jccdb_compare_regions for region, date and price status." : "この語の観測(地域・価格)はまだ無い。何があるかは jccdb_coverage。/ No observations yet for this term; see jccdb_coverage.",
    note: "items は『品目が公的資料に実在する』の記録で、地域も価格も持たない。verified は evidence_url の原本で実在を確かめた層。/ items record that the line item exists in a public document; no region or price.",
  };
  return withParts(out, R.ok, R.fails);
}

const OBS_ORDER = "(o.price IS NULL), o.geo_code, o.area_code, o.item_name, o.spec, o.period_key DESC, o.obs_id";

async function observations(ctx, a) {
  const f = await buildFilter(ctx, a);
  if (f.err) return f.err;
  if (!f.nfilters) return argErr("query か pref(geo)のどちらかは要る。/ give query or pref (or geo, country, layer, source_id).");
  const lim = clamp(a.limit, 1, 100, 30);
  const off = clamp(a.offset, 0, 1000000, 0);
  // 1. 国ごとの件数
  const R = await across(ctx, f.targets, async (p) => {
    const w = f.whereFor(p);
    let groups;
    if (f.covOk) groups = await covCounts(p, a);
    else groups = (await p.db.prepare("SELECT o.country AS country, o.layer AS layer, o.price_status AS price_status, COUNT(*) AS n FROM obs2 o WHERE " + w.sql.join(" AND ") + " GROUP BY o.layer, o.price_status").bind(...w.binds).all()).results;
    const total = groups.reduce((s, r) => s + r.n, 0);
    const priced = groups.filter((r) => OPEN_STATUSES.has(r.price_status)).reduce((s, r) => s + r.n, 0);
    return { p, w, groups: groups.map((r) => ({ ...r, country: p.country })), total, priced, broad: f.covOk && total > BROAD_ROWS };
  });
  if (!R.ok.length) return allFailed(R.fails, f.targets);
  // 2. 束ねた並び: v0.2 の ORDER BY (price IS NULL), country, ... と同じく [JP 値あり][US 値あり][JP 値なし][US 値なし]。
  //    索引の順で返す国(broad)は1つの塊として値ありの位置に置く。
  const segs = [];
  for (const c of R.ok) { const x = R.res[c]; if (x.broad) segs.push({ c, start: 0, len: x.total, order: BROAD_ORDER }); else segs.push({ c, start: 0, len: x.priced, order: OBS_ORDER }); }
  for (const c of R.ok) { const x = R.res[c]; if (!x.broad) segs.push({ c, start: x.priced, len: x.total - x.priced, order: OBS_ORDER }); }
  const rows = [];
  let pos = 0;
  for (const s of segs) {
    const a0 = Math.max(off, pos), a1 = Math.min(off + lim, pos + s.len);
    if (a1 > a0) {
      const x = R.res[s.c];
      try { rows.push(...(await pageRows(x.p.db, x.w, s.order, a1 - a0, s.start + (a0 - pos)))); }
      catch (e) { return readFail(e, s.c); }
    }
    pos += s.len;
  }
  const groups = R.ok.flatMap((c) => R.res[c].groups);
  const total = groups.reduce((s, r) => s + r.n, 0);
  const sum = (k) => { const o = {}; for (const r of groups) o[r[k]] = (o[r[k]] || 0) + r.n; return o; };
  const summary = sum("price_status");
  const countries = Object.keys(sum("country"));
  let nl = [];
  if (f.g || a.source_id) for (const c of R.ok) { try { nl = nl.concat(await notListed(R.res[c].p, { g: f.g, layer: a.layer, source_id: a.source_id })); } catch (_e) { /* coverage が読めなければ省く */ } }
  const out = {
    query: a.query || null, pref: f.g && f.g.country === "JP" && f.g.level === "pref" ? f.g.name : null,
    geo: f.g, country: f.country || null, layer: a.layer || null, period: f.period, source_id: a.source_id || null,
    matched: total, count: total, by_status: summary, by_country: sum("country"), by_layer: sum("layer"),
    returned: rows.length, offset: off, next_offset: off + rows.length < total ? off + rows.length : null,
    rows: rows.map(shapeRow),
    search: f.t.length ? Object.fromEntries(R.ok.map((c) => [c, R.res[c].w.mode])) : undefined,
    order_note: R.ok.some((c) => R.res[c].broad) ? BROAD_NOTE : undefined,
    status_legend: STATUS_LEGEND, basis: basisFor(countries.length ? countries : [f.country || R.ok[0]]), basis_by_country: BASIS_NOTE, license_note: LICENSE_NOTE,
    honest_reading: total === 0
      ? "この条件の観測はまだ無い。無いことは『存在しない』ではなく『まだ取り込んでいない』である。/ Not yet ingested; absence here is not absence in the world. " + (await absence(ctx, R.ok, a.layer))
      : (summary.publication_based_not_public
        ? "『publication_based_not_public』の行は、公的機関が値を公開していない(市販の物価資料の値を使う)という事実の記録であり、JCCDB の欠落ではない。/ Rows marked publication_based_not_public record that the public body itself does not publish a value."
        : null),
    not_listed: nl,
    not_listed_reading: nl.length ? "この地域には、表の複製を禁じているため行を載せていない出典がある(not_listed)。件数と状態の内訳と原本の URL だけを返す。/ Some sources for this region forbid copying; only their counts and URLs are returned." : null,
  };
  return withParts(out, R.ok, R.fails);
}

async function laborRate(ctx, a) {
  const history = bool(a.history);
  if (!a.pref && !a.geo && !a.job) return argErr("pref か job のどちらかは要る。/ give pref or job.");
  const f = await buildFilter(ctx, { pref: a.pref, geo: a.geo, country: a.country || "JP" });
  if (f.err) return f.err;
  const c = f.targets[0];
  const p = await part(ctx, c);
  if (p.fail) return p.fail;
  const CAP = 20000;
  let all, src;
  const run = async () => {
    const w = f.whereFor(p, { terms: terms(a.job) });
    const where = ["o.layer = 'labor'", ...w.sql];
    all = (await p.db.prepare("SELECT " + SLIM_SEL + " FROM " + SLIM_FROM + " WHERE " + where.join(" AND ") + " ORDER BY o.period_key DESC, o.rid LIMIT ?").bind(...w.binds, CAP).all()).results;
    src = await sourcesInfo(p.db, all.map((r) => r.source_id));
  };
  try {
    try { await run(); } catch (e) { if (p.fts && /fts5|obs2_fts|no such module/i.test(String(e.message))) { p.fts = false; await run(); } else throw e; }
  } catch (e) { return readFail(e, c); }
  const lim = clamp(a.limit, 1, 200, 60);
  const flat = (r) => ({
    pref: r.country === "JP" ? r.geo_name : null, geo_code: r.geo_code, geo_name: r.geo_name, job: r.item_name,
    wage_yen_per_8h: r.currency === "JPY" ? r.price : null, wage_plus_required_costs_yen_ref: r.currency === "JPY" ? r.ref_value : null,
    wage: r.price, currency: r.currency || null, unit: r.unit, price_basis: r.price_basis,
    price_status: r.price_status, period: r.period, effective_from: r.effective_from, evidence_url: r.evidence_url,
    source_id: r.source_id, license: r.license, attribution: r.attribution || null, computed: r.computed === 1,
  });
  const used = [...new Set(all.map((r) => r.source_id))].map((id) => ({ source_id: id, title: (src[id] || {}).title || null, license: (src[id] || {}).license || null, attribution: (src[id] || {}).attribution || null }));
  const base = {
    source: used.length ? used.slice(0, 20).map((u) => u.title).join(" / ") : "国土交通省『公共工事設計労務単価』(PDL1.0) / MLIT public-works design labor rates",
    sources_used: used.slice(0, 200), sources_used_total: used.length, truncated: all.length >= CAP,
    reading: c === "JP"
      ? "所定労働時間内8時間あたりの賃金。事業主が負担する法定福利費・労務管理費等は含まない(参考値は wage_plus_required_costs_yen_ref)。not_set はその県でその職種の単価を設定していない。/ Wage per 8 scheduled hours, excluding employer costs (see the reference value)."
      : "米国の labor は Davis-Bacon の一般賃金決定(基本時給と付加給付が別の行)。組で見るなら jccdb_us_prevailing_wage。/ U.S. labor rows are Davis-Bacon rates (base and fringe are separate rows); use jccdb_us_prevailing_wage to see them paired.",
    basis: c === "JP" ? BASIS_NOTE.JP : US_BASIS.prevailing_wage + " " + BASIS_NOTE.US, status_legend: STATUS_LEGEND, license_note: LICENSE_NOTE,
  };
  if (history) {
    const ser = new Map();
    for (const r of [...all].sort((x, y) => (x.period_key < y.period_key ? -1 : x.period_key > y.period_key ? 1 : x.rid - y.rid))) {
      const k = [r.country, r.geo_code, r.area_label, r.item_name, r.unit, r.price_basis].join("\x1f");
      if (!ser.has(k)) ser.set(k, { pref: r.country === "JP" ? r.geo_name : null, geo_code: r.geo_code, geo_name: r.geo_name, job: r.item_name, unit: r.unit, price_basis: r.price_basis, _rid: r.rid, points: [] });
      ser.get(k).points.push({ period: r.period, effective_from: r.effective_from, wage: r.price, currency: r.currency || null, ref_value: r.ref_value, price_status: r.price_status,
        source_id: r.source_id, evidence_url: r.evidence_url, license: r.license, attribution: r.attribution || null, computed: r.computed === 1 });
    }
    const series = [...ser.values()].sort((x, y) => (x.geo_code < y.geo_code ? -1 : x.geo_code > y.geo_code ? 1 : x._rid - y._rid)).slice(0, lim).map(({ _rid, ...s }) => ({ ...s, periods: s.points.map((q) => q.period) }));
    return { history: true, count: series.length, series, rows: series.flatMap((s) => s.points.map((q) => ({ pref: s.pref, geo_code: s.geo_code, job: s.job, wage_yen_per_8h: q.currency === "JPY" ? q.wage : null, ...q }))),
      period_note: "年ごとの系列(古い順)。取り込んだ年だけが並ぶ。欠けた年は『その年の単価が無い』ではなく『取り込んでいない』。/ Yearly series, oldest first; missing years are not ingested, not absent.", ...base };
  }
  // 既定: 地域ごとに、条件に合う行の最新の時点だけ(v0.1 と同じく 1 地域 x 1 職種 = 1 行)
  const latest = {};
  for (const r of all) { const k = r.country + r.geo_code; if (!latest[k] || r.period_key > latest[k]) latest[k] = r.period_key; }
  const rows = all.filter((r) => r.period_key === latest[r.country + r.geo_code])
    .sort((x, y) => (x.geo_code < y.geo_code ? -1 : x.geo_code > y.geo_code ? 1 : x.rid - y.rid)).slice(0, lim).map(flat);
  return { rows, count: rows.length, periods: [...new Set(rows.map((r) => r.period))],
    period_note: "地域ごとに最新の時点だけを返す。過去の年は history:true。/ Latest period per region; pass history:true for the yearly series.", ...base };
}

async function sources(ctx, a) {
  const country = normCountry(a.country);
  if (country === undefined) return argErr("country は JP か US: " + a.country);
  const lim = clamp(a.limit, 1, 500, 20);
  const off = clamp(a.offset, 0, 100000, 0);
  const targets = country ? [country] : ["JP", "US"];
  let legacy = {}, built = null;
  if (ctx.env && ctx.env.DB) {
    try {
      legacy = Object.fromEntries((await ctx.env.DB.prepare("SELECT source_id, body FROM sources ORDER BY source_id").all()).results.map((r) => [r.source_id, JSON.parse(r.body)]));
      const meta = await ctx.env.DB.prepare("SELECT v FROM meta WHERE k='built'").first();
      built = meta ? JSON.parse(meta.v) : null;
    } catch (_e) { /* v0.1 の表が無い DB でも v2 の台帳は返す */ }
  }
  const R = await across(ctx, targets, async (p) => {
    const where = [], binds = [];
    if (a.source_id) { where.push("source_id = ?"); binds.push(String(a.source_id)); }
    if (!blank(a.query)) { where.push("(source_id LIKE ? ESCAPE '\\' OR lower(title) LIKE ? ESCAPE '\\' OR lower(publisher) LIKE ? ESCAPE '\\')"); const l = likeArg(String(a.query).toLowerCase().trim()); binds.push(l, l, l); }
    const w = where.length ? " WHERE " + where.join(" AND ") : "";
    const n = (await p.db.prepare("SELECT COUNT(*) AS n FROM sources2" + w).bind(...binds).first()).n;
    const rs = (await p.db.prepare("SELECT source_id, body FROM sources2" + w + " ORDER BY source_id LIMIT ?").bind(...binds, off + lim).all()).results;
    return { n, rs, built: p.built };
  });
  if (!R.ok.length) return allFailed(R.fails, targets);
  const merged = R.ok.flatMap((c) => R.res[c].rs).sort((x, y) => (x.source_id < y.source_id ? -1 : 1)).slice(off, off + lim);
  const total = R.ok.reduce((s, c) => s + R.res[c].n, 0);
  const ledger = Object.fromEntries(merged.map((r) => [r.source_id, JSON.parse(r.body)]));
  const out = {
    built, built_v2: Object.fromEntries(R.ok.map((c) => [c, R.res[c].built])), sources: legacy, ledger, count: total,
    returned: merged.length, offset: off, next_offset: off + merged.length < total ? off + merged.length : null,
    note: "ledger が観測層 v2 の出典台帳(URL・原本の sha256・利用条件の条文・読み方)。出典は約 2,500 あるので limit(既定 20、最大 500)ずつ返す。country・source_id・query で絞れる。sources は v0.1 の3出典(後方互換で残している)。built_v2 は国ごとの組み立ての記録。/ ledger holds the source ledger, paged by limit (default 20); filter with country, source_id or query. sources is the v0.1 subset kept for compatibility.",
  };
  return withParts(out, R.ok, R.fails);
}

// ---------------------------------------------------------------- v0.2 の5本

async function compareRegions(ctx, a) {
  if (!terms(a.query).length) return argErr("query(品目名)が要る。例: query='生コンクリート', spec='21-8-25(20)'。/ query (item name) is required.");
  const mode = a.normalize == null || a.normalize === "" ? "exact" : String(a.normalize);
  if (!["exact", "namacon"].includes(mode)) return argErr("normalize は exact か namacon: " + a.normalize + " / normalize must be exact or namacon");
  const country0 = normCountry(a.country);
  if (country0 === undefined) return argErr("country は JP か US: " + a.country + " / country must be JP or US");
  if (a.geo_level && !(await geoLevelOk(ctx, a.geo_level, targetsOf(country0, null)))) return argErr("geo_level が分からない: " + a.geo_level + " / geo_level must be one of " + GEO_LEVELS.join(", "));
  const f = await buildFilter(ctx, { query: [a.query, a.spec].filter(Boolean).join(" "), country: a.country, layer: a.layer, status: a.status });
  if (f.err) return f.err;
  const CAP = 20000;
  const R = await across(ctx, f.targets, async (p) => {
    const w = f.whereFor(p);
    if (a.geo_level) { w.sql.push("o.geo_level = ?"); w.binds.push(String(a.geo_level)); }
    const rows = (await p.db.prepare("SELECT " + SLIM_SEL + " FROM " + SLIM_FROM + " WHERE " + w.sql.join(" AND ") + " ORDER BY o.period_key DESC, o.obs_id LIMIT ?").bind(...w.binds, CAP).all()).results;
    return { rows, mode: w.mode };
  });
  if (!R.ok.length) return allFailed(R.fails, f.targets);
  const all = R.ok.flatMap((c) => R.res[c].rows);
  const truncated = R.ok.some((c) => R.res[c].rows.length >= CAP);
  if (!all.length) {
    return withParts({ query: a.query, spec: a.spec || null, matched_rows: 0, count: 0, groups_total: 0, groups: [], status_legend: STATUS_LEGEND, basis: basisFor([f.country || R.ok[0]]),
      honest_reading: await absence(ctx, R.ok, a.layer) }, R.ok, R.fails);
  }
  const latestKey = {};
  const exactKey = (r) => [r.country, r.layer, norm(r.item_name), norm(r.spec), norm(r.unit), r.price_basis, r.currency || ""].join("\x1f");
  const nkCache = new Map();
  const nk = (r) => { if (!nkCache.has(r.obs_id)) nkCache.set(r.obs_id, mode === "namacon" && r.layer === "material" ? namaconKey(r.item_name, r.spec) : null); return nkCache.get(r.obs_id); };
  const cmpKey = (r) => {
    const k = nk(r);
    return k ? ["namacon", r.country, r.layer, k.cement, k.designation, k.wc_max ?? "", k.c_min ?? "", norm(r.unit), r.price_basis, r.currency || ""].join("\x1f") : exactKey(r);
  };
  const regionKey = (r) => [cmpKey(r), r.geo_level, r.geo_code, r.area_label, r.area_code].join("\x1f");
  for (const r of all) { const k = regionKey(r); if (!latestKey[k] || r.period_key > latestKey[k]) latestKey[k] = r.period_key; }
  const latest = all.filter((r) => r.period_key === latestKey[regionKey(r)]);
  const gmap = new Map();
  for (const r of latest) {
    const k = cmpKey(r);
    if (!gmap.has(k)) gmap.set(k, []);
    gmap.get(k).push(r);
  }
  const at = (r) => ({ value: r.price, computed: r.computed === 1, geo_level: r.geo_level, geo_code: r.geo_code, geo_name: r.geo_name, area_label: r.area_label, area_code: r.area_code, period: r.period, source_id: r.source_id, evidence_url: r.evidence_url, license: r.license, attribution: r.attribution || null });
  const groups = [...gmap.values()].map((rs) => {
    const priced = rs.filter((r) => r.price != null).sort((x, y) => x.price - y.price);
    const periods = [...new Set(rs.map((r) => r.period))].sort();
    const r0 = rs[0];
    const regions = [...rs].sort((x, y) => (x.price == null) - (y.price == null) || (x.price ?? 0) - (y.price ?? 0) || String(x.geo_code).localeCompare(String(y.geo_code)) || String(x.area_code).localeCompare(String(y.area_code)));
    const specs = [...new Set(rs.map((r) => r.spec))];
    const k0 = nk(r0);
    return {
      country: r0.country, layer: r0.layer, item_name: r0.item_name, spec: r0.spec, unit: r0.unit, price_basis: r0.price_basis, currency: r0.currency || null,
      normalized: k0 ? { kind: "namacon", ...k0, computed: true } : undefined,
      spec_variants: specs.length > 1 ? specs : undefined, sources: [...new Set(rs.map((r) => r.source_id))],
      regions_total: rs.length, by_status: countBy(rs, (r) => r.price_status), periods, periods_mixed: periods.length > 1,
      stats: {
        n_priced: priced.length,
        min: priced.length ? at(priced[0]) : null,
        median: priced.length ? { value: median(priced.map((r) => r.price)), computed: true, method: "値のある地域を並べた真ん中(偶数個なら真ん中2つの平均)。/ middle of the priced regions (mean of the two middle values when even)." } : null,
        max: priced.length ? at(priced[priced.length - 1]) : null,
      },
      regions: regions.slice(0, 200).map(shapeRow), regions_truncated: regions.length > 200,
    };
  }).sort((x, y) => y.regions_total - x.regions_total || y.stats.n_priced - x.stats.n_priced);
  const lim = clamp(a.limit, 1, 20, 5);
  const countries = [...new Set(latest.map((r) => r.country))];
  const out = {
    query: a.query, spec: a.spec || null, country: f.country || null, layer: a.layer || null, normalize: mode,
    matched_rows: latest.length, count: latest.length, groups_total: groups.length, returned_groups: Math.min(lim, groups.length), truncated,
    by_status: countBy(latest, (r) => r.price_status),
    groups: groups.slice(0, lim),
    search: Object.fromEntries(R.ok.map((c) => [c, R.res[c].mode])),
    reading: "地域ごとに最新の時点の行だけを並べた。品目・規格・単位・値の種類が同じもの(全角と半角・空白の違いはそろえる。spec_variants に原本の書き方)だけを1つの組にする(普通と高炉、単位の違う行は別の組)。min / max はその地域の行の値(原本の値なら computed:false。着工統計の 1m2 あたりのように組み立てで計算した行なら computed:true)、median はこのサービスが計算した値(computed:true)。area_members と note は省いた(jccdb_observations で引ける)。値の無い地域は by_status と regions の price_status で理由を言う。/ Latest row per region; only identical item/spec/unit/basis are compared. min and max are source values; the median is computed.",
    status_legend: STATUS_LEGEND, basis: basisFor(countries), license_note: LICENSE_NOTE, computed_note: COMPUTED_NOTE,
    honest_reading: groups.length > lim
      ? (mode === "exact" && /生コン/.test(String(a.query || "") + String(a.spec || ""))
        ? `比べられる組が ${groups.length} ある。生コンは局ごとに規格の書き方が違うので、normalize='namacon' で局をまたいで束ねられる(セメント・呼び強度-スランプ-骨材・水セメント比・単位セメント量で束ねる)。/ ${groups.length} groups; use normalize='namacon' to group ready-mix concrete across bureaus.`
        : `比べられる組が ${groups.length} ある。spec で絞ると1つになる。/ ${groups.length} comparable groups; narrow with spec.`)
      : null,
    normalize_note: mode === "namacon" ? "normalize='namacon': 生コンの規格を、セメントの種類・呼び強度-スランプ-粗骨材の最大寸法・水セメント比の上限・単位セメント量の下限で束ねた(normalized。束ね方はこのサービスの読み取りなので computed:true)。単位水量など他の条件は束ねる鍵に入れていない。原本の書き方は spec_variants と各地域の spec にある。/ Ready-mix specs grouped by cement type, designation, max W/C and min cement content (computed); other conditions are not part of the key." : undefined,
  };
  return withParts(out, R.ok, R.fails);
}

const WORK_KEYS = [["source_id", "asc"], ["geo_code", "asc"], ["area_label", "asc"], ["area_code", "asc"], ["item_name", "asc"], ["spec", "asc"], ["period_key", "desc"], ["obs_id", "asc"]];
const WORK_ORDER = "o.source_id, o.geo_code, o.area_label, o.area_code, o.item_name, o.spec, o.period_key DESC, o.obs_id";

async function workUnitPrice(ctx, a) {
  if (!terms(a.query).length && !a.pref && !a.geo && !a.source_id) return argErr("query(工種・品目)か pref(geo)か source_id のどれかは要る。/ give query, pref/geo or source_id.");
  const f = await buildFilter(ctx, { query: a.query, pref: a.pref, geo: a.geo, country: a.country, period: a.period, source_id: a.source_id });
  if (f.err) return f.err;
  const lim = clamp(a.limit, 1, 100, 20);
  const off = clamp(a.offset, 0, 1000000, 0);
  // 1. 単価の行(構成比でない行)を数え、並べて rid を取る(国が2つなら両方から off + lim 行ずつ取り、同じ鍵で束ねる)
  const multi = f.targets.length > 1;
  const R = await across(ctx, f.targets, async (p) => {
    const w = f.whereFor(p);
    const where = ["o.layer = 'work'", "o.price_basis <> 'ratio'", ...w.sql];
    const groups = (await p.db.prepare("SELECT o.price_status AS price_status, COUNT(*) AS n FROM obs2 o WHERE " + where.join(" AND ") + " GROUP BY o.price_status").bind(...w.binds).all()).results;
    const keys = (await p.db.prepare("SELECT o.rid, o.source_id, o.geo_code, o.area_label, o.area_code, o.item_name, o.spec, o.period_key, o.obs_id FROM obs2 o WHERE " + where.join(" AND ") + " ORDER BY " + WORK_ORDER + " LIMIT ? OFFSET ?").bind(...w.binds, multi ? off + lim : lim, multi ? 0 : off).all()).results;
    return { p, groups: groups.map((r) => ({ ...r, country: p.country })), keys: keys.map((k) => ({ ...k, _c: p.country })) };
  });
  if (!R.ok.length) return allFailed(R.fails, f.targets);
  let page = R.ok.flatMap((c) => R.res[c].keys);
  if (multi) page = page.sort(cmpBy(WORK_KEYS)).slice(off, off + lim);
  const out = [];
  let attached = 0;
  for (const c of R.ok) {
    const p = R.res[c].p;
    const mine = page.filter((k) => k._c === c).map((k) => k.rid);
    if (!mine.length) continue;
    let pkgs, ratios = [];
    try {
      pkgs = await fetchByRids(p.db, mine);
      // 2. そのページの単価の行と同じ出典・規格の構成比の行だけを読む(規格は 40 個ずつ)
      const sids = [...new Set(pkgs.map((x) => x.source_id))];
      const specs = [...new Set(pkgs.map((x) => x.spec))];
      for (let i = 0; i < specs.length && sids.length; i += 40) {
        const ch = specs.slice(i, i + 40);
        const rids = (await p.db.prepare("SELECT o.rid FROM obs2 o WHERE o.layer = 'work' AND o.price_basis = 'ratio' AND o.source_id IN (" + sids.map(() => "?").join(",") +
          ") AND o.spec IN (" + ch.map(() => "?").join(",") + ") ORDER BY o.rid LIMIT 20000").bind(...sids, ...ch).all()).results.map((r) => r.rid);
        ratios.push(...(await fetchByRids(p.db, rids)));
      }
    } catch (e) { return readFail(e, c); }
    // 3. 添える: まず note の『obs_id=<16桁>』、無ければ同じ出典・地域・地区・時点・規格で、品目名が『<単価の行の品目名> 』で始まる行
    const byId = new Map(pkgs.map((x) => [x.obs_id, { row: x, comp: [], linked_by: new Set() }]));
    const key = (r) => [r.source_id, r.geo_code, r.area_label, r.area_code, r.period, r.spec].join("\x1f");
    const byKey = new Map();
    for (const e of byId.values()) { const k = key(e.row); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(e); }
    for (const r of ratios) {
      const m = /obs_id=([0-9a-f]{16})/.exec(r.note || "");
      let e = m ? byId.get(m[1]) : null;
      let how = "obs_id";
      if (!e && !m) {
        const cands = (byKey.get(key(r)) || []).filter((x) => norm(r.item_name).startsWith(norm(x.row.item_name)));
        e = cands.sort((x, y) => norm(y.row.item_name).length - norm(x.row.item_name).length)[0] || null;
        how = "same_key_and_name";
      }
      if (e) { e.comp.push(r); e.linked_by.add(how); attached++; }
    }
    for (const { row, comp, linked_by } of byId.values()) {
      out.push({ _rid: row.rid, _c: c, pkg: {
        ...shapeRow(row),
        composition: comp.map((r) => ({
          obs_id: r.obs_id, item_name: r.item_name, part: r.item_name.startsWith(row.item_name) ? r.item_name.slice(row.item_name.length).trim() : r.item_name,
          spec: r.spec, unit: r.unit, ratio: r.price ?? null, price_status: r.price_status, note: r.note, computed: r.computed === 1,
        })),
        composition_linked_by: [...linked_by],
      } });
    }
  }
  const order = new Map(page.map((k, i) => [k._c + ":" + k.rid, i]));
  const packages = out.sort((x, y) => order.get(x._c + ":" + x._rid) - order.get(y._c + ":" + y._rid)).map((x) => x.pkg);
  const groups = R.ok.flatMap((c) => R.res[c].groups);
  const total = groups.reduce((s, r) => s + r.n, 0);
  const countries = [...new Set(groups.map((r) => r.country))];
  const res = {
    query: a.query || null, geo: f.g, period: f.period, packages_total: total, count: total, returned: packages.length, offset: off,
    next_offset: off + packages.length < total ? off + packages.length : null, packages, composition_rows_attached: attached,
    by_status: groups.reduce((o, r) => { o[r.price_status] = (o[r.price_status] || 0) + r.n; return o; }, {}),
    reading: "layer=work(工事の単価: 材料・労務・機械の複合)。構成比(price_basis=ratio)の行は、note の obs_id で示された単価の行に添えた(無ければ同じ出典・地域・地区・時点・規格で品目名が続く行)。構成比には内訳の内訳(K と K1 など)があるので、足しても 100 にならない。施工パッケージの標準単価は東京地区・基準年月の値で、他地区・他時点は構成比と地区の単価で補正して使う(各行の note)。米国の work は DoD の支援施設の単価(市販資料由来で値なし)と FTA の出来形原価。/ Ratio rows are attached to the package named in their note (obs_id), else to the package of the same source, region, period and spec whose item name they extend. Ratios are nested, so they need not sum to 100.",
    status_legend: STATUS_LEGEND, basis: basisFor(countries.length ? countries : [f.country || R.ok[0]]), license_note: LICENSE_NOTE, computed_note: COMPUTED_NOTE,
    honest_reading: total ? null : await absence(ctx, R.ok, "work"),
  };
  return withParts(res, R.ok, R.fails);
}

async function indexSeries(ctx, a) {
  const f = await buildFilter(ctx, { query: a.query, geo: a.geo, country: a.country, source_id: a.source_id });
  if (f.err) return f.err;
  let from = null, to = null;
  const fp = a.from ? normPeriod(a.from) : null, tp = a.to ? normPeriod(a.to) : null;
  if (a.from && !fp) return argErr("from の形が分からない: " + a.from);
  if (a.to && !tp) return argErr("to の形が分からない: " + a.to);
  const c0 = f.country || (f.targets.length === 1 ? f.targets[0] : null);
  if (fp) from = periodStart(fp, c0);
  if (tp) to = periodEnd(tp, c0);
  if (from && to && from >= to) return argErr("from が to より後。/ from is after to.");
  const skey = "o.source_id, o.item_name, o.spec, o.unit, o.geo_level, o.geo_code, o.area_label, o.price_basis";
  if (!f.t.length && !a.source_id) {
    // 系列の一覧だけ(点は返さない)
    const R = await across(ctx, f.targets, async (p) => {
      const w = f.whereFor(p);
      const where = ["o.layer = 'index'", ...w.sql];
      return (await p.db.prepare("SELECT " + skey + ", o.country AS country, o.geo_name AS geo_name, COALESCE(o.license, s.license) AS license, s.attribution AS attribution, COUNT(*) AS n, SUM(o.price IS NOT NULL) AS n_priced, MIN(o.period_key) AS k0, MAX(o.period_key) AS k1 FROM " + SLIM_FROM + " WHERE " +
        where.join(" AND ") + " GROUP BY " + skey + ", o.country, o.geo_name, COALESCE(o.license, s.license) ORDER BY o.source_id, o.item_name, o.spec LIMIT 200").bind(...w.binds).all()).results;
    });
    if (!R.ok.length) return allFailed(R.fails, f.targets);
    const cat = R.ok.flatMap((c) => R.res[c]).slice(0, 200);
    return withParts({ mode: "catalog", count: cat.length, series: cat.map((r) => ({ ...r, attribution: r.attribution || null })),
      next: "query か source_id を渡すと点(値と前年同期比)を返す。/ Pass query or source_id to get the points.",
      honest_reading: cat.length ? null : await absence(ctx, R.ok, "index") }, R.ok, R.fails);
  }
  const CAP = 20000;
  const R = await across(ctx, f.targets, async (p) => {
    const w = f.whereFor(p);
    const where = ["o.layer = 'index'", ...w.sql];
    return (await p.db.prepare("SELECT " + SLIM_SEL + " FROM " + SLIM_FROM + " WHERE " + where.join(" AND ") + " ORDER BY o.period_key, o.obs_id LIMIT ?").bind(...w.binds, CAP).all()).results;
  });
  if (!R.ok.length) return allFailed(R.fails, f.targets);
  const all = R.ok.flatMap((c) => R.res[c]);
  const smap = new Map();
  for (const r of all) {
    const k = [r.source_id, r.item_name, r.spec, r.unit, r.geo_level, r.geo_code, r.area_label, r.price_basis].join("\x1f");
    if (!smap.has(k)) smap.set(k, []);
    smap.get(k).push(r);
  }
  const lim = clamp(a.limit, 1, 20, 5);
  const maxPts = clamp(a.max_points, 1, 1000, 500);
  const series = [...smap.values()].slice(0, lim).map((rs) => {
    const r0 = rs[0];
    const fr = fp ? periodStart(fp, r0.country) : null, tr = tp ? periodEnd(tp, r0.country) : null;
    const byP = new Map(rs.map((r) => [r.period, r]));
    const inWin = rs.filter((r) => (!fr || r.period_key >= fr) && (!tr || r.period_key < tr));
    const pts = inWin.map((r) => {
      const bp = prevYearPeriod(r.period);
      const b = bp ? byP.get(bp) : null;
      let yoy = null;
      if (r.price != null && b && b.price != null && b.price !== 0) {
        yoy = { pct: Math.round((r.price / b.price - 1) * 100000) / 1000, base_period: bp, base_value: b.price, computed: true };
      }
      return { period: r.period, value: r.price ?? null, ref_value: r.ref_value ?? null, ref_note: r.ref_note || null, price_status: r.price_status, computed: r.computed === 1,
        yoy, yoy_missing_reason: yoy ? null : (r.price == null ? "当期の値が無い" : !b ? "前年同期(" + bp + ")の行が無い" : "前年同期の値が無いか 0") };
    });
    const shown = pts.slice(Math.max(0, pts.length - maxPts));
    return {
      source_id: r0.source_id, country: r0.country, item_name: r0.item_name, spec: r0.spec, unit: r0.unit, price_basis: r0.price_basis,
      geo_level: r0.geo_level, geo_code: r0.geo_code, geo_name: r0.geo_name, area_label: r0.area_label,
      license: r0.license, attribution: r0.attribution || null, evidence_url: r0.evidence_url,
      points_total: pts.length, points_returned: shown.length, first_period: pts.length ? pts[0].period : null, last_period: pts.length ? pts[pts.length - 1].period : null,
      latest: shown.length ? shown[shown.length - 1] : null, points: shown,
    };
  });
  const out = {
    query: a.query || null, country: f.country || null, geo: f.g, from: a.from || null, to: a.to || null,
    series_total: smap.size, count: smap.size, returned_series: series.length, series, truncated: R.ok.some((c) => R.res[c].length >= CAP),
    yoy_note: "yoy.pct はこのサービスが計算した前年同期比(computed:true)で、原本には無い。式: (当期の値 / 前年同期の値 - 1) x 100。原系列(value)で計算し、季節調整値(ref_value)では計算していない。/ yoy.pct is computed by this service from the unadjusted values: (value / value one year earlier - 1) x 100.",
    status_legend: STATUS_LEGEND, basis: basisFor([...new Set(all.map((r) => r.country))]), license_note: LICENSE_NOTE, computed_note: COMPUTED_NOTE,
    honest_reading: smap.size ? null : await absence(ctx, R.ok, "index"),
  };
  return withParts(out, R.ok, R.fails);
}

// ---------------------------------------------------------------- 米国

const SQFT_PER_M2 = 0.09290304; // 1 sqft = 0.09290304 m2(定義値)
const PER_SQFT_BASES = new Set(["cost_per_sqft", "permit_valuation_per_sqft_median_usd"]);
function perM2(r) {
  if (!PER_SQFT_BASES.has(r.price_basis) || r.price == null) return undefined;
  return { value: Math.round((r.price / SQFT_PER_M2) * 100) / 100, unit: "USD/m2", computed: true, method: "USD/sqft / 0.09290304(1 sqft = 0.09290304 m2)。/ converted by this service." };
}

// 州を含む USACE の機械損料の地域(EP-R1..R12)。geo_names に地域の州の一覧がある。
async function epRegionsOf(p, stateCode) {
  const name = US_STATES[stateCode];
  if (!name) return [];
  const rs = (await p.db.prepare("SELECT DISTINCT geo_code, name FROM geo_names WHERE geo_level = 'usace_ep_region'").all()).results;
  return rs.filter((r) => String(r.name).split(/\s*;\s*/).some((x) => x.trim().toLowerCase() === name.toLowerCase())).map((r) => r.geo_code);
}

const US_ORDER = "o.layer, (o.price IS NULL), o.geo_code, o.area_label, o.item_name, o.spec, o.period_key DESC, o.obs_id";

async function usPrices(ctx, a) {
  let layers = US_PRICE_LAYERS;
  if (a.layer) {
    if (!US_PRICE_LAYERS.includes(String(a.layer))) return argErr("layer は " + US_PRICE_LAYERS.join(", ") + " のどれか: " + a.layer);
    layers = [String(a.layer)];
  }
  if (!blank(a.state) && !blank(a.geo) && String(a.state).trim() !== String(a.geo).trim()) return argErr("state と geo は片方だけ渡すこと。/ pass either state or geo.");
  const p = await part(ctx, "US");
  if (p.fail) return p.fail;
  // 全国一律・地域一律の行を添えるのは、既定では州を指定したときだけ(v0.2 と同じ)。郡・都市圏・市では全国の行(約 10 万行)が埋もれさせるので、include_national:true のときだけ。
  let includeNational = blank(a.include_national) ? null : bool(a.include_national);
  let g = null;
  try {
    const input = blank(a.geo) ? a.state : a.geo;
    if (!blank(input)) {
      g = await resolveUsGeo(p, input);
      if (g && g.error) return argErr(g.error, { code: g.code, candidates: g.candidates });
      if (g && g.country !== "US") return argErr("米国の地域ではない: " + input);
    }
  } catch (e) { return readFail(e, "US"); }
  if (includeNational === null) includeNational = !g || g.level === "state";
  const f = await buildFilter(ctx, { query: a.query, country: "US", period: a.period, status: a.status, source_id: a.source_id });
  if (f.err) return f.err;
  let ep = [];
  // 州(郡)を指定したときの地域の条件は「その州(と郡・管区)OR 全国の行 OR その州を含む USACE の地域」(全国一律・地域一律の値を落とさないため)
  const lim = clamp(a.limit, 1, 100, 30);
  const off = clamp(a.offset, 0, 1000000, 0);
  const narrow = f.t.length || g || f.period || a.source_id;
  let groups, rows, mode = null, broad = false;
  const run = async () => {
    if (g && includeNational && g.level !== "national") ep = await epRegionsOf(p, g.level === "state" ? g.code : (g.state || String(g.code).slice(0, 2)));
    const w = f.whereFor(p, { layers, geoGiven: !!g });
    if (g) { const gc = geoCond(g); const wide = includeNational && g.level !== "national"; w.sql.push(wide ? "(" + gc.sql + " OR (o.geo_code = 'US' AND o.geo_level = 'national')" + (ep.length ? " OR o.geo_code IN (" + ep.map(() => "?").join(",") + ")" : "") + ")" : gc.sql); w.binds.push(...gc.binds, ...(wide ? ep : [])); }
    mode = w.mode;
    if (!narrow) groups = await covCounts(p, {}, layers).then((rs) => a.status ? rs.filter((r) => r.price_status === a.status) : rs);
    else groups = (await p.db.prepare("SELECT o.layer AS layer, o.price_status AS price_status, COUNT(*) AS n FROM obs2 o WHERE " + w.sql.join(" AND ") + " GROUP BY o.layer, o.price_status").bind(...w.binds).all()).results;
    const total0 = groups.reduce((s, r) => s + r.n, 0);
    broad = !narrow && total0 > BROAD_ROWS;
    rows = await pageRows(p.db, w, broad ? BROAD_ORDER : US_ORDER, lim, off);
  };
  try {
    try { await run(); } catch (e) { if (p.fts && /fts5|obs2_fts|no such module/i.test(String(e.message))) { p.fts = false; await run(); } else throw e; }
  } catch (e) { return readFail(e, "US"); }
  const total = groups.reduce((s, r) => s + r.n, 0);
  const sum = (k) => { const o = {}; for (const r of groups) o[r[k]] = (o[r[k]] || 0) + r.n; return o; };
  const shaped = rows.map((r) => {
    const o = shapeRow(r);
    o.geo_match = g && g.level !== "national" ? (r.geo_level === "national" ? "national" : r.geo_level === "usace_ep_region" ? "region" : "exact") : null;
    const pm = perM2(r);
    if (pm) o.per_m2 = pm;
    return o;
  });
  return {
    query: a.query || null, state: g, geo: g, layers, include_national: !!(g && g.level !== "national" && includeNational), period: f.period,
    matched: total, count: total, by_layer: sum("layer"), by_status: sum("price_status"),
    returned: shaped.length, offset: off, next_offset: off + shaped.length < total ? off + shaped.length : null, rows: shaped,
    search: f.t.length ? { US: mode } : undefined, order_note: broad ? BROAD_NOTE : undefined,
    reading: "州を指定したときは、その州(と郡・管区)の行に加えて全国一律の行(FEMA の損料など)と、その州を含む USACE の機械損料の地域の行も返す(geo_match が national / region。include_national:false で外せる)。郡・都市圏・市のときは、include_national:true のときだけ添える。都市圏(metro)の行は州で絞れないので、州を指定すると出ない(cbsa:31080 の形で渡す)。/ With a state, national rows and USACE equipment-region rows covering the state are included (geo_match national / region); metro rows need cbsa:<code>.",
    status_legend: STATUS_LEGEND, basis: BASIS_NOTE.US, license_note: LICENSE_NOTE, computed_note: COMPUTED_NOTE,
    honest_reading: total ? null : await absence(ctx, ["US"], a.layer || null),
  };
}

// Davis-Bacon の決定の郡の欄(「Oregon Counties of Benton, Clackamas, Lane and Multnomah」)を名前の一覧にする。
export function dbraCounties(text) {
  const m = /\b(?:Counties|County|Parishes|Parish|Boroughs|Borough)\s+of\s+(.+)$/i.exec(String(text || ""));
  if (!m) return [];
  return m[1].split(/\s*,\s*|\s+and\s+/i).map((x) => x.trim()).filter(Boolean);
}

// Davis-Bacon の行は price_basis で見分ける(日本の労務単価は labor_wage_8h)。決定番号は area_label の頭(「CA20260001 Building ...」)。
const DBRA_BASES = ["prevailing_wage_hourly", "prevailing_fringe_hourly", "prevailing_wage_daily"];

async function usPrevailingWage(ctx, a) {
  if (blank(a.state) && blank(a.decision)) return argErr("state(州)か decision(決定番号、例 CA20260001)のどちらかは要る。/ give state or decision.");
  const lim = clamp(a.limit, 1, 100, 30);
  const off = clamp(a.offset, 0, 100000, 0);
  let st = null, dec = null;
  if (!blank(a.decision)) {
    dec = String(a.decision).normalize("NFKC").trim().toUpperCase();
    if (!/^[A-Z]{2}\d{8}$/.test(dec)) return argErr("decision は 州の略号2文字 + 8桁(例 CA20260001): " + a.decision);
    st = US_ABBR[dec.slice(0, 2)] || (dec.startsWith("CM") ? "69" : null);
    if (!st) return argErr("decision の州が分からない: " + a.decision);
  }
  if (!blank(a.state)) {
    const g = normGeo("state:" + String(a.state).trim(), "US");
    if (g.error) return argErr(g.error, { code: g.code });
    if (st && st !== g.code) return argErr("state と decision の州が違う。/ state and decision disagree");
    st = g.code;
  }
  const p = await part(ctx, "US");
  if (p.fail) return p.fail;
  const t = terms(a.trade);
  let county = null, memberIds = null, total, keys, statesWithData;
  const run = async () => {
    statesWithData = (await p.db.prepare("SELECT DISTINCT geo_code FROM coverage WHERE country = 'US' AND layer = 'labor' AND geo_level = 'state' AND listed = 1 ORDER BY geo_code").all()).results.map((r) => r.geo_code);
    if (!blank(a.county)) {
      const cv = String(a.county).trim();
      let g = null;
      if (/^\d{5}$/.test(cv)) {
        if (cv.slice(0, 2) !== st) throw Object.assign(new Error("county"), { arg: `郡 FIPS ${cv} は州 ${US_STATES[st]} の郡ではない。` });
        g = await resolveUsGeo(p, "county:" + cv);
      } else g = await resolveUsGeo(p, "county:" + cv.replace(/,\s*[^,]+$/, "") + ", " + st);
      if (!g || g.error) throw Object.assign(new Error("county"), { arg: (g && g.error) || "郡が分からない: " + cv, code: g && g.code });
      const base = countyBase(g.name);
      const word = (String(g.name).replace(/,.*$/, "").replace(/\s+(county|parish|borough|census area|municipality)$/i, "").match(/[A-Za-z]{3,}/g) || [g.name]).sort((x, y) => y.length - x.length)[0];
      const cands = (await p.db.prepare("SELECT members_id, text FROM members WHERE text LIKE ?").bind("%" + word + "%").all()).results;
      memberIds = cands.filter((m) => dbraCounties(m.text).some((x) => countyBase(x) === base)).map((m) => m.members_id);
      county = { fips: g.code, name: g.name, match: { method: "決定の郡の欄の名前と、大文字小文字・空白・句読点と郡の接尾辞を除いて一致(このサービスの照合)。/ matched against the decision's county list, ignoring case, spacing, punctuation and county suffixes.", computed: true, decisions_matched: memberIds.length } };
    }
    const w = { sql: ["o.geo_code = ?", "o.layer = 'labor'", "o.geo_level = 'state'", "o.price_basis IN (" + DBRA_BASES.map((x) => "'" + x + "'").join(", ") + ")"], binds: [st] };
    if (dec) { w.sql.push("o.area_label LIKE ?"); w.binds.push(dec + " %"); }
    if (memberIds) w.sql.push(memberIds.length ? "o.members_id IN (" + intList(memberIds) + ")" : "0");
    if (!blank(a.construction_type)) { w.sql.push("o.area_label LIKE ? ESCAPE '\\'"); w.binds.push(likeArg(String(a.construction_type).trim())); }
    if (t.length) { const tc = textCond(p, t); w.sql.push(...tc.sql); w.binds.push(...tc.binds); w.mode = tc.mode; }
    const grp = " FROM obs2 o WHERE " + w.sql.join(" AND ") + " GROUP BY o.source_id, o.source_page, o.item_name, o.spec";
    total = (await p.db.prepare("SELECT COUNT(*) AS n FROM (SELECT 1" + grp + ")").bind(...w.binds).first()).n;
    keys = (await p.db.prepare("SELECT o.source_id AS source_id, o.item_name AS item_name, MAX(CASE WHEN o.price_basis <> 'prevailing_fringe_hourly' THEN o.rid END) AS base_rid, " +
      "MAX(CASE WHEN o.price_basis = 'prevailing_fringe_hourly' THEN o.rid END) AS fringe_rid" + grp + " ORDER BY o.source_id, o.item_name, o.spec, o.source_page LIMIT ? OFFSET ?").bind(...w.binds, lim, off).all()).results;
    return w;
  };
  let w;
  try {
    try { w = await run(); } catch (e) { if (e.arg) throw e; if (p.fts && /fts5|obs2_fts|no such module/i.test(String(e.message))) { p.fts = false; w = await run(); } else throw e; }
  } catch (e) { if (e.arg) return argErr(e.arg, e.code ? { code: e.code } : undefined); return readFail(e, "US"); }
  let rows;
  try { rows = await fetchByRids(p.db, keys.flatMap((k) => [k.base_rid, k.fringe_rid]).filter((x) => x != null)); } catch (e) { return readFail(e, "US"); }
  const byRid = new Map(rows.map((r) => [r.rid, r]));
  const val = (r) => r ? { value: r.price ?? null, unit: r.unit, price_basis: r.price_basis, price_status: r.price_status, ref_value: r.ref_value ?? null, ref_note: r.ref_note || null, obs_id: r.obs_id, computed: r.computed === 1, note: r.note || null } : null;
  const rates = keys.map((k) => {
    const b = byRid.get(k.base_rid), fr = byRid.get(k.fringe_rid), r0 = b || fr;
    const lab = String(r0.area_label || "");
    const decNo = (/^([A-Z]{2}\d{8})/.exec(lab) || [])[1] || null;
    const both = b && fr && b.price != null && fr.price != null && b.price_basis === "prevailing_wage_hourly";
    return {
      decision: decNo, revision: r0.area_code || null, construction_types: decNo ? lab.slice(decNo.length).trim() : lab, published: r0.period,
      rate_identifier: r0.spec, trade: r0.item_name, counties: r0.area_members || null,
      base: val(b), fringe: val(fr),
      total_hourly: both ? { value: round(b.price + fr.price, 2), unit: "USD/hour", computed: true, method: "基本時給 + 付加給付(このサービスの足し算。原本に合計の欄は無い)。/ base + fringe, added by this service." } : null,
      total_missing_reason: both ? undefined : (!b || !fr ? "基本時給か付加給付の行が無い" : b.price_basis !== "prevailing_wage_hourly" ? "基本の欄が日額(prevailing_wage_daily)なので時給と足さない" : "値の無い欄がある(price_status を見ること)"),
      source_id: r0.source_id, source_page: r0.source_page, evidence_url: r0.evidence_url, license: r0.license, attribution: r0.attribution || null,
    };
  });
  const noState = !statesWithData.includes(st);
  return {
    state: { code: st, name: US_STATES[st] }, county, trade: a.trade || null, decision: dec, construction_type: a.construction_type || null,
    count: total, returned: rates.length, offset: off, next_offset: off + rates.length < total ? off + rates.length : null, rates,
    search: t.length ? { US: w && w.mode } : undefined,
    reading: "1 件 = 1 つの決定の中の 1 職種(基本時給と付加給付の2行を組にした)。decision は決定番号、revision は改訂番号、published は現行の改訂の公表日、rate_identifier は組の見出し(組合の協約番号と効力日、SU は調査、UAVG は組合の加重平均)。郡は決定の郡の欄で照合する。/ One record = one trade in one decision (base and fringe rows paired).",
    coverage_note: `取り込んだ州・地域: ${statesWithData.map((c) => (Object.entries(US_ABBR).find(([, v]) => v === c) || [c])[0]).join(" ")}(SAM.gov の現行の決定のうち、ここにある州だけ)。/ States ingested: see list.`,
    honest_reading: noState ? `${US_STATES[st]} の Davis-Bacon の決定はまだ取り込んでいない(0 件は『決定が無い』ではない)。/ Not ingested for this state.` : (total ? null : "この条件に合う職種の行は無い(取り込んだ決定の中で)。/ No rate matches within the ingested decisions."),
    status_legend: STATUS_LEGEND, basis: US_BASIS.prevailing_wage + " " + BASIS_NOTE.US, license_note: LICENSE_NOTE, computed_note: COMPUTED_NOTE,
  };
}

const BPS_MEASURE = { "Bldgs": "buildings", "Units": "units", "Value": "valuation", "Value / Units": "valuation_per_unit" };
const CITY_BASIS = {
  count: "permits", permit_valuation_total_usd: "valuation_total", permit_valuation_median_usd: "valuation_median",
  permit_valuation_p25_usd: "valuation_p25", permit_valuation_p75_usd: "valuation_p75", permit_valuation_per_sqft_median_usd: "valuation_per_sqft_median",
};
const CITY_BASES_SQL = Object.keys(CITY_BASIS).map((x) => "'" + x + "'").join(", ");
const STRUCTURES = ["1-unit", "2-units", "3-4 units", "5+ units"];

async function usPermits(ctx, a) {
  const lim = clamp(a.limit, 1, 100, 20);
  const off = clamp(a.offset, 0, 100000, 0);
  const which = blank(a.source) ? "all" : String(a.source).toLowerCase();
  if (!["all", "bps", "city"].includes(which)) return argErr("source は all / bps / city: " + a.source);
  let structure = null;
  if (!blank(a.structure)) {
    structure = STRUCTURES.find((x) => x.replace(/\s+/g, "").toLowerCase() === String(a.structure).replace(/\s+/g, "").toLowerCase());
    if (!structure) return argErr("structure は " + STRUCTURES.join(" / ") + " のどれか: " + a.structure);
  }
  let period = null;
  const py = blank(a.year) ? a.period : a.year;
  if (!blank(py)) { period = normPeriod(py); if (!period) return argErr("year(period)の形が分からない: " + py + " / use YYYY"); }
  const p = await part(ctx, "US");
  if (p.fail) return p.fail;
  let g;
  try {
    g = blank(a.geo) ? { country: "US", level: "national", code: "US", name: "United States" } : await resolveUsGeo(p, a.geo);
  } catch (e) { return readFail(e, "US"); }
  if (g.error) return argErr(g.error, { code: g.code, candidates: g.candidates });
  if (g.country !== "US") return argErr("米国の地域ではない: " + a.geo);
  if (!["national", "state", "county", "metro", "place"].includes(g.level)) return argErr("geo は 州・郡(FIPS か名前)・都市圏(cbsa:)・市(Austin, TX)・国全体のどれか: " + a.geo);
  const lvCond = {
    national: { sql: "o.geo_code = 'US' AND o.geo_level = 'national'", binds: [] },
    state: { sql: "o.geo_code = ? AND o.geo_level = 'state'", binds: [g.code] },
    county: { sql: "o.geo_code = ? AND o.geo_level = 'county'", binds: [g.code] },
    metro: { sql: "o.geo_code = ? AND o.geo_level = 'metro'", binds: [g.code] },
    place: g.level === "place" ? geoCond(g) : null,
  }[g.level];
  const perCond = period ? { sql: " AND o.period_key >= ? AND o.period_key < ?", binds: [periodStart(period, "US"), periodEnd(period, "US")] } : { sql: "", binds: [] };
  const CAP = 20000;
  let bpsRows = [], cityRows = [], citiesAll = [];
  try {
    if (which !== "city") {
      bpsRows = (await p.db.prepare("SELECT " + SLIM_SEL + " FROM " + SLIM_FROM + " WHERE " + lvCond.sql + " AND o.layer = 'spending' AND o.category LIKE 'Building Permits Survey%'" + perCond.sql +
        (structure ? " AND o.item_name = ?" : "") + " ORDER BY o.period_key DESC, o.rid LIMIT ?").bind(...lvCond.binds, ...perCond.binds, ...(structure ? [structure] : []), CAP).all()).results;
    }
    if (which !== "bps" && (g.level === "national" || g.level === "state" || g.level === "place")) {
      // 市の許可データの行: geo_level city で area_label が空(市全体)、price_basis が件数か申告額の集計(BPS の place は area_label に市の名前がある)
      const cc = g.level === "national" ? { sql: "o.geo_level = 'city'", binds: [] }
        : g.level === "state" ? { sql: "o.geo_code = ? AND o.geo_level = 'city'", binds: [g.code] }
          : { sql: lvCond.sql, binds: lvCond.binds };
      cityRows = (await p.db.prepare("SELECT " + SLIM_SEL + " FROM " + SLIM_FROM + " WHERE " + cc.sql + " AND o.area_label = '' AND o.layer IN ('spending', 'cost_sqft') AND o.price_basis IN (" + CITY_BASES_SQL + ")" + perCond.sql +
        " ORDER BY o.geo_name, o.period_key DESC, o.item_name, o.rid LIMIT ?").bind(...cc.binds, ...perCond.binds, CAP).all()).results;
    }
    citiesAll = (await p.db.prepare("SELECT DISTINCT o.geo_code AS geo_code, o.geo_name AS geo_name FROM obs2 o WHERE o.layer = 'spending' AND o.price_basis = 'permit_valuation_total_usd' AND o.geo_level = 'city'").all()).results;
  } catch (e) { return readFail(e, "US"); }
  const v = (r) => {
    const o = { value: r.price ?? null, unit: r.unit, price_basis: r.price_basis, price_status: r.price_status, computed: r.computed === 1, obs_id: r.obs_id,
      source_id: r.source_id, evidence_url: r.evidence_url, license: r.license, attribution: r.attribution || null };
    if (r.ref_value != null) o.ref = { value: r.ref_value, note: r.ref_note || null };
    if (r.price != null && r.price_basis === "permit_valuation_thousand_usd") o.value_usd = { value: round(r.price * 1000, 2), computed: true, method: "千ドル x 1000(このサービスの換算)。/ thousand USD x 1000, converted by this service." };
    return o;
  };
  // BPS: 地域 x 時点 x 建物の区分 x 期間の種類(年 / 年初来)ごとに、棟数・戸数・工事額・1 戸あたり(原本に無い値)を並べる
  const bmap = new Map();
  for (const r of bpsRows) {
    const [measure, rest] = String(r.spec).split(/,\s*/, 2);
    const kindOfTime = String(r.spec).split(/;\s*/)[1] || null;
    const k = [r.geo_level, r.geo_code, r.area_label, r.area_code, r.period, r.item_name, kindOfTime].join("\x1f");
    if (!bmap.has(k)) bmap.set(k, { geo_level: r.geo_level, geo_code: r.geo_code, geo_name: r.geo_name, area_label: r.area_label || null, area_code: r.area_code || null,
      period: r.period, time_basis: kindOfTime, structure: r.item_name, estimate: rest ? rest.split(";")[0] : null, _k: r.period_key });
    const f = BPS_MEASURE[measure];
    if (f) bmap.get(k)[f] = v(r);
  }
  const srt = (x, y) => (x._k < y._k ? 1 : x._k > y._k ? -1 : 0) || String(x.geo_code).localeCompare(String(y.geo_code)) || String(x.area_label).localeCompare(String(y.area_label)) || STRUCTURES.indexOf(x.structure) - STRUCTURES.indexOf(y.structure);
  const bps = [...bmap.values()].sort(srt);
  // 市: 市 x 時点 x 許可の種類・工事の区分ごとに、件数・合計・分位・1 sqft あたりの中央値
  const cmap = new Map();
  for (const r of cityRows) {
    const k = [r.geo_code, r.geo_name, r.period, r.item_name].join("\x1f");
    if (!cmap.has(k)) cmap.set(k, { city: r.geo_name, state: { code: r.geo_code, name: US_STATES[r.geo_code] || null }, period: r.period, category: r.category, item: r.item_name, spec: r.spec, _k: r.period_key });
    const f = CITY_BASIS[r.price_basis];
    if (f) { const o = v(r); if (f === "valuation_per_sqft_median") { const pm = perM2(r); if (pm) o.per_m2 = pm; } cmap.get(k)[f] = o; }
  }
  const city = [...cmap.values()].sort((x, y) => String(x.city).localeCompare(String(y.city)) || (x._k < y._k ? 1 : x._k > y._k ? -1 : 0) || (/\(all /.test(y.item) - /\(all /.test(x.item)) || String(x.item).localeCompare(String(y.item)));
  const clean = (xs) => xs.slice(off, off + lim).map(({ _k, ...x }) => x);
  const cityNames = [...new Set(citiesAll.map((c) => c.geo_name))].sort();
  const total = bps.length + city.length;
  return {
    geo: g, year: period, structure, source: which, count: total,
    bps: { count: bps.length, returned: Math.min(lim, Math.max(0, bps.length - off)), offset: off, records: clean(bps), truncated: bpsRows.length >= CAP },
    city_permits: { count: city.length, returned: Math.min(lim, Math.max(0, city.length - off)), offset: off, records: clean(city), cities_ingested: cityNames, truncated: cityRows.length >= CAP },
    reading: "bps = Census Building Permits Survey(民間の新築住宅の許可。buildings 棟数、units 戸数、valuation 工事額、valuation_per_unit 1 戸あたり = 工事額 / 戸数 で観測層の組み立てが計算した値 computed:true)。州と都市圏の工事額は千ドル(value_usd にドルへの換算、computed:true)、郡と市はドル。値は Estimates with Imputation、ref は Reported Only。city_permits = 市の許可データの申告工事額の分布(件数・合計・中央値・25/75 分位・1 sqft あたりの中央値。どれも観測層の組み立てが許可ごとの申告額から計算した値 computed:true)。/ bps: Census BPS counts and valuations (per-unit values computed); city_permits: distributions of declared valuations in city permit data (computed).",
    honest_reading: total ? null : (g.level === "place" && which !== "bps" && !cityNames.some((c) => countyBase(c) === g.place_key)
      ? `${g.name} の市の許可データは取り込んでいない(取り込んだ市: ${cityNames.join(", ")})。Census BPS の place の集計は bps にある時点だけ。/ City permit data not ingested for this place.`
      : "この条件の許可の行は無い(取り込んでいない時点・地域かもしれない)。何があるかは jccdb_coverage(layer spending)。/ No permit rows match; see jccdb_coverage."),
    status_legend: STATUS_LEGEND, basis: US_BASIS.permits + " " + BASIS_NOTE.US, license_note: LICENSE_NOTE, computed_note: COMPUTED_NOTE,
  };
}

const ACF_BASES = ["area_cost_factor", "sustainment_area_cost_factor"];

async function usAreaFactor(ctx, a) {
  if (blank(a.geo) && blank(a.installation)) return argErr("geo(州・郡・ZIP・市・国外の国)か installation(施設の名前)のどちらかは要る。/ give geo or installation.");
  const lim = clamp(a.limit, 1, 100, 30);
  const off = clamp(a.offset, 0, 100000, 0);
  const history = blank(a.include_history) ? true : bool(a.include_history);
  const p = await part(ctx, "US");
  if (p.fail) return p.fail;
  let g = null;
  try {
    if (!blank(a.geo)) {
      g = await resolveUsGeo(p, a.geo, { allowZip: true, allowCountry: true, placeAsText: true });
      if (g && !g.error && g.country === "JP" && g.level === "national") g = await resolveOconus(p, "JP", a.geo);
    }
  } catch (e) { return readFail(e, "US"); }
  if (g && g.error) return argErr(g.error, { code: g.code, candidates: g.candidates });
  if (g && !["state", "county", "zip", "place_text", "country"].includes(g.level)) return argErr("geo は 州・郡・ZIP(zip:28533)・市(Cherry Point, NC)・国外の国(country:JP)のどれか: " + a.geo);
  const t = terms(a.installation);
  let st = g ? (g.level === "state" ? g.code : g.level === "county" ? g.code.slice(0, 2) : g.level === "place_text" ? g.state : null) : null;
  let total, keys, stats, sa = [], w0;
  const run = async () => {
    const w = { sql: ["o.layer = 'index'", "o.price_basis IN ('area_cost_factor', 'sustainment_area_cost_factor')"], binds: [] };
    if (g) {
      if (g.level === "state") { w.sql.push("o.geo_code = ? AND o.geo_level = 'state'"); w.binds.push(g.code); }
      else if (g.level === "country") { w.sql.push("o.geo_code = ? AND o.geo_level = 'country'"); w.binds.push(g.code); }
      else {
        // 郡・市・ZIP は施設の所在(area_members の County / City / Zip)で照合する
        const lab = g.level === "county" ? "County" : g.level === "zip" ? "Zip" : "City";
        const name = g.level === "county" ? String(g.name).replace(/,.*$/, "").replace(/\s+(county|parish|borough|census area|municipality)$/i, "").trim() : g.level === "zip" ? g.code : g.name;
        const cands = (await p.db.prepare("SELECT members_id, text FROM members WHERE text LIKE ? ESCAPE '\\'").bind(likeArg(lab + ": " + name)).all()).results;
        const want = g.level === "county" ? countyBase(name) : String(name).toLowerCase();
        const ids = cands.filter((m) => {
          const mm = new RegExp("(?:^|;\\s*)" + lab + ":\\s*([^;]+)").exec(m.text);
          if (!mm) return false;
          const got = g.level === "county" ? countyBase(mm[1]) : mm[1].trim().toLowerCase();
          const inState = !st || new RegExp("State:\\s*" + US_STATES[st] + "\\s*(;|$)", "i").test(m.text);
          return got === want && inState;
        }).map((m) => m.members_id);
        w.sql.push(ids.length ? "o.members_id IN (" + intList(ids) + ")" : "0");
        if (st) { w.sql.push("o.geo_code = ?"); w.binds.push(st); }
      }
    }
    if (t.length) { const tc = textCond(p, t); w.sql.push(...tc.sql); w.binds.push(...tc.binds); w.mode = tc.mode; }
    const grp = " FROM obs2 o WHERE " + w.sql.join(" AND ") + " GROUP BY o.source_id, o.geo_level, o.geo_code, o.area_label, o.area_code, o.spec";
    total = (await p.db.prepare("SELECT COUNT(*) AS n FROM (SELECT 1" + grp + ")").bind(...w.binds).first()).n;
    keys = (await p.db.prepare("SELECT MAX(CASE WHEN o.price_basis = 'area_cost_factor' THEN o.rid END) AS acf_rid, MAX(CASE WHEN o.price_basis = 'sustainment_area_cost_factor' THEN o.rid END) AS sacf_rid" + grp +
      " ORDER BY o.geo_code, o.area_label, o.area_code LIMIT ? OFFSET ?").bind(...w.binds, lim, off).all()).results;
    const vals = (await p.db.prepare("SELECT o.price AS v, o.rid AS rid FROM obs2 o WHERE " + w.sql.join(" AND ") + " AND o.price_basis = 'area_cost_factor' AND o.price IS NOT NULL ORDER BY o.price, o.rid").bind(...w.binds).all()).results;
    stats = vals;
    // 州が分かれば、USACE の州の調整係数(CWCCIS Table 3 の現行値と Table 4 の年ごとの値)
    if (!st && g && g.level === "zip" && keys.length) {
      const r0 = (await fetchByRids(p.db, [keys[0].acf_rid || keys[0].sacf_rid]))[0];
      const sm = r0 && /State:\s*([^;]+)/.exec(r0.area_members || "");
      if (sm) st = Object.entries(US_STATES).find(([, n]) => n.toLowerCase() === sm[1].trim().toLowerCase())?.[0] || null;
    }
    if (st) sa = (await p.db.prepare("SELECT " + SLIM_SEL + " FROM " + SLIM_FROM + " WHERE o.geo_code = ? AND o.layer = 'index' AND o.geo_level = 'state' AND o.price_basis = 'state_adjustment_factor' ORDER BY o.period_key DESC, o.rid").bind(st).all()).results;
    return w;
  };
  try {
    try { w0 = await run(); } catch (e) { if (p.fts && /fts5|obs2_fts|no such module/i.test(String(e.message))) { p.fts = false; w0 = await run(); } else throw e; }
  } catch (e) { return readFail(e, "US"); }
  let rows;
  try { rows = await fetchByRids(p.db, keys.flatMap((k) => [k.acf_rid, k.sacf_rid]).filter((x) => x != null)); } catch (e) { return readFail(e, "US"); }
  const byRid = new Map(rows.map((r) => [r.rid, r]));
  const val = (r) => r ? { value: r.price ?? null, unit: r.unit, price_basis: r.price_basis, price_status: r.price_status, ref_value: r.ref_value ?? null, ref_note: r.ref_note || null, obs_id: r.obs_id, computed: r.computed === 1, note: r.note || null } : null;
  const sites = keys.map((k) => {
    const x = byRid.get(k.acf_rid), y = byRid.get(k.sacf_rid), r0 = x || y;
    const inst = /Installation Name:\s*([^;]+)/.exec(r0.spec || "");
    return {
      installation: inst ? inst[1].trim() : null, site_name: r0.area_label || null, site_id: r0.area_code || null, site_detail: r0.spec,
      location: r0.area_members || null, geo_level: r0.geo_level, geo_code: r0.geo_code, geo_name: r0.geo_name, period: r0.period,
      area_cost_factor: val(x), sustainment_area_cost_factor: val(y),
      source_id: r0.source_id, source_page: (x || y).source_page, evidence_url: r0.evidence_url, license: r0.license, attribution: r0.attribution || null,
    };
  });
  const vs = stats.map((r) => r.v);
  const acfStats = vs.length ? {
    n_sites: vs.length, min: vs[0], max: vs[vs.length - 1],
    median: { value: median(vs), computed: true, method: "条件に合う施設の ACF を並べた真ん中(このサービスの計算)。/ median over matched sites, computed by this service." },
  } : null;
  const saRow = (r) => ({ value: r.price ?? null, period: r.period, table: r.category, spec: r.spec, price_status: r.price_status, obs_id: r.obs_id, computed: r.computed === 1,
    source_id: r.source_id, source_page: r.source_page, evidence_url: r.evidence_url, license: r.license, attribution: r.attribution || null });
  const cur = sa.find((r) => /TABLE 3/i.test(r.category || "")) || null;
  const hist = sa.filter((r) => /TABLE 4/i.test(r.category || ""));
  const count = total + sa.length;
  return {
    geo: g, installation: a.installation || null, count,
    sites_total: total, returned: sites.length, offset: off, next_offset: off + sites.length < total ? off + sites.length : null, sites,
    acf_stats: acfStats,
    state_adjustment_factor: st ? { state: { code: st, name: US_STATES[st] }, current: cur ? saRow(cur) : null, history: history ? hist.map(saRow) : undefined, history_total: hist.length } : null,
    search: t.length ? { US: w0 && w0.mode } : undefined,
    reading: "sites = DoD UFS 3-701-01 の Table 4-1(施設ごとの Area Cost Factor と Sustainment ACF。96 基準都市の平均 = 1.00、FY の版)。郡・市・ZIP は施設の所在の欄(County / City / Zip)で照合する。state_adjustment_factor = USACE CWCCIS(EM 1110-2-1304)の州の調整係数(current = Table 3 の現行値、history = Table 4 の年ごとの値、For Information Only)。acf_stats の median はこのサービスの計算(computed:true)。/ DoD ACF by installation (96 base-city average = 1.00) and USACE CWCCIS state adjustment factors.",
    honest_reading: count ? null : "この場所の係数の行は無い(DoD の表に施設が無い地域か、名前の照合に当たらなかった)。州で引き直すと州の中の施設と USACE の州係数が出る。/ No factor rows here; try the state.",
    status_legend: STATUS_LEGEND, basis: US_BASIS.area_factor + " " + BASIS_NOTE.US, license_note: LICENSE_NOTE, computed_note: COMPUTED_NOTE,
  };
}

// ---------------------------------------------------------------- 何がどこまであるか

const SOURCES_PER_LAYER = 60;
const familyOf = (sid) => String(sid).split("-").slice(0, 2).join("-");

async function coverage(ctx, a) {
  const country = normCountry(a.country);
  if (country === undefined) return argErr("country は JP か US: " + a.country);
  let g = null;
  if (a.geo) { g = normGeo(a.geo, country); if (g && g.error) return argErr(g.error, { code: g.code, candidates: g.candidates }); }
  const targets = targetsOf(country, g);
  if (a.layer && !(await layerOk(ctx, a.layer, targets))) return argErr("layer が分からない: " + a.layer + " / layer must be one of " + LAYERS.join(", "));
  const R = await across(ctx, targets, async (p) => {
    const where = ["country = ?"], binds = [p.country];
    if (a.layer) { where.push("layer = ?"); binds.push(String(a.layer)); }
    if (a.source_id) { where.push("source_id = ?"); binds.push(String(a.source_id)); }
    if (g && g.country === p.country) { const gc = geoCond(g); where.push(gc.sql.replace(/o\./g, "")); binds.push(...gc.binds); }
    const cov = (await p.db.prepare("SELECT * FROM coverage WHERE " + where.join(" AND ") + " ORDER BY country, layer, source_id").bind(...binds).all()).results;
    return { cov, led: await sourcesInfo(p.db, cov.map((r) => r.source_id)), built: p.built };
  });
  if (!R.ok.length) return allFailed(R.fails, targets);
  const cov = R.ok.flatMap((c) => R.res[c].cov);
  const led = Object.assign({}, ...R.ok.map((c) => R.res[c].led));
  const pk = (p, c) => { const n = normPeriod(p); return n ? periodStart(n, c) : p; };
  const tree = {};
  for (const r of cov) {
    const listed = r.listed === undefined || r.listed === null || r.listed === 1;
    const C = (tree[r.country] = tree[r.country] || {});
    const L = (C[r.layer] = C[r.layer] || { rows: 0, priced: 0, computed: 0, by_status: {}, not_listed_cells: 0, sources: {} });
    if (listed) { L.rows += r.n; L.priced += r.n_priced; L.computed += r.n_computed; L.by_status[r.price_status] = (L.by_status[r.price_status] || 0) + r.n; }
    else L.not_listed_cells += r.n;
    const S = (L.sources[r.source_id] = L.sources[r.source_id] || { rows: 0, priced: 0, computed: 0, by_status: {}, geo_levels: new Set(), geos: new Set(), period_min: null, period_max: null, listed });
    S.rows += r.n; S.priced += r.n_priced; S.computed += r.n_computed; S.by_status[r.price_status] = (S.by_status[r.price_status] || 0) + r.n;
    S.geo_levels.add(r.geo_level); S.geos.add(r.geo_level + ":" + r.geo_code);
    if (!S.period_min || pk(r.period_min, r.country) < pk(S.period_min, r.country)) S.period_min = r.period_min;
    if (!S.period_max || pk(r.period_max, r.country) > pk(S.period_max, r.country)) S.period_max = r.period_max;
  }
  const matrix = [];
  for (const [c, layers] of Object.entries(tree)) for (const [l, L] of Object.entries(layers)) {
    const all = Object.entries(L.sources).map(([sid, S]) => {
      const d = led[sid] || {};
      return { source_id: sid, title: d.title || null, publisher: d.publisher || null, license: d.license || null, values_copied: d.values_copied == null ? null : d.values_copied === 1,
        retrieved_at: d.retrieved_at || null, effective_from: d.effective_from || null, published: d.published || null,
        rows: S.rows, priced: S.priced, computed: S.computed, by_status: S.by_status, period_min: S.period_min, period_max: S.period_max,
        geo_levels: [...S.geo_levels].sort(), geo_count: S.geos.size,
        rows_in_db: S.listed ? S.rows : 0, row_listing: S.listed ? "listed" : "not_in_public_build", why_not_listed: S.listed ? undefined : (d.row_listing_reason || null) };
    });
    const fam = {};
    for (const s of all) { const k = familyOf(s.source_id); const x = (fam[k] = fam[k] || { family: k, sources: 0, rows: 0, priced: 0, period_min: null, period_max: null }); x.sources++; x.rows += s.rows; x.priced += s.priced;
      if (!x.period_min || pk(s.period_min, c) < pk(x.period_min, c)) x.period_min = s.period_min; if (!x.period_max || pk(s.period_max, c) > pk(x.period_max, c)) x.period_max = s.period_max; }
    const cap = a.source_id ? all.length : SOURCES_PER_LAYER;
    const shown = [...all].sort((x, y) => y.rows - x.rows || (x.source_id < y.source_id ? -1 : 1)).slice(0, cap);
    matrix.push({ country: c, layer: l, rows: L.rows, priced: L.priced, computed: L.computed, by_status: L.by_status, not_listed_cells: L.not_listed_cells,
      sources_total: all.length, sources_truncated: all.length > shown.length, source_families: Object.values(fam).sort((x, y) => y.rows - x.rows), sources: shown });
  }
  const wantC = targets;
  const wantL = a.layer ? [String(a.layer)] : LAYERS;
  const absent = [];
  for (const c of wantC) {
    if (!R.ok.includes(c)) continue; // 読めなかった国は absent と言わない(parts に理由)
    for (const l of wantL) if (!(tree[c] && tree[c][l])) {
      absent.push({ country: c, layer: l, rows: 0, statement: `${c} x ${l}${g ? " x " + g.name : ""}${a.source_id ? " x " + a.source_id : ""} の観測はこの DB に無い(取り込んでいない)。/ not ingested.` });
    }
  }
  const total = matrix.reduce((s, m) => s + m.rows, 0);
  const notListedCells = matrix.reduce((s, m) => s + (m.not_listed_cells || 0), 0);
  const out = {
    filters: { country: country || null, layer: a.layer || null, source_id: a.source_id || null, geo: g },
    built_v2: Object.fromEntries(R.ok.map((c) => [c, R.res[c].built])), total_rows: total, count: total, priced_rows: matrix.reduce((s, m) => s + m.priced, 0),
    matrix, absent, not_listed_cells: notListedCells,
    reading: "組み立て時(built_v2 の国ごとの built_at)の集計。rows は行の数、priced は値のある行の数、computed はそのうち原本に無く組み立てで計算した値の行の数。sources は行の多い順に layer ごと 60 まで(source_families に出典の系統ごとの合計、source_id で絞ると全部)。absent は 0 行の組み合わせで、『この DB に無い』であって『世界に無い』ではない。/ Counts as of build time; sources are capped at 60 per layer (see source_families); absent means not ingested here.",
    status_legend: STATUS_LEGEND,
  };
  return withParts(out, R.ok, R.fails);
}

// ---------------------------------------------------------------- 道具の定義

const LAYER_DESC = "material(資材) / labor(労務単価・Davis-Bacon) / work(工事の単価) / equipment(機械損料) / index(指数・地域係数) / wage(統計の賃金) / bid_item(入札単価) / cost_sqft(面積あたり工事費) / spending(工事支出・建築許可) / house_price(1戸あたり住宅価格) / cost_limit(1戸あたり上限額)";
export const TOOLS = [
  {
    name: "jccdb_search_items",
    annotations: { title: "JCCDB 品目検索", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "日本の建設費オープンデータ JCCDB(95,403品目)の品目を名前で探す。生コン・異形棒鋼・ヒューム管など資材・製品・労務の品目が公的資料に実在するかと、その証拠URLを返す。観測(日本と米国)の件数も layer ごとに返す。地域や価格は jccdb_observations。/ Search the 95,403 line items of JCCDB (Japan) by name; returns whether the item exists in a public document and its evidence URL, with observation counts for Japan and the U.S.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "品目名(日本語が最もよく当たる。例: 生コンクリート 21-8-25)" }, category: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 50 } }, required: ["query"], additionalProperties: false },
  },
  {
    name: "jccdb_observations",
    annotations: { title: "JCCDB 観測(地域・時点・価格状態)", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "品目が『どの地域・地区で・いつ・いくらで(または非公開の理由)』公的資料に載っているかを返す(日本と米国)。値は再配布を許す出典のときだけ入り、それ以外は price_status で理由を言う。各行に license・attribution・evidence_url。country も地域も無いときは日本と米国の両方を引いて束ねる。例: query='生コンクリート', pref='奈良県'。/ Region, date and price status of an item in public documents (Japan and U.S.). Values only where the licence allows redistribution; every row carries licence, attribution and evidence URL. Without country or region both databases are searched and merged.",
    inputSchema: { type: "object", properties: {
      query: { type: "string" },
      pref: { type: "string", description: "都道府県(奈良県/奈良/nara)" },
      geo: { type: "string", description: "地域: 都道府県名・JIS コード(29, JP-29)、州名・略号・FIPS(California, CA, US-06)、郡 FIPS 5桁(county:06037)、都市圏(cbsa:31080)、市(Austin, TX)、JP / US" },
      country: { type: "string", enum: ["JP", "US"] },
      layer: { type: "string", enum: LAYERS, description: LAYER_DESC },
      status: { type: "string", enum: Object.keys(STATUS_LEGEND) },
      period: { type: "string", description: "時点(2026, 2026-09, 2025Q4, FY2025, 2026H1)。その時点に始まる行" },
      source_id: { type: "string", description: "出典 ID(jccdb_sources / jccdb_coverage で分かる)" },
      limit: { type: "integer", minimum: 1, maximum: 100 },
      offset: { type: "integer", minimum: 0 },
    }, additionalProperties: false },
  },
  {
    name: "jccdb_labor_rate",
    annotations: { title: "公共工事設計労務単価", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "国交省の公共工事設計労務単価(47都道府県 x 50職種)を引く。既定は地域ごとの最新の時点、history:true で年ごとの系列。country='US' で米国の Davis-Bacon の行(基本時給と付加給付が別の行。組にするなら jccdb_us_prevailing_wage)。例: pref='奈良県', job='大工'。/ MLIT public-works design labor rates by prefecture and trade; latest by default, yearly series with history:true. country='US' returns Davis-Bacon rows.",
    inputSchema: { type: "object", properties: { pref: { type: "string" }, geo: { type: "string" }, country: { type: "string", enum: ["JP", "US"], description: "既定 JP" }, job: { type: "string" }, history: { type: "boolean", description: "true で年ごとの系列" }, limit: { type: "integer", minimum: 1, maximum: 200 } }, additionalProperties: false },
  },
  {
    name: "jccdb_sources",
    annotations: { title: "観測層の出典台帳", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "観測層の出典(URL・原本の sha256・利用条件の文言・読み方)を返す。約 2,500 出典あるので limit(既定 20、最大 500)ずつ。country・source_id・query(出典 ID・題名・発行者の部分一致)で絞れる。/ Source ledger for the observation layer: URL, sha256 of the original, licence wording and how it was read; paged (default 20), filter by country, source_id or query.",
    inputSchema: { type: "object", properties: { country: { type: "string", enum: ["JP", "US"] }, source_id: { type: "string" }, query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 500 }, offset: { type: "integer", minimum: 0 } }, additionalProperties: false },
  },
  {
    name: "jccdb_compare_regions",
    annotations: { title: "地域ごとの比較(最新時点)", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "品目と規格で、地域ごとの最新時点の値を並べ、最小・中央・最大と状態別の件数を返す。規格・単位・値の種類が同じものだけを比べる。例: query='生コンクリート', spec='21-8-25(20)'。/ Lists the latest value per region for an item and spec, with min, median (computed) and max and counts by price status; only identical spec/unit/basis are compared.",
    inputSchema: { type: "object", properties: {
      query: { type: "string", description: "品目名" }, spec: { type: "string", description: "規格(例: 21-8-25(20))" },
      country: { type: "string", enum: ["JP", "US"] }, layer: { type: "string", enum: LAYERS }, geo_level: { type: "string", enum: GEO_LEVELS },
      status: { type: "string", enum: Object.keys(STATUS_LEGEND) }, limit: { type: "integer", minimum: 1, maximum: 20, description: "返す組の数" },
      normalize: { type: "string", enum: ["exact", "namacon"], description: "exact(既定: 規格の文字が同じものだけ)/ namacon(生コンの規格を局をまたいで束ねる)" },
    }, required: ["query"], additionalProperties: false },
  },
  {
    name: "jccdb_work_unit_price",
    annotations: { title: "工事の単価(施工パッケージ等)", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "layer=work(工事の単価: 材料・労務・機械の複合。施工パッケージ型積算の標準単価など)を引く。構成比の行を同じパッケージの行に添える(composition)。公共土木の積算単価であり、リフォームの見積単価ではない。/ Public-works unit prices for work items (materials, labor and equipment combined), with composition-ratio rows attached to their package.",
    inputSchema: { type: "object", properties: {
      query: { type: "string", description: "工種・品目(例: 掘削)" }, pref: { type: "string" }, geo: { type: "string" }, country: { type: "string", enum: ["JP", "US"] },
      period: { type: "string" }, source_id: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 }, offset: { type: "integer", minimum: 0 },
    }, additionalProperties: false },
  },
  {
    name: "jccdb_index_series",
    annotations: { title: "指数の系列と前年同期比", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "index 層(NHCCI、PPI、CWCCIS、建設工事費デフレーター等)の系列を期間で返し、前年同期比を計算して添える(computed:true、原本には無い値)。query も source_id も無いときは系列の一覧。/ Index series (NHCCI, PPI, CWCCIS, deflators) over a period, with year-over-year change computed by this service (computed:true). Without query or source_id, lists the series.",
    inputSchema: { type: "object", properties: {
      query: { type: "string", description: "系列名(例: NHCCI)" }, country: { type: "string", enum: ["JP", "US"] }, geo: { type: "string" }, source_id: { type: "string" },
      from: { type: "string", description: "始め(2020, 2020Q1, 2020-01, FY2020)" }, to: { type: "string", description: "終わり(含む)" },
      limit: { type: "integer", minimum: 1, maximum: 20, description: "系列の数" }, max_points: { type: "integer", minimum: 1, maximum: 1000 },
    }, additionalProperties: false },
  },
  {
    name: "jccdb_us_prices",
    annotations: { title: "米国の建設費(全 layer)", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "米国の建設費データベースを layer・地域・時点・品目で引く: labor(Davis-Bacon)/ wage(BLS OEWS・QCEW)/ work(DoD・FTA)/ equipment(FEMA・USACE)/ index(PPI・NHCCI・CWCCIS・DoD ACF)/ spending(Census 工事支出・建築許可、市の許可)/ cost_sqft / cost_limit(HUD)/ bid_item(州 DOT)/ house_price / material。geo は州・郡 FIPS(county:06037)・都市圏(cbsa:31080)・市(Austin, TX)。州を指定すると全国一律の行と USACE の地域の行も添える。1m2 あたりへの換算は computed:true。/ The U.S. construction cost database by layer, region (state, county FIPS, CBSA, place), period and item; national and USACE regional rows are added for a state; per-m2 conversions are computed:true.",
    inputSchema: { type: "object", properties: {
      query: { type: "string", description: "品目・職種(英語。例: excavation, carpenters)" }, state: { type: "string", description: "州名・略号・FIPS(California, CA, 06, US-CA)" },
      geo: { type: "string", description: "州・郡 FIPS(county:06037 か 06037)・都市圏 CBSA(cbsa:31080)・市(Austin, TX)・郡の名前(Los Angeles County, CA)" },
      layer: { type: "string", enum: US_PRICE_LAYERS, description: LAYER_DESC }, period: { type: "string", description: "時点(2024, 2025-05, 2025Q4, FY2026)" }, status: { type: "string", enum: Object.keys(STATUS_LEGEND) },
      source_id: { type: "string" }, include_national: { type: "boolean" }, limit: { type: "integer", minimum: 1, maximum: 100 }, offset: { type: "integer", minimum: 0 },
    }, additionalProperties: false },
  },
  {
    name: "jccdb_coverage",
    annotations: { title: "何がどこまであるか", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "観測層に何がどこまであるかを返す: 国 x layer x 出典の件数、値のある件数、状態別、出典の時点、出典の系統ごとの合計。0 行の組み合わせは absent に『無い』と明記する。/ What the observation layer holds: rows per country x layer x source (and source family), priced rows, status counts and source periods; empty combinations are listed as absent.",
    inputSchema: { type: "object", properties: { country: { type: "string", enum: ["JP", "US"] }, layer: { type: "string", enum: LAYERS }, source_id: { type: "string" }, geo: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "jccdb_us_prevailing_wage",
    annotations: { title: "米国 Davis-Bacon の法定賃金", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "Davis-Bacon 法の一般賃金決定(連邦の資金が入る建設工事の最低の基本時給と付加給付)を、州・郡・職種で引く。1 件ごとに基本時給と付加給付を並べ、決定番号・改訂・公表日・組の見出しと郡の一覧を添える。基本 + 付加給付の合計は computed:true。民間の住宅工事の相場ではない。例: state='CA', county='Los Angeles', trade='carpenter'。/ Davis-Bacon general wage determinations by state, county and trade: base wage and fringe side by side with decision number, revision and publication date; the total is computed:true. Not market rates for private work.",
    inputSchema: { type: "object", properties: {
      state: { type: "string", description: "州名・略号・FIPS" }, county: { type: "string", description: "郡 FIPS 5桁か郡の名前(Los Angeles)" },
      trade: { type: "string", description: "職種(英語。例: carpenter, electrician, laborer)" }, decision: { type: "string", description: "決定番号(例 CA20260001)" },
      construction_type: { type: "string", description: "工事の種類(Building / Heavy / Highway / Residential)" },
      limit: { type: "integer", minimum: 1, maximum: 100 }, offset: { type: "integer", minimum: 0 },
    }, additionalProperties: false },
  },
  {
    name: "jccdb_us_permits",
    annotations: { title: "米国の建築許可(件数・工事額・1戸あたり・市の分位)", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "米国の建築許可を地域と年で引く: Census Building Permits Survey(州・郡・都市圏・市の棟数・戸数・工事額・1戸あたり)と、市の許可データの申告工事額の分布(件数・合計・中央値・25/75 分位・1 sqft あたり)。工事額は申請者の申告で、契約額でも見積の単価でもない。例: geo='Austin, TX', year='2024'。/ U.S. building permits by region and year: Census BPS counts, valuations and per-unit values, plus city permit valuation distributions (median, quartiles, per sq ft). Declared by applicants; not contract prices.",
    inputSchema: { type: "object", properties: {
      geo: { type: "string", description: "州・郡(FIPS か 'Multnomah County, OR')・都市圏(cbsa:38900)・市(Austin, TX)。無ければ全国" },
      year: { type: "string", description: "年(2024)。2026 は 1〜8 月の年初来" }, structure: { type: "string", enum: STRUCTURES, description: "建物の区分(BPS)" },
      source: { type: "string", enum: ["all", "bps", "city"] }, limit: { type: "integer", minimum: 1, maximum: 100 }, offset: { type: "integer", minimum: 0 },
    }, additionalProperties: false },
  },
  {
    name: "jccdb_us_area_factor",
    annotations: { title: "米国の場所の係数(DoD ACF・USACE)", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "場所ごとの建設費の係数を引く: DoD の Area Cost Factor と Sustainment ACF(軍の施設ごと、96 基準都市の平均 = 1.00)と、USACE CWCCIS の州の調整係数(現行値と年ごと)。geo は州・郡・ZIP(zip:28533)・市(Cherry Point, NC)・国外の国(country:JP)、installation は施設の名前。中央値は computed:true。見積の良し悪しを判定する係数ではない。/ Location cost factors: DoD Area Cost Factors by installation (96 base-city average = 1.00) and USACE CWCCIS state adjustment factors; geo accepts state, county, ZIP, city or an overseas country.",
    inputSchema: { type: "object", properties: {
      geo: { type: "string", description: "州・郡(FIPS か名前)・ZIP(zip:28533)・市(Cherry Point, NC)・国外(country:JP)" }, installation: { type: "string", description: "施設の名前(例: Fort Bragg, Cherry Point)" },
      include_history: { type: "boolean", description: "USACE の州係数の年ごとの値も返す(既定 true)" }, limit: { type: "integer", minimum: 1, maximum: 100 }, offset: { type: "integer", minimum: 0 },
    }, additionalProperties: false },
  },
];

const HANDLERS = {
  jccdb_search_items: searchItems,
  jccdb_observations: observations,
  jccdb_labor_rate: laborRate,
  jccdb_sources: sources,
  jccdb_compare_regions: compareRegions,
  jccdb_work_unit_price: workUnitPrice,
  jccdb_index_series: indexSeries,
  jccdb_us_prices: usPrices,
  jccdb_coverage: coverage,
  jccdb_us_prevailing_wage: usPrevailingWage,
  jccdb_us_permits: usPermits,
  jccdb_us_area_factor: usAreaFactor,
};

export async function callTool(env, name, args) {
  const fn = own(HANDLERS, name) ? HANDLERS[name] : null;
  if (!fn) return { error: "unknown tool: " + name, code: "unknown_tool" };
  if (!env || (!env.DB && !env.DB_US)) return readFail(new Error("D1 bindings DB and DB_US are not configured"));
  const ctx = { env, parts: {} };
  let out;
  try { out = await fn(ctx, args || {}); } catch (e) { return readFail(e); }
  if (!out.error) {
    out.source_read = true;
    if (typeof out.count === "number") out.lookup = out.count > 0 ? "ok" : out.partial ? "unknown" : "absent";
  }
  return out;
}

// ---------------------------------------------------------------- HTTP

function json(body, status, h) {
  return new Response(JSON.stringify(body, null, 1), { status: status || 200, headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", ...(h || {}) } });
}
function restStatus(out) { return out && out.fetch_failed ? 503 : 200; }

async function handleRpc(env, msg) {
  const { id, method, params } = msg || {};
  if (method === "initialize") return { jsonrpc: "2.0", id, result: { protocolVersion: PROTOCOL_VERSION, serverInfo: SERVER, capabilities: { tools: {} } } };
  if (method === "notifications/initialized") return null;
  if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
  if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
  if (method === "tools/call") {
    const out = await callTool(env, params && params.name, (params && params.arguments) || {});
    return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(out) }], structuredContent: out, isError: !!out.error } };
  }
  return { jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } };
}

// 行数は MAX(rid)(組み立ては rid を 1 から隙間なく振る)。deep=1 のときだけ COUNT(*)(米国は 285 万行を読む)。
async function health(env, deep) {
  const out = { ok: false, ...SERVER };
  const db = env && env.DB, dbu = env && env.DB_US;
  if (db) {
    try {
      const m1 = await db.prepare("SELECT v FROM meta WHERE k='built'").first();
      Object.assign(out, m1 ? JSON.parse(m1.v) : {});
    } catch (e) { out.v01_error = String(e.message || e).slice(0, 200); }
  } else out.v01_error = notBound("JP").error;
  const one = async (c, d) => {
    if (!d) return { obs2: null, complete: false, error: notBound(c).error, code: notBound(c).code };
    try {
      const m = await d.prepare("SELECT v FROM meta WHERE k='built_v3'").first();
      const n = deep ? (await d.prepare("SELECT COUNT(*) AS n FROM obs2").first()).n : ((await d.prepare("SELECT MAX(rid) AS n FROM obs2").first()).n || 0);
      const built = m ? JSON.parse(m.v) : null;
      let fts = null;
      if (built && built.fts) { try { const f = await d.prepare("SELECT v FROM meta WHERE k='built_v3_fts'").first(); fts = !!(f && JSON.parse(f.v).obs2_fingerprint_sha256 === built.obs2_fingerprint_sha256); } catch (_e) { fts = false; } }
      return { obs2: n, counted: deep ? "count" : "max_rid", complete: !!(built && built.obs2 === n), built, fts };
    } catch (e) { const f = readFail(e, c); return { obs2: null, complete: false, error: f.error, code: f.code }; }
  };
  const jp = await one("JP", db), us = await one("US", dbu);
  out.obs2_by_country = { JP: jp.obs2, US: us.obs2 };
  out.obs2 = jp.obs2 == null && us.obs2 == null ? null : (jp.obs2 || 0) + (us.obs2 || 0);
  out.obs2_complete = jp.complete && us.complete;
  out.parts = { JP: jp, US: us };
  out.built_v2 = { JP: jp.built || null, US: us.built || null };
  if (!jp.complete || !us.complete) out.obs2_error = [jp, us].filter((x) => x.error).map((x) => x.error).join(" / ") || null;
  out.ok = out.items > 0 && out.obs2_complete === true;
  return out;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type, mcp-protocol-version" } });
    const p = url.pathname;
    try {
      if (request.method === "GET") {
        const a = Object.fromEntries(url.searchParams);
        const rest = async (name, args) => { const out = await callTool(env, name, args); return json(out, restStatus(out)); };
        if (p === "/health") return json(await health(env, bool(a.deep)));
        if (p === "/search") return rest("jccdb_search_items", { query: a.q, category: a.category, limit: a.limit });
        if (p === "/obs") return rest("jccdb_observations", { query: a.q, pref: a.pref, geo: a.geo, country: a.country, layer: a.layer, status: a.status, period: a.period, source_id: a.source_id, limit: a.limit, offset: a.offset });
        if (p === "/labor") return rest("jccdb_labor_rate", { pref: a.pref, geo: a.geo, country: a.country, job: a.job, history: a.history, limit: a.limit });
        if (p === "/sources") return rest("jccdb_sources", { country: a.country, source_id: a.source_id, query: a.q, limit: a.limit, offset: a.offset });
        if (p === "/compare") return rest("jccdb_compare_regions", { query: a.q, spec: a.spec, country: a.country, layer: a.layer, geo_level: a.geo_level, status: a.status, limit: a.limit, normalize: a.normalize });
        if (p === "/work") return rest("jccdb_work_unit_price", { query: a.q, pref: a.pref, geo: a.geo, country: a.country, period: a.period, source_id: a.source_id, limit: a.limit, offset: a.offset });
        if (p === "/index") return rest("jccdb_index_series", { query: a.q, country: a.country, geo: a.geo, source_id: a.source_id, from: a.from, to: a.to, limit: a.limit, max_points: a.max_points });
        if (p === "/us") return rest("jccdb_us_prices", { query: a.q, state: a.state, geo: a.geo, layer: a.layer, period: a.period, status: a.status, source_id: a.source_id, include_national: a.include_national, limit: a.limit, offset: a.offset });
        if (p === "/us/wage") return rest("jccdb_us_prevailing_wage", { state: a.state, county: a.county, trade: a.trade || a.q, decision: a.decision, construction_type: a.construction_type, limit: a.limit, offset: a.offset });
        if (p === "/us/permits") return rest("jccdb_us_permits", { geo: a.geo, year: a.year, structure: a.structure, source: a.source, limit: a.limit, offset: a.offset });
        if (p === "/us/area-factor") return rest("jccdb_us_area_factor", { geo: a.geo, installation: a.installation || a.q, include_history: a.include_history, limit: a.limit, offset: a.offset });
        if (p === "/coverage") return rest("jccdb_coverage", { country: a.country, layer: a.layer, source_id: a.source_id, geo: a.geo });
        if (p === "/" || p === "/mcp") return json({ ...SERVER, protocolVersion: PROTOCOL_VERSION, tools: TOOLS.map((t) => t.name),
          rest: ["/search?q=", "/obs?q=&pref=&geo=&country=&layer=&period=&source_id=&offset=", "/labor?pref=&job=&history=1", "/sources?country=&source_id=&q=", "/compare?q=&spec=", "/work?q=&pref=", "/index?q=&from=&to=",
            "/us?q=&state=&geo=&layer=&period=", "/us/wage?state=&county=&trade=&decision=", "/us/permits?geo=&year=&structure=", "/us/area-factor?geo=&installation=", "/coverage?country=&layer=", "/health?deep=1"] });
        return json({ error: "not found" }, 404);
      }
      if (request.method === "POST" && (p === "/mcp" || p === "/")) {
        const body = await request.json();
        if (Array.isArray(body)) {
          const out = (await Promise.all(body.map((m) => handleRpc(env, m)))).filter(Boolean);
          return json(out);
        }
        const r = await handleRpc(env, body);
        return r ? json(r) : new Response(null, { status: 202 });
      }
      return json({ error: "method not allowed" }, 405);
    } catch (e) {
      return json({ error: "internal", detail: String((e && e.message) || e).slice(0, 300) }, 500);
    }
  },
};
