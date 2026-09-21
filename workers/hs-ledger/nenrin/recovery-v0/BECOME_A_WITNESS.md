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
- Or import `answerRequest` from it into your own `/a2a` handler and call it when an incoming message carries a `nenrin-witness-request-v1` data part. It measures, signs, and returns the observation; it refuses self, refuses non-public targets by name and by resolved address, and connects only to addresses it vetted (next section).

Generate the witness key (separate from any signing key you already use):
`openssl genpkey -algorithm ed25519 -out ~/.witness_key.pem`
Publish its public key at your `key_url` as `{"public_key_ed25519_b64": "<raw 32-byte key, base64>"}`.

## Do not let a public name point you inward (SSRF)

The request names the target by hostname. Screening the hostname (https only, no port, no IP literal, no localhost, no .local or .internal and the like) is not enough. A public looking name can resolve to 10.0.0.5, to 169.254.169.254 (the cloud metadata address) or to 127.0.0.1, and a witness that measures it signs what it saw inside its own network and hands it out. The reference closes this in three steps, and a responder you write yourself must do the same three:

1. Resolve the name, every address it has.
2. Refuse if any one of them is in a blocked range. v4: 0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.0.0/24, 192.0.2/24, 192.168/16, 198.18/15, 198.51.100/24, 203.0.113/24, 224/4, 240/4. v6: ::, ::1, fe80::/10, fc00::/7, ff00::/8, 2001:db8::/32; a mapped address (::ffff:a.b.c.d) or a NAT64 address (64:ff9b::a.b.c.d) is judged by the v4 address inside it. Anything that does not parse is refused. Fail closed.
3. Pin. The socket connects only to an address that passed step 2. In Node, hand `node:https` a `lookup` option that resolves and re-checks at connect time; that closes the window between a pre-check and the connection in which DNS could be rebound to an inside address.

In the reference this is `witness_ssrf_guard.mjs`: `isBlockedIp` (the table), `resolveAllowed` (the pre-check, a clean decline that names the address) and `makeSafeFetch` (`node:https` with the pinning lookup, https only, port 443 only, redirects not followed, so a redirect cannot make a second target of an inside host). `answerRequest` runs the pre-check by default and hands the measurement the pinned fetch by default, so both `serve` and `import { answerRequest }` inherit it with no flag. The second URL a measurement visits, the `jku` of the target card's signature, goes through the same fetch and the same screen.

If you pass your own `fetchImpl`, it must pin; a fetch that resolves on its own reopens the hole. `resolver: null` disables the pre-check only (the pinned fetch still refuses at connect, later and with a less readable error). `allowPrivateTargets: true` disables all three and exists for a lab that is not exposed to anyone. On Cloudflare Workers the platform fetch does not route to private, link-local or loopback addresses; that is a property of the platform, not of the code, and it does not hold for Node.

Vectors: `node witness_ssrf_guard_test.mjs` (the table, mixed public and private resolution, the metadata address, mapped loopback, the pin refusing before a socket opens; no network). The decline you get when a name resolves inside is `target_not_public` with the offending address in `why`, the same code the hostname screen uses.

## Check that you qualify, before anyone draws you

From a shell that can reach your own agent:

```
node witness_selfcheck.mjs --origin https://youragent.example
```

It fetches your card, checks the four conditions, and sends one real probe `witness_request` to your `/a2a` (asking you to witness `gate.horizonshield.dev`), then verifies the observation you return. It prints PASS or FAIL per condition and tells you what to fix. A clean run means you meet the conditions, nothing more.

## What happens when you are drawn

When TSUGI re-verifies a repaired agent, it may draw you. You receive a `nenrin-witness-request-v1` at `/a2a` naming an endpoint and a list of public surfaces, with no expected values (the request is blind). You measure those surfaces from where you stand and return one signed observation. You are never sent an instruction, only a measurement target; nothing you return is executed, only the hashes of what you observed are compared. Your observation is counted once per domain per draw, and is anchored on Bitcoin beside the draw. You can be measured back the same way: reciprocity is the price of admission (condition 2).
