// RUN_ALL: library (CLI, network)
// external_attestation: 第三者が公開しとる観測 (Agenstry の API など) を、その bytes の sha256 で JIDEC に錨打ちする seed を作る。
// 相手はうちの型で署名せん。せやから witness-observation にはせん (11.4 で witness_unsigned になる、それが正しい)。
// 代わりに「この URL がこの時刻にこの bytes を配っとって、中にこう書いてあった」を運営者の hash として残す。
// 何を証明するか (establishes) と何を証明せんか (does_not_establish) を本文が自分で言う。entry 50 と同じ seed の型。
//
// 使い方 (本番、agenstry.com に届くシェルで):
//   node external_attestation.mjs --url https://agenstry.com/api/agents/gate.horizonshield.dev \
//     --about "Agenstry's published observation of gate.horizonshield.dev (agent card, JWS, A2A liveness)" \
//     --fields version,signed,signature_valid,stats.last_checked,stats.checks_ok,stats.checks_total,stats.uptime_pct \
//     --refers-to 6d259ba9bfe2869f --refers-entry 50 --out seed_external_agenstry_<stamp>.json
//   zsh ../../append_witness.sh seed_external_agenstry_<stamp>.json
// offline 試験: --fixture file.json (fetch せずにその bytes を使う)
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const sha256hex = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", typeof s === "string" ? new TextEncoder().encode(s) : s))].map((x) => x.toString(16).padStart(2, "0")).join("");
const getPath = (o, p) => p.split(".").reduce((a, k) => (a && typeof a === "object" ? a[k] : undefined), o);

export async function buildAttestation({ url, about, bytes, fetchedAt, fields = [], refersTo = null, refersEntry = null }) {
  const bytes_sha256 = await sha256hex(bytes);
  let parsed = null; try { parsed = JSON.parse(new TextDecoder().decode(bytes)); } catch (_e) {}
  const read = [];
  for (const f of fields) {
    const v = parsed ? getPath(parsed, f) : undefined;
    read.push({ path: f, value: v === undefined ? null : v, present: v !== undefined });
  }
  const lines = [];
  lines.push("# tsugi-external-attestation-v1: " + about + ", fetched " + fetchedAt);
  lines.push("");
  lines.push("**Status:** a citation of a third party's published observation, anchored so its state at this time cannot later be disputed by anyone, the operator included. The third party neither wrote nor signed this record; the bytes at the URL are theirs, this record is the operator's SHA-256 of those bytes and a verbatim copy of the fields named below. It is not a witness observation under conduct-v1.1 section 11.4 (unsigned, not drawn) and is never counted toward a quorum.");
  lines.push("");
  lines.push("**Source:** " + url);
  lines.push("**Fetched at:** " + fetchedAt);
  lines.push("**Bytes sha256:** " + bytes_sha256 + " (" + bytes.length + " bytes)");
  lines.push("**Parsed as:** " + (parsed ? "JSON" : "not JSON (hash only)"));
  if (read.length) {
    lines.push("");
    lines.push("**Fields read from the bytes (as served, copied, not judged):**");
    for (const r of read) lines.push("- " + r.path + ": " + (r.present ? JSON.stringify(r.value) : "(absent)"));
  }
  if (refersTo) lines.push("", "**Refers to:** TSUGI incident chain sha256 " + refersTo + (refersEntry ? " (JIDEC entry " + refersEntry + ")" : ""));
  lines.push("");
  lines.push("**Establishes:** that bytes with the sha256 above were served at the source URL at the fetched time, and that they carried exactly the field values listed; and, once anchored, that this was so no later than the Bitcoin block of the anchoring entry.");
  lines.push("");
  lines.push("**Does not establish:** the third party's method, or that its fields are true of the subject; that the third party observed the deployment current at the fetched time (its own timestamps inside the bytes say what it saw and when); the meaning of a null or absent field beyond that it was null or absent; anything not inside the bytes.");
  lines.push("");
  const record_canonical = lines.join("\n");
  const claim_sha256 = await sha256hex(record_canonical);
  const work = "External attestation content-anchored: binds the SHA-256 of the bytes a third party (" + new URL(url).host + ") served about " + about.split(" (")[0] + " at " + fetchedAt + ", with the named fields copied verbatim, and fixes that time on Bitcoin. A citation, not a witness; nothing here scores or judges.";
  return { seed: { claim_sha256, record_canonical, work }, bytes_sha256, read, parsed: !!parsed };
}

// @@CLI_BEGIN
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) { const a = process.argv[i]; if (a.startsWith("--")) { const v = process.argv[i + 1]; if (v !== undefined && !v.startsWith("--")) { args[a.slice(2)] = v; i++; } else args[a.slice(2)] = true; } }
  if (!args.url || !args.about) { console.error("usage: node external_attestation.mjs --url <https url> --about <what it observes> [--fields a.b,c] [--refers-to <sha256>] [--refers-entry N] [--fixture file] [--out seed.json]"); process.exit(2); }
  if (!/^https:\/\//.test(args.url)) { console.error("refuse: url must be https"); process.exit(2); }
  let bytes, fetchedAt;
  if (args.fixture) { bytes = new Uint8Array(readFileSync(args.fixture)); fetchedAt = args["fetched-at"] || new Date().toISOString(); }
  else {
    const res = await fetch(args.url, { cache: "no-store", headers: { "accept": "application/json, */*" } });
    if (!res.ok) { console.error("fetch failed: http " + res.status); process.exit(1); }
    bytes = new Uint8Array(await res.arrayBuffer()); fetchedAt = new Date().toISOString();
  }
  const fields = args.fields ? String(args.fields).split(",").map((s) => s.trim()).filter(Boolean) : [];
  const r = await buildAttestation({ url: args.url, about: args.about, bytes, fetchedAt, fields, refersTo: args["refers-to"] || null, refersEntry: args["refers-entry"] || null });
  const out = args.out || ("seed_external_" + new URL(args.url).host.replace(/[^a-z0-9]+/gi, "_") + "_" + fetchedAt.replace(/[-:]/g, "").slice(0, 15) + ".json");
  writeFileSync(out, JSON.stringify(r.seed, null, 1) + "\n");
  console.error("external-attestation: " + args.url + " -> " + r.bytes_sha256.slice(0, 12) + " (" + bytes.length + " bytes, " + (r.parsed ? "JSON" : "not JSON") + "), claim " + r.seed.claim_sha256.slice(0, 12) + ", seed " + out);
  for (const f of r.read) console.error("  " + f.path + " = " + (f.present ? JSON.stringify(f.value) : "(absent)"));
}
// @@CLI_END
