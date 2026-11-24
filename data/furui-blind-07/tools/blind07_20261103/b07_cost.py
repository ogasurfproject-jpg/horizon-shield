#!/usr/bin/env python3
# blind-07 の費用の見込みと日ごとの分け(O10)。書いた者 番人(Team)の下の設計の担当 2026-11-03。計算だけ。網に出ない。呼ばない。
# 光の腕の static は q21v4 と q21b を A74 の答えから使うので、範囲の 2 段の分(0.00981)を引く。
# 単価: 篩 1 件 0.0146(範囲をためる前)、0.0048(ためた後)。攻め手 0.028(Opus、入力 2,000、出力 1,000 token の仮)。的 0.00045(Haiku、2,000 と 500 の仮)。
# Gemini の攻め手の 1 回は Claude の攻め手以下(0.028 以下)と置き、見込みでは Gemini の手番も 0.028 で数える。
# 2026-11-06 計画の 7 節の値段で照らすようにした(前の版は _v_0142c97d_b07_cost.py): gemini-4-argon 2.00 と 10.00(11-30 まで)、
#   11-30 までに回せない時の替え gemini-3.8-flash 0.75 と 3.75。同じ 2,000 と 1,000 token(出力は思考の token を含む)で 0.028 を越えれば終わり 1。
# usage: python3 -I -B b07_cost.py
import math
COLD, WARM, ATK, TGT = 0.0146, 0.0048, 0.028, 0.00045
SCOPE = 0.00582 + 0.00399   # q21v4 と q21b の 1 回の平均の和(DESIGN_BATON_A74_v1 2.3.4)
GEMINI = [("gemini-4-argon(11-30 まで)", 2.00, 10.00), ("gemini-3.8-flash(替え)", 0.75, 3.75)]

def gemini_turns():
    return [(n, 2000 / 1e6 * pin + 1000 / 1e6 * pout) for n, pin, pout in GEMINI]

def ceil5(x):
    return 5 * math.ceil(round(x, 6) / 5)

def plan():
    static = (1500 + 300 + 1000 + 1000) * COLD + 2812 * WARM
    ad_filtered = 1000 * COLD + 500 * ATK + 500 * ATK + 1000 * TGT   # 20 目標 x (Claude 25 + Gemini 25)
    ad_pg2 = 500 * ATK + 500 * ATK + 1000 * TGT
    ad_none = 200 * ATK + 200 * TGT                                  # 20 目標 x (5 + 5)
    canary_static = 3800 * (COLD - SCOPE) + 2812 * WARM              # 光の腕は q21v4 と q21b を A74 から使う
    days = [("1", "A74 static", static), ("2", "CANARY static", canary_static),
            ("3", "AD_A74 + AD_PG2 + AD_NONE", ad_filtered + ad_pg2 + ad_none), ("4", "AD_CANARY", ad_filtered)]
    return static, canary_static, ad_filtered, ad_pg2, ad_none, days

if __name__ == "__main__":
    static, cst, adf, adp, adn, days = plan()
    print("static の層 A74: 3,800 x %.4f + 2,812 x %.4f = %.4f" % (COLD, WARM, static))
    print("static の層 光: 3,800 x (%.4f - %.5f) + 2,812 x %.4f = %.4f" % (COLD, SCOPE, WARM, cst))
    print("手を変える攻め(篩あり)1 腕: 1,000 x %.4f + 500 x %.3f + 500 x %.3f + 1,000 x %.5f = %.4f" % (COLD, ATK, ATK, TGT, adf))
    print("手を変える攻め(Prompt Guard 2): 500 x %.3f + 500 x %.3f + 1,000 x %.5f = %.4f" % (ATK, ATK, TGT, adp))
    print("篩なしの対照: 200 x %.3f + 200 x %.5f = %.4f" % (ATK, TGT, adn))
    tot, caps = 0.0, 0
    for d, name, x in days:
        c = ceil5(1.5 * x); tot += x; caps += c
        print("日 %s %-28s 見込み %8.4f  x 1.5 = %8.4f  日の上限 %4d" % (d, name, x, 1.5 * x, c))
    print("見込みの計 %.4f、日の上限の和 %d、計画の上限 380(見込みの %.3f 倍)" % (tot, caps, 380 / tot))
    print("本番の扉の 100 行: 100 x %.4f = %.2f(runner の 1 日 5.00 の内、計画の上限の外)" % (COLD, 100 * COLD))
    bad = 0
    for n, g in gemini_turns():
        print("Gemini の攻め手 1 回 %s: 2,000 と 1,000 token で %.4f、Opus の攻め手 %.3f 以下: %s" % (n, g, ATK, "成り立つ" if g <= ATK else "崩れる"))
        bad += g > ATK
    if bad: raise SystemExit("止めた: Gemini の攻め手が Opus の攻め手より高い。見込みと日の上限を計算し直す")
