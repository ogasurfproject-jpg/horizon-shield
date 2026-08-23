# -*- coding: utf-8 -*-
"""
hs-hearing に「業種」という軸を入れる。

2026-08-23。合同会社あっぷす様(訪問看護)が「加盟店希望」と打たれたところ、
建設業のヒアリング(対応できる工種、例: 外壁塗装)が返った。
原因は合言葉の不足ではなく、合言葉が業種を聞く前に商品を決めていたこと。
入口は1つのまま、分岐を1問だけ後ろにずらす。

このパッチが触るもの:
  hearing.js    import / 業種ゲート / normalizeProfile / llmStructure / triggerGeneration
  autopilot.js  import / computeCompleteness / nextQuestions
両方ともバックアップを取る。アンカーが1つでも見つからなければ、何も書かずに終わる。
"""

import io, os, shutil, sys

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "workers", "hs-hearing", "src")
SRC = os.path.abspath(os.environ.get("HS_SRC", SRC))
STAMP = ".bak_preindustry20260823"

H = os.path.join(SRC, "hearing.js")
A = os.path.join(SRC, "autopilot.js")

# ---------------------------------------------------------------- hearing.js

H_IMPORT_ANCHOR = 'import * as AP from "./autopilot.js";'
H_IMPORT_NEW = H_IMPORT_ANCHOR + '\nimport * as IND from "./industry.js";'

H_GATE_START = "  // 初回: 店レコードを自動作成して即ヒアリング開始(コード不要)"

H_GATE_NEW = r'''  /* --------------------------------------------------------------
     2026-08-23 業種の分岐。

     合同会社あっぷす様(訪問看護)が「加盟店希望」と打たれたところ、
     この下にあった処理が無条件に Yakumo の店を作り、「対応できる工種と強み
     (例: 外壁塗装、無機3回塗り10年保証)」を尋ねてしまった。
     訪問看護に工種は無い。打たれた言葉は正しく、壊れていたのはこちらの構造である。

     合言葉を業種ごとに増やす道は採らなかった。お客様に我々の商品分類を
     先に覚えていただく設計になるうえ、増やすたびに「間違った先へ送る口」が
     1つ増えるからである。入口は1つのまま、分岐を1問だけ後ろにずらす。

     判らないときは推測しない。二度読めなければ人に回す。
     業種を間違えたヒアリングは、相手の時間を奪った上で、
     こちらが話を聞いていないことの証拠になる。
     -------------------------------------------------------------- */
  {
    const intakeKey = "intake:" + userId;
    const INTAKE_TTL = 259200; // 72時間
    let intake = null;
    try { intake = await env.HS_HEARING_KV.get(intakeKey, "json"); } catch (_e) { intake = null; }

    const putIntake = async (o) => {
      try { await env.HS_HEARING_KV.put(intakeKey, JSON.stringify(o), { expirationTtl: INTAKE_TTL }); } catch (_e) {}
    };

    // 見積書が添えられていれば、業種を尋ねるまでもない。建設である。
    const looksConstruction = Array.isArray(estimates) && estimates.length > 0;

    // 業種が決まったところで店を用意する(既存があればそれに業種を書く)。
    const startWithIndustry = async (indKey, existingId) => {
      const ind = IND.industryOf(indKey);
      const nowIso2 = new Date().toISOString();
      let sid = existingId || null;
      let store = null;
      if (sid) {
        try { store = await env.HS_HEARING_KV.get("store:" + sid, "json"); } catch (_e) { store = null; }
      }
      // 既に店があったということは、業種を決める前に別の業種のヒアリングを
      // 送ってしまっている。次の文で、それを取り消す必要がある。
      const afterWrong = !!store;
      if (!store) {
        const rand2 = (n) => { const a = "abcdefghjkmnpqrstuvwxyz23456789"; const u = crypto.getRandomValues(new Uint8Array(n)); let s = ""; for (const b of u) s += a[b % a.length]; return s; };
        sid = "kira-" + rand2(8);
        const tok = "ht_" + rand2(12);
        store = { store_id: sid, company: "", areas: [], works: [], tier: "honbu", status: "onboarding", source: "kira-line", token: tok, created_at: nowIso2, autopilot: {} };
        await env.HS_HEARING_KV.put("htok:" + tok, JSON.stringify({ store_id: sid, company: "", issued_at: nowIso2, via: "kira-bridge" }));
      }
      store.industry = indKey;
      store.industry_decided_at = nowIso2;
      await env.HS_HEARING_KV.put("store:" + sid, JSON.stringify(store));
      await env.HS_HEARING_KV.put("line2store:" + userId, sid);
      await env.HS_HEARING_KV.put("store2line:" + sid, userId);
      try { await env.HS_HEARING_KV.delete(intakeKey); } catch (_e) {}
      await AP.activityAdd(env, { type: "onboard", text: (ind ? ind.label : indKey) + " のヒアリングが始まりました" });
      await notify(env, "[intake] 業種=" + indKey + " で開始。store=" + sid + " line=" + userId);
      if (Array.isArray(estimates) && estimates.length) { try { await appendEstimatesForAudit(env, sid, estimates); } catch (_e) {} }
      return { ok: true, reply: IND.openingText(indKey, afterWrong) };
    };

    // 既にある店だが、まだ一度も中身を聞けておらず、業種も無い。
    // 今日の平田様(合同会社あっぷす)がこれに当たる。次の一言を工種として
    // 取り込む前に、業種から聞き直す。
    if (storeId && !intake) {
      let s0 = null;
      try { s0 = await env.HS_HEARING_KV.get("store:" + storeId, "json"); } catch (_e) { s0 = null; }
      const untouched = s0 && !s0.industry && !safeStr(s0.company, 120) &&
                        !(Array.isArray(s0.works) && s0.works.length) &&
                        !(Array.isArray(s0.areas) && s0.areas.length);
      if (untouched) {
        if (looksConstruction) return await startWithIndustry("construction", storeId);
        const guess = IND.classifyIndustry(t);
        if (guess && guess.key !== IND.UNKNOWN_INDUSTRY && !guess.ambiguous) {
          return await startWithIndustry(guess.key, storeId);
        }
        await putIntake({ state: "awaiting_industry", store_id: storeId, asked_at: new Date().toISOString(), retries: 0 });
        await notify(env, "[intake] 業種が未確定のため業種を尋ねました。store=" + storeId + " line=" + userId);
        return { ok: true, reply: IND.askIndustryText() };
      }
    }

    // 業種を尋ねた相手からの返事。
    if (intake && intake.state === "awaiting_industry") {
      const cls = IND.classifyIndustry(t);
      if (cls && cls.key !== IND.UNKNOWN_INDUSTRY && !cls.ambiguous) {
        return await startWithIndustry(cls.key, intake.store_id || storeId);
      }
      const retries = Number(intake.retries || 0) + 1;
      if (!cls && retries < 2) {
        await putIntake(Object.assign({}, intake, { retries }));
        return { ok: true, reply: "うまく読み取れませんでした。もう一度だけ、ご業種を短くお願いします。\n1) 建設・リフォーム  2) 訪問看護・介護  3) それ以外" };
      }
      // 「それ以外」か、二度読めなかった。ここで型を当てはめない。
      await putIntake(Object.assign({}, intake, { state: "handoff", retries, last_text: String(t).slice(0, 300) }));
      await notify(env, "[intake] 業種を決めずに人へ回しました。line=" + userId + " / " + String(t).slice(0, 160));
      return { ok: true, reply: "承知しました。ご業種は、こちらで型を決めずに担当の大賀がお伺いします。\nご業種と、いま困っていることを一言だけ書いておいていただけると、話が早くなります。" };
    }

    // 人へ回したあとは、自動で型に嵌めない。届いた言葉は大賀に流す。
    if (intake && intake.state === "handoff") {
      const cls = IND.classifyIndustry(t);
      if (cls && cls.key !== IND.UNKNOWN_INDUSTRY && !cls.ambiguous) {
        return await startWithIndustry(cls.key, intake.store_id || storeId);
      }
      await notify(env, "[intake] 人待ちの相手から追加の言葉。line=" + userId + " / " + String(t).slice(0, 200));
      return { ok: true, reply: "" };
    }

    // まったくの初回。ここで店を作らない。業種が決まってから作る。
    if (!storeId) {
      if (looksConstruction) return await startWithIndustry("construction", null);
      const guess = IND.classifyIndustry(t);
      if (guess && guess.key !== IND.UNKNOWN_INDUSTRY && !guess.ambiguous) {
        return await startWithIndustry(guess.key, null);
      }
      await putIntake({ state: "awaiting_industry", store_id: null, asked_at: new Date().toISOString(), retries: 0 });
      await notify(env, "[intake] 新規のご連絡。業種を尋ねました。line=" + userId);
      return { ok: true, reply: IND.askIndustryText() };
    }
  }
'''

H_NORM_ANCHOR = """  const out = {
    member_no: (store && store.member_no) || null,
    store_id: (store && store.store_id) || null,"""
H_NORM_NEW = """  const out = {
    member_no: (store && store.member_no) || null,
    store_id: (store && store.store_id) || null,
    // 業種。生成側(GitHub Action)が型を選ぶのに要る。
    // 業種の無い既存レコードは建設として扱う(後方互換)。
    industry: (store && store.industry) || IND.DEFAULT_INDUSTRY,"""

H_LLM_ANCHOR = '  const sys = "You extract structured data from a Japanese renovation/construction contractor\'s email reply.'
H_LLM_FULL_PREFIX = "  const sys = "
H_LLM_NEW = ('  // 業種ごとに抽出の指示を変える。訪問看護の返信から「工種」を取り出そうとすれば、\n'
             '  // 取れないか、取れてはいけないものが取れる。\n'
             '  const sys = IND.llmSystemPrompt((store && store.industry) || IND.DEFAULT_INDUSTRY);\n')

H_GEN_ANCHOR = """  const autopilot = { focus_primary: ap.focus_primary || null, completeness: ap.completeness || 0, news: (news.items || []).slice(0, 5) };"""
H_GEN_NEW = """  const indKey = (store && store.industry) || (profile && profile.industry) || IND.DEFAULT_INDUSTRY;
  const indDef = IND.industryOf(indKey);
  const autopilot = {
    focus_primary: ap.focus_primary || null,
    completeness: ap.completeness || 0,
    news: (news.items || []).slice(0, 5),
    // 業種と、生成の配分。受け手(GitHub Action)はこれを見て型を選ぶ。
    // 業種を渡さなければ、受け手には建設と訪問看護の区別がつかない。
    industry: indKey,
    industry_label: indDef ? indDef.label : "",
    mall: indDef ? indDef.mall : null,
    golden_ratio: (indDef && indDef.golden_ratio) || null,
  };"""

# -------------------------------------------------------------- autopilot.js

A_IMPORT_ANCHOR = "// 2026-08-19 patch51."
A_IMPORT_NEW = 'import * as IND from "./industry.js";\n\n// 2026-08-19 patch51.'

A_EST_ANCHOR = '  add((p.estimates_for_audit || []).length >= MIN_AUDIT_ESTIMATES, 10, "q_estimates");'
A_EST_NEW = ('  // 2026-08-23: 見積もり例は建設の話である。訪問看護に見積書は無い。\n'
             '  // 業種を見ずにこの10点を課すと、訪問看護は永久に完成度が上がらず、\n'
             '  // 生成が始まらない。業種ぶんの配点は下の業種バンクで持つ。\n'
             '  const usesEstimates = !p.industry || p.industry === "construction";\n'
             '  if (usesEstimates) add((p.estimates_for_audit || []).length >= MIN_AUDIT_ESTIMATES, 10, "q_estimates");')

A_COMP_ANCHOR = "  // 契約時点で埋まる基本項目ぶんの底上げ(社名/所在地/工種は必須通過済み)"
A_COMP_NEW = """  // 2026-08-23: 業種ぶんの設問。業種ごとに聞くべきことが違う。
  // 訪問看護なら、指示書の期限、加算、減算の要件、返戻、オンコールの実態。
  // 答えは extra[qid] に入る(フォーカス個別と同じ仕組み)。
  const ibank = IND.industryBank(p.industry);
  if (ibank) {
    const iqids = Object.keys(ibank);
    const ianswered = iqids.filter((q) => !!extra[q]).length;
    score += Math.round((ianswered / iqids.length) * 20);
    for (const q of iqids) if (!extra[q]) { missing.push({ qid: q, w: ibank[q].w }); askable.push({ qid: q, w: ibank[q].w }); }
  }
  // 契約時点で埋まる基本項目ぶんの底上げ(社名/所在地/工種は必須通過済み)"""

A_NEXT_ANCHOR = "    const q = QUESTION_BANK[m.qid] || (autopilot && autopilot.focus_primary && QUESTION_BANK[autopilot.focus_primary] && QUESTION_BANK[autopilot.focus_primary][m.qid]);"
A_NEXT_NEW = """    // 2026-08-23: 業種の文面を先に見る。無ければ従来どおり。
    // これが無いと、訪問看護の事業所に「工種ごとの強み(例: 外壁塗装)」
    // 「施主さんからよく聞かれる質問」が、追撃質問として毎週届く。
    const q = IND.questionFor((profile || {}).industry, m.qid)
      || QUESTION_BANK[m.qid]
      || (autopilot && autopilot.focus_primary && QUESTION_BANK[autopilot.focus_primary] && QUESTION_BANK[autopilot.focus_primary][m.qid]);"""


def replace_once(src, old, new, label, out):
    if new.split("\n")[0].strip() and new.strip() in src:
        out.append("  skip (already applied): " + label)
        return src, True
    if src.count(old) != 1:
        out.append("  ANCHOR FAIL (%d hits): %s" % (src.count(old), label))
        return src, False
    out.append("  ok: " + label)
    return src.replace(old, new, 1), True


def patch_hearing(src, out):
    ok = True
    src, o = replace_once(src, H_IMPORT_ANCHOR, H_IMPORT_NEW, "hearing: import industry.js", out); ok &= o

    # 業種ゲート: マーカー行から、その if ブロックの閉じ括弧までを差し替える
    if "2026-08-23 業種の分岐" in src:
        out.append("  skip (already applied): hearing: industry gate")
    else:
        lines = src.split("\n")
        try:
            i = lines.index(H_GATE_START)
        except ValueError:
            out.append("  ANCHOR FAIL: hearing: industry gate start"); return src, False
        j = i + 1
        end = None
        while j < len(lines):
            if lines[j] == "  }":
                end = j
                break
            j += 1
        if end is None:
            out.append("  ANCHOR FAIL: hearing: industry gate end"); return src, False
        if "加盟店へのご関心" not in "\n".join(lines[i:end + 1]):
            out.append("  ANCHOR FAIL: hearing: gate block does not look right"); return src, False
        lines[i:end + 1] = H_GATE_NEW.rstrip("\n").split("\n")
        src = "\n".join(lines)
        out.append("  ok: hearing: industry gate (%d 行を差し替え)" % (end - i + 1))

    src, o = replace_once(src, H_NORM_ANCHOR, H_NORM_NEW, "hearing: normalizeProfile industry", out); ok &= o
    src, o = replace_once(src, H_GEN_ANCHOR, H_GEN_NEW, "hearing: triggerGeneration payload", out); ok &= o

    # llmStructure: sys の1行まるごと
    if "IND.llmSystemPrompt" in src:
        out.append("  skip (already applied): hearing: llmStructure prompt")
    else:
        lines = src.split("\n")
        hit = [k for k, l in enumerate(lines) if l.startswith(H_LLM_FULL_PREFIX) and "You extract structured data" in l]
        if len(hit) != 1:
            out.append("  ANCHOR FAIL (%d hits): hearing: llmStructure prompt" % len(hit)); ok = False
        else:
            lines[hit[0]:hit[0] + 1] = H_LLM_NEW.rstrip("\n").split("\n")
            src = "\n".join(lines)
            out.append("  ok: hearing: llmStructure prompt")
    return src, ok


def patch_autopilot(src, out):
    ok = True
    src, o = replace_once(src, A_IMPORT_ANCHOR, A_IMPORT_NEW, "autopilot: import industry.js", out); ok &= o
    src, o = replace_once(src, A_EST_ANCHOR, A_EST_NEW, "autopilot: q_estimates は建設のみ", out); ok &= o
    src, o = replace_once(src, A_COMP_ANCHOR, A_COMP_NEW, "autopilot: computeCompleteness 業種バンク", out); ok &= o
    src, o = replace_once(src, A_NEXT_ANCHOR, A_NEXT_NEW, "autopilot: nextQuestions 業種バンク", out); ok &= o
    return src, ok


def main():
    for p in (H, A):
        if not os.path.exists(p):
            print("not found: " + p, file=sys.stderr); sys.exit(1)
    hsrc = io.open(H, encoding="utf-8").read()
    asrc = io.open(A, encoding="utf-8").read()

    out = []
    print("hearing.js:")
    hnew, hok = patch_hearing(hsrc, out)
    print("\n".join(out)); out = []
    print("autopilot.js:")
    anew, aok = patch_autopilot(asrc, out)
    print("\n".join(out))

    if not (hok and aok):
        print("\nアンカーが合わないので、何も書かずに終わります。", file=sys.stderr)
        sys.exit(2)

    if hnew != hsrc:
        shutil.copy2(H, H + STAMP)
        io.open(H, "w", encoding="utf-8").write(hnew)
    if anew != asrc:
        shutil.copy2(A, A + STAMP)
        io.open(A, "w", encoding="utf-8").write(anew)
    print("\n書き換えました。バックアップ: *%s" % STAMP)


if __name__ == "__main__":
    main()
