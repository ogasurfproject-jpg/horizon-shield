/* 加盟店MCPの同意ファイルと、CI の自動登録の導出を、実物で確かめる。
   ネットワークには出ない。扉の受け入れ規則は扉のソースから写した faithful copy で、
   加盟店MCPの fetch と CI の python は実物をそのまま走らせる。

   なぜ要るか (2026-09-11):
     扉の器(POST /watch + well-known 同意)は全部あるのに、配線が無く手動だった。
     加盟店MCPが /.well-known/mcp-conduct.json を出し、CI が roster から endpoint を
     導いて /watch に流せば、扉のソースを書き換えずに自動計測に乗る。
     その2つが本当に噛み合うかを、置いた物どうしで確かめる。 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "consent-"));

let fails = 0;
function ok(name, cond, detail) {
  if (cond) { console.log("  ok   " + name); return; }
  fails++; console.log("  NG   " + name + (detail ? "  <- " + detail : ""));
}

async function loadWorker(rel) {
  const src = fs.readFileSync(path.join(REPO, rel), "utf8");
  const f = path.join(TMP, rel.replace(/[\/]/g, "_").replace(/\.js$/, ".mjs"));
  fs.writeFileSync(f, src);
  return (await import(f + "?v=" + Math.random())).default;
}

/* 扉のソース(workers/hs-verify-gate/src/worker.js)の wellKnownConsent から写した規則。
   写しなので、扉が動いたら本物と食い違わないか目で照合できるよう、判定の芯だけを持つ。 */
function gateAccepts(body, endpoint) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { consent: false, why: "not a JSON object" };
  const declined = body.listing === "decline";
  if (body.allow_tool_call !== true) return { consent: false, declined, why: "allow_tool_call is not boolean true" };
  if (body.endpoints !== undefined) {
    if (!Array.isArray(body.endpoints) || !body.endpoints.every((e) => typeof e === "string")) return { consent: false, why: "endpoints is not an array of strings" };
    if (!body.endpoints.includes(endpoint)) return { consent: false, why: "endpoint not among listed endpoints" };
  }
  return { consent: true, declined };
}

console.log("1. 加盟店MCPが同意ファイルを出す(実物の fetch)");
for (const [rel, origin, storeId] of [
  ["workers/hs-partner-001-mcp/src/worker.js", "https://p001.horizonshield.dev", "hs-partner-001"],
  ["workers/hs-partner-002-mcp/src/worker.js", "https://p002.horizonshield.dev", "hs-partner-002"],
]) {
  const worker = await loadWorker(rel);
  const res = await worker.fetch(new Request(origin + "/.well-known/mcp-conduct.json"),
                                 { STORE_ID: storeId, PARTNER_NAME: "テスト店" });
  ok(storeId + ": 200 で返る", res.status === 200, "status " + res.status);
  const body = await res.json();
  ok(storeId + ": allow_tool_call は boolean の true", body.allow_tool_call === true, JSON.stringify(body.allow_tool_call));
  ok(storeId + ": endpoints は自分の /mcp に絞る",
     Array.isArray(body.endpoints) && body.endpoints.length === 1 && body.endpoints[0] === origin + "/mcp",
     JSON.stringify(body.endpoints));
  ok(storeId + ": listing は decline ではない(測ってよい)", body.listing !== "decline", String(body.listing));
  ok(storeId + ": 英語文脈なので社名に 音 を使わない", !/HORIZ音/.test(JSON.stringify(body)), "音 が英語の同意ファイルに出た");

  const verdict = gateAccepts(body, origin + "/mcp");
  ok(storeId + ": 扉の規則で consent が立つ(自分の /mcp)", verdict.consent === true, verdict.why);
  const other = gateAccepts(body, "https://evil.example/mcp");
  ok(storeId + ": 別 origin の endpoint には consent を広げない", other.consent === false, "他所の口にも同意してしまった");

  // 同意ファイル以外の口を壊していないこと
  const card = await worker.fetch(new Request(origin + "/.well-known/agent-card.json"), { STORE_ID: storeId, PARTNER_NAME: "テスト店" });
  ok(storeId + ": agent-card は今までどおり出る", card.status === 200, "status " + card.status);
  const health = await worker.fetch(new Request(origin + "/health"), { STORE_ID: storeId, PARTNER_NAME: "テスト店" });
  ok(storeId + ": health は今までどおり出る", health.status === 200, "status " + health.status);
}

console.log("2. CI の endpoint 導出(ワークフローの実物の python を走らせる)");
{
  const yaml = fs.readFileSync(path.join(REPO, ".github/workflows/gate-register-partners.yml"), "utf8");
  const m = yaml.match(/python3 - <<'PY'[^\n]*\n([\s\S]*?)\n {10}PY/);
  ok("ワークフローに python の導出ブロックがある", !!m);
  if (m) {
    const py = m[1].replace(/^ {10}/gm, "");   // YAML の字下げを外す
    const pyFile = path.join(TMP, "derive.py");
    fs.writeFileSync(pyFile, py);

    // 実測に寄せた roster: webmcp の2店 + webmcp でない店 + member_no が3桁を超える店
    const roster = { contractors: [
      { member_no: "No.001", name: "リフォーム職人株式会社", webmcp_option: true },
      { member_no: "No.002", name: "ミネオトーヨー住器株式会社", webmcp_option: true },
      { member_no: "No.003", name: "webmcp でない店", webmcp_option: false },
      { member_no: "No.4000", name: "番号が3桁を超える店", webmcp_option: true },
      { member_no: null, name: "番号が無い店", webmcp_option: true },
    ]};
    const dataDir = path.join(TMP, "data");
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, "yakumo-contractors.json"), JSON.stringify(roster));

    const r = spawnSync("python3", [pyFile], { cwd: TMP, encoding: "utf8" });
    ok("python が動く", r.status === 0, (r.stderr || "").split("\n").slice(0, 2).join(" "));
    const out = (r.stdout || "").trim().split("\n").filter(Boolean).sort();
    ok("webmcp の2店だけが p001/p002 として出る",
       out.join(",") === "https://p001.horizonshield.dev/mcp,https://p002.horizonshield.dev/mcp",
       JSON.stringify(out));
    ok("webmcp でない店は出さない", !out.some((x) => /p003/.test(x)));
    ok("member_no が3桁を超える店は出さない(存在しない p4000 を登録しない)", !out.some((x) => /p4000|p400/.test(x)));
    ok("member_no が無い店は出さない", out.length === 2);
  }

  // 本番 roster でも落ちないこと(いまは webmcp が2店)
  const realDerive = path.join(TMP, "derive_real.py");
  if (m) {
    fs.writeFileSync(realDerive, m[1].replace(/^ {10}/gm, ""));
    const r2 = spawnSync("python3", [realDerive], { cwd: REPO, encoding: "utf8" });
    ok("本番 roster に対して python が落ちない", r2.status === 0, (r2.stderr || "").slice(0, 120));
    const realOut = (r2.stdout || "").trim().split("\n").filter(Boolean);
    ok("本番 roster から少なくとも p001 が出る", realOut.includes("https://p001.horizonshield.dev/mcp"), JSON.stringify(realOut));
  }
}

console.log("");
if (fails) { console.log("=== " + fails + " 件 不合格 (consent_test) ==="); process.exit(1); }
console.log("=== 全部 通過 (consent_test) ===");
