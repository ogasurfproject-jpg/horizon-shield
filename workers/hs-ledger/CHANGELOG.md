# hs-ledger changelog

Started on 2026-10-30. Earlier changes are in the git history.

## 2026-10-30

- Plain-text records (plans, pins, score records: anything that is not JSON) are no longer shown as "schema v0 · concept-proof" with the note that only the estimate JSON is hashed. The receipt page badges them "plain-text record" and says the claim is the SHA-256 of all the record bytes, as the raw route serves them. /cite and the jidec_cite tool of hs-jidec-mcp say the same. JSON v0 estimate entries such as #10 keep their old note. Commit 65eb6094.
- Reported on entry #194 by an outside witness, Federico Blanco (invinoveritas), credited by name with his consent.
