const HS_MCP_URL = "https://hs-mcp/";
const DEFAULT_MODEL = "gemini-2.5-flash";
const MAX_TURNS = 6;
const SYSTEM = [
  "あなたはHORIZON SHIELDの建設見積もり監査アシスタント。運営はThe HORIZONs株式会社。",
  "日本の建設・リフォーム見積もりの適正性を、必ず提供ツールで数値根拠を取ってから答える。憶測で価格を言わない。",
  "手順: 相場はget_price_range/search_cost_category、見積額はaudit_estimate、営業トークや一式表現はred_flag_check、第三者検証の証拠を求められたらverify_fair_price(署名レシート)。",
  "回答は日本語で簡潔に。過剰の懸念は根拠(平均比%や危険水準)と対処を添える。最後にデータ出典(souba-db/大賀俊勝監修)を一言。断定しすぎず施主が判断できる材料を渡す。"
,
  "適正価格の判定を出すときは verify_fair_price も必ず呼び、回答末尾に「検証情報」の節を付ける。そこに claim_sha256 の先頭16桁、PTKA の Bitcoin ブロック番号、そして発行者を信用せず SHA-256 を自分で再計算して検証できる旨を、各1行で簡潔に記す。これが HORIZON SHIELD の世界初の芯である。"
].join("\n");
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const J = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json; charset=utf-8", ...CORS } });
async function mcp(method, params, env) {
  const r = await env.HS_MCP.fetch(HS_MCP_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params || {} }) });
  const j = await r.json();
  if (j.error) throw new Error("MCP " + method + ": " + (j.error.message || "error"));
  return j.result;
}
function norm(r) {
  const t = r && r.content && r.content[0] && r.content[0].text;
  if (typeof t === "string") { try { const o = JSON.parse(t); return (o && typeof o === "object" && !Array.isArray(o)) ? (r.isError ? { error: o } : o) : { result: o }; } catch { return r.isError ? { error: t } : { result: t }; } }
  return { result: r };
}
const TMAP = { string: "STRING", number: "NUMBER", integer: "INTEGER", boolean: "BOOLEAN", array: "ARRAY", object: "OBJECT" };
function sane(s) {
  if (!s || typeof s !== "object") return { type: "STRING" };
  const o = {};
  if (s.type) o.type = TMAP[String(s.type).toLowerCase()] || "STRING";
  if (s.description) o.description = String(s.description).slice(0, 2048);
  if (Array.isArray(s.enum)) o.enum = s.enum;
  if (s.format) o.format = s.format;
  if (s.items) o.items = sane(s.items);
  if (s.properties && typeof s.properties === "object") { o.properties = {}; for (const k of Object.keys(s.properties)) o.properties[k] = sane(s.properties[k]); }
  if (Array.isArray(s.required)) o.required = s.required;
  if (!o.type) o.type = o.properties ? "OBJECT" : "STRING";
  return o;
}
function decls(tools) { return [{ functionDeclarations: (tools || []).map((t) => ({ name: t.name, description: String(t.description || "").slice(0, 1024), parameters: sane(t.inputSchema || { type: "object", properties: {} }) })) }]; }
function calls(c) { return ((c && c.parts) || []).filter((p) => p.functionCall).map((p) => p.functionCall); }
async function gem(key, model, contents, tools) {
  const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent", {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM }] }, contents, tools, toolConfig: { functionCallingConfig: { mode: "AUTO" } } })
  });
  const j = await r.json();
  if (j.error) throw new Error("Gemini: " + (j.error.message || JSON.stringify(j.error)));
  return j;
}
async function ask(question, env) {
  const key = env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY 未設定。npx wrangler secret put GEMINI_API_KEY を先に。");
  const model = env.GEMINI_MODEL || DEFAULT_MODEL;
  const tools = decls((await mcp("tools/list", {}, env)).tools);
  const contents = [{ role: "user", parts: [{ text: question }] }];
  const used = [];
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const resp = await gem(key, model, contents, tools);
    const c = (resp.candidates && resp.candidates[0] && resp.candidates[0].content) || { parts: [] };
    const cs = calls(c);
    if (!cs.length) { const text = (c.parts || []).map((p) => p.text).filter(Boolean).join(""); return { answer: text, tools_used: used, turns: turn + 1, model }; }
    contents.push(c);
    const parts = [];
    for (const call of cs) { used.push(call.name); let res; try { res = norm(await mcp("tools/call", { name: call.name, arguments: call.args || {} }, env)); } catch (e) { res = { error: String((e && e.message) || e) }; } parts.push({ functionResponse: { name: call.name, response: res } }); }
    contents.push({ role: "user", parts });
  }
  return { answer: "監査の往復が上限に達しました。質問を分けて再度お試しください。", tools_used: used, turns: MAX_TURNS, model, truncated: true };
}
export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (request.method === "GET") return J({ service: "hs-gemini-audit", how: "POST {question} to this URL", backend: "Gemini x HORIZON SHIELD hs-mcp" });
    if (request.method !== "POST") return J({ error: "POST only" }, 405);
    let body; try { body = await request.json(); } catch { return J({ error: "invalid JSON body" }, 400); }
    const question = ((body && (body.question || body.q)) || "").toString().trim();
    if (!question) return J({ error: "question is required" }, 400);
    if (question.length > 2000) return J({ error: "question too long" }, 400);
    if (env.AUDIT_RL) { const rl = await env.AUDIT_RL.limit({ key: request.headers.get("cf-connecting-ip") || "anon" }); if (!rl.success) return J({ error: "rate_limited" }, 429); }
    try { return J(await ask(question, env)); } catch (e) { return J({ error: String((e && e.message) || e) }, 502); }
  }
};
