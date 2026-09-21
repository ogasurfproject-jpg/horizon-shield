// run.mjs  PROTOCOL_v1 の live runner (S4..S8 を繋ぐ)。台帳から委任連鎖と agreement を引き、
// 引かれた witness の verdict と着金レシートを合わせて issueRDA を回し、RDA と JIDEC seed を出す。
// S0(enrol/KYC)・S3(escrow)・S6(着金の実物) は外部/契約側。ここは記録源を live 台帳に繋ぐ配線だけ。
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { issueRDA, toJidecSeed } from "./issuer.mjs";

export async function fetchLedger(base, path, fetchImpl = fetch) {
  const res = await fetchImpl(base.replace(/\/$/, "") + path, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error("ledger GET " + path + " -> http " + res.status);
  return res.json();
}

// /witness/task の応答から観測配列を取り出す (実装により observations/set/witnesses/配列)。
export function observationsOf(resp) {
  if (Array.isArray(resp)) return resp;
  for (const k of ["observations", "set", "witnesses", "records", "items"]) if (Array.isArray(resp && resp[k])) return resp[k];
  return [];
}

// delegation set から引かれた witness の観測 1 件 (witness_id 指定、無ければ最初の独立観測)。
export function pickWitness(observations, witnessId = null) {
  if (witnessId) return observations.find((o) => o.witness_id === witnessId) || null;
  return observations.find((o) => o.witness_id !== o.hop.from && o.witness_id !== o.hop.to) || observations[0] || null;
}

// 純関数の芯: 記録一式から RDA と JIDEC seed を出す。
export async function runFromRecords({ task_id, delegation, agreement, agreement_ref = null, witnessId = null, settlement, operate_to = null, recipe_committed_at = null, history = null, spent = null }) {
  const witness = pickWitness(delegation, witnessId);
  if (!witness) return { ok: false, why: ["no witness observation in the delegation set"] };
  const issued = await issueRDA({ task_id, delegation, agreement, agreement_ref, witness, settlement, operate_to, recipe_committed_at, history, spent });
  if (!issued.ok) return issued;
  const seed = await toJidecSeed(issued.rda);
  return { ok: true, rda: issued.rda, seed, folded: issued.folded, settlement_tier: issued.settlement_tier };
}

// @@CLI_BEGIN
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) { const a = process.argv[i]; if (a.startsWith("--")) { const v = process.argv[i + 1]; if (v !== undefined && !v.startsWith("--")) { args[a.slice(2)] = v; i++; } else args[a.slice(2)] = true; } }
  if (!args.task || !args.settlement || (!args.ledger && !args["fixture-delegation"])) {
    console.error("usage: node run.mjs --ledger <base> --task <task_id> --agreement <sha> --settlement receipt.json [--witness-id id] [--operate-to principal] [--recipe-committed-at iso] [--out rda.json] [--seed seed.json]");
    console.error("offline: --fixture-delegation obs.json --fixture-agreement agr.json (instead of --ledger)");
    process.exit(2);
  }
  const settlement = JSON.parse(readFileSync(args.settlement, "utf8"));
  let delegation, agreement;
  if (args["fixture-delegation"]) {
    delegation = observationsOf(JSON.parse(readFileSync(args["fixture-delegation"], "utf8")));
    agreement = args["fixture-agreement"] ? JSON.parse(readFileSync(args["fixture-agreement"], "utf8")) : null;
  } else {
    delegation = observationsOf(await fetchLedger(args.ledger, "/witness/task?task_id=" + encodeURIComponent(args.task)));
    agreement = args.agreement ? await fetchLedger(args.ledger, "/agreement/" + encodeURIComponent(args.agreement)) : null;
  }
  const r = await runFromRecords({
    task_id: args.task, delegation, agreement, agreement_ref: args.agreement || null,
    witnessId: args["witness-id"] || null, settlement, operate_to: args["operate-to"] || null,
    recipe_committed_at: args["recipe-committed-at"] || null,
  });
  if (!r.ok) { console.error("no RDA (fail-closed): " + r.why.join("; ")); process.exit(1); }
  if (args.out) writeFileSync(args.out, JSON.stringify(r.rda, null, 2) + "\n");
  if (args.seed) writeFileSync(args.seed, JSON.stringify(r.seed, null, 1) + "\n");
  const exec = (r.rda.splits.find((s) => s.role === "execute") || {});
  console.error("RDA " + r.rda.rda_id.slice(0, 12) + " for task " + r.rda.task_id + ": execute " + exec.agent_id + " " + exec.share_bps + " bps, tier " + r.settlement_tier + (r.folded.length ? ", folded " + r.folded.join(",") : "") + (args.seed ? " -> anchor: zsh ../../../append_witness.sh " + args.seed : ""));
}
// @@CLI_END
