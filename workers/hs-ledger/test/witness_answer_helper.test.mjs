// test/witness_answer_helper.test.mjs
// The public helper nenrin/witness-answer-v0/witness_answer_v0.py builds answers that outside witnesses file at POST /witness.
// Whatever the helper accepts as a key_url the intake must accept with the same signed_domain, and whatever the intake
// refuses the helper must refuse first, so nobody signs and posts an answer the intake then turns away. This file holds the
// two to that: (1) the helper's host lists are the intake's lists, read from src/worker.js; (2) for each key_url below the
// helper builds and wraps a furui-day and a tooshi-day answer and the intake answers the POST; (3) the body a key_url serves
// (JSON or one ssh-ed25519 line) is read to the same key by both. The helper is narrower than the intake in two stated ways
// only: this project's own domains (a TOOSHI day and a FURUI day record are this project's own records) and URL spellings
// the helper does not take (port, query, upper-case host, no path, dot segments).
// Run: node test/witness_answer_helper.test.mjs   (offline; fetch is replaced for key_url lookups; python3 runs the helper)

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { servedKeyB64 } from "../src/ssh_ed25519.mjs";
import { loadWorker, mockKV, checker } from "./load.mjs";

const chk = checker("hs-ledger witness-answer-v0 helper and intake");
const HERE = dirname(fileURLToPath(import.meta.url));
const HELPER = join(HERE, "..", "nenrin", "witness-answer-v0", "witness_answer_v0.py");
const SRC = readFileSync(join(HERE, "..", "src", "worker.js"), "utf8");

function py(lines, input) {
  const r = spawnSync("python3", ["-I", "-B", "-c", [
    "import base64, importlib.util, json, sys",
    "sp = importlib.util.spec_from_file_location('witness_answer_v0', sys.argv[1])",
    "W = importlib.util.module_from_spec(sp); sp.loader.exec_module(W)",
    ...lines,
  ].join("\n"), HELPER], { input: JSON.stringify(input), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  try { return JSON.parse(r.stdout); } catch (_e) { chk("python3 ran the helper", false, r.stderr); return null; }
}

// 1. The lists.
const arr = (name) => { const m = new RegExp("const " + name + " = \\[([\\s\\S]*?)\\];").exec(SRC); return m ? JSON.parse("[" + m[1] + "]") : null; };
const s3 = /if \(\/\^(.+?)\$\/\.test\(host\)\) return true;\s*\/\/ path-style S3/.exec(SRC);
const lists = py(["print(json.dumps({'shared': list(W.SHARED_HOSTS), 's3': W.SHARED_S3, 'github': list(W.OPERATOR_GITHUB)}))"], null);
chk("worker.js still names WITNESS_SHARED_HOSTS, the path-style S3 pattern and WITNESS_OUR_GITHUB_OWNERS", arr("WITNESS_SHARED_HOSTS") && s3 && arr("WITNESS_OUR_GITHUB_OWNERS"));
if (lists) {
  chk("the helper's SHARED_HOSTS is the intake's WITNESS_SHARED_HOSTS, " + lists.shared.length + " hosts in the same order",
    JSON.stringify(lists.shared) === JSON.stringify(arr("WITNESS_SHARED_HOSTS")), JSON.stringify(lists.shared));
  chk("the helper's SHARED_S3 is the intake's path-style S3 pattern", s3 && lists.s3 === s3[1], lists.s3 + " / " + (s3 && s3[1]));
  chk("the helper's OPERATOR_GITHUB is the intake's WITNESS_OUR_GITHUB_OWNERS", JSON.stringify(lists.github) === JSON.stringify(arr("WITNESS_OUR_GITHUB_OWNERS")));
}

// 2. key_urls: the helper's answer and the intake's answer.
const R = "https://raw.githubusercontent.com/";
const SAME = [
  "https://pipavlo82.github.io/keys/witness.json", "https://witness.example/.well-known/nenrin-witness-key.json",
  "https://my-bucket.s3.amazonaws.com/witness.json", "https://s3.dualstack.us-east-1.amazonaws.com/k.json",
  R + "alice/keys/main/witness.json", R + "Alice/keys/main/witness.json", R + "alice/keys/refs/heads/main/witness.json",
  R + "alice/keys/refs/tags/v1/k/witness.json", R + "alice/keys/refs/main/witness.json", R + "alice//keys/main/witness.json",
  R + "alice/keys/refs/heads/0123abc/witness.json", R + "alice/keys/refs/tags/0123456789abcdef0123456789abcdef01234567/k.json",
  R + "alice/keys/refs/heads/main", R + "alice/keys/main", R + "alice/keys", R + "-alice/keys/main/k.json", R + "a_b/keys/main/k.json",
  R + "a".repeat(40) + "/keys/main/k.json", R + "a".repeat(39) + "/keys/main/k.json", R + "alice/keys/abc1234/k.json",
  R + "ogasurfproject-jpg/horizon-shield/main/witness.json", R + "OgaSurfProject-JPG/x/refs/heads/main/k.json",
  R + "alice/../ogasurfproject-jpg/x/main/k.json",
  "https://ledger.horizonshield.dev/witness-key.json", "http://witness.example/k.json",
  ...lists ? [...lists.shared.map((h) => "https://" + h + "/k/witness.json"), "https://s3-us-west-2.amazonaws.com/b/k.json", "https://s3.eu-central-1.amazonaws.com/b/k.json"] : [],
];
const NARROWER = [
  "https://horizonshield.dev/.well-known/nenrin-witness-key.json", "https://x.oga-surf-project.workers.dev/k.json",
  "https://the-horizons-innovation.com/k.json", "https://witness.example:8443/k.json", "https://witness.example/k.json?v=1",
  "https://Witness.example/k.json", "https://witness.example", "https://witness.example/a/../k.json", "https://witness.example/a/./k.json",
];
const cases = py([
  "SEED = bytes.fromhex('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60')",
  "PUB = W.ed25519_public(SEED)",
  "H = lambda s: __import__('hashlib').sha256(s.encode()).hexdigest()",
  "LIM = ['digest and inclusion checks only']",
  "def furui(u):",
  "    c = {'schema': 'nenrin-furui-check-v1', 'command': 'furui-day', 'steps': [{'name': s, 'state': 'ok'} for s in W.FURUI_STEPS],",
  "         'facts': {'day': '2026-11-03', 'leaf': 0, 'record_sha256': H('rec'), 'n': 2, 'root': H('root')}}",
  "    return W.build_furui([c], 'w', u, LIM, '2026-11-04T02:36:00Z', 'nenrin-verify 0.8.1 furui-day')",
  "def tooshi(u):",
  "    r = {'schema': 'tooshi-daily-v0', 'checked_at': '2026-11-06T05:00:00Z', 'trigger': 'manual', 'checks': [{'id': '1_sieve_admission', 'state': 'ok'}]}",
  "    return W.build_tooshi(r, H('tool'), 'w', u, LIM)",
  "out = []",
  "for u in json.load(sys.stdin):",
  "    p = W.key_url_problem(u)",
  "    for kind, mk in (('furui-day', furui), ('tooshi-day', tooshi)):",
  "        a = W.finish(mk(u), PUB, SEED)",
  "        why = p",
  "        try:",
  "            rc = W.intake_record(a, 'test')",
  "        except W.Bad as e:",
  "            why = why or str(e)",
  "            b = W.finish(mk('https://witness.example/k.json'), PUB, SEED)",
  "            rec = json.loads(W.intake_record(b, 'test')); rec['witness']['key_url'] = u; rec['answer'] = a",
  "            rc = W.canonical(rec)",
  "        out.append({'u': u, 'kind': kind, 'helper_ok': why is None, 'why': why, 'identity': None if p else W.identity_of(u),",
  "                    'body': W.intake_body(rc, PUB, seed=SEED)})",
  "print(json.dumps({'pub': base64.b64encode(PUB).decode(), 'cases': out}))",
], [...SAME, ...NARROWER]);

const worker = await loadWorker("src/worker.js");
const ORIGIN = "https://ledger.horizonshield.dev";
const PUB_B64 = cases ? cases.pub : "";
globalThis.fetch = async () => new Response(JSON.stringify({ public_key_ed25519_b64: PUB_B64 }), { status: 200, headers: { "content-type": "application/json" } });
async function post(body) {
  const env = { LEDGER: mockKV([["seq", "40"]]).binding, LEDGER_ADMIN_TOKEN: "t".repeat(64) };
  const res = await worker.fetch(new Request(ORIGIN + "/witness", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" }, body: JSON.stringify(body) }), env);
  return { status: res.status, j: await res.json() };
}
let nSame = 0, nNarrow = 0, nOk = 0;
for (const c of cases ? cases.cases : []) {
  const r = await post(c.body);
  const intakeOk = r.status === 201 && r.j.signed === true;
  const label = c.kind + " " + c.u;
  if (NARROWER.includes(c.u)) {
    nNarrow++;
    chk("narrower on purpose, the helper refuses and the intake takes it: " + label, !c.helper_ok && intakeOk, JSON.stringify({ why: c.why, intake: r.j }));
  } else {
    nSame++;
    if (c.helper_ok) nOk++;
    chk((c.helper_ok ? "both take it, as " + c.identity + ": " : "both refuse it: ") + label,
      c.helper_ok === intakeOk && (!intakeOk || r.j.signed_domain === c.identity), JSON.stringify({ why: c.why, status: r.status, intake: r.j }));
  }
}
chk("the cases ran: " + nSame + " the same (" + nOk + " taken), " + nNarrow + " narrower", cases && nSame === 2 * SAME.length && nNarrow === 2 * NARROWER.length && nOk > 10);

// 3. The body a key_url serves: the intake's res.text() and servedKeyB64 against the helper's served_key.
const KEY = Buffer.from(PUB_B64, "base64");
const str = (b) => Buffer.concat([Buffer.from([0, 0, 0, b.length]), b]);
const wire = (key, tail = Buffer.alloc(0)) => Buffer.concat([str(Buffer.from("ssh-ed25519")), str(key), tail]).toString("base64");
const line = "ssh-ed25519 " + wire(KEY) + " witness key\n";
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const BODIES = [
  ["the JSON document", Buffer.from(JSON.stringify({ public_key_ed25519_b64: PUB_B64 }))],
  ["the JSON document after a BOM", Buffer.concat([BOM, Buffer.from(JSON.stringify({ public_key_ed25519_b64: PUB_B64 }))])],
  ["the JSON document with a byte that is not UTF-8 in another field", Buffer.concat([Buffer.from('{"public_key_ed25519_b64":"' + PUB_B64 + '","note":"'), Buffer.from([0xff]), Buffer.from('"}')])],
  ["the JSON document with the key base64 and a space", Buffer.from(JSON.stringify({ public_key_ed25519_b64: PUB_B64 + " " }))],
  ["JSON without the key", Buffer.from('{"key":"x"}')],
  ["JSON null", Buffer.from("null")],
  ["JSON with NaN", Buffer.from('{"public_key_ed25519_b64":"' + PUB_B64 + '","n":NaN}')],
  ["an ssh-ed25519 line inside a JSON string", Buffer.from(JSON.stringify(line))],
  ["one ssh-ed25519 line", Buffer.from(line)],
  ["one ssh-ed25519 line after a BOM", Buffer.concat([BOM, Buffer.from(line)])],
  ["one ssh-ed25519 line, \\r\\n", Buffer.from(line.replace("\n", "\r\n"))],
  ["one ssh-ed25519 line, no comment, no line feed", Buffer.from("ssh-ed25519 " + wire(KEY))],
  ["two ssh-ed25519 lines", Buffer.from(line + line)],
  ["an ssh-ed25519 line with a byte after the key", Buffer.from("ssh-ed25519 " + wire(KEY, Buffer.from([0])) + "\n")],
  ["an ssh-ed25519 line with a comment outside printable ASCII", Buffer.from("ssh-ed25519 " + wire(KEY) + " darrén\n")],
  ["ssh-rsa", Buffer.from("ssh-rsa " + wire(KEY) + "\n")],
  ["empty", Buffer.alloc(0)],
];
const pyKeys = py([
  "out = []",
  "for b in json.load(sys.stdin):",
  "    try:",
  "        out.append(base64.b64encode(W.served_key(base64.b64decode(b))).decode())",
  "    except (W.Bad, ValueError):",
  "        out.append(None)",
  "print(json.dumps(out))",
], BODIES.map((b) => b[1].toString("base64")));
for (let i = 0; i < BODIES.length && pyKeys; i++) {
  const js = servedKeyB64(await new Response(BODIES[i][1]).text(), { ssh: true }) === PUB_B64;
  const pyOk = pyKeys[i] === PUB_B64;
  chk((js ? "both read the key: " : "both refuse: ") + BODIES[i][0], js === pyOk, "intake " + js + ", helper " + pyKeys[i]);
}

process.exit(chk.done() ? 1 : 0);
