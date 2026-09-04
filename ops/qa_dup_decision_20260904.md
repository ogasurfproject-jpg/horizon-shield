# qa の近似重複 22 ページ: 何が同じで、どう直すか(2026-09-04 夜、番人の実測。決めるのは TOshi)

## 実測

- qa 56 ページ全部に同じ 781 字(17 文)が入っとる: 「信用財」の段落、「施工業者から報酬を受け取らない独立した第三者です」、「判断に迷う見積書は第三者の査定に」、電話の呼び込み、監修の一文、FAQ「診断は誰がしていますか」。JSON-LD の FAQPage も 56 ページ全部にある
- 題材固有の文は中央値 1,019 字(最小 926、最大 1,587)。54 ページが 1,200 字未満
- 門の重複判定 13 組(simhash 6 bit 以内)は、この共通 781 字が押し上げとる。**共通文を外した複製で門を回したら 13 組 → 0 組**(本番は触っとらん、$HOME/qa_sim で実験)
- 22 ページ中 21 が GSC「クロール済み・未登録」

## 直し方は 2 段

### 段 1(機械、56 ページ全部): 共通 781 字を、1〜2 行の案内 + リンク 1 本に置き換える

置き換え先の 1 ページ: /faq/second-opinion-reform/(既存、依頼先の比較表がある)か /about-founder.html。電話の呼び込みは 1 行に畳む(消さん)。FAQ の JSON-LD は「診断は誰が」等の共通 Q を外して、題材固有の Q だけ残す。
これだけで門の重複は消える。ただし可視字数は 1,000 字前後に減る = Google から見た薄さはそのまま。**段 1 だけでは索引は動かん**と見る方が安全。

### 段 2(題材ごと): 固有の中身を 500 字以上足す。出典つきで

souba-db が幅(min / avg / max / 単位 / 動向)を持っとる題材は、それを表にして「出典: souba-db、詳細 /souba/」で足す。get_price_range の返り値がそのまま材料になる(例: 足場 = ㎡ 700〜1,200 円、30 坪一式 15〜25 万円、+3.2%)。

| ページ | souba-db に幅がある | 使うカテゴリ | 段 2 の材料 |
|---|---|---|---|
| ashiba-koji-tanka | ある | 足場(外壁塗装の内訳) | get_price_range 足場 |
| shiroari-cost | ある | termite_work(赤旗 19) | 幅 + 赤旗 |
| yane-repair-cost | ある | roof_construction / rain_leak_repair(赤旗 23) | 幅 + 赤旗 |
| 雨漏り修理-適正価格(aeo) | ある | rain_leak_repair | 幅 + 赤旗 |
| 断熱工事-適正価格(aeo) | ある | insulation_work(赤旗 17) | 幅 + 赤旗 |
| dance-studio-bouon-cost | ある | bouon_shaon_work | 幅 |
| karaoke-bouon-cost | ある | bouon_shaon_work | 幅(dance と同じ幅になるので、用途の違い = 遮音等級・営業時間帯・面積を本文で分ける) |
| kucho-kanki-tanka | ある | aircon_work / zenkanki | 幅 |
| duct-kanki-cost | ある | gyomu_chubo / commercial_tenpo | 幅 |
| kitchen-stainless-cost | ある | gyomu_chubo | 幅 |
| dendenkan-rack-tanka | ある | electrical_work(赤旗 27) | 幅 + 赤旗 |
| denki-haisen-tanka | ある | electrical_work | 幅 + 赤旗(dendenkan と分ける: 幹線 vs 分岐) |
| kyuutouki-maker-tanka | ある | water_heater_reform(赤旗 24) | 幅 + 赤旗 |
| tosou-tanka-detail | ある | gaiheki_tosou | 幅(材工別) |
| sakan-mortar-tanka | ある | sakan_work | 幅 |
| roumu-tanka-2026 | 無い | (国交省 公共工事設計労務単価、毎年 3 月公表、都道府県別・51 職種) | **公的一次資料を出典にできる**。番人が表にできる |
| chiiki-roumu-tanka | 無い | 同上(地域別) | 同上。roumu-tanka-2026 と統合する候補 |
| genjou-kaifuku-cost | 無い | (国交省 原状回復ガイドライン、民法 621 条) | 公的資料。faq/chintai-taikyo-hiyou-takasugiru と役割分担(住宅 vs テナント) |
| dental-clinic-cost | 無い | commercial_tenpo_work の一部 | TOshi の現場知識か、店舗内装のハブに統合 |
| esthe-salon-cost | 無い | 同上 | 同上 |
| kozo-goban-tanka | 無い | (材料単価。JCCDB は品目名と単位のみ、価格無し) | 木材市況の公開値を出典にするか、statement を「単価は市況、見積書での見方」に寄せる |
| spring-floor-cost | 無い | 無し | 統合候補(dance-studio-bouon の一節にする) |

14 / 22 は souba-db の幅で段 2 ができる(出典つき、機械で下書き可)。2 は国交省の一次資料で番人が表にできる。1 は法令とガイドライン。5 は TOshi の中身か統合。

## 順番の提案

1. 段 1 を 56 ページに(機械、掟どおり列挙 → 文脈 → 名指し → tar → 差分)。置き換え文の 1〜2 行と電話の 1 行は TOshi が決める
2. 段 2 を souba-db 組 14 ページから(番人が get_price_range の返り値で下書き、TOshi が目を通す)
3. 労務 2 本は国交省の単価表で 1 本に統合、テナント内装 3 本は 1 本のハブに統合、spring-floor は dance の一節に
4. 全部済んだら GSC 登録リクエストを 22 → 統合後の本数で
5. 物差し: 毎週月曜の監視 15 問(この 22 ページは 15 問の正本やない。効くのはサイト全体の「薄い」印象の解消)

## 決めてほしいこと

- 段 1 の置き換え文(1〜2 行)と電話の呼び込みの 1 行
- 統合 3 件(労務 2 → 1、テナント内装 3 → 1、spring-floor → dance)をやるか
- 段 2 の souba-db 組を番人が下書きしてええか(出典と数字は souba-db の返り値そのまま、文は TOshi が直す前提)
