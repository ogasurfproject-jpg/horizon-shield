// hs-verify-gate
// MCP Verification Gate / 検証の扉  (v0 適合性チェッカー)
//
// 目的:
//   申請された MCP エンドポイントを実測し、5条件への適合を決定論的に判定する。
//   人の裁量を入れない。だから無料で開放できる。
//
// 設計の芯:
//   - 実測のみ。自己申告は判定材料にしない(エンドポイントを実際に叩く)。
//   - fail-closed。判定できない項目は "unknown" ではなく不適合として扱う。
//   - 申請者が事前に自分で走らせられる(公開エンドポイント)。落ちる理由が自分で分かる。
//   - 判定結果に SHA-256 を付す。扉自身が扉の基準を満たす。
//   - 称号名・条件の重みは CONFIG で差し替え可能(仕様確定前でも動く)。
//
// 口:
//   POST /check   { "endpoint": "https://..." }   適合性チェックを実行
//   GET  /spec                                    条件の仕様(機械可読)
//   GET  /health                                  死活

import { recomputeHandler, verifyEventHandler, RECOMPUTE_USAGE, VERIFY_EVENT_USAGE } from "./recompute.js";
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

// 公開・読み取り専用のチェッカーなので、誰でもブラウザから叩けるよう CORS を開く。
// これが無いと shield ドメインの検証ディレクトリから /self・/check を実測取得できない。
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, a2a-extensions, x-a2a-extensions, a2a-version",
  "access-control-expose-headers": "a2a-extensions, x-a2a-extensions",
  "access-control-max-age": "86400"
};

// 0.3.0. 時刻座標。追補 NENRIN_COORDINATE_v1_ADDENDUM_instants_v1.md の実装。
// 追補は anchor 前の 2026-09-05 に §6 を書き直した(Federico の freshness_beacon を先行技術として明記)。
// 0.3.0 配備時の sha256 は c4929b29...、書き直し後(anchor 対象)は e228dfd8...。規則本体は同じ。
import * as nenrin from "./nenrin_instant.js";

// 仕様確定までの暫定値。名称や閾値はここだけ直せば全体に効く。
const CONFIG = {
  version: "0.4.2",  // 2026-09-09. 0.4.2: 判定に number_safety を入れる(判定自身のバイトの中の数値が全部 RFC 7493 の安全域の整数か。条件07 が測る相手の表面に課しとる規則を、扉自身の出力に課す。Federico Blanco Sanchez-Llanos が 2026-09-09 に payments 側から公開した同じ型: 精度はパースの時点で失われるので散文では間に合わん)。欄は数値を 1 つも持たんので、足しても答えは変わらん。hash の手順は不変。0.4.1: 掃引の判定は hash 対象のバイトそのものを KV に保存し、GET /record/<record_sha256> でそのまま配る(SEP-1913 で vaaraio が /is-verified の投影を 1024 通り直列化しても再現できんかった件。公開しとった sha のバイトは掃引では保存しとらんかった。recompute_url は /history を指しとった)。判定規則と hash の手順は不変。0.4.0 (conduct-v1.1): 判定と /self に establishes / does_not_establish を入れて hash に含める(Federico の 2026-09-07 の指摘: 「正しさは判定しとらん」の断りが落とせて conformance は通っとった)。塩の commitment を掃引ごとに台帳の witness intake へ commitment 型記録で錨打ち(窓ごとに 1 回、/nenrin/window に commitment_filed)。GET /register/lookup(verified/pending/declined/unknown + 先月の輪の数 + 証明せん物、24h cache)。well-known の notify / identity / witness_policy を読む(掃引後に notify へ POST、1 時間 1 回、/check からは飛ばさん)。判定規則は 0.3.0 のまま。0.3.5 (2026-09-06): 時刻座標の本番と設計のズレを直す(履歴に coordinate_derivation を残す、次の窓の salt を先に作り beacon は salt より後の block に限る、基準高さは quorum 番目の tip - 6 で hash の一致だけを要求、窓ごとに規則を固定、GET /nenrin/window で commitment を公開。判定規則は 0.3.0 のまま)。0.3.4: 相手の card の A2A 署名(§8.4)を読んで detail に書く(判定不変)。扉自身の card も署名可(署名は Mac で作る、鍵は Worker に無い)。0.3.2: A2A Conduct Extension v1(条件3 を capabilities.extensions[].params.compensation からも読む、両方あれば一致必須、/ext/conduct/v1 で仕様を配る)。0.3.3: 扉自身が A2A を喋る(/a2a に SendMessage と message/send、両綴りの拡張ヘッダ、1.0 と 0.3 の両線)。判定規則は 0.3.0 のまま。
  tier_pass: "verified",        // 通過時の称号(暫定)
  tier_fail: "pending",         // 未通過(不合格とは呼ばない)
  tier_held: "held",            // 到達できず測れなかった。不適合とは別の状態
  unreachable_streak: 3,        // 連続これだけ到達不能が続くまで通知しない
  timeout_ms: 10000,
  determinism_runs: 2,          // 決定論性の確認に何回叩くか
  determinism_tool_tries: 3     // 0.2.2: 空引数に error で答えるツールは測定にならない。別のツールを最大何本まで試すか
};

// 再計算の手順書。2026-08-23 に実測して書き直した。
// 旧文は "JSON.stringify the remainder in this key order" とだけ書いてあった。これは JavaScript の
// 言い回しであって、手順ではない。本番の記録1件で、第三者が自然に試す4通りを実際に走らせたところ、
// 素直な json.dumps も、区切りだけ詰めた版も、キーを並べ替えた版も、全て違うハッシュを出した。
// 再現したのは「区切りを詰める」かつ「非ASCIIをエスケープしない」の1通りだけだった。
// 誰でも再計算できると書く以上、その1通りを名指しする義務がこちらにある。
// 条件07 の適合ベクタと自己測定の公開先。判定JSONから直接たどれるようにする。
const CONFORMANCE_URL = "https://shield.the-horizons-innovation.com/verify-directory/conformance/";

// ---- 0.3.2. A2A Conduct Extension v1 ----
// 条件3(報酬構造の開示)の置き場所を、A2A 1.0 が拡張データに定めた正規の場所
// capabilities.extensions[{uri}].params にも広げる。top-level の compensation(0.2.0 以来)も読み続ける。
// 両方あれば 5 鍵が一致せねばならん。二つの申告が食い違う開示は開示ではない。
// URI は識別子。同じ URI で仕様本文(ext/CONDUCT_EXT_v1.md と同じ文)を配る。
const CONDUCT_EXT_URI = "https://gate.horizonshield.dev/ext/conduct/v1";

// ---- Agent Card 署名 (A2A 1.0 §8.4: JWS ES256 over RFC 8785 of the proto-shaped card, signatures 欄は除く) ----
// 署名は Worker の中では作らん。鍵を持つ Mac の上で workers/a2a-card-sign/sign.mjs が公式 SDK(@a2a-js/sdk)の generator で計算し、
// 下の定数を書き換える(配備前、commit 対象)。Worker は鍵を持たず、公開鍵だけを /.well-known/jwks.json で配る。
// card の中身が変わったら署名は必ず作り直す。作り直さんと検証で落ちる = 改ざんと同じ顔になる。それが正しい。
// 署名は正規の origin(CARD_CANONICAL_ORIGIN)で配る card にだけ付ける。workers.dev の別名で開いた card は signatures 無し。
/* @@CARD_SIGNATURE_BEGIN */
const CARD_SIGNATURE = {
  "kid": "hs-2026-09",
  "jku": "https://gate.horizonshield.dev/.well-known/jwks.json",
  "alg": "ES256",
  "protected": "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpPU0UiLCJraWQiOiJocy0yMDI2LTA5Iiwiamt1IjoiaHR0cHM6Ly9nYXRlLmhvcml6b25zaGllbGQuZGV2Ly53ZWxsLWtub3duL2p3a3MuanNvbiJ9",
  "signature": "4SdksJq8dLxqZJ0FTjNdKldDBRTxcZQyN7m6Lvss3i2_SGeQNussG7uOGCBfKzVRJsgSyLwwE20QeQARFhSWBQ",
  "jwk": {
    "kty": "EC",
    "x": "CytwnuXFtXi7PFCcF-TCbvW5OgOg4KuWRLeRvdfHWLs",
    "y": "Zha3FI2QplMaGveXjrIg8PxrZ6dTjHmESoGs88uAIiA",
    "crv": "P-256",
    "kid": "hs-2026-09",
    "alg": "ES256",
    "use": "sig"
  },
  "canonical_sha256": "112a6d2b2dac5ab065a6f0e1f097dedaa71065e4f96ecedc9e8a7a84d80d8ea2"
};
/* @@CARD_SIGNATURE_END */
const CARD_CANONICAL_ORIGIN = "https://gate.horizonshield.dev";
function withCardSignature(card, origin) {
  if (!CARD_SIGNATURE || !CARD_SIGNATURE.protected || !CARD_SIGNATURE.signature) return card;
  if (String(origin || "").replace(/\/+$/, "") !== CARD_CANONICAL_ORIGIN) return card;
  return Object.assign({}, card, { signatures: [{ protected: CARD_SIGNATURE.protected, signature: CARD_SIGNATURE.signature }] });
}
function jwksDocument() {
  return { keys: CARD_SIGNATURE && CARD_SIGNATURE.jwk ? [CARD_SIGNATURE.jwk] : [] };
}
const CONDUCT_EXT_SOURCE = "https://github.com/ogasurfproject-jpg/horizon-shield/blob/main/workers/hs-verify-gate/ext/CONDUCT_EXT_v1.md";
const CONDUCT_EXT_MD = "# A2A Conduct Extension v1 (`conduct-v1`)\n\n**Extension URI (the identifier, compared as an exact string):** `https://gate.horizonshield.dev/ext/conduct/v1`\n**Status:** v1, 2026-09-06 (sections 9 and 10 and the wire notes in sections 3 and 4 added the same day, before any anchoring). Revision v1.1, 2026-09-07: section 11, additive, same URI, every added field OPTIONAL; served from gate 0.4.0 with a new `spec_markdown_sha256`. Reference implementations: MCP Verification Gate 0.3.3 (reads it, serves this document at the URI, answers `SendMessage` at `/a2a`), HORIZON SHIELD KIRA and JIDEC agent cards (declare and echo it on both A2A wire versions), `a2a_conduct_walk.py` (client-side witness walk). Interoperability with the official A2A SDKs (`a2a-sdk` 1.1.x for Python, `@a2a-js/sdk` 1.1.x) is exercised by `workers/hs-mcp/test/sdk_js_interop.mjs` and `sdk_py_interop.py` against the real server code, both wire versions, no network.\n**Type:** data-only A2A extension on the Agent Card, plus an optional request-level echo. It MUST NOT be declared `required: true` (A2A guidance: data-only extensions are never required).\n**Language:** RFC 2119 keywords. Field names are exact.\n\n## 1. What this is for\n\nAn agent about to hand work to another agent can read three things before the first message: who pays the other agent, where a record of that agent's measured conduct lives that the agent itself did not write, and where to file its own observation of that agent. The extension carries one declaration and a set of pointers. It carries no score, no rank, and no verdict of its own. Declaring it proves nothing; the third-party record at `conduct_record` is the evidence, and only if the client fetched it.\n\n## 2. Declaration in the Agent Card\n\nThe agent lists the extension under `capabilities.extensions[]` (A2A 1.0, `AgentExtension`: `uri`, `description`, `required`, `params`).\n\n```json\n{\n  \"uri\": \"https://gate.horizonshield.dev/ext/conduct/v1\",\n  \"description\": \"Who pays this agent, where its measured conduct record lives, and where to file a witness walk.\",\n  \"required\": false,\n  \"params\": {\n    \"compensation\": { \"paid_by\": \"buyer\", \"referral_fee\": false, \"listing_fee\": false, \"success_fee_pct\": 0, \"disclosure_url\": \"https://...\" },\n    \"measured_endpoints\": [\"https://mcp.horizonshield.dev/mcp\"],\n    \"conduct_record\": \"https://gate.horizonshield.dev/history?endpoint=https%3A%2F%2Fmcp.horizonshield.dev%2Fmcp\",\n    \"verdict_recipe\": \"https://gate.horizonshield.dev/spec\",\n    \"witness_intake\": \"https://ledger.horizonshield.dev/witness\",\n    \"consent\": \"https://mcp.horizonshield.dev/.well-known/mcp-conduct.json\",\n    \"register\": \"https://gate.horizonshield.dev/register\",\n    \"rings\": {\n      \"spec\": \"https://github.com/ogasurfproject-jpg/horizon-shield/blob/main/workers/hs-ledger/nenrin/NENRIN_SPEC_v1.md\",\n      \"spec_sha256\": \"9ccba2e325fd2a555fcdb2dec519b8c6bf7a669064674846aea98ecfff824e3d\",\n      \"base\": \"https://raw.githubusercontent.com/ogasurfproject-jpg/mcp-conduct-register/main/rings/\",\n      \"path\": \"<slug>/<YYYY-MM>.json\",\n      \"slug\": \"endpoint URL without https://, lower case, every run of characters outside [a-z0-9] replaced by one hyphen, hyphens trimmed at both ends\",\n      \"ledger\": \"https://ledger.horizonshield.dev/ledger\"\n    }\n  }\n}\n```\n\n`params` fields:\n\n| field | type | requirement | meaning |\n|---|---|---|---|\n| `compensation` | object | REQUIRED | Who pays the agent. `paid_by` MUST be one of `buyer`, `seller`, `referral`, `advertising`, `subscription`, `public`, `other`. `referral_fee` and `listing_fee` MUST be booleans. `success_fee_pct`, when present, MUST be a number from 0 to 100. `disclosure_url`, when present, MUST be a string. Content is not judged by anyone reading this field; only the absence or malformation of the declaration is a failure. This is the same shape the gate's condition 3 has read at the card's top-level `compensation` key since 0.2.0. |\n| `measured_endpoints` | string[] | REQUIRED, at least one | The exact URL(s) whose conduct is recorded, as they appear on the register. |\n| `conduct_record` | string (https URL) | REQUIRED | A live record of measurements of the agent, written by a party other than the agent. For gate-measured endpoints this is `https://gate.horizonshield.dev/history?endpoint=<url-encoded endpoint>`. Every record there carries a `record_sha256` that the reader recomputes. |\n| `witness_intake` | string (https URL) | REQUIRED | Where a client files its own walk of the agent (section 4). |\n| `verdict_recipe` | string (https URL) | OPTIONAL | How to recompute the hashes in `conduct_record`. |\n| `consent` | string (https URL) | OPTIONAL | The origin's `/.well-known/mcp-conduct.json`, the owner's proof of consent to tool calls during measurement. |\n| `register` | string (https URL) | OPTIONAL | The public register the endpoint sits on. |\n| `rings` | object | OPTIONAL | Where monthly conduct rings (NENRIN Layer 3) are published, with the spec they follow and its sha256. |\n\nA card MAY keep the top-level `compensation` key for readers that predate this extension. When both are present they MUST be equal on the five keys above; two declarations that disagree are a failed disclosure, not a choice for the reader to make. When the extension is listed more than once with this URI, every listing MUST carry an equal `compensation`.\n\n## 3. Request-level echo (optional)\n\nA client activates the extension by sending the A2A service parameter `A2A-Extensions` containing this URI (an HTTP header in the HTTP bindings). An agent that declares the extension MUST then include this URI in the `A2A-Extensions` header of its response and MUST place these keys in the `metadata` of the returned `Message` or `Task`:\n\n| metadata key | value |\n|---|---|\n| `https://gate.horizonshield.dev/ext/conduct/v1/endpoint` | the entry of `measured_endpoints` that served this request |\n| `https://gate.horizonshield.dev/ext/conduct/v1/conduct_record` | same value as `params.conduct_record` |\n| `https://gate.horizonshield.dev/ext/conduct/v1/witness_intake` | same value as `params.witness_intake` |\n\nNothing else. No timestamp (a time an issuer chooses is a coordinate the issuer controls), no score. An agent that declares the extension and does not echo on activation is non-conforming; a client SHOULD record that as a discrepancy (section 4, `verdict.ok = false`). An agent that does not declare the extension is free to ignore the header, as A2A allows.\n\n**Two spellings of the header, two versions of the wire.** A2A 0.3 named the service parameter `X-A2A-Extensions`; A2A 1.0 names it `A2A-Extensions`. The 0.3 compatibility paths of the official SDKs still emit the old spelling (`@a2a-js/sdk` 1.1.0 emits only `X-A2A-Extensions` on the 0.3 wire; `a2a-sdk` 1.1.x for Python emits both). An agent MUST read the URI from either header, MUST echo it under `A2A-Extensions`, and MUST also echo it under `X-A2A-Extensions` when the request carried that spelling (a 0.3 client reads only the spelling it sent). The wire version is decided by the method name (`SendMessage` is 1.0, `message/send` is 0.3) and, failing that, by the `A2A-Version` header; the response takes the shape of that wire (1.0: `{\"task\": ...}` or `{\"message\": ...}` with `TASK_STATE_*` and `ROLE_*` enum names and parts discriminated by member name; 0.3: a `Message` or `Task` with `kind`). The `metadata` keys above are the same on both wires. The agent SHOULD also list this URI in the `extensions` field of the returned `Message` (or of `status.message` on a `Task`), the field A2A provides for \"extensions that contributed to this message\". A card that carries the extension SHOULD publish `supportedInterfaces[]` with a `protocolVersion: \"1.0\"` entry first, and MAY keep the 0.3 `url` / `preferredTransport` / `protocolVersion` keys beside it for 0.3-only readers; both official SDKs read such a card as 1.0 and ignore the 0.3 keys.\n\n## 4. Witness walk: `a2a-conduct-walk-v1`\n\nThis is how every connecting client becomes a witness. A walk is a `jidec-path-v1` record (JIDEC_PATH_SPEC_v1.md, ledger entry 5) with a `witness` field, submitted as `POST <witness_intake>` with body `{\"record_canonical\": \"<exact bytes>\"}`. Canonical bytes are UTF-8 of the record with keys sorted at every nesting level, separators `,` and `:` with no spaces, non-ASCII unescaped (Python `json.dumps(obj, sort_keys=True, separators=(\",\",\":\"), ensure_ascii=False)`; a JavaScript implementation MUST sort keys recursively before `JSON.stringify`, the seam recorded in ledger entry 34).\n\nFields:\n\n- `schema`: `\"jidec-path-v1\"`. `purpose`: `\"a2a-conduct-walk-v1: <measured endpoint>\"`. `walked_at`: ISO-8601 UTC. `base`: the card origin (`https://host`). `witness`: `{ \"name\": \"<who>\", \"vantage\": \"<network or tool the walk was taken from>\" }`; `name` MAY be `anonymous`.\n- `nodes`: n0 `fetch` GET `<origin>/.well-known/agent-card.json`; n1 the same GET again; n2 `compute` \"locate the extension by URI in n1 and validate `params`\"; n3 `fetch` POST to the measured endpoint with header `A2A-Extensions: <this URI>` and a JSON-RPC body (MCP `initialize`, or A2A `SendMessage` / `message/send` when the endpoint is the A2A interface). Each `fetch` node records `request.url`, `request.method`, `response.status`, `response.body_sha256` over the exact bytes received. A walk MUST touch at least one `measured_endpoints` entry or the origin, or the ring builder will not count it for that endpoint.\n- `assertions` (each with `claim`, `op`, `result`, `evidence_nodes`): `card_bytes_stable` (n0 body sha equals n1 body sha), `conduct_ext_declared` (n1 carries this URI under `capabilities.extensions[]`), `compensation_well_formed` (section 2 shape), `measured_endpoint_answered` (n3 status 200 and a JSON-RPC `result` of the shape the wire version requires), `extension_echoed` (the n3 response carries this URI under `A2A-Extensions`, or under `X-A2A-Extensions` when the walk sent that spelling; only asserted when n3 was an A2A message, otherwise recorded with `result: null` and `note: \"not applicable\"`). A walk in A2A mode records which wire it used (`conduct_ext.wire`, `\"1.0\"` or `\"0.3\"`); a 0.3 walk sends `message/send` with the header spelled `X-A2A-Extensions` only, which is what a 0.3 client does.\n- `verdict`: `{ \"ok\": <all applicable assertions true>, \"outcome\": \"PASS\" | \"FAIL\", \"n_pass\": <int>, \"n_total\": <int> }`. Both `ok` and `outcome` are carried because the ring builder (`make_ring.py`) reads `ok` while JIDEC_PATH_SPEC_v1 names `outcome`; a record carrying only one of them is read differently by the two.\n\nThe ledger accepts a schema-valid record inside its stated caps with no editorial step, pools it at `/witness/pending`, bundles the pool into a `nenrin-witness-batch-v1` entry once a day, and stamps it to Bitcoin. The monthly ring for the endpoint counts the walk under `witnesses` by distinct `witness.name`, and lists it under `discrepancies` when `ok` is false. With one witness a ring says so in `limits`; the second independent witness is what removes that sentence.\n\n## 5. What this does not do\n\nIt does not measure quality. It does not verify that `compensation` is truthful; a false declaration is published and recorded, and is grounds for revocation on the register, but no reader of this extension can tell truth from shape. It does not make the agent trustworthy; it makes the agent's conduct record findable and the reader's own observation filable. A client MUST NOT treat the presence of this extension as a pass.\n\n## 6. Interoperability, stated so this is not an island\n\nThe unit of record is a ring file: a JSON file whose identity is `sha256(file bytes)` and whose monthly list is anchored to Bitcoin through OpenTimestamps as a JIDEC ledger entry. Two independent implementations (Python and Node.js) reproduce the August 2026 rings byte for byte (ledger entry 34). That file, not this extension, is what other transparency systems can carry:\n\n- **in-toto Statement v1** (planned mapping, not yet emitted): `subject = [{ \"name\": \"rings/<slug>/<YYYY-MM>.json\", \"digest\": { \"sha256\": \"<ring sha>\" } }]`, `predicateType = <this URI>`, predicate = the ring's counts.\n- **IETF SCITT** (planned mapping, not yet emitted): the ring file is the Statement payload; the JIDEC entry with its Bitcoin attestation plays the part of the Receipt; JIDEC is the transparency service. A future version MAY emit a COSE_Sign1 Signed Statement over the same bytes.\n- **Canonical form:** NENRIN v1 defines its canonical form by reference to a language runtime (the seam above). The next NENRIN spec version is expected to adopt RFC 8785 (JCS) or a language-neutral statement. This extension defines no canonical form of its own and inherits that seam.\n\nThese mappings are direction, not delivery. Nothing in sections 2 to 4 depends on them.\n\n## 7. Versioning\n\nThe URI ends in `/v1`. A breaking change to fields, keys, or the walk MUST use a new URI. This document is served at the URI (`GET https://gate.horizonshield.dev/ext/conduct/v1`, JSON with `Accept: application/json`, this text with `Accept: text/markdown`). A permanent identifier (for example under w3id.org) MAY later redirect here; it would be a convenience, not a second identifier. Implementations compare the string at the top of this document and nothing else.\n\n## 8. Source\n\nDevelopment home: `workers/hs-verify-gate/ext/CONDUCT_EXT_v1.md` in `github.com/ogasurfproject-jpg/horizon-shield`. The gate serves the same text. The sha256 of this file is recorded in the gate's `/ext/conduct/v1` JSON as `spec_markdown_sha256` so a reader can tell whether the served copy and the repository copy are the same bytes.\n\n\n## 9. Prior art, named before anyone else has to\n\nThis extension claims no new primitive. The closest published work, and what differs:\n\n- **ERC-8004 Trustless Agents** (Draft ERC; De Rossi, Crapis, Ellis, Reppel; created 2025-08-13). On-chain Identity, Reputation and Validation registries: the Reputation Registry stores client feedback as value scores and tags, the Validation Registry stores validator responses, and a registration file can point at an A2A agent card. Difference: conduct-v1 carries no score and no feedback channel; the record it points to is a measurement written by a gate that does not take the agent's word; the evidence lives as bytes anyone re-hashes; and the timestamp is a Bitcoin attestation of a ring file, not contract state. The two are not exclusive: an ERC-8004 registration file can point at a card that carries this extension.\n- **A2A discussion #1631, \"Reputation-Aware Agent Discovery\"** (makito20256, 2026-03-14; prototype arp-trust-substrate published 2026-04-29; URI `https://agent-reputation-protocol.dev/extensions/reputation/v0.1`). Puts success_rate, accuracy, speed and honesty scores in the card, weighted by the evaluator's own reputation. Difference: the opposite direction. That discussion converged on separating attestation surfaces from scoring policies; conduct-v1 is an attestation surface and stops there by design, and it carries the one field none of the above carry, who pays the agent.\n- **Sigstore-signed Agent Cards** (Hinds, 2025-07-31). Keyless signatures over the card, recorded in a transparency log; answers who published this card and from which commit. Complementary: a signed card can carry this extension; this extension signs nothing.\n- **Agent Certificates** (Zhou, arXiv 2603.14332). A certificate chain and a skills manifest hash in the card's extensions field, for capability integrity. A different question (did the tools change) from this one (how did the agent behave when measured, and who pays it).\n- The transparency and provenance primitives named in section 6 (Certificate Transparency, Rekor, in-toto, SCITT, OpenTimestamps, RFC 8785) are prior art for every mechanism used here.\n\nWhat is not claimed: that any component is new. What is stated: the combination (compensation disclosure as a structural condition, a pointer to a third-party measurement with counts and no scores, a client-side witness path into a Bitcoin-anchored append-only ledger, and a ring builder reproduced byte for byte by a second implementation) was not found by the author in the sources above on 2026-09-06. A prior instance of the full combination is a finding, and this section is where it will be named.\n\n## 10. License and governance\n\nThis specification and the reference implementations named above are licensed under the Apache License, Version 2.0 (`LICENSE` beside this file in the repository). Anyone MAY implement it, fork it, or propose it elsewhere without asking. The A2A project's governance for community extensions (proposal issue in `a2aproject/A2A`, maintainer sponsorship, an `experimental-ext-` repository, graduation by TSC vote) is the intended path if there is interest; should the extension move under the `a2aproject` organization, the URI at the top of this document stays valid for v1 as published, and any URI under `https://a2a-protocol.org/extensions/` would be a new identifier for a new version, not an alias of this one.\n\n## 11. Revision v1.1 (2026-09-07): additive, same URI\n\n**Status:** served at the URI from gate 0.4.0. Every field in this section is OPTIONAL for the declaring agent and for the walking client; a v1 reader that ignores them reads a v1.1 card and a v1.1 walk correctly, and v1 as published (JIDEC entry 37) stays valid unchanged. Section 7 permits this: only a breaking change needs a new URI. The served JSON reports `spec_markdown_sha256`, so a reader can always tell which text it has. Reference implementations: gate 0.4.0 (lookup, notify, verdict disclaimers, commitment anchoring), ledger intake (lanes, domain binding, counting rule), `a2a_conduct_walk.py` (modes, signing), `make_ring.py` (v1.1 columns).\n\n**Why a revision.** Three holes named in the operator's own review on 2026-09-06: a witness chooses its own identity, so a flood of self-named witnesses can bury the disagreement column (11.4); a walk record can leak what a caller asked whom (11.3); filing costs the caller effort, so nobody files (11.5 to 11.7). Plus one field forced by a public finding (11.9): a record that does not say what it does not establish is read as more than it is.\n\n**Rollout.** Rings for months from 2026-09 onward carry the columns of 11.8 when built with a builder that implements them; the v1 fields keep their v1 meaning and their bytes are unaffected in months before 2026-09, so the August 2026 reproducibility result (entry 34) is untouched. A month is published under v1.1 columns only after the second ring implementation agrees byte for byte on a shared fixture; until then that month is published under v1 columns and says so.\n\n### 11.1 What a record claims: `establishes` and `does_not_establish`\n\nAny record that carries `mode` (11.2) is a v1.1 record and MUST carry two non-empty arrays of strings: `establishes`, naming exactly what the record proves, and `does_not_establish`, naming what it does not. `does_not_establish` MUST contain at least: correctness or quality of any response; truth of the compensation declaration; and, when the record is unsigned, the identity of the witness beyond the name given. The intake refuses a v1.1 record missing either array or carrying it empty (`reason_code: disclaimer_missing`). A v1 record (no `mode`) is accepted as before and stored with `disclaimer_present: false`.\n\nThe same discipline applies to the measurer. From gate 0.4.0 every verdict and the gate's own `/self` record carry `establishes` and `does_not_establish`, and both arrays are inside the bytes that `record_sha256` hashes: a quotation of the verdict with the arrays removed no longer recomputes.\n\n### 11.2 Record modes\n\n`mode` is `\"full\"` (v1 behaviour), `\"hash-only\"` or `\"commitment\"`. A record without `mode` is read as `\"full\"`. `vantage_limitation` (OPTIONAL, string) states what the witness could not see from where it stood: a proxy, a cache, a rate limit hit, a region.\n\n### 11.3 `hash-only` and `commitment` (what a caller asked whom stays private)\n\n`hash-only`: every `fetch` node carries only `response.status` and `response.body_sha256`; `request.url` is the origin (`https://host`, no path, no query) and `request.method` is `\"REDACTED\"`. `purpose` keeps `\"a2a-conduct-walk-v1: <measured endpoint>\"` so the ring builder can attribute the walk. `establishes` says that a response with the given sha256 was received from the origin at `walked_at` and nothing more; `does_not_establish` adds \"which tool or method was called\". The intake refuses a hash-only node whose `request.url` carries a path, a query or a fragment (`reason_code: path_leaks_tool`), and a `request.method` other than `REDACTED`.\n\n`commitment`: the record carries `schema`, `purpose`, `walked_at`, `base`, `witness`, `mode: \"commitment\"`, `commitment` (64 hex characters), the two arrays of 11.1, and SHOULD carry `commitment_recipe` (a string saying how `commitment` was formed). For a witness walk the recipe is `sha256(canonical full record || salt)`; the witness keeps the full record and the salt, and MAY reveal later by filing the full record. Other purposes MAY use commitment mode with their own recipe, stated in the record: the gate files its instant coordinate salt commitment this way (purpose `nenrin-instant-commitment-v1: <window_id>`, recipe `sha256('nenrin-instant-salt-v1:' + salt)`, `base` the window's page on the gate), which anchors the salt's creation time to a Bitcoin block through the ledger without any new ledger code. The ring counts a walk commitment under `commitments_unrevealed`, with `verdict.ok = null`, under neither PASS nor discrepancies. Nothing in a commitment identifies a tool, a method or a response.\n\nA record never carries a request or response body in any mode. A client MAY keep a local allow list and deny list of endpoints it will file about; a denied endpoint is simply not walked, and the client MUST NOT file a record that pretends otherwise.\n\n### 11.4 Witness identity: domain-bound signing, lanes, counting\n\nSigning is the existing intake mechanism: Ed25519 over the exact canonical bytes, presented as `signature_ed25519_b64` and `public_key_ed25519_b64` beside `record_canonical`. v1.1 adds `witness.key_url` (OPTIONAL, https URL): the same public key MUST be served at that URL as `{\"public_key_ed25519_b64\": \"<key>\"}`. The host of `key_url` is then the witness's identity (`signed_domain`); the string in `witness.name` is a label. The intake refuses: `key_url` without a signature (`bad_key_url`); a `key_url` host equal to the walked agent's origin host or measured endpoint host, or to the ledger's own host (`self_witness`: an agent cannot witness itself under a key it serves); a key served at `key_url` that is not the signing key (`key_url_mismatch`); and answers 503 `key_url_unreachable` when the key cannot be fetched, so the caller can retry or file unsigned. Keys are cached 24 hours per URL.\n\nLanes: unsigned and address-signed records share a per-address lane of 5 stored records per UTC day; domain-signed records have a per-domain lane of 50; the intake stores at most 500 records per UTC day in total. Beyond a lane the intake answers 429 and stores nothing. The caps are stated at `GET <witness_intake>`.\n\nCounting, not storage, is the unit: the first record per identity (`domain:<host>` when domain-signed, otherwise `name:<witness.name>`) × walked endpoint × UTC day is stored with `counted: true`; later records that day are stored with `counted: false` and the reason. Two records with identical canonical bytes are stored once. `/witness/pending` and the daily `nenrin-witness-batch-v1` entry carry every stored record, counted or not, so nothing is hidden by a cap; only the ring's counts respect it. None of this scores a witness. It separates two columns and stops one address from filling a column alone.\n\n### 11.5 Consent file additions: `notify`, `identity`, `witness_policy`\n\nThe owner's consent file (`/.well-known/mcp-conduct.json` on the origin, v1 section 2 `consent`) MAY carry three more keys. Only the owner of the origin can place them, which is why they live there rather than in a request.\n\n`notify` (https URL): after each scheduled measurement of an endpoint on that origin, the measurer POSTs a JSON summary there: `event: \"measured\"`, `endpoint`, `at`, `status`, `record_sha256`, what changed, `establishes`, `does_not_establish`, and links to the conduct record and the lookup. At most once per hour per endpoint, a bounded number per sweep (the rest are recorded as deferred), never from an on-demand check (which anyone can call), never to an IP literal, a local name, or the measurer's own hosts, no retry. The sweep record carries `notify_status` per row. Declaring the field is consent to receive the POST; removing it stops the POSTs. The notification changes nothing about the verdict.\n\n`identity`: an https URL, or `{ \"kind\": \"did\" | \"jwks\" | \"vc\" | \"url\", \"ref\": \"<DID or https URL>\" }`, pointing at an identity the agent holds elsewhere. The measurer does not resolve it and asserts nothing about it; readings copy it as declared. This is the receiving slot for identity layers when they go live.\n\n`witness_policy`: `{ \"reciprocal\": true | false }` (default false). `reciprocal: true` is the owner's statement that it walks back callers as in 11.6. A declaration; the ring's `walked_as_witness` column is the fact. A card MAY repeat `identity` and `witness_policy` under this extension's `params`; when both are present the consent file is what the measurer reads.\n\n### 11.6 Reciprocal walk\n\nAn agent that declares `witness_policy.reciprocal: true` states this behaviour: when it receives an A2A message whose `metadata` carries `https://gate.horizonshield.dev/ext/conduct/v1/caller_card` (an https URL, sent by the caller voluntarily), it walks that card within 24 hours, honours `listing: \"decline\"` at that origin, files the walk under its own name and, if it has one, its domain key, to the intake named in the caller's card (or its own intake when the caller declares none), and answers with the `metadata` key `https://gate.horizonshield.dev/ext/conduct/v1/reciprocal` set to `\"scheduled\"` or `\"declined\"`. The caller thus receives one record it did not write, without filing anything. A reciprocal walk is a walk like any other: same schema, same intake rules, counted under the walking agent's identity, carrying the arrays of 11.1. Reference implementation: pending; the field is defined so that cards can declare it now.\n\n### 11.7 Register lookup: one URL before connecting\n\n`GET https://gate.horizonshield.dev/register/lookup?endpoint=<url-encoded endpoint>` answers with no score: `status` (`verified`, `pending`, `declined`, `unknown`), `status_meaning`, `last_measured` (`at`, `status`, `record_sha256`, coordinate window), `measurements`, `last_ring` (the last published ring's counts copied as counts, or `present: false` with the URLs tried), `conduct_record`, `witness_intake`, `rings` (base, slug, path), `establishes`, `does_not_establish`. `unknown` means the register has no row; it never means a finding. The response is cacheable for 24 hours (`Cache-Control: public, max-age=86400`) and says so.\n\n### 11.8 Ring columns (NENRIN, months from 2026-09)\n\nBeside v1's `witnesses` and `discrepancies` (unchanged, every witness counted by distinct name): `witnesses_signed`, `witnesses_unsigned`, `discrepancies_signed`, `discrepancies_unsigned` (deduplicated per identity and day), `commitments_unrevealed`, `walked_as_witness` (walks this endpoint's operator filed about other endpoints that month, by count, attributed by `signed_domain` equal to the endpoint host and `counted: true`), `instants_derived`, `instants_legacy`, `instants_no_coordinate_block`; and `limits` gains \"unsigned witnesses are counted by the name they gave\" whenever `witnesses_unsigned > 0`. Counts only, never a rate.\n\n### 11.9 Red team and prior art added in this revision\n\nVectors, each a refusal or a separation and never a pass: disclaimer dropped from a v1.1 record (still schema-valid, refused); disclaimer emptied; bad mode; `key_url` without signature; `key_url` under the walked agent's own domain; key at `key_url` not the signing key; `key_url` unreachable (503, not 422); same identity twice in a day (stored, counted once); one address over its lane (429, nothing stored); hash-only node with a path (refused); commitment without a 64 hex commitment (refused); the gate's verdict quoted without its arrays (does not recompute); commitment filed once per window and reported honestly when the ledger is unreachable; notify to an IP literal (never sent); notify twice within an hour (second not sent); notify from an on-demand check (never sent). Suites: `workers/hs-ledger/test/witness_v11.test.mjs`, `workers/hs-ledger/nenrin/a2a-conduct-walk/walk_selftest.py`, `workers/hs-ledger/nenrin/ring-v1/ring_redteam.py`, `workers/hs-verify-gate/test/conduct_v11_gate.test.mjs`.\n\nPrior art: the `establishes` / `does_not_establish` pair follows a public finding by Federico Blanco Sánchez-Llanos (LinkedIn, 2026-09-07) about a TEE attestation conformance specification in `trustless-ai/recompute-kit`: a record that could silently drop its \"not judged correct\" disclaimer and still pass conformance, repaired the same day by a one-line fix and a new conformance vector, and mirrored by the `vantage_limitation` his review verdicts carry. This revision adopts the same discipline on both the witness side and the measurer side. Domain-bound witness keys follow the transparency-log witness model (Sigsum witnesses, Certificate Transparency gossip), applied to the conduct of a counterparty instead of the consistency of a log. Nothing else in this revision claims a new primitive.\n\n### 11.10 What this revision does not do\n\nIt does not make a witness trustworthy; it makes a signed witness attributable to a domain and an unsigned one countable apart. It does not detect lies; a signed liar fills the signed column, and any hidden judgement of who is lying would be a coordinate the operator controls, which is what this extension exists to remove. It does not prove that a hash-only or commitment record refers to a real exchange; it proves only that a stated hash was filed at a stated time. It does not oblige any framework to file records by default; reference hooks default to writing the record locally and sending nothing. It does not change coordinate derivation, the sweep's conditions, or any field of `coordinate_derivation`.\n";
const COMPENSATION_KEYS = ["paid_by", "referral_fee", "listing_fee", "success_fee_pct", "disclosure_url"];

// 扉が申請者に要求するのと同じ形式で、扉自身の報酬構造を宣言する(card の top-level と extension の両方に同じ物を置く)。
const GATE_COMPENSATION = {
  paid_by: "buyer",
  referral_fee: false,
  listing_fee: false,
  success_fee_pct: 0,
  disclosure_url: "https://shield.the-horizons-innovation.com/yakumo/plans/"
};

// card の capabilities.extensions[] のうち、この URI の宣言を全部返す。配列でなければ無し。
function conductExtDeclarations(card) {
  const caps = card && card.capabilities && typeof card.capabilities === "object" && !Array.isArray(card.capabilities) ? card.capabilities : null;
  const exts = caps && Array.isArray(caps.extensions) ? caps.extensions : [];
  return exts.filter((e) => e && typeof e === "object" && !Array.isArray(e) && e.uri === CONDUCT_EXT_URI);
}
// 5 鍵の完全一致。省略した鍵は null と読む(省略と 0 は一致しない)。
function compensationEqual(a, b) {
  const norm = (v) => JSON.stringify(v === undefined ? null : v);
  return COMPENSATION_KEYS.every((k) => norm(a[k]) === norm(b[k]));
}
// 拡張の宣言 1 本を組む。各 worker が自分の card に置く形。
function conductExtension(params) {
  return {
    uri: CONDUCT_EXT_URI,
    description: "Who pays this agent, where its measured conduct record lives, and where to file a witness walk. The specification is served at the URI.",
    required: false,
    params
  };
}
function conductExtensionSpec(origin, mdSha) {
  const u = CONDUCT_EXT_URI;
  return {
    uri: u,
    name: "A2A Conduct Extension",
    version: "v1",
    since_gate: "0.3.2",
    type: "data-only extension on the A2A Agent Card, plus an optional request-level echo",
    required: false,
    declaration: {
      where: "capabilities.extensions[] with uri equal to this URI",
      params: {
        compensation: { requirement: "REQUIRED", shape: { paid_by: PAID_BY, referral_fee: "boolean", listing_fee: "boolean", success_fee_pct: "number 0..100, optional", disclosure_url: "string, optional" }, note: "Same shape as the top-level compensation key (0.2.0). When both are present they must be equal on the five keys; an omitted optional key equals only an omitted key." },
        measured_endpoints: { requirement: "REQUIRED, at least one", type: "string[]", meaning: "exact endpoint URL(s) whose conduct is recorded, as on the register" },
        conduct_record: { requirement: "REQUIRED", type: "https URL", meaning: "live record of measurements written by a party other than the agent; for gate-measured endpoints " + origin + "/history?endpoint=<url-encoded endpoint>" },
        witness_intake: { requirement: "REQUIRED", type: "https URL", meaning: "where a client files its own walk; https://ledger.horizonshield.dev/witness" },
        verdict_recipe: { requirement: "OPTIONAL", type: "https URL", meaning: "how to recompute the record hashes; " + origin + "/spec" },
        consent: { requirement: "OPTIONAL", type: "https URL", meaning: "the origin's " + CONSENT_WELL_KNOWN_PATH },
        register: { requirement: "OPTIONAL", type: "https URL", meaning: "the public register the endpoint sits on" },
        rings: { requirement: "OPTIONAL", type: "object", meaning: "where monthly NENRIN Layer 3 rings are published: spec, spec_sha256, base, path, slug, ledger" }
      }
    },
    echo: {
      activate: "send the A2A service parameter A2A-Extensions containing this URI (an HTTP header in the HTTP bindings); the 0.3 spelling X-A2A-Extensions is read as well",
      response_header: "A2A-Extensions must contain this URI; when the request used X-A2A-Extensions the same value is echoed under that spelling too",
      wires: { "1.0": "method SendMessage; result is {task} or {message} with TASK_STATE_* / ROLE_* names and parts discriminated by member name", "0.3": "method message/send; result is a Message or Task with kind" },
      metadata_keys: [u + "/endpoint", u + "/conduct_record", u + "/witness_intake"],
      message_extensions: "the returned Message (or status.message of a Task) should list this URI in its extensions field",
      nothing_else: "no timestamp, no score"
    },
    walk: {
      schema: "jidec-path-v1",
      purpose_prefix: "a2a-conduct-walk-v1: ",
      nodes: ["n0 GET <origin>/.well-known/agent-card.json", "n1 the same GET again", "n2 compute: locate this URI in n1 and validate params", "n3 POST the measured endpoint with A2A-Extensions: <this URI> (MCP initialize, or A2A SendMessage / message/send)"],
      assertions: ["card_bytes_stable", "conduct_ext_declared", "compensation_well_formed", "measured_endpoint_answered", "extension_echoed (null and not applicable when n3 was not an A2A message)"],
      verdict: "{ ok, outcome, n_pass, n_total }; both ok and outcome are carried because make_ring.py reads ok while JIDEC_PATH_SPEC_v1 names outcome",
      canonical: "UTF-8, keys sorted at every nesting level, separators , and : without spaces, non-ASCII unescaped (Python json.dumps sort_keys separators ensure_ascii=False; JavaScript must sort keys recursively before JSON.stringify: the seam of ledger entry 34)",
      submit: "POST <witness_intake> with {\"record_canonical\": \"<exact bytes>\"}",
      counted: "the monthly ring for the endpoint counts the walk under witnesses by distinct witness.name and under discrepancies when ok is false",
      reference_client: "workers/hs-ledger/nenrin/a2a-conduct-walk/a2a_conduct_walk.py"
    },
    how_this_gate_reads_it: "condition 3 (compensation_disclosure) reads the top-level compensation key and every capabilities.extensions[] entry carrying this URI; one well-formed declaration passes, two that disagree fail, none fails. Nothing else in the params is judged by this gate.",
    what_it_does_not_do: ["measure quality", "verify that compensation is truthful", "make the agent trustworthy", "count as a pass by being present"],
    interop: {
      in_toto_statement_v1: "planned mapping, not yet emitted: subject = the ring file by sha256, predicateType = this URI",
      scitt: "planned mapping, not yet emitted: the ring file is the Statement payload, the JIDEC entry with its Bitcoin attestation plays the Receipt",
      canonical_form: "inherits the NENRIN v1 seam (canonical form defined by reference to a language runtime); RFC 8785 or a language-neutral statement expected in the next NENRIN version"
    },
    // 0.4.0 (2026-09-07). conduct-v1.1: 同じ URI、足す欄は全部 OPTIONAL。markdown の section 11 が規範、ここはその目次。
    v1_1: {
      since: "2026-09-07 (gate 0.4.0); section 11 of the markdown is normative, this block is its index",
      additive: "same URI; every added field is OPTIONAL; a v1 reader reads a v1.1 card and walk correctly; v1 as anchored (JIDEC entry 37) stays valid",
      record_fields: { mode: "full | hash-only | commitment (absent means full)", establishes: "required on a v1.1 record: non-empty string list of what it proves", does_not_establish: "required on a v1.1 record: non-empty string list of what it does not prove; the intake refuses its absence (disclaimer_missing)", vantage_limitation: "optional string", commitment: "64 hex, commitment mode only; commitment_recipe should state how it was formed", "witness.key_url": "optional https URL under the witness's own domain serving {public_key_ed25519_b64}; the host becomes signed_domain" },
      intake: { signing: "Ed25519 over the canonical bytes (signature_ed25519_b64 + public_key_ed25519_b64 beside record_canonical, as in v1)", refusals: ["disclaimer_missing", "bad_mode", "bad_commitment", "path_leaks_tool", "bad_key_url", "self_witness", "key_url_mismatch", "key_url_unreachable (503)"], lanes: "5 stored per address per UTC day (unsigned or address-signed), 50 per domain per day (domain-signed), 500 per day in total; stated at GET " + "https://ledger.horizonshield.dev/witness", counting: "first record per identity (domain:<host> or name:<witness.name>) x endpoint x UTC day is counted: true; later ones stored with counted: false; identical bytes stored once" },
      consent_file_fields: { notify: "https URL; the measurer POSTs a summary after each scheduled measurement, at most once per hour per endpoint, never from an on-demand check, never to an IP literal or a local name; notify_status in the sweep record", identity: "https URL or {kind, ref}; declared, never resolved by the measurer", witness_policy: "{reciprocal: boolean}; a declaration, the ring's walked_as_witness column is the fact" },
      measurer: { verdict_disclaimers: "every verdict and /self carry establishes and does_not_establish inside the hashed bytes", lookup: origin + "/register/lookup?endpoint=<url-encoded endpoint> (verified | pending | declined | unknown, last ring counts, 24 hour cache, no score)", commitment_anchoring: "each sweep files the instant coordinate salt commitment of the next window to the witness intake as a commitment record (purpose nenrin-instant-commitment-v1: <window_id>); /nenrin/window shows commitment_filed" },
      rings: "months from 2026-09, once two builders agree byte for byte: witnesses_signed, witnesses_unsigned, discrepancies_signed, discrepancies_unsigned, commitments_unrevealed, walked_as_witness, instants_derived, instants_legacy, instants_no_coordinate_block",
      reciprocal_walk: "defined (11.6: metadata keys caller_card and reciprocal); reference implementation pending",
      red_team: ["workers/hs-ledger/test/witness_v11.test.mjs", "workers/hs-ledger/nenrin/a2a-conduct-walk/walk_selftest.py", "workers/hs-ledger/nenrin/ring-v1/ring_redteam.py", "workers/hs-verify-gate/test/conduct_v11_gate.test.mjs"],
      does_not: "detect lies, make a witness trustworthy, prove a hash-only or commitment record refers to a real exchange, change coordinate derivation or the sweep's conditions"
    },
    versioning: "the URI ends in /v1; a breaking change uses a new URI; a w3id.org redirect may later point here and would not be a second identifier; v1.1 (section 11) is an additive revision under the same URI",
    license: "Apache-2.0 (LICENSE beside the markdown in the repository)",
    a2a_endpoint: origin + "/a2a (SendMessage or message/send; a text part carrying an MCP endpoint URL returns this gate's register reading for it)",
    spec_markdown: "GET " + u + " with Accept: text/markdown",
    spec_markdown_sha256: mdSha,
    source: CONDUCT_EXT_SOURCE,
    gate_version: CONFIG.version
  };
}
async function conductExtResponse(request, origin) {
  const accept = request.headers.get("Accept") || "";
  if (/text\/markdown/i.test(accept)) {
    return new Response(CONDUCT_EXT_MD, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=3600", ...CORS_HEADERS } });
  }
  const mdSha = await sha256hex(CONDUCT_EXT_MD);
  return json(conductExtensionSpec(origin, mdSha));
}


// ---- 扉自身の A2A の口 (0.3.3) ----
// 「扉に別の agent の行儀を訊く」を A2A そのもので出来るようにする。中身は GET /is-verified と同じ bytes(register の読み。測りはせん)。
// 公式 SDK の実測: 0.3 互換路は X-A2A-Extensions を送る。1.0 の綴りは A2A-Extensions。読むのは両方、echo は A2A-Extensions + 要求の綴り。
const A2A_EXT_HEADER = "A2A-Extensions";
const A2A_EXT_HEADER_LEGACY = "X-A2A-Extensions";
const A2A_VERSION_HEADER = "A2A-Version";
function a2aRequestedExtensionUris(request) {
  const out = [];
  for (const name of [A2A_EXT_HEADER, A2A_EXT_HEADER_LEGACY]) {
    const h = request.headers.get(name) || "";
    for (const u of h.split(",")) { const t = u.trim(); if (t && !out.includes(t)) out.push(t); }
  }
  return out;
}
function a2aActivatedExtensions(request) { return a2aRequestedExtensionUris(request).filter((u) => u === CONDUCT_EXT_URI); }
function a2aEchoHeaders(request, activated) {
  if (!activated.length) return {};
  const h = {}; h[A2A_EXT_HEADER] = activated.join(",");
  if (request.headers.get(A2A_EXT_HEADER_LEGACY)) h[A2A_EXT_HEADER_LEGACY] = activated.join(",");
  return h;
}
function a2aWire(method, request) {
  if (method === "SendMessage") return "1.0";
  if (method === "message/send") return "0.3";
  const v = ((request && request.headers.get(A2A_VERSION_HEADER)) || "").trim();
  return v.startsWith("1.") ? "1.0" : "0.3";
}
function a2aPartText(p) { return p && typeof p === "object" && typeof p.text === "string" && (p.kind === undefined || p.kind === "text") ? p.text : null; }
function a2aPart10(p) {
  if (!p || typeof p !== "object") return p;
  const o = {};
  if (p.kind === "text" || typeof p.text === "string") o.text = String(p.text === undefined ? "" : p.text);
  else if (p.kind === "data" || p.data !== undefined) o.data = p.data;
  else { for (const k of Object.keys(p)) if (k !== "kind") o[k] = p[k]; }
  if (p.metadata && typeof p.metadata === "object") o.metadata = p.metadata;
  return o;
}
function a2aMessage10(m) {
  const o = {};
  for (const k of Object.keys(m)) { if (k === "kind" || k === "role" || k === "parts") continue; o[k] = m[k]; }
  o.role = m.role === "user" ? "ROLE_USER" : m.role === "agent" ? "ROLE_AGENT" : "ROLE_UNSPECIFIED";
  o.parts = Array.isArray(m.parts) ? m.parts.map(a2aPart10) : [];
  return o;
}
function a2aSendMessageResult(result, wire) {
  if (wire !== "1.0" || !result || typeof result !== "object") return result;
  if (result.kind === "message") return { message: a2aMessage10(result) };
  return result;
}
function gateConductMetadata(origin) {
  const m = {};
  m[CONDUCT_EXT_URI + "/endpoint"] = origin + "/mcp";
  m[CONDUCT_EXT_URI + "/conduct_record"] = origin + "/history?endpoint=" + encodeURIComponent(origin + "/mcp");
  m[CONDUCT_EXT_URI + "/witness_intake"] = "https://ledger.horizonshield.dev/witness";
  return m;
}
function a2aAttachConduct(result, origin) {
  result.metadata = Object.assign({}, result.metadata || {}, gateConductMetadata(origin));
  const ex = Array.isArray(result.extensions) ? result.extensions.slice() : [];
  if (!ex.includes(CONDUCT_EXT_URI)) ex.push(CONDUCT_EXT_URI);
  result.extensions = ex;
  return result;
}
const A2A_GATE_USAGE = "Send an MCP endpoint URL (https://...) as a text part. This gate answers with its current register reading for that endpoint, the same bytes as GET /is-verified: verified is true only when the latest scheduled measurement passed every measured condition, and null in every other case (absent, watched, pending, held). It never says false, it does not measure on this path (a fresh measurement is POST /check), and it is not a recommendation.";
async function handleGateA2A(request, env, origin) {
  let b; try { b = await request.json(); } catch (_e) { b = null; }
  const rid = b && b.id !== undefined ? b.id : null;
  const activated = a2aActivatedExtensions(request);
  const echo = a2aEchoHeaders(request, activated);
  const send = (payload, status) => new Response(JSON.stringify(Object.assign({ jsonrpc: "2.0", id: rid }, payload)), { status: status || 200, headers: Object.assign({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }, CORS_HEADERS, echo) });
  if (!b || b.jsonrpc !== "2.0") return send({ error: { code: -32600, message: "invalid request: jsonrpc 2.0 envelope required" } });
  if (b.method !== "SendMessage" && b.method !== "message/send")
    return send({ error: { code: -32601, message: "method not found: " + String(b.method) + ". This agent implements SendMessage (1.0) and message/send (0.3). " + A2A_GATE_USAGE } });
  const wire = a2aWire(b.method, request);
  const parts = (b.params && b.params.message && Array.isArray(b.params.message.parts)) ? b.params.message.parts : [];
  const text = parts.map(a2aPartText).filter((x) => typeof x === "string").join(" ").trim();
  const m = text.match(/https:\/\/[^\s"'<>]+/);
  let result;
  if (!m) {
    result = { kind: "message", role: "agent", messageId: crypto.randomUUID(), parts: [
      { kind: "text", text: A2A_GATE_USAGE },
      { kind: "data", data: { usage: "SendMessage with a text part containing an https MCP endpoint URL", is_verified: origin + "/is-verified?endpoint=<url>", check: origin + "/check (POST, measures now)", spec: origin + "/spec", extension: CONDUCT_EXT_URI } }
    ] };
  } else if (!env || !env.HS_VERIFY_KV) {
    return send({ error: { code: -32000, message: "storage_unavailable: the register is not bound here, so this gate cannot say. This is NOT 'not verified'." } });
  } else {
    const ep = m[0].replace(/[.,;:)\]]+$/, "");
    let reading;
    try { reading = await isVerified(env, ep); }
    catch (e) { return send({ error: { code: -32000, message: "lookup_failed: " + String(e && e.message || e) } }); }
    const line = reading.state === "verified"
      ? "verified: the latest scheduled measurement of " + ep + " passed every measured condition. Record sha256 " + reading.record_sha256 + ". Recompute: " + reading.recompute_url
      : "state " + reading.state + " for " + ep + ": verified is null (not false). " + reading.reason;
    result = { kind: "message", role: "agent", messageId: crypto.randomUUID(), parts: [{ kind: "text", text: line }, { kind: "data", data: reading }] };
  }
  if (activated.includes(CONDUCT_EXT_URI)) result = a2aAttachConduct(result, origin);
  return send({ result: a2aSendMessageResult(result, wire) });
}

// ---- 使用量 ----
// 2026-08-23。「これでインフラになったのか」と問われて、答えられなかった。作った物の数は言えても、
// 使われた回数を一度も数えていなかったからだ。インフラかどうかを決めるのは作った側の主張ではなく
// 他人の使用であり、測っていない以上その言葉は使えない。それがこの扉の存在理由そのものなので、
// 自分にも同じ規則を当てる。数えていないなら「使われている」と書かない。数えるならこう数える。
//
// 数えるのは、公開URLのホスト名と回数だけ。IPも User-Agent も本文も保存しない。
// KV は読んで書き戻すので、同時アクセスは取りこぼす。だから出す数字は常に下限であり、そう明記する。
const USAGE_TTL_DAYS = 400;

// 自ゾーン判定は既存の isOwnZone(url文字列) を使う。ここで同名の関数をもう一つ作ったのが
// 2026-08-23 のデプロイを止めた原因だった。node --check はスクリプト扱いで重複宣言を通し、
// esbuild はモジュール扱いで弾く。検査が本番より緩ければ、検査は仕事をしていない。

function usageKey(day) {
  return "usage:" + (day || new Date().toISOString().slice(0, 10));
}

function bumpUsage(env, ctx, field, host) {
  if (!env || !env.HS_VERIFY_KV) return;
  const run = async () => {
    try {
      const k = usageKey();
      const cur = (await env.HS_VERIFY_KV.get(k, "json")) ||
        { external_checks: 0, own_checks: 0, testbed_hits: 0, spec_hits: 0, external_hosts: [] };
      cur[field] = (Number(cur[field]) || 0) + 1;
      if (host && cur.external_hosts.indexOf(host) < 0 && cur.external_hosts.length < 200) {
        cur.external_hosts.push(host);
      }
      await env.HS_VERIFY_KV.put(k, JSON.stringify(cur), { expirationTtl: 60 * 60 * 24 * USAGE_TTL_DAYS });
    } catch (_e) { /* 計数の失敗で測定本体を止めない */ }
  };
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(run());
  else run();
}

async function usageReport(env, days) {
  const n = Math.min(Math.max(Number(days) || 30, 1), 90);
  const today = new Date();
  const out = [];
  const totals = { external_checks: 0, own_checks: 0, testbed_hits: 0, spec_hits: 0 };
  const hosts = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10);
    let row = null;
    try { row = await env.HS_VERIFY_KV.get(usageKey(d), "json"); } catch (_e) { row = null; }
    if (!row) continue;
    for (const f of Object.keys(totals)) totals[f] += Number(row[f]) || 0;
    for (const h of (row.external_hosts || [])) if (hosts.indexOf(h) < 0) hosts.push(h);
    out.push({ day: d, external_checks: row.external_checks || 0, own_checks: row.own_checks || 0, testbed_hits: row.testbed_hits || 0 });
  }
  return {
    window_days: n,
    counting_since: "2026-08-23",
    totals: totals,
    distinct_external_hosts_checked: hosts.length,
    external_hosts: hosts.slice(0, 100),
    by_day: out,
    what_this_is:
      "Counts of requests, published so that the question 'is this actually used by anyone' has an answer " +
      "made of numbers instead of an adjective. external_checks counts verdicts requested for endpoints " +
      "outside our own zone, which is the only figure here that means someone other than us found this " +
      "useful. own_checks counts us measuring ourselves and is separated for exactly that reason.",
    what_this_is_not:
      "Not people. Not sessions. Bots, crawlers and repeated calls from one operator are all in here and " +
      "are not distinguishable. No IP address, no user agent and no request body is stored, so they cannot " +
      "be separated later either.",
    accuracy:
      "A lower bound. Counters are read and written back, so simultaneous requests overwrite each other and " +
      "the loss is silently absorbed. A number here is never higher than the truth, and we would rather " +
      "under-report our own usage than publish a figure we cannot defend.",
    honest_status:
      totals.external_checks > 0
        ? "Someone outside this operator has used it. That is a fact about usage, not about usefulness."
        : "Nobody outside this operator has used it yet. Calling it infrastructure today would be a claim with no measurement behind it, so we do not."
  };
}

const RECOMPUTE_NOTE =
  "Remove the record_sha256 and recompute_note fields, then serialize what is left as UTF-8 JSON " +
  "with no insignificant whitespace, with the keys left in the order printed here, and with " +
  "non-ASCII characters left as themselves rather than escaped to \\u sequences. The SHA-256 of " +
  "those bytes must equal record_sha256. In JavaScript that is JSON.stringify(record). In Python " +
  "it is json.dumps(record, separators=(',',':'), ensure_ascii=False). Measured 2026-08-23: of the " +
  "four ways a reader naturally reaches for this, only that one reproduces the value, so both are " +
  "named here rather than left implied by a JavaScript idiom. Verified in those two languages only " +
  "(2026-09-05): in any other, the two things to get right are key order exactly as printed and numbers " +
  "exactly as printed; if your encoder reorders keys or rewrites numbers it will not reproduce this value, " +
  "so use an order-preserving parse followed by a compact serialize. The response you are reading is " +
  "indented for humans and is not the hashed bytes. Since 0.4.1 (2026-09-09) the hashed bytes of every " +
  "scheduled verdict are served, byte for byte, at /record/<record_sha256>: SHA-256 of that body equals " +
  "the path with no serialization step in between. On-demand /check verdicts and verdicts from before that " +
  "date are not stored; their sha names bytes that only the caller who received them holds. " +
  "Since 0.4.2 the record carries number_safety, generated from the record itself and inside these bytes: " +
  "parse_safe true means no number here was destroyed by JSON.parse before any canonicalization ran, and " +
  "safe_integers_only true means additionally that a compact re-serialization in key order reproduces these " +
  "bytes in any language. Whatever is false, the fields that make it false are named, and fetching " +
  "/record/<record_sha256> and hashing the body is the way to check without re-serializing anything.";

function json(obj, status, extraHeaders) {
  // キャッシュ指示を明示する。書かなければ中間キャッシュの裁量になり、
  // 「測っていない」と「もう緑ではない」が、どちらも古いまま配られる。
  //   400番台以上  no-store   /e/ の404は「測ってもらえば動き出す」と書いてある。
  //                           その約束を守るには、404を誰にも保持させてはいけない。
  //   それ以外     max-age=60 生きた計器なので、60秒より長く固定させない。
  // 0.4.0. 第 3 引数で header を足せる(/register/lookup の 24 時間 cache だけが使う。2xx の時だけ効く)。
  const st = status || 200;
  const cache = st >= 400 ? "no-store" : "public, max-age=60, must-revalidate";
  const extra = (st < 400 && extraHeaders && typeof extraHeaders === "object") ? extraHeaders : {};
  return new Response(JSON.stringify(obj, null, 2), {
    status: st,
    headers: { ...JSON_HEADERS, "Cache-Control": cache, ...CORS_HEADERS, ...extra }
  });
}

// 2026-08-20 mould-ledger. 鋳型記録の使い方。
// この台帳が測るのは「直したか」ではなく「母型を探したか」。
const MOULD_USAGE = {
  route: "GET /mould, GET /mould/{id}, POST /mould",
  purpose:
    "A fix repairs one casting. The mould that cast it sits untouched unless somebody goes looking. " +
    "This ledger records four things about a fix and freezes them: the class of assumption behind it, " +
    "where the author searched for that same assumption, what they found, and at what volume each " +
    "casting failed.",
  fields: {
    class: "the assumption, written so it can be searched for. Not a description of the symptom.",
    instance: "where it was first noticed. { where, symptom, volume }",
    searched: "the space the author says they searched. Naming it is the point.",
    reproduce:
      "optional. Commands that re-run that search, with the ref they were run against. This gate " +
      "does not run them. It records them so a reader can run them and compare their own hit list " +
      "with the locations above. A record without them is published, and says so.",
    found: "per location: already_correct, fixed, or absent. With a commit where there is one.",
    volume: "loud = it threw or returned an error. quiet = it degraded without complaining.",
  },
  volume_note:
    "The same mould does not cast identical failures. It casts the same flaw at different volumes. " +
    "The instance you notice is the loudest one, not the worst one. A quiet casting survives precisely " +
    "because it never complains, so a bug driven search always finds the wrong member of the family first.",
  empty_search_is_published:
    "A record whose searched list is empty is accepted and published as such. An instance fixed with no " +
    "class search is exactly what this ledger exists to make visible. It is not hidden and not rejected.",
  this_ledger_verifies_nothing:
    "Every record is the author's own account. This gate does not reproduce it. What is frozen here is " +
    "the claim and its date, not its truth. Each record carries a record_sha256 anyone can recompute.",
  // 2026-08-20 mould-open-write. 台帳は運営のものではない。誰でも自分の記録を刻める道を一本通す。
  writing:
    "Reading requires nothing, and writing requires no key either. Open the 'Record a mould' issue in " +
    "github.com/ogasurfproject-jpg/horizon-shield, then POST {\"issue\": <number>} to /mould/from-issue. " +
    "This gate fetches that issue from GitHub itself and records what GitHub shows. The caller carries no " +
    "credential and supplies no content, so there is nothing to forge and no shared token that can leak. " +
    "GitHub does the identity part. This gate does not, and does not claim to.",
  how_to_record:
    "https://github.com/ogasurfproject-jpg/horizon-shield/issues/new?template=mould-record.yml",
  what_a_record_is_not:
    "Not a certificate, not a score, not a ranking. Nobody is rated here. A record with an empty search " +
    "list sits in the same list as a thorough one: marked, unhidden, and not placed below it.",
};

// 2026-08-20 mould-no-key. gate が GitHub を自分で読む。呼び出し側は何も主張できない。
// 見出し文字列は .github/ISSUE_TEMPLATE/mould-record.yml と一字一句そろえる。
const MOULD_REPO = "ogasurfproject-jpg/horizon-shield";
const MOULD_LABEL = "mould-record";
const MOULD_ISSUE_FIELDS = {
  "The assumption": "class",
  "Why it is worth recording": "class_note",
  "Where you first noticed it": "instance_where",
  "What it did there": "instance_symptom",
  "How loudly did it fail there?": "instance_volume",
  "Where you searched for the same assumption": "searched",
  "What you found at each place": "found",
  "How someone else could re-run it": "reproduce",
  "What prompted the search": "prompted_by",
};

function mouldParseIssueBody(body) {
  const out = {};
  let key = null, buf = [];
  for (const line of String(body || "").replace(/\r\n/g, "\n").split("\n")) {
    const m = /^###\s+(.+?)\s*$/.exec(line);
    if (m) {
      if (key) out[key] = buf.join("\n").trim();
      key = MOULD_ISSUE_FIELDS[m[1].trim()] || null;
      buf = [];
      continue;
    }
    if (key) buf.push(line);
  }
  if (key) out[key] = buf.join("\n").trim();
  // 任意項目が未入力のとき GitHub は _No response_ と描く。空として扱う。
  for (const k of Object.keys(out)) {
    const v = out[k].trim().toLowerCase();
    if (v === "_no response_" || v === "none") out[k] = "";
  }
  return out;
}

function mouldVolume(s) {
  const t = String(s || "").trim().toLowerCase();
  if (t.startsWith("loud")) return "loud";
  if (t.startsWith("quiet")) return "quiet";
  return null;
}

function mouldLines(block) {
  return String(block || "").split("\n").map((l) => l.trim().replace(/^-\s*/, "").trim()).filter(Boolean);
}

// 2026-08-20 search-reproducible.
// 1行 = command | ref | scope。ref は commit sha / tag / 日付など、著者が指した時点。
function mouldReproduce(block) {
  return mouldLines(block).map((line) => {
    // 2026-08-20: 左から素直に3分割すると、コマンド中の | で壊れる。
    // 実測で rg -n "|| 0" src/ を含む行が別物になった。走らせるまで気づかない形。
    // ref と scope はパイプを含まない。コマンドは含む。だから左から2つだけ切る。
    const p = line.split("|");
    if (p.length < 3) return { command: line.trim(), ref: null, scope: null };
    const ref = p.shift().trim();
    const scope = p.shift().trim();
    const command = p.join("|").trim();
    if (!command) return { command: line.trim(), ref: null, scope: null };
    return { command: command, ref: ref || null, scope: scope || null };
  }).filter((x) => x.command);
}

function mouldIssueToBody(issue) {
  const f = mouldParseIssueBody(issue && issue.body);
  return {
    id: "mould-gh-" + issue.number,
    class: f.class || "",
    class_note: f.class_note || null,
    instance: {
      where: f.instance_where || null,
      symptom: f.instance_symptom || null,
      volume: mouldVolume(f.instance_volume),
    },
    searched: mouldLines(f.searched),
    found: mouldLines(f.found).map((line) => {
      // 2026-08-20: reproduce を直したとき、隣のこれを置いていた。同じ鋳型。
      // note は最後の欄なので、note にパイプが入ると p[3] しか拾わず、そこから先が黙って消える。
      // where / state / volume はパイプを含まない。note は含みうる。だから残り全部を note にする。
      const p = line.split("|").map((x) => x.trim());
      const note = p.slice(3).join(" | ").trim();
      return { where: p[0] || "", state: p[1] || "", volume: mouldVolume(p[2]), note: note || null };
    }).filter((x) => x.where),
    reproduce: mouldReproduce(f.reproduce),
    prompted_by: f.prompted_by || null,
    submitted_via: "github",
    submitted_by: (issue.user && issue.user.login) || null,
    source_url: issue.html_url || null,
  };
}

// 記録の作成そのもの。運営経路と Issue 経路の両方がここを通る。
// 二つの入口が別々に記録を組み立てると、いつか片方だけ仕様が変わる。それも鋳型。
async function mouldWrite(env, b) {
  const t = (v, n) => (v == null ? "" : String(v)).slice(0, n);
  const cls = t(b.class, 400);
  if (!cls) return { status: 400, body: { error: "class is required", usage: MOULD_USAGE } };
  const idx = (await env.HS_VERIFY_KV.get("mould:index", "json")) || [];
  const newId = t(b.id, 60) || ("mould-" + String(idx.length + 1).padStart(4, "0"));
  if (await env.HS_VERIFY_KV.get("mould:" + newId)) {
    return { status: 409, body: { error: "already_recorded", id: newId, means: "This ledger is append only. A record is never rewritten." } };
  }
  const searched = (Array.isArray(b.searched) ? b.searched : []).map((x) => t(x, 300)).filter(Boolean).slice(0, 40);
  const found = (Array.isArray(b.found) ? b.found : []).slice(0, 40).map((f) => ({
    where: t(f && f.where, 200),
    state: ["already_correct", "fixed", "absent", "live"].includes(t(f && f.state, 20)) ? t(f.state, 20) : "unstated",
    volume: ["loud", "quiet"].includes(t(f && f.volume, 10)) ? t(f.volume, 10) : null,
    commit: t(f && f.commit, 40) || null,
    note: t(f && f.note, 300) || null,
  })).filter((f) => f.where);
  const reproduce = (Array.isArray(b.reproduce) ? b.reproduce : []).slice(0, 20).map((r) => ({
    command: t(r && r.command, 400),
    ref: t(r && r.ref, 120) || null,
    scope: t(r && r.scope, 200) || null,
  })).filter((r) => r.command);
  const subVia = t(b.submitted_via, 40) || "operator";
  const subBy = t(b.submitted_by, 100) || null;
  const subSrc = t(b.source_url, 300) || null;
  const rec = {
    ledger: "HORIZON SHIELD mould records",
    id: newId,
    recorded_at: new Date().toISOString(),
    gate_commit: gateCommit(),
    class: cls,
    class_note: t(b.class_note, 600) || null,
    instance: {
      where: t(b.instance && b.instance.where, 200) || null,
      symptom: t(b.instance && b.instance.symptom, 400) || null,
      volume: ["loud", "quiet"].includes(t(b.instance && b.instance.volume, 10)) ? t(b.instance.volume, 10) : null,
    },
    searched: searched,
    searched_note: searched.length
      ? "The space the author says they searched. This ledger does not verify that the search happened."
      : "The author recorded no search. The instance was fixed and the class was not looked for. This is published, not hidden.",
    // 2026-08-20 search-reproducible. 検証はしない。他人が走らせられるようにするだけ。
    reproduce: reproduce,
    reproduce_note: reproduce.length
      ? "The author says these commands re-run the search. This gate did not run them and does not " +
        "vouch for them. What changed is that you can run them yourself against the ref given, and " +
        "compare your own hit list with the locations recorded above. If they disagree, the record " +
        "is wrong and that is now something a stranger can establish without asking anyone."
      : "No way to re-run the search was given, so the searched field above is an assertion and " +
        "nothing more. That is published rather than hidden, on the same rule as an empty search.",
    found: found,
    volume_note: MOULD_USAGE.volume_note,
    prompted_by: t(b.prompted_by, 300) || null,
    submission: {
      via: subVia,
      by: subBy,
      source: subSrc,
      what_this_establishes: subVia === "github"
        ? "This gate fetched the issue from GitHub itself and recorded what GitHub showed. Nobody handed " +
          "it these words. That establishes who wrote this record. It establishes nothing about whether " +
          "the search it describes actually happened."
        : "This record was posted with the operator token. It establishes that the operator wrote it, " +
          "and nothing else.",
    },
    self_asserted:
      "Everything above is the author's own account. This gate did not reproduce it. What is frozen " +
      "here is the claim and its date, not its truth.",
  };
  rec.record_sha256 = await sha256hex(JSON.stringify(rec));
  rec.recompute_note = RECOMPUTE_NOTE;
  await env.HS_VERIFY_KV.put("mould:" + newId, JSON.stringify(rec));
  idx.unshift({ id: newId, recorded_at: rec.recorded_at, class: rec.class, searched: searched.length, found: found.length, repro: reproduce.length, by: subBy, via: subVia, record_sha256: rec.record_sha256 });
  await env.HS_VERIFY_KV.put("mould:index", JSON.stringify(idx.slice(0, 500)));
  return { status: 201, body: rec };
}

async function sha256hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 定数時間比較: 両者を SHA-256(64桁hex) 化して XOR 集約。長さ差でも分岐しない。
async function ctEqual(a, b) {
  const ha = await sha256hex(String(a == null ? "" : a));
  const hb = await sha256hex(String(b == null ? "" : b));
  let out = 0;
  for (let i = 0; i < ha.length; i++) out |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return out === 0;
}

function withTimeout(p, ms) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))
  ]);
}

// ---- 測定経路 (2026-08-15) ----
// 実測: HTTPで呼ばれたこのWorkerから自ゾーンへの subrequest は 522 になる。
// cron起動なら通る。外部ゾーンへは通る。最初に外から見つけたのは Federico。
// 対象が自ゾーンのときだけ、別ゾーンの hs-verify-relay を経由して公開エッジで測る。
// service binding は使わない。公開経路を測らない私道になるからだ。
//
// ---- 訂正 (2026-08-19 patch52。上の行は消さない。訂正は積む) ----
// 上の「cron起動なら通る」は、半分が実測で、半分が外れていた。
// 2026-08-18T18:00:27Z の巡回の記録では、同じ cron が7本を測り、
// mcp / hearing / web / jidec / p001 はすべて reachable:true を返している。
// cron から自ゾーンの「別ワーカー」へは通る。そこは正しかった。
// 同じ巡回で gate だけが http 522 を返した（/history 18:00:38Z）。
// 塞がっていたのはゾーンではなく、同じワーカーが自分自身を叩く経路だった。
// 条件式がゾーンで書かれていたため、cron のときだけ自己測定が直接経路に落ち、
// 毎日 03:00 JST に自分を held にして、それを「相手に届かない」として公開していた。
// 登記簿の中で唯一、自分についてだけ、測定器の故障を対象の欠陥として記録していた。
const PROBE_UA = "HORIZON-SHIELD-verify-gate/0.2 (+https://gate.horizonshield.dev/spec; conformance probe; read-only)";
const OWN_ZONE = "horizonshield.dev";
const GATE_HOST = "gate.horizonshield.dev"; // patch52: 自己参照かどうかの判定に使う
let GATE_ENV = null;       // 入口で env を差す。値は毎回同一なので競合しない
let GATE_CONTEXT = "none"; // "http" | "cron"。patch52: 中継の要否は文脈だけでなく「相手が自分か」で決まる
// 2026-08-19 patch53. patch52 がこの行から消してしまった実測を書き戻す。
//   旧: 「★中継は http 文脈のみ。cron→workers.dev は塞がっている(実測)」
// 消したのは誤りだった。79行目の古い記述は残して訂正を積んだのに、ここだけ消していた。
// しかもこの1行が、cron から中継に届かない可能性を示す唯一の手がかりだった。
// RELAY_URL は現在 workers.dev なので、この実測が今も生きているなら cron からは届かない。
// そのときの正解は「届かない」ではなく「測っていない」。patch53 の try/catch がそれを保証する。
// 中継に custom domain を張れば cron からも届く可能性はある。cron から自ゾーンの別ワーカーへは
// 2026-08-18T18:00Z の巡回で5本とも到達を実測済みだからだ。ただしこれは未測定。推測で動かさない。

function isOwnZone(u) {
  try {
    const h = new URL(u).hostname;
    return h === OWN_ZONE || h.endsWith("." + OWN_ZONE);
  } catch (_e) { return false; }
}

// 0.2.2. 公開の測定器が測ってよいのは公開の名前だけ。IP リテラル / localhost / 内部っぽい名前 / userinfo 付きは
// 入口で断る(redteam: endpoint_ip_literal / endpoint_localhost / endpoint_userinfo)。
function endpointHostProblem(parsed) {
  const h = String(parsed.hostname || "").toLowerCase();
  if (parsed.username || parsed.password) return "userinfo in URL is not accepted";
  if (!h) return "hostname required";
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return "not a public hostname: " + h;
  if (/^\[?[0-9a-f:]+\]?$/i.test(h) && h.indexOf(":") >= 0) return "IP literal is not accepted: " + h;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return "IP literal is not accepted: " + h;
  if (h.indexOf(".") < 0) return "not a public hostname: " + h;
  return null;
}

function isSelf(u) {
  try { return new URL(u).hostname === GATE_HOST; } catch (_e) { return false; }
}

function relayConfigured() {
  return !!(GATE_ENV && GATE_ENV.RELAY_URL && GATE_ENV.RELAY_TOKEN);
}

// 2026-08-19 patch52. 中継を通すかどうか。
// http 文脈: 自ゾーンは全部 522 になる(2026-08-14/15 実測)。中継が要る。
// cron 文脈: 自ゾーンの別ワーカーへは直接届く(2026-08-18T18:00Z の巡回で5本を実測)。
//            届かないのは自分自身への subrequest だけ(同じ巡回で gate だけ http 522)。
// だから条件は「自ゾーンか」ではなく「自分自身か」で分ける。
function useRelay(u) {
  if (!relayConfigured()) return false;
  if (!isOwnZone(u)) return false;
  return GATE_CONTEXT === "http" || isSelf(u);
}

function probeVia(endpoint) {
  return useRelay(endpoint)
    ? "relay (hs-verify-relay, a separate worker outside this zone path; the whole probe traverses the public edge, because a Worker invoked over HTTP cannot reach its own zone directly. Measured 2026-08-14/15)"
    : "direct from the gate worker (" + GATE_CONTEXT + " context)";
}

// デプロイ時に deploy_gate.sh が --var GATE_COMMIT:<sha> で注入する。
// 注入なしでデプロイされたら、判定には "unpinned" が載る。空白ではなく名指しで。
// コミットSHAは内容アドレスであり、この値が record_sha256 の中を旅することで
// 「どのバイト列のコードがこの判定を出したか」が判定自身に固定される。
function gateCommit() {
  return (GATE_ENV && GATE_ENV.GATE_COMMIT)
    ? String(GATE_ENV.GATE_COMMIT)
    : "unpinned: this deployment did not inject a commit (deploy_gate.sh not used)";
}

// 0.2.2. リダイレクトを黙って辿ると、他所のサーバーや他所のカードを「この endpoint のもの」として測ってしまう
// (redteam: card_redirect_cross_origin / mcp_redirect_cross_origin)。同一オリジンの中だけ最大3回辿り、
// オリジンを跨ぐ 3xx は「述べられた URL では測っていない」として answered(届いた上で不適合)に落とす。
// 中継経路(自ゾーン)は中継側が辿るので、この縛りは直叩き経路にだけ効く。そのことは隠さない。
// 0.4.0 (2026-09-07). 掃引の subrequest 予算。Workers Free は 1 回の実行(cron も 1 回)で fetch 50 本。51 本目は例外で落ちて、
// 測定の途中で切れる = 壊れた instant が履歴に載る。0.3.4 の jwks(+1/署名付き card)と 0.3.5 の 3 源 beacon(窓の初回 +7)と
// 0.4.0 の commitment(+2)で、自前 8 行の日は 44 + 7 + 2 = 53 になっとった(MAX_PER_SWEEP の注記は init+list+card=5 で
// 数えとって、tools/call ×2 と jwks を落としとった)。数えるのは掃引の間だけ、fetch を 1 回呼んだら 1。
// 残りが 1 行分(SUBREQUEST_PER_ENDPOINT)を切ったら、その行は測らずに理由を書いて次回に回す(次回は least recently measured で先頭)。
// 予算は env.SUBREQUEST_BUDGET で変えられる(Paid なら 1000)。既定は Free の 50。
const SUBREQUEST_BUDGET_DEFAULT = 50;
const SUBREQUEST_PER_ENDPOINT = 6;   // init + tools/list + card + jwks(署名付き card) + tools/call ×2。pagination や再試行で増える
let sweepBudget = null;              // 掃引中だけ { used }。掃引外は null で何も数えん
function countSubrequest() { if (sweepBudget) sweepBudget.used += 1; }
async function countingFetch(u, init) { countSubrequest(); return fetch(u, init); }

async function fetchSameOriginOnly(url, opts) {
  let cur = url;
  for (let hop = 0; hop < 4; hop++) {
    const res = await countingFetch(cur, { ...opts, redirect: "manual" });
    if (res.status < 300 || res.status >= 400) return res;
    const loc = res.headers.get("location");
    if (!loc) return res;
    let next;
    try { next = new URL(loc, cur).toString(); } catch (_e) { return res; }
    if (new URL(next).origin !== new URL(url).origin) {
      const e = new Error("redirected off-origin to " + new URL(next).host + " (http " + res.status + "): the stated URL answered with a redirect to another origin, so nothing was measured at the stated URL");
      e.answered = true;
      throw e;
    }
    if (hop === 3) {
      const e = new Error("too many redirects at the stated URL"); e.answered = true; throw e;
    }
    cur = next;
    // 307/308 はメソッドと本文を保つ。それ以外は GET に落ちる(fetch の既定と同じ)
    if (!(res.status === 307 || res.status === 308)) opts = { ...opts, method: "GET", body: undefined };
  }
  return await countingFetch(cur, opts);
}

async function probeFetch(url, init) {
  const opts = init ? { ...init } : {};
  opts.headers = { ...(opts.headers || {}), "user-agent": PROBE_UA };
  if (!useRelay(url)) {
    // 2026-08-19 patch52. 中継が無い状態で自分自身を直接叩くと必ず http 522 になる。
    // 522 は gatewayish なので transport 扱いになり、公開の記録に reachable:false が載る。
    // それは相手についての主張であり、ここでの相手は自分自身で、
    // 公開インターネットからは到達できている。**書いてよい事実ではない。**
    // 測定を成立させずに gate-side として落とす。既存の検出がこれを拾う。
    if (isSelf(url)) {
      throw new Error("relay unavailable (self-probe has no relay path): gate-side failure, not a statement about the target");
    }
    return await fetchSameOriginOnly(url, opts);
  }
  // 2026-08-19 patch53. ここは patch52 の取りこぼし。
  // 中継が「返した」場合しか見ていなかった。fetch that throws は素通りして、
  // 呼び出し元では transport 扱いになり、また reachable:false が公開される。
  // Cloudflare が同一アカウントの workers.dev 間呼び出しを塞ぐときは、
  // ステータスではなく例外で来る（1104 / 1042 / fetch failed。checkMcp の hint が同じ形を名指ししている）。
  // RELAY_URL は現在 workers.dev なので、cron からはこの形で落ちる可能性が高い。
  // 中継に届かないのはこちらの故障であって、相手についての事実ではない。例外にもそう言わせる。
  let res;
  try {
    res = await countingFetch(GATE_ENV.RELAY_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-relay-token": GATE_ENV.RELAY_TOKEN },
      body: JSON.stringify({
        url: url,
        method: opts.method === "POST" ? "POST" : "GET",
        headers: opts.headers,
        body: typeof opts.body === "string" ? opts.body : null
      })
    });
  } catch (e) {
    throw new Error("relay unreachable (" + String((e && e.message) || e) + "): gate-side failure, not a statement about the target");
  }
  let wrapped = null;
  try { wrapped = await res.json(); } catch (_e) { wrapped = null; }
  if (res.status === 502 && wrapped && wrapped.error === "target_fetch_failed") {
    // 中継までは届いたが、中継から相手に届かなかった = 公開エッジ経由の相手側到達性の事実
    throw new Error("unreachable via public-edge relay: " + String(wrapped.message || "fetch failed"));
  }
  if (!res.ok || !wrapped || wrapped.relayed !== true) {
    // 中継そのものに届かない/設定不良 = こちら側の故障。相手の記録にしない文言で返す
    throw new Error("relay unavailable (http " + res.status + "): gate-side failure, not a statement about the target");
  }
  return new Response(wrapped.body || "", { status: wrapped.status, headers: wrapped.headers || {} });
}

// 2^53 を超える整数リテラルは JSON.parse が黙って丸める。丸めた後の数からは復元できない。
// 2026-08-23 の午前、我々はこれを「JavaScriptでは検出不能な限界」として公開した。誤りだった。
// V8 の source-access reviver は各リテラルの元の文字列を渡してくれる。元が読めるなら、丸めが
// 起きた事実は検出できる。検出できるものを「限界」と呼んで放置するのは、ただの怠慢だった。
//
// なぜ拒む必要があるか: RFC 8785 の土台である RFC 7493 (I-JSON) は整数を
// [-(2^53)+1, (2^53)-1] に限っている。範囲外の整数を含む表面は、Python のように多倍長整数を
// 持つ言語では別の値として読まれる。つまり我々のハッシュを相手は再現できない。
// 再現できないものに「誰でも再計算できる」と書いた指紋を付けてはいけない。
//
// この機能が無い実行環境では detectable:false を返し、「検出できなかった」と正直に言う。
// 検出できないことと、起きていないことは、別の事実である。
// ---- 0.4.2 (2026-09-09): 同じ規律を、扉自身の出力に ----
// 条件07 は測る相手の表面について決めとる: 2^53 の外の整数を含むなら指紋を出さん(RFC 7493 I-JSON)。
// 理由は「多倍長整数を持つ言語では別の値として読まれる = こっちのハッシュを相手は再現できん」。
// では、この扉が出す判定そのもののバイトはどうか。誰も測っとらんかった。運営者は例外やなく被験者や。
//
// 発端: Federico Blanco Sanchez-Llanos が 2026-09-09 に公開した /review の不具合。
// 2^53 を超える JSON の数値は、自前の正準化コードが動く前に、パースの時点で double に潰れる。
// 「こう直列化せよ」と散文で書いても、読み手が parse した瞬間にもう壊れとるから間に合わん。
//
// ここで測るのは 1 つだけ: このバイトの中の数値が全部、I-JSON の安全域の整数か。
//   全部そうなら → JSON を読んで、印字順のまま、詰めて書き直す実装は、言語を問わず同じバイトに着く。
//   そうでないなら → 着かん実装がある(2^53 の外は丸められ、小数は実行環境ごとに印字が違い得る)。
// どっちなのかを、散文やなく欄で言う。判定にはせん(条件やない、赤くもならん)。
//
// **この欄自身は数値を 1 つも持たん(真偽と文字列だけ)。** だから欄を足す前と後で走査の答えが変わらん。
// 不動点やから、hash の中に入れられる。入れられるから、引用から外せん。
const IJSON_MAX_SAFE = 9007199254740991;   // 2^53 - 1、RFC 7493 の整数の上限
function scanNumbers(value) {
  const findings = [];
  (function walk(v, path) {
    if (v === null || v === undefined) return;
    if (typeof v === "number") {
      if (!Number.isFinite(v)) {
        findings.push({ kind: "not_finite", text: path + ": not a finite number (" + String(v) + "); JSON cannot carry it and JSON.parse never produces it" });
      } else if (!Number.isInteger(v)) {
        findings.push({ kind: "non_integer", text: path + ": " + String(v) + " is not an integer; runtimes that print a fixed number of digits instead of the shortest round trip form write different characters here" });
      } else if (Math.abs(v) > IJSON_MAX_SAFE) {
        findings.push({ kind: "unsafe_integer", text: path + ": " + String(v) + " is outside the RFC 7493 safe range; JSON.parse rounds it in JavaScript before any canonicalization runs" });
      }
      return;
    }
    if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) walk(v[i], path + "[" + i + "]"); return; }
    if (typeof v === "object") { for (const k of Object.keys(v)) walk(v[k], path ? path + "." + k : k); }
  })(value, "");
  return findings;
}
const NUMBER_SAFETY_MAX_FINDINGS = 20;
function numberSafety(record) {
  const all = scanNumbers(record);
  // 二段に分ける。同じ「再現できん」でも、確実に壊れる物と、実装によっては壊れる物を混ぜたら、
  // 欄は狼少年になる。条件07 が相手の表面について既に引いとる線と同じ線をここでも引く。
  const unsafe = all.filter((f) => f.kind !== "non_integer").map((f) => f.text);
  const nonInteger = all.filter((f) => f.kind === "non_integer").map((f) => f.text);
  const cap = (list) => list.length > NUMBER_SAFETY_MAX_FINDINGS
    ? list.slice(0, NUMBER_SAFETY_MAX_FINDINGS).concat(["more were found than are listed here; this list is capped"])
    : list;
  return {
    since: "0.4.2",
    parse_safe: unsafe.length === 0,
    safe_integers_only: all.length === 0,
    unsafe_integers: cap(unsafe),
    non_integer_numbers: cap(nonInteger),
    what:
      "Which numbers in these bytes a second implementer might not reproduce. Two questions, not one, because " +
      "the two failures are not the same size. parse_safe is the one that matters: true means unsafe_integers is " +
      "empty, so no value here is destroyed by JSON.parse before any canonicalization code can run, and a reader " +
      "at least sees what was written. safe_integers_only is stricter: true means both lists are empty, so every " +
      "number here is an integer inside the RFC 7493 (I-JSON) safe range and a compact re-serialization with the " +
      "keys in the order printed reproduces these bytes in any language at all. non_integer_numbers lists " +
      "doubles: every runtime that prints the shortest form that round trips (JavaScript, Python, Go, Java and " +
      "others) reaches the same characters, but a runtime that prints a fixed number of digits does not. A " +
      "verdict that measures a surface normally carries one such double, the percentage in absence_vs_failure, " +
      "so parse_safe true with safe_integers_only false is the ordinary state and is not a warning.",
    why:
      "An integer past 2^53 is rounded by JSON.parse before any canonicalization runs, and a double can be " +
      "printed more than one way. Either silently breaks the recompute recipe for some readers, and prose in " +
      "the recipe cannot prevent it, because the damage happens before the reader reaches the prose. Found in " +
      "public on 2026-09-09 by Federico Blanco Sanchez-Llanos, from the payments side, in an idempotency key " +
      "where two different large amounts collapsed into one fingerprint.",
    self_applied:
      "This is condition 07's rule, which this gate applies to every surface it measures and for which it " +
      "withholds a fingerprint rather than publish one nobody could reproduce, asked of the gate's own verdict. " +
      "The operator is a subject of the rule, not an exception to it.",
    not_a_rule:
      "A disclosed measurement, not a pass or fail. Nothing turns red on it, and a listed number does not make " +
      "a verdict wrong. It says how to check: fetch the bytes at record_url and hash them, rather than parsing " +
      "and re-serializing them yourself.",
    this_block_holds_no_number:
      "By construction this block contains no numeric value, so adding it to the record cannot change the " +
      "answer it reports about the record."
  };
}

const PARSE_INFO = Symbol("hs_parse_info");

function parseJsonTracked(text) {
  const lost = [];
  let detectable = false;
  const value = JSON.parse(text, function (k, v, ctx) {
    if (ctx && typeof ctx.source === "string") {
      detectable = true;
      if (typeof v === "number" && /^-?\d+$/.test(ctx.source)) {
        try { if (BigInt(ctx.source) !== BigInt(v)) lost.push(ctx.source); } catch (_e) { /* Infinity 等は canonicalJson 側で拒む */ }
      }
    }
    return v;
  });
  const info = { detectable: detectable, lost: lost };
  if (value && typeof value === "object") {
    try { Object.defineProperty(value, PARSE_INFO, { value: info, enumerable: false }); } catch (_e) {}
  }
  return value;
}

function parseInfoOf(v) {
  return (v && typeof v === "object" && v[PARSE_INFO]) || { detectable: false, lost: [] };
}

async function rpcCall(endpoint, method, params) {
  const res = await withTimeout(probeFetch(endpoint, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params || {} })
  }), CONFIG.timeout_ms);
  if (!res.ok) {
    // 0.2.2. HTTP のステータスは相手からの「答え」である(checkAgentCard の 404 と同じ理屈)。
    // gateway 系(502-504, 52x)だけが「相手の origin は答えていない」。それ以外の 4xx/5xx は
    // 届いた上での不適合であり、reachable:false と公開してはいけない(redteam: mcp_http_404 / 401)。
    const gatewayish = (res.status >= 502 && res.status <= 504) || (res.status >= 520 && res.status <= 530);
    const e = new Error("http " + res.status + (gatewayish ? "" : " (the server answered, but not with JSON-RPC)"));
    e.answered = !gatewayish;
    throw e;
  }
  const text = await res.text();
  try {
    return parseJsonTracked(text);
  } catch (pe) {
    // 0.2.2. 200 で HTML を返す相手は「届いたが MCP ではない」。到達不能ではない(redteam: mcp_http_200_html)。
    const e = new Error("response is not JSON (" + String((pe && pe.message) || pe).slice(0, 60) + "): the server answered, but not with JSON-RPC");
    e.answered = true;
    throw e;
  }
}

// ---- 表面(surface)のハッシュ ----
// RFC 8785 (JCS) の正規化。2026-08-23、本物のJCS実装(npm canonicalize)と適合ベクタで突き合わせた。
//
// 実測: 12本中11本がバイト一致。JSで書いてあることが効いていて、キー順序(RFC 8785 は UTF-16
// コード単位順。JSの既定 sort がまさにそれ)と数値表記(ES6 Number::toString がそのまま仕様)は
// 素通しで合っていた。同じ処理を Python で手書きすると、コードポイント順と指数表記の2点で外れる。
//
// 唯一外れた1本が非有限数だった。1e400 は JSON.parse で Infinity になり、旧実装はそれを
// JSON.stringify 経由で null に変え、ハッシュだけは平然と返していた。本物のJCSはここで例外を出す。
// 黙って値が変わる正規化は、第三者の再計算を黙って壊す。計器が黙って壊れるのが一番たちが悪い。
// だから出せないものは出さない(fail-closed)。適合ベクタは tools/jcs_conformance.mjs に固定した。
//
// この計器の既知の限界(2026-08-23 実測、未解決):
//   JavaScript では 2^53 を超える整数リテラルは JSON.parse の時点で既に丸められている。
//   9007199254740993 は、この関数が値を見る前に ...992 になっており、こちらからは区別できない。
//   Python のような多倍長整数を持つ言語の実装は、ここで黙って丸めず例外を出すべきであり、
//   この実装はそれができない。できないことを、できるふりで隠さずここに書いておく。
//   (この一点だけは、我々が測れない 1/64 にあたる。)
//
// 出典: Federico Blanco Sanchez-Llanos が自身の署名経路で同じ分類の乖離を公表(2026-08-23)。
// 指摘は借りた。数字は自分で測った。
function canonicalJson(v) {
  if (typeof v === "number" && !Number.isFinite(v)) {
    throw new Error("canonicalization refused: a non-finite number (Infinity or NaN) has no JSON form, so no reproducible hash exists over it");
  }
  if (v === null || typeof v !== "object") return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonicalJson(v[k])).join(",") + "}";
}

// ハッシュは16hex(64bit)に切る。変更検出用の指紋であって、暗号学的な同一性証明ではない。
// 名前ハッシュだけでは「名前を残して inputSchema を書き換える」変更(統合破壊の第1位)が見えない。
// だからマニフェスト全体と、ツール1本ごとの指紋を持つ。
async function surfaceHashes(tools, initResult, pages, complete, parseNotes) {
  const sorted = tools.slice().sort((a, b) => (String(a.name) < String(b.name) ? -1 : 1));
  const strip = (t) => ({ name: t.name, description: t.description || "", inputSchema: t.inputSchema || null });
  const pn = parseNotes || { detectable: false, lost: [] };

  // 正規化を拒んだ場合、それは相手が壊れているのではなく、こちらが「その形は正規化できない」と
  // 言っているだけ。到達性の失敗(transport)に混ぜると、こちらの都合が相手の記録になる。
  // だから握りつぶしも例外の素通しもせず、ハッシュを null にして理由をそのまま開示する。
  let refused = null;
  // 丸められた整数リテラルを見ていたら、その時点で指紋は他言語と一致しない。ハッシュを出さない。
  if (pn.lost.length) {
    refused = "canonicalization refused: the response carried " + pn.lost.length +
      " integer literal(s) outside the IEEE-754 safe range (" + pn.lost.slice(0, 3).join(", ") +
      (pn.lost.length > 3 ? ", ..." : "") + "), which JSON.parse rounded before this gate saw them. " +
      "RFC 7493, the profile RFC 8785 builds on, excludes them for this reason";
  }
  const hash = async (v) => {
    if (refused) return null;
    try {
      return (await sha256hex(canonicalJson(v))).slice(0, 16);
    } catch (e) {
      if (!refused) refused = String((e && e.message) || e);
      return null;
    }
  };

  const perTool = {};
  for (const t of sorted) {
    perTool[String(t.name)] = await hash(strip(t));
  }
  const out = {
    complete: complete,
    pages_followed: pages,
    names_hash: (await sha256hex(JSON.stringify(sorted.map((t) => String(t.name))))).slice(0, 16),
    manifest_hash: await hash(sorted.map(strip)),
    server_info_hash: initResult ? await hash(initResult) : null,
    tool_hashes: perTool
  };
  out.canonicalization = refused ? "refused" : "rfc8785-jcs";
  // 検出できたか / 検出した結果どうだったか、を分けて書く。
  // "clean" は「無かった」。"unavailable" は「見られなかった」。同じ扱いにしてはいけない。
  out.unsafe_integer_scan = pn.detectable ? (pn.lost.length ? "found" : "clean") : "unavailable in this runtime";
  if (refused) {
    out.canonicalization_note =
      "A hash is withheld here rather than published. " + refused + ". This is a statement about what " +
      "this gate will canonicalize, NOT a fault found in the measured server: a value of this shape " +
      "cannot be re-serialized byte-for-byte by an independent party, so any hash over it would be a " +
      "number nobody else could reproduce. Publishing it would look like proof and act like noise.";
  }
  return out;
}

// ---- 条件06. 「無かった」と「引けなかった」を区別できる契約か ----
// Federico Blanco Sanchez-Llanos, "The Mould, Not the Letter", 2026-08-20:
//   never let "the fetch failed" and "the fetch succeeded and found nothing" collapse
//   into the same downstream value.
//
// Measured from the outputSchema each tool already declares in tools/list. Nothing is
// executed. This renders NO verdict ,  it is a disclosed number, like reachable in gate58.
//
// The test is STRUCTURAL and name-independent: a boolean, or an enum with 2+ values, is a
// place a read-succeeded / read-failed / nothing-matched state can live. Field NAMES are
// not consulted, because this gate scores servers it does not own, and a name list would
// let an author score well by renaming a field. A bare count is not enough: count 0 does
// not prove the read worked. The field names that produced each pass are published, so a
// reader can see the false positives (a job board that declares remote:boolean passes this
// structural test and is not thereby holding the difference).
function schemaHoldsState(schema) {
  // v2, 2026-08-20, Federico Blanco Sanchez-Llanos's refinement. Only the ENVELOPE:
  // the top-level properties of the outputSchema, outside whatever wraps the domain
  // payload (data/result/items). Read-state conventionally lives in the envelope; an
  // entity flag like a job listing's remote:boolean lives one level down, inside the
  // object it describes, and is not read-state. Restricting to the top level strips
  // that entity-nested class without dropping a real read-state (ours all sit at the
  // envelope). It does NOT separate a top-level metadata boolean (cache_hit) from a
  // top-level read-state: that residual is semantic, not structural, which is why the
  // field names stay published so a reader makes the call the machine can't.
  const props = (schema && schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties))
    ? schema.properties : {};
  const found = [];
  for (const [pk, pv] of Object.entries(props)) {
    if (!pv || typeof pv !== "object") continue;
    const t = pv.type, ts = Array.isArray(t) ? t : (t ? [t] : []);
    const isBool = ts.includes("boolean");
    const isEnum = Array.isArray(pv.enum) && pv.enum.length >= 2;
    if (isBool || isEnum) found.push(pk + ":" + (isEnum ? "enum" : "boolean"));
  }
  return [...new Set(found)];
}

function measureAbsenceVsFailure(tools) {
  let opaque = 0, flat = 0, discriminating = 0;
  const holds = [];
  for (const t of (tools || [])) {
    const out = t && t.outputSchema;
    const hasOut = !!(out && typeof out === "object" && Object.keys(out).length);
    if (!hasOut) { opaque += 1; continue; }
    const fields = schemaHoldsState(out);
    if (fields.length) { discriminating += 1; holds.push({ tool: String(t && t.name), fields: fields }); }
    else { flat += 1; }
  }
  const total = (tools || []).length;
  const cannot = opaque + flat;
  return {
    condition: "06",
    question: "Can a consumer tell 'the lookup failed' from 'the lookup found nothing'?",
    source: "Federico Blanco Sanchez-Llanos, \"The Mould, Not the Letter\", 2026-08-20",
    method: "structural, name-independent: a boolean or an enum with 2+ values in a tool's declared outputSchema. tools/list only; nothing is executed.",
    verdict: null,
    verdict_note: "A disclosed measurement, not a pass or fail. Nearly all of the field cannot do this, so a threshold would only condemn; and a schema is a declaration, not behaviour. The gate reports the number and the field names, and judges nobody on it.",
    tools_measured: total,
    opaque: opaque,
    flat: flat,
    discriminating: discriminating,
    cannot_distinguish: cannot,
    cannot_distinguish_pct: total ? Math.round(1000 * cannot / total) / 10 : null,
    discriminating_fields: holds,
    caution: "This test cannot read. A field like remote:boolean passes it without being a read-state at all. discriminating_fields is published so you can check each pass yourself."
  };
}

// ---- 条件1. 実在する MCP エンドポイント ----
async function checkMcp(endpoint) {
  const detail = {};
  let initResult = null;
  // 応答テキストの段階で、丸められた整数リテラルを見たかどうかを集める。
  const parseNotes = { detectable: false, lost: [] };
  const noteParse = (v) => {
    const i = parseInfoOf(v);
    if (i.detectable) parseNotes.detectable = true;
    for (const s of i.lost) if (parseNotes.lost.indexOf(s) < 0) parseNotes.lost.push(s);
  };
  try {
    const init = await rpcCall(endpoint, "initialize", { protocolVersion: "2024-11-05" });
    noteParse(init);
    detail.initialize = !!(init && init.result);
    detail.server_name = (init && init.result && init.result.serverInfo && init.result.serverInfo.name) || null;
    initResult = init && init.result ? { serverInfo: init.result.serverInfo || null, capabilities: init.result.capabilities || null } : null;
    // 0.2.2. initialize が JSON-RPC error や result 無しで答えたのに、tools/list だけで通していた
    // (redteam: initialize_jsonrpc_error / initialize_result_null)。条件1は「initialize と tools/list に答える」。
    if (init && init.error) {
      return { pass: false, reason: "initialize returned a JSON-RPC error: " + String((init.error && init.error.message) || JSON.stringify(init.error)).slice(0, 80), detail };
    }
    if (!init || !init.result || typeof init.result !== "object") {
      return { pass: false, reason: "initialize returned no result object", detail };
    }
  } catch (e) {
    if (/gate-side failure/.test(String(e && e.message))) {
      // 中継の故障。対象のことは何も分かっていない。boolean にもそう言わせる。
      return { pass: false, gate_side: true, measured: false, reason: "not measured: " + e.message, detail };
    }
    if (e && e.answered === true) {
      // 0.2.2. 届いた上での不適合。transport(到達不能)と混ぜない。
      return { pass: false, reason: "initialize failed: " + e.message, detail };
    }
    const hint = /1104|1042|Failed to fetch|fetch failed/i.test(String(e.message))
      ? " (the gate could not reach this host. Cloudflare blocks Worker-to-Worker calls within the " +
        "same account over workers.dev; use a custom domain, or run the check from outside)"
      : "";
    return { pass: false, transport: true, reason: "initialize failed: " + e.message + hint, detail };
  }
  try {
    // カーソルを最後まで辿る(上限3ページ)。辿り切れなければ surface は complete: false。
    // 部分読みから「ツールが消えた」と主張するのが、この測定の最悪の故障だから。
    let tools = [];
    let cursor = null;
    let pages = 0;
    do {
      const list = await rpcCall(endpoint, "tools/list", cursor ? { cursor: cursor } : {});
      noteParse(list);
      const batchRaw = (list && list.result && list.result.tools);
      // 0.2.2. tools が配列でなければ、それは MCP の tools/list ではない(redteam: tools_is_object_not_array。
      // 旧実装は concat でオブジェクトを1本のツールとして数え、verified を出していた)。
      if (batchRaw !== undefined && batchRaw !== null && !Array.isArray(batchRaw)) {
        return { pass: false, reason: "tools/list returned tools that is not an array", detail };
      }
      const batch = batchRaw || [];
      tools = tools.concat(batch);
      cursor = (list && list.result && list.result.nextCursor) || null;
      pages += 1;
    } while (cursor && pages < 3);
    detail.tool_count = tools.length;
    detail.tools = tools.map((t) => (t && t.name)).slice(0, 50);
    detail.surface = await surfaceHashes(tools, initResult, pages, !cursor, parseNotes);
    detail.absence_vs_failure = measureAbsenceVsFailure(tools);
    if (!tools.length) return { pass: false, reason: "tools/list returned no tools", detail };
    // 0.2.2. 中身の無いツールは数えない。MCP のツールは「空でない文字列の name」と「inputSchema オブジェクト」を持つ。
    // 名前だけの殻(redteam: hollow_tool_no_inputSchema / tool_empty_name / tool_name_not_string)で条件1を通し、
    // その殻に決定論性まで測らせて verified を出していた。重複名(duplicate_tool_names)も1面として認めない。
    const callable = tools.filter((t) => t && typeof t.name === "string" && t.name.trim().length > 0 &&
      t.inputSchema && typeof t.inputSchema === "object" && !Array.isArray(t.inputSchema));
    detail.callable_tools = callable.map((t) => t.name).slice(0, 50);
    detail.hollow_tools = tools.length - callable.length;
    if (!callable.length) {
      return { pass: false, reason: "tools/list returned no well-formed tool (a tool needs a non-empty string name and an inputSchema object)", detail };
    }
    const _names = callable.map((t) => t.name);
    if (new Set(_names).size !== _names.length) {
      return { pass: false, reason: "tools/list carries duplicate tool names; a surface that names the same tool twice cannot be addressed unambiguously", detail };
    }
  } catch (e) {
    if (/gate-side failure/.test(String(e && e.message))) {
      return { pass: false, gate_side: true, measured: false, reason: "not measured: " + e.message, detail };
    }
    if (e && e.answered === true) {
      return { pass: false, reason: "tools/list failed: " + e.message, detail };
    }
    return { pass: false, transport: true, reason: "tools/list failed: " + e.message, detail };
  }
  return { pass: true, reason: "MCP endpoint responds to initialize and tools/list", detail };
}

// ---- 条件2. A2A エージェントカード ----
async function checkAgentCard(endpoint) {
  const origin = new URL(endpoint).origin;
  const url = origin + "/.well-known/agent-card.json";
  try {
    const res = await withTimeout(probeFetch(url), CONFIG.timeout_ms);
    if (!res.ok) {
      // An HTTP status IS an answer from the far side. 404 means "reached,
      // and no card is published there": a failed condition, not
      // unreachability, and it must not flip the whole record to held.
      // Only gateway-shaped statuses (502-504 and Cloudflare's 52x edge
      // codes) mean the origin behind the URL did not actually answer.
      const gatewayish = (res.status >= 502 && res.status <= 504) || (res.status >= 520 && res.status <= 530);
      if (gatewayish) return { pass: false, transport: true, reason: "agent-card not reachable (http " + res.status + ")", detail: { url } };
      return { pass: false, reason: "agent-card not published (http " + res.status + ": the server answered; no card lives at this path)", detail: { url } };
    }
    let card;
    try { card = await res.json(); }
    catch (_e) {
      // 0.2.2. 200 で JSON でないものは「届いたがカードではない」。到達不能ではない(redteam: card_is_html)。
      return { pass: false, reason: "agent-card is not JSON (the server answered; what lives at this path is not a card)", detail: { url } };
    }
    // 0.2.2. カードは JSON オブジェクトで、name / description は空でない文字列(redteam: card_is_array /
    // card_name_whitespace / card_name_boolean / card_description_object)。真偽値や空白で条件2を通していた。
    if (!card || typeof card !== "object" || Array.isArray(card)) {
      return { pass: false, reason: "agent-card is not a JSON object", detail: { url } };
    }
    const missing = ["name", "description"].filter((k) => typeof card[k] !== "string" || !card[k].trim());
    if (missing.length) {
      return { pass: false, reason: "agent-card missing or empty (must be non-empty strings): " + missing.join(", "), detail: { url } };
    }
    // 0.3.4. 署名があれば読む。判定には効かん(条件2は「公開されとる、形が整うとる」のまま)。detail.signature に verified true / false / null(読めん)を書く。
    // 無効な署名で条件 2 を落とすかどうかは判定規則の変更で、ここでは決めん(記録には残る)。
    const signature = await verifyCardSignatures(card, origin);
    return {
      pass: true,
      reason: "agent-card published and well-formed" + (signature.verified === true ? "; signature verifies" : signature.verified === false ? "; a signature is present but does not verify" : ""),
      detail: { url, name: card.name, skills: (card.skills || []).length, signature },
      card: card
    };
  } catch (e) {
    if (/gate-side failure/.test(String(e && e.message))) {
      return { pass: false, gate_side: true, measured: false, reason: "not measured: " + e.message, detail: { url } };
    }
    if (e && e.answered === true) {
      return { pass: false, reason: "agent-card not usable: " + e.message, detail: { url } };
    }
    return { pass: false, transport: true, reason: "agent-card fetch failed: " + e.message, detail: { url } };
  }
}

// ---- 相手の card の署名を読む (0.3.4、判定には効かん、detail だけ) ----
// A2A 1.0 §8.4: 署名の対象は「proto の形に写した card(schema 外の鍵は落ち、既定値の欄は省かれる)から signatures を除き、RFC 8785 で並べた bytes」。
// 公式 SDK(@a2a-js/sdk canonicalizeAgentCard = AgentCard.fromJSON/toJSON 往復 + JCS)と同じ bytes を出す写しを、ここに schema として書く。
// 同じ bytes が出ることは workers/a2a-card-sign/canon_equiv.test.mjs が公式 SDK と突き合わせて確かめる。
// 読めん形(securitySchemes / securityRequirements を持つ card)は「検証できん」と言い、有効とも無効とも言わん。
const CARD_SCHEMA = {
  kind: "message",
  fields: {
    name: "string", description: "string", version: "string", documentationUrl: "string", iconUrl: "string",
    supportedInterfaces: { kind: "repeated", of: { kind: "message", fields: { url: "string", protocolBinding: "string", tenant: "string", protocolVersion: "string" } } },
    provider: { kind: "message", fields: { url: "string", organization: "string" } },
    capabilities: { kind: "message", fields: {
      streaming: "obool", pushNotifications: "obool", extendedAgentCard: "obool",
      extensions: { kind: "repeated", of: { kind: "message", fields: { uri: "string", description: "string", required: "bool", params: "struct" } } }
    } },
    defaultInputModes: { kind: "repeated", of: "string" }, defaultOutputModes: { kind: "repeated", of: "string" },
    skills: { kind: "repeated", of: { kind: "message", fields: {
      id: "string", name: "string", description: "string",
      tags: { kind: "repeated", of: "string" }, examples: { kind: "repeated", of: "string" },
      inputModes: { kind: "repeated", of: "string" }, outputModes: { kind: "repeated", of: "string" },
      securityRequirements: "unsupported"
    } } },
    securitySchemes: "unsupported", securityRequirements: "unsupported"
  }
};
const CARD_SNAKE = { supported_interfaces: "supportedInterfaces", documentation_url: "documentationUrl", icon_url: "iconUrl", protocol_binding: "protocolBinding", protocol_version: "protocolVersion", push_notifications: "pushNotifications", extended_agent_card: "extendedAgentCard", default_input_modes: "defaultInputModes", default_output_modes: "defaultOutputModes", input_modes: "inputModes", output_modes: "outputModes", security_schemes: "securitySchemes", security_requirements: "securityRequirements" };
// proto3 の JSON 写し(ts-proto toJSON、公式 SDK が使う物)の規則、実測で確かめた分:
//   string は "" を省く(REQUIRED でも)。bool(非 optional、AgentExtension.required)は false を省く。
//   optional bool(streaming / pushNotifications / extendedAgentCard)は true も false も、書いてあれば残す。
//   message は空になったら省く(capabilities: {} は消える)。repeated は空なら省く。
//   Struct(params)は再帰的に null / "" / {} / [] を落とし、false と 0 は残し、数は JS の数の書き方(1e+21、-0 は 0)。
function pruneStruct(v) {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "string") return v === "" ? undefined : v;
  if (typeof v === "number") return Number.isFinite(v) ? (v === 0 ? 0 : v) : undefined;
  if (typeof v === "boolean") return v;
  if (Array.isArray(v)) { const out = v.map(pruneStruct).filter((x) => x !== undefined); return out.length ? out : undefined; }
  if (typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v)) { const x = pruneStruct(v[k]); if (x !== undefined) out[k] = x; }
    return Object.keys(out).length ? out : undefined;
  }
  return undefined;
}
function cardProject(value, schema, problems) {
  if (schema === "unsupported") { if (value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0) && !(typeof value === "object" && Object.keys(value).length === 0)) problems.push("field not supported by this verifier"); return undefined; }
  if (schema === "string") { if (typeof value !== "string" || value === "") return undefined; return value; }
  if (schema === "bool") { return value === true ? true : undefined; }
  if (schema === "obool") { return typeof value === "boolean" ? value : undefined; }
  if (schema === "struct") { if (!value || typeof value !== "object" || Array.isArray(value)) return undefined; return pruneStruct(value); }
  if (schema.kind === "repeated") {
    if (!Array.isArray(value) || value.length === 0) return undefined;
    const out = value.map((v) => cardProject(v, schema.of, problems)).filter((v) => v !== undefined);
    return out.length ? out : undefined;
  }
  if (schema.kind === "message") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const out = {};
    for (const rawKey of Object.keys(value)) {
      const key = CARD_SNAKE[rawKey] || rawKey;
      const f = schema.fields[key];
      if (!f) continue;
      const v = cardProject(value[rawKey], f, problems);
      if (v !== undefined) out[key] = v;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return undefined;
}
function jcs(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(jcs).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}";
}
export function cardSignatureCanonical(card) {
  const problems = [];
  const bare = Object.assign({}, card); delete bare.signatures;
  const projected = cardProject(bare, CARD_SCHEMA, problems) || {};
  return { canonical: jcs(projected), unsupported: problems.length ? problems : null };
}
function b64urlToBytes(s) {
  const b = String(s).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b + "===".slice((b.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64url(bytes) {
  let bin = ""; for (const x of bytes) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function verifyCardSignatures(card, origin) {
  const sigs = Array.isArray(card && card.signatures) ? card.signatures : [];
  if (!sigs.length) return { present: 0, verified: null, reason: "card carries no signatures (A2A 1.0 §8.4 is optional)" };
  const { canonical, unsupported } = cardSignatureCanonical(card);
  if (unsupported) return { present: sigs.length, verified: null, reason: "unverifiable by this gate: " + unsupported[0] + " (security schemes are not modelled here; nothing is said about validity)" };
  const canonical_sha256 = await sha256hex(canonical);
  const payloadB64 = bytesToB64url(new TextEncoder().encode(canonical));
  const results = [];
  for (const sig of sigs.slice(0, 3)) {
    const r = { kid: null, jku: null, alg: null, verified: null, reason: null };
    try {
      if (!sig || typeof sig.protected !== "string" || typeof sig.signature !== "string") throw Object.assign(new Error("signature entry is not {protected, signature}"), { soft: true });
      const hdr = JSON.parse(new TextDecoder().decode(b64urlToBytes(sig.protected)));
      r.alg = hdr.alg || null; r.kid = typeof hdr.kid === "string" ? hdr.kid : null; r.jku = typeof hdr.jku === "string" ? hdr.jku : (origin + "/.well-known/jwks.json");
      if (hdr.alg !== "ES256") { r.reason = "alg " + String(hdr.alg) + " not supported by this gate (ES256 only)"; results.push(r); continue; }
      if (!r.kid) { r.reason = "protected header has no kid"; r.verified = false; results.push(r); continue; }
      if (!/^https:\/\//.test(r.jku)) { r.reason = "jku is not https"; r.verified = false; results.push(r); continue; }
      r.jku_same_host = new URL(r.jku).host === new URL(origin).host;
      const res = await withTimeout(probeFetch(r.jku), CONFIG.timeout_ms);
      if (!res.ok) { r.reason = "jwks not readable (http " + res.status + ")"; results.push(r); continue; }
      let jwks; try { jwks = await res.json(); } catch (_e) { r.reason = "jwks is not JSON"; results.push(r); continue; }
      const key = (jwks && Array.isArray(jwks.keys) ? jwks.keys : []).find((k) => k && k.kid === r.kid);
      if (!key) { r.reason = "kid not found in jwks"; r.verified = false; results.push(r); continue; }
      if (key.kty !== "EC" || key.crv !== "P-256" || typeof key.x !== "string" || typeof key.y !== "string") { r.reason = "jwk is not an EC P-256 public key"; r.verified = false; results.push(r); continue; }
      const pub = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: key.x, y: key.y }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
      const data = new TextEncoder().encode(sig.protected + "." + payloadB64);
      const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, b64urlToBytes(sig.signature), data);
      r.verified = !!ok;
      r.reason = ok ? "signature verifies over the RFC 8785 canonical card (schema fields only; fields outside the A2A 1.0 schema are not covered)" : "signature does not verify: the card was changed after signing, or was signed over a different canonical form";
    } catch (e) {
      if (e && e.soft) { r.verified = false; r.reason = e.message; }
      else if (/gate-side failure/.test(String(e && e.message))) { r.reason = "not measured: " + e.message; }
      else { r.reason = "jwks fetch failed: " + String(e && e.message || e); }
    }
    results.push(r);
  }
  const anyTrue = results.some((x) => x.verified === true);
  const anyFalse = results.some((x) => x.verified === false);
  return { present: sigs.length, verified: anyTrue ? true : (anyFalse ? false : null), canonical_sha256, signatures: results };
}

// ---- 条件3. 報酬構造の開示 ----
// 内容は審査しない。開示していないという選択肢だけを消す。
const PAID_BY = ["buyer", "seller", "referral", "advertising", "subscription", "public", "other"];

function checkCompensation(card) {
  if (!card) return { pass: false, reason: "no agent-card, cannot read compensation", detail: {} };
  // 0.3.2. 置き場所は二つ: top-level の compensation と、capabilities.extensions[uri = CONDUCT_EXT_URI].params.compensation。
  // どちらか一つが整っていれば通す。両方あれば 5 鍵が一致せねばならん。無ければ落ちる(0.2.0 以来変わらず)。
  const expected_shape = { paid_by: PAID_BY, referral_fee: "boolean", listing_fee: "boolean", success_fee_pct: "number", disclosure_url: "string" };
  const locations = ["compensation", "capabilities.extensions[uri=" + CONDUCT_EXT_URI + "].params.compensation"];
  const decls = [];
  if (card.compensation !== undefined) decls.push({ where: "top_level", c: card.compensation });
  for (const e of conductExtDeclarations(card)) {
    const p = e.params && typeof e.params === "object" && !Array.isArray(e.params) ? e.params : null;
    decls.push({ where: "extension", c: p ? p.compensation : undefined });
  }
  if (!decls.length) {
    return {
      pass: false,
      reason: "compensation block not declared in agent-card (neither location)",
      detail: { expected_shape, locations }
    };
  }
  for (const d of decls) {
    if (!d.c || typeof d.c !== "object" || Array.isArray(d.c)) {
      return { pass: false, reason: "compensation block at " + d.where + " is not an object", detail: { expected_shape, locations, location: d.where } };
    }
  }
  const c = decls[0].c;
  for (const d of decls.slice(1)) {
    if (!compensationEqual(c, d.c)) {
      return { pass: false, reason: "two compensation declarations disagree (" + decls[0].where + " vs " + d.where + "): a disclosure that says two things is not a disclosure", detail: { locations, declared_at: decls.map((x) => x.where) } };
    }
  }
  const location = decls.every((d) => d.where === decls[0].where) ? decls[0].where : "both";
  if (!PAID_BY.includes(c.paid_by)) {
    return { pass: false, reason: "compensation.paid_by must be one of: " + PAID_BY.join(", "), detail: { got: c.paid_by } };
  }
  if (typeof c.referral_fee !== "boolean" || typeof c.listing_fee !== "boolean") {
    return { pass: false, reason: "compensation.referral_fee and listing_fee must be boolean", detail: {} };
  }
  // 0.2.2. 宣言するなら機械可読な型で。旧実装は success_fee_pct:"see website" を黙って null にして通し、
  // 開示していないのと同じ記録を verified に載せていた(redteam: comp_success_fee_string / _nan / _out_of_range /
  // comp_disclosure_url_object)。内容は審査しない。形だけを見る。
  if (c.success_fee_pct !== undefined && (typeof c.success_fee_pct !== "number" || !Number.isFinite(c.success_fee_pct) || c.success_fee_pct < 0 || c.success_fee_pct > 100)) {
    return { pass: false, reason: "compensation.success_fee_pct, when declared, must be a number between 0 and 100", detail: { got: c.success_fee_pct === undefined ? null : c.success_fee_pct } };
  }
  if (c.disclosure_url !== undefined && c.disclosure_url !== null && typeof c.disclosure_url !== "string") {
    return { pass: false, reason: "compensation.disclosure_url, when declared, must be a string", detail: {} };
  }
  const detail = {
    paid_by: c.paid_by,
    referral_fee: c.referral_fee,
    listing_fee: c.listing_fee,
    success_fee_pct: typeof c.success_fee_pct === "number" ? c.success_fee_pct : null,
    disclosure_url: c.disclosure_url || null
  };
  // 自己矛盾は合否を変えない(内容は審査しないという約束)。ただし読者に見えるように書く。
  if (c.paid_by === "referral" && c.referral_fee === false) {
    detail.consistency_note = "paid_by is referral while referral_fee is false: the declaration contradicts itself. Not judged here; published so a reader can see it.";
  }
  detail.location = location;
  return {
    pass: true,
    reason: "compensation structure declared",
    detail: detail
  };
}

// ---- 条件4. 数値主張の再計算可能性(決定論性) ----
// 同じ入力を複数回投げ、返る内容が一致するかを実測する。
async function checkDeterminism(endpoint, toolNames, allowToolCall, coord) {
  // 0.2.2. 引数は「呼べるツール名の配列」。旧実装は先頭1本の名前だった。
  const names = Array.isArray(toolNames) ? toolNames.filter((n) => typeof n === "string" && n) : (toolNames ? [toolNames] : []);
  const toolName = names[0] || null;
  // 既定ではツールを呼ばない。決定論性を測るには相手のツールを実行する必要があり、
  // 先頭のツールが破壊的な操作である可能性がある。所有者の明示的な同意なしには触らない。
  if (!allowToolCall) {
    return {
      pass: false,
      measured: false,
      reason:
        "not measured: measuring determinism requires calling one of your tools, and this gate " +
        "does not call tools on a server without the owner's consent. The first tool listed may " +
        "be destructive. To have this condition measured, re-run with allow_tool_call set to true " +
        "from a request you control.",
      detail: {
        consent_required: true,
        how_to_measure: 'POST /check {"endpoint":"https://your-server/mcp","allow_tool_call":true}',
        tool_that_would_be_called: toolName || null
      }
    };
  }
  if (!toolName) return { pass: false, reason: "no tool available to test", detail: {} };
  // 0.2.2. error 応答(JSON-RPC error / result.isError:true)を2回受け取って「同一」と数えていた
  // (redteam: determinism_error_echo / determinism_isError_echo)。引数不足のエラーを2回返すだけの相手が
  // verified になる。error は出力ではない。測定にならない。別のツールを最大 determinism_tool_tries 本まで試し、
  // どれも error なら「測れなかった」と書く(pending)。測ったのが N本中1本であることと選び方も開示する。
  const tried = [];
  // 0.3.0. 順番を決めるのが server やった間、server は自分の一番ええ tool を先頭に置けた。
  // 導出できる窓では、辞書順に並べた集合から扉が導いた順に測る。並べ替えでは steer できん。
  let order = names, selection;
  if (coord && coord.derived) {
    try { order = await nenrin.toolOrder(coord.seed, endpoint, coord.window_id, names); } catch (e) { order = names; }
    selection = "derived: the tool order is HMAC-SHA256 derived over the lexicographically sorted tool names, keyed by a salt the gate committed to before this window and bound to a Bitcoin block. The server cannot steer the pick by reordering its own tools/list. Up to " +
      CONFIG.determinism_tool_tries + " tools are tried in that derived order.";
  } else {
    selection = "first well-formed tool (in the server's own tools/list order) that answers empty arguments without an error; up to " +
      CONFIG.determinism_tool_tries + " tools are tried. The server chooses its own order, so this measures one tool the server put first, not the whole surface.";
  }
  const candidates = order.slice(0, CONFIG.determinism_tool_tries);
  for (const name of candidates) {
    const outs = [];
    let errored = null;
    for (let i = 0; i < CONFIG.determinism_runs; i++) {
      let r;
      try {
        r = await rpcCall(endpoint, "tools/call", { name: name, arguments: {} });
      } catch (e) {
        return { pass: false, reason: "tools/call failed: " + e.message, detail: { tool: name, tried: tried } };
      }
      if (r && r.error) { errored = "JSON-RPC error: " + String((r.error && r.error.message) || JSON.stringify(r.error)).slice(0, 60); break; }
      if (r && r.result && r.result.isError === true) { errored = "result.isError true"; break; }
      outs.push(JSON.stringify((r && r.result && r.result.content) || r));
    }
    if (errored) { tried.push({ tool: name, outcome: "error response, not a measurement (" + errored + ")" }); continue; }
    const same = outs.every((o) => o === outs[0]);
    tried.push({ tool: name, outcome: same ? "identical across " + CONFIG.determinism_runs + " runs" : "output changed between runs" });
    return {
      pass: same,
      reason: same
        ? "identical input returned identical output across " + CONFIG.determinism_runs + " runs"
        : "output changed between identical runs (not usable as a fixed reference)",
      detail: { tool: name, runs: CONFIG.determinism_runs, identical: same, tried: tried,
        tools_measured: 1, tools_unmeasured: Math.max(0, names.length - 1), selection: selection }
    };
  }
  return {
    pass: false,
    measured: false,
    reason: "not measured: every tool tried (" + tried.length + " of " + names.length + ") answered empty arguments with an error, so there was no output to compare. An error echo is not a measurement of determinism.",
    detail: { tried: tried, tools_measured: 0, tools_unmeasured: names.length, selection: selection }
  };
}

// ---- 判定の組み立て ----
async function runCheck(endpoint, allowToolCall, consentBasis, consentSource, consentLookup, coord) {
  const started = new Date().toISOString();
  const results = {};

  results.mcp_endpoint = await checkMcp(endpoint);
  const cardRes = await checkAgentCard(endpoint);
  results.agent_card = { pass: cardRes.pass, transport: cardRes.transport === true, ...(cardRes.gate_side === true ? { gate_side: true, measured: false } : {}), reason: cardRes.reason, detail: cardRes.detail };
  // カードが「取れなかった」のが中継故障なら、開示の有無も分かっていない。落ちた顔をさせない。
  results.compensation_disclosure = cardRes.gate_side === true
    ? { pass: false, gate_side: true, measured: false, reason: "not measured: the agent card could not be fetched because the gate's relay path was unavailable, so whether compensation is disclosed is unknown" }
    : checkCompensation(cardRes.card);

  // 0.2.2. 決定論性は「呼べるツール」の列から測る(殻のツールは除外済み)。
  const firstTool = results.mcp_endpoint.detail && Array.isArray(results.mcp_endpoint.detail.callable_tools)
    ? results.mcp_endpoint.detail.callable_tools
    : (results.mcp_endpoint.detail && results.mcp_endpoint.detail.tools ? results.mcp_endpoint.detail.tools.slice(0, 1) : null);
  // 2026-08-19 patch52. MCPが測れていないなら、ツールが無いのではなく見ていない。
  // "no tool available to test" は、探した上で無かったときの文言。
  // 探していないのに無いと書くのは、8/19 に verify-event の tags で直したのと同じ形。
  results.determinism = results.mcp_endpoint.gate_side === true
    ? { pass: false, gate_side: true, measured: false, reason: "not measured: the tool list could not be read because the gate's relay path was unavailable, so there was nothing to test determinism against" }
    : await checkDeterminism(endpoint, firstTool, allowToolCall === true, coord);

  const passed = Object.values(results).every((r) => r.pass);
  // gate-side = こちらの測定装置の故障。unreachable(相手に届かない)と混ぜない。
  const gateSide = Object.values(results).some((r) => r && r.gate_side === true);
  // 「届かなかった」と「届いた上で条件を満たさない」は別の事実。
  // fail-closed は変えない。緑にはしない。ただし理由の書き分けはする。
  const unreachable = Object.values(results).some((r) => r && r.transport === true);

  const record = {
    gate: "MCP Verification Gate",
    gate_version: CONFIG.version,
    gate_commit: gateCommit(),
    endpoint: endpoint,
    checked_at: started,
    reachable: gateSide ? null : !unreachable,
    status: passed ? CONFIG.tier_pass : ((unreachable || gateSide) ? CONFIG.tier_held : CONFIG.tier_fail),
    scope_note:
      "This gate verifies conformance and disclosure only. It does NOT verify that any price " +
      "or figure returned by the server is correct. Price validation is a separate, paid tier " +
      "and is currently available for Japanese construction only. By default this gate calls no " +
      "tools on the server being checked, so determinism is reported as not measured rather than " +
      "guessed. Send allow_tool_call true to have it measured on a server you control.",
    tools_called: allowToolCall === true ? "one tool, twice, with empty arguments, by consent" : "none",
    // 0.3.0. 測る日と測る tool をどう決めたか。全部が扉の導いた出力で、対象が渡した入力は 1 つも無い。
    // 導出できんかった窓は derived:false と、旧規則に落ちたことを書く。黙って落ちん。
    coordinate_derivation: await nenrin.derivationBlock(coord, endpoint, firstTool || []),
    // 0.2.2. 同意の根拠を判定に載せる。/check の allow_tool_call は要求者の申告であって、所有者の証明ではない。
    consent_basis: allowToolCall === true
      ? (consentBasis || "asserted by the requester via allow_tool_call; not proven to be the owner")
      : "no consent given; no tool was called",
    // 0.2.4. 同意の出どころ。operator_list(扉のソース、公開)/ well_known(origin のファイル、所有の証明)/
    // requester(申告、証明ではない)/ none。掃引に使えるのは前の 2 つだけ。
    consent_source: allowToolCall === true ? (consentSource || "requester") : "none",
    ...(consentLookup && consentLookup.consent !== true ? {
      consent_lookup: {
        well_known: consentLookup.url || null,
        result: consentLookup.reason || null,
        how_to_consent: "Publish " + CONSENT_WELL_KNOWN_PATH + " on the origin with {\"allow_tool_call\": true} (optionally \"endpoints\": [exact endpoint URLs]). " +
          "Only the owner of the origin can place a file there, so the gate treats it as consent, measures determinism on the register with it, and records where it read it."
      }
    } : {}),
    probed_via: probeVia(endpoint),
    ...(gateSide ? {
      measurement_note:
        "This measurement did not happen. The gate's own relay path was unavailable, so nothing in " +
        "this record says anything about the target. reachable is null rather than false for exactly " +
        "that reason: an instrument failure is not a statement about the thing it failed to measure."
    } : {}),
    checks: results
  };

  // 条件06 は合否ではなく開示測定。checks の外に置く(passed に触れない)。sha を取る前に
  // 挿入するので、新しい verdict はこの値ごと自己整合し、verify_verdict でも一致する。
  const _avf = record.checks.mcp_endpoint && record.checks.mcp_endpoint.detail
    ? record.checks.mcp_endpoint.detail.absence_vs_failure : null;
  if (_avf) {
    delete record.checks.mcp_endpoint.detail.absence_vs_failure;
    record.absence_vs_failure = _avf;
  } else {
    record.absence_vs_failure = {
      condition: "06",
      measured: false,
      reason: "the tool list could not be read, so the contract was not measured. This is NOT a statement that the server cannot distinguish the two ,  only that the gate did not see."
    };
  }

  // 条件07 正規化適合。これも合否ではなく開示測定で、checks の外に置く(passed に触れない)。
  // 2026-08-23、実装より先に「この条件で行が赤くなることはない」と公開した。約束が先にあるので守る。
  // 測っているのは相手の行儀ではなく、我々以外の誰かがこの表面を検算できるかどうか。
  // 正規化できない表面には第三者が再現できる指紋が無く、黙って書き換えられても作った本人以外は気づけない。
  const _surf = record.checks.mcp_endpoint && record.checks.mcp_endpoint.detail
    ? record.checks.mcp_endpoint.detail.surface : null;
  if (_surf) {
    const refused = _surf.canonicalization === "refused";
    record.canonicalization = {
      condition: "07",
      question: "Can an independent party recompute the fingerprint of this server's declared surface, byte for byte, without us?",
      method: "RFC 8785 (JCS). The tool manifest from tools/list is canonicalized and hashed. Nothing is executed, and nothing about the content is judged.",
      measured: true,
      canonicalizable: !refused,
      scheme: _surf.canonicalization || null,
      unsafe_integer_scan: _surf.unsafe_integer_scan || null,
      verdict: null,
      verdict_note:
        "A disclosed measurement, not a pass or fail. It never turns a row red. This gate published that " +
        "promise on 2026-08-23, before the condition was implemented, and is keeping it.",
      gate_self_conformance: {
        vectors: 13,
        passing: 13,
        measured_at: "2026-08-23",
        measured_against: "npm canonicalize@2.0.0, an independent RFC 8785 implementation",
        first_result: "11 of 12 before the fix. The vector we failed produced a hash over a value we had silently altered.",
        published: CONFORMANCE_URL
      },
      retracted_limitation:
        "On the morning of 2026-08-23 this gate published, here and on its own site, that an integer past " +
        "2^53 is rounded inside JSON.parse before the gate can see it and that the case was therefore " +
        "undetectable in JavaScript. That was wrong, and it was wrong in the comfortable direction: it " +
        "excused us. The source text is available to a JSON.parse reviver, so the rounding is detectable " +
        "after all. It is now detected, and a surface carrying such a literal has its fingerprint withheld " +
        "rather than published. The false claim is left on the record instead of being deleted."
    };
    if (refused) record.canonicalization.refusal_note = _surf.canonicalization_note || null;
  } else {
    record.canonicalization = {
      condition: "07",
      measured: false,
      reason:
        "the tool list could not be read, so there was no declared surface to canonicalize. This is NOT a " +
        "statement that the surface cannot be canonicalized, only that the gate did not see it."
    };
  }

  // 0.4.0 (2026-09-07). 判定が「何を証明して、何を証明しとらんか」を、散文やなく欄で持つ。
  // 証人記録(conduct-v1.1)に同じ欄を必須にした日に、運営者の判定にも同じ欄を入れる。運営者は例外やなく被験者。
  // sha を取る前に入れるので、この 2 欄は再計算の対象であって、後から書き換えられん。
  Object.assign(record, gateDisclaimers(record));

  // 0.4.2. 数値の安全性を、hash を取る前に、記録そのものから測って記録に入れる。
  // 欄は数値を持たんので、入れた後に測り直しても同じ答えになる(不動点)。試験がそれを見張る。
  record.number_safety = numberSafety(record);

  // 条件5. 判定自体が再計算可能であること
  const canonical = JSON.stringify(record);
  record.record_sha256 = await sha256hex(canonical);
  record.recompute_note = RECOMPUTE_NOTE +
    " This gate holds itself to the same standard it applies to applicants.";
  // 0.4.1. hash を取ったバイトそのものを、見えん性質(non-enumerable)で持たせる。JSON.stringify には出ん。
  // 掃引の recordHistory がこれを KV に保存して GET /record/<sha> で配る。再直列化は挟まん。
  try { Object.defineProperty(record, "__canonical", { value: canonical, enumerable: false, writable: false, configurable: true }); } catch (_e) {}

  return record;
}

// 0.4.0. 判定の establishes / does_not_establish。記録そのものから組む(申告は 1 つも使わん)。
// 文は固定の語彙で、同じ記録からは同じ配列が出る。輪と台帳と証人記録に同じ欄がある。
function gateDisclaimers(record) {
  const checks = (record && record.checks) || {};
  const names = Object.keys(checks).sort();
  const passed = names.filter((k) => checks[k] && checks[k].pass === true);
  const failed = names.filter((k) => checks[k] && checks[k].pass !== true && checks[k].measured !== false && checks[k].transport !== true);
  const unmeasured = names.filter((k) => checks[k] && checks[k].measured === false);
  const transport = names.filter((k) => checks[k] && checks[k].transport === true);
  const est = [
    "at " + record.checked_at + " this gate (commit " + record.gate_commit + ", version " + record.gate_version + ") measured " + record.endpoint + " and recorded status " + record.status,
    "conditions passed: " + (passed.length ? passed.join(", ") : "none") + "; conditions failed: " + (failed.length ? failed.join(", ") : "none"),
    "every hash in this record recomputes from the bytes it names, and record_sha256 recomputes from this record with record_sha256 and recompute_note removed"
  ];
  if (record.coordinate_derivation && record.coordinate_derivation.derived === true) {
    est.push("the measurement instant and the tool measured were derived from a committed salt and a Bitcoin block the subject did not choose (coordinate_derivation)");
  }
  const dne = [
    "correctness of any price, figure or answer the server returns",
    "truth of the compensation declaration; only its presence and shape are measured",
    "quality, competence or fitness of the operator or the service",
    "behaviour at instants not measured or from vantages this gate did not use"
  ];
  if (unmeasured.length) dne.push("conditions not measured on this instant: " + unmeasured.join(", ") + " (unmeasured is not failed)");
  if (transport.length) dne.push("anything about the target for conditions the gate's own transport failed on: " + transport.join(", "));
  if (!(record.coordinate_derivation && record.coordinate_derivation.derived === true)) {
    dne.push("that the measurement instant was unpredictable to the subject (coordinate not derived on this instant; the legacy computable schedule applied and is disclosed)");
  }
  return { establishes: est, does_not_establish: dne };
}

// ---- 仕様(機械可読) ----
function spec() {
  return {
    gate: "MCP Verification Gate",
    version: CONFIG.version,
    gate_commit: gateCommit(),
    what_this_verifies: [
      "The server actually exists and speaks MCP",
      "The server publishes an A2A agent card",
      "The server declares who pays it",
      "Identical input returns identical output",
      "This gate's own verdict can be recomputed by anyone"
    ],
    what_this_does_not_verify: [
      "Whether prices or figures returned by the server are correct",
      "Whether the declared compensation structure is truthful (it is published and recorded; false declarations are grounds for revocation)",
      "Quality, competence, or fitness of the underlying business"
    ],
    conditions: {
      mcp_endpoint: "POST /mcp responds to initialize (with a result, not an error) and tools/list with at least one well-formed tool: a non-empty string name and an inputSchema object. Hollow tools are not counted, duplicate names fail, and a tools value that is not an array fails (0.2.2).",
      agent_card: "GET /.well-known/agent-card.json returns a JSON object whose name and description are non-empty strings. Redirects are followed only within the same origin; a redirect to another origin is not a card at this origin (0.2.2).",
      compensation_disclosure: {
        location: "agent-card, top-level key 'compensation', or (0.3.2) the capabilities.extensions[] entry whose uri is " + CONDUCT_EXT_URI + ", key params.compensation. One well-formed declaration passes. When both are present they must be equal on the five keys, or the condition fails.",
        shape: {
          paid_by: PAID_BY,
          referral_fee: "boolean, required",
          listing_fee: "boolean, required",
          success_fee_pct: "number between 0 and 100, optional; declared with any other type or range, the condition fails (0.2.2)",
          disclosure_url: "string, optional; declared with any other type, the condition fails (0.2.2)"
        },
        note: "Content is not judged. Only the absence of disclosure disqualifies. A self-contradicting declaration (paid_by referral with referral_fee false) still passes and is published with a consistency_note (0.2.2)."
      },
      determinism: "Calling the same tool with the same arguments returns identical content across runs. NOT measured by default: doing so requires executing a tool on the checked server, which this gate will not do without the owner's consent. Consent comes from the owner: a file at /.well-known/mcp-conduct.json on the server's own origin (see well_known_consent below), which is the only basis the scheduled sweep accepts. A requester may assert allow_tool_call on a one-off /check, but an assertion is not proof and never becomes the basis for a row on the public register (0.2.4). An error response (JSON-RPC error or result.isError) is not a measurement: up to " + CONFIG.determinism_tool_tries + " tools are tried in an order this gate derives (see instant_coordinate below), not the server's own, and the verdict discloses which tool was measured, which were tried, and how many were not measured (0.2.2).",
      self_verification: "Every verdict carries a SHA-256 that any third party can recompute"
    },
    reachability: "Any HTTP status, or a non-JSON body, is an answer from the server: reachable stays true and the row goes pending, not held. Only gateway-shaped statuses (502-504, 52x) and transport failures mean held. Redirects to another origin are treated as answered, not followed (0.2.2).",
    consent: "allow_tool_call on /check is asserted by the requester and is not proof of ownership; every verdict states its consent_basis and consent_source. Rows in the public register are measured with tool calls only with proven consent: the operator's published consent list (0.2.2) or a consent file on the endpoint's own origin (0.2.4).",
    establishes_and_does_not_establish: {
      since: "0.4.0",
      what: "Every verdict (and this gate's own /self record) carries two arrays, establishes and does_not_establish, generated from the measurement itself and included in the bytes that record_sha256 hashes. establishes names what was measured: the instant, the commit, the conditions that passed and failed, the hash recipe and the coordinate. does_not_establish names what a passing verdict never means: that answers are correct, that a compensation declaration is true, quality, safety, other instants, other vantages, conditions not measured on this run.",
      why: "A verdict that only lists what passed can be quoted with its caveats dropped; the quote still verifies against the hash. Found in public on 2026-09-07 by a reader of the A2A extension: the 'not judged correct' disclaimer could be removed from a card and conformance still passed. With the two arrays inside the hashed record, a quote without them no longer recomputes.",
      not_a_rule: "The arrays are text and are not conditions. Nothing passes or fails on them. They are the record refusing to be quoted as more than it is."
    },
    lookup: {
      since: "0.4.0",
      route: "GET /register/lookup?endpoint=<https MCP endpoint>",
      what: "One read before connecting: status (verified / pending / declined / unknown), the latest stored verdict's sha, the last published ring's counts (witnesses signed and unsigned, discrepancies, commitments, walked_as_witness, instants by derivation), where the record and the witness intake are, and what the answer does not establish. Cached 24 hours. No score, no rank.",
      unknown: "means no row here. It is never a finding about the endpoint."
    },
    number_safety: {
      since: "0.4.2 (2026-09-09)",
      where: "a number_safety block inside every verdict and inside the gate's own /self record, so it is covered by record_sha256 and cannot be dropped from a quote",
      what: "Two booleans over two lists, generated from the record. parse_safe: no integer here is outside the RFC 7493 (I-JSON) safe range and no value is non-finite, so nothing was destroyed by JSON.parse before any canonicalization code could run. safe_integers_only: stricter, both lists empty, so a compact re-serialization with the keys in the order printed reproduces these bytes in any language at all. unsafe_integers names the values that break parse_safe; non_integer_numbers names the doubles, which runtimes printing the shortest round trip form agree on and runtimes printing a fixed number of digits do not. A verdict that measured a surface normally carries one double, the percentage in absence_vs_failure, so parse_safe true with safe_integers_only false is the ordinary state.",
      why: "An integer past 2^53 is rounded by JSON.parse before any canonicalization runs, and a non-integer double is printed differently by different runtimes. Prose in a recompute recipe cannot prevent either, because the damage happens before the reader reaches the prose. Found in public on 2026-09-09 by Federico Blanco Sanchez-Llanos from the payments side, in an idempotency key that collapsed two different large amounts into one fingerprint.",
      self_applied: "Condition 07 already refuses to publish a fingerprint for a measured surface carrying such an integer. 0.4.2 asks the same question of this gate's own output. The operator is a subject of the rule, not an exception to it.",
      not_a_rule: "A disclosed measurement. Nothing passes or fails on it and no row turns red.",
      the_block_holds_no_number: "By construction the block contains no numeric value, so adding it to the record cannot change the answer it reports."
    },
    record_bytes: {
      since: "0.4.1 (" + RECORD_BYTES_SINCE + ")",
      route: "GET /record/<record_sha256>",
      what: "The exact bytes that record_sha256 hashes, for every scheduled verdict from that date on: the verdict with record_sha256 and recompute_note removed, stored as the string that was hashed and returned without re-serialization. SHA-256 of the body equals the path. History entries, register rows, /is-verified, /register/lookup and the envelope carry record_url pointing here when the bytes exist.",
      why: "Before this, the sha was published but the bytes were not: scheduled measurements were summarised into history and the record itself was dropped, and recompute_url pointed at /history, whose entries have a different shape. A second implementer (SEP-1913, 2026-09-09) tried 1024 serializations of the /is-verified projection and correctly reported that none reproduced the sha. The fault was on this side: the published reference did not name published bytes. Now it does.",
      not_stored: "On-demand POST /check verdicts are returned to the caller and not stored (storing them would let anyone spend this gate's KV write quota). Verdicts before " + RECORD_BYTES_SINCE + " have no stored bytes; their sha stands as issued but names bytes this gate no longer holds, and the gate says so rather than pointing at a summary.",
      recipe_unchanged: "Remove record_sha256 and recompute_note, JSON.stringify in key order, SHA-256. Unchanged since 0.1. What changed is that the object to apply it to is now published."
    },
    instant_coordinate: {
      since: "0.3.0",
      schema: "nenrin-instant-v1",
      production_departures_found_2026_09_06: "Three departures between this text and the deployed code were found on 2026-09-06 by reading worker.js, nenrin_instant.js, verify_beacons.py and /sweep/last: (1) the derivation block was written into every verdict but dropped from every /history entry, so exports were structurally silent on it; (2) beacon agreement was demanded on a height each source computed from its own tip (tip minus 6), so two honest explorers one block apart never agreed, and the first sweep after 0.3.0 (2026-09-05T18:00Z) fell back to the legacy schedule; (3) the salt was created at the sweep and bound to a block mined about an hour earlier, so the salt did not precede the block. All three are fixed in 0.3.5; entries written before 0.3.5 carry no derivation block and the sweeps of 2026-09-05 ran on the legacy rule. Recorded here rather than removed, in the same spirit as the addendum: the operator is a subject of its own rule.",
      defect: "Time is a coordinate. Until 0.2.4 the free tier's measurement day was sha256(endpoint) mod 7, every input public, so the subject could compute the day it would be measured and a shim answering one day in seven earned a full record at one seventh of the cost. The same defect had a second face: determinism measured the first tool in the server's own tools/list order, and the server chose that order.",
      fix: "The measurement day and the tool order are HMAC-SHA256 derived from a salt this gate creates before each 7 day window opens (0.3.5: at the latest during the previous window's first sweep), bound to a Bitcoin block whose header time is at or after the salt's creation. The subject cannot predict them. The gate cannot choose them after the fact, because the commitment is published at /nenrin/window before the block exists. The tool is chosen over the lexicographically sorted name set, so reordering tools/list steers nothing and renaming moves tool_set_sha256.",
      beacon: "One reference height for every source: the second highest tip among the sources that answered, minus 6 (freshness v3.3's quorum tip; with two sources that is min(tip) minus 6), across the block sources that answered (mempool.space, blockstream.info and, since 0.3.5, mempool.emzy.de; the two mempool instances share a codebase, which is a named residual) (0.3.5; until 0.3.4 each source's own tip minus 6 was compared, which failed whenever the explorers were one block apart). The hash at that height must agree between at least two sources and the block's header time must be at or after salt_created_at, or there is no beacon and the legacy computable schedule is used and said so in the verdict, in the sweep record and at /nenrin/window. The first sweep of a window decides derived or legacy for the whole window, so no row is measured twice or skipped by a mid-window switch. This gate cannot sync headers peer to peer, so it records the height and hash it used: anyone holding the chain can falsify a wrong beacon, permanently.",
      in_every_verdict: "coordinate_derivation, and since 0.3.5 in every /history entry (derived, window_id, salt_commitment, salt_created_at, beacon height, hash and header time, day_in_window, tool_set_sha256, or the fallback with its reason_code)",
      window: "/nenrin/window (current, next and previous window: commitment at creation, pinned rule, beacon, salt revealed once the window has closed); /nenrin/window/{window_id} for one window",
      anchoring: "Since 0.4.0 every sweep files the commitment of the next window (and of the current one, if not yet filed) to the JIDEC witness intake as a conduct-v1.1 commitment record (purpose nenrin-instant-commitment-v1: <window_id>, base = the window's page here, so the ring builder does not count it as a witness of any endpoint). The ledger bundles it into the next daily batch and stamps the batch to Bitcoin, so the block height of that batch bounds the salt's creation from above with no trust in this gate. /nenrin/window shows commitment_filed per window: record sha, ledger URL, and whether it was filed before the window opened. Until 0.3.5 the commitment was only published on this gate's own page, which proved nothing to anyone who does not trust this gate; that gap was written in the addendum as future work and is closed here.",
      addendum: "workers/hs-ledger/nenrin/coordinate-v1/NENRIN_COORDINATE_v1_ADDENDUM_instants_v1.md, sha256 c4929b29b6e9f8f2877cc58e3c2e225542a7fe9a1bf805a02374b96750cf4c9f. The defect was published before the fix was written.",
      red_team: "test/redteam_instant.mjs, 40 vectors, and instant_redteam.py, 17 vectors, against two independent implementations of the same rule; test/sweep_coordinate.test.mjs drives a whole sweep against mock explorers and reads the derivation back from /history, /sweep/last and /nenrin/window.",
      limits: "Derivation is fair only inside the surface the subject declared. A tool never listed is never picked: that set is unknown, not absent. A salt is single use per window. This measures conduct, not quality."
    },
    well_known_consent: {
      since: "0.2.4",
      path: CONSENT_WELL_KNOWN_PATH,
      shape: { allow_tool_call: "boolean true, required; nothing else counts", endpoints: "optional array of exact endpoint URLs; when present, only those endpoints are consented", listing: "optional string, since 0.3.1; the exact value \"decline\" means the owner declines measurement: the scheduled sweep skips the endpoint, the register row records owner_declined with a date, and no verdict is produced while the file says so. Removing the value resumes measurement at the next sweep. Anyone can still add a row; only the origin can decline it.", notify: "optional https URL, since 0.4.0 (conduct-v1.1): after every scheduled measurement the gate POSTs a summary there (event measured, status, record_sha256, what changed, establishes, does_not_establish, links). At most once per hour per endpoint, at most " + NOTIFY_MAX_PER_SWEEP + " per sweep (the rest are recorded as deferred), never from an on-demand /check, never to an IP literal, a local name, or this gate's own hosts. The sweep record carries notify_status per row. Notification changes nothing about the verdict.", identity: "optional https URL, since 0.4.0: where the owner says who they are. Copied into readings as declared; never verified by this gate.", witness_policy: "optional object, since 0.4.0: reciprocal true declares that the owner walks back whoever walks them. A declaration; the ring's walked_as_witness column is the fact." },
      why: "Only the owner of an origin can place a file under its /.well-known/. So the file is proof of consent, where a request field is only an assertion. The gate reads it with the same same-origin rules as the agent card, executes nothing from it, and records in the verdict where and when it read it.",
      effect: "Determinism is measured on /check without asserting allow_tool_call, and on every scheduled measurement of the public register. The verdict of a check without consent names this path under consent_lookup.how_to_consent."
    },
    red_team: "test/redteam_gate.mjs in the public repository attacks this gate with adversarial mock servers (hollow tools, error echoes, cross-origin redirects, malformed cards and disclosures, misclassified reachability). Fail-closed and deterministic. v0.2.1 scored 17 of 48; v0.2.2 scored 48 of 48; v0.2.4 scored 63 of 63 (the added cases being attacks on the well-known consent file: absent, wrong type, HTML, http 500, off-origin redirect, an endpoints list that excludes the endpoint, and two proving that consent never excuses a failed condition); v0.3.2 scored 74 of 74 (eleven cases on the compensation declaration living in capabilities.extensions[].params, including two declarations that disagree); v0.3.4 scores 82 of 82 (eight cases on reading A2A card signatures: verified, edited after signing, unreadable jwks, unknown kid, unsupported alg, foreign jku, malformed entry; none of them changes the verdict, all of them are disclosed). Run it yourself: node test/redteam_gate.mjs. Known residual: determinism is measured on one tool per instant. Since 0.3.0 that tool is chosen by the instant coordinate over the sorted tool-name set whenever the beacon is available, and is the first tool listed only in the legacy fallback; the verdict names which of the two applied (coordinate_derivation), so the choice is disclosed rather than hidden.",
    also_measured_no_verdict: {
      absence_vs_failure: {
        condition: "06",
        question: "Can a consumer tell 'the lookup failed' from 'the lookup found nothing'?",
        source: "Federico Blanco Sanchez-Llanos, \"The Mould, Not the Letter\", 2026-08-20",
        method: "Structural, name-independent: does a tool's declared outputSchema contain a boolean, or an enum with 2+ values, where a read-succeeded / read-failed / nothing-matched state could live. Read from tools/list; nothing is executed.",
        verdict: "none. A disclosed number, not a pass or fail. Nearly all of the field cannot do this, so a threshold would only condemn; and a schema is a declaration, not behaviour. Reported per verdict under the top-level key absence_vs_failure, with the field names that produced each pass so a reader can check the false positives.",
        self_applied: "This gate's own get_conditions tool fails the test ,  it takes no arguments and has no read that can fail ,  and that is left standing rather than papered over."
      },
      canonicalization: {
        condition: "07",
        question: "Can an independent party recompute the fingerprint of this server's declared surface, byte for byte, without us?",
        method: "RFC 8785 (JCS) over the tool manifest from tools/list. Nothing is executed and no content is judged. A surface that cannot be canonicalized has no fingerprint a third party can reproduce, so a silent change to it can only be caught by whoever made it.",
        verdict: "none. A disclosed measurement, not a pass or fail, and it never turns a row red. That promise was published on 2026-08-23, before this condition was implemented.",
        self_applied: "Measured before it was applied to anyone else. This gate's own canonicalizer matched 11 of 12 vectors against an independent RFC 8785 implementation on first measurement; the vector it failed produced a hash over a value it had silently altered. Fixed, and 13 vectors are now pinned as a permanent regression test.",
        unsafe_integers: "Integer literals outside the IEEE-754 safe range are detected from the response source text, not from the parsed number, and a surface carrying one has its fingerprint withheld. RFC 7493, the profile RFC 8785 builds on, excludes them, and a runtime with arbitrary-precision integers would read them as different values, so no cross-language hash over them is reproducible.",
        retracted_limitation: "On the morning of 2026-08-23 this gate published that the case was undetectable in JavaScript. That was wrong, and wrong in the direction that excused us. JSON.parse exposes the source text of each literal to a reviver. Detection was implemented the same day. The false claim is kept on the record rather than deleted.",
        vectors: CONFORMANCE_URL
      }
    },
    tiers: {
      [CONFIG.tier_pass]: "Free. Conformance and disclosure verified. No price validation.",
      "verified_plus_data": "Paid. Figures traced to a third-party obtainable primary source.",
      "yakumo_partner": "Paid. Dedicated MCP server, operations, audit log."
    },
    operator: "The HORIZONs Co., Ltd. / HORIZON SHIELD",
    self_applied: "This gate is itself subject to these conditions."
  };
}

// ---- 公開履歴と自動再測定 ----
// 「測定が変われば緑ではなくなる」と公開ページに書いた以上、誰かが測り直さねばならない。
// ここがその実装。記録するのは公開判定のみで、申請者の秘密も顧客データも持たない。

// KV が無い環境でも動く。履歴が無効になるだけで、判定機能そのものは影響を受けない。
// 2026-09-05. 30 では 31 日の月を 1 か月分も持てん。年輪(nenrin-ring-v1)の原料は /history で、
// 原料が 30 件で押し出されるなら、8 月の輪は 9 月 8 日以降に二度と作れんかった。400 は日次で 1 年強。
// KV は耐久記録やない。耐久記録は mcp-conduct-register に日次で archive する history/ の方。
const HISTORY_MAX = 400;  // 1エンドポイントあたりの保持件数(2026-09-05 まで 30)
const CHANGES_MAX = 50;   // 変化ログの保持件数

// ---- 監視レジストリと通知 ----
// 判定は無料と有料で完全に同一。値段が付くのは「測る頻度」と「変化を知らされるか」だけ。
// 判定そのものを売った時点で中立性が死ぬので、そこには決して値段を付けない。
const REGISTRY_KEY = "watch:registry";
const REMOVED_KEY = "watch:removed";   // 0.3.1. 外した行の墓標。外した事実は公開する。
const REGISTRY_MAX = 500;
const MAX_PER_SWEEP = 8;         // 1本あたり 1(init)+1〜3(tools/list)+1(card)+1(jwks、署名付き card)+2(tools/call、同意あり)= 6 が普通。8×6=48。予算の実測は sweepBudget(下)
// 0.3.0 で 9 から 8 に下げた。窓の初回だけ beacon の取得が +4 乗る(tip 2 源 + block 2 源)。
// 9 のままやと 45+4=49 で余白 1 になり、endpoint が 1 つ余計に redirect しただけで掃引が死ぬ。
// 溢れた分は skipped に "over MAX_PER_SWEEP" として必ず記録される。黙って切らん。
// 0.4.0 の足し算: 窓の初回に commitment の filing +2(beacon と同じ日)。外部の行は well-known +1 で 6。
// notify は 1 掃引 NOTIFY_MAX_PER_SWEEP 本まで(溢れた行は notify_status に deferred と書く)。
const FREE_INTERVAL_DAYS = 7;    // 無料層は週1回
const NOTIFY_TIMEOUT_MS = 5000;
const NOTIFY_MAX_PER_SWEEP = 3;

async function readRegistry(env) {
  if (!env || !env.HS_VERIFY_KV) return {};
  try { return (await env.HS_VERIFY_KV.get(REGISTRY_KEY, "json")) || {}; }
  catch (_e) { return {}; }
}

// 0.3.1. 断った/撤回した事実を登録簿の行に書く。変わった時だけ書く(KV の書き込みは掃引ごとに 8 回で足りる)。
async function markDeclined(env, endpoint, declined) {
  const reg = await readRegistry(env);
  const row = reg[endpoint];
  if (!row) return;
  const was = !!row.owner_declined_at;
  if (declined === was) return;
  if (declined) row.owner_declined_at = new Date().toISOString();
  else { row.owner_declined_withdrawn_at = new Date().toISOString(); delete row.owner_declined_at; }
  await writeRegistry(env, reg);
}

// 0.4.0. 所有者が consent file に書いた identity / witness_policy を登録簿の行に写す(宣言であって判定やない)。
// 変わった時だけ書く。notify の URL は写さん(他人の webhook を公開する理由が無い。置いてある事実だけ)。
async function markDeclared(env, endpoint, declared) {
  const reg = await readRegistry(env);
  const row = reg[endpoint];
  if (!row) return;
  const next = declared ? {
    identity: declared.identity && declared.identity.ref ? { kind: declared.identity.kind, ref: declared.identity.ref } : null,
    witness_policy: declared.witness_policy && declared.witness_policy.reciprocal != null ? { reciprocal: declared.witness_policy.reciprocal } : null,
    notify_present: !!(declared.notify && declared.notify.url)
  } : null;
  const cur = row.declared || null;
  if (JSON.stringify(cur) === JSON.stringify(next)) return;
  if (next) { row.declared = next; row.declared_read_at = new Date().toISOString(); }
  else { delete row.declared; delete row.declared_read_at; }
  await writeRegistry(env, reg);
}

async function readRemoved(env) {
  if (!env || !env.HS_VERIFY_KV) return [];
  try { return (await env.HS_VERIFY_KV.get(REMOVED_KEY, "json")) || []; } catch (_e) { return []; }
}

async function writeRegistry(env, reg) {
  if (!env || !env.HS_VERIFY_KV) return false;
  try { await env.HS_VERIFY_KV.put(REGISTRY_KEY, JSON.stringify(reg)); return true; }
  catch (_e) { return false; }
}

async function readSweepLast(env) {
  if (!env || !env.HS_VERIFY_KV) {
    return { ran: false, note: "History storage is not bound on this deployment." };
  }
  try {
    const v = await env.HS_VERIFY_KV.get("sweep:last", "json");
    if (v) return v;
  } catch (_e) {}
  return { ran: false, note: "No sweep has completed yet. If the cron is registered, the first run happens at 18:00 UTC." };
}

// 公開の登録簿。watchlist と既存の hist:* を読むだけで、何も測らず、何も保存しない。
// webhook は通知の宛先であって公開情報ではないので、決して出さない。
// 未掲載は不合格ではない。ここで測られたことが無い、それだけを意味する。
// ツール呼び出しの同意。所有者が明示的に依頼したエンドポイントだけをここに入れる。
// determinism は所有者のツールを2回呼ばないと測れず、同意のない呼び出しは絶対にしない。
// だから同意のないサーバーは determinism が not measured のままになり、verified には届かない。
// それは不合格ではなく、測っていないという意味であり、register の応答でもそう説明する。
// 追加は運営者の手作業。所有者からの依頼が無い限り足さない。勝手に足せる経路は用意しない。
const TOOL_CALL_CONSENT = new Set([
  "https://mcp.horizonshield.dev/mcp",
  "https://web.horizonshield.dev/mcp",
  "https://hearing.horizonshield.dev/mcp",
  "https://jidec.horizonshield.dev/mcp",
  "https://gate.horizonshield.dev/mcp",
  // p002 ミネオトーヨー住器。所有者同意 2026-08-18 19:51 LINE「測って下さい。」
  "https://p002.horizonshield.dev/mcp",
  // femtech.horizonshield.dev フェム情報源レジストリ。所有者は我々自身なので同意は自明。
  "https://femtech.horizonshield.dev/mcp",
  // 自前の試験標的。所有者は我々自身なので同意は自明。
  "https://gate.horizonshield.dev/testbed/i-json/mcp"
]);

// 0.2.4. 同意の機械的な証明。上の Set は「所有者からの依頼を待って手で足す」道で、外の運営者には遠すぎた。
// 2026-09-04、GitHub Action(mcp-conduct-action)を作って分かった: 外の行は /check で verified を取っても、
// 登録簿の掃引が tool を呼ばんから pending 止まりで、バッジは緑にならん。申告(allow_tool_call)は所有の証明
// ではないので掃引には使えん。所有の証明になる場所が 1 つある: origin の /.well-known/ 配下。そこに
// {"allow_tool_call": true} を置けるのは origin の所有者だけ。置けた事実が同意であり、申告ではない。
// 読むだけで何も実行しない。取れなければ同意無し(fail-closed)。取れなかった理由は判定に刻む。
const CONSENT_WELL_KNOWN_PATH = "/.well-known/mcp-conduct.json";

async function wellKnownConsent(endpoint) {
  const url = new URL(endpoint).origin + CONSENT_WELL_KNOWN_PATH;
  try {
    const res = await withTimeout(probeFetch(url), CONFIG.timeout_ms);
    if (!res.ok) return { consent: false, url, file_present: false, declined: false, reason: "no consent file at " + CONSENT_WELL_KNOWN_PATH + " (http " + res.status + ")" };
    let body;
    try { body = await res.json(); } catch (_e) { return { consent: false, url, file_present: true, declined: false, reason: "consent file is not JSON" }; }
    if (!body || typeof body !== "object" || Array.isArray(body)) return { consent: false, url, file_present: true, declined: false, reason: "consent file is not a JSON object" };
    // 0.3.1. listing: "decline" は所有者の「測るな」。origin にしか置けん物やから、申告やなく証明として扱う。
    // 同意(allow_tool_call)とは独立。断った行は登録簿に残り、「断った」と書かれる。判定は作らん。
    const declined = body.listing === "decline";
    // 0.4.0 (conduct-v1.1). 同じファイルに所有者が置ける任意の欄。読むだけで、判定には一切入れん。
    //   notify: 掃引で測った後に扉が POST する https の URL(1 時間に 1 回まで。/check では飛ばさん)。
    //   identity: 所有者が「私はこれ」と指す URL(証明はせん。lookup にそのまま declared として出す)。
    //   witness_policy.reciprocal: true なら「歩かれたら歩き返す」宣言(宣言であって、輪の walked_as_witness が事実)。
    const declared = wellKnownDeclared(body);
    if (body.allow_tool_call !== true) return { consent: false, url, file_present: true, declined, declared, reason: "consent file does not set allow_tool_call to the boolean true (nothing else counts)" };
    if (body.endpoints !== undefined) {
      if (!Array.isArray(body.endpoints) || !body.endpoints.every((e) => typeof e === "string")) {
        return { consent: false, url, declared, reason: "consent file has an endpoints field that is not an array of strings" };
      }
      if (!body.endpoints.includes(endpoint)) return { consent: false, url, file_present: true, declined, declared, reason: "consent file lists endpoints and this endpoint is not among them (exact string match)" };
    }
    return { consent: true, url, file_present: true, declined, declared, fetched_at: new Date().toISOString() };
  } catch (e) {
    const gateSide = /gate-side failure/.test(String(e && e.message));
    return { consent: false, url, file_present: null, declined: false, gate_side: gateSide, reason: (gateSide ? "consent file not read (gate side): " : "consent file not read: ") + String((e && e.message) || e) };
  }
}

// 0.4.0. well-known の任意欄を取り出す。形が違えば黙って落とすのやなく、その欄に why を書いて返す。
// notify の宛先は https で、扉自身のホスト・IP 直書き・localhost は受けん(扉が誰かの内側を叩く道具にならんように)。
const NOTIFY_MIN_INTERVAL_S = 3600;
function notifyTargetProblem(u) {
  if (typeof u !== "string") return "notify is not a string";
  let p;
  try { p = new URL(u); } catch (_e) { return "notify is not a URL"; }
  if (p.protocol !== "https:") return "notify must be https";
  const h = p.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return "notify must not point at a local name";
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.startsWith("[")) return "notify must be a hostname, not an IP literal";
  if (h === "gate.horizonshield.dev" || h === "ledger.horizonshield.dev") return "notify must not point at the gate or the ledger";
  if (p.username || p.password) return "notify must not carry credentials";
  return null;
}
function wellKnownDeclared(body) {
  const out = {};
  if (body.notify !== undefined) {
    const why = notifyTargetProblem(body.notify);
    out.notify = why ? { url: null, why } : { url: body.notify, why: null };
  }
  if (body.identity !== undefined) {
    // 11.5: https URL か {kind, ref}。解決はせん、写すだけ。
    const id = body.identity;
    if (typeof id === "string" && /^https:\/\//i.test(id)) out.identity = { kind: "url", ref: id, why: null };
    else if (id && typeof id === "object" && !Array.isArray(id) && ["did", "jwks", "vc", "url"].includes(id.kind) && typeof id.ref === "string" && id.ref.length > 0 && id.ref.length <= 512)
      out.identity = { kind: id.kind, ref: id.ref, why: null };
    else out.identity = { kind: null, ref: null, why: "identity must be an https URL or {kind: did|jwks|vc|url, ref: string}" };
  }
  if (body.witness_policy !== undefined) {
    const wp = body.witness_policy;
    out.witness_policy = (wp && typeof wp === "object" && !Array.isArray(wp))
      ? { reciprocal: wp.reciprocal === true, why: null }
      : { reciprocal: null, why: "witness_policy must be an object" };
  }
  return Object.keys(out).length ? out : null;
}

// 同意の解決。順に: 扉のソースの同意リスト(公開)→ origin の well-known ファイル → 無し。
// 要求者の申告はここに入れない。申告は所有の証明ではないので、別の根拠(requester)として刻む。
async function resolveConsent(endpoint) {
  if (TOOL_CALL_CONSENT.has(endpoint)) {
    // 0.4.0. 自前の行は well-known を読まん(掃引の subrequest 枠 50 を守る。自前の行に notify は要らん)。
    return { consent: true, source: "operator_list", declined_listing: false, declared: null, basis: "operator consent list (TOOL_CALL_CONSENT in the gate's source, published)" };
  }
  const wk = await wellKnownConsent(endpoint);
  if (wk.consent) {
    return { consent: true, source: "well_known", declined_listing: wk.declined === true, declared: wk.declared || null, basis: "consent file on the origin (" + wk.url + ") sets allow_tool_call true, read at " + wk.fetched_at + "; only the owner of the origin can place a file there" };
  }
  return { consent: false, source: "none", declined_listing: wk.declined === true, declared: wk.declared || null, basis: null, reason: wk.reason, url: wk.url, gate_side: wk.gate_side === true };
}

// 0.4.0 (conduct-v1.1 notify). 掃引で測った後、所有者が well-known に書いた notify へ結果の要約を POST する。
// 変化した時だけやない、測るたびに飛ばす(「測られた」こと自体を知らせる)。ただし endpoint ごとに 1 時間に 1 回まで、
// 掃引からだけ(/check からは飛ばさん。誰でも叩ける口から他人の URL に POST させんため)。結果は掃引の記録に notify_status で残す。
async function notifyMeasured(env, endpoint, target, payload, nowMs, fetchImpl) {
  const why = notifyTargetProblem(target);
  if (why) return { sent: false, reason: why };
  const key = "notify:sent:" + (await sha256hex(endpoint)).slice(0, 16);
  if (env && env.HS_VERIFY_KV) {
    try {
      const last = await env.HS_VERIFY_KV.get(key);
      if (last && (nowMs - Number(last)) < NOTIFY_MIN_INTERVAL_S * 1000) return { sent: false, reason: "rate limited: one notify per endpoint per " + NOTIFY_MIN_INTERVAL_S + "s (last at " + new Date(Number(last)).toISOString() + ")" };
    } catch (_e) {}
  }
  let out;
  try {
    const f = fetchImpl || fetch;
    const res = await withTimeout(f(target, { method: "POST", headers: { ...JSON_HEADERS, "user-agent": "hs-verify-gate/" + CONFIG.version + " (+https://gate.horizonshield.dev/spec)" }, body: JSON.stringify(payload), redirect: "manual" }), NOTIFY_TIMEOUT_MS);
    out = { sent: true, status: res.status, at: new Date(nowMs).toISOString() };
  } catch (e) {
    out = { sent: false, reason: String((e && e.message) || e).slice(0, 200), at: new Date(nowMs).toISOString() };
  }
  if (env && env.HS_VERIFY_KV) {
    try { await env.HS_VERIFY_KV.put(key, String(nowMs), { expirationTtl: NOTIFY_MIN_INTERVAL_S }); } catch (_e) {}
  }
  return out;
}

// /check と MCP の check ツールの共通入口。証明された同意が申告に勝つ。どちらも無ければ tool は呼ばん。
async function checkWithConsent(endpoint, asserted) {
  const c = await resolveConsent(endpoint);
  if (c.consent) return await runCheck(endpoint, true, c.basis, c.source);
  if (asserted === true) return await runCheck(endpoint, true, null, "requester", c);
  return await runCheck(endpoint, false, null, "none", c);
}

// 2026-08-19 patch41. この計器自身の既知の制限。測ったが直せていないものを、黙って回避しない。
const KNOWN_UA_LIMITATION = "Known limitation of this instrument, measured 2026-08-18 and unresolved: requests carrying the Python urllib user agent are refused with 403 by a Cloudflare managed rule in front of this Worker, so that one client is turned away before any code here runs. curl, python-requests, node-fetch, undici, axios, okhttp, Go, Java, Postman and an absent user agent were all measured at 200 on the same day. This is stated here rather than worked around silently.";

// 表示名。運営者が付けた名前であって、測定値ではない。registerの応答でもそう明記する。
// 加盟店の実名は本人の書面同意が取れてから入れる。それまでは掲載準備中。
const OPERATOR_LABELS = {
  "https://mcp.horizonshield.dev/mcp":     { ja: "KIRA\u9069\u6b63\u8a3a\u65ad", en: "KIRA fair price audit (the flagship MCP server)", url: "https://shield.the-horizons-innovation.com" },
  "https://web.horizonshield.dev/mcp":     { ja: "KIRA\u76f8\u8ac7\u7a93\u53e3", en: "KIRA intake desk for renovation questions", url: "https://shield.the-horizons-innovation.com" },
  "https://hearing.horizonshield.dev/mcp": { ja: "YAKUMO\u52a0\u76df\u5e97\u30c7\u30a3\u30ec\u30af\u30c8\u30ea", en: "YAKUMO verified contractor directory", url: "https://shield.the-horizons-innovation.com/yakumo/" },
  "https://gate.horizonshield.dev/mcp":    { ja: "\u691c\u8a3c\u30b2\u30fc\u30c8\uff08\u3053\u306e\u691c\u67fb\u6a5f\u81ea\u8eab\uff09", en: "The verification gate, measuring itself", url: "https://shield.the-horizons-innovation.com/verify-directory/" },
  "https://jidec.horizonshield.dev/mcp":   { ja: "JIDEC \u516c\u958b\u691c\u8a3c\u53f0\u5e33", en: "JIDEC, the Bitcoin anchored public ledger", url: "https://ledger.horizonshield.dev/llms.txt" },
  "https://p001.horizonshield.dev/mcp":    { ja: "\u30ea\u30d5\u30a9\u30fc\u30e0\u8077\u4eba\u682a\u5f0f\u4f1a\u793e\uff08\u52a0\u76dfNo.001\uff09", en: "Reform Shokunin Co., Ltd. (member No.001, Aichi)", url: "https://shield.the-horizons-innovation.com/yakumo/no001/" },
  "https://p002.horizonshield.dev/mcp":    { ja: "\u30df\u30cd\u30aa\u30c8\u30fc\u30e8\u30fc\u4f4f\u5668\u682a\u5f0f\u4f1a\u793e\uff08\u52a0\u76dfNo.002\uff09", en: "Mineo Toyo Juki Co., Ltd. (member No.002)" },
  "https://femtech.horizonshield.dev/mcp": { ja: "フェム情報源レジストリ", en: "Femtech source registry (verify sources, never diagnose)", url: "https://femtech.horizonshield.dev/" }
};

const REGISTER_JOIN_MAX = 50;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// --- Badge: an operator may display the current verdict on their own site.
// Deliberate: short cache so a green cannot be pinned, and an unlisted endpoint
// is not an error. The badge shows what the register says right now, or nothing.
function badgeSvg(label, status, color) {
  const L = String(label), S = String(status);
  const lw = 8 + L.length * 6.2, sw = 8 + S.length * 6.2, w = lw + sw;
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w.toFixed(0) + '" height="20" role="img" aria-label="' + L + ': ' + S + '">' +
    '<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>' +
    '<rect width="' + w.toFixed(0) + '" height="20" rx="3" fill="#555"/>' +
    '<rect x="' + lw.toFixed(0) + '" width="' + sw.toFixed(0) + '" height="20" rx="3" fill="' + color + '"/>' +
    '<rect x="' + lw.toFixed(0) + '" width="4" height="20" fill="' + color + '"/>' +
    '<rect width="' + w.toFixed(0) + '" height="20" rx="3" fill="url(#s)"/>' +
    '<g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">' +
    '<text x="' + (lw / 2).toFixed(0) + '" y="14">' + L + '</text>' +
    '<text x="' + (lw + sw / 2).toFixed(0) + '" y="14">' + S + '</text></g></svg>';
}

// 2026-08-19 patch54. 渡せるバッジ。
// 20px のシールズ風はサイトに貼る用で、名刺やチラシには小さすぎる。
// こちらは印刷にも耐える大きさで、事業者名とエンドポイントと測定日を入れる。
//
// ★日付を必ず焼き込む理由。
// 公開している約束は「バッジを取り上げる手続きは無い。条件を満たさなくなったら、
// 次のリクエストで緑が描かれないだけ」。ダウンロードされた静止画は、落ちても緑のまま残る。
// それは約束と矛盾する。だから measured の日付と、いまの状態を確かめる URL を焼き込む。
// 「この日はこうだった」なら嘘にならない。
function xmlEsc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function sealSvg(opts) {
  const name = xmlEsc(opts.name || opts.endpoint || "unmeasured endpoint");
  const sub = xmlEsc(opts.sub || "");
  const ep = xmlEsc(opts.endpoint || "");
  const status = String(opts.status || "not listed");
  const when = xmlEsc(opts.when || "");
  const verifyUrl = xmlEsc(opts.verifyUrl || "");
  const green = status === CONFIG.tier_pass;
  const accent = green ? "#34d399" : (status === CONFIG.tier_held ? "#9aa4b2" : "#fbbf24");
  const W = 560, H = sub ? 190 : 176;
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "\u2026" : s);
  // 2026-08-19 patch57. 確認先のURLだけは、絶対に切らない。
  // 印刷したバッジを持っている人にとって、いまの状態を確かめる手段はこの1行しかない。
  // 途中で切れたURLは、確かめられないという点で、URLが無いのと同じ。
  // だから長いときは切るのではなく、字間を詰めて収める。切れることは無い。
  const epRaw = String(opts.endpoint || "");
  const verifyRaw = String(opts.verifyUrl || "");
  const line = (x, y, s, fill, size, maxW, extra) => {
    const est = String(s).length * size * 0.55;
    const squeeze = est > maxW ? ' textLength="' + maxW + '" lengthAdjust="spacingAndGlyphs"' : "";
    return '<text x="' + x + '" y="' + y + '" fill="' + fill + '" font-size="' + size + '"' + (extra || "") + squeeze + '>' + xmlEsc(s) + '</text>';
  };
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" ' +
    'aria-label="MCP conduct ' + xmlEsc(status) + ' for ' + name + ', measured ' + when + '">' +
    '<rect width="' + W + '" height="' + H + '" rx="14" fill="#0b0b0e"/>' +
    '<rect x="0.5" y="0.5" width="' + (W - 1) + '" height="' + (H - 1) + '" rx="13.5" fill="none" stroke="rgba(255,255,255,.10)"/>' +
    '<rect x="0" y="0" width="6" height="' + H + '" rx="3" fill="' + accent + '"/>' +
    '<g font-family="Inter,Helvetica,Arial,sans-serif">' +
    '<text x="28" y="34" fill="#6f6f7a" font-size="11" letter-spacing="2.4">HORIZON SHIELD</text>' +
    '<text x="28" y="64" fill="' + accent + '" font-size="21" font-weight="700">MCP conduct ' + xmlEsc(status) + '</text>' +
    line(28, 92, String(opts.name || opts.endpoint || "unmeasured endpoint"), "#f4f4f5", 15, 462, ' font-weight="600"') +
    (sub ? line(28, 112, String(opts.sub || ""), "#a9a9b3", 11.5, 462) : "") +
    line(28, (sub ? 136 : 122), epRaw, "#6f6f7a", 10.5, 504, ' font-family="ui-monospace,Menlo,monospace"') +
    line(28, (sub ? 156 : 142), "measured " + String(opts.when || ""), "#6f6f7a", 10.5, 240) +
    line(28, (sub ? 174 : 160), "verify at " + verifyRaw, "#8a8a95", 10.5, 504) +
    '</g>' +
    '<g transform="translate(' + (W - 62) + ',26)">' +
    '<circle cx="18" cy="18" r="17" fill="none" stroke="' + accent + '" stroke-width="2" opacity="' + (green ? "1" : ".45") + '"/>' +
    (green ? '<path d="M10 18.5 L16 24 L26 12" fill="none" stroke="' + accent + '" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>' : '') +
    '</g></svg>';
}

// --- Per endpoint permalink. One citable URL per measured server.
// /e/{host}{path} reconstructs the endpoint. Unlisted returns 404 on purpose:
// we do not mint an empty page for an endpoint nobody has measured.

// ---- 機械が依存できるようにするための面 ----
// ここで足しているのは、この登記簿を「人が英語のページを読んで理解する」以外の
// 経路で使えるようにするためのものだけだ。判定そのものには一切影響しない。
// 4行が verified で、その4行が全部こちらのものである、という事実も変わらない。

function openapiDoc(origin) {
  const ok = { description: "OK" };
  const g = (summary, description) => ({ get: { summary, description, responses: { "200": ok } } });
  return {
    openapi: "3.1.0",
    info: {
      title: "MCP conduct register",
      version: CONFIG.version,
      description:
        "A register of measured conduct for MCP endpoints. Five stated conditions are measured on a schedule. " +
        "A condition that could not be measured is never counted as a pass, including for the operator of this gate. " +
        "Read only. No account, no key, no fee. Every verdict carries a SHA-256 that a stranger can recompute.",
      license: { name: "MIT", url: "https://opensource.org/licenses/MIT" },
      contact: { url: "https://shield.the-horizons-innovation.com/verify-directory/" }
    },
    servers: [{ url: origin }],
    paths: {
      "/register": g("Every row in the register", "Rows are scheduled measurements, not endorsements. An endpoint that is absent has simply never been measured."),
      "/verified.json": g("Only the rows that passed every measured condition", "A schema.org Dataset. Returns zero rows when zero rows pass. The bar is not lowered to avoid an empty list."),
      "/history": g("Past measurements for one endpoint", "Query with ?endpoint=. Records are appended, never edited. The gate keeps the most recent " + HISTORY_MAX + " per endpoint (30 until 2026-09-05); older records leave this response, so archive the export."),
      "/changes": g("State changes only", "A change means a condition flipped, not merely that a new verdict was issued."),
      "/feed.xml": g("The same changes as an Atom feed", "For subscribing rather than polling."),
      "/sitemap.xml": g("One URL per measured endpoint", "Only endpoints that have actually been measured appear. No page is minted for an endpoint nobody has measured."),
      "/e/{host}{path}": g("The permanent page for one measured endpoint", "Carries the verdict, the time it was taken, the SHA-256 of the record, and the command to recompute it. 404 when the endpoint has never been measured."),
      "/badge": g("A badge drawn from the register at request time", "Query with ?endpoint=. Short cache, so a green cannot be kept up after the row stops being green."),
      "/embed": g("The verification envelope, ready to paste on your own site", "Query with ?endpoint=. The text twin of the badge: JSON-LD for crawlers and the same statement as visible text for language models that fetch the page. Carries status, the record sha256, the recompute recipe and what it does not establish; never a score. Add format=json for the JSON-LD alone. A copy is a snapshot with its date inside; the /e/ page is the live statement."),
      "/badge/seal": g("A larger badge, sized for print and for other people's sites", "Query with ?endpoint=. Carries the operator label, the endpoint, the measurement date and the verify URL. Add download=1 to receive it as a file. A downloaded file is a snapshot: the date is drawn into the image for exactly that reason, and the live row remains the only current statement."),
      "/spec": g("The five conditions, stated in full", "Includes what a pass does not mean."),
      "/ext/conduct/v1": g("A2A Conduct Extension v1 (the URI is the identifier)", "JSON by default. Accept: text/markdown returns the specification text. Declared by agent cards under capabilities.extensions[]."),
      "/self": g("This gate measured against its own conditions", "It does not currently pass all of them, and the reason is published."),
      "/health": g("Liveness and the deployed commit", ""),
      "/recompute": {
        post: {
          summary: "Work out which canonicalization reproduces a claimed hash",
          description:
            "Send a JSON object as it was published, and a SHA-256 somebody claims was taken over it. " +
            "Returns every recipe that reproduces the value, whether that recipe is RFC 8785 JCS, how many " +
            "combinations were tried, and the exact space they covered. A hash that could not be reproduced " +
            "is reported as not reproduced with the number of combinations tried, and never as invalid. " +
            "Omit the claimed hash to receive canonical forms and their hashes instead, so a reading can be " +
            "held by someone who does not operate the source. Contacts nothing. Stores nothing.",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", required: ["object"], properties: {
              object: { type: "object", description: "The JSON object as published." },
              claimed: { type: "string", description: "Optional. 64 hex characters. Omit to receive canonical forms." },
              max_candidates: { type: "integer", description: "Optional upper bound on combinations tried." }
            } } } }
          },
          responses: { "200": ok }
        }
      },
      "/verify-event": {
        post: {
          summary: "Recompute a NIP-01 event id and verify its BIP340 signature",
          description:
            "Computed here from the curve parameters, with no library and no network call, so neither the " +
            "issuer's own verification service nor a dependency has to be trusted. For each field name given, " +
            "the answer states whether it sits inside the signed bytes or beside them. A valid signature shows " +
            "that the holder of the key signed those bytes. It does not make the bytes true.",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", required: ["event"], properties: {
              event: { type: "object", description: "A complete signed event with id, pubkey, created_at, kind, tags, content and sig." },
              assert_inside: { type: "array", items: { type: "string" }, description: "Optional field names to locate inside the signed bytes. Both content and tags are searched, and the answer says which one carried the field." }
            } } } }
          },
          responses: { "200": ok }
        }
      },
      "/mould": g("Mould records. What class of assumption a fix came from, where the author searched for it, and what they found. A record with an empty search is published as such.", ""),
      "/sweep/last": g("When the last scheduled re-measurement ran, under which coordinate rule, and why", ""),
      "/nenrin/window": g("The instant coordinate's public window: salt commitment at creation, pinned rule, beacon, salt revealed after the window closes (0.3.5), and since 0.4.0 whether the commitment was filed to the ledger witness intake before the window opened", ""),
      "/register/lookup": g("One read before connecting (conduct-v1.1 section 7): status verified / pending / declined / unknown, the last published ring's counts, where the record lives, and what the answer does not establish. Query endpoint=<https MCP endpoint>. Cached 24 hours. No score.", ""),
      "/watchlist": g("Endpoints scheduled for re-measurement", ""),
      "/.well-known/agent-card.json": g("A2A agent card for this gate", ""),
      "/.well-known/mcp-register.json": g("Machine readable summary of the register", ""),
      "/check": {
        post: {
          summary: "Measure one endpoint now",
          "x-known-limitation": KNOWN_UA_LIMITATION,
          description:
            "Measures the stated conditions against the endpoint you name. Determinism stays unmeasured unless the owner has recorded consent, " +
            "because measuring it requires calling a tool on someone else's server.",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", required: ["endpoint"], properties: {
              endpoint: { type: "string", format: "uri", description: "The MCP endpoint to measure." },
              allow_tool_call: { type: "boolean", description: "Only the owner of the endpoint may set this true." }
            } } } }
          },
          responses: { "200": ok }
        }
      },
      "/mcp": {
        post: { summary: "The same register over MCP", description: "Streamable HTTP, JSON-RPC 2.0.", responses: { "200": ok } }
      }
    }
  };
}

function sitemapXml(origin, rows) {
  const seen = new Set();
  const urls = [];
  urls.push({ loc: "https://shield.the-horizons-innovation.com/verify-directory/", pri: "1.0", freq: "daily" });
  urls.push({ loc: "https://shield.the-horizons-innovation.com/verify-directory/recompute/", pri: "0.9", freq: "weekly" });
  for (const r of rows) {
    if (!r || !r.endpoint) continue;
    const loc = encodeURI(origin + "/e/" + String(r.endpoint).replace(/^https?:\/\//, ""));
    if (seen.has(loc)) continue;
    seen.add(loc);
    const at = (r.latest && r.latest.at) ? String(r.latest.at).slice(0, 10) : "";
    urls.push({ loc: loc, pri: "0.8", freq: "daily", mod: at });
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) =>
      "  <url><loc>" + esc(u.loc) + "</loc>" +
      (u.mod ? "<lastmod>" + esc(u.mod) + "</lastmod>" : "") +
      "<changefreq>" + u.freq + "</changefreq><priority>" + u.pri + "</priority></url>"
    ).join("\n") +
    "\n</urlset>\n";
}

function atomFeed(origin, changes) {
  const list = changes.slice().reverse().slice(0, 50);
  const newest = list.length && list[0].at ? String(list[0].at) : "1970-01-01T00:00:00Z";
  const entries = list.map((c) => {
    const ep = String(c.endpoint || "unknown");
    const at = String(c.at || newest);
    const path = encodeURI(origin + "/e/" + ep.replace(/^https?:\/\//, ""));
    const id = path + "#" + encodeURIComponent(at);
    const title = ep + ": " + String(c.status_from || "unmeasured") + " to " + String(c.status_to || "unknown");
    const body =
      "Condition changes: " + String(c.summary || "not recorded") + ". " +
      "Reachable at the time of measurement: " + (c.reachable === true ? "yes" : (c.reachable === false ? "no" : "not measured")) + ". " +
      "This entry records that a condition flipped. It is not a statement about the operator.";
    return "  <entry>\n" +
      "    <title>" + esc(title) + "</title>\n" +
      "    <id>" + esc(id) + "</id>\n" +
      "    <updated>" + esc(at) + "</updated>\n" +
      '    <link rel="alternate" href="' + esc(path) + '"/>\n' +
      "    <summary>" + esc(body) + "</summary>\n" +
      "  </entry>";
  }).join("\n");
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<feed xmlns="http://www.w3.org/2005/Atom">\n' +
    "  <title>MCP conduct register: state changes</title>\n" +
    "  <subtitle>A change means a condition flipped, not merely that a new verdict was issued.</subtitle>\n" +
    "  <id>" + esc(origin + "/feed.xml") + "</id>\n" +
    '  <link rel="self" href="' + esc(origin + "/feed.xml") + '"/>\n' +
    '  <link rel="alternate" href="https://shield.the-horizons-innovation.com/verify-directory/"/>\n' +
    "  <updated>" + esc(newest) + "</updated>\n" +
    (entries ? entries + "\n" : "") +
    "</feed>\n";
}

function securityTxt(origin) {
  return [
    "Contact: mailto:contact@the-horizons-innovation.com",
    "Preferred-Languages: en, ja",
    "Canonical: " + origin + "/.well-known/security.txt",
    "Policy: https://shield.the-horizons-innovation.com/verify-directory/",
    "",
    "# This service publishes verdicts about other people's servers.",
    "# If a verdict here is wrong, that is a security problem, not a support ticket.",
    "# Send the endpoint, what you measured, and from where. A report that contradicts",
    "# our own measurement is the most useful kind, and it will be published either way."
  ].join("\n") + "\n";
}

// ---- verification envelope: the text twin of the badge (2026-09-07) ----------------------------
// A badge is a picture. A crawler indexes it as an image and a language model that fetches this
// page never sees what is inside it. This block says the same thing in words a retrieval layer
// reads: what was measured, where the record lives, its sha256, how to recompute it, and, never
// omitted, what it does not establish. It carries no score and no rank: status is a state
// (verified / pending / declined) and does_not_establish is always present, so a quotation of it
// cannot turn into a recommendation (the same discipline as the verdict arrays, 0.4.0).
// It is served twice on purpose: as JSON-LD in <head> for crawlers, and as visible text in <body>
// for fetchers that strip <script> (measured 2026-09-07: a browsing agent's text view of a page
// carrying JSON-LD contained none of it). Same values in both. Nothing here is a new claim; every
// value is copied from the row and its latest history entry.
const ENVELOPE_DNE_FALLBACK = [
  "that the endpoint is safe, correct, honest, or fit for any purpose; this gate measures conduct and disclosure only",
  "that any answer the endpoint gives is correct or of good quality",
  "that the compensation declaration is true",
  "conditions not measured on the latest run, other instants, other vantages"
];
function envelopeStatus(row) {
  if (row.owner_declined) return "declined";
  if (!row.latest || !row.latest.status) return "pending";
  return row.latest.status === CONFIG.tier_pass ? "verified" : "pending";
}
function conductEnvelope(origin, row) {
  const ep = String(row.endpoint);
  const latest = row.latest || {};
  const status = envelopeStatus(row);
  const dne = (Array.isArray(latest.does_not_establish) && latest.does_not_establish.length) ? latest.does_not_establish : ENVELOPE_DNE_FALLBACK;
  const est = Array.isArray(latest.establishes) ? latest.establishes : [];
  const self = origin + "/e/" + ep.replace(/^https?:\/\//, "");
  const obj = {
    "@context": ["https://schema.org", { conduct: CONDUCT_EXT_URI + "#" }],
    "@type": "CreativeWork",
    "@id": self + "#conduct",
    additionalType: CONDUCT_EXT_URI,
    name: "Independent conduct record for " + ep,
    url: latest.record_url || row.history_url,
    "conduct:history": row.history_url,
    creator: { "@type": "Organization", name: "HORIZON SHIELD MCP Verification Gate", url: origin },
    about: { "@type": "WebAPI", name: ep, url: ep },
    "conduct:status": status,
    "conduct:does_not_establish": dne,
    "conduct:register_lookup": origin + "/register/lookup?endpoint=" + encodeURIComponent(ep),
    "conduct:witness_intake": "https://ledger.horizonshield.dev/witness",
    isBasedOn: origin + "/spec",
    usageInfo: latest.record_url
      ? "Fetch url. The body is the hashed verdict itself (record_sha256 and recompute_note removed); SHA-256 of the body equals identifier.value. conduct:history lists every measurement. This is a state, not a score, and not a recommendation."
      : "identifier.value is the sha of a verdict measured before this gate began storing the hashed bytes (0.4.1); it cannot be recomputed from any published object. conduct:history lists the measurements; entries there are summaries. The next scheduled measurement carries url pointing at its bytes. This is a state, not a score, and not a recommendation.",
    disambiguatingDescription: "Independent measurement of conduct, counts not scores. status=" + status + ". Does not establish: " + dne.join("; ") + "."
  };
  if (est.length) obj["conduct:establishes"] = est;
  if (latest.record_sha256) obj.identifier = { "@type": "PropertyValue", propertyID: "sha256", name: "record_sha256", value: latest.record_sha256 };
  if (latest.at) obj.dateModified = latest.at;
  return obj;
}
function envelopeVisibleHtml(envObj) {
  const li = (a) => a.map((s) => "<li>" + esc(s) + "</li>").join("");
  const est = envObj["conduct:establishes"] || [];
  const dne = envObj["conduct:does_not_establish"] || [];
  const sha = envObj.identifier ? envObj.identifier.value : "none yet";
  return '<section class="env" id="verification">' +
    '<h2>Verification, in words a machine can read</h2>' +
    '<p class="n">The badge above is a picture. This is the same statement as text, for search engines and for language models that fetch this page. It is a state, not a score, and not a recommendation.</p>' +
    '<table>' +
    '<tr><th>status</th><td>' + esc(envObj["conduct:status"]) + '</td></tr>' +
    '<tr><th>record sha256</th><td style="word-break:break-all">' + esc(sha) + '</td></tr>' +
    '<tr><th>record</th><td style="word-break:break-all"><a href="' + esc(envObj.url) + '">' + esc(envObj.url) + '</a>' + (String(envObj.url).indexOf("/record/") >= 0 ? " (the hashed bytes: sha256 of the body equals record sha256)" : " (history; the hashed bytes of this verdict were not stored, see recompute recipe)") + '</td></tr>' +
    (envObj["conduct:history"] && envObj["conduct:history"] !== envObj.url ? '<tr><th>history</th><td style="word-break:break-all"><a href="' + esc(envObj["conduct:history"]) + '">' + esc(envObj["conduct:history"]) + '</a></td></tr>' : '') +
    '<tr><th>recompute recipe</th><td><a href="' + esc(envObj.isBasedOn) + '">' + esc(envObj.isBasedOn) + '</a></td></tr>' +
    '<tr><th>one read before connecting</th><td style="word-break:break-all"><a href="' + esc(envObj["conduct:register_lookup"]) + '">' + esc(envObj["conduct:register_lookup"]) + '</a></td></tr>' +
    (envObj.dateModified ? '<tr><th>as of</th><td>' + esc(envObj.dateModified) + '</td></tr>' : '') +
    '</table>' +
    (est.length ? '<p><b>Establishes</b></p><ul>' + li(est) + '</ul>' : '') +
    '<p><b>Does not establish</b></p><ul>' + li(dne) + '</ul>' +
    '</section>';
}

function endpointPage(origin, row) {
  const ep = esc(row.endpoint);
  const st = esc((row.latest && row.latest.status) || "no measurement yet");
  const at = esc((row.latest && row.latest.at) || "");
  const sha = (row.latest && row.latest.record_sha256) || "";
  const self = origin + "/e/" + row.endpoint.replace(/^https?:\/\//, "");
  const label = row.operator_label ? esc(row.operator_label) : "";
  const why = row.why_not_verified ? esc(row.why_not_verified) : "";
  const surf = (row.latest && row.latest.surface) || null;
  const toolCount = surf && surf.tool_hashes ? Object.keys(surf.tool_hashes).length : 0;
  const lsc = row.last_surface_change || null;
  const envObj = conductEnvelope(origin, row);
  const ld = {
    "@context": "https://schema.org", "@type": "Dataset",
    "@id": self + "#dataset",
    name: "Measured conduct of " + row.endpoint,
    description: "Every scheduled measurement of this MCP endpoint, with the verdict, the time it was taken and the hash of the record. Generated by a script with no editorial input.",
    url: self, license: "https://opensource.org/licenses/MIT", isAccessibleForFree: true,
    isPartOf: { "@id": "https://shield.the-horizons-innovation.com/verify-directory/#dataset" },
    distribution: [{ "@type": "DataDownload", encodingFormat: "application/json", contentUrl: row.history_url }],
    variableMeasured: ["endpoint reachability", "agent card presence", "payer disclosure", "determinism", "record recomputability"]
  };
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + ep + ' : ' + st + ' | MCP conduct register</title>' +
    '<meta name="description" content="Measured conduct of ' + ep + '. Latest verdict ' + st + '.">' +
    '<link rel="canonical" href="' + self + '">' +
    '<meta name="robots" content="index,follow,max-snippet:-1">' +
    '<script type="application/ld+json">' + JSON.stringify(ld) + '</script>' +
    '<script type="application/ld+json">' + JSON.stringify(envObj) + '</script>' +
    '<style>body{background:#0a0a0a;color:#ddd;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;line-height:1.8;margin:0}' +
    '.w{max-width:760px;margin:0 auto;padding:40px 20px 60px}a{color:#f97316}' +
    'h1{font-size:19px;color:#fff;word-break:break-all;margin:6px 0 18px}' +
    'table{width:100%;border-collapse:collapse;margin:18px 0;font-size:14px}' +
    'th,td{border:1px solid #2a2a2a;padding:9px 11px;text-align:left;vertical-align:top}' +
    'th{background:#141414;color:#f97316;width:34%;font-weight:600}' +
    'pre{background:#141414;border:1px solid #2a2a2a;border-radius:9px;padding:13px;overflow-x:auto;font-size:13px}' +
    '.moved{background:#1a1206;border:1px solid #5a3a12;border-radius:9px;padding:13px 15px;margin:16px 0;font-size:13.5px;color:#f0c98a}' +
    '.moved b{color:#fbbf24}' +
    '.own{background:#0d1411;border:1px solid #234034;border-radius:9px;padding:15px 17px;margin:24px 0 8px;font-size:13.5px}' +
    '.own b{color:#fff}.own ul{margin:10px 0 0;padding-left:18px}.own li{margin:6px 0;color:#c3c3c3}' +
    '.n{color:#8a8a8a;font-size:13px}.env{margin-top:28px}.env h2{font-size:15px;color:#fff;margin:0 0 6px}.env ul{padding-left:18px}.env li{margin:4px 0;color:#c3c3c3}</style></head><body><div class="w">' +
    '<a href="https://shield.the-horizons-innovation.com/verify-directory/">back to the register</a>' +
    '<h1>' + ep + '</h1>' +
    '<img src="' + origin + '/badge?endpoint=' + encodeURIComponent(row.endpoint) + '" alt="MCP conduct: ' + st + '" height="20">' +
    '<table>' +
    (label ? '<tr><th>operator</th><td>' + label + '</td></tr>' : '') +
    '<tr><th>latest verdict</th><td>' + st + '</td></tr>' +
    '<tr><th>measured at</th><td>' + (at || 'not recorded') + '</td></tr>' +
    '<tr><th>measurements</th><td>' + (row.measurements === null ? 'see history' : row.measurements) + '</td></tr>' +
    '<tr><th>first measured</th><td>' + esc(row.first_at || 'not recorded') + '</td></tr>' +
    '<tr><th>cadence</th><td>' + esc(row.cadence || '') + '</td></tr>' +
    '<tr><th>tool call consent</th><td>' + (row.tool_call_consent ? 'given by the operator' : 'not given') + '</td></tr>' +
    '<tr><th>record sha256</th><td style="word-break:break-all">' + esc(sha || 'none yet') + '</td></tr>' +
    (surf ? '<tr><th>declared surface</th><td>' + esc(String(toolCount)) + ' tool' + (toolCount === 1 ? '' : 's') +
      ', manifest ' + esc(String(surf.manifest_hash || 'withheld')) +
      (surf.canonicalization === 'refused'
        ? '<br><span class="n">fingerprint withheld: this surface cannot be canonicalized, so no third party could reproduce a hash over it</span>'
        : '') + '</td></tr>' : '') +
    '</table>' +
    (lsc ? '<div class="moved"><b>The declared surface last moved on ' + esc(String(lsc.at || 'an unrecorded date')) + '.</b><br>' +
      (lsc.added && lsc.added.length ? 'added: ' + esc(lsc.added.join(', ')) + '<br>' : '') +
      (lsc.removed && lsc.removed.length ? 'removed: ' + esc(lsc.removed.join(', ')) + '<br>' : '') +
      (lsc.definition_changed && lsc.definition_changed.length ? 'definition changed: ' + esc(lsc.definition_changed.join(', ')) + '<br>' : '') +
      '<span class="n">A tool can keep its name and change what it accepts. That breaks the code calling it and breaks no badge, ' +
      'so it is recorded here as a dated fact. The MCP specification treats tool list changes as normal operation. ' +
      'Nothing here says this change was wrong.</span></div>' : '') +
    (why ? '<p class="n">' + why + '</p>' : '') +
    envelopeVisibleHtml(envObj) +
    '<p class="n">Put this on your own site: <a href="' + origin + '/embed?endpoint=' + encodeURIComponent(row.endpoint) + '">the same block, ready to paste</a>. A copy is a snapshot with its date inside; this page is the live statement.</p>' +
    '<p>Recompute this row yourself. Do not take our word for it.</p>' +
    '<pre>curl -s "' + row.history_url + '"</pre>' +
    '<p class="n" style="margin-top:16px">More on this endpoint: ' +
      '<a href="' + row.history_url + '">every measurement, as JSON</a> / ' +
      '<a href="' + origin + '/is-verified?endpoint=' + encodeURIComponent(row.endpoint) + '">one-glance verdict</a> / ' +
      '<a href="https://shield.the-horizons-innovation.com/verify-directory/recompute/">how to recompute a verdict</a> / ' +
      '<a href="' + origin + '/spec">the conditions, in full</a></p>' +
    '<div class="own"><b>Is this your server?</b>' +
      '<ul>' +
      '<li>Appearing here is free and stays free. So is this page, the structured data inside it, and the fact that ' +
        'search engines and agents can read it. <b>None of that is for sale at any price.</b></li>' +
      '<li>Free, on request: correct the operator name shown above, ask to be measured now rather than at the next ' +
        'sweep, or ask not to be measured again. Records already taken stay, because a register that deletes its ' +
        'own past is not a register.</li>' +
      '<li>Paid: measured daily instead of weekly, and told by webhook within the hour when a condition flips or ' +
        'the declared surface moves.</li>' +
      '<li><b>Never for sale:</b> the verdict, the order of this register, and whether you appear in it. Paying buys ' +
        'more measurement of you, sooner. It has never bought a better result, and a paid row that fails is ' +
        'published exactly like a free one that fails.</li>' +
      '</ul></div>' +
    '<p class="n">A green here means every condition that could be measured was measured and passed. It is not a statement that the server is good, safe or correct. Conditions that were not measured are never counted as passes, including for the operator of this register.</p>' +
    '</div></body></html>';
}

async function publicRegister(env) {
  const list = await watchlist(env);
  const rows = [];
  let joined = 0;
  for (const w of list) {
    const row = {
      endpoint: w.endpoint,
      tier: w.tier,
      cadence: w.tier === "free" ? "weekly" : "daily",
      measurements: null,
      first_at: null,
      latest: null,
      history_url: "https://gate.horizonshield.dev/history?endpoint=" + encodeURIComponent(w.endpoint)
    };
    const lbl = OPERATOR_LABELS[w.endpoint];
    if (lbl) row.operator_label = lbl;
    row.requested_by = w.requested_by || "unrecorded (row added before 0.3.1)";
    if (w.owner_declined_at) row.owner_declined = { since: w.owner_declined_at, how: CONSENT_WELL_KNOWN_PATH + " on the origin sets listing to decline", effect: "not measured while the file says so; no verdict exists for this row" };
    row.tool_call_consent = TOOL_CALL_CONSENT.has(w.endpoint);
    if (joined < REGISTER_JOIN_MAX) {
      joined++;
      const hist = await readHistory(env, w.endpoint);
      const entries = (hist && Array.isArray(hist.entries)) ? hist.entries : [];
      row.measurements = entries.length;
      row.first_at = entries.length ? (entries[0].at || null) : null;
      const latest = entries.length ? entries[entries.length - 1] : null;
      if (latest) {
        row.latest = {
          at: latest.at || null,
          status: latest.status || null,
          record_sha256: latest.record_sha256 || null,
          record_url: latest.record_url || null,
          consent_source: latest.consent_source || null,
          surface: latest.surface || null,
          // 2026-09-07. 0.4.0 wrote the two arrays into every history entry; the register row now carries them too,
          // so the endpoint page and /embed can state them without a second read.
          establishes: Array.isArray(latest.establishes) ? latest.establishes : null,
          does_not_establish: Array.isArray(latest.does_not_establish) ? latest.does_not_establish : null
        };
        // 0.2.4. 直近の掃引が origin の well-known ファイルで同意を読めたなら、その行の同意は真。
        if (latest.consent_source === "well_known") row.tool_call_consent = true;
      }
      // 直近の表面移動を、日付付きで一件だけ持ち上げる。統合を壊す変更はここに出る。
      for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i] && entries[i].surface_change) {
          row.last_surface_change = { at: entries[i].at || null, ...entries[i].surface_change };
          break;
        }
      }
    } else {
      row.note = "not joined with history in this response: over REGISTER_JOIN_MAX (" + REGISTER_JOIN_MAX + "). The history_url works regardless.";
    }
    if (!row.tool_call_consent) {
      row.why_not_verified = "No owner consent for tool calls is on record, so determinism is not measured and this row cannot reach verified. That is not a failure, it is an unmeasured condition. " +
        "To consent, publish " + CONSENT_WELL_KNOWN_PATH + " on the origin with {\"allow_tool_call\": true}; the next scheduled measurement reads it and records where it read it (0.2.4).";
    }
    rows.push(row);
  }
  const removed = await readRemoved(env);
  return {
    removed_rows: removed,
    count: rows.length,
    max: REGISTRY_MAX,
    gate_commit: gateCommit(),
    note: "The public register. Rows are scheduled measurements, not endorsements. An endpoint that is absent has simply never been measured here; absence is NOT a negative verdict. Webhooks are never published. Every stored verdict carries a record_sha256 you can recompute yourself. The operator_label field is a display name assigned by the operator, not a measurement.",
    join: 'POST /watch with {"endpoint":"https://your-server/mcp"}',
    rows: rows
  };
}

// 無料層は週1回。エンドポイントごとに測る日をずらし、1日に固まらないようにする。
async function isDueToday(endpoint, tier, now, coord) {
  if (tier !== "free") return true;
  // 0.3.0. 導出できる窓は導出で決める。対象は自分の番を先に計算できん。
  if (coord && coord.derived) {
    return (await nenrin.dueOffset(coord.seed, endpoint, coord.window_id)) === nenrin.dayInWindow(now);
  }
  // beacon が 2 源で一致せんかった窓は旧規則に落ちる。落ちたことは掃引の記録に書く。黙って落ちん。
  const h = await sha256hex(endpoint);
  const bucket = parseInt(h.slice(0, 4), 16) % FREE_INTERVAL_DAYS;
  return Math.floor(now / 86400000) % FREE_INTERVAL_DAYS === bucket;
}

// 変化したときだけ飛ばす。判定は公開されているので、これは「早く知る」ことの対価。
async function notifyChange(target, payload) {
  if (!target || !/^https:\/\//i.test(target)) return { sent: false, reason: "no https webhook" };
  try {
    const res = await withTimeout(fetch(target, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(payload)
    }), NOTIFY_TIMEOUT_MS);
    return { sent: true, status: res.status };
  } catch (e) {
    return { sent: false, reason: String((e && e.message) || e) };
  }
}

// 監視対象の既定値。KV の watch:endpoints があればそちらを使う。
// 2026-08-09 workers.dev から独自ドメインへ。
// 同一アカウント内では扉から workers.dev の兄弟 Worker に届かず、
// 全条件が held のまま記録され続けていた。届く道を作ってから測る。
// **扉自身もここに入れる。** 自分に同じ基準を当てられない物差しは、物差しではない。
const DEFAULT_WATCHLIST = [
  "https://mcp.horizonshield.dev/mcp",
  "https://hearing.horizonshield.dev/mcp",
  "https://web.horizonshield.dev/mcp",
  "https://jidec.horizonshield.dev/mcp",
  "https://p001.horizonshield.dev/mcp",
  "https://p002.horizonshield.dev/mcp",
  "https://gate.horizonshield.dev/mcp",
  "https://femtech.horizonshield.dev/mcp"
];

// 既定の自社分、旧来の watch:endpoints、新しい watch:registry を束ねて返す。
// 返すのは {endpoint, tier, webhook} の配列。tier は self / free / paid。
async function watchlist(env) {
  const out = [];
  const seen = new Set();
  const push = (ep, tier, webhook, extra) => {
    if (typeof ep !== "string" || seen.has(ep)) return;
    seen.add(ep);
    out.push({ endpoint: ep, tier: tier, webhook: webhook || null, ...(extra || {}) });
  };
  for (const ep of DEFAULT_WATCHLIST) push(ep, "self", null, { requested_by: "operator" });
  if (env && env.HS_VERIFY_KV) {
    try {
      const legacy = await env.HS_VERIFY_KV.get("watch:endpoints", "json");
      if (Array.isArray(legacy)) for (const ep of legacy) push(ep, "self", null, { requested_by: "operator" });
    } catch (_e) { /* KV が読めなければ既定値で続ける */ }
  }
  const reg = await readRegistry(env);
  for (const ep of Object.keys(reg)) {
    const r = reg[ep] || {};
    push(ep, r.tier === "paid" ? "paid" : "free", r.webhook || null, {
      requested_by: r.requested_by || "unrecorded (row added before 0.3.1)",
      owner_declined_at: r.owner_declined_at || null
    });
  }
  return out;
}

async function histKey(endpoint) {
  return "hist:" + (await sha256hex(endpoint)).slice(0, 16);
}

function publicReachable(v) {
  // 2026-08-20 gate58: reachable は三択。true / false / null（測っていない）。
  //   これまで `v !== false` で外に出していたので、null と undefined が true になっていた。
  //   門の側で落ちた回（gate_side）は上で null を入れている。そこを潰さない。
  if (v === true) return true;
  if (v === false) return false;
  return null;
}

// 2026-08-20 gate59. 過去のエントリは書き換えない。注記を足す。
//   entry は書いた時点で確定して KV に積まれる（recordHistory が summarise の結果を積む）。
//   だから gate58 より前に書かれた行は、いまも reachable:true のまま残っている。
//   実例: gate.horizonshield.dev/mcp の 2026-08-19T18:00:47.502Z。
//         4条件すべて measured:false（中継に届かなかった）なのに reachable:true。
//   ★消さない。書き換えない。何が書かれていて、なぜ間違いなのかを両方見せる。
const GATE58_FIX_DATE = "2026-08-20";

function entryUnmeasured(e) {
  if (!e || !e.conditions) return false;
  const cs = Object.keys(e.conditions).map((k) => e.conditions[k]);
  if (!cs.length) return false;
  return cs.every((c) => c && c.measured === false);
}

function annotateEntry(e) {
  if (!e || e.reachable !== true || !entryUnmeasured(e)) return e;
  return Object.assign({}, e, {
    reachable_note:
      "This entry stores reachable: true, but every condition on this run says measured: false, so " +
      "reachability was not established on it. Until " + GATE58_FIX_DATE + " the value was written as " +
      "(v !== false), which turned 'not measured' into true. The stored entry is left exactly as written."
  });
}

function annotateEntries(list) {
  return Array.isArray(list) ? list.map(annotateEntry) : list;
}

function annotateHistory(v) {
  if (!v || !Array.isArray(v.entries)) return v;
  const entries = annotateEntries(v.entries);
  const n = entries.filter((e) => e && e.reachable_note).length;
  const out = Object.assign({}, v, { entries: entries });
  if (n > 0) {
    out.correction = {
      at: GATE58_FIX_DATE,
      what: "Entries written before this date stored reachable as (v !== false), so a run where nothing could be measured was recorded as reachable: true.",
      fix: "gate58 made reachable three-valued: true, false, or null when it was not measured. Entries written from this date carry null on such runs.",
      affected_in_this_response: n,
      entries_are_not_edited: "Past entries keep the bytes they were written with. They carry reachable_note instead, so the record shows both what was written and why it was wrong."
    };
  }
  return out;
}

// 状態の指紋。**record_sha256 を使ってはいけない。**
// あれは checked_at を含むので毎回変わり、毎日「変化した」と誤検知する。
// 変化として意味があるのは status と各条件の合否だけ。
function stateFingerprint(record) {
  const checks = record && record.checks ? record.checks : {};
  const parts = Object.keys(checks).sort().map((k) => k + "=" + (checks[k] && checks[k].pass ? "1" : "0"));
  return (record && record.status ? record.status : "unknown") + "|" + parts.join(",");
}

function summarise(record) {
  const checks = (record && record.checks) || {};
  const out = {};
  for (const k of Object.keys(checks)) {
    // **理由を落とさない。** 赤くなった記録に理由が無いと、読み手は誤解しかできない。
    const r = checks[k] && typeof checks[k].reason === "string" ? checks[k].reason : null;
    out[k] = {
      pass: !!checks[k].pass,
      measured: checks[k].measured === false ? false : true,
      transport: checks[k].transport === true,
      reason: r ? r.slice(0, 400) : null
    };
  }
  return {
    at: record.checked_at,
    status: record.status,
    reachable: publicReachable(record.reachable),
    record_sha256: record.record_sha256,
    consent_source: record.consent_source || null,
    conditions: out,
    // 表面の指紋。fingerprint には今も入れない ,  表面の移動は条件の flip とは別種の事実だからだ。
    // ただし 2026-08-23 から、別種であることと黙っていてよいことは違うと考えを改めた。
    // 表面が動けば changed になり、通知にも /changes にも載る。MCP 仕様が tools/list の変化を
    // 正常運用と見なしているのはその通りなので、警報ではなく日付付きの事実として出す。
    surface: (checks.mcp_endpoint && checks.mcp_endpoint.detail && checks.mcp_endpoint.detail.surface) || null,
    absence_vs_failure: record.absence_vs_failure ? {
      measured: record.absence_vs_failure.measured === false ? false : true,
      tools_measured: record.absence_vs_failure.tools_measured != null ? record.absence_vs_failure.tools_measured : null,
      discriminating: record.absence_vs_failure.discriminating != null ? record.absence_vs_failure.discriminating : null,
      cannot_distinguish_pct: record.absence_vs_failure.cannot_distinguish_pct != null ? record.absence_vs_failure.cannot_distinguish_pct : null
    } : null,
    fingerprint: stateFingerprint(record),
    // 0.3.5. 判定に載せとった座標の導出が、履歴には 1 バイトも残っとらんかった(発見 2026-09-06、論文チャット)。
    // /history export は輪の原料で、verify_beacons.py と claim register C15 の入力でもある。残さんと、
    // 「導出したか、旧規則に落ちたか」を公開記録から誰も復元できん。過去の entry は触らん(entries are never edited)。
    coordinate_derivation: summariseCoordinate(record.coordinate_derivation),
    // 0.4.0. 判定の免責 2 欄を履歴にも残す(輪の原料、verify_beacons の入力)。
    establishes: Array.isArray(record.establishes) ? record.establishes : null,
    does_not_establish: Array.isArray(record.does_not_establish) ? record.does_not_establish : null
  };
}

function summariseCoordinate(cd) {
  if (!cd || typeof cd !== "object") return null;
  const b = cd.beacon && typeof cd.beacon === "object" ? cd.beacon : null;
  return {
    derived: cd.derived === true,
    window_id: cd.window_id || null,
    salt_commitment: cd.salt_commitment || null,
    salt_created_at: cd.salt_created_at || null,
    beacon: b && b.block_hash ? { height: b.height, block_hash: b.block_hash, block_time: b.block_time || null } : null,
    day_in_window: cd.day_in_window != null ? cd.day_in_window : null,
    tool_set_sha256: cd.tool_set_sha256 || null,
    tool_count: cd.tool_count != null ? cd.tool_count : null,
    fallback: cd.derived === true ? null : (cd.fallback || null),
    reason_code: cd.derived === true ? null : (cd.reason_code || null),
    why: cd.derived === true ? null : (typeof cd.why === "string" ? cd.why.slice(0, 400) : null)
  };
}

// ---- 0.4.1 (2026-09-09): the hashed bytes, published ----
// record_sha256 は「判定から record_sha256 と recompute_note を抜いて JSON.stringify したバイト」の SHA-256 やが、
// 掃引ではその判定本体を保存しとらんかった(履歴は summarise() の要約だけ)。公開しとった sha のバイトを第三者が
// 取れん状態で「再計算できる」と書いとった。SEP-1913 で vaaraio が 1024 通り試して再現できず、正しく指摘した。
// 直し: hash を取った文字列そのものを rec:<sha> に保存し、GET /record/<sha> でそのまま返す。読む側は body を
// SHA-256 するだけで path と一致する。散文の解釈が 1 文字も要らん。保存前に sha を再計算して一致を確かめる。
const RECORD_KEY_PREFIX = "rec:";
const RECORD_BYTES_SINCE = "2026-09-09";
function recordBytesUrl(sha) { return "https://gate.horizonshield.dev/record/" + sha; }
function canonicalOf(record) {
  if (record && typeof record.__canonical === "string") return record.__canonical;
  if (!record || typeof record !== "object") return null;
  const copy = {};
  for (const k of Object.keys(record)) { if (k === "record_sha256" || k === "recompute_note") continue; copy[k] = record[k]; }
  return JSON.stringify(copy);
}
async function storeRecordBytes(env, record) {
  const sha = record && typeof record.record_sha256 === "string" ? record.record_sha256 : null;
  if (!sha) return { stored: false, sha: null, reason: "record has no record_sha256" };
  if (!env || !env.HS_VERIFY_KV) return { stored: false, sha, reason: "storage not bound" };
  const canonical = canonicalOf(record);
  if (typeof canonical !== "string") return { stored: false, sha, reason: "could not serialize the record" };
  const check = await sha256hex(canonical);
  if (check !== sha) return { stored: false, sha, reason: "the record no longer hashes to its own record_sha256 (mutated after hashing); bytes not stored rather than stored wrong" };
  try {
    await env.HS_VERIFY_KV.put(RECORD_KEY_PREFIX + sha, canonical);
    return { stored: true, sha, reason: null };
  } catch (e) {
    return { stored: false, sha, reason: "KV write failed: " + String(e && e.message || e).slice(0, 120) };
  }
}
async function readRecordBytes(env, sha) {
  if (!env || !env.HS_VERIFY_KV) return null;
  try { return await env.HS_VERIFY_KV.get(RECORD_KEY_PREFIX + sha, "text"); } catch (_e) { return null; }
}

async function recordHistory(env, endpoint, record) {
  if (!env || !env.HS_VERIFY_KV) return null;
  const key = await histKey(endpoint);
  let prev = null;
  try { prev = await env.HS_VERIFY_KV.get(key, "json"); } catch (_e) {}
  const entries = (prev && Array.isArray(prev.entries)) ? prev.entries : [];
  const last = entries.length ? entries[entries.length - 1] : null;
  const entry = summarise(record);
  // 0.4.1. 判定の hash 対象バイトを sha 宛てに保存し、この entry からそこを指す。保存できんかったら理由を残す。
  const stored = await storeRecordBytes(env, record);
  entry.record_url = stored.stored ? recordBytesUrl(stored.sha) : null;
  if (!stored.stored) entry.record_bytes_note = stored.reason;

  // 表面が前回と違えば、日付付きの差分をこのエントリ自身に残す。
  // 指標にしない。回数も割合も作らない。何が増え、何が消え、何の définition が変わったか、だけ。
  // 両方 complete のときだけ比較する ,  部分読みとの比較から「削除」を出さない。
  const prevSurface = last && last.surface ? last.surface : null;
  if (entry.surface && prevSurface && entry.surface.complete === true && prevSurface.complete === true
      && entry.surface.manifest_hash !== prevSurface.manifest_hash) {
    const prevT = prevSurface.tool_hashes || {};
    const curT = entry.surface.tool_hashes || {};
    entry.surface_change = {
      added: Object.keys(curT).filter((k) => !(k in prevT)),
      removed: Object.keys(prevT).filter((k) => !(k in curT)),
      definition_changed: Object.keys(curT).filter((k) => (k in prevT) && curT[k] !== prevT[k]),
      note: "The tool surface changed between measurements. This is a dated fact, not a defect: the MCP specification treats tool-list changes as normal operation (notifications/tools/list_changed). Recorded for anyone; judged by no one."
    };
  }

  // 2026-08-23. ここまで、変化の判定は status と5条件の合否だけを見ていた。
  // だから「ツール名はそのまま、inputSchema だけ差し替えた」変更は、5条件を全部通したまま
  // 変化ゼロとして扱われ、通知も出ず /changes にも載らなかった。統合を黙って壊す変更の第一位が、
  // 計算され、履歴に書き込まれ、そのまま誰にも知らされていなかった。
  // 測って保存して黙っているのは、測っていないのとほとんど変わらない。表面の移動も変化に数える。
  const surfaceMoved = !!entry.surface_change;
  const changed = !last || last.fingerprint !== entry.fingerprint || surfaceMoved;
  let lastFlips = [];
  entries.push(entry);
  while (entries.length > HISTORY_MAX) entries.shift();

  try {
    await env.HS_VERIFY_KV.put(key, JSON.stringify({ endpoint, entries }));
  } catch (_e) { /* 書けなくても判定は返す */ }

  // 到達できなかった回が連続で何回続いたか。1回の回線の詰まりで赤い通知を飛ばさない。
  // **誤報を1回でも出した監視に、二度目の金は払われない。**
  let streak = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i] && entries[i].reachable === false) streak++;
    else break;
  }
  const suppressed = entry.reachable === false && streak < CONFIG.unreachable_streak;

  if (changed && last) {
    // 初回は「変化」ではない。前があって違ったときだけ記録する。
    // **何が変わったかを書く。** status だけでは pending -> pending にしかならず、
    // 通知を受け取る側に一番必要な情報が抜ける。
    const flips = [];
    const keys = new Set(Object.keys(last.conditions || {}).concat(Object.keys(entry.conditions || {})));
    for (const k of keys) {
      const before = last.conditions && last.conditions[k] ? last.conditions[k].pass : null;
      const after = entry.conditions && entry.conditions[k] ? entry.conditions[k].pass : null;
      if (before !== after) {
        flips.push({ condition: k, from: before, to: after });
      }
    }
    lastFlips = flips;
    let changes = [];
    try { changes = (await env.HS_VERIFY_KV.get("changes:recent", "json")) || []; } catch (_e) {}
    // 表面の移動を、条件の反転と同じ重さで書く。読み手にとってはこちらの方が実害が早い。
    const sc = entry.surface_change || null;
    const scBits = [];
    if (sc) {
      if (sc.added && sc.added.length) scBits.push(sc.added.length + " tool added");
      if (sc.removed && sc.removed.length) scBits.push(sc.removed.length + " tool removed");
      if (sc.definition_changed && sc.definition_changed.length) {
        scBits.push(sc.definition_changed.length + " tool definition changed (" + sc.definition_changed.slice(0, 3).join(", ") + ")");
      }
    }
    const flipBits = flips.map((f) => f.condition + " " + (f.from ? "pass" : "fail") + " to " + (f.to ? "pass" : "fail"));
    changes.push({
      at: entry.at,
      endpoint,
      status_from: last.status,
      status_to: entry.status,
      conditions_changed: flips,
      surface_changed: sc,
      reachable: publicReachable(entry.reachable),
      unreachable_streak: streak,
      alert_suppressed: suppressed,
      summary: flipBits.concat(scBits).join(", ") || "status changed with no condition flip",
      ...(sc && !flips.length ? {
        note: "The declared surface moved while every condition still passed. A verdict alone would not have shown this, and it is the shape of change that breaks an integration without breaking a badge."
      } : {})
    });
    while (changes.length > CHANGES_MAX) changes.shift();
    try { await env.HS_VERIFY_KV.put("changes:recent", JSON.stringify(changes)); } catch (_e) {}
  }
  // 3回連続で到達不能になった時点で、ちょうど1回だけ鳴らす。
  // 指紋は2回目以降変わらないので、changed だけを見ていると永久に鳴らない。
  const crossed = entry.reachable === false && streak === CONFIG.unreachable_streak;
  return {
    changed: changed && !!last,
    alertable: (changed && !!last && !suppressed) || crossed,
    unreachable_streak: streak,
    entry,
    flips: lastFlips
  };
}

async function readHistory(env, endpoint) {
  if (!env || !env.HS_VERIFY_KV) {
    return { endpoint, entries: [], note: "History storage is not bound on this deployment, so nothing has been recorded yet." };
  }
  const key = await histKey(endpoint);
  try {
    const v = await env.HS_VERIFY_KV.get(key, "json");
    if (v) return annotateHistory(v);
  } catch (_e) {}
  return { endpoint, entries: [], note: "No history recorded for this endpoint yet. It may not be on the watchlist." };
}

async function readChanges(env) {
  if (!env || !env.HS_VERIFY_KV) {
    return { changes: [], note: "History storage is not bound on this deployment." };
  }
  try {
    const v = await env.HS_VERIFY_KV.get("changes:recent", "json");
    return {
      changes: v || [],
      note: "Changes recorded by the scheduled re-measurement. A change means either that a condition flipped, or that the declared tool surface moved. It never means that a fresh verdict was simply issued.",
      why_surface_matters: "A server can keep every tool name, swap what a tool accepts, and still pass all five conditions. That change breaks the code calling it and breaks no badge, so it is reported here with the same weight as a flip. Entries carry surface_changed with the tools added, removed, or redefined.",
      not_a_judgement: "The MCP specification treats tool list changes as normal operation. Nothing here says a change was wrong. It says a change happened, and on what date."
    };
  } catch (_e) {
    return { changes: [], note: "could not read changes" };
  }
}

// 毎日の再測定。**同意のないエンドポイントには allow_tool_call を決して渡さない。**
// 同意済み (TOOL_CALL_CONSENT) だけ determinism まで測る。同意の有無は判定に影響するので、
// 各行の応答に tool_call_consent として開示する。隠れた優遇に見えないようにするためだ。
// 0.4.0 (2026-09-07). 塩の commitment を台帳に錨打ちする。0.3.5 までは /nenrin/window に載せるだけで
// 「錨は次の仕事」と自分で書いとった。addendum instants v1 の言うとおり、commitment は窓が開く前に
// 錨が要る(後から塩を選び直せんことの証明は、窓より前の block にしか無い)。
// 新しい server code は要らん: 台帳の witness intake に、conduct-v1.1 の commitment 型の記録を 1 本出すだけ
// (census と同じ手)。翌 00:30Z の束ねが Bitcoin に刻む。窓ごとに 1 回、結果は KV に残して /nenrin/window に出す。
// base に窓のページを書く(origin だけにすると、輪の builder が扉自身の endpoint の証人として数える)。
const COMMITMENT_INTAKE = "https://ledger.horizonshield.dev/witness";
async function fileInstantCommitment(env, wid, st, nowMs, fetchImpl) {
  if (!env || !env.HS_VERIFY_KV || !wid || !st || !st.commitment) return null;
  const key = "nenrin:commitfiled:" + wid;
  let prev = null;
  try { prev = await env.HS_VERIFY_KV.get(key, "json"); } catch (_e) { prev = null; }
  if (prev && prev.sha) return prev;
  const bounds = nenrin.windowBounds(wid);
  const filedAt = new Date(nowMs).toISOString();
  const beforeOpen = filedAt < bounds.opens_at;
  const record = {
    schema: "jidec-path-v1",
    purpose: "nenrin-instant-commitment-v1: " + wid,
    walked_at: st.salt_created_at,
    walker: { tool: "hs-verify-gate", version: CONFIG.version },
    base: "https://gate.horizonshield.dev/nenrin/window/" + wid,
    witness: { name: "gate.horizonshield.dev", vantage: "cloudflare-worker" },
    mode: "commitment",
    commitment: st.commitment,
    commitment_recipe: "sha256('nenrin-instant-salt-v1:' + salt); the salt is served at base once the window has closed",
    window: { window_id: wid, opens_at: bounds.opens_at, closes_at: bounds.closes_at },
    filed_at: filedAt,
    establishes: [
      "salt commitment " + st.commitment + " for window " + wid + " existed at " + st.salt_created_at + " and was filed at " + filedAt + (beforeOpen ? ", before the window opens at " : ", after the window opened at ") + bounds.opens_at,
      "once the ledger batch that holds this record is confirmed in a Bitcoin block, the block height bounds the commitment from above: the salt could not have been chosen after that block"
    ],
    does_not_establish: [
      "the salt itself until the window closes and the gate reveals it at base",
      "that any measurement in the window was taken; each verdict carries its own coordinate_derivation",
      beforeOpen ? "anything about blocks mined before the ledger batch is confirmed" : "that the commitment preceded the window: this one was filed after the window opened and says so"
    ]
  };
  const body = canonicalJson(record);
  let res = null, j = null;
  try {
    const f = fetchImpl || fetch;
    const r = await f(COMMITMENT_INTAKE, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ record_canonical: body }) });
    res = r.status;
    j = await r.json().catch(() => null);
  } catch (e) {
    res = 0; j = { error: String((e && e.message) || e).slice(0, 200) };
  }
  const out = { window_id: wid, commitment: st.commitment, filed_at: filedAt, before_open: beforeOpen, http: res,
    sha: j && j.sha ? j.sha : null, url: j && j.url ? j.url : null, counted: j && j.counted != null ? j.counted : null,
    error: (res === 200 || res === 201) ? null : (j && (j.error || j.reason_code) ? String(j.error || j.reason_code) : "intake unreachable") };
  try { await env.HS_VERIFY_KV.put(key, JSON.stringify(out)); } catch (_e) {}
  return out;
}
async function commitmentFiled(env, wid) {
  if (!env || !env.HS_VERIFY_KV || !wid) return null;
  try { return await env.HS_VERIFY_KV.get("nenrin:commitfiled:" + wid, "json"); } catch (_e) { return null; }
}

async function runDailySweep(env, opts) {
  const now = Date.now();
  const force = !!(opts && opts.force);
  const list = await watchlist(env);
  // 0.4.0. subrequest の予算。掃引の間だけ数える。
  const budget = Number(env && env.SUBREQUEST_BUDGET) || SUBREQUEST_BUDGET_DEFAULT;
  sweepBudget = { used: 0 };
  try {

  // 0.3.0. 窓の座標をここで 1 回だけ組む。以後これを下へ通す。
  // 取れんかったら旧規則に落ちるが、落ちたことは掃引の記録に残す。
  let coord = null;
  try { coord = await nenrin.coordinate(env.HS_VERIFY_KV, now, countingFetch); } catch (e) { coord = null; }
  // 0.4.0. 次の窓(先。開く前に錨が要るのはこっち)と、まだ出しとらんなら今の窓の commitment を台帳に出す。
  // 失敗しても掃引は止めん、結果は記録に残す。窓ごとに 1 本なので、予算に乗るのは初回の掃引だけ。
  const commitments = [];
  if (coord) {
    for (const w of [coord.next_window, { window_id: coord.window_id, commitment: coord.commitment, salt_created_at: coord.salt_created_at }]) {
      if (!w || !w.window_id || !w.commitment) continue;
      try { const r = await fileInstantCommitment(env, w.window_id, w, now, countingFetch); if (r) commitments.push(r); } catch (_e) {}
    }
  }
  const cadenceNote = (coord && coord.derived)
    ? "not due today (derived: the day is HMAC-derived from a committed salt bound to a Bitcoin block, so the subject cannot predict it)"
    : "not due today (legacy computable schedule: the subject can predict this, disclosed rather than hidden)";

  const due = [];
  const skipped = [];
  for (const w of list) {
    if (force || (await isDueToday(w.endpoint, w.tier, now, coord))) due.push(w);
    else skipped.push({ endpoint: w.endpoint, tier: w.tier, reason: cadenceNote });
  }
  // 0.3.1. 順番は「一番長く測っとらん物から」。それまでは登録簿の並び順で、自前 8 台(日次)が
  // MAX_PER_SWEEP=8 を毎日使い切り、外部の行は順番が来ても「over MAX_PER_SWEEP」で永久に落ちる形やった。
  // 0.3.0 で 9 → 8 に下げた日に、無料層の唯一の席が消えとった。測ったことが無い行が最初、次に古い順。
  // 同点は登録簿の並び順。溢れた分は必ず記録する。黙って切ると「全部測った」ように読める。
  const lastAt = new Map();
  for (const w of due) {
    let at = "";
    try {
      const h = await readHistory(env, w.endpoint);
      const es = (h && Array.isArray(h.entries)) ? h.entries : [];
      at = es.length ? String(es[es.length - 1].at || "") : "";
    } catch (_e) { at = ""; }
    lastAt.set(w.endpoint, at);
  }
  due.sort((a, b) => {
    const x = lastAt.get(a.endpoint) || "", y = lastAt.get(b.endpoint) || "";
    return x < y ? -1 : (x > y ? 1 : 0);
  });
  for (const w of due.slice(MAX_PER_SWEEP)) {
    skipped.push({ endpoint: w.endpoint, tier: w.tier, reason: "over MAX_PER_SWEEP for this run (order is least recently measured first; this endpoint was last measured " + (lastAt.get(w.endpoint) || "never") + ", so it goes first next time)" });
  }
  const run = due.slice(0, MAX_PER_SWEEP);

  const results = [];
  let notifiesSent = 0;
  for (const w of run) {
    // 0.4.0. 残りの予算が 1 行分を切ったら測らん。途中で切れた測定を履歴に載せるより、測らんかった事実を書く方が正しい。
    const remaining = budget - sweepBudget.used;
    if (remaining < SUBREQUEST_PER_ENDPOINT) {
      skipped.push({ endpoint: w.endpoint, tier: w.tier, reason: "subrequest budget: " + sweepBudget.used + " of " + budget + " used before this row (the window's first sweep fetches the beacon from three sources and files the commitments; each measured row costs about " + SUBREQUEST_PER_ENDPOINT + "). An overrun aborts a measurement half way, so this row was not measured and goes first next time (order is least recently measured first)" });
      continue;
    }
    try {
      // 0.2.4. 手書きの Set か、origin の well-known ファイル。申告は掃引では決して使わん。
      const consent = await resolveConsent(w.endpoint);
      // 0.3.1. 所有者が origin の well-known で listing: decline を出しとる行は測らん。断った事実だけ残す。
      if (consent.declined_listing) {
        skipped.push({ endpoint: w.endpoint, tier: w.tier, reason: "owner declined measurement: " + CONSENT_WELL_KNOWN_PATH + " on the origin sets listing to decline. The row stays on the register and says so; nothing was measured and no verdict exists." });
        await markDeclined(env, w.endpoint, true);
        continue;
      }
      await markDeclined(env, w.endpoint, false);
      await markDeclared(env, w.endpoint, consent.declared || null);
      const record = await runCheck(w.endpoint, consent.consent, consent.basis, consent.source, consent, coord);
      const r = await recordHistory(env, w.endpoint, record);
      const changed = !!(r && r.changed);
      const alertable = !!(r && r.alertable);
      let notified = null;
      if (alertable && w.webhook) {
        notified = await notifyChange(w.webhook, {
          event: "conformance_change",
          endpoint: w.endpoint,
          at: r.entry.at,
          status: r.entry.status,
          reachable: publicReachable(r.entry.reachable),
          conditions_changed: r.flips || [],
          surface_changed: (r.entry && r.entry.surface_change) || null,
          history: "/history?endpoint=" + encodeURIComponent(w.endpoint),
          note: "The verdict is free and public. What you are paying for is being told, and being measured daily. " +
            "surface_changed is present when the declared tool surface moved, which can happen while every condition still passes."
        });
      }
      // 0.4.0 (conduct-v1.1 notify). 所有者が well-known に notify を置いとる行には、測るたびに要約を飛ばす。
      // 判定は変わらん。飛ばした事実と結果(status か、飛ばさんかった理由)を notify_status に残す。
      let notifyStatus = null;
      const decl = consent && consent.declared && consent.declared.notify;
      if (decl) {
        if (!decl.url) notifyStatus = { sent: false, reason: decl.why };
        else if (notifiesSent >= NOTIFY_MAX_PER_SWEEP) notifyStatus = { sent: false, reason: "deferred: over NOTIFY_MAX_PER_SWEEP (" + NOTIFY_MAX_PER_SWEEP + ") for this run" };
        else {
          notifiesSent += 1;
          notifyStatus = await notifyMeasured(env, w.endpoint, decl.url, {
            event: "measured",
            endpoint: w.endpoint,
            at: r && r.entry ? r.entry.at : record.checked_at,
            status: record.status,
            reachable: publicReachable(record.reachable),
            record_sha256: record.record_sha256 || null,
            changed,
            conditions_changed: (r && r.flips) || [],
            surface_changed: (r && r.entry && r.entry.surface_change) || null,
            establishes: record.establishes || null,
            does_not_establish: record.does_not_establish || null,
            history: "https://gate.horizonshield.dev/history?endpoint=" + encodeURIComponent(w.endpoint),
            lookup: "https://gate.horizonshield.dev/register/lookup?endpoint=" + encodeURIComponent(w.endpoint),
            note: "Sent because " + CONSENT_WELL_KNOWN_PATH + " on your origin names this URL as notify (conduct-v1.1). Sent after every scheduled measurement, at most once per hour per endpoint, never from an on-demand /check. Remove the field to stop. The verdict is public either way."
          }, now, countingFetch);
        }
      }
      results.push({ endpoint: w.endpoint, tier: w.tier, status: record.status, reachable: publicReachable(record.reachable), changed, surface_changed: (r.entry && r.entry.surface_change) || null, alert_suppressed: changed && !alertable, notified, notify_status: notifyStatus });
    } catch (e) {
      results.push({ endpoint: w.endpoint, tier: w.tier, error: String((e && e.message) || e) });
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  const out = {
    ran: true,
    at: new Date(now).toISOString(),
    watched_total: list.length,
    measured: results.length,
    // 0.3.5. この掃引がどの規則で走ったか、なぜ落ちたか、次の窓の commitment。skipped の文だけに頼らん。
    coordinate: coord ? {
      derived: coord.derived === true,
      window_id: coord.window_id || null,
      rule: coord.rule ? { rule: coord.rule.rule, pinned_at: coord.rule.pinned_at, reason: coord.rule.reason || null, reason_code: coord.rule.reason_code || null } : null,
      commitment: coord.commitment || null,
      salt_created_at: coord.salt_created_at || null,
      beacon: coord.beacon && coord.beacon.block_hash ? { height: coord.beacon.height, block_hash: coord.beacon.block_hash, block_time: coord.beacon.block_time || null, reference: coord.beacon.reference || null } : null,
      reason_code: coord.derived === true ? null : (coord.reason_code || null),
      why: coord.derived === true ? null : (coord.why || null),
      sources: coord.beacon && Array.isArray(coord.beacon.sources) ? coord.beacon.sources : null,
      next_window: coord.next_window || null,
      salts_created_now: coord.salts_created_now || [],
      // 0.4.0. この掃引で台帳に出した(か、既に出しとった)commitment の記録。
      commitments_filed: commitments,
      window: "/nenrin/window"
    } : { derived: false, why: "coordinate() failed before the sweep; legacy schedule; see /nenrin/window" },
    // 0.4.0. この掃引が使った subrequest の数と予算。溢れた行は skipped に "subrequest budget" で載る。
    subrequests: { used: sweepBudget.used, budget, per_endpoint_reserve: SUBREQUEST_PER_ENDPOINT, note: "Workers Free allows 50 fetches per invocation; an overrun throws mid-measurement. Rows the budget could not cover are in skipped with the reason and go first next time." },
    results,
    skipped
  };
  if (env && env.HS_VERIFY_KV) {
    try { await env.HS_VERIFY_KV.put("sweep:last", JSON.stringify(out)); } catch (_e) {}
  }
  return out;
  } finally { sweepBudget = null; }
}

// ---- MCP インターフェース ----
// 扉は HTTP チェッカーであると同時に MCP サーバーでもある。
// MCP クライアントから「このサーバーは適合しているか」を会話中に確かめられる。

// Declared so a consumer can tell, from the contract alone, which answers this
// gate is able to distinguish. Every field named here already existed in the
// objects these tools return ,  nothing about a verdict changes, so a published
// record_sha256 still recomputes to the same value.
const GATE_CONDITIONS_SCHEMA = {
  type: "object",
  description:
    "Deterministic. Takes no arguments, looks nothing up, and returns the same document " +
    "every time. It therefore declares no read-state field, and a structural probe will " +
    "score it as unable to hold the difference between a failed read and an empty one. " +
    "That score is correct and is left standing: this tool has no read to fail. Adding a " +
    "state field it can never use would make the number look better and mean less.",
  properties: { conditions: { type: ["array", "object"] }, not_verified: { type: ["array", "object", "string"] }, tiers: { type: ["array", "object"] } },
  additionalProperties: true,
};
const GATE_CHECK_SCHEMA = {
  type: "object",
  properties: {
    endpoint: { type: "string" },
    reachable: {
      description:
        "Three-valued on purpose (gate58). true = measured and answered. false = measured " +
        "and did not answer. null = NOT MEASURED. null is never to be read as a failing " +
        "endpoint; it means this gate has nothing to say.",
    },
    pass: { type: ["boolean", "null"] },
    conditions: { type: ["array", "object"] },
    record_sha256: { type: "string", description: "Hash of this verdict with record_sha256 and recompute_note removed. Recompute it yourself; verify_verdict does the same arithmetic." },
    recompute_note: { type: "string" },
  },
  additionalProperties: true,
};
const GATE_VERIFY_SCHEMA = {
  type: "object",
  properties: {
    verified: { type: ["boolean", "null"], description: "true = the verdict hashes to its own record_sha256, so it was not altered after issue. false = it was altered. This is a finding about the record, not an error." },
    method: { type: "string" },
    note: { type: "string" },
  },
  additionalProperties: true,
};
const GATE_LOOKUP_SCHEMA = {
  type: "object",
  properties: {
    endpoint: { type: "string" },
    on_register: {
      type: "boolean",
      description:
        "true = this endpoint is on the register. false = the register was READ and this " +
        "endpoint is not on it. If the register could not be read at all, this field is " +
        "not returned: the call comes back as a tool error (isError), because absence and " +
        "not-knowing are different answers.",
    },
    register_size: { type: "number" },
    standing: { type: ["string", "null"] },
    latest: { type: ["object", "null"] },
    means: { type: ["string", "object"] },
    does_not_mean: { type: ["string", "object"] },
  },
  additionalProperties: true,
};
// チャッピ提案①/設計図§3(b): エージェントが「接続前に一目で」読むための crisp な判定形の outputSchema。
// この扉の最新ツールなので、条件06のお手本にする: state の enum が「verified/pending/held/watched/absent」を
// 区別し、照会そのものの失敗は isError(tool error)へ落とす。空(absent)と失敗と合格が同じ値に潰れない。
const GATE_ISVERIFIED_SCHEMA = {
  type: "object",
  description:
    "A one-glance answer for an agent deciding whether to trust an MCP endpoint BEFORE connecting. " +
    "Reads the register only; measures nothing. verified is true ONLY when the latest scheduled " +
    "measurement passed every measured condition; it is null in every other case (pending, held, " +
    "watched, absent), and never false, because this gate calls nothing a failure. The state enum " +
    "says which case it is, so a consumer can tell 'not verified here' apart from 'the lookup failed' " +
    "(that returns as a tool error, isError) and from 'measured and passing'.",
  properties: {
    endpoint: { type: "string" },
    verified: { type: ["boolean", "null"], description: "true = latest measurement passed all measured conditions. null = not established here (see state). Never false: unmeasured or not-yet-passing is not a failure." },
    state: { type: "string", enum: ["verified", "pending", "held", "watched", "absent"], description: "verified = passed all measured conditions. pending = measured but not passing every one (often only because determinism needs the owner's consent). held = could not be reached. watched = on the list, not yet measured. absent = no row here at all." },
    on_register: { type: "boolean" },
    measured_at: { type: ["string", "null"] },
    record_sha256: { type: ["string", "null"], description: "Hash of the latest verdict. Recompute it via recompute_url; no trust in this gate required." },
    recompute_url: { type: "string" },
    conditions: { type: ["object", "null"] },
  },
  additionalProperties: true,
};

const MCP_TOOLS = [
  {
    // **1本目に置くのは意図的。** 引数を取らず、読み取り専用で、毎回同じ結果を返す。
    // 他所の適合チェッカーが1本目を空引数で叩いても、何も壊れず決定論的に応答する。
    name: "get_conditions",
    outputSchema: GATE_CONDITIONS_SCHEMA,
    title: "Get the conformance conditions",
    annotations: { title: "Get the conformance conditions", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description:
      "Return the five conditions this gate measures, what it explicitly does not verify, " +
      "and the tier definitions. Takes no arguments and returns identical output every time. " +
      "Read this before running a check so you know what a verdict does and does not claim.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "check_conformance",
    outputSchema: GATE_CHECK_SCHEMA,
    title: "Check an MCP server for conformance and disclosure",
    annotations: { title: "Check an MCP server for conformance and disclosure", readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    description:
      "Measure a public MCP endpoint against five conditions: it speaks MCP, it publishes an A2A " +
      "agent card, it declares who pays it, identical input returns identical output, and the " +
      "verdict itself can be recomputed by anyone. Free, no key. Conformance and disclosure only; " +
      "this says nothing about whether any figure the checked server returns is correct. " +
      "By default no tool on the checked server is called, so determinism comes back as not " +
      "measured rather than guessed. Set allow_tool_call true only for a server you control.",
    inputSchema: {
      type: "object",
      properties: {
        endpoint: { type: "string", description: "https URL of the MCP endpoint to measure" },
        allow_tool_call: {
          type: "boolean",
          description: "Consent to executing one tool on the checked server, twice, with empty arguments. Only set this for a server you own. Default false."
        }
      },
      required: ["endpoint"],
      additionalProperties: false
    }
  },
  {
    name: "verify_verdict",
    outputSchema: GATE_VERIFY_SCHEMA,
    title: "Recompute a verdict hash without trusting the issuer",
    annotations: { title: "Recompute a verdict hash without trusting the issuer", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description:
      "Take a verdict this gate issued and recompute its record_sha256 independently. Removes " +
      "record_sha256 and recompute_note, serialises the remainder in key order, and hashes it. " +
      "Returns whether the verdict was altered after it was issued. You do not have to trust the " +
      "party that issued the verdict, including this one.",
    inputSchema: {
      type: "object",
      properties: {
        record: { type: "object", description: "The full verdict object as returned by check_conformance or GET /self" }
      },
      required: ["record"],
      additionalProperties: false
    }
  },
  {
    // ★2026-08-14 追加。エージェントが加盟者を引けるようにする。
    //   ここが無いと、レジストリは人間が読むページのままで、
    //   「機械が選ぶ時代のための記録」という主張が自分の実装で裏切られる。
    //   新しい保存はしない。既にある watch:registry と hist:* を読むだけ。
    name: "lookup_server",
    outputSchema: GATE_LOOKUP_SCHEMA,
    title: "Look up an MCP server on this register",
    annotations: { title: "Look up an MCP server on this register", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description:
      "Look up what this register already holds about an MCP endpoint: whether it is watched, how " +
      "often it is re-measured, how many measurements exist, when the first and latest were taken, " +
      "and the latest verdict with the record_sha256 you can recompute yourself. Reads stored " +
      "measurements only. It contacts nothing and measures nothing, so use check_conformance " +
      "for a fresh reading. An endpoint that is absent is reported as absent and that is NOT a " +
      "negative verdict: it means nobody has measured it here, not that it failed.",
    inputSchema: {
      type: "object",
      properties: {
        endpoint: { type: "string", description: "https URL of the MCP endpoint to look up, exactly as it appears on the register" }
      },
      required: ["endpoint"],
      additionalProperties: false
    }
  },
  {
    // ★2026-08-21 追加(チャッピ提案①/設計図§3(b)・§4)。
    //   既存 lookup_server は情報量が多い。エージェントが「接続前に一目で」判断するための
    //   crisp な形が要る、というのが提案の核。lookup_server を投影するだけ。新しい測定も保存もしない。
    //   verified は tier_pass のときだけ true、それ以外は null(pending も held も absent も)。
    //   「載っている=合格」「測っていない=不合格」を絶対に作らない fail-closed。判定は売り物ではない。
    name: "is_verified",
    outputSchema: GATE_ISVERIFIED_SCHEMA,
    title: "One glance: is this MCP server verified, with proof",
    annotations: { title: "One glance: is this MCP server verified, with proof", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description:
      "A single machine-first answer for an agent deciding whether to trust an MCP endpoint BEFORE it " +
      "connects. Returns verified (true only when the latest scheduled measurement passed every measured " +
      "condition; null otherwise, never false), a state enum saying which case it is, measured_at, and a " +
      "record_sha256 with a recompute_url so you can check the verdict without trusting this gate. Reads " +
      "the stored register only: it contacts nothing and measures nothing. Absent and pending are reported " +
      "honestly and are NOT negative verdicts. For a fresh measurement rather than the stored one, use " +
      "check_conformance.",
    inputSchema: {
      type: "object",
      properties: {
        endpoint: { type: "string", description: "https URL of the MCP endpoint to look up, exactly as it appears on the register" }
      },
      required: ["endpoint"],
      additionalProperties: false
    }
  }
];

function mcpText(obj) {
  return { content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] };
}

// Federico Blanco Sanchez-Llanos, "The Mould, Not the Letter", 2026-08-20:
//   never let "the fetch failed" and "the fetch succeeded and found nothing"
//   collapse into the same downstream value.
//
// Measured 2026-08-20. This gate already knew the difference and said it in
// prose ,  lookup_server literally answers "It is not reporting absence, because
// it does not know." But all ten failure payloads rode home in the SUCCESS
// channel: a JSON-RPC result with no isError, carrying {error: "..."} buried in
// a text block. A human reader could tell. A machine consumer, which is exactly
// who this directory is built for, read "the call succeeded".
// The gate that measures other people could not be measured correctly itself.
//
// mcpFail puts a failure where a machine looks for one. mcpOk carries
// structuredContent so a success is readable without parsing prose.
// Neither changes any verdict object, so record_sha256 stays recomputable.
function mcpFail(obj) {
  return {
    content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }],
    isError: true,
  };
}
function mcpOk(obj) {
  const structured = obj && typeof obj === "object" && !Array.isArray(obj) ? obj : { value: obj };
  return {
    content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }],
    structuredContent: structured,
  };
}

async function verifyVerdict(record) {
  if (!record || typeof record !== "object") {
    return { verified: false, reason: "record must be an object" };
  }
  const expected = record.record_sha256;
  if (!expected) {
    return { verified: false, reason: "record has no record_sha256 to check against" };
  }
  const copy = JSON.parse(JSON.stringify(record));
  delete copy.record_sha256;
  delete copy.recompute_note;
  const got = await sha256hex(JSON.stringify(copy));
  return {
    verified: got === expected,
    expected_sha256: expected,
    recomputed_sha256: got,
    method: "Remove record_sha256 and recompute_note, JSON.stringify the remainder in key order, SHA-256.",
    note: got === expected
      ? "record_sha256 matches a recompute of this record. This proves only internal self-consistency (the body hashes to its own stored digest); it is NOT proof of authorship or that this gate issued it ,  anyone can compute the same hash with the public method above. For issuer authenticity/anchoring, rely on the JIDEC ledger, not this unkeyed checksum."
      : "Mismatch. The verdict was altered after it was issued, or it was not issued by this gate. Reject it."
  };
}

// レジストリ照会。**測らない。既に保存されているものを読むだけ。**
// 未登録を「不合格」として返さないことが、この関数のいちばん大事な仕様である。
const LOOKUP_HISTORY_MAX_RETURN = 20;

async function lookupServer(env, endpoint) {
  const wl = await watchlist(env);
  const watched = wl.find((w) => w && w.endpoint === endpoint) || null;
  const reg = await readRegistry(env);
  const regEntry = reg[endpoint] || null;
  const hist = await readHistory(env, endpoint);
  const entries = (hist && Array.isArray(hist.entries)) ? hist.entries : [];
  const latest = entries.length ? entries[entries.length - 1] : null;

  const historyUrl = "https://gate.horizonshield.dev/history?endpoint=" + encodeURIComponent(endpoint);

  if (!watched && !regEntry && !entries.length) {
    return {
      endpoint: endpoint,
      on_register: false,
      register_size: wl.length,
      means:
        "This register holds no measurements for this endpoint.",
      does_not_mean:
        "This is not a verdict and not a blacklist. An absent row means nobody has measured this " +
        "endpoint here, not that it was measured and failed. Do not treat absence as a negative " +
        "signal about the server or the people who run it.",
      how_to_appear:
        "Anyone can add it, including someone who does not own it, because the check is read-only " +
        "and calls no tool: POST https://gate.horizonshield.dev/watch with " +
        "{\"endpoint\":\"" + endpoint + "\"}. Free, weekly re-measurement, no account and no fee.",
      fresh_reading: "Call check_conformance with this endpoint to measure it right now."
    };
  }

  const tier = watched ? watched.tier : (regEntry && regEntry.tier === "paid" ? "paid" : "free");
  return {
    endpoint: endpoint,
    on_register: true,
    tier: tier,
    cadence: tier === "paid" ? "daily" : (tier === "self" ? "daily" : "weekly"),
    added_at: (regEntry && regEntry.added_at) || null,
    alerted_on_change: !!(watched && watched.webhook) || !!(regEntry && regEntry.webhook),
    measurements: entries.length,
    // 監視対象に入っていることと、測られたことは別である。
    // ここを混ぜた瞬間に「載っている=合格」という読み方が生まれる。
    standing: entries.length
      ? "measured"
      : "watched, not yet measured. Being on the watchlist is not a measurement and this gate does not count it as one",
    first_measured_at: entries.length ? entries[0].at : null,
    last_measured_at: latest ? latest.at : null,
    latest: annotateEntry(latest),
    history: annotateEntries(entries.slice(-LOOKUP_HISTORY_MAX_RETURN)),
    history_truncated: entries.length > LOOKUP_HISTORY_MAX_RETURN,
    full_history_url: historyUrl,
    means:
      "A row is a series of measurements taken at stated times, each carrying a record_sha256 you " +
      "can recompute without trusting this gate. The dates are the point: they cannot be created " +
      "retroactively, so a long row is evidence of duration and nothing else can substitute for it.",
    does_not_mean:
      "Not a certificate, and not a statement that any figure this server returns is correct. This " +
      "measures conduct and disclosure only. A passing row stops passing when the measurement does, " +
      "and a condition recorded as not measured is never counted as a pass, including for the " +
      "gate itself, whose own verdict currently reads pending."
  };
}

// crisp な判定形。lookupServer を投影するだけ。測らない・保存しない・課金しない。
// verified は tier_pass のときだけ true。それ以外は必ず null(never false)。
// pending は「測ったが全条件は通っていない」で、多くは determinism が同意なしで未測定なだけ。
// これを false にすると「載っている大半が失敗」に見えてしまい中立が死ぬので、null にする。
async function isVerified(env, endpoint) {
  const lu = await lookupServer(env, endpoint);
  const history_url = "https://gate.horizonshield.dev/history?endpoint=" + encodeURIComponent(endpoint);
  // 0.4.1. 再計算の先は hash 対象のバイトそのもの(record_url)。無い entry(0.4.1 より前)は履歴を指すが、
  // 履歴の entry は要約であって hash 対象やない。そのことを recompute_note に書く。
  const record_url = (lu.latest && typeof lu.latest.record_url === "string") ? lu.latest.record_url : null;
  const recompute_url = record_url || history_url;
  const base = {
    endpoint: endpoint,
    gate: "MCP Verification Gate",
    gate_commit: gateCommit(),
    recompute_url: recompute_url,
    record_url: record_url,
    history_url: history_url,
    recompute_note: record_url
      ? "GET record_url. The body is the verdict with record_sha256 and recompute_note removed, exactly as hashed. SHA-256 of that body equals record_sha256. This response is a projection of that record and is not the hashed bytes."
      : "The latest stored verdict predates " + RECORD_BYTES_SINCE + ", when this gate began storing the hashed bytes; its record_sha256 names bytes no longer held here and cannot be recomputed from any published object. History entries are summaries, not the hashed record. The next scheduled measurement will carry record_url. This response is a projection and is not the hashed bytes.",
    verified_meaning:
      "true only when the latest scheduled measurement passed every measured condition. In every other " +
      "case verified is null, not false: this gate never labels a server a failure. Read state for which " +
      "case it is, and record_url for the bytes that record_sha256 hashes, so the verdict can be checked without trusting this gate.",
    not_an_endorsement:
      "A measurement of conduct and disclosure, not a recommendation. verified: true does not mean the " +
      "figures the server returns are correct, that it is safe, or that the business behind it is " +
      "competent. It is not sold, not ranked, and reading it costs the operator nothing."
  };
  if (!lu.on_register) {
    return Object.assign(base, {
      on_register: false, state: "absent", verified: null,
      measured_at: null, record_sha256: null, conditions: null,
      reason: "No measurement exists here for this endpoint. Absence is not a negative verdict.",
      how_to_appear: lu.how_to_appear || null
    });
  }
  const latest = lu.latest || null;
  if (!latest || !lu.measurements) {
    return Object.assign(base, {
      on_register: true, state: "watched", verified: null,
      measured_at: null, record_sha256: null, conditions: null,
      reason: "On the watchlist but not yet measured. Being watched is not a measurement."
    });
  }
  const status = latest.status;
  let state, verified;
  if (status === CONFIG.tier_pass) { state = "verified"; verified = true; }
  else if (status === CONFIG.tier_held) { state = "held"; verified = null; }
  else { state = "pending"; verified = null; }
  let conditions = null;
  if (latest.conditions && typeof latest.conditions === "object") {
    conditions = latest.conditions;
  } else if (latest.checks && typeof latest.checks === "object") {
    conditions = {};
    for (const k of Object.keys(latest.checks)) {
      const c = latest.checks[k];
      conditions[k] = (c && typeof c === "object") ? (c.measured === false ? null : !!c.pass) : null;
    }
  }
  return Object.assign(base, {
    on_register: true,
    state: state,
    verified: verified,
    measured_at: latest.at || latest.checked_at || null,
    record_sha256: latest.record_sha256 || null,
    conditions: conditions,
    absence_vs_failure: latest.absence_vs_failure || null,
    measurements: lu.measurements,
    reason: state === "verified"
      ? "The latest scheduled measurement passed every measured condition."
      : (state === "held"
          ? "The latest attempt could not reach the endpoint, so nothing was established. Not a failure of the server."
          : "Measured, but not currently passing every condition. This is often only because determinism is unmeasured without the owner's consent, which is not a failure. See conditions.")
  });
}

// ---- 0.4.0 (conduct-v1.1 section 7): GET /register/lookup ----
// 繋ぐ前に 1 本で読める口。/is-verified が「今の判定」なら、これは「判定 + 先月の輪の数 + 記録の場所 + 証明せん物」。
// 点数は無い。数は輪(mcp-conduct-register の rings/<slug>/<YYYY-MM>.json)からそのまま写す。
// 輪は KV に置かん(Free 枠の KV 書き込みは 1 日 1000 で、lookup を叩かれるたびに書いとったら掃引の履歴の書き込みが
// 黙って落ちる)。fetch の cf.cacheTtlByStatus で edge に 24 時間置く。行の無い endpoint は輪も引かん(輪は登録簿の履歴から作る物)。
const RINGS_RAW_BASE = "https://raw.githubusercontent.com/ogasurfproject-jpg/mcp-conduct-register/main/rings/";
const RING_CACHE_S = 86400;
const RING_FETCH_CF = { cacheEverything: true, cacheTtlByStatus: { "200-299": RING_CACHE_S, "404": 3600, "500-599": 60 } };
function ringSlug(endpoint) {
  return String(endpoint).replace(/^https:\/\//i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function monthsBack(nowMs, n) {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() - n;
  const dd = new Date(Date.UTC(y, m, 1));
  return dd.getUTCFullYear() + "-" + String(dd.getUTCMonth() + 1).padStart(2, "0");
}
// 先月、無ければ先々月。それより前は探さん(輪は月が閉じてから作るので、先月が無いのは「まだ」か「輪が無い」のどちらか)。
async function fetchLastRing(env, endpoint, nowMs, fetchImpl) {
  const slug = ringSlug(endpoint);
  const f = fetchImpl || fetch;
  const tried = [];
  let found = null;
  for (const n of [1, 2]) {
    const month = monthsBack(nowMs, n);
    const url = RINGS_RAW_BASE + slug + "/" + month + ".json";
    let st = 0, ring = null;
    try {
      const r = await withTimeout(f(url, { headers: { accept: "application/json" }, cf: RING_FETCH_CF }), CONFIG.timeout_ms);
      st = r.status;
      if (r.ok) ring = await r.json().catch(() => null);
    } catch (_e) { st = 0; }
    tried.push({ month, url, http: st });
    if (ring && ring.schema === "nenrin-ring-v1" && ring.endpoint === endpoint) {
      found = {
        month: ring.ring, url,
        witnesses: ring.witnesses != null ? ring.witnesses : null,
        witnesses_signed: ring.witnesses_signed != null ? ring.witnesses_signed : null,
        witnesses_unsigned: ring.witnesses_unsigned != null ? ring.witnesses_unsigned : null,
        discrepancies: Array.isArray(ring.discrepancies) ? ring.discrepancies.length : null,
        discrepancies_signed: Array.isArray(ring.discrepancies_signed) ? ring.discrepancies_signed.length : null,
        commitments_unrevealed: ring.commitments_unrevealed != null ? ring.commitments_unrevealed : null,
        walked_as_witness: ring.walked_as_witness != null ? ring.walked_as_witness : null,
        instants_sampled: ring.instants_sampled != null ? ring.instants_sampled : null,
        instants_reached: ring.instants_reached != null ? ring.instants_reached : null,
        instants_derived: ring.instants_derived != null ? ring.instants_derived : null,
        surface_changes: Array.isArray(ring.surface_changes) ? ring.surface_changes.length : null,
        record_sha256_last: ring.record_sha256_last || null,
        prev_ring_sha256: ring.prev_ring_sha256 || null,
        columns: ring.witnesses_signed != null ? "v1.1 (signed and unsigned split, commitments, walked_as_witness, instants by derivation)" : "v1 (counts only)"
      };
      break;
    }
    if (st === 200 && ring && ring.endpoint !== endpoint) { tried[tried.length - 1].why = "ring file is for a different endpoint (slug collision); ignored"; }
  }
  return found
    ? { present: true, ...found, tried, fetched_at: new Date(nowMs).toISOString() }
    : { present: false, slug, tried, why: "no ring published for the last two months at " + RINGS_RAW_BASE + slug + "/. Rings are built after a month closes from the archived /history; an endpoint measured for the first time this month has no ring yet, and an endpoint with no measurements never gets one", fetched_at: new Date(nowMs).toISOString() };
}

async function registerLookup(env, endpoint, nowMs, fetchImpl) {
  const now = nowMs || Date.now();
  const lu = await lookupServer(env, endpoint);
  const reg = await readRegistry(env);
  const row = reg[endpoint] || null;
  const latest = lu.on_register ? (lu.latest || null) : null;
  let status, meaning;
  if (row && row.owner_declined_at) {
    status = "declined";
    meaning = "The owner placed listing: decline in " + CONSENT_WELL_KNOWN_PATH + " on the origin. The row stays and says so; nothing has been measured since " + row.owner_declined_at + ". Declining is a right, not a finding.";
  } else if (!lu.on_register) {
    status = "unknown";
    meaning = "No row on this register. unknown means nobody has measured this endpoint here, never that it was measured and failed.";
  } else if (!latest || !lu.measurements) {
    status = "pending";
    meaning = "On the watchlist, not yet measured. Being watched is not a measurement.";
  } else if (latest.status === CONFIG.tier_pass) {
    status = "verified";
    meaning = "The latest scheduled measurement passed every measured condition, from this gate's vantage, on that date.";
  } else if (latest.status === CONFIG.tier_held) {
    status = "pending";
    meaning = "The latest attempt could not reach the endpoint, so nothing was established. Not a failure of the server.";
  } else {
    status = "pending";
    meaning = "Measured, not currently passing every condition. Often only because determinism is unmeasured without the owner's consent, which is not a failure. Read the record.";
  }
  // 行が無ければ輪も引かん(輪はこの登録簿の履歴から作る。無い行に輪は無い。誰でも叩ける口から他所へ 2 本ずつ fetch させん)。
  const ring = lu.on_register
    ? await fetchLastRing(env, endpoint, now, fetchImpl)
    : { present: false, slug: ringSlug(endpoint), tried: [], why: "no row on this register, so no ring can exist for it: rings are built from this register's archived /history. Nothing was fetched." };
  const historyUrl = "https://gate.horizonshield.dev/history?endpoint=" + encodeURIComponent(endpoint);
  return {
    endpoint,
    status,
    status_meaning: meaning,
    status_vocabulary: { verified: "latest scheduled measurement passed every measured condition", pending: "on the register but not currently a full pass (unmeasured, unreachable, or a condition short)", declined: "owner declined measurement on the origin", unknown: "no row here" },
    last_measured: latest ? {
      at: latest.at || latest.checked_at || null,
      status: latest.status || null,
      record_sha256: latest.record_sha256 || null,
      record_url: latest.record_url || null,
      coordinate: latest.coordinate_derivation ? { derived: latest.coordinate_derivation.derived === true, window_id: latest.coordinate_derivation.window_id || null } : null
    } : null,
    measurements: lu.on_register ? (lu.measurements || 0) : 0,
    first_measured_at: lu.on_register ? (lu.first_measured_at || null) : null,
    owner_declined_at: row && row.owner_declined_at ? row.owner_declined_at : null,
    declared: row && row.declared ? Object.assign({}, row.declared, { read_at: row.declared_read_at || null, note: "copied from the owner's consent file at the last sweep; declared, not verified" }) : null,
    last_ring: ring,
    conduct_record: historyUrl,
    witness_intake: "https://ledger.horizonshield.dev/witness",
    rings: { base: RINGS_RAW_BASE, slug: ringSlug(endpoint), path: "<slug>/<YYYY-MM>.json" },
    register: "https://gate.horizonshield.dev/register",
    fresh_reading: "POST https://gate.horizonshield.dev/check with {\"endpoint\":\"" + endpoint + "\"}",
    how_to_appear: lu.on_register ? null : (lu.how_to_appear || null),
    establishes: [
      "what this register held for the endpoint at the time of this reading: the status vocabulary above, the latest stored verdict's sha" + ((latest && latest.record_url) ? " (its hashed bytes are at " + latest.record_url + "; SHA-256 of that body equals the sha)" : " (measured before " + RECORD_BYTES_SINCE + ", so its hashed bytes were not stored and the sha cannot be recomputed from any published object; " + historyUrl + " lists the measurements as summaries)") + ", and the counts copied from the last published ring, if one exists",
      "counts, never rates: a witness count of 3 means three distinct identities filed records that month, and says nothing about how many should have"
    ],
    does_not_establish: [
      "that the endpoint is safe, correct, honest, or fit for any purpose; this gate measures conduct and disclosure only",
      "anything about an endpoint with status unknown: absence of a row is not a finding",
      "that a ring's witness count is complete or representative; anyone can file, nobody is obliged to, and unsigned witnesses are counted separately since 2026-09 because they are cheap to fabricate",
      "a reading fresher than this cache: served with a 24 hour cache, so a change since then is in " + historyUrl + " and not here"
    ],
    cache: "public, max-age=86400",
    conduct_ext: CONDUCT_EXT_URI + " (conduct-v1.1 fields are optional and additive; this lookup is its section 7)"
  };
}

async function handleMcp(body, env) {
  const id = body && body.id;
  const method = body && body.method;

  if (method === "initialize") {
    return {
      jsonrpc: "2.0", id,
      result: {
        protocolVersion: (body.params && body.params.protocolVersion) || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "hs-verify-gate", version: CONFIG.version }
      }
    };
  }
  if (method === "notifications/initialized") return null;
  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: MCP_TOOLS } };
  }
  if (method === "tools/call") {
    const name = body.params && body.params.name;
    const args = (body.params && body.params.arguments) || {};

    if (name === "get_conditions") {
      return { jsonrpc: "2.0", id, result: mcpOk(spec()) };
    }
    if (name === "check_conformance") {
      const endpoint = args.endpoint;
      if (!endpoint || typeof endpoint !== "string") {
        return { jsonrpc: "2.0", id, result: mcpFail({ error: "endpoint_required" }) };
      }
      let parsed;
      try { parsed = new URL(endpoint); }
      catch (_e) { return { jsonrpc: "2.0", id, result: mcpFail({ error: "invalid_url" }) }; }
      if (parsed.protocol !== "https:") {
        return { jsonrpc: "2.0", id, result: mcpFail({ error: "https_required" }) };
      }
      const _hostErr = endpointHostProblem(parsed);
      if (_hostErr) return { jsonrpc: "2.0", id, result: mcpFail({ error: "endpoint_host_rejected", reason: _hostErr }) };
      try {
        return { jsonrpc: "2.0", id, result: mcpOk(await checkWithConsent(endpoint, args.allow_tool_call === true)) };
      } catch (e) {
        return { jsonrpc: "2.0", id, result: mcpFail({ error: "check_failed", message: String(e && e.message || e) }) };
      }
    }
    if (name === "verify_verdict") {
      return { jsonrpc: "2.0", id, result: mcpOk(await verifyVerdict(args.record)) };
    }
    if (name === "lookup_server") {
      const endpoint = args.endpoint;
      if (!endpoint || typeof endpoint !== "string") {
        return { jsonrpc: "2.0", id, result: mcpFail({ error: "endpoint_required" }) };
      }
      let parsedLookup;
      try { parsedLookup = new URL(endpoint); }
      catch (_e) { return { jsonrpc: "2.0", id, result: mcpFail({ error: "invalid_url" }) }; }
      if (parsedLookup.protocol !== "https:") {
        return { jsonrpc: "2.0", id, result: mcpFail({ error: "https_required" }) };
      }
      if (!env || !env.HS_VERIFY_KV) {
        return { jsonrpc: "2.0", id, result: mcpFail({
          endpoint: endpoint,
          error: "storage_unavailable",
          note: "History storage is not bound on this deployment, so this gate cannot say whether the endpoint is on the register. It is not reporting absence, because it does not know."
        }) };
      }
      try {
        return { jsonrpc: "2.0", id, result: mcpOk(await lookupServer(env, endpoint)) };
      } catch (e) {
        return { jsonrpc: "2.0", id, result: mcpFail({ error: "lookup_failed", message: String(e && e.message || e) }) };
      }
    }
    if (name === "is_verified") {
      const endpoint = args.endpoint;
      if (!endpoint || typeof endpoint !== "string") {
        return { jsonrpc: "2.0", id, result: mcpFail({ error: "endpoint_required" }) };
      }
      let parsedIv;
      try { parsedIv = new URL(endpoint); }
      catch (_e) { return { jsonrpc: "2.0", id, result: mcpFail({ error: "invalid_url" }) }; }
      if (parsedIv.protocol !== "https:") {
        return { jsonrpc: "2.0", id, result: mcpFail({ error: "https_required" }) };
      }
      if (!env || !env.HS_VERIFY_KV) {
        return { jsonrpc: "2.0", id, result: mcpFail({
          endpoint: endpoint, error: "storage_unavailable",
          note: "The register storage is not bound on this deployment, so this gate cannot say whether the endpoint is verified. It is NOT reporting 'not verified', because it does not know."
        }) };
      }
      try {
        return { jsonrpc: "2.0", id, result: mcpOk(await isVerified(env, endpoint)) };
      } catch (e) {
        return { jsonrpc: "2.0", id, result: mcpFail({ error: "lookup_failed", message: String(e && e.message || e) }) };
      }
    }
    return { jsonrpc: "2.0", id, result: mcpFail({ error: "unknown_tool", name }) };
  }
  return { jsonrpc: "2.0", id, error: { code: -32601, message: "method not found: " + method } };
}

// ---- 扉自身のエージェントカード ----
// 標準を提案する側が、その標準を満たしていなければ意味がない。
function ownAgentCard(origin) {
  return {
    name: "MCP Verification Gate",
    description:
      "Checks whether an MCP server exists, publishes an agent card, discloses who pays it, " +
      "and returns identical output for identical input. Free. Conformance and disclosure only; " +
      "this gate does not verify that any price returned by a checked server is correct.",
    // 0.3.3. 1.0 の supportedInterfaces と 0.3 の url/preferredTransport/protocolVersion を同居させる(公式 SDK 1.x は前者を読み、0.3 の SDK は後者を読む)。
    // url は A2A を喋る /a2a を指す。以前は origin を指しとって、A2A client が POST しても JSON-RPC は返っとらんかった(看板が嘘やった)。
    supportedInterfaces: [
      { url: origin + "/a2a", protocolBinding: "JSONRPC", protocolVersion: "1.0" },
      { url: origin + "/a2a", protocolBinding: "JSONRPC", protocolVersion: "0.3" }
    ],
    url: origin + "/a2a",
    provider: { organization: "The HORIZ\u97f3s Co., Ltd." },
    version: CONFIG.version,
    protocolVersion: "0.3.0",
    // 0.3.2. 扉自身が A2A Conduct Extension v1 を宣言する。top-level の compensation と同じ物を params にも置く(一致必須は自分にも効く)。
    capabilities: { streaming: false, pushNotifications: false, extensions: [conductExtension({
      compensation: GATE_COMPENSATION,
      measured_endpoints: [origin + "/mcp"],
      conduct_record: origin + "/history?endpoint=" + encodeURIComponent(origin + "/mcp"),
      verdict_recipe: origin + "/spec",
      witness_intake: "https://ledger.horizonshield.dev/witness",
      register: origin + "/register",
      rings: {
        spec: "https://github.com/ogasurfproject-jpg/horizon-shield/blob/main/workers/hs-ledger/nenrin/NENRIN_SPEC_v1.md",
        spec_sha256: "9ccba2e325fd2a555fcdb2dec519b8c6bf7a669064674846aea98ecfff824e3d",
        base: "https://raw.githubusercontent.com/ogasurfproject-jpg/mcp-conduct-register/main/rings/",
        path: "<slug>/<YYYY-MM>.json",
        slug: "endpoint URL without https://, lower case, every run of characters outside [a-z0-9] replaced by one hyphen, hyphens trimmed at both ends",
        ledger: "https://ledger.horizonshield.dev/ledger"
      }
    })] },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["application/json", "text/plain"],
    // 扉が申請者に要求するのと同じ形式で、扉自身の報酬構造を宣言する。
    compensation: GATE_COMPENSATION,
    preferredTransport: "JSONRPC",
    skills: [
      {
        id: "check",
        name: "Conformance check",
        description: "POST /check with an MCP endpoint URL, or call the check_conformance tool over MCP at /mcp. Returns a verdict with a recomputable SHA-256. Over A2A (SendMessage at /a2a), a text part carrying an MCP endpoint URL returns this gate's current register reading for it (the same bytes as GET /is-verified): verified true only on a full pass, null otherwise, never false.",
        tags: ["mcp", "verification", "conformance", "disclosure"]
      },
      {
        id: "verify",
        name: "Verdict verification",
        description: "Recompute the SHA-256 of a verdict this gate issued, so you do not have to trust the issuer. Available as the verify_verdict tool over MCP.",
        tags: ["verification", "tamper-evident", "recomputable"]
      }
    ]
  };
}

// ---- 自己検証 ----
// ネットワークを経由せず、扉自身の公開物を内部で読んで判定する。
// 同一アカウントのWorker間呼び出しがエッジで遮断される環境でも成立する。
async function selfCheck(origin) {
  const card = ownAgentCard(origin);
  const checks = {};

  checks.agent_card = {
    pass: !!(card.name && card.description),
    reason: card.name && card.description
      ? "agent-card published and well-formed"
      : "agent-card incomplete",
    detail: { url: origin + "/.well-known/agent-card.json", name: card.name }
  };

  checks.compensation_disclosure = checkCompensation(card);

  // 扉は数値を返さないため、価格の決定論性ではなく判定の決定論性を示す。
  const a = await runSpecDigest();
  const b = await runSpecDigest();
  checks.determinism = {
    pass: a === b,
    reason: a === b
      ? "the published spec and verdict format are stable across reads"
      : "spec digest changed between reads",
    detail: { spec_sha256: a }
  };

  // 扉は MCP サーバーではないため、条件1は対象外であることを明示する(隠さない)。
  // この扉は MCP サーバーでもあるので、条件1は該当する。
  // ただし同一アカウント制約で自分自身に到達できないため、自分では測れない。
  // 「対象外」と書くのは嘘になるので、測れないことをそのまま書く。
  checks.mcp_endpoint = {
    // 測っていない条件を pass にはしない。/check が他人に適用しているのと同じ扱い。
    // これ一個で扉の総合判定が verified になっていた。自分にだけ甘い物差しは物差しではない。
    pass: false,
    measured: false,
    reason:
      "not measured: this gate now speaks MCP at /mcp, so the condition applies to it. It cannot " +
      "reach itself over the network from inside its own account, so it has not measured this, " +
      "and it does not count an unmeasured condition as a pass. That is the same rule this gate " +
      "applies to every other server it checks. Point another checker at /mcp from outside and " +
      "the claim is either confirmed or destroyed.",
    detail: {
      applicable: true,
      self_measured: false,
      mcp_endpoint: origin + "/mcp",
      http_endpoints: ["/check", "/is-verified", "/record/<record_sha256>", "/spec", "/self", "/health"]
    }
  };

  const passed = Object.values(checks).every((r) => r.pass);
  const record = {
    gate: "MCP Verification Gate",
    gate_version: CONFIG.version,
    gate_commit: gateCommit(),
    subject: "the gate itself",
    endpoint: origin,
    checked_at: new Date().toISOString(),
    status: passed ? CONFIG.tier_pass : CONFIG.tier_fail,
    scope_note:
      "The gate applies its own conditions to itself. Where a condition does not apply, that is " +
      "stated explicitly rather than skipped silently.",
    checks: checks
  };
  Object.assign(record, gateDisclaimers(record));
  record.number_safety = numberSafety(record);
  const canonical = JSON.stringify(record);
  record.record_sha256 = await sha256hex(canonical);
  record.recompute_note =
    "Remove record_sha256 and recompute_note, JSON.stringify the remainder in this key order, " +
    "take the SHA-256, and it must equal record_sha256.";
  return record;
}

async function runSpecDigest() {
  return await sha256hex(JSON.stringify(spec()));
}

export default {
  // Cron Trigger。毎日の再測定。
  // 「測定が変われば緑ではなくなる」と公開した以上、測り直す者が要る。
  async scheduled(event, env, ctx) {
    GATE_ENV = env;
    GATE_CONTEXT = "cron";
    ctx.waitUntil(runDailySweep(env));
  },

  async fetch(request, env, ctx) {
    GATE_ENV = env;
    GATE_CONTEXT = "http";
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS プリフライト。ブラウザからの POST /check は content-type で preflight が飛ぶ。
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // --- 正規化の試験標的 (condition 07 の陽性側) ---
    // 2026-08-23。この日の朝、我々は「2^53超の整数は JavaScript では検出できない」と公開し、
    // 昼に撤回して検出を実装した。撤回だけでは足りない。陰性(clean)しか本番で見せられないなら、
    // 検出が本当に働くかは我々の自己申告になる。だから、わざと違反する標的を本番に置く。
    //
    // 本文は文字列として組む。JSON.stringify に通すと 9007199254740993 が ...992 に丸まり、
    // この試験の主役そのものが消える。ここだけは手で組まねばならない。
    //
    // 誰でも自分の正規化をここに当てられる。合否も課金も記録も無い。
    if (path === "/testbed/i-json" || path === "/testbed/i-json/mcp") {
      const H = { ...JSON_HEADERS, "Cache-Control": "no-store", ...CORS_HEADERS };

      if (request.method === "GET") {
        return json({
          service: "wedjat-testbed-i-json",
          purpose:
            "A deliberate torture test for JSON canonicalization, kept running in production so that the " +
            "positive case can be reproduced by anyone, including against us. The tool manifest served here " +
            "carries the integer literal 9007199254740993, which no IEEE-754 double can hold. A canonicalizer " +
            "that reads it with JSON.parse and never looks at the source text will silently see " +
            "9007199254740992 and publish a hash over a value that never arrived. RFC 7493, the profile RFC " +
            "8785 builds on, excludes such integers for exactly this reason.",
          why_it_exists:
            "On the morning of 2026-08-23 this gate published that the case was undetectable in JavaScript. " +
            "That was wrong and was retracted the same day. A retraction that cannot be tested is just a " +
            "second claim, so the test target is public.",
          how_to_use: {
            through_this_gate:
              "POST /check {\"endpoint\":\"https://gate.horizonshield.dev/testbed/i-json/mcp\",\"allow_tool_call\":true} " +
              "and read canonicalization.unsafe_integer_scan",
            against_your_own:
              "POST here with a JSON-RPC body of {\"method\":\"tools/list\"} and canonicalize the bytes you " +
              "receive, not the number your parser hands you"
          },
          expected_result: {
            unsafe_integer_scan: "found",
            manifest_hash: null,
            note: "Every hash over the manifest is withheld, and the verdict still does not fail. Condition 07 never turns a row red."
          },
          conformance: CONFORMANCE_URL
        });
      }
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

      bumpUsage(env, ctx, "testbed_hits", null);
      let rb = null;
      try { rb = await request.json(); } catch (_e) { rb = null; }
      const rid = rb && rb.id != null ? JSON.stringify(rb.id) : "1";
      const m = rb && rb.method;

      if (m === "initialize") {
        return new Response(
          '{"jsonrpc":"2.0","id":' + rid + ',"result":{"protocolVersion":"2024-11-05",' +
          '"capabilities":{"tools":{}},"serverInfo":{"name":"wedjat-testbed-i-json","version":"1.0.0"}}}',
          { headers: H });
      }
      if (m === "tools/list") {
        return new Response(
          '{"jsonrpc":"2.0","id":' + rid + ',"result":{"tools":[{' +
          '"name":"declare_unsafe_integer",' +
          '"description":"Declares an integer literal outside the IEEE-754 safe range, on purpose, so that a canonicalizer can be caught rounding it in silence.",' +
          '"inputSchema":{"type":"object","properties":{' +
          '"found":{"type":"boolean","description":"whether the lookup matched anything"},' +
          '"lookup":{"type":"string","enum":["ok","failed","not_found"],"description":"read state, so failure and emptiness stay distinguishable"}},' +
          '"x_unsafe_integer_literal":9007199254740993}}]}}',
          { headers: H });
      }
      if (m === "tools/call") {
        return new Response(
          '{"jsonrpc":"2.0","id":' + rid + ',"result":{"content":[{"type":"text",' +
          '"text":"This testbed is deterministic. It returns this same sentence every time, so that determinism stays measurable while canonicalization deliberately does not."}],' +
          '"isError":false}}',
          { headers: H });
      }
      return new Response(
        '{"jsonrpc":"2.0","id":' + rid + ',"error":{"code":-32601,"message":"method not found on this testbed. It answers initialize, tools/list and tools/call."}}',
        { headers: H });
    }

    // --- mould records. 2026-08-20 mould-ledger / mould-no-key. ---
    // Prompted by Federico Blanco Sanchez-Llanos, "The Mould, Not the Letter".
    // Nothing here measures anyone. It records what the author searched for, and freezes it.
    if (path === "/mould" || path.startsWith("/mould/")) {
      const seg = path.startsWith("/mould/") ? decodeURIComponent(path.slice("/mould/".length)) : "";

      // 鍵の要らない記録口。呼べる内容は「この repo の、このラベルの付いた Issue N を、そのまま刻め」だけ。
      // 本文は gate が GitHub から直接取る。呼び出し側は一文字も持ち込めないので、偽造する余地が無い。
      // 共有の書き込み鍵を配れば、他人の名前で記録を刻める。だから配らない。増やしもしない。
      if (seg === "from-issue") {
        if (request.method !== "POST") {
          return json({ error: "Use POST with a body of {\"issue\": <number>}.", usage: MOULD_USAGE }, 405);
        }
        let ib;
        try { ib = await request.json(); }
        catch (_e) { return json({ error: "The request body was not JSON.", usage: MOULD_USAGE }, 400); }
        const num = Number(ib && ib.issue);
        if (!Number.isInteger(num) || num <= 0) {
          return json({ error: "issue must be a positive integer", usage: MOULD_USAGE }, 400);
        }
        let gh;
        try {
          const r = await fetch("https://api.github.com/repos/" + MOULD_REPO + "/issues/" + num, {
            headers: { "user-agent": PROBE_UA, accept: "application/vnd.github+json" },
          });
          if (r.status === 404) {
            return json({ error: "issue_not_found", issue: num, means: "GitHub does not show this issue. Nothing was recorded." }, 404);
          }
          if (r.status === 403 || r.status === 429) {
            return json({ error: "github_rate_limited", issue: num, means: "This gate reads GitHub without a token, so it shares an anonymous rate limit. Nothing was recorded, and nothing was partially recorded. Retry." }, 503);
          }
          if (!r.ok) return json({ error: "github_unavailable", status: r.status, means: "Nothing was recorded." }, 502);
          gh = await r.json();
        } catch (_e) {
          return json({ error: "github_unreachable", means: "Nothing was recorded." }, 502);
        }
        const labels = (gh.labels || []).map((l) => (typeof l === "string" ? l : (l && l.name) || ""));
        if (!labels.includes(MOULD_LABEL)) {
          return json({
            error: "not_a_mould_record",
            issue: num,
            labels: labels,
            means: "Only an issue carrying the " + MOULD_LABEL + " label in " + MOULD_REPO + " is recorded. " +
                   "This gate reads the label from GitHub, not from whoever called it.",
          }, 422);
        }
        const out = await mouldWrite(env, mouldIssueToBody(gh));
        return json(out.body, out.status);
      }

      if (request.method === "GET") {
        if (seg) {
          const one = await env.HS_VERIFY_KV.get("mould:" + seg, "json");
          if (!one) {
            return json({
              error: "not_found",
              id: seg,
              means: "No record under this id. That is a statement about this ledger, not about any code.",
            }, 404);
          }
          return json(one, 200);
        }
        const idx = (await env.HS_VERIFY_KV.get("mould:index", "json")) || [];
        return json({ ...MOULD_USAGE, count: idx.length, records: idx }, 200);
      }
      if (request.method === "POST") {
        if (!env || !env.SWEEP_TOKEN) return json({ error: "not_configured" }, 503);
        if (!(await ctEqual(request.headers.get("x-sweep-token") || "", env.SWEEP_TOKEN))) {
          return json({ error: "forbidden", usage: MOULD_USAGE }, 403);
        }
        let b;
        try { b = await request.json(); }
        catch (_e) { return json({ error: "The request body was not JSON.", usage: MOULD_USAGE }, 400); }
        const out = await mouldWrite(env, b);
        return json(out.body, out.status);
      }
      return json({ error: "Use GET to read, POST to record.", usage: MOULD_USAGE }, 405);
    }

    // --- recompute and verify-event. Read only, pure computation, nothing stored. ---
    // 外から確かめるための2本。tools/list には出していない。
    if (path === "/recompute") {
      if (request.method === "GET") return json(RECOMPUTE_USAGE, 200);
      if (request.method === "POST") {
        let sent;
        try { sent = await request.json(); }
        catch (_e) { return json({ error: "The request body was not JSON.", usage: RECOMPUTE_USAGE }, 400); }
        const r = await recomputeHandler(sent);
        return json(r.body, r.status);
      }
      return json({ error: "Use GET for usage, or POST to recompute." }, 405);
    }
    if (path === "/verify-event") {
      if (request.method === "GET") return json(VERIFY_EVENT_USAGE, 200);
      if (request.method === "POST") {
        let sent;
        try { sent = await request.json(); }
        catch (_e) { return json({ error: "The request body was not JSON.", usage: VERIFY_EVENT_USAGE }, 400); }
        const r = await verifyEventHandler(sent);
        return json(r.body, r.status);
      }
      return json({ error: "Use GET for usage, or POST to verify a signed event." }, 405);
    }

    // A2A JSON-RPC (0.3.3)。card の supportedInterfaces / url がここを指す。
    if (path === "/a2a" && request.method === "POST") return await handleGateA2A(request, env, url.origin);
    if (path === "/a2a" && request.method === "GET") {
      return json({ ok: true, transport: "A2A JSON-RPC (POST)", methods: ["SendMessage", "message/send"], agent_card: url.origin + "/.well-known/agent-card.json", extensions: [CONDUCT_EXT_URI], usage: A2A_GATE_USAGE });
    }

    // MCP over Streamable HTTP。扉自身を MCP クライアントから呼べるようにする。
    if (path === "/mcp" && request.method === "POST") {
      let body;
      try { body = await request.json(); }
      catch (_e) {
        return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, 400);
      }
      if (Array.isArray(body)) {
        return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "batch not supported" } }, 400);
      }
      const res = await handleMcp(body, env);
      if (res === null) return new Response(null, { status: 202, headers: CORS_HEADERS });
      return json(res);
    }
    if (path === "/mcp" && request.method === "GET") {
      return json({
        ok: true,
        transport: "MCP over Streamable HTTP (JSON-RPC 2.0)",
        usage: "POST JSON-RPC to this URL. methods: initialize, tools/list, tools/call.",
        tools: MCP_TOOLS.map((t) => t.name)
      });
    }

    // 公開履歴。誰でも読める。認証も鍵も要らない。
    // 0.4.1. hash 対象のバイトそのもの。再直列化せず、保存した文字列をそのまま返す。body の SHA-256 = path。
    if (path.startsWith("/record/") && request.method === "GET") {
      const sha = path.slice("/record/".length).toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(sha)) return json({ error: "bad_sha", usage: "/record/<64 hex record_sha256>", note: "The path is the SHA-256 of the body it serves." }, 400);
      if (!env || !env.HS_VERIFY_KV) return json({ error: "storage_unavailable", sha }, 503);
      const bytes = await readRecordBytes(env, sha);
      if (bytes == null) {
        return json({
          error: "not_stored", sha,
          meaning: "No bytes are stored under this sha. This says nothing about whether the sha is genuine.",
          why: [
            "verdicts from scheduled measurements before " + RECORD_BYTES_SINCE + " were summarised into history and the record itself was not kept; their sha names bytes this gate no longer holds",
            "on-demand POST /check verdicts are returned to the caller and not stored; only the caller holds those bytes",
            "a sha that never came from this gate"
          ],
          since: RECORD_BYTES_SINCE + " (gate 0.4.1) every scheduled verdict's hashed bytes are stored and served here",
          history_hint: "history entries carry record_url when the bytes exist; an entry without it predates storage"
        }, 404);
      }
      return new Response(bytes, {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "public, max-age=31536000, immutable",
          "access-control-allow-origin": "*",
          "x-record-sha256": sha,
          "x-recompute": "SHA-256 of this body, byte for byte, equals the path. The body is the verdict with record_sha256 and recompute_note removed, exactly as it was hashed; nothing was re-serialized."
        }
      });
    }
    if (path === "/history") {
      const ep = url.searchParams.get("endpoint");
      if (!ep) return json({ error: "endpoint_required", usage: "/history?endpoint=https://your-server/mcp" }, 400);
      const hist = await readHistory(env, ep);
      if (hist && typeof hist === "object") hist.retention = { kept_max: HISTORY_MAX, note: "The gate keeps the most recent " + HISTORY_MAX + " records per endpoint and drops the oldest beyond that (30 until 2026-09-05). Entries are never edited, but they do leave this response. A monthly ring (nenrin-ring-v1) needs the full month, so export before it is gone." };
      return json(hist);
    }
    if (path === "/changes") return json(await readChanges(env));
    if (path === "/sweep/last") return json(await readSweepLast(env));

    // 0.3.5. 窓の公開面。commitment は作った瞬間から、salt は窓が閉じてから、固定した規則と beacon はいつでも。
    if (path === "/nenrin/window" || /^\/nenrin\/window\/w\d+$/.test(path)) {
      if (!env || !env.HS_VERIFY_KV) return json({ error: "storage_unavailable", note: "no KV bound; the window state lives in KV" }, 500);
      const nowMs = Date.now();
      const m = /^\/nenrin\/window\/(w\d+)$/.exec(path);
      // 0.4.0. 窓ごとに、台帳に出した commitment の記録(sha、台帳の URL、窓が開く前か後か)を添える。
      const withFiled = async (wid) => {
        const w = await nenrin.publicWindow(env.HS_VERIFY_KV, wid, nowMs);
        if (!w) return null;
        w.commitment_filed = await commitmentFiled(env, wid);
        return w;
      };
      if (m) {
        const one = await withFiled(m[1]);
        return one ? json(one) : json({ error: "not_found", window_id: m[1], note: "no salt was created for this window (before 0.3.0, or more than 120 days ago)" }, 404);
      }
      const cur = nenrin.windowId(nowMs), nxt = nenrin.nextWindowId(nowMs), prev = "w" + (nenrin.windowIndex(cur) - 1);
      return json({
        schema: nenrin.NENRIN_INSTANT_SCHEMA, gate_version: CONFIG.version, now: new Date(nowMs).toISOString(),
        current: await withFiled(cur),
        next: await withFiled(nxt),
        previous: await withFiled(prev),
        rules: {
          window: "seven days, opening Thursday 00:00 UTC (epoch day divided by 7); window_id = 'w' + that quotient",
          salt: "created no later than the first sweep of the previous window (0.3.5), so the commitment is public here before the window opens and before any block it will be bound to exists",
          commitment: "sha256('nenrin-instant-salt-v1:' + salt); published at creation, never edited",
          beacon: "one reference height for every source: the second highest tip among the sources that answered, minus 6 (with two sources, min(tip) minus 6); the hash at that height must agree between at least two sources; the block's header time must be at or after salt_created_at, or there is no beacon; decided once per window at its first sweep and cached",
          rule: "the first sweep of a window decides derived or legacy and the whole window keeps that rule, so every row is measured exactly once under one rule; the reason is recorded here",
          reveal: "salt is served once the window has closed; recompute the commitment, the seed (HMAC-SHA256 keyed by the salt over 'nenrin-instant-v1 seed <window_id> <block_hash>') and every row's day from it",
          anchoring: "the commitment is published here at creation and, since 0.4.0, filed by each sweep to the JIDEC witness intake as a conduct-v1.1 commitment record (nenrin-instant-commitment-v1), once per window; the ledger bundles it into the next daily batch and stamps the batch to Bitcoin. commitment_filed on each window above carries the record sha, the ledger URL and whether it was filed before the window opened. A window whose commitment_filed is null or carries an error was not anchored, and this page and the sweep record are then the only proof of when the commitment existed",
          history: "since 0.3.5 every /history entry carries coordinate_derivation (derived, window_id, salt_commitment, beacon, day_in_window, or the fallback and its reason)"
        }
      });
    }

    // 0.4.0 (2026-09-07). 繋ぐ前に 1 本で聞ける口。点数は無い。verified / pending / declined / unknown と、
    // 先月の輪の数(証人、食い違い)、記録の場所、そしてこの答えが証明せん物。unknown は「無い」やなく「登録簿に行が無い」。
    // conduct-v1.1 section 7。24 時間 cache 可。輪は登録簿 repo の raw から読み、KV に 24 時間置く。
    if (path === "/register/lookup" && request.method === "GET") {
      const ep = url.searchParams.get("endpoint") || "";
      if (!/^https:\/\/[^\s]+$/.test(ep)) return json({ error: "endpoint (https URL) required", example: "/register/lookup?endpoint=" + encodeURIComponent("https://mcp.horizonshield.dev/mcp") }, 400);
      try { return json(await registerLookup(env, ep), 200, { "Cache-Control": "public, max-age=86400" }); }
      catch (e) { return json({ endpoint: ep, error: "lookup_failed", message: String((e && e.message) || e) }, 500); }
    }

    // 公開の登録簿。加盟者の行を、人間もエージェントも一覧で読める。
    if (path === "/register" && request.method === "GET") {
      return json(await publicRegister(env));
    }

    // 通過した行だけ。0件なら0件と返す。空を隠すために基準を緩めることはしない。
    if (path === "/verified.json" && request.method === "GET") {
      const reg = await publicRegister(env);
      const all = Array.isArray(reg.rows) ? reg.rows : [];
      const verified = all.filter((r) => r.latest && r.latest.status === CONFIG.tier_pass);
      return json({
        "@context": "https://schema.org",
        "@type": "Dataset",
        name: "MCP servers that passed every measured condition",
        description: "The subset of the public register whose latest scheduled measurement passed all five conditions, including determinism. Passing means the measured conditions passed on that date, from the vantage that measured them. It does not mean the numbers a server returns are correct, that the business behind it is competent, or that it is safe to use.",
        url: "https://shield.the-horizons-innovation.com/verify-directory/",
        license: "https://opensource.org/licenses/MIT",
        isAccessibleForFree: true,
        updated: new Date().toISOString(),
        gate_commit: gateCommit(),
        verified_count: verified.length,
        register_count: all.length,
        why_the_count_can_be_zero: "Determinism cannot be measured without calling a tool on the server, and this gate never calls a tool without the owner asking for it. A server whose owner has not asked stays unmeasured on that condition and therefore stays short of verified. Unmeasured is not failed.",
        how_to_become_verified: {
          step_1: "Check yourself with consent: POST /check with {\"endpoint\":\"https://your-server/mcp\",\"allow_tool_call\":true}",
          step_2: "If it returns verified, ask the operator to record your consent so the nightly sweep measures the same way.",
          step_3: "The row turns verified on the next sweep, and stays that way only while it keeps passing.",
          note: "Nothing here is bought. The verdict is the measurement."
        },
        badge_for_a_verified_server: {
          where: "your own /.well-known/agent-card.json",
          why: "so an agent reading your card directly learns the record exists without visiting any page we control",
          block: {
            verification: {
              provider: "HORIZON SHIELD verification gate",
              register: "https://gate.horizonshield.dev/register",
              your_history: "https://gate.horizonshield.dev/history?endpoint=<your endpoint>",
              record_sha256: "<the hash of the verdict you are citing>",
              recompute: "Fetch the history, hash the record, compare. No trust in the provider is required."
            }
          },
          honesty_rule: "Publish the block only while the row actually reads verified. If it stops passing, remove it. The register will show the truth either way, so a stale badge only costs you."
        },
        servers: verified.map((r) => ({
          endpoint: r.endpoint,
          name: (r.operator_label && (r.operator_label.en || r.operator_label.ja)) || null,
          status: r.latest.status,
          verified_at: r.latest.at,
          record_sha256: r.latest.record_sha256,
          measurements: r.measurements,
          history_url: r.history_url
        }))
      });
    }

    // 指定したエンドポイント群を一括参照。register を読むだけで、測定はしない。
    // 消費側(読む方)の便宜。無料・中立。運営者(測られる方)には一切課金しない。
    // 新しい判定意味は作らず、既存の中立ロジック lookupServer をそのまま束ねる。
    if (path === "/feed/batch" && request.method === "POST") {
      let fb;
      try { fb = await request.json(); }
      catch (_e) { return json({ error: "POST JSON body {\"endpoints\":[...]}", note: "Reads the register for the endpoints you name. It does not measure them; measurement is POST /check." }, 400); }
      const eps = (fb && Array.isArray(fb.endpoints)) ? fb.endpoints : null;
      if (!eps) return json({ error: "endpoints must be an array of MCP endpoint URLs" }, 400);
      const CAP = 50;
      if (eps.length > CAP) return json({ error: "too many endpoints in one call", cap: CAP, given: eps.length, note: "Split into batches of " + CAP + ". This reads the register only; it does not measure." }, 400);
      const seen = new Set();
      const results = [];
      for (const raw of eps) {
        const ep = String(raw == null ? "" : raw).slice(0, 300).trim();
        if (!ep || seen.has(ep)) continue;
        seen.add(ep);
        results.push(await lookupServer(env, ep));
      }
      return json({
        note: "A read of the public register for the endpoints you named. It does NOT measure them: it returns the latest stored verdict, or that there is none. Absence is not a negative verdict, only the lack of a measurement here. Every result carries a record_sha256 you can recompute without trusting this gate.",
        not_an_endorsement: "This is measurement, not recommendation. It says nothing about whether a listed server is safe or correct to use. It is not sold, not ranked, and not ordered. Being read here costs the operator nothing.",
        to_measure_now: "For a fresh reading rather than the stored one, POST /check with a single endpoint.",
        count: results.length,
        results
      }, 200);
    }

    // 単発の crisp 判定。エージェントが接続前に GET 一発で読む。register を読むだけ・無料・中立。
    // MCP を話せない相手(ブラウザ・素の HTTP クライアント)にも同じ答えを返す。
    if (path === "/is-verified" && request.method === "GET") {
      const ep = url.searchParams.get("endpoint");
      if (!ep) return json({ error: "endpoint_required", usage: "/is-verified?endpoint=https://your-server/mcp", note: "Reads the register. verified is true only for a full pass, null otherwise (never false). It does not measure; a fresh reading is POST /check." }, 400);
      if (!env || !env.HS_VERIFY_KV) return json({ endpoint: ep, error: "storage_unavailable", note: "Register storage is not bound here, so the gate cannot say. This is NOT 'not verified'." }, 503);
      try { return json(await isVerified(env, ep)); }
      catch (e) { return json({ endpoint: ep, error: "lookup_failed", message: String(e && e.message || e) }, 500); }
    }

    // 監視の登録。誰でも自分のエンドポイントを載せられる。判定は変わらない。
    if (path === "/watch" && request.method === "GET") {
      const reg = await readRegistry(env);
      const ep = url.searchParams.get("endpoint");
      if (ep) {
        const r = reg[ep];
        if (!r) return json({ endpoint: ep, registered: false });
        return json({
          endpoint: ep, registered: true, tier: r.tier,
          cadence: r.tier === "paid" ? "daily" : "weekly",
          notified: !!r.webhook, added_at: r.added_at || null
        });
      }
      return json({
        count: Object.keys(reg).length,
        max: REGISTRY_MAX,
        usage: 'POST /watch with {"endpoint":"https://your-server/mcp","webhook":"https://your-endpoint-for-alerts"}',
        note: "Registering changes nothing about the verdict. It changes how often we re-measure, and whether you are told when a condition flips."
      });
    }

    if (path === "/watch" && request.method === "POST") {
      let body;
      try { body = await request.json(); }
      catch (_e) { return json({ error: "invalid_json" }, 400); }
      const ep = body && body.endpoint;
      if (typeof ep !== "string" || !/^https:\/\//i.test(ep)) {
        return json({ error: "endpoint_required", note: "endpoint must be an https URL" }, 400);
      }
      const hook = body ? body.webhook : undefined;
      if (hook !== undefined && hook !== null && (typeof hook !== "string" || !/^https:\/\//i.test(hook))) {
        return json({ error: "webhook_must_be_https" }, 400);
      }
      if (!env || !env.HS_VERIFY_KV) return json({ error: "storage_unavailable" }, 503);
      const reg = await readRegistry(env);
      const prev = reg[ep] || null;
      if (!prev && Object.keys(reg).length >= REGISTRY_MAX) {
        return json({ error: "registry_full", max: REGISTRY_MAX }, 429);
      }
      const admin = !!(env.SWEEP_TOKEN && await ctEqual(request.headers.get("x-sweep-token") || "", env.SWEEP_TOKEN));
      const tier = admin && body.tier === "paid" ? "paid" : ((prev && prev.tier === "paid") ? "paid" : "free");
      // 0.3.1. 誰が乗せたかを刻む。依頼者の申告は所有の証明にならんので、operator か anonymous の二値。
      // 乗せた時点の origin の well-known の状態も刻む(consent / decline / present / absent)。
      // 2026-09-04 に同意を断った翌日、その扉が匿名の依頼で列に入った。設計の芯(誰でも乗せられる)は残し、
      // 所有者には listing: decline という機械的な出口を与える。
      const wk = await wellKnownConsent(ep);
      const ownerFile = wk.file_present === false ? "absent" : (wk.file_present === null ? "unread" : (wk.declined ? "decline" : (wk.consent ? "consent" : "present")));
      reg[ep] = {
        tier: tier,
        webhook: hook === undefined ? ((prev && prev.webhook) || null) : (hook || null),
        added_at: (prev && prev.added_at) || new Date().toISOString(),
        requested_by: (prev && prev.requested_by) || (admin ? "operator" : "anonymous"),
        owner_file_at_request: (prev && prev.owner_file_at_request) || ownerFile
      };
      if (prev && prev.owner_declined_at) reg[ep].owner_declined_at = prev.owner_declined_at;
      if (wk.declined) reg[ep].owner_declined_at = reg[ep].owner_declined_at || new Date().toISOString();
      const ok = await writeRegistry(env, reg);
      return json({
        ok: ok,
        endpoint: ep,
        tier: tier,
        cadence: tier === "paid" ? "daily" : "weekly",
        notified: !!reg[ep].webhook,
        requested_by: reg[ep].requested_by,
        owner_file_at_request: reg[ep].owner_file_at_request,
        owner_declined: !!reg[ep].owner_declined_at,
        history: "/history?endpoint=" + encodeURIComponent(ep),
        note: wk.declined
          ? "The owner of this origin declines measurement (" + CONSENT_WELL_KNOWN_PATH + " sets listing to decline). The row stays on the register and says declined; no verdict will be produced while the file says so."
          : "The verdict is identical for every tier and free to read for anyone. Paying changes the cadence and the alert, never the result. The owner of the origin can decline measurement at any time by publishing listing: decline in " + CONSENT_WELL_KNOWN_PATH + "."
      });
    }

    // 0.3.1. 行を外す。運営のみ、理由必須、墓標は公開(/watchlist と /register の removed)。
    // 2026-09-05 に TWZRD へ「言うてくれたら同日に外す」と書いた。約束は KV を手で触る形やなく、経路と記録で守る。
    // 履歴(/history)は消さん。記録は消さん、行だけ外れる。自前の行(source の DEFAULT_WATCHLIST)は外せん。
    if (path === "/watch" && request.method === "DELETE") {
      if (!env || !env.SWEEP_TOKEN) return json({ error: "sweep_token_not_configured" }, 503);
      if (!(await ctEqual(request.headers.get("x-sweep-token") || "", env.SWEEP_TOKEN))) return json({ error: "forbidden" }, 403);
      let body;
      try { body = await request.json(); } catch (_e) { return json({ error: "invalid_json" }, 400); }
      const ep = body && body.endpoint;
      const reason = body && body.reason;
      if (typeof ep !== "string" || !ep) return json({ error: "endpoint_required" }, 400);
      if (typeof reason !== "string" || reason.trim().length < 8) return json({ error: "reason_required", note: "a removal without a stated reason is a silent edit; state it, it is published" }, 400);
      const reg = await readRegistry(env);
      const row = reg[ep];
      if (!row) return json({ error: "not_a_removable_row", note: "either not on the register, or a self row fixed in the gate's source" }, 404);
      delete reg[ep];
      const ok = await writeRegistry(env, reg);
      let removed = [];
      try { removed = (await env.HS_VERIFY_KV.get(REMOVED_KEY, "json")) || []; } catch (_e) { removed = []; }
      const stone = { endpoint: ep, removed_at: new Date().toISOString(), reason: reason.trim(), requested_by: row.requested_by || "unrecorded", added_at: row.added_at || null, owner_file_at_request: row.owner_file_at_request || null, history_kept: true };
      removed.push(stone);
      try { await env.HS_VERIFY_KV.put(REMOVED_KEY, JSON.stringify(removed)); } catch (_e) {}
      return json({ ok: ok, removed: stone, note: "The row is gone from the schedule. Its history stays readable at /history, and this removal is listed publicly under removed on /watchlist and /register." });
    }

    // 掃引の手動実行。cron を待たずに測れるようにする。運営のみ。
    // 0.3.5. beacon の試し引き。KV に書かん、窓の規則も固定せん、cache もせん。配備直後に explorer が Worker に答えるかを、
    // 夜の掃引を待たずに見るための運営者の口。sweep と同じ token。
    if (path === "/nenrin/probe" && request.method === "GET") {
      if (!env || !env.SWEEP_TOKEN) return json({ error: "sweep_token_not_configured" }, 503);
      if (!(await ctEqual(request.headers.get("x-sweep-token") || "", env.SWEEP_TOKEN))) return json({ error: "forbidden" }, 403);
      const nowMs = Date.now();
      let st = null;
      try { st = env.HS_VERIFY_KV ? await env.HS_VERIFY_KV.get("nenrin:window:" + nenrin.windowId(nowMs), "json") : null; } catch (_e) { st = null; }
      const saltAt = st && st.salt_created_at ? st.salt_created_at : new Date(nowMs).toISOString();
      const scratch = { get: async () => null, put: async () => {} };
      const bc = await nenrin.beacon(scratch, nenrin.windowId(nowMs), saltAt, fetch);
      return json({
        probe: true, wrote_nothing: true, window_id: nenrin.windowId(nowMs), salt_created_at: saltAt, salt_source: st ? "kv" : "none yet (now used as the bound)",
        would_derive: !!bc.block_hash, reason_code: bc.reason_code || null, reason: bc.reason || null,
        height: bc.height, block_hash: bc.block_hash, block_time: bc.block_time || null, reference: bc.reference || null, sources: bc.sources || []
      });
    }
    if (path === "/sweep" && request.method === "POST") {
      if (!env || !env.SWEEP_TOKEN) {
        return json({ error: "sweep_token_not_configured" }, 503);
      }
      if (!(await ctEqual(request.headers.get("x-sweep-token") || "", env.SWEEP_TOKEN))) {
        return json({ error: "forbidden" }, 403);
      }
      let force = false;
      try { const b = await request.json(); force = !!(b && b.force); } catch (_e) {}
      return json(await runDailySweep(env, { force: force }));
    }
    if (path === "/watchlist") {
      const wl = await watchlist(env);
      return json({
        watched: wl.map((w) => ({
          endpoint: w.endpoint,
          tier: w.tier,
          cadence: w.tier === "free" ? "weekly" : "daily",
          notified: !!w.webhook,
          requested_by: w.requested_by || "unrecorded (row added before 0.3.1)",
          owner_declined: !!w.owner_declined_at
        })),
        removed: await readRemoved(env),
        cadence: "daily for self and paid, weekly for free",
        verdict_is_identical_for_every_tier: true,
        note: "These endpoints are re-measured on a schedule so a verdict on this site does not silently go stale. No tool on any watched server is ever called by the sweep.",
        history: "/history?endpoint=...",
        changes: "/changes"
      });
    }

    if (path === "/badge/seal" && request.method === "GET") {
      const ep = url.searchParams.get("endpoint") || "";
      const reg = await publicRegister(env);
      const row = (Array.isArray(reg.rows) ? reg.rows : []).find((r) => r.endpoint === ep);
      const lb = (row && row.operator_label) || {};
      const status = (row && row.latest && row.latest.status) ? String(row.latest.status) : "not listed";
      const when = (row && row.latest && row.latest.at) ? String(row.latest.at).slice(0, 10) : new Date().toISOString().slice(0, 10);
      const svg = sealSvg({
        name: lb.en || lb.ja || ep || "not listed",
        sub: (lb.en && lb.ja) ? lb.ja : "",
        endpoint: ep,
        status: status,
        when: when,
        // 2026-08-19 patch57. 入口ではなく、この1本の行に直接届く住所にする。
        // 印刷物を見た人に「サイトのどこかから探せ」と言わないため。
        verifyUrl: (function () {
          try { const u = new URL(ep); return "gate.horizonshield.dev/e/" + u.hostname + u.pathname; }
          catch (_e) { return "shield.the-horizons-innovation.com/verify-directory/"; }
        })()
      });
      const dl = url.searchParams.get("download") === "1";
      const host = (() => { try { return new URL(ep).hostname.replace(/[^a-z0-9.-]/gi, ""); } catch (_e) { return "badge"; } })();
      const headers = {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "public, max-age=300, must-revalidate",
        "Access-Control-Allow-Origin": "*"
      };
      if (dl) headers["Content-Disposition"] = 'attachment; filename="mcp-conduct-' + host + '-' + when + '.svg"';
      return new Response(svg, { headers });
    }

    if (path === "/badge" && request.method === "GET") {
      const ep = url.searchParams.get("endpoint") || "";
      let status = "not listed", color = "#9f9f9f";
      if (ep) {
        const reg = await publicRegister(env);
        const row = (Array.isArray(reg.rows) ? reg.rows : []).find((r) => r.endpoint === ep);
        if (row && row.latest && row.latest.status) {
          status = String(row.latest.status);
          color = status === CONFIG.tier_pass ? "#2f9e44" : "#c9820a";
        }
      }
      return new Response(badgeSvg("MCP conduct", status, color), {
        headers: {
          "Content-Type": "image/svg+xml; charset=utf-8",
          "Cache-Control": "public, max-age=300, must-revalidate",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }

    // 2026-09-07. The verification envelope as a paste-ready snippet for an operator's own site.
    if (path === "/embed" && request.method === "GET") {
      const ep = url.searchParams.get("endpoint") || "";
      const reg = await publicRegister(env);
      const row = (Array.isArray(reg.rows) ? reg.rows : []).find((r) => r.endpoint === ep);
      if (!row) {
        return json({ error: "not on the register", endpoint: ep, note: "No envelope is minted for an endpoint nobody has measured. Ask for a measurement and this URL starts working.", register: "https://gate.horizonshield.dev/register" }, 404);
      }
      const origin = "https://gate.horizonshield.dev";
      const envObj = conductEnvelope(origin, row);
      const headers = { "Cache-Control": "public, max-age=300, must-revalidate", "Access-Control-Allow-Origin": "*" };
      if ((url.searchParams.get("format") || "") === "json") {
        return new Response(JSON.stringify(envObj, null, 2), { headers: { ...headers, "Content-Type": "application/ld+json; charset=utf-8" } });
      }
      const live = origin + "/e/" + ep.replace(/^https?:\/\//, "");
      const snippet = "<!-- HORIZON SHIELD verification envelope for " + ep + ", as of " + (envObj.dateModified || "no measurement yet") +
        ". A copy is a snapshot; the live statement is " + live + " -->\n" +
        '<script type="application/ld+json">\n' + JSON.stringify(envObj, null, 2) + '\n</script>\n' +
        envelopeVisibleHtml(envObj) + "\n";
      return new Response(snippet, { headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" } });
    }

    if (path.startsWith("/e/") && request.method === "GET") {
      const rest = path.slice(3).replace(/\/+$/, "");
      const ep = "https://" + rest;
      const reg = await publicRegister(env);
      const row = (Array.isArray(reg.rows) ? reg.rows : []).find((r) => r.endpoint === ep);
      if (!row) {
        return json({
          error: "not on the register",
          endpoint: ep,
          note: "No page is minted for an endpoint nobody has measured. Ask for a measurement and this URL starts working.",
          how_to_join: "https://shield.the-horizons-innovation.com/verify-directory/#listed",
          register: "https://gate.horizonshield.dev/register"
        }, 404);
      }
      return new Response(endpointPage("https://gate.horizonshield.dev", row), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, max-age=300, must-revalidate",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }

    if (path === "/openapi.json") return json(openapiDoc(url.origin));

    if (path === "/sitemap.xml") {
      const reg = await publicRegister(env);
      const rows = Array.isArray(reg.rows) ? reg.rows : [];
      return new Response(sitemapXml(url.origin, rows), {
        headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600", ...CORS_HEADERS }
      });
    }

    if (path === "/feed.xml") {
      const ch = await readChanges(env);
      const list = Array.isArray(ch.changes) ? ch.changes : [];
      return new Response(atomFeed(url.origin, list), {
        headers: { "Content-Type": "application/atom+xml; charset=utf-8", "Cache-Control": "public, max-age=300", ...CORS_HEADERS }
      });
    }

    if (path === "/.well-known/security.txt" || path === "/security.txt") {
      return new Response(securityTxt(url.origin), {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400", ...CORS_HEADERS }
      });
    }

    // OpenAI プラグイン申請のドメイン確認。トークンは env で渡す。
    // 未設定のときに空文字を200で返すと、確認が通ったように見えて通らない。だから404。
    if (path === "/.well-known/openai-apps-challenge") {
      const token = (env && env.OPENAI_APPS_CHALLENGE) || "";
      if (!token) {
        return json({
          error: "not configured",
          note: "This host has no OpenAI apps challenge token set. Nothing is being claimed here."
        }, 404);
      }
      return new Response(token, {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...CORS_HEADERS }
      });
    }

    if (path === "/robots.txt") {
      return new Response("User-agent: *\nAllow: /\nSitemap: " + url.origin + "/sitemap.xml\n", {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400" }
      });
    }

    if (path === "/health") return json({ ok: true, gate_version: CONFIG.version, gate_commit: gateCommit() });
    if (path === "/usage") return json(await usageReport(env, url.searchParams.get("days")));
    if (path === "/spec") { bumpUsage(env, ctx, "spec_hits", null); return json(spec()); }
    if (path === "/ext/conduct/v1" || path === "/ext/conduct/v1/") return await conductExtResponse(request, url.origin);
    if (path === "/.well-known/agent-card.json") return json(withCardSignature(ownAgentCard(url.origin), url.origin));
    if (path === "/.well-known/jwks.json") return json(jwksDocument());
    if (path === "/.well-known/glama.json") return json({ "$schema": "https://glama.ai/mcp/schemas/connector.json", maintainers: [{ email: "ogasurfproject@gmail.com" }] });
    // A machine that has only the hostname can find the register without being told where
    // to look. Same bytes as /register, plus the statement of what the rows are and are not,
    // shaped so that a crawler which reads nothing else still quotes it correctly.
    if (path === "/.well-known/mcp-register.json" && request.method === "GET") {
      const reg = await publicRegister(env);
      return json({
        "@context": "https://schema.org",
        "@type": "Dataset",
        "@id": "https://github.com/ogasurfproject-jpg/mcp-conduct-register#dataset",
        name: "MCP Conduct Register: measured conduct of Model Context Protocol servers",
        description: "A machine generated record of how MCP servers behaved when measured. Not a curated list, not a ranking, not an endorsement. Rows are produced by a scheduled measurement, not by selection.",
        url: "https://shield.the-horizons-innovation.com/verify-directory/",
        license: "https://opensource.org/licenses/MIT",
        isAccessibleForFree: true,
        creator: {
          "@type": "Organization",
          name: "The HORIZONs Co., Ltd.",
          url: "https://shield.the-horizons-innovation.com/",
          founder: { "@type": "Person", name: "Toshikatsu Oga", identifier: "https://orcid.org/0009-0000-9180-903X" }
        },
        distribution: [
          { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: "https://gate.horizonshield.dev/register" },
          { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: "https://raw.githubusercontent.com/ogasurfproject-jpg/mcp-conduct-register/main/register.json" },
          { "@type": "application/atom+xml", encodingFormat: "application/atom+xml", contentUrl: "https://raw.githubusercontent.com/ogasurfproject-jpg/mcp-conduct-register/main/feed.xml" }
        ],
        rows_are_selected_by: "nobody, the schedule decides what is measured and the code copies the result; since 0.3.1 every row records who asked for it (operator or anonymous), an origin can decline measurement with listing: decline in " + CONSENT_WELL_KNOWN_PATH + " (the row then says declined instead of carrying a verdict), and the operator can remove a row only through DELETE /watch, which requires a stated reason and leaves a public tombstone under removed_rows; history is never deleted",
        what_this_does_not_claim: "That a listed server returns correct numbers, that the business behind it is competent, or that it is safe to use.",
        disputes: {
          how: "Measure any listed endpoint yourself and submit the observation to the public ledger under your own name and vantage.",
          intake: "https://ledger.horizonshield.dev/witness",
          operator_veto: "none, the code has no route to refuse a schema valid submission"
        },
        count: reg.count,
        gate_commit: reg.gate_commit,
        rows: reg.rows
      });
    }
    if (path === "/self") return json(await selfCheck(url.origin));

    if (path === "/check" && request.method === "POST") {
      let body;
      try { body = await request.json(); }
      catch (_e) { return json({ error: "invalid_json" }, 400); }
      const endpoint = body && body.endpoint;
      if (!endpoint || typeof endpoint !== "string") {
        return json({ error: "endpoint_required", hint: 'POST {"endpoint":"https://your-server/mcp"}' }, 400);
      }
      let parsed;
      try { parsed = new URL(endpoint); }
      catch (_e) { return json({ error: "invalid_url" }, 400); }
      if (parsed.protocol !== "https:") {
        return json({ error: "https_required" }, 400);
      }
      const _hostErr = endpointHostProblem(parsed);
      if (_hostErr) return json({ error: "endpoint_host_rejected", reason: _hostErr }, 400);
      const own = isOwnZone(endpoint);
      bumpUsage(env, ctx, own ? "own_checks" : "external_checks", own ? null : parsed.hostname);
      try {
        return json(await checkWithConsent(endpoint, body && body.allow_tool_call === true));
      } catch (e) {
        return json({ error: "check_failed", message: String(e && e.message || e) }, 500);
      }
    }

    if (path === "/check" && request.method === "GET") {
      return json({
        ok: true,
        usage: 'POST /check {"endpoint":"https://your-server/mcp"}',
        note: "By default no tool on the checked server is called, so determinism comes back as not measured. Add \"allow_tool_call\": true to measure it, and only do that for a server you control.",
        spec: "/spec"
      });
    }

    return json({ error: "not_found", path, endpoints: ["/mcp", "/a2a", "/.well-known/agent-card.json", "/.well-known/jwks.json", "/check", "/is-verified", "/record/<record_sha256>", "/register/lookup", "/spec", "/ext/conduct/v1", "/self", "/history", "/changes", "/watchlist", "/watch", "/sweep", "/sweep/last", "/nenrin/window", "/health"] }, 404);
  }
};


// 0.4.1 test hooks (no behaviour). Tests recompute the served bytes and compare to the path.
export const _numberSafety = { scanNumbers, numberSafety, IJSON_MAX_SAFE };
export const _recordBytes = { canonicalOf, storeRecordBytes, readRecordBytes, recordBytesUrl, RECORD_KEY_PREFIX, RECORD_BYTES_SINCE };
