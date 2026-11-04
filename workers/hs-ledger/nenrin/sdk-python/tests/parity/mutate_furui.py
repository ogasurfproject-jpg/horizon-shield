"""Mutations of the shared furui vectors: every JSON body of every world, one value at a time replaced by a value of
another type (or removed), a string value given a character before or after it or put in uppercase (a 64 hex value
with a trailing "\n" passed Python's re.match and "$" before 0.8.1, and nowhere else), the OpenTimestamps proofs
cut or flipped at one byte, and a body that is not JSON (a block explorer's hash or header, in
bitcoin_header_vectors.json) cut, extended or changed at one character. Seeded, so every port reads the
same mutated cases. Written as a vectors file without expect: the ports are compared with each other, not with a
frozen answer.

  python3 -I mutate_furui.py <verify_vectors.json> <out.json> [--per-body N] [--seed S]
"""
import base64
import json
import random
import sys

REPL = [None, True, False, 0, 1, -1, 1.5, 9007199254740993, "", "x", "runner-1", [], {}, ["off_topic"], "0" * 64,
        "0" * 64 + "\n", "0" * 64 + "\r", "0" * 64 + " ", "\n" + "0" * 64, "A" * 64, "\uff10" * 64]
# what a string value becomes when it is kept and edged: a character after it, before it, or the value in uppercase
EDGE = [lambda t: t + "\n", lambda t: t + "\r", lambda t: t + " ", lambda t: t + "\r\n", lambda t: "\n" + t, lambda t: " " + t,
        lambda t: t.upper()]


def getp(v, p):
    for k in p:
        v = v[k]
    return v


def paths(v, p=()):
    yield p
    if isinstance(v, dict):
        for k in v:
            yield from paths(v[k], p + (k,))
    elif isinstance(v, list):
        for i, x in enumerate(v):
            yield from paths(x, p + (i,))


def setp(v, p, new, delete=False):
    if not p:
        return new
    v = json.loads(json.dumps(v))
    o = v
    for k in p[:-1]:
        o = o[k]
    if delete and isinstance(o, dict):
        del o[p[-1]]
    elif delete and isinstance(o, list):
        o.pop(p[-1])
    else:
        o[p[-1]] = new
    return v


def main(a):
    src, out = a[0], a[1]
    per = int(a[a.index("--per-body") + 1]) if "--per-body" in a else 6
    rnd = random.Random(int(a[a.index("--seed") + 1]) if "--seed" in a else 20261103)
    doc = json.load(open(src, encoding="utf-8"))
    cases = []
    for c in doc["cases"]:
        if c["command"] == "ots-parse":
            continue
        for url in sorted(c["world"]):
            w = c["world"][url]
            if "body_b64" in w:
                b = bytearray(base64.b64decode(w["body_b64"]))
                for j in range(per):
                    m = bytearray(b)
                    i = rnd.randrange(len(m))
                    if j % 2:
                        m = m[:i]
                    else:
                        m[i] ^= 1 << rnd.randrange(8)
                    nw = dict(c["world"], **{url: {"status": 200, "body_b64": base64.b64encode(bytes(m)).decode()}})
                    cases.append({"name": "%s | %s | ots %d" % (c["name"], url, j), "command": c["command"], "args": c["args"], "world": nw})
                continue
            try:
                body = json.loads(w["body"])
            except ValueError:
                t = w["body"]
                for j in range(per):
                    i = rnd.randrange(len(t) + 1)
                    k = j % 4
                    if k == 0:
                        m = t[:i]
                    elif k == 1:
                        m = t + rnd.choice(["\n", " ", "0", "\r\n"])
                    else:
                        m = t[:i] + rnd.choice(["0", "f", "F", "g", "\n", " ", "\u00e9", ""]) + t[i + 1:]
                    st = w["status"] if rnd.random() < 0.9 else rnd.choice([404, 429, 500])
                    nw = dict(c["world"], **{url: {"status": st, "body": m}})
                    cases.append({"name": "%s | %s | text %d" % (c["name"], url, j), "command": c["command"], "args": c["args"], "world": nw})
                continue
            ps = list(paths(body))
            for j in range(per):
                p = ps[rnd.randrange(len(ps))]
                cur = getp(body, p)
                if p and rnd.random() < 0.25:
                    nb = setp(body, p, None, delete=True)
                    what = "del"
                elif isinstance(cur, str) and rnd.random() < 0.4:
                    k = rnd.randrange(len(EDGE))
                    nb = setp(body, p, EDGE[k](cur))
                    what = "edge%d" % k
                else:
                    r = REPL[rnd.randrange(len(REPL))]
                    nb = setp(body, p, r)
                    what = json.dumps(r)
                # a string value inside an embedded canonical record is mutated through its text as well
                if isinstance(nb, dict) and isinstance(nb.get("record_canonical"), str) and rnd.random() < 0.3:
                    t = nb["record_canonical"]
                    i = rnd.randrange(max(1, len(t)))
                    nb["record_canonical"] = t[:i] + rnd.choice(["0", "1", "a", '"', "}", ""]) + t[i + 1:]
                st = w["status"] if rnd.random() < 0.95 else rnd.choice([404, 410, 500])
                nw = dict(c["world"], **{url: {"status": st, "body": json.dumps(nb, ensure_ascii=False)}})
                cases.append({"name": "%s | %s | %s %s" % (c["name"], url, "/".join(map(str, p)), what), "command": c["command"], "args": c["args"], "world": nw})
    json.dump({"schema": "nenrin-furui-verify-mutations-v1", "cases": cases}, open(out, "w", encoding="utf-8"), ensure_ascii=False)
    print("%d mutated cases" % len(cases))


if __name__ == "__main__":
    main(sys.argv[1:])
