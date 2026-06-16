import hashlib, json, os, re, urllib.request, datetime
try:
    from feed_emitter import emit_feed
except Exception:
    emit_feed = None

# ============================================================
# 水回り 施主支給EC 監視ボット(定価×実売×OFF率)
#   - homedepo等の施主支給ECは定価と実売を1ページ併載 = 掛け率が一撃
#   - 製品名/定価/価格の3行セットを構造抽出
#   - OFF率(=業者の掛け率の目安)を自動計算
#   - 検算ゲート: OFF率が常識レンジ(40〜85%)外 → 保留
#   - 値引き率の変動 = 仕入環境/メーカー定価改定のサイン
# ============================================================

TARGETS = [
    {
        "id": "homedepo_sale07",
        "shop": "ホームデポ(施主支給)",
        "label": "水回り特価一覧",
        "url": "https://www.homedepo.biz/sale_item07.php",
    },
]

# 検算ゲート
OFF_MIN = 0.40   # OFF率の常識下限(40%引き)
OFF_MAX = 0.85   # OFF率の常識上限(85%引き)
PRICE_MIN = 10000
PRICE_MAX = 3000000
CHANGE_ALERT = 0.30  # 実売が前回比±30%超で動いたら要確認

BASE = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(BASE, "water_state.json")


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def to_parts(html):
    t = html.decode("utf-8", errors="ignore")
    t = re.sub(r"(?is)<script.*?</script>", " ", t)
    t = re.sub(r"(?is)<style.*?</style>", " ", t)
    t = re.sub(r"(?s)<[^>]+>", "|", t)
    t = re.sub(r"\s+", " ", t)
    t = re.sub(r"\|+", "|", t)
    return [p.strip() for p in t.split("|") if p.strip()]


def parse_products(parts):
    """製品名 → 定価:X → 価格:X の3行セットを拾う。
    定価行の直前の非価格行を製品名とみなす。"""
    items = []
    last_name = ""
    pending_teika = None
    for p in parts:
        m_teika = re.search(r"定価\s*[:：]?\s*([0-9,]+)\s*円", p)
        m_kakaku = re.search(r"価格\s*[:：]?\s*([0-9,]+)\s*円", p)
        if m_teika:
            pending_teika = int(m_teika.group(1).replace(",", ""))
            continue
        if m_kakaku and pending_teika:
            jiuri = int(m_kakaku.group(1).replace(",", ""))
            teika = pending_teika
            if PRICE_MIN <= teika <= PRICE_MAX and PRICE_MIN <= jiuri <= PRICE_MAX and jiuri < teika:
                off = 1 - jiuri / teika
                items.append({"name": last_name[:40], "teika": teika, "jiuri": jiuri, "off": round(off, 3)})
            pending_teika = None
            continue
        # 価格でない行 = 製品名候補(定価/価格/注釈以外)
        if "定価" not in p and "価格" not in p and not re.match(r"^[0-9,]+円", p):
            if any(k in p for k in ["TOTO", "リクシル", "LIXIL", "クリナップ", "TOCLAS", "トクラス",
                                     "エコキュート", "給湯", "サザナ", "洗面", "トイレ",
                                     "キッチン", "ユニットバス", "アメージュ", "コロナ", "ノーリツ"]):
                last_name = p
    return items


def main():
    state = json.load(open(STATE, encoding="utf-8")) if os.path.exists(STATE) else {}
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    alerts, hold = [], []

    for t in TARGETS:
        tid = t["id"]
        print("=" * 54)
        print("監視:", t["shop"], t["label"])
        try:
            parts = to_parts(fetch(t["url"]))
        except Exception as e:
            print("  取得失敗:", e)
            continue

        items = parse_products(parts)
        print(f"  抽出 {len(items)} 件")
        # 検算ゲート: OFF率が常識外を弾く
        clean = []
        for it in items:
            if OFF_MIN <= it["off"] <= OFF_MAX:
                clean.append(it)
                print(f"    {it['name']}: 定価{it['teika']:,}→{it['jiuri']:,} ({it['off']*100:.0f}%OFF)")
            else:
                print(f"    [除外] {it['name']}: OFF率{it['off']*100:.0f}% 常識外")

        h = hashlib.sha256(json.dumps([(c['name'], c['teika'], c['jiuri']) for c in clean],
                                      ensure_ascii=False).encode()).hexdigest()[:16]
        prev = state.get(tid, {})
        # 識別キーは name+teika。homedepoに同名製品(本体/付属品)が複数あるため
        # 名前だけだと取り違える。定価込みキーで同名でも別商品として扱う。
        def _key(x):
            return f"{x['name']}|{x['teika']}"
        prev_items = {_key(c): c for c in prev.get("items", [])}
        # 定価改定の検出用: name単位で「前回その名前にあった定価集合」を持つ
        prev_by_name = {}
        for c in prev.get("items", []):
            prev_by_name.setdefault(c["name"], []).append(c["teika"])

        if not prev:
            print("  → 初回記録。")
        elif h != prev.get("hash"):
            print("  ★変化あり = 実売変動の可能性")
            for c in clean:
                old = prev_items.get(_key(c))
                if old:
                    # 同一商品(name+teika一致)。実売の変動だけを見る。
                    dj = (c["jiuri"] - old["jiuri"]) / old["jiuri"] if old["jiuri"] else 0
                    if abs(dj) > CHANGE_ALERT:
                        print(f"     [保留] {c['name']} 実売{old['jiuri']:,}→{c['jiuri']:,} ({dj:+.0%})")
                        hold.append((c["name"], old["jiuri"], c["jiuri"], t["url"]))
                    elif abs(dj) > 0.001:
                        print(f"     実売変動 {c['name']}: {old['jiuri']:,}→{c['jiuri']:,} ({dj:+.1%})")
                        alerts.append(("実売変動", c["name"], old["jiuri"], c["jiuri"], t["url"]))
                else:
                    # name+teika が前回に無い。定価改定か新商品かを判定。
                    prev_teikas = prev_by_name.get(c["name"], [])
                    if prev_teikas:
                        # 同名で別定価が前回あった = 定価改定の可能性(ただし同名複数だと曖昧なので保留)
                        nearest = min(prev_teikas, key=lambda tk: abs(tk - c["teika"]))
                        # 定価が大きく違う(2倍以上 or 半分以下)なら別商品の取り違えとみなしスキップ
                        ratio = c["teika"] / nearest if nearest else 0
                        if 0.5 <= ratio <= 2.0:
                            print(f"     定価改定 {c['name']}: {nearest:,}→{c['teika']:,}")
                            alerts.append(("定価改定", c["name"], nearest, c["teika"], t["url"]))
                        else:
                            # 定価が桁違い = 同名別商品。誤検知防止でスキップ。
                            pass
        else:
            print("  → 変化なし。")

        state[tid] = {"shop": t["shop"], "label": t["label"], "url": t["url"],
                      "hash": h, "items": clean, "checked_at": now}

    json.dump(state, open(STATE, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("=" * 54)
    if alerts:
        print("【変動アラート(自動確定)】note素材:")
        for a in alerts:
            print(f"  - [{a[0]}] {a[1]}: {a[2]:,}→{a[3]:,}")

        # === 自動feed化: 水回りの実売変動を1本の鮮度テーマに集約 ===
        if emit_feed:
            url = alerts[0][-1]
            facts = []
            for a in alerts:
                kind_a, name, old, new = a[0], a[1], a[2], a[3]
                if old:
                    diff = (new - old) / old * 100
                    facts.append(f"{name}: 実売 約{old:,}円 → 約{new:,}円({diff:+.1f}%)")
                else:
                    facts.append(f"{name}: {new:,}円")
            facts.append("施主支給ECの定価×実売から業者の掛け率の目安が読める。60%OFFを謳いつつ上位グレードへ誘導する手法に注意")
            facts.append("汎用品も上位グレードも製造原価はカタログ定価の約15%という卸業者証言がある")
            n = len(alerts)
            title = f"ユニットバス・水回りの実売価格に動き。今、見積もりの掛け率が妥当か確認を"
            p = emit_feed(
                category="水回り", kind="掛け率変動", title=title,
                angle="施主支給ECの定価×実売の変動を施主向けに解説し、見積もりの値引き率(掛け率)が妥当か、上位グレード誘導がないかをKIRA診断で確認するよう誘導。具体的な製品名や金額は参考事実の範囲で。",
                keywords=["ユニットバス", "水回りリフォーム", "値引き率", "施主支給", "適正価格"],
                facts=facts, source_url=url,
            )
            if p:
                print(f"  → 鮮度テーマfeed生成: {p}")
            else:
                print(f"  → 同じネタが既存のためfeedスキップ")
    if hold:
        print("【保留(要目視)】:")
        for hh in hold:
            print(f"  - {hh[0]}: 実売{hh[1]:,}→{hh[2]:,} 変動大。ページ確認のこと")
    if not alerts and not hold:
        print("更新なし。次回また回す。")
    print("state:", STATE)


if __name__ == "__main__":
    main()
