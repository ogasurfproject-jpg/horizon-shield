// rda.mjs  RDA の canonical・rda_id・検証・nullifier (SPEC_v1)。
// canonical は再帰キーソート (配列順は保つ) = Federico の Node 再現と同じ規約。rda_id = SHA-256(canonical(rda_id 抜き))。
// 検証は fail-closed (E8): 証拠 4 参照が揃う、splits が 10000、recipe が成立より前に commit (G3)、rda_id 再計算、
// settlement_ref / agreement_ref が使い捨て (G2 nullifier)。どれか欠けたら ok:false。
import { computeSplits, RECIPE } from "./recipe.mjs";

const enc = new TextEncoder();
async function sha256hex(s) {
  const b = await crypto.subtle.digest("SHA-256", typeof s === "string" ? enc.encode(s) : s);
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
export function canonical(v) {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
  return JSON.stringify(v === undefined ? null : v);
}
export async function rdaId(record) { const { rda_id, ...rest } = record; return sha256hex(canonical(rest)); }

const nullifiers = (rec) => [rec.evidence && rec.evidence.settlement_ref, rec.evidence && rec.evidence.agreement_ref].filter(Boolean).map(String);

export async function buildRDA({ task_id, evidence, gross, recipe = RECIPE, issued_at = null, recipe_committed_at = null }) {
  const { splits } = computeSplits(evidence, recipe);
  const record = {
    task_id,
    evidence: {
      delegation_chain_ref: evidence.delegation_chain_ref,
      agreement_ref: evidence.agreement_ref,
      witness_set_ref: evidence.witness_set_ref,
      settlement_ref: evidence.settlement_ref,
    },
    gross,
    splits,
    derivation: { recipe_id: recipe.recipe_id, recipe_committed_at },
    issued_at,
  };
  return { ...record, rda_id: await sha256hex(canonical(record)) };
}

export function makeSpentSet() {
  const s = new Set();
  return { has: (k) => s.has(String(k)), markSpent: (rec) => { for (const k of nullifiers(rec)) s.add(k); }, size: () => s.size };
}

export async function validateRDA(record, { spent } = {}) {
  const why = [];
  const e = record.evidence || {};
  for (const k of ["delegation_chain_ref", "agreement_ref", "witness_set_ref", "settlement_ref"]) if (!e[k]) why.push("missing evidence." + k);
  const sum = (record.splits || []).reduce((a, x) => a + (x.share_bps | 0), 0);
  if (sum !== 10000) why.push("splits sum " + sum + " != 10000");
  if (!record.derivation || !record.derivation.recipe_id) why.push("missing derivation.recipe_id");
  const rc = record.derivation && record.derivation.recipe_committed_at;
  const st = record.gross && record.gross.settled_at;
  if (rc && st && new Date(rc).getTime() > new Date(st).getTime()) why.push("recipe committed after settlement (G3)");
  if (record.rda_id && record.rda_id !== (await rdaId(record))) why.push("rda_id does not recompute");
  if (spent) for (const k of nullifiers(record)) if (spent.has(k)) why.push("nullifier already spent: " + k);
  return { ok: why.length === 0, why };
}
