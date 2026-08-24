# -*- coding: utf-8 -*-
"""内部MCPが読む算定要件を、JHNRD から作る。

なぜ生成にするか:
  同じ事実を二箇所に書けば、いつか片方だけ直る。
  worker の中に単位数を手で書けば、JHNRD を直しても worker は古いままになる。
  落ちない。例外も出ない。ただ古い数字が出続ける。

  だから worker が読むファイルは、必ずここから作る。
  作ったものには「写しである」印と、元の sha256 を入れる。
  印の無い写しは、誰かが手で書き換えても分からない。

  現場からの報告(field_reports)は入れない。
  事業所が毎月扱っている事実は貴重だが、それは「実際どう運用されているか」であって
  「何が定められているか」ではない。内部MCPが規則として読めば、その瞬間に
  「事業所が言ったこと」が「制度が定めたこと」にすり替わる。

  python3 tools/nursing/build_mcp_rules.py --check   ずれているかを見るだけ
  python3 tools/nursing/build_mcp_rules.py --write   作り直す
"""
import argparse
import hashlib
import io
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import migrate_questions as MQ  # noqa: E402  DB の場所の決め方を1箇所に寄せる

HS = MQ.HS
DB = MQ.DB
OUT = os.path.join(HS, "workers", "hs-nursing-mcp", "src", "rules.js")


def trim(db):
    """worker に渡すぶんだけを取る。要らないものを持ち出さない。"""
    revs = {r["id"]: r for r in (db.get("revisions") or [])}

    src = {}
    for sid, s in (db.get("sources") or {}).items():
        src[sid] = {
            "title": s.get("title"),
            "url": s.get("url"),
            "publisher": s.get("publisher"),
            "tier": s.get("tier"),
            "current": s.get("current"),
            "not_current_reason": s.get("not_current_reason"),
            "retrieved_at": s.get("retrieved_at"),
        }

    items = []
    for it in (db.get("items") or []):
        eff = it.get("effect") or {}
        rid = eff.get("revision") or it.get("revision")
        rc = eff.get("revision_recheck") or it.get("revision_recheck") or {}
        rev = revs.get(rid) or {}
        reqs = []
        for key in ("requirements", "rules", "watch"):
            for r in (it.get(key) or []):
                reqs.append({
                    "kind": key,
                    "id": r.get("id"),
                    "text": r.get("text"),
                    "ask": r.get("ask"),
                    "confirmed": bool(r.get("confirmed")),
                    "unconfirmed_reason": r.get("unconfirmed_reason"),
                    "source_ref": r.get("source_ref") or [],
                })
        items.append({
            "id": it.get("id"),
            "kind": it.get("kind"),
            "insurance": it.get("insurance"),
            "name": it.get("name"),
            "effect": {
                "type": eff.get("type"),
                "value": eff.get("value"),
                "confirmed": bool(eff.get("confirmed")),
                "unconfirmed_reason": eff.get("unconfirmed_reason"),
                "source_ref": eff.get("source_ref") or [],
            },
            "revision": rid,
            "revision_name": rev.get("name"),
            "effective_from": rev.get("effective_from"),
            "superseded_by": rev.get("superseded_by"),
            "recheck_needed": bool(rc.get("needed")),
            "recheck_why": rc.get("why"),
            "requirements": reqs,
            "we_do_not_say": it.get("we_do_not_say"),
            "sources": it.get("sources") or [],
            "beppyo7": (it.get("beppyo7") or {}).get("list"),
        })

    qs = {}
    for q in (db.get("questions") or []):
        qs[q["id"]] = {"text": q.get("text"), "purpose": q.get("purpose"), "w": q.get("w")}

    return {
        "version": db.get("version"),
        "revision_label": db.get("revision"),
        "built_at": db.get("built_at"),
        "revisions": db.get("revisions") or [],
        "sources": src,
        "items": items,
        "questions": qs,
        "known_gaps": db.get("known_gaps") or [],
        "conflicts": db.get("conflicts") or [],
        "discipline": db.get("discipline") or [],
    }


def render(payload, sha):
    body = json.dumps(payload, ensure_ascii=False, indent=2)
    head = (
        "/* このファイルは生成物である。手で書き換えないこと。\n"
        "   元         : JHNRD data/rules_2024.json\n"
        "   元の版     : " + str(payload.get("version")) + "\n"
        "   元の sha256: " + sha + "\n"
        "   作り直す   : python3 tools/nursing/build_mcp_rules.py --write\n"
        "\n"
        "   ここに数字を手で足さないこと。足しても JHNRD には戻らないので、\n"
        "   公開データベースと内部MCPが別のことを言う状態になる。\n"
        "   そのずれは落ちない。例外も出ない。ただ違う数字が出続ける。 */\n"
    )
    return (head
            + "export const SOURCE_SHA256 = " + json.dumps(sha) + ";\n"
            + "export const RULES = " + body + ";\n"
            + "export default RULES;\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()

    raw = io.open(DB, "rb").read()
    sha = hashlib.sha256(raw).hexdigest()
    db = json.loads(raw.decode("utf-8"))
    payload = trim(db)
    want = render(payload, sha)

    print("元       : %s" % DB)
    print("元の版   : %s / 項目 %d / 設問 %d"
          % (payload["version"], len(payload["items"]), len(payload["questions"])))
    print("読んだ先 : %s" % ("リポジトリ内の写し" if MQ.DB_IS_COPY else "JHNRD 本体"))
    print("出力     : %s" % os.path.relpath(OUT, HS))

    have = io.open(OUT, encoding="utf-8").read() if os.path.exists(OUT) else ""
    if have == want:
        print("\nずれはありません。")
        return 0

    if not a.write:
        print("\nずれています。")
        if not have:
            print("  出力がまだありません。")
        else:
            import difflib
            d = list(difflib.unified_diff(have.splitlines(), want.splitlines(),
                                          lineterm="", n=0))
            print("  差分 %d 行(先頭だけ):" % len(d))
            for line in d[:12]:
                print("    " + line[:120])
        print("\n作り直すには --write を付けてください。")
        return 1

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    io.open(OUT, "w", encoding="utf-8").write(want)
    print("\n作り直しました。%d バイト" % len(want))

    # 出したものが JavaScript として通るかを、JavaScript の目で見る。
    # Python で組み立てて Python で読み直しても、通ることの確認にならない。
    # 2026-08-23、実際に Python の読み直しは通り node で落ちる生成物を作った。
    r = subprocess.run(["node", "--check", OUT], capture_output=True, text=True)
    if r.returncode != 0:
        io.open(OUT, "w", encoding="utf-8").write(have)
        sys.stderr.write("\nnode --check が落ちたので、元に戻しました。\n" + r.stderr + "\n")
        return 2
    print("node --check 通過。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
