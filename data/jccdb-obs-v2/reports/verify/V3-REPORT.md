# 独立検証 V3: JHNRD seed.24、hs-jccdb-obs v0.2 の SQL、改正ウォッチャーの見張り先(2026-09-26)

検証者は作った担当とは別。スクリプトと取った頁は verify/V3/(results.json ほか)。検証者の環境で .md が書けなかったため、この報告は番人が検証者の返答から起こした。

## 結論

1. JHNRD seed.24: 全件が通った。
   - quote は 284 件すべてが原本テキストにあり、数字の抜けは 0 件。
   - confirmed_basis に名前が出る資料は、すべて source_ref にある。
   - seed.23 から消えた項目・要件・出典は 0 件。更新した要件には previous に旧版がある。
   - effect を直した 2 項目(genzan-junkangoshi、kaigo-kihon-st)の値は、告示第19号の注1・注2・イの単位数と一致。
   - validate.py は緑、公開 MCP の試験は 72 件すべて通過。
   - 例外: seed.23 から持ち越した confirmed:true の 29 件に confirmed_basis が無い。そのうち 2 件(kanri-kyoka4-shinsetsu、kanri2-todokede-fuyo)は資料が mhlw-r8-houkan-st(agency)の1件だけで、「二つの資料の一致で確定」の掟に反する。
   - 小さな残り: 出典 mhlw-santei-kouzou-r8 の note が「准看護師 x98/100」のまま。kaigo-kihon-st に previous_source_ref が無い。
2. hs-jccdb-obs v0.2 の本番用 SQL: 全件が通った。
   - MANIFEST の sha256 は 209 ファイルすべて一致。
   - restricted の出典の値が入った行は 0。not_in_public_build の 4 出典の行、保留の obs_id はどちらも 0。
   - obs2 の 414,587 行は、observations/ の CSV の行数の合計と一致。
3. 改正ウォッチャー: 建設の list 16 件中 14 件が通った。text の 3 件は題名の確認が通った。
   - 東北(thr): 頁が frameset でリンクが 0 件。台帳の URL は枠の中の tanka.files/sheet001.htm にある。
   - Census VIP: 取り込みの元の URL(econ_getzippedfile/?programCode=VIP)が link_filter に合わない。
   - text の確かめ方が弱い: ウォッチャーは本文全体に title_must が含まれるかで判定していた。「厚生労働大臣が定める基準」は告示第19号・第127号・第67号・第94号・第96号、省令第37号の本文にも出てくるので、同じ URL が別の告示を返しても告示第95号と第94号では気づけない。

## 番人の対応(同日)

- JHNRD: 資料1件の 2 件を confirmed:false に下げ、理由を書いた(previous_confirmed: true を残した)。残り 27 件には、seed.23 以前に何を出典に確定したかを confirmed_basis に書き足した。出典の note に准看護師の率の注を足し、kaigo-kihon-st に previous_source_ref を足した。seed.20 の出典の題名にあった em ダッシュをハイフンにした。どれも add_seed24_20260926.py の中(seed.23 から作り直せば同じになる)。
- 改正ウォッチャー: 東北の見張り先を tanka.files/sheet001.htm に替えた(Apify で取り、R08_04_01tanka.pdf ほか 4 つの単価表のリンクがあることを確かめた)。Census VIP は頁の本文の変化で拾う text に替えた。text の題名は <title>(無ければ本文の先頭 400 字)で確かめ、title_must に告示の番号を入れた(第67号・第19号・第103号・第95号・第94号)。試験を 3 本足して 42/0。
