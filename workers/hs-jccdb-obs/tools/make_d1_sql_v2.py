# -*- coding: utf-8 -*-
"""
観測層 v2(observations/**/*.csv と sources/*.json)から、D1 に流し込む SQL を作る(hs-jccdb-obs v0.2)。

使い方:
    python3 tools/make_d1_sql_v2.py <観測層 v2 のルート> [--out sql_v2] [--chunk 2000] [--validator <validate_obs.py>]

  <観測層 v2 のルート>  observations/ と sources/ がある所(作業場では /home/claude/work/obs2)
  --out        書き出し先(既定: この worker の sql_v2/)。中の *.sql は消してから書く。v0.1 の sql/ には触らない
  --chunk      1ファイルあたりの文の数(既定 2000)
  --validator  検査器(既定: <ルート>/tools/validate_obs.py)

約束:
  - 組み立ての前に検査器を走らせる。誤りが1つでもあれば何も書かずに止まる(終了コード 1)。
  - ファイル名は増える前提。observations の下の CSV は全部読む(名前で選ばない)。
  - 値は CSV の文字のまま数として入れる(丸めない)。閉じた状態の行に値が無いことは検査器が確かめている。
  - 流す順: schema/0002_obs2.sql を当ててから、<out>/001.sql から順に全部。
"""
import csv, glob, hashlib, json, os, re, subprocess, sys, tempfile, unicodedata, datetime, collections

HERE = os.path.dirname(os.path.abspath(__file__))
WORKER = os.path.dirname(HERE)

# ダッシュ類(U+2010..U+2015, U+2212, U+FF0D)は検索用の norm で '-' にそろえる。worker.js の norm と同じ規則。
DASHES = re.compile("[\u2010-\u2015\u2212\uff0d]")
OBS2_COLS = None  # obs_common.COLUMNS を検査器と同じ所から読む

# 観測層の組み立てで原本の値から計算した値(原本には無い値)の目印。parser は note にこの語を書く(着工統計の 1m2 あたり等)。
COMPUTED_MARKS = ("原本に無い値", "not in the original", "not in the source")


def is_computed(row):
    t = row["note"].lower()
    return any(m.lower() in t for m in COMPUTED_MARKS)


def norm(s):
    t = unicodedata.normalize("NFKC", s or "")
    t = re.sub(r"\s+", "", t)
    t = DASHES.sub("-", t)
    return t.lower()


def period_key(p, country):
    """時点の始まりの日付。並べ替えと期間の絞り込みに使う。worker.js の periodStart と同じ規則。"""
    m = re.match(r"^(\d{4})$", p)
    if m:
        return "%s-01-01" % m.group(1)
    m = re.match(r"^(\d{4})-(\d{2})$", p)
    if m:
        return "%s-%s-01" % m.groups()
    if re.match(r"^\d{4}-\d{2}-\d{2}$", p):
        return p
    m = re.match(r"^(\d{4})Q([1-4])$", p)
    if m:
        return "%s-%02d-01" % (m.group(1), 3 * int(m.group(2)) - 2)
    m = re.match(r"^(\d{4})H([12])$", p)
    if m:
        return "%s-%s-01" % (m.group(1), "01" if m.group(2) == "1" else "07")
    m = re.match(r"^FY(\d{4})$", p)
    if m:
        y = int(m.group(1))
        return "%04d-04-01" % y if country == "JP" else "%04d-10-01" % (y - 1)
    raise ValueError("時点の形が分からない: %r" % p)


def q(v):
    if v is None:
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"


def qnum(v):
    return v if v != "" else "NULL"


def sha256_file(fn):
    h = hashlib.sha256()
    with open(fn, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def run_validator(validator, root):
    with tempfile.TemporaryDirectory() as td:
        jout = os.path.join(td, "validate.json")
        r = subprocess.run([sys.executable, validator, root, "--json", jout], capture_output=True, text=True)
        summary = json.load(open(jout, encoding="utf-8")) if os.path.exists(jout) else None
    return r, summary


def main(argv):
    args = list(argv)
    if not args or args[0].startswith("--"):
        sys.exit(__doc__)
    root = os.path.abspath(os.path.expanduser(args[0]))
    out = os.path.join(WORKER, "sql_v2")
    chunk = 2000
    validator = os.path.join(root, "tools", "validate_obs.py")
    if "--out" in args:
        out = os.path.abspath(os.path.expanduser(args[args.index("--out") + 1]))
    if "--chunk" in args:
        chunk = int(args[args.index("--chunk") + 1])
    if "--validator" in args:
        validator = os.path.abspath(os.path.expanduser(args[args.index("--validator") + 1]))
    if not os.path.isfile(validator):
        sys.exit("検査器が見つからない: %s(--validator で渡す)" % validator)
    if os.path.abspath(out) == os.path.join(WORKER, "sql"):
        sys.exit("--out に v0.1 の sql/ は使えない(items と obs の SQL が消える)。sql_v2 などを使う。")

    # 1. 検査。誤りが1つでもあれば止まる。
    r, summary = run_validator(validator, root)
    if r.returncode != 0 or not summary or summary.get("errors"):
        sys.stdout.write(r.stdout[-4000:])
        sys.stderr.write(r.stderr[-2000:])
        sys.exit("検査器が誤りを返した(終了コード %s)。SQL は書いていない。" % r.returncode)
    if not summary.get("rows"):
        sys.exit("観測が0行。SQL は書いていない。")

    sys.path.insert(0, os.path.dirname(validator))
    from obs_common import COLUMNS  # 検査器と同じ列の定義
    global OBS2_COLS
    OBS2_COLS = COLUMNS

    # 2. 出典台帳
    ledger = {}
    for fn in sorted(glob.glob(os.path.join(root, "sources", "*.json"))):
        d = json.load(open(fn, encoding="utf-8"))
        ledger[d["source_id"]] = d

    # 3. 観測(全部)
    files = sorted(glob.glob(os.path.join(root, "observations", "**", "*.csv"), recursive=True))
    cols = COLUMNS + ["computed", "norm", "period_key", "src_file"]
    head = "INSERT INTO obs2 (%s) VALUES (" % ",".join(cols)
    num_cols = {"price", "ref_value"}
    stmts = []
    per_file = collections.OrderedDict()
    cov = {}
    tot = collections.Counter()
    file_sha = {}
    for fn in files:
        rel = os.path.relpath(fn, root).replace(os.sep, "/")
        file_sha[rel] = sha256_file(fn)
        n = 0
        with open(fn, encoding="utf-8", newline="") as f:
            rd = csv.DictReader(f)
            if rd.fieldnames != COLUMNS:
                sys.exit("列の並びが違う: %s" % rel)
            for row in rd:
                pk = period_key(row["period"], row["country"])
                vals = [qnum(row[c]) if c in num_cols else q(row[c]) for c in COLUMNS]
                comp = is_computed(row)
                vals += ["1" if comp else "0", q(norm(row["item_name"] + " " + row["spec"])), q(pk), q(rel)]
                stmts.append(head + ",".join(vals) + ");")
                n += 1
                key = (row["source_id"], row["country"], row["layer"], row["geo_level"], row["geo_code"], row["price_status"])
                c = cov.get(key)
                if c is None:
                    c = cov[key] = {"geo_name": row["geo_name"], "n": 0, "n_priced": 0, "n_computed": 0, "pmin": None, "pmax": None}
                c["n"] += 1
                if row["price"] != "":
                    c["n_priced"] += 1
                if comp:
                    c["n_computed"] += 1
                    tot["computed"] += 1
                if c["pmin"] is None or pk < c["pmin"][0]:
                    c["pmin"] = (pk, row["period"])
                if c["pmax"] is None or pk > c["pmax"][0]:
                    c["pmax"] = (pk, row["period"])
                tot["layer:" + row["layer"]] += 1
                tot["status:" + row["price_status"]] += 1
                tot["country:" + row["country"]] += 1
        per_file[rel] = n
    n_obs = len(stmts)
    want = (summary.get("rows_by_dir") or {}).get("observations", summary["rows"])
    if n_obs != want:
        sys.exit("検査器の行数(%s)と読んだ行数(%s)が違う。" % (want, n_obs))

    # 3b. 行の一覧を載せない出典(observations_restricted/)は、件数だけを coverage に入れる(listed = 0)。
    #     出典が表の複製・転載・電子媒体への加工を禁じているため(台帳の row_listing_reason)。observations_hold/ は何も入れない。
    nl = collections.Counter()
    for fn in sorted(glob.glob(os.path.join(root, "observations_restricted", "**", "*.csv"), recursive=True)):
        rel = os.path.relpath(fn, root).replace(os.sep, "/")
        file_sha[rel] = sha256_file(fn)
        with open(fn, encoding="utf-8", newline="") as f:
            rd = csv.DictReader(f)
            if rd.fieldnames != COLUMNS:
                sys.exit("列の並びが違う: %s" % rel)
            for row in rd:
                if row["price"] != "":
                    sys.exit("行を載せない出典に値がある: %s %s" % (rel, row["obs_id"]))
                pk = period_key(row["period"], row["country"])
                key = (row["source_id"], row["country"], row["layer"], row["geo_level"], row["geo_code"], row["price_status"])
                c = cov.get(key)
                if c is None:
                    c = cov[key] = {"geo_name": row["geo_name"], "n": 0, "n_priced": 0, "n_computed": 0, "pmin": None, "pmax": None, "listed": 0}
                elif c.get("listed", 1) != 0:
                    sys.exit("同じ出典が observations と observations_restricted の両方にある: %s" % row["source_id"])
                c["n"] += 1
                nl[row["source_id"]] += 1
                if c["pmin"] is None or pk < c["pmin"][0]:
                    c["pmin"] = (pk, row["period"])
                if c["pmax"] is None or pk > c["pmax"][0]:
                    c["pmax"] = (pk, row["period"])
    for sid in nl:
        if (ledger.get(sid) or {}).get("row_listing") != "not_in_public_build":
            sys.exit("observations_restricted にあるのに台帳に row_listing=not_in_public_build が無い: %s" % sid)

    # 4. 出典台帳(観測に使われていない台帳も入れる: 何を調べたかの記録なので)
    used = {k[0] for k in cov}
    missing = used - set(ledger)
    if missing:
        sys.exit("台帳に無い出典: %s" % sorted(missing))
    for sid in sorted(ledger):
        d = ledger[sid]
        stmts.append("INSERT INTO sources2 (source_id,country,title,publisher,url,retrieved_at,license,values_copied,attribution,body) VALUES (%s);" % ",".join([
            q(sid), q(d.get("country")), q(d.get("title")), q(d.get("publisher")), q(d.get("url")), q(d.get("retrieved_at")),
            q(d.get("license")), "1" if d.get("values_copied") is True else "0", q(d.get("attribution") or ""),
            q(json.dumps(d, ensure_ascii=False, sort_keys=True))]))

    # 5. coverage
    for key in sorted(cov):
        c = cov[key]
        stmts.append("INSERT INTO coverage (source_id,country,layer,geo_level,geo_code,geo_name,price_status,n,n_priced,n_computed,period_min,period_max,listed) VALUES (%s);" % ",".join(
            [q(x) for x in key[:5]] + [q(c["geo_name"]), q(key[5]), str(c["n"]), str(c["n_priced"]), str(c["n_computed"]), q(c["pmin"][1]), q(c["pmax"][1]), str(c.get("listed", 1))]))

    # 6. meta(最後の文。ここまで流れたかの目印にもなる)
    fp = hashlib.sha256("\n".join("%s %s" % (k, file_sha[k]) for k in sorted(file_sha)).encode()).hexdigest()
    built = {
        "obs2": n_obs, "sources2": len(ledger), "coverage": len(cov), "files": per_file, "computed_rows": tot["computed"],
        "not_listed_rows_by_source": dict(sorted(nl.items())),
        "by_layer": {k[6:]: v for k, v in sorted(tot.items()) if k.startswith("layer:")},
        "by_status": {k[7:]: v for k, v in sorted(tot.items()) if k.startswith("status:")},
        "by_country": {k[8:]: v for k, v in sorted(tot.items()) if k.startswith("country:")},
        "obs2_fingerprint_sha256": fp,
        "validator": {"files": summary.get("files"), "rows": summary.get("rows"), "errors": summary.get("errors"),
                      "rows_by_dir": summary.get("rows_by_dir"), "rows_public": want},
        "built_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    stmts.append("INSERT OR REPLACE INTO meta (k, v) VALUES ('built_v2', %s);" % q(json.dumps(built, ensure_ascii=False, sort_keys=True)))

    # 7. 書き出し
    os.makedirs(out, exist_ok=True)
    for f in glob.glob(os.path.join(out, "*.sql")):
        os.remove(f)
    names = []
    for i in range(0, len(stmts), chunk):
        name = "%03d.sql" % (i // chunk + 1)
        with open(os.path.join(out, name), "w", encoding="utf-8") as f:
            f.write("\n".join(stmts[i:i + chunk]) + "\n")
        names.append(name)
    manifest = {"built": built, "statements": len(stmts), "chunk": chunk,
                "sql_files": {n: sha256_file(os.path.join(out, n)) for n in names},
                "source_files_sha256": file_sha,
                "apply_order": ["schema/0002_obs2.sql"] + ["%s/%s" % (os.path.basename(out), n) for n in names]}
    json.dump(manifest, open(os.path.join(out, "MANIFEST.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1, sort_keys=True)
    print(json.dumps({"obs2": n_obs, "sources2": len(ledger), "coverage": len(cov), "files": len(names),
                      "out": out, "by_layer": built["by_layer"], "by_status": built["by_status"]}, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv[1:])
