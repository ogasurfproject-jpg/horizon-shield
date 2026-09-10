// hs-hearing: 同じ店への二度押しで、生成の合図が二度飛ばんことを確かめる。
//
// なぜ在るか (2026-09-10)。
// 07:49:22Z と 07:52:19Z、3分差で同じ店(No.001)の生成が二度走った。二度目は頁を
// 一バイトも変えず、manifest の generated_at だけ動かし、
// 「auto-publish 11 verified pages (門を通過)」と名乗る commit を台帳に残し、
// 同じ11本の URL を IndexNow に再送した。公開しとらんものを公開したと名乗る記録が、
// バイトが記録の単位やと言うとる repo に残った。
//
// この試験は src/hearing.js から triggerGeneration をそのまま切り出して回す。
// 書き写した写しは試さん。試すのは、deploy される物と同じバイト列や。
//
// 走らせ方: node dispatch_debounce_test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = process.argv[2] || path.join(HERE, "src", "hearing.js");
const src = readFileSync(SRC, "utf8");
const start = src.indexOf("async function triggerGeneration");
if (start < 0) { console.error("not found"); process.exit(2); }
const end = src.indexOf("\n}\n", start);
const body = src.slice(start, end + 3);
console.log("切り出した行数: " + body.split("\n").length);

const AP = { newsDigest: async () => ({ items: [] }) };
const IND = { industryOf: () => ({ label: "建設", mall: "m", golden_ratio: null }) };

function makeKV(initial) {
  const m = new Map(Object.entries(initial || {}));
  return { m, get: async (k) => (m.has(k) ? m.get(k) : null),
           put: async (k, v) => { m.set(k, v); return { ok: true }; } };
}
let fetchCalls = 0, fetchOk = true;
const fakeFetch = async () => { fetchCalls++; return { ok: fetchOk, status: fetchOk ? 204 : 500 }; };

const make = new Function("AP", "IND", "fetch", body + "\nreturn triggerGeneration;");
const trigger = make(AP, IND, fakeFetch);

const baseEnv = { GH_DISPATCH_TOKEN: "t", GH_DISPATCH_REPO: "o/r" };
const store = { store_id: "s1", industry: "construction", autopilot: {} };
const profile = { company: "c", area: "a", works: ["w"] };
let pass = 0, fail = 0;
const t = (name, cond, detail) => { if (cond) { pass++; console.log("ok   " + name); }
  else { fail++; console.log("NG   " + name + "  " + (detail || "")); } };

// A
fetchCalls = 0; fetchOk = true;
let env = { ...baseEnv, HS_HEARING_KV: makeKV({}) };
let r = await trigger(env, profile, store);
t("印が無ければ合図を出し、印を置く", r.triggered === true && fetchCalls === 1 && env.HS_HEARING_KV.m.has("dispatch:s1"), JSON.stringify(r));

// B
fetchCalls = 0;
env = { ...baseEnv, HS_HEARING_KV: makeKV({ "dispatch:s1": String(Date.now() - 60000) }) };
r = await trigger(env, profile, store);
t("1分前の印があれば止める。合図は出さん", r.triggered === false && r.reason === "debounced" && fetchCalls === 0, JSON.stringify(r));

// C
fetchCalls = 0;
env = { ...baseEnv, HS_HEARING_KV: makeKV({ "dispatch:s1": String(Date.now() - 60000) }) };
r = await trigger(env, profile, store, { force: true });
t("force なら通す(生成器を直した直後の出し直し)", r.triggered === true && fetchCalls === 1, JSON.stringify(r));

// D
fetchCalls = 0;
env = { ...baseEnv, HS_HEARING_KV: makeKV({ "dispatch:s1": String(Date.now() - 20 * 60000) }) };
r = await trigger(env, profile, store);
t("窓の外(20分前)の印は止めん", r.triggered === true && fetchCalls === 1, JSON.stringify(r));

// E
fetchCalls = 0; fetchOk = false;
env = { ...baseEnv, HS_HEARING_KV: makeKV({}) };
r = await trigger(env, profile, store);
t("合図が失敗したら印を置かん(次を塞がん)", r.triggered === false && !env.HS_HEARING_KV.m.has("dispatch:s1"), JSON.stringify(r));
fetchOk = true;

// F
fetchCalls = 0;
env = { ...baseEnv, HS_HEARING_KV: makeKV({}) };
r = await trigger(env, profile, null);
t("店が分からんときは止めん(防げん物を、防げるふりせん)", r.triggered === true && fetchCalls === 1, JSON.stringify(r));

// G
fetchCalls = 0;
env = { ...baseEnv, GEN_DEBOUNCE_MS: 0, HS_HEARING_KV: makeKV({ "dispatch:s1": String(Date.now() - 1000) }) };
r = await trigger(env, profile, store);
t("GEN_DEBOUNCE_MS=0 で仕掛けごと切れる", r.triggered === true && fetchCalls === 1, JSON.stringify(r));

// H
fetchCalls = 0;
env = { ...baseEnv, GEN_DEBOUNCE_MS: "0", HS_HEARING_KV: makeKV({ "dispatch:s1": String(Date.now() - 1000) }) };
r = await trigger(env, profile, store);
t('文字列の "0" でも切れる(Worker の env は文字列で来る)', r.triggered === true && fetchCalls === 1, JSON.stringify(r));

// I
fetchCalls = 0;
env = { ...baseEnv, GEN_DEBOUNCE_MS: "abc", HS_HEARING_KV: makeKV({ "dispatch:s1": String(Date.now() - 1000) }) };
r = await trigger(env, profile, store);
t("数にならん値は既定に戻る。関所は開く方に倒さん", r.triggered === false && r.reason === "debounced", JSON.stringify(r));

// J
fetchCalls = 0;
env = { ...baseEnv, HS_HEARING_KV: makeKV({}) };
await trigger(env, profile, store);
r = await trigger(env, profile, store);
t("同じ中身の二度目は止める(指紋一致)", r.triggered === false && r.reason === "debounced" && fetchCalls === 1, JSON.stringify(r));

// K
fetchCalls = 0;
env = { ...baseEnv, HS_HEARING_KV: makeKV({}) };
await trigger(env, profile, store);
r = await trigger(env, { ...profile, works: ["w", "外壁塗装"] }, store);
t("中身の違う本物の2通目は通す(指紋不一致)", r.triggered === true && fetchCalls === 2, JSON.stringify(r));

// L
fetchCalls = 0;
env = { ...baseEnv, HS_HEARING_KV: makeKV({}) };
await trigger(env, profile, store);
t("印は 時刻|指紋 の形で入る", /^\d+\|[0-9a-f]{16}$/.test(env.HS_HEARING_KV.m.get("dispatch:s1") || ""), JSON.stringify(env.HS_HEARING_KV.m.get("dispatch:s1")));

// M
fetchCalls = 0;
env = { ...baseEnv, HS_HEARING_KV: makeKV({ "dispatch:s1": String(Date.now() - 60000) }) };
r = await trigger(env, { ...profile, works: ["まるで違う"] }, store);
t("旧い形の印(指紋なし)は、窓が閉じるまで止める側に倒す", r.triggered === false && r.reason === "debounced", JSON.stringify(r));

// N
fetchCalls = 0;
env = { ...baseEnv, HS_HEARING_KV: makeKV({}) };
await trigger(env, profile, store);
const fp1 = env.HS_HEARING_KV.m.get("dispatch:s1").split("|")[1];
env = { ...baseEnv, HS_HEARING_KV: makeKV({}) };
await trigger(env, { works: ["w"], area: "a", company: "c" }, store);
const fp2 = env.HS_HEARING_KV.m.get("dispatch:s1").split("|")[1];
t("指紋は鍵の順に依らん(同じ中身なら同じ指紋)", fp1 === fp2, fp1 + " vs " + fp2);

console.log("");
console.log("=== " + pass + " / " + (pass + fail) + (fail ? " 不合格あり" : " 合格") + " (triggerGeneration debounce) ===");
process.exit(fail ? 1 : 0);
