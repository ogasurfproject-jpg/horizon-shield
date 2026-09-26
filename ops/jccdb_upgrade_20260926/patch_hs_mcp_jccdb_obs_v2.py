# -*- coding: utf-8 -*-
"""
hs-mcp に JCCDB の品目・観測層 v2(日本と米国)を引く11本のツールを足す(v2、additive)。中身は hs-jccdb-obs v0.3。
  2026-09-26 M2: TOshi がまだ当てていないので v2 のまま直した(直す前の写しは .bak.20260926-134055-m2)。米国の建設費データベース化に合わせて、
  get_us_construction_prices の layer を米国の全 layer に広げ、get_us_prevailing_wage / get_us_permits / get_us_area_factor を足した。

  v1 の3本(search_jccdb_items / get_jccdb_observations / get_jccdb_labor_rate)を v2 の形にし、5本を足す:
    compare_jccdb_regions, get_jccdb_work_unit_price, get_jccdb_index_series, get_us_construction_prices, get_jccdb_coverage,
    get_us_prevailing_wage, get_us_permits, get_us_area_factor
  v1 の3本の名前と引数は変えない(引数を足すだけ)。hs-mcp の既存ツールの定義と挙動は変えない
  (変えるのは v1 が足した search_cost_category の「該当なし」の案内文だけで、それも v1 と同じ文)。

状態を見て、当て方を選ぶ:
  fresh : v1 も v2 も当たっていない mcp.js  -> 全部(ツール11本、呼び出しの分岐、案内文、wrangler の binding)
  v1    : v1 が当たっている mcp.js          -> 差分(v1 の3本と分岐を v2 に置き換え、wrangler の注記を v2 に)
  v2    : 既に当たっている                  -> 何もしない(終了コード 0)
  どちらの道で当てても、出来上がる mcp.js と wrangler.jsonc は同じバイト列になる。

掟: 錨 + assert count==1 + 時刻つき .bak + node --check(と、読み込んで tools/list を叩く検査)は一時ディレクトリで。
    リポには検査用のファイルを残さない。1つでも外れたら何も書かずに止まる。
使い方: python3 patch_hs_mcp_jccdb_obs_v2.py ~/horizon-shield/workers/hs-mcp --dry   (書かずに検査だけ)
        python3 patch_hs_mcp_jccdb_obs_v2.py ~/horizon-shield/workers/hs-mcp         (実際に書く)
"""
import sys, os, shutil, subprocess, datetime, tempfile, json

# ------------------------------------------------------------------ v1 の patcher が書いた文(錨)。patch_hs_mcp_jccdb_obs.py と1バイトも違わない。
TOOLS_END = '      work: { type: "string", description: "工事名(例: 窓 交換, 外壁塗装, 浴室)。 / Work name in Japanese." }\n    } }\n  }\n];\n'
NEW_TOOLS = '      work: { type: "string", description: "工事名(例: 窓 交換, 外壁塗装, 浴室)。 / Work name in Japanese." }\n    } }\n  },\n  // [PATCH 2026-09-26 jccdb-obs] JCCDB の 95,403 品目と観測層を MCP から引けるようにする。\n  //   実測: search_cost_category(\'生コンクリート\') も get_price_range(\'生コン\',\'奈良県\') も該当なしで、\n  //   JCCDB に奈良県の生コン品目が 147 行あるのに LLM は「入っていない」と答えていた。中身は hs-jccdb-obs(D1)。\n  {\n    name: "search_jccdb_items",\n    title: "Search JCCDB Line Items",\n    annotations: { title: "JCCDB 品目検索", readOnlyHint: true, destructiveHint: false, openWorldHint: false },\n    description: "日本の建設費オープンデータ JCCDB(95,403品目)の品目を名前で探す。生コン・異形棒鋼・ヒューム管・側溝など資材や製品、労務の品目が公的資料に実在するかと証拠URLを返す。工事カテゴリ(search_cost_category)に無い資材はこちら。地域・時点・価格は get_jccdb_observations。 / Search the 95,403 JCCDB line items (materials, products, labor) by name; returns whether each exists in a public document, with its evidence URL. Use for materials that are not renovation work categories.",\n    inputSchema: { type: "object", properties: {\n      query: { type: "string", description: "品目名(日本語。例: 生コンクリート 21-8-25)。 / Item name in Japanese." },\n      category: { type: "string", description: "(任意) JCCDB のカテゴリ名で絞る。 / optional JCCDB category." },\n      limit: { type: "integer", minimum: 1, maximum: 50 }\n    }, required: ["query"] }\n  },\n  {\n    name: "get_jccdb_observations",\n    title: "Get JCCDB Observations (region, date, price status)",\n    annotations: { title: "JCCDB 観測(地域・時点・価格状態)", readOnlyHint: true, destructiveHint: false, openWorldHint: false },\n    description: "品目が『どの都道府県・地区で・いつから・いくらで(または非公開の理由)』公的資料に載っているかを返す。値は再配布を許す出典(PDL1.0: 国交省・地方整備局)のときだけ入る。県が刊行物単価を使って値を公開していない地区は publication_based_not_public と返す(欠落ではなく事実)。例: query=\'生コンクリート\', pref=\'奈良県\'。公共工事の設計単価であり、リフォームの見積単価ではない。 / Region, date and price status of an item in Japanese public documents. Values only where the licence allows redistribution; cells where the prefecture uses commercial price publications are reported as such, not guessed.",\n    inputSchema: { type: "object", properties: {\n      query: { type: "string", description: "品目名(例: 生コンクリート)。 / Item name." },\n      pref: { type: "string", description: "都道府県(奈良県 / 奈良 / nara)。 / Prefecture." },\n      layer: { type: "string", enum: ["labor", "material"] },\n      limit: { type: "integer", minimum: 1, maximum: 100 }\n    } }\n  },\n  {\n    name: "get_jccdb_labor_rate",\n    title: "Get Public-Works Design Labor Rate (Japan)",\n    annotations: { title: "公共工事設計労務単価", readOnlyHint: true, destructiveHint: false, openWorldHint: false },\n    description: "国交省の公共工事設計労務単価(令和8年3月適用、47都道府県 x 50職種、所定労働時間内8時間あたりの賃金)を引く。例: pref=\'奈良県\', job=\'大工\'。 / MLIT public-works design labor rates from March 2026, by prefecture and trade (wage per 8 hours).",\n    inputSchema: { type: "object", properties: {\n      pref: { type: "string", description: "都道府県。 / Prefecture." },\n      job: { type: "string", description: "職種(例: 大工, 左官, 特殊作業員)。 / Trade in Japanese." }\n    } }\n  }\n];\n'
CALL_ANCHOR = '  if (name === "jccdb_dataset_info") return txt({ ...JCCDB, next_actions: NEXT_ACTIONS });\n'
CALL_NEW = '  // [PATCH 2026-09-26 jccdb-obs] hs-jccdb-obs へ service binding で渡す。\n  //   「呼べなかった」と「呼べて0件だった」を同じ値に潰さない(2026-08-20 の掟)。\n  if (name === "search_jccdb_items" || name === "get_jccdb_observations" || name === "get_jccdb_labor_rate") {\n    const _map = { search_jccdb_items: "jccdb_search_items", get_jccdb_observations: "jccdb_observations", get_jccdb_labor_rate: "jccdb_labor_rate" };\n    if (!env || !env.JCCDB_SVC) return txt({ error: "jccdb_obs_not_bound", fetch_failed: true, message: "JCCDB の観測の口(hs-jccdb-obs)に繋がっていない。0件ではなく、取りに行けていない。 / The JCCDB observation service is not bound. This is a failure to fetch, not an empty result." });\n    let _j = null;\n    try {\n      const _r = await env.JCCDB_SVC.fetch("https://jccdb-obs.internal/mcp", { method: "POST", headers: { "content-type": "application/json" },\n        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: _map[name], arguments: args || {} } }) });\n      _j = await _r.json();\n    } catch (e) {\n      return txt({ error: "jccdb_obs_fetch_failed", fetch_failed: true, message: "hs-jccdb-obs への問い合わせが失敗した。0件ではない。 / The lookup failed; this is not an empty result." });\n    }\n    const _sc = _j && _j.result && _j.result.structuredContent;\n    if (!_sc) return txt({ error: "jccdb_obs_bad_response", fetch_failed: true });\n    return txt({ ..._sc, fetch_failed: false, next_actions: NEXT_ACTIONS });\n  }\n  if (name === "jccdb_dataset_info") return txt({ ...JCCDB, next_actions: NEXT_ACTIONS });\n'
MSG_OLD = '    if (!hit.length) return txt("該当カテゴリが見つかりませんでした: " + q + " / list_cost_categories で全一覧を確認できます。");\n'
MSG_NEW = '    if (!hit.length) return txt("該当カテゴリが見つかりませんでした: " + q + " / list_cost_categories で全一覧を確認できます。資材・製品・労務の品目(生コン、鉄筋、側溝など)なら search_jccdb_items で JCCDB 95,403 品目を、地域と価格状態は get_jccdb_observations で引けます。 / For materials and line items, use search_jccdb_items and get_jccdb_observations.");\n'
WR_OLD = '    { "binding": "HEARING_SVC", "service": "hs-hearing" }\n  ],'
WR_NEW = '    { "binding": "HEARING_SVC", "service": "hs-hearing" },\n    // ★2026-09-26 JCCDB の品目・観測層の口(search_jccdb_items / get_jccdb_observations / get_jccdb_labor_rate)。\n    //   hs-jccdb-obs を先に deploy してから、この行を含む hs-mcp を deploy する(逆順だと binding 先が無く deploy が落ちる)。\n    { "binding": "JCCDB_SVC", "service": "hs-jccdb-obs" }\n  ],'

V2_MARK = "[PATCH 2026-09-26 jccdb-obs v2]"
V1_MARK = "[PATCH 2026-09-26 jccdb-obs]"
V2_NAMES = ["search_jccdb_items", "get_jccdb_observations", "get_jccdb_labor_rate", "compare_jccdb_regions",
            "get_jccdb_work_unit_price", "get_jccdb_index_series", "get_us_construction_prices", "get_jccdb_coverage",
            "get_us_prevailing_wage", "get_us_permits", "get_us_area_factor"]
V1_NAMES = V2_NAMES[:3]

V2_NEW_TOOLS = '''      work: { type: "string", description: "工事名(例: 窓 交換, 外壁塗装, 浴室)。 / Work name in Japanese." }
    } }
  },
  // [PATCH 2026-09-26 jccdb-obs v2] JCCDB の 95,403 品目と観測層 v2(日本と米国、同じ列)を MCP から引く11本。中身は hs-jccdb-obs v0.3(D1 は日本と米国の2つ)。
  //   v1 の3本は名前も引数もそのままで、引数を足しただけ。値は再配布を許す出典のときだけ入り、各行に license・attribution・evidence_url が付く。
  //   公共工事の設計単価・入札単価・統計であって、リフォームの見積単価ではない(返答の basis に書いてある)。
  {
    name: "search_jccdb_items",
    title: "Search JCCDB Line Items",
    annotations: { title: "JCCDB 品目検索", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "日本の建設費オープンデータ JCCDB(95,403品目)の品目を名前で探す。生コン・異形棒鋼・ヒューム管・側溝など資材や製品、労務の品目が公的資料に実在するかと証拠URLを返す。工事カテゴリ(search_cost_category)に無い資材はこちら。地域・時点・価格は get_jccdb_observations。 / Search the 95,403 JCCDB line items (materials, products, labor) by name; returns whether each exists in a public document, with its evidence URL. Use for materials that are not renovation work categories.",
    inputSchema: { type: "object", properties: {
      query: { type: "string", description: "品目名(日本語。例: 生コンクリート 21-8-25)。 / Item name in Japanese." },
      category: { type: "string", description: "(任意) JCCDB のカテゴリ名で絞る。 / optional JCCDB category." },
      limit: { type: "integer", minimum: 1, maximum: 50 }
    }, required: ["query"] }
  },
  {
    name: "get_jccdb_observations",
    title: "Get JCCDB Observations (region, date, price status; Japan and U.S.)",
    annotations: { title: "JCCDB 観測(地域・時点・価格状態)", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "品目が『どの地域・地区で・いつ・いくらで(または非公開の理由)』公的資料に載っているかを返す(日本と米国)。値は再配布を許す出典のときだけ入り、各行に license・attribution・evidence_url が付く。県が刊行物単価を使って値を公開していない地区は publication_based_not_public と返す(欠落ではなく事実)。例: query='生コンクリート', pref='奈良県'。公共工事の設計単価であり、リフォームの見積単価ではない。 / Region, date and price status of an item in Japanese and U.S. public documents. Values only where the licence allows redistribution; every row carries licence, attribution and evidence URL; cells where the public body uses commercial price publications are reported as such, not guessed.",
    inputSchema: { type: "object", properties: {
      query: { type: "string", description: "品目名(例: 生コンクリート)。 / Item name." },
      pref: { type: "string", description: "都道府県(奈良県 / 奈良 / nara)。 / Prefecture." },
      geo: { type: "string", description: "地域: 都道府県名・JIS コード(29, JP-29)、州名・略号・FIPS(California, CA, US-06)。 / Region: prefecture name or JIS code, U.S. state name, abbreviation or FIPS." },
      country: { type: "string", enum: ["JP", "US"] },
      layer: { type: "string", enum: ["material", "labor", "work", "equipment", "index", "wage", "bid_item", "cost_sqft", "spending", "house_price", "cost_limit"] },
      status: { type: "string", enum: ["published_pdl", "published_cc_by", "public_domain", "published_open_terms", "published_restricted_not_copied", "publication_based_not_public", "not_set"] },
      period: { type: "string", description: "時点(2026, 2026-09, 2025Q4, FY2025)。 / Period." },
      source_id: { type: "string", description: "出典 ID(get_jccdb_coverage で分かる)。 / Source id." },
      limit: { type: "integer", minimum: 1, maximum: 100 },
      offset: { type: "integer", minimum: 0 }
    } }
  },
  {
    name: "get_jccdb_labor_rate",
    title: "Get Public-Works Design Labor Rate (Japan)",
    annotations: { title: "公共工事設計労務単価", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "国交省の公共工事設計労務単価(47都道府県 x 50職種、所定労働時間内8時間あたりの賃金)を引く。既定は地域ごとの最新の時点、history:true で年ごとの系列。例: pref='奈良県', job='大工'。 / MLIT public-works design labor rates by prefecture and trade (wage per 8 hours); latest by default, yearly series with history:true.",
    inputSchema: { type: "object", properties: {
      pref: { type: "string", description: "都道府県。 / Prefecture." },
      job: { type: "string", description: "職種(例: 大工, 左官, 特殊作業員)。 / Trade in Japanese." },
      history: { type: "boolean", description: "true で年ごとの系列。 / true for the yearly series." },
      limit: { type: "integer", minimum: 1, maximum: 200 }
    } }
  },
  {
    name: "compare_jccdb_regions",
    title: "Compare JCCDB Values Across Regions (latest)",
    annotations: { title: "地域ごとの比較(最新時点)", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "品目と規格で、地域ごとの最新時点の値を並べ、最小・中央・最大と状態別の件数を返す。規格・単位・値の種類が同じものだけを比べる(普通と高炉は別の組)。中央値はこのサービスの計算(computed:true)。例: query='生コンクリート', spec='24-8-25(20)', layer='material', normalize='namacon'(局ごとの規格の書き方の違いを越えて束ねる)。 / Latest value per region for an item and spec, with min, median (computed) and max and counts by price status; only identical spec, unit and basis are compared.",
    inputSchema: { type: "object", properties: {
      query: { type: "string", description: "品目名。 / Item name." },
      spec: { type: "string", description: "規格(例: 21-8-25(20))。 / Specification." },
      country: { type: "string", enum: ["JP", "US"] },
      layer: { type: "string", enum: ["material", "labor", "work", "equipment", "index", "wage", "bid_item", "cost_sqft", "spending", "house_price", "cost_limit"] },
      limit: { type: "integer", minimum: 1, maximum: 20 },
      normalize: { type: "string", enum: ["exact", "namacon"], description: "exact(既定: 規格の文字が同じものだけ)/ namacon(生コンの規格を局をまたいで束ねる: セメント・呼び強度-スランプ-骨材・水セメント比・単位セメント量)。 / namacon groups ready-mix concrete specs across bureaus." }
    }, required: ["query"] }
  },
  {
    name: "get_jccdb_work_unit_price",
    title: "Get Public-Works Unit Prices for Work Items (Japan)",
    annotations: { title: "工事の単価(施工パッケージ等)", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "工事の単価(材料・労務・機械の複合。施工パッケージ型積算の標準単価など)を引き、構成比の行を同じパッケージの行に添えて返す。公共土木の積算単価であり、リフォームの見積単価ではない。例: query='掘削', pref='東京都'。 / Public-works unit prices for work items (materials, labor and equipment combined), with composition-ratio rows attached to their package. Not renovation quote prices.",
    inputSchema: { type: "object", properties: {
      query: { type: "string", description: "工種・品目(例: 掘削)。 / Work item." },
      pref: { type: "string", description: "都道府県。 / Prefecture." },
      period: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 100 },
      offset: { type: "integer", minimum: 0 }
    } }
  },
  {
    name: "get_jccdb_index_series",
    title: "Get Construction Cost Index Series with Year-over-Year Change",
    annotations: { title: "指数の系列と前年同期比", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "建設費の指数(NHCCI、PPI、建設工事費デフレーター等)の系列を期間で返し、前年同期比を添える。前年同期比はこのサービスが計算した値(computed:true)で、原本には無い。query も source_id も無いときは系列の一覧。例: query='NHCCI', from='2020Q1'。 / Construction cost index series over a period with year-over-year change computed by this service (computed:true). Without query or source_id, lists the series.",
    inputSchema: { type: "object", properties: {
      query: { type: "string", description: "系列名(例: NHCCI)。 / Series name." },
      country: { type: "string", enum: ["JP", "US"] },
      source_id: { type: "string" },
      from: { type: "string", description: "始め(2020, 2020Q1, 2020-01, FY2020)。 / Start period." },
      to: { type: "string", description: "終わり(含む)。 / End period (inclusive)." },
      limit: { type: "integer", minimum: 1, maximum: 20 }
    } }
  },
  {
    name: "get_us_construction_prices",
    title: "Get U.S. Construction Prices (all layers: prevailing wages, wages, bids, equipment, permits, indexes, cost limits)",
    annotations: { title: "米国の建設費(全 layer)", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "米国の公的な建設費データベースを layer・地域・時点・品目で引く: labor(Davis-Bacon の法定賃金)、wage(BLS OEWS・QCEW の賃金)、work(DoD・FTA の単価)、equipment(FEMA・USACE の機械損料)、index(PPI・NHCCI・CWCCIS・DoD の地域係数)、spending(Census の工事支出と建築許可、市の許可)、cost_sqft(面積あたり工事費)、cost_limit(HUD の 1 戸あたり上限)、bid_item(州 DOT の入札単価)、house_price、material。geo は州・郡 FIPS(county:06037)・都市圏(cbsa:31080)・市(Austin, TX)。州を指定すると全国一律の行と USACE の地域の行も添える。1m2 あたりへの換算は computed:true。住宅リフォームの見積単価ではない。 / The U.S. public construction cost database by layer, region (state, county FIPS, CBSA, place), period and item: Davis-Bacon prevailing wages, BLS wages, public unit costs, equipment rates, permits and spending, indexes and area factors, HUD cost limits and state DOT bid prices. National and USACE regional rows are added for a state; per-m2 conversions are computed:true. Not residential remodeling quotes.",
    inputSchema: { type: "object", properties: {
      query: { type: "string", description: "品目・職種(英語。例: excavation, carpenters)。 / Item or occupation in English." },
      state: { type: "string", description: "州名・略号・FIPS(California, CA, 06, カリフォルニア)。 / State name, abbreviation or FIPS." },
      geo: { type: "string", description: "州・郡 FIPS(county:06037)・都市圏 CBSA(cbsa:31080)・市(Austin, TX)・郡の名前(Los Angeles County, CA)。 / State, county FIPS, CBSA, place or county name." },
      layer: { type: "string", enum: ["labor", "wage", "work", "equipment", "index", "spending", "cost_sqft", "cost_limit", "bid_item", "house_price", "material"] },
      period: { type: "string", description: "時点(2024, 2025-05, 2025Q4, FY2026)。 / Period." },
      source_id: { type: "string" },
      include_national: { type: "boolean", description: "州を指定したとき全国一律・地域一律の行も返す(既定 true。郡・都市圏・市では既定 false)。 / Include national and regional rows (default true for a state)." },
      limit: { type: "integer", minimum: 1, maximum: 100 },
      offset: { type: "integer", minimum: 0 }
    } }
  },
  {
    name: "get_jccdb_coverage",
    title: "Get JCCDB Observation Coverage (what exists, what does not)",
    annotations: { title: "何がどこまであるか", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "JCCDB の観測層に何がどこまであるかを返す: 国 x 種類(layer) x 出典の件数、値のある件数、状態別、出典の時点。0 行の組み合わせは absent に『無い(取り込んでいない)』と明記する。答える前に、その国・種類のデータがあるかをここで確かめる。 / What the JCCDB observation layer holds: rows per country x layer x source, priced rows, status counts and source periods; empty combinations are listed as absent (not ingested).",
    inputSchema: { type: "object", properties: {
      country: { type: "string", enum: ["JP", "US"] },
      layer: { type: "string", enum: ["material", "labor", "work", "equipment", "index", "wage", "bid_item", "cost_sqft", "spending", "house_price", "cost_limit"] },
      geo: { type: "string", description: "地域(都道府県・州)。 / Region." }
    } }
  },
  {
    name: "get_us_prevailing_wage",
    title: "Get U.S. Davis-Bacon Prevailing Wages (base and fringe)",
    annotations: { title: "米国 Davis-Bacon の法定賃金", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "米国 Davis-Bacon 法の一般賃金決定(連邦の資金が入る建設工事で払うべき最低の基本時給と付加給付)を、州・郡・職種で引く。1 件ごとに基本時給と付加給付を並べ、決定番号・改訂・公表日・郡の一覧・出典 URL を添える。基本 + 付加給付の合計は computed:true。民間の住宅工事の相場や業者の請求単価ではない。例: state='CA', county='Los Angeles', trade='carpenter'。 / U.S. Davis-Bacon general wage determinations by state, county and trade: base wage and fringe side by side with decision number, revision, publication date and source URL; the total is computed:true. These are minimums for federally funded work, not private market rates.",
    inputSchema: { type: "object", properties: {
      state: { type: "string", description: "州名・略号・FIPS。 / State." },
      county: { type: "string", description: "郡 FIPS 5桁か郡の名前(Los Angeles)。 / County FIPS or name." },
      trade: { type: "string", description: "職種(英語。例: carpenter, electrician, laborer)。 / Trade in English." },
      decision: { type: "string", description: "決定番号(例 CA20260001)。 / Wage determination number." },
      construction_type: { type: "string", description: "Building / Heavy / Highway / Residential。 / Construction type." },
      limit: { type: "integer", minimum: 1, maximum: 100 },
      offset: { type: "integer", minimum: 0 }
    } }
  },
  {
    name: "get_us_permits",
    title: "Get U.S. Building Permits (counts, valuation, per unit, city quartiles)",
    annotations: { title: "米国の建築許可(件数・工事額・1戸あたり・市の分位)", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "米国の建築許可を地域と年で引く: Census Building Permits Survey(州・郡・都市圏・市の棟数・戸数・工事額・1戸あたり)と、市の許可データの申告工事額の分布(件数・合計・中央値・25/75 分位・1 sqft あたり)。工事額は申請者の申告で、契約額でも見積の単価でもない。計算した値は computed:true。例: geo='Austin, TX', year='2024'。 / U.S. building permits by region and year: Census BPS buildings, units, valuation and per-unit values, plus distributions of declared valuations in city permit data (median, quartiles, per sq ft). Declared by applicants; not contract prices or quotes.",
    inputSchema: { type: "object", properties: {
      geo: { type: "string", description: "州・郡(FIPS か 'Multnomah County, OR')・都市圏(cbsa:38900)・市(Austin, TX)。無ければ全国。 / State, county, CBSA or place; national if omitted." },
      year: { type: "string", description: "年(2024)。 / Year." },
      structure: { type: "string", enum: ["1-unit", "2-units", "3-4 units", "5+ units"] },
      source: { type: "string", enum: ["all", "bps", "city"] },
      limit: { type: "integer", minimum: 1, maximum: 100 },
      offset: { type: "integer", minimum: 0 }
    } }
  },
  {
    name: "get_us_area_factor",
    title: "Get U.S. Location Cost Factors (DoD Area Cost Factor, USACE state adjustment)",
    annotations: { title: "米国の場所の係数(DoD ACF・USACE)", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "米国の場所ごとの建設費の係数を引く: 国防総省の Area Cost Factor と Sustainment ACF(軍の施設ごと、96 基準都市の平均 = 1.00)と、陸軍工兵隊 CWCCIS の州の調整係数(現行値と年ごと)。geo は州・郡・ZIP(zip:28533)・市(Cherry Point, NC)・国外の国(country:JP)。中央値は computed:true。予算用の係数で、見積の良し悪しを判定する係数ではない。 / U.S. location cost factors: DoD Area Cost Factors by installation (96 base-city average = 1.00) and USACE CWCCIS state adjustment factors; geo accepts state, county, ZIP, city or an overseas country. Budgeting factors, not a test of whether a quote is fair.",
    inputSchema: { type: "object", properties: {
      geo: { type: "string", description: "州・郡・ZIP(zip:28533)・市(Cherry Point, NC)・国外(country:JP)。 / State, county, ZIP, city or overseas country." },
      installation: { type: "string", description: "施設の名前(例: Fort Bragg)。 / Installation name." },
      include_history: { type: "boolean" },
      limit: { type: "integer", minimum: 1, maximum: 100 },
      offset: { type: "integer", minimum: 0 }
    } }
  }
];
'''

V2_CALL_BLOCK = '''  // [PATCH 2026-09-26 jccdb-obs v2] hs-jccdb-obs(v0.3)へ service binding で渡す11本。
  //   「呼べなかった」と「呼べて0件だった」を同じ値に潰さない(2026-08-20 の掟)。呼べなかったときは isError + fetch_failed:true。
  //   引数の誤り(地域名が分からない等)は isError + invalid_argument:true(fetch_failed:false)。0件は isError なしで count:0 / lookup:"absent"。
  const _JCCDB_OBS = {
    search_jccdb_items: "jccdb_search_items", get_jccdb_observations: "jccdb_observations", get_jccdb_labor_rate: "jccdb_labor_rate",
    compare_jccdb_regions: "jccdb_compare_regions", get_jccdb_work_unit_price: "jccdb_work_unit_price", get_jccdb_index_series: "jccdb_index_series",
    get_us_construction_prices: "jccdb_us_prices", get_jccdb_coverage: "jccdb_coverage",
    get_us_prevailing_wage: "jccdb_us_prevailing_wage", get_us_permits: "jccdb_us_permits", get_us_area_factor: "jccdb_us_area_factor"
  };
  if (Object.prototype.hasOwnProperty.call(_JCCDB_OBS, name)) {
    if (!env || !env.JCCDB_SVC) return failTxt({ error: "jccdb_obs_not_bound", fetch_failed: true, source_read: false, message: "JCCDB の観測の口(hs-jccdb-obs)に繋がっていない。0件ではなく、取りに行けていない。 / The JCCDB observation service is not bound. This is a failure to fetch, not an empty result." });
    let _r = null, _j = null;
    try {
      _r = await env.JCCDB_SVC.fetch("https://jccdb-obs.internal/mcp", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: _JCCDB_OBS[name], arguments: args || {} } }) });
      _j = await _r.json();
    } catch (e) {
      return failTxt({ error: "jccdb_obs_fetch_failed", fetch_failed: true, source_read: false, message: "hs-jccdb-obs への問い合わせが失敗した。0件ではない。 / The lookup failed; this is not an empty result." });
    }
    const _res = _j && _j.result;
    const _sc = _res && _res.structuredContent;
    if (!_sc) return failTxt({ error: "jccdb_obs_bad_response", fetch_failed: true, source_read: false, http_status: _r ? _r.status : null, message: "hs-jccdb-obs の返事が読めなかった。0件ではない。 / Unreadable response; this is not an empty result." });
    if (_res.isError || _sc.error) {
      return failTxt({ ..._sc, error: _sc.code || "jccdb_obs_error", message: String(_sc.error || ""), fetch_failed: _sc.fetch_failed === true, invalid_argument: _sc.invalid_argument === true, source_read: false });
    }
    return txt({ ..._sc, fetch_failed: false, next_actions: NEXT_ACTIONS });
  }
'''

V2_WR_NEW = '''    { "binding": "HEARING_SVC", "service": "hs-hearing" },
    // ★2026-09-26 JCCDB の品目・観測層 v2 の口(11本: search_jccdb_items / get_jccdb_observations / get_jccdb_labor_rate /
    //   compare_jccdb_regions / get_jccdb_work_unit_price / get_jccdb_index_series / get_us_construction_prices / get_jccdb_coverage /
    //   get_us_prevailing_wage / get_us_permits / get_us_area_factor)。
    //   hs-jccdb-obs を先に deploy してから、この行を含む hs-mcp を deploy する(逆順だと binding 先が無く deploy が落ちる)。
    { "binding": "JCCDB_SVC", "service": "hs-jccdb-obs" }
  ],'''

FORBIDDEN = [chr(0x2013), chr(0x2014), chr(0x2015)]

# 一時ディレクトリで、元の mcp.js と当てた後の mcp.js を読み込み、tools/list を叩いて比べる。
SMOKE = r'''
const [orig, patched] = await Promise.all([import(process.argv[2]), import(process.argv[3])]);
const kv = new Map();
const env = { RL_KV: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); }, delete: async (k) => kv.delete(k), list: async () => ({ keys: [] }) } };
const ctx = { waitUntil() {}, passThroughOnException() {} };
async function rpc(m, body) {
  const r = await m.default.fetch(new Request("https://mcp.horizonshield.dev/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(body) }), env, ctx);
  const t = await r.text(); return JSON.parse(t.match(/\{[\s\S]*\}/)[0]);
}
const a = (await rpc(orig, { jsonrpc: "2.0", id: 1, method: "tools/list" })).result.tools;
const b = (await rpc(patched, { jsonrpc: "2.0", id: 1, method: "tools/list" })).result.tools;
const ours = new Set(JSON.parse(process.argv[4]));
const keep = (ts) => JSON.stringify(ts.filter((t) => !ours.has(t.name)));
const c = await rpc(patched, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_jccdb_coverage", arguments: {} } });
const sc = JSON.parse(c.result.content[0].text);
console.log(JSON.stringify({ same_existing_tools: keep(a) === keep(b), names: b.map((t) => t.name).filter((n) => ours.has(n)),
  total_before: a.length, total_after: b.length, unbound_is_error: c.result.isError === true && sc.fetch_failed === true && sc.error === "jccdb_obs_not_bound" }));
'''


def detect(s):
    if V2_MARK in s:
        return "v2"
    if 'name: "search_jccdb_items"' in s:
        return "v1"
    return "fresh"


def plan(s, w, state):
    """(新しい mcp.js, 新しい wrangler.jsonc, 錨の一覧) を返す。錨が1回でなければ AssertionError。"""
    if state == "fresh":
        anchors = (("tools end", s, TOOLS_END), ("callTool", s, CALL_ANCHOR), ("not-found msg", s, MSG_OLD), ("wrangler services", w, WR_OLD))
    else:
        anchors = (("v1 tools", s, NEW_TOOLS), ("v1 call block", s, CALL_NEW), ("v1 not-found msg", s, MSG_NEW), ("v1 wrangler binding", w, WR_NEW))
    for name, text, anchor in anchors:
        n = text.count(anchor)
        assert n == 1, "錨 %s が %d 回。1回でないので止める(何も書いていない)。" % (name, n)
    if state == "fresh":
        s2 = s.replace(TOOLS_END, V2_NEW_TOOLS).replace(CALL_ANCHOR, V2_CALL_BLOCK + CALL_ANCHOR).replace(MSG_OLD, MSG_NEW)
        w2 = w.replace(WR_OLD, V2_WR_NEW)
    else:
        s2 = s.replace(NEW_TOOLS, V2_NEW_TOOLS).replace(CALL_NEW, V2_CALL_BLOCK + CALL_ANCHOR)
        w2 = w.replace(WR_NEW, V2_WR_NEW)
    return s2, w2, [a[0] for a in anchors]


def post_checks(s2, w2):
    for n in V2_NAMES:
        c = s2.count('name: "%s"' % n)
        assert c == 1, "当てた後の %s が %d 回" % (n, c)
    assert s2.count("JCCDB_SVC.fetch") == 1, "JCCDB_SVC.fetch が1回でない"
    assert s2.count(V2_MARK) == 2, "v2 の目印が2回でない"
    assert s2.count(V1_MARK) == 0, "v1 の目印が残っている(v1 の塊を置き換えきれていない)"
    assert s2.count(MSG_NEW) == 1, "案内文が1回でない"
    assert w2.count('"binding": "JCCDB_SVC"') == 1, "wrangler の JCCDB_SVC が1回でない"
    for ch in FORBIDDEN:
        assert ch not in V2_NEW_TOOLS + V2_CALL_BLOCK + V2_WR_NEW, "足す文に禁止文字 U+%04X" % ord(ch)
        assert s2.count(ch) == 0 and w2.count(ch) == 0, "当てた後のファイルに禁止文字 U+%04X" % ord(ch)


def node_checks(s, s2):
    with tempfile.TemporaryDirectory() as td:  # 検査用の写しはリポの外に置く(リポにゴミを残さない)
        a, b, sm = os.path.join(td, "orig.mjs"), os.path.join(td, "patched.mjs"), os.path.join(td, "smoke.mjs")
        open(a, "w", encoding="utf-8").write(s)
        open(b, "w", encoding="utf-8").write(s2)
        open(sm, "w", encoding="utf-8").write(SMOKE)
        r = subprocess.run(["node", "--check", b], capture_output=True, text=True)
        assert r.returncode == 0, "node --check が落ちた: " + r.stderr[:500]
        r = subprocess.run(["node", sm, "file://" + a, "file://" + b, json.dumps(V2_NAMES)], capture_output=True, text=True, cwd=td)
        assert r.returncode == 0, "読み込み検査が落ちた: " + r.stderr[-800:]
        out = json.loads(r.stdout.strip().splitlines()[-1])
    assert out["same_existing_tools"], "既存ツールの定義(tools/list)が変わっている"
    assert out["names"] == V2_NAMES, "tools/list の新ツールが揃っていない: %s" % out["names"]
    assert out["unbound_is_error"], "binding が無いときに fetch_failed を返していない"
    return out


def main():
    if len(sys.argv) < 2 or sys.argv[1].startswith("--"):
        sys.exit(__doc__)
    root = os.path.expanduser(sys.argv[1])
    dry = "--dry" in sys.argv
    mcp, wr = os.path.join(root, "src", "mcp.js"), os.path.join(root, "wrangler.jsonc")
    s = open(mcp, encoding="utf-8").read()
    w = open(wr, encoding="utf-8").read()
    state = detect(s)
    if state == "v2":
        try:
            post_checks(s, w)
        except AssertionError as e:
            sys.exit("v2 の目印はあるが形が揃っていない(手で直されたか途中で止まった): %s。何もしない。" % e)
        print("既に v2 が当たっている。何もしない。")
        return
    try:
        s2, w2, used = plan(s, w, state)
        post_checks(s2, w2)
        out = node_checks(s, s2)
    except AssertionError as e:
        sys.exit("止めた(状態 %s): %s" % (state, e))
    what = "全部(11本 + 分岐 + 案内文 + binding)" if state == "fresh" else "差分(v1 の3本と分岐を v2 に、binding の注記を v2 に)"
    summary = "状態 %s -> %s。錨 %s は各1回、node --check 緑、tools/list は既存 %d 本そのまま + 新 %d 本(合計 %d)、binding 無しは fetch_failed。" % (
        state, what, "/".join(used), out["total_before"] - (3 if state == "v1" else 0), len(V2_NAMES), out["total_after"])
    if dry:
        print("dry: " + summary + " 書いていない。")
        return
    ts = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    shutil.copy2(mcp, mcp + ".bak.%s-jccdbobs2" % ts)
    shutil.copy2(wr, wr + ".bak.%s-jccdbobs2" % ts)
    open(mcp, "w", encoding="utf-8").write(s2)
    open(wr, "w", encoding="utf-8").write(w2)
    print("書いた。" + summary + " バックアップ: mcp.js.bak.%s-jccdbobs2 / wrangler.jsonc.bak.%s-jccdbobs2" % (ts, ts))


if __name__ == "__main__":
    main()
