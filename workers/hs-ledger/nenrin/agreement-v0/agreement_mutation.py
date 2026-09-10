#!/usr/bin/env python3
"""Mutation test for agreement_redteam.py. It breaks agreement_verify.py one rule at a time and
checks that the adversary notices. Run: python3 agreement_mutation.py   (about ten minutes)

A suite of 178 vectors that all pass proves nothing on its own: a suite can be green because
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

Where it does the breaking took three tries to get right, and the story is worth keeping because
each version failed in a way the previous one could not see.

First version: mutate agreement_verify.py in place, restore in a finally block. The claim was
"restored on every exit path, including a crash and a Ctrl-C". True for exceptions and for SIGINT,
false for SIGTERM: python ends the process without running finally. On 2026-09-10 a two minute
command timeout sent exactly that signal mid run and left a mutant in agreement_verify.py.

Second version: keep mutating in place, but write a backup beside the file first and remove it
only after a byte for byte restore. A run that dies leaves the backup, and the next run restores
from it. That held for the case it was built for, and then broke on the case it was not: later the
same day the backup could not be deleted (the folder allowed reading and writing but not unlink),
so it survived a successful run, and the NEXT run treated it as evidence of a crash and restored
a stale copy over a legitimate edit, silently deleting it. A recovery mechanism that fires when
nothing is wrong is worse than none, because it destroys work while reporting health.

Third version, this one: **do not touch the file at all.** Copy the verifier, the signer and the
adversary into a temporary directory and mutate the copy. Then SIGTERM, SIGKILL, a full disk and a
folder that forbids unlink are all the same event: the working tree was never modified, so there
is nothing to restore and nothing to leave behind. The check at the end is not "did the restore
work" but "is the real file byte for byte what it was before this program started", which is a
question that can be answered without trusting anything this program did.

If a backup from the second version is still lying around, this program says so and stops. It does
NOT restore from it. Deciding what a leftover file means is a person's job; the failure above is
what happens when a program decides that for itself.
"""
# RUN_ALL: suite    長い (百秒ほど)。agreement_verify.py を書き換えて、また戻す

import hashlib
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TARGET = os.path.join(HERE, "agreement_verify.py")
SUITE = os.path.join(HERE, "agreement_redteam.py")
SIGNER = os.path.join(HERE, "agreement_sign.py")
OLD_BACKUP = os.path.join(HERE, ".agreement_verify.py.mutation_backup")


def refuse_if_old_backup():
    """A file left by the in place version of this tool. Say so; decide nothing."""
    if not os.path.exists(OLD_BACKUP):
        return
    print("★ 拒否: %s がまだ置いてある。" % os.path.basename(OLD_BACKUP))
    print("        今の版はこの file を作らん。有るということは、昔の版の run が死んだか、")
    print("        消せんまま残ったかのどちらかや。中身と agreement_verify.py を見比べて、")
    print("        どっちが本物か決めるのは人の仕事。ここでは戻さん。")
    print("        (2026-09-10: ここで勝手に戻す作りやったせいで、正しい編集が黙って消えた)")
    sys.exit(2)

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

    # Third hunt, same day, after the second: eighteen more candidates and nine survived.
    # The heaviest was canonical() itself. Break the key sort, escape non ASCII, or loosen the
    # separators and all 166 vectors stayed green, in a system whose entire claim is that two
    # implementations reach the same bytes. The form is pinned as bytes now, not as prose.
    ('strict is never on, so v1.1 is read with v1 rules', 'strict = schema == SCHEMA_V11', 'strict = False', True),
    ('key_urls_checked always true', 'urls_checked = bool(url_results) and len(url_results) == 2 and all(url_results)', 'urls_checked = True', True),
    ('two signatures becomes two or more', 'checked = len(per_sig) == 2 and all(e["result"] == "valid" for e in per_sig)', 'checked = len(per_sig) >= 2 and all(e["result"] == "valid" for e in per_sig)', True),
    ('canonical stops sorting keys', 'return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))', 'return json.dumps(obj, ensure_ascii=False, sort_keys=False, separators=(",", ":"))', True),
    ('canonical escapes non ASCII', 'return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))', 'return json.dumps(obj, ensure_ascii=True, sort_keys=True, separators=(",", ":"))', True),
    ('canonical uses the default separators', 'separators=(",", ":"))', 'separators=(", ", ": "))', True),
    ('the signatures stay inside the signed bytes', 'body = {k: v for k, v in record.items() if k != "signatures"}', 'body = {k: v for k, v in record.items()}', True),
    ('the v1.1 size limit raised to the v1 one', 'MAX_BYTES = {SCHEMA_V1: 65536, SCHEMA_V11: 16384}', 'MAX_BYTES = {SCHEMA_V1: 65536, SCHEMA_V11: 65536}', True),
    ('roles gains a fourth value', 'ROLES = ("payer", "payee", "peer")', 'ROLES = ("payer", "payee", "peer", "either")', True),
    ('record_paid_by gains a positional word under v1.1', 'PAID_BY_WORDS = ("both", "neither", "third_party")', 'PAID_BY_WORDS = ("both", "neither", "third_party", "party_a")', True),
    ('the report stops saying that no key URL was fetched', 'if not urls_checked:', 'if False:', True),
    ('floats stop being scanned at all', 'elif isinstance(node, float):', 'elif False:', True),
    ('the overclaim guard loses the contract pattern', '(r"\\bcontract\\b", "formation of a contract"),\n', '', True),
    ('the non canonical point encoding bound is dropped', 'if y >= _P25519:', 'if False:', True),
    ('EQUIVALENT: the separator checks in norm_domain (the label pattern rejects every one of them anyway)', 'if not s or "/" in s or "@" in s or ":" in s or " " in s:', 'if not s:', False),
    ('EQUIVALENT: the on curve check after _xrecover (x is constructed to satisfy the curve equation)', 'if (-x * x + y * y - 1 - _D25519 * x * x * y * y) % _P25519 != 0:', 'if False:', False),
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


def clear_pycache(pc=None):
    """作業場の __pycache__ を落とす。写した verifier を差し替えても、古い .pyc が
    残っとったら python はそっちを読む。mtime が同じ秒に収まると実際に起きる。"""
    if pc is None:
        pc = os.path.join(HERE, "__pycache__")
    if os.path.isdir(pc):
        for f in os.listdir(pc):
            try:
                os.remove(os.path.join(pc, f))
            except OSError:
                pass


def build_workspace():
    """敵が読む物が全部揃った作業場を作る。返すのは (作業場, agreement-v0 の場所)。

    敵は自分の隣の README.md も、4 つ上の ops/ の草案も、2 つ上の seed も読む。
    せやから平たい tmp folder では足りん。repo と同じ深さの骨組みを立てて、
    agreement_verify.py だけを本物の写しにし、他は元を指す link にする。link やから
    書き換わる心配は無いし、写し忘れも起きん。

    ここに何を並べるかは手で書いてある。手で書いた一覧はいつかずれる。ずれたら
    どうなるかというと、変異を入れる前の敵が赤くなって、この program は測るのを
    やめる。せやから、この一覧が古いまま緑が出ることはない。"""
    work = tempfile.mkdtemp(prefix="agreement-mutation-")
    repo = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
    here2 = os.path.join(work, "workers", "hs-ledger", "nenrin", "agreement-v0")
    os.makedirs(here2)

    def link(src, dst):
        if os.path.exists(src) and not os.path.exists(dst):
            os.symlink(src, dst)

    link(os.path.join(repo, "ops"), os.path.join(work, "ops"))
    link(os.path.join(repo, "workers", "hs-ledger", "seed_entry_agreement_v0.json"),
         os.path.join(work, "workers", "hs-ledger", "seed_entry_agreement_v0.json"))

    skip = {os.path.basename(TARGET), "__pycache__"}
    for name in os.listdir(HERE):
        if name in skip or name.startswith(".agreement_verify.py.mutation_backup"):
            continue
        link(os.path.join(HERE, name), os.path.join(here2, name))
    return work, here2


def main():
    refuse_if_old_backup()
    with open(TARGET, encoding="utf-8") as f:
        orig = f.read()
    before = hashlib.sha256(orig.encode("utf-8")).hexdigest()

    work, here2 = build_workspace()
    copy_target = os.path.join(here2, os.path.basename(TARGET))
    copy_suite = os.path.join(here2, os.path.basename(SUITE))

    print("target      %s" % os.path.basename(TARGET))
    print("base sha256 %s" % before)
    print("作業場      %s  (元の file には触らん)" % work)
    print("mutants     %d (%d expected caught, %d equivalent)\n"
          % (len(MUTANTS), sum(1 for m in MUTANTS if m[3]), sum(1 for m in MUTANTS if not m[3])))

    def run_suite():
        env = dict(os.environ, AGREEMENT_MUTATION_RUN="1")
        clear_pycache(os.path.join(here2, "__pycache__"))
        p = subprocess.run([sys.executable, copy_suite], cwd=here2,
                           capture_output=True, text=True, env=env)
        ng = len([l for l in p.stdout.splitlines() if l.strip().startswith("NG")])
        return p.returncode != 0, ng, p

    # 変異を入れる前に、写した敵が緑で走ることを見る。ここが赤かったら、
    # この先の "caught" は全部、変異のせいやのうて写し損ないのせいかもしれん。
    with open(copy_target, "w", encoding="utf-8") as f:
        f.write(orig)
    base_caught, _base_ng, base_p = run_suite()
    if base_caught:
        print("★ 拒否: 変異を入れる前から敵が赤い。ここから先は何も測れん。")
        print(base_p.stdout[-1500:])
        print(base_p.stderr[-800:])
        return 2
    print("  %-56s %-8s %s" % ("(変異なし)", "green", "ここが緑やから、以下の caught に意味がある"))

    wrong = []
    for name, old, new, expect in MUTANTS:
        if orig.count(old) != 1:
            print("  %-56s ANCHOR MATCHES %d TIMES" % (name[:56], orig.count(old)))
            wrong.append(name + " (anchor)")
            continue
        with open(copy_target, "w", encoding="utf-8") as f:
            f.write(orig.replace(old, new))
        caught, ng, _p = run_suite()
        mark = "ok" if caught == expect else "MISS"
        print("  %-56s %-8s NG=%-2d %s" % (name[:56], "caught" if caught else "survived", ng, mark))
        if caught != expect:
            wrong.append(name)

    # 「戻せたか」やのうて「そもそも変わっとらんか」を聞く。この問いは、この
    # program が何をしたかを信用せんでも答えられる。
    with open(TARGET, encoding="utf-8") as f:
        after = hashlib.sha256(f.read().encode("utf-8")).hexdigest()
    print()
    if after == before:
        print("元の file   1 バイトも触っとらん (%s)" % before[:16])
    else:
        print("*** 元の file が変わっとる。%s -> %s。git で見比べること ***" % (before[:16], after[:16]))
        wrong.append("元の file が変わった")
    shutil.rmtree(work, ignore_errors=True)

    print()
    if wrong:
        print("=== %d / %d, and these did not behave as expected: %s ===" % (len(MUTANTS) - len(wrong), len(MUTANTS), ", ".join(wrong)))
    else:
        print("=== %d / %d 合格 (mutation) ===" % (len(MUTANTS), len(MUTANTS)))
        print("規則を 1 本ずつ壊して、敵が気付くかを見る。緑やから正しいんやない。壊したら赤くなるから正しい。")
    return 1 if wrong else 0


if __name__ == "__main__":
    sys.exit(main())
