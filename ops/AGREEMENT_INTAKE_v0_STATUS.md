# Agreement Intake v0, status, 2026-09-16

Honest state. The 番人 built and verified; the deploy trigger is TOshi's hand.
Phase 1 (accept, dedupe, serve by sha) was deployed earlier today. Section 2.4
(the daily batch and anchor) is now built and green and needs a redeploy to ship.

## Built and green (design and verify)

- `ops/AGREEMENT_INTAKE_v0_DECISIONS.md`. The five section 4 items, decided in
  the open with reasons. Nothing there relaxes a MUST or MUST NOT.
- `workers/hs-ledger/nenrin/agreement-v0/agreement_intake.mjs`:
  `handleAgreementIntake` (POST), `handleAgreementGet` (GET by sha, now reports
  anchored status and the ledger entry), `AgreementDedupeDO` (atomic dedupe),
  `doStore(env)` (fails closed; also holds the anchor queue and result markers),
  `buildAgreementBatch` (pure, deterministic, sorted by sha),
  `agreementSelfDescription` / `recomputeRecipe`.
- The live worker `src/worker.js`: imports and re-exports the above; serves
  `GET /agreement`, `POST /agreement`, `GET /agreement/pending`,
  `POST /agreement/anchor` (operator auth), and
  `GET /agreement/{canonical_sha256}`; `fetchKey` reuses
  `witnessFetchDomainKey`; `agreementRateLimit` is the salted per network daily
  cap (a spam control, never a fee); `anchorAgreementPool` bundles the accepted
  pool into one ledger entry and anchors its hash, mirroring
  `anchorWitnessPool`; the daily `scheduled` cron now runs it at 00:30 UTC after
  the witness batch.
- `workers/hs-ledger/wrangler.jsonc`: DO binding `AGREEMENT_DEDUPE_DO` and the
  migration `{ tag: v1, new_sqlite_classes: [AgreementDedupeDO] }`, house form.
- Tests, all green:
  - `nenrin/agreement-v0/agreement_intake.test.mjs` : ALL PASS (55), against the
    real verifier and the real DO class, including the batch and anchor path.
  - `test/agreement.test.mjs` : ALL PASS (17), driving the live worker through
    every route including `/agreement/pending` and `/agreement/anchor`.
  - `test/ledger.test.mjs` : ALL PASS (route set names the new routes).
  - `test/mcp.test.mjs` : ALL PASS.
  - `nenrin/agreement-v0/agreement_verify_test.mjs` : 5,286 / 5,286, untouched.

Run, all green:
    cd workers/hs-ledger
    node nenrin/agreement-v0/agreement_verify_test.mjs
    node nenrin/agreement-v0/agreement_intake.test.mjs
    node test/agreement.test.mjs
    node test/ledger.test.mjs
    node test/mcp.test.mjs

## Deploy (TOshi's hand only, never the 番人's)

Do NOT put a trailing `# comment` on a command line: zsh interactive does not
treat `#` as a comment, so it passes the comment as arguments and wrangler
errors. Every line below is comment free on purpose.

    cd ~/horizon-shield/workers/hs-ledger
    node test/ledger.test.mjs && node test/mcp.test.mjs && node test/agreement.test.mjs && node nenrin/agreement-v0/agreement_intake.test.mjs
    npx wrangler deploy

Smoke test after deploy:

    curl -s https://ledger.horizonshield.dev/agreement | jq .
    curl -s https://ledger.horizonshield.dev/agreement/pending | jq .

## What a deploy now ships (full v0)

`POST /agreement` accepts a fully signed record, deduplicates it atomically on
the DO, serves it by sha, and queues it for anchoring; a refused record is
returned with its report and never stored; an unreachable key server is a 503,
not a verdict. The daily cron at 00:30 UTC bundles the accepted pool into one
ledger entry and anchors its hash, so `agreed_at` is bounded from above; the
Bitcoin stamp then follows on the operator's existing OpenTimestamps run, exactly
as the witness pool already works. The operator can also anchor on demand with
`POST /agreement/anchor` and the ledger admin key.

## Follow ups (not blocking a deploy)

- The Bitcoin stamp on an agreement batch entry rides the existing GitHub Actions
  OTS runner; until it stamps, the entry is `ots_status: unstamped`, same as any
  fresh witness batch. Nothing new to build.
- A record that was accepted but whose queue write failed (best effort) is served
  but unanchored. Rare; a later reconcile pass could sweep the DO for such shas.
  Not needed for v0.

## What this does not claim

That it is correct: only that every handler, route and the anchor path is tested
against the real verifier and the real DO class, and that each boundary MUST and
MUST NOT is exercised. That the boundary is complete. That an endpoint is live at
the latest version: the section 2.4 code needs a redeploy, which is TOshi's hand.
