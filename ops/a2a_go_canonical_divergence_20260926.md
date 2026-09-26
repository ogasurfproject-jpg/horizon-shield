# a2a-go v2.6.0 と @a2a-js/sdk 1.1.0 の Agent Card 正規化のズレ(2026-09-26、番人の記録と issue 文案)

## 事実(workers/a2a-card-sign/interop-go で再現できる)
- a2a-go v2.6.0(2026-09-25、commit ebf17c56)の a2acrypto は、配られた card の JSON をそのまま RFC 8785 にして top-level の signatures だけ落とす。
- @a2a-js/sdk 1.1.0 の canonicalizeAgentCard は、先に protobuf の型に往復させ(AgentCard.toJSON(AgentCard.fromJSON(card)))、空値を落としてから RFC 8785 にする。1.0 schema の外の欄は消える。
- 扉の card(0.4.15)では、Go の正規形 6852 バイト(sha256 d9fe9289…)、JS SDK の正規形 6410 バイト(sha256 1489fe91…)。JS SDK が落とす top-level 欄: url, protocolVersion, securityRequirements, compensation, preferredTransport。
- 結果: JS SDK で作った署名は Go で検証できない。Go で作った署名も、schema 外の欄・既定値・空配列が 1 つでもある card では JS で検証できない(往復で欄が消えて別のバイトになる)。
- 仕様(docs/specification.md 8.4.1、commit 72b3761b、2026-09-25)は規則 1 で「正規化の前に JSON は protobuf の field presence に従う(既定値は REQUIRED か optional でない限り落とす)」と書いている。JS SDK の proto 往復がこれで、a2a-go 2.6.0 は規則 2(RFC 8785)と 3(signatures 除外)だけ適用して規則 1 を飛ばしている。**ズレているのは Go 側。** 扉の 2 本のうち仕様どおりの署名は signatures[1](JS SDK の形)、signatures[0](素の RFC 8785)は互換用。
- 扉は 0.4.x から同じ鍵で 2 本(JS SDK の形 + 素の RFC 8785)を付けているので、Go 2.6.0 は signatures[0] を PASS にした。1 本しか付けていない card は、どちらかの SDK で「無効」に見える。
- 独立した 2 実装(a2a-go の canonicalizeJSON と sign_lib.mjs の jcsCanonical)は、素の RFC 8785 についてはバイト一致した。ズレは RFC 8785 の実装差ではなく「何を正規化するか」の差。

## 出す先と順番(TOshi の手)
1. a2aproject/a2a-go に issue(下の英文)。#141 と #441 を参照。
2. 返事で「仕様どおり」と言われたら、a2aproject/A2A の仕様側に「8.4 が指すバイトはどちらか」を問う。
3. 貼るのは TOshi。AI 支援の開示行は入れない(2026-09-26 の取り決め)。

## issue 文案(英語、ダッシュ無し)

Title: AgentCard JWS: v2.6.0 canonicalizes the served JSON, the JS SDK canonicalizes the proto projection; signatures do not cross-verify

Body:

With v2.6.0 (AgentCard JWS signing and verification, #141; canonicalization in #441) I ran `a2acrypto.Verifier.Verify` against a card that is signed with `@a2a-js/sdk` 1.1.0 `generateAgentCardSignature`. The signature does not verify, and the cause is a difference in what the two SDKs canonicalize, not a key or encoding problem.

What each SDK does:
- a2a-go v2.6.0 `canonicalizeJSON` takes the served JSON as is, removes the top-level `signatures` field, and applies RFC 8785.
- @a2a-js/sdk 1.1.0 `canonicalizeAgentCard` first runs the card through the protobuf model (`AgentCard.toJSON(AgentCard.fromJSON(card))`), removes empty values (`cleanEmpty`), then applies RFC 8785. Every field outside the 1.0 schema is dropped before hashing.

Reproduction (public card, no account needed):

    curl -s https://gate.horizonshield.dev/.well-known/agent-card.json > card.json

The card carries two ES256 signatures from the same key (jku on the card): `signatures[0]` over the plain RFC 8785 form of the served card, `signatures[1]` over the JS SDK form. Verifying both with v2.6.0 `a2acrypto` (JWKSKeyResolver on the card's jku):

    served_bytes=9420 served_sha256=99d374405a59bbdc92f93f52e5f6c647da8db8ec06a5b851c59dc8e1880fcb8d
    go_canonical_bytes=6852 go_canonical_sha256=d9fe9289b493f93e2d771a0fcda118cf39177baf98392a2ad299f930098aef1a
    signature[0]: PASS
    signature[1]: FAIL signature verification failed

The JS side on the same bytes:

    js_sdk_canonical_bytes=6410 js_sdk_canonical_sha256=1489fe91a2d6cbd6fcc88ce40d3c929eea9597832c3044fdc2c68877907d9f75
    js_plain_jcs_bytes=6852   js_plain_jcs_sha256=d9fe9289b493f93e2d771a0fcda118cf39177baf98392a2ad299f930098aef1a
    top_level_fields_dropped_by_js_sdk=["url","protocolVersion","securityRequirements","compensation","preferredTransport"]

So the two RFC 8785 implementations agree byte for byte on the plain form (Go's `canonicalizeJSON` and an independent 6-line JCS in the signer produce identical 6852 bytes). The 442-byte difference is entirely the proto projection. Consequences:
- A card signed only by the JS SDK reads as invalid to a Go v2.6.0 client.
- A card signed only by Go, if it contains any field outside the 1.0 schema (or any empty value), reads as invalid to a JS client.
- Signers that need to be verifiable by both today have to attach two signatures, which is what the card above does.

The harness (v2.6.0 `a2acrypto` files copied verbatim, standard library only, plus the JS comparison script) is here: https://github.com/ogasurfproject-jpg/horizon-shield/tree/main/workers/a2a-card-sign/interop-go

Which side matches the specification: section 8.4.1 "Canonicalization Requirements" (docs/specification.md at 72b3761b, 2026-09-25) has three rules. Rule 1: "Before canonicalization, the JSON representation MUST respect Protocol Buffer field presence semantics as defined in Section 5.7", with "Default values MUST be omitted unless the field is marked as REQUIRED or has the optional keyword". Rules 2 and 3 are RFC 8785 and the exclusion of `signatures`. v2.6.0 `canonicalizeJSON` applies rules 2 and 3 but not rule 1: it never projects the JSON through the proto model, so defaults, empty repeated fields and unknown fields all stay in the signed bytes. The JS SDK's proto round trip is rule 1. So as far as I can read the spec, a signature produced by v2.6.0 over a card that contains any default value, empty array or non-schema field is not the signature the spec describes, and v2.6.0 will reject spec-conformant signatures from the JS SDK for the same cards.

Suggested fix: apply the proto projection in `canonicalizeJSON` (unmarshal into `a2a.AgentCard` with presence semantics, marshal back, then JCS), and add a cross-SDK golden: one card, one key, signed by the JS SDK, verified by Go, and the reverse. The card above can serve as a public golden; it will keep both signatures until the SDKs agree.

One spec-level note that falls out of this: under rule 1, fields outside the schema (for example extension declarations placed at the top level rather than in `capabilities.extensions[].params`) are not covered by the signature at all. That is worth one sentence in 8.4.1, since operators may assume the whole served document is signed.
