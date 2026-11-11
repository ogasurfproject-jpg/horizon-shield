#!/usr/bin/env node
// loss-bound-v1 in a second runtime: the twin of loss_bound_v1.py.
//
// loss_bound_v1.py is the reference and states the record and the rules for finite, calls_day, l_day and l_day_policy.
// This file follows it function by function, over clause_eval_v0.mjs (classifyAction, limitFor), loss_bound_v0.mjs
// (grantedActions, windowOf), contract_door_v0.mjs (payloadSchemaOk, openFields) and canonical_v0.mjs, so that a record
// computed in JavaScript has the same canonical bytes as one computed in Python. loss_bound_v1.py --selftest runs both
// over the same inputs and fails on the first byte that differs.
//
//   node loss_bound_v1.mjs --contract contract.json --action report [--policy policy.json]   # prints the canonical record
//   node loss_bound_v1.mjs --cases -          # a JSON list of {name, contract, action, policy} on stdin; "<name> <canonical>" per line
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { canonical } from "./canonical_v0.mjs";
import { classifyAction, limitFor, contractSha256, own } from "./clause_eval_v0.mjs";
import { grantedActions, windowOf, PAYLOAD_UNBOUND } from "./loss_bound_v0.mjs";
import { payloadSchemaOk, openFields } from "./contract_door_v0.mjs";

export const SCHEMA = "loss-bound-v1";
export const DAY_BLOCKS = 144;
export const BOUNDS = "amount";
const RUNS = new Set(["authorized", "conditional"]);
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const isIntAtLeast = (x, lo) => typeof x === "number" && Number.isInteger(x) && x >= lo;
const grantOf = (contract) => (isObj(contract) && isObj(own(contract, "grant")) ? contract.grant : {});

// grant.payload_schema[action] when it is a well formed payload-schema-v0 object, else null
export function schemaOf(contract, action) {
  const ps = own(grantOf(contract), "payload_schema");
  const s = isObj(ps) ? own(ps, action) : undefined;
  return s !== undefined && s !== null && payloadSchemaOk(s) ? s : null;
}

// grant.exposure[action] as { window_blocks, max_acts } when both are in range, else null
export function termsWindowOf(contract, action) {
  const ex = own(grantOf(contract), "exposure");
  const w = isObj(ex) ? own(ex, action) : undefined;
  if (!(isObj(w) && isIntAtLeast(w.window_blocks, 1) && w.window_blocks <= 4320 && isIntAtLeast(w.max_acts, 1) && w.max_acts <= 100000)) return null;
  return { window_blocks: w.window_blocks, max_acts: w.max_acts };
}

export const callsIn = (w, dayBlocks = DAY_BLOCKS) => w.max_acts * Math.ceil(dayBlocks / w.window_blocks);

export function lossBound(contract, action, policy = null) {
  const kind = classifyAction(contract, action);
  const lim = limitFor(contract, action);
  const unit = lim !== null && typeof lim.unit === "string" ? lim.unit : null;
  const tw = termsWindowOf(contract, action), win = windowOf(policy, action);
  let amountMax, opened, finite, callsDay, lDay, lDayPolicy;
  if (RUNS.has(kind)) {
    amountMax = lim !== null ? lim.max : null;
    const s = schemaOf(contract, action);
    opened = s !== null ? openFields(s) : PAYLOAD_UNBOUND;
    finite = isIntAtLeast(amountMax, 0) && Array.isArray(opened) && opened.length === 0;
    callsDay = tw !== null ? callsIn(tw) : null;
    lDay = finite && callsDay !== null ? amountMax * callsDay : null;
    lDayPolicy = finite && win !== null ? amountMax * callsIn(win) : null;
  } else {
    [amountMax, opened, finite, callsDay, lDay, lDayPolicy] = [0, [], true, 0, 0, 0];
  }
  return { schema: SCHEMA, contract_sha256: contractSha256(contract), action, class: kind, amount_max: amountMax, unit,
    actions: grantedActions(contract), open_fields: opened, holds: false, window: win, terms_window: tw, day_blocks: DAY_BLOCKS,
    calls_day: callsDay, l_day: lDay, l_day_policy: lDayPolicy, bounds: BOUNDS, finite: Boolean(finite) };
}

export const lossBoundBytes = (rec) => Buffer.from(canonical(rec), "utf8");

function main(argv) {
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const rd = (p) => JSON.parse(readFileSync(p === "-" ? 0 : p, "utf8"));
  if (arg("--cases") !== undefined) {
    for (const c of rd(arg("--cases"))) process.stdout.write(c.name + " " + canonical(lossBound(c.contract, c.action, c.policy ?? null)) + "\n");
    return 0;
  }
  if (arg("--contract") === undefined || arg("--action") === undefined) {
    process.stderr.write("usage: node loss_bound_v1.mjs --contract contract.json --action A [--policy policy.json] | --cases -\n");
    return 1;
  }
  process.stdout.write(canonical(lossBound(rd(arg("--contract")), arg("--action"), arg("--policy") ? rd(arg("--policy")) : null)) + "\n");
  return 0;
}

const self = (() => { try { return realpathSync(fileURLToPath(import.meta.url)); } catch (_e) { return null; } })();
const run = (() => { try { return process.argv[1] ? realpathSync(process.argv[1]) : null; } catch (_e) { return null; } })();
if (self !== null && self === run) process.exitCode = main(process.argv.slice(2));
