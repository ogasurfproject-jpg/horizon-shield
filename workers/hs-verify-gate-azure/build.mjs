// build.mjs  src/main.mjs と ../hs-verify-gate/src/*.js を dist/main.cjs の 1 file に束ねる。npm の package は束ねず、
// deploy の zip に node_modules(npm ci --omit=dev)を入れる。CommonJS に落とすのは、Functions の Node で ES modules を
// 読む形が preview の扱いだから(worker.js は top level の await も import.meta も使わないので、CommonJS に落とせる)。
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

await build({
  entryPoints: ["src/main.mjs"],
  outfile: "dist/main.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  packages: "external",
  legalComments: "none",
  logLevel: "warning",
});
const sha = createHash("sha256").update(readFileSync("dist/main.cjs")).digest("hex");
console.log("dist/main.cjs " + sha.slice(0, 8));
