// trust_signal_selftest.mjs — résumé envelope -> trust-signal 射影の自己検証(offline、鍵不要)。
// 使い方: cd workers/hs-ledger/nenrin/trust-signal-v1 && node trust_signal_selftest.mjs
import { resumeToTrustSignal, toA2ATrustSignal } from "./trust_signal_v1.mjs";

const R = [];
const t = (name, cond, got) => { R.push({ name, ok: !!cond }); console.log((cond ? "ok   " : "NG   ") + name + (cond ? "" : "   <<< " + String(got).slice(0, 200))); };

// 良い履歴 + 悪い履歴が混ざった résumé envelope(assembleResume の出力形)
const RESUME = {
  schema: "nenrin-resume-v1",
  perma_id: "https://mcp.horizonshield.dev",
  measured_endpoint: "https://mcp.horizonshield.dev/mcp",
  agent_card_url: "https://mcp.horizonshield.dev/.well-known/agent-card.json",
  counts: { PASS: 3, FAIL: 2 },                       // 悪い履歴 = FAIL 2 本
  witness_diversity: { distinct_names: 2, distinct_vantages: 2 },
  measurements: [
    { measured_at: "2026-08-15T17:04:31Z", record_sha256: "aaa", outcome: "PASS", record_url: "https://ledger.horizonshield.dev/witness/aaa", anchor: { bitcoin_block: 965862, block_time: "2026-09-06 01:08 UTC", ots: "x", batch_sha256: "b1" } },
    { measured_at: "2026-09-14T18:00:00Z", record_sha256: "bbb", outcome: "FAIL", record_url: "https://ledger.horizonshield.dev/witness/bbb", anchor: { bitcoin_block: 970000, block_time: "2026-09-14 18:10 UTC", ots: "y", batch_sha256: "b2" } },
  ],
  discrepancies: [{ record_sha256: "bbb", disc: { note: "reachable vs 522" } }],  // 保存された食い違い
  rings: [],
  agreements: [],
  freshness: { last_measured: "2026-09-14T18:00:00Z", oldest_measurement: "2026-08-15T17:04:31Z", current_now: false, period_days: 30 },
  resume_sha256: "deadbeef",
};

const sig = resumeToTrustSignal(RESUME, { as_of: "2026-09-15T00:40:00Z", issuer_is_party: true });

t("signal_kind is third-party-observation", sig.signal_kind === "third-party-observation", sig.signal_kind);
t("subject.endpoint mapped", sig.subject.endpoint === "https://mcp.horizonshield.dev/mcp", sig.subject.endpoint);
t("issuer_is_party disclosed", sig.issuer.is_party_to_subject === true, sig.issuer);
t("measurements = PASS+FAIL", sig.observation.measurements === 5, sig.observation.measurements);
t("disagreements_preserved = discrepancies.length", sig.observation.disagreements_preserved === 1, sig.observation.disagreements_preserved);
// 悪い履歴が adverse に事実として出る(score でなく count)
t("adverse.fail_outcomes reflects FAIL count", sig.adverse.fail_outcomes === 2, sig.adverse.fail_outcomes);
t("adverse.disagreements reflects discrepancies", sig.adverse.disagreements === 1, sig.adverse.disagreements);
t("adverse.stale true when not current_now", sig.adverse.stale === true, sig.adverse.stale);
t("adverse.erasable false (append-only + anchor)", sig.adverse.erasable === false, sig.adverse.erasable);
// 年輪(時間深さ)と錨
t("time_depth.first_observed = oldest", sig.time_depth.first_observed === "2026-08-15T17:04:31Z", sig.time_depth.first_observed);
t("oldest_anchor picks the oldest block", sig.time_depth.oldest_anchor && sig.time_depth.oldest_anchor.block === 965862, sig.time_depth.oldest_anchor);
// no score(構造で守る)
t("maps_to.scored is false", sig.maps_to.scored === false, sig.maps_to.scored);
t("no forbidden score key anywhere (resumeToTrustSignal did not throw)", true, "");

// A2A entry
const entry = toA2ATrustSignal(sig);
t("a2a type behavioral", entry.type === "behavioral", entry.type);
t("a2a provider sig null (signed off-worker)", entry.provider.sig === null, entry.provider);
t("a2a x-nenrin.layer recomputable", entry["x-nenrin"].layer === "recomputable", entry["x-nenrin"].layer);
t("a2a carries adverse facts", entry["x-nenrin"].adverse && entry["x-nenrin"].adverse.fail_outcomes === 2, entry["x-nenrin"].adverse);
t("a2a metric fail_outcomes direction none (HS does not judge)", entry.metrics.find(m => m.uri.includes("fail_outcomes")).direction === "none", entry.metrics);
t("a2a metric disagreements direction none", entry.metrics.find(m => m.uri.includes("disagreements")).direction === "none", "");

// 負のテスト: 出力に伝播する場所(adverse)へ score を注入したら scanNoScore が throw する
// (toA2ATrustSignal は adverse を丸ごと x-nenrin へ写すので、guard が確かに output を守っとることを確かめる)
let threw = false, msg = "";
try { toA2ATrustSignal(Object.assign({}, sig, { adverse: Object.assign({}, sig.adverse, { trust_score: 0.9 }) })); } catch (e) { threw = true; msg = String(e.message); }
t("injecting a score key into output throws (no-score enforced structurally)", threw && /score key/.test(msg), threw ? msg : "did not throw");

const passed = R.filter(r => r.ok).length;
console.log("\n=== " + passed + " / " + R.length + " 合格 (trust_signal_v1 射影) ===");
console.log("悪い履歴は adverse に事実の count として出る。score も penalty も無い(構造で拒否)。読み手が penalty を決める。");
if (passed !== R.length) process.exit(1);
