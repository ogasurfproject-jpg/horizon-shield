// hs-outreach : HORIZON SHIELD 加盟店アウトリーチ送信Worker
// 番人設計。完全自動。ただし機械ゲート4枚で「本物のスパムにならない」を強制する:
//   (1)ウォームアップ上限  (2)抑制リスト(opt-out/bounce)  (3)特定電子メール法の表示義務  (4)バウンス率で自動停止(kill-switch)
// 初期は DRY_RUN=true(shadow) = 送信先を TEST_INBOX に差し替え。中身を見て納得したら env で false に倒す。
// 送信は brain(毎日のscheduledタスク)が /enqueue で積んだキューを、この hand が業務時間に throttle して掃く。

const RESEND = "https://api.resend.com/emails";

// ---- 小物 ----
const j = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json; charset=utf-8" } });
const html = (b, s = 200) => new Response(b, { status: s, headers: { "content-type": "text/html; charset=utf-8" } });
const enc = new TextEncoder();

function jstDate(d = new Date()) {
  const t = new Date(d.getTime() + 9 * 3600 * 1000);
  return t.toISOString().slice(0, 10); // YYYY-MM-DD (JST)
}

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
async function ctEq(a, b) {
  const ha = await crypto.subtle.digest("SHA-256", enc.encode(String(a)));
  const hb = await crypto.subtle.digest("SHA-256", enc.encode(String(b)));
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let o = 0; for (let i = 0; i < x.length; i++) o |= x[i] ^ y[i]; return o === 0;
}
const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e || "");

// ---- ウォームアップ表(1日の上限。カレンダー日数で漸増) ----
function warmupCap(startISO, override) {
  if (override && Number(override) > 0) return Number(override);
  const sched = [5, 5, 5, 7, 7, 7, 10, 10, 10, 13, 13, 13, 16, 16, 16, 20];
  const start = startISO ? new Date(startISO + "T00:00:00Z").getTime() : Date.now();
  const days = Math.max(0, Math.floor((Date.now() - start) / 86400000));
  return sched[Math.min(days, sched.length - 1)];
}

// ---- 状態 ----
async function getState(env) {
  const raw = await env.OUTREACH_DATA.get("state");
  return raw ? JSON.parse(raw) : { warmupStart: jstDate(), paused: false, bounces: 0, sentTotal: 0 };
}
const putState = (env, s) => env.OUTREACH_DATA.put("state", JSON.stringify(s));
const todayKey = () => "sent:" + jstDate();
async function todayCount(env) { return Number((await env.OUTREACH_DATA.get(todayKey())) || 0); }
async function bumpToday(env) {
  const n = (await todayCount(env)) + 1;
  await env.OUTREACH_DATA.put(todayKey(), String(n), { expirationTtl: 60 * 60 * 24 * 3 });
  return n;
}

// ---- 抑制/台帳 ----
const suppKey = (e) => "supp:" + e.toLowerCase();
const ledgerKey = (e) => "sent:addr:" + e.toLowerCase();
async function isSuppressed(env, e) { return !!(await env.OUTREACH_DATA.get(suppKey(e))); }
async function alreadySent(env, e) { return !!(await env.OUTREACH_DATA.get(ledgerKey(e))); }
async function suppress(env, e, reason) {
  await env.OUTREACH_DATA.put(suppKey(e), JSON.stringify({ reason, ts: Date.now() }));
}

// ---- 1通の送信 ----
async function sendOne(env, item) {
  const to = item.email;
  const token = await hmac(env.UNSUB_SECRET, to);
  const unsubUrl = `${env.PUBLIC_BASE}/unsubscribe?e=${encodeURIComponent(to)}&t=${token}`;

  // 法令表示: 送信者ブロック + 配信停止導線を必ず本文末尾に付ける(brainが入れ忘れても hand が担保)
  const senderBlock = env.SENDER_BLOCK || "The HORIZONs株式会社 / HORIZON SHIELD";
  const footer = `<hr><p style="font-size:12px;color:#888;line-height:1.6">${senderBlock}<br>` +
    `本メールは貴社が公開されている事業用連絡先に、加盟のご案内としてお送りしています。` +
    `今後の配信を停止する場合は<a href="${unsubUrl}">こちら</a>（ワンクリック）。返信でも承ります。</p>`;
  const bodyHtml = (item.html || "") + footer;
  const bodyText = (item.text || "") + `\n\n----\n${senderBlock}\n配信停止: ${unsubUrl}`;

  // shadow: 送信先を差し替え、件名に本来の宛先を明示
  const dry = String(env.DRY_RUN) !== "false";
  const realTo = dry ? env.TEST_INBOX : to;
  const subject = dry ? `[SHADOW→${to}] ${item.subject}` : item.subject;

  const payload = {
    from: env.FROM_ADDRESS,
    to: [realTo],
    reply_to: env.REPLY_TO || undefined,
    subject,
    html: bodyHtml,
    text: bodyText,
    headers: {
      "List-Unsubscribe": `<${unsubUrl}>, <mailto:${env.UNSUB_MAILBOX || "unsubscribe@" + (env.FROM_ADDRESS.split("@")[1] || "").replace(/>$/, "")}?subject=unsubscribe>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
  if (env.PDF_URL) payload.attachments = [{ path: env.PDF_URL, filename: env.PDF_FILENAME || "HORIZON_SHIELD_加盟のご案内.pdf" }];

  const r = await fetch(RESEND, {
    method: "POST",
    headers: { authorization: "Bearer " + env.RESEND_API_KEY, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const ok = r.status >= 200 && r.status < 300;
  const res = await r.json().catch(() => ({}));
  return { ok, status: r.status, id: res.id, res };
}

// ---- 毎回の掃き出し(cronから) ----
async function drain(env, ctx) {
  const st = await getState(env);
  if (st.paused) return { skipped: "paused" };

  const cap = warmupCap(st.warmupStart, env.DAILY_CAP_OVERRIDE);
  const done = await todayCount(env);
  const remaining = cap - done;
  if (remaining <= 0) return { skipped: "daily_cap_reached", cap, done };

  const perRun = Math.min(remaining, Number(env.PER_RUN_MAX || 3));
  const list = await env.OUTREACH_QUEUE.list({ limit: perRun * 4 });
  let sent = 0; const log = [];

  for (const k of list.keys) {
    if (sent >= perRun) break;
    const raw = await env.OUTREACH_QUEUE.get(k.name);
    if (!raw) continue;
    let item; try { item = JSON.parse(raw); } catch { await env.OUTREACH_QUEUE.delete(k.name); continue; }
    const e = (item.email || "").trim();

    // ゲート: 形式・重複・抑制
    if (!validEmail(e)) { await env.OUTREACH_QUEUE.delete(k.name); log.push({ e, drop: "invalid" }); continue; }
    if (await isSuppressed(env, e)) { await env.OUTREACH_QUEUE.delete(k.name); log.push({ e, drop: "suppressed" }); continue; }
    if (await alreadySent(env, e)) { await env.OUTREACH_QUEUE.delete(k.name); log.push({ e, drop: "dup" }); continue; }

    const out = await sendOne(env, item);
    if (out.ok) {
      await env.OUTREACH_DATA.put(ledgerKey(e), JSON.stringify({ status: "sent", ts: Date.now(), id: out.id, company: item.company || "" }));
      await env.OUTREACH_QUEUE.delete(k.name);
      await bumpToday(env);
      st.sentTotal = (st.sentTotal || 0) + 1;
      sent++; log.push({ e, sent: true, id: out.id });
    } else {
      // 送信API失敗はキューに残す(次回再試行)。ただし連続失敗の暴走は避けるため retry カウント
      item._retry = (item._retry || 0) + 1;
      if (item._retry >= 3) { await env.OUTREACH_QUEUE.delete(k.name); log.push({ e, drop: "retry_exhausted", status: out.status }); }
      else { await env.OUTREACH_QUEUE.put(k.name, JSON.stringify(item)); log.push({ e, fail: out.status }); }
    }
  }
  await putState(env, st);
  return { cap, done: done + sent, perRun, sent, log };
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(drain(env, ctx));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    const admin = async () => {
      const t = url.searchParams.get("token") || (request.headers.get("authorization") || "").replace("Bearer ", "");
      return env.ADMIN_TOKEN && await ctEq(t, env.ADMIN_TOKEN);
    };

    // 配信停止(公開・トークン検証)
    if (p === "/unsubscribe") {
      const e = (url.searchParams.get("e") || "").trim();
      const t = url.searchParams.get("t") || "";
      if (!validEmail(e) || !(await ctEq(t, await hmac(env.UNSUB_SECRET, e)))) return html("<p>リンクが無効です。</p>", 400);
      await suppress(env, e, "optout");
      return html("<h2>配信を停止しました。</h2><p>今後このアドレスへHORIZON SHIELDから加盟のご案内をお送りすることはありません。ご確認ありがとうございました。</p>");
    }

    // Resend webhook(bounce/complaint → 抑制 + 率で自動停止)
    if (p === "/webhook/resend" && request.method === "POST") {
      if (env.WEBHOOK_SECRET && url.searchParams.get("s") !== env.WEBHOOK_SECRET) return j({ error: "unauthorized" }, 401);
      const ev = await request.json().catch(() => ({}));
      const type = ev.type || "";
      const addr = ev.data?.to?.[0] || ev.data?.email || "";
      if (/bounce|complaint|spam/i.test(type) && validEmail(addr)) {
        await suppress(env, addr, type);
        const st = await getState(env);
        st.bounces = (st.bounces || 0) + 1;
        // バウンス+苦情が閾値(既定8)を超えたら全停止。人がいないぶん機械が手を止める。
        const thr = Number(env.BOUNCE_PAUSE_THRESHOLD || 8);
        if (st.bounces >= thr) st.paused = true;
        await putState(env, st);
      }
      return j({ ok: true });
    }

    // --- 以下 admin ---
    if (!(await admin())) return j({ error: "unauthorized" }, 401);

    if (p === "/status") {
      const st = await getState(env);
      return j({ ...st, cap_today: warmupCap(st.warmupStart, env.DAILY_CAP_OVERRIDE), sent_today: await todayCount(env), dry_run: String(env.DRY_RUN) !== "false" });
    }
    if (p === "/pause") { const st = await getState(env); st.paused = url.searchParams.get("on") !== "0"; await putState(env, st); return j({ paused: st.paused }); }
    if (p === "/enqueue" && request.method === "POST") {
      const arr = await request.json().catch(() => null);
      if (!Array.isArray(arr)) return j({ error: "array of targets required" }, 400);
      let added = 0, skipped = 0;
      for (const it of arr) {
        const e = (it.email || "").trim().toLowerCase();
        if (!validEmail(e) || !it.subject || !it.html) { skipped++; continue; }
        if (await isSuppressed(env, e) || await alreadySent(env, e)) { skipped++; continue; }
        await env.OUTREACH_QUEUE.put("q:" + e, JSON.stringify({ ...it, email: e, enqueued: Date.now() }));
        added++;
      }
      return j({ added, skipped });
    }
    if (p === "/drain" && request.method === "POST") return j(await drain(env, null)); // 手動掃き出し(検証用)
    if (p === "/suppress" && request.method === "POST") { const e = url.searchParams.get("e"); if (validEmail(e)) { await suppress(env, e, "manual"); return j({ ok: true }); } return j({ error: "email" }, 400); }

    return j({ service: "hs-outreach", routes: ["/unsubscribe", "/webhook/resend", "/status", "/pause", "/enqueue", "/drain", "/suppress"] });
  },
};
