// ============================================================================
// Yakumo 加盟店マイページ Google OAuth + 署名cookieセッション
// 方針: Glama式の本格ログイン。堤さん達が自分のGoogleアカウントで入る。
// 安全設計:
//  - IDトークンは Google JWKS で署名検証(aud/iss/exp)。メールを鵜呑みにしない。
//  - セッションcookieは store_id + exp を HMAC-SHA256 署名。改ざんは検知して弾く。
//  - cookie属性 HttpOnly; Secure; SameSite=Lax。
//  - email2store に無いメールは店に入れない(承認待ち)。
// 既存(register-info/MCP/LINE)には一切依存しない。独立モジュール。
// ============================================================================

const SELF = "https://hs-hearing.oga-surf-project.workers.dev";
const MYPAGE = "https://hs-webmcp.oga-surf-project.workers.dev/mypage";
const SESSION_TTL = 60 * 60 * 24 * 30; // 30日
const COOKIE = "yakumo_sess";

const enc = new TextEncoder();
function b64url(buf) {
  let s = btoa(String.fromCharCode(...new Uint8Array(buf)));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToBytes(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---- HMAC-SHA256 署名 (SESSION_SECRET) ----
async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function signSession(env, store, exp) {
  // 空文字は「世界中が知っとる鍵」。未設定なら署名せず落ちる (fail-closed)。
  if (!env.SESSION_SECRET) throw new Error("SESSION_SECRET is not set: refusing to sign a session with an empty key");
  const payload = store + "." + exp;
  const key = await hmacKey(env.SESSION_SECRET);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return payload + "." + b64url(sig);
}
async function verifySessionToken(env, token) {
  if (!token) return null;
  // 未設定のときに空鍵で検証したら、偽造 cookie が全部通る。誰もログインしとらん扱いにする。
  if (!env.SESSION_SECRET) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [store, exp, sig] = parts;
  if (!/^[0-9]+$/.test(exp)) return null;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return null;
  const key = await hmacKey(env.SESSION_SECRET);
  const ok = await crypto.subtle.verify("HMAC", key, b64urlToBytes(sig), enc.encode(store + "." + exp));
  return ok ? store : null;
}

// リクエストの cookie から現在の store_id を返す(未ログインなら null)
export async function currentStore(request, env) {
  const c = request.headers.get("Cookie") || "";
  const m = c.match(new RegExp("(?:^|;\\s*)" + COOKIE + "=([^;]+)"));
  if (!m) return null;
  try { return await verifySessionToken(env, decodeURIComponent(m[1])); }
  catch (e) { return null; }
}

function redirect(loc, extraHeaders) {
  return new Response(null, { status: 302, headers: { Location: loc, ...(extraHeaders || {}) } });
}
function htmlPage(title, bodyHtml) {
  return new Response(
    "<!doctype html><html lang=\"ja\"><head><meta charset=\"utf-8\">" +
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"robots\" content=\"noindex,nofollow\">" +
    "<title>" + title + "</title><style>" +
    "body{margin:0;background:#080B11;color:#EAF0F8;font-family:system-ui,'Hiragino Sans',Meiryo,sans-serif;line-height:1.8;display:flex;min-height:100vh;align-items:center;justify-content:center}" +
    ".card{max-width:420px;margin:20px;padding:30px 26px;border:1px solid #1A2230;border-radius:16px;background:#0A0E16;text-align:center}" +
    "h1{font-size:19px;margin:0 0 10px}p{color:#7E8CA2;font-size:14px}a.btn{display:inline-block;margin-top:16px;background:#3FE0CE;color:#06241F;text-decoration:none;font-weight:800;border-radius:11px;padding:13px 22px;font-size:15px}" +
    "</style></head><body><div class=\"card\">" + bodyHtml + "</div></body></html>",
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
  );
}

// ---- /auth/google : 認可画面へ ----
async function startAuth(url, env) {
  if (!env.GOOGLE_CLIENT_ID) return htmlPage("設定エラー", "<h1>設定が未完了です</h1><p>GOOGLE_CLIENT_ID 未設定。運営にご連絡ください。</p>");
  const state = b64url(crypto.getRandomValues(new Uint8Array(24)));
  // state を KV に90秒だけ保存(CSRF対策)
  await env.HS_HEARING_KV.put("oauthstate:" + state, "1", { expirationTtl: 90 });
  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  auth.searchParams.set("redirect_uri", SELF + "/auth/callback");
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", "openid email profile");
  auth.searchParams.set("state", state);
  auth.searchParams.set("prompt", "select_account");
  return redirect(auth.toString());
}

// ---- Google IDトークン検証(JWKS) ----
let JWKS_CACHE = null, JWKS_AT = 0;
async function getGoogleKeys() {
  const now = Date.now();
  if (JWKS_CACHE && now - JWKS_AT < 3600000) return JWKS_CACHE;
  const r = await fetch("https://www.googleapis.com/oauth2/v3/certs");
  const j = await r.json();
  JWKS_CACHE = j.keys || []; JWKS_AT = now;
  return JWKS_CACHE;
}
async function verifyIdToken(idToken, clientId) {
  const [h, p, s] = idToken.split(".");
  if (!h || !p || !s) return null;
  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h)));
  const keys = await getGoogleKeys();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(s), enc.encode(h + "." + p));
  if (!ok) return null;
  const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));
  if (payload.aud !== clientId) return null;
  if (payload.iss !== "https://accounts.google.com" && payload.iss !== "accounts.google.com") return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  if (!payload.email || !payload.email_verified) return null;
  return payload;
}

// ---- /auth/callback : code受領 → 検証 → email2store → cookie発行 ----
async function handleCallback(url, env) {
  const err = url.searchParams.get("error");
  if (err) return htmlPage("ログイン中断", "<h1>ログインが中断されました</h1><p>もう一度お試しください。</p><a class=\"btn\" href=\"" + SELF + "/auth/google\">Googleでログイン</a>");
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  if (!code || !state) return htmlPage("エラー", "<h1>パラメータ不足</h1><p>もう一度お試しください。</p>");
  // state 照合(CSRF)
  const seen = await env.HS_HEARING_KV.get("oauthstate:" + state);
  if (!seen) return htmlPage("エラー", "<h1>セッション期限切れ</h1><p>お手数ですが、もう一度ログインしてください。</p><a class=\"btn\" href=\"" + SELF + "/auth/google\">Googleでログイン</a>");
  await env.HS_HEARING_KV.delete("oauthstate:" + state);
  // code をトークンに交換
  const tok = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: SELF + "/auth/callback", grant_type: "authorization_code",
    }),
  });
  if (!tok.ok) return htmlPage("エラー", "<h1>認証に失敗しました</h1><p>もう一度お試しください。</p>");
  const tj = await tok.json();
  const claims = await verifyIdToken(tj.id_token || "", env.GOOGLE_CLIENT_ID);
  if (!claims) return htmlPage("エラー", "<h1>トークン検証に失敗しました</h1><p>もう一度お試しください。</p>");
  const email = String(claims.email).toLowerCase();
  // email2store 照合
  const store = await env.HS_HEARING_KV.get("email2store:" + email);
  if (!store) {
    // 未登録: 店に入れない。運営に通知(activity)。
    try { await env.HS_HEARING_KV.put("pending_login:" + email, JSON.stringify({ email, at: new Date().toISOString() }), { expirationTtl: 60 * 60 * 24 * 7 }); } catch (e) {}
    return htmlPage("未登録アカウント",
      "<h1>このアカウントはまだ登録されていません</h1><p>" + email.replace(/[<>&]/g, "") + " は加盟店として登録されていません。運営(Yakumo)にご連絡ください。登録後、このアカウントでログインできます。</p>");
  }
  // セッションcookie発行
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL;
  const token = await signSession(env, store, exp);
  const cookie = COOKIE + "=" + encodeURIComponent(token) +
    "; Path=/; Max-Age=" + SESSION_TTL + "; HttpOnly; Secure; SameSite=Lax; Domain=oga-surf-project.workers.dev";
  // マイページ(グラフ)へ。k は hs-webmcp と一致する mypageToken を再計算して付ける。
  const gk = (await mypageK(env, store)).slice(0, 20);
  return redirect(MYPAGE + "?store=" + encodeURIComponent(store) + "&k=" + gk, { "Set-Cookie": cookie });
}

// hs-webmcp の mypageToken と完全一致(hs-mypage:MYPAGE_SALT:store の SHA-256 先頭20)
async function mypageK(env, store) {
  // salt 無しの token は store_id を知っとる者なら誰でも再現できる。未設定なら発行せん。
  if (!env.MYPAGE_SALT) throw new Error("MYPAGE_SALT is not set: refusing to mint a mypage token without a salt");
  const buf = await crypto.subtle.digest("SHA-256", enc.encode("hs-mypage:" + env.MYPAGE_SALT + ":" + store));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function logout() {
  const cookie = COOKIE + "=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax; Domain=oga-surf-project.workers.dev";
  return redirect(MYPAGE.replace("/mypage", "/"), { "Set-Cookie": cookie });
}

// ---- ルーター: /auth/* を捌く。該当なしは null を返す(既存処理へ) ----
export async function handleAuth(request, env, url) {
  const path = url.pathname;
  if (path === "/auth/google") return startAuth(url, env);
  if (path === "/auth/callback") return handleCallback(url, env);
  if (path === "/auth/logout") return logout();
  if (path === "/auth/me") {
    const store = await currentStore(request, env);
    return new Response(JSON.stringify({ logged_in: !!store, store: store || null }),
      { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
  }
  return null;
}
