# RUN_ALL: suite
# 双子の採点。python の canonical バイトが node と 1 桁も違わんか (fixture の 7 記録の record_sha256 で突き合わせる)。
# そして python の verify_chain が node と同じ拒否を返すか、python が署名した記録を node が受けるか。
# 緑の意味: 2 言語が「記録とは何バイトか」で一致した、それだけや。
import json, os, sys, subprocess, tempfile
import recovery_verify as R

HERE = os.path.dirname(os.path.abspath(__file__))
fx = json.load(open(os.path.join(HERE, "recovery_fixture_20260920.json"), encoding="utf-8"))
p = f = 0; out = []
def t(name, ok, detail=""):
    global p, f
    if ok: p += 1
    else: f += 1
    out.append(("  ok   " if ok else "  FAIL ") + name + ("" if ok or not detail else "  <- " + str(detail)))
def codes(r): return [x["code"] for x in r["refusals"]]

# 1. byte 一致: python の record_sha256 == fixture に焼かれた node の値 (全 7)
for i, rec in enumerate(fx):
    h = R.record_sha256(rec)
    t("byte-identity: record[%d] %s python sha == node sha" % (i, rec["schema"]), h == rec["record_sha256"], h + " vs " + rec["record_sha256"])

# 2. python verify_chain が fixture を 1 区間として通す
chain = R.verify_chain(fx)
t("python: fixture verifies as a complete segment", chain["ok"] and chain.get("segment", {}).get("complete") is True, json.dumps(chain["refusals"]))
t("python: three drift records open the segment", chain.get("segment", {}).get("drifts", []).__len__() == 3)

# 3. 変異の拒否コードが node と一致
m = json.loads(json.dumps(fx[3])); m["diagnosis"] += " "
t("python: one byte in diagnosis -> hash_mismatch", "hash_mismatch" in codes(R.verify_record(m)))
m2 = json.loads(json.dumps(fx[0])); m2["observed"]["count"] = 3
t("python: a JSON number -> number_in_record", "number_in_record" in codes(R.verify_record(m2)))
m3 = json.loads(json.dumps(fx[3])); del m3["establishes"]
t("python: establishes removed -> disclaimer_missing", "disclaimer_missing" in codes(R.verify_record(m3)))
m4 = json.loads(json.dumps(fx[3])); m4["primitive"] = "rm_rf_root"
t("python: primitive outside the catalog -> primitive_not_in_catalog", "primitive_not_in_catalog" in codes(R.verify_record(m4)))
t("python: real fixture strict mode flags the unsigned approval", "authorization_unsigned" in codes(R.verify_chain(fx, operator_keys=["x"])))

# 4. Ed25519: python が署名 -> python が検証、そして node が検証 (cross-language)
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization
priv = Ed25519PrivateKey.generate()
pub_b64 = __import__("base64").b64encode(priv.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()
signed = R.sign_record(fx[4], priv)
t("python: python-signed record verifies in python", R.verify_record(signed)["ok"])
tmp = os.path.join(tempfile.gettempdir(), "recovery_twin_signed.json")
json.dump(signed, open(tmp, "w"))
node_src = ("const fs=require('fs');import('./recovery_verify.mjs').then(async m=>{"
            "const r=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));"
            "const v=await m.verifyRecord(r);"
            "process.stdout.write(v.ok?'NODE_OK':'NODE_FAIL:'+JSON.stringify(v.refusals));});")
res = subprocess.run(["node", "-e", node_src, tmp], cwd=HERE, capture_output=True, text=True)
t("cross-language: python-signed record verifies in node (Ed25519 + canonical byte-identity)", res.stdout.strip() == "NODE_OK", res.stdout + res.stderr)

# 5. python-signed authorization を fixture に差し込んで strict モードで通す (node と同じ挙動)
v1 = json.loads(json.dumps(fx))
signed_auth = R.sign_record(fx[4], priv)
v1[4] = signed_auth
# execution.prev と authorization_sha256 を新 hash に張り直す (seal 相当)
v1[5] = dict(R.hashed_body(v1[5])); v1[5]["prev"] = signed_auth["record_sha256"]; v1[5]["authorization_sha256"] = signed_auth["record_sha256"]; v1[5]["record_sha256"] = R.record_sha256(v1[5])
v1[6] = dict(R.hashed_body(v1[6])); v1[6]["prev"] = v1[5]["record_sha256"]; v1[6]["execution_sha256"] = v1[5]["record_sha256"]; v1[6]["record_sha256"] = R.record_sha256(v1[6])
strict = R.verify_chain(v1, operator_keys=[pub_b64])
t("python: a signed authorization by a trusted key verifies in strict mode", strict["ok"], json.dumps(strict["refusals"]))
untrusted = R.verify_chain(v1, operator_keys=["someotherkey"])
t("python: a signed authorization by an untrusted key is refused", "authorization_untrusted_key" in codes(untrusted))

# 6. v2 籤: python の draw が node の fixture と同じ k 人を出し、埋め込み観測の byte が一致し、同じ拒否を返す
wf = json.load(open(os.path.join(HERE, "witness_fixture_20260920.json"), encoding="utf-8"))
wv = wf["records"][6]; own = "gate.horizonshield.dev"
t("v2 byte-identity: verify record with draw + embedded signed observations, python sha == node sha", R.record_sha256(wv) == wv["record_sha256"])
for n, e in enumerate(wv["external"]):
    if "record" in e:
        t("v2 byte-identity: external[%d] observation python sha == witness's sha, and its Ed25519 signature verifies in python" % n, R.record_sha256(e["record"]) == e["record"]["record_sha256"] and R.verify_record(e["record"])["ok"])
d = R.draw(wf["pool"], wf["beacon"]["hash"], wf["records"][5]["record_sha256"], 3, exclude_host=own)
t("v2 draw: python draws the same 3 witnesses as node from beacon + pool + execution hash", d["drawn"] == wv["draw"]["drawn"] and d["pool_sha256"] == wv["draw"]["pool_sha256"], json.dumps(d["drawn"]))
d_rev = R.draw({"entries": list(reversed(wf["pool"]["entries"]))}, wf["beacon"]["hash"], wf["records"][5]["record_sha256"], 3, exclude_host=own)
t("v2 draw: pool file order does not matter in python either", d_rev["drawn"] == d["drawn"])
q2 = R.verify_chain(wf["records"], witness_quorum={"q": wf["q"], "pool": wf["pool"], "beaconHash": wf["beacon"]["hash"]})
t("v2 python: fixture verifies with quorum %s, 2 agreeing" % wf["q"], q2["ok"] and q2["segment"]["witness"]["agreeing"] == wv["draw"]["drawn"][:2], json.dumps(q2["refusals"]))
q3 = R.verify_chain(wf["records"], witness_quorum={"q": 3, "pool": wf["pool"]})
t("v2 python: quorum 3 -> witness_quorum_short (one drawn witness did not answer)", "witness_quorum_short" in codes(q3))
t("v2 python: v0 fixture under a quorum -> witness_quorum_short", "witness_quorum_short" in codes(R.verify_chain(fx, witness_quorum={"q": 1, "pool": wf["pool"]})))
m = json.loads(json.dumps(wf["records"])); m[6]["draw"]["drawn"][0] = "witness-e.example"
m[6] = dict(R.hashed_body(m[6])); m[6]["record_sha256"] = R.record_sha256(m[6])
t("v2 python: drawn edited by hand -> draw_mismatch", "draw_mismatch" in codes(R.verify_chain(m, witness_quorum={"q": 2, "pool": wf["pool"]})))
bad_pool = {"entries": wf["pool"]["entries"] + [{"signed_domain": "witness-f.example", "key_url": "https://witness-f.example/k.json", "public_key_ed25519_b64": "zz" + wf["pool"]["entries"][0]["public_key_ed25519_b64"][2:]}]}
t("v2 python: another pool -> pool_mismatch", "pool_mismatch" in codes(R.verify_chain(wf["records"], witness_quorum={"q": 2, "pool": bad_pool})))
t("v2 python: another beacon -> beacon_mismatch", "beacon_mismatch" in codes(R.verify_chain(wf["records"], witness_quorum={"q": 2, "pool": wf["pool"], "beaconHash": "f" * 64})))
m2 = json.loads(json.dumps(wf["records"])); idx = next(i for i, e in enumerate(m2[6]["external"]) if "record" in e)
m2[6]["external"][idx]["record"]["observed"]["health.gate_commit"]["gate_commit"] = "deadbeef0000"
m2[6] = dict(R.hashed_body(m2[6])); m2[6]["record_sha256"] = R.record_sha256(m2[6])
t("v2 python: one byte inside a witness observation -> hash_mismatch", "hash_mismatch" in codes(R.verify_chain(m2, witness_quorum={"q": 2, "pool": wf["pool"]})))
m3 = json.loads(json.dumps(wf["records"])); m3[6]["external"][idx]["signed_domain"] = "witness-e.example"
m3[6] = dict(R.hashed_body(m3[6])); m3[6]["record_sha256"] = R.record_sha256(m3[6])
t("v2 python: entry.signed_domain differs from the signed record -> witness_domain_mismatch", "witness_domain_mismatch" in codes(R.verify_chain(m3, witness_quorum={"q": 2, "pool": wf["pool"]})))
m4 = json.loads(json.dumps(wf["records"])); m4[6]["external"][idx]["record"]["recorded_at"] = "2026-09-20T07:00:00Z"
m4[6] = dict(R.hashed_body(m4[6])); m4[6]["record_sha256"] = R.record_sha256(m4[6])
t("v2 python: observation dated before the execution -> hash_mismatch of the witness record (its own hash no longer recomputes) or witness_before_execution", any(c in ("hash_mismatch", "witness_before_execution") for c in codes(R.verify_chain(m4, witness_quorum={"q": 2, "pool": wf["pool"]}))))
m5 = json.loads(json.dumps(wf["records"])); m5[6]["draw"]["pool_size"] = "7"
m5[6] = dict(R.hashed_body(m5[6])); m5[6]["record_sha256"] = R.record_sha256(m5[6])
t("v2 python: draw.pool_size not the pool's size -> draw_mismatch", "draw_mismatch" in codes(R.verify_chain(m5, witness_quorum={"q": 2, "pool": wf["pool"]})))
t("v2 python: policy k 5 against a draw of 3 -> draw_mismatch; k 3 passes", "draw_mismatch" in codes(R.verify_chain(wf["records"], witness_quorum={"q": 2, "pool": wf["pool"], "k": 5})) and R.verify_chain(wf["records"], witness_quorum={"q": 2, "pool": wf["pool"], "k": 3})["ok"])
sc = {"q": 2, "pool": wf["pool"], "requireCommitment": True, "commitmentAnchor": {"height": "0", "hash": wv["draw"]["commitment"]["anchor"]["hash"]}}
t("v2.2 python: fixture passes with requireCommitment + the reader's anchor", R.verify_chain(wf["records"], witness_quorum=sc)["ok"], json.dumps(R.verify_chain(wf["records"], witness_quorum=sc)["refusals"]))
t("v2.2 python: claim text is byte-identical to node (fixture claim_sha256 recomputes)", R.sha256_hex(R.commitment_claim_text(wf["records"][5]["record_sha256"])) == wv["draw"]["commitment"]["claim_sha256"])
m6 = json.loads(json.dumps(wf["records"])); del m6[6]["draw"]["commitment"]
m6[6] = dict(R.hashed_body(m6[6])); m6[6]["record_sha256"] = R.record_sha256(m6[6])
t("v2.2 python: no commitment under the policy -> draw_uncommitted", "draw_uncommitted" in codes(R.verify_chain(m6, witness_quorum=sc)))
m7 = json.loads(json.dumps(wf["records"])); m7[6]["draw"]["beacon"]["height"] = "2"
m7[6] = dict(R.hashed_body(m7[6])); m7[6]["record_sha256"] = R.record_sha256(m7[6])
t("v2.2 python: beacon not anchor + 1 -> beacon_not_next_block", "beacon_not_next_block" in codes(R.verify_chain(m7, witness_quorum=sc)))
t("v2.2 python: reader's anchor at another height -> commitment_mismatch", "commitment_mismatch" in codes(R.verify_chain(wf["records"], witness_quorum={**sc, "commitmentAnchor": {"height": "9"}})))
t("v2 python: subset_matches keeps extra observed keys, refuses missing ones", R.subset_matches({"a": {"b": "1"}}, {"a": {"b": "1", "c": "2"}}) and not R.subset_matches({"a": {"b": "1", "c": "2"}}, {"a": {"b": "1"}}))

# 7. 実事件 2 (2026-09-20 署名切れ) の 12 記録: python でも byte 一致、運営者鍵の strict で通る
inc = json.load(open(os.path.join(HERE, "incident_20260920_resign_chain.json"), encoding="utf-8"))
t("incident 2: all 12 record_sha256 recompute in python", all(R.record_sha256(r) == r["record_sha256"] for r in inc["records"]))
st = R.verify_chain(inc["records"], operator_keys=[inc["operator_public_key_ed25519_b64"]])
t("incident 2: python strict verify_chain ok and complete", st["ok"] and st["segment"]["complete"], json.dumps(st["refusals"]))
t("incident 2: python asked for a quorum says witness_quorum_short", "witness_quorum_short" in codes(R.verify_chain(inc["records"], operator_keys=[inc["operator_public_key_ed25519_b64"]], witness_quorum={"q": 1, "pool": json.load(open(os.path.join(HERE, "witness_pool.json"), encoding="utf-8"))})))

print("\n".join(out))
print("=== %d / %d 合格 (recovery-twin: python が node と byte 一致、v2 籤も同じ k 人) ===" % (p, p + f))
if f: sys.exit(1)
