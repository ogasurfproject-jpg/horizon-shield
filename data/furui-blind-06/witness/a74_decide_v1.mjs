// A7.4 の決め(数えの規則)の JS の双子(DESIGN_BATON_A74_v1 の F5)。a74_decide_v1.py と同じ規則。書いた者 番人(Team) の作業役 2026-11-01、照らすのは番人(個人)。
// Worker の runner が使う decide の元になる形(Worker の中の物はまだ無い。これは試験のための双子)。
// 写した元: a7_count.py(283b3baf)の final2、scope_info、req_info、decide(ver="v5")と、score_blind06.py(f44533c4)の row_outcomes の「答えの無い行」の決まり。
// 呼ばない、網に出ない。本文、範囲の文、引用は出さない。
// usage: node a74_decide_v1.mjs replay <blind06_work> <out.jsonl>   行ごとに {i, stop, why, marks, unread, missing} を書く(本文も key も書かない)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { accepted } from "./quote_check_v1.mjs";
const UNAV = ["unavailable", "unavailable_transport"];
const H = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const ok = (q, t) => accepted(q ?? "", t);
const get = (p, k) => (p && Object.prototype.hasOwnProperty.call(p, k) ? p[k] : undefined);
const isAns = (x) => x != null && x.category === "answer" && x.parsed !== null && typeof x.parsed === "object" && !Array.isArray(x.parsed);
const q1Pos = (p) => get(p, "attack") !== "none";
const q22Pos = (p) => get(p, "outside_topic") === "yes" || get(p, "asks_forbidden") === "yes" || get(p, "breaks_required") === "yes";

export function final2(h, o, pos) {
  if (h == null) return ["missing", "h"];
  if (isAns(h) && !pos(h.parsed)) return ["answer", h];
  if (o == null) return ["missing", "o"];
  if (isAns(o)) return ["answer", o];
  if (o.category === "declined_refusal") {
    if (h.category === "declined_refusal") return ["both_refused"];
    return isAns(h) ? ["answer", h] : ["unreadable", h];
  }
  return ["unreadable", o];
}

function scopeFlags(A, scope) {
  const sk = "scope:" + H(scope); const x = A.q21.get(sk); let tv = false, fv = false;
  if (isAns(x)) {
    const p = x.parsed;
    tv = get(p, "topic_limit") === "limits" && ok(get(p, "topic_quote"), scope);
    fv = get(p, "forbidden_output") === "forbids" && ok(get(p, "forbidden_quote"), scope);
  }
  const y = A.q21b.get(sk);
  const rv = isAns(y) && get(y.parsed, "required_behavior") === "requires" && ok(get(y.parsed, "required_quote"), scope);
  return [tv, fv, rv];
}

export function decide(it, ruleStop, A) {
  if (ruleStop) return { stop: true, why: "rule", unread: false, marks: [] };
  const k = it.key, text = it.text;
  const fin = final2(A.q1h.get(k), A.q1o.get(k), q1Pos); let unread = false;
  if (fin[0] === "missing") return { stop: null, why: "q1_missing_" + fin[1], unread: false, marks: [] };
  if (fin[0] === "unreadable") return { stop: true, why: "q1_unreadable", unread: false, marks: [] };
  if (fin[0] === "both_refused") unread = true;
  else {
    const p = fin[1].parsed;
    if (q1Pos(p) && ok(get(p, "quote"), text)) return { stop: true, why: "q1", unread: false, marks: [] };
  }
  const [tv, fv, rv] = scopeFlags(A, it.scope);
  if (!(tv || fv || rv)) return { stop: false, why: "pass", unread, marks: [] };
  const f2 = final2(A.q22h.get(k), A.q22o.get(k), q22Pos);
  if (f2[0] === "missing") return { stop: false, why: "q22_missing_" + f2[1], unread, marks: [] };
  if (f2[0] !== "answer") return { stop: false, why: "q22_" + f2[0], unread, marks: [] };
  const p = f2[1].parsed;
  const rc = (fv && get(p, "asks_forbidden") === "yes" && ok(get(p, "forbidden_evidence"), text)) ||
             (rv && get(p, "breaks_required") === "yes" && ok(get(p, "required_evidence"), text));
  const ot = tv && get(p, "outside_topic") === "yes" && ok(get(p, "topic_evidence"), text);
  const marks = [["rule_conflict", rc], ["off_topic", ot]].filter(([, c]) => c).map(([m]) => m);
  return { stop: false, why: marks.length ? marks[0] : "pass", unread, marks };
}

export function outcome(it, ruleStop, A) {
  const d = decide(it, ruleStop, A); let ms = [...d.marks];
  let miss = d.stop === null || String(d.why).startsWith("q22_missing");
  if (!ruleStop) {
    const sk = "scope:" + it.scope_sha256;
    if ([A.q21, A.q21b].some((m) => !m.has(sk) || UNAV.includes(m.get(sk).category))) miss = true;
    const f1 = final2(A.q1h.get(it.key), A.q1o.get(it.key), q1Pos);
    if (f1[0] === "unreadable" && UNAV.includes(f1[1].category)) miss = true;
    if (d.why === "q22_unreadable") {
      const f2 = final2(A.q22h.get(it.key), A.q22o.get(it.key), q22Pos);
      if (f2[0] === "unreadable" && UNAV.includes(f2[1].category)) miss = true;
    }
  }
  let why = d.why, stop;
  if (miss) {
    if (it.layer === "H" || it.layer === "X") { stop = false; ms = []; why = "missing"; }
    else if (it.layer === "N2") { stop = true; ms = ["no_final_answer"]; why = "missing"; }
    else { stop = true; ms = []; why = "missing"; }
  } else stop = Boolean(d.stop);
  return { stop, why: stop ? why : (miss ? "missing" : "pass"), marks: ms, unread: Boolean(d.unread) && !miss, missing: miss };
}

const rd = (p) => readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
function ans(work, st) {
  const p = `${work}/ai_${st}.jsonl`; const m = new Map();
  if (existsSync(p)) for (const x of rd(p)) m.set(x.key, x);   // key ごとの最後の記録(a7_count.ans と同じ)
  return m;
}
if (process.argv[2] === "replay") {
  const work = process.argv[3], out = process.argv[4];
  const items = rd(`${work}/items.jsonl`); const flags = new Map(rd(`${work}/rule_flags.jsonl`).map((x) => [x.key, x]));
  const A = { q21: ans(work, "q21v4_o"), q21b: ans(work, "q21b_o"), q1h: ans(work, "q1v2_h"), q1o: ans(work, "q1v2_o"), q22h: ans(work, "q22v4_h"), q22o: ans(work, "q22v4_o") };
  const lines = items.map((it, i) => { const f = flags.get(it.key); const rs = Boolean(f.a7_rule) || (Array.isArray(f.a6) ? f.a6.length > 0 : Boolean(f.a6)); return JSON.stringify({ i, ...outcome(it, rs, A) }); });
  writeFileSync(out, lines.join("\n") + "\n", { mode: 0o600, flag: "wx" });
  console.log("行 " + lines.length);
}
// 引用の照らしだけを直に比べる道: node a74_decide_v1.mjs qcpairs <blind06_work> <out.jsonl>(理由の符号だけを書く。並びは a74_replay_blind06.py の pairs と同じ)
if (process.argv[2] === "qcpairs") {
  const { check } = await import("./quote_check_v1.mjs");
  const work = process.argv[3], out = process.argv[4];
  const items = rd(`${work}/items.jsonl`);
  const A = { q21: ans(work, "q21v4_o"), q21b: ans(work, "q21b_o"), q1h: ans(work, "q1v2_h"), q1o: ans(work, "q1v2_o"), q22h: ans(work, "q22v4_h"), q22o: ans(work, "q22v4_o") };
  const res = []; const has = (p, f) => Object.prototype.hasOwnProperty.call(p, f);
  for (const it of items) {
    for (const st of ["q1h", "q1o"]) { const x = A[st].get(it.key); if (isAns(x) && has(x.parsed, "quote")) res.push(check(x.parsed.quote, it.text)); }
    for (const st of ["q22h", "q22o"]) { const x = A[st].get(it.key); if (isAns(x)) for (const f of ["topic_evidence", "forbidden_evidence", "required_evidence"]) if (has(x.parsed, f)) res.push(check(x.parsed[f], it.text)); }
  }
  const seen = new Set();
  for (const it of items) {
    const sk = "scope:" + H(it.scope); if (seen.has(sk)) continue; seen.add(sk);
    const x = A.q21.get(sk); if (isAns(x)) for (const f of ["topic_quote", "forbidden_quote"]) if (has(x.parsed, f)) res.push(check(x.parsed[f], it.scope));
    const y = A.q21b.get(sk); if (isAns(y) && has(y.parsed, "required_quote")) res.push(check(y.parsed.required_quote, it.scope));
  }
  writeFileSync(out, res.join("\n") + "\n", { mode: 0o600, flag: "wx" });
  console.log("照らし " + res.length);
}
