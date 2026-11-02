# hs-ledger changelog

Started on 2026-10-30. Earlier changes are in the git history.

## 2026-11-02

- The admission intake reads version 0.4 (admission-intake 0.4.0): the content block in the shape of FURUI A7.4, with a salted commitment to the content, the decision and the marks. It checks the block's shape and its nine rules, the same as the verifier, and never sees the content. A 0.4 record sent to an intake that does not know 0.4 is refused as malformed and not stored.
- POST /furui-check-day (furui-check-day-v0): a content check runner's signed daily root goes to the public pool and rides the daily batch at 00:30 UTC, one record per runner per day. The runner's keys are served at /.well-known/furui-check-keys.json; the list is empty until the runner's key is made, so every day record is refused until then.
- GET /resume fills agreements[]: the anchored agreements a party on the endpoint's host signed, each checked by the same two hops as the measurements (the stored bytes hash to the sha the batch lists, and the batch is the anchored entry).

## 2026-10-30

- Plain-text records (plans, pins, score records: anything that is not JSON) are no longer shown as "schema v0 · concept-proof" with the note that only the estimate JSON is hashed. The receipt page badges them "plain-text record" and says the claim is the SHA-256 of all the record bytes, as the raw route serves them. /cite and the jidec_cite tool of hs-jidec-mcp say the same. JSON v0 estimate entries such as #10 keep their old note. Commit 65eb6094.
- Reported on entry #194 by an outside witness, Federico Blanco (invinoveritas), credited by name with his consent.
