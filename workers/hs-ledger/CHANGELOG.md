# hs-ledger changelog

Started on 2026-10-30. Earlier changes are in the git history.

## 2026-11-02

- The content check runner (hs-furui-runner) sends its daily root through a service binding to a named entrypoint, FuruiDayIntake, instead of the public POST /furui-check-day. The entrypoint runs every check the public path runs and is not counted in the public caps, so a flood of public posts can no longer push the runner's record out of the day. The public caps stay as they are. A named entrypoint has no public URL.
- furui-check-day-intake 0.2.0: another record for a day whose first record has the same root is answered 200 with the first record's sha and is not stored. Another root for the day is still refused (day_already_recorded).
- runner-1's public half is listed in /.well-known/furui-check-keys.json, from height 0, so the runner's daily records can be accepted.
- POST /furui-check-day is rate limited before anything is read: 50 a day in all and 10 a day per network (429). A runner writes one record a day.
- The admission intake reads version 0.4 (admission-intake 0.4.0): the content block in the shape of FURUI A7.4, with a salted commitment to the content, the decision and the marks. It checks the block's shape and its nine rules, the same as the verifier, and never sees the content. A 0.4 record sent to an intake that does not know 0.4 is refused as malformed and not stored.
- POST /furui-check-day (furui-check-day-v0): a content check runner's signed daily root goes to the public pool and rides the daily batch at 00:30 UTC, one record per runner per day. The runner's keys are served at /.well-known/furui-check-keys.json; the list is empty until the runner's key is made, so every day record is refused until then.
- GET /resume fills agreements[]: the anchored agreements a party on the endpoint's host signed, each checked by the same two hops as the measurements (the stored bytes hash to the sha the batch lists, and the batch is the anchored entry).

## 2026-10-30

- Plain-text records (plans, pins, score records: anything that is not JSON) are no longer shown as "schema v0 · concept-proof" with the note that only the estimate JSON is hashed. The receipt page badges them "plain-text record" and says the claim is the SHA-256 of all the record bytes, as the raw route serves them. /cite and the jidec_cite tool of hs-jidec-mcp say the same. JSON v0 estimate entries such as #10 keep their old note. Commit 65eb6094.
- Reported on entry #194 by an outside witness, Federico Blanco (invinoveritas), credited by name with his consent.
