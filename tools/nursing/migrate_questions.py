# -*- coding: utf-8 -*-
"""
ヒアリングの設問文を、industry.js から、データベース側へ一度だけ移す。

なぜ (2026-08-23):
  いまは DB の要件に ask: "q_nv_bcp_plan" と書き、その文面は industry.js に
  手で書いている。2箇所に手で書いて、対応表も手で保っている。
  8項目のうちは持つ。加算が100件になったら持たない。
  必ず、聞いていない要件か、どの要件のためでもない設問が生まれる。
  そしてずれても落ちない。「その要件について誰にも尋ねていない」状態が静かに残る。

  向きを変える。設問文を DB 側に置き、industry.js の bank を生成する。

行き先を2つに分ける:
  ・算定要件を確かめる設問と、DBの穴を埋めるための現場質問  -> JHNRD(公開)
      公開の算定要件データベースにとって「この要件をどう尋ねるか」は中身である。
  ・業務・集客・採用の設問                                  -> hs-docfix(非公開)
      これは弊社の営業の台本であって、公開データベースの中身ではない。

これは移行であって、書き直しではない:
  文面は1字も変えない。順序も変えない。
  (順序は nextQuestions の同点時の並び順に効くため、変えれば挙動が変わる)
  移行後に bank を作り直し、移行前と1字でも違えば異常終了する。

使い方:
  python3 tools/nursing/migrate_questions.py            下見
  python3 tools/nursing/migrate_questions.py --apply    実行
"""

import io, json, os, re, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))


def find_repo(start, marker):
    d = os.path.abspath(start)
    for _ in range(6):
        if os.path.exists(os.path.join(d, marker)):
            return d
        p = os.path.dirname(d)
        if p == d:
            break
        d = p
    return None


HS = find_repo(HERE, os.path.join("tools", "yakumo", "generate.py"))
if not HS:
    sys.stderr.write("\nhs-docfix の根が見つかりません。\n\n"); sys.exit(1)

JHNRD = os.environ.get("JHNRD_REPO") or os.path.join(os.path.dirname(HS), "jhnrd")

# 本物(JHNRD)が手元にあればそれを見る。無ければ、こちらに置いた写しを見る。
# CI には JHNRD を置いていないので、写しで検査する。写しが本物と合っていることは
# sync_db.py が別に見ている。ここで黙って写しに落ちると、どちらを見たのか
# 分からなくなるので、必ずどちらを見たかを表示する。
DB_OWNER = os.path.join(JHNRD, "data", "rules_2024.json")
DB_COPY = os.path.join(HS, "data", "nursing", "rules_2024.json")


def _seed(path):
    """版の末尾の数(seed.N)を返す。読めなければ None。"""
    try:
        import json as _json
        v = str(_json.load(io.open(path, encoding="utf-8")).get("version") or "")
    except Exception:
        return None
    tail = v.rsplit(".", 1)[-1]
    return int(tail) if tail.isdigit() else None


# 2026-08-24: ここは「持ち主のファイルが在れば持ち主を見る」だった。
#   在ることと、新しいことは別である。
#   実測: このコンテナの隣に seed.6(設問0問)の古い JHNRD が置いてあり、
#   リポジトリ内の写しは seed.8(設問18問)だった。道具は黙って seed.6 を読み、
#   模擬サーバの試験が「q_nv_shido が出力に無い」で落ちた。
#   コードは正しく、読んでいた世界が古かった。走行1と、古い .mjs の写しと、同じ型である。
#
#   だから、どちらが新しいかを見る。持ち主が写しより古ければ、黙って選ばない。
#   どちらを見るべきかは人が決めることなので、止めて名前を出す。
DB_FORCED = os.environ.get("HS_NURSING_DB")
DB_PICK_NOTE = ""
if DB_FORCED:
    DB = DB_FORCED
    DB_PICK_NOTE = "HS_NURSING_DB で指定されたものを見ています"
elif not os.path.exists(DB_OWNER):
    DB = DB_COPY
    DB_PICK_NOTE = "JHNRD が手元に無いので、リポジトリ内の写しを見ています"
else:
    so, sc = _seed(DB_OWNER), _seed(DB_COPY)
    if so is not None and sc is not None and so < sc:
        sys.stderr.write(
            "\n持ち主のデータベースが、写しより古いです。どちらを見るべきかを決められません。\n"
            "  持ち主 %s  版 seed.%d\n"
            "  写し   %s  版 seed.%d\n\n"
            "  どちらかが取り残されています。次のどれかをしてください。\n"
            "    ・持ち主を更新する: cd %s && git pull\n"
            "    ・写しを持ち主に合わせる: python3 tools/nursing/sync_db.py --pull\n"
            "    ・今回だけどちらかを指定する: HS_NURSING_DB=<パス> で実行する\n\n"
            % (DB_OWNER, so, DB_COPY, sc, JHNRD))
        sys.exit(2)
    DB = DB_OWNER
    DB_PICK_NOTE = "JHNRD 本体を見ています"
DB_IS_COPY = (DB == DB_COPY)
LOCAL = os.path.join(HS, "data", "nursing", "questions_local.json")
IND = os.path.join(HS, "workers", "hs-hearing", "src", "industry.js")

# 現場質問。DB の穴を埋めるために現場に尋ねるもの。規則の出典にはしない。
FIELD = {
    "q_nv_shiji_period": {
        "fills_gap": "訪問看護指示書の有効期間について、条文を確認できていない",
        "gives": "実際の更新周期。条文を引くときの手がかりと、確認できたあとの突き合わせ先",
    },
    "q_nv_tokubetsu_days": {
        "fills_gap": "特別訪問看護指示書の交付回数・日数について、条文を確認できていない",
        "gives": "実務での回し方と、月2回交付になった実例の状況",
    },
}

# 業務・集客・採用。弊社側に置く。
PURPOSE_LOCAL = {
    "q_nv_system": "ops", "q_nv_insurance": "ops", "q_nv_henrei": "ops",
    "q_nv_oncall": "ops", "q_nv_shimekiri": "ops",
    "q_nv_work_notes": "outbound", "q_nv_capacity": "outbound",
    "q_nv_caremane": "outbound", "q_nv_faq": "outbound", "q_nv_story": "outbound",
    "q_nv_recruit_role": "recruit", "q_nv_recruit_oncall": "recruit",
    "q_nv_recruit_edu": "recruit",
}


def bank_span(src):
    """bank: { ... } の範囲を、波括弧を数えて求める。設問の中にも波括弧がある。"""
    m = re.search(r"\n(\s*)bank:\s*\{", src)
    if not m:
        sys.stderr.write("bank: が見つかりません。\n"); sys.exit(2)
    i = src.index("{", m.start())
    depth, j = 0, i
    while j < len(src):
        if src[j] == "{": depth += 1
        elif src[j] == "}":
            depth -= 1
            if depth == 0:
                return m.start() + 1, i, j + 1, m.group(1)
        j += 1
    sys.stderr.write("bank: の閉じ括弧が見つかりません。\n"); sys.exit(2)


def parse_bank(src):
    """bank の中の q_nv_* を、書かれている順に読む。"""
    _, i, j, _ = bank_span(src)
    body = src[i:j]
    out = []
    for m in re.finditer(
            r"^\s*(q_nv_[a-z0-9_]+):\s*\{\s*\n\s*w:\s*(\d+),"
            r"(?:\s*\n\s*purpose:\s*\"[a-z]+\",)?\s*\n\s*text:\s*(.*?),?\n\s*\},",
            body, re.S | re.M):
        qid, w, raw = m.group(1), int(m.group(2)), m.group(3)
        # 文字列連結("..." + "...")をつなぐ。
        parts = re.findall(r'"((?:[^"\\]|\\.)*)"', raw)
        if any("\\" in p for p in parts):
            sys.stderr.write("エスケープを含む設問があります: %s\n"
                             "  この道具は素の文字列だけを前提にしています。手で移してください。\n" % qid)
            sys.exit(2)
        out.append({"id": qid, "w": w, "text": "".join(parts)})
    return out


def main():
    apply = "--apply" in sys.argv
    src = io.open(IND, encoding="utf-8").read()
    qs = parse_bank(src)
    print("industry.js の bank: %d 問" % len(qs))

    db = json.load(io.open(DB, encoding="utf-8"))
    # DB のどの要件が、どの設問を求めているか
    asks = {}
    for it in db.get("items", []):
        for key in ("requirements", "rules", "watch"):
            for r in it.get(key, []):
                a = r.get("ask")
                if a:
                    asks.setdefault(a, []).append("%s/%s" % (it.get("id"), r.get("id")))

    req, field, local, orphan = [], [], [], []
    for n, q in enumerate(qs):
        e = {"id": q["id"], "w": q["w"], "order": n, "text": q["text"]}
        if q["id"] in asks:
            e["purpose"] = "requirement"
            req.append(e)
        elif q["id"] in FIELD:
            e["purpose"] = "field"
            e.update(FIELD[q["id"]])
            e["not_a_source"] = True
            e["note"] = ("これは現場の運用を尋ねる設問である。答えは field_reports に入る。"
                         "規則の出典(sources)にはしない。事業所がそう回しているという事実は、"
                         "そう定められているという根拠ではない。")
            field.append(e)
        elif q["id"] in PURPOSE_LOCAL:
            e["purpose"] = PURPOSE_LOCAL[q["id"]]
            local.append(e)
        else:
            orphan.append(q["id"])

    print("  JHNRD へ(算定要件を確かめる) : %d" % len(req))
    for e in req:
        print("     %-22s w=%-3d ← %s" % (e["id"], e["w"], "、".join(asks[e["id"]])))
    print("  JHNRD へ(DBの穴を埋める現場質問): %d  %s" % (len(field), [e["id"] for e in field]))
    print("  hs-docfix へ(業務・集客・採用)  : %d" % len(local))
    for p in ("ops", "outbound", "recruit"):
        ids = [e["id"] for e in local if e["purpose"] == p]
        print("     %-9s %s" % (p, ids))

    if orphan:
        print("\n行き先が決まっていない設問があります: %s" % orphan, file=sys.stderr)
        print("  黙って落とすと、その設問は誰にも尋ねられなくなります。", file=sys.stderr)
        sys.exit(3)

    # DB が求めているのに、文面が無い ask
    missing = sorted(set(asks) - {e["id"] for e in req})
    if missing:
        print("\n要件が求めているのに設問が無い: %s" % missing)

    if not apply:
        print("\n(--apply が無いので、まだ書いていません)")
        return

    db["questions"] = req + field
    db["questions_note"] = (
        "ヒアリングの設問文。要件のとなりに、その要件を確かめるための問いを置く。"
        "purpose が requirement のものは items[].{requirements,rules,watch}[].ask から参照される。"
        "purpose が field のものは、この DB にまだ無いことを現場に尋ねるための問いであり、"
        "答えは field_reports に入る。sources には入れない。")
    db["version"] = "2024-kaitei.seed.7"
    shutil.copy2(DB, DB + ".bak_preq20260823")
    io.open(DB, "w", encoding="utf-8").write(json.dumps(db, ensure_ascii=False, indent=2) + "\n")
    print("\nJHNRD に %d 問を入れました。版 -> %s" % (len(db["questions"]), db["version"]))

    io.open(LOCAL, "w", encoding="utf-8").write(json.dumps({
        "note": ("弊社側のヒアリング設問。算定要件の確認ではないので、公開データベース(JHNRD)には置かない。"
                 "industry.js の bank は、JHNRD の questions とこのファイルから生成される。"
                 "industry.js を手で編集しないこと。"),
        "generated_into": "workers/hs-hearing/src/industry.js",
        "questions": local,
    }, ensure_ascii=False, indent=2) + "\n")
    print("hs-docfix に %d 問を入れました: %s" % (len(local), os.path.relpath(LOCAL, HS)))


if __name__ == "__main__":
    main()
