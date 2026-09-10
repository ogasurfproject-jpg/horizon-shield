// hs-outreach: 管理鍵をどこから受けるか、その一箇所だけを試す。
//
// なぜ在るか (2026-09-10)。
// このワーカーには試験が一本も無かった。そして admin() は、管理鍵を
// Authorization ヘッダと URL の ?token= の両方から受けていた。query は
// request log にも、ブラウザの履歴にも、外へ出るときの Referer にも残る。
// ヘッダは残らん。同じ鍵を残る所と残らん所の両方から受けたら、実質の置き場は
// 残る方になる。楽なほうが使われるからや。
// 今夜この ADMIN_TOKEN を露出を理由に回した直後やったので、受け口のほうを閉めた。
//
// この試験は src/outreach.js から ctEq と admin をそのまま切り出して回す。
// 書き写した写しは試さん。試すのは deploy されるバイト列や。
//
// 走らせ方: node auth_test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = process.argv[2] || path.join(HERE, "src", "outreach.js");
const src = readFileSync(SRC, "utf8");

function slice(startMarker, endMarker) {
  const i = src.indexOf(startMarker);
  if (i < 0) throw new Error("切り出せん: " + startMarker);
  const j = src.indexOf(endMarker, i);
  if (j < 0) throw new Error("終わりが見つからん: " + endMarker);
  return src.slice(i, j + endMarker.length);
}

const ctEqSrc = slice("async function ctEq(a, b) {", "\n}\n");
const adminSrc = slice("const admin = async () => {", "\n    };\n");
console.log("切り出した行数: ctEq " + ctEqSrc.split("\n").length + ", admin " + adminSrc.split("\n").length);

const enc = new TextEncoder();
const make = new Function("enc", ctEqSrc + "\nreturn ctEq;");
const ctEq = make(enc);

// admin は url / request / env を閉じ込みで使う。同じ名前で渡す。
const makeAdmin = new Function("url", "request", "env", "ctEq",
  adminSrc.replace(/^\s*const admin = /, "return ") .replace(/;\s*$/, ";"));

const TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const WRONG = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

function build(opts) {
  const u = new URL("https://hs-outreach.example.invalid/status");
  if (opts.query != null) u.searchParams.set("token", opts.query);
  const headers = new Map();
  if (opts.auth != null) headers.set("authorization", opts.auth);
  const request = { headers: { get: (k) => headers.get(String(k).toLowerCase()) ?? null } };
  const env = opts.envToken === undefined ? { ADMIN_TOKEN: TOKEN } : { ADMIN_TOKEN: opts.envToken };
  return makeAdmin(u, request, env, ctEq);
}

let pass = 0, fail = 0;
const t = async (name, got, want) => {
  const v = await got;
  if (v === want) { pass++; console.log("ok   " + name); }
  else { fail++; console.log("NG   " + name + "  want=" + want + " got=" + v); }
};

await t("正しい鍵を Authorization: Bearer で出したら通る",
  build({ auth: "Bearer " + TOKEN })(), true);
await t("小文字の bearer でも通る(ヘッダ値の綴りで落とさん)",
  build({ auth: "bearer " + TOKEN })(), true);
await t("Bearer 無しの生の値でも通る(前からの動きを変えとらん)",
  build({ auth: TOKEN })(), true);
await t("正しい鍵でも ?token= では通らん。これが今日の変更や",
  build({ query: TOKEN })(), false);
await t("query に正しい鍵、ヘッダに何も無い、でも通らん",
  build({ query: TOKEN, auth: null })(), false);
await t("query に正しい鍵、ヘッダに間違い、当然通らん",
  build({ query: TOKEN, auth: "Bearer " + WRONG })(), false);
await t("query が正しくてもヘッダが正しければ通る(query は無視されるだけ)",
  build({ query: WRONG, auth: "Bearer " + TOKEN })(), true);
await t("間違った鍵は通らん", build({ auth: "Bearer " + WRONG })(), false);
await t("鍵を出さなければ通らん", build({})(), false);
await t("env に ADMIN_TOKEN が無ければ、何を出しても通らん",
  build({ auth: "Bearer " + TOKEN, envToken: undefined === undefined ? "" : "" })(), false);

// 落ちたときに理由が返ることを、ソースの字面で確かめる。
const hasNote = /the admin token is no longer accepted in the URL query/.test(src);
const noteIsConditional = /adminViaQuery\s*\n?\s*\?/.test(src) || /adminViaQuery\s*\?/.test(src);
const flagFromQuery = /const adminViaQuery = url\.searchParams\.has\("token"\)/.test(src);
if (hasNote) { pass++; console.log("ok   401 に理由が書いてある(黙って落とさん)"); } else { fail++; console.log("NG   401 に理由が無い"); }
if (noteIsConditional) { pass++; console.log("ok   その理由は ?token= で来たときだけ出る"); } else { fail++; console.log("NG   理由が無条件に出とる"); }
if (flagFromQuery) { pass++; console.log("ok   その判定は url から導いとる(横に置いた旗やない)"); } else { fail++; console.log("NG   判定の出どころが url やない"); }

console.log("");
console.log("=== " + pass + " / " + (pass + fail) + (fail ? " 不合格あり" : " 合格") + " (hs-outreach 管理鍵の受け口) ===");
process.exit(fail ? 1 : 0);
