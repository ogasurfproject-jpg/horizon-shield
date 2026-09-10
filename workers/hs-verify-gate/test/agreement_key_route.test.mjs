// 合意記録の署名鍵を配る口 /keys/agreement.json の試験。
//
// なぜ在るか (2026-09-11)。
//
// a2a-agreement-v1.1 の記録は鍵を署名バイトの中に持つ。この URL は検証には要らん。
// 効くのは 1 点だけ、「その鍵はその当事者が自分のドメインで配っとる鍵か」という
// 帰属の主張や。同じ日に合意層の検証器を直して、その主張が立たん時に **記録は通して
// 帰属だけ落とす** ようにした。せやからこの口は、その主張が立つ側の足場になる。
//
// 一番大事なんは、鍵が未設定の時に何を返すかや。空の値を 200 で返したらあかん。
// 読む側は「鍵が違う」と判断してまう。無いなら 404 で「無い」と言う。そうすれば
// intake は 503 で retry できる。「無い」と「空」は違う。
//
// 走らせ方: node test/agreement_key_route.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(path.join(HERE, "..", "src", "worker.js"), "utf8");

let pass = 0, fail = 0;
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log("ok   " + name); }
  else { fail++; console.log("NG   " + name + (detail !== undefined ? "  " + detail : "")); }
};

// 本番の worker を丸ごと import せんと動かせん形やから、口の中身を source から
// 切り出して回す。書き写した写しは試さん。試すのは deploy される物と同じバイト列や。
const start = SRC.indexOf('if (path === "/keys/agreement.json") {');
t("口が src/worker.js に在る", start >= 0);
const body = start < 0 ? "" : SRC.slice(start, SRC.indexOf('\n    if (path === "/recompute")', start));

t("秘密鍵をこの worker で扱っとらん",
  !/private|secret_key|PRIVKEY|sign\(/i.test(body), body.slice(0, 120));
// 名前に数字が入る (B64)。[A-Z_]+ だけやと B で切れて、当たっとるつもりで
// 別の物を見とった。試験が測る物を間違えると、通っても何も言うてへん。
t("読むのは env.AGREEMENT_PUBKEY_B64 だけ",
  (body.match(/env\.[A-Z0-9_]+/g) || []).every((x) => x === "env.AGREEMENT_PUBKEY_B64"),
  JSON.stringify([...new Set(body.match(/env\.[A-Z0-9_]+/g) || [])]));

// 切り出した中身を、偽の env で二通り走らせる
const run = async (env) => {
  const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
  const CORS_HEADERS = { "access-control-allow-origin": "*" };
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: JSON_HEADERS });
  const path2 = "/keys/agreement.json";
  const fn = new Function("path", "env", "json", "JSON_HEADERS", "CORS_HEADERS", "Response",
    body + "\n return null;");
  return await fn(path2, env, json, JSON_HEADERS, CORS_HEADERS, Response);
};

{
  const r = await run({});
  t("鍵が未設定なら 404", r && r.status === 404, r && r.status);
  const b = await r.json();
  t("そして「無い」と言う。空の鍵を返さん", b.error === "not_configured" && !("public_key_ed25519_b64" in b),
    JSON.stringify(b).slice(0, 120));
  t("なぜ空を返さんかを本文に書いとる", typeof b.why === "string" && b.why.length > 40);
}
{
  const KEY = "0EqyMnQrtKs6E2i9RhXk5tAiSrcaAWuvhSCjMsl3hzc=";
  const r = await run({ AGREEMENT_PUBKEY_B64: KEY });
  t("鍵が設定されとったら 200", r.status === 200, r.status);
  const b = await r.json();
  t("鍵をそのまま返す。加工せん", b.public_key_ed25519_b64 === KEY, b.public_key_ed25519_b64);
  t("alg を名乗る", b.alg === "ed25519");
  t("どの schema の鍵かを言う", b.schema === "a2a-agreement-v1.1");
  // 「何やないか」を必ず書く。この tree の他の口と同じ作法や。中身が有ることを見る。
  t("この URL が何を証さんかを書いとる",
    typeof b.what_this_is_not === "string" && b.what_this_is_not.length > 60
    && /public key|record/i.test(b.what_this_is_not), b.what_this_is_not);
  t("何を証すかも、証さんかとは別に書いとる",
    typeof b.what_this_is === "string" && b.what_this_is.length > 60);
  t("仕様の在り処を指しとる", typeof b.spec === "string" && b.spec.startsWith("https://"));
}
{
  const r = await run({ AGREEMENT_PUBKEY_B64: "   " });
  t("空白だけの鍵は未設定と同じ扱い", r.status === 404, r.status);
}
{
  const KEY = " 0EqyMnQrtKs6E2i9RhXk5tAiSrcaAWuvhSCjMsl3hzc= ";
  const b = await (await run({ AGREEMENT_PUBKEY_B64: KEY })).json();
  // 前後の空白は落とす。落とさんかったら、記録の中の鍵と字が合わんで帰属が立たん。
  t("前後の空白は落とす", b.public_key_ed25519_b64 === KEY.trim(), JSON.stringify(b.public_key_ed25519_b64));
}

console.log("");
console.log("覆っとらんもの: 本番でこの URL が本当に配られとるか。ここで測っとるんは");
console.log("               src/worker.js の中身だけや。生きとるかは curl が見る。");
console.log("");
console.log("=== " + pass + " / " + (pass + fail) + (fail ? " 不合格あり" : " 合格")
  + " (合意記録の鍵の口) ===");
process.exit(fail ? 1 : 0);
