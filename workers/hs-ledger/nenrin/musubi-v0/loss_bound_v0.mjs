#!/usr/bin/env node
// loss-bound-v0 in a second runtime: the twin of loss_bound_v0.py.
//
// loss_bound_v0.py is the reference and states the record and the rule for finite. This file follows it function by
// function, over clause_eval_v0.mjs (classifyAction, limitFor) and canonical_v0.mjs, so that a record computed in
// JavaScript has the same canonical bytes as one computed in Python. loss_bound_v0.py --selftest runs both over the same
// inputs and fails on the first byte that differs.
//
// L is computed from the contract's grant and the door's published policy alone, without the content check's answer.
// While the contract does not bind the payload, L is not finite and the record says so.
//
//   node loss_bound_v0.mjs --contract contract.json --action report [--policy policy.json]   # prints the canonical record
//   node loss_bound_v0.mjs --cases -          # a JSON list of {name, contract, action, policy} on stdin; "<name> <canonical>" per line
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { canonical } from "./canonical_v0.mjs";
import { classifyAction, limitFor, contractSha256, own } from "./clause_eval_v0.mjs";

export const SCHEMA = "loss-bound-v0";
export const PAYLOAD_UNBOUND = "payload_unbound";
const RUNS = new Set(["authorized", "conditional"]);
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const isIntAtLeast = (x, lo) => typeof x === "number" && Number.isInteger(x) && x >= lo;

// the actions the grant lets run (classifyAction gives authorized or conditional), ascending, each once
export function grantedActions(contract) {
  const g = isObj(contract) && isObj(contract.grant) ? contract.grant : {};
  const names = [];
  for (const a of Array.isArray(g.authorized_actions) ? g.authorized_actions : []) if (typeof a === "string") names.push(a);
  for (const c of Array.isArray(g.conditional) ? g.conditional : []) if (isObj(c) && typeof c.action === "string") names.push(c.action);
  return [...new Set(names.filter((a) => RUNS.has(classifyAction(contract, a))))].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
}

// policy.exposure[action] as { window_blocks, max_acts } when both are integers of at least 1, else null
export function windowOf(policy, action) {
  const ex = isObj(policy) ? own(policy, "exposure") : undefined;
  const w = isObj(ex) ? own(ex, action) : undefined;
  if (!isObj(w) || !(isIntAtLeast(w.window_blocks, 1) && isIntAtLeast(w.max_acts, 1))) return null;
  return { window_blocks: w.window_blocks, max_acts: w.max_acts };
}

export function lossBound(contract, action, policy = null) {
  const kind = classifyAction(contract, action);
  const lim = limitFor(contract, action);
  const unit = lim !== null && typeof lim.unit === "string" ? lim.unit : null;
  let amountMax, openFields;
  if (RUNS.has(kind)) { amountMax = lim !== null ? lim.max : null; openFields = PAYLOAD_UNBOUND; }
  else { amountMax = 0; openFields = []; }
  const finite = !RUNS.has(kind) || (isIntAtLeast(amountMax, 0) && Array.isArray(openFields) && openFields.length === 0);
  return { schema: SCHEMA, contract_sha256: contractSha256(contract), action, class: kind, amount_max: amountMax, unit,
    actions: grantedActions(contract), open_fields: openFields, holds: false, window: windowOf(policy, action), finite: Boolean(finite) };
}

export const lossBoundBytes = (rec) => Buffer.from(canonical(rec), "utf8");

export function windowLoss(rec) {
  const w = rec.window;
  if (!isObj(w) || !isIntAtLeast(rec.amount_max, 0)) return null;
  return { amount: rec.amount_max * w.max_acts, unit: rec.unit ?? null, per_blocks: w.window_blocks };
}

function main(argv) {
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const rd = (p) => JSON.parse(readFileSync(p === "-" ? 0 : p, "utf8"));
  if (arg("--cases") !== undefined) {
    for (const c of rd(arg("--cases"))) process.stdout.write(c.name + " " + canonical(lossBound(c.contract, c.action, c.policy ?? null)) + "\n");
    return 0;
  }
  if (arg("--contract") === undefined || arg("--action") === undefined) {
    process.stderr.write("usage: node loss_bound_v0.mjs --contract contract.json --action A [--policy policy.json] | --cases -\n");
    return 1;
  }
  process.stdout.write(canonical(lossBound(rd(arg("--contract")), arg("--action"), arg("--policy") ? rd(arg("--policy")) : null)) + "\n");
  return 0;
}

const self = (() => { try { return realpathSync(fileURLToPath(import.meta.url)); } catch (_e) { return null; } })();
const run = (() => { try { return process.argv[1] ? realpathSync(process.argv[1]) : null; } catch (_e) { return null; } })();
if (self !== null && self === run) process.exitCode = main(process.argv.slice(2));
