/* hs-kira-line: the global lesson book is one key per lesson (concurrency audit K1, 2026-10-13).
   Offline, no network: the real worker, with KV and fetch mocked.

   Before: kira_lessons:global was one JSON list, read and written back by the AI auto add of every group's webhook
   and by the owner's おぼえて / わすれて. Two writers in flight at once lost a lesson, or wrote back a lesson the
   owner had just deleted.
   After: every new lesson is its own key kira_lesson:<id>; the old list is read only (never rewritten); a lesson
   that exists only in the old list is deleted with a tombstone kira_lesson_del:<sha256(text) 32 hex>.

   The fake KV has a barrier on puts of lesson keys (kira_lessons:global in the old code, kira_lesson:* and
   kira_lesson_del:* in the new): the first writer waits until the second has also read and is about to write, so
   both writes are based on the same state. Every "fix" check fails on 4dc7e373 and passes after the fix. The
   "guard" checks pin behaviour that must not change (read failures are reported, never treated as empty).

   node workers/hs-kira-line/lessons_perkey_test.mjs
*/
import crypto from "node:crypto";
import W from "./src/worker.js";

let fail = 0, checks = 0, guards = 0;
function check(label, cond, detail) {
  checks++;
  console.log((cond ? "  ok   " : "  NG   ") + label + (detail ? "  " + detail : ""));
  if (!cond) fail++;
}
function guard(label, cond, detail) {
  guards++;
  console.log((cond ? "  ok   " : "  NG   ") + "[guard] " + label + (detail ? "  " + detail : ""));
  if (!cond) fail++;
}

const SECRET = "test-channel-secret";
const OWNER = "U" + "c".repeat(32);
const GID1 = "C" + "a".repeat(32);
const GID2 = "C" + "d".repeat(32);
const UID = "U" + "b".repeat(32);
const QUOTE_ACK = "ご返信ありがとうございます。内容を確認して、担当の大賀からあらためてお返事します。";
const sha32 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, 32);

// barrier(n): puts of lesson keys wait until n writers have arrived (or 2 s), then all go on.
function makeEnv(opts) {
  const o = opts || {};
  const kv = new Map();
  const meta = new Map();
  const puts = [];
  let arrived = 0, waiters = [];
  const release = () => { const w = waiters; waiters = []; for (const r of w) r(); };
  return {
    LINE_CHANNEL_SECRET: SECRET, LINE_CHANNEL_TOKEN: "tok", LINE_USER_ID: OWNER, KIRA_BRIDGE_KEY: "bk", ANTHROPIC_API_KEY: "test-not-a-key",
    KIRA_SET_WAIT_MS: "1",
    _kv: kv, _puts: puts, _meta: meta,
    SEEN_STORE: {
      get: async (k) => {
        if (o.failGet && o.failGet(k)) throw new Error("KV get failed (test)");
        return kv.has(k) ? kv.get(k) : null;
      },
      put: async (k, v, popts) => {
        if (o.barrier && k.startsWith("kira_lesson")) {
          arrived++;
          if (arrived < o.barrier) await new Promise((r) => { waiters.push(r); setTimeout(() => { release(); }, 2000); });
          else release();
        }
        puts.push({ k, v, opts: popts || {} });
        kv.set(k, v);
        if (popts && popts.metadata) meta.set(k, popts.metadata); else meta.delete(k);
      },
      delete: async (k) => { kv.delete(k); meta.delete(k); },
      list: async (q) => {
        const p = (q && q.prefix) || "";
        if (o.failList && o.failList(p)) throw new Error("KV list failed (test)");
        return { list_complete: true, keys: [...kv.keys()].filter((k) => k.startsWith(p)).sort().map((name) => (meta.has(name) ? { name, metadata: meta.get(name) } : { name })) };
      },
    },
  };
}
// The merged view a reader sees: old list minus tombstones, then kira_lesson:* in key order.
async function visible(env) {
  const blob = JSON.parse(env._kv.get("kira_lessons:global") || "[]");
  const dels = new Set([...env._kv.keys()].filter((k) => k.startsWith("kira_lesson_del:")).map((k) => k.slice("kira_lesson_del:".length)));
  const out = blob.filter((l) => !dels.has(sha32(l.t)));
  for (const k of [...env._kv.keys()].filter((k) => k.startsWith("kira_lesson:")).sort()) out.push(JSON.parse(env._kv.get(k)));
  return out;
}
const texts = async (env) => (await visible(env)).map((l) => l.t);
const lessonPuts = (env) => env._puts.filter((p) => p.k.startsWith("kira_lesson"));

function sign(body) { return crypto.createHmac("sha256", SECRET).update(body).digest("base64"); }
async function send(env, events) {
  const body = JSON.stringify({ events });
  const waits = [];
  const res = await W.fetch(new Request("https://x/webhook", { method: "POST", headers: { "content-type": "application/json", "x-line-signature": sign(body) }, body }), env, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return res;
}

let calls = [];
// The decision mock reads the incoming text (【いま届いた発言】) and files one global lesson named after it.
globalThis.fetch = async (url, init) => {
  const u = String(url);
  let body = null; try { body = JSON.parse((init && init.body) || "null"); } catch (_e) { body = null; }
  calls.push({ url: u, body });
  if (u.includes("/kira-bridge")) return new Response(JSON.stringify({ ok: true, reply: "", kind: "other" }), { status: 200 });
  if (u.includes("api.anthropic.com")) {
    const ctx = String((body && body.messages && body.messages[0] && body.messages[0].content) || "");
    const m = ctx.match(/【いま届いた発言】\n[\s\S]*?覚え書き([A-Z])/);
    const tag = m ? m[1] : "X";
    const d = { action: "reply", reply: "ありがとうございます。", reason: "-", lessons: [{ scope: "global", text: "話し方の覚え書き" + tag }] };
    return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(d) }] }), { status: 200 });
  }
  return new Response("{}", { status: 200 });
};
const replies = () => calls.filter((c) => c.url.includes("/v2/bot/message/reply"));
const replyText = (i) => { const r = replies()[i || 0]; return (r && r.body && r.body.messages[0].text) || ""; };
const pushes = () => calls.filter((c) => c.url.includes("/v2/bot/message/push"));
const ownerSaid = (s) => pushes().filter((c) => c.body && c.body.to === OWNER).some((c) => c.body.messages[0].text.includes(s));
const decideCalls = () => calls.filter((c) => c.url.includes("api.anthropic.com") && String((c.body && c.body.system) || "").includes("加盟店さん(施工会社"));
const mid = (p) => p + Math.random().toString(36).slice(2);
const groupAt = (gid, text) => ({
  type: "message", replyToken: "rt_" + mid(""), source: { type: "group", groupId: gid, userId: UID },
  message: { type: "text", id: mid("g"), text, mention: { mentionees: [{ index: 0, length: 15, type: "user", isSelf: true }] } },
});
const ownerMsg = (text) => ({ type: "message", replyToken: "rt_" + mid(""), source: { type: "user", userId: OWNER }, message: { type: "text", id: mid("o"), text } });
const OLD = [{ t: "古い覚え書き1", at: "2026-10-01T00:00:00.000Z", by: "owner" }, { t: "古い覚え書き2", at: "2026-10-02T00:00:00.000Z", by: "owner" }];
const seedOld = (env) => { env._kv.set("kira_lessons:global", JSON.stringify(OLD)); env._kv.set("kira_global_swept:v20", "1"); };

console.log("\n1) two groups add a global lesson at the same time: both are kept");
{
  const env = makeEnv({ barrier: 2 });
  seedOld(env);
  env._kv.set("groupPartner:" + GID1, "1"); env._kv.set("groupPartner:" + GID2, "1");
  calls = [];
  await Promise.all([send(env, [groupAt(GID1, "@HORIZON SHIELD 覚え書きA について")]), send(env, [groupAt(GID2, "@HORIZON SHIELD 覚え書きB について")])]);
  guard("both webhooks decided", decideCalls().length === 2, String(decideCalls().length));
  const v = await texts(env);
  check("both lessons are in the book (count 4 = 2 old + 2 new)", v.length === 4 && v.includes("話し方の覚え書きA") && v.includes("話し方の覚え書きB"), JSON.stringify(v));
  check("the old list was not rewritten", env._kv.get("kira_lessons:global") === JSON.stringify(OLD) && !env._puts.some((p) => p.k === "kira_lessons:global"));
  check("each new lesson is its own key kira_lesson:<id>", [...env._kv.keys()].filter((k) => k.startsWith("kira_lesson:")).length === 2);
  const withMeta = lessonPuts(env).filter((p) => p.opts.metadata && p.opts.metadata.t && p.opts.metadata.by === "kira");
  check("the lesson text and author ride in the key's metadata", withMeta.length === 2, String(withMeta.length));
  const ids = [...env._kv.keys()].filter((k) => k.startsWith("kira_lesson:")).map((k) => k.slice("kira_lesson:".length));
  check("ids are time ordered then random (digits-rand)", ids.length === 2 && ids.every((id) => /^[0-9]{14}-[0-9a-z]{6,}$/.test(id)), JSON.stringify(ids));
}

console.log("\n2) the owner deletes a lesson while a group adds one: the deleted lesson stays deleted, the new one is kept");
{
  const env = makeEnv({ barrier: 2 });
  seedOld(env);
  env._kv.set("groupPartner:" + GID1, "1");
  calls = [];
  await Promise.all([send(env, [ownerMsg("わすれて 1")]), send(env, [groupAt(GID1, "@HORIZON SHIELD 覚え書きC について")])]);
  const v = await texts(env);
  check("book is [old2, C]: nothing lost, nothing resurrected", JSON.stringify(v) === JSON.stringify(["古い覚え書き2", "話し方の覚え書きC"]), JSON.stringify(v));
  check("a lesson that only existed in the old list is deleted by a tombstone key", env._kv.has("kira_lesson_del:" + sha32("古い覚え書き1")));
  check("the old list itself was not rewritten", env._kv.get("kira_lessons:global") === JSON.stringify(OLD));
  guard("the owner was told what was deleted", replies().some((r) => r.body.messages[0].text === "消しました: 古い覚え書き1"));
}

console.log("\n3) owner commands on the merged book: 経験帳 numbers, おぼえて adds a key, わすれて removes a key");
{
  const env = makeEnv();
  seedOld(env);
  calls = [];
  await send(env, [ownerMsg("おぼえて 新しい覚え書き")]);
  guard("おぼえて answers with the count", replyText() === "経験帳に足しました(全体 3 件)。", replyText());
  check("おぼえて wrote a kira_lesson:<id> key with by owner, not the old list", lessonPuts(env).length === 1 && lessonPuts(env)[0].k.startsWith("kira_lesson:") && JSON.parse(lessonPuts(env)[0].v).by === "owner" && !env._puts.some((p) => p.k === "kira_lessons:global"));
  calls = [];
  await send(env, [ownerMsg("経験帳")]);
  guard("経験帳 lists old then new, numbered", replyText().startsWith("【経験帳 全体 3 件】\n1. 古い覚え書き1(大賀)\n2. 古い覚え書き2(大賀)\n3. 新しい覚え書き(大賀)"), replyText());
  calls = [];
  await send(env, [ownerMsg("わすれて 3")]);
  guard("わすれて 3 deletes the per-key lesson", replyText() === "消しました: 新しい覚え書き" && (await texts(env)).length === 2, replyText());
  guard("the per-key lesson is gone from KV (no tombstone needed)", ![...env._kv.keys()].some((k) => k.startsWith("kira_lesson:")) && ![...env._kv.keys()].some((k) => k.startsWith("kira_lesson_del:")));
  calls = [];
  await send(env, [ownerMsg("わすれて 2")]);
  guard("わすれて 2 deletes an old-list lesson", replyText() === "消しました: 古い覚え書き2");
  check("deleting an old-list lesson writes a tombstone and leaves the list bytes alone", env._kv.has("kira_lesson_del:" + sha32("古い覚え書き2")) && env._kv.get("kira_lessons:global") === JSON.stringify(OLD));
  calls = [];
  await send(env, [ownerMsg("経験帳")]);
  guard("経験帳 after deletes shows 1", replyText().startsWith("【経験帳 全体 1 件】\n1. 古い覚え書き1(大賀)"), replyText());
  // KIRA reads the same merged book: the deleted old lesson is not in its context, the kept one is.
  env._kv.set("groupPartner:" + GID1, "1");
  calls = [];
  await send(env, [groupAt(GID1, "@HORIZON SHIELD 覚え書きD について")]);
  const ctx = String(decideCalls()[0].body.messages[0].content);
  check("KIRA's context has the kept old lesson and not the deleted one", ctx.includes("古い覚え書き1") && !ctx.includes("古い覚え書き2"));
  guard("the auto add dedupes against the merged book", (await texts(env)).filter((t) => t === "話し方の覚え書きD").length === 1);
  calls = [];
  await send(env, [groupAt(GID1, "@HORIZON SHIELD 覚え書きD について")]);
  guard("the same lesson twice is filed once", (await texts(env)).filter((t) => t === "話し方の覚え書きD").length === 1 && (await texts(env)).length === 2);
}

console.log("\n4) the cap (40) prunes the oldest without rewriting the old list");
{
  const env = makeEnv();
  const many = []; for (let i = 1; i <= 40; i++) many.push({ t: "覚え書き番号" + String(i).padStart(2, "0"), at: "2026-10-0" + (1 + (i % 9)) + "T00:00:00.000Z", by: "owner" });
  env._kv.set("kira_lessons:global", JSON.stringify(many)); env._kv.set("kira_global_swept:v20", "1");
  calls = [];
  await send(env, [ownerMsg("おぼえて 四十一番目")]);
  const v = await texts(env);
  guard("40 stay visible, the oldest is gone, the new one is last", v.length === 40 && v[0] === "覚え書き番号02" && v[39] === "四十一番目", v[0] + " .. " + v[39]);
  check("the oldest was pruned with a tombstone; the old list bytes are untouched", env._kv.has("kira_lesson_del:" + sha32("覚え書き番号01")) && env._kv.get("kira_lessons:global") === JSON.stringify(many));
}

console.log("\n5) read failures are still reported, never treated as an empty book");
{
  const env = makeEnv({ failGet: (k) => k === "kira_lessons:global" });
  seedOld(env);
  calls = [];
  await send(env, [ownerMsg("おぼえて 新しい覚え書き")]);
  guard("old list unreadable: おぼえて writes nothing and says so", replyText().includes("経験帳を今は読み込めませんでした") && replyText().includes("何も変えていません") && lessonPuts(env).length === 0, replyText());
  calls = [];
  await send(env, [ownerMsg("わすれて 1")]);
  guard("old list unreadable: わすれて deletes nothing", replyText().includes("経験帳を今は読み込めませんでした") && lessonPuts(env).length === 0 && !env._kv.has("kira_lesson_del:" + sha32("古い覚え書き1")), replyText());
  const env2 = makeEnv({ failList: (p) => p === "kira_lesson:" });
  seedOld(env2);
  calls = [];
  await send(env2, [ownerMsg("おぼえて 新しい覚え書き")]);
  check("per-key list unreadable: おぼえて writes nothing and says so", replyText().includes("経験帳を今は読み込めませんでした") && lessonPuts(env2).length === 0, replyText());
  calls = [];
  await send(env2, [ownerMsg("経験帳")]);
  check("per-key list unreadable: 経験帳 never shows a partial book", replyText().includes("経験帳を今は読み込めませんでした") && !replyText().includes("古い覚え書き1"), replyText());
  env2._kv.set("groupPartner:" + GID1, "1");
  calls = [];
  await send(env2, [groupAt(GID1, "@HORIZON SHIELD 覚え書きE について")]);
  check("per-key list unreadable in a group: KIRA does not decide, the owner is told", decideCalls().length === 0 && ownerSaid("経験帳か会話を今は読み込めなかった"), String(decideCalls().length));
  calls = [];
  const envFail = makeEnv({ failList: (p) => p === "kira_lesson:" });
  seedOld(envFail);
  envFail._kv.set("partner:" + UID, JSON.stringify({ since: 1, groupId: GID1 }));
  await send(envFail, [{ type: "message", replyToken: "rt_dm", source: { type: "user", userId: UID }, message: { type: "text", id: mid("t"), text: "覚え書きF について" } }]);
  check("per-key list unreadable in a 1 to 1: neutral receipt only", decideCalls().length === 0 && replyText() === QUOTE_ACK, replyText().slice(0, 40));
}

console.log("\n6) version and /health marker");
{
  const r = await W.fetch(new Request("https://x/health"), makeEnv(), { waitUntil: () => {} });
  const j = await r.json();
  check("/health version is v27-quota-20261106", j.version === "v27-quota-20261106", j.version);
  check("/health lessons is per-key-20261013", j.lessons === "per-key-20261013", String(j.lessons));
}

console.log("\nchecks: " + checks + ", guards: " + guards + ", failed: " + fail);
const EXPECT = 18, EXPECT_GUARDS = 13;
if (checks < EXPECT || guards < EXPECT_GUARDS) { console.log("fewer checks than expected (" + EXPECT + " + " + EXPECT_GUARDS + " guards)"); fail++; }
console.log(fail ? "per-key lesson checks FAILED" : "per-key lesson checks all passed");
process.exit(fail ? 1 : 0);
