// hs-verify-relay の記録の試験。網は要らない。
//   node workers/hs-verify-relay/relay_log_test.mjs
//
// 何を確かめるか:
//   1. 1リクエストにつき1行、必ず出る(落ちた回も出る)
//   2. 鍵の値・本文・生のIPが、行の中に一切現れない
//   3. 同じ相手は同じ ip_tag になり、違う相手は違う ip_tag になる
//   4. 記録が壊れても、応答は返る
//
// 走らなかった試験は、通った試験と見分けがつかない。だから確かめた数も数える。

import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SRC = path.join(HERE, "deno_relay.js");

const TOKEN = "s3cret-relay-token-value";
let handler = null;
globalThis.Deno = {
  env: { get: (k) => (k === "RELAY_TOKEN" ? TOKEN : undefined) },
  serve: (h) => { handler = h; },
};

// Deno.serve を捕まえるために、一時ファイルにして import する。
const tmp = path.join(HERE, ".relay_under_test.mjs");
writeFileSync(tmp, readFileSync(SRC, "utf-8"));
await import(pathToFileURL(tmp).href);
try { unlinkSync(tmp); } catch (_e) {}

let fail = 0, ran = 0;
function check(label, cond, detail) {
  console.log((cond ? "  ok   " : "  NG   ") + label + (detail ? "  " + detail : ""));
  ran++;
  if (!cond) fail++;
}

const LOGS = [];
const realLog = console.log;
function capture(fn) {
  return (async () => {
    const start = LOGS.length;
    console.log = (...a) => { LOGS.push(a.join(" ")); };
    let out;
    try { out = await fn(); } finally { console.log = realLog; }
    return { res: out, lines: LOGS.slice(start) };
  })();
}

const IP_A = { remoteAddr: { hostname: "203.0.113.9" } };
const IP_B = { remoteAddr: { hostname: "198.51.100.4" } };

function req(method, url, { token, ua, body, referer } = {}) {
  const headers = {};
  if (token) headers["x-relay-token"] = token;
  if (ua) headers["user-agent"] = ua;
  if (referer) headers["referer"] = referer;
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const parse = (line) => JSON.parse(line.replace(/^hs-relay-req /, ""));

console.log("\n1) 1リクエストにつき1行");
{
  const { res, lines } = await capture(() =>
    handler(req("GET", "https://relay.invalid/?probe=1", { ua: "UptimeRobot/2.0" }), IP_A));
  check("GET / が 200", res.status === 200, String(res.status));
  check("記録が1行だけ出る", lines.length === 1, String(lines.length));
  const o = parse(lines[0]);
  check("印が付いている", lines[0].startsWith("hs-relay-req "));
  check("メソッドが入る", o.method === "GET");
  check("path が入る", o.path === "/", o.path);
  check("query が入る", o.query === "?probe=1", o.query);
  check("名乗り(UA)が入る", o.ua === "UptimeRobot/2.0", o.ua);
  check("鍵が無いことが分かる", o.token === "absent");
  check("所要時間が入る", typeof o.ms === "number");
}

console.log("\n2) 鍵・本文・生IPを書かない");
{
  const { lines } = await capture(() =>
    handler(req("POST", "https://relay.invalid/", {
      token: TOKEN,
      body: { url: "https://horizonshield.dev/x", body: "PATIENT-NAME-12345" },
    }), IP_A));
  const raw = lines[0];
  check("鍵の値が行に出ない", !raw.includes(TOKEN));
  check("要求の本文が行に出ない", !raw.includes("PATIENT-NAME-12345"));
  check("生のIPが行に出ない", !raw.includes("203.0.113.9"));
  const o = parse(raw);
  check("鍵があったことは分かる", o.token === "present");
}

console.log("\n3) 同じ相手か違う相手かは分かる");
{
  const a1 = parse((await capture(() => handler(req("GET", "https://relay.invalid/"), IP_A))).lines[0]);
  const a2 = parse((await capture(() => handler(req("GET", "https://relay.invalid/"), IP_A))).lines[0]);
  const b1 = parse((await capture(() => handler(req("GET", "https://relay.invalid/"), IP_B))).lines[0]);
  check("同じ相手は同じ印になる", a1.ip_tag && a1.ip_tag === a2.ip_tag, a1.ip_tag);
  check("違う相手は違う印になる", a1.ip_tag !== b1.ip_tag, a1.ip_tag + " vs " + b1.ip_tag);
  check("印は12桁", a1.ip_tag.length === 12, String(a1.ip_tag.length));
  check("印から元のIPは読めない", !a1.ip_tag.includes("203"));
}

console.log("\n4) 拒んだ回・失敗した回も残る");
{
  const noTok = await capture(() =>
    handler(req("POST", "https://relay.invalid/", { body: { url: "https://horizonshield.dev/" } }), IP_A));
  check("鍵なしは 403", noTok.res.status === 403, String(noTok.res.status));
  check("403 でも記録が残る", noTok.lines.length === 1);
  check("403 が記録に入る", parse(noTok.lines[0]).status === 403);

  const badHost = await capture(() =>
    handler(req("POST", "https://relay.invalid/", {
      token: TOKEN, body: { url: "https://example.com/" } }), IP_A));
  check("ゾーン外は 403", badHost.res.status === 403, String(badHost.res.status));
  check("取得先は空のまま(取りに行っていないので)", parse(badHost.lines[0]).target_host === "");

  const badJson = await capture(() => {
    const r = new Request("https://relay.invalid/", {
      method: "POST", headers: { "x-relay-token": TOKEN, "content-type": "application/json" },
      body: "{{{",
    });
    return handler(r, IP_A);
  });
  check("壊れた JSON は 400", badJson.res.status === 400, String(badJson.res.status));
  check("400 でも記録が残る", badJson.lines.length === 1);
}

console.log("\n5) 取りに行った回は、取得先とバイト数が残る");
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("x".repeat(4096), {
    status: 200, headers: { "content-type": "text/plain", "content-length": "4096" },
  });
  const { res, lines } = await capture(() =>
    handler(req("POST", "https://relay.invalid/", {
      token: TOKEN, body: { url: "https://api.horizonshield.dev/health" } }), IP_A));
  globalThis.fetch = realFetch;
  check("中継が成立して 200", res.status === 200, String(res.status));
  const o = parse(lines[0]);
  check("取得先のホストが残る", o.target_host === "api.horizonshield.dev", o.target_host);
  check("受け取ったバイト数が残る", o.bytes_read === 4096, String(o.bytes_read));
  check("打ち切っていないことが残る", o.truncated === false, String(o.truncated));
}

console.log("\n6) 上限を超えたら、超えたと残る");
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("y".repeat(1024 * 1024), {
    status: 200, headers: { "content-type": "text/plain" },
  });
  const { lines } = await capture(() =>
    handler(req("POST", "https://relay.invalid/", {
      token: TOKEN, body: { url: "https://api.horizonshield.dev/big" } }), IP_A));
  globalThis.fetch = realFetch;
  const o = parse(lines[0]);
  check("上限で止まる", o.bytes_read === 262144, String(o.bytes_read));
  check("打ち切ったことが残る", o.truncated === true);
}

console.log("");
// 確認や場面を足したら EXPECT も直すこと。数が合わないこと自体を赤にする。
const EXPECT = 30;
console.log("確かめた数: " + ran + " 件 (場面 6)");
if (ran !== EXPECT) {
  console.log("確かめた数が " + EXPECT + " と合わない。"
              + "途中で終わったか、確認を足して EXPECT を直していない。");
  process.exit(1);
}
if (fail) { console.log(fail + " 件おかしい。"); process.exit(1); }
console.log("中継の記録 すべて通過 (" + ran + " 件)");
