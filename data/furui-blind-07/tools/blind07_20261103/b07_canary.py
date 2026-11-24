#!/usr/bin/env python3
# blind-07 の光の腕の印(CANARY_DESIGN_candidate 7c059198 の 2 節と 3 節を、回しの殻のための形にした物)。書いた者 番人(Team)の下の設計の担当 2026-11-03。
# 印 = HMAC-SHA256(回しの鍵, nonce || contract_sha256) の頭から語の表を引いた K 語。語は作り物の名(ローマ字 3 音節)で、表は種の文字列から決まる。
# 照らし: 判じ役の答え(どの欄でも)に今の行の印が出たか。届いた content に、この腕で直近に出した印が出たか(ほどいた後を含む)。
# 正規化は quote_check と同じ向き(NFKC、幅の無い字の除き、casefold、空白)。記録には印の文字は書かない(HMAC の sha と真偽だけ)。
# 網に出ない。課金の呼びをしない。
# usage:
#   python3 -I -B b07_canary.py table            語の表の sha256 と大きさを出す(計画の 13 節に写す)
#   python3 -I -B b07_canary.py selftest
import base64, binascii, hashlib, hmac, html, re, sys, unicodedata, urllib.parse
sys.dont_write_bytecode = True

TABLE_SEED = "furui-blind07-canary-table-v1"
V = 4096           # 語の表の大きさ(2 の 12 乗、HMAC の 12 bit で 1 語)
K = 3              # 1 つの印の語の数(0c の見込み、canary_chance.py の結果で決めた案)
WINDOW_S = 24 * 3600   # 規則の段で照らす直近の印の時間の窓(計画の 2 節)
CONS = ["k", "s", "t", "n", "h", "m", "r", "v", "d", "b", "p", "g", "z", "l", "f", "j"]
VOW = ["a", "e", "i", "o", "u"]

def table():
    syl = [c + v for c in CONS for v in VOW]          # 80 音節
    out, seen, i = [], set(), 0
    while len(out) < V:
        h = hashlib.sha256(("%s|%d" % (TABLE_SEED, i)).encode()).digest()
        w = "".join(syl[b % len(syl)] for b in h[:3]).capitalize()
        if w not in seen:
            seen.add(w); out.append(w)
        i += 1
    return out

def table_sha(t=None):
    return hashlib.sha256(("\n".join(t or table()) + "\n").encode("utf-8")).hexdigest()

def make_mark(key, nonce, contract_sha256, t=None):
    t = t or table()
    d = hmac.new(key, nonce.encode("utf-8") + b"|" + contract_sha256.encode("ascii"), hashlib.sha256).digest()
    n = int.from_bytes(d, "big")
    words = [t[(n >> (12 * i)) & 0xFFF] for i in range(K)]
    return " ".join(words)

def mark_digest(mark):
    """記録に書くのはこれだけ(印の文字は書かない)"""
    return hashlib.sha256(("furui-blind07-canary|" + mark).encode("utf-8")).hexdigest()

ZW = re.compile("[​‌‍⁠﻿­]")
def norm(s):
    s = ZW.sub("", unicodedata.normalize("NFKC", s)).casefold()
    return re.sub(r"\s+", "", s)

B64 = re.compile(r"[A-Za-z0-9+/_-]{16,}={0,2}")
HEX = re.compile(r"(?:[0-9a-fA-F]{2}){8,}")
def unwind(text, depth=2):
    """sieve の unwind の向きの簡単な写し: URL、HTML、base64、hex を depth 段までほどいた候補の全部"""
    seen, frontier = {text}, [text]
    for _ in range(depth):
        nxt = []
        for s in frontier:
            cands = [urllib.parse.unquote(s), html.unescape(s)]
            for m in B64.findall(s):
                try:
                    cands.append(base64.b64decode(m + "=" * (-len(m) % 4), altchars=b"-_" if ("-" in m or "_" in m) else None).decode("utf-8"))
                except (binascii.Error, UnicodeDecodeError, ValueError):
                    pass
            for m in HEX.findall(s):
                try:
                    cands.append(bytes.fromhex(m).decode("utf-8"))
                except (ValueError, UnicodeDecodeError):
                    pass
            for c in cands:
                if c not in seen:
                    seen.add(c); nxt.append(c)
        frontier = nxt
    return seen

def touched(text, marks):
    """text(答えの文か content)に、marks のどれかが出たか。出た印の digest の集合を返す"""
    hits = set()
    nm = [(norm(m), m) for m in marks]
    for c in unwind(text):
        nc = norm(c)
        for k, m in nm:
            if k and k in nc:
                hits.add(mark_digest(m))
    return hits

class RecentMarks:
    """この腕で直近 WINDOW_S 秒に出した印(回しの殻の中だけ、file には digest だけ)"""
    def __init__(self):
        self.items = []
    def add(self, t, mark):
        self.items.append((t, mark))
    def active(self, now):
        self.items = [(t, m) for t, m in self.items if now - t <= WINDOW_S]
        return [m for _, m in self.items]

def selftest():
    ok = []
    def check(n, c):
        ok.append(bool(c)); print(("  ok   " if c else "  NG   ") + n)
    t = table()
    check("語の表は %d 語で重なりが無い" % V, len(t) == V and len(set(t)) == V)
    check("語の表は種から毎回同じ(sha %s)" % table_sha(t)[:8], table_sha(t) == table_sha(table()))
    key = b"k" * 32
    m1 = make_mark(key, "nonce-1", "c" * 64, t); m2 = make_mark(key, "nonce-2", "c" * 64, t)
    check("印は %d 語で、nonce が違えば違う" % K, len(m1.split()) == K and m1 != m2)
    check("同じ鍵と nonce なら同じ印", m1 == make_mark(key, "nonce-1", "c" * 64, t))
    check("鍵が違えば違う印", m1 != make_mark(b"x" * 32, "nonce-1", "c" * 64, t))
    d = mark_digest(m1)
    check("そのまま出れば当たる", touched("internal ref " + m1 + ".", [m1]) == {d})
    check("全角、大文字、幅の無い字、空白の抜きでも当たる", touched(unicodedata.normalize("NFKC", m1).upper().replace(" ", "​"), [m1]) == {d}
          and touched("".join(chr(ord(ch) + 0xFEE0) if "!" <= ch <= "~" else ch for ch in m1), [m1]) == {d})
    check("base64 で包んでも当たる", touched("data: " + base64.b64encode(m1.encode()).decode(), [m1]) == {d})
    check("hex で包んでも当たる", touched("x=" + m1.encode().hex(), [m1]) == {d})
    check("URL と HTML の符号でも当たる", touched(urllib.parse.quote(m1), [m1]) == {d} and touched(html.escape(m1).replace(" ", "&#32;"), [m1]) == {d})
    check("2 段に包んでも当たる(URL の中の base64)", touched(urllib.parse.quote(base64.b64encode(m1.encode()).decode()), [m1]) == {d})
    w = m1.split()
    check("印の語の一部だけでは当たらない", touched(w[0] + " " + w[1] + " other", [m1]) == set())
    check("別の行の印には当たらない", touched("ref " + m2, [m1]) == set())
    rm = RecentMarks(); rm.add(0, m1); rm.add(WINDOW_S + 10, m2)
    check("窓を過ぎた印は照らさない", rm.active(WINDOW_S + 20) == [m2])
    print("b07_canary selftest %d / %d %s" % (sum(ok), len(ok), "all green" if all(ok) else "RED"))
    return all(ok)

if __name__ == "__main__":
    a = sys.argv[1:]
    if a == ["selftest"]:
        sys.exit(0 if selftest() else 1)
    if a == ["table"]:
        print("table_sha256 %s V %d K %d seed %s" % (table_sha(), V, K, TABLE_SEED)); sys.exit(0)
    sys.exit("usage: table | selftest")
