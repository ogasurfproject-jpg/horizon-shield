import hashlib, json, os, re, urllib.request, datetime
try:
    from feed_emitter import emit_feed
except Exception:
    emit_feed = None

# ============================================================
# 内窓・断熱 補助金 制度監視ボット(先進的窓リノベ2026)
#   塗料=PDF版数 / 水回り=EC価格 とは別の「制度監視」型。
#   追うもの:
#     - 締切期限(前倒し=予算枯渇のサイン)
#     - 「予算上限に達した/受付終了」文言の出現(即終了アラート)
#     - 更新日(制度に動きがあった)
#     - ページ全体ハッシュ(グレード要件/補助額の変更)
#   施主の不安: 補助金いつ尽きる / グレード地雷で対象外
# ============================================================

TARGETS = [
    {
        "id": "madoreno2026_application",
        "label": "先進的窓リノベ2026 申請(締切/予算執行)",
        "url": "https://window-renovation2026.env.go.jp/application/",
    },
    {
        "id": "madoreno2026_overview",
        "label": "先進的窓リノベ2026 概要(補助額/グレード要件)",
        "url": "https://window-renovation2026.env.go.jp/overview/",
    },
]

# 受付終了・予算枯渇を示す危険ワード(出現したら即アラート)
# 実際の終了告知だけを狙う(条件説明「〜場合は」と区別するため完了/確定表現に限定)
DANGER_WORDS = [
    "受付を終了しました", "受付を終了いたしました", "申請を締め切りました",
    "募集を終了しました", "予算上限に達したため", "申請受付は終了",
    "現在、申請を受け付けておりません", "受付は終了しました",
]

BASE = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(BASE, "madoreno_state.json")


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def to_text(html):
    t = html.decode("utf-8", errors="ignore")
    t = re.sub(r"(?is)<script.*?</script>", " ", t)
    t = re.sub(r"(?is)<style.*?</style>", " ", t)
    t = re.sub(r"(?s)<[^>]+>", " ", t)
    return re.sub(r"\s+", " ", t)


def extract_deadlines(text):
    """「遅くとも 2026年MM月DD日 まで」型の締切を全部拾う。"""
    out = []
    for m in re.finditer(r"遅くとも\s*(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日", text):
        out.append(f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}")
    return sorted(set(out))


def extract_update_date(text):
    m = re.search(r"更新日\s*[:：]?\s*(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日", text)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    return ""


def main():
    state = json.load(open(STATE, encoding="utf-8")) if os.path.exists(STATE) else {}
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    alerts, danger = [], []

    for t in TARGETS:
        tid = t["id"]
        print("=" * 54)
        print("監視:", t["label"])
        try:
            text = to_text(fetch(t["url"]))
        except Exception as e:
            print("  取得失敗:", e)
            continue

        h = hashlib.sha256(text.encode("utf-8", errors="ignore")).hexdigest()[:16]
        deadlines = extract_deadlines(text)
        upd = extract_update_date(text)
        hits = [w for w in DANGER_WORDS if w in text]

        print("  ハッシュ:", h)
        print("  更新日:", upd or "(なし)")
        print("  締切:", " / ".join(deadlines) if deadlines else "(なし)")
        if hits:
            print("  ★危険ワード:", " / ".join(hits))

        prev = state.get(tid, {})
        if not prev:
            print("  → 初回記録。")
        else:
            # 締切の前倒し検知
            prev_dl = prev.get("deadlines", [])
            if deadlines and prev_dl and deadlines != prev_dl:
                print("  ★締切が変化!", prev_dl, "→", deadlines)
                alerts.append(("締切変化", t["label"], str(prev_dl), str(deadlines), t["url"]))
            # 更新日の変化
            if upd and prev.get("update_date") and upd != prev.get("update_date"):
                print("  ★更新日が動いた:", prev.get("update_date"), "→", upd)
                alerts.append(("ページ更新", t["label"], prev.get("update_date"), upd, t["url"]))
            # 危険ワードの新規出現
            new_danger = [w for w in hits if w not in prev.get("danger_hits", [])]
            if new_danger:
                print("  ★★受付終了/予算枯渇の可能性:", " / ".join(new_danger))
                danger.append((t["label"], " / ".join(new_danger), t["url"]))
            # 全体ハッシュ変化(要件/補助額の変更検知)
            if h != prev.get("hash") and not (deadlines != prev_dl or new_danger):
                print("  ★ページ内容に変化あり(要件/補助額の変更可能性)")
                alerts.append(("内容変化", t["label"], "", "", t["url"]))
            if h == prev.get("hash"):
                print("  → 変化なし。")

        state[tid] = {"label": t["label"], "url": t["url"], "hash": h,
                      "deadlines": deadlines, "update_date": upd,
                      "danger_hits": hits, "checked_at": now}

    json.dump(state, open(STATE, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("=" * 54)
    if danger:
        print("【★★緊急: 受付終了/予算枯渇アラート】")
        for d in danger:
            print(f"  - {d[0]}: {d[1]}")
            print(f"    {d[2]}")
        print("  ※ 即note/LINE配信: 『補助金が締め切られた/枯渇間近。駆け込み需要』")
    if alerts:
        print("【変化アラート】note素材:")
        for a in alerts:
            if a[2] or a[3]:
                print(f"  - [{a[0]}] {a[1]}: {a[2]} → {a[3]}")
            else:
                print(f"  - [{a[0]}] {a[1]}")
            print(f"    {a[-1]}")

    # === 自動feed化: 内窓補助金の変化を緊急度つき鮮度テーマに集約 ===
    if emit_feed and (danger or alerts):
        url = (danger[0][-1] if danger else alerts[0][-1])
        facts = []
        kind = "制度変更"
        priority_urgent = False

        # danger(受付終了/予算枯渇)が最優先
        if danger:
            kind = "受付終了"
            priority_urgent = True
            for d in danger:
                facts.append(f"先進的窓リノベ事業で『{d[1]}』に該当する表記が確認されました。公式サイトで最新状況を必ず確認してください")
            title = "先進的窓リノベ補助金に受付終了/予算枯渇の兆候。今すぐ公式で最新状況の確認を"
        else:
            # 締切変化・ページ更新
            shimekiri_changed = any(a[0] == "締切変化" for a in alerts)
            if shimekiri_changed:
                kind = "締切変化"
                priority_urgent = True
                def _fmt_deadlines(x):
                    # ["2026-09-30","2026-12-31"] → "2026年9月30日・2026年12月31日"
                    try:
                        items = x if isinstance(x, list) else eval(x)
                    except Exception:
                        items = [x]
                    out = []
                    for d in items:
                        m = re.match(r"(\d{4})-(\d{2})-(\d{2})", str(d))
                        if m:
                            out.append(f"{int(m.group(1))}年{int(m.group(2))}月{int(m.group(3))}日")
                        else:
                            out.append(str(d))
                    return "・".join(out)
                for a in alerts:
                    if a[0] == "締切変化":
                        facts.append(f"公式サイトの申請締切の記載が変わりました(前回確認時: {_fmt_deadlines(a[2])} / 今回: {_fmt_deadlines(a[3])})。予算上限に達した場合はその時点までです")
                title = "先進的窓リノベ補助金の申請締切に動き。予算枯渇による前倒しに注意"
            else:
                kind = "制度更新"
                facts.append("先進的窓リノベ事業の公式ページが更新されました。補助額・要件・締切のいずれかが動いた可能性があります")
                title = "先進的窓リノベ補助金の公式情報が更新。要件とグレード条件の再確認を"

        # 内窓共通のグレード地雷factを必ず添える(KIRAの独壇場)
        facts.append("2026年は内窓のSグレード以上(Uw1.5程度以下)が補助条件で、Aグレードは対象外の場合があります")
        facts.append("ガラス厚や空気層の幅を誤るとグレードが下がり補助対象外になる場合があります。見積書の仕様を確認してください")

        p = emit_feed(
            category="内窓", kind=kind, title=title,
            angle="先進的窓リノベ補助金の締切/要件の変化を施主向けに解説し、見積書のグレードがSグレード以上か、補助対象から外れないかをKIRA診断で確認するよう誘導。締切や金額は参考事実の範囲で断定しすぎない。",
            keywords=["先進的窓リノベ", "内窓", "補助金", "Sグレード", "締切"],
            facts=facts, source_url=url,
        )
        if p:
            print(f"  → 鮮度テーマfeed生成({'緊急' if priority_urgent else '通常'}): {p}")
        else:
            print(f"  → 同じネタが既存のためfeedスキップ")
    if not danger and not alerts:
        print("更新なし。来月また回す。")
    print("state:", STATE)


if __name__ == "__main__":
    main()
