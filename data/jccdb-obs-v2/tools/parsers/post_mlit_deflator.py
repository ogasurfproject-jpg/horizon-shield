# -*- coding: utf-8 -*-
"""
建設工事費デフレーターの parser(parse_mlit_deflator.py)のあとに、2026-09-26 番人の判断
(tools/apply_decisions_20260926.py の hold_deflator と realign_deflator)を、選んだ月次の版で当てる。

apply_decisions_20260926.realign_deflator は月別の原本を raw/mlit-deflator-tsuki-2606.xlsx に決め打ちしている。
ここでは関数の中身を変えず、その場所だけを選んだ版の原本に差し替えて呼ぶ。
保留のファイル(observations_hold/jp/index_mlit_deflator_suspect_shift.csv)は「前からある行 + 新しい行」で書く作りなので、
選んだ版と違う月次の版の行を先に外す(同じ時点の保留が二つの版で並ばないように)。
年度別の保留(index_mlit_deflator_nendo_suspect_shift.csv)も同じく、選んだ年度次の版と違う版の行を先に外す
(2026-11-02 に年度次の版 defnendo_261030 が出たので --nendo を足した。省くと 260630 で、今までと同じ)。

使い方: python3 post_mlit_deflator.py [--month 2606|2607|2608] [--nendo 260630|261030]
        (OBS2 はこのファイルの場所から決まる。--month を省くと 2606、--nendo を省くと 260630)
"""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OBS2 = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(OBS2, "tools"))
import apply_decisions_20260926 as A  # noqa: E402
from obs_common import write_obs  # noqa: E402

MONTH = sys.argv[sys.argv.index("--month") + 1] if "--month" in sys.argv else "2606"
SID_M = "mlit-deflator-tsuki-%s" % MONTH
NENDO = sys.argv[sys.argv.index("--nendo") + 1] if "--nendo" in sys.argv else "260630"
SID_Y = "mlit-deflator-nendo-%s" % NENDO


def main():
    assert os.path.abspath(A.ROOT) == OBS2, (A.ROOT, OBS2)
    raw_m = A.J("raw", SID_M + ".xlsx")
    assert os.path.exists(raw_m), raw_m
    assert os.path.exists(A.J("raw", SID_Y + ".xlsx")), SID_Y
    for fn, sid in (("index_mlit_deflator_suspect_shift.csv", SID_M), ("index_mlit_deflator_nendo_suspect_shift.csv", SID_Y)):
        hp = A.J("observations_hold", "jp", fn)
        if os.path.exists(hp):
            rows = A.read(hp)
            keep = [r for r in rows if r["source_id"] == sid]
            if len(keep) != len(rows):
                write_obs(hp, keep)
                print("前の版の保留を外した:", fn, len(rows) - len(keep))
    orig = A.J

    def J(*p):
        if p == ("raw", "mlit-deflator-tsuki-2606.xlsx"):
            return orig("raw", SID_M + ".xlsx")
        return orig(*p)

    A.J = J
    try:
        A.hold_deflator()
        A.realign_deflator()
    finally:
        A.J = orig


if __name__ == "__main__":
    main()
