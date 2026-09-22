# selection-v0 (Choice Layer)

Discovery is solved. Choice is not. An agent can find HORIZON SHIELD; it still has
no machine-checkable way to answer "for my task, is this the right call, and how
would I know". This directory is the answer, built so it cannot turn into
marketing.

## What is here

- `SELECTION_SPEC_v0.md` -- the schema and the one rule: list decision criteria,
  point to recomputable evidence, assert no ranking, verify not trust.
- `selection.conduct.json` -- manifest for the task "check how an MCP/A2A endpoint
  behaved before connecting" (served by the Verify Gate). Six axes, each with a
  probe an agent runs itself.
- `selection.construction.json` -- manifest for the task "check whether a Japanese
  construction quote is fairly priced" (KIRA). Five axes.
- `selection_verify.mjs` -- the verifier. It checks the invariants offline, and
  with `--live` calls each `verify.url` and recomputes. Fail-closed.
- `selection_verify.test.mjs` -- offline tests (8, all green).

## Run it

```
node selection_verify.mjs selection.conduct.json          # invariants, offline
node selection_verify.mjs selection.conduct.json --live   # also recompute against live endpoints
node --test selection_verify.test.mjs                     # tests
```

Offline result today: conduct 38/38, construction 33/33, tests 8/8.

## Why it is not marketing

The verifier rejects any manifest that ranks competitors or uses superlatives,
that has an empty `out_of_scope`, or that has an axis without a runnable probe or
without a provider-neutral way to measure the same axis on anyone else. We never
fill in a competitor's number. We say how to measure the axis on any provider and
leave the measuring to the agent. This is the NENRIN stance applied to selection:
we do not tell you to choose us, we give you the criteria and the bytes.

## Placement in the path (wiring)

The manifest only helps at the moment an agent is choosing. So it is referenced
where that choice happens:

1. Served at `GET /.well-known/selection.json` on the Verify Gate
   (gate.horizonshield.dev), returning `selection.conduct.json`.
2. Referenced from the agent card at
   `GET /.well-known/agent-card.json` via `x-selection-criteria`, so any agent
   that reads the card to decide whether to connect finds the criteria and the
   probes in the same fetch.

The construction manifest ships here and is wired into KIRA's surface next, the
same way.

## Deploy (TOshi's manual steps; the guardian does not deploy)

The route and card reference are added to `workers/hs-verify-gate/src/worker.js`
by `patch_selection_endpoint.mjs` (additive, with a timestamped .bak and
`node --check`). After applying:

```
cd ~/horizon-shield/workers/hs-verify-gate
npx wrangler whoami          # expect oga.surf.project / c15ff64a (this gate is on HS)
npx wrangler deploy
```

Then confirm live:

```
curl -s https://gate.horizonshield.dev/.well-known/selection.json | head
node ~/horizon-shield/workers/hs-ledger/nenrin/selection-v0/selection_verify.mjs \
  ~/horizon-shield/workers/hs-ledger/nenrin/selection-v0/selection.conduct.json --live
```

`--live` against the deployed gate is the real proof: the Choice Layer recomputing
its own claims from the running endpoints.
