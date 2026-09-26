# -*- coding: utf-8 -*-
"""
hs-mcp に、米国の掛け率・マージン・輸入原価・各段の価格を引く4本のツールを足す(v3、additive)。中身は hs-jccdb-obs v0.4。
  get_us_price_chain         -> jccdb_us_price_chain   (陸揚げ原価から卸・小売・元請の各段の価格)
  get_us_import_landed_cost  -> jccdb_us_import_cost   (輸入の陸揚げ原価、HS 10 桁と相手国)
  get_us_trade_margins       -> jccdb_us_margin        (卸・小売の粗利率と BEA の流通構造)
  get_us_contract_discounts  -> jccdb_us_kake          (州・共同購買の契約の値引き率と掛け率)
あわせて get_jccdb_coverage に detail を足す(v0.4 の既定は要約)。既存のツールの定義と挙動は変えない(get_jccdb_coverage の引数を1つ足すだけ)。
呼び出しは v2 が作った分岐(_JCCDB_OBS の表と JCCDB_SVC.fetch("https://jccdb-obs.internal/mcp"))に名前を足すだけ。
hs-jccdb-obs v0.4 は、この host(jccdb-obs.internal)からの呼び出しにだけ米国の値を返す。公開の URL からは返さない。

前提: patcher v2(patch_hs_mcp_jccdb_obs_v2.py)が当たっていること。当たっていなければ何もせずに止まる。
状態: v2 -> 当てる / v3 -> 何もしない(終了コード 0)。
掟: 錨 + assert count==1 + 時刻つき .bak + node --check と読み込み検査(tools/list、binding 無しの fetch_failed)は一時ディレクトリで。
    リポには検査用のファイルを残さない。1つでも外れたら何も書かずに止まる。wrangler.jsonc は触らない(binding は v2 で入っている)。
使い方: python3 patch_hs_mcp_kake_v3.py ~/horizon-shield/workers/hs-mcp --dry   (書かずに検査だけ)
        python3 patch_hs_mcp_kake_v3.py ~/horizon-shield/workers/hs-mcp         (実際に書く)
"""
import sys, os, shutil, subprocess, datetime, tempfile, json

V2_MARK = "[PATCH 2026-09-26 jccdb-obs v2]"
V3_MARK = "[PATCH 2026-09-26 kake v3]"
NEW4 = ["get_us_price_chain", "get_us_import_landed_cost", "get_us_trade_margins", "get_us_contract_discounts"]

TOOLS_END = '''      include_history: { type: "boolean" },
      limit: { type: "integer", minimum: 1, maximum: 100 },
      offset: { type: "integer", minimum: 0 }
    } }
  }
];
'''
TOOLS_NEW = '''      include_history: { type: "boolean" },
      limit: { type: "integer", minimum: 1, maximum: 100 },
      offset: { type: "integer", minimum: 0 }
    } }
  },
  // [PATCH 2026-09-26 kake v3] 米国の掛け率・マージン・輸入原価・各段の価格(非公開の計算層)を引く4本。中身は hs-jccdb-obs v0.4(D1 は DB_US)。
  //   値はこの MCP からだけ返す(hs-jccdb-obs の公開の URL では返さない)。計算した値は computed:true、式・出典・sha256・data_version が付く。
  {
    name: "get_us_price_chain",
    title: "Get U.S. Material Price Chain (landed import cost to wholesale, retail and contractor)",
    annotations: { title: "米国の資材の流通の各段の価格", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "米国で建材や化学品が流通の各段でいくらになるかを計算して返す: 輸入の陸揚げ原価(Census の輸入統計、CIF + 関税、232 条などの追加関税を含む)から、卸(業種の平均の粗利率、Census AIES 2024)、小売(直接輸入と卸経由の幅)、元請(Caltrans の材料の上乗せ 15%)まで。HS 10 桁か英語の品名で引く。各行に式・出典の URL と sha256・卸の業種の当て方の確度・BEA 2007 の流通構造との照合が付く。推計(computed:true)で、見積の良し悪しを判定する値ではない。例: query='plywood'、hs='2523290000'(ポルトランドセメント)。 / Estimated U.S. prices along the distribution chain for construction materials and chemicals: landed import cost (Census, CIF plus duty including Section 232) to wholesale (industry-average gross margin, Census AIES 2024), retail (range: direct import vs via wholesale) and contractor (Caltrans materials markup 15%). Look up by HS code or English product name; every row carries the formula, source URLs and hashes, mapping confidence and a BEA 2007 cross-check. Estimates (computed:true), not a verdict on any quote.",
    inputSchema: { type: "object", properties: {
      hs: { type: "string", description: "HS の頭 2〜10 桁(例 2523 セメント、4412 合板、3917 樹脂管、6907 タイル)。 / HS code prefix." },
      query: { type: "string", description: "英語の品名(例 plywood, portland cement, pvc pipe, ceramic tiles)。 / Product name in English." },
      include_thin: { type: "boolean", description: "取引の薄い品目も入れる(既定は外す)。 / Include thinly traded items." },
      limit: { type: "integer", minimum: 1, maximum: 50 }
    } }
  },
  {
    name: "get_us_import_landed_cost",
    title: "Get U.S. Landed Import Cost by HS Code and Partner Country",
    annotations: { title: "米国の輸入の陸揚げ原価", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "米国に輸入される建材と化学品の陸揚げ原価を HS 10 桁で返す(Census の輸入統計 IMDB、月と年初来): 通関価格・CIF・計算上の関税(232 条などの追加関税を含む)・数量・単価・実効の関税率と、相手国の上位(か country で指定の国)。単価と実効の関税率は computed:true。国内の運賃と通関の手数料は入らない。 / Landed cost of U.S. imports of construction materials and chemicals by HS 10-digit code (Census IMDB, month and year to date): customs value, CIF, calculated duty (including Section 232 and other additional duties), quantity, unit cost and effective duty rate (computed), with top partner countries or one country.",
    inputSchema: { type: "object", properties: {
      hs: { type: "string", description: "HS の頭 2〜10 桁(例 7214 棒鋼)。 / HS code prefix." },
      query: { type: "string", description: "英語の品名。 / Product name in English." },
      country: { type: "string", description: "相手国(英語の国名か Census の国コード 4 桁)。 / Partner country." },
      top_countries: { type: "integer", minimum: 1, maximum: 20 },
      limit: { type: "integer", minimum: 1, maximum: 50 }
    } }
  },
  {
    name: "get_us_trade_margins",
    title: "Get U.S. Wholesale and Retail Gross Margins (Census) and BEA Margin Structure",
    annotations: { title: "米国の卸・小売の粗利率", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "米国の卸と小売の粗利率を NAICS で返す(Census AWTS 1992〜2022、ARTS 1993〜2022、AIES 2024)。kake_cost_ratio = 1 - 粗利率(売値のうち仕入れ原価の割合)。commodity か include_bea で BEA 2007 の建設業と家計の購入の流通構造(生産者価格・運賃・卸・小売・購入者価格)も。業種の平均で、個々の会社の仕入れ値ではない。例: naics='4233'(建材卸)、naics='444110'(ホームセンター)。 / U.S. wholesale and retail gross margins by NAICS (Census AWTS, ARTS, AIES 2024) with kake_cost_ratio = 1 - margin; optionally the BEA 2007 margin structure. Industry averages, not any firm's cost.",
    inputSchema: { type: "object", properties: {
      naics: { type: "string", description: "NAICS の頭(4233 建材卸、423720 配管・暖房卸、4441 建材小売、444110 ホームセンター)。 / NAICS prefix." },
      query: { type: "string", description: "業種の語(英語。例 plumbing, paint)。 / Industry words in English." },
      trade: { type: "string", enum: ["wholesale", "retail"] },
      year: { type: "string" },
      history: { type: "boolean", description: "true で年ごと。 / All years." },
      include_bea: { type: "boolean" },
      commodity: { type: "string", description: "BEA の品目の語(英語。例 cement, lighting)。 / BEA commodity words." },
      limit: { type: "integer", minimum: 1, maximum: 200 }
    } }
  },
  {
    name: "get_us_contract_discounts",
    title: "Get U.S. Public Contract Discount Rates off List Price (kake ratio)",
    annotations: { title: "米国の公的な契約の値引き率と掛け率", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "州と共同購買の契約書が公開している、定価からの値引き率を返す(ワシントン州 DES 23623 配管部材・11121 電気資材、NASPO ValuePoint の資材 MRO の Grainger・Fastenal・MSC・Lawson・HD Supply、Home Depot の塗料)。掛け率 = 1 - 値引き率(computed:true)。定価への上乗せ(Over MSRP)と業者の目録からの値引き(Catalog Off)は別の列で、掛け率には入れない。率は上限で、定価の基準は行ごとに違う。例: query='eaton breakers'。 / Published discount rates off list price in U.S. public contracts (Washington DES plumbing and electrical, NASPO ValuePoint MRO), with kake_ratio = 1 - discount (computed:true). Over-MSRP and catalog-off rows are kept separate. Rates are ceilings; list bases differ by row.",
    inputSchema: { type: "object", properties: {
      query: { type: "string", description: "メーカー・製品系列・分野・業者の語(英語)。 / Manufacturer, product line, category or vendor words." },
      vendor: { type: "string" },
      manufacturer: { type: "string" },
      source_id: { type: "string", enum: ["wa-des-23623", "wa-des-11121", "naspo-mro-ak"] },
      basis: { type: "string", enum: ["MSRP Discount", "Over MSRP", "Catalog Off", "Discount off List Price", "Discount off shelf price", "Discount off shelf price (range)", "Cost Plus", "N/A", "See below"] },
      limit: { type: "integer", minimum: 1, maximum: 100 },
      offset: { type: "integer", minimum: 0 }
    } }
  }
];
'''
COV_OLD = '''      geo: { type: "string", description: "地域(都道府県・州)。 / Region." }
    } }
  },
  {
    name: "get_us_prevailing_wage",'''
COV_NEW = '''      geo: { type: "string", description: "地域(都道府県・州)。 / Region." },
      detail: { type: "boolean", description: "true で出典ごとの行も返す(既定は要約: layer ごとの件数と出典の系統の上位 5。米国の非公開の層の件数も付く)。 / true for per-source rows; the default is a summary." }
    } }
  },
  {
    name: "get_us_prevailing_wage",'''
MAP_OLD = '''    get_us_prevailing_wage: "jccdb_us_prevailing_wage", get_us_permits: "jccdb_us_permits", get_us_area_factor: "jccdb_us_area_factor"
  };'''
MAP_NEW = '''    get_us_prevailing_wage: "jccdb_us_prevailing_wage", get_us_permits: "jccdb_us_permits", get_us_area_factor: "jccdb_us_area_factor",
    // [PATCH 2026-09-26 kake v3] hs-jccdb-obs v0.4 の非公開の計算層。host が jccdb-obs.internal の呼び出しにだけ値を返す。
    get_us_price_chain: "jccdb_us_price_chain", get_us_import_landed_cost: "jccdb_us_import_cost", get_us_trade_margins: "jccdb_us_margin", get_us_contract_discounts: "jccdb_us_kake"
  };'''
FORBIDDEN = [chr(0x2013), chr(0x2014), chr(0x2015)]

SMOKE = r'''
const [orig, patched] = await Promise.all([import(process.argv[2]), import(process.argv[3])]);
const kv = new Map();
const env = { RL_KV: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); }, delete: async (k) => kv.delete(k), list: async () => ({ keys: [] }) } };
const ctx = { waitUntil() {}, passThroughOnException() {} };
const _log = console.log; console.log = (...a) => { if (typeof a[0] === "string" && a[0].startsWith('{"evt":"tool_call"')) return; _log(...a); };
async function rpc(m, body) {
  const r = await m.default.fetch(new Request("https://mcp.horizonshield.dev/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(body) }), env, ctx);
  const t = await r.text(); return JSON.parse(t.match(/\{[\s\S]*\}/)[0]);
}
const a = (await rpc(orig, { jsonrpc: "2.0", id: 1, method: "tools/list" })).result.tools;
const b = (await rpc(patched, { jsonrpc: "2.0", id: 1, method: "tools/list" })).result.tools;
const ours = new Set(JSON.parse(process.argv[4]));
const touched = new Set(["get_jccdb_coverage"]);
const keep = (ts) => JSON.stringify(ts.filter((t) => !ours.has(t.name) && !touched.has(t.name)));
const covA = a.find((t) => t.name === "get_jccdb_coverage"), covB = b.find((t) => t.name === "get_jccdb_coverage");
const covOk = covB && covB.inputSchema.properties.detail && covB.inputSchema.properties.detail.type === "boolean" &&
  JSON.stringify({ ...covB, inputSchema: { ...covB.inputSchema, properties: Object.fromEntries(Object.entries(covB.inputSchema.properties).filter(([k]) => k !== "detail")) } }) === JSON.stringify(covA);
const c = await rpc(patched, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_us_price_chain", arguments: { hs: "2523" } } });
const sc = JSON.parse(c.result.content[0].text);
_log(JSON.stringify({ same_existing_tools: keep(a) === keep(b), coverage_only_detail_added: covOk, names: b.map((t) => t.name).filter((n) => ours.has(n)),
  total_before: a.length, total_after: b.length, unbound_is_error: c.result.isError === true && sc.fetch_failed === true && sc.error === "jccdb_obs_not_bound" }));
'''


def detect(s):
    if V3_MARK in s:
        return "v3"
    if V2_MARK in s:
        return "v2"
    return "no_v2"


def plan(s):
    anchors = (("tools end", TOOLS_END), ("coverage schema", COV_OLD), ("call map", MAP_OLD))
    for name, anchor in anchors:
        n = s.count(anchor)
        assert n == 1, "錨 %s が %d 回。1回でないので止める(何も書いていない)。" % (name, n)
    return s.replace(TOOLS_END, TOOLS_NEW).replace(COV_OLD, COV_NEW).replace(MAP_OLD, MAP_NEW), [a[0] for a in anchors]


def post_checks(s2):
    for n in NEW4:
        assert s2.count('name: "%s"' % n) == 1, "当てた後の %s の定義が1回でない" % n
    assert s2.count(V3_MARK) == 2, "v3 の目印が2回でない"
    assert s2.count('JCCDB_SVC.fetch("https://jccdb-obs.internal/mcp"') == 1, "JCCDB_SVC の呼び先が jccdb-obs.internal でない(v0.4 はこの host にだけ米国の値を返す)"
    assert s2.count("detail: { type: \"boolean\"") == 1, "coverage の detail が1回でない"
    for ch in FORBIDDEN:
        assert ch not in TOOLS_NEW + COV_NEW + MAP_NEW, "足す文に禁止文字 U+%04X" % ord(ch)


def node_checks(s, s2):
    with tempfile.TemporaryDirectory() as td:
        a, b, sm = os.path.join(td, "orig.mjs"), os.path.join(td, "patched.mjs"), os.path.join(td, "smoke.mjs")
        open(a, "w", encoding="utf-8").write(s)
        open(b, "w", encoding="utf-8").write(s2)
        open(sm, "w", encoding="utf-8").write(SMOKE)
        r = subprocess.run(["node", "--check", b], capture_output=True, text=True)
        assert r.returncode == 0, "node --check が落ちた: " + r.stderr[:500]
        r = subprocess.run(["node", sm, "file://" + a, "file://" + b, json.dumps(NEW4)], capture_output=True, text=True, cwd=td)
        assert r.returncode == 0, "読み込み検査が落ちた: " + r.stderr[-800:]
        out = json.loads(r.stdout.strip().splitlines()[-1])
    assert out["same_existing_tools"], "既存ツールの定義(tools/list)が変わっている"
    assert out["coverage_only_detail_added"], "get_jccdb_coverage の変化が detail の追加だけではない"
    assert out["names"] == NEW4, "tools/list の新ツールが揃っていない: %s" % out["names"]
    assert out["total_after"] == out["total_before"] + 4, "ツールの数が 4 本増えていない"
    assert out["unbound_is_error"], "binding が無いときに fetch_failed を返していない"
    return out


def main():
    if len(sys.argv) < 2 or sys.argv[1].startswith("--"):
        sys.exit(__doc__)
    root = os.path.expanduser(sys.argv[1])
    dry = "--dry" in sys.argv
    mcp = os.path.join(root, "src", "mcp.js")
    s = open(mcp, encoding="utf-8").read()
    state = detect(s)
    if state == "v3":
        try:
            post_checks(s)
        except AssertionError as e:
            sys.exit("v3 の目印はあるが形が揃っていない(手で直されたか途中で止まった): %s。何もしない。" % e)
        print("既に v3 が当たっている。何もしない。")
        return
    if state == "no_v2":
        sys.exit("patcher v2(jccdb-obs v2)が当たっていない。先に v2 を当てること。何もしない。")
    try:
        s2, used = plan(s)
        post_checks(s2)
        out = node_checks(s, s2)
    except AssertionError as e:
        sys.exit("止めた: %s" % e)
    summary = "状態 v2 -> v3。錨 %s は各1回、node --check 緑、tools/list は既存 %d 本そのまま(get_jccdb_coverage は detail を足しただけ)+ 新 4 本(合計 %d)、binding 無しは fetch_failed。" % (
        "/".join(used), out["total_before"], out["total_after"])
    if dry:
        print("dry: " + summary + " 書いていない。")
        return
    ts = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    shutil.copy2(mcp, mcp + ".bak.%s-kakev3" % ts)
    open(mcp, "w", encoding="utf-8").write(s2)
    print("書いた。" + summary + " バックアップ: src/mcp.js.bak.%s-kakev3" % ts)


if __name__ == "__main__":
    main()
