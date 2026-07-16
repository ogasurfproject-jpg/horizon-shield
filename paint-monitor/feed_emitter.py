# -*- coding: utf-8 -*-
"""
feed_emitter: 監視ボットの検知結果を「鮮度テーマJSON」として feed/ に吐く共通モジュール。
note(THEMES注入用)とLINE(配信文の素材)の両方が食える形式。

使い方(各監視ボットの末尾で):
    from feed_emitter import emit_feed
    emit_feed(category="塗料", kind="値上げ",
              title="...", angle="...", keywords=[...], facts=[...],
              source_url="...")

設計方針:
- 生の卸値額/卸率/内部係数は絶対に出さない(掛け率と判定のみ)。facts には設計価格や締切など公開可の事実だけ。
- 吐くだけ。配信(push)はTOshiが中身を確認してから手動。
"""
import json, os, datetime, hashlib

# feedの置き場所はリポジトリ内の note-post/feed/(GitHub Actionsから読める場所)。
# 監視ボットは paint-monitor で動くが、吐いたネタはここに置いてpush対象にする。
_HS_ROOT = os.path.expanduser("~/Desktop/horizon-shield")
FEED_DIR = os.environ.get("HS_FEED_DIR", os.path.join(_HS_ROOT, "note-post", "feed"))


def emit_feed(category, kind, title, angle, keywords, facts, source_url,
              cta="見積書を見せてください。KIRAが設計価格と相場の両面から無料診断します。"):
    """鮮度テーマを feed/ に1件JSONで吐く。重複は内容ハッシュで防ぐ。"""
    os.makedirs(FEED_DIR, exist_ok=True)
    now = datetime.datetime.now()
    payload = {
        "category": category,          # 塗料 / 水回り / 内窓
        "kind": kind,                  # 値上げ / 掛け率変動 / 締切前倒し / 受付終了 等
        "title": title,                # noteのタイトル / LINEの見出し
        "angle": angle,                # KIRAに渡す記事の狙い
        "keywords": keywords,          # note keywords
        "facts": facts,                # 公開可の事実(設計価格・締切・OFF率など)
        "cta": cta,                    # 診断導線
        "source_url": source_url,
        "lp_url": "https://shield.the-horizons-innovation.com",
        "created_at": now.strftime("%Y-%m-%d %H:%M:%S"),
        "priority": "urgent" if kind in ("受付終了", "締切前倒し", "締切変化", "値上げ") else "normal",
    }
    # 内容ハッシュで重複ファイルを防ぐ(同じ検知を二重配信しない)
    sig = hashlib.sha256((category + kind + title).encode("utf-8")).hexdigest()[:10]
    fname = f"{now.strftime('%Y%m%d')}_{category}_{kind}_{sig}.json"
    path = os.path.join(FEED_DIR, fname)
    if os.path.exists(path):
        return None  # 既に同じネタを吐いている
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    return path


def list_pending():
    """未処理の鮮度テーマ一覧(配信側が読む想定)。priority=urgentを先頭に。"""
    if not os.path.isdir(FEED_DIR):
        return []
    items = []
    for fn in os.listdir(FEED_DIR):
        if fn.endswith(".json"):
            try:
                items.append(json.load(open(os.path.join(FEED_DIR, fn), encoding="utf-8")))
            except Exception:
                pass
    items.sort(key=lambda x: (0 if x.get("priority") == "urgent" else 1, x.get("created_at", "")))
    return items


if __name__ == "__main__":
    # 自己テスト: ダミーの鮮度テーマを吐いて読み戻す
    p = emit_feed(
        category="塗料", kind="値上げ",
        title="【テスト】日本ペイントが外壁塗料を改定。今見積もりを取る人が損しない方法",
        angle="設計価格の改定事実を示し、値上げ前見積もりかの確認とKIRA診断に誘導",
        keywords=["外壁塗装", "値上げ", "設計価格", "㎡単価", "適正価格"],
        facts=["パーフェクトトップSi 設計価格 約5,090円/㎡(戸建材工)",
               "設計価格に足場・諸経費は含まれない"],
        source_url="https://www.nipponpaint.co.jp/images/products/building/pricelist.pdf",
    )
    print("emit:", p)
    print("pending件数:", len(list_pending()))
    for it in list_pending():
        print(" -", it["priority"], it["category"], it["kind"], it["title"][:30])
