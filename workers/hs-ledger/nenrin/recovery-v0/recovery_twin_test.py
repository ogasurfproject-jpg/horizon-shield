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

print("\n".join(out))
print("=== %d / %d 合格 (recovery-twin: python が node と byte 一致) ===" % (p, p + f))
if f: sys.exit(1)
