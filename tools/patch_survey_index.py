# -*- coding: utf-8 -*-
"""verify-directory/survey/index.html に、走行1の計器故障の節を挿入する。"""
import io, os, shutil, sys

P = "verify-directory/survey/index.html"
ANCHOR = '<section>\n  <div class="wrap">\n    <div class="kh">What the first report will contain</div>'

BLOCK = '''<section>
  <div class="wrap">
    <div class="kh">Report 1, and the walk that was thrown away</div>
    <h2>The first full walk broke the first rule. It was caught before publication, not after.</h2>
    <p class="slead">On 2026-08-23 the walk ran against all 12,429 endpoints and finished with a number. The number was <b>11,794 held</b>. It is not published, because it was not a measurement of anybody&rsquo;s server.</p>

    <div class="confess" style="margin-top:22px">
      <div class="big">Eighteen minutes in, our own name resolution stopped working. The walker did not notice.</div>
      <p>From 06:35Z onward, <b>11,307 consecutive endpoints were recorded as not reached</b>, and not one of them succeeded over the following hour and forty minutes. Before that moment the same walk had reached 1,001 endpoints out of 1,122. Nothing about the population changed at 06:35. Our machine did.</p>
      <p>The row that settles it belongs to a host called <span class="mono">api.m2mcent.com</span>. It <b>answered 113 HTTP requests</b> during the healthy period. Every one of its remaining 163 endpoints was then recorded as not reached. <b>A host that answers 113 requests does not disappear.</b></p>
      <p>The first of the five rules above says <b>held</b> means we could not measure it, and that an instrument failure is not a statement about the thing it failed to measure. This walk broke that rule against 11,307 servers, and it broke it silently.</p>
    </div>

    <pre style="margin-top:22px"><span class="c">survey1_walk &middot; run 1 &middot; 2026-08-23 &middot; discarded</span>
  rows written                      12429
  reached, before 06:35Z             1001
  reached, after  06:35Z                <b>0</b>
  longest run of not reached        <b>11307</b>

  not reached, total                11428
    "not reached: URLError"         <b>11422</b>
    "not reached: timeout"              5
    "not reached: InvalidURL"           1</pre>

    <p class="slead" style="margin-top:18px"><b>The defect underneath the defect is the last three lines.</b> The walker recorded only the name of the exception class, so 11,422 rows carried an identical reason string. From the file alone, a server that no longer exists and a resolver that had stopped answering were the same row. <b>We could not have told the difference after the fact, and neither could you.</b></p>

    <div class="kv" style="margin-top:22px">
      <div class="r"><div class="k">reason</div><div class="v">Now carries the errno and the underlying cause, not just the exception name.</div></div>
      <div class="r"><div class="k">control</div><div class="v">After 25 consecutive unreachable results the walker stops accusing the population and <b>probes a known good address instead</b>. Two of them, one ours and one not ours. If the control answers, the streak is a property of the population and the walk continues.</div></div>
      <div class="r"><div class="k">discard</div><div class="v">Results taken while the control was also unreachable are <b>thrown away and measured again</b> after recovery, rather than written down.</div></div>
      <div class="r"><div class="k">abort</div><div class="v">If the control does not come back within 900 seconds the run <b>stops</b>. A missing row is better than an invented one.</div></div>
      <div class="r"><div class="k">retry</div><div class="v">One retry, after a pause, before any unreachable result is written at all. A resolver stumbling for a second should not become a permanent claim about somebody&rsquo;s server.</div></div>
      <div class="r"><div class="k">aggregate</div><div class="v">The aggregator now <b>refuses to count a file with this shape</b> and exits with an error. Pointed at run 1, it refuses, on two independent checks.</div></div>
    </div>

    <p class="slead" style="margin-top:22px"><b>Run 1 is not partially salvaged.</b> Its first 1,122 rows were taken while the instrument was healthy and would probably survive scrutiny. But choosing where to cut is a judgement, and a survey that decides which of its own rows to keep has stopped being a survey. <b>The whole run is discarded and all 12,429 endpoints are being measured again.</b></p>
    <p class="slead" style="margin-top:14px">Both files stay published. The discarded rows are the evidence that the rule was broken, and deleting them would make this paragraph unverifiable.</p>

    <div class="linkset">
      <a href="/verify-directory/survey/data/survey1_walk_2026-08-23_run1_discarded.jsonl">Run 1, discarded, 12,429 rows (6.4 MB)</a>
      <a href="/verify-directory/survey/data/survey1_walk_2026-08-23_run1_instrument_failure.json">What went wrong, machine readable</a>
      <a href="https://github.com/ogasurfproject-jpg/horizon-shield/blob/main/tools/survey1_walk.py">The walker</a>
      <a href="https://github.com/ogasurfproject-jpg/horizon-shield/blob/main/tools/survey1_aggregate.py">The aggregator that refused it</a>
    </div>

    <div class="honest">
      <div class="t">Stated plainly</div>
      <p><b>Nothing external caught this.</b> No operator complained, because nothing had been published yet. It was caught because the counters in the log had frozen in a shape that did not match the pilot runs, and that was worth an hour of checking before it was worth a page. <b>If this survey is ever going to name somebody else&rsquo;s server, this is the standard it has to hold itself to first.</b></p>
    </div>

    <div class="stamp" style="font-family:var(--mono);font-size:11.5px;color:var(--slate);margin-top:18px">written 2026-08-23, while run 2 was still walking &middot; report 1 does not exist yet</div>
  </div>
</section>

'''


def main():
    if not os.path.exists(P):
        print("not found: " + P, file=sys.stderr); sys.exit(1)
    src = io.open(P, encoding="utf-8").read()
    if "the walk that was thrown away" in src:
        print("already patched"); return
    if ANCHOR not in src:
        print("anchor not found", file=sys.stderr); sys.exit(1)
    if "—" in BLOCK or "–" in BLOCK:
        print("forbidden dash in new text", file=sys.stderr); sys.exit(1)
    shutil.copy2(P, P + ".bak_prerun1note20260823")
    out = src.replace(ANCHOR, BLOCK + ANCHOR, 1)
    io.open(P, "w", encoding="utf-8").write(out)
    print("patched %s (+%d bytes), backup .bak_prerun1note20260823" % (P, len(out) - len(src)))


if __name__ == "__main__":
    main()
