// hs-webmcp / index.js  --  HORIZON SHIELD WebMCP (KIRA) 外部=集客の窓口層
// 役割: 外部のLLM/エージェントが「施主の見積もり相談」を呼べる窓口。
//       内部 hs-mcp(本番・不可侵)へ Service Binding で橋渡しする。hs-mcp には一切触れない。
// 仕様: MCP最新準拠(2025-06-18)。tools + resources + prompts + completion + logging を実装。
//       Streamable HTTP(単一エンドポイント POST /mcp / GETは405)。stateless・CORS開放・fail-closed。
//       表向きは全店同一のKIRA(Glama仕様・名前なし)。store_idで裏個別識別+WebMCP課金ゲートのみ。
// v0.2.0

const HS_MCP = "https://hs-mcp.oga-surf-project.workers.dev";
const SITE = "https://shield.the-horizons-innovation.com";
const SELF = "https://hs-webmcp.oga-surf-project.workers.dev";

const SERVER = { name: "hs-webmcp", title: "HORIZON SHIELD WebMCP (KIRA)", version: "0.2.0" };
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
  "運営: The HORIZ音s株式会社 / 監修 大賀俊勝(ORCID 0009-0000-9180-903X)。";
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
  name: "HORIZON SHIELD WebMCP Intake",
  provider: "The HORIZ音s株式会社",
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
        '<div class="ft">運営 The HORIZ音s株式会社 / 監修 大賀俊勝(建設実務30年)。KIRAは施工業者から紹介料や送客報酬を受け取らない、独立した第三者です。</div>' +
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

  function open() { panel.classList.add('open'); var w = root.querySelector('#hsw'); if (w) w.focus(); }
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
  function ehnBlock(a) {
    var board = (a && a.next_actions && a.next_actions.board_url) || (a && a.ehn && a.ehn.compare_cases) || (SITE + '/ehn/');
    var submit = (a && a.next_actions && a.next_actions.ehn_submit) || (a && a.ehn && a.ehn.ehn_submit) || (SITE + '/hacker/submit/');
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
    var ehn = (out && out.next && out.next.ehn) || (SITE + '/ehn/');
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
async function verifyStore(storeId) {
  if (!storeId) return { ok: true, store: null };
  const db = await loadContractors();
  if (!db) return { ok: false, code: -32002, message: "store registry unavailable (fail-closed)" };
  const c = (db.contractors || []).find((x) => x.store_id === storeId);
  if (!c) return { ok: false, code: -32001, message: "unknown store: " + storeId };
  if (!isProvisioned(c)) return { ok: false, code: -32001, message: "store not provisioned for WebMCP (paid option required)" };
  return { ok: true, store: c };
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

// ---------------- HTTP + JSON-RPC dispatch ----------------
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    // GET: discovery/info(MCPエンドポイントは405)
    if (method === "GET") {
      if (path === "/.well-known/agent-card.json")
        return new Response(JSON.stringify(AGENT_CARD, null, 2), { headers: { "Content-Type": "application/json", ...CORS } });
      if (path === "/.well-known/security.txt")
        return new Response(SECURITY_TXT, { headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS } });
      if (path === "/.well-known/glama.json")
        return new Response(JSON.stringify({ "$schema": "https://glama.ai/mcp/schemas/connector.json", maintainers: [{ email: "ogasurfproject@gmail.com" }] }, null, 2), { headers: { "Content-Type": "application/json", ...CORS } });
      if (path === "/embed.js")
        return new Response(EMBED_JS, { headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=300", ...CORS } });
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
      if (!gate.ok) return rpcErr(id, gate.code, gate.message);
      const tenant = gate.store ? { store_id: gate.store.store_id, member_no: gate.store.member_no } : null;
      const name = params && params.name;
      const out = await runTool(name, (params && params.arguments) || {}, env);
      if (out === null) return rpcErr(id, -32602, "Unknown tool: " + name);
      if (tenant) out._tenant = tenant;
      return rpc(id, { content: [{ type: "text", text: JSON.stringify(out) }], structuredContent: out });
    }

    return rpcErr(id, -32601, "Method not found: " + rpcMethod);
  },
};
