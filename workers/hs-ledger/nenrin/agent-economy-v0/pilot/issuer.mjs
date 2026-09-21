// issuer.mjs  PROTOCOL_v1 の S7 (RDA を組んで fail-closed 検証) と S8 (JIDEC seed)。
// 決定的な発行体: 本物の証拠 (委任連鎖・agreement・引かれた witness・着金) を入れると、
// verdict が pass で、着金が Tier A で、witness が当事者やない時だけ、split を導出して RDA を出す。
// G4 減衰は履歴の prior_count で、G6 は over-cap の connect を execute に畳む。どれか欠けたら ok:false。
import { RECIPE } from "./recipe.mjs";
import { buildRDA, validateRDA, canonical, rdaId } from "./rda.mjs";
import { rolesFromDelegation, grossFromAgreement, verdictFromWitness, settlementTier } from "./evidence.mjs";

const fail = (msg) => ({ ok: false, why: [msg] });

export async function issueRDA({ task_id, delegation, agreement, agreement_ref = null, witness, settlement, operate_to = null, recipe = RECIPE, recipe_committed_at = null, history = null, spent = null }) {
  const vd = verdictFromWitness(witness);
  if (!vd.pass) return fail("witness verdict is not pass (S5): " + JSON.stringify(vd.verdict));
  const st = settlementTier(settlement);
  if (!st.admissible) return fail("settlement not admissible, tier " + st.tier + " (G5/S6)");
  if (!st.ref) return fail("settlement has no ref (S6)");

  const roles = rolesFromDelegation(delegation);
  const parties = new Set();
  for (const o of delegation) { parties.add(o.hop.from); parties.add(o.hop.to); }
  if (parties.has(vd.witness_id)) return fail("witness is a party to the task (W3)");

  const gross = grossFromAgreement(agreement);
  const slot = Math.floor(recipe.connect_pool_bps / recipe.connect_max_hops);
  const survivingHops = [];
  const folded = [];
  for (const h of roles.connect_hops.slice(0, recipe.connect_max_hops)) {
    if (h.connector === roles.executor) continue;
    const prior = history ? history.priorCount(h.connector, roles.executor) : 0;   // G4
    const prospective = Math.floor(slot * (1 / Math.pow(2, prior)));
    if (history && history.wouldExceedConnectCap(h.connector, prospective)) { folded.push(h.connector); continue; } // G6 -> execute
    survivingHops.push({ connector: h.connector, executor: roles.executor, prior_count: prior });
  }

  const record = await buildRDA({
    task_id,
    evidence: {
      executor: roles.executor, operate_to, connect_hops: survivingHops,
      delegation_chain_ref: roles.delegation_chain_ref,
      agreement_ref: agreement_ref || (agreement && agreement.record_sha256) || null,
      witness_set_ref: vd.witness_set_ref,
      settlement_ref: st.ref,
    },
    gross: { amount: gross.amount, currency: gross.currency, external_customer_ref: (settlement && settlement.customer_ref) || null, settled: true, settled_at: (settlement && settlement.settled_at) || null },
    recipe, recipe_committed_at,
  });

  const v = await validateRDA(record, { spent });
  if (!v.ok) return { ok: false, why: v.why };
  return { ok: true, rda: record, folded, settlement_tier: st.tier };
}

// S8: RDA を JIDEC の seed 形 ({claim_sha256, record_canonical, work}) に。append_witness.sh が錨打つ。
// 錨る bytes = rda_id 抜き canonical、claim_sha256 = その sha256 (= rda_id)。
export async function toJidecSeed(rda) {
  const { rda_id, ...rest } = rda;
  const record_canonical = canonical(rest);
  const claim_sha256 = await rdaId(rda);
  const exec = (rda.splits.find((s) => s.role === "execute") || {}).share_bps;
  const work = "agent-economy RDA for task " + rda.task_id + ": gross " + rda.gross.amount + " " + rda.gross.currency +
    ", " + rda.splits.length + " splits summing to 10000 (execute " + exec + " bps), derived from the delegation chain, agreement, witness verdict and settlement by recipe " + rda.derivation.recipe_id +
    ". A derived attestation of what is owed on the evidence, not a transfer; the layer holds no funds.";
  return { claim_sha256, record_canonical, work };
}
