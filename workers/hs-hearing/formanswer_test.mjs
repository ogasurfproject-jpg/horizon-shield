/* 用紙から返ってきた答えを、実物の settleByQid / pendingQuestionList / sniffFileType で確かめる。
   KV も時計もネットワークも使わん。

   なぜ要るか (2026-09-11):
     森下さま(リフォーム職人株式会社 No.001)から、こう来た。
       「いただいたフォーム内を確認させていただいたのですが、回答欄がなく、
        "フォームで回答する"と"登録を完了する"のループとなってしまうため」
     こちらが LINE で聞いた設問が、用紙のどこにも載っていなかった。
     /register-info は pending_question(連結済みの1本の文字列)を返していたが、
     用紙はそれでは欄を作れない。どこで切れば1問なのか判らんからである。

     そして、その設問の本文にはこう書いてあった。
       「写真でも、PDFでも、手書きのメモでも構いません。」
     言うておきながら、置く場所を一つも持っていなかった。

   ここで押さえること:
     1) 用紙から来た答えは qid を連れている。当て推量(ambiguous)を作らない。
     2) 締めた設問は、返事待ちの本文からも消える。用紙で二度聞かない。
     3) 残した波の時計(催促の 3/7/14/21 日)を巻き戻さない。
     4) 中身は名乗りを信じず、先頭の数バイトで見る。判らんものは預からない。
     5) 用紙(HTML)と worker の配線が、実際につながっている。 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRCDIR = path.join(HERE, "src");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "hsform-"));
for (const f of fs.readdirSync(SRCDIR)) {
  if (!f.endsWith(".js")) continue;
  let body = fs.readFileSync(path.join(SRCDIR, f), "utf8");
  body = body.replace(/from "\.\/([a-z0-9_]+)\.js"/g, 'from "./$1.mjs"');
  if (f === "hearing.js") body += "\nexport { hearingForm };\n";
  fs.writeFileSync(path.join(TMP, f.replace(/\.js$/, ".mjs")), body);
}
const AP = await import(path.join(TMP, "autopilot.mjs") + "?v=" + Math.random());
const H  = await import(path.join(TMP, "hearing.mjs") + "?v=" + Math.random());

let fails = 0;
function ok(name, cond, detail) {
  if (cond) { console.log("  ok   " + name); return; }
  fails++; console.log("  NG   " + name + (detail ? "  <- " + detail : ""));
}

/* 実測に寄せた土台。返事待ちの波が二つ開いている(森下さまの記録がそうだった)。 */
const T1 = "2026-09-04T21:17:00.000Z";   // 古い波
const T2 = "2026-09-08T21:17:00.000Z";   // 新しい波
function baseStore() {
  return {
    store_id: "hs-partner-001", member_no: "No.001", company: "リフォーム職人株式会社",
    autopilot: {
      nudges: 2, penalty: 1, unanswered_sends: 3,
      needs_human: { since: T2, why: "1通の返事をどの設問に当てるか決められない" },
      asked: [{ qid: "q_a", at: T1 }, { qid: "q_b", at: T2 }, { qid: "q_c", at: T2 }],
      pending: {
        qids: ["q_a", "q_b", "q_c"],
        asked_texts: { q_a: "問いA", q_b: "問いB", q_c: "問いC" },
        text: "問いA\n問いB\n問いC",
        sent_at: T1, via: "followup",
        waves: [
          { qids: ["q_a"], texts: { q_a: "問いA" }, sent_at: T1, kind: "followup" },
          { qids: ["q_b", "q_c"], texts: { q_b: "問いB", q_c: "問いC" }, sent_at: T2, kind: "followup" },
        ],
      },
    },
  };
}

console.log("1. 用紙から1問だけ答えた");
{
  const s = baseStore();
  const patch = AP.settleByQid(s, [{ qid: "q_b", text: "見積は月に3本ほどです" }]);
  const ap = s.autopilot, p = ap.pending;
  ok("答えは q_b にだけ入る", Object.keys(patch).join(",") === "q_b", Object.keys(patch).join(","));
  ok("印は form(当て推量ではない)", patch.q_b.attributed === "form", patch.q_b.attributed);
  ok("何を聞かれたかを控えている", patch.q_b.asked === "問いB", patch.q_b.asked);
  ok("巻き添えにした設問は無い", Array.isArray(patch.q_b.with) && patch.q_b.with.length === 0);
  ok("返事待ちに残るのは q_a と q_c", (p.qids || []).sort().join(",") === "q_a,q_c", String(p.qids));
  ok("締めた q_b の問い文は本文から消える",
     !("q_b" in (p.asked_texts || {})) && !/問いB/.test(p.text || ""), JSON.stringify(p.asked_texts));
  ok("残った問い文は消えていない",
     /問いA/.test(p.text) && /問いC/.test(p.text), p.text);
  ok("催促の時計は古い波のまま(巻き戻さない)", p.sent_at === T1, p.sent_at);
  ok("人送りの印は外れる", !ap.needs_human);
  ok("督促の数え直し", ap.nudges === 0 && ap.penalty === 0 && ap.unanswered_sends === 0);
  ok("送信履歴に返信時刻が付く", !!(ap.asked.find((a) => a.qid === "q_b") || {}).replied_at);
  ok("答えていない設問には返信時刻を付けない", !(ap.asked.find((a) => a.qid === "q_c") || {}).replied_at);
  ok("last_attributed も form", ap.last_attributed === "form", ap.last_attributed);
}

console.log("2. 返事待ちを全部答えた");
{
  const s = baseStore();
  AP.settleByQid(s, [{ qid: "q_a", text: "A" }, { qid: "q_b", text: "B" }, { qid: "q_c", text: "C" }]);
  ok("返事待ちは空になる", s.autopilot.pending === null, JSON.stringify(s.autopilot.pending));
}

console.log("3. 空で送られたとき");
{
  const s = baseStore();
  const patch = AP.settleByQid(s, [{ qid: "q_b", text: "   " }, { qid: "", text: "x" }]);
  ok("何も書いてなければ、何も当てない", Object.keys(patch).length === 0);
  ok("返事待ちはそのまま残る", (s.autopilot.pending.qids || []).length === 3);
  ok("それでも督促は数え直す(送信は届いている)", s.autopilot.nudges === 0);
}

console.log("4. 用紙で答えた設問を、もう一度聞きにいかない");
{
  const s = baseStore();
  const patch = AP.settleByQid(s, [{ qid: "q_trust", text: "施工実績4000件以上" }]);
  const profile = { industry: "construction", extra: { ...patch } };
  const next = AP.nextQuestions(profile, s.autopilot, 5).map((q) => q.qid);
  ok("q_trust は次の設問に出てこない", next.indexOf("q_trust") < 0, next.join(","));
}

console.log("5. 返事待ちを1問ずつ取り出す(用紙が欄を作れる形か)");
{
  const s = baseStore();
  const list = H.pendingQuestionList(s);
  ok("3問が3つに分かれて出る", list.length === 3, String(list.length));
  ok("qid と本文が対になっている",
     list[0].qid === "q_a" && list[0].text === "問いA", JSON.stringify(list[0]));
  ok("返事待ちが無ければ空", H.pendingQuestionList({ autopilot: {} }).length === 0);
  ok("店が無くても落ちない", H.pendingQuestionList(null).length === 0);
}

console.log("6. 見積書の中身は、名乗りではなく先頭の数バイトで見る");
{
  const mk = (bytes) => { const u = new Uint8Array(16); u.set(bytes, 0); return u.buffer; };
  const ftyp = (brand) => {
    const u = new Uint8Array(16);
    u.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70], 0);           // ....ftyp
    for (let i = 0; i < 4; i++) u[8 + i] = brand.charCodeAt(i);
    return u.buffer;
  };
  ok("JPEG",  H.sniffFileType(mk([0xFF, 0xD8, 0xFF, 0xE0])) === "image/jpeg");
  ok("PNG",   H.sniffFileType(mk([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) === "image/png");
  ok("PDF",   H.sniffFileType(mk([0x25, 0x50, 0x44, 0x46, 0x2D])) === "application/pdf");
  ok("HEIC(iPhone の既定)", H.sniffFileType(ftyp("heic")) === "image/heic");
  ok("HEIF(mif1)", H.sniffFileType(ftyp("mif1")) === "image/heic");
  ok("MP4 は預からない", H.sniffFileType(ftyp("isom")) === "");
  ok("実行ファイルは預からない", H.sniffFileType(mk([0x4D, 0x5A, 0x90, 0x00])) === "");
  ok("短すぎるものは預からない", H.sniffFileType(new Uint8Array(3).buffer) === "");
}

console.log("7. 用紙と worker の配線(繋がっていなければ、上が全部通っても届かない)");
{
  const hj  = fs.readFileSync(path.join(SRCDIR, "hearing.js"), "utf8");
  const reg = fs.readFileSync(path.join(HERE, "..", "..", "yakumo", "register", "index.html"), "utf8");
  ok("worker に見積書の受け口がある", /\/\^\\\/h\\\/\[\^\/\]\+\\\/file\$\//.test(hj) || /\/h\/\[\^\/\]\+\/file\$/.test(hj));
  ok("/register-info が設問を1問ずつ返す", /pending_questions: pendingQuestionList\(store\)/.test(hj));
  ok("/h/ POST が answers を見る", /Array\.isArray\(raw\.answers\)/.test(hj));
  ok("qid つきの答えは settleByQid で締める", /AP\.settleByQid\(store, formAnswers\)/.test(hj));
  ok("LINE で文字以外を黙って捨てていない", !/ev\.message\.type !== "text"\) continue;/.test(hj));
  ok("用紙に設問の器がある", /id="pqbox"/.test(reg) && /renderPending/.test(reg));
  ok("用紙が qid を連れて送る", /data-pq/.test(reg) && /payload\.answers=answers/.test(reg));
  ok("用紙に見積書の添付欄がある", /id="estFiles"/.test(reg) && /uploadEstFiles/.test(reg));
  ok("添付は /file へ上げる", /\/file\?name=/.test(reg));
}

console.log("8. /h/ の用紙に、設問の欄が実際に出て、書き出した JS が壊れていない");
{
  const st = { company: "リフォーム職人株式会社", industry: "construction", member_no: "No.001" };
  const pq = [{ qid: "q_estimates", text: "見積もりが3本要ります。写真でもPDFでも構いません。" },
              { qid: "q_price_pushback", text: '高いと言われた項目は<b>ありますか</b>と"聞かれたこと"' }];
  const page = H.hearingForm("ht_pq", st, null, pq);
  ok("欄が2つ出る", (page.match(/data-pq="/g) || []).length === 2,
     String((page.match(/data-pq="/g) || []).length));
  ok("qid が欄に乗っている", page.includes('data-pq="q_estimates"') && page.includes('data-pq="q_price_pushback"'));
  ok("問い文が出ている", page.includes("見積もりが3本要ります"));
  ok("設問の本文は必ず逃がす(HTMLを差し込ませない)",
     !page.includes("<b>ありますか</b>") && page.includes("&lt;b&gt;"), "設問本文の < がそのまま出た");
  ok("見積書の添付欄がある", page.includes('id="estFiles"'));
  {
    // 用紙の JS には常に querySelectorAll("[data-pq]") が入る。見るのは「欄が出たか」であって
    // 文字列があるかではない。属性と枠が無いことを見る。
    const np = H.hearingForm("ht_np", st, null, []);
    ok("返事待ちが無ければ、欄そのものを出さない",
       !np.includes('data-pq="') && !np.includes('class="pqbox"'));
  }
  ok("pendingQs を渡さん古い呼び方でも落ちない", H.hearingForm("ht_old", st, null).length > 1000);

  // 書き出した client の JS を、そのまま構文検査にかける。
  // ここが壊れると用紙は「見た目は出るのに送信だけ効かない」になる。森下さまが遭うたのがそれや。
  const m = page.match(/<script>([\s\S]*?)<\/script>/);
  ok("script が1本書き出されている", !!m);
  if (m) {
    const js = path.join(TMP, "form_client.js");
    fs.writeFileSync(js, m[1]);
    const { spawnSync } = await import("node:child_process");
    const r = spawnSync(process.execPath, ["--check", js], { encoding: "utf8" });
    ok("用紙の JS が構文として通る", r.status === 0, (r.stderr || "").split("\n").slice(0, 3).join(" "));
    ok("送信で answers を積んでいる", /payload\.answers=answers/.test(m[1]));
    ok("送信の前に見積書を上げている", /uploadEstFiles\("\/h\/"\+TOKEN/.test(m[1]));
  }
}

console.log("");
if (fails) { console.log("=== " + fails + " 件 不合格 (formanswer_test) ==="); process.exit(1); }
console.log("=== 全部 通過 (formanswer_test) ===");
