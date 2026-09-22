# hs-selection-v0

A machine-readable **Choice Layer** for HORIZON SHIELD.

Discovery is solved: an agent can find this service. Choice is not: an agent that
has found it still has no machine-checkable way to answer "for my task, is this the
right call, and how would I know". This spec fills that gap without becoming
marketing.

## The one rule

A selection manifest lists **decision criteria and points to recomputable
evidence. It asserts no ranking. Verify, do not trust.**

This is the same stance as NENRIN itself. We do not tell an agent to choose us. We
publish the axes that matter for a task, our verifiable value on each with a probe
the agent runs itself, and an honest statement of when not to use us. The agent
recomputes. The manifest is never the authority; the bytes it points to are.

A "why choose us" blob that an agent is asked to trust is the thing this
architecture exists to reject. So this spec forbids it structurally (see
invariants).

## File shape

One manifest per task, served as JSON. `selection.<task>.json`.

```json
{
  "spec": "hs-selection-v0",
  "task": { "id": "string", "label": "string", "description": "string" },
  "provider": { "organization": "string", "url": "https url" },
  "as_of": "YYYY-MM-DD",
  "principle": "This manifest lists decision criteria and points to recomputable evidence. It asserts no ranking. Verify, do not trust.",
  "axes": [ Axis, ... ],
  "out_of_scope": [ "string", ... ],
  "provenance": { "dataset": "string", "curator": "string", "sources": [ "string", ... ] }
}
```

### Axis

```json
{
  "id": "kebab-case",
  "label": "short human label",
  "why_it_matters": "why an agent choosing for this task should weigh this",
  "our_claim": "a factual, checkable statement. no superlatives.",
  "verify": {
    "method": "GET",
    "url": "https url an agent calls",
    "recompute": "the exact step that turns the response into a yes/no",
    "pass_if": "the condition that makes our_claim true",
    "self_contained": true
  },
  "measure_any_provider": "how to measure THIS axis on ANY provider, so the comparison is fair and provider-neutral"
}
```

## Invariants (enforced by selection_verify.mjs)

1. `principle` present and exactly the sentence above.
2. Every axis has `verify.url` (https), `verify.recompute`, `verify.pass_if`, and
   `measure_any_provider`.
3. `out_of_scope` is a non-empty array. If we cannot say when not to use us, the
   manifest is marketing and is rejected.
4. No ranking or superlative language anywhere: the words `best`, `better`,
   `superior`, `leading`, `#1`, `only one`, `no competitor`, `unbeatable` (and
   their obvious variants) are rejected. Claims are about us, checkable, and
   comparable, never about others.
5. Every `verify.url` is on a public origin that needs no account, so a stranger
   can recompute.

## Live check

`node selection_verify.mjs <manifest.json>` validates the invariants offline.

`node selection_verify.mjs <manifest.json> --live` additionally calls each
`verify.url` and runs the machine-runnable recompute (hash match, field presence).
Unreachable or mismatched is **fail-closed**: a claim that cannot be recomputed
does not pass. This is the manifest verifying itself. We ship the Choice Layer
with the tool that checks it, and we run that tool against our own claims.

## Not in v0

- No competitor values. We describe how to measure any provider on each axis and
  leave the measuring to the agent. We never fill in someone else's number.
- No score. An agent may compute one from the axes; if it does, it has left the
  manifest and owns that number.
- Placement in the path (agent card reference, well-known route) is wiring, not
  part of this file. See README.
