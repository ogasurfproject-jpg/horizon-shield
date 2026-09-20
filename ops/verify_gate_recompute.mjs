// verify_gate_recompute.mjs
// 扉(hs-verify-gate)の判定を、発行者を信じずに再計算して照合する。
// 使い方:
//   node verify_gate_recompute.mjs
//   node verify_gate_recompute.mjs https://any-mcp-server/mcp
// 引数なしなら扉の自己適用判定(/self)を検証する。
// 引数にMCPエンドポイントを渡すと、扉に /check させたうえでその判定を再計算する。

import { webcrypto as crypto } from 'node:crypto';

const GATE = "https://gate.horizonshield.dev";
const target = process.argv[2] || null;

async function sha256hex(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function line(label, value) {
  console.log("  " + String(label).padEnd(16) + value);
}

async function main() {
  let res, label;
  if (target) {
    label = target;
    res = await fetch(GATE + "/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: target })
    });
  } else {
    label = GATE + "/self";
    res = await fetch(GATE + "/self");
  }

  console.log("");
  console.log("SUBJECT");
  line("endpoint", label);
  line("http", res.status);
  line("cors", res.headers.get("access-control-allow-origin") || "(none)");

  const record = JSON.parse(await res.text());
  if (record.error) {
    console.log("");
    console.log("ERROR: " + JSON.stringify(record));
    process.exit(1);
  }

  console.log("");
  console.log("VERDICT");
  line("status", record.status);
  line("gate_version", record.gate_version);
  line("checked_at", record.checked_at);

  console.log("");
  console.log("CONDITIONS");
  for (const [k, v] of Object.entries(record.checks || {})) {
    const na = v && v.detail && v.detail.applicable === false;
    const verdict = na ? "N/A (stated)" : (v.pass ? "PASS" : "FAIL");
    line(k, verdict);
    if (!v.pass && !na && v.reason) console.log("      reason: " + v.reason);
  }

  const r = JSON.parse(JSON.stringify(record));
  const expected = r.record_sha256;
  delete r.record_sha256;
  delete r.recompute_note;
  const got = await sha256hex(JSON.stringify(r));

  console.log("");
  console.log("RECOMPUTE (independent, on your machine)");
  line("record_sha256", expected);
  line("recomputed", got);
  line("match", expected === got ? "YES" : "NO");
  console.log("");

  if (expected !== got) {
    console.log("MISMATCH. The verdict was altered after it was issued. Reject it.");
    process.exit(1);
  }
  console.log("The verdict is intact. You did not have to trust the issuer.");
  process.exit(0);
}

main().catch((e) => {
  console.log("");
  console.log("FAILED: " + e.message);
  process.exit(1);
});
