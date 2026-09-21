// evidence.mjs  実際の錨済み記録から issuer が要る形を取り出す adapter (PROTOCOL_v1 の結線 2)。
// 記録の実形に噛ませる seam。live 記録に繋ぐ時はここだけ直す。

// 委任連鎖 (task-delegation-bind-v0 WitnessObservation の配列) から executor と connect hop を出す。
// executor = 最終 hop (最大 seq) の to。connector = 各 hop の from で executor と別 principal、seq 順、重複除去。
export function rolesFromDelegation(observations) {
  const hops = observations.map((o) => o.hop).sort((a, b) => a.seq - b.seq);
  if (!hops.length) throw new Error("empty delegation chain");
  const executor = hops[hops.length - 1].to;
  const seen = new Set();
  const connect_hops = [];
  for (const h of hops) {
    if (h.from === executor || seen.has(h.from)) continue;
    seen.add(h.from);
    connect_hops.push({ connector: h.from, executor });
  }
  const terminalSeq = hops[hops.length - 1].seq;
  const terminal = observations.find((o) => o.hop.seq === terminalSeq);
  return { executor, connect_hops, delegation_chain_ref: terminal ? terminal.evidence_id : null };
}

// agreement-v0 記録 (a2a-agreement-v1 / v1.1) の terms から gross を取る。
export function grossFromAgreement(record) {
  const t = record && record.terms;
  if (!t || t.amount == null || !t.currency) throw new Error("agreement has no terms.amount / currency");
  return { amount: t.amount, currency: t.currency };
}

// 引かれた witness の verdict。conduct.verdict が成功値なら pass。R4 は fail-closed (成功以外は pass やない)。
const PASS_VERDICTS = new Set(["pass", "ok", "clean", "verified", "complete", "completed"]);
export function verdictFromWitness(obs) {
  const v = obs && obs.conduct && obs.conduct.verdict;
  return { pass: PASS_VERDICTS.has(String(v).toLowerCase()), witness_id: obs && obs.witness_id, verdict: v, witness_set_ref: obs && obs.evidence_id };
}

// 着金レシートの独立性の合図で G5 の段を決める。A のみ pilot で成立。
const TIER = { payer_principal: "A", psp: "A", escrow: "A", bank_ref: "B", onchain_kyc: "B", self_custodial: "C", payee: "C" };
export function settlementTier(receipt) {
  const tier = (receipt && TIER[receipt.signer_kind]) || "C";
  return { tier, ref: receipt && receipt.ref, admissible: tier === "A" };
}
