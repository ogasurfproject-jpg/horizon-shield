// hs-verify-relay (Deno Deploy version) / 2026-08-21
//
// なぜ Cloudflare の外に置くか:
//   扉(hs-verify-gate, zone horizonshield.dev)は、HTTP で呼ばれると自ゾーンへの
//   subrequest が 522 になる(2026-08-14/15 実測)。だから自分自身を測れない。
//   中継を Cloudflare 上のどこに置いても、同一ゾーン(522)か同一アカウント workers.dev
//   (ループ)で詰む。relay.the-horizons-innovation.com は GMO(dnsv.jp)にあり Cloudflare の
//   ゾーンではないので custom_domain も作れない。
//   よって中継は Cloudflare の外、公開エッジ上のホスト(Deno Deploy)に置く。扉→中継も
//   中継→horizonshield.dev も、真のクロスプロバイダの公開エッジになる。
//   これは扉の設計思想(私道=service binding を使わず、公開エッジで測る)とも一致する。
//
// これは開放プロキシではない:
//   1. x-relay-token の一致(定数時間比較)が無ければ 403
//   2. 取得先は horizonshield.dev ゾーンの https のみ。他は一切取得しない
//   3. メソッドは GET / POST のみ、応答本文は 256KB で打ち切り
//
// 秘密は RELAY_TOKEN のみ(Deno Deploy の環境変数に設定)。扉側にも同じ値を入れる。
// 状態は持たない(KVもDBも無い)。
//
// 2026-08-25 追記: 1リクエストにつき1行だけ、素性を標準出力に書く。
//   きっかけは、1日 289 リクエストという値が出たのに、
//   こちらが把握しているのは 1日1回の cron だけだった、ということである。
//   残り 288 が何なのか、誰にも言えなかった。
//   通信量は入口に門を付けて止めたが、「誰が叩いているか」は別の問いで、
//   止めても分からない。分からないままにしておくと、
//   増えたときにも減ったときにも、理由を言えない。
//
//   記録するもの: 時刻・メソッド・path・User-Agent・Referer・
//     鍵の有無・結果・(POSTなら)取得先のホスト・受け取ったバイト数・所要ミリ秒。
//   記録しないもの: 本文(要求も応答も)・鍵の値・生のIPアドレス。
//   同じ相手が何度も来たことは数えたいので、IP は起動ごとの塩を混ぜて
//   ハッシュにし、先頭12桁だけを書く。再起動すると別の値になる。
//   つまり「今この瞬間、同じ相手か」は分かるが、後から個人には戻らない。

const ALLOWED_ZONE = "horizonshield.dev";
const TIMEOUT_MS = 10000;
const MAX_BODY = 262144;
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

// 起動ごとに変わる塩。IP を数えられる形にはするが、後から戻せる形にはしない。
const BOOT_SALT = crypto.randomUUID();

function clip(s, n) {
  s = String(s == null ? "" : s);
  return s.length > n ? s.slice(0, n) + "…" : s;
}

async function ipTag(info) {
  try {
    const a = info && info.remoteAddr;
    const ip = (a && (a.hostname || a.address)) || "";
    if (!ip) return "";
    return (await sha256hex(BOOT_SALT + "|" + ip)).slice(0, 12);
  } catch (_e) {
    return "";
  }
}

// 1リクエストにつき1行。Deno Deploy の Logs で grep できるよう、頭に印を付ける。
async function logRequest(request, info, res, ctx, started) {
  let path = "", query = "";
  try {
    const u = new URL(request.url);
    path = u.pathname;
    query = u.search;
  } catch (_e) {}
  const h = request.headers;
  console.log("hs-relay-req " + JSON.stringify({
    at: new Date().toISOString(),
    method: request.method,
    path: path,
    query: clip(query, 120),
    status: res ? res.status : 0,
    token: h.get("x-relay-token") ? "present" : "absent",
    ua: clip(h.get("user-agent"), 160),
    referer: clip(h.get("referer"), 160),
    origin: clip(h.get("origin"), 120),
    country: h.get("cf-ipcountry") || h.get("x-country") || "",
    ip_tag: ctx.ip_tag || "",
    target_host: ctx.target_host || "",
    bytes_read: ctx.bytes_read == null ? "" : ctx.bytes_read,
    truncated: ctx.truncated == null ? "" : ctx.truncated,
    threw: ctx.threw || "",
    ms: Date.now() - started,
  }));
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), { status, headers: JSON_HEADERS });
}

async function sha256hex(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function ctEqual(a, b) {
  const ha = await sha256hex(String(a == null ? "" : a));
  const hb = await sha256hex(String(b == null ? "" : b));
  let out = 0;
  for (let i = 0; i < ha.length; i++) out |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return out === 0;
}

function withTimeout(p, ms) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
  ]);
}

async function handle(request, ctx) {
  const RELAY_TOKEN = Deno.env.get("RELAY_TOKEN");

  if (request.method === "GET") {
    return json({
      service: "hs-verify-relay",
      host: "deno-deploy",
      // 2026-08-25: 自分がどの版かを、外から見えるところに書く。
      //   記録(hs-relay-req)がログに出ないとき、
      //   「コードが古い」のか「ログの仕組みが止まっている」のかを、
      //   コンソールを読まずに切り分けるため。
      //   版を上げたら、ここも上げる。
      build: "2026-08-25.reqlog.1",
      request_log: "hs-relay-req",
      purpose:
        "Cross-provider probe relay for the HORIZON SHIELD verification gate. The gate, a " +
        "Cloudflare Worker, cannot make subrequests to its own zone over HTTP (they fail with 522), " +
        "so it cannot measure itself. This relay runs off Cloudflare, on the public edge, and " +
        "performs those probes over the public internet, so the gate measures the same path any " +
        "outside client uses. It is not an open proxy: it authenticates its caller and fetches " +
        "nothing outside the " + ALLOWED_ZONE + " zone. Verdicts produced through it carry a " +
        "probed_via field saying so.",
    });
  }

  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  if (!RELAY_TOKEN) {
    return json({ error: "relay_not_configured", note: "RELAY_TOKEN env var is not set on this deployment." }, 503);
  }

  const token = request.headers.get("x-relay-token") || "";
  if (!(await ctEqual(token, RELAY_TOKEN))) {
    return json({ error: "forbidden" }, 403);
  }

  let body;
  try { body = await request.json(); }
  catch (_e) { return json({ error: "invalid_json" }, 400); }

  let u;
  try { u = new URL(body && body.url); }
  catch (_e) { return json({ error: "invalid_url" }, 400); }
  if (u.protocol !== "https:") return json({ error: "https_only" }, 400);

  const h = u.hostname;
  if (!(h === ALLOWED_ZONE || h.endsWith("." + ALLOWED_ZONE))) {
    return json({
      error: "target_not_allowed",
      note: "This relay exists solely so the gate can measure its own zone over the public edge. It fetches nothing else.",
    }, 403);
  }

  ctx.target_host = h;

  const method = body.method === "POST" ? "POST" : "GET";
  const headers = (body.headers && typeof body.headers === "object") ? body.headers : {};
  const init = { method: method, headers: headers };
  if (method === "POST") {
    init.body = typeof body.body === "string" ? body.body : JSON.stringify(body.body || {});
  }

  let res;
  try {
    res = await withTimeout(fetch(u.toString(), init), TIMEOUT_MS);
  } catch (e) {
    // 中継から相手に届かなかった。相手側の到達性の事実であり、中継自体の故障と区別して返す。
    return json({ relayed: false, error: "target_fetch_failed", message: String((e && e.message) || e) }, 502);
  }

  const capped = await readCapped(res, MAX_BODY);
  ctx.bytes_read = capped.bytes_read;
  ctx.truncated = capped.truncated;

  return json({
    relayed: true,
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") || "" },
    body: capped.text,
    body_cap: MAX_BODY,
    body_bytes_read: capped.bytes_read,
    body_truncated: capped.truncated,
    body_declared_length: capped.declared_length,
  });
}

// 2026-08-24: ここは res.text() で全部受け取ってから 256KB に切っていた。
//   返す量は減るが、受け取る量は1バイトも減らない。
//   このファイルの冒頭には「応答本文は 256KB で打ち切り」と書いてあった。
//   嘘ではない。ただ、守っていたのは出口だけで、入口には門が無かった。
//   1日 289 リクエストに対して受信 2.6GiB という値が出て、初めて見えた。
//   落ちない。例外も出ない。ただ、通信量だけが増え続ける。
//
//   本文は読みながら数え、上限に達したら読むのをやめて相手との接続を切る。
//   何バイト受け取ったか、相手が何バイトと名乗っていたか、打ち切ったかどうかを、
//   返事に書く。測ったことと、測れなかったことを分けるためである。
async function readCapped(res, max) {
  const declared = Number(res.headers.get("content-length") || 0) || null;
  if (!res.body) {
    let t = "";
    try { t = await res.text(); } catch (_e) { t = ""; }
    const cut = t.length > max;
    return { text: cut ? t.slice(0, max) : t, truncated: cut,
             declared_length: declared, bytes_read: t.length };
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0, truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (total + value.byteLength > max) {
        chunks.push(value.subarray(0, max - total));
        total = max;
        truncated = true;
        try { await reader.cancel(); } catch (_e) {}
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } catch (_e) {
    // 途中で切れた。受け取れたところまでを返し、打ち切りとは区別しない。
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
  return { text: new TextDecoder().decode(buf), truncated,
           declared_length: declared, bytes_read: total };
}

// 記録は応答の邪魔をしない。記録に失敗しても、返すものは返す。
// 逆に、handle が投げても記録は残す。落ちた回だけ記録が消えるのでは、
// 一番知りたい回が見えない。
Deno.serve(async (request, info) => {
  const started = Date.now();
  const ctx = {};
  try { ctx.ip_tag = await ipTag(info); } catch (_e) {}
  let res;
  try {
    res = await handle(request, ctx);
  } catch (e) {
    ctx.threw = String((e && e.message) || e);
    res = json({ error: "relay_internal_error" }, 500);
  }
  try { await logRequest(request, info, res, ctx, started); } catch (_e) {}
  return res;
});
