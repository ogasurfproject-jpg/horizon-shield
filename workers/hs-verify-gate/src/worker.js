// hs-verify-gate
// MCP Verification Gate / 検証の扉  (v0 適合性チェッカー)
//
// 目的:
//   申請された MCP エンドポイントを実測し、5条件への適合を決定論的に判定する。
//   人の裁量を入れない。だから無料で開放できる。
//
// 設計の芯:
//   - 実測のみ。自己申告は判定材料にしない(エンドポイントを実際に叩く)。
//   - fail-closed。判定できない項目は "unknown" ではなく不適合として扱う。
//   - 申請者が事前に自分で走らせられる(公開エンドポイント)。落ちる理由が自分で分かる。
//   - 判定結果に SHA-256 を付す。扉自身が扉の基準を満たす。
//   - 称号名・条件の重みは CONFIG で差し替え可能(仕様確定前でも動く)。
//
// 口:
//   POST /check   { "endpoint": "https://..." }   適合性チェックを実行
//   GET  /spec                                    条件の仕様(機械可読)
//   GET  /health                                  死活

import { recomputeHandler, verifyEventHandler, RECOMPUTE_USAGE, VERIFY_EVENT_USAGE } from "./recompute.js";
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

// 公開・読み取り専用のチェッカーなので、誰でもブラウザから叩けるよう CORS を開く。
// これが無いと shield ドメインの検証ディレクトリから /self・/check を実測取得できない。
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400"
};

// 仕様確定までの暫定値。名称や閾値はここだけ直せば全体に効く。
const CONFIG = {
  version: "0.2.1",
  tier_pass: "verified",        // 通過時の称号(暫定)
  tier_fail: "pending",         // 未通過(不合格とは呼ばない)
  tier_held: "held",            // 到達できず測れなかった。不適合とは別の状態
  unreachable_streak: 3,        // 連続これだけ到達不能が続くまで通知しない
  timeout_ms: 10000,
  determinism_runs: 2           // 決定論性の確認に何回叩くか
};

// 再計算の手順書。2026-08-23 に実測して書き直した。
// 旧文は "JSON.stringify the remainder in this key order" とだけ書いてあった。これは JavaScript の
// 言い回しであって、手順ではない。本番の記録1件で、第三者が自然に試す4通りを実際に走らせたところ、
// 素直な json.dumps も、区切りだけ詰めた版も、キーを並べ替えた版も、全て違うハッシュを出した。
// 再現したのは「区切りを詰める」かつ「非ASCIIをエスケープしない」の1通りだけだった。
// 誰でも再計算できると書く以上、その1通りを名指しする義務がこちらにある。
// 条件07 の適合ベクタと自己測定の公開先。判定JSONから直接たどれるようにする。
const CONFORMANCE_URL = "https://shield.the-horizons-innovation.com/verify-directory/conformance/";

// ---- 使用量 ----
// 2026-08-23。「これでインフラになったのか」と問われて、答えられなかった。作った物の数は言えても、
// 使われた回数を一度も数えていなかったからだ。インフラかどうかを決めるのは作った側の主張ではなく
// 他人の使用であり、測っていない以上その言葉は使えない。それがこの扉の存在理由そのものなので、
// 自分にも同じ規則を当てる。数えていないなら「使われている」と書かない。数えるならこう数える。
//
// 数えるのは、公開URLのホスト名と回数だけ。IPも User-Agent も本文も保存しない。
// KV は読んで書き戻すので、同時アクセスは取りこぼす。だから出す数字は常に下限であり、そう明記する。
const USAGE_TTL_DAYS = 400;

// 自ゾーン判定は既存の isOwnZone(url文字列) を使う。ここで同名の関数をもう一つ作ったのが
// 2026-08-23 のデプロイを止めた原因だった。node --check はスクリプト扱いで重複宣言を通し、
// esbuild はモジュール扱いで弾く。検査が本番より緩ければ、検査は仕事をしていない。

function usageKey(day) {
  return "usage:" + (day || new Date().toISOString().slice(0, 10));
}

function bumpUsage(env, ctx, field, host) {
  if (!env || !env.HS_VERIFY_KV) return;
  const run = async () => {
    try {
      const k = usageKey();
      const cur = (await env.HS_VERIFY_KV.get(k, "json")) ||
        { external_checks: 0, own_checks: 0, testbed_hits: 0, spec_hits: 0, external_hosts: [] };
      cur[field] = (Number(cur[field]) || 0) + 1;
      if (host && cur.external_hosts.indexOf(host) < 0 && cur.external_hosts.length < 200) {
        cur.external_hosts.push(host);
      }
      await env.HS_VERIFY_KV.put(k, JSON.stringify(cur), { expirationTtl: 60 * 60 * 24 * USAGE_TTL_DAYS });
    } catch (_e) { /* 計数の失敗で測定本体を止めない */ }
  };
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(run());
  else run();
}

async function usageReport(env, days) {
  const n = Math.min(Math.max(Number(days) || 30, 1), 90);
  const today = new Date();
  const out = [];
  const totals = { external_checks: 0, own_checks: 0, testbed_hits: 0, spec_hits: 0 };
  const hosts = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10);
    let row = null;
    try { row = await env.HS_VERIFY_KV.get(usageKey(d), "json"); } catch (_e) { row = null; }
    if (!row) continue;
    for (const f of Object.keys(totals)) totals[f] += Number(row[f]) || 0;
    for (const h of (row.external_hosts || [])) if (hosts.indexOf(h) < 0) hosts.push(h);
    out.push({ day: d, external_checks: row.external_checks || 0, own_checks: row.own_checks || 0, testbed_hits: row.testbed_hits || 0 });
  }
  return {
    window_days: n,
    counting_since: "2026-08-23",
    totals: totals,
    distinct_external_hosts_checked: hosts.length,
    external_hosts: hosts.slice(0, 100),
    by_day: out,
    what_this_is:
      "Counts of requests, published so that the question 'is this actually used by anyone' has an answer " +
      "made of numbers instead of an adjective. external_checks counts verdicts requested for endpoints " +
      "outside our own zone, which is the only figure here that means someone other than us found this " +
      "useful. own_checks counts us measuring ourselves and is separated for exactly that reason.",
    what_this_is_not:
      "Not people. Not sessions. Bots, crawlers and repeated calls from one operator are all in here and " +
      "are not distinguishable. No IP address, no user agent and no request body is stored, so they cannot " +
      "be separated later either.",
    accuracy:
      "A lower bound. Counters are read and written back, so simultaneous requests overwrite each other and " +
      "the loss is silently absorbed. A number here is never higher than the truth, and we would rather " +
      "under-report our own usage than publish a figure we cannot defend.",
    honest_status:
      totals.external_checks > 0
        ? "Someone outside this operator has used it. That is a fact about usage, not about usefulness."
        : "Nobody outside this operator has used it yet. Calling it infrastructure today would be a claim with no measurement behind it, so we do not."
  };
}

const RECOMPUTE_NOTE =
  "Remove the record_sha256 and recompute_note fields, then serialize what is left as UTF-8 JSON " +
  "with no insignificant whitespace, with the keys left in the order printed here, and with " +
  "non-ASCII characters left as themselves rather than escaped to \\u sequences. The SHA-256 of " +
  "those bytes must equal record_sha256. In JavaScript that is JSON.stringify(record). In Python " +
  "it is json.dumps(record, separators=(',',':'), ensure_ascii=False). Measured 2026-08-23: of the " +
  "four ways a reader naturally reaches for this, only that one reproduces the value, so both are " +
  "named here rather than left implied by a JavaScript idiom.";

function json(obj, status) {
  // キャッシュ指示を明示する。書かなければ中間キャッシュの裁量になり、
  // 「測っていない」と「もう緑ではない」が、どちらも古いまま配られる。
  //   400番台以上  no-store   /e/ の404は「測ってもらえば動き出す」と書いてある。
  //                           その約束を守るには、404を誰にも保持させてはいけない。
  //   それ以外     max-age=60 生きた計器なので、60秒より長く固定させない。
  const st = status || 200;
  const cache = st >= 400 ? "no-store" : "public, max-age=60, must-revalidate";
  return new Response(JSON.stringify(obj, null, 2), {
    status: st,
    headers: { ...JSON_HEADERS, "Cache-Control": cache, ...CORS_HEADERS }
  });
}

// 2026-08-20 mould-ledger. 鋳型記録の使い方。
// この台帳が測るのは「直したか」ではなく「母型を探したか」。
const MOULD_USAGE = {
  route: "GET /mould, GET /mould/{id}, POST /mould",
  purpose:
    "A fix repairs one casting. The mould that cast it sits untouched unless somebody goes looking. " +
    "This ledger records four things about a fix and freezes them: the class of assumption behind it, " +
    "where the author searched for that same assumption, what they found, and at what volume each " +
    "casting failed.",
  fields: {
    class: "the assumption, written so it can be searched for. Not a description of the symptom.",
    instance: "where it was first noticed. { where, symptom, volume }",
    searched: "the space the author says they searched. Naming it is the point.",
    reproduce:
      "optional. Commands that re-run that search, with the ref they were run against. This gate " +
      "does not run them. It records them so a reader can run them and compare their own hit list " +
      "with the locations above. A record without them is published, and says so.",
    found: "per location: already_correct, fixed, or absent. With a commit where there is one.",
    volume: "loud = it threw or returned an error. quiet = it degraded without complaining.",
  },
  volume_note:
    "The same mould does not cast identical failures. It casts the same flaw at different volumes. " +
    "The instance you notice is the loudest one, not the worst one. A quiet casting survives precisely " +
    "because it never complains, so a bug driven search always finds the wrong member of the family first.",
  empty_search_is_published:
    "A record whose searched list is empty is accepted and published as such. An instance fixed with no " +
    "class search is exactly what this ledger exists to make visible. It is not hidden and not rejected.",
  this_ledger_verifies_nothing:
    "Every record is the author's own account. This gate does not reproduce it. What is frozen here is " +
    "the claim and its date, not its truth. Each record carries a record_sha256 anyone can recompute.",
  // 2026-08-20 mould-open-write. 台帳は運営のものではない。誰でも自分の記録を刻める道を一本通す。
  writing:
    "Reading requires nothing, and writing requires no key either. Open the 'Record a mould' issue in " +
    "github.com/ogasurfproject-jpg/horizon-shield, then POST {\"issue\": <number>} to /mould/from-issue. " +
    "This gate fetches that issue from GitHub itself and records what GitHub shows. The caller carries no " +
    "credential and supplies no content, so there is nothing to forge and no shared token that can leak. " +
    "GitHub does the identity part. This gate does not, and does not claim to.",
  how_to_record:
    "https://github.com/ogasurfproject-jpg/horizon-shield/issues/new?template=mould-record.yml",
  what_a_record_is_not:
    "Not a certificate, not a score, not a ranking. Nobody is rated here. A record with an empty search " +
    "list sits in the same list as a thorough one: marked, unhidden, and not placed below it.",
};

// 2026-08-20 mould-no-key. gate が GitHub を自分で読む。呼び出し側は何も主張できない。
// 見出し文字列は .github/ISSUE_TEMPLATE/mould-record.yml と一字一句そろえる。
const MOULD_REPO = "ogasurfproject-jpg/horizon-shield";
const MOULD_LABEL = "mould-record";
const MOULD_ISSUE_FIELDS = {
  "The assumption": "class",
  "Why it is worth recording": "class_note",
  "Where you first noticed it": "instance_where",
  "What it did there": "instance_symptom",
  "How loudly did it fail there?": "instance_volume",
  "Where you searched for the same assumption": "searched",
  "What you found at each place": "found",
  "How someone else could re-run it": "reproduce",
  "What prompted the search": "prompted_by",
};

function mouldParseIssueBody(body) {
  const out = {};
  let key = null, buf = [];
  for (const line of String(body || "").replace(/\r\n/g, "\n").split("\n")) {
    const m = /^###\s+(.+?)\s*$/.exec(line);
    if (m) {
      if (key) out[key] = buf.join("\n").trim();
      key = MOULD_ISSUE_FIELDS[m[1].trim()] || null;
      buf = [];
      continue;
    }
    if (key) buf.push(line);
  }
  if (key) out[key] = buf.join("\n").trim();
  // 任意項目が未入力のとき GitHub は _No response_ と描く。空として扱う。
  for (const k of Object.keys(out)) {
    const v = out[k].trim().toLowerCase();
    if (v === "_no response_" || v === "none") out[k] = "";
  }
  return out;
}

function mouldVolume(s) {
  const t = String(s || "").trim().toLowerCase();
  if (t.startsWith("loud")) return "loud";
  if (t.startsWith("quiet")) return "quiet";
  return null;
}

function mouldLines(block) {
  return String(block || "").split("\n").map((l) => l.trim().replace(/^-\s*/, "").trim()).filter(Boolean);
}

// 2026-08-20 search-reproducible.
// 1行 = command | ref | scope。ref は commit sha / tag / 日付など、著者が指した時点。
function mouldReproduce(block) {
  return mouldLines(block).map((line) => {
    // 2026-08-20: 左から素直に3分割すると、コマンド中の | で壊れる。
    // 実測で rg -n "|| 0" src/ を含む行が別物になった。走らせるまで気づかない形。
    // ref と scope はパイプを含まない。コマンドは含む。だから左から2つだけ切る。
    const p = line.split("|");
    if (p.length < 3) return { command: line.trim(), ref: null, scope: null };
    const ref = p.shift().trim();
    const scope = p.shift().trim();
    const command = p.join("|").trim();
    if (!command) return { command: line.trim(), ref: null, scope: null };
    return { command: command, ref: ref || null, scope: scope || null };
  }).filter((x) => x.command);
}

function mouldIssueToBody(issue) {
  const f = mouldParseIssueBody(issue && issue.body);
  return {
    id: "mould-gh-" + issue.number,
    class: f.class || "",
    class_note: f.class_note || null,
    instance: {
      where: f.instance_where || null,
      symptom: f.instance_symptom || null,
      volume: mouldVolume(f.instance_volume),
    },
    searched: mouldLines(f.searched),
    found: mouldLines(f.found).map((line) => {
      // 2026-08-20: reproduce を直したとき、隣のこれを置いていた。同じ鋳型。
      // note は最後の欄なので、note にパイプが入ると p[3] しか拾わず、そこから先が黙って消える。
      // where / state / volume はパイプを含まない。note は含みうる。だから残り全部を note にする。
      const p = line.split("|").map((x) => x.trim());
      const note = p.slice(3).join(" | ").trim();
      return { where: p[0] || "", state: p[1] || "", volume: mouldVolume(p[2]), note: note || null };
    }).filter((x) => x.where),
    reproduce: mouldReproduce(f.reproduce),
    prompted_by: f.prompted_by || null,
    submitted_via: "github",
    submitted_by: (issue.user && issue.user.login) || null,
    source_url: issue.html_url || null,
  };
}

// 記録の作成そのもの。運営経路と Issue 経路の両方がここを通る。
// 二つの入口が別々に記録を組み立てると、いつか片方だけ仕様が変わる。それも鋳型。
async function mouldWrite(env, b) {
  const t = (v, n) => (v == null ? "" : String(v)).slice(0, n);
  const cls = t(b.class, 400);
  if (!cls) return { status: 400, body: { error: "class is required", usage: MOULD_USAGE } };
  const idx = (await env.HS_VERIFY_KV.get("mould:index", "json")) || [];
  const newId = t(b.id, 60) || ("mould-" + String(idx.length + 1).padStart(4, "0"));
  if (await env.HS_VERIFY_KV.get("mould:" + newId)) {
    return { status: 409, body: { error: "already_recorded", id: newId, means: "This ledger is append only. A record is never rewritten." } };
  }
  const searched = (Array.isArray(b.searched) ? b.searched : []).map((x) => t(x, 300)).filter(Boolean).slice(0, 40);
  const found = (Array.isArray(b.found) ? b.found : []).slice(0, 40).map((f) => ({
    where: t(f && f.where, 200),
    state: ["already_correct", "fixed", "absent", "live"].includes(t(f && f.state, 20)) ? t(f.state, 20) : "unstated",
    volume: ["loud", "quiet"].includes(t(f && f.volume, 10)) ? t(f.volume, 10) : null,
    commit: t(f && f.commit, 40) || null,
    note: t(f && f.note, 300) || null,
  })).filter((f) => f.where);
  const reproduce = (Array.isArray(b.reproduce) ? b.reproduce : []).slice(0, 20).map((r) => ({
    command: t(r && r.command, 400),
    ref: t(r && r.ref, 120) || null,
    scope: t(r && r.scope, 200) || null,
  })).filter((r) => r.command);
  const subVia = t(b.submitted_via, 40) || "operator";
  const subBy = t(b.submitted_by, 100) || null;
  const subSrc = t(b.source_url, 300) || null;
  const rec = {
    ledger: "HORIZON SHIELD mould records",
    id: newId,
    recorded_at: new Date().toISOString(),
    gate_commit: gateCommit(),
    class: cls,
    class_note: t(b.class_note, 600) || null,
    instance: {
      where: t(b.instance && b.instance.where, 200) || null,
      symptom: t(b.instance && b.instance.symptom, 400) || null,
      volume: ["loud", "quiet"].includes(t(b.instance && b.instance.volume, 10)) ? t(b.instance.volume, 10) : null,
    },
    searched: searched,
    searched_note: searched.length
      ? "The space the author says they searched. This ledger does not verify that the search happened."
      : "The author recorded no search. The instance was fixed and the class was not looked for. This is published, not hidden.",
    // 2026-08-20 search-reproducible. 検証はしない。他人が走らせられるようにするだけ。
    reproduce: reproduce,
    reproduce_note: reproduce.length
      ? "The author says these commands re-run the search. This gate did not run them and does not " +
        "vouch for them. What changed is that you can run them yourself against the ref given, and " +
        "compare your own hit list with the locations recorded above. If they disagree, the record " +
        "is wrong and that is now something a stranger can establish without asking anyone."
      : "No way to re-run the search was given, so the searched field above is an assertion and " +
        "nothing more. That is published rather than hidden, on the same rule as an empty search.",
    found: found,
    volume_note: MOULD_USAGE.volume_note,
    prompted_by: t(b.prompted_by, 300) || null,
    submission: {
      via: subVia,
      by: subBy,
      source: subSrc,
      what_this_establishes: subVia === "github"
        ? "This gate fetched the issue from GitHub itself and recorded what GitHub showed. Nobody handed " +
          "it these words. That establishes who wrote this record. It establishes nothing about whether " +
          "the search it describes actually happened."
        : "This record was posted with the operator token. It establishes that the operator wrote it, " +
          "and nothing else.",
    },
    self_asserted:
      "Everything above is the author's own account. This gate did not reproduce it. What is frozen " +
      "here is the claim and its date, not its truth.",
  };
  rec.record_sha256 = await sha256hex(JSON.stringify(rec));
  rec.recompute_note = RECOMPUTE_NOTE;
  await env.HS_VERIFY_KV.put("mould:" + newId, JSON.stringify(rec));
  idx.unshift({ id: newId, recorded_at: rec.recorded_at, class: rec.class, searched: searched.length, found: found.length, repro: reproduce.length, by: subBy, via: subVia, record_sha256: rec.record_sha256 });
  await env.HS_VERIFY_KV.put("mould:index", JSON.stringify(idx.slice(0, 500)));
  return { status: 201, body: rec };
}

async function sha256hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 定数時間比較: 両者を SHA-256(64桁hex) 化して XOR 集約。長さ差でも分岐しない。
async function ctEqual(a, b) {
  const ha = await sha256hex(String(a == null ? "" : a));
  const hb = await sha256hex(String(b == null ? "" : b));
  let out = 0;
  for (let i = 0; i < ha.length; i++) out |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return out === 0;
}

function withTimeout(p, ms) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))
  ]);
}

// ---- 測定経路 (2026-08-15) ----
// 実測: HTTPで呼ばれたこのWorkerから自ゾーンへの subrequest は 522 になる。
// cron起動なら通る。外部ゾーンへは通る。最初に外から見つけたのは Federico。
// 対象が自ゾーンのときだけ、別ゾーンの hs-verify-relay を経由して公開エッジで測る。
// service binding は使わない。公開経路を測らない私道になるからだ。
//
// ---- 訂正 (2026-08-19 patch52。上の行は消さない。訂正は積む) ----
// 上の「cron起動なら通る」は、半分が実測で、半分が外れていた。
// 2026-08-18T18:00:27Z の巡回の記録では、同じ cron が7本を測り、
// mcp / hearing / web / jidec / p001 はすべて reachable:true を返している。
// cron から自ゾーンの「別ワーカー」へは通る。そこは正しかった。
// 同じ巡回で gate だけが http 522 を返した（/history 18:00:38Z）。
// 塞がっていたのはゾーンではなく、同じワーカーが自分自身を叩く経路だった。
// 条件式がゾーンで書かれていたため、cron のときだけ自己測定が直接経路に落ち、
// 毎日 03:00 JST に自分を held にして、それを「相手に届かない」として公開していた。
// 登記簿の中で唯一、自分についてだけ、測定器の故障を対象の欠陥として記録していた。
const PROBE_UA = "HORIZON-SHIELD-verify-gate/0.2 (+https://gate.horizonshield.dev/spec; conformance probe; read-only)";
const OWN_ZONE = "horizonshield.dev";
const GATE_HOST = "gate.horizonshield.dev"; // patch52: 自己参照かどうかの判定に使う
let GATE_ENV = null;       // 入口で env を差す。値は毎回同一なので競合しない
let GATE_CONTEXT = "none"; // "http" | "cron"。patch52: 中継の要否は文脈だけでなく「相手が自分か」で決まる
// 2026-08-19 patch53. patch52 がこの行から消してしまった実測を書き戻す。
//   旧: 「★中継は http 文脈のみ。cron→workers.dev は塞がっている(実測)」
// 消したのは誤りだった。79行目の古い記述は残して訂正を積んだのに、ここだけ消していた。
// しかもこの1行が、cron から中継に届かない可能性を示す唯一の手がかりだった。
// RELAY_URL は現在 workers.dev なので、この実測が今も生きているなら cron からは届かない。
// そのときの正解は「届かない」ではなく「測っていない」。patch53 の try/catch がそれを保証する。
// 中継に custom domain を張れば cron からも届く可能性はある。cron から自ゾーンの別ワーカーへは
// 2026-08-18T18:00Z の巡回で5本とも到達を実測済みだからだ。ただしこれは未測定。推測で動かさない。

function isOwnZone(u) {
  try {
    const h = new URL(u).hostname;
    return h === OWN_ZONE || h.endsWith("." + OWN_ZONE);
  } catch (_e) { return false; }
}

function isSelf(u) {
  try { return new URL(u).hostname === GATE_HOST; } catch (_e) { return false; }
}

function relayConfigured() {
  return !!(GATE_ENV && GATE_ENV.RELAY_URL && GATE_ENV.RELAY_TOKEN);
}

// 2026-08-19 patch52. 中継を通すかどうか。
// http 文脈: 自ゾーンは全部 522 になる(2026-08-14/15 実測)。中継が要る。
// cron 文脈: 自ゾーンの別ワーカーへは直接届く(2026-08-18T18:00Z の巡回で5本を実測)。
//            届かないのは自分自身への subrequest だけ(同じ巡回で gate だけ http 522)。
// だから条件は「自ゾーンか」ではなく「自分自身か」で分ける。
function useRelay(u) {
  if (!relayConfigured()) return false;
  if (!isOwnZone(u)) return false;
  return GATE_CONTEXT === "http" || isSelf(u);
}

function probeVia(endpoint) {
  return useRelay(endpoint)
    ? "relay (hs-verify-relay, a separate worker outside this zone path; the whole probe traverses the public edge, because a Worker invoked over HTTP cannot reach its own zone directly. Measured 2026-08-14/15)"
    : "direct from the gate worker (" + GATE_CONTEXT + " context)";
}

// デプロイ時に deploy_gate.sh が --var GATE_COMMIT:<sha> で注入する。
// 注入なしでデプロイされたら、判定には "unpinned" が載る。空白ではなく名指しで。
// コミットSHAは内容アドレスであり、この値が record_sha256 の中を旅することで
// 「どのバイト列のコードがこの判定を出したか」が判定自身に固定される。
function gateCommit() {
  return (GATE_ENV && GATE_ENV.GATE_COMMIT)
    ? String(GATE_ENV.GATE_COMMIT)
    : "unpinned: this deployment did not inject a commit (deploy_gate.sh not used)";
}

async function probeFetch(url, init) {
  const opts = init ? { ...init } : {};
  opts.headers = { ...(opts.headers || {}), "user-agent": PROBE_UA };
  if (!useRelay(url)) {
    // 2026-08-19 patch52. 中継が無い状態で自分自身を直接叩くと必ず http 522 になる。
    // 522 は gatewayish なので transport 扱いになり、公開の記録に reachable:false が載る。
    // それは相手についての主張であり、ここでの相手は自分自身で、
    // 公開インターネットからは到達できている。**書いてよい事実ではない。**
    // 測定を成立させずに gate-side として落とす。既存の検出がこれを拾う。
    if (isSelf(url)) {
      throw new Error("relay unavailable (self-probe has no relay path): gate-side failure, not a statement about the target");
    }
    return await fetch(url, opts);
  }
  // 2026-08-19 patch53. ここは patch52 の取りこぼし。
  // 中継が「返した」場合しか見ていなかった。fetch that throws は素通りして、
  // 呼び出し元では transport 扱いになり、また reachable:false が公開される。
  // Cloudflare が同一アカウントの workers.dev 間呼び出しを塞ぐときは、
  // ステータスではなく例外で来る（1104 / 1042 / fetch failed。checkMcp の hint が同じ形を名指ししている）。
  // RELAY_URL は現在 workers.dev なので、cron からはこの形で落ちる可能性が高い。
  // 中継に届かないのはこちらの故障であって、相手についての事実ではない。例外にもそう言わせる。
  let res;
  try {
    res = await fetch(GATE_ENV.RELAY_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-relay-token": GATE_ENV.RELAY_TOKEN },
      body: JSON.stringify({
        url: url,
        method: opts.method === "POST" ? "POST" : "GET",
        headers: opts.headers,
        body: typeof opts.body === "string" ? opts.body : null
      })
    });
  } catch (e) {
    throw new Error("relay unreachable (" + String((e && e.message) || e) + "): gate-side failure, not a statement about the target");
  }
  let wrapped = null;
  try { wrapped = await res.json(); } catch (_e) { wrapped = null; }
  if (res.status === 502 && wrapped && wrapped.error === "target_fetch_failed") {
    // 中継までは届いたが、中継から相手に届かなかった = 公開エッジ経由の相手側到達性の事実
    throw new Error("unreachable via public-edge relay: " + String(wrapped.message || "fetch failed"));
  }
  if (!res.ok || !wrapped || wrapped.relayed !== true) {
    // 中継そのものに届かない/設定不良 = こちら側の故障。相手の記録にしない文言で返す
    throw new Error("relay unavailable (http " + res.status + "): gate-side failure, not a statement about the target");
  }
  return new Response(wrapped.body || "", { status: wrapped.status, headers: wrapped.headers || {} });
}

// 2^53 を超える整数リテラルは JSON.parse が黙って丸める。丸めた後の数からは復元できない。
// 2026-08-23 の午前、我々はこれを「JavaScriptでは検出不能な限界」として公開した。誤りだった。
// V8 の source-access reviver は各リテラルの元の文字列を渡してくれる。元が読めるなら、丸めが
// 起きた事実は検出できる。検出できるものを「限界」と呼んで放置するのは、ただの怠慢だった。
//
// なぜ拒む必要があるか: RFC 8785 の土台である RFC 7493 (I-JSON) は整数を
// [-(2^53)+1, (2^53)-1] に限っている。範囲外の整数を含む表面は、Python のように多倍長整数を
// 持つ言語では別の値として読まれる。つまり我々のハッシュを相手は再現できない。
// 再現できないものに「誰でも再計算できる」と書いた指紋を付けてはいけない。
//
// この機能が無い実行環境では detectable:false を返し、「検出できなかった」と正直に言う。
// 検出できないことと、起きていないことは、別の事実である。
const PARSE_INFO = Symbol("hs_parse_info");

function parseJsonTracked(text) {
  const lost = [];
  let detectable = false;
  const value = JSON.parse(text, function (k, v, ctx) {
    if (ctx && typeof ctx.source === "string") {
      detectable = true;
      if (typeof v === "number" && /^-?\d+$/.test(ctx.source)) {
        try { if (BigInt(ctx.source) !== BigInt(v)) lost.push(ctx.source); } catch (_e) { /* Infinity 等は canonicalJson 側で拒む */ }
      }
    }
    return v;
  });
  const info = { detectable: detectable, lost: lost };
  if (value && typeof value === "object") {
    try { Object.defineProperty(value, PARSE_INFO, { value: info, enumerable: false }); } catch (_e) {}
  }
  return value;
}

function parseInfoOf(v) {
  return (v && typeof v === "object" && v[PARSE_INFO]) || { detectable: false, lost: [] };
}

async function rpcCall(endpoint, method, params) {
  const res = await withTimeout(probeFetch(endpoint, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params || {} })
  }), CONFIG.timeout_ms);
  if (!res.ok) throw new Error("http " + res.status);
  return parseJsonTracked(await res.text());
}

// ---- 表面(surface)のハッシュ ----
// RFC 8785 (JCS) の正規化。2026-08-23、本物のJCS実装(npm canonicalize)と適合ベクタで突き合わせた。
//
// 実測: 12本中11本がバイト一致。JSで書いてあることが効いていて、キー順序(RFC 8785 は UTF-16
// コード単位順。JSの既定 sort がまさにそれ)と数値表記(ES6 Number::toString がそのまま仕様)は
// 素通しで合っていた。同じ処理を Python で手書きすると、コードポイント順と指数表記の2点で外れる。
//
// 唯一外れた1本が非有限数だった。1e400 は JSON.parse で Infinity になり、旧実装はそれを
// JSON.stringify 経由で null に変え、ハッシュだけは平然と返していた。本物のJCSはここで例外を出す。
// 黙って値が変わる正規化は、第三者の再計算を黙って壊す。計器が黙って壊れるのが一番たちが悪い。
// だから出せないものは出さない(fail-closed)。適合ベクタは tools/jcs_conformance.mjs に固定した。
//
// この計器の既知の限界(2026-08-23 実測、未解決):
//   JavaScript では 2^53 を超える整数リテラルは JSON.parse の時点で既に丸められている。
//   9007199254740993 は、この関数が値を見る前に ...992 になっており、こちらからは区別できない。
//   Python のような多倍長整数を持つ言語の実装は、ここで黙って丸めず例外を出すべきであり、
//   この実装はそれができない。できないことを、できるふりで隠さずここに書いておく。
//   (この一点だけは、我々が測れない 1/64 にあたる。)
//
// 出典: Federico Blanco Sanchez-Llanos が自身の署名経路で同じ分類の乖離を公表(2026-08-23)。
// 指摘は借りた。数字は自分で測った。
function canonicalJson(v) {
  if (typeof v === "number" && !Number.isFinite(v)) {
    throw new Error("canonicalization refused: a non-finite number (Infinity or NaN) has no JSON form, so no reproducible hash exists over it");
  }
  if (v === null || typeof v !== "object") return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonicalJson(v[k])).join(",") + "}";
}

// ハッシュは16hex(64bit)に切る。変更検出用の指紋であって、暗号学的な同一性証明ではない。
// 名前ハッシュだけでは「名前を残して inputSchema を書き換える」変更(統合破壊の第1位)が見えない。
// だからマニフェスト全体と、ツール1本ごとの指紋を持つ。
async function surfaceHashes(tools, initResult, pages, complete, parseNotes) {
  const sorted = tools.slice().sort((a, b) => (String(a.name) < String(b.name) ? -1 : 1));
  const strip = (t) => ({ name: t.name, description: t.description || "", inputSchema: t.inputSchema || null });
  const pn = parseNotes || { detectable: false, lost: [] };

  // 正規化を拒んだ場合、それは相手が壊れているのではなく、こちらが「その形は正規化できない」と
  // 言っているだけ。到達性の失敗(transport)に混ぜると、こちらの都合が相手の記録になる。
  // だから握りつぶしも例外の素通しもせず、ハッシュを null にして理由をそのまま開示する。
  let refused = null;
  // 丸められた整数リテラルを見ていたら、その時点で指紋は他言語と一致しない。ハッシュを出さない。
  if (pn.lost.length) {
    refused = "canonicalization refused: the response carried " + pn.lost.length +
      " integer literal(s) outside the IEEE-754 safe range (" + pn.lost.slice(0, 3).join(", ") +
      (pn.lost.length > 3 ? ", ..." : "") + "), which JSON.parse rounded before this gate saw them. " +
      "RFC 7493, the profile RFC 8785 builds on, excludes them for this reason";
  }
  const hash = async (v) => {
    if (refused) return null;
    try {
      return (await sha256hex(canonicalJson(v))).slice(0, 16);
    } catch (e) {
      if (!refused) refused = String((e && e.message) || e);
      return null;
    }
  };

  const perTool = {};
  for (const t of sorted) {
    perTool[String(t.name)] = await hash(strip(t));
  }
  const out = {
    complete: complete,
    pages_followed: pages,
    names_hash: (await sha256hex(JSON.stringify(sorted.map((t) => String(t.name))))).slice(0, 16),
    manifest_hash: await hash(sorted.map(strip)),
    server_info_hash: initResult ? await hash(initResult) : null,
    tool_hashes: perTool
  };
  out.canonicalization = refused ? "refused" : "rfc8785-jcs";
  // 検出できたか / 検出した結果どうだったか、を分けて書く。
  // "clean" は「無かった」。"unavailable" は「見られなかった」。同じ扱いにしてはいけない。
  out.unsafe_integer_scan = pn.detectable ? (pn.lost.length ? "found" : "clean") : "unavailable in this runtime";
  if (refused) {
    out.canonicalization_note =
      "A hash is withheld here rather than published. " + refused + ". This is a statement about what " +
      "this gate will canonicalize, NOT a fault found in the measured server: a value of this shape " +
      "cannot be re-serialized byte-for-byte by an independent party, so any hash over it would be a " +
      "number nobody else could reproduce. Publishing it would look like proof and act like noise.";
  }
  return out;
}

// ---- 条件06. 「無かった」と「引けなかった」を区別できる契約か ----
// Federico Blanco Sanchez-Llanos, "The Mould, Not the Letter", 2026-08-20:
//   never let "the fetch failed" and "the fetch succeeded and found nothing" collapse
//   into the same downstream value.
//
// Measured from the outputSchema each tool already declares in tools/list. Nothing is
// executed. This renders NO verdict ,  it is a disclosed number, like reachable in gate58.
//
// The test is STRUCTURAL and name-independent: a boolean, or an enum with 2+ values, is a
// place a read-succeeded / read-failed / nothing-matched state can live. Field NAMES are
// not consulted, because this gate scores servers it does not own, and a name list would
// let an author score well by renaming a field. A bare count is not enough: count 0 does
// not prove the read worked. The field names that produced each pass are published, so a
// reader can see the false positives (a job board that declares remote:boolean passes this
// structural test and is not thereby holding the difference).
function schemaHoldsState(schema) {
  // v2, 2026-08-20, Federico Blanco Sanchez-Llanos's refinement. Only the ENVELOPE:
  // the top-level properties of the outputSchema, outside whatever wraps the domain
  // payload (data/result/items). Read-state conventionally lives in the envelope; an
  // entity flag like a job listing's remote:boolean lives one level down, inside the
  // object it describes, and is not read-state. Restricting to the top level strips
  // that entity-nested class without dropping a real read-state (ours all sit at the
  // envelope). It does NOT separate a top-level metadata boolean (cache_hit) from a
  // top-level read-state: that residual is semantic, not structural, which is why the
  // field names stay published so a reader makes the call the machine can't.
  const props = (schema && schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties))
    ? schema.properties : {};
  const found = [];
  for (const [pk, pv] of Object.entries(props)) {
    if (!pv || typeof pv !== "object") continue;
    const t = pv.type, ts = Array.isArray(t) ? t : (t ? [t] : []);
    const isBool = ts.includes("boolean");
    const isEnum = Array.isArray(pv.enum) && pv.enum.length >= 2;
    if (isBool || isEnum) found.push(pk + ":" + (isEnum ? "enum" : "boolean"));
  }
  return [...new Set(found)];
}

function measureAbsenceVsFailure(tools) {
  let opaque = 0, flat = 0, discriminating = 0;
  const holds = [];
  for (const t of (tools || [])) {
    const out = t && t.outputSchema;
    const hasOut = !!(out && typeof out === "object" && Object.keys(out).length);
    if (!hasOut) { opaque += 1; continue; }
    const fields = schemaHoldsState(out);
    if (fields.length) { discriminating += 1; holds.push({ tool: String(t && t.name), fields: fields }); }
    else { flat += 1; }
  }
  const total = (tools || []).length;
  const cannot = opaque + flat;
  return {
    condition: "06",
    question: "Can a consumer tell 'the lookup failed' from 'the lookup found nothing'?",
    source: "Federico Blanco Sanchez-Llanos, \"The Mould, Not the Letter\", 2026-08-20",
    method: "structural, name-independent: a boolean or an enum with 2+ values in a tool's declared outputSchema. tools/list only; nothing is executed.",
    verdict: null,
    verdict_note: "A disclosed measurement, not a pass or fail. Nearly all of the field cannot do this, so a threshold would only condemn; and a schema is a declaration, not behaviour. The gate reports the number and the field names, and judges nobody on it.",
    tools_measured: total,
    opaque: opaque,
    flat: flat,
    discriminating: discriminating,
    cannot_distinguish: cannot,
    cannot_distinguish_pct: total ? Math.round(1000 * cannot / total) / 10 : null,
    discriminating_fields: holds,
    caution: "This test cannot read. A field like remote:boolean passes it without being a read-state at all. discriminating_fields is published so you can check each pass yourself."
  };
}

// ---- 条件1. 実在する MCP エンドポイント ----
async function checkMcp(endpoint) {
  const detail = {};
  let initResult = null;
  // 応答テキストの段階で、丸められた整数リテラルを見たかどうかを集める。
  const parseNotes = { detectable: false, lost: [] };
  const noteParse = (v) => {
    const i = parseInfoOf(v);
    if (i.detectable) parseNotes.detectable = true;
    for (const s of i.lost) if (parseNotes.lost.indexOf(s) < 0) parseNotes.lost.push(s);
  };
  try {
    const init = await rpcCall(endpoint, "initialize", { protocolVersion: "2024-11-05" });
    noteParse(init);
    detail.initialize = !!(init && init.result);
    detail.server_name = (init && init.result && init.result.serverInfo && init.result.serverInfo.name) || null;
    initResult = init && init.result ? { serverInfo: init.result.serverInfo || null, capabilities: init.result.capabilities || null } : null;
  } catch (e) {
    if (/gate-side failure/.test(String(e && e.message))) {
      // 中継の故障。対象のことは何も分かっていない。boolean にもそう言わせる。
      return { pass: false, gate_side: true, measured: false, reason: "not measured: " + e.message, detail };
    }
    const hint = /1104|1042|Failed to fetch|fetch failed/i.test(String(e.message))
      ? " (the gate could not reach this host. Cloudflare blocks Worker-to-Worker calls within the " +
        "same account over workers.dev; use a custom domain, or run the check from outside)"
      : "";
    return { pass: false, transport: true, reason: "initialize failed: " + e.message + hint, detail };
  }
  try {
    // カーソルを最後まで辿る(上限3ページ)。辿り切れなければ surface は complete: false。
    // 部分読みから「ツールが消えた」と主張するのが、この測定の最悪の故障だから。
    let tools = [];
    let cursor = null;
    let pages = 0;
    do {
      const list = await rpcCall(endpoint, "tools/list", cursor ? { cursor: cursor } : {});
      noteParse(list);
      const batch = (list && list.result && list.result.tools) || [];
      tools = tools.concat(batch);
      cursor = (list && list.result && list.result.nextCursor) || null;
      pages += 1;
    } while (cursor && pages < 3);
    detail.tool_count = tools.length;
    detail.tools = tools.map((t) => t.name).slice(0, 50);
    detail.surface = await surfaceHashes(tools, initResult, pages, !cursor, parseNotes);
    detail.absence_vs_failure = measureAbsenceVsFailure(tools);
    if (!tools.length) return { pass: false, reason: "tools/list returned no tools", detail };
  } catch (e) {
    if (/gate-side failure/.test(String(e && e.message))) {
      return { pass: false, gate_side: true, measured: false, reason: "not measured: " + e.message, detail };
    }
    return { pass: false, transport: true, reason: "tools/list failed: " + e.message, detail };
  }
  return { pass: true, reason: "MCP endpoint responds to initialize and tools/list", detail };
}

// ---- 条件2. A2A エージェントカード ----
async function checkAgentCard(endpoint) {
  const origin = new URL(endpoint).origin;
  const url = origin + "/.well-known/agent-card.json";
  try {
    const res = await withTimeout(probeFetch(url), CONFIG.timeout_ms);
    if (!res.ok) {
      // An HTTP status IS an answer from the far side. 404 means "reached,
      // and no card is published there": a failed condition, not
      // unreachability, and it must not flip the whole record to held.
      // Only gateway-shaped statuses (502-504 and Cloudflare's 52x edge
      // codes) mean the origin behind the URL did not actually answer.
      const gatewayish = (res.status >= 502 && res.status <= 504) || (res.status >= 520 && res.status <= 530);
      if (gatewayish) return { pass: false, transport: true, reason: "agent-card not reachable (http " + res.status + ")", detail: { url } };
      return { pass: false, reason: "agent-card not published (http " + res.status + ": the server answered; no card lives at this path)", detail: { url } };
    }
    const card = await res.json();
    const missing = ["name", "description"].filter((k) => !card[k]);
    if (missing.length) {
      return { pass: false, reason: "agent-card missing fields: " + missing.join(", "), detail: { url } };
    }
    return {
      pass: true,
      reason: "agent-card published and well-formed",
      detail: { url, name: card.name, skills: (card.skills || []).length },
      card: card
    };
  } catch (e) {
    if (/gate-side failure/.test(String(e && e.message))) {
      return { pass: false, gate_side: true, measured: false, reason: "not measured: " + e.message, detail: { url } };
    }
    return { pass: false, transport: true, reason: "agent-card fetch failed: " + e.message, detail: { url } };
  }
}

// ---- 条件3. 報酬構造の開示 ----
// 内容は審査しない。開示していないという選択肢だけを消す。
const PAID_BY = ["buyer", "seller", "referral", "advertising", "subscription", "public", "other"];

function checkCompensation(card) {
  if (!card) return { pass: false, reason: "no agent-card, cannot read compensation", detail: {} };
  const c = card.compensation;
  if (!c || typeof c !== "object") {
    return {
      pass: false,
      reason: "compensation block not declared in agent-card",
      detail: { expected_shape: { paid_by: PAID_BY, referral_fee: "boolean", listing_fee: "boolean", success_fee_pct: "number", disclosure_url: "string" } }
    };
  }
  if (!PAID_BY.includes(c.paid_by)) {
    return { pass: false, reason: "compensation.paid_by must be one of: " + PAID_BY.join(", "), detail: { got: c.paid_by } };
  }
  if (typeof c.referral_fee !== "boolean" || typeof c.listing_fee !== "boolean") {
    return { pass: false, reason: "compensation.referral_fee and listing_fee must be boolean", detail: {} };
  }
  return {
    pass: true,
    reason: "compensation structure declared",
    detail: {
      paid_by: c.paid_by,
      referral_fee: c.referral_fee,
      listing_fee: c.listing_fee,
      success_fee_pct: typeof c.success_fee_pct === "number" ? c.success_fee_pct : null,
      disclosure_url: c.disclosure_url || null
    }
  };
}

// ---- 条件4. 数値主張の再計算可能性(決定論性) ----
// 同じ入力を複数回投げ、返る内容が一致するかを実測する。
async function checkDeterminism(endpoint, toolName, allowToolCall) {
  // 既定ではツールを呼ばない。決定論性を測るには相手のツールを実行する必要があり、
  // 先頭のツールが破壊的な操作である可能性がある。所有者の明示的な同意なしには触らない。
  if (!allowToolCall) {
    return {
      pass: false,
      measured: false,
      reason:
        "not measured: measuring determinism requires calling one of your tools, and this gate " +
        "does not call tools on a server without the owner's consent. The first tool listed may " +
        "be destructive. To have this condition measured, re-run with allow_tool_call set to true " +
        "from a request you control.",
      detail: {
        consent_required: true,
        how_to_measure: 'POST /check {"endpoint":"https://your-server/mcp","allow_tool_call":true}',
        tool_that_would_be_called: toolName || null
      }
    };
  }
  if (!toolName) return { pass: false, reason: "no tool available to test", detail: {} };
  const outs = [];
  for (let i = 0; i < CONFIG.determinism_runs; i++) {
    try {
      const r = await rpcCall(endpoint, "tools/call", { name: toolName, arguments: {} });
      const txt = JSON.stringify((r && r.result && r.result.content) || r);
      outs.push(txt);
    } catch (e) {
      return { pass: false, reason: "tools/call failed: " + e.message, detail: { tool: toolName } };
    }
  }
  const same = outs.every((o) => o === outs[0]);
  return {
    pass: same,
    reason: same
      ? "identical input returned identical output across " + CONFIG.determinism_runs + " runs"
      : "output changed between identical runs (not usable as a fixed reference)",
    detail: { tool: toolName, runs: CONFIG.determinism_runs, identical: same }
  };
}

// ---- 判定の組み立て ----
async function runCheck(endpoint, allowToolCall) {
  const started = new Date().toISOString();
  const results = {};

  results.mcp_endpoint = await checkMcp(endpoint);
  const cardRes = await checkAgentCard(endpoint);
  results.agent_card = { pass: cardRes.pass, transport: cardRes.transport === true, ...(cardRes.gate_side === true ? { gate_side: true, measured: false } : {}), reason: cardRes.reason, detail: cardRes.detail };
  // カードが「取れなかった」のが中継故障なら、開示の有無も分かっていない。落ちた顔をさせない。
  results.compensation_disclosure = cardRes.gate_side === true
    ? { pass: false, gate_side: true, measured: false, reason: "not measured: the agent card could not be fetched because the gate's relay path was unavailable, so whether compensation is disclosed is unknown" }
    : checkCompensation(cardRes.card);

  const firstTool = results.mcp_endpoint.detail && results.mcp_endpoint.detail.tools
    ? results.mcp_endpoint.detail.tools[0] : null;
  // 2026-08-19 patch52. MCPが測れていないなら、ツールが無いのではなく見ていない。
  // "no tool available to test" は、探した上で無かったときの文言。
  // 探していないのに無いと書くのは、8/19 に verify-event の tags で直したのと同じ形。
  results.determinism = results.mcp_endpoint.gate_side === true
    ? { pass: false, gate_side: true, measured: false, reason: "not measured: the tool list could not be read because the gate's relay path was unavailable, so there was nothing to test determinism against" }
    : await checkDeterminism(endpoint, firstTool, allowToolCall === true);

  const passed = Object.values(results).every((r) => r.pass);
  // gate-side = こちらの測定装置の故障。unreachable(相手に届かない)と混ぜない。
  const gateSide = Object.values(results).some((r) => r && r.gate_side === true);
  // 「届かなかった」と「届いた上で条件を満たさない」は別の事実。
  // fail-closed は変えない。緑にはしない。ただし理由の書き分けはする。
  const unreachable = Object.values(results).some((r) => r && r.transport === true);

  const record = {
    gate: "MCP Verification Gate",
    gate_version: CONFIG.version,
    gate_commit: gateCommit(),
    endpoint: endpoint,
    checked_at: started,
    reachable: gateSide ? null : !unreachable,
    status: passed ? CONFIG.tier_pass : ((unreachable || gateSide) ? CONFIG.tier_held : CONFIG.tier_fail),
    scope_note:
      "This gate verifies conformance and disclosure only. It does NOT verify that any price " +
      "or figure returned by the server is correct. Price validation is a separate, paid tier " +
      "and is currently available for Japanese construction only. By default this gate calls no " +
      "tools on the server being checked, so determinism is reported as not measured rather than " +
      "guessed. Send allow_tool_call true to have it measured on a server you control.",
    tools_called: allowToolCall === true ? "one tool, twice, with empty arguments, by consent" : "none",
    probed_via: probeVia(endpoint),
    ...(gateSide ? {
      measurement_note:
        "This measurement did not happen. The gate's own relay path was unavailable, so nothing in " +
        "this record says anything about the target. reachable is null rather than false for exactly " +
        "that reason: an instrument failure is not a statement about the thing it failed to measure."
    } : {}),
    checks: results
  };

  // 条件06 は合否ではなく開示測定。checks の外に置く(passed に触れない)。sha を取る前に
  // 挿入するので、新しい verdict はこの値ごと自己整合し、verify_verdict でも一致する。
  const _avf = record.checks.mcp_endpoint && record.checks.mcp_endpoint.detail
    ? record.checks.mcp_endpoint.detail.absence_vs_failure : null;
  if (_avf) {
    delete record.checks.mcp_endpoint.detail.absence_vs_failure;
    record.absence_vs_failure = _avf;
  } else {
    record.absence_vs_failure = {
      condition: "06",
      measured: false,
      reason: "the tool list could not be read, so the contract was not measured. This is NOT a statement that the server cannot distinguish the two ,  only that the gate did not see."
    };
  }

  // 条件07 正規化適合。これも合否ではなく開示測定で、checks の外に置く(passed に触れない)。
  // 2026-08-23、実装より先に「この条件で行が赤くなることはない」と公開した。約束が先にあるので守る。
  // 測っているのは相手の行儀ではなく、我々以外の誰かがこの表面を検算できるかどうか。
  // 正規化できない表面には第三者が再現できる指紋が無く、黙って書き換えられても作った本人以外は気づけない。
  const _surf = record.checks.mcp_endpoint && record.checks.mcp_endpoint.detail
    ? record.checks.mcp_endpoint.detail.surface : null;
  if (_surf) {
    const refused = _surf.canonicalization === "refused";
    record.canonicalization = {
      condition: "07",
      question: "Can an independent party recompute the fingerprint of this server's declared surface, byte for byte, without us?",
      method: "RFC 8785 (JCS). The tool manifest from tools/list is canonicalized and hashed. Nothing is executed, and nothing about the content is judged.",
      measured: true,
      canonicalizable: !refused,
      scheme: _surf.canonicalization || null,
      unsafe_integer_scan: _surf.unsafe_integer_scan || null,
      verdict: null,
      verdict_note:
        "A disclosed measurement, not a pass or fail. It never turns a row red. This gate published that " +
        "promise on 2026-08-23, before the condition was implemented, and is keeping it.",
      gate_self_conformance: {
        vectors: 13,
        passing: 13,
        measured_at: "2026-08-23",
        measured_against: "npm canonicalize@2.0.0, an independent RFC 8785 implementation",
        first_result: "11 of 12 before the fix. The vector we failed produced a hash over a value we had silently altered.",
        published: CONFORMANCE_URL
      },
      retracted_limitation:
        "On the morning of 2026-08-23 this gate published, here and on its own site, that an integer past " +
        "2^53 is rounded inside JSON.parse before the gate can see it and that the case was therefore " +
        "undetectable in JavaScript. That was wrong, and it was wrong in the comfortable direction: it " +
        "excused us. The source text is available to a JSON.parse reviver, so the rounding is detectable " +
        "after all. It is now detected, and a surface carrying such a literal has its fingerprint withheld " +
        "rather than published. The false claim is left on the record instead of being deleted."
    };
    if (refused) record.canonicalization.refusal_note = _surf.canonicalization_note || null;
  } else {
    record.canonicalization = {
      condition: "07",
      measured: false,
      reason:
        "the tool list could not be read, so there was no declared surface to canonicalize. This is NOT a " +
        "statement that the surface cannot be canonicalized, only that the gate did not see it."
    };
  }

  // 条件5. 判定自体が再計算可能であること
  const canonical = JSON.stringify(record);
  record.record_sha256 = await sha256hex(canonical);
  record.recompute_note = RECOMPUTE_NOTE +
    " This gate holds itself to the same standard it applies to applicants.";

  return record;
}

// ---- 仕様(機械可読) ----
function spec() {
  return {
    gate: "MCP Verification Gate",
    version: CONFIG.version,
    gate_commit: gateCommit(),
    what_this_verifies: [
      "The server actually exists and speaks MCP",
      "The server publishes an A2A agent card",
      "The server declares who pays it",
      "Identical input returns identical output",
      "This gate's own verdict can be recomputed by anyone"
    ],
    what_this_does_not_verify: [
      "Whether prices or figures returned by the server are correct",
      "Whether the declared compensation structure is truthful (it is published and recorded; false declarations are grounds for revocation)",
      "Quality, competence, or fitness of the underlying business"
    ],
    conditions: {
      mcp_endpoint: "POST /mcp responds to initialize and tools/list with at least one tool",
      agent_card: "GET /.well-known/agent-card.json returns JSON with name and description",
      compensation_disclosure: {
        location: "agent-card, top-level key 'compensation'",
        shape: {
          paid_by: PAID_BY,
          referral_fee: "boolean, required",
          listing_fee: "boolean, required",
          success_fee_pct: "number, optional",
          disclosure_url: "string, optional"
        },
        note: "Content is not judged. Only the absence of disclosure disqualifies."
      },
      determinism: "Calling the same tool with the same arguments returns identical content across runs. NOT measured by default: doing so requires executing a tool on the checked server, which this gate will not do without the owner's consent. Send allow_tool_call true to measure it.",
      self_verification: "Every verdict carries a SHA-256 that any third party can recompute"
    },
    also_measured_no_verdict: {
      absence_vs_failure: {
        condition: "06",
        question: "Can a consumer tell 'the lookup failed' from 'the lookup found nothing'?",
        source: "Federico Blanco Sanchez-Llanos, \"The Mould, Not the Letter\", 2026-08-20",
        method: "Structural, name-independent: does a tool's declared outputSchema contain a boolean, or an enum with 2+ values, where a read-succeeded / read-failed / nothing-matched state could live. Read from tools/list; nothing is executed.",
        verdict: "none. A disclosed number, not a pass or fail. Nearly all of the field cannot do this, so a threshold would only condemn; and a schema is a declaration, not behaviour. Reported per verdict under the top-level key absence_vs_failure, with the field names that produced each pass so a reader can check the false positives.",
        self_applied: "This gate's own get_conditions tool fails the test ,  it takes no arguments and has no read that can fail ,  and that is left standing rather than papered over."
      },
      canonicalization: {
        condition: "07",
        question: "Can an independent party recompute the fingerprint of this server's declared surface, byte for byte, without us?",
        method: "RFC 8785 (JCS) over the tool manifest from tools/list. Nothing is executed and no content is judged. A surface that cannot be canonicalized has no fingerprint a third party can reproduce, so a silent change to it can only be caught by whoever made it.",
        verdict: "none. A disclosed measurement, not a pass or fail, and it never turns a row red. That promise was published on 2026-08-23, before this condition was implemented.",
        self_applied: "Measured before it was applied to anyone else. This gate's own canonicalizer matched 11 of 12 vectors against an independent RFC 8785 implementation on first measurement; the vector it failed produced a hash over a value it had silently altered. Fixed, and 13 vectors are now pinned as a permanent regression test.",
        unsafe_integers: "Integer literals outside the IEEE-754 safe range are detected from the response source text, not from the parsed number, and a surface carrying one has its fingerprint withheld. RFC 7493, the profile RFC 8785 builds on, excludes them, and a runtime with arbitrary-precision integers would read them as different values, so no cross-language hash over them is reproducible.",
        retracted_limitation: "On the morning of 2026-08-23 this gate published that the case was undetectable in JavaScript. That was wrong, and wrong in the direction that excused us. JSON.parse exposes the source text of each literal to a reviver. Detection was implemented the same day. The false claim is kept on the record rather than deleted.",
        vectors: CONFORMANCE_URL
      }
    },
    tiers: {
      [CONFIG.tier_pass]: "Free. Conformance and disclosure verified. No price validation.",
      "verified_plus_data": "Paid. Figures traced to a third-party obtainable primary source.",
      "yakumo_partner": "Paid. Dedicated MCP server, operations, audit log."
    },
    operator: "The HORIZONs Co., Ltd. / HORIZON SHIELD",
    self_applied: "This gate is itself subject to these conditions."
  };
}

// ---- 公開履歴と自動再測定 ----
// 「測定が変われば緑ではなくなる」と公開ページに書いた以上、誰かが測り直さねばならない。
// ここがその実装。記録するのは公開判定のみで、申請者の秘密も顧客データも持たない。

// KV が無い環境でも動く。履歴が無効になるだけで、判定機能そのものは影響を受けない。
const HISTORY_MAX = 30;   // 1エンドポイントあたりの保持件数
const CHANGES_MAX = 50;   // 変化ログの保持件数

// ---- 監視レジストリと通知 ----
// 判定は無料と有料で完全に同一。値段が付くのは「測る頻度」と「変化を知らされるか」だけ。
// 判定そのものを売った時点で中立性が死ぬので、そこには決して値段を付けない。
const REGISTRY_KEY = "watch:registry";
const REGISTRY_MAX = 500;
const MAX_PER_SWEEP = 9;         // 1本あたり最悪 1(init)+3(tools/listページ)+1(card)=5。9×5=45 ≤ 50(Free枠)
const FREE_INTERVAL_DAYS = 7;    // 無料層は週1回
const NOTIFY_TIMEOUT_MS = 5000;

async function readRegistry(env) {
  if (!env || !env.HS_VERIFY_KV) return {};
  try { return (await env.HS_VERIFY_KV.get(REGISTRY_KEY, "json")) || {}; }
  catch (_e) { return {}; }
}

async function writeRegistry(env, reg) {
  if (!env || !env.HS_VERIFY_KV) return false;
  try { await env.HS_VERIFY_KV.put(REGISTRY_KEY, JSON.stringify(reg)); return true; }
  catch (_e) { return false; }
}

async function readSweepLast(env) {
  if (!env || !env.HS_VERIFY_KV) {
    return { ran: false, note: "History storage is not bound on this deployment." };
  }
  try {
    const v = await env.HS_VERIFY_KV.get("sweep:last", "json");
    if (v) return v;
  } catch (_e) {}
  return { ran: false, note: "No sweep has completed yet. If the cron is registered, the first run happens at 18:00 UTC." };
}

// 公開の登録簿。watchlist と既存の hist:* を読むだけで、何も測らず、何も保存しない。
// webhook は通知の宛先であって公開情報ではないので、決して出さない。
// 未掲載は不合格ではない。ここで測られたことが無い、それだけを意味する。
// ツール呼び出しの同意。所有者が明示的に依頼したエンドポイントだけをここに入れる。
// determinism は所有者のツールを2回呼ばないと測れず、同意のない呼び出しは絶対にしない。
// だから同意のないサーバーは determinism が not measured のままになり、verified には届かない。
// それは不合格ではなく、測っていないという意味であり、register の応答でもそう説明する。
// 追加は運営者の手作業。所有者からの依頼が無い限り足さない。勝手に足せる経路は用意しない。
const TOOL_CALL_CONSENT = new Set([
  "https://mcp.horizonshield.dev/mcp",
  "https://web.horizonshield.dev/mcp",
  "https://hearing.horizonshield.dev/mcp",
  "https://jidec.horizonshield.dev/mcp",
  "https://gate.horizonshield.dev/mcp",
  // p002 ミネオトーヨー住器。所有者同意 2026-08-18 19:51 LINE「測って下さい。」
  "https://p002.horizonshield.dev/mcp",
  // 自前の試験標的。所有者は我々自身なので同意は自明。
  "https://gate.horizonshield.dev/testbed/i-json/mcp"
]);

// 2026-08-19 patch41. この計器自身の既知の制限。測ったが直せていないものを、黙って回避しない。
const KNOWN_UA_LIMITATION = "Known limitation of this instrument, measured 2026-08-18 and unresolved: requests carrying the Python urllib user agent are refused with 403 by a Cloudflare managed rule in front of this Worker, so that one client is turned away before any code here runs. curl, python-requests, node-fetch, undici, axios, okhttp, Go, Java, Postman and an absent user agent were all measured at 200 on the same day. This is stated here rather than worked around silently.";

// 表示名。運営者が付けた名前であって、測定値ではない。registerの応答でもそう明記する。
// 加盟店の実名は本人の書面同意が取れてから入れる。それまでは掲載準備中。
const OPERATOR_LABELS = {
  "https://mcp.horizonshield.dev/mcp":     { ja: "KIRA\u9069\u6b63\u8a3a\u65ad", en: "KIRA fair price audit (the flagship MCP server)", url: "https://shield.the-horizons-innovation.com" },
  "https://web.horizonshield.dev/mcp":     { ja: "KIRA\u76f8\u8ac7\u7a93\u53e3", en: "KIRA intake desk for renovation questions", url: "https://shield.the-horizons-innovation.com" },
  "https://hearing.horizonshield.dev/mcp": { ja: "YAKUMO\u52a0\u76df\u5e97\u30c7\u30a3\u30ec\u30af\u30c8\u30ea", en: "YAKUMO verified contractor directory", url: "https://shield.the-horizons-innovation.com/yakumo/" },
  "https://gate.horizonshield.dev/mcp":    { ja: "\u691c\u8a3c\u30b2\u30fc\u30c8\uff08\u3053\u306e\u691c\u67fb\u6a5f\u81ea\u8eab\uff09", en: "The verification gate, measuring itself", url: "https://shield.the-horizons-innovation.com/verify-directory/" },
  "https://jidec.horizonshield.dev/mcp":   { ja: "JIDEC \u516c\u958b\u691c\u8a3c\u53f0\u5e33", en: "JIDEC, the Bitcoin anchored public ledger", url: "https://ledger.horizonshield.dev/llms.txt" },
  "https://p001.horizonshield.dev/mcp":    { ja: "\u30ea\u30d5\u30a9\u30fc\u30e0\u8077\u4eba\u682a\u5f0f\u4f1a\u793e\uff08\u52a0\u76dfNo.001\uff09", en: "Reform Shokunin Co., Ltd. (member No.001, Aichi)", url: "https://shield.the-horizons-innovation.com/yakumo/no001/" },
  "https://p002.horizonshield.dev/mcp":    { ja: "\u30df\u30cd\u30aa\u30c8\u30fc\u30e8\u30fc\u4f4f\u5668\u682a\u5f0f\u4f1a\u793e\uff08\u52a0\u76dfNo.002\uff09", en: "Mineo Toyo Juki Co., Ltd. (member No.002)" }
};

const REGISTER_JOIN_MAX = 50;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// --- Badge: an operator may display the current verdict on their own site.
// Deliberate: short cache so a green cannot be pinned, and an unlisted endpoint
// is not an error. The badge shows what the register says right now, or nothing.
function badgeSvg(label, status, color) {
  const L = String(label), S = String(status);
  const lw = 8 + L.length * 6.2, sw = 8 + S.length * 6.2, w = lw + sw;
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w.toFixed(0) + '" height="20" role="img" aria-label="' + L + ': ' + S + '">' +
    '<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>' +
    '<rect width="' + w.toFixed(0) + '" height="20" rx="3" fill="#555"/>' +
    '<rect x="' + lw.toFixed(0) + '" width="' + sw.toFixed(0) + '" height="20" rx="3" fill="' + color + '"/>' +
    '<rect x="' + lw.toFixed(0) + '" width="4" height="20" fill="' + color + '"/>' +
    '<rect width="' + w.toFixed(0) + '" height="20" rx="3" fill="url(#s)"/>' +
    '<g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">' +
    '<text x="' + (lw / 2).toFixed(0) + '" y="14">' + L + '</text>' +
    '<text x="' + (lw + sw / 2).toFixed(0) + '" y="14">' + S + '</text></g></svg>';
}

// 2026-08-19 patch54. 渡せるバッジ。
// 20px のシールズ風はサイトに貼る用で、名刺やチラシには小さすぎる。
// こちらは印刷にも耐える大きさで、事業者名とエンドポイントと測定日を入れる。
//
// ★日付を必ず焼き込む理由。
// 公開している約束は「バッジを取り上げる手続きは無い。条件を満たさなくなったら、
// 次のリクエストで緑が描かれないだけ」。ダウンロードされた静止画は、落ちても緑のまま残る。
// それは約束と矛盾する。だから measured の日付と、いまの状態を確かめる URL を焼き込む。
// 「この日はこうだった」なら嘘にならない。
function xmlEsc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function sealSvg(opts) {
  const name = xmlEsc(opts.name || opts.endpoint || "unmeasured endpoint");
  const sub = xmlEsc(opts.sub || "");
  const ep = xmlEsc(opts.endpoint || "");
  const status = String(opts.status || "not listed");
  const when = xmlEsc(opts.when || "");
  const verifyUrl = xmlEsc(opts.verifyUrl || "");
  const green = status === CONFIG.tier_pass;
  const accent = green ? "#34d399" : (status === CONFIG.tier_held ? "#9aa4b2" : "#fbbf24");
  const W = 560, H = sub ? 190 : 176;
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "\u2026" : s);
  // 2026-08-19 patch57. 確認先のURLだけは、絶対に切らない。
  // 印刷したバッジを持っている人にとって、いまの状態を確かめる手段はこの1行しかない。
  // 途中で切れたURLは、確かめられないという点で、URLが無いのと同じ。
  // だから長いときは切るのではなく、字間を詰めて収める。切れることは無い。
  const epRaw = String(opts.endpoint || "");
  const verifyRaw = String(opts.verifyUrl || "");
  const line = (x, y, s, fill, size, maxW, extra) => {
    const est = String(s).length * size * 0.55;
    const squeeze = est > maxW ? ' textLength="' + maxW + '" lengthAdjust="spacingAndGlyphs"' : "";
    return '<text x="' + x + '" y="' + y + '" fill="' + fill + '" font-size="' + size + '"' + (extra || "") + squeeze + '>' + xmlEsc(s) + '</text>';
  };
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" ' +
    'aria-label="MCP conduct ' + xmlEsc(status) + ' for ' + name + ', measured ' + when + '">' +
    '<rect width="' + W + '" height="' + H + '" rx="14" fill="#0b0b0e"/>' +
    '<rect x="0.5" y="0.5" width="' + (W - 1) + '" height="' + (H - 1) + '" rx="13.5" fill="none" stroke="rgba(255,255,255,.10)"/>' +
    '<rect x="0" y="0" width="6" height="' + H + '" rx="3" fill="' + accent + '"/>' +
    '<g font-family="Inter,Helvetica,Arial,sans-serif">' +
    '<text x="28" y="34" fill="#6f6f7a" font-size="11" letter-spacing="2.4">HORIZON SHIELD</text>' +
    '<text x="28" y="64" fill="' + accent + '" font-size="21" font-weight="700">MCP conduct ' + xmlEsc(status) + '</text>' +
    line(28, 92, String(opts.name || opts.endpoint || "unmeasured endpoint"), "#f4f4f5", 15, 462, ' font-weight="600"') +
    (sub ? line(28, 112, String(opts.sub || ""), "#a9a9b3", 11.5, 462) : "") +
    line(28, (sub ? 136 : 122), epRaw, "#6f6f7a", 10.5, 504, ' font-family="ui-monospace,Menlo,monospace"') +
    line(28, (sub ? 156 : 142), "measured " + String(opts.when || ""), "#6f6f7a", 10.5, 240) +
    line(28, (sub ? 174 : 160), "verify at " + verifyRaw, "#8a8a95", 10.5, 504) +
    '</g>' +
    '<g transform="translate(' + (W - 62) + ',26)">' +
    '<circle cx="18" cy="18" r="17" fill="none" stroke="' + accent + '" stroke-width="2" opacity="' + (green ? "1" : ".45") + '"/>' +
    (green ? '<path d="M10 18.5 L16 24 L26 12" fill="none" stroke="' + accent + '" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>' : '') +
    '</g></svg>';
}

// --- Per endpoint permalink. One citable URL per measured server.
// /e/{host}{path} reconstructs the endpoint. Unlisted returns 404 on purpose:
// we do not mint an empty page for an endpoint nobody has measured.

// ---- 機械が依存できるようにするための面 ----
// ここで足しているのは、この登記簿を「人が英語のページを読んで理解する」以外の
// 経路で使えるようにするためのものだけだ。判定そのものには一切影響しない。
// 4行が verified で、その4行が全部こちらのものである、という事実も変わらない。

function openapiDoc(origin) {
  const ok = { description: "OK" };
  const g = (summary, description) => ({ get: { summary, description, responses: { "200": ok } } });
  return {
    openapi: "3.1.0",
    info: {
      title: "MCP conduct register",
      version: CONFIG.version,
      description:
        "A register of measured conduct for MCP endpoints. Five stated conditions are measured on a schedule. " +
        "A condition that could not be measured is never counted as a pass, including for the operator of this gate. " +
        "Read only. No account, no key, no fee. Every verdict carries a SHA-256 that a stranger can recompute.",
      license: { name: "MIT", url: "https://opensource.org/licenses/MIT" },
      contact: { url: "https://shield.the-horizons-innovation.com/verify-directory/" }
    },
    servers: [{ url: origin }],
    paths: {
      "/register": g("Every row in the register", "Rows are scheduled measurements, not endorsements. An endpoint that is absent has simply never been measured."),
      "/verified.json": g("Only the rows that passed every measured condition", "A schema.org Dataset. Returns zero rows when zero rows pass. The bar is not lowered to avoid an empty list."),
      "/history": g("Past measurements for one endpoint", "Query with ?endpoint=. Records are appended, never edited."),
      "/changes": g("State changes only", "A change means a condition flipped, not merely that a new verdict was issued."),
      "/feed.xml": g("The same changes as an Atom feed", "For subscribing rather than polling."),
      "/sitemap.xml": g("One URL per measured endpoint", "Only endpoints that have actually been measured appear. No page is minted for an endpoint nobody has measured."),
      "/e/{host}{path}": g("The permanent page for one measured endpoint", "Carries the verdict, the time it was taken, the SHA-256 of the record, and the command to recompute it. 404 when the endpoint has never been measured."),
      "/badge": g("A badge drawn from the register at request time", "Query with ?endpoint=. Short cache, so a green cannot be kept up after the row stops being green."),
      "/badge/seal": g("A larger badge, sized for print and for other people's sites", "Query with ?endpoint=. Carries the operator label, the endpoint, the measurement date and the verify URL. Add download=1 to receive it as a file. A downloaded file is a snapshot: the date is drawn into the image for exactly that reason, and the live row remains the only current statement."),
      "/spec": g("The five conditions, stated in full", "Includes what a pass does not mean."),
      "/self": g("This gate measured against its own conditions", "It does not currently pass all of them, and the reason is published."),
      "/health": g("Liveness and the deployed commit", ""),
      "/recompute": {
        post: {
          summary: "Work out which canonicalization reproduces a claimed hash",
          description:
            "Send a JSON object as it was published, and a SHA-256 somebody claims was taken over it. " +
            "Returns every recipe that reproduces the value, whether that recipe is RFC 8785 JCS, how many " +
            "combinations were tried, and the exact space they covered. A hash that could not be reproduced " +
            "is reported as not reproduced with the number of combinations tried, and never as invalid. " +
            "Omit the claimed hash to receive canonical forms and their hashes instead, so a reading can be " +
            "held by someone who does not operate the source. Contacts nothing. Stores nothing.",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", required: ["object"], properties: {
              object: { type: "object", description: "The JSON object as published." },
              claimed: { type: "string", description: "Optional. 64 hex characters. Omit to receive canonical forms." },
              max_candidates: { type: "integer", description: "Optional upper bound on combinations tried." }
            } } } }
          },
          responses: { "200": ok }
        }
      },
      "/verify-event": {
        post: {
          summary: "Recompute a NIP-01 event id and verify its BIP340 signature",
          description:
            "Computed here from the curve parameters, with no library and no network call, so neither the " +
            "issuer's own verification service nor a dependency has to be trusted. For each field name given, " +
            "the answer states whether it sits inside the signed bytes or beside them. A valid signature shows " +
            "that the holder of the key signed those bytes. It does not make the bytes true.",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", required: ["event"], properties: {
              event: { type: "object", description: "A complete signed event with id, pubkey, created_at, kind, tags, content and sig." },
              assert_inside: { type: "array", items: { type: "string" }, description: "Optional field names to locate inside the signed bytes. Both content and tags are searched, and the answer says which one carried the field." }
            } } } }
          },
          responses: { "200": ok }
        }
      },
      "/mould": g("Mould records. What class of assumption a fix came from, where the author searched for it, and what they found. A record with an empty search is published as such.", ""),
      "/sweep/last": g("When the last scheduled re-measurement ran", ""),
      "/watchlist": g("Endpoints scheduled for re-measurement", ""),
      "/.well-known/agent-card.json": g("A2A agent card for this gate", ""),
      "/.well-known/mcp-register.json": g("Machine readable summary of the register", ""),
      "/check": {
        post: {
          summary: "Measure one endpoint now",
          "x-known-limitation": KNOWN_UA_LIMITATION,
          description:
            "Measures the stated conditions against the endpoint you name. Determinism stays unmeasured unless the owner has recorded consent, " +
            "because measuring it requires calling a tool on someone else's server.",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", required: ["endpoint"], properties: {
              endpoint: { type: "string", format: "uri", description: "The MCP endpoint to measure." },
              allow_tool_call: { type: "boolean", description: "Only the owner of the endpoint may set this true." }
            } } } }
          },
          responses: { "200": ok }
        }
      },
      "/mcp": {
        post: { summary: "The same register over MCP", description: "Streamable HTTP, JSON-RPC 2.0.", responses: { "200": ok } }
      }
    }
  };
}

function sitemapXml(origin, rows) {
  const seen = new Set();
  const urls = [];
  urls.push({ loc: "https://shield.the-horizons-innovation.com/verify-directory/", pri: "1.0", freq: "daily" });
  urls.push({ loc: "https://shield.the-horizons-innovation.com/verify-directory/recompute/", pri: "0.9", freq: "weekly" });
  for (const r of rows) {
    if (!r || !r.endpoint) continue;
    const loc = encodeURI(origin + "/e/" + String(r.endpoint).replace(/^https?:\/\//, ""));
    if (seen.has(loc)) continue;
    seen.add(loc);
    const at = (r.latest && r.latest.at) ? String(r.latest.at).slice(0, 10) : "";
    urls.push({ loc: loc, pri: "0.8", freq: "daily", mod: at });
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) =>
      "  <url><loc>" + esc(u.loc) + "</loc>" +
      (u.mod ? "<lastmod>" + esc(u.mod) + "</lastmod>" : "") +
      "<changefreq>" + u.freq + "</changefreq><priority>" + u.pri + "</priority></url>"
    ).join("\n") +
    "\n</urlset>\n";
}

function atomFeed(origin, changes) {
  const list = changes.slice().reverse().slice(0, 50);
  const newest = list.length && list[0].at ? String(list[0].at) : "1970-01-01T00:00:00Z";
  const entries = list.map((c) => {
    const ep = String(c.endpoint || "unknown");
    const at = String(c.at || newest);
    const path = encodeURI(origin + "/e/" + ep.replace(/^https?:\/\//, ""));
    const id = path + "#" + encodeURIComponent(at);
    const title = ep + ": " + String(c.status_from || "unmeasured") + " to " + String(c.status_to || "unknown");
    const body =
      "Condition changes: " + String(c.summary || "not recorded") + ". " +
      "Reachable at the time of measurement: " + (c.reachable === true ? "yes" : (c.reachable === false ? "no" : "not measured")) + ". " +
      "This entry records that a condition flipped. It is not a statement about the operator.";
    return "  <entry>\n" +
      "    <title>" + esc(title) + "</title>\n" +
      "    <id>" + esc(id) + "</id>\n" +
      "    <updated>" + esc(at) + "</updated>\n" +
      '    <link rel="alternate" href="' + esc(path) + '"/>\n' +
      "    <summary>" + esc(body) + "</summary>\n" +
      "  </entry>";
  }).join("\n");
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<feed xmlns="http://www.w3.org/2005/Atom">\n' +
    "  <title>MCP conduct register: state changes</title>\n" +
    "  <subtitle>A change means a condition flipped, not merely that a new verdict was issued.</subtitle>\n" +
    "  <id>" + esc(origin + "/feed.xml") + "</id>\n" +
    '  <link rel="self" href="' + esc(origin + "/feed.xml") + '"/>\n' +
    '  <link rel="alternate" href="https://shield.the-horizons-innovation.com/verify-directory/"/>\n' +
    "  <updated>" + esc(newest) + "</updated>\n" +
    (entries ? entries + "\n" : "") +
    "</feed>\n";
}

function securityTxt(origin) {
  return [
    "Contact: mailto:contact@the-horizons-innovation.com",
    "Preferred-Languages: en, ja",
    "Canonical: " + origin + "/.well-known/security.txt",
    "Policy: https://shield.the-horizons-innovation.com/verify-directory/",
    "",
    "# This service publishes verdicts about other people's servers.",
    "# If a verdict here is wrong, that is a security problem, not a support ticket.",
    "# Send the endpoint, what you measured, and from where. A report that contradicts",
    "# our own measurement is the most useful kind, and it will be published either way."
  ].join("\n") + "\n";
}

function endpointPage(origin, row) {
  const ep = esc(row.endpoint);
  const st = esc((row.latest && row.latest.status) || "no measurement yet");
  const at = esc((row.latest && row.latest.at) || "");
  const sha = (row.latest && row.latest.record_sha256) || "";
  const self = origin + "/e/" + row.endpoint.replace(/^https?:\/\//, "");
  const label = row.operator_label ? esc(row.operator_label) : "";
  const why = row.why_not_verified ? esc(row.why_not_verified) : "";
  const surf = (row.latest && row.latest.surface) || null;
  const toolCount = surf && surf.tool_hashes ? Object.keys(surf.tool_hashes).length : 0;
  const lsc = row.last_surface_change || null;
  const ld = {
    "@context": "https://schema.org", "@type": "Dataset",
    "@id": self + "#dataset",
    name: "Measured conduct of " + row.endpoint,
    description: "Every scheduled measurement of this MCP endpoint, with the verdict, the time it was taken and the hash of the record. Generated by a script with no editorial input.",
    url: self, license: "https://opensource.org/licenses/MIT", isAccessibleForFree: true,
    isPartOf: { "@id": "https://shield.the-horizons-innovation.com/verify-directory/#dataset" },
    distribution: [{ "@type": "DataDownload", encodingFormat: "application/json", contentUrl: row.history_url }],
    variableMeasured: ["endpoint reachability", "agent card presence", "payer disclosure", "determinism", "record recomputability"]
  };
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + ep + ' : ' + st + ' | MCP conduct register</title>' +
    '<meta name="description" content="Measured conduct of ' + ep + '. Latest verdict ' + st + '.">' +
    '<link rel="canonical" href="' + self + '">' +
    '<meta name="robots" content="index,follow,max-snippet:-1">' +
    '<script type="application/ld+json">' + JSON.stringify(ld) + '</script>' +
    '<style>body{background:#0a0a0a;color:#ddd;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;line-height:1.8;margin:0}' +
    '.w{max-width:760px;margin:0 auto;padding:40px 20px 60px}a{color:#f97316}' +
    'h1{font-size:19px;color:#fff;word-break:break-all;margin:6px 0 18px}' +
    'table{width:100%;border-collapse:collapse;margin:18px 0;font-size:14px}' +
    'th,td{border:1px solid #2a2a2a;padding:9px 11px;text-align:left;vertical-align:top}' +
    'th{background:#141414;color:#f97316;width:34%;font-weight:600}' +
    'pre{background:#141414;border:1px solid #2a2a2a;border-radius:9px;padding:13px;overflow-x:auto;font-size:13px}' +
    '.moved{background:#1a1206;border:1px solid #5a3a12;border-radius:9px;padding:13px 15px;margin:16px 0;font-size:13.5px;color:#f0c98a}' +
    '.moved b{color:#fbbf24}' +
    '.own{background:#0d1411;border:1px solid #234034;border-radius:9px;padding:15px 17px;margin:24px 0 8px;font-size:13.5px}' +
    '.own b{color:#fff}.own ul{margin:10px 0 0;padding-left:18px}.own li{margin:6px 0;color:#c3c3c3}' +
    '.n{color:#8a8a8a;font-size:13px}</style></head><body><div class="w">' +
    '<a href="https://shield.the-horizons-innovation.com/verify-directory/">back to the register</a>' +
    '<h1>' + ep + '</h1>' +
    '<img src="' + origin + '/badge?endpoint=' + encodeURIComponent(row.endpoint) + '" alt="MCP conduct: ' + st + '" height="20">' +
    '<table>' +
    (label ? '<tr><th>operator</th><td>' + label + '</td></tr>' : '') +
    '<tr><th>latest verdict</th><td>' + st + '</td></tr>' +
    '<tr><th>measured at</th><td>' + (at || 'not recorded') + '</td></tr>' +
    '<tr><th>measurements</th><td>' + (row.measurements === null ? 'see history' : row.measurements) + '</td></tr>' +
    '<tr><th>first measured</th><td>' + esc(row.first_at || 'not recorded') + '</td></tr>' +
    '<tr><th>cadence</th><td>' + esc(row.cadence || '') + '</td></tr>' +
    '<tr><th>tool call consent</th><td>' + (row.tool_call_consent ? 'given by the operator' : 'not given') + '</td></tr>' +
    '<tr><th>record sha256</th><td style="word-break:break-all">' + esc(sha || 'none yet') + '</td></tr>' +
    (surf ? '<tr><th>declared surface</th><td>' + esc(String(toolCount)) + ' tool' + (toolCount === 1 ? '' : 's') +
      ', manifest ' + esc(String(surf.manifest_hash || 'withheld')) +
      (surf.canonicalization === 'refused'
        ? '<br><span class="n">fingerprint withheld: this surface cannot be canonicalized, so no third party could reproduce a hash over it</span>'
        : '') + '</td></tr>' : '') +
    '</table>' +
    (lsc ? '<div class="moved"><b>The declared surface last moved on ' + esc(String(lsc.at || 'an unrecorded date')) + '.</b><br>' +
      (lsc.added && lsc.added.length ? 'added: ' + esc(lsc.added.join(', ')) + '<br>' : '') +
      (lsc.removed && lsc.removed.length ? 'removed: ' + esc(lsc.removed.join(', ')) + '<br>' : '') +
      (lsc.definition_changed && lsc.definition_changed.length ? 'definition changed: ' + esc(lsc.definition_changed.join(', ')) + '<br>' : '') +
      '<span class="n">A tool can keep its name and change what it accepts. That breaks the code calling it and breaks no badge, ' +
      'so it is recorded here as a dated fact. The MCP specification treats tool list changes as normal operation. ' +
      'Nothing here says this change was wrong.</span></div>' : '') +
    (why ? '<p class="n">' + why + '</p>' : '') +
    '<p>Recompute this row yourself. Do not take our word for it.</p>' +
    '<pre>curl -s "' + row.history_url + '"</pre>' +
    '<p class="n" style="margin-top:16px">More on this endpoint: ' +
      '<a href="' + row.history_url + '">every measurement, as JSON</a> / ' +
      '<a href="' + origin + '/is-verified?endpoint=' + encodeURIComponent(row.endpoint) + '">one-glance verdict</a> / ' +
      '<a href="https://shield.the-horizons-innovation.com/verify-directory/recompute/">how to recompute a verdict</a> / ' +
      '<a href="' + origin + '/spec">the conditions, in full</a></p>' +
    '<div class="own"><b>Is this your server?</b>' +
      '<ul>' +
      '<li>Appearing here is free and stays free. So is this page, the structured data inside it, and the fact that ' +
        'search engines and agents can read it. <b>None of that is for sale at any price.</b></li>' +
      '<li>Free, on request: correct the operator name shown above, ask to be measured now rather than at the next ' +
        'sweep, or ask not to be measured again. Records already taken stay, because a register that deletes its ' +
        'own past is not a register.</li>' +
      '<li>Paid: measured daily instead of weekly, and told by webhook within the hour when a condition flips or ' +
        'the declared surface moves.</li>' +
      '<li><b>Never for sale:</b> the verdict, the order of this register, and whether you appear in it. Paying buys ' +
        'more measurement of you, sooner. It has never bought a better result, and a paid row that fails is ' +
        'published exactly like a free one that fails.</li>' +
      '</ul></div>' +
    '<p class="n">A green here means every condition that could be measured was measured and passed. It is not a statement that the server is good, safe or correct. Conditions that were not measured are never counted as passes, including for the operator of this register.</p>' +
    '</div></body></html>';
}

async function publicRegister(env) {
  const list = await watchlist(env);
  const rows = [];
  let joined = 0;
  for (const w of list) {
    const row = {
      endpoint: w.endpoint,
      tier: w.tier,
      cadence: w.tier === "free" ? "weekly" : "daily",
      measurements: null,
      first_at: null,
      latest: null,
      history_url: "https://gate.horizonshield.dev/history?endpoint=" + encodeURIComponent(w.endpoint)
    };
    const lbl = OPERATOR_LABELS[w.endpoint];
    if (lbl) row.operator_label = lbl;
    row.tool_call_consent = TOOL_CALL_CONSENT.has(w.endpoint);
    if (!row.tool_call_consent) {
      row.why_not_verified = "The owner has not asked for tool calls, so determinism is not measured and this row cannot reach verified. That is not a failure, it is an unmeasured condition.";
    }
    if (joined < REGISTER_JOIN_MAX) {
      joined++;
      const hist = await readHistory(env, w.endpoint);
      const entries = (hist && Array.isArray(hist.entries)) ? hist.entries : [];
      row.measurements = entries.length;
      row.first_at = entries.length ? (entries[0].at || null) : null;
      const latest = entries.length ? entries[entries.length - 1] : null;
      if (latest) {
        row.latest = {
          at: latest.at || null,
          status: latest.status || null,
          record_sha256: latest.record_sha256 || null,
          surface: latest.surface || null
        };
      }
      // 直近の表面移動を、日付付きで一件だけ持ち上げる。統合を壊す変更はここに出る。
      for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i] && entries[i].surface_change) {
          row.last_surface_change = { at: entries[i].at || null, ...entries[i].surface_change };
          break;
        }
      }
    } else {
      row.note = "not joined with history in this response: over REGISTER_JOIN_MAX (" + REGISTER_JOIN_MAX + "). The history_url works regardless.";
    }
    rows.push(row);
  }
  return {
    count: rows.length,
    max: REGISTRY_MAX,
    gate_commit: gateCommit(),
    note: "The public register. Rows are scheduled measurements, not endorsements. An endpoint that is absent has simply never been measured here; absence is NOT a negative verdict. Webhooks are never published. Every stored verdict carries a record_sha256 you can recompute yourself. The operator_label field is a display name assigned by the operator, not a measurement.",
    join: 'POST /watch with {"endpoint":"https://your-server/mcp"}',
    rows: rows
  };
}

// 無料層は週1回。エンドポイントごとに測る日をずらし、1日に固まらないようにする。
async function isDueToday(endpoint, tier, now) {
  if (tier !== "free") return true;
  const h = await sha256hex(endpoint);
  const bucket = parseInt(h.slice(0, 4), 16) % FREE_INTERVAL_DAYS;
  return Math.floor(now / 86400000) % FREE_INTERVAL_DAYS === bucket;
}

// 変化したときだけ飛ばす。判定は公開されているので、これは「早く知る」ことの対価。
async function notifyChange(target, payload) {
  if (!target || !/^https:\/\//i.test(target)) return { sent: false, reason: "no https webhook" };
  try {
    const res = await withTimeout(fetch(target, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(payload)
    }), NOTIFY_TIMEOUT_MS);
    return { sent: true, status: res.status };
  } catch (e) {
    return { sent: false, reason: String((e && e.message) || e) };
  }
}

// 監視対象の既定値。KV の watch:endpoints があればそちらを使う。
// 2026-08-09 workers.dev から独自ドメインへ。
// 同一アカウント内では扉から workers.dev の兄弟 Worker に届かず、
// 全条件が held のまま記録され続けていた。届く道を作ってから測る。
// **扉自身もここに入れる。** 自分に同じ基準を当てられない物差しは、物差しではない。
const DEFAULT_WATCHLIST = [
  "https://mcp.horizonshield.dev/mcp",
  "https://hearing.horizonshield.dev/mcp",
  "https://web.horizonshield.dev/mcp",
  "https://jidec.horizonshield.dev/mcp",
  "https://p001.horizonshield.dev/mcp",
  "https://p002.horizonshield.dev/mcp",
  "https://gate.horizonshield.dev/mcp"
];

// 既定の自社分、旧来の watch:endpoints、新しい watch:registry を束ねて返す。
// 返すのは {endpoint, tier, webhook} の配列。tier は self / free / paid。
async function watchlist(env) {
  const out = [];
  const seen = new Set();
  const push = (ep, tier, webhook) => {
    if (typeof ep !== "string" || seen.has(ep)) return;
    seen.add(ep);
    out.push({ endpoint: ep, tier: tier, webhook: webhook || null });
  };
  for (const ep of DEFAULT_WATCHLIST) push(ep, "self", null);
  if (env && env.HS_VERIFY_KV) {
    try {
      const legacy = await env.HS_VERIFY_KV.get("watch:endpoints", "json");
      if (Array.isArray(legacy)) for (const ep of legacy) push(ep, "self", null);
    } catch (_e) { /* KV が読めなければ既定値で続ける */ }
  }
  const reg = await readRegistry(env);
  for (const ep of Object.keys(reg)) {
    const r = reg[ep] || {};
    push(ep, r.tier === "paid" ? "paid" : "free", r.webhook || null);
  }
  return out;
}

async function histKey(endpoint) {
  return "hist:" + (await sha256hex(endpoint)).slice(0, 16);
}

function publicReachable(v) {
  // 2026-08-20 gate58: reachable は三択。true / false / null（測っていない）。
  //   これまで `v !== false` で外に出していたので、null と undefined が true になっていた。
  //   門の側で落ちた回（gate_side）は上で null を入れている。そこを潰さない。
  if (v === true) return true;
  if (v === false) return false;
  return null;
}

// 2026-08-20 gate59. 過去のエントリは書き換えない。注記を足す。
//   entry は書いた時点で確定して KV に積まれる（recordHistory が summarise の結果を積む）。
//   だから gate58 より前に書かれた行は、いまも reachable:true のまま残っている。
//   実例: gate.horizonshield.dev/mcp の 2026-08-19T18:00:47.502Z。
//         4条件すべて measured:false（中継に届かなかった）なのに reachable:true。
//   ★消さない。書き換えない。何が書かれていて、なぜ間違いなのかを両方見せる。
const GATE58_FIX_DATE = "2026-08-20";

function entryUnmeasured(e) {
  if (!e || !e.conditions) return false;
  const cs = Object.keys(e.conditions).map((k) => e.conditions[k]);
  if (!cs.length) return false;
  return cs.every((c) => c && c.measured === false);
}

function annotateEntry(e) {
  if (!e || e.reachable !== true || !entryUnmeasured(e)) return e;
  return Object.assign({}, e, {
    reachable_note:
      "This entry stores reachable: true, but every condition on this run says measured: false, so " +
      "reachability was not established on it. Until " + GATE58_FIX_DATE + " the value was written as " +
      "(v !== false), which turned 'not measured' into true. The stored entry is left exactly as written."
  });
}

function annotateEntries(list) {
  return Array.isArray(list) ? list.map(annotateEntry) : list;
}

function annotateHistory(v) {
  if (!v || !Array.isArray(v.entries)) return v;
  const entries = annotateEntries(v.entries);
  const n = entries.filter((e) => e && e.reachable_note).length;
  const out = Object.assign({}, v, { entries: entries });
  if (n > 0) {
    out.correction = {
      at: GATE58_FIX_DATE,
      what: "Entries written before this date stored reachable as (v !== false), so a run where nothing could be measured was recorded as reachable: true.",
      fix: "gate58 made reachable three-valued: true, false, or null when it was not measured. Entries written from this date carry null on such runs.",
      affected_in_this_response: n,
      entries_are_not_edited: "Past entries keep the bytes they were written with. They carry reachable_note instead, so the record shows both what was written and why it was wrong."
    };
  }
  return out;
}

// 状態の指紋。**record_sha256 を使ってはいけない。**
// あれは checked_at を含むので毎回変わり、毎日「変化した」と誤検知する。
// 変化として意味があるのは status と各条件の合否だけ。
function stateFingerprint(record) {
  const checks = record && record.checks ? record.checks : {};
  const parts = Object.keys(checks).sort().map((k) => k + "=" + (checks[k] && checks[k].pass ? "1" : "0"));
  return (record && record.status ? record.status : "unknown") + "|" + parts.join(",");
}

function summarise(record) {
  const checks = (record && record.checks) || {};
  const out = {};
  for (const k of Object.keys(checks)) {
    // **理由を落とさない。** 赤くなった記録に理由が無いと、読み手は誤解しかできない。
    const r = checks[k] && typeof checks[k].reason === "string" ? checks[k].reason : null;
    out[k] = {
      pass: !!checks[k].pass,
      measured: checks[k].measured === false ? false : true,
      transport: checks[k].transport === true,
      reason: r ? r.slice(0, 400) : null
    };
  }
  return {
    at: record.checked_at,
    status: record.status,
    reachable: publicReachable(record.reachable),
    record_sha256: record.record_sha256,
    conditions: out,
    // 表面の指紋。fingerprint には今も入れない ,  表面の移動は条件の flip とは別種の事実だからだ。
    // ただし 2026-08-23 から、別種であることと黙っていてよいことは違うと考えを改めた。
    // 表面が動けば changed になり、通知にも /changes にも載る。MCP 仕様が tools/list の変化を
    // 正常運用と見なしているのはその通りなので、警報ではなく日付付きの事実として出す。
    surface: (checks.mcp_endpoint && checks.mcp_endpoint.detail && checks.mcp_endpoint.detail.surface) || null,
    absence_vs_failure: record.absence_vs_failure ? {
      measured: record.absence_vs_failure.measured === false ? false : true,
      tools_measured: record.absence_vs_failure.tools_measured != null ? record.absence_vs_failure.tools_measured : null,
      discriminating: record.absence_vs_failure.discriminating != null ? record.absence_vs_failure.discriminating : null,
      cannot_distinguish_pct: record.absence_vs_failure.cannot_distinguish_pct != null ? record.absence_vs_failure.cannot_distinguish_pct : null
    } : null,
    fingerprint: stateFingerprint(record)
  };
}

async function recordHistory(env, endpoint, record) {
  if (!env || !env.HS_VERIFY_KV) return null;
  const key = await histKey(endpoint);
  let prev = null;
  try { prev = await env.HS_VERIFY_KV.get(key, "json"); } catch (_e) {}
  const entries = (prev && Array.isArray(prev.entries)) ? prev.entries : [];
  const last = entries.length ? entries[entries.length - 1] : null;
  const entry = summarise(record);

  // 表面が前回と違えば、日付付きの差分をこのエントリ自身に残す。
  // 指標にしない。回数も割合も作らない。何が増え、何が消え、何の définition が変わったか、だけ。
  // 両方 complete のときだけ比較する ,  部分読みとの比較から「削除」を出さない。
  const prevSurface = last && last.surface ? last.surface : null;
  if (entry.surface && prevSurface && entry.surface.complete === true && prevSurface.complete === true
      && entry.surface.manifest_hash !== prevSurface.manifest_hash) {
    const prevT = prevSurface.tool_hashes || {};
    const curT = entry.surface.tool_hashes || {};
    entry.surface_change = {
      added: Object.keys(curT).filter((k) => !(k in prevT)),
      removed: Object.keys(prevT).filter((k) => !(k in curT)),
      definition_changed: Object.keys(curT).filter((k) => (k in prevT) && curT[k] !== prevT[k]),
      note: "The tool surface changed between measurements. This is a dated fact, not a defect: the MCP specification treats tool-list changes as normal operation (notifications/tools/list_changed). Recorded for anyone; judged by no one."
    };
  }

  // 2026-08-23. ここまで、変化の判定は status と5条件の合否だけを見ていた。
  // だから「ツール名はそのまま、inputSchema だけ差し替えた」変更は、5条件を全部通したまま
  // 変化ゼロとして扱われ、通知も出ず /changes にも載らなかった。統合を黙って壊す変更の第一位が、
  // 計算され、履歴に書き込まれ、そのまま誰にも知らされていなかった。
  // 測って保存して黙っているのは、測っていないのとほとんど変わらない。表面の移動も変化に数える。
  const surfaceMoved = !!entry.surface_change;
  const changed = !last || last.fingerprint !== entry.fingerprint || surfaceMoved;
  let lastFlips = [];
  entries.push(entry);
  while (entries.length > HISTORY_MAX) entries.shift();

  try {
    await env.HS_VERIFY_KV.put(key, JSON.stringify({ endpoint, entries }));
  } catch (_e) { /* 書けなくても判定は返す */ }

  // 到達できなかった回が連続で何回続いたか。1回の回線の詰まりで赤い通知を飛ばさない。
  // **誤報を1回でも出した監視に、二度目の金は払われない。**
  let streak = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i] && entries[i].reachable === false) streak++;
    else break;
  }
  const suppressed = entry.reachable === false && streak < CONFIG.unreachable_streak;

  if (changed && last) {
    // 初回は「変化」ではない。前があって違ったときだけ記録する。
    // **何が変わったかを書く。** status だけでは pending -> pending にしかならず、
    // 通知を受け取る側に一番必要な情報が抜ける。
    const flips = [];
    const keys = new Set(Object.keys(last.conditions || {}).concat(Object.keys(entry.conditions || {})));
    for (const k of keys) {
      const before = last.conditions && last.conditions[k] ? last.conditions[k].pass : null;
      const after = entry.conditions && entry.conditions[k] ? entry.conditions[k].pass : null;
      if (before !== after) {
        flips.push({ condition: k, from: before, to: after });
      }
    }
    lastFlips = flips;
    let changes = [];
    try { changes = (await env.HS_VERIFY_KV.get("changes:recent", "json")) || []; } catch (_e) {}
    // 表面の移動を、条件の反転と同じ重さで書く。読み手にとってはこちらの方が実害が早い。
    const sc = entry.surface_change || null;
    const scBits = [];
    if (sc) {
      if (sc.added && sc.added.length) scBits.push(sc.added.length + " tool added");
      if (sc.removed && sc.removed.length) scBits.push(sc.removed.length + " tool removed");
      if (sc.definition_changed && sc.definition_changed.length) {
        scBits.push(sc.definition_changed.length + " tool definition changed (" + sc.definition_changed.slice(0, 3).join(", ") + ")");
      }
    }
    const flipBits = flips.map((f) => f.condition + " " + (f.from ? "pass" : "fail") + " to " + (f.to ? "pass" : "fail"));
    changes.push({
      at: entry.at,
      endpoint,
      status_from: last.status,
      status_to: entry.status,
      conditions_changed: flips,
      surface_changed: sc,
      reachable: publicReachable(entry.reachable),
      unreachable_streak: streak,
      alert_suppressed: suppressed,
      summary: flipBits.concat(scBits).join(", ") || "status changed with no condition flip",
      ...(sc && !flips.length ? {
        note: "The declared surface moved while every condition still passed. A verdict alone would not have shown this, and it is the shape of change that breaks an integration without breaking a badge."
      } : {})
    });
    while (changes.length > CHANGES_MAX) changes.shift();
    try { await env.HS_VERIFY_KV.put("changes:recent", JSON.stringify(changes)); } catch (_e) {}
  }
  // 3回連続で到達不能になった時点で、ちょうど1回だけ鳴らす。
  // 指紋は2回目以降変わらないので、changed だけを見ていると永久に鳴らない。
  const crossed = entry.reachable === false && streak === CONFIG.unreachable_streak;
  return {
    changed: changed && !!last,
    alertable: (changed && !!last && !suppressed) || crossed,
    unreachable_streak: streak,
    entry,
    flips: lastFlips
  };
}

async function readHistory(env, endpoint) {
  if (!env || !env.HS_VERIFY_KV) {
    return { endpoint, entries: [], note: "History storage is not bound on this deployment, so nothing has been recorded yet." };
  }
  const key = await histKey(endpoint);
  try {
    const v = await env.HS_VERIFY_KV.get(key, "json");
    if (v) return annotateHistory(v);
  } catch (_e) {}
  return { endpoint, entries: [], note: "No history recorded for this endpoint yet. It may not be on the watchlist." };
}

async function readChanges(env) {
  if (!env || !env.HS_VERIFY_KV) {
    return { changes: [], note: "History storage is not bound on this deployment." };
  }
  try {
    const v = await env.HS_VERIFY_KV.get("changes:recent", "json");
    return {
      changes: v || [],
      note: "Changes recorded by the scheduled re-measurement. A change means either that a condition flipped, or that the declared tool surface moved. It never means that a fresh verdict was simply issued.",
      why_surface_matters: "A server can keep every tool name, swap what a tool accepts, and still pass all five conditions. That change breaks the code calling it and breaks no badge, so it is reported here with the same weight as a flip. Entries carry surface_changed with the tools added, removed, or redefined.",
      not_a_judgement: "The MCP specification treats tool list changes as normal operation. Nothing here says a change was wrong. It says a change happened, and on what date."
    };
  } catch (_e) {
    return { changes: [], note: "could not read changes" };
  }
}

// 毎日の再測定。**同意のないエンドポイントには allow_tool_call を決して渡さない。**
// 同意済み (TOOL_CALL_CONSENT) だけ determinism まで測る。同意の有無は判定に影響するので、
// 各行の応答に tool_call_consent として開示する。隠れた優遇に見えないようにするためだ。
async function runDailySweep(env, opts) {
  const now = Date.now();
  const force = !!(opts && opts.force);
  const list = await watchlist(env);

  const due = [];
  const skipped = [];
  for (const w of list) {
    if (force || (await isDueToday(w.endpoint, w.tier, now))) due.push(w);
    else skipped.push({ endpoint: w.endpoint, tier: w.tier, reason: "not due today (weekly cadence)" });
  }
  // 上限で落ちた分は必ず記録する。黙って切ると「全部測った」ように読める。
  for (const w of due.slice(MAX_PER_SWEEP)) {
    skipped.push({ endpoint: w.endpoint, tier: w.tier, reason: "over MAX_PER_SWEEP for this run" });
  }
  const run = due.slice(0, MAX_PER_SWEEP);

  const results = [];
  for (const w of run) {
    try {
      const record = await runCheck(w.endpoint, TOOL_CALL_CONSENT.has(w.endpoint));
      const r = await recordHistory(env, w.endpoint, record);
      const changed = !!(r && r.changed);
      const alertable = !!(r && r.alertable);
      let notified = null;
      if (alertable && w.webhook) {
        notified = await notifyChange(w.webhook, {
          event: "conformance_change",
          endpoint: w.endpoint,
          at: r.entry.at,
          status: r.entry.status,
          reachable: publicReachable(r.entry.reachable),
          conditions_changed: r.flips || [],
          surface_changed: (r.entry && r.entry.surface_change) || null,
          history: "/history?endpoint=" + encodeURIComponent(w.endpoint),
          note: "The verdict is free and public. What you are paying for is being told, and being measured daily. " +
            "surface_changed is present when the declared tool surface moved, which can happen while every condition still passes."
        });
      }
      results.push({ endpoint: w.endpoint, tier: w.tier, status: record.status, reachable: publicReachable(record.reachable), changed, surface_changed: (r.entry && r.entry.surface_change) || null, alert_suppressed: changed && !alertable, notified });
    } catch (e) {
      results.push({ endpoint: w.endpoint, tier: w.tier, error: String((e && e.message) || e) });
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  const out = {
    ran: true,
    at: new Date(now).toISOString(),
    watched_total: list.length,
    measured: results.length,
    results,
    skipped
  };
  if (env && env.HS_VERIFY_KV) {
    try { await env.HS_VERIFY_KV.put("sweep:last", JSON.stringify(out)); } catch (_e) {}
  }
  return out;
}

// ---- MCP インターフェース ----
// 扉は HTTP チェッカーであると同時に MCP サーバーでもある。
// MCP クライアントから「このサーバーは適合しているか」を会話中に確かめられる。

// Declared so a consumer can tell, from the contract alone, which answers this
// gate is able to distinguish. Every field named here already existed in the
// objects these tools return ,  nothing about a verdict changes, so a published
// record_sha256 still recomputes to the same value.
const GATE_CONDITIONS_SCHEMA = {
  type: "object",
  description:
    "Deterministic. Takes no arguments, looks nothing up, and returns the same document " +
    "every time. It therefore declares no read-state field, and a structural probe will " +
    "score it as unable to hold the difference between a failed read and an empty one. " +
    "That score is correct and is left standing: this tool has no read to fail. Adding a " +
    "state field it can never use would make the number look better and mean less.",
  properties: { conditions: { type: ["array", "object"] }, not_verified: { type: ["array", "object", "string"] }, tiers: { type: ["array", "object"] } },
  additionalProperties: true,
};
const GATE_CHECK_SCHEMA = {
  type: "object",
  properties: {
    endpoint: { type: "string" },
    reachable: {
      description:
        "Three-valued on purpose (gate58). true = measured and answered. false = measured " +
        "and did not answer. null = NOT MEASURED. null is never to be read as a failing " +
        "endpoint; it means this gate has nothing to say.",
    },
    pass: { type: ["boolean", "null"] },
    conditions: { type: ["array", "object"] },
    record_sha256: { type: "string", description: "Hash of this verdict with record_sha256 and recompute_note removed. Recompute it yourself; verify_verdict does the same arithmetic." },
    recompute_note: { type: "string" },
  },
  additionalProperties: true,
};
const GATE_VERIFY_SCHEMA = {
  type: "object",
  properties: {
    verified: { type: ["boolean", "null"], description: "true = the verdict hashes to its own record_sha256, so it was not altered after issue. false = it was altered. This is a finding about the record, not an error." },
    method: { type: "string" },
    note: { type: "string" },
  },
  additionalProperties: true,
};
const GATE_LOOKUP_SCHEMA = {
  type: "object",
  properties: {
    endpoint: { type: "string" },
    on_register: {
      type: "boolean",
      description:
        "true = this endpoint is on the register. false = the register was READ and this " +
        "endpoint is not on it. If the register could not be read at all, this field is " +
        "not returned: the call comes back as a tool error (isError), because absence and " +
        "not-knowing are different answers.",
    },
    register_size: { type: "number" },
    standing: { type: ["string", "null"] },
    latest: { type: ["object", "null"] },
    means: { type: ["string", "object"] },
    does_not_mean: { type: ["string", "object"] },
  },
  additionalProperties: true,
};
// チャッピ提案①/設計図§3(b): エージェントが「接続前に一目で」読むための crisp な判定形の outputSchema。
// この扉の最新ツールなので、条件06のお手本にする: state の enum が「verified/pending/held/watched/absent」を
// 区別し、照会そのものの失敗は isError(tool error)へ落とす。空(absent)と失敗と合格が同じ値に潰れない。
const GATE_ISVERIFIED_SCHEMA = {
  type: "object",
  description:
    "A one-glance answer for an agent deciding whether to trust an MCP endpoint BEFORE connecting. " +
    "Reads the register only; measures nothing. verified is true ONLY when the latest scheduled " +
    "measurement passed every measured condition; it is null in every other case (pending, held, " +
    "watched, absent), and never false, because this gate calls nothing a failure. The state enum " +
    "says which case it is, so a consumer can tell 'not verified here' apart from 'the lookup failed' " +
    "(that returns as a tool error, isError) and from 'measured and passing'.",
  properties: {
    endpoint: { type: "string" },
    verified: { type: ["boolean", "null"], description: "true = latest measurement passed all measured conditions. null = not established here (see state). Never false: unmeasured or not-yet-passing is not a failure." },
    state: { type: "string", enum: ["verified", "pending", "held", "watched", "absent"], description: "verified = passed all measured conditions. pending = measured but not passing every one (often only because determinism needs the owner's consent). held = could not be reached. watched = on the list, not yet measured. absent = no row here at all." },
    on_register: { type: "boolean" },
    measured_at: { type: ["string", "null"] },
    record_sha256: { type: ["string", "null"], description: "Hash of the latest verdict. Recompute it via recompute_url; no trust in this gate required." },
    recompute_url: { type: "string" },
    conditions: { type: ["object", "null"] },
  },
  additionalProperties: true,
};

const MCP_TOOLS = [
  {
    // **1本目に置くのは意図的。** 引数を取らず、読み取り専用で、毎回同じ結果を返す。
    // 他所の適合チェッカーが1本目を空引数で叩いても、何も壊れず決定論的に応答する。
    name: "get_conditions",
    outputSchema: GATE_CONDITIONS_SCHEMA,
    title: "Get the conformance conditions",
    annotations: { title: "Get the conformance conditions", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description:
      "Return the five conditions this gate measures, what it explicitly does not verify, " +
      "and the tier definitions. Takes no arguments and returns identical output every time. " +
      "Read this before running a check so you know what a verdict does and does not claim.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "check_conformance",
    outputSchema: GATE_CHECK_SCHEMA,
    title: "Check an MCP server for conformance and disclosure",
    annotations: { title: "Check an MCP server for conformance and disclosure", readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    description:
      "Measure a public MCP endpoint against five conditions: it speaks MCP, it publishes an A2A " +
      "agent card, it declares who pays it, identical input returns identical output, and the " +
      "verdict itself can be recomputed by anyone. Free, no key. Conformance and disclosure only; " +
      "this says nothing about whether any figure the checked server returns is correct. " +
      "By default no tool on the checked server is called, so determinism comes back as not " +
      "measured rather than guessed. Set allow_tool_call true only for a server you control.",
    inputSchema: {
      type: "object",
      properties: {
        endpoint: { type: "string", description: "https URL of the MCP endpoint to measure" },
        allow_tool_call: {
          type: "boolean",
          description: "Consent to executing one tool on the checked server, twice, with empty arguments. Only set this for a server you own. Default false."
        }
      },
      required: ["endpoint"],
      additionalProperties: false
    }
  },
  {
    name: "verify_verdict",
    outputSchema: GATE_VERIFY_SCHEMA,
    title: "Recompute a verdict hash without trusting the issuer",
    annotations: { title: "Recompute a verdict hash without trusting the issuer", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description:
      "Take a verdict this gate issued and recompute its record_sha256 independently. Removes " +
      "record_sha256 and recompute_note, serialises the remainder in key order, and hashes it. " +
      "Returns whether the verdict was altered after it was issued. You do not have to trust the " +
      "party that issued the verdict, including this one.",
    inputSchema: {
      type: "object",
      properties: {
        record: { type: "object", description: "The full verdict object as returned by check_conformance or GET /self" }
      },
      required: ["record"],
      additionalProperties: false
    }
  },
  {
    // ★2026-08-14 追加。エージェントが加盟者を引けるようにする。
    //   ここが無いと、レジストリは人間が読むページのままで、
    //   「機械が選ぶ時代のための記録」という主張が自分の実装で裏切られる。
    //   新しい保存はしない。既にある watch:registry と hist:* を読むだけ。
    name: "lookup_server",
    outputSchema: GATE_LOOKUP_SCHEMA,
    title: "Look up an MCP server on this register",
    annotations: { title: "Look up an MCP server on this register", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description:
      "Look up what this register already holds about an MCP endpoint: whether it is watched, how " +
      "often it is re-measured, how many measurements exist, when the first and latest were taken, " +
      "and the latest verdict with the record_sha256 you can recompute yourself. Reads stored " +
      "measurements only. It contacts nothing and measures nothing, so use check_conformance " +
      "for a fresh reading. An endpoint that is absent is reported as absent and that is NOT a " +
      "negative verdict: it means nobody has measured it here, not that it failed.",
    inputSchema: {
      type: "object",
      properties: {
        endpoint: { type: "string", description: "https URL of the MCP endpoint to look up, exactly as it appears on the register" }
      },
      required: ["endpoint"],
      additionalProperties: false
    }
  },
  {
    // ★2026-08-21 追加(チャッピ提案①/設計図§3(b)・§4)。
    //   既存 lookup_server は情報量が多い。エージェントが「接続前に一目で」判断するための
    //   crisp な形が要る、というのが提案の核。lookup_server を投影するだけ。新しい測定も保存もしない。
    //   verified は tier_pass のときだけ true、それ以外は null(pending も held も absent も)。
    //   「載っている=合格」「測っていない=不合格」を絶対に作らない fail-closed。判定は売り物ではない。
    name: "is_verified",
    outputSchema: GATE_ISVERIFIED_SCHEMA,
    title: "One glance: is this MCP server verified, with proof",
    annotations: { title: "One glance: is this MCP server verified, with proof", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description:
      "A single machine-first answer for an agent deciding whether to trust an MCP endpoint BEFORE it " +
      "connects. Returns verified (true only when the latest scheduled measurement passed every measured " +
      "condition; null otherwise, never false), a state enum saying which case it is, measured_at, and a " +
      "record_sha256 with a recompute_url so you can check the verdict without trusting this gate. Reads " +
      "the stored register only: it contacts nothing and measures nothing. Absent and pending are reported " +
      "honestly and are NOT negative verdicts. For a fresh measurement rather than the stored one, use " +
      "check_conformance.",
    inputSchema: {
      type: "object",
      properties: {
        endpoint: { type: "string", description: "https URL of the MCP endpoint to look up, exactly as it appears on the register" }
      },
      required: ["endpoint"],
      additionalProperties: false
    }
  }
];

function mcpText(obj) {
  return { content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] };
}

// Federico Blanco Sanchez-Llanos, "The Mould, Not the Letter", 2026-08-20:
//   never let "the fetch failed" and "the fetch succeeded and found nothing"
//   collapse into the same downstream value.
//
// Measured 2026-08-20. This gate already knew the difference and said it in
// prose ,  lookup_server literally answers "It is not reporting absence, because
// it does not know." But all ten failure payloads rode home in the SUCCESS
// channel: a JSON-RPC result with no isError, carrying {error: "..."} buried in
// a text block. A human reader could tell. A machine consumer, which is exactly
// who this directory is built for, read "the call succeeded".
// The gate that measures other people could not be measured correctly itself.
//
// mcpFail puts a failure where a machine looks for one. mcpOk carries
// structuredContent so a success is readable without parsing prose.
// Neither changes any verdict object, so record_sha256 stays recomputable.
function mcpFail(obj) {
  return {
    content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }],
    isError: true,
  };
}
function mcpOk(obj) {
  const structured = obj && typeof obj === "object" && !Array.isArray(obj) ? obj : { value: obj };
  return {
    content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }],
    structuredContent: structured,
  };
}

async function verifyVerdict(record) {
  if (!record || typeof record !== "object") {
    return { verified: false, reason: "record must be an object" };
  }
  const expected = record.record_sha256;
  if (!expected) {
    return { verified: false, reason: "record has no record_sha256 to check against" };
  }
  const copy = JSON.parse(JSON.stringify(record));
  delete copy.record_sha256;
  delete copy.recompute_note;
  const got = await sha256hex(JSON.stringify(copy));
  return {
    verified: got === expected,
    expected_sha256: expected,
    recomputed_sha256: got,
    method: "Remove record_sha256 and recompute_note, JSON.stringify the remainder in key order, SHA-256.",
    note: got === expected
      ? "record_sha256 matches a recompute of this record. This proves only internal self-consistency (the body hashes to its own stored digest); it is NOT proof of authorship or that this gate issued it ,  anyone can compute the same hash with the public method above. For issuer authenticity/anchoring, rely on the JIDEC ledger, not this unkeyed checksum."
      : "Mismatch. The verdict was altered after it was issued, or it was not issued by this gate. Reject it."
  };
}

// レジストリ照会。**測らない。既に保存されているものを読むだけ。**
// 未登録を「不合格」として返さないことが、この関数のいちばん大事な仕様である。
const LOOKUP_HISTORY_MAX_RETURN = 20;

async function lookupServer(env, endpoint) {
  const wl = await watchlist(env);
  const watched = wl.find((w) => w && w.endpoint === endpoint) || null;
  const reg = await readRegistry(env);
  const regEntry = reg[endpoint] || null;
  const hist = await readHistory(env, endpoint);
  const entries = (hist && Array.isArray(hist.entries)) ? hist.entries : [];
  const latest = entries.length ? entries[entries.length - 1] : null;

  const historyUrl = "https://gate.horizonshield.dev/history?endpoint=" + encodeURIComponent(endpoint);

  if (!watched && !regEntry && !entries.length) {
    return {
      endpoint: endpoint,
      on_register: false,
      register_size: wl.length,
      means:
        "This register holds no measurements for this endpoint.",
      does_not_mean:
        "This is not a verdict and not a blacklist. An absent row means nobody has measured this " +
        "endpoint here, not that it was measured and failed. Do not treat absence as a negative " +
        "signal about the server or the people who run it.",
      how_to_appear:
        "Anyone can add it, including someone who does not own it, because the check is read-only " +
        "and calls no tool: POST https://gate.horizonshield.dev/watch with " +
        "{\"endpoint\":\"" + endpoint + "\"}. Free, weekly re-measurement, no account and no fee.",
      fresh_reading: "Call check_conformance with this endpoint to measure it right now."
    };
  }

  const tier = watched ? watched.tier : (regEntry && regEntry.tier === "paid" ? "paid" : "free");
  return {
    endpoint: endpoint,
    on_register: true,
    tier: tier,
    cadence: tier === "paid" ? "daily" : (tier === "self" ? "daily" : "weekly"),
    added_at: (regEntry && regEntry.added_at) || null,
    alerted_on_change: !!(watched && watched.webhook) || !!(regEntry && regEntry.webhook),
    measurements: entries.length,
    // 監視対象に入っていることと、測られたことは別である。
    // ここを混ぜた瞬間に「載っている=合格」という読み方が生まれる。
    standing: entries.length
      ? "measured"
      : "watched, not yet measured. Being on the watchlist is not a measurement and this gate does not count it as one",
    first_measured_at: entries.length ? entries[0].at : null,
    last_measured_at: latest ? latest.at : null,
    latest: annotateEntry(latest),
    history: annotateEntries(entries.slice(-LOOKUP_HISTORY_MAX_RETURN)),
    history_truncated: entries.length > LOOKUP_HISTORY_MAX_RETURN,
    full_history_url: historyUrl,
    means:
      "A row is a series of measurements taken at stated times, each carrying a record_sha256 you " +
      "can recompute without trusting this gate. The dates are the point: they cannot be created " +
      "retroactively, so a long row is evidence of duration and nothing else can substitute for it.",
    does_not_mean:
      "Not a certificate, and not a statement that any figure this server returns is correct. This " +
      "measures conduct and disclosure only. A passing row stops passing when the measurement does, " +
      "and a condition recorded as not measured is never counted as a pass, including for the " +
      "gate itself, whose own verdict currently reads pending."
  };
}

// crisp な判定形。lookupServer を投影するだけ。測らない・保存しない・課金しない。
// verified は tier_pass のときだけ true。それ以外は必ず null(never false)。
// pending は「測ったが全条件は通っていない」で、多くは determinism が同意なしで未測定なだけ。
// これを false にすると「載っている大半が失敗」に見えてしまい中立が死ぬので、null にする。
async function isVerified(env, endpoint) {
  const lu = await lookupServer(env, endpoint);
  const recompute_url = "https://gate.horizonshield.dev/history?endpoint=" + encodeURIComponent(endpoint);
  const base = {
    endpoint: endpoint,
    gate: "MCP Verification Gate",
    gate_commit: gateCommit(),
    recompute_url: recompute_url,
    verified_meaning:
      "true only when the latest scheduled measurement passed every measured condition. In every other " +
      "case verified is null, not false: this gate never labels a server a failure. Read state for which " +
      "case it is, and record_sha256 to recompute the verdict without trusting this gate.",
    not_an_endorsement:
      "A measurement of conduct and disclosure, not a recommendation. verified: true does not mean the " +
      "figures the server returns are correct, that it is safe, or that the business behind it is " +
      "competent. It is not sold, not ranked, and reading it costs the operator nothing."
  };
  if (!lu.on_register) {
    return Object.assign(base, {
      on_register: false, state: "absent", verified: null,
      measured_at: null, record_sha256: null, conditions: null,
      reason: "No measurement exists here for this endpoint. Absence is not a negative verdict.",
      how_to_appear: lu.how_to_appear || null
    });
  }
  const latest = lu.latest || null;
  if (!latest || !lu.measurements) {
    return Object.assign(base, {
      on_register: true, state: "watched", verified: null,
      measured_at: null, record_sha256: null, conditions: null,
      reason: "On the watchlist but not yet measured. Being watched is not a measurement."
    });
  }
  const status = latest.status;
  let state, verified;
  if (status === CONFIG.tier_pass) { state = "verified"; verified = true; }
  else if (status === CONFIG.tier_held) { state = "held"; verified = null; }
  else { state = "pending"; verified = null; }
  let conditions = null;
  if (latest.conditions && typeof latest.conditions === "object") {
    conditions = latest.conditions;
  } else if (latest.checks && typeof latest.checks === "object") {
    conditions = {};
    for (const k of Object.keys(latest.checks)) {
      const c = latest.checks[k];
      conditions[k] = (c && typeof c === "object") ? (c.measured === false ? null : !!c.pass) : null;
    }
  }
  return Object.assign(base, {
    on_register: true,
    state: state,
    verified: verified,
    measured_at: latest.at || latest.checked_at || null,
    record_sha256: latest.record_sha256 || null,
    conditions: conditions,
    absence_vs_failure: latest.absence_vs_failure || null,
    measurements: lu.measurements,
    history_url: lu.full_history_url || recompute_url,
    reason: state === "verified"
      ? "The latest scheduled measurement passed every measured condition."
      : (state === "held"
          ? "The latest attempt could not reach the endpoint, so nothing was established. Not a failure of the server."
          : "Measured, but not currently passing every condition. This is often only because determinism is unmeasured without the owner's consent, which is not a failure. See conditions.")
  });
}

async function handleMcp(body, env) {
  const id = body && body.id;
  const method = body && body.method;

  if (method === "initialize") {
    return {
      jsonrpc: "2.0", id,
      result: {
        protocolVersion: (body.params && body.params.protocolVersion) || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "hs-verify-gate", version: CONFIG.version }
      }
    };
  }
  if (method === "notifications/initialized") return null;
  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: MCP_TOOLS } };
  }
  if (method === "tools/call") {
    const name = body.params && body.params.name;
    const args = (body.params && body.params.arguments) || {};

    if (name === "get_conditions") {
      return { jsonrpc: "2.0", id, result: mcpOk(spec()) };
    }
    if (name === "check_conformance") {
      const endpoint = args.endpoint;
      if (!endpoint || typeof endpoint !== "string") {
        return { jsonrpc: "2.0", id, result: mcpFail({ error: "endpoint_required" }) };
      }
      let parsed;
      try { parsed = new URL(endpoint); }
      catch (_e) { return { jsonrpc: "2.0", id, result: mcpFail({ error: "invalid_url" }) }; }
      if (parsed.protocol !== "https:") {
        return { jsonrpc: "2.0", id, result: mcpFail({ error: "https_required" }) };
      }
      try {
        return { jsonrpc: "2.0", id, result: mcpOk(await runCheck(endpoint, args.allow_tool_call === true)) };
      } catch (e) {
        return { jsonrpc: "2.0", id, result: mcpFail({ error: "check_failed", message: String(e && e.message || e) }) };
      }
    }
    if (name === "verify_verdict") {
      return { jsonrpc: "2.0", id, result: mcpOk(await verifyVerdict(args.record)) };
    }
    if (name === "lookup_server") {
      const endpoint = args.endpoint;
      if (!endpoint || typeof endpoint !== "string") {
        return { jsonrpc: "2.0", id, result: mcpFail({ error: "endpoint_required" }) };
      }
      let parsedLookup;
      try { parsedLookup = new URL(endpoint); }
      catch (_e) { return { jsonrpc: "2.0", id, result: mcpFail({ error: "invalid_url" }) }; }
      if (parsedLookup.protocol !== "https:") {
        return { jsonrpc: "2.0", id, result: mcpFail({ error: "https_required" }) };
      }
      if (!env || !env.HS_VERIFY_KV) {
        return { jsonrpc: "2.0", id, result: mcpFail({
          endpoint: endpoint,
          error: "storage_unavailable",
          note: "History storage is not bound on this deployment, so this gate cannot say whether the endpoint is on the register. It is not reporting absence, because it does not know."
        }) };
      }
      try {
        return { jsonrpc: "2.0", id, result: mcpOk(await lookupServer(env, endpoint)) };
      } catch (e) {
        return { jsonrpc: "2.0", id, result: mcpFail({ error: "lookup_failed", message: String(e && e.message || e) }) };
      }
    }
    if (name === "is_verified") {
      const endpoint = args.endpoint;
      if (!endpoint || typeof endpoint !== "string") {
        return { jsonrpc: "2.0", id, result: mcpFail({ error: "endpoint_required" }) };
      }
      let parsedIv;
      try { parsedIv = new URL(endpoint); }
      catch (_e) { return { jsonrpc: "2.0", id, result: mcpFail({ error: "invalid_url" }) }; }
      if (parsedIv.protocol !== "https:") {
        return { jsonrpc: "2.0", id, result: mcpFail({ error: "https_required" }) };
      }
      if (!env || !env.HS_VERIFY_KV) {
        return { jsonrpc: "2.0", id, result: mcpFail({
          endpoint: endpoint, error: "storage_unavailable",
          note: "The register storage is not bound on this deployment, so this gate cannot say whether the endpoint is verified. It is NOT reporting 'not verified', because it does not know."
        }) };
      }
      try {
        return { jsonrpc: "2.0", id, result: mcpOk(await isVerified(env, endpoint)) };
      } catch (e) {
        return { jsonrpc: "2.0", id, result: mcpFail({ error: "lookup_failed", message: String(e && e.message || e) }) };
      }
    }
    return { jsonrpc: "2.0", id, result: mcpFail({ error: "unknown_tool", name }) };
  }
  return { jsonrpc: "2.0", id, error: { code: -32601, message: "method not found: " + method } };
}

// ---- 扉自身のエージェントカード ----
// 標準を提案する側が、その標準を満たしていなければ意味がない。
function ownAgentCard(origin) {
  return {
    name: "MCP Verification Gate",
    description:
      "Checks whether an MCP server exists, publishes an agent card, discloses who pays it, " +
      "and returns identical output for identical input. Free. Conformance and disclosure only; " +
      "this gate does not verify that any price returned by a checked server is correct.",
    url: origin,
    provider: { organization: "The HORIZ\u97f3s Co., Ltd." },
    version: CONFIG.version,
    protocolVersion: "0.2.0",
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["text"],
    defaultOutputModes: ["text"],
    // 扉が申請者に要求するのと同じ形式で、扉自身の報酬構造を宣言する。
    compensation: {
      paid_by: "buyer",
      referral_fee: false,
      listing_fee: false,
      success_fee_pct: 0,
      disclosure_url: "https://shield.the-horizons-innovation.com/yakumo/plans/"
    },
    preferredTransport: "JSONRPC",
    skills: [
      {
        id: "check",
        name: "Conformance check",
        description: "POST /check with an MCP endpoint URL, or call the check_conformance tool over MCP at /mcp. Returns a verdict with a recomputable SHA-256.",
        tags: ["mcp", "verification", "conformance", "disclosure"]
      },
      {
        id: "verify",
        name: "Verdict verification",
        description: "Recompute the SHA-256 of a verdict this gate issued, so you do not have to trust the issuer. Available as the verify_verdict tool over MCP.",
        tags: ["verification", "tamper-evident", "recomputable"]
      }
    ]
  };
}

// ---- 自己検証 ----
// ネットワークを経由せず、扉自身の公開物を内部で読んで判定する。
// 同一アカウントのWorker間呼び出しがエッジで遮断される環境でも成立する。
async function selfCheck(origin) {
  const card = ownAgentCard(origin);
  const checks = {};

  checks.agent_card = {
    pass: !!(card.name && card.description),
    reason: card.name && card.description
      ? "agent-card published and well-formed"
      : "agent-card incomplete",
    detail: { url: origin + "/.well-known/agent-card.json", name: card.name }
  };

  checks.compensation_disclosure = checkCompensation(card);

  // 扉は数値を返さないため、価格の決定論性ではなく判定の決定論性を示す。
  const a = await runSpecDigest();
  const b = await runSpecDigest();
  checks.determinism = {
    pass: a === b,
    reason: a === b
      ? "the published spec and verdict format are stable across reads"
      : "spec digest changed between reads",
    detail: { spec_sha256: a }
  };

  // 扉は MCP サーバーではないため、条件1は対象外であることを明示する(隠さない)。
  // この扉は MCP サーバーでもあるので、条件1は該当する。
  // ただし同一アカウント制約で自分自身に到達できないため、自分では測れない。
  // 「対象外」と書くのは嘘になるので、測れないことをそのまま書く。
  checks.mcp_endpoint = {
    // 測っていない条件を pass にはしない。/check が他人に適用しているのと同じ扱い。
    // これ一個で扉の総合判定が verified になっていた。自分にだけ甘い物差しは物差しではない。
    pass: false,
    measured: false,
    reason:
      "not measured: this gate now speaks MCP at /mcp, so the condition applies to it. It cannot " +
      "reach itself over the network from inside its own account, so it has not measured this, " +
      "and it does not count an unmeasured condition as a pass. That is the same rule this gate " +
      "applies to every other server it checks. Point another checker at /mcp from outside and " +
      "the claim is either confirmed or destroyed.",
    detail: {
      applicable: true,
      self_measured: false,
      mcp_endpoint: origin + "/mcp",
      http_endpoints: ["/check", "/is-verified", "/spec", "/self", "/health"]
    }
  };

  const passed = Object.values(checks).every((r) => r.pass);
  const record = {
    gate: "MCP Verification Gate",
    gate_version: CONFIG.version,
    gate_commit: gateCommit(),
    subject: "the gate itself",
    endpoint: origin,
    checked_at: new Date().toISOString(),
    status: passed ? CONFIG.tier_pass : CONFIG.tier_fail,
    scope_note:
      "The gate applies its own conditions to itself. Where a condition does not apply, that is " +
      "stated explicitly rather than skipped silently.",
    checks: checks
  };
  const canonical = JSON.stringify(record);
  record.record_sha256 = await sha256hex(canonical);
  record.recompute_note =
    "Remove record_sha256 and recompute_note, JSON.stringify the remainder in this key order, " +
    "take the SHA-256, and it must equal record_sha256.";
  return record;
}

async function runSpecDigest() {
  return await sha256hex(JSON.stringify(spec()));
}

export default {
  // Cron Trigger。毎日の再測定。
  // 「測定が変われば緑ではなくなる」と公開した以上、測り直す者が要る。
  async scheduled(event, env, ctx) {
    GATE_ENV = env;
    GATE_CONTEXT = "cron";
    ctx.waitUntil(runDailySweep(env));
  },

  async fetch(request, env, ctx) {
    GATE_ENV = env;
    GATE_CONTEXT = "http";
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS プリフライト。ブラウザからの POST /check は content-type で preflight が飛ぶ。
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // --- 正規化の試験標的 (condition 07 の陽性側) ---
    // 2026-08-23。この日の朝、我々は「2^53超の整数は JavaScript では検出できない」と公開し、
    // 昼に撤回して検出を実装した。撤回だけでは足りない。陰性(clean)しか本番で見せられないなら、
    // 検出が本当に働くかは我々の自己申告になる。だから、わざと違反する標的を本番に置く。
    //
    // 本文は文字列として組む。JSON.stringify に通すと 9007199254740993 が ...992 に丸まり、
    // この試験の主役そのものが消える。ここだけは手で組まねばならない。
    //
    // 誰でも自分の正規化をここに当てられる。合否も課金も記録も無い。
    if (path === "/testbed/i-json" || path === "/testbed/i-json/mcp") {
      const H = { ...JSON_HEADERS, "Cache-Control": "no-store", ...CORS_HEADERS };

      if (request.method === "GET") {
        return json({
          service: "wedjat-testbed-i-json",
          purpose:
            "A deliberate torture test for JSON canonicalization, kept running in production so that the " +
            "positive case can be reproduced by anyone, including against us. The tool manifest served here " +
            "carries the integer literal 9007199254740993, which no IEEE-754 double can hold. A canonicalizer " +
            "that reads it with JSON.parse and never looks at the source text will silently see " +
            "9007199254740992 and publish a hash over a value that never arrived. RFC 7493, the profile RFC " +
            "8785 builds on, excludes such integers for exactly this reason.",
          why_it_exists:
            "On the morning of 2026-08-23 this gate published that the case was undetectable in JavaScript. " +
            "That was wrong and was retracted the same day. A retraction that cannot be tested is just a " +
            "second claim, so the test target is public.",
          how_to_use: {
            through_this_gate:
              "POST /check {\"endpoint\":\"https://gate.horizonshield.dev/testbed/i-json/mcp\",\"allow_tool_call\":true} " +
              "and read canonicalization.unsafe_integer_scan",
            against_your_own:
              "POST here with a JSON-RPC body of {\"method\":\"tools/list\"} and canonicalize the bytes you " +
              "receive, not the number your parser hands you"
          },
          expected_result: {
            unsafe_integer_scan: "found",
            manifest_hash: null,
            note: "Every hash over the manifest is withheld, and the verdict still does not fail. Condition 07 never turns a row red."
          },
          conformance: CONFORMANCE_URL
        });
      }
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

      bumpUsage(env, ctx, "testbed_hits", null);
      let rb = null;
      try { rb = await request.json(); } catch (_e) { rb = null; }
      const rid = rb && rb.id != null ? JSON.stringify(rb.id) : "1";
      const m = rb && rb.method;

      if (m === "initialize") {
        return new Response(
          '{"jsonrpc":"2.0","id":' + rid + ',"result":{"protocolVersion":"2024-11-05",' +
          '"capabilities":{"tools":{}},"serverInfo":{"name":"wedjat-testbed-i-json","version":"1.0.0"}}}',
          { headers: H });
      }
      if (m === "tools/list") {
        return new Response(
          '{"jsonrpc":"2.0","id":' + rid + ',"result":{"tools":[{' +
          '"name":"declare_unsafe_integer",' +
          '"description":"Declares an integer literal outside the IEEE-754 safe range, on purpose, so that a canonicalizer can be caught rounding it in silence.",' +
          '"inputSchema":{"type":"object","properties":{' +
          '"found":{"type":"boolean","description":"whether the lookup matched anything"},' +
          '"lookup":{"type":"string","enum":["ok","failed","not_found"],"description":"read state, so failure and emptiness stay distinguishable"}},' +
          '"x_unsafe_integer_literal":9007199254740993}}]}}',
          { headers: H });
      }
      if (m === "tools/call") {
        return new Response(
          '{"jsonrpc":"2.0","id":' + rid + ',"result":{"content":[{"type":"text",' +
          '"text":"This testbed is deterministic. It returns this same sentence every time, so that determinism stays measurable while canonicalization deliberately does not."}],' +
          '"isError":false}}',
          { headers: H });
      }
      return new Response(
        '{"jsonrpc":"2.0","id":' + rid + ',"error":{"code":-32601,"message":"method not found on this testbed. It answers initialize, tools/list and tools/call."}}',
        { headers: H });
    }

    // --- mould records. 2026-08-20 mould-ledger / mould-no-key. ---
    // Prompted by Federico Blanco Sanchez-Llanos, "The Mould, Not the Letter".
    // Nothing here measures anyone. It records what the author searched for, and freezes it.
    if (path === "/mould" || path.startsWith("/mould/")) {
      const seg = path.startsWith("/mould/") ? decodeURIComponent(path.slice("/mould/".length)) : "";

      // 鍵の要らない記録口。呼べる内容は「この repo の、このラベルの付いた Issue N を、そのまま刻め」だけ。
      // 本文は gate が GitHub から直接取る。呼び出し側は一文字も持ち込めないので、偽造する余地が無い。
      // 共有の書き込み鍵を配れば、他人の名前で記録を刻める。だから配らない。増やしもしない。
      if (seg === "from-issue") {
        if (request.method !== "POST") {
          return json({ error: "Use POST with a body of {\"issue\": <number>}.", usage: MOULD_USAGE }, 405);
        }
        let ib;
        try { ib = await request.json(); }
        catch (_e) { return json({ error: "The request body was not JSON.", usage: MOULD_USAGE }, 400); }
        const num = Number(ib && ib.issue);
        if (!Number.isInteger(num) || num <= 0) {
          return json({ error: "issue must be a positive integer", usage: MOULD_USAGE }, 400);
        }
        let gh;
        try {
          const r = await fetch("https://api.github.com/repos/" + MOULD_REPO + "/issues/" + num, {
            headers: { "user-agent": PROBE_UA, accept: "application/vnd.github+json" },
          });
          if (r.status === 404) {
            return json({ error: "issue_not_found", issue: num, means: "GitHub does not show this issue. Nothing was recorded." }, 404);
          }
          if (r.status === 403 || r.status === 429) {
            return json({ error: "github_rate_limited", issue: num, means: "This gate reads GitHub without a token, so it shares an anonymous rate limit. Nothing was recorded, and nothing was partially recorded. Retry." }, 503);
          }
          if (!r.ok) return json({ error: "github_unavailable", status: r.status, means: "Nothing was recorded." }, 502);
          gh = await r.json();
        } catch (_e) {
          return json({ error: "github_unreachable", means: "Nothing was recorded." }, 502);
        }
        const labels = (gh.labels || []).map((l) => (typeof l === "string" ? l : (l && l.name) || ""));
        if (!labels.includes(MOULD_LABEL)) {
          return json({
            error: "not_a_mould_record",
            issue: num,
            labels: labels,
            means: "Only an issue carrying the " + MOULD_LABEL + " label in " + MOULD_REPO + " is recorded. " +
                   "This gate reads the label from GitHub, not from whoever called it.",
          }, 422);
        }
        const out = await mouldWrite(env, mouldIssueToBody(gh));
        return json(out.body, out.status);
      }

      if (request.method === "GET") {
        if (seg) {
          const one = await env.HS_VERIFY_KV.get("mould:" + seg, "json");
          if (!one) {
            return json({
              error: "not_found",
              id: seg,
              means: "No record under this id. That is a statement about this ledger, not about any code.",
            }, 404);
          }
          return json(one, 200);
        }
        const idx = (await env.HS_VERIFY_KV.get("mould:index", "json")) || [];
        return json({ ...MOULD_USAGE, count: idx.length, records: idx }, 200);
      }
      if (request.method === "POST") {
        if (!env || !env.SWEEP_TOKEN) return json({ error: "not_configured" }, 503);
        if (!(await ctEqual(request.headers.get("x-sweep-token") || "", env.SWEEP_TOKEN))) {
          return json({ error: "forbidden", usage: MOULD_USAGE }, 403);
        }
        let b;
        try { b = await request.json(); }
        catch (_e) { return json({ error: "The request body was not JSON.", usage: MOULD_USAGE }, 400); }
        const out = await mouldWrite(env, b);
        return json(out.body, out.status);
      }
      return json({ error: "Use GET to read, POST to record.", usage: MOULD_USAGE }, 405);
    }

    // --- recompute and verify-event. Read only, pure computation, nothing stored. ---
    // 外から確かめるための2本。tools/list には出していない。
    if (path === "/recompute") {
      if (request.method === "GET") return json(RECOMPUTE_USAGE, 200);
      if (request.method === "POST") {
        let sent;
        try { sent = await request.json(); }
        catch (_e) { return json({ error: "The request body was not JSON.", usage: RECOMPUTE_USAGE }, 400); }
        const r = await recomputeHandler(sent);
        return json(r.body, r.status);
      }
      return json({ error: "Use GET for usage, or POST to recompute." }, 405);
    }
    if (path === "/verify-event") {
      if (request.method === "GET") return json(VERIFY_EVENT_USAGE, 200);
      if (request.method === "POST") {
        let sent;
        try { sent = await request.json(); }
        catch (_e) { return json({ error: "The request body was not JSON.", usage: VERIFY_EVENT_USAGE }, 400); }
        const r = await verifyEventHandler(sent);
        return json(r.body, r.status);
      }
      return json({ error: "Use GET for usage, or POST to verify a signed event." }, 405);
    }

    // MCP over Streamable HTTP。扉自身を MCP クライアントから呼べるようにする。
    if (path === "/mcp" && request.method === "POST") {
      let body;
      try { body = await request.json(); }
      catch (_e) {
        return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, 400);
      }
      if (Array.isArray(body)) {
        return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "batch not supported" } }, 400);
      }
      const res = await handleMcp(body, env);
      if (res === null) return new Response(null, { status: 202, headers: CORS_HEADERS });
      return json(res);
    }
    if (path === "/mcp" && request.method === "GET") {
      return json({
        ok: true,
        transport: "MCP over Streamable HTTP (JSON-RPC 2.0)",
        usage: "POST JSON-RPC to this URL. methods: initialize, tools/list, tools/call.",
        tools: MCP_TOOLS.map((t) => t.name)
      });
    }

    // 公開履歴。誰でも読める。認証も鍵も要らない。
    if (path === "/history") {
      const ep = url.searchParams.get("endpoint");
      if (!ep) return json({ error: "endpoint_required", usage: "/history?endpoint=https://your-server/mcp" }, 400);
      return json(await readHistory(env, ep));
    }
    if (path === "/changes") return json(await readChanges(env));
    if (path === "/sweep/last") return json(await readSweepLast(env));

    // 公開の登録簿。加盟者の行を、人間もエージェントも一覧で読める。
    if (path === "/register" && request.method === "GET") {
      return json(await publicRegister(env));
    }

    // 通過した行だけ。0件なら0件と返す。空を隠すために基準を緩めることはしない。
    if (path === "/verified.json" && request.method === "GET") {
      const reg = await publicRegister(env);
      const all = Array.isArray(reg.rows) ? reg.rows : [];
      const verified = all.filter((r) => r.latest && r.latest.status === CONFIG.tier_pass);
      return json({
        "@context": "https://schema.org",
        "@type": "Dataset",
        name: "MCP servers that passed every measured condition",
        description: "The subset of the public register whose latest scheduled measurement passed all five conditions, including determinism. Passing means the measured conditions passed on that date, from the vantage that measured them. It does not mean the numbers a server returns are correct, that the business behind it is competent, or that it is safe to use.",
        url: "https://shield.the-horizons-innovation.com/verify-directory/",
        license: "https://opensource.org/licenses/MIT",
        isAccessibleForFree: true,
        updated: new Date().toISOString(),
        gate_commit: gateCommit(),
        verified_count: verified.length,
        register_count: all.length,
        why_the_count_can_be_zero: "Determinism cannot be measured without calling a tool on the server, and this gate never calls a tool without the owner asking for it. A server whose owner has not asked stays unmeasured on that condition and therefore stays short of verified. Unmeasured is not failed.",
        how_to_become_verified: {
          step_1: "Check yourself with consent: POST /check with {\"endpoint\":\"https://your-server/mcp\",\"allow_tool_call\":true}",
          step_2: "If it returns verified, ask the operator to record your consent so the nightly sweep measures the same way.",
          step_3: "The row turns verified on the next sweep, and stays that way only while it keeps passing.",
          note: "Nothing here is bought. The verdict is the measurement."
        },
        badge_for_a_verified_server: {
          where: "your own /.well-known/agent-card.json",
          why: "so an agent reading your card directly learns the record exists without visiting any page we control",
          block: {
            verification: {
              provider: "HORIZON SHIELD verification gate",
              register: "https://gate.horizonshield.dev/register",
              your_history: "https://gate.horizonshield.dev/history?endpoint=<your endpoint>",
              record_sha256: "<the hash of the verdict you are citing>",
              recompute: "Fetch the history, hash the record, compare. No trust in the provider is required."
            }
          },
          honesty_rule: "Publish the block only while the row actually reads verified. If it stops passing, remove it. The register will show the truth either way, so a stale badge only costs you."
        },
        servers: verified.map((r) => ({
          endpoint: r.endpoint,
          name: (r.operator_label && (r.operator_label.en || r.operator_label.ja)) || null,
          status: r.latest.status,
          verified_at: r.latest.at,
          record_sha256: r.latest.record_sha256,
          measurements: r.measurements,
          history_url: r.history_url
        }))
      });
    }

    // 指定したエンドポイント群を一括参照。register を読むだけで、測定はしない。
    // 消費側(読む方)の便宜。無料・中立。運営者(測られる方)には一切課金しない。
    // 新しい判定意味は作らず、既存の中立ロジック lookupServer をそのまま束ねる。
    if (path === "/feed/batch" && request.method === "POST") {
      let fb;
      try { fb = await request.json(); }
      catch (_e) { return json({ error: "POST JSON body {\"endpoints\":[...]}", note: "Reads the register for the endpoints you name. It does not measure them; measurement is POST /check." }, 400); }
      const eps = (fb && Array.isArray(fb.endpoints)) ? fb.endpoints : null;
      if (!eps) return json({ error: "endpoints must be an array of MCP endpoint URLs" }, 400);
      const CAP = 50;
      if (eps.length > CAP) return json({ error: "too many endpoints in one call", cap: CAP, given: eps.length, note: "Split into batches of " + CAP + ". This reads the register only; it does not measure." }, 400);
      const seen = new Set();
      const results = [];
      for (const raw of eps) {
        const ep = String(raw == null ? "" : raw).slice(0, 300).trim();
        if (!ep || seen.has(ep)) continue;
        seen.add(ep);
        results.push(await lookupServer(env, ep));
      }
      return json({
        note: "A read of the public register for the endpoints you named. It does NOT measure them: it returns the latest stored verdict, or that there is none. Absence is not a negative verdict, only the lack of a measurement here. Every result carries a record_sha256 you can recompute without trusting this gate.",
        not_an_endorsement: "This is measurement, not recommendation. It says nothing about whether a listed server is safe or correct to use. It is not sold, not ranked, and not ordered. Being read here costs the operator nothing.",
        to_measure_now: "For a fresh reading rather than the stored one, POST /check with a single endpoint.",
        count: results.length,
        results
      }, 200);
    }

    // 単発の crisp 判定。エージェントが接続前に GET 一発で読む。register を読むだけ・無料・中立。
    // MCP を話せない相手(ブラウザ・素の HTTP クライアント)にも同じ答えを返す。
    if (path === "/is-verified" && request.method === "GET") {
      const ep = url.searchParams.get("endpoint");
      if (!ep) return json({ error: "endpoint_required", usage: "/is-verified?endpoint=https://your-server/mcp", note: "Reads the register. verified is true only for a full pass, null otherwise (never false). It does not measure; a fresh reading is POST /check." }, 400);
      if (!env || !env.HS_VERIFY_KV) return json({ endpoint: ep, error: "storage_unavailable", note: "Register storage is not bound here, so the gate cannot say. This is NOT 'not verified'." }, 503);
      try { return json(await isVerified(env, ep)); }
      catch (e) { return json({ endpoint: ep, error: "lookup_failed", message: String(e && e.message || e) }, 500); }
    }

    // 監視の登録。誰でも自分のエンドポイントを載せられる。判定は変わらない。
    if (path === "/watch" && request.method === "GET") {
      const reg = await readRegistry(env);
      const ep = url.searchParams.get("endpoint");
      if (ep) {
        const r = reg[ep];
        if (!r) return json({ endpoint: ep, registered: false });
        return json({
          endpoint: ep, registered: true, tier: r.tier,
          cadence: r.tier === "paid" ? "daily" : "weekly",
          notified: !!r.webhook, added_at: r.added_at || null
        });
      }
      return json({
        count: Object.keys(reg).length,
        max: REGISTRY_MAX,
        usage: 'POST /watch with {"endpoint":"https://your-server/mcp","webhook":"https://your-endpoint-for-alerts"}',
        note: "Registering changes nothing about the verdict. It changes how often we re-measure, and whether you are told when a condition flips."
      });
    }

    if (path === "/watch" && request.method === "POST") {
      let body;
      try { body = await request.json(); }
      catch (_e) { return json({ error: "invalid_json" }, 400); }
      const ep = body && body.endpoint;
      if (typeof ep !== "string" || !/^https:\/\//i.test(ep)) {
        return json({ error: "endpoint_required", note: "endpoint must be an https URL" }, 400);
      }
      const hook = body ? body.webhook : undefined;
      if (hook !== undefined && hook !== null && (typeof hook !== "string" || !/^https:\/\//i.test(hook))) {
        return json({ error: "webhook_must_be_https" }, 400);
      }
      if (!env || !env.HS_VERIFY_KV) return json({ error: "storage_unavailable" }, 503);
      const reg = await readRegistry(env);
      const prev = reg[ep] || null;
      if (!prev && Object.keys(reg).length >= REGISTRY_MAX) {
        return json({ error: "registry_full", max: REGISTRY_MAX }, 429);
      }
      const admin = !!(env.SWEEP_TOKEN && await ctEqual(request.headers.get("x-sweep-token") || "", env.SWEEP_TOKEN));
      const tier = admin && body.tier === "paid" ? "paid" : ((prev && prev.tier === "paid") ? "paid" : "free");
      reg[ep] = {
        tier: tier,
        webhook: hook === undefined ? ((prev && prev.webhook) || null) : (hook || null),
        added_at: (prev && prev.added_at) || new Date().toISOString()
      };
      const ok = await writeRegistry(env, reg);
      return json({
        ok: ok,
        endpoint: ep,
        tier: tier,
        cadence: tier === "paid" ? "daily" : "weekly",
        notified: !!reg[ep].webhook,
        history: "/history?endpoint=" + encodeURIComponent(ep),
        note: "The verdict is identical for every tier and free to read for anyone. Paying changes the cadence and the alert, never the result."
      });
    }

    // 掃引の手動実行。cron を待たずに測れるようにする。運営のみ。
    if (path === "/sweep" && request.method === "POST") {
      if (!env || !env.SWEEP_TOKEN) {
        return json({ error: "sweep_token_not_configured" }, 503);
      }
      if (!(await ctEqual(request.headers.get("x-sweep-token") || "", env.SWEEP_TOKEN))) {
        return json({ error: "forbidden" }, 403);
      }
      let force = false;
      try { const b = await request.json(); force = !!(b && b.force); } catch (_e) {}
      return json(await runDailySweep(env, { force: force }));
    }
    if (path === "/watchlist") {
      const wl = await watchlist(env);
      return json({
        watched: wl.map((w) => ({
          endpoint: w.endpoint,
          tier: w.tier,
          cadence: w.tier === "free" ? "weekly" : "daily",
          notified: !!w.webhook
        })),
        cadence: "daily for self and paid, weekly for free",
        verdict_is_identical_for_every_tier: true,
        note: "These endpoints are re-measured on a schedule so a verdict on this site does not silently go stale. No tool on any watched server is ever called by the sweep.",
        history: "/history?endpoint=...",
        changes: "/changes"
      });
    }

    if (path === "/badge/seal" && request.method === "GET") {
      const ep = url.searchParams.get("endpoint") || "";
      const reg = await publicRegister(env);
      const row = (Array.isArray(reg.rows) ? reg.rows : []).find((r) => r.endpoint === ep);
      const lb = (row && row.operator_label) || {};
      const status = (row && row.latest && row.latest.status) ? String(row.latest.status) : "not listed";
      const when = (row && row.latest && row.latest.at) ? String(row.latest.at).slice(0, 10) : new Date().toISOString().slice(0, 10);
      const svg = sealSvg({
        name: lb.en || lb.ja || ep || "not listed",
        sub: (lb.en && lb.ja) ? lb.ja : "",
        endpoint: ep,
        status: status,
        when: when,
        // 2026-08-19 patch57. 入口ではなく、この1本の行に直接届く住所にする。
        // 印刷物を見た人に「サイトのどこかから探せ」と言わないため。
        verifyUrl: (function () {
          try { const u = new URL(ep); return "gate.horizonshield.dev/e/" + u.hostname + u.pathname; }
          catch (_e) { return "shield.the-horizons-innovation.com/verify-directory/"; }
        })()
      });
      const dl = url.searchParams.get("download") === "1";
      const host = (() => { try { return new URL(ep).hostname.replace(/[^a-z0-9.-]/gi, ""); } catch (_e) { return "badge"; } })();
      const headers = {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "public, max-age=300, must-revalidate",
        "Access-Control-Allow-Origin": "*"
      };
      if (dl) headers["Content-Disposition"] = 'attachment; filename="mcp-conduct-' + host + '-' + when + '.svg"';
      return new Response(svg, { headers });
    }

    if (path === "/badge" && request.method === "GET") {
      const ep = url.searchParams.get("endpoint") || "";
      let status = "not listed", color = "#9f9f9f";
      if (ep) {
        const reg = await publicRegister(env);
        const row = (Array.isArray(reg.rows) ? reg.rows : []).find((r) => r.endpoint === ep);
        if (row && row.latest && row.latest.status) {
          status = String(row.latest.status);
          color = status === CONFIG.tier_pass ? "#2f9e44" : "#c9820a";
        }
      }
      return new Response(badgeSvg("MCP conduct", status, color), {
        headers: {
          "Content-Type": "image/svg+xml; charset=utf-8",
          "Cache-Control": "public, max-age=300, must-revalidate",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }

    if (path.startsWith("/e/") && request.method === "GET") {
      const rest = path.slice(3).replace(/\/+$/, "");
      const ep = "https://" + rest;
      const reg = await publicRegister(env);
      const row = (Array.isArray(reg.rows) ? reg.rows : []).find((r) => r.endpoint === ep);
      if (!row) {
        return json({
          error: "not on the register",
          endpoint: ep,
          note: "No page is minted for an endpoint nobody has measured. Ask for a measurement and this URL starts working.",
          how_to_join: "https://shield.the-horizons-innovation.com/verify-directory/#listed",
          register: "https://gate.horizonshield.dev/register"
        }, 404);
      }
      return new Response(endpointPage("https://gate.horizonshield.dev", row), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, max-age=300, must-revalidate",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }

    if (path === "/openapi.json") return json(openapiDoc(url.origin));

    if (path === "/sitemap.xml") {
      const reg = await publicRegister(env);
      const rows = Array.isArray(reg.rows) ? reg.rows : [];
      return new Response(sitemapXml(url.origin, rows), {
        headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600", ...CORS_HEADERS }
      });
    }

    if (path === "/feed.xml") {
      const ch = await readChanges(env);
      const list = Array.isArray(ch.changes) ? ch.changes : [];
      return new Response(atomFeed(url.origin, list), {
        headers: { "Content-Type": "application/atom+xml; charset=utf-8", "Cache-Control": "public, max-age=300", ...CORS_HEADERS }
      });
    }

    if (path === "/.well-known/security.txt" || path === "/security.txt") {
      return new Response(securityTxt(url.origin), {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400", ...CORS_HEADERS }
      });
    }

    // OpenAI プラグイン申請のドメイン確認。トークンは env で渡す。
    // 未設定のときに空文字を200で返すと、確認が通ったように見えて通らない。だから404。
    if (path === "/.well-known/openai-apps-challenge") {
      const token = (env && env.OPENAI_APPS_CHALLENGE) || "";
      if (!token) {
        return json({
          error: "not configured",
          note: "This host has no OpenAI apps challenge token set. Nothing is being claimed here."
        }, 404);
      }
      return new Response(token, {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...CORS_HEADERS }
      });
    }

    if (path === "/robots.txt") {
      return new Response("User-agent: *\nAllow: /\nSitemap: " + url.origin + "/sitemap.xml\n", {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400" }
      });
    }

    if (path === "/health") return json({ ok: true, gate_version: CONFIG.version, gate_commit: gateCommit() });
    if (path === "/usage") return json(await usageReport(env, url.searchParams.get("days")));
    if (path === "/spec") { bumpUsage(env, ctx, "spec_hits", null); return json(spec()); }
    if (path === "/.well-known/agent-card.json") return json(ownAgentCard(url.origin));
    if (path === "/.well-known/glama.json") return json({ "$schema": "https://glama.ai/mcp/schemas/connector.json", maintainers: [{ email: "ogasurfproject@gmail.com" }] });
    // A machine that has only the hostname can find the register without being told where
    // to look. Same bytes as /register, plus the statement of what the rows are and are not,
    // shaped so that a crawler which reads nothing else still quotes it correctly.
    if (path === "/.well-known/mcp-register.json" && request.method === "GET") {
      const reg = await publicRegister(env);
      return json({
        "@context": "https://schema.org",
        "@type": "Dataset",
        "@id": "https://github.com/ogasurfproject-jpg/mcp-conduct-register#dataset",
        name: "MCP Conduct Register: measured conduct of Model Context Protocol servers",
        description: "A machine generated record of how MCP servers behaved when measured. Not a curated list, not a ranking, not an endorsement. Rows are produced by a scheduled measurement, not by selection.",
        url: "https://shield.the-horizons-innovation.com/verify-directory/",
        license: "https://opensource.org/licenses/MIT",
        isAccessibleForFree: true,
        creator: {
          "@type": "Organization",
          name: "The HORIZONs Co., Ltd.",
          url: "https://shield.the-horizons-innovation.com/",
          founder: { "@type": "Person", name: "Toshikatsu Oga", identifier: "https://orcid.org/0009-0000-9180-903X" }
        },
        distribution: [
          { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: "https://gate.horizonshield.dev/register" },
          { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: "https://raw.githubusercontent.com/ogasurfproject-jpg/mcp-conduct-register/main/register.json" },
          { "@type": "application/atom+xml", encodingFormat: "application/atom+xml", contentUrl: "https://raw.githubusercontent.com/ogasurfproject-jpg/mcp-conduct-register/main/feed.xml" }
        ],
        rows_are_selected_by: "nobody, the schedule decides what is measured and the code copies the result",
        what_this_does_not_claim: "That a listed server returns correct numbers, that the business behind it is competent, or that it is safe to use.",
        disputes: {
          how: "Measure any listed endpoint yourself and submit the observation to the public ledger under your own name and vantage.",
          intake: "https://ledger.horizonshield.dev/witness",
          operator_veto: "none, the code has no route to refuse a schema valid submission"
        },
        count: reg.count,
        gate_commit: reg.gate_commit,
        rows: reg.rows
      });
    }
    if (path === "/self") return json(await selfCheck(url.origin));

    if (path === "/check" && request.method === "POST") {
      let body;
      try { body = await request.json(); }
      catch (_e) { return json({ error: "invalid_json" }, 400); }
      const endpoint = body && body.endpoint;
      if (!endpoint || typeof endpoint !== "string") {
        return json({ error: "endpoint_required", hint: 'POST {"endpoint":"https://your-server/mcp"}' }, 400);
      }
      let parsed;
      try { parsed = new URL(endpoint); }
      catch (_e) { return json({ error: "invalid_url" }, 400); }
      if (parsed.protocol !== "https:") {
        return json({ error: "https_required" }, 400);
      }
      const own = isOwnZone(endpoint);
      bumpUsage(env, ctx, own ? "own_checks" : "external_checks", own ? null : parsed.hostname);
      try {
        return json(await runCheck(endpoint, body && body.allow_tool_call === true));
      } catch (e) {
        return json({ error: "check_failed", message: String(e && e.message || e) }, 500);
      }
    }

    if (path === "/check" && request.method === "GET") {
      return json({
        ok: true,
        usage: 'POST /check {"endpoint":"https://your-server/mcp"}',
        note: "By default no tool on the checked server is called, so determinism comes back as not measured. Add \"allow_tool_call\": true to measure it, and only do that for a server you control.",
        spec: "/spec"
      });
    }

    return json({ error: "not_found", path, endpoints: ["/mcp", "/check", "/is-verified", "/spec", "/self", "/history", "/changes", "/watchlist", "/watch", "/sweep", "/sweep/last", "/health"] }, 404);
  }
};
