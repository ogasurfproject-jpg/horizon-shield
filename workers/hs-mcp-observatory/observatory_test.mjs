/* 照会口を、実物の fetch を呼んで確かめる。ネットワークには出ない。

   ここで見るのは、数字が合っているかだけではない。
   報告書に自分で書いた4つの規則を、この口が守っているかを見る。

     ・落ちた口の名簿を配らない
     ・人格の判定をしない(測定を述べる)
     ・held と pending を足さない
     ・hash と再現手順の無い言明を出さない

   規則は、書いた日には必ず守れているように見える。
   守れていることを、走らせて確かめる。 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRCDIR = path.join(HERE, "src");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "hsobs-"));
for (const f of fs.readdirSync(SRCDIR)) {
  if (!f.endsWith(".js")) continue;
  let body = fs.readFileSync(path.join(SRCDIR, f), "utf8");
  body = body.replace(/from "\.\/([a-z0-9_]+)\.js"/g, 'from "./$1.mjs"');
  fs.writeFileSync(path.join(TMP, f.replace(/\.js$/, ".mjs")), body);
}
const W = (await import(path.join(TMP, "worker.mjs") + "?v=" + Math.random())).default;
const DATA = await import(path.join(TMP, "data.mjs") + "?v=" + Math.random());

let checks = 0, fail = 0;
function check(label, cond, detail) {
  checks++;
  console.log((cond ? "  ok   " : "  NG   ") + label + (detail ? "  " + String(detail).slice(0, 150) : ""));
  if (!cond) fail++;
}

async function call(name, args) {
  const r = await W.fetch(new Request("https://x/mcp", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args || {} } }),
  }));
  const b = await r.json();
  const t = b && b.result && b.result.content && b.result.content[0] && b.result.content[0].text;
  return t ? JSON.parse(t) : b;
}

/* --- 1. 鍵は無い。これは公開の記録である --------------------------- */
console.log("1) 誰でも引けること");
{
  const r = await W.fetch(new Request("https://x/mcp", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  }));
  check("鍵なしで tools/list が通る", r.status === 200, "status=" + r.status);
  const b = await r.json();
  const names = b.result.tools.map((t) => t.name);
  check("道具が5つ", names.length === 5, names.join(","));
  check("一覧を返す道具が無い",
        !names.some((n) => /list|all|roster|dump|search/.test(n.replace("observatory_", ""))),
        names.join(","));

  const h = await W.fetch(new Request("https://x/"));
  check("生死の口は鍵なしで開く", h.status === 200);
}

/* --- 2. 数字が、公開している報告書と合っていること ------------------ */
console.log("\n2) 数字");
{
  const s = await call("mcp_observatory_summary");
  check("当てた住所 12,429", DATA.META.https_endpoints_active === 12429, DATA.META.https_endpoints_active);
  check("公開時の答えた数 5,785", s.as_published.measured === 5785, s.as_published.measured);
  check("訂正後の答えた数 5,880", s.corrected.measured === 5880, s.corrected.measured);
  check("訂正後の返事待ち 823", s.corrected.pending === 823, s.corrected.pending);
  check("こちらの落ち度 95", s.corrected.our_fault === 95, s.corrected.our_fault);
  check("道具の総数 104,434", s.tools.total === 104434, s.tools.total);
  check("金の出所を名乗った 152", s.compensation.disclosed === 152, s.compensation.disclosed);
  check("エージェントカードが無かった 4,762", s.agent_cards.absent === 4762, s.agent_cards.absent);
  check("152 は下限だと言う", /floor/.test(JSON.stringify(s.compensation)), s.compensation.floor_note);
  check("捨てた走行のことを出す", s.discarded_run && s.discarded_run.rows_total === 12429,
        JSON.stringify(s.discarded_run && s.discarded_run.verdict));

  const rows = DATA.ROWS;
  check("行の数が走行と同じ", rows.length === 12429, rows.length);
  const rec = rows.filter((r) => r[9]).length;
  check("回復した行が95件(公開している訂正と一致)", rec === 95, rec);
}

/* --- 3. 住所を1つ引く。hash と再現手順が必ず付くこと ---------------- */
console.log("\n3) 住所を引く");
{
  const disclosed = DATA.ROWS.find((r) => r[5] === 1);
  const g = await call("mcp_observatory_lookup", { address: disclosed[0] });
  check("見つかる", g.found === true, g.endpoint);
  check("測った日を言う", g.measured_on === "2026-08-23", g.measured_on);
  check("金の出所の記載があったと言う", g.compensation_disclosure === "present", g.compensation_disclosure);
  check("欄の名前を出す", Array.isArray(g.compensation_fields), JSON.stringify(g.compensation_fields));
  check("record_sha256 が付く", /^[0-9a-f]{64}$/.test(g.verify.record_sha256), g.verify.record_sha256);
  check("再計算の手順が付く", /recompute/.test(g.verify.procedure), g.verify.procedure);
  check("生の行の在り処が付く", /\.jsonl/.test(g.verify.raw_line.file), g.verify.raw_line.file);

  // 末尾のスラッシュ違いでも引ける。写し間違いで「無い」と言わない。
  const g2 = await call("mcp_observatory_lookup", { address: disclosed[0] + "/" });
  check("末尾のスラッシュ違いでも引ける", g2.found === true || g2.endpoint === disclosed[0], JSON.stringify(g2).slice(0, 80));

  const none = await call("mcp_observatory_lookup", { address: "https://example.invalid/mcp" });
  check("知らない住所は found:false", none.found === false);
  check("知らない住所を『失敗』と言わない",
        /not a finding about this address/.test(none.what_this_means || ""), none.what_this_means);
}

/* --- 4. 人格の判定をしないこと -------------------------------------- */
console.log("\n4) 述べるのは測定であって、人格ではない");
{
  const noCard = DATA.ROWS.find((r) => r[1] === "measured" && r[4] === 0 && r[5] === 0);
  const g = await call("mcp_observatory_lookup", { address: noCard[0] });
  check("カードが無かったと述べる", g.agent_card === "absent", g.agent_card);
  check("『隠している』とは言わない", !/hiding|hides|conceal(?!ment)/i.test(JSON.stringify(g)),
        (JSON.stringify(g).match(/.{0,40}(hiding|hides).{0,40}/i) || [""])[0]);
  check("『隠したのではない』と明示する",
        /not a finding of concealment/.test(g.note || ""), g.note);

  // 2026-08-24: ここは最初、返ってきた全部を1つの塊にして禁じ手を探していた。
  //   すると「Never write "it went down"」「Not "this server is dishonest"」という
  //   規則の文そのものに当たって赤くなった。規則を守っていることを、規則の引用で咎めていた。
  //   見る対象を間違えると門はいつも赤くなり、やがて外される。今日これで3回目である。
  //   見るのは「どこかのサーバーについてこちらが組み立てた文」だけにする。
  const rulesText = JSON.stringify((await call("mcp_observatory_state")).rules_this_report_holds_itself_to);
  const about = [JSON.stringify(g)];
  for (const r of DATA.ROWS.slice(0, 400)) {
    // ここでは1件ずつの言明だけを見る(規則の一覧は含めない)
    about.push(JSON.stringify(await call("mcp_observatory_lookup", { address: r[0] })));
  }
  const blob = about.join("");
  for (const w of ["dishonest", "untrustworthy", "scam", "went down", "is down", "hiding"]) {
    check("どのサーバーについても「" + w + "」と言っていない", !new RegExp(w, "i").test(blob),
          (blob.match(new RegExp(".{0,40}" + w + ".{0,40}", "i")) || [""])[0]);
  }
  check("規則の文としては、その言い回しを引用している(門が引用を咎めていない)",
        /went down/.test(rulesText) && /dishonest/.test(rulesText));
}

/* --- 5. held と pending を足さないこと ------------------------------ */
console.log("\n5) 届かなかったのと、答えが無かったのを足さない");
{
  const s = await call("mcp_observatory_summary");
  check("公開時の held と pending が別々に出る",
        typeof s.as_published.held === "number" && typeof s.as_published.pending === "number",
        JSON.stringify(s.as_published));
  check("足した数を出していない",
        !JSON.stringify(s).includes(String(s.as_published.held + s.as_published.pending)),
        "held+pending=" + (s.as_published.held + s.as_published.pending));

  const held = DATA.ROWS.find((r) => r[1] === "held");
  if (held) {
    const g = await call("mcp_observatory_lookup", { address: held[0] });
    check("held は『こちらの計器の話』だと言う",
          /instrument/.test(g.state_means || ""), g.state_means);
  } else {
    check("held の行がある", false, "見つからない");
  }
  const skipped = DATA.ROWS.find((r) => r[1] === "skipped");
  const gs = await call("mcp_observatory_lookup", { address: skipped[0] });
  check("robots で見送ったものは『no is an answer』と言う",
        /no is an answer/.test(gs.state_means || ""), gs.state_means);
}

/* --- 6. ホストは集計だけ。名簿は配らない --------------------------- */
console.log("\n6) ホストを引いても、名簿は出ない");
{
  // 宣言のうち193件は住所ではなく雛形で、new URL が投げる。
  // 実物の worker は try/catch で拾っている。試験のほうが落ちていた。
  const counts = {};
  let unparsable = 0;
  for (const r of DATA.ROWS) {
    let h = "";
    try { h = new URL(r[0]).host.toLowerCase(); } catch (_e) { unparsable++; continue; }
    counts[h] = (counts[h] || 0) + 1;
  }
  check("住所として読めない宣言があっても落ちない", unparsable >= 0, "読めない " + unparsable + " 件");
  const big = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const g = await call("mcp_observatory_lookup", { host: big[0] });
  check("ホストの件数は返す", g.addresses_declared_on_this_host === big[1],
        big[0] + " " + g.addresses_declared_on_this_host + " / 実際 " + big[1]);
  check("住所の一覧は返さない", !JSON.stringify(g).includes("https://"),
        (JSON.stringify(g).match(/https:\/\/[^"]{0,40}/) || [""])[0]);
  check("集計だけだと言う", /Counts only/.test(g.note || ""), g.note);

  const none = await call("mcp_observatory_lookup", {});
  check("何も指定しなければ何も出さない", !!none.error, JSON.stringify(none).slice(0, 90));
  check("一覧を返す道具が無いと言う", /must already hold/.test(none.note || ""), none.note);
}

/* --- 6b. 雛形は「住所ではない」と言うこと --------------------------- */
console.log("\n6b) 住所ではなく雛形だった宣言");
{
  const tpl = DATA.ROWS.find((r) => r[11] === 1);
  check("雛形の行がある", !!tpl, tpl && tpl[0]);
  const g = await call("mcp_observatory_lookup", { address: tpl[0] });
  check("『これは住所ではない』と言う", !!g.this_is_not_an_address, JSON.stringify(g).slice(0, 90));
  check("誰かのソフトについての事実として読ませない",
        /measured nothing about any server/.test((g.this_is_not_an_address || {}).meaning || ""),
        (g.this_is_not_an_address || {}).meaning);
  check("同じ形が何件あるかを言う", DATA.TEMPLATED_COUNT > 100, DATA.TEMPLATED_COUNT);
  const s = await call("mcp_observatory_summary");
  check("全体の数にも雛形の件数を出す",
        (s.templated_endpoints || {}).count === DATA.TEMPLATED_COUNT,
        JSON.stringify(s.templated_endpoints || {}).slice(0, 80));
  check("公開済みの数から後から引いたりしないと言う",
        /did not remove them/.test((s.templated_endpoints || {}).where_they_land || ""),
        (s.templated_endpoints || {}).where_they_land);
}

/* --- 7. 数字を引く前に限界を読ませること ---------------------------- */
console.log("\n7) 限界を先に言う");
{
  const st = await call("mcp_observatory_state");
  check("4つの規則を出す", (st.rules_this_report_holds_itself_to || []).length === 4);
  check("やらないことを出す", (st.what_we_do_not_do || []).length >= 3);
  check("『エコシステムのスキャンではない』と言う",
        /not a scan of the MCP ecosystem/.test(JSON.stringify(st)), "");
  check("道具を1つも呼んでいないと言う",
        /No tool was called/.test(JSON.stringify(st)), "");
  check("再現の場所を出す", /recompute/.test(JSON.stringify(st.pages)), JSON.stringify(st.pages).slice(0, 80));

  const m = await call("mcp_observatory_method");
  check("捨てた走行のことを method でも言う",
        /discarded/.test(JSON.stringify(m.what_we_got_wrong)), "");
  check("何を間違えたかを2件出す", (m.what_we_got_wrong || []).length === 2);
  check("報告書の hash を出す", /^[0-9a-f]{64}$/.test(m.reproduce.report_record_sha256 || ""),
        m.reproduce.report_record_sha256);
}

/* --- 8. 名乗り方の手引きは、実測から作られていること ---------------- */
console.log("\n8) 名乗り方の手引き");
{
  const g = await call("mcp_observatory_disclosure_guide");
  const names = (g.field_names_observed || []).map((x) => x.field);
  check("実際に使われている欄名を出す", names.includes("payment"), names.slice(0, 4).join(","));
  check("件数の多い順に並ぶ",
        (g.field_names_observed || []).every((x, i, a) => i === 0 || a[i - 1].seen_on_servers >= x.seen_on_servers));
  check("こちらが決めた仕様ではないと言う",
        /not a specification we invented/.test(JSON.stringify(g.notes)), "");
  check("カードが無かった数を添える",
        JSON.stringify(g.notes).includes(String(DATA.SUMMARY.agent_card_absent)), "");
}

/* --- 9. MCP の層 ---------------------------------------------------- */
console.log("\n9) MCP の層");
{
  const d = await W.fetch(new Request("https://x/mcp", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "server/discover" }),
  }));
  const b = await d.json();
  check("server/discover が答える", !!(b.result && b.result.serverInfo));
  check("対応する版を並べる", (b.result.supportedVersions || []).includes("2026-07-28"),
        JSON.stringify(b.result.supportedVersions));

  const u = await W.fetch(new Request("https://x/mcp", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "nope" }),
  }));
  check("知らない method は -32601", (await u.json()).error.code === -32601);

  const lk = await W.fetch(new Request("https://x/lookup?host=example.com"));
  check("MCP を話さない相手にも /lookup を開けてある", lk.status === 200);
}

/* --- 10. 走らなかった場面を、通った場面と見分けられること ------------ */
const EXPECTED = 53;
console.log("");
console.log("確かめた数: " + checks + " (最低 " + EXPECTED + ")");
if (checks < EXPECTED) {
  console.log("  NG   場面がまるごと走っていません。途中で止まっていないか見てください。");
  fail++;
}
if (fail) { console.log(fail + " 件おかしい。"); process.exit(1); }
console.log("照会口 すべて通過");
