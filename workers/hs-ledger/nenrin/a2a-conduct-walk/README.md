# a2a-conduct-walk: be a witness in ten minutes

Every agent on the [conduct register](https://gate.horizonshield.dev/register) has a record it did not write. Most of that record is written by one measurement gate, run by one operator. A witness is anyone else who walks the agent from their own machine and files what they saw. The monthly ring counts witnesses by name; two witnesses who disagree are recorded as a discrepancy, not resolved. The operator's own servers are on the register and are measured the same way.

This directory holds the reference witness client for the [A2A Conduct Extension v1](https://gate.horizonshield.dev/ext/conduct/v1) (section 4, `a2a-conduct-walk-v1`). Standard library Python, no account, no key, no payment. What you get back is a sha256 that anyone can recompute from the bytes you filed.

Honest numbers as of 2026-09-06: 9 rows on the register, 1 outside witness, 37 ledger entries anchored to Bitcoin. That is why this file exists.

## 1. One command (any machine with Python 3.8+ and [uv](https://docs.astral.sh/uv/))

```
uvx --from "git+https://github.com/ogasurfproject-jpg/horizon-shield#subdirectory=workers/hs-ledger/nenrin/a2a-conduct-walk" \
  a2a-conduct-walk --origin https://mcp.horizonshield.dev --mode a2a --submit \
  --witness-name "Your name or project" --vantage "where this runs, e.g. laptop in Osaka, VPS eu-west"
```

What happens: the card at `<origin>/.well-known/agent-card.json` is fetched twice, the extension declaration is validated, one A2A `SendMessage` goes to the measured endpoint with the `A2A-Extensions` header, every response body's sha256 is recorded, and the record is POSTed to the intake the card itself names (`https://ledger.horizonshield.dev/witness` for the register's rows). The last line prints `submitted ... http 200` and the sha256. Keep the sha256: it is your receipt, and it appears in the next day's bundle on the ledger.

Without `--submit` nothing leaves your machine; the record is written to `walk_<sha12>.json` so you can read it first. `--transport curl` if an edge answers 403 to Python. `--wire 0.3` to walk as a 0.3 client would.

Without uv: `curl -sSLO https://raw.githubusercontent.com/ogasurfproject-jpg/horizon-shield/main/workers/hs-ledger/nenrin/a2a-conduct-walk/a2a_conduct_walk.py && python3 a2a_conduct_walk.py --origin ... --mode a2a --submit --witness-name ... --vantage ...`

## 2. One tool call from your agent (MCP)

`conduct-witness-mcp` is the same walk as a stdio MCP server with one tool, `witness_walk`. It runs where your agent runs, so the vantage is yours.

Claude Code:

```
claude mcp add conduct-witness -- uvx --from "git+https://github.com/ogasurfproject-jpg/horizon-shield#subdirectory=workers/hs-ledger/nenrin/a2a-conduct-walk" conduct-witness-mcp
```

Claude Desktop, Cursor, or any client with an `mcpServers` block:

```json
{"mcpServers": {"conduct-witness": {"command": "uvx", "args": ["--from", "git+https://github.com/ogasurfproject-jpg/horizon-shield#subdirectory=workers/hs-ledger/nenrin/a2a-conduct-walk", "conduct-witness-mcp"]}}}
```

Then ask your agent: "walk https://mcp.horizonshield.dev as a witness, my name is X, vantage Y". The tool returns the outcome, the assertions, every node's status and body sha256, the sha256 of the record, and the intake's answer. `submit: false` walks without filing.

## 3. A skill for Claude Code (`skills/conduct-witness/SKILL.md` in this repository)

Copy that directory into `.claude/skills/` and the agent knows how to run section 1 and report the sha256 back. The skill never invents a witness name: it asks you once.

## 4. The ladder

Ten minutes: file one walk under your name (sections 1 or 2). One hour: declare the extension in your own agent card so your agent's record is findable (section 2 of the specification; the gate's `/check` tells you whether the declaration is well formed). One day: run your own gate or ledger and anchor each other's roots. Every month: countersign the ring list with your key (the witness council, being designed; a seat is earned by records written, not bought).

## 4a. conduct-v1.1: what the record says about itself, privacy, signing (2026-09-07)

Every record this client writes now carries `mode`, `establishes` and `does_not_establish`. The last is the field that stops a reader from taking a PASS for a verdict, and the intake refuses a v1.1 record without it (`disclaimer_missing`). Three record modes:

- `--privacy full` (default): every node's url, method and hashes, as before.
- `--privacy hash-only`: node urls are reduced to the origin, methods to `REDACTED`, request hashes dropped. The record never names the tool that was called; `does_not_establish` says so.
- `--privacy commitment`: only `sha256(canonical full record || salt)` is filed. The full record and the salt stay on your disk (`walk_<sha12>.json`, `walk_<sha12>.salt`). Reveal later by POSTing the full record; until then the ring counts it under `commitments_unrevealed`.

Signing binds the record to a domain you control, which is what makes you countable apart from unsigned names:

```
openssl genpkey -algorithm ed25519 -out witness.pem
python3 a2a_conduct_walk.py --print-public-key witness.pem
```

Serve the printed JSON at `https://<your domain>/.well-known/nenrin-witness-key.json`, then walk with `--key witness.pem --key-url https://<your domain>/.well-known/nenrin-witness-key.json` (needs `pip install cryptography`). The ledger fetches the key from that URL, refuses a mismatch, refuses a key served from the walked agent's own domain (`self_witness`), and records the domain as `signed_domain`. The monthly ring then counts you under `witnesses_signed`; unsigned names are counted under `witnesses_unsigned` and the ring says they are counted by the name they gave. Same for the MCP server: set `HS_WITNESS_KEY` and `HS_WITNESS_KEY_URL` in its environment, and `privacy` / `vantage_limitation` are tool arguments.

Caps, stated at `GET /witness`: 500 records a day in total, 5 a day per address for unsigned records, 50 a day per domain for signed ones; per witness, per endpoint, per UTC day only the first record is counted by the ring, the rest are stored and anchored with `counted: false`.

## 5. What a witness is not

Not a reviewer, not a rater, not a member. A PASS is one observation, not a verdict. A FAIL is filed the same way as a PASS. The record is yours; the ledger keeps it under your name and cannot edit it. If you want your walk withdrawn, you cannot; that is the property you are contributing.

Do not walk an agent whose owner has asked not to be measured (the register honours `listing: "decline"` in the origin's `/.well-known/mcp-conduct.json`; do the same).

## 6. Files

`a2a_conduct_walk.py` the client; `conduct_witness_mcp.py` the MCP server; `walk_selftest.py` (22 vectors, offline) and `witness_mcp_selftest.py` (14 checks, a real subprocess against a fake agent on localhost); `pyproject.toml` (console scripts `a2a-conduct-walk` and `conduct-witness-mcp`). License: Apache-2.0 (the specification's `LICENSE`).

---

## 日本語: 10 分で証人になる

登録簿の各 agent には「その agent 自身が書いとらん記録」がある。今はその大半を 1 つの扉(1 つの運営者)が書いとる。証人は、それ以外の誰かで、自分の機械から agent を歩いて、見た物を提出する人や。月の輪は証人を名前で数える。2 人の証人が食い違えば、食い違いとして残す(どちらかを消さん)。運営者自身のサーバーも登録簿に載って、同じ扉で測られとる。

正直な数(2026-09-06): 登録簿 9 行、外の証人 1 人、台帳 37 entry(Bitcoin に錨)。せやからこの文がある。

1 節のコマンドを 1 回打てば終わる(`--witness-name` にあなたの名前か project 名、`--vantage` にどこから歩いたか)。最後の行の sha256 が受領証で、翌日の束ねで台帳に載る。`--submit` を外せば何も外に出ん。MCP の口(2 節)なら、あなたの agent に「https://mcp.horizonshield.dev を証人として歩いて、名前は X、vantage は Y」と言うだけ。

見返りは名前だけ。金も token も会員証も無い。輪の `witnesses` にあなたの名前が載り、台帳にあなたの観測が Bitcoin ごと残り、証人会(設計中)の席は「書いた記録の数」で決まる。所有者が測定を断っとる agent は歩かんこと。
