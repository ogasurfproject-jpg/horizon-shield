# -*- coding: utf-8 -*-
"""Apify web-fetch (formats=["raw"]) の get-dataset-items の結果ファイルから、原本のバイト列を復元する。
使い方: python3 apify_raw_to_file.py <tool-result.txt> <out_path>
  結果: out_path に原本を書き、bytes と sha256 と content-type と last-modified を表示する。
  raw は base64(バイナリ)か文字列(HTML/CSV 等)。どちらかを判定して書く。
"""
import sys, json, base64, hashlib
src, out = sys.argv[1], sys.argv[2]
d = json.load(open(src, encoding="utf-8"))
it = d["items"][0]
raw = it.get("raw")
ct = it.get("fetch.contentType") or (it.get("fetch") or {}).get("contentType") or ""
clen = it.get("fetch.contentLengthBytes") or (it.get("fetch") or {}).get("contentLengthBytes")
lm = it.get("metadata.headers.last-modified") or ""
b = None
if isinstance(raw, str):
    try:
        b = base64.b64decode(raw, validate=True)
        kind = "base64"
    except Exception:
        b = raw.encode("utf-8"); kind = "text"
elif isinstance(raw, dict) and "data" in raw:
    b = bytes(raw["data"]); kind = "buffer"
else:
    sys.exit("raw が無い / 形が不明: " + str(type(raw)))
open(out, "wb").write(b)
print(json.dumps({"out": out, "kind": kind, "bytes": len(b), "content_length_header": clen,
                  "sha256": hashlib.sha256(b).hexdigest(), "content_type": ct, "last_modified": lm,
                  "head": b[:8].hex()}, ensure_ascii=False))
