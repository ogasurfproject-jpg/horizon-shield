# AI 引用の計器 差し替え(2026-09-15)

作業者: 番人(設計・検証のみ)。書き出し・送信・commit・push は TOshi。

## なぜ差し替えるか(実測)

- 9/7 と 9/14 の Claude 監視(ops/llm_visibility_monitor.py、17 問)は CITED 0/17。GSC は 9/14 時点でコア 115 本のうち登録 0。
- 同じ期間、Bing Webmaster Tools の AI Performance は 8/24〜9/13 の 21 日で引用 10,391 回、直近 7 日(9/7〜9/13)は 4,554 回(650.6/日、被引用ページ 平均 76.4)、9/13 は 1,234 回。従来検索の表示 481 の 9.5 倍。
- grounding query 133 本、引用 3,758 回、引用加重シェア 23.6%。「外壁塗装 相場」363 回で 39.5%。シェア 30% 以上が 24 本、50% 以上が 5 本。
- 型別: 価格型 124 本 / 3,555 回。判定型(「適正価格とは」「見積書比較価格」)2 本 / 26 回。手口型(「一式無増減とは」)1 本 / 8 回。サービス型(第三者・検証・鑑定・社名)0 本。
- つまり「引用 0」は Google と Claude の話で、Bing 側の AI(Copilot 等)では価格型の問いで既に上位出典になっている。0 と数百を同じ「引用」と呼んで混ぜていたのが計器の誤り。以後、どのエンジンの数字かを必ず言う。

## 主計器(週 1 回、月曜)

1. Bing Webmaster Tools から 3 本を書き出して ~/Downloads に置く(ファイル名は Bing が付ける物のまま):
   - AIPerformanceOverviewStats_*.csv(AI Performance の日次: Citations / Cited Pages)
   - AISearchQueriesReport_*.csv(grounding query: Citations / Citation Share)
   - SearchPerformanceOverview_All_*.csv(従来検索の日次。比較用)
2. 台本を回す(stdlib のみ、送信なし。--log で ops/bing_ai_log.txt に要約 1 行を追記):

   cd ~/horizon-shield
   python3 ops/bing_ai_citation_summary.py ~/Downloads --log

3. 見る数字は 4 つだけ:
   - 直近 7 日の引用回数と 1 日平均(基準 9/7〜9/13: 4,554 回、650.6/日)
   - 被引用ページの 1 日平均(基準 76.4)
   - 引用加重シェア(基準 23.6%)とシェア 30% 以上の query 本数(基準 24 本)
   - 型別の本数。判定型・手口型・サービス型が 0 のままかどうか(ここが空いている)

## 副計器(据え置き)

- ops/llm_visibility_monitor.py(Claude、17 問、毎週月曜 12:00)。0/17 が動くかを見る。質問は変えない(基準が崩れる)。
- GSC: 索引登録件数(基準 0/115)とクロール数/日(基準 3)。gsc_log.txt。
- 副計器の 0 は「Google と Claude で 0」と書く。Bing の数字と混ぜない。

## 判断の線(4 週後 10/13 に見る)

- Bing 直近 7 日が 4,554 回を下回り続けたら、9/13 の sitemap 縮小か IndexNow の影響を疑う(archive / yakumo の 2 本が Bing に登録されているかを先に確認)。
- 判定型・手口型・サービス型が 4 週後も 0 本なら、価格型で拾われた読者を判定ページ(/kantei/、/souba/gaiheki-check/、/guide/mitsumori-tekisei-check/)へ流す導線を、被引用上位ページの本文に足す(ページ量産はしない)。
- 引用加重シェアが 23.6% から下がり、本数だけ増えているなら、薄い引用が増えているので上位 query の正本ページを厚くする。

## IndexNow でコア 115 本を再送信する手順(9/15 に番人が検証済み)

事実確認(9/15、番人):
- 台本は repo 直下の indexnow_submit.py(ops/ には無い)。既定 dry-run、--send で送信。--urls は完全 URL のカンマ区切り。ファイル入力は無い。
- 鍵は INDEXNOW_KEY 環境変数。値は IndexNow の仕組み上、repo 直下で公開している 32 桁 .txt のファイル名と同じ(本文 = ファイル名、本番で 200 を確認済み)。新しく作る物は無い。
- 本番 sitemap.xml は 115 本(重複 0、全部 自ドメイン)。115 本を番人が台本と同じ関所で通した結果、200 が 115 本、moat 漏れ判定が 1 本(/ehn/)。/ehn/ の判定は本文中の base64 文字列に 3 文字の禁止語がたまたま含まれるだけの誤検知で、漏れではない。台本はこれを DROP するので、送信は 114 本になる。台本は直さない(壊さない)。
- 副産物: /tokusho/ の canonical が /tokusho.html を指している(sitemap は /tokusho/)。送信には影響しない。直すなら別件。

手順(zsh。上から順。コメント行は無い):

cd ~/horizon-shield
export INDEXNOW_KEY=$(ls | grep -E '^[0-9a-f]{32}\.txt$' | sed 's/\.txt$//')
python3 -c "import re;print(','.join(re.findall(r'<loc>(.*?)</loc>',open('sitemap.xml').read())))" > /tmp/hs_core_urls.txt
python3 indexnow_submit.py --no-marker --urls "$(cat /tmp/hs_core_urls.txt)"

期待値: 「適格 114 / 除外 1」、除外の 1 本は /ehn/ [MOAT_LEAK ...]。これ以外の DROP が出たら送らず番人に言う。

python3 indexnow_submit.py --no-marker --urls "$(cat /tmp/hs_core_urls.txt)" --send

期待値: 「IndexNow 応答: HTTP 200」か 202。403 なら鍵ファイルが本番で読めていない、422 なら URL 不正、429 なら送りすぎ(翌日)。

効果の見方: 翌週の主計器で「被引用ページの 1 日平均」が 76.4 から動くか。9/13 の 1,234 回は archive/yakumo 445 本の IndexNow 送信と Bing への sitemap 登録の当日と一致するが、因果は 1 回では言えない。コア 115 本は 9/4 に 13 本を送っただけで、まとめて IndexNow に出すのは今回が初めて。

## 送信記録

- 2026-09-15 TOshi 実行: dry-run 適格 114 / 除外 1(/ehn/ MOAT_LEAK、誤検知)。--send で IndexNow 応答 HTTP 200、送信 114 本。次の主計器は 9/22(月)の export で読む。

## 月曜の定型(計器と一緒に見る 4 つ目)

- 加盟店の「人の番の名簿」を見る。機械(hs-hearing)が 3 回送って返事の無い店(needs_human)と、初回ヒアリング済みで 14 日以上返事の無い店を、名前と日数で出す。毎朝 06:17 JST の日次通知(LINE)に「人の番(電話する名簿)」として載る。cron を待たずに読むなら:

   curl -s -H "X-Admin-Key: ${HEARING_ADMIN_SECRET:?}" "https://hearing.horizonshield.dev/admin/roster" | python3 -c "import json,sys;print(json.load(sys.stdin)['text'])"

- 並んだ店には人が電話する。機械は 4 通目を書かん(設計)。返事が来てから /admin/unstick。
- 2026-09-15 の名簿: あっぷす(最終回答 8/29、10/1 運用開始)、ミネオトーヨー住器 No.002(最終回答 9/7)。
