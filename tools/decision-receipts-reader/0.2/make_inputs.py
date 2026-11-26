"""make_inputs for dr_check 0.2.0: writes inputs-11.json from the verifier calls of the -11 test package.

For each vector it keeps the name, the input file of the package it comes from and the argv of its verifier call,
and for every file those calls read, the SHA-256 that MANIFEST.sha256 gives.  It reads only the input files named
below and MANIFEST.sha256; it opens no expected result.

Usage: python3 -I -B make_inputs.py <package_dir> inputs-11.json
"""
import glob, hashlib, json, os, sys

VALUE_FLAGS = {"-binding", "-decision-binding", "-policy", "-pub", "-signer", "-t", "-aud", "-nonce", "-case",
               "-action", "-approval", "-approver-pub", "-consumed", "-received", "-held", "-held-approval",
               "-audit-context", "-executor-id", "-decision", "-decision-pub", "-decision-signer", "-decision-aud",
               "-decision-nonce", "-effect"}
BOOL_FLAGS = {"-first", "-second"}
FILE_FLAGS = {"-policy", "-action", "-approval", "-consumed", "-received", "-held-approval", "-audit-context",
              "-decision", "-effect"}


def files_of(argv):
    out, i = [], 1
    while i < len(argv):
        x = argv[i]
        if x in BOOL_FLAGS:
            i += 1
        elif x in VALUE_FLAGS:
            if x in FILE_FLAGS:
                out.append(argv[i + 1])
            elif x == "-held":
                out.append(argv[i + 1].split(":", 1)[1])
            i += 2
        else:
            out.append(x)
            i += 1
    return out


def main(argv):
    if len(argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    pkg, outp = argv[1], argv[2]
    rel = lambda p: os.path.relpath(p, pkg)
    sources = (["inputs.json"] + sorted(rel(p) for p in glob.glob(os.path.join(pkg, "inputs-08", "*.json")))
               + sorted(rel(p) for p in glob.glob(os.path.join(pkg, "inputs-10", "*.json")))
               + ["cose/inputs-cose.json", "approver-signature/inputs-sa.json", "first-check/inputs-first.json"])
    manifest = {}
    with open(os.path.join(pkg, "MANIFEST.sha256"), "rb") as f:
        mbytes = f.read()
    for line in mbytes.decode("utf-8").splitlines():
        h, p = line.split(None, 1)
        manifest[p[2:] if p.startswith("./") else p] = h
    vectors, files, srcsha, names = [], {}, {}, set()
    for s in sources:
        with open(os.path.join(pkg, s), "rb") as f:
            b = f.read()
        srcsha[s] = hashlib.sha256(b).hexdigest()
        for v in json.loads(b)["vectors"]:
            if v["name"] in names:
                raise SystemExit("vector name twice: " + v["name"])
            names.add(v["name"])
            a = v["verifier"]["argv"]
            vectors.append({"name": v["name"], "source": s, "argv": a})
            for p in files_of(a):
                files[p] = manifest.get(p)
    doc = {"draft": "draft-gruszka-audit-decision-receipts-11", "made_by": "make_inputs.py of dr_check 0.2.0",
           "manifest_sha256": hashlib.sha256(mbytes).hexdigest(), "sources": srcsha, "count": len(vectors),
           "vectors": vectors, "files": files}
    data = json.dumps(doc, sort_keys=True, indent=1).encode()
    with open(outp, "wb") as f:
        f.write(data)
    missing = sorted(p for p, h in files.items() if h is None)
    print("%d vectors, %d files, %d not in MANIFEST.sha256" % (len(vectors), len(files), len(missing)), file=sys.stderr)
    for p in missing:
        print("  not in MANIFEST: " + p, file=sys.stderr)
    print(hashlib.sha256(data).hexdigest())
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
