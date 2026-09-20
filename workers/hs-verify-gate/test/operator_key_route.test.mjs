// 運営者の許可鍵を配る口 /keys/operator.json の試験 (0.4.8)。agreement.json / witness.json と同じ規律。
// 未設定なら 404(「無い」)、空を 200 で返さん。秘密鍵はこの worker に無い(署名は手元 recovery-v0/authorize.mjs)。
// 測るのは deploy される src/worker.js のバイトそのもの。走らせ方: node test/operator_key_route.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(path.join(HERE, "..", "src", "worker.js"), "utf8");
const FAKE_KEY = Buffer.from("operator-key-route-test-fixture!").toString("base64");

let pass = 0, fail = 0;
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log("ok   " + name); }
  else { fail++; console.log("NG   " + name + (detail !== undefined ? "  " + detail : "")); }
};

const start = SRC.indexOf('if (path === "/keys/operator.json") {');
t("口が src/worker.js に在る", start >= 0);
const end = start < 0 ? -1 : SRC.indexOf("\n    // --- 合意記録の署名鍵を配る口", start);
t("口は合意記録の鍵の口の前に置かれとる (他の口の試験の窓を汚さん)", end > start);
const body = start < 0 || end < 0 ? "" : SRC.slice(start, end);

t("秘密鍵をこの worker で扱っとらん", !/private|secret_key|PRIVKEY|sign\(/i.test(body), body.slice(0, 120));
t("読むのは env.OPERATOR_PUBKEY_B64 だけ",
  (body.match(/env\.[A-Z0-9_]+/g) || []).every((x) => x === "env.OPERATOR_PUBKEY_B64"),
  JSON.stringify([...new Set(body.match(/env\.[A-Z0-9_]+/g) || [])]));

const run = async (env) => {
  const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
  const CORS_HEADERS = { "access-control-allow-origin": "*" };
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: JSON_HEADERS });
  const path2 = "/keys/operator.json";
  const fn = new Function("path", "env", "json", "JSON_HEADERS", "CORS_HEADERS", "Response", body + "\n return null;");
  return await fn(path2, env, json, JSON_HEADERS, CORS_HEADERS, Response);
};

{
  const r = await run({});
  t("鍵が未設定なら 404", r && r.status === 404, r && r.status);
  const b = await r.json();
  t("そして「無い」と言う。空の鍵を返さん", b.error === "not_configured" && !("public_key_ed25519_b64" in b), JSON.stringify(b).slice(0, 120));
  t("なぜ空を返さんかを本文に書いとる", typeof b.why === "string" && b.why.length > 40);
}
{
  const KEY = FAKE_KEY;
  const r = await run({ OPERATOR_PUBKEY_B64: KEY });
  t("鍵が設定されとったら 200", r.status === 200, r.status);
  const b = await r.json();
  t("鍵をそのまま返す。加工せん", b.public_key_ed25519_b64 === KEY, b.public_key_ed25519_b64);
  t("alg を名乗る", b.alg === "ed25519");
  t("どの schema の鍵かを言う", b.schema === "nenrin-authorization-v1");
  t("この URL が何を証さんかを書いとる", typeof b.what_this_is_not === "string" && b.what_this_is_not.length > 60);
  t("何を証すかも別に書いとる (期限と信用集合に触れる)", typeof b.what_this_is === "string" && /expires_at/.test(b.what_this_is) && /trust set/.test(b.what_this_is));
  t("仕様の在り処を指しとる", typeof b.spec === "string" && b.spec.startsWith("https://"));
  t("公開キャッシュは短い (鍵の回転が効くように)", (r.headers.get("Cache-Control") || "").includes("max-age=300"));
}
{
  const r = await run({ OPERATOR_PUBKEY_B64: "   " });
  t("空白だけの鍵は未設定と同じ扱い", r.status === 404, r.status);
}
{
  const KEY = " " + FAKE_KEY + " ";
  const b = await (await run({ OPERATOR_PUBKEY_B64: KEY })).json();
  t("前後の空白は落とす", b.public_key_ed25519_b64 === KEY.trim(), JSON.stringify(b.public_key_ed25519_b64));
}

console.log("");
console.log("=== " + pass + " / " + (pass + fail) + (fail ? " 不合格あり" : " 合格") + " (運営者鍵の口、扉 0.4.8) ===");
process.exit(fail ? 1 : 0);
