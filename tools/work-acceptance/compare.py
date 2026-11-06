"""Compare frozen verdicts with the expected objects. Written before the expected values were opened.
Rules (declared before opening):
- refused vectors: compare refused and reason exactly.
- problem_codes, warning_codes: as sets.
- signature_valid, independence, receipt_timestamp, verdict_stated, verdict_recomputed: exact.
- criteria_hash, criteria_committed_before_check: exact if the expected vocabulary is ours; otherwise a value
  mapping ours->expected is built over all vectors and the field counts as agreeing only if that mapping is
  one-to-one (reported in the output).
- tsa_signature: an absent expected field reads as not_evaluated for each token present in our output.
"""
import json, sys, collections
ours = json.load(open(sys.argv[1])); src = sys.argv[2]; outp = sys.argv[3]
import os
exp = {}
for fn in ours:
    exp[fn] = json.load(open(os.path.join(src, fn)))['expected']
maps = {f: collections.defaultdict(set) for f in ('criteria_hash', 'criteria_committed_before_check')}
for fn, o in ours.items():
    e = exp[fn]
    if not o.get('refused') and not e.get('refused'):
        for f in maps:
            maps[f][o.get(f)].add(json.dumps(e.get(f)))
one_to_one = {}
for f, m in maps.items():
    inv = collections.defaultdict(set)
    for k, vs in m.items():
        for v in vs: inv[v].add(k)
    one_to_one[f] = all(len(vs) == 1 for vs in m.values()) and all(len(ks) == 1 for ks in inv.values())
rows = {}; agree = 0
for fn, o in ours.items():
    e = exp[fn]; diffs = []
    if o.get('refused') or e.get('refused'):
        if bool(o.get('refused')) != bool(e.get('refused')) or o.get('reason') != e.get('reason'):
            diffs.append(('refused/reason', o.get('refused'), o.get('reason'), e.get('refused'), e.get('reason')))
    else:
        for f in ('problem_codes', 'warning_codes'):
            if set(o[f]) != set(e[f]):
                diffs.append((f, sorted(set(o[f]) - set(e[f])), sorted(set(e[f]) - set(o[f]))))
        for f in ('signature_valid', 'independence', 'receipt_timestamp', 'verdict_stated', 'verdict_recomputed'):
            if o.get(f) != e.get(f):
                diffs.append((f, o.get(f), e.get(f)))
        for f in maps:
            if o.get(f) != e.get(f) and not one_to_one[f]:
                diffs.append((f, o.get(f), e.get(f)))
        ot = o.get('tsa_signature', {}); et = e.get('tsa_signature')
        if et is None:
            et = {k: 'not_evaluated' for k in ot}
        if ot != et:
            diffs.append(('tsa_signature', ot, et))
    rows[fn] = diffs
    agree += not diffs
res = {'vectors': len(ours), 'agree': agree, 'value_maps': {f: {str(k): sorted(v) for k, v in m.items()} for f, m in maps.items()},
       'one_to_one': one_to_one, 'diffs': {k: v for k, v in rows.items() if v}}
json.dump(res, open(outp, 'w'), indent=1, sort_keys=True, default=str)
print('agree', agree, 'of', len(ours)); print('one_to_one', one_to_one)
for k, v in res['diffs'].items(): print(k, v)
