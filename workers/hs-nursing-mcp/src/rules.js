/* このファイルは生成物である。手で書き換えないこと。
   元         : JHNRD data/rules_2024.json
   元の版     : 2024-kaitei.seed.24
   中身の sha256: 95885608c84f58f6aa41875ffc2d602a2b2701bc88880c2eaa59792659078d47
   作り直す   : python3 tools/nursing/build_mcp_rules.py --write

   ここに数字を手で足さないこと。足しても JHNRD には戻らないので、
   公開データベースと内部MCPが別のことを言う状態になる。
   そのずれは落ちない。例外も出ない。ただ違う数字が出続ける。 */
export const SOURCE_SHA256 = "95885608c84f58f6aa41875ffc2d602a2b2701bc88880c2eaa59792659078d47";
export const RULES = {
  "version": "2024-kaitei.seed.24",
  "revision_label": "seed.24(2026-09-26): 令和8年6月施行の要件の本文に結んだ。医療は留意事項通知(保発0305第19号、4/2 訂正後)・施設基準(告示第75号)・届出通知(保医発0305第9号、7/30 訂正後)・現行の告示第103号・疑義解釈その1〜13、介護は告示第19号・第95号・第94号・第96号・老企第36号(全老健の統合版と厚労省の新旧対照表)・省令第37号・Q&A。requirements を 71 件更新、213 件追加(旧版の文言は previous に残した)。准看護師の率を直した(イ・ロは 100分の90、ハは 100分の98。seed.23 までは 98/100 をイ・ロにも当てていた)。訪問看護費の基本単位数を告示の本文で確定。secondary 二つの一致だけの 30 件と、資料が1件だけだった seed.23 の 2 件は confirmed:false に下げた。 seed.23(2026-09-26): 令和8年6月施行の訪問看護療養費(医療)を告示第74号(PDF)と法令等データベースの現行告示第67号の二つの statute で全額を突き合わせ(366個の並びが一致)、医療 18項目・介護 7項目を追加。介護は告示第19号・第127号の現行本文に初めて届き、算定構造(agency)の単位数の集合と一致した。既存の医療 5 項目を confirmed:true に上げた。設問 9 本を追加。 令和8年度改定(医療・介護とも令和8年6月施行)を現行とする。令和6年度改定で作った介護の6項目(業務継続計画未策定減算・高齢者虐待防止措置未実施減算・准看護師・PT/OT/ST・特別管理加算・ターミナルケア加算)を令和8へ当て直した(令和8は処遇改善のみの臨時改定につき据え置きを確認: mhlw-r8-minaoshi-an)。特別管理加算(旧+574→(Ⅰ)500/(Ⅱ)250)とターミナルケア加算(旧+2,000→2,500)の取り違えを訂正し、緊急時訪問看護加算に(Ⅰ)600/(Ⅱ)574の候補を入れた。訂正値の出典は二次資料3件で一致・告示原本照合は残課題として confirmed:false のまま残す。 seed.12(2026-08-24): 訪問看護への準用の条番号が 指定居宅サービス等基準 第七十四条 であることを告示第95号(statute)で確認した。緊急時訪問看護加算(Ⅰ)(Ⅱ)の分かれ目も告示の文言で確定した(単位数は依然 confirmed:false)。 seed.13(2026-08-24): 朝の時点で『現行の第七十四条が同じ範囲を定めているか未確認』としていた findings を、告示第95号で解決済みにした。同じ事実が三箇所にあるので、相互に名指しさせてある。 seed.14(2026-08-24): 令和8年6月施行の算定構造に1項目ずつ名指しして当たり、特別管理加算(Ⅰ)500/(Ⅱ)250・緊急時訪問看護加算600/574(病院診療所325/315)・ターミナルケア加算2,500単位を、外部の二次資料4件との一致をもって確定にした。特別管理加算の対象状態は告示第94号から、加算する日の運用は老企第36号から取った。読み取りの食い違いは解決。 seed.15(2026-08-24): 最後に残っていた食い違い(理学療法士等の減算幅)を解決した。『−97単位』は同じ表の訪問介護費の初回加算97単位の混入だった。正しくは1回294単位、条件つきで1回につき−8単位。294は名指し読み1件のみなので confirmed:false のまま残す。 seed.16(2026-08-24): サービス提供体制強化加算((Ⅰ)6/(Ⅱ)3)と初回加算((Ⅰ)350/(Ⅱ)300)を確定。訪問看護管理療養費(月2日目以降)の細分化後の各区分の額を入れたが、読み取りが改正後と改正前の欄を入れ替えたためconfirmed:false のまま残す。 seed.17(2026-08-24): PDFを生テキストに直して列の位置で読み直した。seed.15 に書いた『−97は訪問介護費の初回加算の混入』は誤りで、実際は同じ表の『医療保険の指示期間の日数につき減算(1日につき−97単位)』の列の値だった。訂正を追記した(消していない)。理学療法士等は 1回294単位・条件つき1回−8単位で確定。古くなった known_gaps 3件に解決済みの印をつけ、まだ入っていない5項目を新たに記録した。 seed.18(2026-08-24): 生テキストで二つの算定構造を並べたところ、『令和8は据え置き』という結論と噛み合わない差が見つかった(ハ2,954→2,961、病院診療所844、初回加算の区分、緊急時(Ⅰ))。食い違いとして残した。あわせて、表にあってDBに無かった3項目(医療保険の指示期間の日数につき−97単位/日、看護・介護職員連携強化加算+250単位、介護職員等処遇改善加算×18/1000)を追加し、サービス提供体制強化加算にハを算定する場合(+50/+25)を足した。 seed.19(2026-08-24): 食い違いを解いた。差は令和8ではなく、令和6年4月版と令和6年6月版の間のものだった(訪問看護は令和6年6月1日施行)。令和6年6月版の算定構造を出典に加え、令和6年4月版は訪問看護については改定前として current:false にした。あわせて『313は取り違え』『294は令和6と令和8の二資料で一致』という、こちらの誤った結論を訂正した。 seed.20(2026-08-25): 3日届かなかった省令第37号 第七十四条の条文本体を、e-Gov法令検索の条文APIから取得した(厚労省の t_doc は第六十条までしか載っていない)。ただし範囲指定が『第三十条から第三十四条まで、第三十五条から第三十八条まで』と不自然に分かれており、間に何も挟まないならこう書く理由がない。読み落としの疑いがあるので confirmed:false のまま残し、旧版の『第三十条から第三十九条まで』との差を食い違いとして記録した。結論(第三十条の二・第三十七条の二が準用されている)は告示第95号が名指ししているので動かない。 seed.21(2026-08-25): 看護体制強化加算(Ⅰ)(Ⅱ)の分かれ目が、老企第36号ではなく告示第95号にあることを突き止め、(Ⅰ)4つ・(Ⅱ)2つの基準を要件として入れた。ただし全て confirmed:false。同じ URL に mode=0 を足しただけで別の告示(第67号)が返り、二度目の読みが取れなかったためである。(Ⅱ)に特別管理加算の割合と看護職員の割合が課されるかどうかも、読み取れていない(detail_unconfirmed_2)。あわせて、記録されている URL で老企第36号の訪問看護費の節が現に取れることを確認した(全老健が載せている同名の通知は訪問介護費までで、別物である)。 seed.22(2026-08-25): 告示第95号の二つ目の読み方を探したが、見つからなかった。e-Gov 法令検索は告示を収録していない(省令第七十四条が取れたのと同じ手は使えない)。厚労省・WAM の検索でも、基準本文を載せた安定したURLは出ず、先頭に返ってくるのは二度読めない t_doc の同じURLだった。取れなかったことと、次に当たる先(都道府県の抜粋・官報)をattempts に書き足した。看護体制強化加算(Ⅱ)の2つの穴は、開いたままである。",
  "built_at": "2026-08-24",
  "revisions": [
    {
      "id": "r6-kaigo",
      "insurance": "介護",
      "name": "令和6年度介護報酬改定",
      "effective_from": "2024-04-01",
      "superseded_by": "r8-kaigo",
      "source_ref": [
        "mhlw-001195261"
      ]
    },
    {
      "id": "r6-iryo",
      "insurance": "医療",
      "name": "令和6年度診療報酬改定",
      "effective_from": "2024-06-01",
      "superseded_by": "r8-iryo",
      "source_ref": [
        "mhlw-r6-kokuji62",
        "mhlw-r6-hohatsu12"
      ]
    },
    {
      "id": "r8-kaigo",
      "insurance": "介護",
      "name": "令和8年度介護報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "source_ref": [
        "mhlw-r8-kaigo-index",
        "mhlw-santei-kouzou-r8"
      ]
    },
    {
      "id": "r8-iryo",
      "insurance": "医療",
      "name": "令和8年度診療報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "source_ref": [
        "mhlw-r8-houkan-st",
        "mhlw-santei-houhou-genko"
      ]
    }
  ],
  "sources": {
    "mhlw-001195261": {
      "title": "令和６年度介護報酬改定の主な事項について (社会保障審議会 介護給付費分科会 第239回 資料1)",
      "url": "https://www.mhlw.go.jp/content/12300000/001195261.pdf",
      "publisher": "厚生労働省 老健局",
      "tier": "agency",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-08-23"
    },
    "mhlw-001195509": {
      "title": "指定居宅サービス介護給付費単位数の算定構造 (3 訪問看護費)",
      "url": "https://www.mhlw.go.jp/content/12300000/001195509.pdf",
      "publisher": "厚生労働省",
      "tier": "agency",
      "current": false,
      "not_current_reason": "令和6年1月22日の社保審-介護給付費分科会 参考資料であり、示しているのは『令和6年4月改定箇所』である。訪問看護は令和6年6月1日施行のため、この表の訪問看護費は6月改定前の値を含む。実際に、基本単位数は 313/470/821/1,125(4月版) に対し 314/471/823/1,128(6月版以降)、ハ 定期巡回連携型は 2,954(4月版) に対し 2,961(6月版以降)、初回加算は区分なし300単位(4月版) に対し (Ⅰ)350/(Ⅱ)300(6月版以降)。訪問看護の現行値の根拠には使えない。他サービスや、6月に動かなかった項目については引き続き有効。",
      "retrieved_at": "2026-08-23"
    },
    "kaipoke-gyakutai": {
      "title": "訪問看護における高齢者虐待防止措置未実施減算とは？【2024年度改定対応】【介護保険】",
      "url": "https://houkan.kaipoke.biz/magazine/addition-subtraction/elderly-abuse-prevention.html",
      "publisher": "カイポケ訪問看護マガジン",
      "tier": "secondary",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-08-23"
    },
    "ibow-20240529": {
      "title": "2024年度訪問看護の報酬改定 減算項目・体制見直し事項",
      "url": "https://ewellibow.jp/useful/information20240529/",
      "publisher": "iBow お役立ち情報ポータルサイト",
      "tier": "secondary",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-08-23"
    },
    "kna-q6": {
      "title": "Q6【特別訪問看護指示書の交付要件について】",
      "url": "https://www.kna.or.jp/c2/q9",
      "publisher": "熊本県看護協会",
      "tier": "secondary",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-08-23"
    },
    "mhlw-shorei-h11-37": {
      "title": "指定居宅サービス等の事業の人員、設備及び運営に関する基準 (平成11年3月31日 厚生省令第37号)",
      "url": "https://www.mhlw.go.jp/web/t_doc?dataId=82999404&dataType=0&pageNo=1",
      "publisher": "厚生労働省",
      "tier": "statute",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-08-23"
    },
    "ipss-shorei-h11-37-old": {
      "title": "指定居宅サービス等の事業の人員、設備及び運営に関する基準 (平成11年3月31日 厚生省令第37号)",
      "url": "https://www.ipss.go.jp/publication/j/shiryou/no.13/data/shiryou/syakaifukushi/728.pdf",
      "publisher": "国立社会保障・人口問題研究所 (掲載)",
      "tier": "statute",
      "current": false,
      "not_current_reason": "改正日の記載が無く、第30条の2および第37条の2が存在しない。これらが加わる前の版である。準用の条番号を知る用途にのみ使える。",
      "retrieved_at": "2026-08-23"
    },
    "mhlw-r8-houkan-st": {
      "title": "令和8年度診療報酬改定について 【訪問看護ステーション向け】(令和8年3月10日版)",
      "url": "https://www.mhlw.go.jp/content/12400000/001671099.pdf",
      "publisher": "厚生労働省保険局医療課",
      "tier": "agency",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-08-24"
    },
    "mhlw-santei-kouzou-r8": {
      "title": "指定居宅サービス介護給付費単位数の算定構造(令和8年6月改定箇所入り) 3 訪問看護費",
      "url": "https://www.mhlw.go.jp/content/001675193.pdf",
      "publisher": "厚生労働省",
      "tier": "agency",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-08-24"
    },
    "mhlw-santei-houhou-genko": {
      "title": "訪問看護療養費に係る指定訪問看護の費用の額の算定方法(平成20年3月5日厚生労働省告示第67号・現行)",
      "url": "https://www.mhlw.go.jp/web/t_doc?dataId=84aa9734&dataType=0&pageNo=1",
      "publisher": "厚生労働省(法令等データベース)",
      "tier": "statute",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-09-26"
    },
    "mhlw-r8-kaigo-index": {
      "title": "令和8年度介護報酬改定について",
      "url": "https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000188411_00073.html",
      "publisher": "厚生労働省",
      "tier": "agency",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-08-24"
    },
    "mhlw-r6-kokuji62": {
      "title": "訪問看護療養費に係る指定訪問看護の費用の額の算定方法の一部を改正する件(令和6年厚生労働省告示第62号)",
      "url": "https://www.mhlw.go.jp/content/12404000/001241061.pdf",
      "publisher": "厚生労働省",
      "tier": "statute",
      "current": false,
      "not_current_reason": "令和8年度診療報酬改定(令和8年6月施行)で改正済み。実際に額が動いている(管理療養費 月初日 機能強化型1 13,230円 -> 13,760円 など)。令和6年度当時の額の根拠としては使えるが、現行の根拠には使えない。",
      "retrieved_at": "2026-08-24"
    },
    "mhlw-r6-hohatsu12": {
      "title": "訪問看護療養費に係る指定訪問看護の費用の額の算定方法の一部改正に伴う実施上の留意事項について(令和6年3月5日 保発0305第12号)",
      "url": "https://www.mhlw.go.jp/content/12404000/001241054.pdf",
      "publisher": "厚生労働省保険局長",
      "tier": "statute",
      "current": false,
      "not_current_reason": "令和8年度診療報酬改定(令和8年6月施行)に対応する通知が別に出ている。額に関する部分は現行の根拠には使えない。ただし特別訪問看護指示書14日・月1回(例外月2回)、訪問看護指示書の有効期間6か月は令和8年度版でも同じ運用が確認できているため、その部分は別途 current な出典と併記する。",
      "retrieved_at": "2026-08-24"
    },
    "mhlw-tokkei-beppyo7": {
      "title": "特掲診療料の施設基準等(平成20年3月5日厚生労働省告示第63号) 別表第七・別表第八",
      "url": "https://www.mhlw.go.jp/web/t_doc?dataId=84aa9733&dataType=0&pageNo=5",
      "publisher": "厚生労働省(法令等データベース)",
      "tier": "statute",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-08-24"
    },
    "kouseikyoku-kinki-r6-shudan": {
      "title": "令和6年度集団指導(訪問看護療養費等について)",
      "url": "https://kouseikyoku.mhlw.go.jp/kinki/000390876.pdf",
      "publisher": "近畿厚生局",
      "tier": "agency",
      "current": false,
      "not_current_reason": "令和6年度の集団指導資料。額は令和8年6月施行分と異なる。振り分けの原則(介護保険優先)と別表第七・特別訪問看護指示書の運用の説明としては使える。",
      "retrieved_at": "2026-08-24"
    },
    "mhlw-r8-minaoshi-an": {
      "title": "令和8年度介護報酬改定 介護報酬の見直し案 別紙1: 指定居宅サービスに要する費用の額の算定に関する基準【令和8年6月施行】(社保審-介護給付費分科会 第253回 諮問書別紙)",
      "url": "https://www.mhlw.go.jp/content/12300000/001633494.pdf",
      "publisher": "厚生労働省",
      "tier": "agency",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-08-24"
    },
    "ptotst-r6-houkan": {
      "title": "訪問看護(令和6年度介護報酬改定)",
      "url": "https://www.pt-ot-st.net/contents4/nursing-care-reiwa-6/?page_id=5735",
      "publisher": "PT-OT-ST.NET",
      "tier": "secondary",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-08-24"
    },
    "arukunpo-2026-kaigo": {
      "title": "2026年(令和8年)6月改定 訪問看護 介護保険の料金表まとめ",
      "url": "https://arukunpo.com/2026-6-1kaigo/",
      "publisher": "あるく報",
      "tier": "secondary",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-08-24"
    },
    "kango-repo-kasan-2026": {
      "title": "訪問看護 加算一覧【2026年改定対応】介護・医療保険の全加算",
      "url": "https://kango-repo.com/blog/houmon-kango-kasan-ichiran",
      "publisher": "看護レポ",
      "tier": "secondary",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-08-24"
    },
    "mhlw-kijun-kokuji95": {
      "title": "厚生労働大臣が定める基準(平成27年3月23日厚生労働省告示第95号)",
      "url": "https://www.mhlw.go.jp/web/t_doc?dataId=82ab4584&dataType=0&pageNo=1",
      "publisher": "厚生労働省(法令等データベース)",
      "tier": "statute",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-08-24"
    },
    "caretasukeru-kinkyuji": {
      "title": "【介護保険】緊急時訪問看護加算の算定要件と指導指摘事項",
      "url": "https://caretasukeru.com/care-insurance-law/calculation-requirements/add-on-requirements/11694/",
      "publisher": "けあタスケル",
      "tier": "secondary",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-08-24"
    },
    "mhlw-kokuji94-jotai": {
      "title": "厚生労働大臣が定める基準に適合する利用者等(平成27年3月23日厚生労働省告示第94号)",
      "url": "https://www.mhlw.go.jp/web/t_doc?dataId=82ab4583&dataType=0&pageNo=1",
      "publisher": "厚生労働省(法令等データベース)",
      "tier": "statute",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-08-24"
    },
    "mhlw-roki36": {
      "title": "指定居宅サービスに要する費用の額の算定に関する基準(訪問通所サービス及び居宅療養管理指導に係る部分)等の制定に伴う実施上の留意事項について(平成12年3月1日 老企第36号)",
      "url": "https://www.mhlw.go.jp/web/t_doc?dataId=00ta4378&dataType=1&pageNo=1",
      "publisher": "厚生労働省",
      "tier": "statute",
      "current": false,
      "not_current_reason": "同じ URL(t_doc 00ta4378)が返すのは平成12年制定時の本文(三級ヘルパーの語、4 訪問看護費は(1)〜(8)だけ)。現行の全文ではない(2026-09-26 N2 の読み)。現行は n2-roken-roki36(全老健の統合版、secondary)と厚労省の新旧対照表(n2-roki36-r6-shinkyu / n2-roki36-r8-shinkyu)で読む。",
      "retrieved_at": "2026-08-24"
    },
    "mhlw-r8-iryo-shinkyu": {
      "title": "別紙2 訪問看護療養費に係る指定訪問看護の費用の額の算定方法(傍線部分は改正部分) 改正後・改正前",
      "url": "https://www.mhlw.go.jp/content/10808000/001655181.pdf",
      "publisher": "厚生労働省",
      "tier": "statute",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-08-24"
    },
    "mhlw-santei-kouzou-r6june": {
      "title": "介護報酬の算定構造(介護サービス) ：令和6年6月改定箇所 Ⅰ 指定居宅サービス介護給付費単位数の算定構造 3 訪問看護費",
      "url": "https://www.wam.go.jp/gyoseiShiryou-files/documents/2024/0506103413612/20240507_002.pdf",
      "publisher": "厚生労働省(WAM NET 行政資料に掲載)",
      "tier": "agency",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-08-24"
    },
    "egov-shorei-h11-37-art74": {
      "title": "指定居宅サービス等の事業の人員、設備及び運営に関する基準 第七十四条(準用) - e-Gov法令検索 条文API",
      "url": "https://laws.e-gov.go.jp/api/1/articles;lawId=411M50000100037;article=74",
      "publisher": "デジタル庁 e-Gov法令検索",
      "tier": "statute",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-08-25"
    },
    "mhlw-r8-kokuji74": {
      "title": "訪問看護療養費に係る指定訪問看護の費用の額の算定方法の一部を改正する件(令和8年厚生労働省告示第74号)",
      "url": "https://www.mhlw.go.jp/content/12400000/001665206.pdf",
      "publisher": "厚生労働省",
      "tier": "statute",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-09-26"
    },
    "mhlw-kokuji19-genko": {
      "title": "指定居宅サービスに要する費用の額の算定に関する基準(平成12年厚生省告示第19号・現行) 別表 3 訪問看護費",
      "url": "https://www.mhlw.go.jp/web/t_doc?dataId=82aa0253&dataType=0&pageNo=1",
      "publisher": "厚生労働省(法令等データベース)",
      "tier": "statute",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-09-26"
    },
    "mhlw-kokuji127-genko": {
      "title": "指定介護予防サービスに要する費用の額の算定に関する基準(平成18年厚生労働省告示第127号・現行) 別表 2 介護予防訪問看護費",
      "url": "https://www.mhlw.go.jp/web/t_doc?dataId=82aa7863&dataType=0&pageNo=1",
      "publisher": "厚生労働省(法令等データベース)",
      "tier": "statute",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-09-26"
    },
    "mhlw-r8-hohatsu0305-19": {
      "title": "訪問看護療養費に係る指定訪問看護の費用の額の算定方法の一部改正に伴う実施上の留意事項について",
      "url": "https://www.mhlw.go.jp/content/12400000/001686845.pdf",
      "publisher": "厚生労働省保険局長",
      "tier": "statute",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-09-26"
    },
    "mhlw-r8-kokuji75": {
      "title": "訪問看護療養費に係る訪問看護ステーションの基準等の一部を改正する件(令和8年厚生労働省告示第75号)",
      "url": "https://www.mhlw.go.jp/content/12400000/001665207.pdf",
      "publisher": "厚生労働省",
      "tier": "statute",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-09-26"
    },
    "mhlw-r8-hoihatsu0305-9": {
      "title": "訪問看護ステーションの基準に係る届出に関する手続きの取扱いについて",
      "url": "https://www.mhlw.go.jp/content/12400000/001732114.pdf",
      "publisher": "厚生労働省保険局医療課長",
      "tier": "statute",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-09-26"
    },
    "mhlw-kokuji103-genko": {
      "title": "訪問看護療養費に係る訪問看護ステーションの基準等(平成18年3月6日厚生労働省告示第103号・現行)",
      "url": "https://www.mhlw.go.jp/web/t_doc?dataId=84aa7834&dataType=0&pageNo=1",
      "publisher": "厚生労働省(法令等データベース)",
      "tier": "statute",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-09-26"
    },
    "mhlw-r8-hoihatsu0327-10": {
      "title": "訪問看護計画書等の記載要領等について",
      "url": "https://www.mhlw.go.jp/content/12400000/001681763.pdf",
      "publisher": "厚生労働省保険局医療課長",
      "tier": "statute",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-09-26"
    },
    "mhlw-r8-gigi-01": {
      "title": "疑義解釈資料の送付について（その１）",
      "url": "https://www.mhlw.go.jp/content/12400000/001678310.pdf",
      "publisher": "厚生労働省保険局医療課",
      "tier": "agency",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-09-26"
    },
    "mhlw-r8-gigi-02": {
      "title": "疑義解釈資料の送付について（その２）",
      "url": "https://www.mhlw.go.jp/content/12400000/001689076.pdf",
      "publisher": "厚生労働省保険局医療課",
      "tier": "agency",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-09-26"
    },
    "mhlw-r8-gigi-03": {
      "title": "疑義解釈資料の送付について（その３）",
      "url": "https://www.mhlw.go.jp/content/12400000/001693874.pdf",
      "publisher": "厚生労働省保険局医療課",
      "tier": "agency",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-09-26"
    },
    "mhlw-r8-gigi-04": {
      "title": "疑義解釈資料の送付について（その４）",
      "url": "https://www.mhlw.go.jp/content/12400000/001694332.pdf",
      "publisher": "厚生労働省保険局医療課",
      "tier": "agency",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-09-26"
    },
    "mhlw-r8-gigi-05": {
      "title": "疑義解釈資料の送付について（その５）",
      "url": "https://www.mhlw.go.jp/content/12400000/001698587.pdf",
      "publisher": "厚生労働省保険局医療課",
      "tier": "agency",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-09-26"
    },
    "mhlw-r8-gigi-06": {
      "title": "疑義解釈資料の送付について（その６）",
      "url": "https://www.mhlw.go.jp/content/12400000/001703573.pdf",
      "publisher": "厚生労働省保険局医療課",
      "tier": "agency",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-09-26"
    },
    "mhlw-r8-gigi-07": {
      "title": "疑義解釈資料の送付について（その７）",
      "url": "https://www.mhlw.go.jp/content/12400000/001707505.pdf",
      "publisher": "厚生労働省保険局医療課",
      "tier": "agency",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-09-26"
    },
    "mhlw-r8-gigi-08": {
      "title": "疑義解釈資料の送付について（その８）",
      "url": "https://www.mhlw.go.jp/content/12400000/001712853.pdf",
      "publisher": "厚生労働省保険局医療課",
      "tier": "agency",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-09-26"
    },
    "mhlw-r8-gigi-09": {
      "title": "疑義解釈資料の送付について（その９）",
      "url": "https://www.mhlw.go.jp/content/12400000/001716069.pdf",
      "publisher": "厚生労働省保険局医療課",
      "tier": "agency",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-09-26"
    },
    "mhlw-r8-gigi-10": {
      "title": "疑義解釈資料の送付について（その10）",
      "url": "https://www.mhlw.go.jp/content/12400000/001725624.pdf",
      "publisher": "厚生労働省保険局医療課",
      "tier": "agency",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-09-26"
    },
    "mhlw-r8-gigi-11": {
      "title": "疑義解釈資料の送付について（その11）",
      "url": "https://www.mhlw.go.jp/content/12400000/001731253.pdf",
      "publisher": "厚生労働省保険局医療課",
      "tier": "agency",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-09-26"
    },
    "mhlw-r8-gigi-12": {
      "title": "疑義解釈資料の送付について（その12）",
      "url": "https://www.mhlw.go.jp/content/12400000/001744953.pdf",
      "publisher": "厚生労働省保険局医療課",
      "tier": "agency",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-09-26"
    },
    "mhlw-r8-gigi-13": {
      "title": "疑義解釈資料の送付について（その13）",
      "url": "https://www.mhlw.go.jp/content/12400000/001752608.pdf",
      "publisher": "厚生労働省保険局医療課",
      "tier": "agency",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-09-26"
    },
    "mhlw-r8-gigi-02-teisei": {
      "title": "「疑義解釈資料の送付について（その２）」の一部訂正について",
      "url": "https://www.mhlw.go.jp/content/12400000/001689078.pdf",
      "publisher": "厚生労働省保険局医療課",
      "tier": "agency",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-09-26"
    },
    "mhlw-r8-teisei-0402": {
      "title": "令和８年度診療報酬改定関連通知及び官報掲載事項の一部訂正について",
      "url": "https://www.mhlw.go.jp/content/12400000/001698334.pdf",
      "publisher": "厚生労働省保険局医療課",
      "tier": "agency",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-09-26"
    },
    "mhlw-r8-index": {
      "title": "令和８年度診療報酬改定について｜厚生労働省",
      "url": "https://www.mhlw.go.jp/stf/newpage_67729.html",
      "publisher": "厚生労働省",
      "tier": "agency",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-09-26"
    },
    "zenhokan-r8-matome": {
      "title": "令和８年度診療報酬改定まとめ（9/25更新）",
      "url": "https://www.zenhokan.or.jp/new/new2753/",
      "publisher": "一般社団法人全国訪問看護事業協会",
      "tier": "secondary",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-09-26"
    },
    "n2-kokuji95-tdoc": {
      "title": "厚生労働大臣が定める基準(◆平成27年03月23日厚生労働省告示第95号)",
      "url": "https://www.mhlw.go.jp/web/t_doc?dataId=82ab4584&dataType=0&pageNo=1",
      "publisher": "厚生労働省(法令等データベース)",
      "tier": "statute",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-09-26"
    },
    "n2-roken-kokuji95": {
      "title": "厚生労働大臣が定める基準 ー 厚生労働省告示第95号 | 告示 | 22 | 法令・Q&A検索システム 全老健介護保険制度情報サービス",
      "url": "https://hourei.roken.or.jp/detail.php?uid=22",
      "publisher": "公益社団法人 全国老人保健施設協会",
      "tier": "secondary",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-09-26"
    },
    "n2-kokuji94-tdoc": {
      "title": "厚生労働大臣が定める基準に適合する利用者等(◆平成27年03月23日厚生労働省告示第94号)",
      "url": "https://www.mhlw.go.jp/web/t_doc?dataId=82ab4583&dataType=0&pageNo=1",
      "publisher": "厚生労働省(法令等データベース)",
      "tier": "statute",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-09-26"
    },
    "n2-roken-kokuji94": {
      "title": "厚生労働大臣が定める基準に適合する利用者等 ー 厚生労働省告示第94号 | 告示 | 14 | 法令・Q&A検索システム 全老健介護保険制度情報サービス",
      "url": "https://hourei.roken.or.jp/detail.php?uid=14",
      "publisher": "公益社団法人 全国老人保健施設協会",
      "tier": "secondary",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-09-26"
    },
    "n2-kokuji96-tdoc": {
      "title": "厚生労働大臣が定める施設基準(◆平成27年03月23日厚生労働省告示第96号)",
      "url": "https://www.mhlw.go.jp/web/t_doc?dataId=82ab4585&dataType=0&pageNo=1",
      "publisher": "厚生労働省(法令等データベース)",
      "tier": "statute",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-09-26"
    },
    "n2-roken-kokuji96": {
      "title": "厚生労働大臣が定める施設基準 ー 厚生労働省告示第96号 | 告示 | 7 | 法令・Q&A検索システム 全老健介護保険制度情報サービス",
      "url": "https://hourei.roken.or.jp/detail.php?uid=7",
      "publisher": "公益社団法人 全国老人保健施設協会",
      "tier": "secondary",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-09-26"
    },
    "n2-roken-kokuji19": {
      "title": "指定居宅サービスに要する費用の額の算定に関する基準 ー 厚生省告示第19号 | 告示 | 11 | 法令・Q&A検索システム 全老健介護保険制度情報サービス",
      "url": "https://hourei.roken.or.jp/detail.php?uid=11",
      "publisher": "公益社団法人 全国老人保健施設協会",
      "tier": "secondary",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-09-26"
    },
    "n2-roken-kokuji127": {
      "title": "指定介護予防サービスに要する費用の額の算定に関する基準 ー 厚生労働省告示第127号 | 告示 | 10 | 法令・Q&A検索システム 全老健介護保険制度情報サービス",
      "url": "https://hourei.roken.or.jp/detail.php?uid=10",
      "publisher": "公益社団法人 全国老人保健施設協会",
      "tier": "secondary",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-09-26"
    },
    "n2-egov-shorei37": {
      "title": "指定居宅サービス等の事業の人員、設備及び運営に関する基準(平成十一年厚生省令第三十七号)",
      "url": "https://laws.e-gov.go.jp/api/2/law_data/411M50000100037",
      "publisher": "デジタル庁 e-Gov 法令検索(法令API v2 law_data)",
      "tier": "statute",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-09-26"
    },
    "n2-shorei37-tdoc": {
      "title": "指定居宅サービス等の事業の人員、設備及び運営に関する基準(◆平成11年03月31日厚生省令第37号)",
      "url": "https://www.mhlw.go.jp/web/t_doc?dataId=82999404&dataType=0&pageNo=1",
      "publisher": "厚生労働省(法令等データベース)",
      "tier": "statute",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-09-26"
    },
    "n2-roki36-tdoc-h12": {
      "title": "指定居宅サービスに要する費用の額の算定に関する基準(訪問通所サービス及び居宅療養管理指導に係る部分)及び指定居宅介護支援に要する費用の額の算定に関する基準の制定に伴う実施上の留意事項について(◆平成12年03月01日老企第36号)",
      "url": "https://www.mhlw.go.jp/web/t_doc?dataId=00ta4378&dataType=1&pageNo=1",
      "publisher": "厚生労働省(法令等データベース)",
      "tier": "statute",
      "current": false,
      "not_current_reason": "Apify web-fetch(formats=[\"raw\"])で HTML を取得し、get-dataset-items の保存結果を apify_raw_to_file.py で復元(bytes/sha256 は復元した HTML)。<rt>(ルビの読み仮名)を除いてタグを外し、テキストにした。同じ dataId で別の法令が返ることがあるので、<title> と本文冒頭の題名で同定した。 本文に「三級ヘルパー」「痴呆対応型共同生活介護」があり、4 訪問看護費は(1)～(8)だけ。改正を反映していない制定時の本文である。既存の出典 mhlw-roki36(同じ URL)は current:true になっているが、現行ではない(conflicts 参照)。",
      "retrieved_at": "2026-09-26"
    },
    "n2-roki36-r6-shinkyu": {
      "title": "別紙１ ○ 指定居宅サービスに要する費用の額の算定に関する基準（訪問通所サービス、居宅療養管理指導及び福祉用具貸与に係る部分）及び指定居宅介護支援に要する費用の額の算定に関する基準の制定に伴う実施上の留意事項について（平成12年３月１日老企第36号厚生省老人保健福祉局企画課長通知）（抄） 新旧対照表",
      "url": "https://www.mhlw.go.jp/content/12300000/001227887.pdf",
      "publisher": "厚生労働省老健局",
      "tier": "statute",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-09-26"
    },
    "n2-roki36-r8-shinkyu": {
      "title": "○ 指定居宅サービスに要する費用の額の算定に関する基準（訪問通所サービス、居宅療養管理指導及び福祉用具貸与に係る部分）及び指定居宅介護支援に要する費用の額の算定に関する基準の制定に伴う実施上の留意事項について（平成12年３月１日老企第36号厚生省老人保健福祉局企画課長通知）（抄） 新旧対照表(令和8年度介護報酬改定)",
      "url": "https://www.mhlw.go.jp/content/12404000/001682729.pdf",
      "publisher": "厚生労働省老健局",
      "tier": "statute",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-09-26"
    },
    "n2-roken-roki36": {
      "title": "指定居宅サービスに要する費用の額の算定に関する基準（訪問通所サービス、居宅療養管理指導及び福祉用具貸与に係る部分）及び指定居宅介護支援に要する費用の額の算定に関する基準の制定に伴う実施上の留意事項について ー 老企第36号 | 通知 | 17 | 法令・Q&A検索システム 全老健介護保険制度情報サービス",
      "url": "https://hourei.roken.or.jp/detail.php?uid=17",
      "publisher": "公益社団法人 全国老人保健施設協会",
      "tier": "secondary",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-09-26"
    },
    "n2-roken-roki25": {
      "title": "指定居宅サービス等及び指定介護予防サービス等に関する基準について ー 老企第25号 | 通知 | 19 | 法令・Q&A検索システム 全老健介護保険制度情報サービス",
      "url": "https://hourei.roken.or.jp/detail.php?uid=19",
      "publisher": "公益社団法人 全国老人保健施設協会",
      "tier": "secondary",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-09-26"
    },
    "n2-hyogo-tebiki-r6": {
      "title": "訪問看護・介護予防訪問看護の手引き 令和６年６月 兵庫県",
      "url": "https://web.pref.hyogo.lg.jp/kf27/documents/houmonkango.pdf",
      "publisher": "兵庫県",
      "tier": "secondary",
      "current": false,
      "not_current_reason": "Apify web-fetch(formats=[\"raw\"])で PDF を取得し apify_raw_to_file.py で復元。pdftotext -layout で頁ごとに読み、頁番号だけの行を除いた。quote は改行と字間の空白を除いて連結した(文字は変えていない)。 86頁。告示・留意事項通知・Q&A を転載している。都道府県の資料で厚労省の資料ではないので tier は secondary。令和6年6月時点の版で、令和8年の改正(処遇改善加算)を含まないので current:false。文言の二度目の読みとしてだけ使った。転載の際の書き換え(訪問介護→訪問看護、注の番号の違い、附則の条番号の違い)があり、conflicts に書いた。",
      "retrieved_at": "2026-09-26"
    },
    "n2-r6-qa-vol1": {
      "title": "令和６年度介護報酬改定に関するＱ＆Ａ（Vol.１）（令和６年３月15日）",
      "url": "https://www.mhlw.go.jp/content/12300000/001230308.pdf",
      "publisher": "厚生労働省老健局老人保健課・高齢者支援課・認知症施策・地域介護推進課(事務連絡)",
      "tier": "agency",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-09-26"
    },
    "n2-r8-shogu-qa1": {
      "title": "「介護職員等処遇改善加算に関するＱ＆Ａ（第１版）」の送付について",
      "url": "https://www.mhlw.go.jp/content/12404000/001675711.pdf",
      "publisher": "厚生労働省老健局老人保健課(事務連絡)",
      "tier": "agency",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-09-26"
    },
    "n2-r8-kokuji87": {
      "title": "指定居宅サービスに要する費用の額の算定に関する基準等の一部を改正する告示(令和8年厚生労働省告示第87号)",
      "url": "https://www.mhlw.go.jp/content/12404000/001675895.pdf",
      "publisher": "厚生労働省",
      "tier": "statute",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-09-26"
    }
  },
  "items": [
    {
      "id": "genzan-bcp",
      "kind": "減算",
      "insurance": "介護",
      "name": "業務継続計画未策定減算",
      "effect": {
        "type": "率",
        "value": "その他のサービス(訪問看護を含む) 所定単位数の100分の1に相当する単位数を減算",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-001195261",
          "mhlw-r8-minaoshi-an"
        ]
      },
      "revision": "r8-kaigo",
      "revision_name": "令和8年度介護報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "bcp-plan",
          "text": "感染症や非常災害の発生時において、利用者に対する指定訪問介護の提供を継続的に実施するための、及び非常時の体制で早期の業務再開を図るための計画(以下「業務継続計画」という。)を策定し、当該業務継続計画に従い必要な措置を講じなければならない。",
          "ask": "q_nv_bcp_plan",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-shorei37-tdoc",
            "n2-egov-shorei37",
            "n2-kokuji95-tdoc"
          ]
        },
        {
          "kind": "requirements",
          "id": "bcp-plan-d",
          "text": "感染症若しくは災害のいずれか又は両方の業務継続計画が未策定の場合、かつ、当該業務継続計画に従い必要な措置が講じられていない場合に減算の対象となる。",
          "ask": "q_nv_bcp_plan",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-r6-qa-vol1",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "bcp-train",
          "text": "訪問介護員等に対し、業務継続計画について周知するとともに、必要な研修及び訓練を定期的に実施しなければならない。",
          "ask": "q_nv_bcp_train",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-shorei37-tdoc",
            "n2-egov-shorei37",
            "n2-r6-qa-vol1"
          ]
        },
        {
          "kind": "requirements",
          "id": "bcp-stock",
          "text": "平時からの備え（体制構築・整備、感染症防止に向けた取組の実施、備蓄品の確保等）",
          "ask": "q_nv_bcp_stock",
          "confirmed": false,
          "unconfirmed_reason": "一致したのは二つの secondary(全老健の統合版と兵庫県の手引)だけ。老企第36号のこの箇所は令和6年の新旧対照表で(略)とされ、厚労省の原文とは照合できていない。discipline の『二つの資料の一致』には数えない(2026-09-26 番人)。",
          "source_ref": [
            "n2-roken-roki25",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "bcp-review",
          "text": "定期的に業務継続計画の見直しを行い、必要に応じて業務継続計画の変更を行うものとする。",
          "ask": "q_nv_bcp_plan",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-shorei37-tdoc",
            "n2-egov-shorei37",
            "n2-r6-qa-vol1"
          ]
        },
        {
          "kind": "requirements",
          "id": "bcp-genzan-scope",
          "text": "業務継続計画の周知、研修、訓練及び定期的な業務継続計画の見直しの実施の有無は、業務継続計画未策定減算の算定要件ではない。",
          "ask": "q_nv_bcp_train",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-r6-qa-vol1",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "bcp-kikan",
          "text": "その翌月（基準を満たさない事実が生じた日が月の初日である場合は当該月）から基準を満たない状況が解消されるに至った月まで、当該事業所の利用者全員について、所定単位数から減算することとする。",
          "ask": "q_nv_bcp_plan",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-roki36-r6-shinkyu",
            "n2-roken-roki36",
            "n2-roki36-r8-shinkyu"
          ]
        },
        {
          "kind": "requirements",
          "id": "bcp-keika",
          "text": "経過措置として、令和７年３月31日までの間、当該減算は適用しないが、義務となっていることを踏まえ、速やかに作成すること。",
          "ask": "q_nv_bcp_plan",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-roki36-r6-shinkyu",
            "n2-roken-roki36",
            "n2-r6-qa-vol1"
          ]
        },
        {
          "kind": "requirements",
          "id": "bcp-sokyu",
          "text": "「基準を満たさない事実が生じた時点」まで遡及して減算を適用することとなる。",
          "ask": "q_nv_bcp_plan",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-r6-qa-vol1",
            "n2-hyogo-tebiki-r6"
          ]
        }
      ],
      "we_do_not_say": "この減算に該当します、とは言わない。要件のどれが未確認かを示すところまで。",
      "sources": [
        "mhlw-shorei-h11-37",
        "mhlw-001195261",
        "ibow-20240529",
        "n2-shorei37-tdoc",
        "n2-egov-shorei37",
        "n2-kokuji95-tdoc",
        "n2-r6-qa-vol1",
        "n2-hyogo-tebiki-r6",
        "n2-roken-roki25",
        "n2-roki36-r6-shinkyu",
        "n2-roken-roki36",
        "n2-roki36-r8-shinkyu"
      ],
      "beppyo7": null
    },
    {
      "id": "genzan-gyakutai",
      "kind": "減算",
      "insurance": "介護",
      "name": "高齢者虐待防止措置未実施減算",
      "effect": {
        "type": "率",
        "value": "所定単位数の100分の1に相当する単位数を減算",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-001195261",
          "kaipoke-gyakutai",
          "mhlw-r8-minaoshi-an"
        ]
      },
      "revision": "r8-kaigo",
      "revision_name": "令和8年度介護報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "gy-committee",
          "text": "当該指定訪問介護事業所における虐待の防止のための対策を検討する委員会(テレビ電話装置等を活用して行うことができるものとする。)を定期的に開催するとともに、その結果について、訪問介護員等に周知徹底を図ること。",
          "ask": "q_nv_gy_committee",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-shorei37-tdoc",
            "n2-egov-shorei37",
            "n2-kokuji95-tdoc"
          ]
        },
        {
          "kind": "requirements",
          "id": "gy-policy",
          "text": "当該指定訪問介護事業所における虐待の防止のための指針を整備すること。",
          "ask": "q_nv_gy_policy",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-shorei37-tdoc",
            "n2-egov-shorei37",
            "n2-kokuji95-tdoc"
          ]
        },
        {
          "kind": "requirements",
          "id": "gy-training",
          "text": "当該指定訪問介護事業所において、訪問介護員等に対し、虐待の防止のための研修を定期的に実施すること。",
          "ask": "q_nv_gy_training",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-shorei37-tdoc",
            "n2-egov-shorei37",
            "n2-kokuji95-tdoc"
          ]
        },
        {
          "kind": "requirements",
          "id": "gy-officer",
          "text": "前三号に掲げる措置を適切に実施するための担当者を置くこと。",
          "ask": "q_nv_gy_officer",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-shorei37-tdoc",
            "n2-egov-shorei37",
            "n2-kokuji95-tdoc"
          ]
        },
        {
          "kind": "requirements",
          "id": "gy-nen1",
          "text": "高齢者虐待防止のための年１回以上の研修を実施していない",
          "ask": "q_nv_gy_training",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-roki36-r6-shinkyu",
            "n2-roken-roki36",
            "n2-roki36-r8-shinkyu"
          ]
        },
        {
          "kind": "requirements",
          "id": "gy-kaizen",
          "text": "速やかに改善計画を都道府県知事に提出した後、事実が生じた月から３月後に改善計画に基づく改善状況を都道府県知事に報告することとし",
          "ask": "q_nv_gy_committee",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-roki36-r6-shinkyu",
            "n2-roken-roki36"
          ]
        },
        {
          "kind": "requirements",
          "id": "gy-kikan",
          "text": "事実が生じた月の翌月から改善が認められた月までの間について、利用者全員について所定単位数から減算することとする。",
          "ask": "q_nv_gy_committee",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-roki36-r6-shinkyu",
            "n2-roken-roki36"
          ]
        },
        {
          "kind": "requirements",
          "id": "gy-any-one",
          "text": "全ての措置の一つでも講じられていなければ減算となることに留意すること。",
          "ask": "q_nv_gy_committee",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-r6-qa-vol1",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "gy-no-sokyu",
          "text": "過去に遡及して当該減算を適用することはできず、発見した日の属する月が「事実が生じた月」となる。",
          "ask": "q_nv_gy_committee",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-r6-qa-vol1",
            "n2-hyogo-tebiki-r6"
          ]
        }
      ],
      "we_do_not_say": "該当・非該当の判定はしない。4つの措置それぞれの状態を並べるところまで。",
      "sources": [
        "mhlw-shorei-h11-37",
        "mhlw-001195261",
        "kaipoke-gyakutai",
        "ibow-20240529",
        "n2-shorei37-tdoc",
        "n2-egov-shorei37",
        "n2-kokuji95-tdoc",
        "n2-roki36-r6-shinkyu",
        "n2-roken-roki36",
        "n2-roki36-r8-shinkyu",
        "n2-r6-qa-vol1",
        "n2-hyogo-tebiki-r6"
      ],
      "beppyo7": null
    },
    {
      "id": "genzan-junkangoshi",
      "kind": "減算",
      "insurance": "介護",
      "name": "准看護師による指定訪問看護",
      "effect": {
        "type": "率",
        "value": "イ(指定訪問看護ステーション)及びロ(病院又は診療所): 准看護師が指定訪問看護を行った場合は、所定単位数の100分の90に相当する単位数を算定する(告示第19号 別表3 注1)。ハ(定期巡回・随時対応型訪問介護看護事業所と連携する場合): 所定単位数の100分の98に相当する単位数を算定する(注2)。",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-kokuji19-genko",
          "n2-roken-kokuji19"
        ]
      },
      "revision": "r8-kaigo",
      "revision_name": "令和8年度介護報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "jk-staff",
          "text": "准看護師が指定訪問看護を行った場合は、所定単位数の100分の90に相当する単位数を算定する。",
          "ask": "q_nv_staff",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-kokuji19-genko",
            "mhlw-santei-kouzou-r8",
            "n2-roken-roki36",
            "n2-roken-kokuji19"
          ]
        },
        {
          "kind": "requirements",
          "id": "jk-ha-98",
          "text": "准看護師が指定訪問看護を行った場合は、所定単位数の100分の98に相当する単位数を算定する。",
          "ask": "q_nv_staff",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-kokuji19-genko",
            "mhlw-santei-kouzou-r8",
            "n2-roken-kokuji19"
          ]
        },
        {
          "kind": "requirements",
          "id": "jk-keikaku",
          "text": "居宅サービス計画上、保健師又は看護師が訪問することとされている場合に、事業所の事情により保健師又は看護師ではなく准看護師が訪問する場合については、准看護師が訪問する場合の単位数(所定単位数の100分の90)を算定すること。",
          "ask": "q_nv_staff",
          "confirmed": false,
          "unconfirmed_reason": "一致したのは二つの secondary(全老健の統合版と兵庫県の手引)だけ。老企第36号のこの箇所は令和6年の新旧対照表で(略)とされ、厚労省の原文とは照合できていない。discipline の『二つの資料の一致』には数えない(2026-09-26 番人)。",
          "source_ref": [
            "n2-roken-roki36",
            "n2-hyogo-tebiki-r6"
          ]
        }
      ],
      "we_do_not_say": "請求額がいくら下がるとは言わない。該当する訪問があるかどうかを見るところまで。",
      "sources": [
        "mhlw-001195509",
        "mhlw-kokuji19-genko",
        "mhlw-santei-kouzou-r8",
        "n2-roken-roki36",
        "n2-roken-kokuji19",
        "n2-hyogo-tebiki-r6"
      ],
      "beppyo7": null
    },
    {
      "id": "pt-ot-st",
      "kind": "単位数",
      "insurance": "介護",
      "name": "理学療法士・作業療法士・言語聴覚士による訪問看護",
      "effect": {
        "type": "単位",
        "value": "理学療法士・作業療法士・言語聴覚士による訪問看護 1回につき 294単位。理学療法士等の訪問回数が看護職員の訪問回数を超えている場合、または特定の加算を算定していない場合は、1回につき −8単位。",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-001195509",
          "mhlw-r8-minaoshi-an",
          "mhlw-santei-kouzou-r8",
          "ibow-20240529",
          "mhlw-santei-kouzou-r6june"
        ]
      },
      "revision": "r8-kaigo",
      "revision_name": "令和8年度介護報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "pt-staff",
          "text": "理学療法士、作業療法士又は言語聴覚士(以下この注において「理学療法士等」という。)が指定訪問看護を行った場合は、イ(5)の所定単位数を算定することとし",
          "ask": "q_nv_staff",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-kokuji19-genko",
            "mhlw-santei-kouzou-r8",
            "n2-roken-kokuji19",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "pt-8tan",
          "text": "イ(5)について、別に厚生労働大臣が定める施設基準に該当する指定訪問看護事業所については、1回につき8単位を所定単位数から減算する。",
          "ask": "q_nv_pt_kaisu",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-kokuji19-genko",
            "mhlw-santei-kouzou-r8",
            "n2-roken-kokuji19",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "pt-8tan-kaisu",
          "text": "当該訪問看護事業所における前年の４月から当該年の３月までの期間の理学療法士等による訪問回数が看護職員による訪問回数を超えている場合は、当該年度の理学療法士等の訪問看護費から８単位を減算する。",
          "ask": "q_nv_pt_kaisu",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-roki36-r6-shinkyu",
            "n2-roken-roki36"
          ]
        },
        {
          "kind": "requirements",
          "id": "pt-8tan-kasan",
          "text": "算定日が属する月の前６月間において、緊急時訪問看護加算(Ⅰ)、緊急時訪問看護加算(Ⅱ)、特別管理加算(Ⅰ)、特別管理加算(Ⅱ)、看護体制強化加算(Ⅰ)及び看護体制強化加算(Ⅱ)のいずれも算定していない場合は、理学療法士等の訪問看護費から８単位を減算する。",
          "ask": "q_nv_kasan",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-roki36-r6-shinkyu",
            "n2-roken-roki36"
          ]
        },
        {
          "kind": "requirements",
          "id": "pt-qa-kaisu",
          "text": "理学療法士等が連続して２回の訪問を行った場合は、１回と数える。",
          "ask": "q_nv_pt_kaisu",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-r6-qa-vol1",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "pt-20pun-6kai",
          "text": "1回当たり20分以上訪問看護を実施することとし、1人の利用者につき週に6回を限度として算定する。",
          "ask": "q_nv_staff",
          "confirmed": false,
          "unconfirmed_reason": "一致を確かめられたのは 老企第36号(全老健の現行統合版) の1資料だけ。老企第36号 第2の4(4)② は令和6年の新旧対照表で（略）とされ、厚労省の原文(令和3年以前の新旧対照表)に当たれていない。兵庫県の手引にも同じ文字列が見つからなかった。",
          "source_ref": [
            "n2-roken-roki36"
          ]
        },
        {
          "kind": "requirements",
          "id": "pt-teiki-hyoka",
          "text": "計画書及び報告書の作成にあたっては、訪問看護サービスの利用開始時及び利用者の状態の変化等に合わせ、定期的な看護職員による訪問により利用者の状態の適切な評価を行うこと。",
          "ask": "q_nv_staff",
          "confirmed": false,
          "unconfirmed_reason": "一致を確かめられたのは 老企第36号(全老健の現行統合版) の1資料だけ。老企第36号 第2の4(4)⑥ は令和6年の新旧対照表で（略）。厚労省の原文に当たれていない。兵庫県の手引にも同じ文字列が見つからなかった。",
          "source_ref": [
            "n2-roken-roki36"
          ]
        },
        {
          "kind": "requirements",
          "id": "pt-8tan-kijun",
          "text": "次に掲げる基準のいずれかに該当すること。\nイ　当該訪問看護事業所における前年度の理学療法士、作業療法士又は言語聴覚士による訪問回数が、看護職員による訪問回数を超えていること。\nロ　緊急時訪問看護加算、特別管理加算及び看護体制強化加算のいずれも算定していないこと。",
          "ask": "q_nv_pt_kaisu",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-kokuji96-tdoc",
            "n2-roken-kokuji96"
          ]
        }
      ],
      "we_do_not_say": "この食い違いが解けるまで、この項目の数字を根拠にした案内は出さない。",
      "sources": [
        "mhlw-001195509",
        "ibow-20240529",
        "mhlw-kokuji19-genko",
        "mhlw-santei-kouzou-r8",
        "n2-roken-kokuji19",
        "n2-hyogo-tebiki-r6",
        "n2-roki36-r6-shinkyu",
        "n2-roken-roki36",
        "n2-r6-qa-vol1",
        "n2-kokuji96-tdoc",
        "n2-roken-kokuji96"
      ],
      "beppyo7": null
    },
    {
      "id": "kasan-tokubetsu-kanri",
      "kind": "加算",
      "insurance": "介護",
      "name": "特別管理加算",
      "effect": {
        "type": "単位",
        "value": "指定訪問看護ステーションの場合 (Ⅰ) 1月につき +500単位 /(Ⅱ) 1月につき +250単位",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-santei-kouzou-r8",
          "mhlw-001195509",
          "ptotst-r6-houkan",
          "arukunpo-2026-kaigo",
          "kango-repo-kasan-2026",
          "caretasukeru-kinkyuji",
          "mhlw-santei-kouzou-r6june"
        ]
      },
      "revision": "r8-kaigo",
      "revision_name": "令和8年度介護報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "tk-target",
          "text": "イ　診療報酬の算定方法(平成二十年厚生労働省告示第五十九号)別表第一医科診療報酬点数表(以下「医科診療報酬点数表」という。)に掲げる在宅麻薬等注射指導管理、在宅腫瘍化学療法注射指導管理、在宅強心剤持続投与指導管理若しくは在宅気管切開患者指導管理を受けている状態又は気管カニューレ若しくは留置カテーテルを使用している状態\nロ　医科診療報酬点数表に掲げる在宅自己腹膜灌流指導管理、在宅血液透析指導管理、在宅酸素療法指導管理、在宅中心静脈栄養法指導管理、在宅成分栄養経管栄養法指導管理、在宅自己導尿指導管理、在宅持続陽圧呼吸療法指導管理、在宅自己疼痛管理指導管理又は在宅肺高血圧症患者指導管理を受けている状態\nハ　人工肛門又は人工膀胱を設置している状態\nニ　真皮を越える褥瘡の状態\nホ　点滴注射を週三日以上行う必要があると認められる状態",
          "ask": "q_nv_kasan",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-kokuji94-tdoc",
            "n2-roken-kokuji94"
          ]
        },
        {
          "kind": "requirements",
          "id": "tk-kubun-1",
          "text": "特別管理加算(Ⅰ)　第六号イに規定する状態にある者に対して指定訪問看護を行う場合",
          "ask": "q_nv_kasan",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-kokuji94-tdoc",
            "n2-roken-kokuji94",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "tk-kubun-2",
          "text": "特別管理加算(Ⅱ)　第六号ロ、ハ、ニ又はホに規定する状態にある者に対して指定訪問看護を行う場合",
          "ask": "q_nv_kasan",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-kokuji94-tdoc",
            "n2-roken-kokuji94",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "tk-keikaku-todokede",
          "text": "電子情報処理組織を使用する方法により、都道府県知事に対し、老健局長が定める様式による届出を行った指定訪問看護事業所が、指定訪問看護の実施に関する計画的な管理を行った場合",
          "ask": "q_nv_todokede",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-kokuji19-genko",
            "n2-roken-kokuji19"
          ]
        },
        {
          "kind": "requirements",
          "id": "tk-1kasho",
          "text": "特別管理加算は、1人の利用者に対し、1か所の事業所に限り算定できる。",
          "ask": "q_nv_kasan",
          "confirmed": false,
          "unconfirmed_reason": "一致したのは二つの secondary(全老健の統合版と兵庫県の手引)だけ。老企第36号のこの箇所は令和6年の新旧対照表で(略)とされ、厚労省の原文とは照合できていない。discipline の『二つの資料の一致』には数えない(2026-09-26 番人)。",
          "source_ref": [
            "n2-roken-roki36",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "tk-jokuso",
          "text": "定期的(1週間に1回以上)に褥瘡の状態の観察・アセスメント・評価",
          "ask": "q_nv_kasan",
          "confirmed": false,
          "unconfirmed_reason": "一致したのは二つの secondary(全老健の統合版と兵庫県の手引)だけ。老企第36号のこの箇所は令和6年の新旧対照表で(略)とされ、厚労省の原文とは照合できていない。discipline の『二つの資料の一致』には数えない(2026-09-26 番人)。",
          "source_ref": [
            "n2-roken-roki36",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "tk-tenteki",
          "text": "主治の医師が点滴注射を週3日以上行うことが必要である旨の指示を訪問看護事業所に対して行った場合であって、かつ、当該事業所の看護職員が週3日以上点滴注射を実施している状態をいう。",
          "ask": "q_nv_kasan",
          "confirmed": false,
          "unconfirmed_reason": "一致したのは二つの secondary(全老健の統合版と兵庫県の手引)だけ。老企第36号のこの箇所は令和6年の新旧対照表で(略)とされ、厚労省の原文とは照合できていない。discipline の『二つの資料の一致』には数えない(2026-09-26 番人)。",
          "source_ref": [
            "n2-roken-roki36",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "tk-iryo",
          "text": "同月に医療保険における訪問看護を利用した場合の当該訪問看護における特別管理加算は算定できないこと。",
          "ask": "q_nv_kasan",
          "confirmed": false,
          "unconfirmed_reason": "一致したのは二つの secondary(全老健の統合版と兵庫県の手引)だけ。老企第36号のこの箇所は令和6年の新旧対照表で(略)とされ、厚労省の原文とは照合できていない。discipline の『二つの資料の一致』には数えない(2026-09-26 番人)。",
          "source_ref": [
            "n2-roken-roki36",
            "n2-hyogo-tebiki-r6"
          ]
        }
      ],
      "we_do_not_say": "算定できます、とは言わない。算定していない場合に、要件を満たしうる利用者がいるかを一緒に見るところまで。",
      "sources": [
        "mhlw-001195509",
        "n2-kokuji94-tdoc",
        "n2-roken-kokuji94",
        "n2-hyogo-tebiki-r6",
        "mhlw-kokuji19-genko",
        "n2-roken-kokuji19",
        "n2-roken-roki36"
      ],
      "beppyo7": null
    },
    {
      "id": "kasan-terminal",
      "kind": "加算",
      "insurance": "介護",
      "name": "ターミナルケア加算",
      "effect": {
        "type": "単位",
        "value": "+2,500単位",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-santei-kouzou-r8",
          "mhlw-001195509",
          "ptotst-r6-houkan",
          "arukunpo-2026-kaigo",
          "kango-repo-kasan-2026",
          "caretasukeru-kinkyuji",
          "mhlw-santei-kouzou-r6june"
        ]
      },
      "revision": "r8-kaigo",
      "revision_name": "令和8年度介護報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "tm-record",
          "text": "ターミナルケアの提供について利用者の身体状況の変化等必要な事項が適切に記録されていること。",
          "ask": "q_nv_kasan",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-kokuji95-tdoc",
            "n2-roken-kokuji95",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "tm-24h",
          "text": "ターミナルケアを受ける利用者について二十四時間連絡できる体制を確保しており、かつ、必要に応じて、指定訪問看護(指定居宅サービス等基準第五十九条に規定する指定訪問看護をいう。以下同じ。)を行うことができる体制を整備していること。",
          "ask": "q_nv_kinkyuji_taisei",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-kokuji95-tdoc",
            "n2-roken-kokuji95",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "tm-setsumei",
          "text": "主治の医師との連携の下に、指定訪問看護におけるターミナルケアに係る計画及び支援体制について利用者及びその家族等に対して説明を行い、同意を得てターミナルケアを行っていること。",
          "ask": "q_nv_kasan",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-kokuji95-tdoc",
            "n2-roken-kokuji95",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "tm-nissu",
          "text": "その死亡日及び死亡日前14日以内に2日(死亡日及び死亡日前14日以内に当該利用者(末期の悪性腫瘍その他別に厚生労働大臣が定める状態にあるものに限る。)に対して訪問看護を行っている場合にあっては、1日)以上ターミナルケアを行った場合(ターミナルケアを行った後、24時間以内に在宅以外で死亡した場合を含む。)",
          "ask": "q_nv_kango_taisei",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-kokuji19-genko",
            "n2-hyogo-tebiki-r6",
            "n2-roken-kokuji19"
          ]
        },
        {
          "kind": "requirements",
          "id": "tm-jotai-1nichi",
          "text": "イ　多発性硬化症、重症筋無力症、スモン、筋萎縮性側索硬化症、脊髄小脳変性症、ハンチントン病、進行性筋ジストロフィー症、パーキンソン病関連疾患(進行性核上性麻痺、大脳皮質基底核変性症及びパーキンソン病(ホーエン・ヤールの重症度分類がステージ三以上であって生活機能障害度がⅡ度又はⅢ度のものに限る。)をいう。)、多系統萎縮症(線条体黒質変性症、オリーブ橋小脳萎縮症及びシャイ・ドレーガー症候群をいう。)、プリオン病、亜急性硬化性全脳炎、ライソゾーム病、副腎白質ジストロフィー、脊髄性筋萎縮症、球脊髄性筋萎縮症、慢性炎症性脱髄性多発神経炎、後天性免疫不全症候群、頚髄損傷及び人工呼吸器を使用している状態\nロ　急性増悪その他当該利用者の主治の医師が一時的に頻回の訪問看護が必要であると認める状態",
          "ask": "q_nv_beppyo7",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-kokuji94-tdoc",
            "n2-roken-kokuji94"
          ]
        },
        {
          "kind": "requirements",
          "id": "tm-kiroku-3",
          "text": "ア　終末期の身体症状の変化及びこれに対する看護についての記録\nイ　療養や死別に関する利用者及び家族の精神的な状態の変化及びこれに対するケアの経過についての記録\nウ　看取りを含めたターミナルケアの各プロセスにおいて利用者及び家族の意向を把握し、それに基づくアセスメント及び対応の経過の記録",
          "ask": "q_nv_kasan",
          "confirmed": false,
          "unconfirmed_reason": "一致したのは二つの secondary(全老健の統合版と兵庫県の手引)だけ。老企第36号のこの箇所は令和6年の新旧対照表で(略)とされ、厚労省の原文とは照合できていない。discipline の『二つの資料の一致』には数えない(2026-09-26 番人)。",
          "source_ref": [
            "n2-roken-roki36",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "tm-1kasho",
          "text": "ターミナルケア加算は、一人の利用者に対し、1か所の事業所に限り算定できる。",
          "ask": "q_nv_kasan",
          "confirmed": false,
          "unconfirmed_reason": "一致したのは二つの secondary(全老健の統合版と兵庫県の手引)だけ。老企第36号のこの箇所は令和6年の新旧対照表で(略)とされ、厚労省の原文とは照合できていない。discipline の『二つの資料の一致』には数えない(2026-09-26 番人)。",
          "source_ref": [
            "n2-roken-roki36",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "tm-hoken",
          "text": "最後に実施した保険制度においてターミナルケア加算等を算定すること。",
          "ask": "q_nv_kasan",
          "confirmed": false,
          "unconfirmed_reason": "一致したのは二つの secondary(全老健の統合版と兵庫県の手引)だけ。老企第36号のこの箇所は令和6年の新旧対照表で(略)とされ、厚労省の原文とは照合できていない。discipline の『二つの資料の一致』には数えない(2026-09-26 番人)。",
          "source_ref": [
            "n2-roken-roki36",
            "n2-hyogo-tebiki-r6"
          ]
        }
      ],
      "we_do_not_say": "算定できます、とは言わない。記録から実施日が辿れるかを見るところまで。",
      "sources": [
        "mhlw-001195509",
        "n2-kokuji95-tdoc",
        "n2-roken-kokuji95",
        "n2-hyogo-tebiki-r6",
        "mhlw-kokuji19-genko",
        "n2-roken-kokuji19",
        "n2-kokuji94-tdoc",
        "n2-roken-kokuji94",
        "n2-roken-roki36"
      ],
      "beppyo7": null
    },
    {
      "id": "shiji-tokubetsu",
      "kind": "期限・交付ルール",
      "insurance": "介護・医療",
      "name": "特別訪問看護指示書",
      "effect": {
        "type": null,
        "value": null,
        "confirmed": false,
        "unconfirmed_reason": null,
        "source_ref": []
      },
      "revision": "r8-iryo",
      "revision_name": "令和8年度診療報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "rules",
          "id": "tk-freq",
          "text": "一人につき原則 月1回まで交付できる",
          "ask": null,
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "kna-q6"
          ]
        },
        {
          "kind": "rules",
          "id": "tk-except",
          "text": "気管カニューレを使用している状態、または真皮を超える褥瘡の状態にある場合は、月に2回まで交付できる",
          "ask": null,
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "kna-q6"
          ]
        },
        {
          "kind": "rules",
          "id": "tk-days",
          "text": "有効期間は14日間",
          "ask": null,
          "confirmed": false,
          "unconfirmed_reason": "当社のご提案書には14日間と記載しているが、当たれた出典に有効期間の記載が無い。原文で確認するまで未確認とする。",
          "source_ref": []
        },
        {
          "kind": "watch",
          "id": "tk-count",
          "text": "当月の交付回数が上限に達していないか",
          "ask": "q_nv_shiji",
          "confirmed": false,
          "unconfirmed_reason": null,
          "source_ref": []
        },
        {
          "kind": "watch",
          "id": "tk-expiry",
          "text": "交付日からの残日数",
          "ask": "q_nv_shiji",
          "confirmed": false,
          "unconfirmed_reason": null,
          "source_ref": []
        }
      ],
      "we_do_not_say": "算定できる・できないの判定はしない。期限と回数を見て、切れる前に知らせるところまで。",
      "sources": [
        "kna-q6"
      ],
      "beppyo7": null
    },
    {
      "id": "shiji-tsujo",
      "kind": "期限・交付ルール",
      "insurance": "介護・医療",
      "name": "訪問看護指示書",
      "effect": {
        "type": null,
        "value": null,
        "confirmed": false,
        "unconfirmed_reason": null,
        "source_ref": []
      },
      "revision": "r8-iryo",
      "revision_name": "令和8年度診療報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "rules",
          "id": "ts-period",
          "text": "有効期間は原則6か月。病状が変われば期間内でも更新が要る",
          "ask": null,
          "confirmed": false,
          "unconfirmed_reason": "当社のご提案書に記載しているが、今回の調査では一次資料・二次資料とも取得できていない。確認するまで未確認とする。",
          "source_ref": []
        },
        {
          "kind": "watch",
          "id": "ts-expiry",
          "text": "利用者ごとの指示書の有効期限",
          "ask": "q_nv_shiji",
          "confirmed": false,
          "unconfirmed_reason": null,
          "source_ref": []
        }
      ],
      "we_do_not_say": null,
      "sources": [
        "mhlw-r6-hohatsu12",
        "kouseikyoku-kinki-r6-shudan"
      ],
      "beppyo7": null
    },
    {
      "id": "iryo-kanri-shonichi",
      "kind": "療養費",
      "insurance": "医療",
      "name": "訪問看護管理療養費(月の初日の訪問の場合)",
      "effect": {
        "type": "円",
        "value": "機能強化型1 13,760円 / 機能強化型2 10,460円 / 機能強化型3 9,030円 / 機能強化型4 9,030円 / それ以外 7,710円",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-santei-houhou-genko",
          "mhlw-r8-houkan-st"
        ]
      },
      "revision": "r8-iryo",
      "revision_name": "令和8年度診療報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "kanri-kyoka-kubun",
          "text": "機能強化型1・2・3・4のいずれの届出をしているか(していない場合は『それ以外』)。区分によって月の初日の額が変わる。",
          "ask": "q_nv_kyoka_kata",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-santei-houhou-genko",
            "mhlw-r8-houkan-st"
          ]
        },
        {
          "kind": "requirements",
          "id": "kanri-kyoka4-shinsetsu",
          "text": "機能強化型訪問看護管理療養費4(9,030円)は令和8年度診療報酬改定で新設された区分である。",
          "ask": "q_nv_kyoka_kata",
          "confirmed": false,
          "unconfirmed_reason": "資料が mhlw-r8-houkan-st の1件(agency)だけで、二つの資料の一致が無い。seed.23 まで confirmed:true にしていたのは掟に反していた(2026-09-26 独立検証 V3 の指摘)。",
          "source_ref": [
            "mhlw-r8-houkan-st"
          ]
        },
        {
          "kind": "requirements",
          "id": "kanri-anzen",
          "text": "(２)(１)の安全な提供体制の整備とは、以下の要件を満たすものである。ア安全管理に関する基本的な考え方、事故発生時の対応方法等が文書化されていること。イ訪問先等で発生した事故、インシデント等が報告され、その分析を通した改善策が実施される体制が整備されていること。ウ日常生活の自立度が低い利用者につき、褥瘡に関する危険因子の評価を行うこと。また、褥瘡に関する危険因子のある利用者及び既に褥瘡を有する利用者については、適切な褥瘡対策の看護計画を作成、実施及び評価を行うこと。なお、褥瘡アセスメントの記録については、参考様式（褥瘡対策に関する看護計画書）を踏まえて記録すること。エ災害等が発生した場合においても、指定訪問看護の提供を中断させない、又は中断しても可能な限り短い期間で復旧させ、利用者に対する指定訪問看護の提供を継続的に実施できるよう業務継続計画を策定し必要な措置を講じていること。オ毎年８月において、褥瘡を有する利用者数等について地方厚生（支）局長へ報告を行うこと。",
          "ask": "q_nv_anzen_taisei",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。 告示(算定方法)の注1は『安全な提供体制が整備されている』とだけ書き、ア〜オの細目は留意事項通知にしかない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        },
        {
          "kind": "requirements",
          "id": "kyoka1-jinin",
          "text": "常勤の保健師、助産師、看護師又は准看護師（以下「看護職員」という。）の数が７以上であること",
          "ask": "q_nv_staff",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-hoihatsu0305-9",
            "mhlw-kokuji103-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "kyoka-kango6wari",
          "text": "第２条第１項に規定する看護師等のうち、６割以上が",
          "ask": "q_nv_staff",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-hoihatsu0305-9",
            "mhlw-kokuji103-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "kyoka1-jisseki",
          "text": "エ次のいずれかを満たすこと。（イ）訪問看護ターミナルケア療養費の算定件数、介護保険制度によるターミナルケア加算の算定件数、在宅で死亡した利用者のうち当該訪問看護ステーションと共同で訪問看護を行った保険医療機関において在宅がん医療総合診療料を算定していた利用者数及び当該訪問看護ステーションが６月以上の指定訪問看護を実施した利用者であって、あらかじめ聴取した利用者及びその家族等の意向に基づき、７日以内の入院を経て連携する保険医療機関で死亡した利用者数（以下「ターミナルケア件数」という。）を合計した数が前年度に20以上であること。（ロ）ターミナルケア件数を合計した数が前年度に15以上、かつ、15歳未満の超重症児及び準超重症児の利用者数を合計した数が常時４人以上であること。（ハ）15歳未満の超重症児及び準超重症児の利用者数を合計した数が常時６人以上。オ特掲診療料の施設基準等（平成20年厚生労働省告示第63号）別表第七に該当する利用者が月に10人以上いること。",
          "ask": "q_nv_kyoka_jisseki",
          "confirmed": false,
          "unconfirmed_reason": "届出通知(保医発0305第9号、7/30 訂正後の PDF)1件の本文。施設基準告示(第103号)は抽象的な文言で、この数字・細目は届出通知にしかない。法令等データベースに同じ通知が見つからず、二つ目の資料と突き合わせられていない。 告示第103号 第一の六(1)ニは『十分な実績を有すること』とだけ書く。",
          "source_ref": [
            "mhlw-r8-hoihatsu0305-9"
          ]
        },
        {
          "kind": "requirements",
          "id": "kyoka1-kyotaku",
          "text": "カ次のいずれかを満たすこと。（イ）訪問看護ステーションと居宅介護支援事業所が同一敷地内に設置され、かつ、当該訪問看護ステーションの介護サービス計画又は介護予防サービス計画の作成が必要な利用者（介護保険制度の給付による訪問看護の利用者を含む。）のうち、例えば、特に医療的な管理が必要な利用者１割程度について、当該居宅介護支援事業所により介護サービス計画又は介護予防サービス計画を作成していること。（ロ）訪問看護ステーションと特定相談支援事業所又は障害児相談支援事業所が同一敷地内に設置され、かつ、当該訪問看護ステーションのサービス等利用計画又は障害児支援利用計画の作成が必要な利用者のうち１割程度について、当該特定相談支援事業所又は障害児相談支援事業所によりサービス等利用計画又は障害児支援利用計画を作成していること。",
          "ask": "q_nv_kyoka_kyotaku",
          "confirmed": false,
          "unconfirmed_reason": "届出通知(保医発0305第9号、7/30 訂正後の PDF)1件の本文。施設基準告示(第103号)は抽象的な文言で、この数字・細目は届出通知にしかない。法令等データベースに同じ通知が見つからず、二つ目の資料と突き合わせられていない。 告示第103号 第一の六(1)ホは『事業を行うことができる体制が整備されていること』とだけ書く。",
          "source_ref": [
            "mhlw-r8-hoihatsu0305-9"
          ]
        },
        {
          "kind": "requirements",
          "id": "kyoka1-kyujitsu",
          "text": "キ休日、祝日等も含め計画的な指定訪問看護を行うこと。また、営業日以外であっても、24時間365日訪問看護を必要とする利用者に対して、訪問看護を提供できる体制を確保し、対応すること。",
          "ask": "q_nv_kinkyuji_taisei",
          "confirmed": false,
          "unconfirmed_reason": "届出通知(保医発0305第9号、7/30 訂正後の PDF)1件の本文。施設基準告示(第103号)は抽象的な文言で、この数字・細目は届出通知にしかない。法令等データベースに同じ通知が見つからず、二つ目の資料と突き合わせられていない。",
          "source_ref": [
            "mhlw-r8-hoihatsu0305-9"
          ]
        },
        {
          "kind": "requirements",
          "id": "kyoka1-kenshu",
          "text": "ク直近１年間に、人材育成のための研修等を実施していること。人材育成のための研修等については、看護学生を対象とした講義若しくは実習の受入れ又は病院若しくは地域において在宅療養を支援する医療従事者等の知識及び技術等の習得を目的とした研修等、在宅医療の推進に資するものであること。ケ直近１年間に、地域の保険医療機関、訪問看護ステーション又は住民等に対して、訪問看護に関する情報提供又は相談に応じている実績があること。",
          "ask": "q_nv_chiiki_kenshu",
          "confirmed": false,
          "unconfirmed_reason": "届出通知(保医発0305第9号、7/30 訂正後の PDF)1件の本文。施設基準告示(第103号)は抽象的な文言で、この数字・細目は届出通知にしかない。法令等データベースに同じ通知が見つからず、二つ目の資料と突き合わせられていない。 告示第103号 第一の六(1)ヘは『研修や相談への対応について実績を有すること』。",
          "source_ref": [
            "mhlw-r8-hoihatsu0305-9"
          ]
        },
        {
          "kind": "requirements",
          "id": "kyoka1-senmon",
          "text": "専門の研修を受けた看護師が配置されていること",
          "ask": "q_nv_tokutei_koui",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-hoihatsu0305-9",
            "mhlw-kokuji103-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "kyoka2-jinin-jisseki",
          "text": "ア常勤の看護職員の数が５以上であること（サテライトに配置している看護職員を含む。）。当該職員数のうち４については、常勤職員のみの数とし",
          "ask": "q_nv_kyoka_jisseki",
          "confirmed": false,
          "unconfirmed_reason": "text の文言全体は二つ目の資料と一致しない。句ごとの照合: 告示第103号の法令等データベース版(法令等データベース dataId=84aa7834 pageNo=1)には『の数が５以上であること』が同じ文言である。",
          "source_ref": [
            "mhlw-r8-hoihatsu0305-9",
            "mhlw-kokuji103-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "kyoka3-kijun",
          "text": "エ特掲診療料の施設基準等別表第七に規定する疾病等の利用者、特掲診療料の施設基準等別表第八に掲げる者又は精神科重症患者支援管理連携加算を算定する利用者が月に10人以上いること又は複数の訪問看護ステーションで共同して訪問看護を提供する利用者が月に10人以上いること。",
          "ask": "q_nv_kyoka_jisseki",
          "confirmed": false,
          "unconfirmed_reason": "届出通知(保医発0305第9号、7/30 訂正後の PDF)1件の本文。施設基準告示(第103号)は抽象的な文言で、この数字・細目は届出通知にしかない。法令等データベースに同じ通知が見つからず、二つ目の資料と突き合わせられていない。 告示第103号 第一の六(3)ニは『相当な実績を有すること』とだけ書き、月10人の数字は届出通知にしかない。",
          "source_ref": [
            "mhlw-r8-hoihatsu0305-9"
          ]
        },
        {
          "kind": "requirements",
          "id": "kyoka4-kijun",
          "text": "ア常勤の看護職員の数が４以上であること（サテライトに配置している看護職員を含む。）。当該職員数については、常勤職員のみの数とすること。",
          "ask": "q_nv_kyoka4_renkei",
          "confirmed": false,
          "unconfirmed_reason": "text の文言全体は二つ目の資料と一致しない。句ごとの照合: 告示第103号の法令等データベース版(法令等データベース dataId=84aa7834 pageNo=1)には『の数が４以上であること』が同じ文言である。告示第75号 PDF の改正後欄(PDF 2頁(改正後欄))には『の数が４以上であること』が同じ文言である。",
          "source_ref": [
            "mhlw-r8-hoihatsu0305-9",
            "mhlw-kokuji103-genko",
            "mhlw-r8-kokuji75"
          ]
        },
        {
          "kind": "requirements",
          "id": "kyoka-qa-kyoka4",
          "text": "（答）そのとおり。",
          "ask": "q_nv_kyoka_kata",
          "confirmed": false,
          "unconfirmed_reason": "疑義解釈資料(事務連絡、tier agency)1件。通知・告示の本文ではなく厚生労働省の解釈であり、確定の扱いにしない。",
          "source_ref": [
            "mhlw-r8-gigi-02"
          ]
        },
        {
          "kind": "requirements",
          "id": "kanri-anzen-qa-kenshu",
          "text": "従業者が当該研修を定期的（年１回、新規採用時を含む。）に研修を受講するよう機会を確保することが望ましい。",
          "ask": "q_nv_anzen_taisei",
          "confirmed": false,
          "unconfirmed_reason": "疑義解釈資料(事務連絡、tier agency)1件。通知・告示の本文ではなく厚生労働省の解釈であり、確定の扱いにしない。 『望ましい』であり要件ではない。",
          "source_ref": [
            "mhlw-r8-gigi-02"
          ]
        }
      ],
      "we_do_not_say": "この区分で算定できます、とは言わない。届出区分と額の対応を示すところまで。",
      "sources": [
        "mhlw-santei-houhou-genko",
        "mhlw-r8-houkan-st",
        "mhlw-r6-hohatsu12",
        "mhlw-r8-hohatsu0305-19",
        "mhlw-r8-hoihatsu0305-9",
        "mhlw-kokuji103-genko",
        "mhlw-r8-kokuji75",
        "mhlw-r8-gigi-02"
      ],
      "beppyo7": null
    },
    {
      "id": "iryo-kanri-2nichime",
      "kind": "療養費",
      "insurance": "医療",
      "name": "訪問看護管理療養費(月の2日目以降の訪問の場合)",
      "effect": {
        "type": "円",
        "value": "令和8年度改定で管理療養費1・2を統合し、単一建物居住利用者の人数と、その月の何日目の訪問かで区分した。イ 単一建物居住利用者が20人未満 3,010円 / ロ 20人以上50人未満 月15日目まで 2,510円・月16日目以降24日目まで 2,310円・月25日目以降 2,210円 / ハ 50人以上 月15日目まで 2,410円・月16日目以降24日目まで 2,210円・月25日目以降 2,010円(1日につき)",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-r8-houkan-st",
          "mhlw-r8-iryo-shinkyu",
          "mhlw-r8-kokuji74",
          "mhlw-santei-houhou-genko"
        ]
      },
      "revision": "r8-iryo",
      "revision_name": "令和8年度診療報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "kanri2-kubun",
          "text": "月の2日目以降の額は、その月の何日目の訪問か(月15日目まで / 16日目以降24日目まで / 25日目以降)と、単一建物居住利用者の人数で決まる。この2つを訪問ごとに記録していなければ、正しい区分を選べない。",
          "ask": "q_nv_douitsu_tatemono",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-houkan-st",
            "mhlw-r8-kokuji74",
            "mhlw-santei-houhou-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "kanri2-todokede-fuyo",
          "text": "令和8年度改定で施設基準の届出が不要になった(令和6年度は管理療養費1・2のいずれかの届出が要った)。",
          "ask": "q_nv_todokede",
          "confirmed": false,
          "unconfirmed_reason": "資料が mhlw-r8-houkan-st の1件(agency)だけで、二つの資料の一致が無い。seed.23 まで confirmed:true にしていたのは掟に反していた(2026-09-26 独立検証 V3 の指摘)。",
          "source_ref": [
            "mhlw-r8-houkan-st"
          ]
        },
        {
          "kind": "requirements",
          "id": "kanri2-tanitsu-teigi",
          "text": "ここでいう単一建物居住利用者の人数とは、当該利用者が居住する建物（同一敷地内のものを含む。）に居住する者のうち、同月において当該訪問看護ステーションが訪問看護管理療養費又は包括型訪問看護療養費を算定する者の人数をいう。",
          "ask": "q_nv_douitsu_tatemono",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        }
      ],
      "we_do_not_say": "区分を選ぶのは事業所。こちらは告示の区分と額を並べるところまで。",
      "sources": [
        "mhlw-r8-houkan-st",
        "mhlw-r8-kokuji74",
        "mhlw-santei-houhou-genko",
        "mhlw-r8-hohatsu0305-19"
      ],
      "beppyo7": null
    },
    {
      "id": "iryo-kasan-24h",
      "kind": "加算",
      "insurance": "医療",
      "name": "24時間対応体制加算(訪問看護管理療養費の加算・月1回)",
      "effect": {
        "type": "円",
        "value": "看護業務の負担の軽減に資する取組を行っている場合 6,800円 / それ以外 6,520円",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-santei-houhou-genko",
          "mhlw-r8-houkan-st"
        ]
      },
      "revision": "r8-iryo",
      "revision_name": "令和8年度診療報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "24h-taisei",
          "text": "利用者又はその家族等から電話等により看護に関する意見を求められた場合に常時対応できる体制にある場合",
          "ask": "q_nv_kinkyuji_taisei",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-hohatsu0305-19",
            "mhlw-kokuji103-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "24h-futankeigen",
          "text": "ア夜間対応した翌日の勤務間隔の確保イ夜間対応に係る勤務の連続回数が２連続（２回）までウ夜間対応後の暦日の休日確保エ夜間勤務のニーズを踏まえた勤務体制の工夫オＩＣＴ、ＡＩ、ＩｏＴ等の活用による業務負担軽減カ電話等による連絡及び相談を担当する者に対する支援体制の確保",
          "ask": "q_nv_24h_futan",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-hohatsu0305-19",
            "mhlw-r8-hoihatsu0305-9"
          ]
        },
        {
          "kind": "requirements",
          "id": "24h-setsumei-doui",
          "text": "看護職員（准看護師を除く。）が指定訪問看護を受けようとする者に対して当該体制にある旨を説明し、その同意を得た場合に、月１回に限り算定する。",
          "ask": "q_nv_kinkyuji_taisei",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。 告示 注2は『同意を得た場合に限る』『月1回に限り』を書くが、准看護師を除く看護職員が説明する点・文書交付(イ)・1利用者1ステーション(ウ)は通知にしかない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        },
        {
          "kind": "requirements",
          "id": "24h-futan-jisseki",
          "text": "届出前１か月の実績を有していること。",
          "ask": "q_nv_24h_futan",
          "confirmed": false,
          "unconfirmed_reason": "届出通知(保医発0305第9号、7/30 訂正後の PDF)1件の本文。施設基準告示(第103号)は抽象的な文言で、この数字・細目は届出通知にしかない。法令等データベースに同じ通知が見つからず、二つ目の資料と突き合わせられていない。 留意事項通知には『届出前１か月の実績』の文言はない。",
          "source_ref": [
            "mhlw-r8-hoihatsu0305-9"
          ]
        },
        {
          "kind": "requirements",
          "id": "24h-yakan-teigi",
          "text": "単に勤務時間割表等において営業日及び営業時間外の対応が割り振られているが夜間対応がなかった場合等は該当しない。",
          "ask": "q_nv_24h_futan",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        },
        {
          "kind": "requirements",
          "id": "24h-hikango",
          "text": "ア看護師等以外の職員が利用者又はその家族等からの電話等による連絡及び相談に対応する際のマニュアルが整備されていること。",
          "ask": "q_nv_24h_hikango",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-hohatsu0305-19",
            "mhlw-r8-hoihatsu0305-9"
          ]
        },
        {
          "kind": "requirements",
          "id": "24h-heisetsu",
          "text": "機能強化型訪問看護管理療養費３又は機能強化型訪問看護管理療養費４を届け出ている訪問看護ステーションにおいて、同一敷地内に訪問看護ステーションと同一開設者である保険医療機関が併設されている場合は、営業時間外の利用者又はその家族等からの電話等による看護に関する相談への対応は、併設する当該保険医療機関の看護師が行うことができる。",
          "ask": "q_nv_kinkyuji_taisei",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。 届出通知 別添2(1)の同じ趣旨の文は『機能強化型訪問看護管理療養費３の届出を行っている』だけを挙げ、4を挙げていない(findings 参照)。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        },
        {
          "kind": "requirements",
          "id": "24h-renkei2",
          "text": "業務継続計画を策定した上で自然災害等の発生に備えた地域の相互支援ネットワークに参画している訪問看護ステーション",
          "ask": "q_nv_24h_renkei",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-hohatsu0305-19",
            "mhlw-r8-hoihatsu0305-9"
          ]
        },
        {
          "kind": "requirements",
          "id": "24h-hokatsu-i",
          "text": "(９)包括型訪問看護療養費を算定すると届出を行った訪問看護ステーションにおいて、包括型訪問看護療養費を算定せずに訪問看護基本療養費等及び訪問看護管理療養費を算定する場合については、注２のイを算定すること。",
          "ask": "q_nv_hokatsu",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        }
      ],
      "we_do_not_say": "6,800円で算定できます、とは言わない。どの取組を満たしているかを並べるところまで。",
      "sources": [
        "mhlw-santei-houhou-genko",
        "mhlw-r8-houkan-st",
        "mhlw-r6-hohatsu12",
        "mhlw-r8-hohatsu0305-19",
        "mhlw-kokuji103-genko",
        "mhlw-r8-hoihatsu0305-9"
      ],
      "beppyo7": null
    },
    {
      "id": "iryo-kihon-i",
      "kind": "療養費",
      "insurance": "医療",
      "name": "訪問看護基本療養費(Ⅰ)",
      "effect": {
        "type": "円",
        "value": "イ 保健師・助産師・看護師 (1)週3日目まで 5,550円 /(2)週4日目以降 6,550円 / ロ 准看護師 (1)週3日目まで 5,050円 /(2)週4日目以降 6,050円 / ハ 緩和ケア・褥瘡ケア・人工肛門ケア及び人工膀胱ケアに係る専門の研修を受けた看護師 12,850円 / ニ 理学療法士・作業療法士・言語聴覚士 5,550円",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-r8-kokuji74",
          "mhlw-santei-houhou-genko"
        ]
      },
      "revision": "r8-iryo",
      "revision_name": "令和8年度診療報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "kihon-i-kaisu",
          "text": "利用者１人につき週３日を限度として算定する。ただし、基準告示第２の１に規定する疾病等の利用者（特掲診療料の施設基準等（平成20年厚生労働省告示第63号）別表第７に掲げる疾病等の者及び別表第８に掲げる者をいう。以下同じ。）については、週４日以上算定でき",
          "ask": "q_nv_beppyo7",
          "confirmed": false,
          "unconfirmed_reason": "text の文言全体は二つ目の資料と一致しない。句ごとの照合: 算定方法告示(第67号)の法令等データベース版(法令等データベース dataId=84aa9734 pageNo=1)には『週３日を限度』が同じ文言である。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19",
            "mhlw-santei-houhou-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "kihon-i-senmon",
          "text": "専門の研修を受けた看護師が配置されていること。",
          "ask": "q_nv_tokutei_koui",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-hoihatsu0305-9",
            "mhlw-kokuji103-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "kihon-i-shiji-kikan",
          "text": "当該指示書に記載された有効期間内（６か月を限度とする。以下同じ。）",
          "ask": "q_nv_shiji",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。 告示(算定方法)の注には6か月の文言がない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        },
        {
          "kind": "requirements",
          "id": "kihon-i-senmon-600",
          "text": "国又は医療関係団体等が主催する研修であること。（600時間以上の研修期間で、修了証が交付されるもの）",
          "ask": "q_nv_tokutei_koui",
          "confirmed": false,
          "unconfirmed_reason": "届出通知(保医発0305第9号、7/30 訂正後の PDF)1件の本文。施設基準告示(第103号)は抽象的な文言で、この数字・細目は届出通知にしかない。法令等データベースに同じ通知が見つからず、二つ目の資料と突き合わせられていない。",
          "source_ref": [
            "mhlw-r8-hoihatsu0305-9"
          ]
        },
        {
          "kind": "requirements",
          "id": "kihon-i-ha-kyodo",
          "text": "共同して指定訪問看護を行った場合に月に１回を限度として、緩和ケア、褥瘡ケア又は人工肛門ケア及び人工膀胱ケアに係る専門の研修を受けた看護師が所属する訪問看護ステーションが算定できるものである。",
          "ask": "q_nv_tokutei_koui",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        },
        {
          "kind": "requirements",
          "id": "kihon-i-online",
          "text": "単に情報通信機器を用いた診療の補助のみを行う場合には算定できず、指定訪問看護の実施時間を十分に確保すること。",
          "ask": "q_nv_enkaku",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        },
        {
          "kind": "requirements",
          "id": "kihon-jikan-hyojun",
          "text": "30分から１時間30分程度を標準とする。",
          "ask": "q_nv_jikan",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        },
        {
          "kind": "requirements",
          "id": "kihon-ichiritsu-kinshi",
          "text": "利用者の心身の状況等を踏まえずに一律に指定訪問看護の日数、回数、実施時間及び人数（この項において「指定訪問看護の日数等」という。）を定めることや、定期的な指定訪問看護を実施していない者が指定訪問看護の日数等を定めることは認められないことに留意すること。",
          "ask": "q_nv_jikan",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        },
        {
          "kind": "requirements",
          "id": "kihon-qa-ikuji",
          "text": "育児支援を主な目的とした訪問は、指定訪問看護に該当しない。",
          "ask": "q_nv_kasan",
          "confirmed": false,
          "unconfirmed_reason": "疑義解釈資料(事務連絡、tier agency)1件。通知・告示の本文ではなく厚生労働省の解釈であり、確定の扱いにしない。",
          "source_ref": [
            "mhlw-r8-gigi-01"
          ]
        }
      ],
      "we_do_not_say": "この区分で算定できます、とは言わない。",
      "sources": [
        "mhlw-santei-houhou-genko",
        "mhlw-r6-hohatsu12",
        "mhlw-r8-hohatsu0305-19",
        "mhlw-r8-hoihatsu0305-9",
        "mhlw-kokuji103-genko",
        "mhlw-r8-gigi-01"
      ],
      "beppyo7": null
    },
    {
      "id": "iryo-kasan-tokubetsu-kanri",
      "kind": "加算",
      "insurance": "医療",
      "name": "特別管理加算(訪問看護管理療養費の加算・月1回)",
      "effect": {
        "type": "円",
        "value": "2,500円(特に重症度等が高い者の場合は 5,000円)",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-r8-kokuji74",
          "mhlw-santei-houhou-genko"
        ]
      },
      "revision": "r8-iryo",
      "revision_name": "令和8年度診療報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "tk-todokede",
          "text": "当該利用者又はその家族等から電話等により看護に関する意見を求められた場合に常時対応できる体制その他必要な体制が整備されている",
          "ask": "q_nv_tokkan_todokede",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-hohatsu0305-19",
            "mhlw-kokuji103-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "tk-taisho",
          "text": "六訪問看護管理療養費の注3本文に規定する厚生労働大臣が定める状態等にある利用者特掲診療料の施設基準等別表第八に掲げる者七訪問看護管理療養費の注3ただし書に規定する厚生労働大臣が定める状態等にある利用者特掲診療料の施設基準等別表第八第一号に掲げる者",
          "ask": "q_nv_tokkan_taisho",
          "confirmed": false,
          "unconfirmed_reason": "施設基準告示(第103号)の法令等データベース版1件の本文。この部分は告示第75号(改正告示 PDF)では『(略)』で、改正されていない。二つ目の資料の同じ文言に当たれていない。 留意事項通知 第5 3(2)は『基準告示第２の６』『基準告示第２の７』と条番号で参照するだけで、文言の一致ではない。別表第八第一号の中身(5,000円の対象)は、特掲診療料の施設基準等 別表第八を条文で読んでいないので列挙できない。",
          "source_ref": [
            "mhlw-kokuji103-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "tk-taisei-todokede",
          "text": "(１)24時間対応体制加算を算定できる体制を整備していること。",
          "ask": "q_nv_tokkan_todokede",
          "confirmed": false,
          "unconfirmed_reason": "届出通知(保医発0305第9号、7/30 訂正後の PDF)1件の本文。施設基準告示(第103号)は抽象的な文言で、この数字・細目は届出通知にしかない。法令等データベースに同じ通知が見つからず、二つ目の資料と突き合わせられていない。",
          "source_ref": [
            "mhlw-r8-hoihatsu0305-9"
          ]
        },
        {
          "kind": "requirements",
          "id": "tk-jokuso-kiroku",
          "text": "定期的（１週間に１回以上）に褥瘡の状態の観察・アセスメント・評価（褥瘡の深さ、滲出液、大きさ、炎症・感染、肉芽組織、壊死組織、ポケット）を行い、褥瘡の発生部位及び実施したケアについて訪問看護記録書に記録すること。",
          "ask": "q_nv_tokkan_kiroku",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        },
        {
          "kind": "requirements",
          "id": "tk-tenteki-kiroku",
          "text": "訪問看護記録書に在宅患者訪問点滴注射指示書を添付の上、点滴注射の実施内容を記録すること。",
          "ask": "q_nv_tokkan_kiroku",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        }
      ],
      "we_do_not_say": "重症度が高いので5,000円です、とは言わない。対象状態の列挙が手元に無い。",
      "sources": [
        "mhlw-santei-houhou-genko",
        "mhlw-r6-hohatsu12",
        "mhlw-r8-hohatsu0305-19",
        "mhlw-kokuji103-genko",
        "mhlw-r8-hoihatsu0305-9"
      ],
      "beppyo7": null
    },
    {
      "id": "iryo-kasan-kinkyu",
      "kind": "加算",
      "insurance": "医療",
      "name": "緊急訪問看護加算(1日につき)",
      "effect": {
        "type": "円",
        "value": "月14日目まで 2,650円 / 月15日目以降 2,000円",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-r8-kokuji74",
          "mhlw-santei-houhou-genko"
        ]
      },
      "revision": "r8-iryo",
      "revision_name": "令和8年度診療報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "kinkyu-yoken",
          "text": "訪問看護計画に基づき定期的に行う指定訪問看護以外であって、利用者又はその家族等の緊急の求めに応じて、主治医（診療所又は在宅療養支援病院の保険医に限る。７において同じ。）の指示により、連携する訪問看護ステーションの看護師等が訪問看護を行った場合に１日につき１回に限り算定する。",
          "ask": "q_nv_kinkyuji_taisei",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。 告示(算定方法)注9も主治医を『診療所又は…在宅療養支援病院…の保険医に限る』とし『1日につき』加算すると書くが、『定期的に行う指定訪問看護以外』『1回に限り』の文言は通知にしかない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        },
        {
          "kind": "requirements",
          "id": "kinkyu-riyu-kisai",
          "text": "(６)当該加算を算定する場合にあっては、訪問看護療養費明細書に算定する理由を記載すること。",
          "ask": "q_nv_kinkyu_kiroku",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。 訪問看護療養費明細書の記載要領(令和8年版)には当たれていない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        },
        {
          "kind": "requirements",
          "id": "kinkyu-bunsho",
          "text": "文書により提供している利用者に限り算定できる。",
          "ask": "q_nv_kinkyuji_taisei",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        },
        {
          "kind": "requirements",
          "id": "kinkyu-kiroku",
          "text": "(４)当該加算に関し、利用者又はその家族等からの電話等による緊急の求めに応じて、主治医の指示により、緊急に指定訪問看護を実施したその日時、内容及び対応状況を訪問看護記録書に記録すること。",
          "ask": "q_nv_kinkyu_kiroku",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        },
        {
          "kind": "requirements",
          "id": "kinkyu-fukusu-st",
          "text": "当該緊急の指定訪問看護を行った訪問看護ステーションが24時間対応体制加算を届け出ていない場合又は当該利用者に対して過去１月以内に指定訪問看護を実施していない場合は算定できない。",
          "ask": "q_nv_fukusu_st",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        },
        {
          "kind": "requirements",
          "id": "kinkyu-qa-hokatsu",
          "text": "緊急に主治医の明示の指示により通常とは著しく異なる対応を必要とした場合に限られるものであり、同日に多数の利用者に算定したり、同一の利用者に連日算定したりすることは想定されない。",
          "ask": "q_nv_hokatsu",
          "confirmed": false,
          "unconfirmed_reason": "疑義解釈資料(事務連絡、tier agency)1件。通知・告示の本文ではなく厚生労働省の解釈であり、確定の扱いにしない。",
          "source_ref": [
            "mhlw-r8-gigi-08"
          ]
        }
      ],
      "we_do_not_say": "緊急なので算定できます、とは言わない。",
      "sources": [
        "mhlw-santei-houhou-genko",
        "mhlw-r6-hohatsu12",
        "mhlw-r8-hohatsu0305-19",
        "mhlw-r8-gigi-08"
      ],
      "beppyo7": null
    },
    {
      "id": "iryo-kasan-nyuyoji",
      "kind": "加算",
      "insurance": "医療",
      "name": "乳幼児加算(1日につき)",
      "effect": {
        "type": "円",
        "value": "1,400円(別に厚生労働大臣が定める者の場合は 1,800円)",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-santei-houhou-genko",
          "mhlw-r8-houkan-st",
          "mhlw-r8-iryo-shinkyu"
        ]
      },
      "revision": "r8-iryo",
      "revision_name": "令和8年度診療報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "nyuyoji-taisho",
          "text": "６歳未満の利用者に対して、指定訪問看護を実施した場合に１日につき１回に限り算定する。",
          "ask": "q_nv_nyuyoji",
          "confirmed": false,
          "unconfirmed_reason": "text の文言全体は二つ目の資料と一致しない。句ごとの照合: 算定方法告示(第67号)の法令等データベース版(法令等データベース dataId=84aa9734 pageNo=1)には『６歳未満の』、『１日につき』が同じ文言である。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19",
            "mhlw-santei-houhou-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "nyuyoji-1800",
          "text": "超重症児又は準超重症児",
          "ask": "q_nv_nyuyoji",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-kokuji103-genko",
            "mhlw-r8-hohatsu0305-19"
          ]
        }
      ],
      "we_do_not_say": "1,800円の対象です、とは言わない。",
      "sources": [
        "mhlw-santei-houhou-genko",
        "mhlw-r8-houkan-st",
        "mhlw-r6-hohatsu12",
        "mhlw-r8-hohatsu0305-19",
        "mhlw-kokuji103-genko"
      ],
      "beppyo7": null
    },
    {
      "id": "iryo-terminal",
      "kind": "療養費",
      "insurance": "医療",
      "name": "訪問看護ターミナルケア療養費1・2",
      "effect": {
        "type": "円",
        "value": "1 25,000円 / 2 10,000円",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-r8-kokuji74",
          "mhlw-santei-houhou-genko"
        ]
      },
      "revision": "r8-iryo",
      "revision_name": "令和8年度診療報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "tc-yoken",
          "text": "死亡日及び死亡日前14日以内の計15日間に訪問看護基本療養費、精神科訪問看護基本療養費、退院支援指導加算又は包括型訪問看護療養費のいずれかを合わせて２回以上算定し、かつ、訪問看護におけるターミナルケアの支援体制（訪問看護ステーションの連絡担当者の氏名、連絡先電話番号、緊急時の注意事項等）について利用者及びその家族等に対して説明した上でターミナルケアを行った場合に算定する。",
          "ask": "q_nv_terminal",
          "confirmed": false,
          "unconfirmed_reason": "text の文言全体は二つ目の資料と一致しない。句ごとの照合: 算定方法告示(第67号)の法令等データベース版(法令等データベース dataId=84aa9734 pageNo=1)には『死亡日前14日以内』、『２回以上』、『利用者及びその家族等に対して説明した上でターミナルケアを行った場合に算定する』が同じ文言である。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19",
            "mhlw-santei-houhou-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "tc-kubun",
          "text": "看取り介護加算等を算定している利用者に限り",
          "ask": "q_nv_terminal",
          "confirmed": false,
          "unconfirmed_reason": "text の文言全体は二つ目の資料と一致しない。句ごとの照合: 算定方法告示(第67号)の法令等データベース版(法令等データベース dataId=84aa9734 pageNo=1)には『看取り介護加算等を算定している利用者』が同じ文言である。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19",
            "mhlw-santei-houhou-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "tc-kiroku",
          "text": "６訪問看護ターミナルケア療養費を算定した場合は、死亡した場所及び死亡時刻等を訪問看護記録書に記録すること。",
          "ask": "q_nv_terminal",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        }
      ],
      "we_do_not_say": "1で算定できます、とは言わない。",
      "sources": [
        "mhlw-santei-houhou-genko",
        "mhlw-r6-hohatsu12",
        "mhlw-r8-hohatsu0305-19"
      ],
      "beppyo7": null
    },
    {
      "id": "iryo-r8-shinsetsu",
      "kind": "療養費",
      "insurance": "医療",
      "name": "令和8年度診療報酬改定で新設された項目(訪問看護療養費)",
      "effect": {
        "type": "円",
        "value": "包括型訪問看護療養費(額未取得) / 訪問看護遠隔診療補助料(額未取得) / 訪問看護物価対応料1 イ(月の初日) 令和8年度60円・令和9年度120円、ロ(月の2日目以降) 令和8年度20円・令和9年度40円 / 訪問看護物価対応料2 令和8年度20円・令和9年度40円 / 訪問看護医療情報連携加算 1,000円(月1回) / 訪問看護ベースアップ評価料(Ⅰ) 780円 -> 1,050円",
        "confirmed": false,
        "unconfirmed_reason": "改定の概要資料(agency)から読み取った。告示の原文で額を確かめていない。包括型訪問看護療養費と訪問看護遠隔診療補助料は、概要資料に名前はあるが額が無かった。",
        "source_ref": [
          "mhlw-r8-houkan-st"
        ]
      },
      "revision": "r8-iryo",
      "revision_name": "令和8年度診療報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "r8-joho-renkei",
          "text": "(３)指定訪問看護を行った日に当該訪問看護ステーションの看護師等が、必要に応じて、次回の指定訪問看護の予定日及び当該利用者の訪問看護計画の変更の有無について、ＩＣＴを用いて医療関係職種等に共有できるように記録すること。また、当該利用者の訪問看護計画の変更の有無を記録する場合には、看護師等がその変更の概要について同様に記録すること。(４)指定訪問看護を行った日に看護師等が、利用者のケアを行う際の留意点を医療関係職種等に共有することが必要と判断した場合において、当該留意点をＩＣＴを用いて医療関係職種等に共有できるように記録すること。(５)当該訪問看護ステーションの利用者の医療・ケアに関わる者が、利用者の人生の最終段階における医療・ケア及び病状の急変時の治療方針等についての希望を利用者又はその家族等から取得した場合に、利用者又はその家族等の同意を得た上でＩＣＴを用いて医療関係職種等に共有できるように記録すること。なお、医療関係職種等が当該情報を取得した場合も同様に記録することを促すよう努めること。",
          "ask": "q_nv_ict_renkei",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。 概要資料(agency)の記述を留意事項通知の本文に置き換えた。記録の中身(次回予定日・計画変更の有無・ケアの留意点・人生の最終段階の希望)は通知にしかない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        },
        {
          "kind": "requirements",
          "id": "r8-kiroku-jikoku",
          "text": "訪問時間（実際の指定訪問看護の開始時刻及び終了時刻）",
          "ask": "q_nv_kiroku_jikoku",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-hohatsu0305-19",
            "mhlw-r8-hoihatsu0327-10"
          ]
        },
        {
          "kind": "requirements",
          "id": "r8-oshiin",
          "text": "２計画書等の記載要領(１)計画書に関する事項①「利用者氏名」、「生年月日」、「要介護認定の状況」及び「住所」の欄には必要な事項を記入すること。",
          "ask": "q_nv_keikaku_youshiki",
          "confirmed": false,
          "unconfirmed_reason": "記載要領通知(保医発0327第10号)を取得した。別紙様式1〜4の管理者氏名欄に『印』の表示がないことは pdftotext の出力で見えるが、『署名・押印を求めない』という文言そのものは、通知の本文にも留意事項通知にも見当たらない。旧データベースの記述は概要資料(agency)のまま。quote は記載要領の計画書の記載事項の冒頭で、押印に触れていないことを示すために置く。",
          "source_ref": [
            "mhlw-r8-hoihatsu0327-10"
          ]
        }
      ],
      "we_do_not_say": "新設分が算定できます、とは言わない。まず額と要件の原文を取る。",
      "sources": [
        "mhlw-r8-houkan-st",
        "mhlw-r8-hohatsu0305-19",
        "mhlw-r8-hoihatsu0327-10"
      ],
      "beppyo7": null
    },
    {
      "id": "furiwake-iryo-kaigo",
      "kind": "振り分けルール",
      "insurance": "医療",
      "name": "医療保険と介護保険のどちらで訪問看護を算定するかの振り分け",
      "effect": {
        "type": "ルール",
        "value": "介護保険の給付が医療保険の給付に優先する。要介護者・要支援者は原則として介護保険。ただし(1)別表第七に掲げる疾病等の者、(2)特別訪問看護指示書が交付されている期間、(3)精神科訪問看護基本療養費を算定する場合は、要介護者でも医療保険から給付される。",
        "confirmed": false,
        "unconfirmed_reason": "厚生局の集団指導資料と解説資料(agency)で確認した。介護保険優先の法律上の根拠条文そのものには当たれていない。",
        "source_ref": [
          "kouseikyoku-kinki-r6-shudan",
          "mhlw-tokkei-beppyo7"
        ]
      },
      "revision": "r8-iryo",
      "revision_name": "令和8年度診療報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "fw-beppyo7-count",
          "text": "○特掲診療料の施設基準等別表第８に掲げる者在宅麻薬等注射指導管理、在宅腫瘍化学療法注射指導管理又は在宅強心剤持続投与指導管理若しくは在宅気管切開患者指導管理を受けている状態にある者又は気管カニューレ若しくは留置カテーテルを使用している状態にある者、在宅自己腹膜灌流指導管理、在宅血液透析指導管理、在宅酸素療法指導管理、在宅中心静脈栄養法指導管理、在宅成分栄養経管栄養法指導管理、在宅自己導尿指導管理、在宅人工呼吸指導管理、在宅持続陽圧呼吸療法指導管理、在宅自己疼痛管理指導管理、在宅肺高血圧症患者指導管理又は在宅難治性皮膚疾患処置指導管理を受けている状態にある者、人工肛門又は人工膀胱を設置している状態にある者、真皮を越える褥瘡の状態にある者又は在宅患者訪問点滴注射管理指導料を算定している者",
          "ask": "q_nv_beppyo7",
          "confirmed": false,
          "unconfirmed_reason": "別表第8の列挙は留意事項通知の再掲(PDF 1件)で、特掲診療料の施設基準等(告示第63号)の別表第八そのものの令和8年版には当たれていない。別表第7の20項目は旧データベースの列挙(mhlw-tokkei-beppyo7)と同じ並びで載っている。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        },
        {
          "kind": "requirements",
          "id": "fw-tokubetsu-kikan",
          "text": "当該特別訪問看護指示書の交付の日から起算して14日以内に行った場合は、月１回（気管カニューレを使用している状態にある者又は真皮を越える褥瘡の状態にある者については、月２回）に限り、14日を限度として所定額を算定できる。",
          "ask": "q_nv_tokubetsu_shiji",
          "confirmed": false,
          "unconfirmed_reason": "text の文言全体は二つ目の資料と一致しない。句ごとの照合: 算定方法告示(第67号)の法令等データベース版(法令等データベース dataId=84aa9734 pageNo=1)には『14日を限度として』、『月２回』が同じ文言である。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19",
            "mhlw-santei-houhou-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "fw-seishinka",
          "text": "(３)精神科訪問看護基本療養費が算定される指定訪問看護を行う場合",
          "ask": "q_nv_seishinka",
          "confirmed": false,
          "unconfirmed_reason": "施設基準告示(第103号)の法令等データベース版1件の本文。この部分は告示第75号(改正告示 PDF)では『(略)』で、改正されていない。二つ目の資料の同じ文言に当たれていない。 認知症を主たる傷病とする場合の扱いは、今回読んだ令和8年度の留意事項通知・届出通知・告示第103号・疑義解釈(その1〜13)のどれにも書かれていない。",
          "source_ref": [
            "mhlw-kokuji103-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "fw-kaigo-yusen",
          "text": "介護保険法（平成９年法律第123号）第62条に規定する要介護被保険者等については",
          "ask": "q_nv_beppyo7",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-hohatsu0305-19",
            "mhlw-santei-houhou-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "fw-kaigo-reigai",
          "text": "一要介護被保険者等である利用者について指定訪問看護の費用に要する額を算定できる場合(１)特別訪問看護指示書に係る指定訪問看護を行う場合(２)特掲診療料の施設基準等別表第七に掲げる疾病等の者に対する指定訪問看護を行う場合(３)精神科訪問看護基本療養費が算定される指定訪問看護を行う場合",
          "ask": "q_nv_beppyo7",
          "confirmed": false,
          "unconfirmed_reason": "施設基準告示(第103号)の法令等データベース版1件の本文。この部分は告示第75号(改正告示 PDF)では『(略)』で、改正されていない。二つ目の資料の同じ文言に当たれていない。 旧データベースは同じ3つの例外を厚生局の集団指導資料(agency)で持っていたが、今回はその資料を読み直していないので一致とは言わない。",
          "source_ref": [
            "mhlw-kokuji103-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "fw-qa-nmosd",
          "text": "（答）いずれもそのとおり。",
          "ask": "q_nv_beppyo7",
          "confirmed": false,
          "unconfirmed_reason": "疑義解釈資料(事務連絡、tier agency)1件。通知・告示の本文ではなく厚生労働省の解釈であり、確定の扱いにしない。",
          "source_ref": [
            "mhlw-r8-gigi-01"
          ]
        },
        {
          "kind": "requirements",
          "id": "fw-qa-c114",
          "text": "現に医科点数表区分番号「Ｃ１１４」在宅難治性皮膚疾患処置指導管理料を算定している利用者が該当するものであり、当該管理料を算定せずに単に難治性の皮膚病変を有する利用者は該当しない。",
          "ask": "q_nv_beppyo7",
          "confirmed": false,
          "unconfirmed_reason": "疑義解釈資料(事務連絡、tier agency)1件。通知・告示の本文ではなく厚生労働省の解釈であり、確定の扱いにしない。",
          "source_ref": [
            "mhlw-r8-gigi-01"
          ]
        }
      ],
      "we_do_not_say": "この方は医療保険です、とは言わない。振り分けの分岐点と、どの分岐が未確認かを示すところまで。",
      "sources": [
        "kouseikyoku-kinki-r6-shudan",
        "mhlw-tokkei-beppyo7",
        "mhlw-r6-hohatsu12",
        "mhlw-r8-hohatsu0305-19",
        "mhlw-santei-houhou-genko",
        "mhlw-kokuji103-genko",
        "mhlw-r8-gigi-01"
      ],
      "beppyo7": [
        "末期の悪性腫瘍",
        "多発性硬化症",
        "重症筋無力症",
        "スモン",
        "筋萎縮性側索硬化症",
        "脊髄小脳変性症",
        "ハンチントン病",
        "進行性筋ジストロフィー症",
        "パーキンソン病関連疾患(進行性核上性麻痺、大脳皮質基底核変性症、パーキンソン病(ホーエン・ヤールの重症度分類がステージ3以上であって生活機能障害度がⅡ度またはⅢ度のものに限る))",
        "多系統萎縮症(線条体黒質変性症、オリーブ橋小脳萎縮症、シャイ・ドレーガー症候群)",
        "プリオン病",
        "亜急性硬化性全脳炎",
        "ライソゾーム病",
        "副腎白質ジストロフィー",
        "脊髄性筋萎縮症",
        "球脊髄性筋萎縮症",
        "慢性炎症性脱髄性多発神経炎",
        "後天性免疫不全症候群",
        "頸髄損傷",
        "人工呼吸器を使用している状態"
      ]
    },
    {
      "id": "kaigo-kihon-st",
      "kind": "単位数",
      "insurance": "介護",
      "name": "訪問看護費(指定訪問看護ステーションの場合)の基本単位数",
      "effect": {
        "type": "単位",
        "value": "イ 指定訪問看護ステーションの場合: 所要時間20分未満 314単位 / 30分未満 471単位 / 30分以上1時間未満 823単位 / 1時間以上1時間30分未満 1,128単位 / 理学療法士、作業療法士又は言語聴覚士による訪問の場合(1回につき) 294単位",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-kokuji19-genko",
          "n2-roken-kokuji19"
        ]
      },
      "revision": "r8-kaigo",
      "revision_name": "令和8年度介護報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "kihon-jikan",
          "text": "現に要した時間ではなく、訪問看護計画書に位置付けられた内容の指定訪問看護を行うのに要する標準的な時間で所定単位数を算定する。",
          "ask": "q_nv_houmon_jikan",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-kokuji19-genko",
            "n2-hyogo-tebiki-r6",
            "n2-roken-kokuji19"
          ]
        },
        {
          "kind": "requirements",
          "id": "kihon-junkangoshi",
          "text": "准看護師が指定訪問看護を行った場合は、所定単位数の100分の90に相当する単位数を算定する。",
          "ask": "q_nv_staff",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-kokuji19-genko",
            "mhlw-santei-kouzou-r8",
            "n2-roken-kokuji19"
          ]
        },
        {
          "kind": "requirements",
          "id": "kihon-20pun",
          "text": "指定訪問看護を24時間行うことができる体制を整えている指定訪問看護事業所であって、居宅サービス計画又は訪問看護計画書の中に20分以上の指定訪問看護が週1回以上含まれている場合に算定し",
          "ask": "q_nv_kinkyuji_taisei",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-kokuji19-genko",
            "n2-roken-roki36",
            "n2-roken-kokuji19"
          ]
        },
        {
          "kind": "requirements",
          "id": "kihon-2jikan",
          "text": "前回提供した訪問看護からおおむね2時間未満の間隔で訪問看護を行う場合(20分未満の訪問看護費を算定する場合及び利用者の状態の変化等により緊急の訪問看護を行う場合を除く。)は、それぞれの所要時間を合算するものとする。",
          "ask": "q_nv_houmon_jikan",
          "confirmed": false,
          "unconfirmed_reason": "一致したのは二つの secondary(全老健の統合版と兵庫県の手引)だけ。老企第36号のこの箇所は令和6年の新旧対照表で(略)とされ、厚労省の原文とは照合できていない。discipline の『二つの資料の一致』には数えない(2026-09-26 番人)。",
          "source_ref": [
            "n2-roken-roki36",
            "n2-hyogo-tebiki-r6"
          ]
        }
      ],
      "we_do_not_say": "算定できます、とは言わない。要件を並べ、どれが未確認かを示すところまで。",
      "sources": [
        "mhlw-santei-kouzou-r8",
        "mhlw-r8-kaigo-index",
        "mhlw-kokuji19-genko",
        "n2-hyogo-tebiki-r6",
        "n2-roken-kokuji19",
        "n2-roken-roki36"
      ],
      "beppyo7": null
    },
    {
      "id": "kaigo-kasan-kinkyuji",
      "kind": "加算",
      "insurance": "介護",
      "name": "緊急時訪問看護加算(Ⅰ)(Ⅱ)",
      "effect": {
        "type": "単位",
        "value": "指定訪問看護ステーションの場合 (Ⅰ) 1月につき +600単位 /(Ⅱ) 1月につき +574単位。病院又は診療所の場合 (Ⅰ) 1月につき +325単位 /(Ⅱ) 1月につき +315単位",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-santei-kouzou-r8",
          "mhlw-001195509",
          "ptotst-r6-houkan",
          "arukunpo-2026-kaigo",
          "kango-repo-kasan-2026",
          "caretasukeru-kinkyuji",
          "mhlw-santei-kouzou-r6june"
        ]
      },
      "revision": "r8-kaigo",
      "revision_name": "令和8年度介護報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "kinkyuji-taisei",
          "text": "利用者又はその家族等から電話等により看護に関する意見を求められた場合に常時対応できる体制にあること。",
          "ask": "q_nv_kinkyuji_taisei",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-kokuji95-tdoc",
            "n2-roken-kokuji95",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "kinkyuji-todokede",
          "text": "電子情報処理組織を使用する方法により、都道府県知事に対し、老健局長が定める様式による届出を行った指定訪問看護ステーション",
          "ask": "q_nv_todokede",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-kokuji19-genko",
            "n2-roken-kokuji19",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "kinkyuji-taisei-1",
          "text": "緊急時訪問における看護業務の負担の軽減に資する十分な業務管理等の体制の整備が行われていること。",
          "ask": "q_nv_kinkyuji_futan",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-kokuji95-tdoc",
            "n2-roken-kokuji95",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "kinkyuji-juri",
          "text": "訪問看護ステーションにおける緊急時訪問看護加算の算定に当たっては、第一の1(5)によらず、届出を受理した日から算定するものとする。",
          "ask": "q_nv_todokede",
          "confirmed": false,
          "unconfirmed_reason": "一致したのは二つの secondary(全老健の統合版と兵庫県の手引)だけ。老企第36号のこの箇所は令和6年の新旧対照表で(略)とされ、厚労省の原文とは照合できていない。discipline の『二つの資料の一致』には数えない(2026-09-26 番人)。",
          "source_ref": [
            "n2-roken-roki36",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "kinkyuji-futan-2",
          "text": "緊急時訪問看護加算(Ⅰ)を算定する場合は、次に掲げる項目のうち、次のア又はイを含むいずれか２項目以上を満たす必要があること。",
          "ask": "q_nv_kinkyuji_futan",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-roki36-r6-shinkyu",
            "n2-roken-roki36"
          ]
        },
        {
          "kind": "requirements",
          "id": "kinkyuji-futan-items",
          "text": "ア　夜間対応した翌日の勤務間隔の確保\nイ　夜間対応に係る勤務の連続回数が２連続（２回）まで\nウ　夜間対応後の暦日の休日確保\nエ　夜間勤務のニーズを踏まえた勤務体制の工夫\nオ　ＩＣＴ、ＡＩ、ＩｏＴ等の活用による業務負担軽減\nカ　電話等による連絡及び相談を担当する者に対する支援体制の確保",
          "ask": "q_nv_kinkyuji_futan",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-roki36-r6-shinkyu",
            "n2-roken-roki36"
          ]
        },
        {
          "kind": "requirements",
          "id": "kinkyuji-yakan",
          "text": "⑨の夜間対応とは、当該訪問看護事業所の運営規程に定める営業日及び営業時間以外における必要時の緊急時訪問看護や、利用者や家族等からの電話連絡を受けて当該者への指導を行った場合とし",
          "ask": "q_nv_kinkyuji_futan",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-roki36-r6-shinkyu",
            "n2-roken-roki36"
          ]
        },
        {
          "kind": "requirements",
          "id": "kinkyuji-doui",
          "text": "当該体制にある旨及び計画的に訪問することとなっていない緊急時訪問を行う体制にある場合には当該加算を算定する旨を説明し、その同意を得た場合に加算する。",
          "ask": "q_nv_kinkyuji_taisei",
          "confirmed": false,
          "unconfirmed_reason": "一致したのは二つの secondary(全老健の統合版と兵庫県の手引)だけ。老企第36号のこの箇所は令和6年の新旧対照表で(略)とされ、厚労省の原文とは照合できていない。discipline の『二つの資料の一致』には数えない(2026-09-26 番人)。",
          "source_ref": [
            "n2-roken-roki36",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "kinkyuji-renraku",
          "text": "当該訪問看護事業所以外の事業所又は従事者を経由するような連絡相談体制をとることや、訪問看護事業所以外の者が所有する電話を連絡先とすることは認められない。",
          "ask": "q_nv_kinkyuji_taisei",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-roki36-r6-shinkyu",
            "n2-roken-roki36"
          ]
        },
        {
          "kind": "requirements",
          "id": "kinkyuji-hokangoshi",
          "text": "ア　保健師又は看護師以外の職員が利用者又はその家族等からの電話等による連絡及び相談に対応する際のマニュアルが整備されていること。\nイ　緊急の訪問看護の必要性の判断を保健師又は看護師が速やかに行える連絡体制及び緊急の訪問看護が可能な体制が整備されていること。\nウ　当該訪問看護事業所の管理者は、連絡相談を担当する保健師又は看護師以外の職員の勤務体制及び勤務状況を明らかにすること。\nエ　保健師又は看護師以外の職員は、電話等により連絡及び相談を受けた際に、保健師又は看護師へ報告すること。報告を受けた保健師又は看護師は、当該報告内容等を訪問看護記録書に記録すること。\nオ　アからエまでについて、利用者及び家族等に説明し、同意を得ること。\nカ　指定訪問看護事業者は、連絡相談を担当する保健師又は看護師以外の職員について届け出させること。",
          "ask": "q_nv_kinkyuji_taisei",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-roki36-r6-shinkyu",
            "n2-roken-roki36"
          ]
        },
        {
          "kind": "requirements",
          "id": "kinkyuji-1kasho",
          "text": "緊急時訪問看護加算は、1人の利用者に対し、1か所の事業所に限り算定できる。",
          "ask": "q_nv_kinkyuji_taisei",
          "confirmed": false,
          "unconfirmed_reason": "一致したのは二つの secondary(全老健の統合版と兵庫県の手引)だけ。老企第36号のこの箇所は令和6年の新旧対照表で(略)とされ、厚労省の原文とは照合できていない。discipline の『二つの資料の一致』には数えない(2026-09-26 番人)。",
          "source_ref": [
            "n2-roken-roki36",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "kinkyuji-iryo",
          "text": "同月に医療保険における訪問看護を利用した場合の当該訪問看護における24時間対応体制加算は算定できないこと。",
          "ask": "q_nv_kinkyuji_taisei",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-roki36-r6-shinkyu",
            "n2-roken-roki36"
          ]
        },
        {
          "kind": "requirements",
          "id": "kinkyuji-qa-renzoku",
          "text": "やむを得ない理由により当該項目を満たさない勤務が0.5割以内の場合は、当該項目の要件を満たしているものとみなす。",
          "ask": "q_nv_kinkyuji_futan",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-r6-qa-vol1",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "kinkyuji-qa-24h365",
          "text": "24時間対応体制における看護業務の負担軽減の取組を行っている場合には当該加算を算定して差し支えない。",
          "ask": "q_nv_kinkyuji_futan",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-r6-qa-vol1",
            "n2-hyogo-tebiki-r6"
          ]
        }
      ],
      "we_do_not_say": "算定できます、とは言わない。要件を並べ、どれが未確認かを示すところまで。 単位数は原本を見るまで一切出さない。",
      "sources": [
        "mhlw-santei-kouzou-r8",
        "n2-kokuji95-tdoc",
        "n2-roken-kokuji95",
        "n2-hyogo-tebiki-r6",
        "mhlw-kokuji19-genko",
        "n2-roken-kokuji19",
        "n2-roken-roki36",
        "n2-roki36-r6-shinkyu",
        "n2-r6-qa-vol1"
      ],
      "beppyo7": null
    },
    {
      "id": "kaigo-kasan-shokai",
      "kind": "加算",
      "insurance": "介護",
      "name": "初回加算(Ⅰ)(Ⅱ)",
      "effect": {
        "type": "単位",
        "value": "(Ⅰ) 1月につき 350単位 /(Ⅱ) 1月につき 300単位",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-santei-kouzou-r8",
          "mhlw-001195509",
          "kango-repo-kasan-2026",
          "arukunpo-2026-kaigo",
          "mhlw-santei-kouzou-r6june"
        ]
      },
      "revision": "r8-kaigo",
      "revision_name": "令和8年度介護報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "shokai-shinki",
          "text": "新規に訪問看護計画書を作成した利用者に対して、初回の指定訪問看護を行った場合は、1月につき所定単位数を加算する。",
          "ask": "q_nv_shokai",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-kokuji19-genko",
            "n2-hyogo-tebiki-r6",
            "n2-roken-kokuji19"
          ]
        },
        {
          "kind": "requirements",
          "id": "shokai-taiin",
          "text": "病院、診療所又は介護保険施設から退院又は退所した日に指定訪問看護事業所の看護師が初回の指定訪問看護を行った場合は、1月につき所定単位数を加算する。",
          "ask": "q_nv_shokai",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-kokuji19-genko",
            "n2-hyogo-tebiki-r6",
            "n2-roken-kokuji19"
          ]
        },
        {
          "kind": "requirements",
          "id": "shokai-2gatsu",
          "text": "利用者が過去２月間（暦月）において、当該訪問看護事業所から訪問看護（医療保険の訪問看護を含む。）の提供を受けていない場合であって新たに訪問看護計画書を作成した場合に算定する。",
          "ask": "q_nv_shokai",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-roki36-r6-shinkyu",
            "n2-roken-roki36"
          ]
        }
      ],
      "we_do_not_say": "算定できます、とは言わない。要件を並べ、どれが未確認かを示すところまで。",
      "sources": [
        "mhlw-santei-kouzou-r8",
        "mhlw-kokuji19-genko",
        "n2-hyogo-tebiki-r6",
        "n2-roken-kokuji19",
        "n2-roki36-r6-shinkyu",
        "n2-roken-roki36"
      ],
      "beppyo7": null
    },
    {
      "id": "kaigo-kasan-taiin-kyodo",
      "kind": "加算",
      "insurance": "介護",
      "name": "退院時共同指導加算",
      "effect": {
        "type": "単位",
        "value": "1回につき 600単位",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-santei-kouzou-r8",
          "mhlw-001195509",
          "mhlw-santei-kouzou-r6june"
        ]
      },
      "revision": "r8-kaigo",
      "revision_name": "令和8年度介護報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "tk-kyodo",
          "text": "病院、診療所、介護老人保健施設又は介護医療院の主治の医師その他の従業者と共同し、在宅での療養上必要な指導を行い、その内容を提供することをいう。",
          "ask": "q_nv_taiin_kyodo",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-kokuji19-genko",
            "n2-hyogo-tebiki-r6",
            "n2-r6-qa-vol1",
            "n2-roken-kokuji19"
          ]
        },
        {
          "kind": "requirements",
          "id": "tk-bunsho",
          "text": "退院時共同指導を行った場合は、その内容を訪問看護記録書に記録すること。",
          "ask": "q_nv_taiin_kyodo",
          "confirmed": false,
          "unconfirmed_reason": "一致したのは二つの secondary(全老健の統合版と兵庫県の手引)だけ。老企第36号のこの箇所は令和6年の新旧対照表で(略)とされ、厚労省の原文とは照合できていない。discipline の『二つの資料の一致』には数えない(2026-09-26 番人)。",
          "source_ref": [
            "n2-roken-roki36",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "tk-kaisu",
          "text": "当該退院又は退所につき1回(特別な管理を必要とする利用者については、2回)に限り",
          "ask": "q_nv_taiin_kyodo",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-kokuji19-genko",
            "n2-hyogo-tebiki-r6",
            "n2-roken-kokuji19"
          ]
        },
        {
          "kind": "requirements",
          "id": "tk-tv",
          "text": "退院時共同指導は、テレビ電話装置等を活用して行うことができるものとする。ただし、テレビ電話装置等の活用について当該者又はその看護に当たる者の同意を得なければならない。",
          "ask": "q_nv_taiin_kyodo",
          "confirmed": false,
          "unconfirmed_reason": "一致したのは二つの secondary(全老健の統合版と兵庫県の手引)だけ。老企第36号のこの箇所は令和6年の新旧対照表で(略)とされ、厚労省の原文とは照合できていない。discipline の『二つの資料の一致』には数えない(2026-09-26 番人)。",
          "source_ref": [
            "n2-roken-roki36",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "tk-qa-mail",
          "text": "電子メールで送信した後に利用者またはその家族が受け取ったことを確認するとともに、確認したことについて訪問看護記録書に記録しておく必要がある。",
          "ask": "q_nv_taiin_kyodo",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-r6-qa-vol1",
            "n2-hyogo-tebiki-r6"
          ]
        }
      ],
      "we_do_not_say": "算定できます、とは言わない。要件を並べ、どれが未確認かを示すところまで。",
      "sources": [
        "mhlw-santei-kouzou-r8",
        "mhlw-001195509",
        "mhlw-kokuji19-genko",
        "n2-hyogo-tebiki-r6",
        "n2-r6-qa-vol1",
        "n2-roken-kokuji19",
        "n2-roken-roki36"
      ],
      "beppyo7": null
    },
    {
      "id": "kaigo-kasan-kango-taisei",
      "kind": "加算",
      "insurance": "介護",
      "name": "看護体制強化加算(Ⅰ)(Ⅱ)",
      "effect": {
        "type": "単位",
        "value": "(Ⅰ) 1月につき 550単位 /(Ⅱ) 1月につき 200単位",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-santei-kouzou-r8",
          "mhlw-001195509",
          "mhlw-santei-kouzou-r6june"
        ]
      },
      "revision": "r8-kaigo",
      "revision_name": "令和8年度介護報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "kt-jisseki",
          "text": "その割合及び人数については、台帳等により毎月記録するものとし、所定の基準を下回った場合については、直ちに第１の５に規定する届出を提出しなければならないこと。",
          "ask": "q_nv_kango_taisei_6m",
          "confirmed": false,
          "unconfirmed_reason": "一致したのは二つの secondary(全老健の統合版と兵庫県の手引)だけ。老企第36号のこの箇所は令和6年の新旧対照表で(略)とされ、厚労省の原文とは照合できていない。discipline の『二つの資料の一致』には数えない(2026-09-26 番人)。",
          "source_ref": [
            "n2-roken-roki36",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "kt-kango-wariai",
          "text": "看護職員の占める割合の算出に当たっては、常勤換算方法により算出した前月（暦月）の平均を用いることとする。",
          "ask": "q_nv_staff",
          "confirmed": false,
          "unconfirmed_reason": "一致したのは二つの secondary(全老健の統合版と兵庫県の手引)だけ。老企第36号のこの箇所は令和6年の新旧対照表で(略)とされ、厚労省の原文とは照合できていない。discipline の『二つの資料の一致』には数えない(2026-09-26 番人)。",
          "source_ref": [
            "n2-roken-roki36",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "kt-1-kinkyuji",
          "text": "算定日が属する月の前六月間において、指定訪問看護事業所における利用者の総数のうち、緊急時訪問看護加算(指定居宅サービス介護給付費単位数表の訪問看護費の注12に係る加算をいう。)を算定した利用者の占める割合が百分の五十以上であること。",
          "ask": "q_nv_kango_taisei_6m",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-kokuji95-tdoc",
            "n2-roken-kokuji95"
          ]
        },
        {
          "kind": "requirements",
          "id": "kt-1-tokubetsu",
          "text": "算定日が属する月の前六月間において、指定訪問看護事業所における利用者の総数のうち、特別管理加算(指定居宅サービス介護給付費単位数表の訪問看護費の注13に係る加算をいう。)を算定した利用者の占める割合が百分の二十以上であること。",
          "ask": "q_nv_kango_taisei_6m",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-kokuji95-tdoc",
            "n2-roken-kokuji95"
          ]
        },
        {
          "kind": "requirements",
          "id": "kt-1-terminal",
          "text": "算定日が属する月の前十二月間において、指定訪問看護事業所におけるターミナルケア加算(指定居宅サービス介護給付費単位数表の訪問看護費の注15に係る加算をいう。ロ(1)(二)において同じ。)を算定した利用者が五名以上であること。",
          "ask": "q_nv_kango_taisei",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-kokuji95-tdoc",
            "n2-roken-kokuji95"
          ]
        },
        {
          "kind": "requirements",
          "id": "kt-1-kangoshoku",
          "text": "当該事業所において指定訪問看護の提供に当たる従業者(指定居宅サービス等基準第六十条第一項に規定する看護師等をいう。以下この号において同じ。)の総数のうち、同項第一号イに規定する看護職員の占める割合が百分の六十以上であること。ただし、指定訪問看護事業者(同項に規定する指定訪問看護事業者をいう。以下同じ。)が、指定介護予防サービス等の事業の人員、設備及び運営並びに指定介護予防サービス等に係る介護予防のための効果的な支援の方法に関する基準(平成十八年厚生労働省令第三十五号。以下「指定介護予防サービス等基準」という。)第六十三条第一項に規定する指定介護予防訪問看護事業所の指定を併せて受け、かつ、指定訪問看護の事業と指定介護予防訪問看護(指定介護予防サービス等基準第六十二条に規定する指定介護予防訪問看護をいう。以下同じ。)の事業とが同一の事業所において一体的に運営されている場合における、当該割合の算定にあっては、指定訪問看護を提供する従業者と指定介護予防訪問看護を提供する従業者の合計数のうち、看護職員の占める割合によるものとする。",
          "ask": "q_nv_staff",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-kokuji95-tdoc",
            "n2-roken-kokuji95"
          ]
        },
        {
          "kind": "requirements",
          "id": "kt-2-kinkyuji",
          "text": "イ(1)(一)、(二)及び(四)に掲げる基準のいずれにも適合すること。",
          "ask": "q_nv_kango_taisei_6m",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-kokuji95-tdoc",
            "n2-roken-kokuji95",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "kt-2-terminal",
          "text": "算定日が属する月の前十二月間において、指定訪問看護事業所におけるターミナルケア加算を算定した利用者が一名以上であること。",
          "ask": "q_nv_kango_taisei",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-kokuji95-tdoc",
            "n2-roken-kokuji95",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "kt-1-byoin",
          "text": "指定訪問看護ステーション以外である指定訪問看護事業所にあっては、(1)(一)から(三)までに掲げる基準のいずれにも適合すること。",
          "ask": "q_nv_kango_taisei_6m",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-kokuji95-tdoc",
            "n2-roken-kokuji95",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "kt-2-byoin",
          "text": "指定訪問看護ステーション以外である指定訪問看護事業所にあっては、イ(1)(一)及び(二)並びにロ(1)(二)に掲げる基準のいずれにも適合すること。",
          "ask": "q_nv_kango_taisei_6m",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-kokuji95-tdoc",
            "n2-roken-kokuji95",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "kt-kango-54",
          "text": "当該割合が100分の60から１割を超えて減少した場合（100分の54を下回った場合）には、その翌月から看護体制強化加算を算定できないものとし",
          "ask": "q_nv_staff",
          "confirmed": false,
          "unconfirmed_reason": "一致したのは二つの secondary(全老健の統合版と兵庫県の手引)だけ。老企第36号のこの箇所は令和6年の新旧対照表で(略)とされ、厚労省の原文とは照合できていない。discipline の『二つの資料の一致』には数えない(2026-09-26 番人)。",
          "source_ref": [
            "n2-roken-roki36",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "kt-jitsu",
          "text": "前6月間において、当該事業所が提供する訪問看護を2回以上利用した者又は当該事業所で当該加算を2回以上算定した者であっても、1として数えること。",
          "ask": "q_nv_kango_taisei_6m",
          "confirmed": false,
          "unconfirmed_reason": "一致したのは二つの secondary(全老健の統合版と兵庫県の手引)だけ。老企第36号のこの箇所は令和6年の新旧対照表で(略)とされ、厚労省の原文とは照合できていない。discipline の『二つの資料の一致』には数えない(2026-09-26 番人)。",
          "source_ref": [
            "n2-roken-roki36",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "kt-doui",
          "text": "当該加算の内容について利用者又はその家族への説明を行い、同意を得ること。",
          "ask": "q_nv_kasan",
          "confirmed": false,
          "unconfirmed_reason": "一致したのは二つの secondary(全老健の統合版と兵庫県の手引)だけ。老企第36号のこの箇所は令和6年の新旧対照表で(略)とされ、厚労省の原文とは照合できていない。discipline の『二つの資料の一致』には数えない(2026-09-26 番人)。",
          "source_ref": [
            "n2-roken-roki36",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "kt-sentaku",
          "text": "当該訪問看護事業所においていずれか一方のみを選択し、届出を行うこと。",
          "ask": "q_nv_todokede",
          "confirmed": false,
          "unconfirmed_reason": "一致したのは二つの secondary(全老健の統合版と兵庫県の手引)だけ。老企第36号のこの箇所は令和6年の新旧対照表で(略)とされ、厚労省の原文とは照合できていない。discipline の『二つの資料の一致』には数えない(2026-09-26 番人)。",
          "source_ref": [
            "n2-roken-roki36",
            "n2-hyogo-tebiki-r6"
          ]
        }
      ],
      "we_do_not_say": "算定できます、とは言わない。要件を並べ、どれが未確認かを示すところまで。",
      "sources": [
        "mhlw-santei-kouzou-r8",
        "mhlw-001195509",
        "mhlw-kijun-kokuji95",
        "n2-kokuji95-tdoc",
        "n2-roken-kokuji95",
        "n2-hyogo-tebiki-r6",
        "n2-roken-roki36"
      ],
      "beppyo7": null
    },
    {
      "id": "kaigo-kasan-service-taisei",
      "kind": "加算",
      "insurance": "介護",
      "name": "サービス提供体制強化加算(Ⅰ)(Ⅱ)",
      "effect": {
        "type": "単位",
        "value": "(Ⅰ) 1回につき 6単位 /(Ⅱ) 1回につき 3単位",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-santei-kouzou-r8",
          "mhlw-001195509",
          "arukunpo-2026-kaigo",
          "mhlw-santei-kouzou-r6june"
        ]
      },
      "revision": "r8-kaigo",
      "revision_name": "令和8年度介護報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "st-kenshu",
          "text": "指定訪問看護事業所の全ての看護師等(指定居宅サービス等基準第六十条第一項に規定する看護師等をいう。以下同じ。)に対し、看護師等ごとに研修計画を作成し、当該計画に従い、研修(外部における研修を含む。)を実施又は実施を予定していること。",
          "ask": "q_nv_service_taisei",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-kokuji95-tdoc",
            "n2-roken-kokuji95",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "st-kaigi",
          "text": "利用者に関する情報若しくはサービス提供に当たっての留意事項の伝達又は当該指定訪問看護事業所における看護師等の技術指導を目的とした会議を定期的に開催すること。",
          "ask": "q_nv_service_taisei",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-kokuji95-tdoc",
            "n2-roken-kokuji95",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "st-kinzoku",
          "text": "当該指定訪問看護事業所の看護師等の総数のうち、勤続年数七年以上の者の占める割合が百分の三十以上であること。",
          "ask": "q_nv_kinzoku",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-kokuji95-tdoc",
            "n2-roken-kokuji95",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "st-kinzoku-2",
          "text": "当該指定訪問看護事業所の看護師等の総数のうち、勤続年数三年以上の者の占める割合が百分の三十以上であること。",
          "ask": "q_nv_kinzoku",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-kokuji95-tdoc",
            "n2-roken-kokuji95",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "st-kenshin",
          "text": "当該指定訪問看護事業所の全ての看護師等に対し、健康診断等を定期的に実施すること。",
          "ask": "q_nv_service_taisei",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-kokuji95-tdoc",
            "n2-roken-kokuji95",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "st-kaigi-hindo",
          "text": "「定期的」とは、おおむね１月に１回以上開催されている必要がある。",
          "ask": "q_nv_service_taisei",
          "confirmed": false,
          "unconfirmed_reason": "一致したのは二つの secondary(全老健の統合版と兵庫県の手引)だけ。老企第36号のこの箇所は令和6年の新旧対照表で(略)とされ、厚労省の原文とは照合できていない。discipline の『二つの資料の一致』には数えない(2026-09-26 番人)。",
          "source_ref": [
            "n2-roken-roki36",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "st-wariai",
          "text": "職員の割合の算出に当たっては、常勤換算方法により算出した前年度(3月を除く。)の平均を用いることとする。",
          "ask": "q_nv_kinzoku",
          "confirmed": false,
          "unconfirmed_reason": "一致したのは二つの secondary(全老健の統合版と兵庫県の手引)だけ。老企第36号のこの箇所は令和6年の新旧対照表で(略)とされ、厚労省の原文とは照合できていない。discipline の『二つの資料の一致』には数えない(2026-09-26 番人)。",
          "source_ref": [
            "n2-roken-roki36",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "st-kinzoku-def",
          "text": "勤続年数の算定に当たっては、当該事業所における勤務年数に加え、同一法人等の経営する他の介護サービス事業所、病院、社会福祉施設等においてサービスを利用者に直接提供する職員として勤務した年数を含めることができるものとする。",
          "ask": "q_nv_kinzoku",
          "confirmed": false,
          "unconfirmed_reason": "一致したのは二つの secondary(全老健の統合版と兵庫県の手引)だけ。老企第36号のこの箇所は令和6年の新旧対照表で(略)とされ、厚労省の原文とは照合できていない。discipline の『二つの資料の一致』には数えない(2026-09-26 番人)。",
          "source_ref": [
            "n2-roken-roki36",
            "n2-hyogo-tebiki-r6"
          ]
        }
      ],
      "we_do_not_say": "算定できます、とは言わない。要件を並べ、どれが未確認かを示すところまで。",
      "sources": [
        "mhlw-santei-kouzou-r8",
        "mhlw-001195509",
        "n2-kokuji95-tdoc",
        "n2-roken-kokuji95",
        "n2-hyogo-tebiki-r6",
        "n2-roken-roki36"
      ],
      "beppyo7": null
    },
    {
      "id": "kaigo-kasan-senmon-kanri",
      "kind": "加算",
      "insurance": "介護",
      "name": "専門管理加算(令和6年度新設)",
      "effect": {
        "type": "単位",
        "value": "緩和ケア等に係る専門の研修を受けた看護師の場合 1月につき 250単位 / 特定行為研修を修了した看護師の場合 1月につき 250単位",
        "confirmed": false,
        "unconfirmed_reason": "令和8年6月施行の算定構造 PDF を、要約経由で読んだ値である。同じ PDF を二度読ませたところ、緊急時訪問看護加算と特別管理加算の単位数が入れ替わって出た(conflicts: santei-kouzou-r8-yomitori 参照)。読み取りが安定していないので、原本の表を人が見て確定するまで確定にしない。",
        "source_ref": [
          "mhlw-santei-kouzou-r8"
        ]
      },
      "revision": "r8-kaigo",
      "revision_name": "令和8年度介護報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "senmon-zaiseki",
          "text": "イ　緩和ケア、褥瘡ケア又は人工肛門ケア及び人工膀胱ケアに係る専門の研修を受けた看護師が配置されていること。\nロ　保健師助産師看護師法(昭和二十三年法律第二百三号)第三十七条の二第二項第五号に規定する指定研修機関において、同項第一号に規定する特定行為のうち訪問看護において専門の管理を必要とするものに係る研修を修了した看護師が配置されていること。",
          "ask": "q_nv_tokutei_koui",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-kokuji95-tdoc",
            "n2-roken-kokuji95"
          ]
        },
        {
          "kind": "requirements",
          "id": "senmon-tejunsho",
          "text": "医科診療報酬点数表の区分番号C007の注3に規定する手順書加算を算定する利用者に対して行った場合に限る。",
          "ask": "q_nv_tokutei_koui",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-kokuji19-genko",
            "n2-hyogo-tebiki-r6",
            "n2-roken-kokuji19"
          ]
        },
        {
          "kind": "requirements",
          "id": "senmon-taisho",
          "text": "悪性腫瘍の鎮痛療法若しくは化学療法を行っている利用者、真皮を越える褥瘡の状態にある利用者(重点的な褥瘡管理を行う必要が認められる利用者(在宅での療養を行っているものに限る。)にあっては真皮までの状態の利用者)又は人工肛門若しくは人工膀胱を造設している者で管理が困難な利用者に行った場合に限る。",
          "ask": "q_nv_tokutei_koui",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-kokuji19-genko",
            "n2-hyogo-tebiki-r6",
            "n2-roken-kokuji19"
          ]
        },
        {
          "kind": "requirements",
          "id": "senmon-teiki",
          "text": "定期的（１月に１回以上）に指定訪問看護を行うとともに、当該利用者に係る指定訪問看護の実施に関する計画的な管理を行った場合に、月１回に限り算定する。",
          "ask": "q_nv_tokutei_koui",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-roki36-r6-shinkyu",
            "n2-roken-roki36"
          ]
        },
        {
          "kind": "requirements",
          "id": "senmon-qa-kenshu",
          "text": "褥瘡ケアについては、日本看護協会の認定看護師教育課程「皮膚・排泄ケア」",
          "ask": "q_nv_tokutei_koui",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-r6-qa-vol1",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "senmon-qa-tokutei",
          "text": "「在宅・慢性期領域パッケージ研修」",
          "ask": "q_nv_tokutei_koui",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-r6-qa-vol1",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "senmon-qa-1kai",
          "text": "イ又はロのいずれかを月１回に限り算定すること。",
          "ask": "q_nv_tokutei_koui",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-r6-qa-vol1",
            "n2-hyogo-tebiki-r6"
          ]
        }
      ],
      "we_do_not_say": "算定できます、とは言わない。要件を並べ、どれが未確認かを示すところまで。",
      "sources": [
        "mhlw-santei-kouzou-r8",
        "n2-kokuji95-tdoc",
        "n2-roken-kokuji95",
        "mhlw-kokuji19-genko",
        "n2-hyogo-tebiki-r6",
        "n2-roken-kokuji19",
        "n2-roki36-r6-shinkyu",
        "n2-roken-roki36",
        "n2-r6-qa-vol1"
      ],
      "beppyo7": null
    },
    {
      "id": "kaigo-kasan-enkaku-shibo",
      "kind": "加算",
      "insurance": "介護",
      "name": "遠隔死亡診断補助加算(令和6年度新設)",
      "effect": {
        "type": "単位",
        "value": "150単位",
        "confirmed": false,
        "unconfirmed_reason": "令和8年6月施行の算定構造 PDF を、要約経由で読んだ値である。同じ PDF を二度読ませたところ、緊急時訪問看護加算と特別管理加算の単位数が入れ替わって出た(conflicts: santei-kouzou-r8-yomitori 参照)。読み取りが安定していないので、原本の表を人が見て確定するまで確定にしない。",
        "source_ref": [
          "mhlw-santei-kouzou-r8"
        ]
      },
      "revision": "r8-kaigo",
      "revision_name": "令和8年度介護報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "es-kenshu",
          "text": "情報通信機器を用いた在宅での看取りに係る研修を受けた看護師が配置されていること。",
          "ask": "q_nv_enkaku",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-kokuji95-tdoc",
            "n2-roken-kokuji95"
          ]
        },
        {
          "kind": "requirements",
          "id": "es-terminal",
          "text": "死亡診断加算を算定する利用者(別に厚生労働大臣が定める地域に居住する利用者に限る。)について、その主治の医師の指示に基づき、情報通信機器を用いて医師の死亡診断の補助を行った場合",
          "ask": "q_nv_enkaku",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-kokuji19-genko",
            "n2-hyogo-tebiki-r6",
            "n2-roken-kokuji19"
          ]
        },
        {
          "kind": "requirements",
          "id": "es-guideline",
          "text": "厚生労働省「情報通信機器（ＩＣＴ）を利用した死亡診断等ガイドライン」に基づき、主治の医師による情報通信機器を用いた死亡診断の補助を行った場合に算定する。",
          "ask": "q_nv_enkaku",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-roki36-r6-shinkyu",
            "n2-roken-roki36"
          ]
        },
        {
          "kind": "requirements",
          "id": "es-qa-kenshu",
          "text": "により実施されている研修が該当する。",
          "ask": "q_nv_enkaku",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-r6-qa-vol1",
            "n2-hyogo-tebiki-r6"
          ]
        }
      ],
      "we_do_not_say": "算定できます、とは言わない。要件を並べ、どれが未確認かを示すところまで。",
      "sources": [
        "mhlw-santei-kouzou-r8",
        "n2-kokuji95-tdoc",
        "n2-roken-kokuji95",
        "mhlw-kokuji19-genko",
        "n2-hyogo-tebiki-r6",
        "n2-roken-kokuji19",
        "n2-roki36-r6-shinkyu",
        "n2-roken-roki36",
        "n2-r6-qa-vol1"
      ],
      "beppyo7": null
    },
    {
      "id": "kaigo-kasan-kouku",
      "kind": "加算",
      "insurance": "介護",
      "name": "口腔連携強化加算(令和6年度新設)",
      "effect": {
        "type": "単位",
        "value": "1回につき 50単位(1月に1回を限度)",
        "confirmed": false,
        "unconfirmed_reason": "令和8年6月施行の算定構造 PDF を、要約経由で読んだ値である。同じ PDF を二度読ませたところ、緊急時訪問看護加算と特別管理加算の単位数が入れ替わって出た(conflicts: santei-kouzou-r8-yomitori 参照)。読み取りが安定していないので、原本の表を人が見て確定するまで確定にしない。",
        "source_ref": [
          "mhlw-santei-kouzou-r8"
        ]
      },
      "revision": "r8-kaigo",
      "revision_name": "令和8年度介護報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "kk-hyoka",
          "text": "口腔の健康状態の評価を実施した場合において、利用者の同意を得て、歯科医療機関及び介護支援専門員に対し、当該評価の結果の情報提供を行ったときは、口腔連携強化加算として、1月に1回に限り所定単位数を加算する。",
          "ask": "q_nv_kouku",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-kokuji19-genko",
            "n2-roken-kokuji19"
          ]
        },
        {
          "kind": "requirements",
          "id": "kk-kiroku",
          "text": "評価した情報を歯科医療機関及び当該利用者を担当する介護支援専門員に対し、別紙様式６等により提供すること。",
          "ask": "q_nv_kouku",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-roki36-r6-shinkyu",
            "n2-roken-roki36"
          ]
        },
        {
          "kind": "requirements",
          "id": "kk-taisei",
          "text": "指定訪問看護事業所の従業者が利用者の口腔の健康状態に係る評価を行うに当たって、歯科診療報酬点数表の区分番号C000に掲げる歯科訪問診療料の算定の実績がある歯科医療機関の歯科医師又は歯科医師の指示を受けた歯科衛生士に相談できる体制を確保し、その旨を文書等で取り決めていること。",
          "ask": "q_nv_kouku_shika",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-kokuji95-tdoc",
            "n2-roken-kokuji95"
          ]
        },
        {
          "kind": "requirements",
          "id": "kk-jogai",
          "text": "当該事業所以外の介護サービス事業所において、当該利用者について、口腔連携強化加算を算定していること。",
          "ask": "q_nv_kouku",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-kokuji95-tdoc",
            "n2-roken-kokuji95",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "kk-kakunin",
          "text": "イ　開口の状態\nロ　歯の汚れの有無\nハ　舌の汚れの有無\nニ　歯肉の腫れ、出血の有無\nホ　左右両方の奥歯のかみ合わせの状態\nヘ　むせの有無\nト　ぶくぶくうがいの状態\nチ　食物のため込み、残留の有無",
          "ask": "q_nv_kouku",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-roki36-r6-shinkyu",
            "n2-roken-roki36"
          ]
        }
      ],
      "we_do_not_say": "算定できます、とは言わない。要件を並べ、どれが未確認かを示すところまで。",
      "sources": [
        "mhlw-santei-kouzou-r8",
        "mhlw-kokuji19-genko",
        "n2-roken-kokuji19",
        "n2-roki36-r6-shinkyu",
        "n2-roken-roki36",
        "n2-kokuji95-tdoc",
        "n2-roken-kokuji95",
        "n2-hyogo-tebiki-r6"
      ],
      "beppyo7": null
    },
    {
      "id": "kaigo-kasan-yakan",
      "kind": "加算",
      "insurance": "介護",
      "name": "夜間・早朝加算 / 深夜加算",
      "effect": {
        "type": "率",
        "value": "夜間・早朝 所定単位数の 25/100 を加算 / 深夜 所定単位数の 50/100 を加算",
        "confirmed": false,
        "unconfirmed_reason": "令和8年6月施行の算定構造 PDF を、要約経由で読んだ値である。同じ PDF を二度読ませたところ、緊急時訪問看護加算と特別管理加算の単位数が入れ替わって出た(conflicts: santei-kouzou-r8-yomitori 参照)。読み取りが安定していないので、原本の表を人が見て確定するまで確定にしない。",
        "source_ref": [
          "mhlw-santei-kouzou-r8"
        ]
      },
      "revision": "r8-kaigo",
      "revision_name": "令和8年度介護報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "yk-jikan",
          "text": "サービス開始時刻が加算の対象となる時間帯にある場合に、当該加算を算定するものとすること。",
          "ask": "q_nv_yakan",
          "confirmed": false,
          "unconfirmed_reason": "一致したのは二つの secondary(全老健の統合版と兵庫県の手引)だけ。老企第36号のこの箇所は令和6年の新旧対照表で(略)とされ、厚労省の原文とは照合できていない。discipline の『二つの資料の一致』には数えない(2026-09-26 番人)。",
          "source_ref": [
            "n2-roken-roki36",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "yk-ritsu",
          "text": "夜間又は早朝に指定訪問看護を行った場合は、1回につき所定単位数の100分の25に相当する単位数を所定単位数に加算し、深夜に指定訪問看護を行った場合は、1回につき所定単位数の100分の50に相当する単位数を所定単位数に加算する。",
          "ask": "q_nv_yakan",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-kokuji19-genko",
            "n2-hyogo-tebiki-r6",
            "n2-roken-kokuji19"
          ]
        },
        {
          "kind": "requirements",
          "id": "yk-jikantai",
          "text": "夜間(午後6時から午後10時までの時間をいう。以下同じ。)又は早朝(午前6時から午前8時までの時間をいう。以下同じ。)",
          "ask": "q_nv_yakan",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-kokuji19-genko",
            "n2-r6-qa-vol1",
            "n2-roken-kokuji19"
          ]
        },
        {
          "kind": "requirements",
          "id": "yk-20pun",
          "text": "なお、20分未満の訪問の場合についても、同様の取扱いとする。",
          "ask": "q_nv_yakan",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-roki36-r6-shinkyu",
            "n2-roken-roki36"
          ]
        }
      ],
      "we_do_not_say": "算定できます、とは言わない。要件を並べ、どれが未確認かを示すところまで。",
      "sources": [
        "mhlw-santei-kouzou-r8",
        "n2-roken-roki36",
        "n2-hyogo-tebiki-r6",
        "mhlw-kokuji19-genko",
        "n2-roken-kokuji19",
        "n2-r6-qa-vol1",
        "n2-roki36-r6-shinkyu"
      ],
      "beppyo7": null
    },
    {
      "id": "kaigo-genzan-douitsu-tatemono",
      "kind": "減算",
      "insurance": "介護",
      "name": "同一建物居住者へのサービス提供に係る減算",
      "effect": {
        "type": "率",
        "value": "同一の建物に居住する利用者が 20人以上 所定単位数の 90/100 / 50人以上 所定単位数の 85/100",
        "confirmed": false,
        "unconfirmed_reason": "令和8年6月施行の算定構造 PDF を、要約経由で読んだ値である。同じ PDF を二度読ませたところ、緊急時訪問看護加算と特別管理加算の単位数が入れ替わって出た(conflicts: santei-kouzou-r8-yomitori 参照)。読み取りが安定していないので、原本の表を人が見て確定するまで確定にしない。",
        "source_ref": [
          "mhlw-santei-kouzou-r8"
        ]
      },
      "revision": "r8-kaigo",
      "revision_name": "令和8年度介護報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "dt-ninzu",
          "text": "この場合の利用者数は、１月間（暦月）の利用者数の平均を用いる。",
          "ask": "q_nv_douitsu_tatemono",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-roken-roki36",
            "n2-roki36-r6-shinkyu"
          ]
        },
        {
          "kind": "requirements",
          "id": "dt-ritsu",
          "text": "1回につき所定単位数の100分の90に相当する単位数を算定し、指定訪問看護事業所における1月当たりの利用者が同一敷地内建物等に50人以上居住する建物に居住する利用者に対して、指定訪問看護を行った場合は、1回につき所定単位数の100分の85に相当する単位数を算定する。",
          "ask": "q_nv_douitsu_tatemono",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-kokuji19-genko",
            "n2-roken-kokuji19"
          ]
        },
        {
          "kind": "requirements",
          "id": "dt-teigi",
          "text": "当該指定訪問介護事業所と構造上又は外形上、一体的な建築物及び同一敷地内並びに隣接する敷地（当該指定訪問介護事業所と建築物が道路等を挟んで設置している場合を含む。）にある建築物のうち効率的なサービス提供が可能なものを指すものである。",
          "ask": "q_nv_douitsu_tatemono",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-roken-roki36",
            "n2-roki36-r6-shinkyu"
          ]
        }
      ],
      "we_do_not_say": "算定できます、とは言わない。要件を並べ、どれが未確認かを示すところまで。 何割減算になるかは、人数を数えたあとの話である。",
      "sources": [
        "mhlw-santei-kouzou-r8",
        "n2-roken-roki36",
        "n2-roki36-r6-shinkyu",
        "mhlw-kokuji19-genko",
        "n2-roken-kokuji19"
      ],
      "beppyo7": null
    },
    {
      "id": "kaigo-kasan-chiiki",
      "kind": "加算",
      "insurance": "介護",
      "name": "特別地域訪問看護加算 / 中山間地域等における小規模事業所加算 / 中山間地域等に居住する者へのサービス提供加算",
      "effect": {
        "type": "率",
        "value": "加算率は未取得。算定構造の表からは読み取れなかった。",
        "confirmed": false,
        "unconfirmed_reason": "令和8年6月施行の算定構造 PDF を、要約経由で読んだ値である。同じ PDF を二度読ませたところ、緊急時訪問看護加算と特別管理加算の単位数が入れ替わって出た(conflicts: santei-kouzou-r8-yomitori 参照)。読み取りが安定していないので、原本の表を人が見て確定するまで確定にしない。",
        "source_ref": [
          "mhlw-santei-kouzou-r8"
        ]
      },
      "revision": "r8-kaigo",
      "revision_name": "令和8年度介護報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "ch-shitei",
          "text": "特別地域訪問看護加算として、イ及びロについては1回につき所定単位数の100分の15に相当する単位数を、ハについては1月につき所定単位数の100分の15に相当する単位数を所定単位数に加算する。",
          "ask": "q_nv_chiiki",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-kokuji19-genko",
            "n2-hyogo-tebiki-r6",
            "n2-roken-kokuji19"
          ]
        },
        {
          "kind": "requirements",
          "id": "ch-idou",
          "text": "通常の事業の実施地域(指定居宅サービス基準第73条第5号に規定する通常の事業の実施地域をいう。)を越えて、指定訪問看護を行った場合は、イ及びロについては1回につき所定単位数の100分の5に相当する単位数を、ハについては1月につき所定単位数の100分の5に相当する単位数を所定単位数に加算する。",
          "ask": "q_nv_chiiki",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-kokuji19-genko",
            "n2-hyogo-tebiki-r6",
            "n2-roken-kokuji19"
          ]
        },
        {
          "kind": "requirements",
          "id": "ch-chusankan",
          "text": "イ及びロについては1回につき所定単位数の100分の10に相当する単位数を、ハについては1月につき所定単位数の100分の10に相当する単位数を所定単位数に加算する。",
          "ask": "q_nv_chiiki",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-kokuji19-genko",
            "n2-hyogo-tebiki-r6",
            "n2-roken-kokuji19"
          ]
        },
        {
          "kind": "requirements",
          "id": "ch-shotei",
          "text": "この場合の所定単位数には緊急時訪問看護加算、特別管理加算及びターミナルケア加算を含まないこと。",
          "ask": "q_nv_chiiki",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-roki36-r6-shinkyu",
            "n2-roken-roki36"
          ]
        },
        {
          "kind": "requirements",
          "id": "ch-chusankan-kijun",
          "text": "一月当たり延訪問回数が百回以下の指定訪問看護事業所であること。",
          "ask": "q_nv_chiiki",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-kokuji96-tdoc",
            "n2-roken-kokuji96"
          ]
        }
      ],
      "we_do_not_say": "算定できます、とは言わない。要件を並べ、どれが未確認かを示すところまで。",
      "sources": [
        "mhlw-santei-kouzou-r8",
        "mhlw-kokuji19-genko",
        "n2-hyogo-tebiki-r6",
        "n2-roken-kokuji19",
        "n2-roki36-r6-shinkyu",
        "n2-roken-roki36",
        "n2-kokuji96-tdoc",
        "n2-roken-kokuji96"
      ],
      "beppyo7": null
    },
    {
      "id": "kaigo-genzan-iryo-shiji-nissuu",
      "kind": "減算",
      "insurance": "介護",
      "name": "医療保険の訪問看護指示期間の日数につき減算",
      "effect": {
        "type": "単位",
        "value": "1日につき −97単位",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-santei-kouzou-r8",
          "mhlw-001195509"
        ]
      },
      "revision": "r8-kaigo",
      "revision_name": "令和8年度介護報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "iryo-shiji-kikan",
          "text": "当該指示の日数に応じて、1日につき97単位を所定単位数から減算する。",
          "ask": "q_nv_tokubetsu_shiji",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-kokuji19-genko",
            "mhlw-santei-kouzou-r8",
            "n2-roken-kokuji19",
            "n2-hyogo-tebiki-r6"
          ]
        }
      ],
      "we_do_not_say": "減算に該当します、とは言わない。指示期間の日数が数えられているかを見るところまで。",
      "sources": [
        "mhlw-santei-kouzou-r8",
        "mhlw-001195509",
        "mhlw-kokuji19-genko",
        "n2-roken-kokuji19",
        "n2-hyogo-tebiki-r6"
      ],
      "beppyo7": null
    },
    {
      "id": "kaigo-kasan-renkei-kyoka",
      "kind": "加算",
      "insurance": "介護",
      "name": "看護・介護職員連携強化加算",
      "effect": {
        "type": "単位",
        "value": "1月につき +250単位",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-santei-kouzou-r8",
          "mhlw-001195509",
          "mhlw-santei-kouzou-r6june"
        ]
      },
      "revision": "r8-kaigo",
      "revision_name": "令和8年度介護報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "renkei-youken",
          "text": "当該加算は訪問看護が24時間行える体制を整えている事業所として緊急時訪問看護加算の届け出をしている場合に算定可能である。",
          "ask": "q_nv_renkei_kyoka",
          "confirmed": false,
          "unconfirmed_reason": "一致したのは二つの secondary(全老健の統合版と兵庫県の手引)だけ。老企第36号のこの箇所は令和6年の新旧対照表で(略)とされ、厚労省の原文とは照合できていない。discipline の『二つの資料の一致』には数えない(2026-09-26 番人)。",
          "source_ref": [
            "n2-roken-roki36",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "renkei-naiyou",
          "text": "たんの吸引等に係る計画書や報告書の作成及び緊急時等の対応についての助言を行うとともに当該訪問介護員等に同行し、利用者の居宅において業務の実施状況について確認した場合、又は利用者に対する安全なサービス提供体制整備や連携体制確保のための会議に出席した場合に算定する。",
          "ask": "q_nv_renkei_kyoka",
          "confirmed": false,
          "unconfirmed_reason": "一致したのは二つの secondary(全老健の統合版と兵庫県の手引)だけ。老企第36号のこの箇所は令和6年の新旧対照表で(略)とされ、厚労省の原文とは照合できていない。discipline の『二つの資料の一致』には数えない(2026-09-26 番人)。",
          "source_ref": [
            "n2-roken-roki36",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "renkei-kokuji",
          "text": "社会福祉士及び介護福祉士法(昭和62年法律第30号)第48条の3第1項の登録又は同法附則第27条第1項の登録を受けた指定訪問介護事業所と連携し",
          "ask": "q_nv_renkei_kyoka",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-kokuji19-genko",
            "n2-roken-kokuji19"
          ]
        }
      ],
      "we_do_not_say": "算定できます、とは言わない。要件を並べ、どれが未確認かを示すところまで。",
      "sources": [
        "mhlw-santei-kouzou-r8",
        "mhlw-001195509",
        "n2-roken-roki36",
        "n2-hyogo-tebiki-r6",
        "mhlw-kokuji19-genko",
        "n2-roken-kokuji19"
      ],
      "beppyo7": null
    },
    {
      "id": "kaigo-kasan-shogu-kaizen",
      "kind": "加算",
      "insurance": "介護",
      "name": "介護職員等処遇改善加算(令和8年度臨時改定で訪問看護に新設)",
      "effect": {
        "type": "率",
        "value": "1月につき +所定単位×18/1000",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-santei-kouzou-r8",
          "mhlw-r8-kaigo-index"
        ]
      },
      "revision": "r8-kaigo",
      "revision_name": "令和8年度介護報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "shogu-todokede",
          "text": "介護職員等処遇改善計画書を作成し、全ての職員に周知し、都道府県知事に届け出ていること。",
          "ask": "q_nv_todokede",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-kokuji95-tdoc",
            "n2-roken-kokuji95"
          ]
        },
        {
          "kind": "requirements",
          "id": "shogu-kouzou",
          "text": "ケアプランデータ連携システムを利用していること。",
          "ask": "q_nv_shogu_careplan",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-kokuji95-tdoc",
            "n2-roken-kokuji95"
          ]
        },
        {
          "kind": "requirements",
          "id": "shogu-chingin",
          "text": "介護職員等処遇改善加算の算定額に相当する賃金改善を実施すること。",
          "ask": "q_nv_todokede",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-kokuji95-tdoc",
            "n2-roken-kokuji95"
          ]
        },
        {
          "kind": "requirements",
          "id": "shogu-ritsu",
          "text": "イからリまでにより算定した単位数の1000分の18に相当する単位数を所定単位数に加算する。",
          "ask": "q_nv_todokede",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-kokuji19-genko",
            "n2-r8-kokuji87",
            "n2-roken-kokuji19"
          ]
        },
        {
          "kind": "requirements",
          "id": "shogu-qa-riyou",
          "text": "ケアプランデータ連携システムへの加入だけではなく、利用することが必要であり、実績報告書において、利用実績について記載することとする。",
          "ask": "q_nv_shogu_careplan",
          "confirmed": false,
          "unconfirmed_reason": "一致を確かめられたのは 処遇改善加算Q&A 第1版(001675711) の1資料だけ。Q&A(第1版)の1資料だけ。兵庫県の手引は令和6年6月のもので令和8年の特例要件を載せていない。",
          "source_ref": [
            "n2-r8-shogu-qa1"
          ]
        },
        {
          "kind": "requirements",
          "id": "shogu-ryuiji",
          "text": "訪問介護と同様であるので、２の(25)を参照されたい。",
          "ask": "q_nv_todokede",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-roki36-r8-shinkyu",
            "n2-roken-roki36"
          ]
        }
      ],
      "we_do_not_say": "算定できます、とは言わない。届出の状態と、要件のどれが未確認かを示すところまで。",
      "sources": [
        "mhlw-santei-kouzou-r8",
        "mhlw-r8-kaigo-index",
        "n2-kokuji95-tdoc",
        "n2-roken-kokuji95",
        "mhlw-kokuji19-genko",
        "n2-r8-kokuji87",
        "n2-roken-kokuji19",
        "n2-r8-shogu-qa1",
        "n2-roki36-r8-shinkyu",
        "n2-roken-roki36"
      ],
      "beppyo7": null
    },
    {
      "id": "iryo-kihon-ii",
      "kind": "療養費",
      "insurance": "医療",
      "name": "訪問看護基本療養費(Ⅱ)(同一建物居住者)",
      "effect": {
        "type": "円",
        "value": "イ 保健師、助産師又は看護師 同一日に2人 週3日目まで5,550円・週4日目以降6,550円 / 3人以上9人以下 2,780円・3,280円 / 10人以上19人以下 月20日目まで2,760円・月21日目以降2,660円 / 20人以上49人以下 2,710円・2,610円 / 50人以上 2,610円・2,510円。ロ 准看護師 5,050円・6,050円 / 2,530円・3,030円 / 2,520円・2,420円 / 2,470円・2,370円 / 2,370円・2,270円。ハ 専門の研修を受けた看護師 12,850円。ニ 理学療法士、作業療法士又は言語聴覚士 5,550円 / 2,780円 / 2,760円・2,660円 / 2,710円・2,610円 / 2,610円・2,510円。1日につき",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-r8-kokuji74",
          "mhlw-santei-houhou-genko"
        ]
      },
      "revision": "r8-iryo",
      "revision_name": "令和8年度診療報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "kihon2-jikan",
          "text": "2(ハを除く)は、30分以上を標準とし、20分を下回らない時間の指定訪問看護を実施し、それを訪問看護記録書に記載して算定する(注3)。",
          "ask": "q_nv_douitsu_tatemono",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-kokuji74",
            "mhlw-santei-houhou-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "kihon2-shu3",
          "text": "基本療養費(Ⅰ)(ハを除く)・精神科(Ⅰ)(Ⅲ)を算定する日と合わせて週3日が限度(別に厚生労働大臣が定める疾病等の利用者を除く)(注3)。",
          "ask": "q_nv_beppyo7",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-kokuji74",
            "mhlw-santei-houhou-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "kihon2-teigi",
          "text": "ウア又はイの集合住宅等の建物が同一敷地内にある場合であって、これらの集合住宅等に居住、入居又は入所している複数の利用者",
          "ask": "q_nv_douitsu_tatemono",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。 告示(算定方法)注3も『同一の建物又は同一の敷地内の建物に居住する他の者』と同一敷地内を含めるが、文言は違う。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        },
        {
          "kind": "requirements",
          "id": "kihon2-qa-shikichi",
          "text": "同一地番の敷地内である場合や、同一地番ではなくとも公道に出ずに敷地を行き来できる等一体的に利用されている敷地である場合が該当する。",
          "ask": "q_nv_douitsu_tatemono",
          "confirmed": false,
          "unconfirmed_reason": "疑義解釈資料(事務連絡、tier agency)1件。通知・告示の本文ではなく厚生労働省の解釈であり、確定の扱いにしない。",
          "source_ref": [
            "mhlw-r8-gigi-01"
          ]
        },
        {
          "kind": "requirements",
          "id": "kihon2-gassan",
          "text": "イ前回提供した指定訪問看護の終了から２時間未満の間隔で、提供時間が20分以上30分未満の指定訪問看護を実施する場合（緊急に指定訪問看護を行う場合を除く。）は、それぞれの時間を合算して１回の指定訪問看護の実施として取り扱うこと。",
          "ask": "q_nv_jikan",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        }
      ],
      "we_do_not_say": "要件を並べるところまで。算定の可否は判定しない。",
      "sources": [
        "mhlw-r8-kokuji74",
        "mhlw-santei-houhou-genko",
        "mhlw-r8-hohatsu0305-19",
        "mhlw-r8-gigi-01"
      ],
      "beppyo7": null
    },
    {
      "id": "iryo-kihon-iii",
      "kind": "療養費",
      "insurance": "医療",
      "name": "訪問看護基本療養費(Ⅲ)(入院中の外泊時)",
      "effect": {
        "type": "円",
        "value": "8,500円",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-r8-kokuji74",
          "mhlw-santei-houhou-genko"
        ]
      },
      "revision": "r8-iryo",
      "revision_name": "令和8年度診療報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "kihon3-gaihaku",
          "text": "対象は入院中で一時的に外泊している者のうち別に厚生労働大臣が定める者に限られる(注5)。",
          "ask": "q_nv_beppyo7",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-kokuji74",
            "mhlw-santei-houhou-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "kihon3-1paku",
          "text": "この場合の外泊とは、１泊２日以上の外泊のことをいう。",
          "ask": "q_nv_beppyo7",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        }
      ],
      "we_do_not_say": "要件を並べるところまで。算定の可否は判定しない。",
      "sources": [
        "mhlw-r8-kokuji74",
        "mhlw-santei-houhou-genko",
        "mhlw-r8-hohatsu0305-19"
      ],
      "beppyo7": null
    },
    {
      "id": "iryo-kasan-nanbyo-fukusu",
      "kind": "加算",
      "insurance": "医療",
      "name": "難病等複数回訪問加算(1日につき)",
      "effect": {
        "type": "円",
        "value": "1日に2回: 同一建物内1人又は2人 4,500円 / 3人以上9人以下 4,000円 / 10人以上19人以下 3,700円 / 20人以上49人以下 3,500円 / 50人以上 3,300円。1日に3回以上: 1人又は2人 8,000円 / 3人以上9人以下 月20日目まで7,200円・月21日目以降6,900円 / 10人以上19人以下 6,300円・5,200円 / 20人以上49人以下 4,800円・3,500円 / 50人以上 4,100円・3,000円",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-r8-kokuji74",
          "mhlw-santei-houhou-genko"
        ]
      },
      "revision": "r8-iryo",
      "revision_name": "令和8年度診療報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "nanbyo-taisho",
          "text": "対象は別表第七等の疾病等の利用者、又は特別訪問看護指示書の交付を受けた利用者(注7)。",
          "ask": "q_nv_beppyo7",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-kokuji74",
            "mhlw-santei-houhou-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "nanbyo-kubun",
          "text": "(２)訪問看護基本療養費(Ⅱ)を算定する場合にあっては、同一建物居住者で同一日に、当該加算、精神科複数回訪問加算又は包括型訪問看護療養費を算定する利用者の合計人数及び１日当たりの指定訪問看護の実施回数に応じて算定する。また、１日に３回以上の指定訪問看護を実施する場合で同一建物居住者の合計人数が３人以上の場合における「月20日目まで」と「月21日目以降」の区分については、算定する日における、月の初日以降に当該加算、精神科複数回訪問加算又は包括型訪問看護療養費のいずれかを算定した日数に応じて、該当する区分を算定する。",
          "ask": "q_nv_douitsu_tatemono",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        }
      ],
      "we_do_not_say": "要件を並べるところまで。算定の可否は判定しない。",
      "sources": [
        "mhlw-r8-kokuji74",
        "mhlw-santei-houhou-genko",
        "mhlw-r8-hohatsu0305-19"
      ],
      "beppyo7": null
    },
    {
      "id": "iryo-kasan-tokubetsu-chiiki",
      "kind": "加算",
      "insurance": "医療",
      "name": "特別地域訪問看護加算",
      "effect": {
        "type": "率",
        "value": "所定額の100分の50",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-r8-kokuji74",
          "mhlw-santei-houhou-genko"
        ]
      },
      "revision": "r8-iryo",
      "revision_name": "令和8年度診療報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "chiiki-jikan",
          "text": "移動時間(最も合理的な経路及び方法による)と、往復と実施時間の合計を記録で示せるか(注8 イ・ロ)。",
          "ask": "q_nv_chiiki",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-kokuji74",
            "mhlw-santei-houhou-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "chiiki-kakunin",
          "text": "(２)特別地域訪問看護加算を算定する訪問看護ステーションは、その所在地又は利用者の家庭の所在地が特別地域に該当するか否かについては、地方厚生（支）局に確認すること。",
          "ask": "q_nv_chiiki",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        },
        {
          "kind": "requirements",
          "id": "chiiki-jijo",
          "text": "交通事情等の特別の事情により訪問に要した時間が片道１時間以上となった場合は該当しない。",
          "ask": "q_nv_chiiki",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        },
        {
          "kind": "requirements",
          "id": "chiiki-qa-satellite",
          "text": "（答）算定不可。",
          "ask": "q_nv_chiiki",
          "confirmed": false,
          "unconfirmed_reason": "疑義解釈資料(事務連絡、tier agency)1件。通知・告示の本文ではなく厚生労働省の解釈であり、確定の扱いにしない。",
          "source_ref": [
            "mhlw-r8-gigi-01"
          ]
        }
      ],
      "we_do_not_say": "要件を並べるところまで。算定の可否は判定しない。",
      "sources": [
        "mhlw-r8-kokuji74",
        "mhlw-santei-houhou-genko",
        "mhlw-r8-hohatsu0305-19",
        "mhlw-r8-gigi-01"
      ],
      "beppyo7": null
    },
    {
      "id": "iryo-kasan-chojikan",
      "kind": "加算",
      "insurance": "医療",
      "name": "長時間訪問看護加算",
      "effect": {
        "type": "円",
        "value": "5,200円(週1日、別に定める者は週3日を限度)",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-r8-kokuji74",
          "mhlw-santei-houhou-genko"
        ]
      },
      "revision": "r8-iryo",
      "revision_name": "令和8年度診療報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "chojikan-taisho",
          "text": "対象は別に厚生労働大臣が定める長時間の訪問を要する者(注10)。",
          "ask": "q_nv_chojikan",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-kokuji74",
            "mhlw-santei-houhou-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "chojikan-90pun",
          "text": "１回の指定訪問看護の時間が90分を超えた場合について算定するものであり、週１回（基準告示第２の３の（２）に規定する者にあっては週３回）に限り算定できるものとする。",
          "ask": "q_nv_chojikan",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。 告示(算定方法)注10は『長時間にわたる指定訪問看護』『週1日(…週3日)を限度』で、90分の数字は通知にしかない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        },
        {
          "kind": "requirements",
          "id": "chojikan-taisho-list",
          "text": "(１)厚生労働大臣が定める長時間の訪問を要する者長時間の訪問看護を要する利用者であって、次のいずれかに該当するものイ十五歳未満の超重症児又は準超重症児ロ特掲診療料の施設基準等別表第八に掲げる者ハ特別訪問看護指示書又は精神科特別訪問看護指示書に係る指定訪問看護を受けている者(２)厚生労働大臣が定める者イ十五歳未満の超重症児又は準超重症児ロ十五歳未満の小児であって、特掲診療料の施設基準等別表第八に掲げる者",
          "ask": "q_nv_chojikan",
          "confirmed": false,
          "unconfirmed_reason": "施設基準告示(第103号)の法令等データベース版1件の本文。この部分は告示第75号(改正告示 PDF)では『(略)』で、改正されていない。二つ目の資料の同じ文言に当たれていない。",
          "source_ref": [
            "mhlw-kokuji103-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "chojikan-chojushoji",
          "text": "判定スコアが10以上のものをいう。",
          "ask": "q_nv_chojikan",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-hohatsu0305-19",
            "mhlw-r8-hoihatsu0305-9"
          ]
        }
      ],
      "we_do_not_say": "要件を並べるところまで。算定の可否は判定しない。",
      "sources": [
        "mhlw-r8-kokuji74",
        "mhlw-santei-houhou-genko",
        "mhlw-r8-hohatsu0305-19",
        "mhlw-kokuji103-genko",
        "mhlw-r8-hoihatsu0305-9"
      ],
      "beppyo7": null
    },
    {
      "id": "iryo-kasan-fukusumei",
      "kind": "加算",
      "insurance": "医療",
      "name": "複数名訪問看護加算(1日につき)",
      "effect": {
        "type": "円",
        "value": "イ 看護職員+他の看護師等(准看護師除く): 同一建物内1人又は2人 4,500円 / 3人以上9人以下 4,000円 / 10人以上19人以下 3,400円 / 20人以上49人以下 3,000円 / 50人以上 2,700円。ロ 看護職員+准看護師: 3,800円 / 3,400円 / 2,800円 / 2,500円 / 2,200円。ハ 看護職員+その他職員(別に定める場合を除く): 3,000円 / 2,700円 / 2,100円 / 1,900円 / 1,600円。ニ 看護職員+その他職員(別に定める場合): 1日1回 3,000円 / 2,700円 / 2,100円 / 1,900円 / 1,600円、1日2回 6,000円 / 5,400円 / 3,800円 / 3,450円 / 3,300円、1日3回以上 10,000円 / 9,000円 / 5,500円 / 4,800円 / 4,500円",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-r8-kokuji74",
          "mhlw-santei-houhou-genko"
        ]
      },
      "revision": "r8-iryo",
      "revision_name": "令和8年度診療報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "fukusu-doui",
          "text": "利用者又はその家族等の同意を得ていること(注12)。",
          "ask": "q_nv_fukusu",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-kokuji74",
            "mhlw-santei-houhou-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "fukusu-taisho",
          "text": "対象は同時に複数名の訪問が必要な者として別に厚生労働大臣が定める者(注12)。",
          "ask": "q_nv_fukusu",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-kokuji74",
            "mhlw-santei-houhou-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "fukusu-taisho-list",
          "text": "(１)訪問看護基本療養費の注12に規定する複数名訪問看護加算に係る厚生労働大臣が定める者一人の保健師、助産師、看護師、准看護師、理学療法士、作業療法士又は言語聴覚士(以下「看護師等」という。)による指定訪問看護が困難な利用者であって、次のいずれかに該当するものイ特掲診療料の施設基準等別表第七に掲げる疾病等の者ロ特掲診療料の施設基準等別表第八に掲げる者ハ特別訪問看護指示書に係る指定訪問看護を受けている者ニ暴力行為、著しい迷惑行為、器物破損行為等が認められる者ホ利用者の身体的理由により一人の看護師等による訪問看護が困難と認められる者(訪問看護基本療養費の注12のハに規定する場合に限る。)ヘその他利用者の状況等から判断して、イからホまでのいずれかに準ずると認められる者(訪問看護基本療養費の注12のハに規定する場合に限る。)(２)訪問看護基本療養費の注12のハ及びニに規定する厚生労働大臣が定める場合一人の看護師等による指定訪問看護が困難な利用者であって、次のいずれかに該当するものに対し、指定訪問看護を行った場合イ特掲診療料の施設基準等別表第七に掲げる疾病等の者ロ特掲診療料の施設基準等別表第八に掲げる者ハ特別訪問看護指示書に係る指定訪問看護を受けている者",
          "ask": "q_nv_fukusu",
          "confirmed": false,
          "unconfirmed_reason": "施設基準告示(第103号)の法令等データベース版1件の本文。この部分は告示第75号(改正告示 PDF)では『(略)』で、改正されていない。二つ目の資料の同じ文言に当たれていない。",
          "source_ref": [
            "mhlw-kokuji103-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "fukusu-shu",
          "text": "ア看護職員が他の看護師等（准看護師を除く。）と同時に指定訪問看護を行う場合は、週１日に限り、注12のイを算定する。",
          "ask": "q_nv_fukusu",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        },
        {
          "kind": "requirements",
          "id": "fukusu-taizai",
          "text": "(４)看護職員と同行するその他職員は、常に同行の必要はないが、必ず利用者の居宅において両者が同時に滞在する一定の時間が確保された場合に算定できる。",
          "ask": "q_nv_fukusu",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        }
      ],
      "we_do_not_say": "要件を並べるところまで。算定の可否は判定しない。",
      "sources": [
        "mhlw-r8-kokuji74",
        "mhlw-santei-houhou-genko",
        "mhlw-kokuji103-genko",
        "mhlw-r8-hohatsu0305-19"
      ],
      "beppyo7": null
    },
    {
      "id": "iryo-kasan-yakan-shinya",
      "kind": "加算",
      "insurance": "医療",
      "name": "夜間・早朝訪問看護加算 / 深夜訪問看護加算(1日につき)",
      "effect": {
        "type": "円",
        "value": "夜間・早朝: 同一建物内1人又は2人 2,100円 / 3人以上9人以下 月15日目まで2,100円・月16日目以降1,900円 / 10人以上19人以下 1,800円・1,300円 / 20人以上49人以下 1,200円・950円 / 50人以上 1,000円・800円。深夜: 1人又は2人 4,200円 / 3人以上9人以下 4,200円・4,000円 / 10人以上19人以下 3,900円・2,300円 / 20人以上49人以下 2,100円・1,500円 / 50人以上 1,800円・1,300円",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-r8-kokuji74",
          "mhlw-santei-houhou-genko"
        ]
      },
      "revision": "r8-iryo",
      "revision_name": "令和8年度診療報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "yakan-jikoku",
          "text": "実際の訪問の時刻が記録から辿れるか(夜間・早朝・深夜の時間帯の定義は注13・注14)。",
          "ask": "q_nv_yakan",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-kokuji74",
            "mhlw-santei-houhou-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "yakan-motome",
          "text": "(２)(１)の場合については、利用者又はその家族等の求めに応じて、当該時間に指定訪問看護を行った場合にのみ算定できるものであり、訪問看護ステーションの都合により、当該時間に指定訪問看護を行った場合には算定できない。",
          "ask": "q_nv_yakan",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        }
      ],
      "we_do_not_say": "要件を並べるところまで。算定の可否は判定しない。",
      "sources": [
        "mhlw-r8-kokuji74",
        "mhlw-santei-houhou-genko",
        "mhlw-r8-hohatsu0305-19"
      ],
      "beppyo7": null
    },
    {
      "id": "iryo-seishin-kihon",
      "kind": "療養費",
      "insurance": "医療",
      "name": "精神科訪問看護基本療養費(Ⅰ)(Ⅲ)(Ⅳ)(1日につき)",
      "effect": {
        "type": "円",
        "value": "(Ⅰ) 保健師・看護師・作業療法士 週3日目まで30分以上5,550円・30分未満4,250円 / 週4日目以降30分以上6,550円・30分未満5,100円。准看護師 5,050円・3,870円 / 6,050円・4,720円。(Ⅱ)は削除。(Ⅲ)(同一建物居住者) イ 保健師、看護師又は作業療法士 同一日に2人 5,550円・4,250円・6,550円・5,100円 / 3人以上9人以下 2,780円・2,130円・3,280円・2,550円 / 10人以上19人以下 2,760円・2,110円・2,660円・2,010円 / 20人以上49人以下 2,710円・2,070円・2,610円・1,970円 / 50人以上 2,610円・1,990円・2,510円・1,890円。ロ 准看護師 5,050円・3,870円・6,050円・4,720円 / 2,530円・1,940円・3,030円・2,360円 / 2,520円・1,930円・2,420円・1,830円 / 2,470円・1,890円・2,370円・1,790円 / 2,370円・1,810円・2,270円・1,710円。(Ⅳ) 8,500円",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-r8-kokuji74",
          "mhlw-santei-houhou-genko"
        ]
      },
      "revision": "r8-iryo",
      "revision_name": "令和8年度診療報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "seishin-todokede",
          "text": "別に厚生労働大臣が定める基準に適合するとして地方厚生局長等に届け出ていること(注1)。",
          "ask": "q_nv_seishinka",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-kokuji74",
            "mhlw-santei-houhou-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "seishin-keiken",
          "text": "(２)精神疾患を有する者に対する訪問看護の経験を１年以上有する者",
          "ask": "q_nv_seishin_keiken",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-hohatsu0305-19",
            "mhlw-r8-hoihatsu0305-9"
          ]
        },
        {
          "kind": "requirements",
          "id": "seishin-gaf",
          "text": "月の初日の指定訪問看護時におけるＧＡＦ尺度により判定した値",
          "ask": "q_nv_seishinka",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-hohatsu0305-19",
            "mhlw-r8-hoihatsu0327-10"
          ]
        }
      ],
      "we_do_not_say": "要件を並べるところまで。算定の可否は判定しない。",
      "sources": [
        "mhlw-r8-kokuji74",
        "mhlw-santei-houhou-genko",
        "mhlw-r8-hohatsu0305-19",
        "mhlw-r8-hoihatsu0305-9",
        "mhlw-r8-hoihatsu0327-10"
      ],
      "beppyo7": null
    },
    {
      "id": "iryo-seishin-kasan",
      "kind": "加算",
      "insurance": "医療",
      "name": "精神科訪問看護基本療養費の加算(精神科緊急・長時間精神科・複数名精神科・精神科複数回 等)",
      "effect": {
        "type": "円",
        "value": "特別地域訪問看護加算 100分の50。精神科緊急訪問看護加算 月14日目まで2,650円・月15日目以降2,000円。長時間精神科訪問看護加算 5,200円。複数名精神科訪問看護加算 イ 1日1回 4,500円 / 4,000円 / 3,400円 / 3,000円 / 2,700円、1日2回 9,000円 / 8,100円 / 6,880円 / 6,070円 / 5,460円、1日3回以上 14,500円 / 13,000円 / 11,050円 / 9,750円 / 8,770円。ロ 1日1回 3,800円 / 3,400円 / 2,800円 / 2,500円 / 2,200円、1日2回 7,600円 / 6,800円 / 5,600円 / 5,000円 / 4,400円、1日3回以上 12,400円 / 11,200円 / 9,220円 / 8,230円 / 7,240円。ハ 3,000円 / 2,700円 / 2,100円 / 1,900円 / 1,600円。夜間・早朝・深夜・精神科複数回訪問加算は 01 と同じ額",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-r8-kokuji74",
          "mhlw-santei-houhou-genko"
        ]
      },
      "revision": "r8-iryo",
      "revision_name": "令和8年度診療報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "seishin-fukusukai",
          "text": "精神科複数回訪問加算は、精神科在宅患者支援管理料を算定する利用者に主治医の指示で1日2回以上訪問した場合(注11)。",
          "ask": "q_nv_seishinka",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-kokuji74",
            "mhlw-santei-houhou-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "seishin-fukusumei-shiji",
          "text": "(４)当該加算は、医師が複数名訪問の必要性があると認め、精神科訪問看護指示書にその旨の記載がある場合に算定する。",
          "ask": "q_nv_seishinka",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        }
      ],
      "we_do_not_say": "要件を並べるところまで。算定の可否は判定しない。",
      "sources": [
        "mhlw-r8-kokuji74",
        "mhlw-santei-houhou-genko",
        "mhlw-r8-hohatsu0305-19"
      ],
      "beppyo7": null
    },
    {
      "id": "iryo-kasan-taiin",
      "kind": "加算",
      "insurance": "医療",
      "name": "退院時共同指導加算 / 特別管理指導加算 / 退院支援指導加算",
      "effect": {
        "type": "円",
        "value": "退院時共同指導加算 8,000円(退院又は退所につき1回、別に定める疾病等は2回)。特別管理指導加算 更に2,000円。退院支援指導加算 6,000円(長時間にわたる指導は8,400円)",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-r8-kokuji74",
          "mhlw-santei-houhou-genko"
        ]
      },
      "revision": "r8-iryo",
      "revision_name": "令和8年度診療報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "taiin-bunsho",
          "text": "退院時共同指導は、主治医又は職員と共同して在宅での療養上必要な指導を行い、その内容を文書により提供していること(注4)。",
          "ask": "q_nv_taiin_kyodo",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-kokuji74",
            "mhlw-santei-houhou-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "taiin-junkango",
          "text": "看護師等から准看護師は除かれている(注4・注7)。",
          "ask": "q_nv_taiin_kyodo",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-kokuji74",
            "mhlw-santei-houhou-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "taiin-kaisu",
          "text": "初日の指定訪問看護の実施時に１回に限り算定する。ただし、基準告示第２の１に規定する疾病等の利用者については、複数日に指導を実施した場合に限り、２回に限り算定できる。",
          "ask": "q_nv_taiin_kyodo",
          "confirmed": false,
          "unconfirmed_reason": "text の文言全体は二つ目の資料と一致しない。句ごとの照合: 算定方法告示(第67号)の法令等データベース版(法令等データベース dataId=84aa9734 pageNo=1)には『１回に限り』、『２回に限り』が同じ文言である。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19",
            "mhlw-santei-houhou-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "taiin-video",
          "text": "(６)退院時共同指導は、リアルタイムでのコミュニケーション（以下「ビデオ通話」という。）が可能な機器を用いて共同指導した場合でも算定可能である。(７)(６)において、利用者の個人情報をビデオ通話の画面上で共有する際は、利用者の同意を得ていること。また、保険医療機関の電子カルテなどを含む医療情報システムと共通のネットワーク上の端末において共同指導を実施する場合には、厚生労働省「医療情報システムの安全管理に関するガイドライン」に対応していること。",
          "ask": "q_nv_taiin_kyodo",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        },
        {
          "kind": "requirements",
          "id": "taiin-shien",
          "text": "１回の退院支援指導の時間が90分を超えた場合又は複数回の退院支援指導の合計時間が90分を超えた場合に限る。",
          "ask": "q_nv_taiin_shien",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。 告示(算定方法)注7 は『長時間にわたる療養上必要な指導』で、90分の数字は通知にしかない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        },
        {
          "kind": "requirements",
          "id": "taiin-shien-taisho",
          "text": "八訪問看護管理療養費の注7に規定する退院支援指導加算に係る厚生労働大臣が定める退院支援指導を要する者退院日に療養上の退院支援指導が必要な利用者であって、次のいずれかに該当するもの(１)特掲診療料の施設基準等別表第七に掲げる疾病等の者(２)特掲診療料の施設基準等別表第八に掲げる者(３)退院日の訪問看護が必要であると認められた者",
          "ask": "q_nv_taiin_shien",
          "confirmed": false,
          "unconfirmed_reason": "施設基準告示(第103号)の法令等データベース版1件の本文。この部分は告示第75号(改正告示 PDF)では『(略)』で、改正されていない。二つ目の資料の同じ文言に当たれていない。",
          "source_ref": [
            "mhlw-kokuji103-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "taiin-shien-shiji",
          "text": "(３)退院支援指導加算は、利用者の退院時に訪問看護指示書の交付を受けている場合に算定する。",
          "ask": "q_nv_taiin_shien",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        }
      ],
      "we_do_not_say": "要件を並べるところまで。算定の可否は判定しない。",
      "sources": [
        "mhlw-r8-kokuji74",
        "mhlw-santei-houhou-genko",
        "mhlw-r8-hohatsu0305-19",
        "mhlw-kokuji103-genko"
      ],
      "beppyo7": null
    },
    {
      "id": "iryo-kasan-renkei",
      "kind": "加算",
      "insurance": "医療",
      "name": "在宅患者連携指導加算 / 在宅患者緊急時等カンファレンス加算 / 訪問看護医療情報連携加算(令和8年新設)",
      "effect": {
        "type": "円",
        "value": "在宅患者連携指導加算 3,000円(月1回)。在宅患者緊急時等カンファレンス加算 2,000円(月2回)。訪問看護医療情報連携加算 1,000円(月1回、在宅患者連携指導加算を算定している場合は算定しない)",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-r8-kokuji74",
          "mhlw-santei-houhou-genko"
        ]
      },
      "revision": "r8-iryo",
      "revision_name": "令和8年度診療報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "renkei-heisan",
          "text": "訪問看護医療情報連携加算と在宅患者連携指導加算は同じ月に両方は取れない(注14 ただし書)。",
          "ask": "q_nv_renkei",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-kokuji74",
            "mhlw-santei-houhou-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "renkei-ict",
          "text": "訪問看護医療情報連携加算は、届出を行ったうえで、関係職種が ICT で記録した診療情報等を活用した計画的な管理が要る(注14)。",
          "ask": "q_nv_renkei",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-kokuji74",
            "mhlw-santei-houhou-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "renkei-2kai",
          "text": "月２回以上医療関係職種間で文書等（電子メール、ファクシミリでも可）により共有された診療情報を基に、利用者又はその家族等に対して指導等を行った場合に、月１回に限り算定する。",
          "ask": "q_nv_renkei",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        },
        {
          "kind": "requirements",
          "id": "renkei-kiroku",
          "text": "(６)他の医療関係職種から受けた診療情報等の内容及びその情報提供日、並びにその診療情報等を基に行った指導等の内容の要点及び指導日を訪問看護記録書に記載すること。",
          "ask": "q_nv_renkei",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        },
        {
          "kind": "requirements",
          "id": "conf-kaisu",
          "text": "月２回に限り算定すること。なお、複数の訪問看護ステーションのみが参加しカンファレンスを行った場合は、所定額は算定しないこと。",
          "ask": "q_nv_renkei",
          "confirmed": false,
          "unconfirmed_reason": "text の文言全体は二つ目の資料と一致しない。句ごとの照合: 算定方法告示(第67号)の法令等データベース版(法令等データベース dataId=84aa9734 pageNo=1)には『月２回に限り』が同じ文言である。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19",
            "mhlw-santei-houhou-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "conf-kiroku",
          "text": "(７)カンファレンスに参加した医療関係職種等の氏名、カンファレンスの要点、利用者に行った指導の要点及びカンファレンスを行った日を訪問看護記録書に記載すること。",
          "ask": "q_nv_renkei",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        },
        {
          "kind": "requirements",
          "id": "jrenkei-doui-kiroku",
          "text": "過去90日以内に記録された利用者の医療・ケアに関する情報（当該訪問看護ステーション及び当該訪問看護ステーションと特別の関係にある保険医療機関等が記録した情報を除く。）をＩＣＴを用いて取得した数が１つ以上であること。",
          "ask": "q_nv_ict_renkei",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。 告示(算定方法)注14 は同意と計画的な管理を書くが、同意の中身・記録・過去90日以内1つ以上は通知にしかない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        },
        {
          "kind": "requirements",
          "id": "jrenkei-kijun",
          "text": "在宅での療養を行っている利用者であって通院が困難なものの診療情報等について、電子情報処理組織を使用する方法その他の情報通信の技術を利用する方法を用いて常時確認できる体制を有し、関係機関と平時からの連携体制を構築していること。",
          "ask": "q_nv_ict_renkei",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-kokuji75",
            "mhlw-kokuji103-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "jrenkei-kikan5",
          "text": "(３)当該訪問看護ステーションと利用者の診療情報等を共有している連携機関（特別の関係にあるものを除く。）の数が、５以上であること。",
          "ask": "q_nv_ict_renkei",
          "confirmed": false,
          "unconfirmed_reason": "届出通知(保医発0305第9号、7/30 訂正後の PDF)1件の本文。施設基準告示(第103号)は抽象的な文言で、この数字・細目は届出通知にしかない。法令等データベースに同じ通知が見つからず、二つ目の資料と突き合わせられていない。",
          "source_ref": [
            "mhlw-r8-hoihatsu0305-9"
          ]
        },
        {
          "kind": "requirements",
          "id": "jrenkei-web-keika",
          "text": "令和八年五月三十一日において現に指定訪問看護事業者が、当該指定に係る訪問看護事業を行う事業所については、令和八年九月三十日までの間に限り",
          "ask": "q_nv_ict_renkei",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-kokuji103-genko",
            "mhlw-r8-kokuji75"
          ]
        }
      ],
      "we_do_not_say": "要件を並べるところまで。算定の可否は判定しない。",
      "sources": [
        "mhlw-r8-kokuji74",
        "mhlw-santei-houhou-genko",
        "mhlw-r8-hohatsu0305-19",
        "mhlw-r8-kokuji75",
        "mhlw-kokuji103-genko",
        "mhlw-r8-hoihatsu0305-9"
      ],
      "beppyo7": null
    },
    {
      "id": "iryo-kasan-kanri-sonota",
      "kind": "加算",
      "insurance": "医療",
      "name": "精神科重症患者支援管理連携加算 / 看護・介護職員連携強化加算 / 専門管理加算 / 訪問看護医療DX情報活用加算",
      "effect": {
        "type": "円",
        "value": "精神科重症患者支援管理連携加算 イ 8,400円・ロ 5,800円(月1回)。看護・介護職員連携強化加算 2,500円(月1回)。専門管理加算 イ 2,500円・ロ 2,500円(月1回)。訪問看護医療DX情報活用加算 50円(月1回)",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-r8-kokuji74",
          "mhlw-santei-houhou-genko"
        ]
      },
      "revision": "r8-iryo",
      "revision_name": "令和8年度診療報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "dx-shikaku",
          "text": "訪問看護医療DX情報活用加算は、届出を行い、電子資格確認で診療情報を取得等したうえで計画的な管理を行った場合(注13)。",
          "ask": "q_nv_dx",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-kokuji74",
            "mhlw-santei-houhou-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "senmon-kenshu",
          "text": "専門管理加算は、専門の研修を受けた看護師又は特定行為研修を修了した看護師による計画的な管理で、届出が要る(注12)。",
          "ask": "q_nv_tokutei_koui",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-kokuji74",
            "mhlw-santei-houhou-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "kaigo-renkei-24h",
          "text": "(３)24時間対応体制加算を届け出ている場合に算定可能である。",
          "ask": "q_nv_kakutan_renkei",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。 告示第103号 第二の九 も対象者を『二十四時間対応体制加算の届出を行っている訪問看護ステーションの利用者』と定めるが、文言は違う。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        },
        {
          "kind": "requirements",
          "id": "senmon-i",
          "text": "定期的（１月に１回以上）に指定訪問看護を行うとともに、当該利用者に係る指定訪問看護の実施に関する計画的な管理を行った場合に、月１回に限り算定する。",
          "ask": "q_nv_tokutei_koui",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        },
        {
          "kind": "requirements",
          "id": "senmon-kijun",
          "text": "特定行為のうち訪問看護において専門の管理を必要とするものに係る研修を修了した看護師が配置されていること",
          "ask": "q_nv_tokutei_koui",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-kokuji103-genko",
            "mhlw-r8-hoihatsu0305-9"
          ]
        },
        {
          "kind": "requirements",
          "id": "dx-kijun",
          "text": "第一条に規定する電子情報処理組織の使用による請求を行っている",
          "ask": "q_nv_dx",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-kokuji103-genko",
            "mhlw-r8-hoihatsu0305-9"
          ]
        },
        {
          "kind": "requirements",
          "id": "dx-kyotaku-doui",
          "text": "居宅同意取得型のオンライン資格確認等システム",
          "ask": "q_nv_dx",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-hohatsu0305-19",
            "mhlw-r8-hoihatsu0305-9"
          ]
        },
        {
          "kind": "requirements",
          "id": "seishin-juusho-kaisu",
          "text": "精神科在宅患者支援管理料２のイを算定する利用者においては週２回以上、２のロを算定する利用者においては月２回以上の精神科訪問看護を実施した場合に、月１回に限り加算し、１人の利用者に対し１つの訪問看護ステーションにおいてのみ算定できるものである。",
          "ask": "q_nv_seishinka",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        },
        {
          "kind": "requirements",
          "id": "kaigo-renkei-naiyou",
          "text": "(２)当該加算は、利用者の病状やその変化に合わせて、主治医の指示により、ア及びイの対応を行っている場合に算定する。ア喀痰吸引等に係る計画書や報告書の作成及び緊急時等の対応についての助言イ介護職員等に同行し、利用者の居宅において喀痰吸引等の業務の実施状況についての確認",
          "ask": "q_nv_kakutan_renkei",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        }
      ],
      "we_do_not_say": "要件を並べるところまで。算定の可否は判定しない。",
      "sources": [
        "mhlw-r8-kokuji74",
        "mhlw-santei-houhou-genko",
        "mhlw-r8-hohatsu0305-19",
        "mhlw-kokuji103-genko",
        "mhlw-r8-hoihatsu0305-9"
      ],
      "beppyo7": null
    },
    {
      "id": "iryo-joho-teikyo",
      "kind": "療養費",
      "insurance": "医療",
      "name": "訪問看護情報提供療養費1・2・3",
      "effect": {
        "type": "円",
        "value": "1: 1,500円 / 2: 1,500円 / 3: 1,500円",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-r8-kokuji74",
          "mhlw-santei-houhou-genko"
        ]
      },
      "revision": "r8-iryo",
      "revision_name": "令和8年度診療報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "joho-motome",
          "text": "1・2は相手方からの求めに応じて、指定訪問看護の状況を示す文書を添えて提供した場合(注1・注2)。",
          "ask": "q_nv_joho_teikyo",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-kokuji74",
            "mhlw-santei-houhou-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "joho1-2shukan",
          "text": "なお、指定訪問看護を行った日から２週間以内に、別紙様式１又は２の文書により、市町村等又は指定特定相談支援事業者等に対して情報を提供した場合に算定する。",
          "ask": "q_nv_joho_teikyo",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        },
        {
          "kind": "requirements",
          "id": "joho1-taisho",
          "text": "十訪問看護情報提供療養費の注1に規定する厚生労働大臣が定める疾病等の利用者(１)特掲診療料の施設基準等別表第七に掲げる疾病等の者(２)特掲診療料の施設基準等別表第八に掲げる者(３)精神障害を有する者又はその家族等(４)十八歳未満の児童",
          "ask": "q_nv_joho_teikyo",
          "confirmed": false,
          "unconfirmed_reason": "施設基準告示(第103号)の法令等データベース版1件の本文。この部分は告示第75号(改正告示 PDF)では『(略)』で、改正されていない。二つ目の資料の同じ文言に当たれていない。",
          "source_ref": [
            "mhlw-kokuji103-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "joho2-kaisu",
          "text": "利用者１人につき各年度１回に限り算定する。",
          "ask": "q_nv_joho_teikyo",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-hohatsu0305-19",
            "mhlw-santei-houhou-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "joho3-tokubetsu",
          "text": "(４)利用者が入院又は入所する保険医療機関等が、訪問看護ステーションと特別の関係にある場合及び主治医の所属する保険医療機関と同一の場合は算定できない。",
          "ask": "q_nv_joho_teikyo",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        },
        {
          "kind": "requirements",
          "id": "joho-qa-carer",
          "text": "（答）よい。",
          "ask": "q_nv_joho_teikyo",
          "confirmed": false,
          "unconfirmed_reason": "疑義解釈資料(事務連絡、tier agency)1件。通知・告示の本文ではなく厚生労働省の解釈であり、確定の扱いにしない。",
          "source_ref": [
            "mhlw-r8-gigi-02"
          ]
        }
      ],
      "we_do_not_say": "要件を並べるところまで。算定の可否は判定しない。",
      "sources": [
        "mhlw-r8-kokuji74",
        "mhlw-santei-houhou-genko",
        "mhlw-r8-hohatsu0305-19",
        "mhlw-kokuji103-genko",
        "mhlw-r8-gigi-02"
      ],
      "beppyo7": null
    },
    {
      "id": "iryo-hokatsu",
      "kind": "療養費",
      "insurance": "医療",
      "name": "包括型訪問看護療養費(1日につき・令和8年新設)",
      "effect": {
        "type": "円",
        "value": "単一建物居住利用者20人未満: 30分以上60分未満 7,010円 / 60分以上90分未満 11,010円 / 90分以上 14,010円 / 90分以上で別に定める場合 15,510円。20人以上50人未満: 6,310円 / 9,910円 / 13,730円 / 15,200円。50人以上: 5,960円 / 9,360円 / 13,450円 / 14,890円",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-r8-kokuji74",
          "mhlw-santei-houhou-genko"
        ]
      },
      "revision": "r8-iryo",
      "revision_name": "令和8年度診療報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "hokatsu-yakan",
          "text": "日中と夜間帯(午後6時から午前8時)にそれぞれ1回以上訪問し、1日60分以上なら1日3回以上(注3)。",
          "ask": "q_nv_hokatsu",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-kokuji74",
            "mhlw-santei-houhou-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "hokatsu-denshi",
          "text": "訪問看護計画書と記録書は電子的方法で記録し、内容と実施時間を記録書に書く(注7)。",
          "ask": "q_nv_hokatsu",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-kokuji74",
            "mhlw-santei-houhou-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "hokatsu-heisan",
          "text": "算定する日は、基本療養費・精神科基本療養費・管理療養費を別に算定できない(注8、例外あり)。",
          "ask": "q_nv_hokatsu",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-kokuji74",
            "mhlw-santei-houhou-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "hokatsu-kijun",
          "text": "高齢者の居住の安定確保に関する法律（平成十三年法律第二十六号）第七条第一項の登録を受けた同法第五条第一項に規定するサービス付き高齢者向け住宅又は老人福祉法（昭和三十八年法律第百三十三号）第二十九条第一項に規定する有料老人ホーム等の集合住宅等（以下「高齢者向け住まい等」という。）に併設又は隣接する訪問看護ステーションであること。",
          "ask": "q_nv_hokatsu_todokede",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-kokuji75",
            "mhlw-kokuji103-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "hokatsu-yakan-ninzu",
          "text": "常時一名以上（ただし、当該訪問看護ステーションにおいて当該利用者の数の合計が三十一以上八十以下の場合は二以上、八十一以上の場合は五十又はその端数を増すごとに一を加えて得た数以上）",
          "ask": "q_nv_hokatsu_todokede",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-kokuji75",
            "mhlw-kokuji103-genko",
            "mhlw-r8-hoihatsu0305-9"
          ]
        },
        {
          "kind": "requirements",
          "id": "hokatsu-1kasho",
          "text": "訪問看護ステーションごと指定できる建物は１か所のみである。",
          "ask": "q_nv_hokatsu_todokede",
          "confirmed": false,
          "unconfirmed_reason": "届出通知(保医発0305第9号、7/30 訂正後の PDF)1件の本文。施設基準告示(第103号)は抽象的な文言で、この数字・細目は届出通知にしかない。法令等データベースに同じ通知が見つからず、二つ目の資料と突き合わせられていない。 告示第103号 七(2)は『訪問看護ステーションにつき一か所指定し』。疑義解釈その7 問3 は、一体的に行える場合は複数の建物を指定して届け出てよいと答えている(conflicts 参照)。",
          "source_ref": [
            "mhlw-r8-hoihatsu0305-9"
          ]
        },
        {
          "kind": "requirements",
          "id": "hokatsu-futan",
          "text": "（イ）又は（ロ）を含む２項目以上を満たしていること。また、届出前１か月の実績を有していること。",
          "ask": "q_nv_hokatsu_todokede",
          "confirmed": false,
          "unconfirmed_reason": "届出通知(保医発0305第9号、7/30 訂正後の PDF)1件の本文。施設基準告示(第103号)は抽象的な文言で、この数字・細目は届出通知にしかない。法令等データベースに同じ通知が見つからず、二つ目の資料と突き合わせられていない。 24時間対応体制加算の負担軽減(ア〜カの6項目)と違い、包括型は(イ)〜(ホ)の5項目で『電話等による連絡及び相談を担当する者に対する支援体制の確保』がない。",
          "source_ref": [
            "mhlw-r8-hoihatsu0305-9"
          ]
        },
        {
          "kind": "requirements",
          "id": "hokatsu-120pun",
          "text": "包括型訪問看護療養費を算定する利用者全員の指定訪問看護の実施時間が１日当たり平均120分以上である場合に算定する。",
          "ask": "q_nv_hokatsu",
          "confirmed": false,
          "unconfirmed_reason": "text の文言全体は二つ目の資料と一致しない。句ごとの照合: 告示第103号の法令等データベース版(法令等データベース dataId=84aa7834 pageNo=1)には『120分以上』が同じ文言である。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19",
            "mhlw-kokuji103-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "hokatsu-kanrisha",
          "text": "訪問看護計画書について、１日に１回以上の確認を行い、必要に応じて見直しを行うこと。",
          "ask": "q_nv_hokatsu",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。 記録書Ⅲに管理者等の氏名と計画書の確認・見直しを記録することは記載要領通知(保医発0327第10号)にもあるが、文言は違う。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        },
        {
          "kind": "requirements",
          "id": "hokatsu-doui",
          "text": "２訪問看護ステーションが包括型訪問看護療養費を算定すると届出を行った建物に居住する利用者に対しては、24時間の対応体制で、計画的又は随時の対応により実施される頻回の指定訪問看護が行われる場合においては、利用者の状況等によって包括型訪問看護療養費を算定することをあらかじめ利用者に説明し、同意を得ること。",
          "ask": "q_nv_hokatsu",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        },
        {
          "kind": "requirements",
          "id": "hokatsu-keika",
          "text": "令和九年五月三十一日までの間に限り",
          "ask": "q_nv_hokatsu_todokede",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-kokuji103-genko",
            "mhlw-r8-hoihatsu0305-9"
          ]
        },
        {
          "kind": "requirements",
          "id": "hokatsu-qa-2kai",
          "text": "②「イ訪問看護時間が30分以上60分未満」の区分を算定する。",
          "ask": "q_nv_hokatsu",
          "confirmed": false,
          "unconfirmed_reason": "疑義解釈資料(事務連絡、tier agency)1件。通知・告示の本文ではなく厚生労働省の解釈であり、確定の扱いにしない。",
          "source_ref": [
            "mhlw-r8-gigi-03"
          ]
        },
        {
          "kind": "requirements",
          "id": "hokatsu-qa-18ji",
          "text": "原則として、訪問看護の実施が夜間帯を含む場合は、夜間帯の訪問看護の回数に計上するが、当該訪問看護の実施時間の多くが日中の時間帯である場合に、夜間帯ではなく日中の回数に計上することは差し支えない。",
          "ask": "q_nv_hokatsu",
          "confirmed": false,
          "unconfirmed_reason": "疑義解釈資料(事務連絡、tier agency)1件。通知・告示の本文ではなく厚生労働省の解釈であり、確定の扱いにしない。",
          "source_ref": [
            "mhlw-r8-gigi-06"
          ]
        },
        {
          "kind": "requirements",
          "id": "hokatsu-qa-jikoku",
          "text": "１日当たりの訪問看護時間及び内容を定めておく必要がある。",
          "ask": "q_nv_hokatsu",
          "confirmed": false,
          "unconfirmed_reason": "疑義解釈資料(事務連絡、tier agency)1件。通知・告示の本文ではなく厚生労働省の解釈であり、確定の扱いにしない。",
          "source_ref": [
            "mhlw-r8-gigi-06"
          ]
        },
        {
          "kind": "requirements",
          "id": "hokatsu-qa-jissai",
          "text": "実際に訪問看護を提供した時間に応じた区分により算定する。",
          "ask": "q_nv_hokatsu",
          "confirmed": false,
          "unconfirmed_reason": "疑義解釈資料(事務連絡、tier agency)1件。通知・告示の本文ではなく厚生労働省の解釈であり、確定の扱いにしない。",
          "source_ref": [
            "mhlw-r8-gigi-06"
          ]
        },
        {
          "kind": "requirements",
          "id": "hokatsu-qa-hizuke",
          "text": "原則としてそれぞれの日付に分けて計上するものであるが、日付変更後の訪問時間が短時間の場合については、訪問を開始した日に合わせて計上しても差し支えない。",
          "ask": "q_nv_hokatsu",
          "confirmed": false,
          "unconfirmed_reason": "疑義解釈資料(事務連絡、tier agency)1件。通知・告示の本文ではなく厚生労働省の解釈であり、確定の扱いにしない。",
          "source_ref": [
            "mhlw-r8-gigi-02"
          ]
        },
        {
          "kind": "requirements",
          "id": "hokatsu-qa-kazoku",
          "text": "訪問看護時間を双方に重複して計上することはせず、それぞれに実施した看護の内容を考慮してそれぞれの訪問看護時間に分けて計上すること。",
          "ask": "q_nv_hokatsu",
          "confirmed": false,
          "unconfirmed_reason": "疑義解釈資料(事務連絡、tier agency)1件。通知・告示の本文ではなく厚生労働省の解釈であり、確定の扱いにしない。",
          "source_ref": [
            "mhlw-r8-gigi-02"
          ]
        },
        {
          "kind": "requirements",
          "id": "hokatsu-qa-yakan-ninzu",
          "text": "訪問看護計画において夜間帯の訪問が予定されている利用者を含む利用者の数に応じた看護職員の数とする。",
          "ask": "q_nv_hokatsu_todokede",
          "confirmed": false,
          "unconfirmed_reason": "疑義解釈資料(事務連絡、tier agency)1件。通知・告示の本文ではなく厚生労働省の解釈であり、確定の扱いにしない。",
          "source_ref": [
            "mhlw-r8-gigi-05"
          ]
        },
        {
          "kind": "requirements",
          "id": "hokatsu-qa-tokubetsu-kankei-kenshu",
          "text": "特別の関係（「診療報酬の算定方法の一部改正に伴う実施上の留意事項について」（令和８年３月５日保医発0305第６号）の別添１第１章第２部通則７の(３)に規定する関係）にない、地域の保険医療機関又は他の訪問看護ステーションとの連携が含まれていることが必要である。",
          "ask": "q_nv_hokatsu_todokede",
          "confirmed": false,
          "unconfirmed_reason": "疑義解釈資料(事務連絡、tier agency)1件。通知・告示の本文ではなく厚生労働省の解釈であり、確定の扱いにしない。",
          "source_ref": [
            "mhlw-r8-gigi-07"
          ]
        },
        {
          "kind": "requirements",
          "id": "hokatsu-qa-nicchu-only",
          "text": "日中の１回分の訪問看護基本療養費を算定することとなる。",
          "ask": "q_nv_hokatsu",
          "confirmed": false,
          "unconfirmed_reason": "疑義解釈資料(事務連絡、tier agency)1件。通知・告示の本文ではなく厚生労働省の解釈であり、確定の扱いにしない。",
          "source_ref": [
            "mhlw-r8-gigi-07"
          ]
        },
        {
          "kind": "requirements",
          "id": "hokatsu-qa-fukusu-tatemono",
          "text": "高齢者向け住まい等の建物を複数指定して届出を行うことは可能である。",
          "ask": "q_nv_hokatsu_todokede",
          "confirmed": false,
          "unconfirmed_reason": "疑義解釈資料(事務連絡、tier agency)1件。通知・告示の本文ではなく厚生労働省の解釈であり、確定の扱いにしない。",
          "source_ref": [
            "mhlw-r8-gigi-07"
          ]
        },
        {
          "kind": "requirements",
          "id": "hokatsu-qa-shinki",
          "text": "届出後１か月分の勤務の予定等により当該基準を満たすことが見込まれる具体的な計画を示すこと、また、（10）に規定する「合同の研修及び事例検討会等の地域の保険医療機関又は訪問看護ステーションとの連携」については、届出時に届出後３か月以内の合同の研修等の予定等により当該基準を満たすことが見込まれる具体的な計画や予定を示すことにより、当該基準を満たすものとして取扱う。ただし、（６）のカについては届出後１か月、（10）については届出後３か月の時点で、届出時の計画や予定が遂行されておらず、施設基準を満たさない場合においては、包括型訪問看護療養費の取り下げを速やかに行うこと。",
          "ask": "q_nv_hokatsu_todokede",
          "confirmed": false,
          "unconfirmed_reason": "疑義解釈資料(事務連絡、tier agency)1件。通知・告示の本文ではなく厚生労働省の解釈であり、確定の扱いにしない。",
          "source_ref": [
            "mhlw-r8-gigi-09"
          ]
        },
        {
          "kind": "requirements",
          "id": "hokatsu-qa-shinki-kenshu",
          "text": "届出後１か月以内に当該研修を少なくとも１回実施している必要がある",
          "ask": "q_nv_hokatsu_todokede",
          "confirmed": false,
          "unconfirmed_reason": "疑義解釈資料(事務連絡、tier agency)1件。通知・告示の本文ではなく厚生労働省の解釈であり、確定の扱いにしない。",
          "source_ref": [
            "mhlw-r8-gigi-10"
          ]
        },
        {
          "kind": "requirements",
          "id": "hokatsu-qa-tokubetsu-ofuku",
          "text": "（答）算定不可。",
          "ask": "q_nv_hokatsu",
          "confirmed": false,
          "unconfirmed_reason": "疑義解釈資料(事務連絡、tier agency)1件。通知・告示の本文ではなく厚生労働省の解釈であり、確定の扱いにしない。",
          "source_ref": [
            "mhlw-r8-gigi-13"
          ]
        }
      ],
      "we_do_not_say": "要件を並べるところまで。算定の可否は判定しない。",
      "sources": [
        "mhlw-r8-kokuji74",
        "mhlw-santei-houhou-genko",
        "mhlw-r8-kokuji75",
        "mhlw-kokuji103-genko",
        "mhlw-r8-hoihatsu0305-9",
        "mhlw-r8-hohatsu0305-19",
        "mhlw-r8-gigi-03",
        "mhlw-r8-gigi-06",
        "mhlw-r8-gigi-02",
        "mhlw-r8-gigi-05",
        "mhlw-r8-gigi-07",
        "mhlw-r8-gigi-09",
        "mhlw-r8-gigi-10",
        "mhlw-r8-gigi-13"
      ],
      "beppyo7": null
    },
    {
      "id": "iryo-enkaku",
      "kind": "療養費",
      "insurance": "医療",
      "name": "遠隔死亡診断補助加算 / 訪問看護遠隔診療補助料(令和8年新設)",
      "effect": {
        "type": "円",
        "value": "遠隔死亡診断補助加算 1,500円。訪問看護遠隔診療補助料 2,650円(月1回)",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-r8-kokuji74",
          "mhlw-santei-houhou-genko"
        ]
      },
      "revision": "r8-iryo",
      "revision_name": "令和8年度診療報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "enkaku-todokede",
          "text": "どちらも別に厚生労働大臣が定める基準に適合するとして地方厚生局長等に届け出たステーションに限る(05 注4、06 注)。",
          "ask": "q_nv_enkaku",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-kokuji74",
            "mhlw-santei-houhou-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "enkaku-shibo",
          "text": "情報通信機器を用いた在宅での看取りに係る研修を受けた看護師",
          "ask": "q_nv_enkaku",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-hohatsu0305-19",
            "mhlw-kokuji103-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "enkaku-hojo",
          "text": "月に１回に限り算定する。",
          "ask": "q_nv_enkaku",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-hohatsu0305-19",
            "mhlw-santei-houhou-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "enkaku-kijun",
          "text": "情報通信機器を用いた診療を行うにつき十分な体制が整備されている保険医療機関と連携しながら診療の補助を行う体制が整備されていること。",
          "ask": "q_nv_enkaku",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-kokuji75",
            "mhlw-kokuji103-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "enkaku-qa-renzoku",
          "text": "（答）算定不可。",
          "ask": "q_nv_enkaku",
          "confirmed": false,
          "unconfirmed_reason": "疑義解釈資料(事務連絡、tier agency)1件。通知・告示の本文ではなく厚生労働省の解釈であり、確定の扱いにしない。",
          "source_ref": [
            "mhlw-r8-gigi-02"
          ]
        },
        {
          "kind": "requirements",
          "id": "enkaku-qa-shujii",
          "text": "（答）そのとおり。",
          "ask": "q_nv_enkaku",
          "confirmed": false,
          "unconfirmed_reason": "疑義解釈資料(事務連絡、tier agency)1件。通知・告示の本文ではなく厚生労働省の解釈であり、確定の扱いにしない。",
          "source_ref": [
            "mhlw-r8-gigi-12"
          ]
        },
        {
          "kind": "requirements",
          "id": "enkaku-qa-zaijiso",
          "text": "計画的な診療に当たるため、訪問看護遠隔診療補助料は算定できない。",
          "ask": "q_nv_enkaku",
          "confirmed": false,
          "unconfirmed_reason": "疑義解釈資料(事務連絡、tier agency)1件。通知・告示の本文ではなく厚生労働省の解釈であり、確定の扱いにしない。",
          "source_ref": [
            "mhlw-r8-gigi-05"
          ]
        }
      ],
      "we_do_not_say": "要件を並べるところまで。算定の可否は判定しない。",
      "sources": [
        "mhlw-r8-kokuji74",
        "mhlw-santei-houhou-genko",
        "mhlw-r8-hohatsu0305-19",
        "mhlw-kokuji103-genko",
        "mhlw-r8-kokuji75",
        "mhlw-r8-gigi-02",
        "mhlw-r8-gigi-12",
        "mhlw-r8-gigi-05"
      ],
      "beppyo7": null
    },
    {
      "id": "iryo-baseup",
      "kind": "療養費",
      "insurance": "医療",
      "name": "訪問看護ベースアップ評価料(Ⅰ)(Ⅱ)",
      "effect": {
        "type": "円",
        "value": "(Ⅰ) 1,050円(継続して賃上げに取り組む場合 1,830円)。令和9年6月以降は所定額の100分の200、継続賃上げは 2,880円。(Ⅱ) 1〜36 は 30円から 1,080円まで30円刻み(19〜36 は令和9年6月以降に算定)。継続賃上げの場合 令和8年6月以降 40円〜1,040円(18区分)、令和9年6月以降 40円〜1,580円(36区分)",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-r8-kokuji74",
          "mhlw-santei-houhou-genko"
        ]
      },
      "revision": "r8-iryo",
      "revision_name": "令和8年度診療報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "baseup-todokede",
          "text": "地方厚生局長等への届出と、職員の賃金の改善を図る体制が要る(注1・注2)。",
          "ask": "q_nv_baseup",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-kokuji74",
            "mhlw-santei-houhou-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "baseup-taisho-shokuin",
          "text": "当該訪問看護ステーションに勤務する職員（以下「対象職員」という。）がいること。",
          "ask": "q_nv_baseup",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-kokuji75",
            "mhlw-kokuji103-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "baseup2-50",
          "text": "対象職員の適切な賃金改善に必要な額に当該訪問看護ステーションの利用者の数に占める医療保険制度の給付の対象となる訪問看護を受けた者の割合を乗じた数の百分の五十未満であること。",
          "ask": "q_nv_baseup",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-kokuji75",
            "mhlw-kokuji103-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "baseup-keizoku",
          "text": "継続的に賃上げを行っている訪問看護ステーションであること。",
          "ask": "q_nv_baseup",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-kokuji75",
            "mhlw-kokuji103-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "baseup-hokoku",
          "text": "また、毎年８月において、前年度における賃金改善の取組状況を評価するため、「賃金改善実績報告書」を別紙様式11別添４の１により作成し、地方厚生（支）局長に報告すること。また、毎年８月において、算定を行っている年度における賃金改善の取組状況を当該訪問看護ステーションにおいて適切に把握するため、「賃金改善中間報告書」を別紙様式11別添４の１により作成し、地方厚生(支)局長に報告すること。",
          "ask": "q_nv_baseup_hokoku",
          "confirmed": false,
          "unconfirmed_reason": "届出通知(保医発0305第9号、7/30 訂正後の PDF)1件の本文。施設基準告示(第103号)は抽象的な文言で、この数字・細目は届出通知にしかない。法令等データベースに同じ通知が見つからず、二つ目の資料と突き合わせられていない。",
          "source_ref": [
            "mhlw-r8-hoihatsu0305-9"
          ]
        },
        {
          "kind": "requirements",
          "id": "baseup-joken-kanzan",
          "text": "常勤換算２人以上の対象職員が勤務していること。",
          "ask": "q_nv_baseup",
          "confirmed": false,
          "unconfirmed_reason": "届出通知(保医発0305第9号、7/30 訂正後の PDF)1件の本文。施設基準告示(第103号)は抽象的な文言で、この数字・細目は届出通知にしかない。法令等データベースに同じ通知が見つからず、二つ目の資料と突き合わせられていない。 告示第103号 第一の十(2)ハは『常勤の対象職員の数が、二以上であること』と書き、常勤換算とは書いていない(findings 参照)。",
          "source_ref": [
            "mhlw-r8-hoihatsu0305-9"
          ]
        },
        {
          "kind": "requirements",
          "id": "baseup-qa-0331",
          "text": "令和８年３月31日時点で当該評価料を算定している必要があることから、同年４月以降に算定を開始する保険医療機関（訪問看護ステーション）は含まれない。",
          "ask": "q_nv_baseup",
          "confirmed": false,
          "unconfirmed_reason": "疑義解釈資料(事務連絡、tier agency)1件。通知・告示の本文ではなく厚生労働省の解釈であり、確定の扱いにしない。 同じ問と答は疑義解釈その2(令和8年4月1日)にも載っている。",
          "source_ref": [
            "mhlw-r8-gigi-01"
          ]
        },
        {
          "kind": "requirements",
          "id": "baseup-qa-kyuyo",
          "text": "訪問看護ベースアップ評価料（Ⅰ）については届出前の１月における給与の支払い実績が必要。○外来・在宅ベースアップ評価料（Ⅱ）、歯科外来・在宅ベースアップ評価料（Ⅱ）、入院ベースアップ評価料、訪問看護ベースアップ評価料（Ⅱ）については、届出前の３月における給与の支払い実績が必要。",
          "ask": "q_nv_baseup",
          "confirmed": false,
          "unconfirmed_reason": "疑義解釈資料(事務連絡、tier agency)1件。通知・告示の本文ではなく厚生労働省の解釈であり、確定の扱いにしない。",
          "source_ref": [
            "mhlw-r8-gigi-02"
          ]
        },
        {
          "kind": "requirements",
          "id": "baseup-qa-zero",
          "text": "速やかに地方厚生(支)局長に届出の変更を行う必要があり、当該変更の届出を行った日の属する月の翌月から算定を行わないこと。",
          "ask": "q_nv_baseup",
          "confirmed": false,
          "unconfirmed_reason": "疑義解釈資料(事務連絡、tier agency)1件。通知・告示の本文ではなく厚生労働省の解釈であり、確定の扱いにしない。",
          "source_ref": [
            "mhlw-r8-gigi-11"
          ]
        },
        {
          "kind": "requirements",
          "id": "baseup2-kubun",
          "text": "ウ訪問看護ベースアップ評価料（Ⅱ）の訪問看護ステーションごとの区分については、当該訪問看護ステーションにおける賃金改善算定基礎額、医療保険の利用者割合、訪問看護ベースアップ評価料（Ⅰ）により算定される金額の見込み並びに訪問看護ベースアップ評価料（Ⅱ）の算定回数の見込みを用いて算出した数【Ａ】に基づき、別表２に従い該当する区分のいずれかを届け出ること。",
          "ask": "q_nv_baseup",
          "confirmed": false,
          "unconfirmed_reason": "届出通知(保医発0305第9号、7/30 訂正後の PDF)1件の本文。施設基準告示(第103号)は抽象的な文言で、この数字・細目は届出通知にしかない。法令等データベースに同じ通知が見つからず、二つ目の資料と突き合わせられていない。 告示第103号 第一の十(2)は区分の算出方法を書かない。",
          "source_ref": [
            "mhlw-r8-hoihatsu0305-9"
          ]
        }
      ],
      "we_do_not_say": "要件を並べるところまで。算定の可否は判定しない。",
      "sources": [
        "mhlw-r8-kokuji74",
        "mhlw-santei-houhou-genko",
        "mhlw-r8-kokuji75",
        "mhlw-kokuji103-genko",
        "mhlw-r8-hoihatsu0305-9",
        "mhlw-r8-gigi-01",
        "mhlw-r8-gigi-02",
        "mhlw-r8-gigi-11"
      ],
      "beppyo7": null
    },
    {
      "id": "iryo-bukka",
      "kind": "療養費",
      "insurance": "医療",
      "name": "訪問看護物価対応料(1日につき・令和8年新設)",
      "effect": {
        "type": "円",
        "value": "1 イ 月の初日の訪問 60円・ロ 月の2日目以降 20円。2(包括型を算定している利用者) 20円。令和9年6月以降は所定額の100分の200",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-r8-kokuji74",
          "mhlw-santei-houhou-genko"
        ]
      },
      "revision": "r8-iryo",
      "revision_name": "令和8年度診療報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "bukka-taisho",
          "text": "1は区分番号02を、2は区分番号04を算定している利用者が対象(注1・注2)。",
          "ask": "q_nv_kasan",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-kokuji74",
            "mhlw-santei-houhou-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "bukka-1nichi",
          "text": "訪問看護物価対応料２については、当該訪問看護ステーションが、包括型訪問看護療養費を算定した場合に限り、所定額を１日につき１回に限り算定することができる。",
          "ask": "q_nv_kasan",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。 告示(第74号)の注1・注2 は算定対象(管理療養費/包括型を算定している利用者)を書くが、『１日につき１回に限り』は通知にしかない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        }
      ],
      "we_do_not_say": "要件を並べるところまで。算定の可否は判定しない。",
      "sources": [
        "mhlw-r8-kokuji74",
        "mhlw-santei-houhou-genko",
        "mhlw-r8-hohatsu0305-19"
      ],
      "beppyo7": null
    },
    {
      "id": "iryo-santei-shinai",
      "kind": "要件",
      "insurance": "医療",
      "name": "訪問看護基本療養費の所定額を算定しない場合(01 注15)",
      "effect": {
        "type": "条件",
        "value": "所定額は算定しない(別に定める場合を除く)",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-r8-kokuji74",
          "mhlw-santei-houhou-genko"
        ]
      },
      "revision": "r8-iryo",
      "revision_name": "令和8年度診療報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "shinai-tasho",
          "text": "他のステーションと重ねて訪問する場合は、例外(別表第七の疾病等で他の1か所、特別指示で週4日以上、週7日計画で他の2か所以下、専門の研修の看護師)のどれかに当たるかを確かめる(注15 ハ)。",
          "ask": "q_nv_beppyo7",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-kokuji74",
            "mhlw-santei-houhou-genko"
          ]
        },
        {
          "kind": "requirements",
          "id": "shinai-dojitsu",
          "text": "同一日にそれぞれの訪問看護ステーションで訪問看護療養費は算定できないこと。",
          "ask": "q_nv_fukusu_st",
          "confirmed": false,
          "unconfirmed_reason": "留意事項通知(保発0305第19号)の PDF 1件の本文。法令等データベースに同じ通知の本文が見つからず(attempts 参照)、二つ目の資料と文言を突き合わせられていない。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19"
          ]
        },
        {
          "kind": "requirements",
          "id": "shinai-hokatsu-tatemono",
          "text": "エ包括型訪問看護療養費を算定すると届け出た建物に居住している場合（包括型訪問看護療養費を算定すると届出を行った訪問看護ステーションから指定訪問看護を受けている場合等を除く。）",
          "ask": "q_nv_hokatsu",
          "confirmed": false,
          "unconfirmed_reason": "text の文言全体は二つ目の資料と一致しない。句ごとの照合: 算定方法告示(第67号)の法令等データベース版(法令等データベース dataId=84aa9734 pageNo=1)には『包括型訪問看護療養費を算定すると届出を行った訪問看護ステーションから指定訪問看護を受けている場合等を除く』が同じ文言である。",
          "source_ref": [
            "mhlw-r8-hohatsu0305-19",
            "mhlw-santei-houhou-genko"
          ]
        }
      ],
      "we_do_not_say": "要件を並べるところまで。算定の可否は判定しない。",
      "sources": [
        "mhlw-r8-kokuji74",
        "mhlw-santei-houhou-genko",
        "mhlw-r8-hohatsu0305-19"
      ],
      "beppyo7": null
    },
    {
      "id": "kaigo-kihon-byoin",
      "kind": "基本",
      "insurance": "介護",
      "name": "訪問看護費(病院又は診療所の場合)の基本単位数",
      "effect": {
        "type": "単位",
        "value": "20分未満 266単位 / 30分未満 399単位 / 30分以上1時間未満 574単位 / 1時間以上1時間30分未満 844単位",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-kokuji19-genko",
          "mhlw-santei-kouzou-r8"
        ]
      },
      "revision": "r8-kaigo",
      "revision_name": "令和8年度介護報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "byoin-20pun",
          "text": "指定訪問看護を24時間行うことができる体制を整えている指定訪問看護事業所であって、居宅サービス計画又は訪問看護計画書の中に20分以上の指定訪問看護が週1回以上含まれている場合に算定し",
          "ask": "q_nv_kinkyuji_taisei",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-kokuji19-genko",
            "n2-roken-kokuji19"
          ]
        }
      ],
      "we_do_not_say": "要件を並べるところまで。算定の可否は判定しない。",
      "sources": [
        "mhlw-kokuji19-genko",
        "mhlw-santei-kouzou-r8",
        "n2-roken-kokuji19"
      ],
      "beppyo7": null
    },
    {
      "id": "kaigo-kihon-teiki-junkai",
      "kind": "基本",
      "insurance": "介護",
      "name": "訪問看護費(定期巡回・随時対応型訪問介護看護事業所と連携する場合)",
      "effect": {
        "type": "単位",
        "value": "2,961単位(1月につき)。准看護師は100分の98。保健師、看護師又は准看護師が要介護5の利用者に行った場合は1月につき800単位を加算。特別の指示の日数に応じ1日につき97単位を減算",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-kokuji19-genko",
          "mhlw-santei-kouzou-r8"
        ]
      },
      "revision": "r8-kaigo",
      "revision_name": "令和8年度介護報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "teiki-shisetsu",
          "text": "別に厚生労働大臣が定める施設基準に適合する指定訪問看護事業所において",
          "ask": "q_nv_staff",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-kokuji19-genko",
            "n2-hyogo-tebiki-r6",
            "n2-roken-kokuji19"
          ]
        },
        {
          "kind": "requirements",
          "id": "teiki-kinkyuji",
          "text": "定期巡回・随時対応型訪問介護看護事業所との連携については、訪問看護を24時間行うことができる体制を整えている事業所として、緊急時訪問看護加算の届け出をしていることが必要である。",
          "ask": "q_nv_kinkyuji_taisei",
          "confirmed": false,
          "unconfirmed_reason": "一致したのは二つの secondary(全老健の統合版と兵庫県の手引)だけ。老企第36号のこの箇所は令和6年の新旧対照表で(略)とされ、厚労省の原文とは照合できていない。discipline の『二つの資料の一致』には数えない(2026-09-26 番人)。",
          "source_ref": [
            "n2-roken-roki36",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "teiki-kijun",
          "text": "連携する指定定期巡回・随時対応型訪問介護看護事業所(指定地域密着型サービスの事業の人員、設備及び運営に関する基準(平成十八年厚生労働省令第三十四号。以下「指定地域密着型サービス基準」という。)第三条の四第一項に規定する指定定期巡回・随時対応型訪問介護看護事業所をいう。以下同じ。)の名称、住所その他必要な事項を都道府県知事に届け出ている指定訪問看護事業所(指定居宅サービス等基準第六十条第一項に規定する指定訪問看護事業所をいう。以下同じ。)であること。",
          "ask": "q_nv_staff",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-kokuji96-tdoc",
            "n2-roken-kokuji96"
          ]
        }
      ],
      "we_do_not_say": "要件を並べるところまで。算定の可否は判定しない。",
      "sources": [
        "mhlw-kokuji19-genko",
        "mhlw-santei-kouzou-r8",
        "n2-hyogo-tebiki-r6",
        "n2-roken-kokuji19",
        "n2-roken-roki36",
        "n2-kokuji96-tdoc",
        "n2-roken-kokuji96"
      ],
      "beppyo7": null
    },
    {
      "id": "kaigo-kasan-fukusumei",
      "kind": "加算",
      "insurance": "介護",
      "name": "複数名訪問加算(Ⅰ)(Ⅱ)",
      "effect": {
        "type": "単位",
        "value": "(Ⅰ) 30分未満 254単位・30分以上 402単位。(Ⅱ)(看護補助者と同時) 30分未満 201単位・30分以上 317単位",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-kokuji19-genko",
          "mhlw-santei-kouzou-r8"
        ]
      },
      "revision": "r8-kaigo",
      "revision_name": "令和8年度介護報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "k-fukusu-kijun",
          "text": "同時に複数の看護師等により指定訪問看護(指定居宅サービス等基準第五十九条に規定する指定訪問看護をいう。以下同じ。)を行うこと又は看護師等が看護補助者と同時に指定訪問看護を行うことについて利用者又はその家族等の同意を得ている場合であって、次のいずれかに該当するとき\nイ　利用者の身体的理由により一人の看護師等による指定訪問看護が困難と認められる場合\nロ　暴力行為、著しい迷惑行為、器物破損行為等が認められる場合\nハ　その他利用者の状況等から判断して、イ又はロに準ずると認められる場合",
          "ask": "q_nv_fukusu",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-kokuji94-tdoc",
            "n2-roken-kokuji94",
            "n2-hyogo-tebiki-r6"
          ]
        },
        {
          "kind": "requirements",
          "id": "fukusu-hojo",
          "text": "資格は問わないが、秘密保持や安全等の観点から、訪問看護事業所に雇用されている必要があるものとする。",
          "ask": "q_nv_fukusu",
          "confirmed": false,
          "unconfirmed_reason": "一致したのは二つの secondary(全老健の統合版と兵庫県の手引)だけ。老企第36号のこの箇所は令和6年の新旧対照表で(略)とされ、厚労省の原文とは照合できていない。discipline の『二つの資料の一致』には数えない(2026-09-26 番人)。",
          "source_ref": [
            "n2-roken-roki36",
            "n2-hyogo-tebiki-r6"
          ]
        }
      ],
      "we_do_not_say": "要件を並べるところまで。算定の可否は判定しない。",
      "sources": [
        "mhlw-kokuji19-genko",
        "mhlw-santei-kouzou-r8",
        "n2-kokuji94-tdoc",
        "n2-roken-kokuji94",
        "n2-hyogo-tebiki-r6",
        "n2-roken-roki36"
      ],
      "beppyo7": null
    },
    {
      "id": "kaigo-kasan-chojikan",
      "kind": "加算",
      "insurance": "介護",
      "name": "長時間訪問看護加算",
      "effect": {
        "type": "単位",
        "value": "300単位(1回につき)",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-kokuji19-genko",
          "mhlw-santei-kouzou-r8"
        ]
      },
      "revision": "r8-kaigo",
      "revision_name": "令和8年度介護報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "k-chojikan-taisho",
          "text": "イ　診療報酬の算定方法(平成二十年厚生労働省告示第五十九号)別表第一医科診療報酬点数表(以下「医科診療報酬点数表」という。)に掲げる在宅麻薬等注射指導管理、在宅腫瘍化学療法注射指導管理、在宅強心剤持続投与指導管理若しくは在宅気管切開患者指導管理を受けている状態又は気管カニューレ若しくは留置カテーテルを使用している状態\nロ　医科診療報酬点数表に掲げる在宅自己腹膜灌流指導管理、在宅血液透析指導管理、在宅酸素療法指導管理、在宅中心静脈栄養法指導管理、在宅成分栄養経管栄養法指導管理、在宅自己導尿指導管理、在宅持続陽圧呼吸療法指導管理、在宅自己疼痛管理指導管理又は在宅肺高血圧症患者指導管理を受けている状態\nハ　人工肛門又は人工膀胱を設置している状態\nニ　真皮を越える褥瘡の状態\nホ　点滴注射を週三日以上行う必要があると認められる状態",
          "ask": "q_nv_chojikan",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-kokuji94-tdoc",
            "n2-roken-kokuji94"
          ]
        },
        {
          "kind": "requirements",
          "id": "chojikan-junkango",
          "text": "当該加算については、保健師又は看護師が行う場合であっても、准看護師が行う場合であっても、同じ単位を算定するものとする。",
          "ask": "q_nv_chojikan",
          "confirmed": false,
          "unconfirmed_reason": "一致したのは二つの secondary(全老健の統合版と兵庫県の手引)だけ。老企第36号のこの箇所は令和6年の新旧対照表で(略)とされ、厚労省の原文とは照合できていない。discipline の『二つの資料の一致』には数えない(2026-09-26 番人)。",
          "source_ref": [
            "n2-roken-roki36",
            "n2-hyogo-tebiki-r6"
          ]
        }
      ],
      "we_do_not_say": "要件を並べるところまで。算定の可否は判定しない。",
      "sources": [
        "mhlw-kokuji19-genko",
        "mhlw-santei-kouzou-r8",
        "n2-kokuji94-tdoc",
        "n2-roken-kokuji94",
        "n2-roken-roki36",
        "n2-hyogo-tebiki-r6"
      ],
      "beppyo7": null
    },
    {
      "id": "kaigo-pt-kaisu",
      "kind": "減算",
      "insurance": "介護",
      "name": "理学療法士等が1日に2回を超えて訪問した場合",
      "effect": {
        "type": "率",
        "value": "1回につき所定単位数の100分の90(介護予防は100分の50)",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-kokuji19-genko",
          "mhlw-santei-kouzou-r8",
          "mhlw-kokuji127-genko"
        ]
      },
      "revision": "r8-kaigo",
      "revision_name": "令和8年度介護報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "pt-kaisu",
          "text": "理学療法士等が1日に2回を超えて指定訪問看護を行った場合、1回につき100分の90に相当する単位数を算定する。",
          "ask": "q_nv_staff",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-kokuji19-genko",
            "n2-roken-roki36",
            "n2-roken-kokuji19"
          ]
        }
      ],
      "we_do_not_say": "要件を並べるところまで。算定の可否は判定しない。",
      "sources": [
        "mhlw-kokuji19-genko",
        "mhlw-santei-kouzou-r8",
        "mhlw-kokuji127-genko",
        "n2-roken-roki36",
        "n2-roken-kokuji19"
      ],
      "beppyo7": null
    },
    {
      "id": "yobou-kihon",
      "kind": "基本",
      "insurance": "介護",
      "name": "介護予防訪問看護費の基本単位数",
      "effect": {
        "type": "単位",
        "value": "ステーション: 20分未満 303単位 / 30分未満 451単位 / 30分以上1時間未満 794単位 / 1時間以上1時間30分未満 1,090単位 / 理学療法士等 284単位。病院又は診療所: 256単位 / 382単位 / 553単位 / 814単位",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-kokuji127-genko",
          "mhlw-santei-kouzou-r8"
        ]
      },
      "revision": "r8-kaigo",
      "revision_name": "令和8年度介護報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "yobou-20pun",
          "text": "指定介護予防訪問看護を24時間行うことができる体制を整えている指定介護予防訪問看護事業所であって",
          "ask": "q_nv_staff",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-kokuji127-genko",
            "n2-roken-kokuji127"
          ]
        }
      ],
      "we_do_not_say": "要件を並べるところまで。算定の可否は判定しない。",
      "sources": [
        "mhlw-kokuji127-genko",
        "mhlw-santei-kouzou-r8",
        "n2-roken-kokuji127"
      ],
      "beppyo7": null
    },
    {
      "id": "yobou-pt-12getsu",
      "kind": "減算",
      "insurance": "介護",
      "name": "介護予防訪問看護 理学療法士等の利用開始から12月を超える場合の減算",
      "effect": {
        "type": "単位",
        "value": "1回につき15単位を減算(注16を算定しているとき)、それ以外は1回につき5単位を減算",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-kokuji127-genko",
          "mhlw-santei-kouzou-r8"
        ]
      },
      "revision": "r8-kaigo",
      "revision_name": "令和8年度介護報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "yobou-12",
          "text": "利用を開始した日の属する月から起算して12月を超えて理学療法士、作業療法士又は言語聴覚士が指定介護予防訪問看護を行う場合であって、注16を算定しているときは、1回につき15単位を所定単位数から減算し、注16を算定していないときは、1回につき5単位を所定単位数から減算する。",
          "ask": "q_nv_yobou_pt",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-kokuji127-genko",
            "n2-roken-kokuji127"
          ]
        }
      ],
      "we_do_not_say": "要件を並べるところまで。算定の可否は判定しない。",
      "sources": [
        "mhlw-kokuji127-genko",
        "mhlw-santei-kouzou-r8",
        "n2-roken-kokuji127"
      ],
      "beppyo7": null
    },
    {
      "id": "kaigo-tokubetsu-shiji-14",
      "kind": "基本",
      "insurance": "介護",
      "name": "主治の医師の特別な指示(急性増悪等)があった場合 14日間は訪問看護費を算定しない(イ及びロ)",
      "effect": {
        "type": "率",
        "value": "当該指示の日から14日間に限って、訪問看護費は、算定しない。",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-kokuji19-genko",
          "n2-roken-kokuji19",
          "n2-hyogo-tebiki-r6"
        ]
      },
      "revision": "r8-kaigo",
      "revision_name": "令和8年度介護報酬改定",
      "effective_from": "2026-06-01",
      "superseded_by": null,
      "recheck_needed": false,
      "recheck_why": null,
      "requirements": [
        {
          "kind": "requirements",
          "id": "tokubetsu-shiji-14",
          "text": "当該指示の日から14日間に限って、訪問看護費は、算定しない。",
          "ask": "q_nv_tokubetsu_shiji",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-kokuji19-genko",
            "n2-roken-roki36",
            "n2-roken-kokuji19"
          ]
        },
        {
          "kind": "requirements",
          "id": "tokubetsu-shiji-ryuiji",
          "text": "交付の日から14日間を限度として医療保険の給付対象となるものであり、訪問看護費は算定しない。",
          "ask": "q_nv_tokubetsu_shiji",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "n2-roken-roki36",
            "n2-roki36-tdoc-h12"
          ]
        }
      ],
      "we_do_not_say": "この期間は算定しない、と事業所の請求について断定しない。特別の指示の有無と日付、どの区分(イ・ロ・ハ)かを並べるところまで。",
      "sources": [
        "mhlw-kokuji19-genko",
        "n2-roken-kokuji19",
        "n2-hyogo-tebiki-r6",
        "n2-roken-roki36",
        "n2-roki36-tdoc-h12"
      ],
      "beppyo7": null
    }
  ],
  "questions": {
    "q_nv_shiji": {
      "text": "訪問看護指示書の期限は、いまどうやって管理していますか。紙のファイル、エクセル、システム、人の記憶。実際のところで構いません。",
      "purpose": "requirement",
      "w": 10
    },
    "q_nv_kasan": {
      "text": "いま算定している加算を、思いつくだけ挙げてください。抜けているものを探すのがこちらの仕事なので、漏れていて構いません。",
      "purpose": "requirement",
      "w": 10
    },
    "q_nv_bcp_plan": {
      "text": "業務継続計画(BCP)は、いまどうなっていますか。感染症のぶんと災害のぶん、それぞれについて「策定済み」「作成中」「これから」のどれかで構いません。片方だけ、という状態もそのまま教えてください。",
      "purpose": "requirement",
      "w": 6
    },
    "q_nv_bcp_train": {
      "text": "その計画に基づく研修と訓練は、直近1年で実施しましたか。「した」「していない」「覚えていない」で構いません。",
      "purpose": "requirement",
      "w": 5
    },
    "q_nv_bcp_stock": {
      "text": "感染症・災害用の備蓄品は、どなたが管理していますか。決まっていなければ「決まっていない」で構いません。",
      "purpose": "requirement",
      "w": 4
    },
    "q_nv_gy_committee": {
      "text": "高齢者虐待防止のための委員会は、直近1年で何回開かれましたか。0回でも構いません。回数をそのまま教えてください。",
      "purpose": "requirement",
      "w": 6
    },
    "q_nv_gy_policy": {
      "text": "高齢者虐待防止のための指針は、いまどうなっていますか。「整備済み」「作りかけ」「まだ」のどれかで構いません。",
      "purpose": "requirement",
      "w": 5
    },
    "q_nv_gy_training": {
      "text": "高齢者虐待防止の研修は、直近1年で何回実施しましたか。0回でも構いません。回数をそのまま教えてください。",
      "purpose": "requirement",
      "w": 6
    },
    "q_nv_gy_officer": {
      "text": "高齢者虐待防止措置の担当者は決まっていますか。お名前は要りません。決まっているかどうかだけで構いません。",
      "purpose": "requirement",
      "w": 5
    },
    "q_nv_staff": {
      "text": "看護師の人数(常勤・非常勤)と、理学療法士・作業療法士・言語聴覚士がいらっしゃれば人数を教えてください。",
      "purpose": "requirement",
      "w": 8
    },
    "q_nv_shiji_period": {
      "text": "訪問看護指示書は、御社では何か月ごとに更新していますか。制度としてどうかではなく、実際の回し方を教えてください。こちらはまだ条文を確認できていないので、現場でどうされているかを先に伺っています。",
      "purpose": "field",
      "w": 6
    },
    "q_nv_tokubetsu_days": {
      "text": "特別訪問看護指示書を受けたことはありますか。あれば、御社では何日ぶんとして運用していますか。交付が月2回になった例があれば、その状況も教えてください。こちらで条文を確認できたら、御社の運用とずれがないかをお知らせします。",
      "purpose": "field",
      "w": 5
    },
    "q_nv_shido": {
      "text": "実地指導(運営指導)を受けたことはありますか。受けた年と、そのとき「見せてください」と言われた書類、指摘された点を、覚えている範囲で教えてください。指摘があったこと自体は珍しくありませんので、そのまま教えていただいて構いません。こちらはまだ条文の原文に当たれていないので、実際に何が見られるのかを、先に現場から教えていただきたいのです。",
      "purpose": "field",
      "w": 8
    },
    "q_nv_kasan_miteki": {
      "text": "いま算定していない加算のうち、「取れるかもしれないが手が回っていない」「要件がよく分からない」と思っているものがあれば、名前だけで構いませんので挙げてください。分からないまま挙げていただくのが、いちばん助かります。こちらの算定要件データベースは加算がまだ2項目しか入っておらず、どこから調べるかを、現場の関心の順で決めたいと思っています。",
      "purpose": "field",
      "w": 8
    },
    "q_nv_iryo_youshiki": {
      "text": "医療保険での訪問看護について伺います。医療保険のほうで実際に使っている様式の名前と、算定している療養費・加算があれば教えてください。こちらのデータベースは介護保険側しか入っておらず、医療保険側はこれから作ります。御社が実際に扱っている名前が、そのまま調べる手がかりになります。",
      "purpose": "field",
      "w": 7
    },
    "q_nv_mayotta": {
      "text": "請求のときに「これはどちらだろう」と迷ったことを、思い出せる範囲で教えてください。医療保険か介護保険か、この加算は取れるのか、この日は算定してよいのか。答えが出たか出なかったかは問いません。迷ったこと自体が、このデータベースが答えるべき問いになります。",
      "purpose": "field",
      "w": 7
    },
    "q_nv_todokede": {
      "text": "加算の体制届出は、いつ、どこへ出していますか。出した加算の名前と、提出先(都道府県か市町村か)、締切の感覚を教えてください。届出が要る加算と要らない加算の区別を、こちらはまだ持っていません。",
      "purpose": "field",
      "w": 6
    },
    "q_nv_local_rule": {
      "text": "保険者(市町村)や都道府県から、独自の様式や独自の取り扱いを言われたことはありますか。「この地域ではこうしてください」と言われた経験があれば教えてください。制度は全国共通のはずでも、運用が違うことがあります。こちらはそこをまだ何も持っていないので、1件でも助かります。",
      "purpose": "field",
      "w": 5
    },
    "q_nv_kyoka_kata": {
      "text": "訪問看護管理療養費の届出区分を教えてください。機能強化型1・2・3・4のいずれかを届け出ていますか、それとも届出はしていませんか。「分からない」でも構いません。月の初日の額がここで決まります。",
      "purpose": "requirement",
      "w": 9
    },
    "q_nv_24h_futan": {
      "text": "24時間対応体制加算について伺います。夜間に対応した翌日の勤務間隔の確保、夜間対応の連続回数を2回までにする、夜間対応後に暦日の休日を確保する、勤務体制の工夫、ICTの活用、電話対応者への支援体制。このうち、御社で実際にやっているものを挙げてください。1つも無ければ「無し」で構いません。",
      "purpose": "requirement",
      "w": 9
    },
    "q_nv_beppyo7": {
      "text": "いま訪問している利用者さんのうち、末期の悪性腫瘍、筋萎縮性側索硬化症、多発性硬化症、パーキンソン病関連疾患、人工呼吸器を使用している状態など、いわゆる別表第七に当たる方は何人いらっしゃいますか。人数だけで構いません。分からなければ「分からない」で構いません。",
      "purpose": "requirement",
      "w": 9
    },
    "q_nv_douitsu_tatemono": {
      "text": "同じ建物(集合住宅やサービス付き高齢者向け住宅など)に住む利用者さんは、いちばん多い建物で何人いらっしゃいますか。また、1日に同じ建物へ何人訪問することがありますか。人数がそのまま減算と単価に効きます。",
      "purpose": "requirement",
      "w": 8
    },
    "q_nv_kinkyuji_taisei": {
      "text": "夜間や休日に、利用者さんやご家族から電話が入る体制はどうなっていますか。誰が受けるか、携帯を持ち回っているか、受けたあとどう動くか。実際の回し方を教えてください。",
      "purpose": "requirement",
      "w": 8
    },
    "q_nv_tokutei_koui": {
      "text": "緩和ケア・褥瘡ケア・人工肛門/人工膀胱ケアの専門研修を修了した看護師、または特定行為研修を修了した看護師は在籍していますか。いらっしゃれば、どの分野の研修かも教えてください。いなければ「いない」で構いません。",
      "purpose": "requirement",
      "w": 7
    },
    "q_nv_seishinka": {
      "text": "精神科の訪問看護はやっていますか。やっている場合、精神科訪問看護指示書を受けている利用者さんは何人ですか。",
      "purpose": "requirement",
      "w": 6
    },
    "q_nv_shokai": {
      "text": "新しい利用者さんを受けるとき、初回の訪問はどなたが行きますか。また、退院や退所の直後に受けることはどのくらいありますか。月に何件くらいか、感覚で構いません。",
      "purpose": "requirement",
      "w": 6
    },
    "q_nv_taiin_kyodo": {
      "text": "利用者さんが退院するとき、病院に出向いて(またはオンラインで)病院の職員と一緒に指導をすることはありますか。あれば、月に何件くらいか、そのとき文書を渡しているかも教えてください。",
      "purpose": "requirement",
      "w": 6
    },
    "q_nv_kouku": {
      "text": "訪問の際に、口の中の状態(食べこぼし、むせ、汚れ、義歯の具合)を見て歯科につなぐことはありますか。つないだ記録を残していますか。「やっていない」で構いません。",
      "purpose": "requirement",
      "w": 6
    },
    "q_nv_chiiki": {
      "text": "御社の事業所や利用者さんのお住まいが、特別地域や中山間地域に指定されている場所に当たることはありますか。片道の移動に1時間近くかかる訪問があるかどうかでも構いません。",
      "purpose": "requirement",
      "w": 5
    },
    "q_nv_kango_taisei": {
      "text": "直近1年で、ターミナルケア(お看取りまで関わった件数)と、特別管理加算を算定した利用者さんの人数を教えてください。おおよそで構いません。届出の要件がこの実績で決まります。",
      "purpose": "requirement",
      "w": 7
    },
    "q_nv_yakan": {
      "text": "夜間(18時〜22時)、早朝(6時〜8時)、深夜(22時〜6時)の訪問はありますか。月に何件くらいか、感覚で構いません。",
      "purpose": "requirement",
      "w": 5
    },
    "q_nv_service_taisei": {
      "text": "看護師さんごとの研修計画は作っていますか。また、利用者さんの情報を共有する会議は定期的に開いていますか。「作っていない」「開いていない」で構いません。",
      "purpose": "requirement",
      "w": 6
    },
    "q_nv_chojikan": {
      "text": "長い時間(1時間半を超えるなど)の訪問が要る利用者はいますか。いれば何人くらいか、だけで構いません。",
      "purpose": "requirement",
      "w": 4
    },
    "q_nv_fukusu": {
      "text": "2人以上で同時に訪問することはありますか。看護補助者が一緒に入ることがあるかも教えてください。",
      "purpose": "requirement",
      "w": 4
    },
    "q_nv_renkei": {
      "text": "主治医・歯科・薬局・ケアマネと、利用者の情報をどうやって共有していますか。紙、電話、システム(名前が分かれば)で構いません。",
      "purpose": "requirement",
      "w": 4
    },
    "q_nv_dx": {
      "text": "訪問先でマイナ保険証の資格確認(オンライン資格確認)はできる体制ですか。",
      "purpose": "requirement",
      "w": 3
    },
    "q_nv_joho_teikyo": {
      "text": "市町村・相談支援事業所・学校・入院先の病院から、利用者の情報を求められて文書で出すことはありますか。",
      "purpose": "requirement",
      "w": 3
    },
    "q_nv_hokatsu": {
      "text": "サービス付き高齢者向け住宅など、同じ建物に住む利用者に1日に何度も訪問することはありますか。",
      "purpose": "requirement",
      "w": 3
    },
    "q_nv_enkaku": {
      "text": "情報通信機器を使った看取りの研修を受けた看護師や、オンライン診療の補助をしたことのある看護師はいますか。",
      "purpose": "requirement",
      "w": 2
    },
    "q_nv_baseup": {
      "text": "ベースアップ評価料の届出はしていますか。していれば(Ⅰ)だけか(Ⅱ)もか、分かる範囲で構いません。",
      "purpose": "requirement",
      "w": 3
    },
    "q_nv_yobou_pt": {
      "text": "要支援の方に理学療法士・作業療法士・言語聴覚士が訪問していて、始めてから1年を超えている方はいますか。",
      "purpose": "requirement",
      "w": 2
    },
    "q_nv_anzen_taisei": {
      "text": "安全管理について伺います。事故が起きたときの対応を書いた文書、インシデントを報告して改善する仕組み、寝たきりに近い利用者さんの褥瘡の危険の評価、業務継続計画、毎年8月の褥瘡の報告。それぞれ「ある」「ない」「分からない」で構いません。",
      "purpose": "requirement",
      "w": 5
    },
    "q_nv_kyoka_jisseki": {
      "text": "前年度に、ご自宅等でのお看取り(ターミナルケア)まで関わった件数と、いま訪問している15歳未満の超重症児・準超重症児の人数、別表第七に当たる方の月の人数を教えてください。おおよそで構いません。",
      "purpose": "requirement",
      "w": 5
    },
    "q_nv_kyoka_kyotaku": {
      "text": "同じ敷地の中に、居宅介護支援事業所(ケアマネ)や相談支援事業所はありますか。あれば、利用者さんのケアプランやサービス等利用計画をそこで作っている方はどのくらいいますか。",
      "purpose": "requirement",
      "w": 5
    },
    "q_nv_chiiki_kenshu": {
      "text": "この1年で、看護学生の実習受け入れ、地域の病院やステーション向けの研修、住民や他の事業所からの相談への対応をしたことはありますか。回数が分かれば回数も教えてください。",
      "purpose": "requirement",
      "w": 5
    },
    "q_nv_kyoka4_renkei": {
      "text": "精神科の利用者さんについて伺います。連携している機関(病院、障害福祉サービス事業所、相談支援事業所、介護事業所、保健所や市町村の担当部署)はいくつありますか。それぞれと年に何回会っていて、その記録を残していますか。",
      "purpose": "requirement",
      "w": 5
    },
    "q_nv_24h_hikango": {
      "text": "夜間や休日の電話を、看護師(保健師)以外の職員が受けることはありますか。ある場合、対応マニュアルと、受けた内容を看護師に報告する決まりはありますか。",
      "purpose": "requirement",
      "w": 5
    },
    "q_nv_24h_renkei": {
      "text": "24時間の電話対応や緊急訪問を、他のステーションと組んで分担していますか。地域の災害時の相互支援の仕組みに入っていますか。",
      "purpose": "requirement",
      "w": 5
    },
    "q_nv_jikan": {
      "text": "1回の訪問は、ふだん何分くらいですか。20分以上30分未満の短い訪問が、同じ日に同じ方へ何度も、または何人もの方に続くことはありますか。",
      "purpose": "requirement",
      "w": 5
    },
    "q_nv_tokubetsu_shiji": {
      "text": "特別訪問看護指示書を受けた利用者さんについて、交付日から14日の期間と、月に何回まで受けたかを、どうやって数えていますか。気管カニューレを使っている方や真皮を越える褥瘡の方はいますか。",
      "purpose": "requirement",
      "w": 5
    },
    "q_nv_tokkan_todokede": {
      "text": "特別管理加算の届出はしていますか。24時間の連絡体制と、医療機器の管理で医療機関と連絡を取り合う体制はどうなっていますか。",
      "purpose": "requirement",
      "w": 5
    },
    "q_nv_tokkan_taisho": {
      "text": "特別管理加算を算定している利用者さんは、どのような状態の方ですか(在宅酸素、留置カテーテル、気管カニューレ、人工肛門、真皮を越える褥瘡、点滴など)。分かる範囲で構いません。",
      "purpose": "requirement",
      "w": 5
    },
    "q_nv_tokkan_kiroku": {
      "text": "真皮を越える褥瘡の方について、週に1回以上、深さや大きさなどを評価して記録していますか。点滴の指示を受けている方について、指示書を記録に添えていますか。",
      "purpose": "requirement",
      "w": 5
    },
    "q_nv_kinkyu_kiroku": {
      "text": "緊急で訪問したとき、その日時、内容、対応の様子を記録していますか。請求のときに、緊急訪問看護加算を算定した理由を明細書に書いていますか。",
      "purpose": "requirement",
      "w": 5
    },
    "q_nv_fukusu_st": {
      "text": "同じ利用者さんに、御社以外の訪問看護ステーションも入っていることはありますか。ある場合、同じ日に両方が訪問することはありますか。",
      "purpose": "requirement",
      "w": 5
    },
    "q_nv_nyuyoji": {
      "text": "6歳未満のお子さんの利用者はいますか。そのうち超重症児・準超重症児、別表第七・第八に当たるお子さんは何人ですか。",
      "purpose": "requirement",
      "w": 5
    },
    "q_nv_seishin_keiken": {
      "text": "精神科訪問看護を担当する職員は、精神科病棟・外来での勤務、精神疾患の方への訪問看護、保健所等での精神保健の業務のいずれかを1年以上経験しているか、20時間以上の研修を修了していますか。",
      "purpose": "requirement",
      "w": 5
    },
    "q_nv_taiin_shien": {
      "text": "利用者さんが退院するその日に、ご自宅等で療養上の指導をすることはありますか。そのとき、訪問看護指示書は退院時に受け取っていますか。90分を超えることはありますか。",
      "purpose": "requirement",
      "w": 5
    },
    "q_nv_ict_renkei": {
      "text": "主治医・歯科・薬局・ケアマネ等と、ICT(情報共有のシステム)で利用者の情報を共有していますか。共有している機関の数と、そのことを事業所内の掲示やウェブサイトに載せているかを教えてください。",
      "purpose": "requirement",
      "w": 5
    },
    "q_nv_kakutan_renkei": {
      "text": "喀痰吸引や経管栄養を行う介護職員(登録喀痰吸引等事業者の職員)に同行して、手技の確認や計画書づくりの助言をすることはありますか。",
      "purpose": "requirement",
      "w": 5
    },
    "q_nv_terminal": {
      "text": "お看取りまで関わった方について、亡くなった場所と時刻を記録に残していますか。ターミナルケアの支援体制(連絡担当者、連絡先、緊急時の注意事項)を利用者さんとご家族に説明していますか。",
      "purpose": "requirement",
      "w": 5
    },
    "q_nv_hokatsu_todokede": {
      "text": "包括型訪問看護療養費の届出をしていますか、または考えていますか。併設・隣接する建物の種類と数、夜間に建物内で働く看護職員の人数、記録を電子で作っているかを教えてください。",
      "purpose": "requirement",
      "w": 5
    },
    "q_nv_baseup_hokoku": {
      "text": "ベースアップ評価料について、毎年8月の賃金改善実績報告書と賃金改善中間報告書を出していますか。根拠の資料を3年間保管していますか。",
      "purpose": "requirement",
      "w": 5
    },
    "q_nv_kiroku_jikoku": {
      "text": "訪問看護記録書に、実際に訪問を始めた時刻と終えた時刻を毎回書いていますか。予定の時刻を書いている、ということはありませんか。",
      "purpose": "requirement",
      "w": 5
    },
    "q_nv_keikaku_youshiki": {
      "text": "訪問看護計画書・報告書は、どの様式で作っていますか(紙か電子か、令和8年6月以降の新しい様式か)。管理者の押印欄が残っている様式を使っていますか。",
      "purpose": "requirement",
      "w": 5
    },
    "q_nv_pt_kaisu": {
      "text": "前年度(4月から翌3月)の、理学療法士・作業療法士・言語聴覚士の訪問回数と、看護職員の訪問回数は、それぞれおおよそ何回でしたか。記録から数えられるかどうかだけでも構いません。",
      "purpose": "requirement",
      "w": 5
    },
    "q_nv_kinkyuji_futan": {
      "text": "夜間の電話や緊急訪問の担当について伺います。次のうち御社で実際にやっているものを挙げてください。夜間対応した翌日の勤務間隔の確保、夜間対応の連続を2回までにする、夜間対応後に暦日の休日をとる、夜間勤務のニーズを踏まえた勤務体制の工夫、ICT・AI・IoTの活用による負担軽減、電話を受ける人を支える体制。1つも無ければ「無し」で構いません。",
      "purpose": "requirement",
      "w": 5
    },
    "q_nv_houmon_jikan": {
      "text": "訪問看護計画書に、1回ごとの訪問の所要時間(20分未満、30分未満、30分以上1時間未満、1時間以上1時間30分未満)を書いていますか。前の訪問からおおむね2時間以内に次の訪問をすることはありますか。",
      "purpose": "requirement",
      "w": 5
    },
    "q_nv_kango_taisei_6m": {
      "text": "直近6か月の実利用者の総数と、そのうち緊急時訪問看護加算を算定した実利用者の数、特別管理加算を算定した実利用者の数を教えてください。おおよそで構いません。",
      "purpose": "requirement",
      "w": 5
    },
    "q_nv_kinzoku": {
      "text": "看護師等(保健師・看護師・准看護師・理学療法士・作業療法士・言語聴覚士)のうち、勤続7年以上の方と勤続3年以上の方は、それぞれ何人いらっしゃいますか。同じ法人の他の事業所や病院で働いた年数を含めて数えて構いません。",
      "purpose": "requirement",
      "w": 5
    },
    "q_nv_kouku_shika": {
      "text": "歯科訪問診療をしている歯科医院と、利用者さんの口の状態の評価について相談できる取り決めを、文書で交わしていますか。「交わしていない」で構いません。",
      "purpose": "requirement",
      "w": 5
    },
    "q_nv_renkei_kyoka": {
      "text": "訪問介護のヘルパーさんがたんの吸引等を行っている利用者さんについて、ヘルパーさんに同行して実施状況を確かめたり、連携のための会議に出たりしたことはありますか。あれば訪問看護記録書に残していますか。",
      "purpose": "requirement",
      "w": 5
    },
    "q_nv_shogu_careplan": {
      "text": "ケアプランデータ連携システム(または同等と認められたシステム)を、加入だけでなく実際に使っていますか。あるいは連携推進法人に所属していますか。「どちらもない」で構いません。",
      "purpose": "requirement",
      "w": 5
    }
  },
  "known_gaps": [
    {
      "gap": "取得できた省令の条文は訪問介護の章のもので、訪問看護への準用の条番号を確認できていない。",
      "consequence": "訪問看護に同じ条文がそのまま適用される、とはまだ書けない。条文を引いた分だけ、間違えたときに強く見える。",
      "next": "厚生省令第37号の訪問看護の章(第4章)にある準用規定の条番号を取得する。",
      "resolved": {
        "at": "2026-08-24",
        "text": "解決。告示第95号が『第七十四条において準用する』と名指ししている。"
      }
    },
    {
      "gap": "告示・省令・通知の原文(tier: statute)には、まだ1件も当たれていない。当たれたのは厚生労働省の審議会資料と算定構造(tier: agency)まで。",
      "consequence": "条文の正確な文言と、細かい例外規定は、まだ手元にない。",
      "next": "介護保険最新情報 Vol.1225 / Vol.1263 / Vol.1285 / Vol.1345 と、指定居宅サービス等の事業の人員・設備及び運営に関する基準の該当条を取得する。",
      "resolved": {
        "at": "2026-08-24",
        "text": "解決。statute の出典は10件(うち現行7件)になった。告示第94号・第95号・第67号、老企第36号など。"
      }
    },
    {
      "gap": "医療保険(訪問看護療養費)側は、まだ1項目も入っていない。",
      "consequence": "医療と介護のどちらで請求するかの判定(ご提案 03「保険の判定」)は、この版では支えられない。",
      "next": "訪問看護療養費の基本療養費・管理療養費・加算を、同じ様式で追加する。",
      "resolved": {
        "at": "2026-08-24",
        "text": "解決。医療保険側は10項目入っている(管理療養費・基本療養費・各加算・令和8新設分)。"
      }
    },
    {
      "gap": "加算は2項目しか入っていない。取りこぼしを探すには全く足りない。",
      "consequence": "ご提案 03「加算の取りこぼし探し」は、この版ではまだ動かせない。",
      "next": "訪問看護費の算定構造にある加算を、算定要件と体制届出の別つきで網羅する。",
      "resolved": {
        "at": "2026-09-26",
        "text": "医療・介護とも告示の本文にある加算を項目にした(医療 18 / 介護 7 を追加)。要件の細目(留意事項通知)は下の新しい穴。"
      }
    },
    {
      "gap": "このデータベースは令和6年度改定(2024)を見て作った。令和8年度改定が医療・介護の両方で令和8年6月に施行されている。既にある8項目は、まだ令和8年6月施行版で確かめ直していない。",
      "consequence": "請求前チェックと加算の取りこぼし探しを、古い単位数で動かすことになる。実際に額が動いている(訪問看護管理療養費 月の初日 機能強化型1 13,230円 -> 13,760円、乳幼児加算 1,300円 -> 1,400円、機能強化型4の新設)。古い物差しで『取りこぼしがあります』と言えば、それは支援ではなく誤誘導である。",
      "next": "令和8年6月施行の算定構造(mhlw-santei-kouzou-r8)と現行告示(mhlw-santei-houhou-genko)に1項目ずつ当て直し、effect.revision を r8-kaigo / r8-iryo に更新する。当て直しが済んだ項目から revision_recheck.needed を false にする。",
      "resolved": {
        "at": "2026-09-26",
        "text": "医療は告示第74号と現行告示第67号(statute 2件)で全額を当て直した。介護は告示第19号・第127号の現行本文(statute)と算定構造(agency)で当て直した。"
      }
    },
    {
      "gap": "医療保険の訪問看護指示期間の日数につき減算(1日につき −97単位)が、この版に項目として入っていない。",
      "consequence": "医療保険へ移った期間の日割り減算を、内部MCPは知らない。取りこぼしではなく、過大請求の側の穴である。",
      "next": "算定構造の位置237の列(令和8・令和6とも −97単位)を出典に、項目として起こす。",
      "found_at": "2026-08-24",
      "found_how": "生テキストで算定構造を読み直したときに見つけた。",
      "resolved": {
        "at": "2026-09-26",
        "text": "seed.18 で項目 kaigo-genzan-iryo-shiji-nissuu を起こし、2026-09-26 に告示第19号 注18 の本文(1日につき97単位)と一致を確認。"
      }
    },
    {
      "gap": "看護・介護職員連携強化加算(1月につき +250単位)が入っていない。",
      "consequence": "算定できる加算を1つ知らない。",
      "next": "算定構造に『へ 看護・介護職員連携強化加算 （１月につき ＋２５０単位）』とある(令和8・令和6とも)。",
      "found_at": "2026-08-24",
      "found_how": "生テキストで算定構造を読み直したときに見つけた。",
      "resolved": {
        "at": "2026-09-26",
        "text": "項目 kaigo-kasan-renkei-kyoka(seed.18)。告示第19号 ヘ の本文と一致。"
      }
    },
    {
      "gap": "訪問看護費の『ハ 定期巡回・随時対応型訪問介護看護事業所と連携する場合』(1月につき 2,961単位)が入っていない。",
      "consequence": "訪問看護費はイ(ステーション)・ロ(病院又は診療所)・ハ(定期巡回連携型)の三本立てだが、ハが無い。",
      "next": "算定構造に『（1月につき ２，９６１単位）』とある。ハの行だけ加算の値が違う列がある点に注意。",
      "found_at": "2026-08-24",
      "found_how": "生テキストで算定構造を読み直したときに見つけた。",
      "resolved": {
        "at": "2026-09-26",
        "text": "項目 kaigo-kihon-teiki-junkai(2026-09-26)。"
      }
    },
    {
      "gap": "サービス提供体制強化加算のうち『ハを算定する場合』(1月につき +50単位 /+25単位)が入っていない。",
      "consequence": "ハを算定する事業所では、いま入っている 6単位/3単位 は当てはまらない。",
      "next": "算定構造に『（１）イ及びロを算定する場合 1回につき+6/+3』『（２）ハを算定する場合 1月につき+50/+25』とある。",
      "found_at": "2026-08-24",
      "found_how": "生テキストで算定構造を読み直したときに見つけた。",
      "resolved": {
        "at": "2026-09-26",
        "text": "seed.18 で追加済み。告示第19号 リ(2) の本文(50/25単位)と一致。"
      }
    },
    {
      "gap": "介護職員等処遇改善加算の率(所定単位×18/1000)が項目として入っていない。",
      "consequence": "令和8年度臨時改定で訪問看護に新設された、唯一の変更点である。",
      "next": "算定構造に『ヌ 介護職員等処遇改善加算 （1月につき ＋所定単位×１８／１０００）』とある。二次資料の『1.8%』と一致。",
      "found_at": "2026-08-24",
      "found_how": "生テキストで算定構造を読み直したときに見つけた。",
      "resolved": {
        "at": "2026-09-26",
        "text": "項目 kaigo-kasan-shogu-kaizen(seed.18)。告示第19号 ヌ の本文(1000分の18)と一致。"
      }
    },
    {
      "gap": "医療の要件の細目(留意事項通知 保発0305第19号・令和8年3月5日、以後の訂正)を本文で読んでいない。",
      "consequence": "加算ごとの記録の要件・併算定の細かい制限は、告示の注の範囲でしか持っていない。",
      "next": "https://www.mhlw.go.jp/content/12400000/001686845.pdf を pdftotext で読み、項目の requirements に足す。4/2 訂正後版であることを確かめる。",
      "found_at": "2026-09-26",
      "found_how": "告示の本文を全部読んだあと、要件がどこまで告示にあり、どこから通知にあるかを数えた。",
      "resolved": {
        "at": "2026-09-26",
        "text": "一部解決(seed.24)。医療の要件の細目(留意事項通知 保発0305第19号): 本文を pdftotext で全部読み、医療の全項目に requirements を結んだ。4/2 訂正後の版であることを訂正事務連絡の別添4と照合して確かめた。残り: 法令等データベースで同じ通知が見つからず、通知だけにある細目は1件の statute のまま(confirmed:false)。"
      }
    },
    {
      "gap": "医療の施設基準(令和8年告示第75号)と届出通知(保医発0305第9号、7/30 訂正後)を読んでいない。",
      "consequence": "機能強化型1〜4、24時間対応体制、包括型、遠隔診療補助、医療情報連携などの届出要件を持っていない。",
      "next": "https://www.mhlw.go.jp/content/12400000/001665207.pdf と https://www.mhlw.go.jp/content/12400000/001732114.pdf。",
      "found_at": "2026-09-26",
      "found_how": "同上。",
      "resolved": {
        "at": "2026-09-26",
        "text": "一部解決(seed.24)。医療の施設基準(告示第75号)と届出通知(保医発0305第9号、7/30 訂正後): 両方読んだ。告示第75号 PDF と法令等データベースの告示第103号(統合版)が改正部分で一致することを確かめ、機能強化型1〜4、24時間対応体制、特別管理、専門管理、DX、医療情報連携、包括型、遠隔診療補助、遠隔死亡診断補助、ベースアップの届出要件を requirements にした。残り: 数字(ターミナル件数、別表第七の人数、連携機関5以上、600時間 等)は届出通知にしかなく、1件のまま。"
      }
    },
    {
      "gap": "令和8年6月以降の疑義解釈(その8〜その13)の訪問看護分を項目に結んでいない。",
      "consequence": "包括型と緊急訪問看護加算の関係、ベースアップ評価料(Ⅱ)の区分計算、遠隔診療補助料の主治医の範囲などの解釈を持っていない。",
      "next": "改正ウォッチャー(hs-law-watch)が一覧の差分で拾う。拾ったものを1問ずつ項目の findings に結ぶ。",
      "found_at": "2026-09-26",
      "found_how": "令和8年度診療報酬改定の通知一覧を見た。",
      "resolved": {
        "at": "2026-09-26",
        "text": "一部解決(seed.24)。令和8年度の疑義解釈(その1〜その13)の訪問看護分: 全部取得し、訪問看護療養費関係とベースアップ評価料関係の問のうち訪問看護に関わるものを、項目ごとに requirements(tier agency、confirmed:false)として結んだ。known_gaps に挙がっていた3つの解釈は、包括型と緊急訪問看護加算の関係=その8 問4、ベースアップ評価料(Ⅱ)の区分計算=届出通知 別添13(3)ウ・別表1・別表2(疑義解釈は派遣職員や40歳未満の常勤医の扱いなど周辺のみ)、遠隔診療補助料の主治医の範囲=その12 問1。"
      }
    },
    {
      "gap": "令和8年版の留意事項通知(保発0305第19号)と届出通知(保医発0305第9号)の本文を、法令等データベースで見つけられていない。",
      "consequence": "通知にしかない細目(記録、回数、時間、人数の数字)は、1件の statute のままで confirmed にできない。",
      "next": "法令等データベースの通知の検索(保険局、令和8年3月5日)で dataId を探す。見つからなければ、地方厚生局が再掲した同じ通知の PDF を二つ目の資料にする(同じ文書の別の写しであることを明記)。",
      "found_at": "2026-09-26",
      "found_how": "seed.24 の本文の読み(N1)"
    },
    {
      "gap": "特掲診療料の施設基準等 別表第八(令和8年版)の条文を読んでいない。",
      "consequence": "特別管理加算の5,000円の対象(別表第八第一号)を列挙できない。別表第八の全体は留意事項通知の再掲でしか持っていない。",
      "next": "法令等データベース dataId=84aa9733 の別表第八の頁を取る(題名を確かめる)。",
      "found_at": "2026-09-26",
      "found_how": "seed.24 の本文の読み(N1)"
    },
    {
      "gap": "5/29・6/19・7/30 の訂正事務連絡は、第三者の pdfplumber 抽出で1〜100頁しか取れず、表紙と訪問看護の部分(全国訪問看護事業協会の案内では 6/19 は P45 別添4、7/30 は P38 別添4)に届いていない。",
      "consequence": "届出通知 001732114 が 7/30 訂正を反映した版であることは、厚労省の頁の掲載と Last-Modified でしか確かめていない。",
      "next": "PDF 分割(頁指定)ができる手段で、該当頁だけを取る。",
      "found_at": "2026-09-26",
      "found_how": "seed.24 の本文の読み(N1)"
    },
    {
      "gap": "指定訪問看護の事業の人員及び運営に関する基準(省令第80号)と、その解釈通知(保発0305第20号、001666806)を読んでいない。",
      "consequence": "令和8年度に加わった紹介料による誘引の禁止(疑義解釈その8 問1〜3)や、医療安全の研修(その2 問2)の根拠条文を項目として持てない。",
      "next": "001666806.pdf を取得し、運営基準の項目を起こすか判断する。",
      "found_at": "2026-09-26",
      "found_how": "seed.24 の本文の読み(N1)"
    },
    {
      "gap": "医療保険と介護保険の給付調整の通知(老老発0327第2号・保医発0327第4号、5/1 に訂正あり)を読んでいない。",
      "consequence": "振り分け(furiwake-iryo-kaigo)は告示と留意事項通知の範囲までで、給付調整通知の細目(認知症の扱いなど)を持っていない。",
      "next": "厚労省の令和8年度改定の頁から給付調整通知を取る。",
      "found_at": "2026-09-26",
      "found_how": "seed.24 の本文の読み(N1)"
    },
    {
      "gap": "訪問看護療養費明細書の記載要領(令和8年版)を読んでいない。",
      "consequence": "緊急訪問看護加算の理由の記載など、明細書への記載の要件は留意事項通知の1文しか持っていない。",
      "next": "「診療報酬請求書等の記載要領等について」等の一部改正(保医発0327第2号)の訪問看護療養費明細書の部分を取る。",
      "found_at": "2026-09-26",
      "found_how": "seed.24 の本文の読み(N1)"
    },
    {
      "gap": "全国訪問看護事業協会が 9/16 に掲げた『令和８年度診療報酬改定において経過措置を設けた施設基準の取扱いについて』(P8 訪問看護療養費)を読んでいない。",
      "consequence": "9/30 に切れる経過措置(医療情報連携加算の掲示のウェブ掲載)の取扱いを、告示の経過措置の文までしか持っていない。",
      "next": "厚労省の原本の URL を探して取得する(協会の写しは secondary の置き場)。",
      "found_at": "2026-09-26",
      "found_how": "seed.24 の本文の読み(N1)"
    },
    {
      "gap": "老企第36号 第2の4 のうち令和6年の新旧対照表で（略）だった箇所((4)①～⑦、(12)、(19)、(21)、(23)～(28) 等)は、全老健の統合版と兵庫県の手引(どちらも secondary)でしか読めていない。",
      "consequence": "confirmed:true にした要件のうち、これらの箇所に由来するものは、厚労省の原文との照合を経ていない(二つの secondary の一致)。",
      "next": "令和3年度改定の新旧対照表(介護保険最新情報 Vol.934、WAM に 13MB の PDF)を別経路で取る。Apify web-fetch は 9MB の上限で失敗した。",
      "found_at": "2026-09-26",
      "found_how": "seed.24 の本文の読み(N2)"
    },
    {
      "gap": "告示第95号に第十号の二を新設し、第九号の注の番号を直した改正告示を特定していない。",
      "consequence": "第九号の注番号の食い違い(conflicts)を解けない。",
      "next": "令和8年3月13日付けの告示一覧(0000188411_00073.html)で告示第95号の一部改正告示を探す。",
      "found_at": "2026-09-26",
      "found_how": "seed.24 の本文の読み(N2)"
    },
    {
      "gap": "老企第36号 第2の2(25)(介護職員等処遇改善加算)と、老発0313第6号(令和8年3月13日)の本文を読んでいない。",
      "consequence": "処遇改善加算の要件は告示第95号 第十号の二の文言までしか持っていない。イとロの関係の読み方も判断できない。",
      "next": "https://www.mhlw.go.jp/content/12404000/001675724.pdf を読む。",
      "found_at": "2026-09-26",
      "found_how": "seed.24 の本文の読み(N2)"
    },
    {
      "gap": "介護予防訪問看護費の留意事項通知(老計発第0317001号等、令和8年分 001675938.pdf)を読んでいない。",
      "consequence": "yobou-* の要件は告示第127号の注までしか無い。",
      "next": "https://www.mhlw.go.jp/content/12404000/001675938.pdf と全老健 uid=15。",
      "found_at": "2026-09-26",
      "found_how": "seed.24 の本文の読み(N2)"
    },
    {
      "gap": "令和6年度Q&A の Vol.2 以降と、令和8年度の処遇改善以外のQ&Aの訪問看護の問を読んでいない。",
      "consequence": "Vol.1 の答が後で修正・削除されていても分からない。",
      "next": "Q&A の一覧(newpage_38790.html にある最新版の統合版)を当たる。",
      "found_at": "2026-09-26",
      "found_how": "seed.24 の本文の読み(N2)"
    },
    {
      "gap": "老企第25号は全老健の統合版(secondary)1件でしか読めていない。",
      "consequence": "bcp-stock(備蓄品)は confirmed:false のまま。",
      "next": "厚労省の法令等データベースの老企第25号(現行版があるか)を探す。",
      "found_at": "2026-09-26",
      "found_how": "seed.24 の本文の読み(N2)"
    },
    {
      "gap": "特別地域・中山間地域等の「別に厚生労働大臣が定める地域」の告示を読んでいない。",
      "consequence": "地域に当たるかどうかの判定の根拠を持っていない(現状どおり保険者に確かめる設問にとどまる)。",
      "next": "平成21年厚生労働省告示第83号等を法令等DBで探す。",
      "found_at": "2026-09-26",
      "found_how": "seed.24 の本文の読み(N2)"
    }
  ],
  "conflicts": [
    {
      "about": "santei-kouzou-r8-yomitori",
      "status": "解決",
      "what": "同じ PDF(令和8年6月施行の算定構造)を二度読ませたところ、緊急時訪問看護加算と特別管理加算の単位数が入れ替わって出た。",
      "claim_a": {
        "text": "緊急時訪問看護加算(Ⅰ) 500単位 /(Ⅱ) 250単位。特別管理加算は区分なしで 600単位。",
        "how": "PDF を要約する小さいモデルに、全加算を一度に読ませた(1回目)",
        "source_ref": [
          "mhlw-santei-kouzou-r8"
        ]
      },
      "claim_b": {
        "text": "緊急時訪問看護加算は表に見当たらない。特別管理加算(Ⅰ) 500単位 /(Ⅱ) 250単位。",
        "how": "同じ PDF に、その2項目だけを名指しで照合させた(2回目)",
        "source_ref": [
          "mhlw-santei-kouzou-r8"
        ]
      },
      "why_it_matters": "計器が同じものを二度測って違う答えを出した。これは測られたものについての言明ではない。どちらかを選べば、選んだ理由が消えたまま単位数が残る。",
      "next": "原本の表を人が見る。あるいは、表を要約させるのではなく1項目ずつ名指しで照合させ、二つ以上の資料で一致した値だけを確定にする。今回、一致した3項目(看護体制強化・退院時共同指導・サービス提供体制強化)はこの方法で確定にした。",
      "claim_c": {
        "text": "令和6年4月改定の算定構造(別の資料)を名指しで読ませたところ、『緊急時訪問看護加算 574単位』と『特別管理加算 574単位』が同じ値で出た。574 は同じ表の緊急時訪問看護加算の値である。",
        "how": "別の資料で、同じ種類の取り違えが再現した(3回目)",
        "source_ref": [
          "mhlw-001195509"
        ]
      },
      "what_it_means": "同じ取り違えが、別の資料でも起きた。つまりこれは、ある1つの資料に固有の問題ではなく、『PDF の表を要約経由で読む』という測り方そのものの問題である。計器の問題であって、測られたものの問題ではない。この測り方で取った単位数は、二つ以上の資料で一致したときにだけ確定にする。",
      "resolution": {
        "at": "2026-08-24",
        "text": "外部の二次資料3件(ptotst-r6-houkan 令和6・arukunpo-2026-kaigo・kango-repo-kasan-2026)を1項目ずつ照合したところ、緊急時訪問看護加算(Ⅰ)600単位/(Ⅱ)574単位、特別管理加算(Ⅰ)500単位/(Ⅱ)250単位 で、3件とも一致した。取り違えの向きが確定した(574は緊急時(Ⅱ)の値、500/250は特別管理の値)。claim_b(名指し読み)の特別管理500/250とも一致する。ただし出典は二次資料であり、告示原本(算定構造の原本)の名指し照合は残課題。該当項目(kasan-tokubetsu-kanri・kaigo-kasan-kinkyuji)の値は訂正したが confirmed:false のまま残す。",
        "source_ref": [
          "ptotst-r6-houkan",
          "arukunpo-2026-kaigo",
          "kango-repo-kasan-2026"
        ]
      },
      "resolution2": {
        "at": "2026-08-24",
        "text": "原本に当たって決着した。令和8年6月施行の算定構造に、1項目だけ名指しして短く引用させる読み方で当たったところ、特別管理加算(Ⅰ)500/(Ⅱ)250、緊急時訪問看護加算 ステーション(Ⅰ)600/(Ⅱ)574・病院又は診療所(Ⅰ)325/(Ⅱ)315、ターミナルケア加算2,500単位 と出て、外部の二次資料4件と完全に一致した。",
        "what_the_instrument_was": "同じ資料に同じ道具で当たっても、訊き方で答えが変わった。『表を丸ごと要約して』と頼むと隣の行の値が混ざり、『この一語を含む行だけ短く引用して』と頼むと正しく出る。さらに、令和6年4月改定の算定構造は、1項目だけ名指ししても『特別管理加算 +574単位』を返し続けた。574は同じ表の緊急時訪問看護加算の値である。つまり原因は二つあった。こちらの訊き方と、あの資料の版そのものの読み取りにくさである。",
        "source_ref": [
          "mhlw-santei-kouzou-r8",
          "mhlw-001195509",
          "ptotst-r6-houkan",
          "arukunpo-2026-kaigo",
          "kango-repo-kasan-2026",
          "caretasukeru-kinkyuji"
        ]
      }
    },
    {
      "about": "r8-suenoki-vs-hyou-no-sa",
      "status": "解決",
      "what": "『令和8年度は臨時改定で本体は据え置き』という結論と、令和6の表と令和8の表の差が噛み合わない。",
      "claim_a": {
        "text": "令和8年度介護報酬改定は臨時改定であり、訪問看護に入るのは介護職員等処遇改善加算の新設だけ。基本単位数・各種加算は据え置き。",
        "how": "諮問書別紙1に訪問看護費で新設として載るのは処遇改善加算だけ。二次資料も『据え置き』と明記していた。",
        "source_ref": [
          "mhlw-r8-minaoshi-an",
          "arukunpo-2026-kaigo"
        ]
      },
      "claim_b": {
        "text": "二つの算定構造を生テキストで並べると、値が違う。ハ 定期巡回・随時対応型と連携する場合 2,954単位(令和6) → 2,961単位(令和8)。ロ 病院又は診療所(4)1時間以上1時間30分未満 842単位 → 844単位。初回加算 300単位(区分なし) → (Ⅰ)350単位 /(Ⅱ)300単位。緊急時訪問看護加算 ステーションの欄は令和6が＋574単位のみ、令和8が＋600単位と＋574単位の二つ。",
        "how": "pdftotext -layout で生テキストにし、列の位置で読んだ。",
        "source_ref": [
          "mhlw-001195509",
          "mhlw-santei-kouzou-r8"
        ]
      },
      "why_it_matters": "『据え置き』を前提に、令和6年度の資料で作った項目を令和8へ当て直した(seed.11)。本体が動いているなら、当て直しの根拠が変わる。どの項目が動いたのかを、項目ごとに確かめ直す必要がある。",
      "next": "令和6年4月と令和8年6月の間に、別の改定があったかどうかを確かめる。二つの表の差が、令和8年6月改定によるものとは限らない。算定構造の図には改定箇所の印(下線等)があるはずだが、生テキストにすると印は落ちる。原本の該当ページを画像として見るか、改正告示の新旧対照表に当たる。",
      "do_not": "どちらかを選んで黙らないこと。いまは、どの項目がいつ動いたのかを我々は知らない。",
      "resolution": {
        "at": "2026-08-24",
        "text": "claim_a(据え置き)が正しかった。差は令和8年6月改定によるものではなく、令和6年4月版と令和6年6月版の間のものだった。訪問看護は令和6年6月1日施行である。令和6年6月版の算定構造を生テキストで読むと、314/471/823/1,128・理学療法士等294・ハ2,961・緊急時(Ⅰ)600/(Ⅱ)574・初回(Ⅰ)350 がすべて令和8年6月版と一致する。令和6年6月から令和8年6月までは据え置きである。",
        "why_we_were_confused": "比較に使った資料(mhlw-001195509)が『令和6年4月改定箇所』の版だったため。同じ『令和6年度改定』でも、サービスによって施行日が違う。訪問看護は6月だった。版を比べるときは、版の名前ではなく施行日を確かめなければならない。",
        "source_ref": [
          "mhlw-santei-kouzou-r6june",
          "mhlw-santei-kouzou-r8",
          "mhlw-001195509"
        ]
      }
    },
    {
      "about": "shorei-37-art74-hanni",
      "status": "未解決",
      "what": "省令第37号 第七十四条の準用の範囲指定が、取得した版によって違う。",
      "claim_a": {
        "text": "第三十条から第三十九条まで",
        "how": "旧版の条文(第三十条の二・第三十七条の二が加わる前のもの)",
        "source_ref": [
          "ipss-shorei-h11-37-old"
        ]
      },
      "claim_b": {
        "text": "第三十条から第三十四条まで、第三十五条から第三十八条まで",
        "how": "e-Gov法令検索の条文APIから現行を取得し、同じ資料を二度読ませて一致(2026-08-25)",
        "source_ref": [
          "egov-shorei-h11-37-art74"
        ]
      },
      "why_it_matters": "この範囲に第三十条の二(業務継続計画)と第三十七条の二(虐待の防止)が入るかどうかで、訪問看護に両減算が適用されるかが決まる。ただし、この食い違いが解けなくても結論は動かない。告示第95号が『第七十四条において準用する…第三十条の二第一項』『…第三十七条の二』と名指ししており、そちらが直接の根拠になっているため(finding junyo-74 の resolved を参照)。",
      "what_we_do": "どちらも消さずに残す。claim_b の分割の書き方には読み落としの疑いがあるので、二つ目の資料が出るまで claim_b を正としない。"
    },
    {
      "about": "hokatsu-tatemono-kasho",
      "status": "未解決",
      "what": "包括型訪問看護療養費を算定する建物として、1つの訪問看護ステーションが複数の建物を指定できるか。",
      "claim_a": {
        "text": "訪問看護ステーションごと指定できる建物は１か所のみである。",
        "how": "届出通知 別添11(2) の本文(7/30 訂正後の版、15〜16頁)。告示第103号 七(2)も『訪問看護ステーションにつき一か所指定し』。",
        "source_ref": [
          "mhlw-r8-hoihatsu0305-9",
          "mhlw-kokuji103-genko"
        ]
      },
      "claim_b": {
        "text": "それぞれの建物における利用者への指定訪問看護を当該訪問看護ステーションが一体的に行うことが可能である場合には、併設又は隣接する（同一の敷地内を含む。）高齢者向け住まい等の建物を複数指定して届出を行うことは可能である。",
        "how": "疑義解釈その7(令和8年5月29日) 訪問看護療養費関係 問3 の答。",
        "source_ref": [
          "mhlw-r8-gigi-07"
        ]
      },
      "why_it_matters": "届出の可否と、同一建物・単一建物居住利用者数の数え方(複数の建物を合算)が変わる。後から出た解釈(agency)が、告示と通知(statute)の文言の例外を作っている形である。",
      "do_not": "どちらかを選んで『複数指定できます』『1か所だけです』と言わない。両方を示し、地方厚生局に確かめる。",
      "found_at": "2026-09-26"
    },
    {
      "about": "baseup2-jouken-ninzu",
      "status": "未解決",
      "what": "訪問看護ベースアップ評価料(Ⅱ)の人数要件が、常勤の人数か常勤換算か。",
      "claim_a": {
        "text": "当該訪問看護ステーションにおける常勤の対象職員の数が、二以上であること。",
        "how": "告示第103号 第一の十(2)ハ(法令等データベース)。",
        "source_ref": [
          "mhlw-kokuji103-genko"
        ]
      },
      "claim_b": {
        "text": "常勤換算２人以上の対象職員が勤務していること。",
        "how": "届出通知 別添13(3)カ(23頁)。",
        "source_ref": [
          "mhlw-r8-hoihatsu0305-9"
        ]
      },
      "why_it_matters": "常勤1人と非常勤で常勤換算2人の事業所は、届出通知の文言では満たし、告示の文言をそのまま読むと満たさない。",
      "do_not": "届出通知の常勤換算で『満たします』と言わない。両方の文言を並べる。",
      "found_at": "2026-09-26"
    },
    {
      "what": "准看護師による訪問の減算率(イ・ロ)",
      "claim_a": {
        "text": "所定単位数に 98/100 を乗じる(seed.23 genzan-junkangoshi の effect、kaigo-kihon-st の kihon-junkangoshi)",
        "source_ref": [
          "mhlw-001195509",
          "mhlw-santei-kouzou-r8"
        ]
      },
      "claim_b": {
        "text": "准看護師が指定訪問看護を行った場合は、所定単位数の100分の90に相当する単位数を算定する(告示第19号 注1、イ及びロ)。100分の98 は注2(ハ)の値",
        "source_ref": [
          "mhlw-kokuji19-genko",
          "n2-roken-kokuji19",
          "mhlw-santei-kouzou-r8",
          "n2-roken-roki36"
        ],
        "tier": "statute"
      },
      "status": "解決",
      "about": "seed24-n2-conflict-01",
      "found_at": "2026-09-26",
      "resolution": "告示第19号 注1(イ・ロ)は 100分の90、注2(ハ)は 100分の98。genzan-junkangoshi と kaigo-kihon-st の effect / requirements を直した(seed.24)。"
    },
    {
      "what": "1日につき97単位の減算の適用範囲",
      "claim_a": {
        "text": "医療保険の訪問看護指示期間の日数につき減算(訪問看護費全体の項目として記載。seed.23 kaigo-genzan-iryo-shiji-nissuu)",
        "source_ref": [
          "mhlw-santei-kouzou-r8",
          "mhlw-001195509"
        ]
      },
      "claim_b": {
        "text": "ハについて、…特別の指示を行った場合は、当該指示の日数に応じて、1日につき97単位を所定単位数から減算する(告示第19号 注18)。イ及びロは注17で14日間算定しない",
        "source_ref": [
          "mhlw-kokuji19-genko",
          "n2-roken-kokuji19",
          "n2-hyogo-tebiki-r6"
        ],
        "tier": "statute"
      },
      "status": "原文で決着できる。項目の名前と trigger_text をハに限る必要がある。",
      "about": "seed24-n2-conflict-02",
      "found_at": "2026-09-26"
    },
    {
      "what": "告示第95号 第九号(看護体制強化加算)が括弧内で引く単位数表の注の番号",
      "claim_a": {
        "text": "緊急時訪問看護加算=注12、特別管理加算=注13、ターミナルケア加算=注15(法令等DB・全老健の現行版。現行の告示第19号の注の番号とも合う)",
        "source_ref": [
          "n2-kokuji95-tdoc",
          "n2-roken-kokuji95",
          "mhlw-kokuji19-genko"
        ]
      },
      "claim_b": {
        "text": "注10・注11・注12(兵庫県の手引 令和6年6月に転載された告示第95号)",
        "source_ref": [
          "n2-hyogo-tebiki-r6"
        ]
      },
      "status": "未解決。注の番号を直した改正告示を特定できていない(令和8年告示第87号には告示第95号の改正が無かった)。要件の中身(割合・人数)は両方で同じ。",
      "about": "seed24-n2-conflict-03",
      "found_at": "2026-09-26"
    },
    {
      "what": "特別管理加算(告示第19号 注13)に届出の文言があるか",
      "claim_a": {
        "text": "電子情報処理組織を使用する方法により、都道府県知事に対し、老健局長が定める様式による届出を行った指定訪問看護事業所が、指定訪問看護の実施に関する計画的な管理を行った場合(法令等DB・全老健)",
        "source_ref": [
          "mhlw-kokuji19-genko",
          "n2-roken-kokuji19"
        ]
      },
      "claim_b": {
        "text": "指定訪問看護事業所が、指定訪問看護の実施に関する計画的な管理を行った場合(兵庫県の手引 令和6年6月の転載。届出の句が無い)",
        "source_ref": [
          "n2-hyogo-tebiki-r6"
        ]
      },
      "status": "未解決。いつ届出の句が入ったか(令和6年6月以降の改正か、手引の転載漏れか)を改正告示で確かめていない。老企第36号 第2の4(19)① は「届け出させること」、平成12年制定時は「届出が加算の算定要件ではないが」だった。",
      "about": "seed24-n2-conflict-04",
      "found_at": "2026-09-26"
    },
    {
      "what": "看護・介護職員連携強化加算(告示第19号 ヘ 注)の社会福祉士及び介護福祉士法 附則の条番号",
      "claim_a": {
        "text": "同法附則第27条第1項の登録(法令等DB・全老健)",
        "source_ref": [
          "mhlw-kokuji19-genko",
          "n2-roken-kokuji19"
        ]
      },
      "claim_b": {
        "text": "同法附則第20条第1項の登録(兵庫県の手引 令和6年6月の転載)",
        "source_ref": [
          "n2-hyogo-tebiki-r6"
        ]
      },
      "status": "未解決。法の附則の条ずれに合わせた改正か、転載の誤りか確かめていない。",
      "about": "seed24-n2-conflict-05",
      "found_at": "2026-09-26"
    },
    {
      "what": "老企第36号 第2の4(14)・(16) の参照範囲",
      "claim_a": {
        "text": "(14)「訪問介護と同様であるので、２⒃を参照されたい。」(16)「２⒅を参照されたい。」(令和6年3月15日の新旧対照表の新欄)",
        "source_ref": [
          "n2-roki36-r6-shinkyu"
        ]
      },
      "claim_b": {
        "text": "(14)「２(16)①～⑤を参照されたい。」(16)「２(18)①から③まで及び⑥を参照されたい。」(全老健の統合版 令和8年3月13日更新)",
        "source_ref": [
          "n2-roken-roki36"
        ]
      },
      "status": "未解決。令和6年3月15日より後の訂正・改正で範囲が絞られた可能性がある(2(16)⑥は訪問介護だけの同一建物90%判定)。その改正通知を読んでいない。要件の抜き書き(dt-teigi・dt-ninzu)は①②の範囲なので、どちらでも影響しない。",
      "about": "seed24-n2-conflict-06",
      "found_at": "2026-09-26"
    },
    {
      "what": "既存の出典 mhlw-roki36 が現行かどうか",
      "claim_a": {
        "text": "current:true(seed.23 の sources)",
        "source_ref": [
          "mhlw-roki36"
        ]
      },
      "claim_b": {
        "text": "同じ URL(t_doc 00ta4378)が返すのは平成12年制定時の本文。三級ヘルパー・痴呆対応型の語があり、4 訪問看護費は(1)～(8)だけ",
        "source_ref": [
          "n2-roki36-tdoc-h12"
        ]
      },
      "status": "原文で決着できる。mhlw-roki36 は current:false が正しい。operation.when_to_add の文(当該月の第一回目…)は現行の(18)②・(19)②にも残っているので、結論は変わらない。",
      "about": "seed24-n2-conflict-07",
      "found_at": "2026-09-26"
    },
    {
      "what": "遠隔死亡診断補助加算にターミナルケア加算の算定が前提か",
      "claim_a": {
        "text": "ターミナルケア加算を算定していることが前提になる(seed.23 es-terminal、原文未確認)",
        "source_ref": [
          "mhlw-santei-kouzou-r8"
        ]
      },
      "claim_b": {
        "text": "告示第19号 注16 と老企第36号 第2の4(22) にその文言は無い。要件は C001 注8 の死亡診断加算を算定する特別地域の利用者について、主治の医師の指示で情報通信機器を用いた死亡診断の補助を行うこと",
        "source_ref": [
          "mhlw-kokuji19-genko",
          "n2-roken-kokuji19",
          "n2-roken-roki36",
          "n2-roki36-r6-shinkyu"
        ]
      },
      "status": "原文には claim_a の文言が無い。es-terminal を update した。",
      "about": "seed24-n2-conflict-08",
      "found_at": "2026-09-26"
    },
    {
      "what": "業務継続計画未策定減算が訪問看護に適用される時期",
      "claim_a": {
        "text": "obligation_from 2024-04-01(seed.23 genzan-bcp.timeline、根拠未確認)",
        "source_ref": [
          "mhlw-001195261"
        ]
      },
      "claim_b": {
        "text": "訪問看護の施行時期は令和７年４月(Q&A Vol.1 問165)。経過措置として令和７年３月31日までの間、当該減算は適用しない(老企第36号 第2の2(11))",
        "source_ref": [
          "n2-r6-qa-vol1",
          "n2-roken-roki36",
          "n2-roki36-r6-shinkyu"
        ]
      },
      "status": "義務化(運営基準)の開始日と減算の適用開始は別物。減算は令和7年4月から。",
      "about": "seed24-n2-conflict-09",
      "found_at": "2026-09-26"
    }
  ],
  "discipline": [
    "出典の無い数字は1つも入れない。単位数も要件も、必ず source を持つ。",
    "source の tier を三段階で区別する。statute = 告示・省令・通知の原文。agency = 厚生労働省が出した資料(審議会資料・改定概要など)。secondary = 民間の解説記事。『厚労省の資料』と『告示そのもの』を同じ扱いにしない。",
    "確認できていない項目は空欄にせず、confirmed:false と unconfirmed_reason を書いて残す。空欄と未確認は違う。",
    "出典どうしが食い違ったら、どちらかを選んで黙らない。conflicts に両方を書き、未解決であることを残す。選んだ瞬間に、選んだ理由が消える。",
    "「算定できます」とは言わない。言えるのは『この加算にはA・B・Cの要件があり、御社の回答ではAとBを満たし、Cは未確認』まで。算定の可否を我々が判定すると、返戻になったときに責任の所在が壊れる。",
    "改定で版を切る。旧版は消さない。過去の判断を後から検証できなくなるため。",
    "requirements の各項目は、ヒアリングの設問 id と1対1で結ぶ。結べない要件は、聞けていない要件である。",
    "現場の実務(field_reports)は、規則の出典ではない。事業所が毎月扱っている事実は貴重だが、「実際どう運用されているか」は「何が定められているか」ではない。field_reports の id を effect や rules の source_ref に入れてはならない。検査器が拒む。",
    "出典が現行版かどうかを持つ。条文そのものでも、改正前の版なら現行の根拠にはならない。素性(tier)が強いことと、いま有効であることは別である。数えるときも分けて出す。statute が何件あるかだけを言うと、実態より良く見える。",
    "PDF の表を要約経由で読んだ値は、それだけでは確定にしない。同じ表を二度読ませて値が入れ替わることが、別々の資料で3回起きた。二つ以上の資料で一致したときにだけ confirmed:true にする。計器が同じものを二度測って違う答えを出したなら、それは測られたものについての言明ではない。"
  ]
};
export default RULES;
