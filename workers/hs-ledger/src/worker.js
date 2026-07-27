// hs-ledger — JIDEC public verification ledger (HORIZON SHIELD)
// Serves per-audit PTKA claims and their OpenTimestamps (Bitcoin) proofs.
//   Public reads : GET /ledger, GET /ledger/{n}, GET /ledger/{n}/ots
//   Authed writes: POST /ledger/append, GET /ledger/pending, POST /ledger/{n}/ots  (header X-Ledger-Key == env.LEDGER_ADMIN_TOKEN)
// Storage: KV binding LEDGER. Stamping is done off-Worker by the GitHub Actions ots-CLI runner.

const enc = new TextEncoder();

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type,x-ledger-key" };
const json = (o, status = 200) => new Response(JSON.stringify(o, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8", ...CORS } });

async function ctEq(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const ha = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(a)));
  const hb = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(b)));
  let o = 0;
  for (let i = 0; i < ha.length; i++) o |= ha[i] ^ hb[i];
  return o === 0;
}
const auth = async (request, env) => !!env.LEDGER_ADMIN_TOKEN && (await ctEq(request.headers.get("x-ledger-key") || "", env.LEDGER_ADMIN_TOKEN));
const isHex64 = (s) => typeof s === "string" && /^[0-9a-f]{64}$/i.test(s);
async function sha256hex(s) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const getEntry = async (env, n) => { const r = await env.LEDGER.get(`entry:${n}`); return r ? JSON.parse(r) : null; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// --- v1 canonical claim schema (per SPEC_HASH_INDEPENDENCE_v1.md, anchored as entry #2).
// Following Pang-jo Chun's 2026-07-25 critique: the Bitcoin-anchored hash MUST commit to
// (input, reference bundle content SHA, algorithm commit, thresholds, result, PDF)
// simultaneously — not just to the estimate JSON or to a concatenation of upstream params.
// v0 records (entries created before the fix) are still readable but flagged as v0.
const V1_REQUIRED = ["schema","issued_at","work_id","input_sha256","reference_bundle_sha256","reference_bundle_version","algorithm_commit","algorithm_url","thresholds_sha256","result_sha256","pdf_sha256","verifier_recipe_url"];
function parseClaimSchema(record_canonical) {
  try {
    const j = JSON.parse(record_canonical);
    if (j && j.schema === "jidec-claim-v1") {
      const missing = V1_REQUIRED.filter((k) => !(k in j));
      if (missing.length) return { schema: "invalid-v1", missing };
      // shape checks: SHA fields must be 64 hex
      const shaFields = ["input_sha256","reference_bundle_sha256","thresholds_sha256","result_sha256","pdf_sha256"];
      for (const f of shaFields) if (!isHex64(j[f])) return { schema: "invalid-v1", bad_field: f };
      if (!/^[0-9a-f]{40}$/i.test(j.algorithm_commit)) return { schema: "invalid-v1", bad_field: "algorithm_commit" };
      return { schema: "v1", claim: j };
    }
    return { schema: "v0" };
  } catch {
    return { schema: "v0-plain" };
  }
}

// --- jidec-path-v1 (per JIDEC_PATH_SPEC_v1.md, anchored as entry #5). A path is a
// content-addressed verification walk. These server-side endpoints (Phase 3) resolve,
// view, query, and re-walk paths. All reads are public; replay only re-fetches this
// project's own workers.dev hosts (allowlist below) so it cannot be turned into an
// open fetch proxy.
function asPathV1(record_canonical) {
  try {
    const j = JSON.parse(record_canonical);
    if (j && j.schema === "jidec-path-v1" && Array.isArray(j.nodes)) return j;
  } catch {}
  return null;
}
async function sha256hexBuf(buf) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", buf))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function pathCard(e, obj, origin) {
  return {
    entry: e.n,
    path_id: e.claim_sha256,
    cite_as: `jidec:path:${e.claim_sha256}`,
    bitcoin: e.ots_status === "confirmed" ? { status: "confirmed", block: e.bitcoin_block, block_time: e.block_time } : { status: e.ots_status || "none", block: null },
    purpose: obj.purpose,
    walked_at: obj.walked_at,
    verdict: obj.verdict,
    assertions: (obj.assertions || []).map((a) => ({ claim: a.claim, result: a.result })),
    ledger_url: `${origin}/ledger/${e.n}`,
    raw_url: `${origin}/ledger/${e.n}?format=raw`,
    replay_url: `${origin}/paths/${e.claim_sha256}/replay`,
  };
}

// --- Age-based pending status. Per Federico's "Reversal Test": a fresh pending
// and a stale one are genuinely different facts, and collapsing them into one
// badge is how a real anchor ends up looking like a stalled one. Purely derived
// at read time — nothing stored is changed, no write path is touched.
// Threshold is env.PENDING_STALE_HOURS (string) or the default below. ---
const STALE_HOURS_DEFAULT = 6;
function pendingView(e, env) {
  if (!e || e.ots_status === "confirmed") return null;
  const since = e.stamped_at || e.created_at; // pending since submission, else since recorded
  const t = since ? Date.parse(since) : NaN;
  if (!Number.isFinite(t)) return null;
  const ms = Date.now() - t;
  const hours = ms > 0 ? Math.floor(ms / 3600000) : 0;
  const staleAfter = Number((env && env.PENDING_STALE_HOURS) || STALE_HOURS_DEFAULT) || STALE_HOURS_DEFAULT;
  return { stage: hours >= staleAfter ? "stale" : "fresh", hours, stale_after: staleAfter };
}
const ageText = (pv) => (pv ? (pv.hours >= 1 ? `${pv.hours}h` : "<1h") : "");
function statusLabel(e, pv) {
  const s = e.ots_status || "unstamped";
  if (s === "confirmed") return `Bitcoin-anchored — block ${e.bitcoin_block}${e.block_time ? " (" + e.block_time + ")" : ""}`;
  const age = ageText(pv);
  if (s === "pending")
    return pv && pv.stage === "stale"
      ? `OpenTimestamps submitted — confirmation delayed, longer than expected (${age})`
      : `OpenTimestamps submitted — awaiting Bitcoin confirmation (${age}, normal)`;
  return pv && pv.stage === "stale" ? `recorded — stamping overdue (${age})` : "recorded — awaiting stamping";
}

function receiptHtml(e, origin, env) {
  const s = e.ots_status || "unstamped";
  const pv = pendingView(e, env);
  const label = statusLabel(e, pv);
  const badgeClass = s === "confirmed" ? "confirmed" : pv && pv.stage === "stale" ? "stale" : s === "pending" ? "pending" : "unstamped";
  const staleNote = pv && pv.stage === "stale"
    ? `<div class="sub" style="margin-top:.5rem">Pending longer than the usual window. The submission is real and public; the delay is on the calendar and Bitcoin side, not a failure. It upgrades automatically when the anchor lands.</div>`
    : "";
  const ots = `${origin}/ledger/${e.n}/ots`;
  const sch = e.schema || parseClaimSchema(e.record_canonical).schema;
  const schBadge = sch === "v1"
    ? `<span class="badge v1">schema v1 · independently verifiable</span>`
    : `<span class="badge v0">schema v0 · concept-proof (see SPEC v1)</span>`;
  const verifyLink = sch === "v1"
    ? `<div class="card"><div class="k">Machine-readable verification recipe</div><div class="v"><a href="${origin}/verify/${e.n}">${origin}/verify/${e.n}</a></div><div class="sub" style="margin-top:.4rem">Lists every artifact a third party must fetch and hash to independently reproduce this audit — no trust in HORIZON SHIELD required.</div></div>`
    : `<div class="card"><div class="k">Schema note</div><div class="sub">This entry uses the v0 schema (only the estimate JSON is hashed). Independent verification per SPEC v1 §3 is available on entries #2 and later. This entry remains a valid timestamp proof for its content at the recorded time.</div></div>`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>JIDEC Ledger #${e.n} — HORIZON SHIELD</title><style>
body{font-family:-apple-system,system-ui,sans-serif;background:#0a1628;color:#e8eef5;margin:0;padding:2rem 1.2rem;line-height:1.6}
.w{max-width:820px;margin:0 auto}h1{color:#c9a84c;font-size:1.25rem;margin:0 0 .2rem}
.sub{color:#94a3b8;font-size:.85rem;margin-bottom:1.5rem}
.card{background:#112240;border:1px solid #24344d;border-radius:10px;padding:1.1rem 1.2rem;margin-bottom:1rem}
.k{color:#94a3b8;font-size:.72rem;text-transform:uppercase;letter-spacing:.05em}.v{font-size:.95rem;word-break:break-all}
code{background:#0a1628;border:1px solid #24344d;border-radius:6px;padding:.15rem .4rem;font-size:.82rem;color:#e8c87a}
pre{background:#0a1628;border:1px solid #24344d;border-radius:6px;padding:.8rem;overflow:auto;white-space:pre-wrap;font-size:.8rem;color:#e8c87a}
.badge{display:inline-block;padding:.25rem .6rem;border-radius:6px;font-size:.8rem;font-weight:700}
.confirmed{background:#16391f;color:#4ade80;border:1px solid #2f7d43}.pending{background:#3a3416;color:#e8c87a;border:1px solid #7d6a2f}
.stale{background:#3a1f16;color:#f0a882;border:1px solid #7d452f}
.unstamped{background:#2a2f3a;color:#94a3b8;border:1px solid #3a4557}
.v1{background:#16292e;color:#7ecfe0;border:1px solid #2f6a7d;margin-left:.6rem}
.v0{background:#2a2f3a;color:#94a3b8;border:1px solid #3a4557;margin-left:.6rem}
a{color:#7ab8e8}</style></head><body><div class="w">
<h1>JIDEC Verification Ledger — Entry #${e.n}</h1>
<div class="sub">HORIZON SHIELD · Pre-Transaction Knowledge Anchoring (PTKA) · anchored to Bitcoin via OpenTimestamps</div>
<div class="card"><div class="k">Status</div><div class="v"><span class="badge ${badgeClass}">${label}</span>${schBadge}</div>${staleNote}</div>
${verifyLink}
<div class="card"><div class="k">Claim SHA-256</div><div class="v"><code>${e.claim_sha256}</code></div>
${e.work ? `<div class="k" style="margin-top:.8rem">Work</div><div class="v">${esc(e.work)}</div>` : ""}
<div class="k" style="margin-top:.8rem">Recorded</div><div class="v">${e.created_at}</div></div>
<div class="card"><div class="k">Signed record — the exact bytes this hash commits to</div><pre>${esc(e.record_canonical || "")}</pre></div>
<div class="card"><div class="k">OpenTimestamps proof</div><div class="v"><a href="${ots}">${ots}</a> ${s === "unstamped" ? "(not yet available)" : ""}</div>
<div class="k" style="margin-top:.8rem">Verify it yourself — independent, no trust in us</div>
<pre>curl -s "${origin}/ledger/${e.n}?format=raw" > claim_${e.n}.txt
curl -s "${ots}" > claim_${e.n}.txt.ots
# no Bitcoin node needed:
ots info claim_${e.n}.txt.ots            # shows the Bitcoin block this is anchored in
# or drag both files into https://opentimestamps.org
# with a full Bitcoin node:
ots verify claim_${e.n}.txt.ots
shasum -a 256 claim_${e.n}.txt           # == ${e.claim_sha256}</pre></div>
<div class="sub">A signature proves the record is untampered, not that the underlying ruleset is still current. This ledger anchors <em>when</em> the claim existed — to Bitcoin, nothing weaker, no separate chain.</div>
</div></body></html>`;
}

/* ===========================================================================
   看板 (discovery layer) — added 2026-07-26 per KANBAN_TO_ANNAININ_v1.md.

   ADDITIVE ONLY. No existing route is modified. /health's `routes` array is
   unchanged and still contains exactly 9 entries (Guardian v4 check ⑩ counts
   them); discovery is exposed as a sibling key and, canonically, through the
   RFC 9727 catalog at /.well-known/api-catalog.

   Only paths that are IANA-registered or shipped in a released spec are used:
     /.well-known/api-catalog       RFC 9727 (permanent registration)
     /.well-known/agent-card.json   A2A v1.0.1 (provisional registration)
     /.well-known/security.txt      RFC 9116 (permanent registration)
   Deliberately NOT served: ai-plugin.json (dead since 2024-04-09),
   /.well-known/agent.json (renamed in A2A v0.3.0), /.well-known/mcp.json
   (SEP-2127 unmerged, path still moving). See design doc §3.9.
   =========================================================================== */

const MCP_ORIGIN = "https://hs-jidec-mcp.oga-surf-project.workers.dev";
const CONTACT = "mailto:thehorizon.nnovation@icloud.com";

const wantsMarkdown = (request) =>
  (request.headers.get("accept") || "").toLowerCase().includes("text/markdown");

// Content-negotiated responses MUST carry Vary: Accept or caches will serve
// HTML/JSON to a client that asked for Markdown and vice versa.
const md = (text) =>
  new Response(text, { headers: { "content-type": "text/markdown; charset=utf-8", vary: "Accept", ...CORS } });
const jsonV = (o, status = 200) =>
  new Response(JSON.stringify(o, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", vary: "Accept", ...CORS },
  });

// Honest description of where this sits relative to SCITT (RFC 9943) and
// COSE Receipts (RFC 9942). The architecture matches; the encodings do not.
// Overstating this would defeat the entire purpose of the ledger.
const TRANSPARENCY = {
  model: "SCITT-shaped transparency service (RFC 9943 vocabulary, not RFC 9943 encoding)",
  anchor_ledger: "bitcoin",
  anchor_method: "opentimestamps",
  mapping: {
    "signed statement": "jidec-claim-v1 canonical bytes (plain UTF-8 JSON, NOT COSE_Sign1)",
    "transparent statement": "an appended ledger entry addressed by claim_sha256",
    receipt: "an OpenTimestamps proof (NOT an RFC 9942 COSE receipt, no RFC9162_SHA256 VDS)",
    "anchor proof": "Bitcoin block inclusion, per draft-fassbender-scitt-time-anchor-01",
  },
  conformance:
    "NOT a conformant SCITT Transparency Service. Statements are canonical JSON rather than COSE_Sign1 and receipts are OpenTimestamps proofs rather than COSE receipts. The vocabulary is used because the shape is the same, not because conformance is claimed.",
  caveats: [
    "draft-fassbender-scitt-time-anchor-01 is an individual Independent Submission, not IETF consensus.",
    "OpenTimestamps has no RFC, no ISO, no ETSI status and no standing under eIDAS. Auditors who require an institutionally recognised timestamp should ask for an RFC 3161 or eIDAS qualified timestamp in addition to this anchor.",
  ],
};

/* ------------------- 看板の実測（Analytics Engine・書き込みのみ） -------------------
   看板v1.1 は「見つけてもらう」ための層である。見つけてもらえたかどうかを一度も
   測っていないなら、それは看板ではなく願望である。ここで足すのはその一本だけ。

   記録するもの（すべて固定語彙・低カーディナリティ）
     route     正規化した入口名。"cite" "verify" "api-catalog" など。番号もSHAも入らない。
     ua_class  クライアントの種類。"ai-crawler" "curl" "browser" など。UA全文は入らない。
     method    GET / POST
     ref_host  Referer の**ホスト名だけ**。パスもクエリも捨てる。
     status    応答コード。404 が多い入口は「導線が間違っている」という意味である。

   記録しないもの
     IPアドレス、cf.* の地理情報、クエリ文字列、User-Agent 全文、Referer のパス、
     リクエスト本文、認証ヘッダ、エントリ番号、SHA-256。

   管理ルート（/ledger/append・/reference/pin・/ledger/pending）は一切記録しない。
   トークンを持つ側の行動を測る理由が無いし、測れば漏れる面が増えるだけである。

   バインディングが無い環境（テスト、ローカル、バインディングが落ちた本番）では
   黙って何もしない。最上位の掟：計測は本番を殺してはならない。
   ただし逆向きの掟も効いている。ここが黙って何もしなくなったとき、台帳は
   「異常なし」と言い続ける。だからテストが、バインディングを渡したときに実際に
   1点書かれることを毎回確かめる。静かに減るのを止められるのはテストだけである。 */

const PRIVACY = {
  access_measurement: "enabled",
  purpose: "to measure whether the discovery layer is reached at all, and by what kind of client",
  recorded: [
    "normalised route label (no entry numbers, no hashes)",
    "client class derived from the User-Agent (not the string itself)",
    "HTTP method",
    "Referer hostname only",
    "HTTP status code",
  ],
  not_recorded: [
    "IP address",
    "geolocation",
    "query strings",
    "full User-Agent string",
    "Referer path",
    "request bodies",
    "credentials",
    "ledger entry numbers",
    "SHA-256 values",
  ],
  admin_routes: "POST /ledger/append, POST /reference/pin and GET /ledger/pending are not measured at all",
  storage: "Cloudflare Analytics Engine only; this Worker keeps no copy in KV and exposes no read route for it",
};

// 管理ルート：計測対象から外す。
const AE_SKIP = new Set(["/ledger/append", "/reference/pin", "/ledger/pending"]);

// パスを固定語彙に落とす。ここが可変語を返すとカーディナリティが爆発するので、
// 番号もSHAも必ず捨てる。未知のパスは "other" にまとめる（404 の山として見える）。
function routeLabel(p, url) {
  if (p === "/" || p === "/health") return "health";
  if (p === "/.well-known/api-catalog") return "api-catalog";
  if (p === "/.well-known/agent-card.json") return "agent-card";
  if (p === "/.well-known/security.txt") return "security-txt";
  if (p === "/robots.txt") return "robots";
  if (p === "/llms.txt") return "llms";
  if (p === "/a2a") return "a2a";
  if (p.startsWith("/cite/")) return "cite";
  if (p === "/ledger") return "ledger-index";
  if (p === "/paths") return "paths-index";
  if (p === "/paths/query") return "paths-query";
  if (/^\/paths\/[0-9a-f]{64}\/replay$/i.test(p)) return "path-replay";
  if (/^\/paths\/[0-9a-f]{64}$/i.test(p)) return "path";
  if (/^\/verify\/\d+$/.test(p)) return "verify";
  if (/^\/reference\/[0-9a-f]{64}$/i.test(p)) return "reference";
  if (/^\/ledger\/\d+\/ots$/.test(p)) return "ots";
  if (/^\/ledger\/\d+$/.test(p)) {
    // format の**値そのもの**は記録しない。3値のラベルに畳んでから記録する。
    const f = url.searchParams.get("format");
    return f === "raw" ? "entry-raw" : f === "json" ? "entry-json" : "entry";
  }
  return "other";
}

// UA を種類に畳む。全文は記録しない。判定順序が重要である。
// クローラの UA はたいてい "Mozilla/5.0" を含むので、ブラウザ判定より前に置く。
function uaClass(ua) {
  const s = String(ua || "").toLowerCase();
  if (!s) return "none";
  if (/claudebot|anthropic|gptbot|oai-searchbot|chatgpt-user|perplexity|ccbot|google-extended|meta-externalagent|bytespider|amazonbot|applebot-extended/.test(s)) return "ai-crawler";
  if (/googlebot|bingbot|duckduckbot|applebot|yandexbot|baiduspider|slurp|ahrefsbot|semrushbot|petalbot/.test(s)) return "search-crawler";
  if (/opentimestamps|ots-cli/.test(s)) return "opentimestamps";
  if (/hs-ledger-replay|jidec|horizon-shield/.test(s)) return "jidec-internal";
  if (/headlesschrome|puppeteer|playwright/.test(s)) return "headless-browser";
  if (/curl/.test(s)) return "curl";
  if (/wget/.test(s)) return "wget";
  if (/python|urllib|requests|httpx|aiohttp/.test(s)) return "python";
  if (/node|undici|axios|got\/|go-http-client|okhttp|java\/|ruby|php|powershell/.test(s)) return "runtime";
  if (/mozilla|safari|chrome|firefox|edge/.test(s)) return "browser";
  return "other";
}

// Referer は**ホスト名だけ**。どこから辿って来たかは知りたいが、
// その人が何を読んでいたかを知る必要は無い。
function refHost(request) {
  const r = request.headers.get("referer") || "";
  if (!r) return "";
  try {
    return new URL(r).hostname.slice(0, 64);
  } catch {
    return "unparseable";
  }
}

function noteHit(env, request, status) {
  try {
    const ae = env && env.KANBAN_AE;
    if (!ae || typeof ae.writeDataPoint !== "function") return;
    if (request.method === "OPTIONS") return;
    const url = new URL(request.url);
    const p = url.pathname.replace(/\/+$/, "") || "/";
    if (AE_SKIP.has(p)) return;
    const route = routeLabel(p, url);
    ae.writeDataPoint({
      indexes: [route],
      blobs: [route, uaClass(request.headers.get("user-agent")), request.method, refHost(request)],
      doubles: [1, Number(status) || 0],
    });
  } catch {
    /* 計測は本番を殺さない。ここで throw させない。 */
  }
}

const apiCatalog = (origin) => ({
  linkset: [
    {
      anchor: origin + "/",
      item: [
        { href: origin + "/health", title: "service descriptor", type: "application/json" },
        { href: origin + "/ledger", title: "public append-only ledger index", type: "application/json" },
        { href: origin + "/paths", title: "anchored verification paths", type: "application/json" },
        { href: origin + "/cite/{citation}", title: "resolve and verify any citation", type: "application/json" },
        { href: origin + "/verify/{n}", title: "executable verification recipe for a v1 claim", type: "application/json" },
        { href: origin + "/reference/{sha}", title: "content-addressed pinned reference bundle", type: "application/json" },
        { href: origin + "/.well-known/agent-card.json", title: "A2A agent card", type: "application/json" },
        { href: origin + "/a2a", title: "A2A JSON-RPC endpoint (message/send)", type: "application/json" },
        { href: MCP_ORIGIN + "/mcp", title: "Model Context Protocol endpoint", type: "application/json" },
        { href: origin + "/llms.txt", title: "orientation for agents sent here to verify", type: "text/markdown" },
      ],
    },
  ],
});

// A2A v1.0.1 AgentCard. Note the path: agent-card.json, NOT the v0.2-era
// agent.json, which was renamed on 2025-07-30. protocolVersion lives inside
// each interface in v1.0, not at the card root.
const agentCard = (origin) => ({
  name: "HORIZON SHIELD JIDEC",
  description:
    "Bitcoin-anchored public verification ledger for construction-estimate audits. Resolves a citation to the exact anchored bytes, recomputes their hash, and reports the Bitcoin anchoring status, so that a third party can confirm a result without trusting HORIZON SHIELD.",
  version: "1.1.0",
  documentationUrl: origin + "/llms.txt",
  iconUrl: null,
  capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
  supportedInterfaces: [{ url: origin + "/a2a", transport: "JSONRPC", protocolVersion: "1.0.1" }],
  defaultInputModes: ["text/plain"],
  defaultOutputModes: ["application/json", "text/plain"],
  skills: [
    {
      id: "cite-and-verify",
      name: "Cite and independently verify a JIDEC record",
      description:
        "Given a citation (jidec:entry:<n>, jidec:path:<sha>, a bare 64-hex id, or a ledger URL), fetch the anchored bytes, recompute SHA-256, confirm it equals the cited id, and report the Bitcoin anchoring status together with an explicit statement of what the proof does and does not cover.",
      tags: ["verification", "provenance", "transparency-log", "bitcoin", "opentimestamps", "construction", "audit", "建設", "積算", "検証"],
      examples: ["jidec:entry:5", "jidec:entry:2", "Verify this JIDEC citation and tell me what it does not prove."],
      inputModes: ["text/plain"],
      outputModes: ["application/json", "text/plain"],
    },
  ],
  securitySchemes: {},
  security: [],
  supportsAuthenticatedExtendedCard: false,
  // Non-A2A discovery pointers, kept outside the required fields on purpose.
  additionalDiscovery: { apiCatalog: origin + "/.well-known/api-catalog", mcp: MCP_ORIGIN + "/mcp" },
});

const securityTxt = (origin) =>
  [
    "# HORIZON SHIELD / JIDEC — RFC 9116",
    "Contact: " + CONTACT,
    "Expires: 2027-07-26T00:00:00.000Z",
    "Preferred-Languages: ja, en",
    "Canonical: " + origin + "/.well-known/security.txt",
    "Policy: " + origin + "/llms.txt",
    "",
    "# This ledger is read-only and unauthenticated by design. If you find a way",
    "# to make a record's bytes disagree with its published hash, or to make a",
    "# verification recipe return a result that cannot be reproduced, that is the",
    "# vulnerability we most want to hear about.",
    "",
  ].join("\n");

const robotsTxt = (origin) =>
  [
    "User-agent: *",
    "Allow: /",
    "",
    "# This ledger exists to be read, cited and independently re-verified.",
    "# Nothing here is private and nothing here requires attribution to be useful.",
    "",
    "# AIPREF (IETF, draft) — machine-readable usage preference.",
    "Content-Usage: train-ai=y, search=y, ai-input=y",
    "",
    "# Cloudflare Content Signals.",
    "Content-signal: search=yes, ai-input=yes, ai-train=yes",
    "",
    "Sitemap: " + origin + "/llms.txt",
    "",
  ].join("\n");

// llms.txt. Its measured value is NOT AI search (97% of published files are
// never requested, and Google states it does not use them). Its measured value
// is coding agents, which do fetch it. So this file is written for exactly one
// reader: an agent that has been told "verify HORIZON SHIELD" and needs to know
// where to start and how to finish.
const llmsTxt = (origin) => `# HORIZON SHIELD / JIDEC

> A Bitcoin-anchored, append-only public ledger of construction-estimate audit
> claims. Its purpose is that you do NOT have to trust HORIZON SHIELD: every
> published result can be re-derived from bytes you fetch and hash yourself.

If you were sent here to verify something, do this in order.

## 1. Resolve the citation

\`GET ${origin}/cite/jidec:entry:5\`

Accepts \`jidec:entry:<n>\`, \`jidec:path:<sha>\`, a bare 64-hex id, or a ledger
URL. Returns the resolved entry, the claimed id, the id recomputed from the
stored bytes, whether they match, and the Bitcoin anchoring status.
Add \`Accept: text/markdown\` for prose instead of JSON.

## 2. Check the hash yourself instead of believing step 1

\`\`\`
curl -s "${origin}/ledger/5?format=raw" | shasum -a 256
\`\`\`

The output must equal the cited id. If it does not, the citation is bad and
nothing else on this site matters.

Hash exactly what you receive. The raw route serves the anchored bytes verbatim;
there is no canonicalisation step to apply and none to guess. If something in the
middle re-indents or re-encodes the response first — a browser view, a markdown
converter, a summarising fetch tool — the digest will not match, and the mismatch
is that intermediary, not the ledger. Pipe curl straight into your hash tool.

## 3. Check the timestamp

\`\`\`
curl -s "${origin}/ledger/5/ots" > claim_5.txt.ots
ots info claim_5.txt.ots
\`\`\`

Or drop the two files into https://opentimestamps.org. A \`pending\` status is
honest, not a failure: Bitcoin confirmation takes hours.

## 4. Reproduce the audit itself

\`GET ${origin}/verify/{n}\` returns a recipe for any entry.

For an entry that declares a \`jidec-claim-v1\` audit it is a seven-step recipe:
which bytes to fetch, which reference bundle is pinned, which algorithm commit to
check out, and what each recomputed hash must equal. If all seven match, the
result is the deterministic output of the declared inputs.

For every other entry — specifications, source witnesses, correction notices — it
is a three-step byte-level recipe: fetch, hash, check the timestamp. That is less
than a full audit reproduction, and the route says so rather than pretending
otherwise. Either way our assertion is not needed.

## Endpoints

- ${origin}/health — service descriptor
- ${origin}/ledger — index of anchored entries
- ${origin}/paths — anchored verification paths (jidec-path-v1)
- ${origin}/cite/{citation} — resolve and verify any citation
- ${origin}/verify/{n} — executable verification recipe
- ${origin}/paths/{sha}/replay — re-observe an anchored path and report drift
- ${origin}/.well-known/api-catalog — RFC 9727 catalog of the above
- ${MCP_ORIGIN}/mcp — Model Context Protocol endpoint (read-only tools)

## What this proves, and what it does not

Proves: these exact bytes existed at or before the anchored time, and have not
changed since.

Does not prove: that an estimate is fair, that the input data is true, that the
reference prices are correct, or that HORIZON SHIELD is competent. Those are
judged by re-running the recipe, not by reading this file.

## Known limits, stated here so you do not have to find them

- OpenTimestamps has no RFC, no ISO and no eIDAS standing. For institutional
  audit, ask additionally for an RFC 3161 or eIDAS qualified timestamp.
- This is a SCITT-shaped service (RFC 9943 vocabulary) but not a conformant
  one: statements are canonical JSON, not COSE_Sign1, and receipts are
  OpenTimestamps proofs, not RFC 9942 COSE receipts.
- Entry #1 predates the v1 schema and is a concept proof only.
- The public ledger index covers the most recent 100 entries.
`;

// Resolve any citation form to a verified card, using only public state.
// This is the ledger-side twin of path/jidec_cite.py and hs-jidec-mcp's
// jidec_cite. Three independent implementations that must agree.
async function citationCard(env, origin, citation) {
  const c = String(citation || "").trim();
  let n = null;
  let m = c.match(/(?:jidec:entry:|\/ledger\/)(\d+)/);
  if (m) n = Number(m[1]);
  else if (/^\d+$/.test(c)) n = Number(c);
  else {
    const h = c.match(/([0-9a-f]{64})/i);
    if (!h) throw new Error("unrecognized citation: " + c);
    const ref = await env.LEDGER.get(`hash:${h[1].toLowerCase()}`);
    if (!ref) throw new Error("no anchored record has id " + h[1].toLowerCase());
    n = Number(ref);
  }

  const e = await getEntry(env, n);
  if (!e) throw new Error("no ledger entry #" + n);

  const recomputed = (await sha256hex(e.record_canonical || "")).toLowerCase();
  const claimed = (e.claim_sha256 || "").toLowerCase();
  const asked = (c.match(/([0-9a-f]{64})/i) || [])[1];
  const match = recomputed === claimed && (!asked || asked.toLowerCase() === recomputed);

  let kind = "v0-plain", obj = null;
  try {
    obj = JSON.parse(e.record_canonical);
    kind = obj && obj.schema === "jidec-path-v1" ? "jidec-path-v1"
         : obj && obj.schema === "jidec-claim-v1" ? "jidec-claim-v1"
         : "v0";
  } catch { obj = null; }

  const bitcoin =
    e.ots_status === "confirmed" && e.bitcoin_block
      ? { status: "confirmed", block: e.bitcoin_block, block_time: e.block_time || null }
      : { status: e.ots_status || "none", block: null, block_time: null };

  const card = {
    citation: c,
    resolved_entry: n,
    ledger_url: `${origin}/ledger/${n}`,
    raw_url: `${origin}/ledger/${n}?format=raw`,
    ots_url: `${origin}/ledger/${n}/ots`,
    verify_url: `${origin}/verify/${n}`,
    integrity: { claimed_sha256: claimed, recomputed_sha256: recomputed, match },
    bitcoin,
    record_kind: kind,
    reproduce: `curl -s "${origin}/ledger/${n}?format=raw" | shasum -a 256   # must print ${claimed}`,
  };

  if (kind === "jidec-path-v1" && obj) {
    card.path = { purpose: obj.purpose, walked_at: obj.walked_at, verdict: obj.verdict, path_url: `${origin}/paths/${claimed}`, replay_url: `${origin}/paths/${claimed}/replay` };
  } else if (kind === "jidec-claim-v1" && obj) {
    card.claim = {};
    for (const k of ["work_id", "input_sha256", "reference_bundle_sha256", "algorithm_commit", "thresholds_sha256", "result_sha256", "pdf_sha256", "issued_at"]) card.claim[k] = obj[k];
  } else {
    card.note = "This entry predates the v1 schemas. Its bytes are still anchored and hash-checkable.";
  }

  card.trust_note = match
    ? "Independently verifiable: the stored bytes hash to the cited id" +
      (bitcoin.status === "confirmed" ? `, and that id is confirmed in Bitcoin block ${bitcoin.block}` :
       bitcoin.status === "pending" ? ", and that id is submitted to OpenTimestamps (Bitcoin confirmation pending)" : "") +
      ". Do not take our word for it — run the command in `reproduce`."
    : "INTEGRITY FAILURE: the stored bytes do NOT hash to the cited id. Do not rely on this citation.";

  card.limits =
    "Proves: these exact bytes existed at or before the anchored time and have not changed. " +
    "Does not prove: that the estimate is fair, that the input data is true, or that HORIZON SHIELD is competent.";

  return card;
}

const cardMarkdown = (card) => {
  const L = [];
  L.push(`# JIDEC citation: ${card.citation}`);
  L.push("");
  L.push(`Entry #${card.resolved_entry} of the JIDEC public ledger. Record type \`${card.record_kind}\`.`);
  L.push("");
  L.push(`## Integrity: ${card.integrity.match ? "OK" : "FAILURE"}`);
  L.push("");
  L.push(`The bytes stored under entry #${card.resolved_entry} hash to \`${card.integrity.recomputed_sha256}\`, and the cited id is \`${card.integrity.claimed_sha256}\`. These ${card.integrity.match ? "match" : "DO NOT MATCH"}.`);
  L.push("");
  L.push("Reproduce this yourself:");
  L.push("");
  L.push("```");
  L.push(card.reproduce);
  L.push("```");
  L.push("");
  L.push("## Bitcoin anchoring");
  L.push("");
  L.push(
    card.bitcoin.status === "confirmed"
      ? `Confirmed in Bitcoin block ${card.bitcoin.block}${card.bitcoin.block_time ? ` (${card.bitcoin.block_time})` : ""}. Proof: ${card.ots_url}`
      : card.bitcoin.status === "pending"
      ? `Submitted to OpenTimestamps; Bitcoin confirmation is pending. Pending is the honest state, not a failure: confirmation takes hours. Proof once available: ${card.ots_url}`
      : `Anchoring status: ${card.bitcoin.status}.`
  );
  if (card.path) {
    L.push("");
    L.push("## Verification path");
    L.push("");
    L.push(`Purpose: ${card.path.purpose}`);
    L.push("");
    L.push(`Walked at ${card.path.walked_at}. Re-observe it live and check for drift: ${card.path.replay_url}`);
  }
  if (card.claim) {
    L.push("");
    L.push("## Committed hashes");
    L.push("");
    for (const [k, v] of Object.entries(card.claim)) if (v) L.push(`- \`${k}\`: \`${v}\``);
  }
  L.push("");
  L.push("## What this does and does not prove");
  L.push("");
  L.push(card.limits);
  L.push("");
  L.push(`Full seven-step reproduction recipe: ${card.verify_url}`);
  L.push("");
  return L.join("\n");
};

const recipeMarkdown = (r) => {
  const L = [];
  L.push(`# How to verify JIDEC entry #${r.entry} without trusting HORIZON SHIELD`);
  L.push("");
  L.push(`Claim id \`${r.claim_sha256}\`. Bitcoin status: ${r.bitcoin_status}${r.bitcoin_block ? ` (block ${r.bitcoin_block})` : ""}.`);
  L.push("");
  for (const s of r.recipe) {
    L.push(`## Step ${s.step}. ${s.action}`);
    L.push("");
    if (s.url) L.push(`Fetch: ${s.url}`);
    if (s.url) L.push("");
    L.push(`Check: ${s.verify}`);
    if (s.note) { L.push(""); L.push(`Note: ${s.note}`); }
    L.push("");
  }
  L.push("## Conclusion");
  L.push("");
  L.push(r.note);
  L.push("");
  return L.join("\n");
};

// ルーティング本体。export default の fetch はこれを呼んで、返ってきた status を
// 見てから看板の実測を1点書く。ここを分けたのは、応答コードまで含めて測るためである。
// 「どの入口が 404 を返しているか」は、看板にとって最も重要な一列である。
async function handle(request, env) {
    const url = new URL(request.url);
    const p = url.pathname.replace(/\/+$/, "") || "/";
    const origin = url.origin;
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    if (p === "/" || p === "/health")
      return json({ ok: true, service: "hs-ledger", ledger: "JIDEC", anchor: "Bitcoin via OpenTimestamps", claim_schema: "jidec-claim-v1", path_schema: "jidec-path-v1", spec: "SPEC_HASH_INDEPENDENCE_v1.md (entry #2); JIDEC_PATH_SPEC_v1.md (entry #5)", routes: ["/ledger", "/ledger/{n}", "/ledger/{n}/ots", "/verify/{n}", "/reference/{sha}", "/paths", "/paths/{sha}", "/paths/{sha}/replay", "/paths/query"], discovery: { api_catalog: "/.well-known/api-catalog", agent_card: "/.well-known/agent-card.json", security_txt: "/.well-known/security.txt", llms_txt: "/llms.txt", a2a: "/a2a", cite: "/cite/{citation}", mcp: MCP_ORIGIN + "/mcp" }, transparency: TRANSPARENCY, privacy: PRIVACY });

    /* ---------------------- 看板 routes (additive, read-only) ---------------------- */

    if (p === "/.well-known/api-catalog" && request.method === "GET") {
      // RFC 9727 の既定は application/linkset+json である。既定は変えない。
      // ただし 2026-07-26 の実測で、その Content-Type を「バイナリ」として扱い本文を
      // 読めない取得クライアントが実在することが分かった（番人の点検⑭でも同じ結果）。
      // 親看板が読めないのは発見可能性にとって致命的なので、明示的に JSON を求めてきた
      // クライアントには同じ本文を application/json で返す。Vary: Accept を必ず付ける。
      const body = JSON.stringify(apiCatalog(origin), null, 2);
      const acc = (request.headers.get("accept") || "").toLowerCase();
      const wantsPlainJson =
        url.searchParams.get("format") === "json" ||
        (acc.includes("application/json") && !acc.includes("linkset"));
      return new Response(body, {
        headers: {
          "content-type": wantsPlainJson ? "application/json; charset=utf-8" : "application/linkset+json; charset=utf-8",
          "vary": "Accept",
          "link": `<${origin}/.well-known/api-catalog?format=json>; rel="alternate"; type="application/json"`,
          ...CORS,
        },
      });
    }

    if (p === "/.well-known/agent-card.json" && request.method === "GET")
      return json(agentCard(origin));

    if (p === "/.well-known/security.txt" && request.method === "GET")
      return new Response(securityTxt(origin), { headers: { "content-type": "text/plain; charset=utf-8", ...CORS } });

    if (p === "/robots.txt" && request.method === "GET")
      return new Response(robotsTxt(origin), { headers: { "content-type": "text/plain; charset=utf-8", ...CORS } });

    if (p === "/llms.txt" && request.method === "GET")
      return new Response(llmsTxt(origin), { headers: { "content-type": "text/markdown; charset=utf-8", ...CORS } });

    // 案内人 front door: one GET resolves and verifies any citation form.
    if (p.startsWith("/cite/") && request.method === "GET") {
      const citation = decodeURIComponent(p.slice("/cite/".length));
      try {
        const card = await citationCard(env, origin, citation);
        if (wantsMarkdown(request)) return md(cardMarkdown(card));
        return jsonV(card, card.integrity.match ? 200 : 409);
      } catch (err) {
        return jsonV({ error: "unresolved", detail: String((err && err.message) || err), accepted_forms: ["jidec:entry:<n>", "jidec:path:<64hex>", "<64hex>", origin + "/ledger/<n>"], index: origin + "/ledger" }, 404);
      }
    }

    // A2A v1.0.1 JSON-RPC. Exactly one method, matching the single skill
    // advertised in the agent card. Advertising an interface we do not serve
    // would make the signboard a lie, so the card and this endpoint move together.
    if (p === "/a2a" && request.method === "POST") {
      const b = await request.json().catch(() => null);
      const rid = b && b.id !== undefined ? b.id : null;
      const rpcErr = (code, message) => json({ jsonrpc: "2.0", id: rid, error: { code, message } });
      if (!b || b.jsonrpc !== "2.0") return rpcErr(-32600, "invalid request: jsonrpc 2.0 envelope required");
      if (b.method !== "message/send")
        return rpcErr(-32601, `method not found: ${b.method}. This agent implements message/send only; send the citation as a text part.`);
      const parts = (b.params && b.params.message && b.params.message.parts) || [];
      const text = parts.filter((x) => x && x.kind === "text" && typeof x.text === "string").map((x) => x.text).join(" ").trim();
      if (!text) return rpcErr(-32602, "invalid params: expected params.message.parts[] containing a text part with a JIDEC citation");
      try {
        const card = await citationCard(env, origin, text.match(/jidec:[a-z]*:?[0-9a-f]+|[0-9a-f]{64}|\d+/i)?.[0] || text);
        return json({ jsonrpc: "2.0", id: rid, result: { kind: "message", role: "agent", messageId: crypto.randomUUID(), parts: [{ kind: "text", text: card.trust_note }, { kind: "data", data: card }] } });
      } catch (err) {
        return rpcErr(-32000, String((err && err.message) || err));
      }
    }

    if (p === "/ledger" && request.method === "GET") {
      const seq = Number((await env.LEDGER.get("seq")) || 0);
      const items = [];
      for (let n = seq; n >= 1 && items.length < 100; n--) {
        const e = await getEntry(env, n);
        if (e) {
          const pv = pendingView(e, env);
          items.push({ n, work: e.work, claim_sha256: e.claim_sha256, ots_status: e.ots_status, pending_stage: pv ? pv.stage : null, pending_hours: pv ? pv.hours : null, bitcoin_block: e.bitcoin_block, url: `${origin}/ledger/${n}` });
        }
      }
      return json({ ledger: "JIDEC", anchor: "Bitcoin via OpenTimestamps", count: seq, entries: items });
    }

    if (p === "/ledger/append" && request.method === "POST") {
      if (!(await auth(request, env))) return json({ error: "unauthorized" }, 401);
      const b = await request.json().catch(() => null);
      if (!b || !isHex64(b.claim_sha256) || typeof b.record_canonical !== "string")
        return json({ error: "claim_sha256 (64 hex) and record_canonical (string) required" }, 400);
      const h = (await sha256hex(b.record_canonical)).toLowerCase();
      if (h !== b.claim_sha256.toLowerCase()) return json({ error: "hash_mismatch", recomputed: h }, 422);
      // v1 schema validation: if the record declares itself as jidec-claim-v1, enforce all required fields.
      // If it's v0 (plain JSON without schema field), still accept for backward compat but flag it.
      const sch = parseClaimSchema(b.record_canonical);
      if (sch.schema === "invalid-v1") return json({ error: "invalid_v1_schema", detail: sch }, 422);
      // v1 must reference a pinned reference bundle that actually exists in KV
      if (sch.schema === "v1") {
        const refExists = await env.LEDGER.get(`ref:${sch.claim.reference_bundle_sha256}`);
        if (!refExists) return json({ error: "unknown_reference_bundle", reference_bundle_sha256: sch.claim.reference_bundle_sha256, hint: "POST the bundle to /reference/pin first" }, 422);
      }
      const dup = await env.LEDGER.get(`hash:${h}`);
      if (dup) return json({ n: Number(dup), url: `${origin}/ledger/${dup}`, dedup: true });
      const n = Number((await env.LEDGER.get("seq")) || 0) + 1;
      const entry = { n, work: b.work || null, claim_sha256: h, record_canonical: b.record_canonical, schema: sch.schema, created_at: new Date().toISOString(), ots_status: "unstamped", bitcoin_block: null, block_time: null, stamped_at: null };
      await env.LEDGER.put(`entry:${n}`, JSON.stringify(entry));
      await env.LEDGER.put(`hash:${h}`, String(n));
      await env.LEDGER.put("seq", String(n));
      return json({ n, url: `${origin}/ledger/${n}`, schema: sch.schema }, 201);
    }

    // --- Reference bundle pinning (per SPEC v1 §4).
    // Any dataset used by an audit must be POSTed here first. The server hashes the exact bytes,
    // stores them content-addressed (key = ref:<sha>), and the returned SHA is the ONLY valid
    // reference_bundle_sha256 for subsequent audit claims. This closes the "R2 same-month update"
    // hole: once pinned, the bytes are frozen; if the maintainer wants to change reference data,
    // they must pin a new bundle (new SHA) and future audits reference the new SHA explicitly.
    if (p === "/reference/pin" && request.method === "POST") {
      if (!(await auth(request, env))) return json({ error: "unauthorized" }, 401);
      const body_text = await request.text();
      if (!body_text) return json({ error: "empty_body" }, 400);
      let parsed;
      try { parsed = JSON.parse(body_text); } catch { return json({ error: "invalid_json" }, 400); }
      if (!parsed || typeof parsed !== "object") return json({ error: "must_be_json_object" }, 400);
      // Require a human-readable version label so operators can look up the bundle in registries.
      if (typeof parsed._meta?.version !== "string" || !parsed._meta.version)
        return json({ error: "missing _meta.version (human-readable label required)" }, 400);
      const ref_sha = (await sha256hex(body_text)).toLowerCase();
      const existing = await env.LEDGER.get(`ref:${ref_sha}`);
      if (existing) {
        return json({ reference_bundle_sha256: ref_sha, dedup: true, pinned_at: JSON.parse(existing).pinned_at });
      }
      const pin = { reference_bundle_sha256: ref_sha, version_label: parsed._meta.version, size_bytes: body_text.length, pinned_at: new Date().toISOString(), bytes: body_text };
      await env.LEDGER.put(`ref:${ref_sha}`, JSON.stringify(pin));
      return json({ reference_bundle_sha256: ref_sha, version_label: parsed._meta.version, url: `${origin}/reference/${ref_sha}` }, 201);
    }

    // Public read of a pinned reference bundle. Third-party verifiers use this to recompute audits.
    const refMatch = p.match(/^\/reference\/([0-9a-f]{64})$/i);
    if (refMatch && request.method === "GET") {
      const rec = await env.LEDGER.get(`ref:${refMatch[1].toLowerCase()}`);
      if (!rec) return json({ error: "reference bundle not found" }, 404);
      const pin = JSON.parse(rec);
      return new Response(pin.bytes, { headers: { "content-type": "application/json; charset=utf-8", "x-reference-sha256": pin.reference_bundle_sha256, "x-reference-version": pin.version_label, "x-pinned-at": pin.pinned_at, ...CORS } });
    }

    if (p === "/ledger/pending" && request.method === "GET") {
      if (!(await auth(request, env))) return json({ error: "unauthorized" }, 401);
      const seq = Number((await env.LEDGER.get("seq")) || 0);
      const out = [];
      for (let n = 1; n <= seq; n++) {
        const e = await getEntry(env, n);
        if (e && e.ots_status !== "confirmed") out.push({ n, claim_sha256: e.claim_sha256, record_canonical: e.record_canonical, ots_status: e.ots_status });
      }
      return json({ pending: out });
    }

    // Machine-readable verification recipe for a v1 entry. Lists exactly what a third party
    // must fetch and recompute to independently verify the claim end-to-end.
    const vm = p.match(/^\/verify\/(\d+)$/);
    if (vm && request.method === "GET") {
      const n = Number(vm[1]);
      const e = await getEntry(env, n);
      if (!e) return json({ error: "not found" }, 404);
      const sch = parseClaimSchema(e.record_canonical);
      if (sch.schema !== "v1") {
        // 2026-07-26: this used to return 400. That was wrong, and a blank third-party
        // agent found it: llms.txt section 4 and the correction notice anchored as entry #7
        // both send a reader to this route, and both are right — it was the route that was
        // too narrow. Every entry, whatever its schema, is verifiable at the byte level.
        // A verifier who is told to come here must get a recipe, not an error.
        return json({
          entry: n,
          claim_sha256: e.claim_sha256,
          bitcoin_status: e.ots_status,
          bitcoin_block: e.bitcoin_block,
          record_kind: sch.schema,
          scope:
            "Byte-level integrity and timestamp only. This entry does not declare a jidec-claim-v1 audit, " +
            "so there is no pinned reference bundle or algorithm commit to recompute. What you can establish " +
            "here is that these exact bytes existed at or before the anchored time and have not changed.",
          bytes_note:
            "The raw route serves the anchored bytes verbatim as text/plain. Hash exactly what you receive. " +
            "There is no canonicalisation step to apply and none to guess. If an intermediary (a browser view, " +
            "a markdown converter, a summarising fetch tool) re-indents or re-encodes the response before you " +
            "hash it, the digest will not match and the mismatch is the intermediary, not the ledger. " +
            "Pipe curl straight into your hash tool.",
          one_liner: `curl -s "${origin}/ledger/${n}?format=raw" | shasum -a 256   # must print ${e.claim_sha256}`,
          recipe: [
            { step: 1, action: "fetch the exact anchored bytes", url: `${origin}/ledger/${n}?format=raw`, verify: `shasum -a 256 => ${e.claim_sha256}` },
            { step: 2, action: "fetch and check the Bitcoin proof", url: `${origin}/ledger/${n}/ots`, verify: e.ots_status === "unstamped" ? "not stamped yet — nothing to check" : "ots verify -f <bytes file> <proof>, or upload both at https://opentimestamps.org" },
            { step: 3, action: "read what this does and does not prove", url: `${origin}/health`, verify: "see the transparency object; the limits are stated there, not implied" },
          ],
          conclusion:
            "If step 1 matches and step 2 verifies, the conclusion holds without any assertion from HORIZON SHIELD.",
        });
      }
      const c = sch.claim;
      const recipeDoc = {
        entry: n,
        claim_sha256: e.claim_sha256,
        bitcoin_status: e.ots_status,
        bitcoin_block: e.bitcoin_block,
        recipe: [
          { step: 1, action: "fetch canonical record", url: `${origin}/ledger/${n}?format=raw`, verify: `shasum -a 256 => ${e.claim_sha256}` },
          { step: 2, action: "fetch and verify Bitcoin proof", url: `${origin}/ledger/${n}/ots`, verify: "ots verify (needs opentimestamps-client) OR drop into https://opentimestamps.org" },
          { step: 3, action: "fetch pinned reference bundle", url: `${origin}/reference/${c.reference_bundle_sha256}`, verify: `shasum -a 256 => ${c.reference_bundle_sha256}` },
          { step: 4, action: "checkout algorithm source at declared commit", url: c.algorithm_url, verify: `git rev-parse HEAD => ${c.algorithm_commit}` },
          { step: 5, action: "obtain the input estimate", verify: `shasum -a 256 => ${c.input_sha256}`, note: "input is user-private; obtain from the audited party" },
          { step: 6, action: "recompute audit and hash the result", verify: `shasum -a 256 => ${c.result_sha256}` },
          { step: 7, action: "verify PDF fingerprint", verify: `shasum -a 256 <issued.pdf> => ${c.pdf_sha256}` }
        ],
        note: "If steps 1-7 all match, the audit result is provably the deterministic output of the declared inputs/algorithm — HORIZON SHIELD's assertion is not needed."
      };
      if (wantsMarkdown(request)) return md(recipeMarkdown(recipeDoc));
      return jsonV(recipeDoc);
    }

    // --- Paths (Phase 3, jidec-path-v1). Read endpoints are public; replay is host-allowlisted. ---

    // List every entry whose record is a verification path.
    if (p === "/paths" && request.method === "GET") {
      const seq = Number((await env.LEDGER.get("seq")) || 0);
      const out = [];
      for (let n = seq; n >= 1 && out.length < 100; n--) {
        const e = await getEntry(env, n);
        if (!e) continue;
        const obj = asPathV1(e.record_canonical);
        if (obj) out.push({ n, path_id: e.claim_sha256, purpose: obj.purpose, verdict: obj.verdict, ots_status: e.ots_status, bitcoin_block: e.bitcoin_block, url: `${origin}/paths/${e.claim_sha256}` });
      }
      return json({ paths: out });
    }

    // Reverse index query: find paths that fetched a URL substring or observed a SHA.
    if (p === "/paths/query" && request.method === "POST") {
      const b = await request.json().catch(() => null);
      if (!b || (typeof b.contains_url !== "string" && typeof b.contains_sha !== "string"))
        return json({ error: "contains_url (string) or contains_sha (string) required" }, 400);
      const wantUrl = typeof b.contains_url === "string" ? b.contains_url : null;
      const wantSha = typeof b.contains_sha === "string" ? b.contains_sha.toLowerCase() : null;
      const seq = Number((await env.LEDGER.get("seq")) || 0);
      const hits = [];
      for (let n = 1; n <= seq; n++) {
        const e = await getEntry(env, n);
        if (!e) continue;
        const obj = asPathV1(e.record_canonical);
        if (!obj) continue;
        let matched = false;
        for (const nd of obj.nodes) {
          if (wantUrl && nd.request && typeof nd.request.url === "string" && nd.request.url.includes(wantUrl)) matched = true;
          if (wantSha) {
            const bs = nd.response && nd.response.body_sha256;
            const os = nd.output_sha256;
            if ((bs && bs.toLowerCase() === wantSha) || (os && os.toLowerCase() === wantSha)) matched = true;
          }
        }
        if (wantSha && e.claim_sha256 && e.claim_sha256.toLowerCase() === wantSha) matched = true;
        if (matched) hits.push({ n, path_id: e.claim_sha256, purpose: obj.purpose, url: `${origin}/paths/${e.claim_sha256}` });
      }
      return json({ query: { contains_url: wantUrl, contains_sha: wantSha }, note: "linear scan over anchored paths; a secondary index is future work at scale", hits });
    }

    // Resolve a path by its id (O(1) via the hash: key) and, optionally, re-walk it.
    const pm = p.match(/^\/paths\/([0-9a-f]{64})(\/replay)?$/i);
    if (pm) {
      const sha = pm[1].toLowerCase();
      const nRef = await env.LEDGER.get(`hash:${sha}`);
      if (!nRef) return json({ error: "no anchored path with that id", path_id: sha }, 404);
      const e = await getEntry(env, Number(nRef));
      if (!e) return json({ error: "entry missing" }, 404);
      const obj = asPathV1(e.record_canonical);
      if (!obj) return json({ error: "entry is not a jidec-path-v1 record", entry: Number(nRef) }, 400);

      if (!pm[2] && request.method === "GET") {
        // integrity: recompute the stored bytes' hash and confirm it equals the id
        const recomputed = (await sha256hex(e.record_canonical)).toLowerCase();
        if (wantsMarkdown(request)) return md(cardMarkdown(await citationCard(env, origin, sha)));
        return jsonV({ ...pathCard(e, obj, origin), integrity: { match: recomputed === sha, recomputed } });
      }

      if (pm[2] && request.method === "GET") {
        // Server-side replay. A Worker fetching another worker on the same account by its
        // public workers.dev hostname loops back to itself, so we do NOT fetch: we re-observe
        // only THIS ledger's own immutable entries directly from KV (which cannot loop and
        // cannot lie), and defer cross-host nodes (e.g. /canary on hs-pdf-gen) to the
        // client-side replay, which runs outside Cloudflare and re-fetches for real. This
        // reports only what it can actually verify — it never emits a false DRIFT.
        const selfHost = url.host;
        const hasPdfGen = env.PDF_GEN && typeof env.PDF_GEN.fetch === "function";
        const diffs = [];
        let drift = false, reobserved = 0;
        const fetchTotal = obj.nodes.filter((x) => x.kind === "fetch").length;
        for (const nd of obj.nodes) {
          if (nd.kind !== "fetch") continue;
          const u = nd.request && nd.request.url;
          const anchored = (nd.response && nd.response.body_sha256) || null;
          let uo = null;
          try { uo = new URL(u); } catch {}
          const lm = uo && uo.pathname.match(/^\/ledger\/(\d+)$/);
          const isRaw = uo && uo.searchParams.get("format") === "raw";
          if (uo && uo.host === selfHost && lm && isRaw) {
            // this ledger's own immutable entry — read from KV, no loopback
            const te = await getEntry(env, Number(lm[1]));
            const freshSha = te ? (await sha256hex(te.record_canonical)).toLowerCase() : null;
            const changed = freshSha !== anchored;
            if (changed) drift = true;
            reobserved++;
            diffs.push({ n: nd.n, url: u, source: "ledger KV (immutable)", anchored_body_sha256: anchored, fresh_body_sha256: freshSha, changed });
          } else if (uo && hasPdfGen && /^hs-pdf-gen\./.test(uo.host)) {
            // cross-worker node re-observed via service binding (no public-hostname loopback)
            let freshSha = null, err = null;
            try {
              const r = await env.PDF_GEN.fetch(new Request(u, { headers: { "user-agent": "hs-ledger-replay" } }));
              freshSha = await sha256hexBuf(await r.arrayBuffer());
            } catch (ex) { err = String((ex && ex.message) || ex); }
            const changed = err ? true : freshSha !== anchored;
            if (changed) drift = true;
            reobserved++;
            diffs.push({ n: nd.n, url: u, source: "service binding PDF_GEN", anchored_body_sha256: anchored, fresh_body_sha256: freshSha, changed, ...(err ? { error: err } : {}) });
          } else {
            diffs.push({ n: nd.n, url: u, deferred: "cross-host node not bound server-side — re-verify with client-side `jidec_path.py --replay`" });
          }
        }
        const full = reobserved === fetchTotal && fetchTotal > 0;
        const result = reobserved === 0
          ? "INCONCLUSIVE — no server-re-observable nodes; run client-side replay"
          : drift
            ? "DRIFT — a re-observed node changed (investigate)"
            : full
              ? "MATCH — all fetch nodes re-observed server-side, no drift"
              : "MATCH (partial) — re-observed nodes unchanged; unbound nodes deferred to client";
        return json({
          path_id: sha, entry: Number(nRef), anchored_verdict: obj.verdict && obj.verdict.outcome,
          reobserved_nodes: reobserved, fetch_nodes: fetchTotal, coverage: full ? "full" : "partial",
          drift, result, diffs,
          note: "Ledger's own entries are re-observed from KV; hs-pdf-gen nodes via the PDF_GEN service binding (no loopback). Any node that cannot be re-observed server-side is deferred to client-side replay, never counted as drift.",
        });
      }
    }

    const m = p.match(/^\/ledger\/(\d+)(\/ots)?$/);
    if (m) {
      const n = Number(m[1]);
      const e = await getEntry(env, n);
      if (!e) return json({ error: "not found" }, 404);
      if (m[2]) {
        if (request.method === "POST") {
          if (!(await auth(request, env))) return json({ error: "unauthorized" }, 401);
          const b = await request.json().catch(() => null);
          if (!b || typeof b.ots_base64 !== "string") return json({ error: "ots_base64 required" }, 400);
          await env.LEDGER.put(`ots:${n}`, b.ots_base64);
          e.ots_status = b.status === "confirmed" ? "confirmed" : "pending";
          if (b.bitcoin_block) e.bitcoin_block = b.bitcoin_block;
          if (b.block_time) e.block_time = b.block_time;
          e.stamped_at = new Date().toISOString();
          await env.LEDGER.put(`entry:${n}`, JSON.stringify(e));
          return json({ ok: true, n, ots_status: e.ots_status });
        }
        const b64 = await env.LEDGER.get(`ots:${n}`);
        if (!b64) return json({ error: "proof not yet available", ots_status: e.ots_status }, 404);
        return new Response(b64ToBytes(b64), { headers: { "content-type": "application/vnd.opentimestamps.proof", "content-disposition": `attachment; filename="claim_${n}.txt.ots"`, ...CORS } });
      }
      const fmt = url.searchParams.get("format");
      if (fmt === "raw") return new Response(e.record_canonical || "", { headers: { "content-type": "text/plain; charset=utf-8", ...CORS } });
      if (fmt === "json" || (request.headers.get("accept") || "").includes("application/json")) {
        const pv = pendingView(e, env);
        return json(pv ? { ...e, pending_stage: pv.stage, pending_hours: pv.hours, pending_stale_after_hours: pv.stale_after } : e);
      }
      return new Response(receiptHtml(e, origin, env), { headers: { "content-type": "text/html; charset=utf-8", ...CORS } });
    }

    return json({ error: "not found", routes: ["/ledger", "/ledger/{n}", "/ledger/{n}/ots"] }, 404);
}

export default {
  async fetch(request, env) {
    const res = await handle(request, env);
    // 実測は応答を返す**前**に1点書く。writeDataPoint は待たない呼び出しなので
    // 遅延は増えない。noteHit の中は全部 try で囲ってあり、ここは throw しない。
    noteHit(env, request, res && res.status);
    return res;
  },
};
