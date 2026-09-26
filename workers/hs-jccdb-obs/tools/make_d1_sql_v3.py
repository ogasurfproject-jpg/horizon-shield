# -*- coding: utf-8 -*-
"""
観測層 v2(observations/**/*.csv と sources/*.json)から、国ごとの D1 に流す SQL を作る(hs-jccdb-obs v0.3)。

使い方:
    python3 tools/make_d1_sql_v3.py <観測層 v2 のルート> --country JP|US [--out DIR] [--max-mb 50] [--validator PATH] [--no-fts]

  <観測層 v2 のルート>  observations/ と sources/ がある所(作業場では /home/claude/work/obs2)
  --country    JP なら日本の行だけ(D1 の DB 用、既定の出力 sql_jp/)、US なら米国の行だけ(D1 の DB_US 用、既定 sql_us/)
  --out        書き出し先。中の *.sql と MANIFEST.json は、検査器が通った後に消してから書く。v0.1 の sql/ には書かない
  --max-mb     1 ファイルの大きさの上限(MB、既定 50)。D1 の import に合わせる。ファイルは文の切れ目でしか分けない
  --validator  検査器(既定: <ルート>/tools/validate_obs.py)
  --no-fts     米国でも FTS5 の索引(fts_*.sql)を作らない(検索は LIKE に落ちる)

約束:
  - 組み立ての前に検査器を全行に走らせる。誤りが1つでもあれば何も書かずに止まる(終了コード 1)。
  - 行を読みながら順にファイルへ書く(全部の文をメモリに持たない)。メモリに持つのは note と area_members の本文の
    指紋(16 bytes)と番号、出典ごと・地域ごとの件数(coverage)だけ。
  - 1 つの INSERT は多くの行をまとめる(1 文 90,000 bytes まで。D1 の文の上限は 100,000 bytes)。note と area_members の
    本文(notes / members 表)は、それを使う obs2 の行より前の文で入れる(表どうしの参照の制約は無い。途中の状態は meta の関所で読ませない)。
  - 値は CSV の文字のまま数として入れる(丸めない)。閉じた状態の行に値が無いことは検査器が確かめている。
  - 流す順は MANIFEST.json の apply_order: schema/0003_obs3.sql、<out>/001.sql から順に、米国は最後に <out>/fts_001.sql から順に。
    meta の built_v3 は本体の最後の文、built_v3_fts は FTS の最後の文(worker はそれぞれを関所にする)。
"""
import csv, glob, hashlib, json, os, re, subprocess, sys, tempfile, unicodedata, datetime, collections

HERE = os.path.dirname(os.path.abspath(__file__))
WORKER = os.path.dirname(HERE)

# ダッシュ類(U+2010..U+2015, U+2212, U+FF0D)は検索用の norm で '-' にそろえる。worker.js の norm と同じ規則。
DASHES = re.compile("[\u2010-\u2015\u2212\uff0d]")
COMPUTED_MARKS = ("原本に無い値", "not in the original", "not in the source")
OPEN_STATUSES = {"published_pdl", "published_cc_by", "public_domain", "published_open_terms"}

STMT_MAX = 90000          # 1 文の上限(bytes)。D1 は 100,000 bytes
STMT_HARD = 100000        # これを超える 1 行があれば止まる
ROWS_PER_STMT = 400
FTS_CHUNK = 20000         # FTS5 に入れる 1 文の行数(rid の範囲)

OBS_COLS = ["rid", "obs_id", "country", "layer", "category", "item_name", "spec", "unit", "geo_level", "geo_code", "geo_name",
            "area_label", "area_code", "members_id", "price", "currency", "price_basis", "price_status", "ref_value", "ref_note",
            "period", "effective_from", "source_id", "source_page", "evidence_url", "license", "jccdb_v4_item_id", "note_id",
            "computed", "norm", "period_key", "file_no"]
FTS_COLS = ["item_name", "spec", "category"]


def is_computed(note):
    t = note.lower()
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


def digest(s):
    return hashlib.blake2b(s.encode("utf-8"), digest_size=16).digest()


COUNTY_SUFFIX = re.compile(r"\s+(county|parish|borough|census area|municipality|city and borough|municipio)$")


def county_base(s):
    """郡・市の名前の照合用の鍵。worker.js の countyBase と同じ規則: NFKC、小文字、「, 以降」を外す、郡の接尾辞を外す、英数字だけ残す。"""
    t = unicodedata.normalize("NFKC", s or "").lower()
    t = re.sub(r",.*$", "", t).strip()
    t = COUNTY_SUFFIX.sub("", t)
    return "".join(ch for ch in t if ch.isalnum())


GEO_NAME_LEVELS = ("county", "metro", "city", "usace_ep_region")


def run_validator(validator, root):
    with tempfile.TemporaryDirectory() as td:
        jout = os.path.join(td, "validate.json")
        r = subprocess.run([sys.executable, validator, root, "--json", jout], capture_output=True, text=True)
        summary = json.load(open(jout, encoding="utf-8")) if os.path.exists(jout) else None
    return r, summary


class SqlWriter:
    """文の組(group)を、ファイルの大きさの上限を越えないように順に書く。組は分けない(notes と、それを使う obs2 の文)。"""

    def __init__(self, out, prefix, max_bytes):
        self.out, self.prefix, self.max_bytes = out, prefix, max_bytes
        self.files = []  # [name, bytes, statements]
        self.fh = None

    def _rotate(self):
        if self.fh:
            self.fh.close()
        name = "%s%03d.sql" % (self.prefix, len(self.files) + 1)
        self.fh = open(os.path.join(self.out, name), "wb")
        self.files.append([name, 0, 0])

    def group(self, stmts):
        bs = []
        for s in stmts:
            b = (s + "\n").encode("utf-8")
            if len(b) > STMT_HARD:
                sys.exit("1 文が %d bytes あり、D1 の上限 100,000 bytes を超える(先頭: %s)。" % (len(b), s[:120]))
            bs.append(b)
        size = sum(len(b) for b in bs)
        if self.fh is None or (self.files[-1][1] > 0 and self.files[-1][1] + size > self.max_bytes):
            self._rotate()
        for b in bs:
            self.fh.write(b)
        self.files[-1][1] += size
        self.files[-1][2] += len(bs)

    def close(self):
        if self.fh:
            self.fh.close()
            self.fh = None


def multi_insert(head, values):
    """values(各 '(...)')を STMT_MAX 以内の INSERT に分ける。"""
    out, cur, size = [], [], len(head)
    for v in values:
        if cur and (size + len(v.encode("utf-8")) + 2 > STMT_MAX or len(cur) >= ROWS_PER_STMT):
            out.append(head + ",".join(cur) + ";")
            cur, size = [], len(head)
        cur.append(v)
        size += len(v.encode("utf-8")) + 1
    if cur:
        out.append(head + ",".join(cur) + ";")
    return out


def country_of_path(rel):
    parts = rel.split("/")
    sub = parts[1].lower() if len(parts) > 2 else None
    return sub.upper() if sub in ("jp", "us") else None


def main(argv):
    args = list(argv)
    if not args or args[0].startswith("--"):
        sys.exit(__doc__)
    root = os.path.abspath(os.path.expanduser(args[0]))
    opt = lambda k, d=None: args[args.index(k) + 1] if k in args else d
    country = (opt("--country") or "").upper()
    if country not in ("JP", "US"):
        sys.exit("--country は JP か US。/ --country must be JP or US")
    out = os.path.abspath(os.path.expanduser(opt("--out", os.path.join(WORKER, "sql_" + country.lower()))))
    max_bytes = int(float(opt("--max-mb", "50")) * 1000 * 1000)
    validator = os.path.abspath(os.path.expanduser(opt("--validator", os.path.join(root, "tools", "validate_obs.py"))))
    fts = country == "US" and "--no-fts" not in args
    if not os.path.isfile(validator):
        sys.exit("検査器が見つからない: %s(--validator で渡す)" % validator)
    if out == os.path.join(WORKER, "sql"):
        sys.exit("--out に v0.1 の sql/ は使えない(items と obs の SQL が消える)。")
    other = "sql_us" if country == "JP" else "sql_jp"
    if os.path.basename(out) == other:
        sys.exit("--country %s の出力を %s/ に書こうとしている(国の取り違え)。" % (country, other))
    if max_bytes < 200000:
        sys.exit("--max-mb が小さすぎる(0.2 以上)。")

    # 1. 検査。誤りが1つでもあれば止まる(まだ何も書いていない)。
    r, summary = run_validator(validator, root)
    if r.returncode != 0 or not summary or summary.get("errors"):
        sys.stdout.write(r.stdout[-4000:])
        sys.stderr.write(r.stderr[-2000:])
        sys.exit("検査器が誤りを返した(終了コード %s)。SQL は書いていない。" % r.returncode)
    if not summary.get("rows"):
        sys.exit("観測が0行。SQL は書いていない。")
    per_file_v = summary.get("per_file") or {}

    sys.path.insert(0, os.path.dirname(validator))
    from obs_common import COLUMNS  # 検査器と同じ列の定義

    # 2. 出典台帳(この国のものだけ。観測に使われていない台帳も入れる: 何を調べたかの記録なので)
    ledger = {}
    for fn in sorted(glob.glob(os.path.join(root, "sources", "*.json"))):
        d = json.load(open(fn, encoding="utf-8"))
        if d.get("country") == country:
            ledger[d["source_id"]] = d

    os.makedirs(out, exist_ok=True)
    for f in glob.glob(os.path.join(out, "*.sql")) + glob.glob(os.path.join(out, "MANIFEST.json")):
        os.remove(f)
    W = SqlWriter(out, "", max_bytes)

    # 3. 観測(この国の行だけ)。行を読みながら書く。
    files = sorted(glob.glob(os.path.join(root, "observations", "**", "*.csv"), recursive=True))
    head_obs = "INSERT INTO obs2 (%s) VALUES " % ",".join(OBS_COLS)
    note_ids, member_ids = {}, {}
    pend_notes, pend_members, batch, batch_bytes = [], [], [], 0
    cov, tot, per_file, file_sha, file_rows = {}, collections.Counter(), collections.OrderedDict(), {}, []
    geo_names = collections.Counter()
    rid = 0

    def flush():
        nonlocal batch, batch_bytes, pend_notes, pend_members
        if not batch:
            return
        g = []
        if pend_notes:
            g += multi_insert("INSERT INTO notes (note_id,text) VALUES ", pend_notes)
        if pend_members:
            g += multi_insert("INSERT INTO members (members_id,text) VALUES ", pend_members)
        g += multi_insert(head_obs, batch)
        W.group(g)
        batch, batch_bytes, pend_notes, pend_members = [], 0, [], []

    for fn in files:
        rel = os.path.relpath(fn, root).replace(os.sep, "/")
        pc = country_of_path(rel)
        if pc and pc != country:
            continue
        file_sha[rel] = sha256_file(fn)
        n_read = n_here = 0
        rid0 = rid + 1
        file_no = len(file_rows) + 1
        with open(fn, encoding="utf-8", newline="") as f:
            rd = csv.DictReader(f)
            if rd.fieldnames != COLUMNS:
                sys.exit("列の並びが違う: %s" % rel)
            for row in rd:
                n_read += 1
                if row["country"] != country:
                    if pc == country:
                        sys.exit("%s は %s の置き場所なのに country=%s の行がある(obs_id %s)。" % (rel, country, row["country"], row["obs_id"]))
                    continue
                n_here += 1
                rid += 1
                led = ledger.get(row["source_id"])
                if led is None:
                    sys.exit("台帳に無い出典(%s の台帳の中に): %s(%s)" % (country, row["source_id"], rel))
                pk = period_key(row["period"], row["country"])
                comp = is_computed(row["note"])
                nid = None
                if row["note"] != "":
                    k = digest(row["note"])
                    nid = note_ids.get(k)
                    if nid is None:
                        nid = note_ids[k] = len(note_ids) + 1
                        pend_notes.append("(%d,%s)" % (nid, q(row["note"])))
                mid = None
                if row["area_members"] != "":
                    k = digest(row["area_members"])
                    mid = member_ids.get(k)
                    if mid is None:
                        mid = member_ids[k] = len(member_ids) + 1
                        pend_members.append("(%d,%s)" % (mid, q(row["area_members"])))
                ev = None if row["evidence_url"] == led.get("url") else row["evidence_url"]
                lic = None if row["license"] == led.get("license") else row["license"]
                if ev is not None:
                    tot["evidence_url_kept"] += 1
                if lic is not None:
                    tot["license_kept"] += 1
                vals = {
                    "rid": str(rid), "obs_id": q(row["obs_id"]), "country": q(row["country"]), "layer": q(row["layer"]),
                    "category": q(row["category"]), "item_name": q(row["item_name"]), "spec": q(row["spec"]), "unit": q(row["unit"]),
                    "geo_level": q(row["geo_level"]), "geo_code": q(row["geo_code"]), "geo_name": q(row["geo_name"]),
                    "area_label": q(row["area_label"]), "area_code": q(row["area_code"]), "members_id": "NULL" if mid is None else str(mid),
                    "price": qnum(row["price"]), "currency": q(row["currency"]), "price_basis": q(row["price_basis"]),
                    "price_status": q(row["price_status"]), "ref_value": qnum(row["ref_value"]), "ref_note": q(row["ref_note"]),
                    "period": q(row["period"]), "effective_from": q(row["effective_from"]), "source_id": q(row["source_id"]),
                    "source_page": q(row["source_page"]), "evidence_url": q(ev), "license": q(lic),
                    "jccdb_v4_item_id": q(row["jccdb_v4_item_id"]), "note_id": "NULL" if nid is None else str(nid),
                    "computed": "1" if comp else "0",
                    "norm": q(norm(row["item_name"] + " " + row["spec"])) if country == "JP" else "NULL",
                    "period_key": q(pk), "file_no": str(file_no),
                }
                v = "(" + ",".join(vals[c] for c in OBS_COLS) + ")"
                vb = len(v.encode("utf-8"))
                if batch and (batch_bytes + vb > STMT_MAX - len(head_obs) or len(batch) >= ROWS_PER_STMT):
                    # 今の行が持ち込んだ本文(pend_notes の末尾)は前の文と一緒に書かれる。どちらにしても、使う行より前に入る。
                    flush()
                batch.append(v)
                batch_bytes += vb + 1
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
                if row["geo_level"] in GEO_NAME_LEVELS:
                    # USACE の機械損料の地域(EP-R1..R12)は、名前の代わりに地域に含まれる州の一覧(area_members)を持つ(州から地域を引くため)
                    label = row["area_members"] if row["geo_level"] == "usace_ep_region" else (row["area_label"] or row["geo_name"])
                    if label:
                        geo_names[(row["geo_level"], row["geo_code"], label)] += 1
        vrows =(per_file_v.get(rel) or {}).get("rows")
        if vrows is not None and vrows != n_read:
            sys.exit("検査器の行数(%s)と読んだ行数(%s)が違う: %s" % (vrows, n_read, rel))
        if n_here:
            per_file[rel] = n_here
            file_rows.append((file_no, rel, file_sha[rel], n_here, rid0, rid))
    flush()
    n_obs = rid
    if not n_obs:
        sys.exit("%s の観測が0行。" % country)

    # 3b. 行の一覧を載せない出典(observations_restricted/)は、件数だけを coverage に入れる(listed = 0)。observations_hold/ は何も入れない。
    nl = collections.Counter()
    for fn in sorted(glob.glob(os.path.join(root, "observations_restricted", "**", "*.csv"), recursive=True)):
        rel = os.path.relpath(fn, root).replace(os.sep, "/")
        pc = country_of_path(rel)
        if pc and pc != country:
            continue
        file_sha[rel] = sha256_file(fn)
        with open(fn, encoding="utf-8", newline="") as f:
            rd = csv.DictReader(f)
            if rd.fieldnames != COLUMNS:
                sys.exit("列の並びが違う: %s" % rel)
            for row in rd:
                if row["country"] != country:
                    continue
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
    missing = {k[0] for k in cov} - set(ledger)
    if missing:
        sys.exit("台帳に無い出典: %s" % sorted(missing))

    # 4. 出典台帳・coverage・取り込んだファイル
    W.group(multi_insert("INSERT INTO sources2 (source_id,country,title,publisher,url,retrieved_at,license,values_copied,attribution,body) VALUES ", [
        "(%s)" % ",".join([q(sid), q(d.get("country")), q(d.get("title")), q(d.get("publisher")), q(d.get("url")), q(d.get("retrieved_at")),
                           q(d.get("license")), "1" if d.get("values_copied") is True else "0", q(d.get("attribution") or ""),
                           q(json.dumps(d, ensure_ascii=False, sort_keys=True))])
        for sid, d in sorted(ledger.items())]))
    W.group(multi_insert("INSERT INTO coverage (source_id,country,layer,geo_level,geo_code,geo_name,price_status,n,n_priced,n_computed,period_min,period_max,listed) VALUES ", [
        "(%s)" % ",".join([q(x) for x in key[:5]] + [q(cov[key]["geo_name"]), q(key[5]), str(cov[key]["n"]), str(cov[key]["n_priced"]),
                           str(cov[key]["n_computed"]), q(cov[key]["pmin"][1]), q(cov[key]["pmax"][1]), str(cov[key].get("listed", 1))])
        for key in sorted(cov)]))
    W.group(multi_insert("INSERT INTO src_files (file_no,path,sha256,rows,rid_min,rid_max) VALUES ", [
        "(%d,%s,%s,%d,%d,%d)" % (no, q(rel), q(sha), n, a, b) for no, rel, sha, n, a, b in file_rows]))
    if geo_names:
        W.group(multi_insert("INSERT INTO geo_names (geo_level,geo_code,name,base_key,n) VALUES ", [
            "(%s,%s,%s,%s,%d)" % (q(lv), q(code), q(name), q(county_base(name)), n) for (lv, code, name), n in sorted(geo_names.items())]))

    # 5. meta(本体の最後の文。ここまで流れたかの目印)
    fp = hashlib.sha256("\n".join("%s %s" % (k, file_sha[k]) for k in sorted(file_sha)).encode()).hexdigest()
    built_at = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    built = {
        "schema": "0003", "country": country, "obs2": n_obs, "notes": len(note_ids), "members": len(member_ids),
        "sources2": len(ledger), "coverage": len(cov), "geo_names": len(geo_names), "files": per_file, "computed_rows": tot["computed"],
        "evidence_url_kept": tot["evidence_url_kept"], "license_kept": tot["license_kept"],
        "not_listed_rows_by_source": dict(sorted(nl.items())),
        "by_layer": {k[6:]: v for k, v in sorted(tot.items()) if k.startswith("layer:")},
        "by_status": {k[7:]: v for k, v in sorted(tot.items()) if k.startswith("status:")},
        "fts": fts, "obs2_fingerprint_sha256": fp,
        "validator": {"files": summary.get("files"), "rows": summary.get("rows"), "errors": summary.get("errors"),
                      "rows_by_dir": summary.get("rows_by_dir")},
        "built_at": built_at,
    }
    W.group(["INSERT OR REPLACE INTO meta (k, v) VALUES ('built_v3', %s);" % q(json.dumps(built, ensure_ascii=False, sort_keys=True))])
    W.close()
    main_files = [f[:] for f in W.files]

    # 6. FTS5(米国だけ)。本体の後に別のファイルで流す。D1 で FTS5 が使えないときは、ここを流さなくても worker は LIKE で答える。
    fts_files = []
    if fts:
        F = SqlWriter(out, "fts_", max_bytes)
        F.group(["CREATE VIRTUAL TABLE obs2_fts USING fts5(%s, content='obs2', content_rowid='rid', detail=none, columnsize=0, tokenize='unicode61');" % ", ".join(FTS_COLS)])
        for a in range(1, n_obs + 1, FTS_CHUNK):
            b = min(n_obs, a + FTS_CHUNK - 1)
            F.group(["INSERT INTO obs2_fts(rowid, %s) SELECT rid, %s FROM obs2 WHERE rid BETWEEN %d AND %d;" % (", ".join(FTS_COLS), ", ".join(FTS_COLS), a, b)])
        F.group(["INSERT OR REPLACE INTO meta (k, v) VALUES ('built_v3_fts', %s);" % q(json.dumps({
            "obs2": n_obs, "obs2_fingerprint_sha256": fp, "columns": FTS_COLS, "tokenizer": "unicode61", "detail": "none",
            "chunk": FTS_CHUNK, "built_at": built_at}, ensure_ascii=False, sort_keys=True))])
        F.close()
        fts_files = F.files

    allf = main_files + fts_files
    manifest = {
        "country": country, "built": built, "statements": sum(f[2] for f in allf), "max_bytes": max_bytes, "stmt_max": STMT_MAX,
        "sql_files": {f[0]: sha256_file(os.path.join(out, f[0])) for f in allf},
        "sql_bytes": {f[0]: f[1] for f in allf},
        "sql_statements": {f[0]: f[2] for f in allf},
        "fts_files": [f[0] for f in fts_files],
        "source_files_sha256": file_sha,
        "apply_order": ["schema/0003_obs3.sql"] + ["%s/%s" % (os.path.basename(out), f[0]) for f in allf],
    }
    json.dump(manifest, open(os.path.join(out, "MANIFEST.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1, sort_keys=True)
    print(json.dumps({"country": country, "obs2": n_obs, "notes": len(note_ids), "members": len(member_ids), "sources2": len(ledger),
                      "coverage": len(cov), "files": len(main_files), "fts_files": len(fts_files),
                      "bytes": sum(f[1] for f in allf), "out": out, "by_layer": built["by_layer"]}, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv[1:])
