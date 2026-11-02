// node_cloudflare_workers.mjs: lets Node read src/worker.js, which imports WorkerEntrypoint from "cloudflare:workers"
// (the named entrypoint FuruiDayIntake, 2026-11-02). Node has no such built in, so importing this file for its side
// effect resolves "cloudflare:workers" to a small stand-in of the same shape (a class that keeps ctx and env).
// wrangler treats "cloudflare:workers" as the real built in and never reads this file; worker.js does not import it.
//
// Every Node reader of worker.js imports this file first, then imports worker.js dynamically (a static import of
// worker.js is resolved before any code of the importing file runs, so the hook would come too late):
//   test/load.mjs, gcp/server.mjs (the Cloud Run twin), nenrin/resume-v1/resume_route_selftest.mjs,
//   nenrin/trust-signal-v1/trust_signal_route_selftest.mjs, ../hs-verify-gate/test/conduct_v11_gate.test.mjs,
//   ../hs-mcp/test/local_env.mjs (and through it a2a-card-sign/selftest.mjs, canon_equiv.test.mjs, sign_lib.mjs,
//   verify.mjs, hs-mcp/test/serve_local.mjs, sdk_js_interop.mjs and walk_reference_servers.py).
// Find them again with: git grep -n "hs-ledger/src/worker.js\|../src/worker.js\|\"hs-ledger\", \"src\""
import { register } from "node:module";

const KEY = Symbol.for("hs-ledger.node_cloudflare_workers");
if (!globalThis[KEY]) {
  globalThis[KEY] = true;
  const STUB = "export class WorkerEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }";
  register("data:text/javascript," + encodeURIComponent(
    "export async function resolve(s, c, n) { if (s === 'cloudflare:workers') return { url: 'data:text/javascript,' + encodeURIComponent(" + JSON.stringify(STUB) + "), shortCircuit: true }; return n(s, c); }"));
}
