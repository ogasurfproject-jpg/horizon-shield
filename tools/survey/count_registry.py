#!/usr/bin/env python3
# レジストリの登録状態を数える(survey0 v4)。
# 2026-08-24: リポジトリの根に未追跡で置かれていたものを tools/survey/ に入れた。
#   報告書0の数字を出したのはこの道具である。だが道具は版管理の外にいた。
#   「手順を先に公開する」「レシピを添える」と書いておきながら、
#   レシピそのものが .gitignore の中にいた。同じ形を今日もう一度踏んだ。
#
# 元の説明:
# survey0 v4: 登録状態を数える。v3 は「生きている登録」と「消された登録」を混ぜていた。
#
# v3 が出したもの（2026-08-19 実測・全件到達）:
#   229 ページ / 22887 名前 / 外から叩ける名前 12133 / https 12484本 / ホスト 9138
#
#   数え方は正しかった。だが **数えた対象が正しいかを確かめていなかった。**
#
# 公開前に確かめたこと（2026-08-19 実測）:
#   各エントリの _meta にこれが入っている。
#     "_meta":{"io.modelcontextprotocol.registry/official":{
#        "status":"active","statusChangedAt":...,"publishedAt":...,"isLatest":true}}
#
#   **status がある。** active 以外の値が混ざっていれば、22887 は過大になる。
#   「レジストリに22887本ある」と書く前に、そのうち何本が生きている登録かを数える。
#
# v4 でやること:
#   A. status ごとに数える。active とそれ以外を分ける
#   B. 「外から叩ける」も active に限った数を出す
#   C. publishedAt から、直近30日・90日の登録数を出す
#      ★これは記事の骨になる。母数が古いのか新しいのかで意味が変わる
#   D. https のホストの集中度を出す
#      12484本が9138ホスト。**名前とホストは一対一ではない。**
#      共有基盤に相乗りしている本数を、そのまま出す
#
# やらないこと（v1-v3 と同じ）:
#   1本も叩かない。生きているかは主張しない。それはゲートの仕事。
import json, urllib.request, urllib.parse, urllib.error, time, collections, hashlib, os, sys, datetime

BASE = "https://registry.modelcontextprotocol.io"
PATH = "/v0/servers"
UA = "HorizonShieldSurvey/0.4 (+https://shield.the-horizons-innovation.com/verify-directory/survey/)"
# 2026-08-24: ここは ~/Desktop/hs-docfix/survey の決め打ちだった。
#   その結果、この道具は「その機械のその場所」でしか動かなかった。
#   月に一度回すには、CI からも worktree からも動かなければならない。
#   出し先を引数と環境変数にする。既定は、いままでと同じ場所。
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.abspath(os.path.join(_HERE, "..", ".."))
OUT = (os.environ.get("SURVEY_OUT")
       or (sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("-") else None)
       or os.path.join(_ROOT, "verify-directory", "survey", "data"))
PAGE_SLEEP = 0.15
PAGE_CAP = 6000
OFFICIAL = "io.modelcontextprotocol.registry/official"


def get(url, tries=3):
    last = None
    for i in range(tries):
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:
            last = e
            time.sleep(1.5 * (i + 1))
    raise last


print("手順0  robots.txt を読む")
try:
    rob = get(BASE + "/robots.txt", tries=1)
except urllib.error.HTTPError as e:
    if e.code == 404:
        rob = ""
        print("  robots.txt は 404。禁止の記述は無い")
    else:
        sys.exit("  NG: robots.txt が読めない (%s)。止める。" % e)
except Exception as e:
    sys.exit("  NG: robots.txt が読めない (%s)。止める。" % e)
if rob:
    bad = [l for l in rob.lower().splitlines()
           if l.strip().startswith("disallow:") and ("/v0" in l or l.strip() == "disallow: /")]
    if bad:
        for l in bad:
            print("  該当:", l.strip())
        sys.exit("  NG: /v0/ が禁じられている。止める。")
print("  OK: /v0/ を禁じる記述は見つからなかった")
print()

os.makedirs(OUT, exist_ok=True)
stamp = datetime.date.today().isoformat()
now = datetime.datetime.now(datetime.timezone.utc)
PROG = os.path.join(OUT, "survey0_v4_progress_%s.jsonl" % stamp)
prog = open(PROG, "w", encoding="utf-8")

print("手順1  レジストリを取る（limit=100 & version=latest）")
print("  ★今回は登録状態（status）も数える。active 以外を混ぜたまま公開しない。")
print()


def parse_ts(s):
    if not s:
        return None
    try:
        t = s.replace("Z", "+00:00")
        if "." in t:
            head, rest = t.split(".", 1)
            frac = "".join(c for c in rest if c.isdigit())[:6]
            tz = rest[len(("".join(c for c in rest if c.isdigit()))):] or "+00:00"
            tz = rest[-6:] if (rest.endswith("+00:00") or rest.endswith("-00:00")) else "+00:00"
            t = head + "." + frac + tz
        return datetime.datetime.fromisoformat(t)
    except Exception:
        return None


cur = None
pages = 0
entries = 0
rows = {}
seen_cursors = set()
stop_reason = "cursor exhausted"

while True:
    q = {"limit": "100", "version": "latest"}
    if cur:
        q["cursor"] = cur
    url = BASE + PATH + "?" + urllib.parse.urlencode(q)
    try:
        d = json.loads(get(url))
    except Exception as e:
        stop_reason = "fetch failed on page %d: %s" % (pages + 1, e)
        print("\n  中断: %s" % stop_reason)
        break

    servers = d.get("servers") or []
    if not servers:
        stop_reason = "empty page"
        break

    for s in servers:
        sv = s.get("server", s)
        entries += 1
        nm = sv.get("name") or ""
        off = ((s.get("_meta") or sv.get("_meta") or {}).get(OFFICIAL) or {})
        https = set()
        types = set()
        for x in (sv.get("remotes") or []):
            u = (x.get("url") or "").strip()
            types.add(x.get("type") or "?")
            if u.lower().startswith("https://"):
                https.add(u)
        rows[nm] = {
            "status": off.get("status") or "unknown",
            "publishedAt": off.get("publishedAt") or "",
            "https": https,
            "types": types,
        }

    meta = d.get("metadata") or {}
    nxt = meta.get("nextCursor") or d.get("nextCursor")
    pages += 1
    act = sum(1 for v in rows.values() if v["status"] == "active")
    prog.write(json.dumps({"page": pages, "entries": entries, "names": len(rows), "active": act}) + "\n")
    prog.flush()
    sys.stdout.write("\r  %5d ページ / %7d 件 / 名前 %6d / active %6d   " % (pages, entries, len(rows), act))
    sys.stdout.flush()

    if not nxt:
        stop_reason = "cursor exhausted"
        break
    if nxt in seen_cursors:
        stop_reason = "cursor repeated (%s)" % nxt
        print("\n  ★止めた: 同じカーソルが二度来た。")
        break
    seen_cursors.add(nxt)
    cur = nxt
    if pages >= PAGE_CAP:
        stop_reason = "page cap %d reached" % PAGE_CAP
        print("\n  ★止めた: ページ上限に当たった。全件ではない。")
        break
    time.sleep(PAGE_SLEEP)

prog.close()
print()
print()

complete = stop_reason in ("cursor exhausted", "empty page")
by_status = collections.Counter(v["status"] for v in rows.values())
active = {k: v for k, v in rows.items() if v["status"] == "active"}
act_https = {k: v for k, v in active.items() if v["https"]}
all_https_urls = set()
for v in act_https.values():
    all_https_urls |= v["https"]
hosts = collections.Counter()
for u in all_https_urls:
    try:
        hosts[urllib.parse.urlsplit(u).hostname or "?"] += 1
    except Exception:
        hosts["?"] += 1
types = collections.Counter()
for v in active.values():
    for t in v["types"]:
        types[t] += 1

d30 = d90 = 0
for v in active.values():
    t = parse_ts(v["publishedAt"])
    if not t:
        continue
    age = (now - t).days
    if age <= 30:
        d30 += 1
    if age <= 90:
        d90 += 1

shared = sum(c for h, c in hosts.items() if c > 1)
shared_hosts = sum(1 for h, c in hosts.items() if c > 1)

print("測った結果（%s）" % stamp)
print("  出所                        %s%s?version=latest" % (BASE, PATH))
print("  ページ数                    %d" % pages)
print("  止まった理由                %s" % stop_reason)
print("  ★全件か                     %s" % ("はい。最後まで辿った" if complete else "いいえ。第0報には出さない"))
print()
print("  ★登録（最新版・全状態）      %d" % len(rows))
for st, n in by_status.most_common():
    print("     status %-12s %6d" % (st, n))
print()
print("  ★生きている登録 active       %d" % len(active))
print("  ★そのうち外から叩ける名前     %d" % len(act_https))
if active:
    print("     割合                     %.1f%%" % (100.0 * len(act_https) / len(active)))
print("  https エンドポイント本数     %d" % len(all_https_urls))
print("  ユニークなホスト数           %d" % len(hosts))
print("  ★2本以上が相乗りしているホスト %d ホストに %d 本" % (shared_hosts, shared))
print("  transport の内訳            %s" % dict(types))
print()
print("  直近30日に公開された active  %d" % d30)
print("  直近90日に公開された active  %d" % d90)
print()
print("  ★これは「宣言されている本数」。生きているかは1本も確かめていない。")
print("  ★手順3（実際に initialize が返るか）はゲートの仕事。ここでは1回も叩いていない。")
print()

rec = {
    "measured_at": now.isoformat(),
    "tool": "survey0_count_v4",
    "source": BASE + PATH + "?version=latest",
    "user_agent": UA,
    "complete": complete,
    "stop_reason": stop_reason,
    "pages": pages,
    "entries_returned": entries,
    "registrations_latest_all_statuses": len(rows),
    "by_status": dict(by_status),
    "active": len(active),
    "active_with_https_remote": len(act_https),
    "https_endpoints_active": len(all_https_urls),
    "unique_hosts_active": len(hosts),
    "hosts_with_more_than_one_endpoint": shared_hosts,
    "endpoints_on_shared_hosts": shared,
    "transport_types_active": dict(types),
    "active_published_last_30_days": d30,
    "active_published_last_90_days": d90,
    "top_hosts": hosts.most_common(40),
    "note": "declared endpoints only. liveness not measured here. active means the registry's own status field.",
}
blob = json.dumps(rec, ensure_ascii=False, indent=2, sort_keys=True).encode("utf-8")
p_json = os.path.join(OUT, "survey0_v4_%s.json" % stamp)
open(p_json, "wb").write(blob)

p_txt = os.path.join(OUT, "survey0_v4_endpoints_active_%s.txt" % stamp)
with open(p_txt, "w", encoding="utf-8") as f:
    for u in sorted(all_https_urls):
        f.write(u + "\n")

print("記録        %s" % p_json)
print("一覧        %s  (%d 本)" % (p_txt, len(all_https_urls)))
print("sha256      %s" % hashlib.sha256(blob).hexdigest())
print()
if complete:
    print("★全件を辿れた。この数字が第0報の見出しになる。")
else:
    print("★全件ではない。第0報には出さない。")
