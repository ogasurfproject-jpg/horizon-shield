# -*- coding: utf-8 -*-
"""
業種が決まった一言が、答えそのものだったときに、それを捨てない。

2026-08-23 22:30 の事故。
平田様は「1、合同会社アップス さざなみ訪問看護ステーション / 2、平塚市全域、大磯町… /
3、医療処置、酸素管理、カテーテル管理、難病、精神、認知症看護…」と、
訊いた3つに全部お答えくださった。

ところが業種ゲートは、その文から業種を「訪問看護」と判定したところで満足し、
中身を取り込まないまま「あらためて、次の3つをご返信ください」と同じ質問を返した。
答えた直後に同じことを訊かれる。相手からは、こちらが読んでいないように見える。

原因: startWithIndustry が「業種を決めて、最初の質問を送る」ことしかしていなかった。
業種を決めるきっかけになった文が、答えを含んでいる場合を考えていなかった。

直し方: 業種を決めた文が短い合図(「2」「訪問看護です」)でなければ、
それは答えである。取り込んでから、受け取った旨だけを返す。二度訊かない。
"""

import io, os, shutil, sys

SRC = os.path.abspath(os.environ.get(
    "HS_SRC",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "workers", "hs-hearing", "src")))
STAMP = ".bak_preingest20260823"

H = os.path.join(SRC, "hearing.js")
I = os.path.join(SRC, "industry.js")

# --- hearing.js: startWithIndustry の締めくくりを差し替える -------------------
H_OLD = '''      if (Array.isArray(estimates) && estimates.length) { try { await appendEstimatesForAudit(env, sid, estimates); } catch (_e) {} }
      return { ok: true, reply: IND.openingText(indKey, afterWrong) };'''

H_NEW = '''      if (Array.isArray(estimates) && estimates.length) { try { await appendEstimatesForAudit(env, sid, estimates); } catch (_e) {} }

      /* 2026-08-23 22:30 の事故への対処。
         業種を決めるきっかけになった文が、そのまま答えであることがある。
         平田様は訊いた3つ(事業所名・エリア・医療処置)に全部お答えくださったのに、
         こちらは業種を読み取っただけで満足し、同じ3つをもう一度お送りした。
         答えた直後に同じことを訊かれれば、読んでいないと受け取られる。

         短い合図(「2」「訪問看護です」)なら、それは業種の返事なので質問へ進む。
         それ以上の中身があるなら、それは答えである。取り込んでから受領だけ返す。 */
      const bare2 = String(t || "").replace(/[\\s\\u3000]/g, "");
      const isJustSignal = bare2.length <= 12;
      if (!isJustSignal) {
        try { await ingestHearingAnswer(env, sid, store, t, "line"); } catch (_e) {}
        await notify(env, "[intake] 業種=" + indKey + " を決めた文が答えを含んでいたので取り込みました。store=" + sid);
        return { ok: true, reply: IND.ackText(indKey, afterWrong) };
      }
      return { ok: true, reply: IND.openingText(indKey, afterWrong) };'''

# --- industry.js: 受領の文 ---------------------------------------------------
I_ANCHOR = '''export function openingText(key, afterWrong) {'''

I_NEW = '''/*
  業種を決めた文が、すでに答えだったときに返す文。

  ここで同じ質問をくり返してはいけない。答えた直後に同じことを訊かれると、
  相手からは、こちらが読んでいないように見える。実際 2026-08-23 22:30 に
  そうなった。受け取ったことだけを言い、足りないぶんは後から少しずつ訊く。
*/
export function ackText(key, afterWrong) {
  const i = INDUSTRIES[key];
  const label = i ? i.label : "";
  const head = afterWrong
    ? ((label ? label + "でしたら、こちらの窓口でお受けします。" : "") +
       "先にお送りした3つの質問は業種を取り違えたものでした。失礼しました。\\n\\n")
    : ((label ? label + "の窓口としてお受けします。ありがとうございます。\\n\\n" : ""));
  return (
    head +
    "いただいた内容は、そのまま受け取りました。同じことは、もうお尋ねしません。\\n" +
    "足りないところがあれば、こちらから少しずつお伺いします。まとめて答えていただく必要はありません。\\n\\n" +
    "写真や音声でも構いません。文字にするのはこちらの仕事です。"
  );
}

export function openingText(key, afterWrong) {'''


def main():
    hs = io.open(H, encoding="utf-8").read()
    isrc = io.open(I, encoding="utf-8").read()
    ok = True

    if "ackText" in isrc:
        print("industry.js: skip (already applied)")
    elif isrc.count(I_ANCHOR) != 1:
        print("industry.js: ANCHOR FAIL (%d hits)" % isrc.count(I_ANCHOR), file=sys.stderr); ok = False
    else:
        isrc = isrc.replace(I_ANCHOR, I_NEW, 1)
        print("industry.js: ok  受領の文 ackText を追加")

    if "IND.ackText" in hs:
        print("hearing.js: skip (already applied)")
    elif hs.count(H_OLD) != 1:
        print("hearing.js: ANCHOR FAIL (%d hits)" % hs.count(H_OLD), file=sys.stderr); ok = False
    else:
        hs = hs.replace(H_OLD, H_NEW, 1)
        print("hearing.js: ok  答えを含む文を取り込むようにした")

    if not ok:
        print("\\nアンカーが合わないので、何も書かずに終わります。", file=sys.stderr)
        sys.exit(2)

    shutil.copy2(I, I + STAMP); io.open(I, "w", encoding="utf-8").write(isrc)
    shutil.copy2(H, H + STAMP); io.open(H, "w", encoding="utf-8").write(hs)
    print("\\n書き換えました。バックアップ: *%s" % STAMP)


if __name__ == "__main__":
    main()
