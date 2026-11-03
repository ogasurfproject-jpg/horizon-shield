// bindings.mjs: the service bindings of the Cloud Run copy. On Cloudflare they are service bindings; here each is a plain
// HTTPS fetch to the public host. Cloud Run is outside the Cloudflare account, so these fetches do not loop back into the
// zone. AGREEMENT_INTAKE (2026-11-03): the Résumé reads the agreement intake's contracts and agreements by sha, as the
// Cloudflare ledger does through its binding, so both give the same agreements[] and not_counted.
export function serviceBindings(fetchImpl) {
  const f = fetchImpl || ((...a) => fetch(...a));
  const passthrough = { fetch: (...a) => f(...a) };
  return { GATE: passthrough, PDF_GEN: passthrough, AGREEMENT_INTAKE: passthrough };
}
