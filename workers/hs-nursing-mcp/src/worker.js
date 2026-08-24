/**
 * hs-nursing-mcp — 訪問看護の内部MCP。
 *
 * ご説明資料でお約束した3つのうち、①内部(請求前チェック・加算の取りこぼし・
 * 指示書の期限管理)に当たる口である。運用開始は2026年10月1日。
 *
 * この口が絶対にしないこと:
 *   ・「算定できます」と言わない。言えるのは
 *     「この加算にはA・B・Cの要件があり、AとBには答えがあり、Cはまだ尋ねていない」まで。
 *     算定の可否をこちらが判定すると、返戻になったときに責任の所在が壊れる。
 *   ・出典の無い数字を出さない。単位数も金額も、必ず出典 id を添えて出す。
 *   ・確認できていないことを、確認できたことのように出さない。
 *     confirmed:false は理由ごと持って出る。空欄と未確認は違う。
 *   ・版が古い数字を、現行の数字として出さない。
 *     令和8年6月に医療・介護の両方が改定された。上書きされた版の数字には
 *     必ず「当て直しが要る」の印を付けて返す。
 *   ・現場の実務を規則として出さない。field_reports は rules.js に入っていない。
 *
 * 規則の中身は src/rules.js にある。あれは生成物で、元は JHNRD である。
 * ここに数字を手で書かない。書けば、公開データベースと内部MCPが別のことを言い始める。
 * そのずれは落ちない。例外も出ない。ただ違う数字が出続ける。
 */

import { RULES, SOURCE_SHA256 } from "./rules.js";

const PROTOCOL_VERSION = "2025-11-25";
const SERVER_NAME = "hs-nursing-mcp";
const SERVER_VERSION = "0.1.0";

/* ------------------------------ 小道具 ------------------------------ */

const S = (v, n = 4000) => (v == null ? "" : String(v)).slice(0, n);

function cors(request) {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Admin-Key, MCP-Protocol-Version, Mcp-Method, Mcp-Name",
    "Access-Control-Max-Age": "86400",
  };
}

function json(body, status, extra) {
  return new Response(JSON.stringify(body, null, 2), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8", ...(extra || {}) },
  });
}

/* ---- 言ってはいけない言い方の門 ----------------------------------------
   データベース側の validate.py と同じ言葉を見る。
   こちらが組み立てた文だけを見る。データベースから持ってきた文(we_do_not_say には
   「算定できます、とは言わない」と書いてある)を見ると、必ず引っかかる。
   見る対象を間違えると、門はいつも赤くなり、やがて外される。 */
const FORBIDDEN = [
  "算定できます", "算定可能です", "算定してください",
  "減算されます", "問題ありません", "大丈夫です", "違反です",
];

function guard(notes) {
  const bad = [];
  for (const n of notes || []) {
    for (const w of FORBIDDEN) {
      if (String(n).includes(w)) bad.push({ word: w, note: S(n, 200) });
    }
  }
  return bad;
}

/* ---- 日付。JST で数える ------------------------------------------------
   利用者の生活も、指示書の期限も、日本の日付で動いている。
   UTC で数えると、日本時間の朝9時までの9時間、前日として扱われる。
   期限の話でその9時間がずれると、切れているものを切れていないと言う。 */
function todayJST(override) {
  if (override && /^\d{4}-\d{2}-\d{2}$/.test(override)) return override;
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

function parseYMD(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ""))) return null;
  const [y, m, d] = String(s).split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  // 2026-02-30 のような日付を、3月2日として黙って受け取らない。
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) {
    return null;
  }
  return t;
}

const dayMs = 86400000;
const fmt = (t) => new Date(t).toISOString().slice(0, 10);
const addDays = (t, n) => t + n * dayMs;

function addMonths(t, n) {
  const d = new Date(t);
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
  const target = new Date(Date.UTC(y, m + n, 1));
  // 月末の扱い。1月31日の6か月後は7月31日。存在しない日はその月の末日に寄せる。
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(day, last));
}

/* ---- 出典を、id ではなく中身で返す -------------------------------------
   id だけ返しても、受け取った側は確かめられない。
   確かめられないものを根拠と呼ばない。 */
function resolveSources(refs) {
  const out = [];
  for (const r of refs || []) {
    const s = RULES.sources[r];
    if (!s) { out.push({ ref: r, missing: true }); continue; }
    out.push({
      ref: r, title: s.title, url: s.url, publisher: s.publisher,
      tier: s.tier, tier_ja: { statute: "告示・通知の原文", agency: "厚生労働省の資料", secondary: "民間の解説" }[s.tier] || s.tier,
      current: s.current,
      not_current_reason: s.not_current_reason || undefined,
      retrieved_at: s.retrieved_at,
    });
  }
  return out;
}

function itemBrief(it) {
  return {
    id: it.id, name: it.name, kind: it.kind, insurance: it.insurance,
    effect: {
      type: it.effect.type,
      value: it.effect.value,
      confirmed: it.effect.confirmed,
      unconfirmed_reason: it.effect.unconfirmed_reason || undefined,
      sources: resolveSources(it.effect.source_ref),
    },
    revision: {
      id: it.revision, name: it.revision_name, effective_from: it.effective_from,
      superseded_by: it.superseded_by || null,
      is_current: !it.superseded_by,
      recheck_needed: it.recheck_needed,
      recheck_why: it.recheck_why || undefined,
    },
    requirement_count: (it.requirements || []).length,
  };
}

/* ------------------------------ 道具 ------------------------------ */

const TOOLS = [
  {
    name: "nursing_db_state",
    description:
      "算定要件データベースの、いまの状態と限界を返す。版、施行日、上書きされた版の項目数、"
      + "未確認の要件の数、未解決の食い違い、既知の穴。数字を使う前に、まずこれを見るための道具。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "nursing_rules_list",
    description:
      "算定要件の一覧を返す。insurance(介護/医療)と kind(加算/減算/療養費/単位数/期限・交付ルール/振り分けルール)で絞れる。",
    inputSchema: {
      type: "object",
      properties: {
        insurance: { type: "string", description: "介護 / 医療 / 両方(既定)" },
        kind: { type: "string", description: "加算 / 減算 / 療養費 / 単位数 / 期限・交付ルール / 振り分けルール" },
        only_current_revision: { type: "boolean", description: "true なら、上書きされた版の項目を外す" },
      },
    },
  },
  {
    name: "nursing_rule_get",
    description: "1つの算定要件を、要件・出典・版の状態つきで返す。",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "項目 id(例 iryo-kasan-24h)" } },
      required: ["id"],
    },
  },
  {
    name: "nursing_kasan_review",
    description:
      "加算の取りこぼしを探すための材料を返す。事業所からの回答(設問id -> 答え)を渡すと、"
      + "要件ごとに『答えがある』『まだ尋ねていない』『データベース側が未確認』を並べる。"
      + "算定の可否は判定しない。判定はしないと決めてある。",
    inputSchema: {
      type: "object",
      properties: {
        answers: { type: "object", description: "設問id -> 答えの文字列。例 {\"q_nv_kyoka_kata\": \"機能強化型2で届出しています\"}" },
        insurance: { type: "string", description: "介護 / 医療 / 両方(既定)" },
      },
    },
  },
  {
    name: "nursing_shijisho_check",
    description:
      "訪問看護指示書・特別訪問看護指示書の期限を数える。交付日から、残り日数と期限切れを出す。"
      + "指示書に書かれた有効期間が分からないときは、上限しか分からないとそのまま言う。",
    inputSchema: {
      type: "object",
      properties: {
        sheets: {
          type: "array",
          description: "指示書の一覧",
          items: {
            type: "object",
            properties: {
              ref: { type: "string", description: "利用者の識別(仮名や整理番号。氏名は入れない)" },
              kind: { type: "string", description: "通常 / 特別" },
              issued_on: { type: "string", description: "交付日 YYYY-MM-DD" },
              valid_until: { type: "string", description: "指示書に書かれた有効期間の末日 YYYY-MM-DD(分かれば)" },
            },
            required: ["kind", "issued_on"],
          },
        },
        today: { type: "string", description: "今日の日付 YYYY-MM-DD(省略時は日本時間の今日)" },
        warn_days_normal: { type: "number", description: "通常の指示書で『期限間近』とする残り日数(既定 30)" },
        warn_days_special: { type: "number", description: "特別指示書で『期限間近』とする残り日数(既定 3)" },
      },
      required: ["sheets"],
    },
  },
  {
    name: "nursing_insurance_route",
    description:
      "医療保険と介護保険のどちらで訪問看護を算定するかの、分岐点を返す。"
      + "分からない入力があれば、決めずに『どれが分からないか』を返す。",
    inputSchema: {
      type: "object",
      properties: {
        youkaigo: { type: "string", description: "要介護または要支援の認定がある: yes / no / unknown" },
        beppyo7: { type: "string", description: "別表第七に掲げる疾病等に当たる: yes / no / unknown" },
        tokubetsu_shijisho: { type: "string", description: "特別訪問看護指示書が交付されている期間内: yes / no / unknown" },
        seishinka: { type: "string", description: "精神科訪問看護基本療養費を算定する: yes / no / unknown" },
      },
    },
  },
  {
    name: "nursing_sources",
    description: "出典の一覧を、素性(statute/agency/secondary)と現行かどうかつきで返す。",
    inputSchema: { type: "object", properties: {} },
  },
];

/* ------------------------------ 道具の中身 ------------------------------ */

function toolDbState() {
  const items = RULES.items;
  const superseded = items.filter((i) => i.superseded_by);
  const effUnconfirmed = items.filter((i) => i.effect && i.effect.value && !i.effect.confirmed);
  let reqTotal = 0, reqUnconfirmed = 0, reqNoAsk = 0;
  for (const it of items) {
    for (const r of it.requirements || []) {
      reqTotal++;
      if (!r.confirmed) reqUnconfirmed++;
      if (!r.ask) reqNoAsk++;
    }
  }
  const notes = [
    "この一覧は、数字を使う前に見るためのものです。",
    "上書きされた版の項目は、現行の根拠ではありません。当て直しが要ります。",
    "未確認の要件は、確認できていないという事実がそのまま残してあります。空欄とは違います。",
  ];
  return {
    version: RULES.version,
    revision_label: RULES.revision_label,
    built_at: RULES.built_at,
    source_sha256: SOURCE_SHA256,
    items: items.length,
    by_insurance: {
      "介護": items.filter((i) => i.insurance === "介護").length,
      "医療": items.filter((i) => i.insurance === "医療").length,
    },
    revisions: RULES.revisions,
    superseded_items: superseded.map((i) => ({
      id: i.id, name: i.name, revision: i.revision, superseded_by: i.superseded_by,
      recheck_why: i.recheck_why || undefined,
    })),
    effect_unconfirmed: effUnconfirmed.map((i) => ({
      id: i.id, name: i.name, why: i.effect.unconfirmed_reason || undefined,
    })),
    requirements: { total: reqTotal, unconfirmed: reqUnconfirmed, without_question: reqNoAsk },
    open_conflicts: RULES.conflicts || [],
    known_gaps: RULES.known_gaps || [],
    discipline: RULES.discipline || [],
    notes,
  };
}

function toolRulesList(args) {
  const ins = S(args.insurance, 10);
  const kind = S(args.kind, 30);
  let items = RULES.items;
  if (ins && ins !== "両方") items = items.filter((i) => i.insurance === ins);
  if (kind) items = items.filter((i) => i.kind === kind);
  if (args.only_current_revision) items = items.filter((i) => !i.superseded_by);
  return {
    version: RULES.version,
    count: items.length,
    filtered_by: { insurance: ins || "両方", kind: kind || "すべて", only_current_revision: !!args.only_current_revision },
    items: items.map(itemBrief),
    notes: [
      "値の confirmed が false のものは、確認できていません。理由を添えてあります。",
      "revision.is_current が false のものは、あとの改定で上書きされています。",
    ],
  };
}

function toolRuleGet(args) {
  const id = S(args.id, 80);
  const it = RULES.items.find((x) => x.id === id);
  if (!it) {
    return {
      error: "そのidの項目はありません",
      id,
      available: RULES.items.map((x) => x.id),
    };
  }
  return {
    version: RULES.version,
    ...itemBrief(it),
    requirements: (it.requirements || []).map((r) => ({
      kind: r.kind, id: r.id, text: r.text,
      confirmed: r.confirmed,
      unconfirmed_reason: r.unconfirmed_reason || undefined,
      ask: r.ask || null,
      question: r.ask ? (RULES.questions[r.ask] || {}).text || null : null,
      sources: resolveSources(r.source_ref),
    })),
    beppyo7: it.beppyo7 || undefined,
    we_do_not_say: it.we_do_not_say || undefined,
    sources: resolveSources(it.sources),
  };
}

function toolKasanReview(args) {
  const answers = (args && typeof args.answers === "object" && args.answers) || {};
  const ins = S(args && args.insurance, 10);
  let items = RULES.items;
  if (ins && ins !== "両方") items = items.filter((i) => i.insurance === ins);

  const rows = [];
  for (const it of items) {
    const reqs = it.requirements || [];
    const detail = [];
    let answered = 0, notAsked = 0, dbUnconfirmed = 0;
    for (const r of reqs) {
      let state, why = undefined, excerpt = undefined;
      if (!r.confirmed) {
        state = "データベース側が未確認";
        why = r.unconfirmed_reason;
        dbUnconfirmed++;
      } else if (!r.ask) {
        state = "尋ねる設問が結ばれていない";
        notAsked++;
      } else if (!(r.ask in answers) || !S(answers[r.ask], 1)) {
        state = "まだ尋ねていない";
        notAsked++;
      } else {
        state = "答えがある";
        excerpt = S(answers[r.ask], 300);
        answered++;
      }
      detail.push({
        id: r.id, text: r.text, state,
        ask: r.ask || null,
        question: r.ask ? (RULES.questions[r.ask] || {}).text || null : null,
        answer_excerpt: excerpt,
        unconfirmed_reason: why,
      });
    }
    let stance;
    if (reqs.length === 0) stance = "要件がまだ入っていない";
    else if (answered === 0) stance = "まだ何も尋ねていない";
    else if (notAsked === 0 && dbUnconfirmed === 0) stance = "要件のぶんの答えは揃っている(可否の判定はしない)";
    else stance = "一部だけ揃っている";

    rows.push({
      id: it.id, name: it.name, kind: it.kind, insurance: it.insurance,
      effect_value: it.effect.value,
      effect_confirmed: it.effect.confirmed,
      revision_is_current: !it.superseded_by,
      recheck_needed: it.recheck_needed,
      stance,
      counts: { requirements: reqs.length, answered, not_asked: notAsked, db_unconfirmed: dbUnconfirmed },
      requirements: detail,
      we_do_not_say: it.we_do_not_say || undefined,
    });
  }

  const nothing = rows.filter((r) => r.stance === "まだ何も尋ねていない");
  const partial = rows.filter((r) => r.stance === "一部だけ揃っている");
  const full = rows.filter((r) => r.stance.startsWith("要件のぶんの答えは揃っている"));

  const notes = [
    "ここで返すのは材料です。どの加算を算定するかの判定はしません。",
    "「まだ尋ねていない」が残っている項目は、答えが無いのであって、要件を満たしていないという意味ではありません。",
    "「データベース側が未確認」は、事業所ではなくこちらの宿題です。原文に当たって埋めます。",
    "revision_is_current が false の項目は、令和8年6月の改定で上書きされた版の数字です。当て直しが済むまで、金額の根拠には使えません。",
  ];
  const bad = guard(notes);
  if (bad.length) return { error: "出力の門に引っかかりました", detail: bad };

  return {
    version: RULES.version,
    answers_given: Object.keys(answers).length,
    summary: {
      "まだ何も尋ねていない": nothing.length,
      "一部だけ揃っている": partial.length,
      "要件のぶんの答えは揃っている": full.length,
      "項目の合計": rows.length,
    },
    next_questions: [...new Set(
      rows.flatMap((r) => r.requirements)
        .filter((d) => d.state === "まだ尋ねていない" && d.ask)
        .map((d) => d.ask)
    )].map((qid) => ({ qid, text: (RULES.questions[qid] || {}).text || null })),
    items: rows,
    notes,
  };
}

function toolShijishoCheck(args) {
  const today = todayJST(args && args.today);
  const t0 = parseYMD(today);
  const warnN = Number.isFinite(args && args.warn_days_normal) ? args.warn_days_normal : 30;
  const warnS = Number.isFinite(args && args.warn_days_special) ? args.warn_days_special : 3;

  const tsujo = RULES.items.find((i) => i.id === "shiji-tsujo");
  const tokubetsu = RULES.items.find((i) => i.id === "shiji-tokubetsu");
  const yuko = RULES.items.find((i) => i.id === "shijisho-yuko-kikan");

  const out = [];
  for (const sh of (args && args.sheets) || []) {
    const ref = S(sh.ref, 80) || "(識別なし)";
    const kind = S(sh.kind, 10);
    const issued = parseYMD(sh.issued_on);
    if (!issued) {
      out.push({ ref, kind, state: "分からない",
                 why: "交付日が YYYY-MM-DD の形で入っていません。日付が無ければ数えられません。推測はしません。" });
      continue;
    }
    if (kind === "特別") {
      // 交付の日から起算して14日以内、14日を限度。交付日を1日目として数える。
      const last = addDays(issued, 13);
      const remain = Math.floor((last - t0) / dayMs);
      out.push({
        ref, kind,
        issued_on: fmt(issued),
        last_day: fmt(last),
        remaining_days: remain,
        state: remain < 0 ? "期限切れ" : (remain <= warnS ? "期限間近" : "有効"),
        rule: "交付の日から起算して14日以内、14日を限度。原則として月1回。"
            + "気管カニューレを使用している状態にある者、または真皮を越える褥瘡の状態にある者については月2回まで。",
        counted_as: "交付日を1日目として14日間。したがって最終日は交付日+13日。",
        caution: "月に何回交付されたかは、この道具では分かりません。月1回(例外は月2回)の上限は別に数えてください。",
        sources: resolveSources(tokubetsu ? tokubetsu.sources : []),
        rule_confirmed: tokubetsu ? !tokubetsu.recheck_needed : false,
        rule_recheck_why: tokubetsu ? tokubetsu.recheck_why : undefined,
      });
      continue;
    }
    // 通常の訪問看護指示書
    const written = parseYMD(sh.valid_until);
    const capped = addMonths(issued, 6);
    const last = written || capped;
    const remain = Math.floor((last - t0) / dayMs);
    const row = {
      ref, kind: kind || "通常",
      issued_on: fmt(issued),
      last_day: fmt(last),
      remaining_days: remain,
      state: remain < 0 ? "期限切れ" : (remain <= warnN ? "期限間近" : "有効"),
      rule: "指示書に記載された有効期間内。6か月を限度とする。",
      sources: resolveSources(yuko ? yuko.sources : (tsujo ? tsujo.sources : [])),
      rule_confirmed: yuko ? !yuko.recheck_needed : false,
      rule_recheck_why: yuko ? yuko.recheck_why : undefined,
    };
    if (written) {
      row.counted_as = "指示書に書かれた有効期間の末日で数えました。";
      if (capped < written) {
        row.warning = "指示書に書かれた末日が、交付日から6か月を超えています。"
                    + "6か月が限度なので、書かれている期間のほうを確かめてください。";
        row.cap_day = fmt(capped);
      }
    } else {
      row.counted_as = "指示書に書かれた有効期間が渡されていないので、上限(交付日から6か月)で数えました。";
      row.warning = "これは上限であって、この指示書の本当の期限ではありません。"
                  + "主治医が定めた期間が6か月より短ければ、実際の期限はもっと早く来ます。"
                  + "valid_until を渡してください。";
      row.is_upper_bound_only = true;
    }
    out.push(row);
  }

  const expired = out.filter((x) => x.state === "期限切れ");
  const soon = out.filter((x) => x.state === "期限間近");
  const unknown = out.filter((x) => x.state === "分からない");
  const upper = out.filter((x) => x.is_upper_bound_only);

  const notes = [
    "日付は日本時間で数えています。",
    "期限が切れているという判定は、渡された交付日と有効期間についてのものです。",
    "上限だけで数えたものは、本当の期限がもっと早い可能性があります。",
  ];
  const bad = guard(notes);
  if (bad.length) return { error: "出力の門に引っかかりました", detail: bad };

  return {
    version: RULES.version,
    today,
    counted: out.length,
    summary: {
      "期限切れ": expired.length, "期限間近": soon.length,
      "有効": out.length - expired.length - soon.length - unknown.length,
      "分からない": unknown.length,
      "上限でしか数えられていない": upper.length,
    },
    sheets: out,
    notes,
  };
}

function toolInsuranceRoute(args) {
  const g = (k) => {
    const v = S(args && args[k], 10).toLowerCase();
    if (v === "yes" || v === "true" || v === "はい") return true;
    if (v === "no" || v === "false" || v === "いいえ") return false;
    return null;
  };
  const youkaigo = g("youkaigo");
  const beppyo7 = g("beppyo7");
  const tokubetsu = g("tokubetsu_shijisho");
  const seishinka = g("seishinka");

  const item = RULES.items.find((i) => i.id === "furiwake-iryo-kaigo");
  const unknowns = [];
  if (youkaigo === null) unknowns.push({ input: "youkaigo", why: "要介護・要支援の認定があるかどうか" });
  if (beppyo7 === null) unknowns.push({ input: "beppyo7", why: "別表第七に掲げる疾病等に当たるかどうか" });
  if (tokubetsu === null) unknowns.push({ input: "tokubetsu_shijisho", why: "特別訪問看護指示書が交付されている期間内かどうか" });
  if (seishinka === null) unknowns.push({ input: "seishinka", why: "精神科訪問看護基本療養費を算定するかどうか" });

  // 例外に1つでも当たれば医療保険側。例外の判定が1つでも不明なら、決めない。
  const anyException = [beppyo7, tokubetsu, seishinka].some((x) => x === true);
  const exceptionUnknown = [beppyo7, tokubetsu, seishinka].some((x) => x === null);

  let route, because;
  if (anyException) {
    route = "医療保険";
    because = [
      beppyo7 === true ? "別表第七に掲げる疾病等に当たる" : null,
      tokubetsu === true ? "特別訪問看護指示書が交付されている期間内である" : null,
      seishinka === true ? "精神科訪問看護基本療養費を算定する" : null,
    ].filter(Boolean);
  } else if (youkaigo === false) {
    route = "医療保険";
    because = ["要介護・要支援の認定が無い"];
  } else if (youkaigo === true && !exceptionUnknown) {
    route = "介護保険";
    because = ["要介護・要支援の認定があり、医療保険側になる3つの例外のいずれにも当たらない"];
  } else {
    route = null;
    because = [];
  }

  const notes = [
    "これは分岐点を並べたものです。最終の判断は、事業所と保険者の運用を見たうえで人がしてください。",
    "介護保険の給付が医療保険の給付に優先する、というのが原則です。",
    "この振り分けは、データベース側でも confirmed:false です。厚生局の資料で確認したもので、法律の条文そのものには当たれていません。",
  ];
  const bad = guard(notes);
  if (bad.length) return { error: "出力の門に引っかかりました", detail: bad };

  return {
    version: RULES.version,
    route,
    決められない理由: route ? undefined : (unknowns.length
      ? "分からない入力があるため、どちらとも決められません。"
      : "入力の組み合わせがこの分岐に載っていません。"),
    because,
    unknown_inputs: unknowns,
    beppyo7_list: (RULES.items.find((i) => i.id === "furiwake-iryo-kaigo") || {}).beppyo7 || [],
    rule: item ? {
      name: item.name, value: item.effect.value,
      confirmed: item.effect.confirmed,
      unconfirmed_reason: item.effect.unconfirmed_reason || undefined,
      sources: resolveSources(item.sources),
      we_do_not_say: item.we_do_not_say,
    } : undefined,
    notes,
  };
}

function toolSources() {
  const rows = Object.entries(RULES.sources).map(([ref, s]) => ({ ref, ...s }));
  return {
    version: RULES.version,
    count: rows.length,
    by_tier: {
      statute: rows.filter((r) => r.tier === "statute").length,
      agency: rows.filter((r) => r.tier === "agency").length,
      secondary: rows.filter((r) => r.tier === "secondary").length,
    },
    current: rows.filter((r) => r.current !== false).length,
    not_current: rows.filter((r) => r.current === false).length,
    sources: rows,
    notes: [
      "素性(tier)が強いことと、いま有効であることは別です。分けて数えています。",
      "current が false の出典は、改正前の版です。現行の根拠には使えません。",
    ],
  };
}

async function callTool(name, args) {
  const a = args || {};
  switch (name) {
    case "nursing_db_state": return toolDbState();
    case "nursing_rules_list": return toolRulesList(a);
    case "nursing_rule_get": return toolRuleGet(a);
    case "nursing_kasan_review": return toolKasanReview(a);
    case "nursing_shijisho_check": return toolShijishoCheck(a);
    case "nursing_insurance_route": return toolInsuranceRoute(a);
    case "nursing_sources": return toolSources();
    default: return { error: "知らない道具です", name, available: TOOLS.map((t) => t.name) };
  }
}

/* ------------------------------ MCP の層 ------------------------------ */

const SERVER_INFO = {
  protocolVersion: PROTOCOL_VERSION,
  capabilities: { tools: {} },
  serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
  instructions:
    "訪問看護の算定要件を引くための内部の口です。算定の可否は判定しません。"
    + "要件と、その要件について何が分かっていて何が分かっていないかを返します。"
    + "数字を使う前に nursing_db_state でデータベースの限界を見てください。",
};

function rpc(id, result, headers) {
  return json({ jsonrpc: "2.0", id, result }, 200, headers);
}
function rpcError(id, code, message, headers, data) {
  return json({ jsonrpc: "2.0", id, error: { code, message, data } }, 200, headers);
}

/* 鍵。内部の口なので、鍵が無ければ何も答えない。
   鍵が設定されていないときに全部開くのは、設定漏れが公開になるということである。
   設定漏れは必ず起きる。だから閉じる側に倒す。 */
function authed(request, env) {
  const want = env && env.NURSING_MCP_KEY;
  if (!want) return { ok: false, reason: "この worker に NURSING_MCP_KEY が設定されていません。設定されるまで、何も答えません。" };
  const got = request.headers.get("X-Admin-Key")
    || (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!got) return { ok: false, reason: "X-Admin-Key か Authorization: Bearer が要ります。" };
  // 長さが違えば早く返る比較になるが、内部の口であり、鍵は推測ではなく漏洩でしか破られない。
  if (got !== want) return { ok: false, reason: "鍵が違います。" };
  return { ok: true };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const h = cors(request);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: h });

    if (url.pathname === "/" || url.pathname === "/health") {
      // 鍵が無くても、生きているかと、どんな口かは言う。中身は言わない。
      return json({
        ok: true,
        name: SERVER_NAME,
        version: SERVER_VERSION,
        what: "訪問看護の算定要件を引くための内部の口。算定の可否は判定しない。",
        mcp: { endpoint: "/mcp", transport: "streamable-http", protocol_version: PROTOCOL_VERSION, stateless: true },
        rules: { version: RULES.version, built_at: RULES.built_at, items: RULES.items.length, source_sha256: SOURCE_SHA256 },
        auth: "X-Admin-Key もしくは Authorization: Bearer",
      }, 200, h);
    }

    if (url.pathname !== "/mcp") return json({ error: "not_found" }, 404, h);

    const a = authed(request, env);
    if (!a.ok) return json({ error: "forbidden", reason: a.reason }, 403, h);

    if (request.method === "GET") return json(SERVER_INFO, 200, h);
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, h);

    let body;
    try { body = await request.json(); } catch (_e) {
      return rpcError(null, -32700, "JSON として読めません", h);
    }

    const batch = Array.isArray(body) ? body : [body];
    const results = [];
    for (const req of batch) {
      const id = req && Object.prototype.hasOwnProperty.call(req, "id") ? req.id : null;
      const method = req && req.method;

      // 2026-07-28 改訂では initialize が無くなった。
      // 古い版の相手のために受け付けるが、こちらは状態を持たない。
      if (method === "initialize") { results.push({ jsonrpc: "2.0", id, result: SERVER_INFO }); continue; }
      if (method === "notifications/initialized") continue;
      if (method === "server/discover") {
        results.push({ jsonrpc: "2.0", id, result: { ...SERVER_INFO, supportedVersions: [PROTOCOL_VERSION, "2026-07-28", "2025-06-18"] } });
        continue;
      }
      if (method === "ping") { results.push({ jsonrpc: "2.0", id, result: {} }); continue; }
      if (method === "tools/list") { results.push({ jsonrpc: "2.0", id, result: { tools: TOOLS } }); continue; }
      if (method === "tools/call") {
        const p = (req && req.params) || {};
        const out = await callTool(p.name, p.arguments);
        results.push({
          jsonrpc: "2.0", id,
          result: { content: [{ type: "text", text: JSON.stringify(out, null, 2) }], isError: !!out.error },
        });
        continue;
      }
      results.push({ jsonrpc: "2.0", id, error: { code: -32601, message: "method not found: " + String(method) } });
    }

    if (!results.length) return new Response(null, { status: 204, headers: h });
    return json(Array.isArray(body) ? results : results[0], 200, h);
  },
};
