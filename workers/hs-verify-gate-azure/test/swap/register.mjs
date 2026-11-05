// register.mjs  node --import ./test/swap/register.mjs <試験>
// 扉(hs-verify-gate/src/worker.js)と Marketplace(hs-ms-marketplace/src/worker.js)の import を、swap.mjs の包みに差し替える。
// 試験の file も worker.js も書き換えない。包みは fetch と scheduled の env の KV と DO を、Azurite の Table の adapter にする。
import { registerHooks } from "node:module";

const TARGETS = [/\/workers\/hs-verify-gate\/src\/worker\.js$/, /\/workers\/hs-ms-marketplace\/src\/worker\.js$/];
const SWAP = new URL("./swap.mjs", import.meta.url).href;
const SHIM = "swapshim:";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(SHIM)) return { url: specifier, shortCircuit: true };
    const r = next(specifier, context);
    if (!r.url.includes("?") && TARGETS.some((re) => re.test(r.url)) && !(context.parentURL || "").startsWith(SHIM)) {
      return { url: SHIM + encodeURIComponent(r.url), shortCircuit: true, format: "module" };
    }
    return r;
  },
  load(url, context, next) {
    if (url.startsWith(SHIM)) {
      const real = decodeURIComponent(url.slice(SHIM.length)) + "?real";
      const source = "export * from " + JSON.stringify(real) + ";\n" +
        "import real from " + JSON.stringify(real) + ";\n" +
        "import { wrapWorker } from " + JSON.stringify(SWAP) + ";\n" +
        "export default wrapWorker(real, " + JSON.stringify(real) + ");\n";
      return { format: "module", source, shortCircuit: true };
    }
    return next(url, context);
  },
});
