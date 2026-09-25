// ext_md_sync: ext/*.md と src/worker.js の埋め込み定数が 1 バイト違わず同じか。
// 2026-09-25 に見つけた穴: 埋め込み(CONDUCT_EXT_MD)だけ 11.6.1 から 11.6.3 を足して、ext/CONDUCT_EXT_v1.md が古いまま残っとった。
// sync_ext_md.py は md から埋め直すので、そのまま走らせとったら公開中の仕様が退行する所やった。片方だけ直したらここで赤になる。
// 走らせ方: node test/ext_md_sync.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const src = readFileSync(path.join(ROOT, "src", "worker.js"), "utf8").split("\n");
const PAIRS = [["CONDUCT_EXT_v1.md", "const CONDUCT_EXT_MD = "], ["LEGAL_ENTITY_EXT_v1.md", "const LEGAL_ENTITY_EXT_MD = "]];
const BAD = ["\u2014", "\u2013", "\u2015", "\u2012", "\u2212"];
let pass = 0, fail = 0;
const t = (name, ok, detail) => { ok ? pass++ : fail++; console.log((ok ? "  ok   " : "  NG   ") + name + (ok || !detail ? "" : "  <<< " + detail)); };
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");

for (const [name, mark] of PAIRS) {
  const md = readFileSync(path.join(ROOT, "ext", name), "utf8");
  const hits = src.filter((l) => l.startsWith(mark));
  t(name + ": exactly one embedded constant in src/worker.js", hits.length === 1, String(hits.length));
  if (hits.length !== 1) continue;
  const emb = JSON.parse(hits[0].slice(mark.length, -1));
  t(name + ": the embedded copy equals the markdown file byte for byte", emb === md,
    "embedded " + sha(emb).slice(0, 16) + " vs md " + sha(md).slice(0, 16) + " (edit the md, then run python3 sync_ext_md.py; never edit the embedded line by hand)");
  t(name + ": carries no forbidden dash", !BAD.some((c) => md.includes(c)));
}
console.log("\next_md_sync  " + pass + " ok, " + fail + " NG");
process.exit(fail ? 1 : 0);
