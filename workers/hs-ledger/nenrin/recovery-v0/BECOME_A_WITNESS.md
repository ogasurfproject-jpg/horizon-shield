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

## Second layer (Linux): give the responder no way to reach inward at all

Resolve, refuse and pin is the first line. If the process also cannot open a socket to an inside address, a bug in the first line has nothing to exploit. This recipe runs in production at api.babyblueviper.com (contributed by invinoveritas / babyblueviper1, first outside witness of this reference).

**1. Listen on a unix socket, not a port.** `serve` binds every interface. `makeHandler` is exported, so wrap it. The key comes from a systemd credential, and one failed request cannot take the service down:

```js
// OURS (not upstream). Serves upstream's makeHandler on a unix socket instead of upstream `serve`, which binds every interface.
// Key is read from a systemd credential (root-only file); a crash in one request must not take the service down.
import { createServer } from "node:http";
import { chmodSync, existsSync, unlinkSync } from "node:fs";
import { loadWitnessKey, makeHandler } from "./recovery-v0/witness_reply.mjs";

const need = (k) => { if (!process.env[k]) { console.error("missing env " + k); process.exit(2); } return process.env[k]; };
const keyPath = process.env.CREDENTIALS_DIRECTORY ? process.env.CREDENTIALS_DIRECTORY + "/witness_key" : need("WITNESS_KEY");
const sock = need("WITNESS_SOCKET");
const k = await loadWitnessKey(keyPath);
const handle = makeHandler({ signedDomain: need("WITNESS_DOMAIN"), keyUrl: need("WITNESS_KEY_URL"), priv: k.priv, pubRaw: k.pubRaw, pubB64: k.pubB64, maxInFlight: 2 });
if (existsSync(sock)) unlinkSync(sock);
const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error("witness-reply: request failed:", err && err.message);
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "internal" }));
  });
});
server.headersTimeout = 10_000;
server.requestTimeout = 90_000;
server.listen(sock, () => { chmodSync(sock, 0o666); console.error("witness-reply: listening on " + sock + " pubkey " + k.pubB64); });
```

**2. Run it under a systemd unit that denies every inside address.** `IPAddressAllow` is evaluated before `IPAddressDeny`, so allow the resolver stub explicitly (127.0.0.53 on systemd-resolved hosts) or DNS dies with the rest of loopback. A unix socket is not an IP socket, so your own front door is unaffected.

```ini
[Service]
Type=simple
DynamicUser=yes
RuntimeDirectory=witness-reply
RuntimeDirectoryMode=0755
LoadCredential=witness_key:/etc/witness-reply/witness_key.pem
Environment=WITNESS_DOMAIN=api.babyblueviper.com
Environment=WITNESS_KEY_URL=https://api.babyblueviper.com/keys/witness.json
Environment=WITNESS_SOCKET=/run/witness-reply/witness.sock
WorkingDirectory=/opt/witness-reply
ExecStart=/usr/bin/node /opt/witness-reply/serve_local.mjs
Restart=on-failure
RestartSec=5
# Layer 2 behind the reference's resolve/refuse/pin: the process cannot open a socket to any inside address at all
# (loopback incl. our API on :8000, RFC1918, CGNAT, link-local incl. the metadata address, ULA). 127.0.0.53 is the
# systemd-resolved stub the box's DNS goes through. Allow is checked before Deny.
IPAddressAllow=127.0.0.53
IPAddressDeny=127.0.0.0/8 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 100.64.0.0/10 ::1/128 fc00::/7 fe80::/10
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
RestrictNamespaces=yes
LockPersonality=yes
MemoryDenyWriteExecute=no
SystemCallFilter=@system-service
CapabilityBoundingSet=
MemoryMax=300M
TasksMax=64
CPUQuota=50%
```

The private key lives in a root-only file and reaches the service only through `LoadCredential`, so neither the service user nor your API process can read it. `MemoryDenyWriteExecute=no` is deliberate: V8 needs it off.

**3. Forward only witness requests to the socket.** Your `/a2a` sends a message to the socket only when it carries a `nenrin-witness-request-v1` part; every other message is handled as before. At the edge we added a kill flag, a 64 KB body cap, a per-IP and a global rate limit, and a clean "declined" reply when the socket is down.

**4. Prove the kernel layer, not just the code.** From a shell, run a throwaway process under the same IP policy and try to reach the inside addresses (each must time out, while DNS still resolves):

```
systemd-run --wait --pipe --quiet -p DynamicUser=yes -p IPAddressAllow=127.0.0.53 \
  -p "IPAddressDeny=127.0.0.0/8 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 100.64.0.0/10 ::1/128 fc00::/7 fe80::/10" \
  /usr/bin/node -e 'const http=require("http"),dns=require("dns");
    const t=(h,p)=>new Promise(r=>{const q=http.get({host:h,port:p,path:"/",timeout:3000},x=>{r(h+":"+p+" REACHED");x.resume()});
      q.on("error",e=>r(h+":"+p+" blocked ("+e.code+")"));q.on("timeout",()=>{q.destroy();r(h+":"+p+" blocked (timeout)")})});
    (async()=>{console.log(await t("127.0.0.1",8000));console.log(await t("169.254.169.254",80));console.log(await t("10.0.0.1",80));
    dns.lookup("gate.horizonshield.dev",(e,a)=>console.log("dns ->",e?e.code:a))})()'
```

Expected: the first three lines say `blocked`, the last resolves. Then run `witness_selfcheck.mjs` against your origin and send a few hostile targets through your public `/a2a` (a name that resolves to `127.0.0.1` or `169.254.169.254`, yourself, an explicit port): each must be declined with the offending address named.

**5. Pin what you vendor to a named upstream commit, and refuse to deploy on drift.** Steps 1-4 assume the upstream files you're wrapping are the files you actually reviewed. Copy the upstream reference verbatim into your own tree (don't fork-and-edit it — a diff against the manifest below should always be empty), record which upstream commit you copied it from, and generate a flat manifest of every vendored file's hash:

```
sha256sum ./*.mjs ./*.md > MANIFEST.sha256
```

A one-line README next to it is enough to name the commit:

```
Last upstream commit touching these files: <full commit sha>.
Files are copied UNMODIFIED; MANIFEST.sha256 pins them (sha256sum -c MANIFEST.sha256).
Do not edit; re-vendor from upstream.
```

Then make the deploy step itself refuse silently-modified vendoring rather than ship it:

```bash
#!/bin/bash
# Deploy the vendored witness responder and (re)start it. Refuses if any vendored file
# differs from MANIFEST.sha256 -- this is the check that makes "pinned to commit X" a
# real, machine-checked claim rather than a comment nobody re-verifies.
set -euo pipefail
SRC=/path/to/vendored/recovery-v0
(cd "$SRC" && sha256sum -c MANIFEST.sha256 --quiet) || { echo "vendored files differ from MANIFEST.sha256; refusing"; exit 1; }
install -d -m 0755 /opt/witness-reply
rsync -a --delete "$SRC"/ /opt/witness-reply/
chown -R root:root /opt/witness-reply
systemctl daemon-reload
systemctl restart witness-reply.service
```

This is what actually runs at api.babyblueviper.com: `sha256sum -c MANIFEST.sha256` gates every deploy, pinned to upstream commit `7f88a531440307ef834686b786c5910c5ae28db3` (the SSRF resolve/refuse/pin commit this section documents). A change to the upstream reference — intentional or not — either matches the pinned hash or the deploy refuses; it never silently ships a divergent copy under the name of a commit that never actually ran.

## Check that you qualify, before anyone draws you

From a shell that can reach your own agent:

```
node witness_selfcheck.mjs --origin https://youragent.example
```

It fetches your card, checks the four conditions, and sends one real probe `witness_request` to your `/a2a` (asking you to witness `gate.horizonshield.dev`), then verifies the observation you return. It prints PASS or FAIL per condition and tells you what to fix. A clean run means you meet the conditions, nothing more.

## What happens when you are drawn

When TSUGI re-verifies a repaired agent, it may draw you. You receive a `nenrin-witness-request-v1` at `/a2a` naming an endpoint and a list of public surfaces, with no expected values (the request is blind). You measure those surfaces from where you stand and return one signed observation. You are never sent an instruction, only a measurement target; nothing you return is executed, only the hashes of what you observed are compared. Your observation is counted once per domain per draw, and is anchored on Bitcoin beside the draw. You can be measured back the same way: reciprocity is the price of admission (condition 2).
