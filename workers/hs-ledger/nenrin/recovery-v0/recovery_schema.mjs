// RUN_ALL: library  recovery-v0 の 5 記録の型 (+ v2 の埋め込み観測 1 種)。採点は recovery_verify_test.mjs
//
// TSUGI (継、旧称 Proof-of-Recovery) の記録 5 種 (設計書 5 節)。
//   drift → proposal → authorization → execution → verify
// 全部 append-only。prev に前の記録の record_sha256 を持つ。drift だけ prev が null (区間の頭)。
// establishes / does_not_establish は conduct-v1.1 と同じ規律: 無い・空は拒否 (disclaimer_missing)。
//
// v0 の約束 (2026-09-20): 記録に JSON の数は入れん。数は文字列で持つ ("43")。
// 理由は agreement_canonical.mjs の頭に書いてある int / float の継ぎ目や。v0 はそこを踏まん。
// 数を入れる版 (v1) は RFC 8785 か parseStrict を採る。それまでは文字列。

export const SCHEMAS = {
  drift: "nenrin-drift-record-v1",
  proposal: "nenrin-repair-proposal-v1",
  authorization: "nenrin-authorization-v1",
  execution: "nenrin-repair-execution-v1",
  verify: "nenrin-verify-record-v1",
  // v2 (設計書 14 節): 籤で引いた外部証人が返す観測。連鎖には並ばん。verify.external[].record に埋め込まれる。
  observation: "nenrin-witness-observation-v1",
};
export const ORDER = [SCHEMAS.drift, SCHEMAS.proposal, SCHEMAS.authorization, SCHEMAS.execution, SCHEMAS.verify];
export const EMBEDDED = [SCHEMAS.observation];

// v1 のカタログ。閉じた一覧 (設計書 6 節)。ここに無いプリミティブは提案も実行も拒否。追加は ADR。
export const PRIMITIVES = {
  quarantine_endpoint:            { reversible: true,  approval: "auto"  },
  redeploy_pinned:                { reversible: true,  approval: "human" },
  resign_agent_card:              { reversible: true,  approval: "human" },
  revert_to_last_witnessed_good:  { reversible: true,  approval: "human" },
  rotate_credential:              { reversible: false, approval: "human" },
};

const HEX64 = /^[0-9a-f]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

const isStr = (v) => typeof v === "string" && v.length > 0;
const isStrArr = (v) => Array.isArray(v) && v.length > 0 && v.every(isStr);
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const isHex = (v) => isStr(v) && HEX64.test(v);
const isDigits = (v) => isStr(v) && /^[0-9]+$/.test(v);
const isHttps = (v) => isStr(v) && /^https:\/\/[^\s/]+/.test(v);

// 数が紛れ込んどらんか (v0 の約束)。深さ優先で見る。
export function hasNumber(v) {
  if (typeof v === "number" || typeof v === "bigint") return true;
  if (Array.isArray(v)) return v.some(hasNumber);
  if (isObj(v)) return Object.values(v).some(hasNumber);
  return false;
}

function checkCommon(r, refuse) {
  if (!isObj(r)) { refuse("not_object", "record is not a JSON object"); return; }
  if (!ORDER.includes(r.schema) && !EMBEDDED.includes(r.schema)) refuse("bad_schema", "schema must be one of " + ORDER.concat(EMBEDDED).join(", "));
  if (!isStr(r.recorded_at) || !ISO.test(r.recorded_at)) refuse("bad_recorded_at", "recorded_at must be ISO-8601 UTC ending in Z");
  if (!isObj(r.witness) || !isStr(r.witness.name) || !isStr(r.witness.vantage)) refuse("bad_witness", "witness.name and witness.vantage are required");
  if (!isStrArr(r.establishes)) refuse("disclaimer_missing", "establishes must be a non-empty array of strings");
  if (!isStrArr(r.does_not_establish)) refuse("disclaimer_missing", "does_not_establish must be a non-empty array of strings");
  if (!(r.prev === null || isHex(r.prev))) refuse("bad_prev", "prev must be null or 64 hex");
  if (r.record_sha256 !== undefined && !isHex(r.record_sha256)) refuse("bad_record_sha256", "record_sha256, when present, must be 64 hex");
  if (hasNumber(r)) refuse("number_in_record", "v0 records carry no JSON numbers; write counts as strings");
}

const CHECK = {
  [SCHEMAS.drift](r, refuse) {
    if (!isStr(r.endpoint)) refuse("bad_endpoint", "endpoint is required");
    if (!isStr(r.surface)) refuse("bad_surface", "surface is required (what was measured)");
    if (typeof r.drift !== "boolean") refuse("bad_drift", "drift must be a boolean");
    if (!isObj(r.observed)) refuse("bad_observed", "observed must be an object");
    if (!isObj(r.expected)) refuse("bad_expected", "expected must be an object");
    if (r.drift === true && !isStr(r.kind)) refuse("bad_kind", "kind is required when drift is true");
    if (r.prev !== null) refuse("bad_prev", "a drift record starts a segment: prev must be null");
    if (r.source !== undefined && !isObj(r.source)) refuse("bad_source", "source, when present, is an object naming the external witness");
  },
  [SCHEMAS.proposal](r, refuse) {
    if (!Array.isArray(r.drift_sha256) || r.drift_sha256.length === 0 || !r.drift_sha256.every(isHex)) refuse("bad_drift_sha256", "drift_sha256 must be a non-empty array of 64 hex");
    if (!isStr(r.primitive) || !(r.primitive in PRIMITIVES)) refuse("primitive_not_in_catalog", "primitive must be one of " + Object.keys(PRIMITIVES).join(", "));
    if (!isStr(r.diagnosis)) refuse("bad_diagnosis", "diagnosis is required");
    if (!isObj(r.expected_after)) refuse("bad_expected_after", "expected_after must be an object: surface -> expected state");
    if (!isStr(r.rollback)) refuse("bad_rollback", "rollback is required");
    if (!isHex(r.prev)) refuse("bad_prev", "proposal must link to the last drift record");
    if (r.rejected !== undefined && !(Array.isArray(r.rejected) && r.rejected.every((x) => isObj(x) && isStr(x.primitive) && isStr(x.why)))) refuse("bad_rejected", "rejected entries need primitive and why");
  },
  [SCHEMAS.authorization](r, refuse) {
    if (!isHex(r.proposal_sha256)) refuse("bad_proposal_sha256", "proposal_sha256 must be 64 hex");
    if (!["approved", "refused"].includes(r.decision)) refuse("bad_decision", "decision must be approved or refused");
    if (!isStr(r.by)) refuse("bad_by", "by is required (who decided)");
    if (!isStr(r.expires_at) || !ISO.test(r.expires_at)) refuse("bad_expires_at", "expires_at must be ISO-8601 UTC");
    if (!isHex(r.prev)) refuse("bad_prev", "authorization must link to the proposal");
    else if (r.prev !== r.proposal_sha256) refuse("prev_mismatch", "authorization.prev must equal proposal_sha256");
  },
  [SCHEMAS.execution](r, refuse) {
    if (!isHex(r.authorization_sha256)) refuse("bad_authorization_sha256", "authorization_sha256 must be 64 hex");
    if (!isStr(r.primitive) || !(r.primitive in PRIMITIVES)) refuse("primitive_not_in_catalog", "primitive must be in the catalog");
    if (!isObj(r.before)) refuse("bad_before", "before must be an object (state before)");
    if (!isObj(r.after)) refuse("bad_after", "after must be an object (state after)");
    if (!["ok", "failed", "rolled_back"].includes(r.outcome)) refuse("bad_outcome", "outcome must be ok, failed or rolled_back");
    if (!isStrArr(r.steps)) refuse("bad_steps", "steps must be a non-empty array of strings");
    if (!isHex(r.prev)) refuse("bad_prev", "execution must link to the authorization");
    else if (r.prev !== r.authorization_sha256) refuse("prev_mismatch", "execution.prev must equal authorization_sha256");
  },
  [SCHEMAS.verify](r, refuse) {
    if (!isHex(r.execution_sha256)) refuse("bad_execution_sha256", "execution_sha256 must be 64 hex");
    if (!isObj(r.observed)) refuse("bad_observed", "observed must be an object");
    if (!isObj(r.expected_after)) refuse("bad_expected_after", "expected_after must be an object");
    if (typeof r.recovered !== "boolean") refuse("bad_recovered", "recovered must be a boolean");
    if (r.external !== undefined && !Array.isArray(r.external)) refuse("bad_external", "external, when present, is an array of external witness results");
    else if (Array.isArray(r.external)) {
      // v0 の自由形 (witness / status / result) はそのまま許す。record を持つ項 (v2) だけ形を見る。
      for (const e of r.external) {
        if (!isObj(e)) { refuse("bad_external", "external entries must be objects"); continue; }
        if (e.record !== undefined) {
          if (!isObj(e.record)) refuse("bad_external", "external[].record, when present, is the witness's signed observation record");
          if (!isStr(e.signed_domain)) refuse("bad_external", "external[].signed_domain is required beside a record");
        }
        if (e.answered !== undefined && typeof e.answered !== "boolean") refuse("bad_external", "external[].answered, when present, is a boolean");
      }
    }
    // v2 籤 (設計書 14.3): 誰を呼んだかを再計算できる形で持つ。無くてもよい (v0 互換)。在るなら形は固い。
    if (r.draw !== undefined) {
      const d = r.draw;
      if (!isObj(d)) refuse("bad_draw", "draw must be an object");
      else {
        if (!isObj(d.beacon) || !isStr(d.beacon.kind) || !isDigits(d.beacon.height) || !isHex(d.beacon.hash)) refuse("bad_draw", "draw.beacon needs kind, height (digits as a string) and hash (64 hex)");
        if (!isHex(d.pool_sha256)) refuse("bad_draw", "draw.pool_sha256 must be 64 hex");
        if (!isDigits(d.pool_size)) refuse("bad_draw", "draw.pool_size must be digits as a string");
        if (!isDigits(d.k)) refuse("bad_draw", "draw.k must be digits as a string");
        if (!isHex(d.subject_sha256)) refuse("bad_draw", "draw.subject_sha256 must be 64 hex (the record the draw serves)");
        if (!isHex(d.request_sha256)) refuse("bad_draw", "draw.request_sha256 must be 64 hex (the request every drawn witness received)");
        if (!Array.isArray(d.drawn) || !d.drawn.every(isStr)) refuse("bad_draw", "draw.drawn must be an array of signed_domain strings (may be empty when the pool is empty)");
      }
    }
    if (!isHex(r.prev)) refuse("bad_prev", "verify must link to the execution");
    else if (r.prev !== r.execution_sha256) refuse("prev_mismatch", "verify.prev must equal execution_sha256");
  },
  // v2: 外部証人の観測。証人が自分の domain 鍵で署名して返す 1 記録。連鎖の外、verify.external[].record の中に居る。
  // 「指示」の欄は無い。observed の hash が比べられるだけ。証人が何を書いても Shield は動かん (設計書 14.1)。
  [SCHEMAS.observation](r, refuse) {
    if (!isStr(r.endpoint)) refuse("bad_endpoint", "endpoint is required (the origin that was measured)");
    if (!isObj(r.observed) || Object.keys(r.observed).length === 0 || !Object.values(r.observed).every(isObj)) refuse("bad_observed", "observed must be an object: surface -> observed state object");
    if (!isHex(r.request_sha256)) refuse("bad_request_sha256", "request_sha256 must be 64 hex (canonical sha256 of the request the witness answered)");
    if (!isObj(r.source) || r.source.kind !== "external_witness" || !isStr(r.source.signed_domain) || !isHttps(r.source.key_url)) refuse("bad_source", "source must be { kind: external_witness, signed_domain, key_url (https) }");
    else if (r.source.key_url && r.source.signed_domain) {
      let host = ""; try { host = new URL(r.source.key_url).host; } catch {}
      if (host.toLowerCase() !== r.source.signed_domain.toLowerCase()) refuse("bad_source", "source.signed_domain must be the host of source.key_url (conduct-v1.1 11.4)");
    }
    if (r.prev !== null) refuse("bad_prev", "an observation stands alone: prev must be null");
  },
};

// 1 記録の型検査。断りの一覧を返す (空 = 型は通った)。同じ (code, why) は一度だけ。
export function validate(record) {
  const refusals = [];
  const seen = new Set();
  const refuse = (code, why) => { const k = code + "|" + why; if (seen.has(k)) return; seen.add(k); refusals.push({ code, why }); };
  checkCommon(record, refuse);
  if (isObj(record) && CHECK[record.schema]) CHECK[record.schema](record, refuse);
  return refusals;
}
