# 被リンク依頼 下書き(2026-09-13)

目的: shield.the-horizons-innovation.com への外部リンクが現在 0 本。Google のクロール需要が 1 日約 3 本しか無く、索引 22 本で止まっている直接の原因。
送るのは TOshi の手。番人は送らない。文面は自由に削ってええ。ダッシュ類は入れてへん。

方針:
- 金の話は一切しない(有料リンクに見える言い回しは Google の規約違反になる)。
- 「検証を受けている事実の表示」として、既存の加盟店バッジを貼ってもらう。加盟の条件にはしない(条件にすると人為リンクになる)。
- 貼り付けコードは公開ページ /badges/ にある。href は各社のプロフィール URL に差し替える。
- バッジ(badges/yakumo-verified.svg)は 7/30 から存在し、/badges/ ページは 8/25 から公開、mypage にも出る。だが 001 にも 002 にも渡した記録は無い(ops / line-broadcast / hearing の自動文のどこにも無い)。この依頼が初回の手渡し。送るときは /badges/ の URL も添える。
- No.002 は KIRA 適正診断が実施中なので、バッジは「加盟店」表示のまま。検証完了後に差し替えの案内をする。

---

## 1. リフォーム職人株式会社(加盟 No.001) 堤 邦博 様 / 森下 真也 様  ← 今は保留

保留の理由: 見積もり例(3 本)がまだ届いていない。KIRA の自動採点も verified 化もそこで止まっている(q_estimates が ASK_MAX に達して機械は二度と聞けない状態)。
検証が通っていないのに「検証済み」を名乗るバッジを渡すのは筋が通らないし、まだ estimates をもらえていない相手にこちらからリンクの favor を頼むのは順番が逆。
先にやること = 見積もり例 3 本をもらう(機械は聞けないので人が直接頼む。森下さんが持っている可能性が高い)。それが入って KIRA が通れば、検証済み → バッジ → 被リンク の順で初めて依頼する。

だから今日の被リンクからは 001 を外す。下の「3. 自前の資産」を先に回す。

---

## 2. ミネオトーヨー住器株式会社(加盟 No.002) 峰尾 剛史 様

件名: Yakumo 加盟店バッジの掲載のお願い(貼るだけ・5 分)

峰尾様

いつもお世話になっております。The HORIZ音s株式会社の大賀です。

Yakumo の加盟店ページ(https://shield.the-horizons-innovation.com/yakumo/no002/)を公開しております(MCP 接続は検証済み、KIRA 適正診断は実施中です)。
貴社サイトの会社概要かフッターに、Yakumo 加盟店バッジを貼っていただけないでしょうか。

貼り付けコード(コピーしてそのまま貼れます):

<a href="https://shield.the-horizons-innovation.com/yakumo/no002/" target="_blank" rel="noopener">
  <img src="https://shield.the-horizons-innovation.com/badges/yakumo-verified.svg" alt="Yakumo 加盟店 - HORIZON SHIELD" width="340" height="72">
</a>

貼っていただくと、
1. 貴社サイトを見た施主が、Yakumo 上の貴社情報と検証の進み具合をその場で確認できます。
2. 検索エンジンと AI が、貴社と Yakumo を結びつけて認識しやすくなります。
3. 弊社の側でも、外部サイトからのリンクが Google の巡回を呼ぶため、加盟店ページが検索に載りやすくなります。

KIRA 適正診断が完了した時点で、検証済み表示への差し替えをこちらからご案内します。
Yakumo は紹介料を取らない中立のモールです。掲載は任意で、加盟条件ではありません。

大賀 俊勝
The HORIZ音s株式会社 / HORIZON SHIELD
TEL 0463-74-5917

---

## 3. 自前の資産からのリンク(相手の返事を待たずに今日できる分)

外部ドメインからのリンクとして数えられるもの。どれも TOshi のアカウント操作。

| 場所 | 貼る先 | 文言の例 |
|---|---|---|
| note.com のプロフィール欄 | https://shield.the-horizons-innovation.com/ | HORIZON SHIELD(見積もり鑑定書AI・逆見積もり) |
| note.com の各記事の末尾(既存記事も) | https://shield.the-horizons-innovation.com/kantei/ | 見積もりが高いか無料で診断する→ |
| LinkedIn の About と Featured | https://shield.the-horizons-innovation.com/ と /kantei/ | 会社サイト |
| GitHub ogasurfproject-jpg/horizon-shield の README 冒頭 | https://shield.the-horizons-innovation.com/ | Live site: |
| GitHub のプロフィール README | https://shield.the-horizons-innovation.com/ | |
| X のプロフィール URL 欄 | https://shield.the-horizons-innovation.com/kantei/ | |
| horizonshield.dev 配下の Worker のトップ(hs-verify-gate 等が HTML を返すなら) | https://shield.the-horizons-innovation.com/ | 別ドメインなので外部リンク扱い。要 wrangler deploy = TOshi の手 |
| SSRN 6964439 / engrXiv 7814 の著者欄・補足 URL | https://shield.the-horizons-innovation.com/ | 学術側の被リンク。編集できる欄があれば |
| 八工門の会社サイト(あれば) | https://shield.the-horizons-innovation.com/ | 提携・技術提供先 |

順番: note.com と LinkedIn が先(今日)。GitHub README は次。相手待ちは 1 と 2。
効果の測り方: GSC の「クロールの統計情報」で 1 日のリクエスト数が 3 本から動くか(2〜4 週)。「リンク」レポートの外部リンク数が 0 から動くか。
