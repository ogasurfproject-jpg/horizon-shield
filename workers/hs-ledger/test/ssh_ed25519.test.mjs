// test/ssh_ed25519.test.mjs
// A witness key_url that serves one OpenSSH line "ssh-ed25519 <base64> [comment]" (src/ssh_ed25519.mjs, 2026-11-07):
// a published line reads to its 32 bytes and key_id, malformed lines are refused, the Python twin in
// nenrin/witness-enroll-v0/witness_enroll_v0.py gives the same answer on every case, and POST /witness binds the domain
// of a key served that way exactly as it binds {public_key_ed25519_b64}.
// Run: node test/ssh_ed25519.test.mjs   (offline; fetch is replaced for key_url lookups; python3 runs the twin)

import { createHash, generateKeyPairSync, sign as edSign } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sshEd25519Key, servedKeyB64 } from "../src/ssh_ed25519.mjs";
import { ed25519PointOk } from "../src/ed25519_point.mjs";
import { loadWorker, mockKV, checker } from "./load.mjs";

const chk = checker("hs-ledger ssh-ed25519 key_url");
const HERE = dirname(fileURLToPath(import.meta.url));
const ENROLL = join(HERE, "..", "nenrin", "witness-enroll-v0", "witness_enroll_v0.py");
const hex = (b) => Buffer.from(b).toString("hex");
const keyId = (raw) => "ed25519:" + createHash("sha256").update(raw).digest("hex").slice(0, 16);

// 1. A published witness key: the key part of https://sencor.ai/keys/witness.pub (fetched 2026-11-07), with a generic
// comment here (the fingerprint and the key come from the base64 alone; the comment changes neither).
const SENCOR = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJDSZavjq+n3yxyvowCNma1gpeC1NXooMLI70YbwN3Px witness key\n";
const SENCOR_RAW = "90d265abe3abe9f7cb1cafa3008d99ad60a5e0b5357a2830b23bd186f03773f1";
const blob = Buffer.from(SENCOR.split(" ")[1], "base64");
chk("its OpenSSH fingerprint is the one published with it",
  "SHA256:" + createHash("sha256").update(blob).digest("base64").replace(/=+$/, "") === "SHA256:zuNo8wSV2fuhmuqhf3sv+0wEyL3p5/1wWvUub+3RoWE");
const k = sshEd25519Key(SENCOR);
chk("the line reads to its 32 key bytes", k && k.length === 32 && hex(k) === SENCOR_RAW, k && hex(k));
chk("key_id ed25519:06bcf268b400a48b", k && keyId(k) === "ed25519:06bcf268b400a48b", k && keyId(k));
chk("the key is a canonical prime-order point", k && ed25519PointOk(k));
chk("servedKeyB64 gives the base64 of the 32 bytes", servedKeyB64(SENCOR) === Buffer.from(SENCOR_RAW, "hex").toString("base64"), servedKeyB64(SENCOR));

// 2. Lines that must and must not read. The wire form is built here so each case changes one thing.
const str = (b) => Buffer.concat([Buffer.from([0, 0, 0, b.length]), b]);
const wire = (name, key, tail = Buffer.alloc(0)) => Buffer.concat([str(Buffer.from(name)), str(key), tail]).toString("base64");
const KEY = Buffer.from(SENCOR_RAW, "hex");
const B = wire("ssh-ed25519", KEY);
const pad1 = wire("ssh-ed25519", KEY, Buffer.from([0]));                         // 52 bytes: ends "==", unused bits zero
const nonCanon = pad1.slice(0, -3) + String.fromCharCode(pad1.charCodeAt(pad1.length - 3) + 1) + "==";
const CASES = [
  ["no comment, final \\n", "ssh-ed25519 " + B + "\n", SENCOR_RAW],
  ["no final line feed", "ssh-ed25519 " + B + " c", SENCOR_RAW],
  ["final \\r\\n", "ssh-ed25519 " + B + " c\r\n", SENCOR_RAW],
  ["tab separators", "ssh-ed25519\t" + B + "\tc", SENCOR_RAW],
  ["space after the key, empty comment", "ssh-ed25519 " + B + " \n", SENCOR_RAW],
  ["another key type (ssh-rsa)", "ssh-rsa " + B + " c\n", null],
  ["the wire form names another type", "ssh-ed25519 " + wire("ssh-ed25518", KEY) + "\n", null],
  ["options before the type (authorized_keys form)", 'from="*" ssh-ed25519 ' + B + "\n", null],
  ["a space before the type", " ssh-ed25519 " + B + "\n", null],
  ["two lines", "ssh-ed25519 " + B + "\nssh-ed25519 " + B + "\n", null],
  ["two final line feeds", "ssh-ed25519 " + B + "\n\n", null],
  ["a key of 31 bytes", "ssh-ed25519 " + wire("ssh-ed25519", KEY.subarray(0, 31)) + "\n", null],
  ["a key of 33 bytes", "ssh-ed25519 " + wire("ssh-ed25519", Buffer.concat([KEY, Buffer.from([1])])) + "\n", null],
  ["a byte after the key", "ssh-ed25519 " + pad1 + "\n", null],
  ["base64 that is not the one spelling of its bytes", "ssh-ed25519 " + nonCanon + "\n", null],
  ["base64 with its padding cut", "ssh-ed25519 " + pad1.replace(/=+$/, "") + "\n", null],
  ["no key", "ssh-ed25519\n", null],
  ["the type alone and a space", "ssh-ed25519 \n", null],
  ["a comment outside printable ASCII", "ssh-ed25519 " + B + " darrén\n", null],
  ["a NUL in the comment", "ssh-ed25519 " + B + " a\u0000b\n", null],
  ["empty", "", null],
];
for (const [name, text, want] of CASES) {
  const got = sshEd25519Key(text);
  chk("js " + (want ? "reads: " : "refuses: ") + name, want ? got && hex(got) === want : got === null, got && hex(got));
}

// 3. The Python twin gives the same answer on every case (and on the published line).
const py = spawnSync("python3", ["-I", "-B", "-c", [
  "import base64, importlib.util, json, sys",
  "sp = importlib.util.spec_from_file_location('witness_enroll_v0', sys.argv[1])",
  "E = importlib.util.module_from_spec(sp); sp.loader.exec_module(E)",
  "out = []",
  "for c in json.load(sys.stdin):",
  "    k = E.ssh_ed25519_key(base64.b64decode(c))",
  "    out.append(None if k is None else k.hex())",
  "print(json.dumps(out))",
].join("\n"), ENROLL], { input: JSON.stringify([SENCOR, ...CASES.map((c) => c[1])].map((t) => Buffer.from(t, "utf8").toString("base64"))), encoding: "utf8" });
let pyOut = null;
try { pyOut = JSON.parse(py.stdout); } catch (_e) { /* reported below */ }
chk("python3 ran the twin", py.status === 0 && Array.isArray(pyOut), py.stderr);
if (Array.isArray(pyOut)) {
  const js = [SENCOR, ...CASES.map((c) => c[1])].map((t) => { const x = sshEd25519Key(t); return x ? hex(x) : null; });
  chk("python and js agree on all " + js.length + " lines", JSON.stringify(pyOut) === JSON.stringify(js), JSON.stringify(pyOut));
}

// 4. The JSON document reads as before.
chk("JSON {public_key_ed25519_b64} is read as before, unchanged", servedKeyB64('{"public_key_ed25519_b64":"abc"}') === "abc");
chk("JSON without public_key_ed25519_b64 is refused as before", servedKeyB64('{"key":"abc"}') === null && servedKeyB64("null") === null && servedKeyB64("[]") === null);
chk("an ssh-ed25519 line inside a JSON string is not read", servedKeyB64(JSON.stringify(SENCOR)) === null);
chk("with ssh false (the intakes other than POST /witness) an ssh-ed25519 line is not read", servedKeyB64(SENCOR, { ssh: false }) === null && servedKeyB64('{"public_key_ed25519_b64":"abc"}', { ssh: false }) === "abc");

// 5. POST /witness: a key served as one ssh-ed25519 line binds the domain like the JSON document does.
const worker = await loadWorker("src/worker.js");
const ORIGIN = "https://ledger.horizonshield.dev";
function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ type: "spki", format: "der" });
  const raw = Buffer.from(der.subarray(der.length - 32));
  return { privateKey, raw, pub_b64: raw.toString("base64") };
}
const W = keypair(), OTHER = keypair();
const sshLine = (raw, comment = "w@ssh.example witness key") => "ssh-ed25519 " + wire("ssh-ed25519", raw) + " " + comment + "\n";
const SERVED = new Map([
  ["https://ssh.example/keys/witness.pub", sshLine(W.raw)],
  ["https://other.example/keys/witness.pub", sshLine(OTHER.raw)],
  ["https://broken.example/keys/witness.pub", "ssh-ed25519 " + wire("ssh-ed25519", W.raw, Buffer.from([0])) + "\n"],
  ["https://rsa.example/keys/witness.pub", "ssh-rsa " + wire("ssh-ed25519", W.raw) + "\n"],
  ["https://json.example/.well-known/nenrin-witness-key.json", JSON.stringify({ public_key_ed25519_b64: W.pub_b64 })],
]);
globalThis.fetch = async (url) => {
  const u = String(url);
  if (SERVED.has(u)) return new Response(SERVED.get(u), { status: 200, headers: { "content-type": u.endsWith(".json") ? "application/json" : "text/plain" } });
  return new Response("nope", { status: 404 });
};
const canon = (o) => JSON.stringify(sortKeys(o));
function sortKeys(x) {
  if (Array.isArray(x)) return x.map(sortKeys);
  if (x && typeof x === "object") return Object.fromEntries(Object.keys(x).sort().map((q) => [q, sortKeys(x[q])]));
  return x;
}
const rec = (at, keyUrl) => ({
  schema: "jidec-path-v1", purpose: "a2a-conduct-walk-v1: https://mcp.horizonshield.dev/mcp", walked_at: at, base: "https://mcp.horizonshield.dev",
  witness: { name: "SSH Witness", vantage: "test", key_url: keyUrl },
  nodes: [{ id: "n0", kind: "fetch", request: { url: "https://mcp.horizonshield.dev/.well-known/agent-card.json", method: "GET" }, response: { status: 200, body_sha256: "a".repeat(64) } }],
  assertions: [{ claim: "card_bytes_stable", op: "eq", result: true, evidence_nodes: ["n0"] }],
  verdict: { ok: true, outcome: "PASS", n_pass: 1, n_total: 1 }, mode: "full",
  establishes: ["card fetched from https://mcp.horizonshield.dev at " + at],
  does_not_establish: ["correctness or quality of any response", "truth of the compensation declaration", "identity of the witness beyond the name given"],
});
const env = { LEDGER: mockKV([["seq", "40"]]).binding, LEDGER_ADMIN_TOKEN: "t".repeat(64) };
async function post(r, key) {
  const record_canonical = canon(r);
  const body = { record_canonical, public_key_ed25519_b64: key.pub_b64, signature_ed25519_b64: edSign(null, Buffer.from(record_canonical, "utf8"), key.privateKey).toString("base64") };
  const res = await worker.fetch(new Request(ORIGIN + "/witness", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" }, body: JSON.stringify(body) }), env);
  return { status: res.status, j: await res.json() };
}
let r = await post(rec("2026-09-07T02:00:00Z", "https://ssh.example/keys/witness.pub"), W);
chk("intake: a key served as one ssh-ed25519 line binds signed_domain", r.status === 201 && r.j.signed === true && r.j.signed_domain === "ssh.example", JSON.stringify(r.j));
r = await post(rec("2026-09-07T02:01:00Z", "https://other.example/keys/witness.pub"), W);
chk("intake: an ssh-ed25519 line of another key is key_url_mismatch", r.status === 422 && r.j.reason_code === "key_url_mismatch", JSON.stringify(r.j));
r = await post(rec("2026-09-07T02:02:00Z", "https://broken.example/keys/witness.pub"), W);
chk("intake: an ssh-ed25519 line with a byte after the key is not a key (503, not stored)", r.status === 503 && r.j.reason_code === "key_url_unreachable" && /ssh-ed25519/.test(r.j.why), JSON.stringify(r.j));
r = await post(rec("2026-09-07T02:03:00Z", "https://rsa.example/keys/witness.pub"), W);
chk("intake: another key type is not a key (503, not stored)", r.status === 503 && r.j.reason_code === "key_url_unreachable", JSON.stringify(r.j));
r = await post(rec("2026-09-07T02:04:00Z", "https://json.example/.well-known/nenrin-witness-key.json"), W);
chk("intake: the JSON document still binds signed_domain", r.status === 201 && r.j.signed_domain === "json.example", JSON.stringify(r.j));

// 6. GET /witness says a key_url may serve one ssh-ed25519 line.
const wd = await (await worker.fetch(new Request(ORIGIN + "/witness"), { LEDGER: mockKV([["seq", "40"]]).binding, LEDGER_ADMIN_TOKEN: "t".repeat(64) })).json();
chk("GET /witness states the ssh-ed25519 line and plain Ed25519 signing", /ssh-ed25519 <base64> \[comment\]/.test(JSON.stringify(wd)) && /not with ssh-keygen -Y sign/.test(JSON.stringify(wd)));

process.exit(chk.done() ? 1 : 0);
