# FURUI blind-03: the salt, the selection and the draw tool, published at opening

- salt.hex: the 32 byte salt. Its SHA-256 was anchored before the draw in JIDEC ledger entry 177 (the plan).
- manifest.json: the strata, the drawn keys and the root. The root was anchored in entry 179 before anyone read the drawn set; the pin came after it; the score digests are in the entry that cites this commit.
- draw_blind03.py: the draw tool, byte for byte the one named in the plan (entry 177, sha256 ac2bda3f71e2ad1dd0345e76ce81e9df2e5f5d3a45ca29c79f93b2c367b578d3). It uses the Python standard library only and holds no FURUI rule, classifier or prompt.
- The split tool and the dataset pins named in the plan are in ../furui-blind-02/ (pubprep.py and PINS.txt). The population is the four MEASURE files with the rows drawn into blind-02 removed (../furui-blind-02/manifest.json); the plan names the four files that remain by their SHA-256.
- business_validate_opened.json: the business validation count that chose 0.2.9 (a), sealed before the plan and opened with this result. Counts only; no sentence is published.

Anyone can recompute the seed, the selection and the root from salt.hex, manifest.json, the hash of the block at the plan's height H (000000000000000000010ff7c836bfe7eab867d288a11ed2a5f159b869a41b95) and the four MEASURE files named with their SHA-256 in the plan record:

    python3 -I draw_blind03.py verify salt.hex 000000000000000000010ff7c836bfe7eab867d288a11ed2a5f159b869a41b95 <dir of the four MEASURE files> manifest.json <blind03.jsonl>

blind03.jsonl holds the drawn rows: the manifest's keys, taken from those four files. The four MEASURE files are what remained of blind-02's after its draw; they are made from the public datasets by our split tool, which the blind-02 plan names by its SHA-256, and the split tool is not in this directory.
The row texts are the public datasets' own; the per-row answers and the raw model answers are not published (their SHA-256 are in the score record).
