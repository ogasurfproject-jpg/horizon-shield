# -*- coding: utf-8 -*-
"""
2026-08-23、平田様の回答を取り込んで見つかった二つ。

【1】profile から industry が落ちていた
  mergeProfiles は、名前を挙げた項目だけを引き継ぐ。industry はその一覧に無かった。
  結果、hearing: レコードに industry が無く、completeness が建設の規則で計算された。
  つまり訪問看護の事業所に「見積もり例をあと3件」を求め続け、
  訪問看護の設問(指示書の期限、加算、減算要件…)は一問も出ない状態だった。
  完成度15%はその産物である。

【2】「要相談」が消えていた
  平田様は「二宮町要相談、秦野市要相談、伊勢原市要相談」と書かれた。
  抽出は条件を落とし、areas_served に平の地名として並べた。
  このまま公開すれば、ケアマネさんに対して「その3市町は対応します」と名乗る。
  ご本人が言っていないことを、ご本人の名前で公開することになる。
  出せない数字を出さないのと同じ理屈で、落とせない条件は落とさない。

【3】訂正の口を広げる
  /admin/profile-patch が文字列8項目しか直せず、エリアも業種も直せなかった。
  こちらが取り違えたものを、こちらで直せない状態だった。
  配列と業種を直せるようにし、直した記録(edits)は必ず残す。
"""

import io, os, shutil, sys

SRC = os.path.abspath(os.environ.get(
    "HS_SRC",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "workers", "hs-hearing", "src")))
STAMP = ".bak_prequalifier20260823"

H = os.path.join(SRC, "hearing.js")
A = os.path.join(SRC, "autopilot.js")
I = os.path.join(SRC, "industry.js")

# --- 1. autopilot.js: industry を引き継ぐ -----------------------------------
A_OLD = '  for (const k of ["member_no", "store_id"]) out[k] = a[k] || b[k] || null;'
A_NEW = '''  for (const k of ["member_no", "store_id"]) out[k] = a[k] || b[k] || null;
  // 2026-08-23: 業種をここで落としていた。
  // industry が profile から消えると computeCompleteness が建設の規則で走り、
  // 訪問看護の事業所に「見積もり例をあと3件」を求め、訪問看護の設問は一問も出ない。
  // これは「情報量の多い方を残す」種類の項目ではない。決まっているものを落とさないだけ。
  const ind = S(b.industry, 40) || S(a.industry, 40);
  if (ind) out.industry = ind;'''

# --- 2. industry.js: 条件つきの言い方を落とさせない -------------------------
I_QUAL = (
    " CRITICAL: if the provider marks an item as conditional or partial "
    "(要相談, 応相談, 要確認, 応談, 一部, 場合により), you MUST keep that qualifier attached to the item "
    "itself, for example \\\"二宮町(要相談)\\\". Never list a conditional item as if it were unconditional, "
    "and never drop a scope word such as 全域 or 一部. Dropping a qualifier turns something the provider "
    "did not say into something we publish in their name."
)

I_PAIRS = [
    ('"Do NOT invent prices or amounts. Unknown fields: empty string or empty array.",',
     '"Do NOT invent prices or amounts. Unknown fields: empty string or empty array." +\n      "' + I_QUAL + '",',
     "industry: 建設の抽出プロンプトに条件保持を追加"),
    ('"Do NOT infer a medical procedure they did not name. Unknown fields: empty string or empty array.",',
     '"Do NOT infer a medical procedure they did not name. Unknown fields: empty string or empty array." +\n      "' + I_QUAL + '",',
     "industry: 訪問看護の抽出プロンプトに条件保持を追加"),
]

# --- 3. hearing.js: 訂正できる項目を広げる ----------------------------------
H_OLD = '''        const ALLOW = ["rep", "license", "contact", "hours", "ng", "story", "strengths", "trust"];
        const fields = (b.fields && typeof b.fields === "object") ? b.fields : {};
        const applied = {};
        for (const k of ALLOW) {
          if (!Object.prototype.hasOwnProperty.call(fields, k)) continue;
          const to = safeStr(fields[k], 2000);
          applied[k] = { from: safeStr(rec.profile[k], 2000), to };
          rec.profile[k] = to;
        }
        if (!Object.keys(applied).length) return json({ error: "no_allowed_field", allow: ALLOW }, 400);'''

H_NEW = '''        // 2026-08-23: 直せる項目が文字列8つしかなく、エリアも業種も直せなかった。
        // こちらが取り違えたものを、こちらで直せないのは筋が通らない。
        // 実際に「二宮町要相談」から条件が落ちた件を、この口から戻した。
        const ALLOW = ["rep", "license", "contact", "hours", "ng", "story", "strengths", "trust",
                       "company", "area", "industry"];
        const ALLOW_ARR = ["areas_served", "works", "cases"];
        const fields = (b.fields && typeof b.fields === "object") ? b.fields : {};
        const applied = {};
        for (const k of ALLOW) {
          if (!Object.prototype.hasOwnProperty.call(fields, k)) continue;
          const to = safeStr(fields[k], 2000);
          applied[k] = { from: safeStr(rec.profile[k], 2000), to };
          rec.profile[k] = to;
        }
        for (const k of ALLOW_ARR) {
          if (!Object.prototype.hasOwnProperty.call(fields, k)) continue;
          if (!Array.isArray(fields[k])) return json({ error: "must_be_array", field: k }, 400);
          const to = fields[k].map((x) => safeStr(x, 120)).filter(Boolean).slice(0, 40);
          applied[k] = { from: (rec.profile[k] || []).slice(0, 40), to };
          rec.profile[k] = to;
        }
        if (!Object.keys(applied).length) {
          return json({ error: "no_allowed_field", allow: ALLOW, allow_array: ALLOW_ARR }, 400);
        }'''


def one(path, pairs, out):
    src = io.open(path, encoding="utf-8").read()
    orig = src
    ok = True
    for old, new, label in pairs:
        if old not in src and new.split("\\n")[0] in src:
            out.append("  skip (already applied): " + label); continue
        if src.count(old) != 1:
            out.append("  ANCHOR FAIL (%d hits): %s" % (src.count(old), label)); ok = False; continue
        src = src.replace(old, new, 1)
        out.append("  ok: " + label)
    return src, orig, ok


def main():
    out = []
    asrc, aorig, aok = one(A, [(A_OLD, A_NEW, "autopilot: mergeProfiles が業種を引き継ぐ")], out)
    print("autopilot.js:"); print("\\n".join(out)); out = []
    isrc, iorig, iok = one(I, I_PAIRS, out)
    print("industry.js:"); print("\\n".join(out)); out = []
    hsrc, horig, hok = one(H, [(H_OLD, H_NEW, "hearing: 訂正できる項目を広げる")], out)
    print("hearing.js:"); print("\\n".join(out))

    if not (aok and iok and hok):
        print("\\nアンカーが合わないので、何も書かずに終わります。", file=sys.stderr)
        sys.exit(2)

    for p, new, orig in ((A, asrc, aorig), (I, isrc, iorig), (H, hsrc, horig)):
        if new != orig:
            shutil.copy2(p, p + STAMP)
            io.open(p, "w", encoding="utf-8").write(new)
    print("\\n書き換えました。バックアップ: *%s" % STAMP)


if __name__ == "__main__":
    main()
