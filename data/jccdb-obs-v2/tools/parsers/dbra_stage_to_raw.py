# -*- coding: utf-8 -*-
"""dbra_unpack.py で復元した応答を OBS2/raw/ に source_id の名前で置く(US-D-davis-bacon)。

使い方: python3 dbra_stage_to_raw.py <stage ディレクトリ> <OBS2> [除く州略号 ...]
  wd_<WD>_<改訂>.json      -> raw/dol-dbra-<wd 小文字>-<改訂>.json(wdol/v1/wd の応答のバイト列そのまま)
  list_page_<k>.json       -> raw/dol-dbra-index-2026-09-26-p<k>.json(sgs/v1/search?index=dbra の応答)
  dictionaries.json        -> raw/dol-dbra-dictionaries-2026-09-26.json
  取得の記録(url, status, bytes, sha256, 応答ヘッダ, 取得時刻)は raw/dol-dbra-fetch-manifest-2026-09-26.json。
  州の一覧が途中で切れた州(取得を途中で止めた州)は引数で除く。
"""
import sys, os, json, shutil, hashlib, re

stage, root = sys.argv[1], sys.argv[2]
exclude = {s.upper() for s in sys.argv[3:]}
idx = json.load(open(os.path.join(stage, "index.json")))
raw = os.path.join(root, "raw")
man = []
for r in sorted(idx, key=lambda x: x["file"]):
    fn = r["file"]
    m = re.match(r"wd_([A-Z]{2})(\d{8})_(\d+)\.json$", fn)
    if m:
        if m.group(1) in exclude:
            continue
        dst = "dol-dbra-%s%s-%s.json" % (m.group(1).lower(), m.group(2), m.group(3))
    elif fn.startswith("list_page_"):
        dst = "dol-dbra-index-2026-09-26-p%s.json" % re.search(r"(\d+)", fn).group(1)
    elif fn == "dictionaries.json":
        dst = "dol-dbra-dictionaries-2026-09-26.json"
    else:
        continue
    b = open(os.path.join(stage, fn), "rb").read()
    assert hashlib.sha256(b).hexdigest() == r["sha256"] and len(b) == r["bytes"]
    open(os.path.join(raw, dst), "wb").write(b)
    man.append({"raw": "raw/" + dst, "url": r["url"], "status": r["status"], "bytes": r["bytes"], "sha256": r["sha256"],
                "headers": r.get("headers"), "fetched_at": r["fetched_at"], "batch": r["batch"]})
json.dump({"fetched_via": "Apify apify/website-content-crawler (playwright, Apify proxy)。SAM.gov の頁の中で fetch() を呼び、応答のバイト列を頁の中で sha256 し、gzip + base64 で受け取って復元(tools/parsers/dbra_unpack.py)。全応答で sha256 一致",
           "apify_runs": {"batch 0": "lxMcG7H5Z7twIEYhQ (dataset UJXXc4yVGcsdzKLhq)", "batch 1-8": "U7V0tsebQ3eE245lm (dataset YrTymJDDfJb9VVfIN、batch 9-16 の途中で中止)"},
           "excluded_states": sorted(exclude), "files": man},
          open(os.path.join(raw, "dol-dbra-fetch-manifest-2026-09-26.json"), "w"), ensure_ascii=False, indent=0)
print(len(man), "files")
