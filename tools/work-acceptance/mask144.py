"""Copy vectors LO..HI keeping only inputs, vector name and license. Prints key names and counts only, never values of removed fields.
Usage: python3 -I -B mask144.py SRC_VECTORS_DIR DST_DIR LO HI"""
import json, sys, os, collections
KEEP = {"inputs", "vector", "license"}
src, dst, lo, hi = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
os.makedirs(dst, exist_ok=True)
removed_c = collections.Counter(); exp_keys = collections.Counter(); n = 0
for fn in sorted(os.listdir(src)):
    if not fn.endswith(".json"):
        continue
    num = int(fn.split("-")[0])
    if not (lo <= num <= hi):
        continue
    d = json.loads(open(os.path.join(src, fn), "rb").read())
    for k in d:
        if k not in KEEP:
            removed_c[k] += 1
    e = d.get("expected")
    if isinstance(e, dict):
        for k in e:
            exp_keys[k] += 1
    m = {k: v for k, v in d.items() if k in KEEP}
    with open(os.path.join(dst, fn), "w") as f:
        json.dump(m, f, indent=1, sort_keys=True)
    n += 1
print("files", n)
print("removed field names:", dict(sorted(removed_c.items())))
print("names inside expected (no values):", dict(sorted(exp_keys.items())))
