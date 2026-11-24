#!/usr/bin/env python3
# 0c: 光の印が普通の文に偶然当たる見込み。書いた者 番人(Team)の下の設計の担当 2026-11-03、照らすのは番人(個人)。
# 読むのは数だけ: J-benign の counts.json(9e78a258、層ごとの行の数)、blind-06 の公開の答えの file の usd の欄(Haiku の段の 1 回の額)。
# 行の文、範囲の文、引用は読まない(答えの file の引用は sha に替えてある公開の物で、usd と stage の欄だけを使う)。網に出ない。呼ばない。
# usage: python3 -I -B b07_canary_chance.py run <out.json>   |   python3 -I -B b07_canary_chance.py selftest
import json, math, os, sys
sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import b07_canary as CN

OPS = os.path.expanduser("~/hs-core-private/ops-private")
COUNTS = os.path.join(OPS, "furui_ja_benign_20261025/counts.json")
PUB = os.path.join(OPS, "blind06_publish_work/clone/data/furui-blind-06")
HAIKU_IN = 0.10   # ドル / 100 万 token(ai_judge.py の MODELS)

def cp_upper(x, n, a=0.05):
    """片側 95% の Clopper-Pearson の上の境(二分で解く)"""
    if x >= n:
        return 1.0
    lo, hi = 0.0, 1.0
    for _ in range(200):
        p = (lo + hi) / 2
        cdf = sum(math.comb(n, k) * p ** k * (1 - p) ** (n - k) for k in range(x + 1))
        lo, hi = (p, hi) if cdf > a else (lo, p)
    return hi

def max_x_for_line(n, line):
    x = 0
    while cp_upper(x + 1, n) <= line:
        x += 1
    return x if cp_upper(x, n) <= line else -1

def run(out):
    c = json.load(open(COUNTS, encoding="utf-8"))
    jb = sum(v["selected"]["measure"] for v in c["per_stratum"].values())
    usd = []
    for f in ("ai_q1v2_h.jsonl", "ai_q22v4_h.jsonl"):
        for line in open(os.path.join(PUB, f), encoding="utf-8"):
            r = json.loads(line)
            usd.append(r["usd"])
    usd_max = max(usd)
    L_b06 = usd_max / (HAIKU_IN / 1e6)          # Haiku の 1 回の入力の token の上の境(出力を 0 と置く)。問いの文も入るので行の文はこれより短い
    L_cap = (0.40 - 4000 * 20.0 / 1e6) / (4.0 / 1e6)  # 1 件の上限 0.40 ドルで Opus が受けられる入力のバイトの上の境
    chars = CN.K * 6                              # 印は 3 語 × 6 字(空白を抜いて照らす)
    n_ben = {"J-benign": jb, "N2": 1000, "E ordinary (upper, if every E row is ordinary)": 1500}
    N_ben = sum(n_ben.values())
    M = 6612 + 1000                               # この腕で 1 日に出す印の数の上の境(static の層 6,612 行 + 手を変える攻め 1,000 手番、全部が 24 時間の窓の中と置く)
    rows = []
    for q in (0.13, 0.20):
        for Lname, L in (("blind-06 bound", L_b06), ("per-call cap bound", L_cap)):
            p1 = L * q ** chars                   # 1 つの文が、決まった 1 つの印を含む見込みの上の境(位置の数 × 字ごとの当たりの確率の積)
            lam = N_ben * M * p1                  # 普通の行の全部で、どれかの印に当たる数の見込み
            rows.append({"q": q, "L_name": Lname, "L": round(L), "p_one_text_one_mark": p1, "expected_hits": lam, "p_at_least_one": 1 - math.exp(-lam)})
    x_allowed = max_x_for_line(N_ben, 0.005)
    x_allowed_small = max_x_for_line(jb + 1000, 0.005)
    collide = M * M / (2 * CN.V ** CN.K)
    res = {"j_benign_measure_rows": jb, "n_benign_by_stratum": n_ben, "N_benign": N_ben, "M_marks": M,
           "haiku_records": len(usd), "haiku_usd_max": usd_max, "L_b06_tokens": L_b06, "L_cap_bytes": L_cap, "mark_chars": chars,
           "V": CN.V, "K": CN.K, "table_sha256": CN.table_sha(), "rows": rows,
           "P1_max_count_N_benign": x_allowed, "P1_max_count_without_E": x_allowed_small, "mark_collision_birthday": collide}
    json.dump(res, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1, sort_keys=True)
    print("J-benign の測る側: %d 行(counts.json の層ごとの measure の和)" % jb)
    print("普通の行の計 N = %s = %d" % (" + ".join(str(v) for v in n_ben.values()), N_ben))
    print("1 日に出す印の数の上の境 M = 6,612 + 1,000 = %d" % M)
    print("blind-06 の Haiku の段の記録 %d 件、1 回の最大 $%.7f -> 入力 %.7f / (0.10 / 1,000,000) = %.0f token 以下" % (len(usd), usd_max, usd_max, L_b06))
    print("1 件の上限からの境: (0.40 - 4,000 x 20 / 1,000,000) / (4.0 / 1,000,000) = %.0f バイト" % L_cap)
    print("印の字の数: %d 語 x 6 字 = %d 字" % (CN.K, chars))
    for r in rows:
        print("q=%.2f %-18s L=%6d: 1 文 1 印 %.3e = L x q^%d、見込み N x M x それ = %.3e、1 つ以上の見込み %.3e" % (r["q"], r["L_name"], r["L"], r["p_one_text_one_mark"], chars, r["expected_hits"], r["p_at_least_one"]))
    print("P1(0.5%%)が許す数: N=%d で %d 行まで、E の普通の行が無い時(N=%d)で %d 行まで" % (N_ben, x_allowed, jb + 1000, x_allowed_small))
    print("印どうしが同じになる見込み: M^2 / (2 x V^K) = %d^2 / (2 x %d^%d) = %.3e" % (M, CN.V, CN.K, collide))
    return res

def selftest():
    ok = []
    def check(n, c):
        ok.append(bool(c)); print(("  ok   " if c else "  NG   ") + n)
    check("CP の上の境: 0 of 300 は 0.99%", abs(cp_upper(0, 300) - (1 - 0.05 ** (1 / 300))) < 1e-9)
    check("CP の上の境: blind-06 の L2 の 3 of 1,963 は 0.39%", abs(cp_upper(3, 1963) - 0.0039) < 0.0001)
    check("CP の上の境: blind-06 の L1 の 9 of 270 は 5.74%", abs(cp_upper(9, 270) - 0.0574) < 0.0001)
    x = max_x_for_line(1000, 0.05)
    check("線が許す数: N2 の 1,000 行で 5%% は 38 行まで(blind-06 の L8 と同じ、%d)" % x, x == 38)
    check("線が許す数: GovTech の 3,000 行で 4% は 102 行まで(blind-06 の L3 と同じ)", max_x_for_line(3000, 0.04) == 102)
    print("b07_canary_chance selftest %d / %d %s" % (sum(ok), len(ok), "all green" if all(ok) else "RED"))
    return all(ok)

if __name__ == "__main__":
    a = sys.argv[1:]
    if a == ["selftest"]:
        sys.exit(0 if selftest() else 1)
    if len(a) == 2 and a[0] == "run":
        run(a[1]); sys.exit(0)
    sys.exit("usage: run <out.json> | selftest")
