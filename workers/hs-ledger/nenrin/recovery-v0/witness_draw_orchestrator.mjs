// RUN_ALL: library  TSUGI v2 籤の「引く側」の一周。採点は witness_draw_orchestrator_test.mjs
//
// 何をするか (設計書 14 節):
//   修復 (execution) を 1 本、見知らぬ証人に再検証させる一周を回す。部品は既にある (draw / buildRequest / sendRequest /
//   verifyWitnesses)。無かったのはそれを順に繋ぐ入口。これがそれ。
//     1. 池を hash    2. 目隠しの依頼を組む (期待値は入れん)    3. beacon と subject から k 人を決定的に引く (自分は外す)
//     4. 引いた各証人の /a2a に依頼を送る    5. 返ってきた署名付き観測を集める    6. verify 記録を組んで seal する
//     7. verifyWitnesses で自分で検証する (署名・身元・引かれとるか・定足数)    8. 錨打ち用の seed を出す (トークンは運営者の手)
//
//   commit-then-reveal (14.6): subject を先に JIDEC に錨打ちして anchor ブロックを得、beacon = anchor.height + 1 を使う。
//   この関数は commitment と beacon を「渡された物」として受ける。錨打ち (append_witness、OTS) は運営者の手 (トークン)。
//   だからこの入口は鍵もトークンも持たん。純粋に「引いて送って集めて検証する」だけ。Worker cron 化はこの上に載せる。
//
// drand の予備 beacon は敢えて入れとらん: commit-then-reveal では beacon は anchor の「次のブロック」でなければならん (検証器が
//   beacon.height === anchor.height + 1 を見る)。drand の乱数はブロックやないので「次のブロック」になれん。二つの Bitcoin API
//   (mempool / blockstream) が両方落ちた時の予備は witness_draw の bases に足す話で、この一周の設計とは別。
import { poolSha256, draw, drawField, normalizePool } from "./witness_draw.mjs";
import { buildRequest, requestSha256, sendRequest } from "./witness_request.mjs";
import { seal, verifyWitnesses, canonicalText, sha256Hex } from "./recovery_verify.mjs";
import { SCHEMAS } from "./recovery_schema.mjs";

const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const SURFACES = ["health.gate_commit", "agent-card.signature", "well-known.jwks", "well-known.openai-apps-challenge", "ext.conduct-v1.spec", "keys.agreement", "keys.witness", "keys.operator", "well-known.did"];

// 一周を回す。sendImpl は差し替え可 (試験は network 無しで、本物は sendRequest)。
// 返す物: { verify (sealed), result (verifyWitnesses の所見), sent (各証人の送信結果), request, request_sha256, draw }
export async function runDraw({
  pool, subjectSha256, endpoint, ownHost, k, surfaces = SURFACES,
  beacon, commitment = null, expectedAfter, observed = {}, recovered,
  executionAt, operatorWitness, quorumQ, requireCommitment = false,
  sendImpl = sendRequest, clock = now, requestTimeoutMs = 30000,
}) {
  if (!pool || !subjectSha256 || !endpoint || !beacon || expectedAfter === undefined || recovered === undefined) {
    throw new Error("pool, subjectSha256, endpoint, beacon, expectedAfter and recovered are required");
  }
  const pSha = await poolSha256(pool);
  const requestedAt = clock();
  const request = buildRequest({ origin: endpoint, surfaces, subjectSha256, poolSha256: pSha, beacon, requestedAt });
  const reqHash = await requestSha256(request);
  const d = await draw({ pool, beaconHash: beacon.hash, subjectSha256, k, excludeHost: ownHost });

  const byDomain = new Map(normalizePool(pool).map((e) => [e.signed_domain.toLowerCase(), e]));
  const sent = [], external = [];
  for (const domain of d.drawn) {
    const entry = byDomain.get(String(domain).toLowerCase());
    if (!entry) { sent.push({ signed_domain: domain, answered: false, why: "not_in_pool" }); external.push({ signed_domain: domain, answered: false, why: "not_in_pool" }); continue; }
    let res; try { res = await sendImpl(entry, request, { timeoutMs: requestTimeoutMs }); }
    catch (e) { res = { signed_domain: domain, answered: false, why: "send_failed: " + String(e && e.message || e).slice(0, 120) }; }
    sent.push({ signed_domain: domain, answered: !!res.answered, ...(res.answered ? {} : { why: res.why || "no_answer" }) });
    if (res.answered && res.record) external.push({ signed_domain: domain, answered: true, record: res.record });
    else external.push({ signed_domain: domain, answered: false, why: res.why || "no_answer" });
  }

  const verify = {
    schema: SCHEMAS.verify, recorded_at: clock(),
    witness: operatorWitness || { name: "tsugi-orchestrator", vantage: "operator network (the draw is recomputable; the operator is not a witness of the outcome)" },
    prev: subjectSha256, execution_sha256: subjectSha256,
    observed, expected_after: expectedAfter, recovered: !!recovered,
    draw: drawField(d, beacon, subjectSha256, reqHash, commitment),
    external,
    establishes: [
      "the draw of witnesses is recomputable from beacon, pool and subject (draw), so the operator did not choose who was asked",
      "each embedded observation is signed by the domain it names and answers the one blinded request whose sha256 is in the draw",
      recovered ? "the operator's own re-measurement (observed) matches expected_after" : "the operator's own re-measurement does not match expected_after",
    ],
    does_not_establish: [
      "that any witness is a real independent agent: being in the pool means the card met the stated conditions, not that it is trusted",
      "the truth of what a witness observed beyond that it signed it: a signed liar fills a column, the draw only removes the operator's choice of who is asked",
      "anything about surfaces no witness was asked about",
    ],
  };
  const sealed = await seal(verify);
  const result = await verifyWitnesses(sealed, {
    ownHost, endpoint, executionSha256: subjectSha256, executionAt,
    quorum: { q: quorumQ, k: String(k), pool, beaconHash: beacon.hash, requireCommitment, commitmentAnchor: commitment ? { height: commitment.anchor.height, hash: commitment.anchor.hash } : null },
  });
  return { verify: sealed, result, sent, request, request_sha256: reqHash, draw: d };
}

// 錨打ち用の seed (append_witness.sh に渡す形、entry 50/51 と同じ型)。トークンは運営者の手で。
export async function appendSeed(verifyRecord) {
  const record_canonical = canonicalText(verifyRecord);
  return {
    claim_sha256: await sha256Hex(record_canonical),
    record_canonical,
    work: "TSUGI kuji re-verification: a repair (execution " + verifyRecord.execution_sha256 + ") was re-verified by witnesses drawn deterministically from a pool by a Bitcoin beacon the operator could not predict, and the draw and the signed observations are fixed on Bitcoin. The operator chose the pool and the policy, not who was asked.",
  };
}

// @@CLI_BEGIN
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) { const a = process.argv[i]; if (a.startsWith("--")) { const k = a.slice(2); const v = process.argv[i + 1]; if (v && !v.startsWith("--")) { args[k] = v; i++; } else args[k] = true; } }
  const need = ["pool", "subject", "endpoint", "own-host", "k", "beacon-kind", "beacon-height", "beacon-hash", "expected", "recovered", "execution-at", "q"];
  if (need.some((n) => args[n] === undefined)) { console.error("usage: node witness_draw_orchestrator.mjs --pool pool.json --subject <64hex> --endpoint https://x --own-host x --k 3 --beacon-kind bitcoin_block --beacon-height N --beacon-hash <64hex> --expected expected.json --recovered true --execution-at <ISO> --q 2 [--observed observed.json] [--commit commit.json] [--require-commitment] [--out verify.json] [--seed-out seed.json]"); process.exit(2); }
  const pool = JSON.parse(readFileSync(args.pool, "utf8"));
  const expectedAfter = JSON.parse(readFileSync(args.expected, "utf8"));
  const observed = args.observed ? JSON.parse(readFileSync(args.observed, "utf8")) : {};
  const commitment = args.commit ? JSON.parse(readFileSync(args.commit, "utf8")) : null;
  const beacon = { kind: args["beacon-kind"], height: String(args["beacon-height"]), hash: args["beacon-hash"] };
  const out = await runDraw({
    pool, subjectSha256: args.subject, endpoint: args.endpoint, ownHost: args["own-host"], k: Number(args.k),
    beacon, commitment, expectedAfter, observed, recovered: args.recovered === "true",
    executionAt: args["execution-at"], quorumQ: Number(args.q), requireCommitment: !!args["require-commitment"],
  });
  const seed = await appendSeed(out.verify);
  if (args.out) writeFileSync(args.out, JSON.stringify(out.verify, null, 1) + "\n");
  if (args["seed-out"]) writeFileSync(args["seed-out"], JSON.stringify(seed, null, 1) + "\n");
  console.error("tsugi-draw: drew [" + out.draw.drawn.join(", ") + "], answered " + out.sent.filter((s) => s.answered).length + "/" + out.sent.length +
    ", verify " + out.verify.record_sha256.slice(0, 12) + ", refusals " + out.result.refusals.length +
    " (agreeing " + out.result.agreeing.length + ", disagreeing " + out.result.disagreeing.length + ")");
  for (const r of out.result.refusals) console.error("  refuse " + r.code + ": " + r.why);
  if (!args.out) process.stdout.write(JSON.stringify({ verify: out.verify, seed, sent: out.sent, refusals: out.result.refusals }, null, 1) + "\n");
  process.exit(out.result.refusals.length ? 1 : 0);
}
