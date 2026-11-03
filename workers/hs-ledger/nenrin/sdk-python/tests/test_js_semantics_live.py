"""The JavaScript semantics in _js.py against Node itself: number text, Date.parse, Buffer base64, string escaping,
ToNumber-coerced sorting. Skipped without Node."""
import json
import random
import shutil
import subprocess

import pytest

from nenrin_verify import _js

pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="needs node")

NODE = r"""
const inp = JSON.parse(require("fs").readFileSync(0, "utf8"));
const out = {
  num: inp.num.map((x) => JSON.stringify(x)),
  date: inp.date.map((s) => { const v = Date.parse(s); return Number.isNaN(v) ? null : v; }),
  b64: inp.b64.map((s) => Buffer.from(s, "base64").toString("hex")),
  quote: inp.quote.map((s) => JSON.stringify(s)),
  sort: inp.sort.map((a) => JSON.stringify(a.slice().sort((x, y) => x - y))),
  keys: inp.keys.map((ks) => { const o = {}; for (const k of ks) o[k] = 0; return Object.keys(o); }),
};
process.stdout.write(JSON.stringify(out));
"""


def test_against_node():
    rnd = random.Random(20261001)
    nums = [0, 1, -1, 2 ** 53 - 1, 1e21, 1e-7, 1.5, 0.1, 123456789012345680000.0, 5e-324, 1.7976931348623157e308, 1e16, 1e20, 123e-20]
    nums += [rnd.uniform(-1e6, 1e6) for _ in range(300)] + [rnd.random() * 10 ** rnd.randint(-30, 30) for _ in range(300)]
    dates = []
    for _ in range(1500):
        y, mo, d = rnd.randint(0, 9999), rnd.randint(0, 13), rnd.randint(0, 32)
        h, mi, s = rnd.choice([0, 12, 23, 24, 25]), rnd.choice([0, 30, 59, 60]), rnd.choice([0, 1, 59, 60])
        frac = rnd.choice(["", ".0", ".1", ".1234", ".0001", ".000", ".9999999"])
        dates.append("%04d-%02d-%02dT%02d:%02d:%02d%sZ" % (y, mo, d, h, mi, s, frac))
    alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/-_= !\n."
    b64 = ["".join(rnd.choice(alpha) for _ in range(rnd.randint(0, 20))) for _ in range(800)]
    quotes = ["".join(chr(rnd.choice([rnd.randint(0, 0x7f), rnd.randint(0x80, 0xffff), rnd.randint(0x10000, 0x10ffff)])) for _ in range(rnd.randint(0, 8))) for _ in range(500)]
    quotes = [q for q in quotes if not any(0xD800 <= ord(c) <= 0xDFFF for c in q)] + ["\ud800", "a\udc00b"]
    pool = [0, 1, 2, "1", "0", "", " 2 ", "0x10", "1e1", True, False, None, [], [3], [1, 2], {}, "abc", -1, 0.5, "Infinity"]
    sorts = [[rnd.choice(pool) for _ in range(rnd.randint(2, 9))] for _ in range(1500)]
    # own property order: "1\n", " 1", "01" and "\u0661" are not array indexes in JavaScript (0.8.1: _INDEX is fullmatch)
    kpool = ["0", "1", "2", "10", "01", "1\n", "2\n", " 1", "1 ", "\u0661", "-1", "1.0", "4294967294", "4294967295", "a", "b", ""]
    keys = [list(dict.fromkeys(rnd.choice(kpool) for _ in range(rnd.randint(1, 8)))) for _ in range(500)]
    payload = {"num": nums, "date": dates, "b64": b64, "quote": quotes, "sort": sorts, "keys": keys}
    text = json.dumps(payload, ensure_ascii=True)
    p = subprocess.run(["node", "-e", NODE], input=text, capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    js = json.loads(p.stdout)
    back = json.loads(text)
    assert [_js.num_str(x) for x in back["num"]] == js["num"]
    assert [_js.date_parse(s) for s in back["date"]] == js["date"]
    assert [_js.node_b64decode(s).hex() for s in back["b64"]] == js["b64"]
    assert [_js.quote(s) for s in back["quote"]] == js["quote"]
    for a, want in zip(back["sort"], js["sort"]):
        assert _js.stringify(_js.sort_numeric(a)) == want, a
    assert [_js._js_key_order(ks) for ks in back["keys"]] == js["keys"]
