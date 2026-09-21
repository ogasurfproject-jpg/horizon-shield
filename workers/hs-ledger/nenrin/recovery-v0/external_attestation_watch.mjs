// RUN_ALL: library (CLI, network)
// external_attestation_watch: Agenstry など第三者の公開観測を定期に再クロールし、実質フィールド
// (version / signed / signature_valid / checks / uptime) が動いた時だけ、錨用の seed を作る番人。
// 動いてなければ何も作らん (同じ観測を何度も錨打つ noise を出さん)。stats.last_checked のような
// 毎回動く時刻フィールドは変化判定から外す (seed には記録する)。seed の形は external_attestation.mjs
// と同一 (buildAttestation を再利用)。錨打ちは運営者の手 (append_witness.sh)。
//
// 使い方 (agenstry.com に届くシェルで、月次などで):
//   node external_attestation_watch.mjs --url https://agenstry.com/api/agents/gate.horizonshield.dev \
//     --about "Agenstry's published observation of gate.horizonshield.dev (agent card, JWS, A2A liveness)" \
//     --fields version,signed,signature_valid,stats.last_checked,stats.checks_ok,stats.checks_total,stats.uptime_pct \
//     --refers-to 6d259ba9bfe2869f --refers-entry 50 --state external_attestation_state.json --out-dir .
//   変化があれば seed を書いて "anchor: zsh ../../append_witness.sh <seed>" を出す。無ければ no change。
// offline 試験: --fixture file.json (fetch せず)。採点は external_attestation_watch.test.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildAttestation } from "./external_attestation.mjs";

// 変化判定から外す、毎回動く時刻系。--watch を明示すればそちらが優先。
export const VOLATILE = /(last_checked|_at$|timestamp|fetched|updated|\btime\b)/i;

// 純関数: 今の bytes と前の state から、変化したか・差分・seed を出す。fs も network も触らん。
export async function evaluate({ url, about, bytes, fetchedAt, fields = [], watch = null, prevState = {}, refersTo = null, refersEntry = null }) {
  const built = await buildAttestation({ url, about, bytes, fetchedAt, fields, refersTo, refersEntry });
  const now = {};
  for (const r of built.read) now[r.path] = r.present ? r.value : null;
  const watchFields = (watch && watch.length) ? watch : fields.filter((f) => !VOLATILE.test(f));
  const prevEntry = prevState && prevState[url] ? prevState[url] : null;
  const prev = prevEntry ? (prevEntry.watched || {}) : null;
  const diff = [];
  let changed = false;
  if (prev) {
    for (const f of watchFields) {
      const b = now[f] === undefined ? null : now[f];
      const a = prev[f] === undefined ? null : prev[f];
      if (JSON.stringify(a) !== JSON.stringify(b)) { changed = true; diff.push({ field: f, from: a, to: b }); }
    }
  } else {
    changed = true; // first sight of this url
  }
  const watched = {};
  for (const f of watchFields) watched[f] = now[f] === undefined ? null : now[f];
  const nextEntry = { watched, bytes_sha256: built.bytes_sha256, fetched_at: fetchedAt, first_seen: prevEntry ? prevEntry.first_seen : fetchedAt };
  const nextState = { ...(prevState || {}), [url]: nextEntry };
  return { changed, firstSight: !prev, diff, seed: changed ? built.seed : null, bytes_sha256: built.bytes_sha256, watchFields, nextState };
}

// @@CLI_BEGIN
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) { const a = process.argv[i]; if (a.startsWith("--")) { const v = process.argv[i + 1]; if (v !== undefined && !v.startsWith("--")) { args[a.slice(2)] = v; i++; } else args[a.slice(2)] = true; } }
  if (!args.url || !args.about) { console.error("usage: node external_attestation_watch.mjs --url <https url> --about <what> [--fields a,b] [--watch a,b] [--refers-to sha] [--refers-entry N] [--state file] [--out-dir .] [--fixture file]"); process.exit(2); }
  if (!/^https:\/\//.test(args.url)) { console.error("refuse: url must be https"); process.exit(2); }
  const fields = args.fields ? String(args.fields).split(",").map((s) => s.trim()).filter(Boolean) : [];
  const watch = args.watch ? String(args.watch).split(",").map((s) => s.trim()).filter(Boolean) : null;
  const statePath = args.state || "external_attestation_state.json";
  const prevState = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {};
  let bytes, fetchedAt;
  if (args.fixture) { bytes = new Uint8Array(readFileSync(args.fixture)); fetchedAt = args["fetched-at"] || new Date().toISOString(); }
  else {
    const res = await fetch(args.url, { cache: "no-store", headers: { "accept": "application/json, */*" } });
    if (!res.ok) { console.error("fetch failed: http " + res.status); process.exit(1); }
    bytes = new Uint8Array(await res.arrayBuffer()); fetchedAt = new Date().toISOString();
  }
  const r = await evaluate({ url: args.url, about: args.about, bytes, fetchedAt, fields, watch, prevState, refersTo: args["refers-to"] || null, refersEntry: args["refers-entry"] || null });
  writeFileSync(statePath, JSON.stringify(r.nextState, null, 1) + "\n");
  if (!r.changed) { console.error("external-attestation-watch: no change at " + args.url + " (" + r.bytes_sha256.slice(0, 12) + ", " + fetchedAt + "); state updated, no seed"); process.exit(0); }
  const outDir = String(args["out-dir"] || ".").replace(/\/$/, "");
  const out = outDir + "/seed_external_" + new URL(args.url).host.replace(/[^a-z0-9]+/gi, "_") + "_" + fetchedAt.replace(/[-:]/g, "").slice(0, 15) + ".json";
  writeFileSync(out, JSON.stringify(r.seed, null, 1) + "\n");
  console.error("external-attestation-watch: " + (r.firstSight ? "first sight" : "CHANGED") + " at " + args.url + " -> claim " + r.seed.claim_sha256.slice(0, 12) + ", seed " + out);
  for (const d of r.diff) console.error("  " + d.field + ": " + JSON.stringify(d.from) + " -> " + JSON.stringify(d.to));
  console.error("  anchor: zsh ../../append_witness.sh " + out);
}
// @@CLI_END
