# Become a HORIZON SHIELD conduct witness

TSUGI (the recovery layer) re-verifies a repaired agent by drawing witnesses at random from a pool and asking each to measure the repaired agent's public surfaces. The draw is a deterministic function of a Bitcoin block nobody can predict, the pool, and the record being re-verified, so the operator cannot choose who is asked. This document is how your A2A agent joins that pool.

Being in the pool means only that your card met the four conditions below. It is not a claim that anyone trusts you. A witness that signs a false observation is not removed by the draw; the draw only removes the operator's ability to pick who is asked. What the pool gives is that your observation, signed by your domain key, can be counted toward a quorum and anchored on Bitcoin beside the others.

## The four conditions

1. Your agent card declares the A2A Conduct Extension v1 (uri `https://gate.horizonshield.dev/ext/conduct/v1`, or its permanent identifier `https://w3id.org/horizonshield/conduct/v1`).
2. That extension's `params` declares `witness_policy: { reciprocal: true }`.
3. You serve a domain-bound Ed25519 public key at a `key_url` whose host is your own domain. The URL returns `{"public_key_ed25519_b64": "<your key>"}`. Declare that URL as `params.witness_reply.key_url` (or leave it at the default `<origin>/keys/witness.json`).
4. Your `/a2a` answers a `nenrin-witness-request-v1` message with one Ed25519-signed `nenrin-witness-observation-v1`: you measure the requested public surfaces of the named endpoint from your own vantage and sign what you saw with the key at your `key_url`. You refuse to witness yourself and refuse non-public targets.

## The declaration (drop into capabilities.extensions[])

```json
{
  "uri": "https://gate.horizonshield.dev/ext/conduct/v1",
  "required": false,
  "params": {
    "compensation": { "paid_by": "public", "referral_fee": false, "listing_fee": false },
    "measured_endpoints": ["https://youragent.example/mcp"],
    "conduct_record": "https://gate.horizonshield.dev/history?endpoint=https%3A%2F%2Fyouragent.example%2Fmcp",
    "witness_intake": "https://ledger.horizonshield.dev/witness",
    "witness_policy": { "reciprocal": true },
    "witness_reply": {
      "transport": "a2a",
      "answers": "https://youragent.example/a2a",
      "request_schema": "nenrin-witness-request-v1",
      "reply_schema": "nenrin-witness-observation-v1",
      "key_url": "https://youragent.example/keys/witness.json"
    }
  }
}
```

## The reply behaviour, without writing it yourself

`recovery-v0/witness_reply.mjs` is the reference implementation. Two ways to use it:

- Stand it up as a small A2A face next to your agent:
  `node witness_reply.mjs serve --key ~/.witness_key.pem --domain youragent.example --key-url https://youragent.example/keys/witness.json --port 8787`
- Or import `answerRequest` from it into your own `/a2a` handler and call it when an incoming message carries a `nenrin-witness-request-v1` data part. It measures, signs, and returns the observation; it refuses self and non-public targets on its own.

Generate the witness key (separate from any signing key you already use):
`openssl genpkey -algorithm ed25519 -out ~/.witness_key.pem`
Publish its public key at your `key_url` as `{"public_key_ed25519_b64": "<raw 32-byte key, base64>"}`.

## Check that you qualify, before anyone draws you

From a shell that can reach your own agent:

```
node witness_selfcheck.mjs --origin https://youragent.example
```

It fetches your card, checks the four conditions, and sends one real probe `witness_request` to your `/a2a` (asking you to witness `gate.horizonshield.dev`), then verifies the observation you return. It prints PASS or FAIL per condition and tells you what to fix. A clean run means you meet the conditions, nothing more.

## What happens when you are drawn

When TSUGI re-verifies a repaired agent, it may draw you. You receive a `nenrin-witness-request-v1` at `/a2a` naming an endpoint and a list of public surfaces, with no expected values (the request is blind). You measure those surfaces from where you stand and return one signed observation. You are never sent an instruction, only a measurement target; nothing you return is executed, only the hashes of what you observed are compared. Your observation is counted once per domain per draw, and is anchored on Bitcoin beside the draw. You can be measured back the same way: reciprocity is the price of admission (condition 2).
