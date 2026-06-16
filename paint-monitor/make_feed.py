# -*- coding: utf-8 -*-
"""
make_feed: 監視ログを見て「これは配信すべき」とTOshiが判断した時、
対話形式で鮮度テーマJSONを1本 feed/ に吐く手動ツール。

使い方:
    python3 make_feed.py
  → カテゴリ/種別/タイトル等を順に聞かれ、feed/ にJSONを吐く。
  既存テンプレ(塗料値上げ/水回り掛け率/内窓締切)から選んで微調整もできる。

段階2(自動feed化)が出来るまでの繋ぎ。これで出口の前半(ネタ生成)が今すぐ使える。
"""
import sys, os
from feed_emitter import emit_feed, list_pending

TEMPLATES = {
    "1": {
        "category": "塗料", "kind": "値上げ",
        "title": "【{month}】{maker}が外壁塗料を改定。今、見積もりを取る人が損しない方法",
        "angle": "メーカー設計価格の改定事実を示し、値上げ前見積もりかの確認とKIRA診断に誘導。足場別であることも明示。",
        "keywords": ["外壁塗装", "塗料値上げ", "設計価格", "㎡単価", "適正価格"],
        "facts": [
            "ラジカルシリコン(パーフェクトトップSi級)の戸建材工設計価格は約5,000〜5,600円/㎡",
            "シリコン約6,400円/㎡、フッ素約6,900円/㎡(いずれも材工、足場・諸経費別)",
            "設計価格は定価。実見積もりはここから値引きされるのが普通",
        ],
        "source_url": "https://www.nipponpaint.co.jp/images/products/building/pricelist.pdf",
    },
    "2": {
        "category": "水回り", "kind": "掛け率変動",
        "title": "ユニットバスの「60%OFF」は本当に得か。定価と掛け率のからくり",
        "angle": "施主支給ECの定価×実売から業者の掛け率の目安を示し、上位グレード誘導の罠を警告。KIRA診断へ。",
        "keywords": ["ユニットバス", "値引き率", "定価", "施主支給", "適正価格"],
        "facts": [
            "施主支給ECではTOTOサザナが定価641,520→実売211,701(約67%OFF)等で公開されている",
            "汎用品も上位グレードも製造原価はカタログ定価の約15%という卸業者証言がある",
            "60%OFFを謳いつつ上位グレードに誘導する販売手法に注意",
        ],
        "source_url": "https://www.homedepo.biz/sale_item07.php",
    },
    "3": {
        "category": "内窓", "kind": "締切前倒し",
        "title": "先進的窓リノベ2026、補助金は予算が尽きたら締切。今のグレード要件に注意",
        "angle": "予算枯渇で締切が前倒しになるリスクと、2026年のグレード要件厳格化(Aグレード除外)を警告。KIRA診断へ。",
        "keywords": ["先進的窓リノベ", "内窓", "補助金", "Sグレード", "締切"],
        "facts": [
            "申請は遅くとも2026年11月16日まで(予算上限に達した場合は当該時点まで)",
            "2026年から内窓のAグレードは補助対象外。Sグレード以上(Uw1.5〜)が条件",
            "ガラス厚を間違えると空気層が狭まりA落ち=補助金ゼロになる",
        ],
        "source_url": "https://window-renovation2026.env.go.jp/application/",
    },
}


def ask(prompt, default=""):
    v = input(f"{prompt}" + (f" [{default}]" if default else "") + ": ").strip()
    return v or default


def main():
    print("=== 鮮度テーマ手動作成(make_feed) ===")
    print("既存テンプレ: 1=塗料値上げ / 2=水回り掛け率 / 3=内窓締切 / 0=ゼロから")
    choice = ask("テンプレ番号", "1")

    if choice in TEMPLATES:
        t = dict(TEMPLATES[choice])
        # タイトルの穴埋め(塗料はmonth/maker)
        if "{month}" in t["title"] or "{maker}" in t["title"]:
            month = ask("時期(例:2026年6月)", "2026年6月")
            maker = ask("メーカー名(例:日本ペイント)", "日本ペイント")
            t["title"] = t["title"].format(month=month, maker=maker)
        print("\n--- このテーマで吐きます ---")
        print("タイトル:", t["title"])
        print("カテゴリ:", t["category"], "/ 種別:", t["kind"])
        if ask("これでよいか(y/n)", "y").lower() != "y":
            print("中止。")
            return
        p = emit_feed(category=t["category"], kind=t["kind"], title=t["title"],
                      angle=t["angle"], keywords=t["keywords"], facts=t["facts"],
                      source_url=t["source_url"])
    else:
        category = ask("カテゴリ(塗料/水回り/内窓)")
        kind = ask("種別(値上げ/掛け率変動/締切前倒し/受付終了 等)")
        title = ask("タイトル")
        angle = ask("記事の狙い(angle)")
        keywords = [k.strip() for k in ask("キーワード(カンマ区切り)").split(",") if k.strip()]
        facts = [f.strip() for f in ask("事実(セミコロン区切り、公開可のみ)").split(";") if f.strip()]
        source_url = ask("出典URL")
        p = emit_feed(category=category, kind=kind, title=title, angle=angle,
                      keywords=keywords, facts=facts, source_url=source_url)

    if p:
        print("\n吐きました:", p)
    else:
        print("\n同じネタが既にあります(重複防止でスキップ)。")
    print("現在のpending:", len(list_pending()), "件")


if __name__ == "__main__":
    main()
