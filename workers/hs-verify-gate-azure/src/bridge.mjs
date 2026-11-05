// bridge.mjs  Azure Functions(v4 の Node のプログラムの形)の HTTP と timer を、Workers の fetch(request, env, ctx) と
// scheduled(event, env, ctx) に渡す。@azure/functions にも storage にも依存しない(要求と worker と env は注入)ので、
// host が無くても関数を直に呼んで試せる。
//
// やる事:
//   1. Functions の HttpRequest を Web の Request にする。client の IP を cf-connecting-ip に入れる(worker が読む名)
//   2. ctx.waitUntil の promise を集め、応答の本文を読み切った後、返す前に全部待つ。Functions は関数が返った後の仕事を
//      走らせ続ける約束をしていないので、待たずに返すと使用の数の書き込みや cron の掃引が途中で止まり得る
//   3. Web の Response を Functions の HttpResponseInit にする(本文はバイトのまま)
//   4. timer の起動を scheduled({cron, scheduledTime}) にする。cron は Cloudflare の SWEEP_CRONS と同じ綴り

// client の IP。Functions の前の front end は X-Forwarded-For に "ip:port" の形で client を足す。客が自分で送った
// X-Forwarded-For が前に付き得るので、最後の 1 つを使う。客が送った cf-connecting-ip は捨てる(名乗りを信じない)。
export function clientIp(xff) {
  if (!xff) return null;
  const parts = String(xff).split(",").map((s) => s.trim()).filter(Boolean);
  let v = parts.length ? parts[parts.length - 1] : "";
  const b = /^\[([0-9a-fA-F:.]+)\](?::\d+)?$/.exec(v);           // [IPv6]:port
  if (b) v = b[1];
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(v)) v = v.slice(0, v.lastIndexOf(":"));   // IPv4:port
  return /^[0-9a-fA-F:.]{2,45}$/.test(v) ? v : null;
}

export async function toWebRequest(req) {
  const method = String(req.method || "GET").toUpperCase();
  const headers = new Headers();
  for (const [k, v] of req.headers) {
    try { headers.append(k, v); } catch (_e) { /* Request が持てない header は捨てる */ }
  }
  headers.delete("cf-connecting-ip");
  const ip = clientIp(headers.get("x-forwarded-for"));
  if (ip) headers.set("cf-connecting-ip", ip);
  let body;
  if (method !== "GET" && method !== "HEAD") {
    const ab = await req.arrayBuffer();
    if (ab && ab.byteLength) body = new Uint8Array(ab);
  }
  return new Request(req.url, { method, headers, body });
}

export async function toFunctionsResponse(webRes, method) {
  const headers = {};
  webRes.headers.forEach((v, k) => { headers[k] = v; });
  const status = webRes.status;
  if (status === 204 || status === 304 || method === "HEAD" || webRes.body === null) {
    if (webRes.body) await webRes.arrayBuffer();
    return { status, headers };
  }
  return { status, headers, body: new Uint8Array(await webRes.arrayBuffer()) };
}

function makeCtx(log) {
  const pending = [];
  const ctx = {
    waitUntil(p) { pending.push(Promise.resolve(p).catch((e) => log("waitUntil failed: " + String((e && e.message) || e).slice(0, 300)))); },
    passThroughOnException() {},
  };
  // 待っている間に新しい waitUntil が足され得るので、空になるまで待つ。
  const drain = async () => { while (pending.length) await pending.shift(); };
  return { ctx, drain };
}
const logOf = (context) => (msg) => { try { (context && context.error ? context.error : console.error).call(context, msg); } catch (_e) { /* log が無い時は捨てる */ } };

export async function runHttp(worker, env, req, context) {
  const log = logOf(context);
  const { ctx, drain } = makeCtx(log);
  try {
    const request = await toWebRequest(req);
    const webRes = await worker.fetch(request, env, ctx);
    const out = await toFunctionsResponse(webRes, request.method);
    await drain();
    return out;
  } catch (e) {
    log("gate handler error: " + String((e && e.message) || e).slice(0, 300));
    await drain();
    return { status: 500, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: "internal" }) };
  }
}

// Cloudflare の SWEEP_CRONS は "0 18 * * *" から "0 21 * * *"。timer はその時刻(UTC)に起きるので、起きた時刻を時に切り捨て、
// 同じ綴りの cron と、その時刻の scheduledTime を渡す。遅れて起きた時(isPastDue)も同じ時の回として渡す。
export function scheduledEventFor(nowMs) {
  const hour = Math.floor(nowMs / 3600000) * 3600000;
  return { type: "scheduled", cron: "0 " + new Date(hour).getUTCHours() + " * * *", scheduledTime: hour };
}

export async function runTimer(worker, env, timer, context, nowMs = Date.now()) {
  const log = logOf(context);
  const { ctx, drain } = makeCtx(log);
  const event = scheduledEventFor(nowMs);
  await worker.scheduled(event, env, ctx);
  await drain();
  return { event, past_due: !!(timer && timer.isPastDue) };
}
