# -*- coding: utf-8 -*-
"""Davis-Bacon (SAM.gov WDOL API) の取得結果を復元する(US-D-davis-bacon)。

取得の仕組み: Apify apify/website-content-crawler(playwright、Apify proxy)で SAM.gov の頁を開き、
pageFunction が頁の中から fetch() で SAM.gov の公開 API(検索 sgs/v1/search?index=dbra と wdol/v1/wd/<WD>/<改訂>)を呼ぶ。
応答のバイト列(fetch の arrayBuffer)を頁の中で sha256 し、全部をつないで gzip + base64 にして <pre id=claude-out> に書く。
crawler の text 欄に「meta JSON @@B64@@ base64 @@END@@」が入る。

使い方: python3 dbra_unpack.py <get-dataset-items の結果ファイル> <出力ディレクトリ>
  各応答を <出力ディレクトリ>/<ファイル名> に書き、頁の中で測った sha256 と一致するか確かめる。
  一覧(index.json)に url, status, bytes, sha256, 応答ヘッダを残す。
"""
import sys, json, base64, gzip, hashlib, os, re

src, outdir = sys.argv[1], sys.argv[2]
os.makedirs(outdir, exist_ok=True)
d = json.load(open(src, encoding="utf-8"))
res = []
for it in d["items"]:
    t = it["text"]
    a, rest = t.split("@@B64@@", 1)
    b64, _ = rest.split("@@END@@", 1)
    meta = json.loads(a.strip())
    gz = base64.b64decode(re.sub(r"\s+", "", b64))
    assert len(gz) == meta["gzlen"], ("gzlen", len(gz), meta["gzlen"])
    assert hashlib.sha256(gz).hexdigest() == meta["gzsha256"], "gz sha256"
    buf = gzip.decompress(gz)
    assert len(buf) == meta["total"], ("total", len(buf), meta["total"])
    for e in meta["index"]:
        b = buf[e["off"]:e["off"] + e["len"]]
        h = hashlib.sha256(b).hexdigest()
        assert h == e["sha256"], ("sha256", e["url"])
        u = e["url"]
        m = re.search(r"/wdol/v1/wd/([A-Z0-9]+)/(\d+)\?", u)
        if m:
            fn = "wd_%s_%s.json" % (m.group(1), m.group(2))
        elif "sgs/v1/search" in u:
            fn = "list_page_%s.json" % re.search(r"&page=(\d+)", u).group(1)
        elif "dictionaries" in u:
            fn = "dictionaries.json"
        else:
            fn = "other_%s.bin" % h[:12]
        open(os.path.join(outdir, fn), "wb").write(b)
        res.append({"file": fn, "url": u, "status": e["status"], "bytes": len(b), "sha256": h,
                    "headers": e.get("headers"), "err": e.get("err"), "batch": meta["batch"],
                    "fetched_at": meta["fetched_at"]})
idx_path = os.path.join(outdir, "index.json")
old = json.load(open(idx_path)) if os.path.exists(idx_path) else []
seen = {r["file"] for r in res}
merged = [r for r in old if r["file"] not in seen] + res
json.dump(merged, open(idx_path, "w"), indent=0)
bad = [r for r in res if r["status"] != 200]
print(json.dumps({"items": len(d["items"]), "responses": len(res), "non200": len(bad),
                  "bytes": sum(r["bytes"] for r in res), "batches": sorted({r["batch"] for r in res}),
                  "index_total": len(merged)}))
for r in bad[:10]:
    print("NON200", r["status"], r["url"], r.get("err"))
