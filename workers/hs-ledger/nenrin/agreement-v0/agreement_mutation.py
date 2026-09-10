#!/usr/bin/env python3
"""Mutation test for agreement_redteam.py. It breaks agreement_verify.py one rule at a time and
checks that the adversary notices. Run: python3 agreement_mutation.py   (about ten minutes)

A suite of 166 vectors that all pass proves nothing on its own: a suite can be green because
the rules hold, or green because the vectors never touch them. This file tells the two apart.
It was worth writing twice. First it found that the single most important rule in the whole
program, that a verdict is never "accepted" unless both signatures actually verified, could be
replaced with the constant true and the adversary stayed green. That is now vector-covered, and
the flag is derived from the evidence in the report rather than set beside it. Then, before asking
an outside reviewer to find a surviving mutant, the operator hunted for one first: eleven
candidates outside this list, ten of which survived. Every rule they broke existed in the
verifier; what was missing was a vector. All ten are in the list below now. A suite that catches
every mutant somebody wrote for it has said nothing about the mutants nobody wrote, and the only
way to learn the difference is to keep writing new ones.

Two mutants are expected to SURVIVE and are marked so. A mutant that changes no behaviour is not
a hole in the adversary, and pretending otherwise would train the reader to ignore this output.

Restoring the file it edits is the whole safety story, and the first version of this claim was
false. It said "restored on every exit path, including a crash and a Ctrl-C", which is true for
exceptions and for SIGINT and is NOT true for SIGTERM: python's default handler ends the process
without running a finally block. On 2026-09-10 a two minute command timeout sent exactly that
signal in the middle of a run, and agreement_verify.py was left with a mutant in it. Nothing was
committed, because the next run of the adversary went red and the mutated line was found by
hashing the file against a copy on another machine. It could as easily have been committed.

So the file is now protected by a copy on disk, not only by a finally block: a backup is written
beside it before the first mutation and removed only after the file is restored and compared byte
for byte. If this program starts and finds that backup already there, a previous run died: it
restores from it and says so before doing anything else. SIGTERM and SIGINT are turned into a
normal exit so the finally still runs; even a SIGKILL, which cannot be caught, leaves the backup
for the next run to find.
"""

import hashlib
import os
import signal
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TARGET = os.path.join(HERE, "agreement_verify.py")
SUITE = os.path.join(HERE, "agreement_redteam.py")
BACKUP = os.path.join(HERE, ".agreement_verify.py.mutation_backup")


def _bye(signum, _frame):
    raise SystemExit("interrupted by signal %d" % signum)


def recover_if_needed():
    """A previous run died with a mutant applied. The backup on disk is the real one."""
    if not os.path.exists(BACKUP):
        return
    with open(BACKUP, encoding="utf-8") as f:
        saved = f.read()
    with open(TARGET, encoding="utf-8") as f:
        now = f.read()
    if saved != now:
        with open(TARGET, "w", encoding="utf-8") as f:
            f.write(saved)
        print("RECOVERED %s from a backup left by a run that did not finish." % os.path.basename(TARGET))
        print("          the file on disk was NOT the real one; it is now.\n")
    os.remove(BACKUP)

# (name, exact text to replace, replacement, expect_caught)
MUTANTS = [
    ("drop the v1.1 context prefix", 'SCHEMA_V11: b"a2a-agreement-v1.1\\n"}', 'SCHEMA_V11: b""}', True),
    ("drop the small order key check", '    elif not _ext_is_identity(_scalarmult(point, _L25519)):', '    elif False:', True),
    ("drop the text scan", '    bad_text = scan_text(record)', '    bad_text = []', True),
    ("drop conduct subject binding", '            if subj and other and not under_domain(subj, other):', '            if False:', True),
    ("let the subject be any host at all", 'if subj and other and not under_domain(subj, other):', 'if subj and other and False:', True),
    ("always claim signatures checked", 'checked = len(per_sig) == 2 and all(e["result"] == "valid" for e in per_sig)', 'checked = True', True),
    ("drop the overclaim guard", '        for pat, what in OVERCLAIM:', '        for pat, what in []:', True),
    ("drop duplicate key detection", '            raise ValueError("duplicate key in JSON object: %s" % k)', '            pass', True),
    ("drop the depth limit", '    if cyclic or depth >= MAX_DEPTH or nodes > MAX_NODES:', '    if False:', True),
    ("drop signature_not_a_party", '            r.refuse("signature_not_a_party",', '            r.find("signature_not_a_party",', True),
    ("drop the v1.1 canonical requirement", '        if strict:\n            r.refuse("not_canonical",', '        if False:\n            r.refuse("not_canonical",', True),
    ("drop recorder disclosure", '            if isinstance(is_party, bool) and actually != is_party:', '            if False:', True),
    ("accept an unlisted fee basis", '        elif basis not in FEE_BASES_OK:', '        elif False:', True),
    ("accept two signatures from one side", 'if len(sig_doms) == 2 and sig_doms[0] == sig_doms[1]:', 'if False:', True),
    ("stop refusing a subdomain counterparty", 'elif under_domain(a, b) or under_domain(b, a):', 'elif False:', True),
    ("stop pinning key_url in the signed bytes", 'elif ku is not None and ku != party.get("key_url"):', 'elif False:', True),
    ("stop refusing an uppercase conduct sha", 'elif not (isinstance(sha, str) and re.match(r"^[0-9a-f]{64}$", sha)):\n                    r.refuse("bad_conduct_sha"', 'elif False:\n                    r.refuse("bad_conduct_sha"', True),
    ("stop refusing unsafe numbers", 'r.refuse("unsafe_number", "%s is %s (%s)" % (path, why, shown))', 'pass', True),
    ("stop refusing an empty disclaimer", 'if not ok_arr(est) or not ok_arr(dne):', 'if False:', True),
    ("stop refusing three signatures", 'elif len(sigs) > 2:', 'elif False:', True),
    ("stop requiring two parties", 'if not isinstance(parties, list) or len(parties) != 2:', 'if not isinstance(parties, list) or len(parties) < 1:', True),
    ("stop refusing roles that do not pair", 'elif roles != ["peer", "peer"]:', 'elif False:', True),
    ("stop refusing one key on both sides", 'if len(pubs) == 2 and pubs[0] == pubs[1]:', 'if False:', True),
    ("stop refusing a v1.1 key_url in a signature", 'if ku is not None:\n                r.refuse("signature_key_url_present"', 'if False:\n                r.refuse("signature_key_url_present"', True),
    ("stop requiring agreement_id", 'if not (isinstance(aid, str) and re.match(r"^[0-9a-f]{32}$", aid)):', 'if False:', True),
    ("stop requiring the card sha", 'if not (isinstance(cs, str) and re.match(r"^[0-9a-f]{64}$", cs)):', 'if False:', True),
    ("stop requiring a currency", 'if not (isinstance(cur, str) and re.match(r"^[A-Z]{3}$", cur)):', 'if False:', True),
    ("stop requiring consideration to be stated", 'if cons not in ("money", "none"):', 'if False:', True),
    ("let a priced agreement claim nothing is owed", 'elif cons == "none":', 'elif False:', True),
    ("stop checking who_pays_whom vs roles", 'if not isinstance(wpw, dict) or (payer and payee and (norm_domain(wpw.get("from")) != payer or norm_domain(wpw.get("to")) != payee)):', 'if False:', True),
    ("stop requiring a minor unit scale", 'if isinstance(scale, bool) or not isinstance(scale, int) or not 0 <= scale <= 4:', 'if False:', True),
    ("stop refusing undeclared self measurement", 'r.refuse("conduct_self_measured_undeclared"', 'r.find("conduct_self_measured_undeclared"', True),
    ("stop refusing an incomplete disclaimer", 'if missing:\n                r.refuse("disclaimer_incomplete"', 'if False:\n                r.refuse("disclaimer_incomplete"', True),
    ("stop bounding the size", 'if len(can.encode("utf-8")) > limit:', 'if False:', True),
    ("accept non canonical base64", 'if base64.b64encode(raw).decode("ascii") != s:', 'if False:', True),
    ("stop refusing a positional record_paid_by", 'if not (paid in PAID_BY_WORDS or (isinstance(paid, str) and norm_domain(paid) in doms)):', 'if False:', True),
    ("stop refusing an unnamed recorder", 'if not isinstance(rec, dict):\n            r.refuse("bad_recorder"', 'if False:\n            r.refuse("bad_recorder"', True),
    ("stop refusing a bad agreed_at", 'if not isinstance(at, str) or not re.match(pattern, at):', 'if False:', True),
    ("accept a signature of the wrong length", 'if b64_raw(s.get("signature"), 64) is None:', 'if False:', True),
    # 2026-09-10: hunted outside the list above and found ten mutants the adversary did not notice.
    # Every rule existed in the verifier; what was missing was a vector. They are covered now.
    ("single label domains become legal", 'if len(labels) < 2:', 'if len(labels) < 1:', True),
    ("a label may start with a hyphen", '_LABEL = re.compile(r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?$")', '_LABEL = re.compile(r"^[a-z0-9-]+$")', True),
    ("three parties allowed", 'if not isinstance(parties, list) or len(parties) != 2:', 'if not isinstance(parties, list) or len(parties) < 2:', True),
    ("the string limit raised a thousandfold", 'MAX_STRING = 4096', 'MAX_STRING = 4096000', True),
    ("the depth limit raised a hundredfold", 'MAX_DEPTH = 32', 'MAX_DEPTH = 3200', True),
    ("the array limit raised", 'MAX_ARRAY = 64', 'MAX_ARRAY = 64000', True),
    ("agent_card need not be https", 'if not isinstance(p.get(req), str) or not host_of_https(p.get(req)):', 'if not isinstance(p.get(req), str) or not p.get(req):', True),
    ("the conduct record url need not be https", 'if not host_of_https(cr.get("url")):', 'if False:', True),
    ("disclosure_url need not be https", 'if not host_of_https(terms.get("disclosure_url")):', 'if not isinstance(terms.get("disclosure_url"), str) or not terms.get("disclosure_url"):', True),
    ("upstream may be any shape at all", 'if not isinstance(u, dict) or not isinstance(u.get("protocol"), str) or not isinstance(u.get("reference"), str):', 'if False:', True),
    ("the alg field is ignored", 'if s.get("alg") != "ed25519":', 'if False:', True),
    # Second hunt, same day: twelve more candidates, six survived. Two of those six were broken
    # mutations of the operator's own making ([] or [...] evaluates to [...]), and two more reach
    # the same verdict by another path. Two were real, and the first of them is the one that
    # matters: the dot boundary in under_domain carries four separate rules.
    ("under_domain drops the dot boundary", 'return host == domain or (host or "").endswith("." + domain)', 'return host == domain or (host or "").endswith(domain)', True),
    ("the surrogate range narrowed to the one code point that was tested", 'if 0xD800 <= ord(ch) <= 0xDFFF:', 'if 0xD800 <= ord(ch) <= 0xD801:', True),
    ("the required disclaimer subjects emptied", 'missing = [name for name, needles in REQUIRED_DNE if not any(n in low for n in needles)]', 'missing = [name for name, needles in [] if not any(n in low for n in needles)]', True),

    # Expected to survive: the same refusal is reached by another path, so behaviour is unchanged.
    ("EQUIVALENT: the a == b branch of self_agreement (the subdomain branch below it catches the same case)",
     'if a == b:\n            r.refuse("self_agreement"', 'if False:\n            r.refuse("self_agreement"', False),
    ("EQUIVALENT: the raw is None branch of bad_public_key (public_key_problem refuses None too)",
     'if raw is None:\n                r.refuse("bad_public_key"', 'if False:\n                r.refuse("bad_public_key"', False),
    ("EQUIVALENT: cycle detection in measure (the node budget refuses a self referring record anyway)",
     'if id(node) in seen:', 'if False:', False),
    ("EQUIVALENT: the named outcome linked fee bases (an unlisted basis is refused by the next branch with the same code)",
     'if basis in FEE_BASES_BAD:', 'if basis in ():', False),
    ("EQUIVALENT: the signature length check inside the crypto path (the shape check already refused it)",
     'raw_sig = b64_raw(sig_b64, 64)', 'raw_sig = b64_raw(sig_b64, 64) or b"\\0" * 64', False),
]


def clear_pycache():
    pc = os.path.join(HERE, "__pycache__")
    if os.path.isdir(pc):
        for f in os.listdir(pc):
            try:
                os.remove(os.path.join(pc, f))
            except OSError:
                pass


def main():
    for _s in (signal.SIGTERM, signal.SIGINT):
        try:
            signal.signal(_s, _bye)
        except Exception:
            pass
    recover_if_needed()
    with open(TARGET, encoding="utf-8") as f:
        orig = f.read()
    with open(BACKUP, "w", encoding="utf-8") as f:
        f.write(orig)
    print("target      %s" % os.path.basename(TARGET))
    print("base sha256 %s" % hashlib.sha256(orig.encode("utf-8")).hexdigest())
    print("mutants     %d (%d expected caught, %d equivalent)\n"
          % (len(MUTANTS), sum(1 for m in MUTANTS if m[3]), sum(1 for m in MUTANTS if not m[3])))
    wrong = []
    try:
        for name, old, new, expect in MUTANTS:
            if orig.count(old) != 1:
                print("  %-56s ANCHOR MATCHES %d TIMES" % (name[:56], orig.count(old)))
                wrong.append(name + " (anchor)")
                continue
            with open(TARGET, "w", encoding="utf-8") as f:
                f.write(orig.replace(old, new))
            clear_pycache()
            p = subprocess.run([sys.executable, SUITE], cwd=HERE, capture_output=True, text=True)
            caught = p.returncode != 0
            ng = len([l for l in p.stdout.splitlines() if l.strip().startswith("NG")])
            mark = "ok" if caught == expect else "MISS"
            print("  %-56s %-8s NG=%-2d %s" % (name[:56], "caught" if caught else "survived", ng, mark))
            if caught != expect:
                wrong.append(name)
    finally:
        with open(TARGET, "w", encoding="utf-8") as f:
            f.write(orig)
        clear_pycache()
        back = open(TARGET, encoding="utf-8").read()
        ok_restore = back == orig
        print("\nrestored    %s" % ("byte identical" if ok_restore else "*** RESTORE FAILED, recover this file from git ***"))
        if ok_restore and os.path.exists(BACKUP):
            os.remove(BACKUP)
        elif not ok_restore:
            print("            the untouched copy is still at %s" % BACKUP)
    print()
    if wrong:
        print("=== %d / %d, and these did not behave as expected: %s ===" % (len(MUTANTS) - len(wrong), len(MUTANTS), ", ".join(wrong)))
    else:
        print("=== %d / %d 合格 (mutation) ===" % (len(MUTANTS), len(MUTANTS)))
        print("規則を 1 本ずつ壊して、敵が気付くかを見る。緑やから正しいんやない。壊したら赤くなるから正しい。")
    return 1 if wrong else 0


if __name__ == "__main__":
    sys.exit(main())
