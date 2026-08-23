/* 業種ゲートを、実物の handleKiraBridge を呼んで確かめる。
   KV は模擬。ネットワークには出ない。 */
import fs from "node:fs";

const SRC = "/tmp/hstry/src/hearing.mjs";
let src = fs.readFileSync(SRC, "utf8");
if (!src.includes("export { handleKiraBridge }")) {
  fs.writeFileSync(SRC, src + "\nexport { handleKiraBridge };\n");
}
const H = await import(SRC + "?v=" + Math.random());

globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => "" });

function makeEnv() {
  const kv = new Map();
  return {
    _kv: kv,
    HS_HEARING_KV: {
      get: async (k, type) => {
        if (!kv.has(k)) return null;
        const v = kv.get(k);
        return type === "json" ? JSON.parse(v) : v;
      },
      put: async (k, v) => { kv.set(k, v); },
      delete: async (k) => { kv.delete(k); },
      list: async () => ({ keys: [] }),
    },
  };
}

const U = "U" + "0".repeat(32);
const line = (s) => String(s || "").split("\n")[0].slice(0, 62);
let fail = 0;
function check(label, cond, detail) {
  console.log((cond ? "  ok   " : "  NG   ") + label + (detail ? "  " + detail : ""));
  if (!cond) fail++;
}

/* --- 1. まったくの初回。店を作らず、業種を尋ねる --------------------- */
console.log("1) 新規の方が「加盟店希望」と打った");
{
  const env = makeEnv();
  const r = await H.handleKiraBridge(env, U, "加盟店希望", null, []);
  console.log("     返信: " + line(r.reply));
  check("業種を尋ねている", r.reply.includes("ご業種"));
  check("店をまだ作っていない", ![...env._kv.keys()].some((k) => k.startsWith("store:")),
        "keys=" + [...env._kv.keys()].join(","));
  check("intake が立っている", env._kv.has("intake:" + U));

  /* --- 2. 続けて業種を答える ---------------------------------------- */
  console.log("2) 続けて「訪問看護です」と答えた");
  const r2 = await H.handleKiraBridge(env, U, "訪問看護です", null, []);
  console.log("     返信: " + line(r2.reply));
  const sid = [...env._kv.keys()].find((k) => k.startsWith("store:"));
  const store = sid ? JSON.parse(env._kv.get(sid)) : null;
  check("店ができた", !!store);
  check("業種が nursing", store && store.industry === "nursing", store ? store.industry : "");
  check("訪問看護の最初の3問になっている", r2.reply.includes("対応できる医療処置"));
  check("工種を訊いていない", !r2.reply.includes("工種"));
  check("取り消し文は出さない(この方は建設の質問を見ていない)", !r2.reply.includes("お答えいただかなくて"));
  check("intake は消えた", !env._kv.has("intake:" + U));
}

/* --- 3. 平田様の状況。店はあるが、まだ何も答えていない ---------------- */
console.log("3) 既に建設の店だけ作られていて、まだ何も答えていない相手(本日の平田様)");
{
  const env = makeEnv();
  const sid = "kira-abcd1234";
  env._kv.set("store:" + sid, JSON.stringify({
    store_id: sid, company: "", areas: [], works: [], tier: "honbu",
    status: "onboarding", source: "kira-line", token: "ht_zzzzzzzzzzzz",
    created_at: "2026-08-23T09:50:00Z", autopilot: {},
  }));
  env._kv.set("line2store:" + U, sid);
  const r = await H.handleKiraBridge(env, U, "合同会社あっぷす", null, []);
  console.log("     返信: " + line(r.reply));
  check("工種として取り込まず、業種を尋ねている", r.reply.includes("ご業種"));
  const s = JSON.parse(env._kv.get("store:" + sid));
  check("社名をまだ書き込んでいない", !s.company, "company=" + JSON.stringify(s.company));

  const r2 = await H.handleKiraBridge(env, U, "2", null, []);
  console.log("     返信: " + line(r2.reply));
  check("建設の質問を取り消している", r2.reply.includes("お答えいただかなくて結構です"));
  check("取り違えたと認めている", r2.reply.includes("取り違えました"));
  check("訪問看護の3問に切り替わった", r2.reply.includes("対応できる医療処置"));
  const s2 = JSON.parse(env._kv.get("store:" + sid));
  check("同じ店に業種 nursing が入った", s2.industry === "nursing", s2.industry);
  check("店を二重に作っていない", [...env._kv.keys()].filter((k) => k.startsWith("store:")).length === 1);
}

/* --- 4. 建設と分かる言葉なら、1問を飛ばす --------------------------- */
console.log("4) 「外壁塗装をやっています」といきなり来た");
{
  const env = makeEnv();
  const r = await H.handleKiraBridge(env, U, "外壁塗装をやっています", null, []);
  console.log("     返信: " + line(r.reply));
  check("業種を尋ねずに建設で始めている", !r.reply.includes("ご業種") && r.reply.includes("工種"));
  const sid = [...env._kv.keys()].find((k) => k.startsWith("store:"));
  check("業種が construction", JSON.parse(env._kv.get(sid)).industry === "construction");
}

/* --- 5. 見積書が添えられていれば、尋ねるまでもない -------------------- */
console.log("5) 見積書の写真つきで来た");
{
  const env = makeEnv();
  const r = await H.handleKiraBridge(env, U, "見てください", null, [{ work: "外壁塗装", amount: 1200000, detail: "" }]);
  check("業種を尋ねずに建設で始めている", !r.reply.includes("ご業種"));
  const sid = [...env._kv.keys()].find((k) => k.startsWith("store:"));
  check("業種が construction", JSON.parse(env._kv.get(sid)).industry === "construction");
}

/* --- 6. 判らないものを推測しない ------------------------------------ */
console.log("6) 業種が二度読み取れなかった");
{
  const env = makeEnv();
  await H.handleKiraBridge(env, U, "加盟店希望", null, []);
  const r1 = await H.handleKiraBridge(env, U, "よろしくお願いします", null, []);
  console.log("     1回目: " + line(r1.reply));
  check("もう一度だけ尋ねている", r1.reply.includes("もう一度"));
  const r2 = await H.handleKiraBridge(env, U, "がんばります", null, []);
  console.log("     2回目: " + line(r2.reply));
  check("人に回している", r2.reply.includes("大賀"));
  check("店を作っていない", ![...env._kv.keys()].some((k) => k.startsWith("store:")));
  const it = JSON.parse(env._kv.get("intake:" + U));
  check("handoff として残している", it.state === "handoff", it.state);
}

/* --- 7. 「介護施設の内装工事」のような文を、勝手に決めない ------------ */
console.log("7) 両方の言葉が入った文");
{
  const env = makeEnv();
  await H.handleKiraBridge(env, U, "加盟店希望", null, []);
  const r = await H.handleKiraBridge(env, U, "介護施設の内装工事をやっています", null, []);
  console.log("     返信: " + line(r.reply));
  check("どちらにも決めていない", !r.reply.includes("対応できる医療処置"));
  check("店を作っていない", ![...env._kv.keys()].some((k) => k.startsWith("store:")));
}

/* --- 8. 既に答えている店は、これまでどおり通す ----------------------- */
console.log("8) すでに中身を答えている建設の店(既存の相手に影響が無いこと)");
{
  const env = makeEnv();
  const sid = "kira-old00001";
  env._kv.set("store:" + sid, JSON.stringify({
    store_id: sid, company: "リフォーム職人株式会社", areas: ["平塚市"], works: ["外壁塗装"],
    tier: "honbu", status: "onboarding", source: "kira-line", token: "ht_yyyyyyyyyyyy",
    created_at: "2026-08-01T00:00:00Z", autopilot: {},
  }));
  env._kv.set("line2store:" + U, sid);
  const r = await H.handleKiraBridge(env, U, "屋根の防水もできます", null, []);
  check("業種を尋ね直していない", !r.reply.includes("ご業種"), line(r.reply));
}

console.log("");
console.log(fail ? fail + " 件 失敗" : "業種ゲート すべて通過");
process.exit(fail ? 1 : 0);
