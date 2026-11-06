# READINGS145 (written before the run; checker war145_check.py)

Source text: README.md of maximusrufus/work-acceptance-record at 066315f0 (tag v1.4.5), step 12 and the Changelog line for 1.4.5.
R1 to R22 of READINGS.md (war12) and READINGS144.md are carried over unchanged. Only step 12 is added.

| R | Section | Text | Chosen reading | Other reading | Vectors it touches |
|---|---|---|---|---|---|
| R23 | step 12 (1.4.5) | "the producer's key counts only when relying_party_keys holds the same decoded key" | compared as decoded bytes over all relying_party_keys entries; the key_id of the entry is not compared; the producer's key is the single issuer entry for parties.producer.key_id, read with step 2's canonical-base64 rule | the entry must also carry the same key_id | 110, 111, 112 |
| R24 | step 12 (1.4.5) | "an entry that does not decode matches nothing" | an entry that is not an object, has no public_key_base64, or is not canonical base64 matches nothing; a relying_party_keys value that is not an object with a keys array has no entries, so the claim fails | refuse the record under the Types rule | none in 01-112 |
| R25 | step 12 (1.4.5) with step 8 | the rule applies when relying_party_keys is supplied, the record claims independent and the producer states a key_id | not applied when derived independence is already self-checked by the step 8 key rules (the outcome is the same); applied whatever the key's point check gives (R22 kept for KEY_REJECTED) | none | none in 01-112 |
