# -*- coding: utf-8 -*-
"""
JCCDB 観測層 v2 の共通部品。parser はここから COLUMNS / make_id / clean / write_obs / pref を使う。
1行 = 1観測 = (品目 x 地域 x 時点 x 出典)。日本と米国を同じ形で持つ。

値(price)を入れてよいのは、出典の利用条件が再配布を許すとき(OPEN_STATUSES)だけ。
許さないときは price を空にし、状態(price_status)だけを入れる。
"""
import csv, hashlib, os, re, unicodedata

COLUMNS = [
    "obs_id", "country", "layer", "category", "item_name", "spec", "unit",
    "geo_level", "geo_code", "geo_name", "area_label", "area_code", "area_members",
    "price", "currency", "price_basis", "price_status", "ref_value", "ref_note",
    "period", "effective_from", "source_id", "source_page", "evidence_url", "license",
    "jccdb_v4_item_id", "note",
]

LAYERS = {
    "material",   # 資材・製品の単価(設計材料単価など)
    "labor",      # 公的に設定された労務単価(設計労務単価、Davis-Bacon の賃金決定など)
    "work",       # 工事(施工)の単価: 材料+労務+機械の複合(施工パッケージ標準単価、営繕の工事単価、市場単価の公開分)
    "equipment",  # 機械の損料・運転単価(FEMA, USACE 等)
    "index",      # 指数(NHCCI, PPI, 建設工事費デフレーター 等)。price は指数値、currency は空
    "wage",       # 統計上の賃金(OEWS 等。設定単価ではなく調査の平均・分位)
    "bid_item",   # 入札単価の集計(州 DOT の加重平均単価 等)
    "cost_sqft",  # 面積あたり工事費の統計(着工統計の工事費予定額/床面積 等)
    "spending",   # 工事の出来高・支出額の統計(Census VIP 等)
}

GEO_LEVELS = {
    "national",       # 国全体(geo_code = JP / US)
    "bureau_area",    # 地方整備局の単価地区(area_code に局の地区コード、geo_code に都道府県コードが分かれば入れる)
    "pref",           # 都道府県(geo_code = JIS 2桁)
    "pref_area",      # 県が定める単価地区
    "city",           # 市区町村(geo_code = 全国地方公共団体コード5桁 か 都道府県コード)
    "census_region",  # 米国 Census Region(geo_code = R1..R4)/ Division(D1..D9)
    "state",          # 米国の州(geo_code = FIPS 2桁)
    "metro",          # 米国の都市圏(geo_code = CBSA 5桁 か OEWS の area コード)
    "county",         # 米国の郡(geo_code = FIPS 5桁)
    "district",       # 州 DOT の管区など(geo_code = 州 FIPS、area_code に管区)
}

OPEN_STATUSES = {"published_pdl", "published_cc_by", "public_domain", "published_open_terms"}
CLOSED_STATUSES = {"published_restricted_not_copied", "publication_based_not_public", "not_set"}
STATUSES = OPEN_STATUSES | CLOSED_STATUSES

# status ごとに許す license
STATUS_LICENSES = {
    "published_pdl": {"PDL1.0"},
    "published_cc_by": {"CC-BY-4.0", "GOV-STD-2.0"},
    "public_domain": {"US-PD-17USC105", "PD"},
    "published_open_terms": {"OPEN-TERMS"},
}
LICENSES = {"PDL1.0", "CC-BY-4.0", "GOV-STD-2.0", "US-PD-17USC105", "PD", "OPEN-TERMS", "restricted"}

PRICE_BASES = {
    "design_unit_price_ex_tax",   # 設計単価(消費税抜き)
    "design_unit_price_inc_tax",  # 設計単価(税込)
    "labor_wage_8h",              # 所定労働時間内8時間あたりの賃金
    "work_unit_price_ex_tax",     # 工事(施工)単価(税抜き)
    "index_value",                # 指数値
    "wage_hourly_mean", "wage_hourly_median", "wage_annual_mean", "wage_annual_median",
    "wage_hourly_p10", "wage_hourly_p25", "wage_hourly_p75", "wage_hourly_p90",
    "prevailing_wage_hourly", "prevailing_fringe_hourly",
    "equipment_rate_hourly", "equipment_rate_daily", "equipment_rate_monthly",
    "bid_weighted_avg", "bid_simple_avg", "bid_median", "bid_low", "bid_high",
    "cost_per_sqft", "cost_per_m2", "spending_million_usd_saar", "spending_million_usd_nsa",
    "count", "ratio",
}

PERIOD_RE = re.compile(r"^(\d{4}(-\d{2}(-\d{2})?)?|\d{4}Q[1-4]|FY\d{4}|\d{4}H[12])$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
NUM_RE = re.compile(r"^-?\d+(\.\d+)?$")
ID_RE = re.compile(r"^[0-9a-f]{16}$")
FORBIDDEN = {"\u2014": "em dash", "\u2013": "en dash", "\u2015": "horizontal bar", "‒": "figure dash"}

JP_PREFS = ["北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県",
            "埼玉県", "千葉県", "東京都", "神奈川県", "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県",
            "岐阜県", "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
            "鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県", "香川県", "愛媛県", "高知県", "福岡県",
            "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県"]
JP_PREF_CODE = {n: "%02d" % (i + 1) for i, n in enumerate(JP_PREFS)}
JP_CODE_PREF = {v: k for k, v in JP_PREF_CODE.items()}

US_STATES = {
    "01": "Alabama", "02": "Alaska", "04": "Arizona", "05": "Arkansas", "06": "California", "08": "Colorado",
    "09": "Connecticut", "10": "Delaware", "11": "District of Columbia", "12": "Florida", "13": "Georgia",
    "15": "Hawaii", "16": "Idaho", "17": "Illinois", "18": "Indiana", "19": "Iowa", "20": "Kansas",
    "21": "Kentucky", "22": "Louisiana", "23": "Maine", "24": "Maryland", "25": "Massachusetts",
    "26": "Michigan", "27": "Minnesota", "28": "Mississippi", "29": "Missouri", "30": "Montana",
    "31": "Nebraska", "32": "Nevada", "33": "New Hampshire", "34": "New Jersey", "35": "New Mexico",
    "36": "New York", "37": "North Carolina", "38": "North Dakota", "39": "Ohio", "40": "Oklahoma",
    "41": "Oregon", "42": "Pennsylvania", "44": "Rhode Island", "45": "South Carolina", "46": "South Dakota",
    "47": "Tennessee", "48": "Texas", "49": "Utah", "50": "Vermont", "51": "Virginia", "53": "Washington",
    "54": "West Virginia", "55": "Wisconsin", "56": "Wyoming", "60": "American Samoa", "66": "Guam",
    "69": "Northern Mariana Islands", "72": "Puerto Rico", "78": "U.S. Virgin Islands",
}
US_STATE_ABBR = {
    "AL": "01", "AK": "02", "AZ": "04", "AR": "05", "CA": "06", "CO": "08", "CT": "09", "DE": "10", "DC": "11",
    "FL": "12", "GA": "13", "HI": "15", "ID": "16", "IL": "17", "IN": "18", "IA": "19", "KS": "20", "KY": "21",
    "LA": "22", "ME": "23", "MD": "24", "MA": "25", "MI": "26", "MN": "27", "MS": "28", "MO": "29", "MT": "30",
    "NE": "31", "NV": "32", "NH": "33", "NJ": "34", "NM": "35", "NY": "36", "NC": "37", "ND": "38", "OH": "39",
    "OK": "40", "OR": "41", "PA": "42", "RI": "44", "SC": "45", "SD": "46", "TN": "47", "TX": "48", "UT": "49",
    "VT": "50", "VA": "51", "WA": "53", "WV": "54", "WI": "55", "WY": "56", "AS": "60", "GU": "66", "MP": "69",
    "PR": "72", "VI": "78",
}


def make_id(*parts):
    """観測の ID。v1 と同じ作り方(sha256 の先頭16桁、区切りは \\x1f)。parts には出典ID と、その出典の中で行を一意に決める値を渡す。"""
    return hashlib.sha256("\x1f".join(str(p) for p in parts).encode("utf-8")).hexdigest()[:16]


def clean(s):
    """セルの文字の後始末。原本の文字は変えない。ただし em/en ダッシュと水平線(出力に出さない約束)だけは '-' に置き換え、
    改行とタブは空白1つにする。前後の空白は落とす。"""
    if s is None:
        return ""
    s = str(s)
    for ch in FORBIDDEN:
        s = s.replace(ch, "-")
    s = re.sub(r"[\r\n\t]+", " ", s)
    return s.strip()


def num(s):
    """'12,300' / '１２，３００' / '12300.0' を '12300' に。数でなければ ValueError。"""
    t = unicodedata.normalize("NFKC", str(s)).replace(",", "").strip()
    if not NUM_RE.match(t):
        raise ValueError("not a number: %r" % (s,))
    if "." in t:
        t = t.rstrip("0").rstrip(".")
    return t


def pref(name_or_code):
    """'奈良' / '奈良県' / '29' / '29奈良県' を ('29', '奈良県') に。分からなければ (None, None)。"""
    t = unicodedata.normalize("NFKC", str(name_or_code or "")).strip()
    m = re.match(r"^(\d{1,2})", t)
    if m and "%02d" % int(m.group(1)) in JP_CODE_PREF:
        c = "%02d" % int(m.group(1))
        return c, JP_CODE_PREF[c]
    for n, c in JP_PREF_CODE.items():
        if t == n or (n != "北海道" and t == n[:-1]) or t.startswith(n):
            return c, n
    return None, None


def write_obs(path, rows):
    """rows(dict のリスト)を COLUMNS の順で書く。足りない列は空、余分な列があれば止める。obs_id の重複でも止める。"""
    seen = set()
    for r in rows:
        extra = set(r) - set(COLUMNS)
        assert not extra, "余分な列: %s" % extra
        assert r["obs_id"] not in seen, "obs_id が重複: %s" % r["obs_id"]
        seen.add(r["obs_id"])
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS, lineterminator="\n")
        w.writeheader()
        for r in rows:
            w.writerow({k: clean(r.get(k, "")) for k in COLUMNS})
    return len(rows)
