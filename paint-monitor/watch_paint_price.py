import subprocess, hashlib, json, os, re, urllib.request, datetime
try:
    from feed_emitter import emit_feed
except Exception:
    emit_feed = None

# ============================================================
# 塗料 値上げ監視ボット(検算ゲート付き 改定率自動算出)
#   - 3社の設計価格PDFを直リンク監視(静的で確実)
#   - 主要製品の㎡単価を狙い撃ち抽出 → 前版と差分 = 改定率
#   - 検算ゲート: 常識レンジ外/前版比±X%超 は「保留アラート」
#     正常時は完全自動、異常時だけ人間に上げる
# ============================================================

TARGETS = [
    {
        "id": "nipponpaint_sekkei_pdf",
        "maker": "日本ペイント",
        "label": "建築用 設計価格表(戸建材工)",
        "url": "https://www.nipponpaint.co.jp/images/products/building/pricelist.pdf",
        # 代表製品: 製品名キー(行特定用)
        "products": ["パーフェクトトップSi", "ファインSi", "パワーオーデフレッシュF"],
    },
    {
        "id": "kikusui_sekkei_pdf",
        "maker": "菊水化学",
        "label": "設計価格 2026",
        "url": "https://www.kikusui-chem.co.jp/common/pdf/kakaku.pdf",
        "products": ["水系ファインコート", "ビュートップウレタン弾性", "グラストSi"],
    },
    {
        "id": "sk_kaken_sekkei_pdf",
        "maker": "SK化研",
        "label": "設計価格表(現行年度版)",
        "url": "https://sk-kaken.yucca-works.jp/wp/wp-content/uploads/price2025.pdf",
        "products": ["セラミシリコン", "プレミアムシリコン", "マイルドシリコン"],
    },
]

# 翌年度版PDFが公開されたら気づくための存在チェック
PROBE_NEXT = [
    {"maker": "SK化研", "url_tmpl": "https://sk-kaken.yucca-works.jp/wp/wp-content/uploads/price{y}.pdf", "year": 2026},
]

# 検算ゲートの定数
PRICE_MIN = 1500      # ㎡単価の常識下限(円/㎡)
PRICE_MAX = 10000     # ㎡単価の常識上限(円/㎡)
CHANGE_ALERT = 0.50   # 前版比 ±50%超の変動は抽出ミス疑い → 保留

BASE = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(BASE, "paint_state.json")


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def head_status(url):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}, method="HEAD")
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status
    except Exception as e:
        return getattr(e, "code", 0)


def pdf_to_text(data):
    open("/tmp/paint_dl.pdf", "wb").write(data)
    out = subprocess.run(["pdftotext", "-layout", "/tmp/paint_dl.pdf", "-"],
                         capture_output=True, text=True)
    return out.stdout


def extract_dates(text):
    return re.findall(r"20\d{2}\s*年\s*\d{1,2}\s*月", text)


def _norm(s):
    """全角英数を半角化して製品名の表記ゆれを吸収する。"""
    z = "ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ０１２３４５６７８９"
    h = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    return s.translate(str.maketrans(z, h))


def _median(vals):
    vs = sorted(vals)
    n = len(vs)
    if n == 0:
        return None
    if n % 2 == 1:
        return vs[n // 2]
    return round((vs[n // 2 - 1] + vs[n // 2]) / 2)


def extract_unit_price(text, product):
    """製品名を含む行から、常識レンジ内の㎡単価の中央値を返す(参考値)。
    同一製品が複数仕様で並ぶため、最小だと下塗り等に引っ張られる。
    中央値で代表的な仕上げ単価に寄せる。見つからなければ None。
    ※ これは参考値。正確な改定率は検知後にPDFを目視確認すること。"""
    product_n = _norm(product)
    candidates = []
    for line in text.splitlines():
        if product_n in _norm(line):
            for m in re.findall(r"(\d{1,2},\d{3}|\d{4})", line):
                v = int(m.replace(",", ""))
                if PRICE_MIN <= v <= PRICE_MAX:
                    candidates.append(v)
    if not candidates:
        return None
    return _median(candidates)


def main():
    state = json.load(open(STATE, encoding="utf-8")) if os.path.exists(STATE) else {}
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    alerts = []        # 改定検知(正常)
    hold_alerts = []   # 検算ゲートに引っかかった保留(要目視)

    for t in TARGETS:
        tid = t["id"]
        print("=" * 54)
        print("監視:", t["maker"], t["label"])
        try:
            raw = fetch(t["url"])
            text = pdf_to_text(raw)
        except Exception as e:
            print("  取得失敗:", e)
            continue

        h = hashlib.sha256(text.encode("utf-8", errors="ignore")).hexdigest()[:16]
        dates = extract_dates(text)
        latest = max(dates) if dates else ""

        # 製品ごとの㎡単価を抽出
        prices = {}
        for p in t["products"]:
            v = extract_unit_price(text, p)
            prices[p] = v
        price_str = " / ".join(f"{p}:{v if v else '取得不可'}" for p, v in prices.items())
        print("  ハッシュ:", h, " 基準日:", latest or "(なし)")
        print("  参考単価(中央値):", price_str)

        prev = state.get(tid, {})
        prev_h = prev.get("hash", "")
        prev_prices = prev.get("prices", {})

        if not prev_h:
            print("  → 初回記録。")
        elif h != prev_h:
            print("  ★PDF更新あり = 改版/値上げの可能性")
            # 製品ごとに改定率を計算 + 検算ゲート
            for p in t["products"]:
                old = prev_prices.get(p)
                new = prices.get(p)
                if old and new:
                    rate = (new - old) / old
                    if abs(rate) > CHANGE_ALERT:
                        print(f"     [保留] {p}: {old}→{new} ({rate:+.0%}) 変動大、抽出ミス疑い")
                        hold_alerts.append((t["maker"], p, old, new, rate, t["url"]))
                    else:
                        sign = "値上げ" if rate > 0 else ("値下げ" if rate < 0 else "横ばい")
                        print(f"     {p}: {old}→{new} ({rate:+.1%} {sign})")
                        if rate != 0:
                            alerts.append((t["maker"], p, old, new, rate, latest, t["url"]))
                elif new and not old:
                    print(f"     {p}: 新規取得 {new}(前版データ無し)")
                elif old and not new:
                    print(f"     [保留] {p}: 今版で取得不可(前版{old}) レイアウト変化疑い")
                    hold_alerts.append((t["maker"], p, old, None, None, t["url"]))
        else:
            print("  → 変化なし。")

        state[tid] = {"maker": t["maker"], "label": t["label"], "url": t["url"],
                      "hash": h, "latest": latest, "prices": prices, "checked_at": now}

    # 翌年度版PDFの公開検知
    for pr in PROBE_NEXT:
        url = pr["url_tmpl"].format(y=pr["year"])
        pid = "probe_" + str(pr["year"]) + "_" + pr["maker"]
        code = head_status(url)
        print("=" * 54)
        print(f"翌年度版チェック: {pr['maker']} {pr['year']}年度  HTTP {code}")
        prev_code = state.get(pid, {}).get("code")
        if prev_code and prev_code != 200 and code == 200:
            print("  ★翌年度版が公開された!", url)
            alerts.append((pr["maker"], f"{pr['year']}年度版 新規公開", None, None, None, "", url))
        elif code == 200:
            print(f"  → 既に公開済み(対象URLを来月price{pr['year']}に上げる)")
        else:
            print("  → まだ未公開。")
        state[pid] = {"code": code, "url": url, "checked_at": now}

    json.dump(state, open(STATE, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    print("=" * 54)
    if alerts:
        print("【改定/値上げアラート(自動確定)】note記事の素材:")
        for a in alerts:
            maker, prod = a[0], a[1]
            if a[2] and a[3]:
                print(f"  - {maker} {prod}: {a[2]}→{a[3]}円/㎡ ({a[4]:+.1%}) 基準日{a[5]}")
            else:
                print(f"  - {maker} {prod}")
            print(f"    {a[-1]}")

        # === 自動feed化: メーカー単位で集約して鮮度テーマを1本吐く ===
        if emit_feed:
            by_maker = {}
            for a in alerts:
                maker = a[0]
                by_maker.setdefault(maker, []).append(a)
            for maker, items in by_maker.items():
                # 値上げ率つきの製品だけ集める(新規公開等はrate=None)
                priced = [x for x in items if x[2] and x[3] and x[4] is not None]
                facts = []
                rates = []
                latest = ""
                url = items[0][-1]
                for x in priced:
                    facts.append(f"{x[1]} 設計価格 約{x[3]:,}円/㎡(前版比 {x[4]*100:+.1f}%)")
                    rates.append(x[4])
                    latest = x[5] or latest
                if not priced:
                    # 新規公開のみ(年度版公開など)
                    title = f"{maker}の設計価格表に動きがあります。値上げ前の見積もりか確認を"
                    facts = [f"{maker}: {items[0][1]}"]
                    kind = "改定"
                else:
                    avg = sum(rates) / len(rates) * 100
                    title = f"{maker}が外壁塗料の設計価格を改定。主要塗料が平均{avg:+.1f}%。今、見積もりを取る人へ"
                    kind = "値上げ"
                facts.append("設計価格は定価。実見積もりはここから値引きされ、足場・諸経費は別途")
                p = emit_feed(
                    category="塗料", kind=kind, title=title,
                    angle=f"{maker}の設計価格改定の事実を施主向けに解説し、値上げ前見積もりかの確認とKIRA診断に誘導。具体的な値引き交渉や足場別の注意も。",
                    keywords=["外壁塗装", "塗料値上げ", maker, "設計価格", "適正価格"],
                    facts=facts, source_url=url,
                )
                if p:
                    print(f"  → 鮮度テーマfeed生成: {p}")
                else:
                    print(f"  → 同じネタが既存のためfeedスキップ({maker})")
    if hold_alerts:
        print("")
        print("【保留(検算ゲート通過せず・要目視確認)】:")
        for ha in hold_alerts:
            maker, prod, old, new = ha[0], ha[1], ha[2], ha[3]
            if new:
                print(f"  - {maker} {prod}: {old}→{new} 変動大。PDFを目視して数字を確認のこと")
            else:
                print(f"  - {maker} {prod}: 今版で取得不可(前版{old})。PDFレイアウト変化の可能性")
            print(f"    {ha[-1]}")
    if not alerts and not hold_alerts:
        print("更新なし。来月また回す。")
    print("state:", STATE)


if __name__ == "__main__":
    main()
