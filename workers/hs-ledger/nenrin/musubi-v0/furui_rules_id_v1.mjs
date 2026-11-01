#!/usr/bin/env node
// furui-rules-id-v1 in a second runtime: the same codes and the same rules_sha256 as furui_rules_id_v1.py, which says
// what the object is and why. furui_rules_id_v1.py --selftest runs this file over its example and mutants.
//
//   node furui_rules_id_v1.mjs --id ID.json        prints rules_sha256, or the problems
//   node furui_rules_id_v1.mjs --batch < LIST.json  prints [{problems, rules_sha256}] for a JSON list of objects
import fs, { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { canonical, sha256 } from "./canonical_v0.mjs";

export const ID = "furui-rules-id-v1";
const KEYS = ["arrangement", "call", "count", "id", "implementations", "prompt_builder", "questions", "quote_check", "rule_files", "stages", "version"];
export const ARRANGEMENTS = {
  "a7-q1-q21-q22": [["rules", null, null, null], ["model", "q1", null, null], ["model", "q1", "stage_2_not_none", null],
    ["model", "q21", null, "scope"], ["model", "q21b", null, "scope"],
    ["model", "q22", "scope_has_verified_limit", null], ["model", "q22", "stage_6_not_all_no", null]],
};
const ROLES = { "a7-q1-q21-q22": { q1: "q1_v2", q21: "q2_1_v4", q21b: "q2_1b", q22: "q2_2_v4" } };
const CALL_KEYS = ["effort", "kw", "max_tokens", "retry", "temperature", "timeout_s"];
const RETRY_KEYS = ["other_retries", "transport", "transport_retries", "wait_s"];
const HEX64 = /^[0-9a-f]{64}$/;
const NAME = /^[\x21-\x7e][\x20-\x7e]{0,127}$/;
const VERSION = /^[\x21-\x7e]{1,64}$/;
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const isStr = (x) => typeof x === "string";
const isInt = (x) => typeof x === "number" && Number.isInteger(x);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const keysAre = (o, ks) => Object.keys(o).sort().join(",") === [...ks].sort().join(",");

function named(xs, where, emptyOk) {
  if (!Array.isArray(xs) || (!xs.length && !emptyOk)) return [where + "_malformed"];
  for (const x of xs) {
    if (!(isObj(x) && keysAre(x, ["name", "sha256"]) && isStr(x.name) && NAME.test(x.name) && isStr(x.sha256) && HEX64.test(x.sha256))) return [where + "_malformed"];
  }
  const names = xs.map((x) => x.name), uniq = [...new Set(names)].sort();
  return names.length === uniq.length && names.every((n, i) => n === uniq[i]) ? [] : [where + "_not_sorted_unique"];
}
const objOk = (x, ks, checks) => isObj(x) && keysAre(x, ks) && Object.entries(checks).every(([k, f]) => f(x[k]));

function callOk(c, models) {
  const s = (v) => isStr(v) && v.length > 0 && [...v].length <= 400;
  if (!objOk(c, CALL_KEYS, {
    effort: s, temperature: (v) => v === null || (isInt(v) && v >= 0 && v <= 1), timeout_s: (v) => isInt(v) && v > 0,
    retry: (r) => objOk(r, RETRY_KEYS, { other_retries: (v) => isInt(v) && v >= 0, transport_retries: (v) => isInt(v) && v >= 0, wait_s: s, transport: s }),
    max_tokens: (m) => isObj(m) && Object.values(m).every((v) => isInt(v) && v > 0),
    kw: (m) => isObj(m) && Object.values(m).every(isObj),
  })) return false;
  const same = (o) => Object.keys(o).length === models.length && models.every((x) => has(o, x));
  return models === null || (same(c.max_tokens) && same(c.kw));
}

export function problems(obj) {
  if (!isObj(obj)) return ["not_an_object"];
  if (!keysAre(obj, KEYS)) return ["keys_not_exact"];
  const p = [];
  if (obj.id !== ID) p.push("id_unknown");
  if (!(isStr(obj.version) && VERSION.test(obj.version))) p.push("version_malformed");
  p.push(...named(obj.questions, "questions", false));
  p.push(...named(obj.rule_files, "rule_files", false));
  p.push(...named(obj.implementations, "implementations", true));
  const hexs = (v) => isStr(v) && HEX64.test(v), nm = (v) => isStr(v) && NAME.test(v), ver = (v) => isStr(v) && VERSION.test(v);
  if (!objOk(obj.prompt_builder, ["name", "pin_sha256", "sha256"], { name: nm, pin_sha256: hexs, sha256: hexs })) p.push("prompt_builder_malformed");
  if (!objOk(obj.count, ["name", "sha256", "ver"], { name: nm, sha256: hexs, ver })) p.push("count_malformed");
  if (!objOk(obj.quote_check, ["name", "sha256", "unicode"], { name: nm, sha256: hexs, unicode: ver })) p.push("quote_check_malformed");
  const st = obj.stages; let shape = null; const models = [];
  if (!Array.isArray(st) || !st.length) p.push("stages_malformed");
  else {
    shape = [];
    for (let i = 0; i < st.length; i++) {
      const s = st[i];
      let ok = isObj(s) && isInt(s.n) && s.n === i + 1 && (s.kind === "rules" || s.kind === "model");
      if (ok) {
        const allowed = new Set(["n", "kind", ...(s.kind === "model" ? ["question", "model", "when", "per"] : [])]);
        ok = !Object.keys(s).some((k) => !allowed.has(k)) && (s.kind === "rules" || (nm(s.model) && nm(s.question)))
          && (!has(s, "when") || isStr(s.when)) && (!has(s, "per") || isStr(s.per));
      }
      if (!ok) { p.push("stages_malformed"); shape = null; break; }
      shape.push([s.kind, has(s, "question") ? s.question : null, has(s, "when") ? s.when : null, has(s, "per") ? s.per : null]);
      if (s.kind === "model" && !models.includes(s.model)) models.push(s.model);
    }
  }
  if (!isStr(obj.arrangement) || !has(ARRANGEMENTS, obj.arrangement)) p.push("arrangement_unknown");
  else if (shape !== null) {
    const roles = ROLES[obj.arrangement];
    const want = ARRANGEMENTS[obj.arrangement].map(([k, q, w, per]) => [k, q ? roles[q] : null, w, per]);
    if (JSON.stringify(shape) !== JSON.stringify(want)) p.push("stages_not_the_arrangement");
    else if (Array.isArray(obj.questions) && !named(obj.questions, "questions", false).length
      && JSON.stringify([...new Set(Object.values(roles))].sort()) !== JSON.stringify(obj.questions.map((x) => x.name))) p.push("questions_not_the_stages");
  }
  if (!callOk(obj.call, shape !== null ? models : null)) p.push("call_malformed");
  return p;
}

export function rulesSha256(obj) {
  const p = problems(obj);
  if (p.length) throw new Error(p.join(", "));
  return sha256(canonical(obj));
}

const one = (x) => { const p = problems(x); return { problems: p, rules_sha256: p.length ? null : rulesSha256(x) }; };

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const a = process.argv.slice(2);
  if (a[0] === "--batch") console.log(JSON.stringify(JSON.parse(fs.readFileSync(0, "utf8")).map(one)));
  else if (a[0] === "--id" && a[1]) {
    const r = one(JSON.parse(fs.readFileSync(a[1], "utf8")));
    console.log(r.problems.length ? JSON.stringify({ problems: r.problems }) : r.rules_sha256);
    process.exit(r.problems.length ? 1 : 0);
  } else { console.error("usage: node furui_rules_id_v1.mjs --id ID.json | --batch < LIST.json"); process.exit(1); }
}
