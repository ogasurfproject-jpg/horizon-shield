# -*- coding: utf-8 -*-
"""
make_souba_dataset_seed.py (2026-09-14): souba-db.json の内容ハッシュを台帳投入用 seed にする

狙い(堀の時刻半分):
  audit_estimate は claim.dataset_sha256 = 判定に使った souba-db.json の実バイトの SHA-256 を返す。
  今はその sha が指すバイトを、発行者が自分のドメインから配っており、黙って差し替えられる。
  このレコードを台帳に append して Bitcoin に刻めば、
  「この sha のデータセットは、この block の時点で確かに生きていた」が prover 非所有の錨で固定される。
  発行者は、後から中身を変えて『昔からこの版だった』と主張できなくなる(時刻の偽造は block height で縛られる)。

やること(make_coordinate_sources_seed.py と同じ流儀、対象がデータセットに変わっただけ):
  1. data/souba-db.json の生バイトを読み、SHA-256 を再計算する(= worker が出す dataset_sha256 と同一の作り方)
  2. _meta から version / updated_at / updated_by / sources を拾う
  3. それらを埋めたリリースの宣言レコード(record_canonical)を組み立てる
  4. 既存の seed 形式 {claim_sha256, record_canonical, work} で
       workers/hs-ledger/seed_entry_souba_dataset_v1.json
     を書く

fail-closed:
  - data/souba-db.json が無い / JSON で無い / _meta.version・updated_at が空 / sources が空なら1バイトも書かない
  - dataset_sha256 が 64 桁 hex で無ければ中止
  - 禁止ダッシュ(em/en/bar/minus)がレコードか work に混じっていたら中止(掟)
  - 書いた後、読み戻して claim_sha256 を再計算し、一致しなければ異常終了

使い方:
  cd ~/horizon-shield
  python3 workers/hs-ledger/make_souba_dataset_seed.py
"""
import io, json, os, sys, hashlib

ROOT = "workers/hs-ledger"
SOUBA = "data/souba-db.json"
DST = ROOT + "/seed_entry_souba_dataset_v1.json"
DATASET_URL = "https://shield.the-horizons-innovation.com/data/souba-db.json"

FORBIDDEN_DASH = ["—", "–", "―", "−"]  # em / en / horizontal bar / minus


def is_hex64(s):
    return isinstance(s, str) and len(s) == 64 and all(c in "0123456789abcdef" for c in s)


def build_record(version, updated_at, updated_by, dataset_sha256, sources):
    src_lines = "\n".join("    " + s for s in sources)
    return (
        "# souba-db dataset release, content-anchored (souba-dataset-v1)\n"
        "\n"
        "**Status:** a dataset release declaration, anchored to the JIDEC ledger the same way the NENRIN "
        "records are, and cited, never edited, once anchored. This record carries the SHA-256 of the exact "
        "bytes of the fair-price dataset that HORIZON SHIELD's price tools read, and fixes the time at which "
        "those bytes were live, on an anchor the issuer does not own.\n"
        "\n"
        "## 1. What this binds\n"
        "\n"
        "HORIZON SHIELD's `audit_estimate` returns, with every verdict, a claim carrying `dataset_sha256`: the "
        "SHA-256 of the `souba-db.json` bytes used for that verdict. Until this record, that hash pointed only "
        "at bytes the issuer serves from its own domain, and the issuer could replace them silently and claim "
        "the new bytes were always the ones in force. This record moves the time coordinate of the dataset off "
        "the issuer's domain and onto Bitcoin. After it is appended and stamped, the issuer cannot backdate a "
        "change to the dataset, and cannot claim a later dataset is the one that was live at this block. Time "
        "forgery is bounded by block height. Physics, not policy.\n"
        "\n"
        "## 2. The fields\n"
        "\n"
        "    version        " + version + "\n"
        "    updated_at     " + updated_at + "\n"
        "    updated_by     " + updated_by + "\n"
        "    dataset_url    " + DATASET_URL + "\n"
        "    dataset_sha256 " + dataset_sha256 + "\n"
        "\n"
        "Public sources the dataset is cross-checked against:\n"
        "\n" + src_lines + "\n"
        "\n"
        "## 3. Fetch the bytes yourself\n"
        "\n"
        "The verification needs no trust in HORIZON SHIELD. Fetch the dataset, hash it, and confirm it equals "
        "the field above:\n"
        "\n"
        "    curl -s " + DATASET_URL + " | shasum -a 256\n"
        "\n"
        "The result must equal `dataset_sha256`. Then find that same hash in this anchored record and read the "
        "Bitcoin block height the ledger entry is stamped to. The issuer touches none of those three steps: the "
        "bytes are fetched from the wire, the hash is recomputed by the reader, and the block is written by "
        "Bitcoin. A verdict whose `claim.dataset_sha256` does not equal an anchored release is a coordinate the "
        "prover chose, and is not the dataset being served here.\n"
        "\n"
        "## 4. The honest boundary\n"
        "\n"
        "This record anchors the dataset's content and its time. It does not certify that the prices in the "
        "dataset are correct. Correctness rests on the named public sources and on member-store cases, which a "
        "reader checks independently. The anchor makes the dataset non-repudiable, not true. A later dataset is "
        "a later entry that cites this one, never an edit of it.\n"
        "\n"
        "## 5. Self-application\n"
        "\n"
        "The issuer is bound by the same rule as every subject on this ledger. The fair-price adjudication is "
        "checked against the dataset whose SHA-256 is anchored here, and the join guard (`nenrin-join-v1`) "
        "derives the cost category from the estimate's own line items, so neither the price bytes nor the "
        "coordinate they are read at is chosen by the party being verified. The operator is a subject, not an "
        "exception.\n"
        "\n"
        "**The SHA-256 of this document is anchored to the JIDEC ledger and stamped to Bitcoin. After anchoring, "
        "this record cannot be altered. Corrections are later entries that cite this one.**\n"
    )


WORK = ("souba-db dataset release v{ver} content-anchored: binds the SHA-256 of the fair-price dataset bytes "
        "that audit_estimate reads, and fixes their time on Bitcoin, so the issuer cannot backdate or "
        "silently replace the dataset a verdict cites.")


def main():
    if not os.path.isdir(ROOT):
        print("NG %s が無い。リポジトリ根から実行しているか確認" % ROOT); sys.exit(1)
    if not os.path.exists(SOUBA):
        print("NG %s が無い" % SOUBA); sys.exit(1)

    raw = io.open(SOUBA, "rb").read()
    dataset_sha256 = hashlib.sha256(raw).hexdigest()

    try:
        d = json.loads(raw.decode("utf-8"))
    except Exception as e:
        print("NG souba-db.json が JSON で無い: %s" % e); sys.exit(1)
    meta = d.get("_meta") or {}
    version = str(meta.get("version") or "").strip()
    updated_at = str(meta.get("updated_at") or "").strip()
    updated_by = str(meta.get("updated_by") or "").strip()
    sources = [str(s).strip() for s in (meta.get("sources") or []) if str(s).strip()]

    checks = [
        ("version 有り", bool(version)),
        ("updated_at 有り", bool(updated_at)),
        ("updated_by 有り", bool(updated_by)),
        ("sources 1件以上", len(sources) >= 1),
        ("dataset_sha256 が64桁hex", is_hex64(dataset_sha256)),
    ]
    for name, ok in checks:
        print("  %s %s" % ("OK " if ok else "NG ", name))
    if not all(ok for _, ok in checks):
        print("★ 前提が違う。1バイトも書かずに終了。"); sys.exit(1)

    # updated_by は監修メモが長い。禁止ダッシュだけ弾き、内容は生かす。
    record = build_record(version, updated_at, updated_by, dataset_sha256, sources)
    work = WORK.replace("{ver}", version)

    for label, text in (("record", record), ("work", work)):
        for dash in FORBIDDEN_DASH:
            if dash in text:
                print("★ %s に禁止ダッシュ(%r)。原文を直して再実行。中止。" % (label, dash)); sys.exit(1)

    claim_sha256 = hashlib.sha256(record.encode("utf-8")).hexdigest()
    seed = {"claim_sha256": claim_sha256, "record_canonical": record, "work": work}
    io.open(DST, "w", encoding="utf-8").write(json.dumps(seed, ensure_ascii=False))

    back = json.load(io.open(DST, encoding="utf-8"))
    re_sha = hashlib.sha256(back["record_canonical"].encode("utf-8")).hexdigest()
    if re_sha != claim_sha256 or back["claim_sha256"] != claim_sha256:
        print("★ %s: 読み戻し検算に失敗。中止。" % DST); sys.exit(1)

    print("")
    print("書いた: %s" % DST)
    print("  claim_sha256   : %s" % claim_sha256)
    print("  dataset_sha256 : %s" % dataset_sha256)
    print("  version        : %s" % version)
    print("")
    print("次(TOshi 手):")
    print("  0) 錨打ち前の必須検算(公開バイトと一致するか。ネイティブTerminalで):")
    print("       curl -s %s | shasum -a 256" % DATASET_URL)
    print("     → 出た sha が dataset_sha256 (%s) と一致することを確認。" % dataset_sha256[:16] + "...")
    print("     ずれていたら souba-db.json が未 push か差し替え済み。push して一致させてから錨打ちする。")
    print("  1) git add workers/hs-ledger/make_souba_dataset_seed.py")
    print("     git add workers/hs-ledger/seed_entry_souba_dataset_v1.json")
    print("     commit / push")
    print("  2) 台帳へ append(回転後の鍵で。既存 NENRIN / coordinate-v1 と同じ手順)")
    print("  3) ots stamp。数時間後に Bitcoin ブロックに入る")
    print("  4) 済んだら mcp.js の dataset_verify ノートの約束(JIDEC で sha を引ける)が本物になる")


if __name__ == "__main__":
    main()
