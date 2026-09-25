# A2A Legal Entity Extension v1 (`legal-entity-v1`)

**Extension URI (the identifier, compared as an exact string):** `https://gate.horizonshield.dev/ext/legal-entity/v1`
**Status:** v1, 2026-09-25. Data-only: declared on the Agent Card, no activation, no request-level echo.
**Reference implementation:** MCP Verification Gate 0.4.15 (`gate.horizonshield.dev`), which declares it on its own card and serves this document at the URI.

## 1. The gap this closes

A2A 1.0 section 8.4 signs the proto-shaped Agent Card: the canonicalizer maps the card to the protocol buffer schema and then applies RFC 8785. The proto `AgentProvider` carries `organization` and `url` and nothing else. A legal entity identifier placed at `provider.legalEntity` is therefore dropped before signing. Measured with `@a2a-js/sdk` 1.1.0 `canonicalizeAgentCard`: the identifier does not appear in the canonical bytes, and a card whose signature verifies says nothing, inside its signed bytes, about which company answers for the agent.

Extension `params` survive canonicalization. Declaring the identifier here puts it inside the bytes a spec-conformant signature covers. Nothing else about the card changes.

## 2. Declaration

One entry in `capabilities.extensions[]` with `uri` equal to this URI and `required: false`. `params`:

| key | requirement | type | meaning |
|---|---|---|---|
| `registry` | REQUIRED | string | ISO 3166-1 alpha-2 code of the jurisdiction whose register issued the identifier, or `GLEIF` for an LEI |
| `scheme` | REQUIRED | string | `houjin-bango` (Japan, 13 digits), `lei` (ISO 17442, 20 characters), or the scheme name the register itself uses |
| `id` | REQUIRED | string | the identifier exactly as the register publishes it |
| `name` | REQUIRED | string | the name as the agent declares it; not asserted to match the register |
| `lookup_url` | OPTIONAL | https URL | a page at the register where anyone can look the identifier up |

Unknown keys are ignored by readers of v1.

## 3. The mirror rule

A card MAY also carry the same identifier at `provider.legalEntity`, where many directories read it. When both are present, `registry`, `scheme`, `id` and `name` MUST be equal. A reader that finds them unequal records a discrepancy and relies on neither.

## 4. What a verified card establishes, and what it does not

Establishes, when the card signature verifies under a key served at a `jku` on the agent's own host: the holder of the signing key declared this identifier inside the signed bytes when it signed.

Does not establish: that the register lists the identifier; that the declared name matches the register; that the entity controls the domain; anything about the agent's conduct or prices. The agent asserts and the register answers. This extension only moves the assertion inside the signature, so it can no longer be edited without breaking the signature. Look the identifier up at `lookup_url` yourself.

## 5. Verifying a card

1. Fetch the card. Remove `signatures`. Canonicalize as A2A 1.0 section 8.4 requires (for example `canonicalizeAgentCard` in `@a2a-js/sdk`).
2. Confirm the canonical bytes contain the extension entry and its `id`.
3. Verify the JWS against the key from `jku`.
4. If `provider.legalEntity` is present, compare it with `params` (section 3).
5. Look the identifier up at the register.

## 6. Example (the reference implementation's own declaration)

```json
{
  "uri": "https://gate.horizonshield.dev/ext/legal-entity/v1",
  "description": "The legal entity that answers for this agent, declared inside the signed bytes. The specification is served at the URI.",
  "required": false,
  "params": {
    "registry": "JP",
    "scheme": "houjin-bango",
    "id": "7021001075279",
    "name": "The HORIZ音s Co., Ltd.",
    "lookup_url": "https://www.houjin-bangou.nta.go.jp/henkorireki-johoto.html?selHouzinNo=7021001075279"
  }
}
```

## 7. License

This specification is published under the Apache License 2.0, like the rest of the repository it lives in. Anyone may declare it on their own card.
