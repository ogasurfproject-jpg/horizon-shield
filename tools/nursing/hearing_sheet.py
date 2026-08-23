# -*- coding: utf-8 -*-
"""
訪問看護のヒアリング一覧を、データベースから作る。

なぜ生成するか:
  手で書いた一覧は、書いた日の姿しか写さない。
  DB に要件を足せば設問は増えるので、一覧は翌週にはもう嘘になる。
  だから毎回作り直す。表に出ている数字も、全部 DB から取る。

  python3 tools/nursing/hearing_sheet.py > /tmp/hearing.html
"""

import html, io, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from sync_questions import merged                      # noqa: E402
from migrate_questions import DB                       # noqa: E402

E = lambda s: html.escape(str(s or ""))

PURPOSE = {
    "requirement": ("算定要件の確認", "req", "データベースにある要件が、実際に満たされているかを確かめる"),
    "field": ("データベースを厚くする", "field", "こちらがまだ持っていないことを、現場に尋ねる。答えは現場報告に入り、規則の出典にはしない"),
    "ops": ("業務の回り方", "ops", "請求と記録が実際どう回っているか"),
    "outbound": ("ケアマネさん向け", "out", "掲載ページの中身になる"),
    "recruit": ("看護師の採用", "rec", "求人ページの中身になる"),
}


def build():
    qs, asks, dup, silent, ver = merged()
    db = json.load(io.open(DB, encoding="utf-8"))
    items = {it["id"]: it for it in db["items"]}
    byid = {q["id"]: q for q in qs}
    rounds = json.load(io.open("/tmp/rounds.json", encoding="utf-8")) \
        if os.path.exists("/tmp/rounds.json") else []

    unconf = sum(1 for it in db["items"] for k in ("requirements", "rules", "watch")
                 for r in it.get(k, []) if r.get("confirmed") is False)
    statute_now = sum(1 for s in db.get("sources", {}).values()
                      if s.get("tier") == "statute" and s.get("current") is not False)
    nfield = sum(1 for q in qs if q.get("purpose") == "field")

    o = []
    a = o.append
    a("<title>訪問看護ヒアリング原簿</title>")
    a('<link rel="preconnect" href="https://fonts.googleapis.com">')
    a('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>')
    a('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
      'family=Zen+Old+Mincho:wght@400;600;700&family=Noto+Sans+JP:wght@400;500;700'
      '&family=IBM+Plex+Mono:wght@400;500&display=swap">')
    a("<style>%s</style>" % CSS)

    a('<div class="wrap">')
    a('<header class="head">')
    a('<p class="eyebrow">HORIZON SHIELD / Yakumo &middot; 訪問看護</p>')
    a("<h1>ヒアリング原簿</h1>")
    a('<p class="lede">この一覧は手で書いていません。算定要件データベース '
      '<span class="mono">%s</span> から毎回作り直しています。'
      'DB に要件を足せば設問が増え、消せば設問も消えます。'
      'ここに出ている数字も、すべて DB から取ったものです。</p>' % E(ver))
    a("</header>")

    # 現在地
    a('<section class="state">')
    for label, val, sub in (
        ("設問", len(qs), "実際に届く全数"),
        ("うち DB を厚くする問い", nfield, "現場に尋ねる"),
        ("DB の項目", len(db["items"]), "減算・加算・指示書"),
        ("出典", len(db.get("sources", {})), "うち現行の条文 %d 件" % statute_now),
        ("未確認の要件", unconf, "確認できていないと書いてある"),
        ("自分で書いた穴", len(db.get("known_gaps", [])), "埋めに行く先"),
    ):
        cls = " warn" if label in ("未確認の要件", "自分で書いた穴") else ""
        a('<div class="cell%s"><span class="num">%s</span>'
          '<span class="lab">%s</span><span class="sub">%s</span></div>'
          % (cls, val, E(label), E(sub)))
    a("</section>")

    if statute_now == 0:
        a('<p class="alarm">現行の告示・省令・通知の原文は、まだ1件も取れていません。'
          'この版の数字は、実務の判断に使う前に原文との突合が要ります。'
          'ヒアリングの設問文に要件の中身を書くのは、DB で確認済みのものだけにしています。</p>')

    # 届く順番
    if rounds:
        a('<section class="block"><h2>届く順番</h2>')
        a('<p class="note">2問ずつ届きます。うち1枠は、必ずデータベースを厚くする問いに空けてあります。'
          '重みだけで並べると集客の設問が前に立ち続け、実地指導も加算も10回まわして1問も届きませんでした。'
          '置いてあることと、届くことは別です。</p>')
        a('<ol class="rounds">')
        for i, r in enumerate(rounds, 1):
            a('<li><span class="rn">%d</span><div class="rq">' % i)
            for qid in r:
                q = byid.get(qid)
                p = (q or {}).get("purpose")
                tag = PURPOSE.get(p, ("共通", "gen", ""))[1] if q else "gen"
                nm = PURPOSE.get(p, ("共通設問", "gen", ""))[0] if q else "共通設問"
                a('<span class="chip %s">%s</span><code>%s</code>' % (tag, E(nm), E(qid)))
            a("</div></li>")
        a("</ol></section>")

    # 全文
    a('<section class="block"><h2>設問の全文</h2>')
    last = None
    for q in qs:
        p = q.get("purpose")
        if p != last:
            nm, tag, desc = PURPOSE.get(p, (p, "gen", ""))
            a('<h3 class="ph %s">%s <span class="phn">%d問</span></h3>'
              % (tag, E(nm), sum(1 for x in qs if x.get("purpose") == p)))
            a('<p class="note">%s</p>' % E(desc))
            last = p
        a('<article class="q %s">' % tag)
        a('<div class="qh"><code>%s</code><span class="w">重み %d</span></div>' % (E(q["id"]), q["w"]))
        a('<p class="qt">%s</p>' % E(q["text"]))
        if p == "requirement":
            refs = asks.get(q["id"], [])
            names = []
            for r in refs:
                iid, rid = r.split("/", 1)
                it = items.get(iid, {})
                names.append("%s <span class='rid'>%s</span>" % (E(it.get("name", iid)), E(rid)))
            a('<p class="meta"><span class="mk">確かめる要件</span>%s</p>' % "、".join(names))
        if p == "field":
            a('<p class="meta"><span class="mk gap">埋めようとしている穴</span>%s</p>' % E(q.get("fills_gap")))
            a('<p class="meta"><span class="mk">得られるもの</span>%s</p>' % E(q.get("gives")))
        a("</article>")
    a("</section>")

    # 線
    a('<section class="block line"><h2>越えない線</h2>')
    a("<dl>")
    for t, d in (
        ("現場の答えは、規則の根拠にしない",
         "事業所がそう回しているという事実は、そう定められているという根拠ではありません。"
         "運用が慣行として間違っていることもあり、地域差もあります。答えは現場報告として残し、"
         "出典としては使いません。データベースの検査が、これを機械的に見ています。"),
        ("同意を得るまで、公開しない",
         "公開データベースは CC BY 4.0 です。実地指導の指摘、返戻の理由、迷った請求。"
         "データベースを厚くしたいのはこちらの都合であって、それを理由にお客様の内部事情を"
         "公開してよいことにはなりません。同意と、名前を出すか匿名にするかが決まるまで、"
         "1件も出ません。"),
        ("どの質問への答えか分からないものは、載せない",
         "2問まとめて送って1通返ってきたとき、番号があれば切り分けます。"
         "無ければ、切り分けられなかったと記録します。推測で割り当てません。"
         "人が確かめるまで、その報告は止まります。"),
        ("こちらが断定しない",
         "設問文に要件の中身を書くのは、DB で確認済みのものだけです。"
         "お客様に自社の遵守状況を断定して伝えるのは、いちばんやってはいけないことです。"),
    ):
        a("<dt>%s</dt><dd>%s</dd>" % (E(t), E(d)))
    a("</dl></section>")

    a('<footer class="foot"><p>算定要件データベース %s &middot; 設問 %d 問 &middot; '
      '生成物のため手で編集しません</p></footer>' % (E(ver), len(qs)))
    a("</div>")
    return "\n".join(o)


CSS = """
:root{
  --ink:#141b24; --ink-2:#3d4a5a; --ink-3:#6b7787;
  --paper:#f6f7f9; --card:#ffffff; --rule:#dde2e9;
  --navy:#2b4b70; --navy-soft:#eaf0f7;
  --seal:#96382f; --seal-soft:#f8ecea;
  --moss:#3a6459; --moss-soft:#e9f1ee;
  --amber:#8a6521; --amber-soft:#f7f0e0;
}
@media (prefers-color-scheme: dark){ :root:not([data-theme="light"]){
  --ink:#e6eaf0; --ink-2:#b0bac8; --ink-3:#7d8899;
  --paper:#10151c; --card:#161d26; --rule:#2a3543;
  --navy:#8fb4dc; --navy-soft:#1a2634;
  --seal:#dd8f85; --seal-soft:#2c1d1b;
  --moss:#86bbaa; --moss-soft:#152622;
  --amber:#d5ac66; --amber-soft:#2a2317;
}}
:root[data-theme="dark"]{
  --ink:#e6eaf0; --ink-2:#b0bac8; --ink-3:#7d8899;
  --paper:#10151c; --card:#161d26; --rule:#2a3543;
  --navy:#8fb4dc; --navy-soft:#1a2634;
  --seal:#dd8f85; --seal-soft:#2c1d1b;
  --moss:#86bbaa; --moss-soft:#152622;
  --amber:#d5ac66; --amber-soft:#2a2317;
}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);
  font-family:"Noto Sans JP",system-ui,sans-serif;line-height:1.85;
  font-feature-settings:"palt" 1;}
.wrap{max-width:860px;margin:0 auto;padding:56px 24px 96px}
.mono,code{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:.86em;
  letter-spacing:.01em}

.head{border-bottom:2px solid var(--ink);padding-bottom:28px;margin-bottom:36px}
.eyebrow{margin:0 0 10px;font-size:12px;letter-spacing:.18em;color:var(--ink-3);
  text-transform:uppercase;font-weight:500}
h1{font-family:"Zen Old Mincho",serif;font-weight:700;font-size:clamp(34px,6vw,52px);
  margin:0 0 16px;letter-spacing:.04em;text-wrap:balance;line-height:1.25}
.lede{margin:0;color:var(--ink-2);font-size:15px;max-width:62ch}

.state{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));
  gap:1px;background:var(--rule);border:1px solid var(--rule);margin-bottom:28px}
.cell{background:var(--card);padding:16px 18px;display:flex;flex-direction:column;gap:2px}
.cell .num{font-family:"Zen Old Mincho",serif;font-size:30px;font-weight:600;
  line-height:1.1;font-variant-numeric:tabular-nums;color:var(--navy)}
.cell.warn .num{color:var(--seal)}
.cell .lab{font-size:13px;font-weight:500}
.cell .sub{font-size:11.5px;color:var(--ink-3);line-height:1.5}

.alarm{background:var(--seal-soft);border-left:3px solid var(--seal);
  padding:14px 18px;margin:0 0 40px;font-size:14px;color:var(--ink-2)}

.block{margin:52px 0 0}
h2{font-family:"Zen Old Mincho",serif;font-size:24px;font-weight:600;
  letter-spacing:.05em;margin:0 0 8px;padding-bottom:10px;
  border-bottom:1px solid var(--rule)}
.note{margin:0 0 22px;font-size:13.5px;color:var(--ink-3);max-width:64ch}

.rounds{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:1px;
  background:var(--rule);border:1px solid var(--rule)}
.rounds li{background:var(--card);display:flex;gap:16px;align-items:center;
  padding:11px 16px;flex-wrap:wrap}
.rn{font-family:"IBM Plex Mono",monospace;font-size:12px;color:var(--ink-3);
  min-width:22px;font-variant-numeric:tabular-nums}
.rq{display:flex;gap:8px;align-items:center;flex-wrap:wrap;flex:1}
.rq code{color:var(--ink-2)}
.chip{font-size:11px;padding:2px 9px;border-radius:2px;font-weight:500;white-space:nowrap}
.chip.field{background:var(--moss-soft);color:var(--moss)}
.chip.req{background:var(--navy-soft);color:var(--navy)}
.chip.ops,.chip.gen{background:var(--rule);color:var(--ink-3)}
.chip.out,.chip.rec{background:var(--amber-soft);color:var(--amber)}

.ph{font-family:"Zen Old Mincho",serif;font-size:18px;font-weight:600;
  margin:38px 0 6px;letter-spacing:.05em;display:flex;align-items:baseline;gap:12px}
.ph.field{color:var(--moss)} .ph.req{color:var(--navy)}
.ph.out,.ph.rec{color:var(--amber)} .ph.ops{color:var(--ink-2)}
.phn{font-family:"IBM Plex Mono",monospace;font-size:11px;color:var(--ink-3);
  font-weight:400;letter-spacing:0}

.q{background:var(--card);border:1px solid var(--rule);border-left:3px solid var(--rule);
  padding:14px 18px;margin:0 0 8px}
.q.field{border-left-color:var(--moss)}
.q.req{border-left-color:var(--navy)}
.q.out,.q.rec{border-left-color:var(--amber)}
.qh{display:flex;justify-content:space-between;align-items:baseline;gap:12px;
  margin-bottom:7px;flex-wrap:wrap}
.qh code{color:var(--ink-3)}
.w{font-family:"IBM Plex Mono",monospace;font-size:11px;color:var(--ink-3);
  font-variant-numeric:tabular-nums}
.qt{margin:0;font-size:14.5px;color:var(--ink)}
.meta{margin:9px 0 0;font-size:12.5px;color:var(--ink-3);line-height:1.7}
.mk{display:inline-block;font-size:10.5px;letter-spacing:.08em;padding:1px 7px;
  margin-right:8px;background:var(--rule);color:var(--ink-2);border-radius:2px}
.mk.gap{background:var(--seal-soft);color:var(--seal)}
.rid{font-family:"IBM Plex Mono",monospace;font-size:10.5px;color:var(--ink-3)}

.line dl{margin:0;display:flex;flex-direction:column;gap:20px}
.line dt{font-family:"Zen Old Mincho",serif;font-size:16px;font-weight:600;
  color:var(--seal);letter-spacing:.03em;margin-bottom:5px}
.line dd{margin:0;font-size:13.5px;color:var(--ink-2);max-width:64ch;
  padding-left:14px;border-left:2px solid var(--rule)}

.foot{margin-top:64px;padding-top:20px;border-top:1px solid var(--rule);
  font-size:11.5px;color:var(--ink-3)}
.foot p{margin:0}
@media (max-width:560px){ .wrap{padding:36px 16px 64px} }
"""

if __name__ == "__main__":
    sys.stdout.write(build())
