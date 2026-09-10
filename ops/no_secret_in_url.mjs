// ops/no_secret_in_url.mjs
//
// 秘密を URL の query に載せて外へ出しとらんか、を見張る。
//
// なんで要るか (2026-09-11)。Gemini が 2 本、Apify が 2 本、`?key=${env.GEMINI_API_KEY}` と
// `"...?token=" + env.APIFY_TOKEN` の形で外へ出しとった。URL は header と違うて、Cloudflare の
// 外向き記録にも、上流の log にも、失敗時に URL を含む文字列を吐く所にも残る。値そのものが残る。
// header ならどれにも残らん。両方の vendor が header 経路を用意しとるので、移すだけの話やった。
//
// 直したら、次は「戻らんこと」を見張らなあかん。人は同じ形をまた書く。これがそれや。
//
//   node ops/no_secret_in_url.mjs
//
// 終了コード 0 = 見つからん、2 = 見つかった (見つけた場所を全部名指しする)。

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");

// query の値に env.<大文字> が入っとる形。`?key=${env.X}` も `"?token=" + env.X` も拾う。
const IN_URL = /[?&][A-Za-z_][A-Za-z0-9_]*=(?:\$\{\s*env\.[A-Z][A-Z0-9_]{2,}|"\s*\+\s*env\.[A-Z][A-Z0-9_]{2,})/;

// 秘密やない物。ここに足すときは、なんで秘密やないかを書くこと。
const NOT_A_SECRET = [
  "env.APIFY_ACTOR_ID",   // actor の識別子。持っとっても何も開かん
  "env.GITHUB_OWNER",     // 公開されとる持ち主名
  "env.GITHUB_REPO",      // 公開されとる repo 名
];

// 他所の endpoint を調べた survey の記録。うちの秘密やのうて、観測した文字列そのもの。
const NOT_OUR_CODE = ["workers/hs-mcp-observatory/"];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === "_to_delete" || name === ".wrangler") continue;
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(js|mjs|ts)$/.test(name)) out.push(p);
  }
  return out;
}

const hits = [];
for (const file of walk(path.join(ROOT, "workers"))) {
  const rel = path.relative(ROOT, file);
  if (NOT_OUR_CODE.some((p) => rel.startsWith(p))) continue;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (!IN_URL.test(line)) return;
    if (NOT_A_SECRET.some((n) => line.includes(n))) return;
    hits.push({ rel, n: i + 1, line: line.trim().slice(0, 120) });
  });
}

if (hits.length === 0) {
  console.log("=== 0 件。秘密を URL の query に載せて外へ出しとる所は無い ===");
  console.log("見とるんは workers/ の下の .js/.mjs/.ts だけや。_to_delete と node_modules は見とらん。");
  process.exit(0);
}

console.log("=== " + hits.length + " 件見つかった ===");
for (const h of hits) console.log("  " + h.rel + ":" + h.n + "\n      " + h.line);
console.log("");
console.log("直し方: 値を header に移す。URL に載せた秘密は Cloudflare の外向き記録にも");
console.log("        上流の log にも残る。header は残らん。");
console.log("        Google の API は x-goog-api-key、Apify は Authorization: Bearer を受ける。");
console.log("秘密やない物が引っ掛かったら、NOT_A_SECRET に「なんで秘密やないか」を書いて足す。");
process.exit(2);
