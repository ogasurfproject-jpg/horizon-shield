/* 訪問看護の内部MCPを、実物の fetch を呼んで確かめる。
   ネットワークには出ない。時計は固定して渡す。

   なぜ要るか (2026-08-24):
     この口は、10月1日から請求の前に見られる。
     間違った数字を出しても落ちない。例外も出ない。ただ間違った数字が出る。
     そして受け取った側は、それを根拠に請求する。
     だから「言ってはいけないことを言わないか」「分からないものを分からないと言うか」を、
     走らせて確かめる。 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRCDIR = path.join(HERE, "src");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "hsnmcp-"));
for (const f of fs.readdirSync(SRCDIR)) {
  if (!f.endsWith(".js")) continue;
  let body = fs.readFileSync(path.join(SRCDIR, f), "utf8");
  body = body.replace(/from "\.\/([a-z0-9_]+)\.js"/g, 'from "./$1.mjs"');
  fs.writeFileSync(path.join(TMP, f.replace(/\.js$/, ".mjs")), body);
}
const W = (await import(path.join(TMP, "worker.mjs") + "?v=" + Math.random())).default;

const KEY = "test-key-not-a-real-secret";
const ENV = { NURSING_MCP_KEY: KEY };

let fail = 0;
function check(label, cond, detail) {
  console.log((cond ? "  ok   " : "  NG   ") + label + (detail ? "  " + String(detail).slice(0, 160) : ""));
  if (!cond) fail++;
}

async function rpc(method, params, { key = KEY, env = ENV } = {}) {
  const headers = { "content-type": "application/json" };
  if (key) headers["X-Admin-Key"] = key;
  const req = new Request("https://x/mcp", {
    method: "POST", headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const res = await W.fetch(req, env);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function call(name, args) {
  const r = await rpc("tools/call", { name, arguments: args || {} });
  if (r.status !== 200) return { status: r.status, raw: r.body };
  const txt = r.body && r.body.result && r.body.result.content
    && r.body.result.content[0] && r.body.result.content[0].text;
  return { status: r.status, out: txt ? JSON.parse(txt) : null, raw: r.body };
}

/* --- 1. 鍵。設定漏れで開かない ------------------------------------ */
console.log("1) 鍵");
{
  const r1 = await rpc("tools/list", {}, { env: {} });
  check("鍵が worker に設定されていなければ 403", r1.status === 403, "status=" + r1.status);
  check("その理由を言う", /設定されていません/.test(JSON.stringify(r1.body)), JSON.stringify(r1.body));

  const r2 = await rpc("tools/list", {}, { key: "" });
  check("鍵を送らなければ 403", r2.status === 403, "status=" + r2.status);

  // HTTP のヘッダは ByteString なので、日本語は入れられない(実物の鍵も ASCII である)。
  const r3 = await rpc("tools/list", {}, { key: "wrong-key-1234" });
  check("鍵が違えば 403", r3.status === 403, "status=" + r3.status);

  const r4 = await rpc("tools/list", {});
  check("正しい鍵なら通る", r4.status === 200, "status=" + r4.status);
}

/* --- 2. MCP の層 --------------------------------------------------- */
console.log("\n2) MCP の層");
{
  const r = await rpc("tools/list", {});
  const tools = r.body.result.tools.map((t) => t.name);
  check("道具が7つある", tools.length === 7, tools.join(","));
  for (const n of ["nursing_db_state", "nursing_rules_list", "nursing_rule_get",
                   "nursing_kasan_review", "nursing_shijisho_check",
                   "nursing_insurance_route", "nursing_sources"]) {
    check("道具 " + n + " がある", tools.includes(n));
  }
  const d = await rpc("server/discover", {});
  check("server/discover が答える", !!(d.body && d.body.result && d.body.result.serverInfo));
  check("対応する版を並べる",
        !!(d.body.result.supportedVersions || []).includes("2026-07-28"),
        JSON.stringify(d.body.result.supportedVersions));
  const i = await rpc("initialize", {});
  check("古い版の initialize も受ける", !!(i.body && i.body.result && i.body.result.serverInfo));
  const u = await rpc("nursing/unknown", {});
  check("知らない method は -32601", u.body.error && u.body.error.code === -32601,
        JSON.stringify(u.body.error));
}

/* --- 3. データベースの限界を、先に言う ----------------------------- */
console.log("\n3) データベースの状態");
{
  const { out } = await call("nursing_db_state");
  check("版を言う", !!out.version, out.version);
  check("項目が30件以上ある", out.items >= 30, "items=" + out.items);
  check("医療保険側の項目がある", out.by_insurance["医療"] > 0, JSON.stringify(out.by_insurance));
  check("上書きされた版の項目を名指しする", (out.superseded_items || []).length > 0,
        "superseded=" + (out.superseded_items || []).length);
  check("未確認の要件を数える", out.requirements.unconfirmed > 0,
        JSON.stringify(out.requirements));
  check("未解決の食い違いを出す", (out.open_conflicts || []).length > 0,
        "conflicts=" + (out.open_conflicts || []).length);
  check("既知の穴を出す", (out.known_gaps || []).length > 0, "gaps=" + (out.known_gaps || []).length);
}

/* --- 4. 加算の取りこぼし。判定はしない ----------------------------- */
console.log("\n4) 加算の材料");
{
  const empty = await call("nursing_kasan_review", { answers: {} });
  check("答えが無ければ「まだ何も尋ねていない」が並ぶ",
        empty.out.summary["まだ何も尋ねていない"] > 0, JSON.stringify(empty.out.summary));
  check("次に訊く設問を出す", (empty.out.next_questions || []).length > 0,
        "next=" + (empty.out.next_questions || []).length);

  const withAns = await call("nursing_kasan_review", {
    answers: {
      q_nv_kyoka_kata: "機能強化型2で届出しています",
      q_nv_24h_futan: "夜間対応の翌日は勤務間隔をあけています。ICTも使っています",
      q_nv_beppyo7: "3人です",
    },
  });
  check("答えた設問の要件が「答えがある」になる",
        JSON.stringify(withAns.out).includes("答えがある"));
  check("答えた数を数える", withAns.out.answers_given === 3, withAns.out.answers_given);
  const kyoka = withAns.out.items.find((i) => i.id === "iryo-kanri-shonichi");
  check("機能強化型の項目で、答えが数えられている",
        !!kyoka && kyoka.counts.answered >= 1, JSON.stringify(kyoka && kyoka.counts));

  const blob = JSON.stringify(withAns.out);
  for (const w of ["算定できます", "算定可能です", "算定してください", "減算されます"]) {
    // データベース側の we_do_not_say には「算定できます、とは言わない」が入っている。
    // 言い切りとして出ていないことを見る。
    const asAssertion = new RegExp(w + "(?!、とは言わない)");
    check("「" + w + "」と言い切っていない", !asAssertion.test(blob.replace(/とは言わない/g, "とは言わない")),
          (blob.match(new RegExp(".{0,20}" + w + ".{0,20}")) || [""])[0]);
  }
  check("判定はしないと明記する",
        JSON.stringify(withAns.out.notes).includes("判定はしません"));
}

/* --- 5. 指示書の期限 ----------------------------------------------- */
console.log("\n5) 指示書の期限");
{
  const r = await call("nursing_shijisho_check", {
    today: "2026-08-24",
    sheets: [
      { ref: "A", kind: "特別", issued_on: "2026-08-20" },   // 8/20 が1日目 -> 最終日 9/2
      { ref: "B", kind: "特別", issued_on: "2026-08-01" },   // 最終日 8/14 -> 期限切れ
      { ref: "C", kind: "通常", issued_on: "2026-06-01", valid_until: "2026-08-31" },
      { ref: "D", kind: "通常", issued_on: "2026-06-01" },   // 上限のみ -> 12/1
      { ref: "E", kind: "通常", issued_on: "きのう" },        // 読めない
      { ref: "F", kind: "通常", issued_on: "2026-01-01", valid_until: "2026-12-31" }, // 6か月超
    ],
  });
  const by = Object.fromEntries(r.out.sheets.map((s) => [s.ref, s]));
  check("特別: 交付日を1日目として14日 -> 最終日は交付日+13日",
        by.A.last_day === "2026-09-02", by.A.last_day);
  check("特別: 残り日数を数える", by.A.remaining_days === 9, by.A.remaining_days);
  check("特別: 過ぎていれば期限切れ", by.B.state === "期限切れ",
        by.B.state + " last=" + by.B.last_day);
  check("特別: 月1回(例外は月2回)の上限は数えられないと言う",
        /月に何回交付されたか/.test(by.A.caution || ""), by.A.caution);
  check("通常: 書かれた末日を使う", by.C.last_day === "2026-08-31", by.C.last_day);
  check("通常: 末日が無ければ上限(6か月)で数える", by.D.last_day === "2026-12-01", by.D.last_day);
  check("通常: それが上限でしかないと言う", by.D.is_upper_bound_only === true, JSON.stringify(by.D.warning));
  check("読めない日付は「分からない」", by.E.state === "分からない", by.E.why);
  check("読めない日付を推測しない", !by.E.last_day, JSON.stringify(by.E));
  check("6か月を超えた末日には注意を付ける", /6か月/.test(by.F.warning || ""), by.F.warning);
  check("上限でしか数えられていない数を出す",
        r.out.summary["上限でしか数えられていない"] === 1, JSON.stringify(r.out.summary));
  check("出典を付ける", (by.A.sources || []).length > 0, JSON.stringify((by.A.sources || [])[0]));
}

/* --- 6. 医療保険と介護保険の振り分け -------------------------------- */
console.log("\n6) 保険の振り分け");
{
  const a = await call("nursing_insurance_route",
    { youkaigo: "yes", beppyo7: "no", tokubetsu_shijisho: "no", seishinka: "no" });
  check("要介護で例外が無ければ介護保険", a.out.route === "介護保険", a.out.route);

  const b = await call("nursing_insurance_route",
    { youkaigo: "yes", beppyo7: "yes", tokubetsu_shijisho: "no", seishinka: "no" });
  check("別表第七に当たれば医療保険", b.out.route === "医療保険", b.out.route);

  const c = await call("nursing_insurance_route",
    { youkaigo: "yes", beppyo7: "unknown", tokubetsu_shijisho: "no", seishinka: "no" });
  check("分からない入力があれば決めない", c.out.route === null, String(c.out.route));
  check("どれが分からないかを言う",
        (c.out.unknown_inputs || []).some((u) => u.input === "beppyo7"),
        JSON.stringify(c.out.unknown_inputs));

  const d = await call("nursing_insurance_route",
    { youkaigo: "no", beppyo7: "unknown", tokubetsu_shijisho: "unknown", seishinka: "unknown" });
  check("要介護でなければ医療保険(例外の判定を待たない)", d.out.route === "医療保険", d.out.route);

  check("別表第七の一覧を返す", (a.out.beppyo7_list || []).length === 20,
        "count=" + (a.out.beppyo7_list || []).length);
  check("この振り分け自体が未確認であることを言う",
        JSON.stringify(a.out.notes).includes("confirmed:false"), JSON.stringify(a.out.notes));
}

/* --- 7. 一覧と1件と出典 -------------------------------------------- */
console.log("\n7) 一覧・1件・出典");
{
  const l = await call("nursing_rules_list", { insurance: "医療" });
  check("医療保険で絞れる", l.out.items.every((i) => i.insurance === "医療"), l.out.count);
  const cur = await call("nursing_rules_list", { only_current_revision: true });
  check("上書きされた版を外せる", cur.out.items.every((i) => i.revision.is_current), cur.out.count);

  const g = await call("nursing_rule_get", { id: "iryo-kasan-24h" });
  check("1件を引ける", g.out.name && g.out.name.includes("24時間"), g.out.name);
  check("要件に設問文が付く",
        (g.out.requirements || []).some((r) => r.question && r.question.length > 5));
  check("出典が URL つきで返る",
        (g.out.effect.sources || []).some((s) => s.url && s.url.startsWith("https://")),
        JSON.stringify((g.out.effect.sources || [])[0]));

  const bad = await call("nursing_rule_get", { id: "そんなものは無い" });
  check("知らない id は、あるものを並べて返す", !!bad.out.error && (bad.out.available || []).length > 0);

  const s = await call("nursing_sources");
  check("出典を素性ごとに数える", s.out.by_tier.statute > 0, JSON.stringify(s.out.by_tier));
  check("現行でない出典を分けて数える", s.out.not_current > 0,
        "not_current=" + s.out.not_current);
}

console.log("");
if (fail) { console.log(fail + " 件おかしい。"); process.exit(1); }
console.log("訪問看護の内部MCP すべて通過");
