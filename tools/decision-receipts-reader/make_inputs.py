"""Writes inputs-06.json: the procedure, T and inputs of each of the 96 vectors, taken from the -06 draft
(A.1, A.3, A.5 F10) and from the derivations in A5-description.txt of the test package, read with the results
hidden.  No expected result is written.  Usage: python3 -I -B make_inputs.py <out.json>"""
import json, sys

V = "vectors/"
inputs = {
    "a1": (V + "v1-action.txt", "dec54f771352454097310ae4bd6608c0070ebebb3955c6be013c1b3a8e310bd0"),
    "a2": (V + "v2-action.txt", "5a7549948a1441addb710f5ada59e06dbce25cc5a59accf14f140379f47adb5b"),
    "ap": (V + "v1-approval-record.json", "88e5b6d69b3e4bc250a42aeffea0414d406e5f04ba4f991ee432a78231da1170"),
    "a3": (V + "v3-action.json", "9165c850b7e03cd59578efa1769be74c5386cff5ce96df6b59e25d38ad6f88b4"),
    "e3": (V + "v3-effect.json", "d3d824cf55168298c0f651244853ec9d9620ea09087abe899243ceb8f9df3a6d"),
    "ap2": (V + "f-ap2.json", "37ec7f3fa06f086626268a6c818ba5b5af7fd16ba292735ce964a83c42c0357c"),
    "c1": (V + "f-c1.json", "f13fce72c54f1872232c0339fa98b33ffe5142f72481cd31e378bc6a680b6f6a"),
    "c2": (V + "f-c2.json", "3e9cea5ebe4860d1f5743526dcdf1f5200c11e8abd7ce67326abfa16f30c6c7f"),
    "ap3": (V + "in-ap3.json", "b4ee9ca3400fe58cc8f5b88db70b0a662e811a2a65ac3be1a47e0451b93cc479"),
    "ap4": (V + "in-ap4.json", "100dcee48c0f2cf0411649da2e9f5a59d1644c1b113d485738343212115ed236"),
    "ap5": (V + "in-ap5.json", "be16b3dacb346d4d33696ff47fb1926c34504744517b052642d4948c4dba0e25"),
    "ap6": (V + "in-ap6.json", "07733e5408f841f9340086efe818ad046f4f34fb3525643a10564f7aea8334f5"),
    "ap7": (V + "in-ap7.json", "2e9ce0cdd4ba1a2a43d365653e69ffcbac6a78342ddee8e1c38987e30ba96a4a"),
    "ap8": (V + "in-ap8.json", "1eb382f6f65f34044b6404baf6a8dfb2c376249ab40d8209f2ebb52b07d2b130"),
    "ap9": (V + "in-ap9.json", "0eec6ee1fa1bdec7ae05889c59cccbff18ab6d42d3045d46e191b631454d5b0a"),
    "ap10": (V + "in-ap10.json", "eaca112629476248efd0b59a749b7c548ab347b7489a13128e45f7d2d28ce328"),
    "c3": (V + "in-c3.json", "2aea8ba9b0793773d1e282163cfc31b9cb6135247ec02e3c06c13d52ad9ebe2e"),
    "F15-SER-P1": (V + "f15-ser-p1-receipt.json", "02036d1f57509858330383755ec16c532bdc58b0f2d949464488d57abc9f95e7"),
}
T1, T2, T3 = "2026-10-15T09:01:00Z", "2026-10-15T09:06:00Z", "2026-10-15T09:11:00Z"
vec = []
def c1(n, env, T=T1, approval="ap", state=None, **kw):
    vec.append(dict(name=n, proc="case1", env=V + env, T=T, action="a1", approval=approval, state=state, **kw))
def c2(n, env, T=T2, action="a2", **kw):
    vec.append(dict(name=n, proc="case2", env=V + env, T=T, action=action, **kw))
def c3(n, out, dec="v3-decision.dsse.json", T=T3, effect="e3", **kw):
    vec.append(dict(name=n, proc="case3", decision_env=V + dec, outcome_env=V + out, T=T, action="a3", effect=effect, **kw))
# Appendix A.3 (draft body) and V2-micro
c1("V1-good", "v1-approval-good.dsse.json")
c1("V1-bad", "v1-approval-bad.dsse.json")
c2("V2-good", "v2-declined-good.dsse.json")
c2("V2-bad", "v2-declined-bad.dsse.json")
c3("V3-decision", "v3-outcome-good.dsse.json")
c3("V3-good", "v3-outcome-good.dsse.json")
c3("V3-bad", "v3-outcome-bad.dsse.json")
c2("V2-micro", "v2-micro.dsse.json", T="2026-10-15T09:05:00.000001Z")
# A.5
c1("F1", "f1.dsse.json"); c2("F2", "f2.dsse.json"); c2("F3", "f3.dsse.json")
c1("F4", "v1-approval-good.dsse.json", T="2026-10-15T09:05:05Z")
c2("F5", "v2-declined-good.dsse.json", action="a1")
c3("F6", "f6.dsse.json"); c3("F7", "f7.dsse.json"); c3("F8", "f8.dsse.json")
c1("F9", "f9.dsse.json", T="2026-10-15T09:16:00Z")
c1("F10", "f10.dsse.json", T="2026-10-15T09:21:00Z", approval="ap2", state="c1")
c2("F11", "f11.dsse.json"); c2("F12", "f12.dsse.json")
c1("F13", "v1-approval-good.dsse.json", state="c2")
c1("F14", "f14.dsse.json")
c2("F15", "f15-ser-p1-receipt.json")
c2("F16", "f16-bom.dsse.json")
c3("F17", "f17-outcome.dsse.json", dec="f17.dsse.json")
c3("F18", "f18.dsse.json")
for i in range(19, 31):
    c2("F%d" % i, "f%d.dsse.json" % i)
for i in range(31, 35):
    c3("F%d" % i, "v3-outcome-good.dsse.json", dec="f%d.dsse.json" % i)
c2("F35", "f35.dsse.json"); c2("F36", "f36.dsse.json")
c2("F37", "v2-declined-good.dsse.json", T="2026-10-15T09:04:00Z")
c2("F38", "v2-declined-good.dsse.json", aud="observer-2")
c2("F39", "v2-declined-good.dsse.json", nonce="dec-0009")
c1("F40", "f40.dsse.json"); c1("F41", "f41.dsse.json")
c1("F42", "v1-approval-good.dsse.json", approval=None)
c1("F43", "v1-approval-good.dsse.json", approval="ap2")
for i, ap in zip(range(44, 51), ("ap3", "ap4", "ap5", "ap6", "ap7", "ap8", "ap9")):
    c1("F%d" % i, "f%d.dsse.json" % i, approval=ap)
for i in (51, 52, 53):
    c2("F%d" % i, "f%d.dsse.json" % i)
for i in range(54, 71):
    if i == 65:
        c3("F65", "f6.dsse.json", executor_id="forge:another-actor")
    elif i == 66:
        c3("F66", "f66.dsse.json", policy="P2")
    elif i == 67:
        c3("F67", "f67.dsse.json", policy="P3", executor_id="gate-1")
    elif i == 69:
        c3("F69", "v3-outcome-good.dsse.json", effect="a3")
    else:
        c3("F%d" % i, "f%d.dsse.json" % i)
c1("F71", "v1-approval-good.dsse.json", state="c3")
c2("F72", "f72.dsse.json")
c2("F73", "v2-micro.dsse.json", T="2026-10-15T09:05:00Z")
c1("F74", "f74.dsse.json")
c3("F75", "f75.dsse.json")
c1("F76", "f76.dsse.json", approval="ap10")
c1("F77", "v1-approval-good.dsse.json", state="c1")
for i in (78, 79, 80, 81):
    c2("F%d" % i, "f%d.dsse.json" % i)
c3("F82", "f82.dsse.json")
for i in range(83, 89):
    c2("F%d" % i, "f%d.dsse.json" % i)
assert len(vec) == 96 and len({v["name"] for v in vec}) == 96
doc = {
    "inputs": {n: {"file": f, "sha256": h} for n, (f, h) in inputs.items()},
    "policies": {"A1": V + "trust-policy.json", "P2": V + "policy-P2.json", "P3": V + "policy-P3.json"},
    "defaults": {"aud": "observer-1", "dm_id": "gate-1", "executor_id": "forge:agent-42-bot"},
    "keys": {
        "gate-1": {"label": "draft-gruszka-audit-decision-receipts test key gate-1",
                   "seed": "100fa92fa6464c141f791a96327f555c1c0cfbf3095af986537e50c3c4335f8c",
                   "pub_b64": "TWfs75IN1In3CNI8TnyIOUHgtwilOPGcRFQLJ670CJc="},
        "observer-1": {"label": "draft-gruszka-audit-decision-receipts test key observer-1",
                       "seed": "f03ad5b668ad225ea15fd9fd272fc8df84be59f467da86b0f2ad0a5ad26f4ddd",
                       "pub_b64": "4hDsi5TCL+A+9SB7k2l4EkY7XePUheE+zE9mBazt2Fs="}},
    "B_sha256": "8cd849a6dcce08aee334511d7b2f31c54e478885dda1795d3c8f972dd0d4811c",
    "B_b64": [
        "eyJjb21taXRfYWxnIjoic2hhMjU2LXNhbHRlZC12MSIsImNvbXBhcmF0b3IiOiI+",
        "PSIsImRhdGFzZXRfaWRfY29tbWl0Ijoic2hhMjU2OmEyMWJhNGQ5NmM4MDNkNDI2",
        "M2RkM2QyMTYxYmMwMzlhMzBmNDQ2MmJkNTk0NzBlMzFiYTVhOWFiMGE5YjNiNjMi",
        "LCJtZXRyaWMiOiJhY2N1cmFjeSIsIm1vZGVsX2lkX2NvbW1pdCI6InNoYTI1Njo5",
        "MDRkZTQyNTYyZjlhMTk2NTFlMTllYjdhYjE2NWU0ZmZlMTE0Y2U1YTJmOThlNTdk",
        "YTU4Mzg5NTk2ODRmYjBmIiwibiI6MTgwMCwicGFzc2VkIjp0cnVlLCJzY2hlbWEi",
        "OiJodHRwczovL3NpZ25lZC1ldmlkZW5jZS5vcmcvZXZhbC1yZWNlaXB0L3YxIiwi",
        "c2NvcmUiOiIwLjgzNCIsInN1aXRlIjoiYWNtZS1zYWZldHktc3VpdGUiLCJzdWl0",
        "ZV92ZXJzaW9uIjoiMS4yLjAiLCJ0aHJlc2hvbGQiOiIwLjgwMCIsInRpbWVzdGFt",
        "cCI6IjIwMjYtMTAtMDJUMDA6MDA6MDBaIn0="],
    "payload_sha256_from_text": {
        "V1-good": {"file": V + "v1-approval-good.dsse.json", "sha256": "b9dfd26537542632013d0df166141a788551b4987dfa33b060d5b5ebba78dfb1"},
        "V1-bad": {"file": V + "v1-approval-bad.dsse.json", "sha256": "69eb87fb33a29153182b0e0c89a444023cc00c82fe7c8db1c7e0893363b2c926"},
        "V2-good": {"file": V + "v2-declined-good.dsse.json", "sha256": "ed149a1c7383842eebf8304001da9de97d130b0b15080d1315ab8fbf1274ed44"},
        "V2-bad": {"file": V + "v2-declined-bad.dsse.json", "sha256": "646d4b2229a55c54848361030bf6d57816597a96bd7d1fb00d7da0f03b009bd2"},
        "V3-decision": {"file": V + "v3-decision.dsse.json", "sha256": "0014b1c419798125c3984e85a4b322ee619a3227978840cac5f9d282b189521f"},
        "V3-good": {"file": V + "v3-outcome-good.dsse.json", "sha256": "f0ff90cf25e2db1e989fa79869d4b3b46899112e8c2269d9a18a64b751aa7274"},
        "V3-bad": {"file": V + "v3-outcome-bad.dsse.json", "sha256": "48be708cf3f959556323474f4a5c9193b417d2bfea5c88bb852daf00b64827b4"},
        "F10": {"file": V + "f10.dsse.json", "sha256": "c299b48e0a0596f8c8eb252beef0138c7d1133f113cdc03150abb6cb41bcdcce"}},
    "v3_good_env": V + "v3-outcome-good.dsse.json",
    "notes": {"V3-decision": "no result of its own (A.3); shown is the Case 3 pair with V3-good"},
    "vectors": vec,
}
open(sys.argv[1], "w").write(json.dumps(doc, indent=1, sort_keys=True))
print(len(vec))
