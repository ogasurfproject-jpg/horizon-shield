// trust_signal_v1.mjs (2026-09-15, 番人)
// 台帳 worker の核。résumé envelope(assembleResume の出力)を、A2A trust.signals[] 互換の
// Layer 1 recomputable な第三者観測 signal に射影する。新データは作らず /resume の投影のみ。
//
// counts never scores を構造で守る: resume_v1 の FORBIDDEN_SCORE_KEYS を共有し、出力を scanNoScore で自己検査。
// score / penalty を1つでも吐いたら throw = 「NENRIN は score を付けん」を機械で強制。
//
// 悪い履歴の扱い(TOshi の「信用情報のようにペナルティ」への番人の答え):
//   HS は penalty を計算せん。悪い履歴は adverse ブロックに「事実の count」として出し、消せず錨付きで残す。
//   credit bureau が延滞を記録し、貸す/貸さんを決めるのは貸し手、と同じ分業。penalty は読み手の policy が決める。
//   HS が score を付けた瞬間、中立の観測者やのうて「誰が悪いか決める審判」になり看板を裏切る。だから count に留める。

import { canonical, FORBIDDEN_SCORE_KEYS } from "../resume-v1/resume_v1.mjs";

function scanNoScore(obj, path = "$") {
  if (Array.isArray(obj)) { obj.forEach((v, i) => scanNoScore(v, path + "[" + i + "]")); return; }
  if (obj && typeof obj === "object") {
    for (const k of Object.keys(obj)) {
      if (FORBIDDEN_SCORE_KEYS.has(k)) throw new Error("trust_signal must not carry a score key: " + path + "." + k);
      scanNoScore(obj[k], path + "." + k);
    }
  }
}

const SIG_SPEC = "https://gate.horizonshield.dev/ext/conduct/v1";

// résumé envelope -> nenrin-observation-signal(可搬・自己記述)
export function resumeToTrustSignal(resume, opts = {}) {
  const r = resume || {};
  const counts = r.counts || {};
  const wd = r.witness_diversity || {};
  const fr = r.freshness || {};
  const meas = Array.isArray(r.measurements) ? r.measurements : [];
  const disc = Array.isArray(r.discrepancies) ? r.discrepancies : [];
  const measurements = (Number(counts.PASS) || 0) + (Number(counts.FAIL) || 0);

  // 一番古い錨(年輪の底)
  let oldestAnchor = null, oldestT = null;
  for (const m of meas) {
    const a = (m && m.anchor) || {};
    if (a.bitcoin_block != null) {
      if (oldestT === null || (m.measured_at && m.measured_at < oldestT)) { oldestT = m.measured_at; oldestAnchor = a; }
    }
  }
  const last = meas.length ? meas[meas.length - 1] : null;

  const sig = {
    type: "trust-signal",
    signal_kind: "third-party-observation",   // 資格でも自己申告でもない=観測。NENRIN の異質さ
    spec: "nenrin-observation-signal-v1",
    as_of: opts.as_of || null,
    subject: { endpoint: r.measured_endpoint || null, agent_card: r.agent_card_url || null },
    issuer: {
      id: opts.issuer || "https://gate.horizonshield.dev",
      is_party_to_subject: !!opts.issuer_is_party,
      note: opts.issuer_is_party ? "the issuer is a party to the subject; disclosed, not hidden" : "the issuer is a third party that does not own the subject",
    },
    observation: {
      measurements,
      pass: Number(counts.PASS) || 0,
      distinct_witnesses: Number(wd.distinct_names) || 0,
      distinct_vantages: Number(wd.distinct_vantages) || 0,
      disagreements_preserved: disc.length,
    },
    // 悪い履歴 = 事実の count。score でも penalty でもない。消せん・錨付き。読み手が penalty を決める。
    adverse: {
      note: "Factual adverse record, counts not a score. HS records and preserves; a reader applies any penalty. A credit bureau records the delinquency; the lender decides the loan.",
      fail_outcomes: Number(counts.FAIL) || 0,       // FAIL に終わった歩きの数
      disagreements: disc.length,                    // 保存された食い違い(消せん)
      stale: !fr.current_now,                         // 直近周期に測られとらん=古い(事実として出す)
      erasable: false,                                // 追記専用+錨=運営者は消せん
    },
    time_depth: {
      first_observed: fr.oldest_measurement || null,
      last_observed: fr.last_measured || null,
      currently_fresh: !!fr.current_now,
      oldest_anchor: oldestAnchor
        ? { chain: "bitcoin", via: "opentimestamps", block: oldestAnchor.bitcoin_block, block_time: oldestAnchor.block_time || null, ots: oldestAnchor.ots || null }
        : null,
    },
    integrity: {
      append_only: true,
      operator_cannot_delete_valid_records: true,
      resume_sha256: r.resume_sha256 || null,
      last_record_sha256: last ? last.record_sha256 : null,
      last_record_url: last ? last.record_url : null,
      recompute: "GET each measurement's record_url, sha256(body) must equal record_sha256; check the Bitcoin anchor via OpenTimestamps; then canonical(resume without resume_sha256) sha256 must equal resume_sha256. No trust in the issuer required.",
    },
    maps_to: {
      a2a_trust_signals: "A2A Agent Card trust.signals[] の 1 entry(a2aproject/A2A#1628、開発中)。HS は Bitcoin timestamp + record 再計算 + 第三者観測 = Recomputable (Layer 1) 側。type=behavioral に写す。",
      layer: "recomputable",
      a2a_type: "behavioral",
      scored: false,
    },
  };
  scanNoScore(sig);   // score / penalty を吐いてへんことを構造で確認(吐いたら throw)
  return sig;
}

// nenrin-observation-signal -> A2A trust.signals[] の 1 entry(type=behavioral、Layer 1)
export function toA2ATrustSignal(sig, opts = {}) {
  const o = sig.observation || {};
  const t = sig.time_depth || {};
  const dir = "higher_is_better";
  const metrics = [
    { uri: SIG_SPEC + "#distinct_witnesses", value: o.distinct_witnesses || 0, unit: "witnesses", direction: dir },
    { uri: SIG_SPEC + "#distinct_vantages", value: o.distinct_vantages || 0, unit: "vantages", direction: dir },
    // 食い違い/失敗は良し悪しを HS が付けん=方向なし。事実として出す
    { uri: SIG_SPEC + "#disagreements_preserved", value: o.disagreements_preserved || 0, unit: "records", direction: "none" },
    { uri: SIG_SPEC + "#fail_outcomes", value: (sig.adverse && sig.adverse.fail_outcomes) || 0, unit: "walks", direction: "none" },
    { uri: SIG_SPEC + "#measurements", value: o.measurements || 0, unit: "measurements", direction: dir },
  ];
  const entry = {
    type: "behavioral",
    provider: { name: "HORIZON SHIELD Verify Gate", jwks: (opts.gate || "https://gate.horizonshield.dev") + "/.well-known/jwks.json", kid: opts.kid || "hs-2026-09", sig: null },
    subject: { agentCardBinding: { agent_card: sig.subject && sig.subject.agent_card, endpoint: sig.subject && sig.subject.endpoint } },
    scope: { domain: "mcp-a2a-conduct-observation", capability: "third-party-measured-conduct" },
    window: { start: t.first_observed || null, end: sig.as_of, observationCount: o.measurements || 0 },
    metrics,
    expiresAt: opts.expiresAt || null,
    "x-nenrin": {
      layer: "recomputable",
      third_party_observed: true,
      issuer_is_party: !!(sig.issuer && sig.issuer.is_party_to_subject),
      adverse: sig.adverse,               // 悪い履歴の事実(消せん・count・score でない)
      time_anchor: t.oldest_anchor || null,
      append_only: true,
      operator_cannot_delete_valid_records: true,
      verify: sig.integrity,
      scored: false,
      note: "Layer-1 recomputable third-party observation signal. No score, no penalty. A reader recomputes the records and applies its own policy. Maps to A2A trust.signals[] type=behavioral (a2aproject/A2A#1628, in development). sig is null: signed off-worker with the gate key.",
    },
  };
  scanNoScore(entry);
  return entry;
}
