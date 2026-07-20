// hs-webmcp / index.js  --  HORIZON SHIELD WebMCP (KIRA) 外部=集客の窓口層
// 役割: 外部のLLM/エージェントが「施主の見積もり相談」を呼べる窓口。
//       内部 hs-mcp(本番・不可侵)へ Service Binding で橋渡しする。hs-mcp には一切触れない。
// 仕様: MCP最新準拠(2025-06-18)。tools + resources + prompts + completion + logging を実装。
//       Streamable HTTP(単一エンドポイント POST /mcp / GETは405)。stateless・CORS開放・fail-closed。
//       表向きは全店同一のKIRA(Glama仕様・名前なし)。store_idで裏個別識別+WebMCP課金ゲートのみ。
// v0.3.0: 店別計測(StatsDO: SQLite Durable Object)+ /beacon + 鍵付き /stats ダッシュボードを追加。
//         計測は fail-open(計測の失敗が本体を壊すことは無い)。入力内容・金額は記録しない。件数のみ。
// v0.4.1: /mypage・/stats を Glama Overview 準拠に(クリーンなKPIタイル + 統合Activityチャート)。診断をAI/ツール指標へ移し矛盾を除去。
// v0.4.0: ★意味の転換: 計測の主役は「加盟店に見せる貢献レポート」(/mypage、店専用リンク)。
//         Glamaが出店者に Analytics を見せるのと同じ立場を、HORIZON SHIELD が加盟店に対して取る。
//         + /px.gif(モール静的ページ用ピクセル: mall_view/mall_list/mall_click)
//         + POST /beacon の JSON一括形式(hs-hearing から agent_view/agent_hit を流し込む)
//         + /stats(運営)に店舗別の露出列と「店舗用リンク」発行を追加。

const HS_MCP = "https://hs-mcp.oga-surf-project.workers.dev";
const SITE = "https://shield.the-horizons-innovation.com";
const SELF = "https://hs-webmcp.oga-surf-project.workers.dev";

const SERVER = { name: "hs-webmcp", title: "HORIZON SHIELD WebMCP (KIRA)", version: "0.5.0" };
const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const DEFAULT_VERSION = "2025-06-18";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, MCP-Protocol-Version",
};

const INSTRUCTIONS =
  "HORIZON SHIELD の中立な建設費・見積もり窓口(KIRA)。施主の見積もりが適正かを、独立第三者の立場で一次診断する。" +
  "tools: intake_estimate(工種+金額で適正診断→EHN導線), scan_tactics(過剰請求の手口+一次ソース), draft_broadcast(注意喚起の発信下書き), orchestrate(一括)。" +
  "resources: souba(工種カテゴリ/価格レンジ)・JCCDB(オープン建設費DB)・EHN(無料の第三者チェック)を参照データとして公開。" +
  "prompts: diagnose_my_estimate / how_to_read_an_estimate。価格は検証可能な一次データのみ、断定せず確認を促す、契約は急かさない、自動投稿しない。Japan, JPY。";

// ---------------- Tools(annotations + title + outputSchema 付き) ----------------
const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
const OUT_OBJ = { type: "object", additionalProperties: true };

const TOOLS = [
  {
    name: "orchestrate",
    title: "集客→診断→発信 一括実行",
    description:
      "1回の呼び出しで HORIZON SHIELD の集客→診断→注意喚起→発信を一気通貫で回す司令塔。work(と任意の quoted_price)を渡すと、内部で intake(KIRA適正診断)・scan_tactics(検証済み手口+一次ソース)・draft_broadcast(発信下書き+被リンク)を順に実行し、結果を1つに束ねて返す。価格は検証可能な一次データのみ。発信は下書きで自動投稿しない。 / One-call orchestrator returning audit + tactics + broadcast draft. Verifiable first-party prices only. Drafts only, no auto-posting.",
    inputSchema: {
      type: "object",
      properties: {
        work: { type: "string", description: "工事名やキーワード(日本語)。例: 外壁塗装, トイレ, シロアリ" },
        quoted_price: { type: "number", description: "(任意)業者提示の金額(円)。あればKIRA適正診断も実行する。", minimum: 0 },
      },
      required: ["work"],
    },
    outputSchema: OUT_OBJ,
    annotations: { title: "集客→診断→発信 一括実行", ...RO, openWorldHint: true },
  },
  {
    name: "intake_estimate",
    title: "見積もり適正診断(KIRA)",
    description:
      "施主の建設・リフォーム見積もりを受け付け、HORIZON SHIELD KIRA(内部・中立)の適正価格診断へ橋渡しする集客窓口。工事名と業者提示額を渡すと、適正かどうかの判定と、無料の第三者チェック(EHN)への導線を返す。価格の断定はせず、確認すべき点を渡す。 / Intake desk: bridges a homeowner quote to the KIRA fair-price audit and returns the verdict plus a free third-party check (EHN) path.",
    inputSchema: {
      type: "object",
      properties: {
        work: { type: "string", description: "工事名(日本語)。例: 外壁塗装 シリコン" },
        quoted_price: { type: "number", description: "業者提示の金額(円)", minimum: 0 },
      },
      required: ["work", "quoted_price"],
    },
    outputSchema: OUT_OBJ,
    annotations: { title: "見積もり適正診断(KIRA)", ...RO, openWorldHint: false },
  },
  {
    name: "scan_tactics",
    title: "過剰請求の手口スキャン",
    description:
      "ある工事・キーワードに関する『過剰請求の手口』を、HORIZON SHIELD(大賀俊勝30年監修)の検証済みデータ(内部KIRA)から返し、一次ソース(国民生活センター/消費者庁/EHN実例ボード)の在処を添える。価格判定ではなく注意喚起。推測で新事例を断定しない。 / Returns verified overcharge tactics and points to primary sources. Awareness, not a price verdict.",
    inputSchema: {
      type: "object",
      properties: {
        work: { type: "string", description: "工事名やキーワード(日本語)。例: 外壁塗装, シロアリ, 火災保険" },
      },
      required: ["work"],
    },
    outputSchema: OUT_OBJ,
    annotations: { title: "過剰請求の手口スキャン", ...RO, openWorldHint: true },
  },
  {
    name: "draft_broadcast",
    title: "注意喚起の発信下書き",
    description:
      "ある工事の過剰請求への注意喚起を発信する下書き(note用長文・X用短文)を生成し、HORIZON SHIELDの該当解説ページ(実在URL)への被リンクを添える。価格はKIRA(検証可能SHA-256付き)の一次データのみ。推測の数字は入れない。下書きであり公開前に運営者が最終版にする(自動投稿しない)。 / Generates broadcast DRAFTS with backlinks. Verifiable first-party prices only. Draft; operator finalizes. No auto-posting.",
    inputSchema: {
      type: "object",
      properties: {
        work: { type: "string", description: "工事名やキーワード(日本語)。例: 外壁塗装, トイレ, 火災保険" },
      },
      required: ["work"],
    },
    outputSchema: OUT_OBJ,
    annotations: { title: "注意喚起の発信下書き", ...RO, openWorldHint: true },
  },
];

// ---------------- Resources(参照データ。裏でhs-mcpの読み取り専用ツールに委譲) ----------------
const ABOUT_MD =
  "# HORIZON SHIELD (KIRA)\n\n" +
  "施工業者から紹介手数料や送客報酬を受け取らない、独立した第三者の建設費・見積もり検証窓口です。" +
  "建設実務30年(大賀俊勝)監修のAI『KIRA』が、オープン建設費データベース(JCCDB, 65,729品目)に照らして見積もりの誠実性を一次診断します。" +
  "価格は検証可能な一次データのみを用い、断定せず、確認すべき点を施主にお渡しします。契約を急かすことはありません。\n\n" +
  "運営: The HORIZONs株式会社 / 監修 大賀俊勝(ORCID 0009-0000-9180-903X)。";
const EHN_MD =
  "# 見積もりハッカーニュース(EHN)\n\n" +
  "手元の見積もりを匿名で貼るだけの無料掲示板です(30秒)。KIRAが『一式』を数量・単価に分解し、" +
  "オープン建設費DBと照合して『盛られやすい所』に印をつけ、みんなの実例と並べて見せます。" +
  "出てくるのは高い/安いの断定ではなく、『どの項目を業者にどう聞くべきか』です。判断はあなた自身。\n\n" +
  SITE + "/ehn/";

const RESOURCES = [
  { uri: "horizon://about", name: "about-horizon-shield", title: "HORIZON SHIELD とは", description: "この窓口と運営(中立・第三者・紹介料なし)の説明", mimeType: "text/markdown" },
  { uri: "jccdb://dataset", name: "jccdb-dataset-info", title: "JCCDB データセット情報", description: "日本建設費オープンDB(65,729品目)のメタ・ライセンス・出典・引用", mimeType: "application/json" },
  { uri: "souba://categories", name: "souba-categories", title: "工事カテゴリ一覧", description: "相場・赤旗を整備した工種カテゴリ(61種)", mimeType: "application/json" },
  { uri: "souba://sources", name: "souba-sources", title: "相場データの出典", description: "fair-price データの出典・更新日・地域係数", mimeType: "application/json" },
  { uri: "ehn://board", name: "ehn-info", title: "見積もりハッカーニュース(EHN)", description: "匿名で見積もりを第三者チェックする無料掲示板の説明", mimeType: "text/markdown" },
];
const RESOURCE_TEMPLATES = [
  { uriTemplate: "souba://category/{query}", name: "souba-category-search", title: "工事カテゴリ検索", description: "工種名でカテゴリを部分一致検索する", mimeType: "application/json" },
  { uriTemplate: "souba://price/{work}", name: "souba-price-range", title: "相場価格レンジ", description: "工種の適正価格レンジ(min/avg/max)を返す", mimeType: "application/json" },
];

// ---------------- Prompts(ガイド付きテンプレート) ----------------
const PROMPTS = [
  {
    name: "diagnose_my_estimate",
    title: "見積もりを診断する",
    description: "手元の見積もり(工種と金額)を、KIRAの中立診断とEHN導線で読み解く手順を組み立てる。",
    arguments: [
      { name: "work", description: "工事名(例: 外壁塗装 シリコン)", required: true },
      { name: "quoted_price", description: "業者提示の金額(円)", required: false },
    ],
  },
  {
    name: "how_to_read_an_estimate",
    title: "見積書の読み方",
    description: "見積書のどこを見るべきか(一式・諸経費・期限つき値引き等)を工種に沿って解説する手順。",
    arguments: [
      { name: "work", description: "工事名(任意)", required: false },
    ],
  },
];

// ---------------- A2A エージェントカード(別プロトコル・発見の補助) ----------------
const AGENT_CARD = {
  protocol: "A2A (Agent2Agent)",
  name: "HORIZON SHIELD: Construction Estimate Auditor for Japan (KIRA)",
  provider: "The HORIZONs株式会社",
  version: SERVER.version,
  role: "集客窓口(外部エージェント/LLM向けの入口)。受けた見積もり相談を内部KIRA(hs-mcp)の適正診断へ橋渡しする。",
  skills: [
    { id: "orchestrate", note: "診断+手口+発信下書きを一気通貫で返す司令塔。価格は一次データのみ・自動投稿なし。" },
    { id: "estimate-intake", note: "施主の見積もりを受け、KIRA適正診断とEHN(無料の第三者チェック)へ橋渡し。" },
    { id: "scan-tactics", note: "工事別の過剰請求の手口(検証済み)と一次ソースの在処を返す注意喚起。" },
    { id: "draft-broadcast", note: "注意喚起の発信下書き(note/X)と解説ページへの被リンクを生成。自動投稿しない。" },
  ],
  bridges_to: {
    internal_mcp: HS_MCP,
    internal_agent_card: HS_MCP + "/.well-known/agent-card.json",
  },
  how_to_connect: "MCPクライアントは POST /mcp に JSON-RPC(initialize/tools|resources|prompts/*)。A2A対応エージェントはこのカードで窓口を発見できる。",
  site: SITE,
};

const SECURITY_TXT =
  "Contact: mailto:contact@the-horizons-innovation.com\n" +
  "Expires: 2027-07-18T00:00:00.000Z\n" +
  "Preferred-Languages: ja, en\n" +
  "Canonical: " + SELF + "/.well-known/security.txt\n" +
  "Policy: " + SITE + "/\n";

// ---------------- embed widget (served at /embed.js?store=...) ----------------
const EMBED_JS = `/* HORIZON SHIELD KIRA embed widget  (served at /embed.js?store=hs-partner-XXX)
   各加盟店サイトに <script src=".../embed.js?store=..."> 1行で載る。
   表向きは全店同一の「KIRA」。store は自分のscript URLから読み、裏でマルチテナントMCPを叩く。
   Shadow DOM でホストページのCSSと完全隔離。localStorage不使用。金額は保存しない。 */
(function () {
  if (window.__HS_KIRA_EMBED__) return;
  window.__HS_KIRA_EMBED__ = true;

  // --- self-identify: store と origin を自分のscript URLから ---
  var me = document.currentScript;
  var srcUrl = (me && me.src) || '';
  if (!srcUrl) {
    var ss = document.getElementsByTagName('script');
    for (var i = 0; i < ss.length; i++) {
      if (ss[i].src && ss[i].src.indexOf('/embed.js') > -1) { me = ss[i]; srcUrl = ss[i].src; break; }
    }
  }
  var store = '';
  var ORIGIN = 'https://hs-webmcp.oga-surf-project.workers.dev';
  try { var u = new URL(srcUrl); store = u.searchParams.get('store') || ''; ORIGIN = u.origin; } catch (e) {}
  if (me && me.getAttribute && me.getAttribute('data-store')) store = me.getAttribute('data-store');
  var ENDPOINT = ORIGIN + '/mcp?store=' + encodeURIComponent(store);
  var SITE = 'https://shield.the-horizons-innovation.com';

  // --- 軽量計測ビーコン(匿名。金額や入力内容は一切送らない。event名だけ) ---
  function ping(ev) {
    try {
      var u = ORIGIN + '/beacon?store=' + encodeURIComponent(store) + '&event=' + ev;
      if (navigator.sendBeacon) { navigator.sendBeacon(u, ''); return; }
      if (window.fetch) { fetch(u, { method: 'POST', mode: 'no-cors', keepalive: true }).catch(function () {}); }
    } catch (e) {}
  }

  function esc(s) {
    s = (s == null ? '' : String(s));
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function yen(n) { try { return '¥' + Number(n).toLocaleString(); } catch (e) { return '¥' + n; } }

  var CSS =
    '*{box-sizing:border-box}' +
    '.fab{position:fixed;right:20px;bottom:20px;z-index:2147483000;background:#f97316;color:#111;border:0;border-radius:999px;padding:14px 20px;font-weight:800;font-size:15px;cursor:pointer;box-shadow:0 8px 28px rgba(0,0,0,.4);font-family:system-ui,"Hiragino Sans",Meiryo,sans-serif}' +
    '.fab:hover{filter:brightness(1.05)}' +
    '.fab .d{display:inline-block;width:8px;height:8px;border-radius:50%;background:#111;margin-right:8px;vertical-align:middle;opacity:.65}' +
    '.panel{position:fixed;right:20px;bottom:84px;z-index:2147483000;width:370px;max-width:calc(100vw - 28px);max-height:calc(100vh - 120px);overflow:auto;background:#0f0f10;color:#e8e8ea;border:1px solid #2a2a2a;border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.55);font-family:system-ui,"Hiragino Sans",Meiryo,sans-serif;display:none;line-height:1.7}' +
    '.panel.open{display:block}' +
    '.hd{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid #222;position:sticky;top:0;background:#0f0f10}' +
    '.ttl{font-weight:800;font-size:16px;color:#fff}' +
    '.tag{font-size:11px;font-weight:700;color:#f97316;border:1px solid #f97316;border-radius:999px;padding:2px 8px;margin-left:8px;vertical-align:middle}' +
    '.x{background:0;border:0;color:#888;font-size:22px;line-height:1;cursor:pointer;padding:2px 6px}' +
    '.x:hover{color:#fff}' +
    '.bd{padding:16px 18px}' +
    '.lead{color:#b9c0cc;font-size:13px;margin:0 0 14px}' +
    'label{display:block;font-size:12px;color:#9aa4b2;margin:12px 0 5px;font-weight:700}' +
    'input{width:100%;background:#161719;border:1px solid #313235;color:#fff;border-radius:10px;padding:11px 12px;font-size:15px;outline:none}' +
    'input:focus{border-color:#f97316}' +
    '.go{width:100%;margin-top:16px;background:#f97316;color:#111;border:0;border-radius:10px;padding:13px;font-weight:800;font-size:15px;cursor:pointer}' +
    '.go:disabled{opacity:.6;cursor:default}' +
    '.err{color:#fca5a5;font-size:12px;margin-top:8px;min-height:14px}' +
    '.rc{margin-top:16px;background:#141416;border:1px solid #26262a;border-radius:12px;padding:14px 15px}' +
    '.rc.load{color:#9aa4b2;text-align:center}' +
    '.row{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}' +
    '.yp{font-size:26px;font-weight:800;color:#fff;font-variant-numeric:tabular-nums}' +
    '.badge{font-size:12px;font-weight:800;color:#111;border-radius:999px;padding:5px 12px;white-space:nowrap}' +
    '.dim{color:#9aa4b2;font-size:12px;margin-top:6px}' +
    '.adv{color:#e8e8ea;font-size:14px;margin:12px 0 0}' +
    '.note{color:#8b95a3;font-size:12px;margin:8px 0 0}' +
    '.src{color:#6b7280;font-size:11px;margin-top:12px}' +
    '.rtitle{font-weight:800;color:#fff;font-size:15px;margin-bottom:6px}' +
    '.rng{margin:14px 0 2px}' +
    '.track{position:relative;height:10px;background:#232327;border-radius:6px}' +
    '.okband{position:absolute;top:0;height:10px;background:rgba(34,197,94,.28);border-radius:6px}' +
    '.avg{position:absolute;top:-3px;width:2px;height:16px;background:#c9ced6;transform:translateX(-1px)}' +
    '.you{position:absolute;top:-4px;width:16px;height:16px;border-radius:50%;border:2px solid #0f0f10;transform:translateX(-8px)}' +
    '.lbls{display:flex;justify-content:space-between;color:#8b95a3;font-size:11px;margin-top:8px}' +
    '.ehn{display:block;text-align:center;margin-top:12px;background:#f97316;color:#111;font-weight:800;font-size:14px;border-radius:10px;padding:12px;text-decoration:none}' +
    '.ehn2{display:block;text-align:center;margin-top:8px;color:#e8e8ea;font-size:13px;text-decoration:underline}' +
    '.ft{color:#6b7280;font-size:11px;margin-top:14px;border-top:1px solid #222;padding-top:12px;line-height:1.6}';

  var HTML =
    '<button class="fab" id="fab" aria-label="見積もりを無料診断"><span class="d"></span>見積もりを無料診断</button>' +
    '<div class="panel" id="panel" role="dialog" aria-label="KIRA 見積もり診断" aria-modal="false">' +
      '<div class="hd"><div class="ttl">KIRA 見積もり診断<span class="tag">無料・匿名</span></div>' +
        '<button class="x" id="x" aria-label="閉じる">&times;</button></div>' +
      '<div class="bd">' +
        '<p class="lead">建設30年監修のAIが、業者の見積もりが適正かをオープン建設費DB(65,729品目)に照らして一次診断します。判断はあなた自身。契約は急かしません。</p>' +
        '<div id="form">' +
          '<label for="hsw">工事名</label>' +
          '<input id="hsw" placeholder="例: 外壁塗装 シリコン 30坪" autocomplete="off">' +
          '<label for="hsp">業者の見積もり金額(円)</label>' +
          '<input id="hsp" inputmode="numeric" placeholder="例: 1200000" autocomplete="off">' +
          '<button class="go" id="go">診断する</button>' +
          '<div class="err" id="ferr"></div>' +
        '</div>' +
        '<div id="result"></div>' +
        '<div class="ft">運営 The HORIZONs株式会社 / 監修 大賀俊勝(建設実務30年)。KIRAは施工業者から紹介料や送客報酬を受け取らない、独立した第三者です。</div>' +
      '</div>' +
    '</div>';

  var host = document.createElement('div');
  (document.body || document.documentElement).appendChild(host);
  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
  var box = document.createElement('div');
  box.innerHTML = '<style>' + CSS + '</style>' + HTML;
  root.appendChild(box);

  var $ = function (id) { return root.getElementById ? root.getElementById(id) : root.querySelector('#' + id); };
  var panel = root.querySelector('#panel');
  var result = root.querySelector('#result');

  // EHN導線クリックの計測(リンク先はそのまま新規タブで開く)
  result.addEventListener('click', function (e) {
    var t = e.target;
    while (t && t !== result) {
      if (t.className === 'ehn' || t.className === 'ehn2') { ping('ehn_click'); break; }
      t = t.parentNode;
    }
  });

  var opened = false;
  function open() { panel.classList.add('open'); if (!opened) { opened = true; ping('open'); } var w = root.querySelector('#hsw'); if (w) w.focus(); }
  function close() { panel.classList.remove('open'); }
  root.querySelector('#fab').addEventListener('click', function () { panel.classList.contains('open') ? close() : open(); });
  root.querySelector('#x').addEventListener('click', close);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

  function badge(level) {
    var c = level === 'ok' ? '#22c55e' : (level === 'alert' ? '#ef4444' : '#f59e0b');
    var t = level === 'ok' ? '適正レンジ内' : (level === 'alert' ? '過剰請求の懸念' : 'やや高い');
    return '<span class="badge" style="background:' + c + '">' + t + '</span>';
  }
  function rangeBar(a) {
    var fr = a.fair_range; if (!fr) return '';
    var lo = Math.min(fr.min, a.your_price), hi = Math.max(fr.max, a.your_price);
    if (hi === lo) hi = lo + 1;
    function pct(x) { return Math.max(0, Math.min(100, (x - lo) / (hi - lo) * 100)); }
    var mn = pct(fr.min), mx = pct(fr.max), av = pct(fr.avg), yo = pct(a.your_price);
    var c = a.level === 'ok' ? '#22c55e' : (a.level === 'alert' ? '#ef4444' : '#f59e0b');
    return '<div class="rng"><div class="track">' +
      '<span class="okband" style="left:' + mn + '%;width:' + (mx - mn) + '%"></span>' +
      '<span class="avg" style="left:' + av + '%"></span>' +
      '<span class="you" style="left:' + yo + '%;background:' + c + '"></span>' +
      '</div><div class="lbls"><span>' + yen(fr.min) + '</span><span>適正帯(平均 ' + yen(fr.avg) + ')</span><span>' + yen(fr.max) + '</span></div></div>';
  }
  function safeUrl(u){ u = String(u == null ? '' : u); return (u.lastIndexOf('https://',0)===0 || u.lastIndexOf('http://',0)===0) ? u : ''; }
  function ehnBlock(a) {
    var board = safeUrl((a && a.next_actions && a.next_actions.board_url) || (a && a.ehn && a.ehn.compare_cases)) || (SITE + '/ehn/');
    var submit = safeUrl((a && a.next_actions && a.next_actions.ehn_submit) || (a && a.ehn && a.ehn.ehn_submit)) || (SITE + '/hacker/submit/');
    return '<a class="ehn" href="' + esc(submit) + '" target="_blank" rel="noopener">この見積もりを匿名で第三者チェック(無料)</a>' +
      '<a class="ehn2" href="' + esc(board) + '" target="_blank" rel="noopener">みんなの実例と並べて見る</a>';
  }
  function renderAudit(a) {
    var html;
    if (a.unit_mismatch) {
      html = '<div class="rtitle">単価建ての工事です</div>' +
        '<p class="adv">' + esc(a.message) + '</p>' +
        (a.how_to_proceed ? '<p class="note">' + esc(a.how_to_proceed) + '</p>' : '') +
        ehnBlock(a) +
        (a.source ? '<div class="src">出典: ' + esc(a.source) + '</div>' : '');
    } else if (a.fair_range && a.verdict) {
      html = '<div class="row"><div class="yp">' + yen(a.your_price) + '</div>' + badge(a.level) + '</div>' +
        '<div class="dim">' + esc(a.verdict) + ' ・ 平均比 ' + esc(a.vs_avg_pct) + '</div>' +
        rangeBar(a) +
        (a.advice ? '<p class="adv">' + esc(a.advice) + '</p>' : '') +
        (a.note ? '<p class="note">' + esc(a.note) + '</p>' : '') +
        ehnBlock(a) +
        (a.source ? '<div class="src">出典: ' + esc(a.source) + '</div>' : '');
    } else {
      html = '<p class="adv">' + esc(a.advice || a.message || '診断結果を取得しました。') + '</p>' + ehnBlock(a);
    }
    result.innerHTML = '<div class="rc">' + html + '</div>';
  }
  function renderSoft(out) {
    var ehn = safeUrl(out && out.next && out.next.ehn) || (SITE + '/ehn/');
    result.innerHTML = '<div class="rc"><p class="adv">' + esc((out && out.message) || '今回は診断できませんでした。') + '</p>' +
      '<a class="ehn" href="' + esc(ehn) + '" target="_blank" rel="noopener">EHNで匿名・無料の第三者チェック</a></div>';
  }
  function renderError(err) {
    var msg = (err && err.code === -32001) ? 'この店舗ではまだ診断をご利用いただけません。' : 'ただいま混み合っています。少し時間をおいて再度お試しください。';
    result.innerHTML = '<div class="rc"><p class="adv">' + esc(msg) + '</p>' + ehnBlock(null) + '</div>';
  }

  function diagnose(work, price) {
    var go = root.querySelector('#go'); go.disabled = true;
    result.innerHTML = '<div class="rc load">KIRAが照合しています…</div>';
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'intake_estimate', arguments: { work: work, quoted_price: price } } })
    }).then(function (r) { return r.json(); }).then(function (d) {
      go.disabled = false;
      if (d && d.error) { renderError(d.error); return; }
      var out = (d && d.result && d.result.structuredContent) ? d.result.structuredContent : null;
      if (!out && d && d.result && d.result.content && d.result.content[0]) { try { out = JSON.parse(d.result.content[0].text); } catch (e) {} }
      if (!out) { renderError({}); return; }
      if (out.ok === false) { renderSoft(out); return; }
      var audit = null; try { audit = JSON.parse(out.audit); } catch (e) {}
      if (!audit) { renderSoft(out); return; }
      renderAudit(audit);
    }).catch(function () { go.disabled = false; renderError({}); });
  }

  root.querySelector('#go').addEventListener('click', function () {
    var w = (root.querySelector('#hsw').value || '').trim();
    var praw = (root.querySelector('#hsp').value || '').replace(/[^0-9]/g, '');
    var ferr = root.querySelector('#ferr');
    if (!w) { ferr.textContent = '工事名を入力してください。'; return; }
    if (!praw) { ferr.textContent = '見積もり金額(数字)を入力してください。'; return; }
    ferr.textContent = '';
    diagnose(w, parseInt(praw, 10));
  });

  // 表示計測(ウィジェットが実際に描画された時に1回)
  ping('view');
})();
`;

// ---------------- JSON-RPC helpers ----------------
function rpc(id, result) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
function rpcErr(id, code, message) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }), {
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

// ---------------- hs-mcp(本番・不可侵)への橋渡し(Service Binding, read-only) ----------------
async function callHsMcp(name, args, env) {
  const body = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args || {} } };
  const res = await env.HS_MCP_SVC.fetch(new Request(HS_MCP, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
  if (!res.ok) throw new Error("hs-mcp upstream " + res.status);
  const data = await res.json();
  const text = data && data.result && data.result.content && data.result.content[0] && data.result.content[0].text;
  if (text == null) throw new Error("hs-mcp empty");
  return text; // 生JSON文字列
}
async function callHsMcpAudit(work, quoted_price, env) {
  return callHsMcp("audit_estimate", { work, quoted_price }, env);
}

async function handleIntake(args, env) {
  const work = String(args && args.work || "").trim();
  const price = Number(args && args.quoted_price);
  if (!work || !price) return { ok: false, message: "work(工事名)と quoted_price(金額)が必要です。" };
  try {
    const auditText = await callHsMcpAudit(work, price, env);
    return {
      ok: true,
      audit: auditText,
      next: {
        ehn: SITE + "/ehn/",
        note: "判定はここまで。見積もりに不安が残れば EHN(見積もりハッカーニュース)に匿名で貼れば、過去の実例と並べて第三者の目を入れます(無料)。",
      },
      source: "HORIZON SHIELD KIRA (via hs-webmcp intake)",
    };
  } catch (e) {
    return {
      ok: false,
      message: "診断窓口が一時的に混み合っています。EHNに匿名で貼れば第三者の目を入れられます(無料)。",
      next: { ehn: SITE + "/ehn/" },
    };
  }
}

const PRIMARY_SOURCES = [
  { name: "国民生活センター(消費者ホットライン 188)", url: "https://www.kokusen.go.jp/", note: "リフォーム・点検商法の相談事例と注意喚起。最新は呼び出し側が確認。" },
  { name: "消費者庁", url: "https://www.caa.go.jp/", note: "訪問販売・クーリングオフ制度の一次情報。" },
  { name: "HORIZON SHIELD EHN(見積もり実例ボード)", url: SITE + "/ehn/", note: "匿名で実例を並べて第三者の目を入れる(無料)。" },
];

async function handleScanTactics(args, env) {
  const work = String(args && args.work || "").trim();
  if (!work) return { ok: false, message: "work(工事名/キーワード)が必要です。" };
  const live_scan = Boolean(env && env.SEARCH_API_KEY);
  let tactics = null;
  try {
    tactics = await callHsMcp("red_flag_check", { text: work + " 訪問販売 一式 今だけ値引き 火災保険ゼロ円 即日契約" }, env);
  } catch (e) { /* fail-open */ }
  return {
    ok: true, work,
    verified_tactics: tactics,
    primary_sources: PRIMARY_SOURCES,
    disclaimer: "これは注意喚起であって価格判定ではありません。具体的な金額の適正診断は intake_estimate(KIRA)を使ってください。最新の個別事例は上記一次ソースで確認してください。",
    scan_mode: live_scan ? "live(web検索有効)" : "verified-only(検証済みデータ+一次ソース住所)",
    source: "HORIZON SHIELD KIRA (大賀俊勝 実務監修) via hs-webmcp",
  };
}

const GEO_MAP = [
  { match: ["太陽光", "ソーラー", "蓄電池", "v2h", "パネル"], slug: "solar", title: "太陽光・蓄電池・V2Hの費用相場" },
  { match: ["トイレ", "便器", "水道", "タンクレス"], slug: "toilet-suidou-bottakuri", title: "トイレ交換・水道ぼったくりの見分け方" },
  { match: ["シロアリ", "防蟻", "白蟻"], slug: "shiroari-50man-sagida", title: "シロアリ駆除50万円は詐欺か" },
  { match: ["食洗機", "食器洗い", "ビルトイン"], slug: "shoksenki-koukan-bottakuri", title: "ビルトイン食洗機交換の適正費用" },
  { match: ["火災保険", "保険", "ゼロ円", "0円", "点検商法"], slug: "kaden-hoken-zero-en-sagida", title: "火災保険で0円工事は本当か" },
];
function pickGeoPages(work) {
  const w = String(work || "").toLowerCase();
  const hits = GEO_MAP.filter((g) => g.match.some((m) => w.includes(m.toLowerCase())));
  if (hits.length === 0) return [{ url: SITE + "/souba/", title: "工事別の適正相場と赤旗(HORIZON SHIELD)" }];
  return hits.map((g) => ({ url: SITE + "/souba/" + g.slug + "/", title: g.title }));
}

async function handleDraftBroadcast(args, env) {
  const work = String(args && args.work || "").trim();
  if (!work) return { ok: false, message: "work(工事名/キーワード)が必要です。" };
  let fair = null, sha = null;
  try {
    const t = await callHsMcp("verify_fair_price", { work }, env);
    const parsed = JSON.parse(t);
    if (parsed && parsed.fair_price_claim) {
      fair = parsed.fair_price_claim;
      sha = (parsed.verification && parsed.verification.claim_sha256) || null;
    }
  } catch (e) {}
  const links = pickGeoPages(work);
  const linkLine = links.map((l) => l.title + ": " + l.url).join(" / ");
  const priceLine = fair
    ? "適正の目安は " + fair.fair_min.toLocaleString() + "〜" + fair.fair_max.toLocaleString() + (fair.unit ? "円/" + fair.unit : "円") + "(平均 " + fair.fair_avg.toLocaleString() + (fair.unit ? "円/" + fair.unit : "円") + ")。出典: HORIZON SHIELD souba-db(大賀俊勝 実務監修)。"
    : "適正相場は工事内容で変わります。具体額は下記の解説と無料診断で確認できます。";
  const draft_note =
    "【" + work + "の見積もり、その金額は適正ですか】\n\n" + priceLine + "\n\n" +
    "建設業界には一式表記で内訳を隠す、今日だけの値引きで即決を迫る、火災保険でゼロ円と煽る、といった過剰請求の手口があります。緊急でも即決せず、内訳を1行ずつ求め、訪問販売なら8日間のクーリングオフが使えます。\n\n" +
    "工事別の適正相場と赤旗の見分け方はこちら。" + linkLine + "\n\n" +
    "見積もりに不安があれば匿名で第三者の目を入れられます(無料): " + SITE + "/ehn/\n\n監修: 大賀俊勝(建設実務30年) / HORIZON SHIELD";
  const draft_x =
    work + "の見積もり、その金額は適正?一式表記・即決値引き・保険でゼロ円は要注意。即決せず内訳を求めて。工事別の相場と赤旗→ " + (links[0] && links[0].url || SITE + "/souba/");
  return {
    ok: true, work, is_draft: true,
    notice: "これは下書きです。公開前に運営者(TOshi)が最終版にしてください。自動投稿しません。",
    draft_note, draft_x, backlinks: links,
    price_source: fair ? { fair_range: { min: fair.fair_min, avg: fair.fair_avg, max: fair.fair_max, unit: fair.unit || null }, claim_sha256: sha, attribution: "HORIZON SHIELD souba-db (大賀俊勝 実務監修)" } : null,
    post_targets: { note: "note.com(運営アカウントで手動投稿)", x: "x.com(運営アカウントで手動投稿)" },
    source: "HORIZON SHIELD KIRA via hs-webmcp (draft generator, no auto-post)",
  };
}

async function handleOrchestrate(args, env) {
  const work = String(args && args.work || "").trim();
  if (!work) return { ok: false, message: "work(工事名/キーワード)が必要です。" };
  const price = Number(args && args.quoted_price);
  const out = { ok: true, work, flow: "intake -> scan_tactics -> draft_broadcast", steps: {} };
  if (price) {
    try { out.steps.intake = await handleIntake({ work, quoted_price: price }, env); }
    catch (e) { out.steps.intake = { ok: false, message: "intake失敗(取れた分のみ返す)" }; }
  } else {
    out.steps.intake = { skipped: true, reason: "quoted_price未指定のため適正診断はスキップ。相場確認はscan/draftの被リンク先で。" };
  }
  try { out.steps.scan_tactics = await handleScanTactics({ work }, env); }
  catch (e) { out.steps.scan_tactics = { ok: false, message: "scan失敗(取れた分のみ返す)" }; }
  try { out.steps.draft_broadcast = await handleDraftBroadcast({ work }, env); }
  catch (e) { out.steps.draft_broadcast = { ok: false, message: "draft失敗(取れた分のみ返す)" }; }
  out.notice = "3ステップを1フローで実行。価格は検証可能な一次データのみ。発信は下書きで自動投稿しません。";
  out.source = "HORIZON SHIELD KIRA via hs-webmcp (orchestrator)";
  return out;
}

async function runTool(name, args, env) {
  if (name === "orchestrate") return handleOrchestrate(args || {}, env);
  if (name === "intake_estimate") return handleIntake(args || {}, env);
  if (name === "scan_tactics") return handleScanTactics(args || {}, env);
  if (name === "draft_broadcast") return handleDraftBroadcast(args || {}, env);
  return null;
}

// ---------------- store裏識別(Glama仕様は不変・全店同一。名前は出さず store_id で裏個別識別+課金ゲート) ----------------
const CONTRACTORS_URL = SITE + "/data/yakumo-contractors.json";
function isProvisioned(c) {
  return !!(c && c.webmcp_option === true && c.webmcp && c.webmcp.enabled === true);
}
async function loadContractors() {
  try {
    const cache = caches.default;
    let res = await cache.match(CONTRACTORS_URL);
    if (!res) {
      res = await fetch(CONTRACTORS_URL, { cf: { cacheTtl: 120, cacheEverything: true } });
      if (res && res.ok) { await cache.put(CONTRACTORS_URL, res.clone()); }
    }
    if (!res || !res.ok) return null;
    return await res.json();
  } catch (e) { return null; }
}
// 課金の第2経路: Stripe 決済で hs-billing がライブ有効化した店(git push 不要)。
// fail-closed: hs-billing が落ちる/不明なら false。手動フラグ(isProvisioned)は今まで通り優先。
const BILLING_URL = "https://hs-billing.oga-surf-project.workers.dev";
async function billingEntitled(storeId) {
  if (!storeId) return false;
  try {
    const url = BILLING_URL + "/entitlement?store=" + encodeURIComponent(storeId);
    const cache = caches.default;
    let res = await cache.match(url);
    if (!res) {
      res = await fetch(url, { cf: { cacheTtl: 60, cacheEverything: true } });
      if (res && res.ok) await cache.put(url, res.clone());
    }
    if (!res || !res.ok) return false;
    const j = await res.json();
    return !!(j && j.active === true);
  } catch (e) { return false; }
}
async function verifyStore(storeId) {
  if (!storeId) return { ok: true, store: null };
  const db = await loadContractors();
  if (!db) return { ok: false, code: -32002, message: "store registry unavailable (fail-closed)" };
  const c = (db.contractors || []).find((x) => x.store_id === storeId);
  if (!c) return { ok: false, code: -32001, message: "unknown store: " + storeId };
  if (isProvisioned(c)) return { ok: true, store: c };
  if (await billingEntitled(storeId)) return { ok: true, store: c, via: "billing" };
  return { ok: false, code: -32001, message: "store not provisioned for WebMCP (paid option required)" };
}

// ---------------- Resources 読み取り(裏でhs-mcpの読み取り専用ツールへ委譲) ----------------
function jsonContents(uri, obj) {
  return { contents: [{ uri, mimeType: "application/json", text: typeof obj === "string" ? obj : JSON.stringify(obj) }] };
}
function mdContents(uri, text) {
  return { contents: [{ uri, mimeType: "text/markdown", text }] };
}
async function readResource(uri, env) {
  if (uri === "horizon://about") return mdContents(uri, ABOUT_MD);
  if (uri === "ehn://board") return mdContents(uri, EHN_MD);
  const upstream = { "jccdb://dataset": "jccdb_dataset_info", "souba://categories": "list_cost_categories", "souba://sources": "fair_price_data_sources" };
  if (upstream[uri]) {
    try { return jsonContents(uri, await callHsMcp(upstream[uri], {}, env)); }
    catch (e) { return jsonContents(uri, { ok: false, note: "参照データを一時的に取得できません。時間をおいて再取得してください。" }); }
  }
  const m = uri.match(/^souba:\/\/(category|price)\/(.+)$/);
  if (m) {
    const kind = m[1];
    const val = decodeURIComponent(m[2]);
    try {
      if (kind === "category") return jsonContents(uri, await callHsMcp("search_cost_category", { query: val }, env));
      return jsonContents(uri, await callHsMcp("get_price_range", { work: val }, env));
    } catch (e) { return jsonContents(uri, { ok: false, note: "参照データを一時的に取得できません。" }); }
  }
  return { __notfound: true };
}

// ---------------- Prompts get ----------------
function textMsg(role, text) { return { role, content: { type: "text", text } }; }
async function getPrompt(name, args, env) {
  args = args || {};
  if (name === "diagnose_my_estimate") {
    const work = String(args.work || "").trim();
    const price = args.quoted_price;
    if (!work) return { __invalid: true };
    const priceLine = price ? ("業者提示額は " + Number(price).toLocaleString() + " 円です。") : "金額はまだ手元にありません。";
    const text =
      "次の見積もりを、独立第三者(KIRA)の立場で読み解いてください。工事: " + work + "。" + priceLine + "\n\n" +
      "手順: (1) intake_estimate ツールに work" + (price ? "と quoted_price" : "") + "を渡し、KIRAの中立診断を取得する。" +
      "(2) scan_tactics ツールで、この工事で多い過剰請求の手口と一次ソースを確認する。" +
      "(3) 断定せず、施主が業者に確認すべき項目を箇条書きで示す。" +
      "(4) 不安が残る場合は EHN(" + SITE + "/ehn/)に匿名で貼る導線を案内する。価格は検証可能な一次データのみを使い、契約を急かさないこと。";
    return { description: "見積もり診断の進め方", messages: [textMsg("user", text)] };
  }
  if (name === "how_to_read_an_estimate") {
    const work = String(args.work || "").trim();
    let base = "見積書を読むときの要点を、施主にわかる言葉で解説してください。";
    if (work) base += "対象の工事: " + work + "。";
    const text = base + "\n\n必ず触れる観点: (1)『一式』表記は数量・単価に分解して確認する。" +
      "(2)『諸経費 一式』は内訳を求める。(3)『今日契約なら値引き』等の期限つき値引きは即決の口実になりやすい。" +
      "(4)材料の型番・グレードが初回見積もりから下がっていないか(ダウングレード)。" +
      "(5)訪問販売なら8日間のクーリングオフ。参考データが要れば souba://price/" + (work || "{工種}") + " や list_cost_categories を参照。断定は避け、確認の仕方を渡すこと。";
    return { description: "見積書の読み方ガイド", messages: [textMsg("user", text)] };
  }
  return { __notfound: true };
}

// ---------------- Completion(工種名の補完) ----------------
async function categoryNames(env) {
  try {
    const raw = await callHsMcp("list_cost_categories", {}, env);
    const data = JSON.parse(raw);
    let arr = [];
    if (Array.isArray(data)) arr = data;
    else if (data && Array.isArray(data.categories)) arr = data.categories;
    else if (data && Array.isArray(data.items)) arr = data.items;
    return arr.map((x) => (typeof x === "string" ? x : (x && (x.name || x.category || x.work || x.title)))).filter(Boolean);
  } catch (e) { return []; }
}
async function completeArg(argument, env) {
  const value = String((argument && argument.value) || "");
  const names = await categoryNames(env);
  const hit = names.filter((n) => n.includes(value)).slice(0, 100);
  return { completion: { values: hit, total: hit.length, hasMore: false } };
}

// ---------------- 計測(店別カウンタ)。役割: 「HORIZON SHIELD が各加盟店に何を運んだか」を店に見せる ----------------
// Glama が出店者(俺たち)に Analytics を見せるのと同じ立場を、HORIZON SHIELD が加盟店に対して取る。
// 方針: 件数のみ記録(day x store x event x tool)。入力内容・金額・IP・UAは一切保存しない。
//       書き込みは waitUntil + fail-open。計測が落ちても本体(/mcp, /embed.js)は絶対に壊れない。
// events(店サイト側): view(ウィジェット表示) open(パネル起動) ehn_click(EHN導線) fetch(embed.js取得)
// events(モール側)  : mall_view(店ページ閲覧) mall_list(モール一覧に表示) mall_click(店ページの相談導線)
// events(AI側)      : agent_view(AI検索一覧に表示) agent_hit(AIが店詳細を照会) <- hs-hearing が /beacon(JSON) で流す
// events(内部)      : rpc(メソッド別) tool(ツール別) verdict(ok/watch/alert) denied(課金ゲート拒否)
const EV_WIDGET = ["view", "open", "ehn_click"];
const EV_PX = ["mall_view", "mall_list", "mall_click"];
const EV_FEED = ["view", "open", "ehn_click", "mall_view", "mall_list", "mall_click", "agent_view", "agent_hit"];
const PX_GIF = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), (c) => c.charCodeAt(0));

async function sha256hex(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
// 店専用リンクのトークン(STATS_KEYから決定論的に導出。保存不要。STATS_KEYを回すと全店ぶん回る)
async function mypageToken(env, storeId) {
  const h = await sha256hex("hs-mypage:" + ((env && env.STATS_KEY) || "") + ":" + storeId);
  return h.slice(0, 20);
}

function jstDay(offsetDays) {
  const t = Date.now() + 9 * 3600 * 1000 - (offsetDays ? offsetDays * 86400 * 1000 : 0);
  return new Date(t).toISOString().slice(0, 10);
}
function track(env, ctx, events) {
  try {
    if (!env || !env.STATS || !ctx || !events || events.length === 0) return;
    const clean = events.map((e) => ({
      store: String((e && e.store) || "").slice(0, 40),
      event: String((e && e.event) || "").slice(0, 24),
      tool: String((e && e.tool) || "").slice(0, 40),
    })).filter((e) => e.event);
    if (clean.length === 0) return;
    const stub = env.STATS.get(env.STATS.idFromName("v1"));
    const body = JSON.stringify({ day: jstDay(), events: clean });
    ctx.waitUntil(stub.fetch("https://stats.internal/track", {
      method: "POST", headers: { "Content-Type": "application/json" }, body,
    }).catch(() => {}));
  } catch (e) { /* fail-open: 計測は本体を壊さない */ }
}
function auditLevel(out) {
  try {
    const t = (out && out.audit) || (out && out.steps && out.steps.intake && out.steps.intake.audit);
    if (!t) return null;
    const a = typeof t === "string" ? JSON.parse(t) : t;
    const lv = a && a.level;
    return (lv === "ok" || lv === "watch" || lv === "alert") ? lv : null;
  } catch (e) { return null; }
}

export class StatsDO {
  constructor(state, env) {
    this.sql = state.storage.sql;
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS ev (" +
      "day TEXT NOT NULL, store TEXT NOT NULL, event TEXT NOT NULL, tool TEXT NOT NULL, " +
      "n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, store, event, tool))"
    );
  }
  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/track") {
        const body = await request.json();
        const day = String((body && body.day) || "");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return new Response("bad day", { status: 400 });
        const events = Array.isArray(body && body.events) ? body.events.slice(0, 20) : [];
        for (const e of events) {
          const store = String((e && e.store) || "").slice(0, 40);
          const event = String((e && e.event) || "").slice(0, 24);
          const tool = String((e && e.tool) || "").slice(0, 40);
          if (!event) continue;
          this.sql.exec(
            "INSERT INTO ev (day, store, event, tool, n) VALUES (?, ?, ?, ?, 1) " +
            "ON CONFLICT (day, store, event, tool) DO UPDATE SET n = n + 1",
            day, store, event, tool
          );
        }
        return new Response(null, { status: 204 });
      }
      if (request.method === "GET" && url.pathname === "/query") {
        const days = Math.max(1, Math.min(180, Number(url.searchParams.get("days")) || 30));
        const since = jstDay(days - 1);
        this.sql.exec("DELETE FROM ev WHERE day < ?", jstDay(400)); // 保持400日
        const rows = this.sql.exec(
          "SELECT day, store, event, tool, n FROM ev WHERE day >= ? ORDER BY day ASC", since
        ).toArray();
        return new Response(JSON.stringify({ since, days, rows }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    } catch (e) {
      return new Response("stats error", { status: 500 });
    }
  }
}

// ---------------- /stats ダッシュボード(鍵付き・noindex・サーバ側描画) ----------------
function escHtml(s) {
  s = (s == null ? "" : String(s));
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function statsAgg(rows, storeFilter) {
  const use = rows.filter((r) => {
    if (storeFilter === "__all") return true;
    if (storeFilter === "__none") return r.store === "";
    return r.store === storeFilter;
  });
  const total = {}; const byDay = {}; const tools = {}; const rpcs = {}; const verdicts = {}; const byStore = {};
  for (const r of use) {
    total[r.event] = (total[r.event] || 0) + r.n;
    if (!byDay[r.event]) byDay[r.event] = {};
    byDay[r.event][r.day] = (byDay[r.event][r.day] || 0) + r.n;
    if (r.event === "tool") tools[r.tool] = (tools[r.tool] || 0) + r.n;
    if (r.event === "rpc") rpcs[r.tool] = (rpcs[r.tool] || 0) + r.n;
    if (r.event === "verdict") verdicts[r.tool] = (verdicts[r.tool] || 0) + r.n;
  }
  for (const r of rows) {
    if (!byStore[r.store]) byStore[r.store] = {};
    byStore[r.store][r.event] = (byStore[r.store][r.event] || 0) + r.n;
  }
  return { total, byDay, tools, rpcs, verdicts, byStore };
}
// クリーンなKPIタイル(Glama Overview 準拠。タイル内にグラフは入れない。数字 + 補助1行)
function kpiTile(label, value, color, sub) {
  return '<div class="card"><div class="lbl"><span class="dot" style="background:' + color + '"></span>' + escHtml(label) + "</div>" +
    '<div class="num">' + Number(value).toLocaleString() + "</div>" +
    (sub ? '<div class="sub">' + sub + "</div>" : "") + "</div>";
}
// 統合 Activity チャート(Glama の Activity 相当)。日別の積み上げ棒 + 凡例 + 日付軸。
// series = [{ label, color, day:{'YYYY-MM-DD': n} }]。データが薄い日も軸に残す(Glama同様)。
function activityChart(dayList, series) {
  const W = 720, H = 210, padL = 8, padR = 8, padT = 10, axisH = 22;
  const plotH = H - padT - axisH;
  const n = dayList.length;
  const step = (W - padL - padR) / Math.max(1, n);
  const bw = Math.max(3, Math.min(26, step - 2)); // 2px の面ギャップ
  let max = 0;
  for (const d of dayList) {
    let s = 0; for (const se of series) s += (se.day[d] || 0);
    if (s > max) max = s;
  }
  const scale = max > 0 ? plotH / max : 0;
  let bars = "";
  for (let i = 0; i < n; i++) {
    const d = dayList[i];
    const x = padL + i * step + (step - bw) / 2;
    let yTop = padT + plotH;
    let total = 0;
    for (const se of series) {
      const v = se.day[d] || 0; total += v;
      if (v <= 0) continue;
      const h = Math.max(1.5, v * scale);
      yTop -= h;
      bars += '<rect x="' + x.toFixed(1) + '" y="' + yTop.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) +
        '" rx="2" fill="' + se.color + '"><title>' + escHtml(d) + " ・ " + escHtml(se.label) + " : " + v + "</title></rect>";
      yTop -= 2; // 面ギャップ
    }
    if (total === 0) {
      bars += '<rect x="' + x.toFixed(1) + '" y="' + (padT + plotH - 1).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="1" rx="0.5" fill="#26262a"><title>' + escHtml(d) + " : 0</title></rect>";
    }
  }
  // 日付軸ラベル(最初 / 中央 / 最後)
  function axLabel(i, anchor) {
    const d = dayList[i]; if (!d) return "";
    const x = padL + i * step + step / 2;
    return '<text x="' + x.toFixed(1) + '" y="' + (H - 6) + '" fill="#6b7280" font-size="10" text-anchor="' + anchor + '">' + escHtml(d.slice(5)) + "</text>";
  }
  const axis = axLabel(0, "start") + axLabel(Math.floor((n - 1) / 2), "middle") + axLabel(n - 1, "end");
  const svg = '<svg viewBox="0 0 ' + W + " " + H + '" width="100%" height="' + H + '" role="img" aria-label="日別アクティビティ" preserveAspectRatio="none" style="display:block">' +
    bars + axis + "</svg>";
  const legend = '<div class="legend">' + series.map((se) =>
    '<span class="lg"><span class="dot" style="background:' + se.color + '"></span>' + escHtml(se.label) + " " +
    Number(dayList.reduce((a, d) => a + (se.day[d] || 0), 0)).toLocaleString() + "</span>").join("") + "</div>";
  return '<div class="chart">' + legend + svg + "</div>";
}
// series 用: rows から (event -> {day:n}) を作る
function daySeriesFromRows(rows, dayList, matchFn) {
  const out = {};
  for (const r of rows) {
    if (!matchFn(r)) continue;
    out[r.day] = (out[r.day] || 0) + r.n;
  }
  return out;
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
async function knownStoreSet() {
  const db = await loadContractors();
  return new Set(((db && db.contractors) || []).map((c) => c.store_id));
}
async function statsPage(url, env) {
  const KEY = env && env.STATS_KEY;
  const given = url.searchParams.get("key") || "";
  if (!KEY) return new Response("stats disabled: STATS_KEY 未設定(wrangler secret put STATS_KEY で設定)", { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  if (!(await ctEqual(given, KEY))) return new Response("forbidden", { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  if (!env.STATS) return new Response("stats unavailable: STATS binding 未設定", { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });

  const days = [7, 30, 90].includes(Number(url.searchParams.get("days"))) ? Number(url.searchParams.get("days")) : 30;
  const storeFilter = url.searchParams.get("store") || "__all";
  const stub = env.STATS.get(env.STATS.idFromName("v1"));
  const res = await stub.fetch("https://stats.internal/query?days=" + days);
  if (!res.ok) return new Response("stats query failed", { status: 502, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const data = await res.json();
  const rows = data.rows || [];
  if (url.searchParams.get("format") === "json") {
    return new Response(JSON.stringify({ since: data.since, days, rows }, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
  }

  const dayList = [];
  for (let i = days - 1; i >= 0; i--) dayList.push(jstDay(i));
  const agg = statsAgg(rows, storeFilter);
  const stores = Object.keys(agg.byStore).sort();
  const C = { a: "#3b82f6", b: "#0d9488", c: "#ea580c", d: "#8b5cf6" };
  const VS = { ok: "#22c55e", watch: "#f59e0b", alert: "#ef4444" };
  const VT = { ok: "適正レンジ内", watch: "やや高い", alert: "過剰請求の懸念" };
  const mergeDay = (a, b) => { const o = {}; for (const key in (a || {})) o[key] = (o[key] || 0) + a[key]; for (const key in (b || {})) o[key] = (o[key] || 0) + b[key]; return o; };
  const actSeries = [
    { label: "AI検索表示", color: C.b, day: agg.byDay.agent_view || {} },
    { label: "AI照会・診断", color: C.c, day: mergeDay(agg.byDay.agent_hit, agg.byDay.tool) },
    { label: "モール閲覧", color: C.a, day: agg.byDay.mall_view || {} },
    { label: "自サイト表示", color: C.d, day: agg.byDay.view || {} },
  ];
  function trow(cols, tag) {
    const t = tag || "td";
    return "<tr>" + cols.map((c) => "<" + t + ">" + c + "</" + t + ">").join("") + "</tr>";
  }
  const storeOpts = ['<option value="__all"' + (storeFilter === "__all" ? " selected" : "") + ">全店(合算)</option>"]
    .concat(stores.map((s) => {
      const v = s === "" ? "__none" : s;
      const lb = s === "" ? "(直接アクセス/storeなし)" : s;
      return '<option value="' + escHtml(v) + '"' + (storeFilter === v ? " selected" : "") + ">" + escHtml(lb) + "</option>";
    })).join("");
  const daysLink = (d) => "/stats?key=" + encodeURIComponent(given) + "&days=" + d + "&store=" + encodeURIComponent(storeFilter);
  const verdictChips = ["ok", "watch", "alert"].map((k) =>
    '<span class="chip"><span class="dot" style="background:' + VS[k] + '"></span>' + VT[k] + " " + (agg.verdicts[k] || 0) + "件</span>"
  ).join("");
  const toolRows = Object.keys(agg.tools).sort((a, b) => agg.tools[b] - agg.tools[a]).map((t) => trow([escHtml(t), agg.tools[t].toLocaleString()])).join("");
  const rpcRows = Object.keys(agg.rpcs).sort((a, b) => agg.rpcs[b] - agg.rpcs[a]).map((t) => trow([escHtml(t), agg.rpcs[t].toLocaleString()])).join("");
  const exposChips = [
    ["モール店ページ閲覧", agg.total.mall_view || 0], ["モール一覧に表示", agg.total.mall_list || 0], ["店ページ相談導線", agg.total.mall_click || 0],
    ["AI検索に表示", agg.total.agent_view || 0], ["AIが店詳細を照会", agg.total.agent_hit || 0],
  ].map((x) => '<span class="chip">' + escHtml(x[0]) + " " + Number(x[1]).toLocaleString() + "</span>").join("");
  const storeRows = (await Promise.all(stores.map(async (s) => {
    const m = agg.byStore[s];
    const link = s === ""
      ? '<span style="color:#6b7280">なし</span>'
      : '<a style="color:#f97316" href="/mypage?store=' + encodeURIComponent(s) + "&k=" + encodeURIComponent(await mypageToken(env, s)) + '" target="_blank" rel="noopener">店舗用リンク</a>';
    return trow([escHtml(s === "" ? "(直接アクセス/storeなし)" : s),
      (m.mall_view || 0).toLocaleString(), (m.mall_list || 0).toLocaleString(), (m.mall_click || 0).toLocaleString(),
      (m.agent_view || 0).toLocaleString(), (m.agent_hit || 0).toLocaleString(),
      (m.view || 0).toLocaleString(), (m.open || 0).toLocaleString(),
      (m.tool || 0).toLocaleString(), (m.ehn_click || 0).toLocaleString(), (m.denied || 0).toLocaleString(),
      link]);
  }))).join("");

  const html = "<!doctype html><html lang=\"ja\"><head><meta charset=\"utf-8\">" +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex,nofollow">' +
    "<title>KIRA 計測ダッシュボード | HORIZON SHIELD</title><style>" +
    "*{box-sizing:border-box}body{margin:0;background:#0f0f10;color:#e8e8ea;font-family:system-ui,'Hiragino Sans',Meiryo,sans-serif;line-height:1.7}" +
    ".wrap{max-width:980px;margin:0 auto;padding:28px 18px 60px}" +
    "h1{font-size:20px;margin:0}h1 .tag{font-size:11px;font-weight:700;color:#f97316;border:1px solid #f97316;border-radius:999px;padding:2px 8px;margin-left:10px;vertical-align:middle}" +
    ".sub{color:#9aa4b2;font-size:12px;margin-top:6px}" +
    ".filters{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:18px 0 14px}" +
    ".filters a{color:#9aa4b2;text-decoration:none;font-size:13px;padding:6px 12px;border:1px solid #2a2a2e;border-radius:999px}" +
    ".filters a.on{color:#111;background:#f97316;border-color:#f97316;font-weight:800}" +
    "select{background:#161719;color:#fff;border:1px solid #313235;border-radius:10px;padding:8px 10px;font-size:13px}" +
    "button{background:#f97316;color:#111;border:0;border-radius:10px;padding:8px 14px;font-weight:800;font-size:13px;cursor:pointer}" +
    ".grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;margin:14px 0}" +
    ".card{background:#141416;border:1px solid #26262a;border-radius:14px;padding:14px 15px}" +
    ".lbl{color:#9aa4b2;font-size:12px;font-weight:700}.num{font-size:28px;font-weight:800;color:#fff;font-variant-numeric:tabular-nums;margin:2px 0 8px}" +
    ".dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:7px;vertical-align:baseline}" +
    ".chips{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 2px}" +
    ".chip{background:#141416;border:1px solid #26262a;border-radius:999px;padding:6px 12px;font-size:13px}" +
    ".chart{background:#141416;border:1px solid #26262a;border-radius:14px;padding:12px 14px 6px;margin:6px 0}.legend{display:flex;flex-wrap:wrap;gap:14px;margin:0 2px 8px}.lg{color:#9aa4b2;font-size:12px}" +
    "h2{font-size:14px;color:#9aa4b2;margin:26px 0 8px;font-weight:700}" +
    "table{width:100%;border-collapse:collapse;background:#141416;border:1px solid #26262a;border-radius:14px;overflow:hidden}" +
    "th,td{padding:9px 12px;font-size:13px;text-align:left;border-bottom:1px solid #202024}th{color:#9aa4b2;font-weight:700;font-size:12px}" +
    "tr:last-child td{border-bottom:0}td:nth-child(n+2),th:nth-child(n+2){text-align:right;font-variant-numeric:tabular-nums}" +
    ".ft{color:#6b7280;font-size:11px;margin-top:26px;border-top:1px solid #222;padding-top:12px}" +
    "</style></head><body><div class=\"wrap\">" +
    '<h1>KIRA 計測ダッシュボード<span class="tag">' + escHtml(String(days)) + "日間</span></h1>" +
    '<div class="sub">集計はJST日次 | 件数のみ記録(入力内容・金額・個人情報は保存しない) | ' + escHtml(data.since) + " から " + escHtml(jstDay()) + " まで</div>" +
    '<div class="filters">' +
    '<a href="' + daysLink(7) + '"' + (days === 7 ? ' class="on"' : "") + ">7日</a>" +
    '<a href="' + daysLink(30) + '"' + (days === 30 ? ' class="on"' : "") + ">30日</a>" +
    '<a href="' + daysLink(90) + '"' + (days === 90 ? ' class="on"' : "") + ">90日</a>" +
    '<form method="GET" action="/stats" style="display:flex;gap:8px;align-items:center;margin:0">' +
    '<input type="hidden" name="key" value="' + escHtml(given) + '"><input type="hidden" name="days" value="' + days + '">' +
    '<select name="store">' + storeOpts + "</select><button type=\"submit\">表示</button></form></div>" +
    '<div class="grid">' +
    kpiTile("AI検索での表示", agg.total.agent_view || 0, C.b, "AIの加盟店検索(八雲MCP)に登場") +
    kpiTile("AIの照会・診断", (agg.total.agent_hit || 0) + (agg.total.tool || 0), C.c, "照会 " + Number(agg.total.agent_hit || 0).toLocaleString() + " ・ 診断 " + Number(agg.total.tool || 0).toLocaleString()) +
    kpiTile("モール店ページ閲覧", agg.total.mall_view || 0, C.a, "一覧表示 " + Number(agg.total.mall_list || 0).toLocaleString() + " ・ 相談 " + Number(agg.total.mall_click || 0).toLocaleString()) +
    kpiTile("自サイト・ウィジェット", agg.total.view || 0, C.d, "起動 " + Number(agg.total.open || 0).toLocaleString() + " ・ EHN " + Number(agg.total.ehn_click || 0).toLocaleString()) +
    "</div>" +
    "<h2>アクティビティ(日別)</h2>" + activityChart(dayList, actSeries) +
    "<h2>診断の判定分布(" + escHtml(String(days)) + "日間)</h2><div class=\"chips\">" + verdictChips + "</div>" +
    "<h2>外への露出の内訳(モール / AIエージェント)</h2><div class=\"chips\">" + exposChips + "</div>" +
    "<h2>店舗別(全店・期間内)。「店舗用リンク」が加盟店に渡す貢献レポート</h2><table><thead>" + trow(["store", "店P閲覧", "一覧表示", "導線", "AI表示", "AI照会", "表示", "起動", "ツール", "EHN", "拒否", "貢献レポート"], "th") + "</thead><tbody>" +
    (storeRows || trow(["まだデータがありません", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "なし"])) + "</tbody></table>" +
    '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">' +
    "<div><h2>ツール別実行数</h2><table><thead>" + trow(["tool", "回"], "th") + "</thead><tbody>" + (toolRows || trow(["(なし)", "0"])) + "</tbody></table></div>" +
    "<div><h2>JSON-RPC メソッド別</h2><table><thead>" + trow(["method", "回"], "th") + "</thead><tbody>" + (rpcRows || trow(["(なし)", "0"])) + "</tbody></table></div>" +
    "</div>" +
    '<div class="ft">HORIZON SHIELD hs-webmcp v' + escHtml(SERVER.version) + " | embed.js取得(参考): " + ((agg.total.fetch || 0)).toLocaleString() + " | JSONで取得: /stats?key=...&format=json | このページは noindex。URLの key は第三者に渡さないこと。</div>" +
    "</div></body></html>";
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}

// ---------------- /mypage 加盟店向け「貢献レポート」(店専用リンク。他店の数字は一切見えない) ----------------
// これが本命。Glama が出店者に見せる Analytics の立場を、HORIZON SHIELD が加盟店(堤さん達)に対して取る。
// 「モールとAIが、あなたの店を今月これだけ世に見せた」を、店側が自分のリンクでいつでも見られる。
async function mypagePage(url, env) {
  const KEY = env && env.STATS_KEY;
  const plain = { "Content-Type": "text/plain; charset=utf-8" };
  if (!KEY) return new Response("mypage disabled: STATS_KEY 未設定", { status: 403, headers: plain });
  const store = String(url.searchParams.get("store") || "").slice(0, 40);
  const k = String(url.searchParams.get("k") || "");
  if (!store || !k) return new Response("forbidden", { status: 403, headers: plain });
  const want = await mypageToken(env, store);
  if (!(await ctEqual(k, want))) return new Response("forbidden", { status: 403, headers: plain });
  if (!env.STATS) return new Response("stats unavailable", { status: 500, headers: plain });

  const days = [7, 30, 90].includes(Number(url.searchParams.get("days"))) ? Number(url.searchParams.get("days")) : 30;
  const stub = env.STATS.get(env.STATS.idFromName("v1"));
  const res = await stub.fetch("https://stats.internal/query?days=" + days);
  if (!res.ok) return new Response("query failed", { status: 502, headers: plain });
  const data = await res.json();
  const rows = (data.rows || []).filter((r) => r.store === store);

  // 店名の解決(取れなければ store_id のまま。fail-open)
  let dispName = store, memberNo = "";
  try {
    const db = await loadContractors();
    const c = db && (db.contractors || []).find((x) => x.store_id === store);
    if (c) { dispName = c.name || store; memberNo = c.member_no || ""; }
  } catch (e) {}

  const dayList = [];
  for (let i = days - 1; i >= 0; i--) dayList.push(jstDay(i));
  const total = {}; const byDay = {}; const verdicts = {}; const intakeByDay = {};
  let intakeN = 0;
  for (const r of rows) {
    total[r.event] = (total[r.event] || 0) + r.n;
    if (!byDay[r.event]) byDay[r.event] = {};
    byDay[r.event][r.day] = (byDay[r.event][r.day] || 0) + r.n;
    if (r.event === "verdict") verdicts[r.tool] = (verdicts[r.tool] || 0) + r.n;
    if (r.event === "tool" && r.tool === "intake_estimate") { intakeN += r.n; intakeByDay[r.day] = (intakeByDay[r.day] || 0) + r.n; }
  }
  const C = { a: "#3b82f6", b: "#0d9488", c: "#ea580c", d: "#8b5cf6" };
  const VS = { ok: "#22c55e", watch: "#f59e0b", alert: "#ef4444" };
  const VT = { ok: "適正レンジ内", watch: "やや高い", alert: "過剰請求の懸念" };
  const dseries = (fn) => daySeriesFromRows(rows, dayList, fn);
  const actSeries = [
    { label: "AI検索表示", color: C.b, day: dseries((r) => r.event === "agent_view") },
    { label: "AI照会・診断", color: C.c, day: dseries((r) => r.event === "agent_hit" || r.event === "tool") },
    { label: "モール閲覧", color: C.a, day: dseries((r) => r.event === "mall_view") },
    { label: "モール相談", color: C.d, day: dseries((r) => r.event === "mall_click") },
  ];
  const verdictTotal = (verdicts.ok || 0) + (verdicts.watch || 0) + (verdicts.alert || 0);
  const hasDiag = intakeN > 0 || verdictTotal > 0;
  const hasWidget = (total.view || 0) + (total.open || 0) + (total.ehn_click || 0) > 0;
  const dl = (d) => "/mypage?store=" + encodeURIComponent(store) + "&k=" + encodeURIComponent(k) + "&days=" + d;
  const verdictChips = ["ok", "watch", "alert"].map((key) =>
    '<span class="chip"><span class="dot" style="background:' + VS[key] + '"></span>' + VT[key] + " " + (verdicts[key] || 0) + "件</span>"
  ).join("");

  const html = "<!doctype html><html lang=\"ja\"><head><meta charset=\"utf-8\">" +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex,nofollow">' +
    "<title>貢献レポート | " + escHtml(dispName) + " | HORIZON SHIELD</title><style>" +
    "*{box-sizing:border-box}body{margin:0;background:#0f0f10;color:#e8e8ea;font-family:system-ui,'Hiragino Sans',Meiryo,sans-serif;line-height:1.7}" +
    ".wrap{max-width:860px;margin:0 auto;padding:28px 18px 60px}" +
    ".brand{font-size:12px;font-weight:800;color:#f97316;letter-spacing:.08em}" +
    "h1{font-size:22px;margin:6px 0 0}h1 .no{font-size:11px;font-weight:700;color:#f97316;border:1px solid #f97316;border-radius:999px;padding:2px 8px;margin-left:10px;vertical-align:middle}" +
    ".sub{color:#9aa4b2;font-size:12px;margin-top:6px}" +
    ".filters{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:18px 0 6px}" +
    ".filters a{color:#9aa4b2;text-decoration:none;font-size:13px;padding:6px 12px;border:1px solid #2a2a2e;border-radius:999px}" +
    ".filters a.on{color:#111;background:#f97316;border-color:#f97316;font-weight:800}" +
    ".grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin:12px 0}" +
    ".card{background:#141416;border:1px solid #26262a;border-radius:14px;padding:14px 15px}" +
    ".lbl{color:#9aa4b2;font-size:12px;font-weight:700}.num{font-size:28px;font-weight:800;color:#fff;font-variant-numeric:tabular-nums;margin:2px 0 8px}" +
    ".sub2,.sub{color:#8b95a3;font-size:11px}.card .sub{margin:0 0 8px}" +
    ".dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:7px;vertical-align:baseline}" +
    ".chips{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 2px}" +
    ".chip{background:#141416;border:1px solid #26262a;border-radius:999px;padding:6px 12px;font-size:13px}" +
    ".chart{background:#141416;border:1px solid #26262a;border-radius:14px;padding:12px 14px 6px;margin:6px 0}.legend{display:flex;flex-wrap:wrap;gap:14px;margin:0 2px 8px}.lg{color:#9aa4b2;font-size:12px}" +
    "h2{font-size:14px;color:#e8e8ea;margin:26px 0 4px;font-weight:800;border-left:3px solid #f97316;padding-left:10px}" +
    ".h2s{color:#8b95a3;font-size:12px;margin:0 0 8px;padding-left:13px}" +
    ".note{background:#141416;border:1px solid #26262a;border-radius:14px;padding:14px 16px;color:#9aa4b2;font-size:12px;margin-top:26px;line-height:1.9}" +
    ".ft{color:#6b7280;font-size:11px;margin-top:22px;border-top:1px solid #222;padding-top:12px}" +
    ".ft a{color:#9aa4b2}" +
    "</style></head><body><div class=\"wrap\">" +
    '<div class="brand">HORIZON SHIELD | Yakumo モール</div>' +
    "<h1>" + escHtml(dispName) + (memberNo ? '<span class="no">加盟 ' + escHtml(memberNo) + "</span>" : "") + "</h1>" +
    '<div class="sub">貢献レポート(あなたの店専用) | 集計はJST日次 | ' + escHtml(data.since) + " から " + escHtml(jstDay()) + " まで</div>" +
    '<div class="filters">' +
    '<a href="' + dl(7) + '"' + (days === 7 ? ' class="on"' : "") + ">7日</a>" +
    '<a href="' + dl(30) + '"' + (days === 30 ? ' class="on"' : "") + ">30日</a>" +
    '<a href="' + dl(90) + '"' + (days === 90 ? ' class="on"' : "") + ">90日</a></div>" +
    "<h2>HORIZON SHIELD があなたの店を世に見せた回数</h2>" +
    '<p class="h2s">モール(人が見る面)と、AIエージェント(ChatGPT / Claude 等が見る面)の、両方で数えています。</p>' +
    '<div class="grid">' +
    kpiTile("AI検索での表示", total.agent_view || 0, C.b, "AIの加盟店検索(八雲MCP)に登場") +
    kpiTile("AIの照会・診断", (total.agent_hit || 0) + (total.tool || 0), C.c, "照会 " + Number(total.agent_hit || 0).toLocaleString() + " ・ 診断 " + Number(intakeN).toLocaleString()) +
    kpiTile("モール店ページ閲覧", total.mall_view || 0, C.a, "モール一覧に表示 " + Number(total.mall_list || 0).toLocaleString() + " 回") +
    kpiTile("モールからの相談", total.mall_click || 0, C.d, "施主が第三者チェックへ進んだ数") +
    "</div>" +
    "<h2>日別のアクティビティ</h2>" +
    '<p class="h2s">HORIZON SHIELD があなたの店を、日ごとにどれだけ世へ運んだか。</p>' +
    activityChart(dayList, actSeries) +
    (hasDiag ? ("<h2>AI診断の判定内訳</h2>" +
      '<p class="h2s">AIがあなたの店に関して見積もりを診断したとき、その結果の内訳です。</p>' +
      '<div class="chips">' + verdictChips + "</div>") : "") +
    (hasWidget ? ("<h2>あなたのサイトでの KIRA ウィジェット</h2>" +
      '<p class="h2s">あなたのサイトに設置した KIRA が、訪問者にどれだけ働いたか(未設置の店には表示されません)。</p>' +
      '<div class="grid">' +
      kpiTile("ウィジェット表示", total.view || 0, C.a, "実描画ベース") +
      kpiTile("パネル起動", total.open || 0, C.b, "ページ毎ユニーク") +
      kpiTile("EHN第三者チェック", total.ehn_click || 0, C.d, "匿名の無料チェックへの導線") +
      "</div>") : "") +
    '<div class="note">この数字について: 計測は件数のみです。施主の入力内容・金額・個人情報は記録していません。' +
    "このリンクはあなたの店専用です(他店の数字は見えません)。リンクの取り扱いにはご注意ください。" +
    "KIRA は施工業者から紹介料や送客報酬を受け取らない、独立した第三者です。</div>" +
    '<div class="ft">運営 The HORIZONs株式会社 | <a href="' + SITE + '/yakumo/" target="_blank" rel="noopener">Yakumo モール</a> | HORIZON SHIELD hs-webmcp v' + escHtml(SERVER.version) + "</div>" +
    "</div></body></html>";
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}

// ---------------- HTTP + JSON-RPC dispatch ----------------
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    // 計測ビーコン。query形式(embedウィジェット発)と JSON一括形式(hs-hearing 等のサーバ発)。常に204。
    if (method === "POST" && path === "/beacon") {
      // M7: 未知storeの水増し / KV肥大を防ぐ。store は空(匿名)か既知登録のみ計上。
      const known = await knownStoreSet();
      const okStore = (s) => !s || known.has(s);
      const evq = String(url.searchParams.get("event") || "");
      if (evq) {
        const st = String(url.searchParams.get("store") || "").slice(0, 40);
        if (EV_FEED.includes(evq) && okStore(st)) {
          track(env, ctx, [{ store: st, event: evq, tool: "" }]);
        }
      } else {
        try {
          const body = await request.json();
          const evs = (Array.isArray(body && body.events) ? body.events : []).slice(0, 20)
            .map((e) => ({ store: String((e && e.store) || "").slice(0, 40), event: String((e && e.event) || ""), tool: "" }))
            .filter((e) => EV_FEED.includes(e.event) && okStore(e.store));
          track(env, ctx, evs);
        } catch (e) { /* 計上できない形式は黙って捨てる(fail-open) */ }
      }
      return new Response(null, { status: 204, headers: CORS });
    }

    // GET: discovery/info(MCPエンドポイントは405)
    if (method === "GET") {
      if (path === "/.well-known/agent-card.json")
        return new Response(JSON.stringify(AGENT_CARD, null, 2), { headers: { "Content-Type": "application/json", ...CORS } });
      if (path === "/.well-known/security.txt")
        return new Response(SECURITY_TXT, { headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS } });
      if (path === "/.well-known/glama.json")
        return new Response(JSON.stringify({ "$schema": "https://glama.ai/mcp/schemas/connector.json", maintainers: [{ email: "ogasurfproject@gmail.com" }] }, null, 2), { headers: { "Content-Type": "application/json", ...CORS } });
      if (path === "/embed.js") {
        track(env, ctx, [{ store: url.searchParams.get("store") || "", event: "fetch", tool: "" }]);
        return new Response(EMBED_JS, { headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=300", ...CORS } });
      }
      if (path === "/stats") return statsPage(url, env);
      if (path === "/mypage") return mypagePage(url, env);
      // モール静的ページ用の計測ピクセル(JS不要。キャッシュ禁止で毎回カウント)
      if (path === "/px.gif") {
        const ev = String(url.searchParams.get("event") || "");
        if (EV_PX.includes(ev)) {
          track(env, ctx, [{ store: url.searchParams.get("store") || "", event: ev, tool: "" }]);
        }
        return new Response(PX_GIF, { headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, private", ...CORS } });
      }
      if (path === "/mcp")
        return new Response("Method Not Allowed. Use POST for JSON-RPC.", { status: 405, headers: { Allow: "POST, OPTIONS", ...CORS } });
      // 人間向け情報(ルート等)。MCPエンドポイントではない。
      return new Response(JSON.stringify({
        name: SERVER.name, title: SERVER.title, version: SERVER.version,
        role: "HORIZON SHIELD WebMCP 集客窓口(外部エージェント向け)",
        mcp_endpoint: SELF + "/mcp", transport: "streamable-http (POST /mcp)",
        auth: "none (public read-only desk)",
        tools: TOOLS.map((t) => t.name),
        resources: RESOURCES.map((r) => r.uri),
        prompts: PROMPTS.map((p) => p.name),
        embed: SELF + "/embed.js?store=<store_id>",
        bridges_to: HS_MCP, site: SITE,
      }, null, 2), { headers: { "Content-Type": "application/json", ...CORS } });
    }

    // DELETE(セッション終了は無し=stateless)
    if (method === "DELETE") {
      if (path === "/mcp") return new Response("Method Not Allowed (stateless server, no session to delete).", { status: 405, headers: { Allow: "POST, OPTIONS", ...CORS } });
      return new Response("Method Not Allowed", { status: 405, headers: CORS });
    }

    if (method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: CORS });

    // MCP-Protocol-Version ヘッダ: 提示があり未対応なら400
    const pvHeader = request.headers.get("MCP-Protocol-Version");
    if (pvHeader && !SUPPORTED_VERSIONS.includes(pvHeader))
      return new Response("Unsupported MCP-Protocol-Version: " + pvHeader, { status: 400, headers: CORS });

    let msg;
    try { msg = await request.json(); }
    catch { return rpcErr(null, -32700, "Parse error"); }

    // 通知/レスポンスは 202 空(仕様)
    const hasId = msg && Object.prototype.hasOwnProperty.call(msg, "id") && msg.id !== undefined && msg.id !== null;
    const isResponse = msg && (Object.prototype.hasOwnProperty.call(msg, "result") || Object.prototype.hasOwnProperty.call(msg, "error")) && !msg.method;
    const isNotification = msg && msg.method && !hasId;
    if (isResponse || isNotification) return new Response(null, { status: 202, headers: CORS });

    const { id, method: rpcMethod, params } = msg || {};

    // メソッド別の軽量計測(件数のみ)
    const storeQS = url.searchParams.get("store") || "";
    track(env, ctx, [{ store: storeQS, event: "rpc", tool: String(rpcMethod || "unknown") }]);

    if (rpcMethod === "initialize") {
      const req = params && params.protocolVersion;
      const negotiated = SUPPORTED_VERSIONS.includes(req) ? req : DEFAULT_VERSION;
      return rpc(id, {
        protocolVersion: negotiated,
        capabilities: {
          tools: { listChanged: false },
          resources: { listChanged: false, subscribe: false },
          prompts: { listChanged: false },
          completions: {},
          logging: {},
        },
        serverInfo: SERVER,
        instructions: INSTRUCTIONS,
      });
    }
    if (rpcMethod === "ping") return rpc(id, {});
    if (rpcMethod === "logging/setLevel") return rpc(id, {});

    if (rpcMethod === "tools/list") return rpc(id, { tools: TOOLS });
    if (rpcMethod === "resources/list") return rpc(id, { resources: RESOURCES });
    if (rpcMethod === "resources/templates/list") return rpc(id, { resourceTemplates: RESOURCE_TEMPLATES });
    if (rpcMethod === "prompts/list") return rpc(id, { prompts: PROMPTS });

    if (rpcMethod === "resources/read") {
      const uri = params && params.uri;
      if (!uri) return rpcErr(id, -32602, "params.uri required");
      const r = await readResource(String(uri), env);
      if (r && r.__notfound) return rpcErr(id, -32002, "Resource not found: " + uri);
      return rpc(id, r);
    }

    if (rpcMethod === "prompts/get") {
      const name = params && params.name;
      if (!name) return rpcErr(id, -32602, "params.name required");
      const p = await getPrompt(name, (params && params.arguments) || {}, env);
      if (p && p.__notfound) return rpcErr(id, -32602, "Unknown prompt: " + name);
      if (p && p.__invalid) return rpcErr(id, -32602, "prompt requires argument: work");
      return rpc(id, p);
    }

    if (rpcMethod === "completion/complete") {
      const argument = params && params.argument;
      if (!argument || !argument.name) return rpcErr(id, -32602, "params.argument required");
      return rpc(id, await completeArg(argument, env));
    }

    if (rpcMethod === "tools/call") {
      // 裏でstoreを検証(表のツール仕様は不変)。未契約storeはここでfail-closed。
      const storeId = url.searchParams.get("store");
      const gate = await verifyStore(storeId);
      if (!gate.ok) {
        track(env, ctx, [{ store: storeId || "", event: "denied", tool: "" }]);
        return rpcErr(id, gate.code, gate.message);
      }
      const tenant = gate.store ? { store_id: gate.store.store_id, member_no: gate.store.member_no } : null;
      const name = params && params.name;
      const out = await runTool(name, (params && params.arguments) || {}, env);
      if (out === null) return rpcErr(id, -32602, "Unknown tool: " + name);
      if (tenant) out._tenant = tenant;
      const tev = [{ store: storeId || "", event: "tool", tool: String(name || "") }];
      const lv = auditLevel(out);
      if (lv) tev.push({ store: storeId || "", event: "verdict", tool: lv });
      track(env, ctx, tev);
      return rpc(id, { content: [{ type: "text", text: JSON.stringify(out) }], structuredContent: out });
    }

    return rpcErr(id, -32601, "Method not found: " + rpcMethod);
  },
};
