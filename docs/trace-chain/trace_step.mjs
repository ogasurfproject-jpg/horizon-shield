// trace_step.mjs : the TRACE steps of the trace-chain vectors, run with the JavaScript reference (sdk/trace_verify.mjs).
//
//   node trace_step.mjs < request.json > answer.json
//
// gen_vectors.py writes one request per call on stdin and reads one answer from stdout. Nothing here decides a
// verdict: every op is a call into trace_verify.mjs or the ledger's intake module trace_pin_v0.mjs, unchanged.
// Outbound sockets are closed before either module is loaded, so a step that tried to reach the network would fail
// here instead of quietly succeeding.
import net from "node:net";
import tls from "node:tls";

const closed = () => { throw new Error("trace_step.mjs: network use is not allowed here"); };
net.Socket.prototype.connect = closed;
net.connect = closed;
net.createConnection = closed;
tls.connect = closed;

const T = await import("../../workers/hs-ledger/nenrin/sdk/trace_verify.mjs");
const PIN = await import("../../workers/hs-ledger/nenrin/trace-pin-v0/trace_pin_v0.mjs");

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const req = JSON.parse(Buffer.concat(chunks).toString("utf8"));

let out;
switch (req.op) {
  case "intake": out = T.verifyTraceIntake(req.bundle); break;
  case "sign_bind": out = T.signTraceBind({ record: req.record, trace: req.trace, actedAt: req.acted_at, seed32: Buffer.from(req.seed_hex, "hex") }); break;
  case "bind": out = T.verifyTraceBind(req.bundle); break;
  case "span_attributes": out = T.spanAttributes(req.bind); break;
  case "span": out = T.checkSpanAttributes(req.span, req.bind_bundle); break;
  case "pin_intake": {
    const c = await PIN.checkTraceRecord(req.record, req.now);
    out = { sha: c.sha, key_thumbprint: c.key_thumbprint, age_seconds_at_intake: c.age_seconds_at_intake, fresh_at_intake: c.fresh_at_intake,
            registered_producer: PIN.registeredProducer(c.key_thumbprint) };
    break;
  }
  case "thumbprint": out = { thumbprint: T.jwkThumbprint(req.jwk) }; break;
  default: throw new Error("unknown op " + req.op);
}
process.stdout.write(JSON.stringify(out));
