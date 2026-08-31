# -*- coding: utf-8 -*-
"""
make_coordinate_seeds.py (2026-09-01): coordinate-v1 の spec とコードを台帳投入用 seed にする

やること (make_nenrin_seeds.py と同じ流儀):
  1. workers/hs-ledger/nenrin/coordinate-v1/NENRIN_COORDINATE_SPEC_v1.md を読む
  2. 同ディレクトリの8ハーネス(census/join/time/freshness の実装と敵)の sha256 を計算し、
     それを列挙した MANIFEST_coordinate_v1.md を生成する(コードのバイト列を1枚に固定する)
  3. 既存の seed 形式 {claim_sha256, record_canonical, work} で
       seed_entry_coordinate_v1_spec.json      (spec の md をアンカー)
       seed_entry_coordinate_v1_manifest.json  (manifest をアンカー=8コードの sha を固定)
     を workers/hs-ledger/ に書く

なぜ2枚か:
  spec の sha は「文書」を固定する。manifest の sha は「8本のコードの正確なバイト列」を固定する。
  両方をアンカーすれば、後から誰かが clone して各ファイルの sha256 を取り、manifest と突き合わせ、
  さらに manifest 自身の sha が Bitcoin に入った時刻を確かめられる。prover の協力は要らない。

fail-closed:
  - ファイルが無い/短すぎる/プレースホルダが残っていれば1バイトも書かない
  - 書いた後、読み戻して sha を再計算し、一致しなければ異常終了
  - 禁止ダッシュ(em/en/bar)が spec/manifest に混じっていたら中止(掟)

使い方:
  cd ~/horizon-shield
  python3 workers/hs-ledger/make_coordinate_seeds.py
"""
import io, json, os, sys, hashlib, time

ROOT = "workers/hs-ledger"
CDIR = ROOT + "/nenrin/coordinate-v1"
SPEC = CDIR + "/NENRIN_COORDINATE_SPEC_v1.md"
MANIFEST = CDIR + "/MANIFEST_coordinate_v1.md"

# アンカー対象の8ハーネス。順序固定=決定論的な manifest。
CODE = [
    ("nenrin_census.py",        "census 実装: 呼べる母集団を CT から数え直す(三集合分解、jidec-path-v1 witness 化)"),
    ("census_redteam.py",       "census の敵: 隠し/水増し/改ざん/残余誤名 を10手で fail-closed"),
    ("join_guard.py",           "join 実装: 座標(原価カテゴリ)を明細から導出、prover のラベルを不一致で拒否"),
    ("join_redteam.py",         "join の敵: 全サブ層を緑に保ったまま座標詐称を8手で拒否"),
    ("time_coordinate_probe.py","時刻座標 probe: created_at を prover が選べる問題(本物 Ed25519)"),
    ("time_redteam.py",         "時刻の敵: authorship 確認/postdating 拒否/backdating と currency を命名"),
    ("freshness_v2.py",         "freshness v2: backdating をビーコンで閉じ currency を fail-closed に"),
    ("freshness_v2_redteam.py", "freshness v2 の敵: 両側の時間箱と fail-closed を9手で確認"),
]

BAD_MARKERS = ["TBD", "TODO", "XXX", "<placeholder"]
FORBIDDEN_DASH = ["—", "–", "―", "−"]

def sha256_file(path):
    return hashlib.sha256(io.open(path, "rb").read()).hexdigest()

def main():
    if not os.path.isdir(CDIR):
        print("NG %s が無い。リポジトリ根から実行しているか確認" % CDIR); sys.exit(1)

    # spec の健全性
    if not os.path.exists(SPEC):
        print("NG %s が無い" % SPEC); sys.exit(1)
    spec_text = io.open(SPEC, encoding="utf-8").read()
    checks = [
        ("1000文字以上", len(spec_text) > 1000),
        ("プレースホルダ無し", not any(m in spec_text for m in BAD_MARKERS)),
        ("nenrin を含む", "nenrin" in spec_text.lower()),
        ("禁止ダッシュ無し", not any(d in spec_text for d in FORBIDDEN_DASH)),
    ]
    for c, o in checks:
        print("  %s spec: %s" % ("OK " if o else "NG ", c))
    if not all(o for _, o in checks):
        print("★ spec の前提が違う。1バイトも書かずに終了。"); sys.exit(1)

    # 8ハーネスの sha を計算
    rows = []
    for fname, desc in CODE:
        p = CDIR + "/" + fname
        if not os.path.exists(p):
            print("NG コードが無い: %s" % p); sys.exit(1)
        rows.append((fname, sha256_file(p), desc))

    # MANIFEST 本文を決定論的に組む
    lines = []
    lines.append("# NENRIN coordinate-v1 code manifest (`nenrin-coordinate-v1-manifest`)")
    lines.append("")
    lines.append("This manifest pins the exact bytes of the coordinate-integrity harnesses that back "
                 "NENRIN_COORDINATE_SPEC_v1.md. The SHA-256 of this manifest is appended to the JIDEC "
                 "ledger and stamped to Bitcoin. Anyone can clone the repository, take the SHA-256 of "
                 "each file below, compare it to the value here, and check the time this manifest entered "
                 "a Bitcoin block. No trust in the operator is required: fetch the bytes, recompute the "
                 "hash, check the anchor.")
    lines.append("")
    lines.append("Spec anchored beside this manifest:")
    lines.append("  %s  %s" % (sha256_file(SPEC), "NENRIN_COORDINATE_SPEC_v1.md"))
    lines.append("")
    lines.append("Harness files, in fixed order, each with its SHA-256:")
    lines.append("")
    for fname, sha, desc in rows:
        lines.append("  %s  %s" % (sha, fname))
        lines.append("      %s" % desc)
    lines.append("")
    lines.append("All four harnesses run offline and deterministically:")
    lines.append("  python3 nenrin_census.py ; python3 census_redteam.py")
    lines.append("  python3 join_guard.py ; python3 join_redteam.py")
    lines.append("  python3 time_coordinate_probe.py ; python3 time_redteam.py")
    lines.append("  python3 freshness_v2.py ; python3 freshness_v2_redteam.py")
    lines.append("")
    lines.append("Once this manifest is anchored, the byte sequence of each harness above is fixed at "
                 "that Bitcoin block height. A later correction is a new manifest that cites this one, "
                 "never an edit. The operator is a subject of this rule, not an exception.")
    manifest_text = "\n".join(lines) + "\n"

    for d in FORBIDDEN_DASH:
        if d in manifest_text:
            print("★ manifest に禁止ダッシュ。中止。"); sys.exit(1)

    io.open(MANIFEST, "w", encoding="utf-8").write(manifest_text)
    print("")
    print("書いた: %s" % MANIFEST)

    # seed 2枚
    for label, dst, text, work in [
        ("spec", ROOT + "/seed_entry_coordinate_v1_spec.json", spec_text,
         "NENRIN Coordinate Integrity v1 (SPEC anchor): one rule, three axes, join + census + time"),
        ("manifest", ROOT + "/seed_entry_coordinate_v1_manifest.json", manifest_text,
         "NENRIN Coordinate Integrity v1 code manifest: SHA-256 of the eight harnesses, byte-pinned"),
    ]:
        sha = hashlib.sha256(text.encode("utf-8")).hexdigest()
        seed = {"claim_sha256": sha, "record_canonical": text, "work": work}
        io.open(dst, "w", encoding="utf-8").write(json.dumps(seed, ensure_ascii=False))
        back = json.load(io.open(dst, encoding="utf-8"))
        re_sha = hashlib.sha256(back["record_canonical"].encode("utf-8")).hexdigest()
        if re_sha != sha or back["claim_sha256"] != sha:
            print("★ %s: 読み戻し検算に失敗。中止。" % dst); sys.exit(1)
        print("書いた: %s" % dst)
        print("  claim_sha256: %s" % sha)

    print("")
    print("次(TOshi 手):")
    print("  1) git add: workers/hs-ledger/nenrin/coordinate-v1/MANIFEST_coordinate_v1.md")
    print("             workers/hs-ledger/seed_entry_coordinate_v1_spec.json")
    print("             workers/hs-ledger/seed_entry_coordinate_v1_manifest.json")
    print("     commit / push (原本が GitHub にある状態で anchor する)")
    print("  2) 台帳へ append(回転後の鍵で。既存 NENRIN と同じ手順)")
    print("  3) ots stamp。数時間後に Bitcoin ブロックに入る")

if __name__ == "__main__":
    main()
