# TSUNAGI: put your verifier on the board

TSUNAGI (繋, "to connect") runs every registered implementation every night, each cloned from its author's own
repository at the default branch head, against the corpora in this repository. The result is
[`ops/tsunagi/BOARD.md`](../../ops/tsunagi/BOARD.md), with the whole run in `board.json` (sha256 inside),
streaks in `history.json` and a badge per implementation in `badges/`.

What a green cell establishes: that this code, at this commit, reproduced this corpus on this run. What it does not:
that the corpus is right, that the code is correct elsewhere, or anything about who wrote it. A green cell is not an
endorsement, and a red one is written down, never hidden.

## Three ways a cell is scored

- **Refereed by the board** (`"parse": "batch_referee"`, NENRIN corpora). The board writes the fixtures to one batch
  file, your command writes one verdict signature per fixture, and the board compares each with the frozen
  `expected.json` itself. Your own count is not read. This is the form to use for a new NENRIN verifier.
- **Refereed by the board, approvals** (`"parse": "batch_approval_referee"`, the a2a-approval-v2 vectors). The board
  writes `[{"name", "contract", "approval"}]` without the expected values, your command writes
  `{"<name>": {"result", "reason"}}`, and the board compares each answer exactly with this repository's pinned copy of
  the vectors (`workers/hs-ledger/nenrin/musubi-v0/fixtures/babyblueviper1_approver_v2/vectors.json`, sha256 pinned in
  `run_board.py`), not with the copy in your repository. Self-reported rows for the same corpus stay beside them.
- **Refereed by the board, crosswalks** (`"parse": "crosswalk_findings"`). For a tool that compares two checkers'
  reports rather than verifying a corpus itself. The command writes one comparison report to `@out`; the board reads it
  and compares every finding with an expectations file pinned in this repository
  (`tools/tsunagi/expected/<corpus>.json`, sha256 pinned in `run_board.py`). A case counts only when all of its findings
  match, and the tool's exit code is recorded but is not the result. The first is Poke-nushi's NENRIN and VATE S3
  crosswalk (VATE #84): per case, the NENRIN records it compares must be byte for byte the ones published in
  `workers/hs-ledger/nenrin/vate-s3-v0/records`, CW-01 to CW-11 must have their expected status, each NENRIN verifier
  (npm, PyPI) its expected verdict and refusals, and VATE its expected assessment and `record_linkage` with `retry_authorized: false`. The board records the sha256 of every report it scored, and the nightly run keeps the reports themselves in `reports/` of its 30-day `tsunagi-board` workflow artifact (`--keep-reports`). It has
  two rows, `"mode": "saved"` (the saved reports compared) and `"mode": "rerun"` (the VATE assessor and both NENRIN
  verifiers run again at the versions the crosswalk names), and the board shows which one each cell did.
- **Self-reported** (`count_line`, `all_pass`, `approval_lines`, `json_results`, `pytest`). The board reads the count
  your command prints. Kept for implementations that registered that way; the board says so in the "scored by" column.
- **Tonight's fresh bundles.** The adversary in `workers/hs-ledger/nenrin/conformance-v0` signs a new set of edge
  bundles with new keys on every run. Every implementation listed under `differential` reads the same batch, and the
  board lists each bundle on which any two of them disagree. There is no frozen answer; a disagreement is a finding
  about the spec, the reference or an implementation, and a person triages it.

## What refereeing does and does not stop

The board loads every corpus before any outside code runs, and after each run it checks that the corpora, the
generator and its own tools are byte for byte what they were; a run that changed them is restored and marked not a
pass. That stops a verifier from reporting a count it did not earn. It does not stop a verifier written to the
answers: `expected.json` is public. Tonight's fresh bundles are the check for that, since they are new every run and
have no published answer.

## The batch contract (any language)

    input  @in   a JSON array      [{"name": "<case>", "bundle": {...}}, ...]
    output @out  a JSON object     {"<case>": {"verdict": "accepted", "refusals": [...], "findings": [...]}, ...}
                                   or {"<case>": {"error": "..."}} for a case you could not evaluate

Codes are compared as sets, as `workers/hs-ledger/nenrin/provenance-v0/VERIFIER.md` section 4 defines the verdict
signature. A missing case, an extra case, an error or any difference counts against you. Exit 0.

## Check yourself first, offline

    pip install nenrin-verify
    nenrin-tsunagi run nenrin-interop-v0.2-edge -- "python3 my_verifier.py {in} {out}"
    nenrin-tsunagi row nenrin-interop-v0.2-edge -- "python3 my_verifier.py {in} {out}"

`run` is the board's referee with the corpora inside the package, so the number you see is the number the board will
show. `row` prints the entry to paste into `implementations.json`. If your verifier is a Python module with
`verify(bundle)`, the board's adapter `tools/tsunagi/adapters/py_module_batch.py <module> @in @out` calls it as is.

With a clone of this repository you can also run the board itself against your working copy, before you push:

    python3 tools/tsunagi/run_board.py --out /tmp/board --only <your-id> --local <your-id>=/path/to/your/checkout

## The ledger, graded by an outside checker

Each night the board also grades this project's own ledger (JIDEC, `ledger.horizonshield.dev`) with a checker this
project did not write: `vlc-check` 1.0.0 of [VLC-1](https://github.com/MattyIceMatrix/vlc-1) (Matthew Moore, MIT),
under the adapter its author wrote for this ledger. `ledger_vlc.py` does it; the row is in `board.json` (`ledger_vlc`,
inside `board_sha256`), one line a night in `history.json`, and a section of BOARD.md.

- Pins: the PyPI wheel by its sha256 (`96cc938b...`) and `conformance.py` inside it by its own, run as
  `python3 -I conformance.py` with nothing installed; the adapter `adapters/jidec-ledger-chained.json` at commit
  `dada2c99`, sha256 `5c6d1c9c...`.
- The head is not read from the export. It is the end-marker hash in the newest `nenrin-head-checkpoint-v1` entry whose
  OpenTimestamps proof is confirmed. The board checks that the proof commits the entry's claim to the block the entry
  names, and that mempool.space and blockstream.info serve the same header for that block (the code of
  `nenrin-verify furui-day --bitcoin-header`).
- The log graded is entries 1..n of the export as served, n being the checkpoint's `ledger_head.n`, then the
  `jidec-head-v1` marker for n: byte for byte the export the ledger serves when it has n entries. Entries after n wait
  for the next checkpoint.
- Two of the spec's Annex A mutations of the same log (`truncate-tail`, `flip-byte`) must grade L0, or the night is not
  ok: a check that cannot fail would be no check.
- Every ledger head written inside the entries is held too. The board reads the last 40 entries as the ledger serves
  them, and below them every entry above the most entries an earlier night that held graded, when that is lower (no
  earlier head reaches there, so an older stamp is what would show a rewrite). On a night with no earlier night that
  held (the first night, or after a gap) it reads every entry. Each must be the
  export's: its record hashes to its claim, and the export carries that claim at that n. The export, recomputed, must
  reach the head that each `nenrin-head-checkpoint-v1` and each `nenrin-witness-batch-v1` entry among them states. An
  older stamp the export no longer reaches shows here even when `history.json` has nothing to compare with. A walk that
  does not read every entry of its range leaves the night not ok.
- The board recomputes the links of the whole export itself, and tonight's export must still reach the head of every
  earlier night in `history.json` that held. A rewrite of entries an earlier stamp covered shows there, even after a
  newer checkpoint was stamped over it. Tonight's checkpoint must also cover at least the entries each of those nights
  graded: a newest confirmed checkpoint that went back is not a night that held.
- Each night keeps the export's sha256, the entry count, the entries graded, the head compared and the grade string. A
  step that could not be done is written as not run, with the reason.
- What a night cannot show: on a night with no earlier night that held, a ledger rewritten whole, every head inside it
  rewritten and stamped again, agrees with itself. The board's own nights from then on, and copies others keep (an
  export someone saved, a head someone holds), are what would show it. The same goes, above the entries the earlier
  nights graded, for a rewrite that rewrote the older stamps there too: the walk holds each older stamp as the ledger
  serves it, and only the used checkpoint's proof is checked.

To redo a night yourself:

    python3 tools/tsunagi/ledger_vlc.py --out /tmp/l     # the export, the cut log, the adapter, the checker's reports
    pip install vlc-check==1.0.0
    vlc-check --log /tmp/l/cut.jsonl --adapter /tmp/l/adapter.json --expect-head <head compared> --json

## Join

Open one pull request that adds your row to `implementations.json`: your public `https` repository, its licence,
the command, the corpus. The pull request runs your row at once (workflow `tsunagi-preview`, read-only token, no
secrets) and shows the result in the job summary. After merge your row is on the next night's board, at your own
commit, in your own repository. To list yourself under tonight's fresh bundles, add an entry under `differential`.

Your badge, for your own README:

    ![TSUNAGI](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/ogasurfproject-jpg/horizon-shield/main/ops/tsunagi/badges/<your-id>.json)

To change your command, rename your row or leave the board, open an issue or a pull request; it is done the same
day. The board runs your default branch head, unless your row sets `"pin"` to a full 40-hex commit sha agreed with you: then it runs exactly that commit, a pin that cannot be fetched is reported as not run (never replaced by the head), and the commit cell is marked pinned. Moving a pin is a separate change you approve. Each run row may also set `"mode"`: `rerun` (the default, the board runs your checker) or `saved` (the board compares reports you saved); board.json records which one each cell did. The board never runs outside code with a write token or a secret.
