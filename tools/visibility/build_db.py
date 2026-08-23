# -*- coding: utf-8 -*-
"""
AI可視性の要件データベースを作る。

なぜ要るか (2026-08-23):
  黄金比 GEO40/AEO30/LLMO20/WebMCP10 でページを生成している。
  だが「なぜその配分か」「その施策に本当に効果があるのか」を支える物差しが無かった。
  建設には JCCDB、訪問看護には JHNRD がある。可視性には何も無い。
  物差しの無い施策は、施策ではなく感想である。

このデータベースが、他のSEO資料と違うところ:
  効果が確かめられていないものを、確かめられていないと書く。

  検索やAIの中身は公開されていない。「この施策でAIに推薦される」と言える人は、
  社外には一人もいない。仕様に書いてあること(構造化データの必須項目、MCPの仕様)と、
  それがAIの推薦に効くかどうかは、まったく別の話である。
  前者は spec_confirmed、後者は effect_confirmed として別々に持つ。

  この区別を持たない資料は、仕様の話を効果の話にすり替える。
  弊社が加盟店に売っているのは、その区別そのものである。

  python3 tools/visibility/build_db.py --apply
"""

import io, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, "..", "..", "data", "visibility", "requirements.json"))

SOURCES = {
    "google-localbusiness": {
        "title": "Local Business (LocalBusiness) structured data",
        "publisher": "Google Search Central",
        "url": "https://developers.google.com/search/docs/appearance/structured-data/local-business",
        "tier": "spec", "retrieved_at": "2026-08-23", "current": True,
        "note": "検索側の提供者自身が出している文書。必須項目と推奨項目、および保証しない旨が書かれている。",
    },
    "google-faq-deprecated": {
        "title": "FAQ rich results の廃止(FAQ構造化データ文書の廃止告知)",
        "publisher": "Google Search Central (告知), Search Engine Journal (報道)",
        "url": "https://www.searchenginejournal.com/google-drops-faq-rich-results-from-search/574429/",
        "tier": "secondary", "retrieved_at": "2026-08-23", "current": True,
        "note": ("Google の文書に付いた廃止告知の引用を含む報道。"
                 "原文の告知そのものにはまだ当たれていない。引用文は "
                 "「FAQ rich results are no longer appearing in Google Search…」。"),
    },
    "llmstxt-proposal": {
        "title": "/llms.txt — a proposal to provide information to help LLMs use websites",
        "publisher": "Jeremy Howard / Answer.AI",
        "url": "https://www.answer.ai/posts/2024-09-03-llmstxt.html",
        "tier": "spec", "retrieved_at": "2026-08-23", "current": True,
        "note": ("提案そのもの。2024年9月。"
                 "提案者自身の文書であり、AI提供各社が採用した公式標準ではない。"),
    },
    "mcp-spec-2026-07-28": {
        "title": "The 2026-07-28 Specification",
        "publisher": "Model Context Protocol (Lead Maintainers: David Soria Parra, Den Delimarsky)",
        "url": "https://blog.modelcontextprotocol.io/posts/2026-07-28/",
        "tier": "spec", "retrieved_at": "2026-08-23", "current": True,
        "note": "現行の仕様改訂。ステートレス化、initialize/initialized の廃止、セッションIDの廃止を含む。",
    },
}

ITEMS = [
    {
        "id": "geo-localbusiness",
        "axis": "GEO",
        "name": "所在と業態を、機械が読める形で名乗る",
        "spec": {
            "text": ("LocalBusiness 構造化データの必須項目は address と name の2つ。"
                     "推奨項目に telephone, url, geo, openingHoursSpecification, "
                     "priceRange, aggregateRating, review などがある。"),
            "confirmed": True, "source_ref": ["google-localbusiness"],
        },
        "effect": {
            "text": "この記述があると、AIが事業所を推薦しやすくなる。",
            "confirmed": False,
            "unconfirmed_reason": (
                "提供者自身が「Google does not guarantee that features that consume "
                "structured data will show up in search results」と明記している。"
                "検索結果への表示すら保証されていない。まして生成AIの推薦に効くかどうかは、"
                "提供者も述べていないし、外から測る方法も無い。"
                "『書いてある通りに書く』ことは正しいが、『書けば推薦される』は根拠が無い。"),
        },
        "ask": "q_ai_place",
    },
    {
        "id": "aeo-faq",
        "axis": "AEO",
        "name": "よくある問いに、答えの形で答えておく",
        "spec": {
            "text": ("FAQPage は schema.org の型として有効で、ページに書いてあっても害は無い。"
                     "ただし Google の FAQ リッチリザルトは 2026年5月7日に表示されなくなり、"
                     "6月に検索での見え方・レポート・テスト対応が外された。"),
            "confirmed": True, "source_ref": ["google-faq-deprecated"],
        },
        "effect": {
            "text": "FAQ構造化データを入れれば、検索で目立つ。",
            "confirmed": False,
            "unconfirmed_reason": (
                "2026年5月7日以降、これは成り立たない。リッチリザルトは出ない。"
                "『構造化データを入れれば目立つ』と説明している資料は、この日以前のものである。"
                "問いと答えの形で書くこと自体は、読む側(人にもAIにも)にとって"
                "意味があると考えているが、その効果は測れていない。"
                "リッチリザルトが出るという言い方は、もうできない。"),
        },
        "watch": [{"id": "faq-claim", "text": "自社および加盟店の資料に「FAQ構造化データでリッチリザルトが出る」と書いていないか",
                   "confirmed": True, "source_ref": ["google-faq-deprecated"]}],
        "ask": "q_ai_questions",
    },
    {
        "id": "llmo-llmstxt",
        "axis": "LLMO",
        "name": "AIに向けて、要点と地図を置く",
        "spec": {
            "text": ("/llms.txt は、H1 の見出し(必須)、任意の要約引用、"
                     "H2 で区切ったリンク集からなる markdown ファイルを、サイト直下に置く提案。"
                     "各ページの markdown 版を .md 付きの URL で出すことも合わせて提案されている。"),
            "confirmed": True, "source_ref": ["llmstxt-proposal"],
        },
        "effect": {
            "text": "llms.txt を置けば、AIがサイトを正しく読む。",
            "confirmed": False,
            "unconfirmed_reason": (
                "これは2024年9月の提案であって、AI提供各社が採用した標準ではない。"
                "どのモデルがこのファイルを読んでいるか、読んで何が変わるかは公表されていない。"
                "置くこと自体の費用は小さいが、『置いたから読まれる』とは言えない。"),
        },
        "ask": "q_ai_summary",
    },
    {
        "id": "webmcp-server",
        "axis": "WebMCP",
        "name": "AIが直接呼べる口を開ける",
        "spec": {
            "text": ("MCP のサーバは tools / resources / prompts を公開できる。"
                     "現行の仕様改訂は 2026-07-28。この改訂で、"
                     "initialize / initialized のやり取りとセッションIDが廃止され、"
                     "1リクエストが単体で完結する形になった。"
                     "メソッド名とツール名は HTTP ヘッダで運ばれる。"),
            "confirmed": True, "source_ref": ["mcp-spec-2026-07-28"],
        },
        "effect": {
            "text": "MCPサーバを出せば、AIに使われる。",
            "confirmed": False,
            "unconfirmed_reason": (
                "口が開いていることと、使われることは別である。"
                "どのクライアントがどう探しに来るかは、まだ定まっていない。"),
        },
        "watch": [
            {"id": "our-own-revision",
             "text": ("弊社の各MCPサーバと調査用の走行が、どの改訂に沿っているか。"
                      "Mcp-Session-Id と notifications/initialized を使っていれば 2025-06-18 の形であり、"
                      "現行の 2026-07-28 では廃止されている。"),
             "confirmed": True, "source_ref": ["mcp-spec-2026-07-28"]},
        ],
        "ask": "q_ai_tools",
    },
]

KNOWN_GAPS = [
    {"gap": "生成AIが事業者を推薦する仕組みは、どの提供者も公表していない。",
     "consequence": ("この分野の施策は、効果を測れないまま行う。"
                     "だから effect は原則 confirmed:false で持ち、"
                     "『効きます』とは言わない。言えば、それは我々の感想である。"),
     "next": "測れることだけを測る。実際にAIから参照された記録が取れたら、それを field_reports に残す。"},
    {"gap": "FAQ廃止について、Google の原文の告知にまだ当たれていない(報道での引用まで)。",
     "consequence": "日付と文言は引用の孫引きである。tier は secondary のままにしてある。",
     "next": "Google Search Central の FAQ 構造化データ文書そのものを取得する。"},
    {"gap": "黄金比 GEO40/AEO30/LLMO20/WebMCP10 の配分に、外部の根拠は無い。",
     "consequence": "この配分は方針であって、測定結果ではない。そう書いておかないと、根拠のある数字に見える。",
     "next": "加盟店ごとに、どの面から実際に問い合わせが来たかを記録し、配分を見直す材料にする。"},
]

QUESTIONS = [
    {"id": "q_ai_place", "w": 9, "purpose": "visibility", "axis": "GEO", "order": 200,
     "text": ("AIや検索から見つけてもらうために、まず所在をはっきりさせます。"
              "正式な社名、住所、電話番号、営業時間、対応できる地域を教えてください。"
              "ホームページやGoogleのプロフィールに載せているものと違いがあれば、"
              "その違いもそのまま教えてください。表記がばらついていること自体が、よくある詰まりです。")},
    {"id": "q_ai_questions", "w": 9, "purpose": "visibility", "axis": "AEO", "order": 201,
     "text": ("お客様から実際によく聞かれることを、聞かれる言葉のまま3つ挙げてください。"
              "きれいに言い換えないでください。実際の言い方のほうが、"
              "同じことを尋ねる人に届きます。答えも、いつも話している通りで構いません。")},
    {"id": "q_ai_summary", "w": 8, "purpose": "visibility", "axis": "LLMO", "order": 202,
     "text": ("御社を一度も見たことがない人に、20秒で説明するとしたら何と言いますか。"
              "何をする会社で、誰のためで、他とどこが違うか。"
              "うまい言い回しより、いつもお客様に話している言葉のほうが役に立ちます。")},
    {"id": "q_ai_tools", "w": 7, "purpose": "visibility", "axis": "WebMCP", "order": 203,
     "text": ("お客様やAIが、御社に直接尋ねられるとしたら、何を尋ねられるようにしておきたいですか。"
              "空き状況、対応できる範囲、料金の目安、対応できる地域など。"
              "『これは自動で答えてよい』『これは必ず人が出る』の線引きも合わせて教えてください。"
              "その線引きが、こちらで作る窓口の設計そのものになります。")},
    {"id": "q_ai_found", "w": 8, "purpose": "visibility", "axis": "measure", "order": 204,
     "text": ("いま、お客様は御社をどうやって見つけていますか。"
              "紹介、検索、看板、SNS、以前からの付き合い。割合はだいたいで構いません。"
              "『AIで見つけた』というお客様がいたら、それは貴重なので必ず教えてください。"
              "こちらはAIからの流入をまだ1件も測れていないので、実例が要ります。")},
]


def main():
    apply = "--apply" in sys.argv
    db = {
        "dataset": "AI可視性 要件データベース (HORIZON SHIELD)",
        "purpose": ("AIと検索から見つけられ、参照されるために何が要るかを、出典つきで並べる。"
                    "仕様に書いてあること(spec)と、それが推薦に効くかどうか(effect)を、必ず分けて持つ。"),
        "version": "visibility.seed.1",
        "built_at": "2026-08-23",
        "discipline": {
            "two_axes": ("spec.confirmed は『仕様や公式文書にそう書いてあるか』。"
                         "effect.confirmed は『それがAIの推薦に効くか』。"
                         "前者が真でも後者は別に確かめる。混ぜない。"),
            "we_do_not_say": ["この施策でAIに推薦されます", "上位に出ます", "必ず効果があります"],
            "why": ("検索やAIの中身は公開されていない。効果を断定できる人は社外にいない。"
                    "断定した瞬間、それは根拠ではなく営業文句になる。"),
        },
        "golden_ratio": {"geo": 40, "aeo": 30, "llmo": 20, "webmcp": 10,
                         "basis": "方針。外部の根拠は無い。known_gaps に書いてある。"},
        "known_gaps": KNOWN_GAPS,
        "items": ITEMS,
        "sources": SOURCES,
        "questions": QUESTIONS,
        "questions_note": ("可視性の設問は業種を問わない。所在・問い・要約・窓口は、"
                           "建設でも訪問看護でも同じだけ要る。だから業種別ではなく共通に置く。"),
        "field_reports": [],
        "field_reports_note": {
            "what": "加盟店から聞き取った、実際にどう見つけられているか。",
            "never": "効果の根拠に使わない。1社の体感は、効果の測定ではない。",
        },
    }
    spec_ok = sum(1 for it in ITEMS if it["spec"]["confirmed"])
    eff_ok = sum(1 for it in ITEMS if it.get("effect", {}).get("confirmed"))
    print("項目 %d / 出典 %d / 設問 %d" % (len(ITEMS), len(SOURCES), len(QUESTIONS)))
    print("  仕様として確認できたもの: %d / %d" % (spec_ok, len(ITEMS)))
    print("  効果まで確認できたもの  : %d / %d  ← ここが 0 であることが、この資料の要点" % (eff_ok, len(ITEMS)))
    for it in ITEMS:
        print("  [%-7s] %s" % (it["axis"], it["name"]))
    if not apply:
        print("\n(--apply が無いので、まだ書いていません)"); return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    io.open(OUT, "w", encoding="utf-8").write(json.dumps(db, ensure_ascii=False, indent=2) + "\n")
    print("\n書きました: %s" % OUT)


if __name__ == "__main__":
    main()
