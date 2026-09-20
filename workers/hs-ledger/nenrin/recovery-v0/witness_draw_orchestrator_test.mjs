// RUN_ALL: suite
// witness_draw_orchestrator: 引く側の一周が、定足数を満たす有効な verify 記録を吐き、錨 seed が再計算できるか。
// 証人は fixture 鍵で本物に署名する (witness_reply.answerRequest をそのまま使う)。network 無し。
// 走らせ方: node witness_draw_orchestrator_test.mjs
import { runDraw, appendSeed } from "./witness_draw_orchestrator.mjs";
import { answerRequest } from "./witness_reply.mjs";
import { buildPool, buildBeacon, buildCommitment, fixtureKey, OWN_HOST, ORIGIN } from "./witness_fixture_build.mjs";
import { verifyRecord, sha256Hex, canonicalText } from "./recovery_verify.mjs";

let pass = 0, fail = 0; const out = [];
const t = (name, ok, detail) => { ok ? pass++ : fail++; out.push((ok ? "  ok   " : "  NG   ") + name + (ok || !detail ? "" : "  <<< " + detail)); };

const SUBJECT = await sha256Hex("fixture execution record to re-verify");
const EXPECTED = { "health.gate_commit": { gate_commit: "recovered-commit-abcdef" }, "well-known.did": { present: "true" } };
const SURFS = Object.keys(EXPECTED);
const EXEC_AT = "2026-09-20T00:00:00Z";

// 模擬の測定: expected を含む観測を返す (証人は一致する)。
const stubMeasure = () => async () => Object.entries(EXPECTED).map(([surface, e]) => ({ surface, observed: { status: "200", ...e, vantage_note: "fixture" } }));
// 模擬の送信: 引いた順に最初の answerCount 人だけ本物に署名して答え、残りは沈黙。
const mkSend = (answerCount) => { let n = 0; return async (entry, req) => {
  n++;
  if (n > answerCount) return { signed_domain: entry.signed_domain, answered: false, why: "silent_fixture" };
  const k = await fixtureKey(entry.signed_domain);
  const r = await answerRequest(req, { signedDomain: entry.signed_domain, keyUrl: entry.key_url, priv: k.privKey, pubRaw: k.pubRaw, measure: stubMeasure(), allowPrivateTargets: true });
  return { signed_domain: entry.signed_domain, answered: r.answered, record: r.record, why: r.declined };
}; };

const pool = await buildPool();
const beacon = await buildBeacon();
const commitment = await buildCommitment(SUBJECT);

// A. 幸せな道: k=3, 2 人答えて一致、q=2 -> 定足数達成、拒否ゼロ
{
  const o = await runDraw({
    pool, subjectSha256: SUBJECT, endpoint: ORIGIN, ownHost: OWN_HOST, k: 3, surfaces: SURFS,
    beacon, commitment, expectedAfter: EXPECTED, observed: { ...EXPECTED }, recovered: true,
    executionAt: EXEC_AT, quorumQ: 2, requireCommitment: true, sendImpl: mkSend(2),
  });
  t("drew 3 witnesses", o.draw.drawn.length === 3, JSON.stringify(o.draw.drawn));
  t("own host is not among the drawn (excluded)", !o.draw.drawn.map((x) => x.toLowerCase()).includes(OWN_HOST.toLowerCase()), JSON.stringify(o.draw.drawn));
  t("2 answered, 1 silent", o.sent.filter((s) => s.answered).length === 2 && o.sent.filter((s) => !s.answered).length === 1, JSON.stringify(o.sent));
  t("verifyWitnesses returns no refusals", o.result.refusals.length === 0, JSON.stringify(o.result.refusals));
  t("quorum met: agreeing >= 2", o.result.agreeing.length >= 2, "agreeing=" + o.result.agreeing.length + " disagreeing=" + o.result.disagreeing.length);
  const v = await verifyRecord(o.verify);
  t("the verify record is itself well-formed (schema + record_sha256)", v.ok, JSON.stringify(v.refusals || []));
  // 錨 seed
  const seed = await appendSeed(o.verify);
  t("append seed claim_sha256 == verify.record_sha256", seed.claim_sha256 === o.verify.record_sha256, seed.claim_sha256 + " vs " + o.verify.record_sha256);
  t("append seed record_canonical recomputes to claim_sha256", (await sha256Hex(seed.record_canonical)) === seed.claim_sha256);
  t("commitment binds beacon to anchor+1 (no beacon_not_next_block refusal)", !o.result.refusals.some((r) => r.code === "beacon_not_next_block"));
}

// B. 定足数不足: 同じく 2 人答えるが q=3 -> witness_quorum_short で正直に断る
{
  const o = await runDraw({
    pool, subjectSha256: SUBJECT, endpoint: ORIGIN, ownHost: OWN_HOST, k: 3, surfaces: SURFS,
    beacon, commitment, expectedAfter: EXPECTED, observed: { ...EXPECTED }, recovered: true,
    executionAt: EXEC_AT, quorumQ: 3, requireCommitment: true, sendImpl: mkSend(2),
  });
  t("q=3 with only 2 agreeing -> witness_quorum_short", o.result.refusals.some((r) => r.code === "witness_quorum_short"), JSON.stringify(o.result.refusals));
}

// C. commit-then-reveal 必須やのに commitment 無し -> draw_uncommitted
{
  const o = await runDraw({
    pool, subjectSha256: SUBJECT, endpoint: ORIGIN, ownHost: OWN_HOST, k: 3, surfaces: SURFS,
    beacon, commitment: null, expectedAfter: EXPECTED, observed: { ...EXPECTED }, recovered: true,
    executionAt: EXEC_AT, quorumQ: 2, requireCommitment: true, sendImpl: mkSend(2),
  });
  t("requireCommitment with no commitment -> draw_uncommitted", o.result.refusals.some((r) => r.code === "draw_uncommitted"), JSON.stringify(o.result.refusals));
}

// D. 引かれてない証人の観測を混ぜたら弾く (身元は本物、でも drawn に無い)
{
  const o = await runDraw({
    pool, subjectSha256: SUBJECT, endpoint: ORIGIN, ownHost: OWN_HOST, k: 1, surfaces: SURFS,
    beacon, commitment, expectedAfter: EXPECTED, observed: { ...EXPECTED }, recovered: true,
    executionAt: EXEC_AT, quorumQ: 1, requireCommitment: true,
    sendImpl: (() => { let n = 0; return async (entry, req) => { n++; const k = await fixtureKey(entry.signed_domain); const r = await answerRequest(req, { signedDomain: entry.signed_domain, keyUrl: entry.key_url, priv: k.privKey, pubRaw: k.pubRaw, measure: stubMeasure(), allowPrivateTargets: true }); return { signed_domain: entry.signed_domain, answered: r.answered, record: r.record }; }; })(),
  });
  // 引かれた 1 人の観測を、別の (引かれてない) domain の署名済み観測にすり替える
  const notDrawn = pool.entries.map((e) => e.signed_domain).find((dm) => dm !== OWN_HOST && !o.draw.drawn.includes(dm));
  const kk = await fixtureKey(notDrawn);
  const intruder = await answerRequest(o.request, { signedDomain: notDrawn, keyUrl: "https://" + notDrawn + "/.well-known/hs-witness-key.json", priv: kk.privKey, pubRaw: kk.pubRaw, measure: stubMeasure(), allowPrivateTargets: true });
  const tampered = { ...o.verify, external: [{ signed_domain: notDrawn, answered: true, record: intruder.record }] };
  const { verifyWitnesses } = await import("./recovery_verify.mjs");
  const res2 = await verifyWitnesses(tampered, { ownHost: OWN_HOST, endpoint: ORIGIN, executionSha256: SUBJECT, executionAt: EXEC_AT, quorum: { q: 1, k: "1", pool, beaconHash: beacon.hash, requireCommitment: true, commitmentAnchor: { height: commitment.anchor.height, hash: commitment.anchor.hash } } });
  t("an observation from a witness that was not drawn is refused (witness_not_drawn)", res2.refusals.some((r) => r.code === "witness_not_drawn"), JSON.stringify(res2.refusals));
}

console.log(out.join("\n"));
console.log("=== " + pass + " / " + (pass + fail) + " 合格 (witness draw orchestrator: 引く側の一周) ===");
if (fail) process.exit(1);