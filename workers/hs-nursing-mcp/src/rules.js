/* このファイルは生成物である。手で書き換えないこと。
   元         : JHNRD data/rules_2024.json
   元の版     : 2024-kaitei.seed.22
   中身の sha256: 2d7dd90fecd0f3f24732e02847844b22b61b26c0bd40ad17263dc2f32785b357
   作り直す   : python3 tools/nursing/build_mcp_rules.py --write

   ここに数字を手で足さないこと。足しても JHNRD には戻らないので、
   公開データベースと内部MCPが別のことを言う状態になる。
   そのずれは落ちない。例外も出ない。ただ違う数字が出続ける。 */
export const SOURCE_SHA256 = "2d7dd90fecd0f3f24732e02847844b22b61b26c0bd40ad17263dc2f32785b357";
export const RULES = {
  "version": "2024-kaitei.seed.22",
  "revision_label": "令和8年度改定(医療・介護とも令和8年6月施行)を現行とする。令和6年度改定で作った介護の6項目(業務継続計画未策定減算・高齢者虐待防止措置未実施減算・准看護師・PT/OT/ST・特別管理加算・ターミナルケア加算)を令和8へ当て直した(令和8は処遇改善のみの臨時改定につき据え置きを確認: mhlw-r8-minaoshi-an)。特別管理加算(旧+574→(Ⅰ)500/(Ⅱ)250)とターミナルケア加算(旧+2,000→2,500)の取り違えを訂正し、緊急時訪問看護加算に(Ⅰ)600/(Ⅱ)574の候補を入れた。訂正値の出典は二次資料3件で一致・告示原本照合は残課題として confirmed:false のまま残す。 seed.12(2026-08-24): 訪問看護への準用の条番号が 指定居宅サービス等基準 第七十四条 であることを告示第95号(statute)で確認した。緊急時訪問看護加算(Ⅰ)(Ⅱ)の分かれ目も告示の文言で確定した(単位数は依然 confirmed:false)。 seed.13(2026-08-24): 朝の時点で『現行の第七十四条が同じ範囲を定めているか未確認』としていた findings を、告示第95号で解決済みにした。同じ事実が三箇所にあるので、相互に名指しさせてある。 seed.14(2026-08-24): 令和8年6月施行の算定構造に1項目ずつ名指しして当たり、特別管理加算(Ⅰ)500/(Ⅱ)250・緊急時訪問看護加算600/574(病院診療所325/315)・ターミナルケア加算2,500単位を、外部の二次資料4件との一致をもって確定にした。特別管理加算の対象状態は告示第94号から、加算する日の運用は老企第36号から取った。読み取りの食い違いは解決。 seed.15(2026-08-24): 最後に残っていた食い違い(理学療法士等の減算幅)を解決した。『−97単位』は同じ表の訪問介護費の初回加算97単位の混入だった。正しくは1回294単位、条件つきで1回につき−8単位。294は名指し読み1件のみなので confirmed:false のまま残す。 seed.16(2026-08-24): サービス提供体制強化加算((Ⅰ)6/(Ⅱ)3)と初回加算((Ⅰ)350/(Ⅱ)300)を確定。訪問看護管理療養費(月2日目以降)の細分化後の各区分の額を入れたが、読み取りが改正後と改正前の欄を入れ替えたためconfirmed:false のまま残す。 seed.17(2026-08-24): PDFを生テキストに直して列の位置で読み直した。seed.15 に書いた『−97は訪問介護費の初回加算の混入』は誤りで、実際は同じ表の『医療保険の指示期間の日数につき減算(1日につき−97単位)』の列の値だった。訂正を追記した(消していない)。理学療法士等は 1回294単位・条件つき1回−8単位で確定。古くなった known_gaps 3件に解決済みの印をつけ、まだ入っていない5項目を新たに記録した。 seed.18(2026-08-24): 生テキストで二つの算定構造を並べたところ、『令和8は据え置き』という結論と噛み合わない差が見つかった(ハ2,954→2,961、病院診療所844、初回加算の区分、緊急時(Ⅰ))。食い違いとして残した。あわせて、表にあってDBに無かった3項目(医療保険の指示期間の日数につき−97単位/日、看護・介護職員連携強化加算+250単位、介護職員等処遇改善加算×18/1000)を追加し、サービス提供体制強化加算にハを算定する場合(+50/+25)を足した。 seed.19(2026-08-24): 食い違いを解いた。差は令和8ではなく、令和6年4月版と令和6年6月版の間のものだった(訪問看護は令和6年6月1日施行)。令和6年6月版の算定構造を出典に加え、令和6年4月版は訪問看護については改定前として current:false にした。あわせて『313は取り違え』『294は令和6と令和8の二資料で一致』という、こちらの誤った結論を訂正した。 seed.20(2026-08-25): 3日届かなかった省令第37号 第七十四条の条文本体を、e-Gov法令検索の条文APIから取得した(厚労省の t_doc は第六十条までしか載っていない)。ただし範囲指定が『第三十条から第三十四条まで、第三十五条から第三十八条まで』と不自然に分かれており、間に何も挟まないならこう書く理由がない。読み落としの疑いがあるので confirmed:false のまま残し、旧版の『第三十条から第三十九条まで』との差を食い違いとして記録した。結論(第三十条の二・第三十七条の二が準用されている)は告示第95号が名指ししているので動かない。 seed.21(2026-08-25): 看護体制強化加算(Ⅰ)(Ⅱ)の分かれ目が、老企第36号ではなく告示第95号にあることを突き止め、(Ⅰ)4つ・(Ⅱ)2つの基準を要件として入れた。ただし全て confirmed:false。同じ URL に mode=0 を足しただけで別の告示(第67号)が返り、二度目の読みが取れなかったためである。(Ⅱ)に特別管理加算の割合と看護職員の割合が課されるかどうかも、読み取れていない(detail_unconfirmed_2)。あわせて、記録されている URL で老企第36号の訪問看護費の節が現に取れることを確認した(全老健が載せている同名の通知は訪問介護費までで、別物である)。 seed.22(2026-08-25): 告示第95号の二つ目の読み方を探したが、見つからなかった。e-Gov 法令検索は告示を収録していない(省令第七十四条が取れたのと同じ手は使えない)。厚労省・WAM の検索でも、基準本文を載せた安定したURLは出ず、先頭に返ってくるのは二度読めない t_doc の同じURLだった。取れなかったことと、次に当たる先(都道府県の抜粋・官報)をattempts に書き足した。看護体制強化加算(Ⅱ)の2つの穴は、開いたままである。",
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
      "retrieved_at": "2026-08-24"
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
      "current": true,
      "not_current_reason": null,
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
      "title": "指定居宅サービス等の事業の人員、設備及び運営に関する基準 第七十四条(準用) — e-Gov法令検索 条文API",
      "url": "https://laws.e-gov.go.jp/api/1/articles;lawId=411M50000100037;article=74",
      "publisher": "デジタル庁 e-Gov法令検索",
      "tier": "statute",
      "current": true,
      "not_current_reason": null,
      "retrieved_at": "2026-08-25"
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
          "text": "感染症の業務継続計画を策定していること",
          "ask": "q_nv_bcp_plan",
          "confirmed": false,
          "unconfirmed_reason": null,
          "source_ref": []
        },
        {
          "kind": "requirements",
          "id": "bcp-plan-d",
          "text": "災害の業務継続計画を策定していること(どちらか一方が欠けても対象になる)",
          "ask": "q_nv_bcp_plan",
          "confirmed": false,
          "unconfirmed_reason": null,
          "source_ref": []
        },
        {
          "kind": "requirements",
          "id": "bcp-train",
          "text": "計画に基づく研修および訓練を定期的に実施していること",
          "ask": "q_nv_bcp_train",
          "confirmed": false,
          "unconfirmed_reason": "省令第30条の2第2項に「必要な研修及び訓練を定期的に実施しなければならない」とあり、要件としては条文に存在する。訪問看護への準用は第七十四条であることを告示第95号で確認した(2026-08-24)。ただし告示第95号 六の三は、減算の基準を『第三十条の二第一項に規定する基準に適合していること』と書いており、第二項(研修及び訓練)が減算の基準に含まれるかは、この文言からは読み取れない。運営基準としては要るが、減算の判定に効くかは別問題として未確認のままにする。",
          "source_ref": [
            "mhlw-shorei-h11-37",
            "mhlw-kijun-kokuji95"
          ]
        },
        {
          "kind": "requirements",
          "id": "bcp-stock",
          "text": "備蓄品の管理および担当者の位置づけができていること",
          "ask": "q_nv_bcp_stock",
          "confirmed": false,
          "unconfirmed_reason": "当社のご提案書に記載しているが、当たれた資料には明記が無い。原文で確認する。",
          "source_ref": []
        },
        {
          "kind": "requirements",
          "id": "bcp-review",
          "text": "業務継続計画の見直しを定期的に行っていること(省令第30条の2第3項)",
          "ask": "q_nv_bcp_plan",
          "confirmed": false,
          "unconfirmed_reason": "訪問看護への準用は第七十四条であることを告示第95号で確認した(2026-08-24)。ただし告示第95号 六の三が挙げるのは『第三十条の二第一項』であり、第三項(定期的な見直し)が減算の基準に含まれるかは、この文言からは読み取れない。未確認のままにする。",
          "source_ref": [
            "mhlw-shorei-h11-37",
            "mhlw-kijun-kokuji95"
          ]
        }
      ],
      "we_do_not_say": "この減算に該当します、とは言わない。要件のどれが未確認かを示すところまで。",
      "sources": [
        "mhlw-shorei-h11-37",
        "mhlw-001195261",
        "ibow-20240529"
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
          "text": "虐待の発生又はその再発を防止するための委員会を開催していること",
          "ask": "q_nv_gy_committee",
          "confirmed": false,
          "unconfirmed_reason": null,
          "source_ref": []
        },
        {
          "kind": "requirements",
          "id": "gy-policy",
          "text": "指針を整備していること",
          "ask": "q_nv_gy_policy",
          "confirmed": false,
          "unconfirmed_reason": null,
          "source_ref": []
        },
        {
          "kind": "requirements",
          "id": "gy-training",
          "text": "研修を実施していること",
          "ask": "q_nv_gy_training",
          "confirmed": false,
          "unconfirmed_reason": null,
          "source_ref": []
        },
        {
          "kind": "requirements",
          "id": "gy-officer",
          "text": "担当者を定めていること",
          "ask": "q_nv_gy_officer",
          "confirmed": false,
          "unconfirmed_reason": null,
          "source_ref": []
        }
      ],
      "we_do_not_say": "該当・非該当の判定はしない。4つの措置それぞれの状態を並べるところまで。",
      "sources": [
        "mhlw-shorei-h11-37",
        "mhlw-001195261",
        "kaipoke-gyakutai",
        "ibow-20240529"
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
        "value": "所定単位数に 98/100 を乗じる",
        "confirmed": true,
        "unconfirmed_reason": null,
        "source_ref": [
          "mhlw-001195509",
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
          "id": "jk-staff",
          "text": "准看護師が訪問しているか",
          "ask": "q_nv_staff",
          "confirmed": false,
          "unconfirmed_reason": null,
          "source_ref": []
        }
      ],
      "we_do_not_say": "請求額がいくら下がるとは言わない。該当する訪問があるかどうかを見るところまで。",
      "sources": [
        "mhlw-001195509"
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
          "text": "理学療法士・作業療法士・言語聴覚士による訪問を行っているか",
          "ask": "q_nv_staff",
          "confirmed": false,
          "unconfirmed_reason": null,
          "source_ref": []
        }
      ],
      "we_do_not_say": "この食い違いが解けるまで、この項目の数字を根拠にした案内は出さない。",
      "sources": [
        "mhlw-001195509",
        "ibow-20240529"
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
          "text": "特別な管理を必要とする状態に当たるか。告示第94号『単位数表の訪問看護費の注7の厚生労働大臣が定める状態』は イ 在宅麻薬等注射指導管理・在宅腫瘍化学療法注射指導管理・在宅強心剤持続投与指導管理・在宅気管切開患者指導管理を受けている状態、又は気管カニューレ若しくは留置カテーテルを使用している状態 / ロ 在宅自己腹膜灌流指導管理・在宅血液透析指導管理・在宅酸素療法指導管理等を受けている状態 / ハ 人工肛門又は人工膀胱を設置している状態 / ニ 真皮を越える褥瘡の状態 / ホ 点滴注射を週三日以上行う必要があると認められる状態。",
          "ask": "q_nv_kasan",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-kokuji94-jotai"
          ]
        }
      ],
      "we_do_not_say": "算定できます、とは言わない。算定していない場合に、要件を満たしうる利用者がいるかを一緒に見るところまで。",
      "sources": [
        "mhlw-001195509"
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
          "text": "死亡日および死亡日前14日以内のターミナルケアの実施日が記録から辿れるか",
          "ask": "q_nv_kasan",
          "confirmed": false,
          "unconfirmed_reason": null,
          "source_ref": []
        }
      ],
      "we_do_not_say": "算定できます、とは言わない。記録から実施日が辿れるかを見るところまで。",
      "sources": [
        "mhlw-001195509"
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
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-houkan-st"
          ]
        },
        {
          "kind": "requirements",
          "id": "kanri-anzen",
          "text": "安全な提供体制の整備(安全管理の基本方針と事故対応方法の文書化、インシデント報告と改善の体制、業務継続計画の策定)が要る。",
          "ask": "q_nv_bcp_plan",
          "confirmed": false,
          "unconfirmed_reason": "令和6年度の通知(保発0305第12号)で確認した要件である。令和8年6月施行版の通知の原文にまだ当たれていない。",
          "source_ref": [
            "mhlw-r6-hohatsu12"
          ]
        }
      ],
      "we_do_not_say": "この区分で算定できます、とは言わない。届出区分と額の対応を示すところまで。",
      "sources": [
        "mhlw-santei-houhou-genko",
        "mhlw-r8-houkan-st",
        "mhlw-r6-hohatsu12"
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
        "value": "令和8年度診療報酬改定で、訪問看護管理療養費1と2を統合し、施設基準の届出を不要とし、単一建物居住利用者の人数と1月当たりの訪問日数によって細分化した。イ 単一建物居住利用者20人未満 3,010円 / ロ 20人以上49人以下 (1)訪問日数15日以下 2,510円 (2)16日以上24日以下 2,310円 (3)25日以上 2,210円 / ハ 50人以上 (1)15日以下 2,410円 (2)16日以上24日以下 2,210円 (3)25日以上 2,010円",
        "confirmed": false,
        "unconfirmed_reason": "新旧対照表(mhlw-r8-iryo-shinkyu)から取ったが、読み取りが『改正後』と『改正前』の欄を入れ替えて返した。返ってきた『改正後』は 訪問看護管理療養費1 3,000円 / 2 2,500円 で、これは令和8年度改定で統合されて消えたはずの区分である。厚生労働省の資料(mhlw-r8-houkan-st)が『1と2を統合し細分化した』と書いていること、および二次資料が改正後の区分イを3,010円としていることから、単一建物居住利用者ベースの細分化のほうが改正後だと判断した。区分イ 3,010円 は二つ(新旧対照表・二次資料)で一致しているが、ロとハの各額は新旧対照表1件しかない。欄の取り違えが起きた読みでもあるので、この塊は確定にしない。原本で1区分ずつ照合すること。",
        "source_ref": [
          "mhlw-r8-houkan-st",
          "mhlw-santei-houhou-genko",
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
          "id": "kanri2-kubun",
          "text": "月の2日目以降の額は、1月当たりの訪問日数と、単一建物に居住する利用者の人数で決まる。この2つを毎月数えていなければ、正しい区分を選べない。",
          "ask": "q_nv_douitsu_tatemono",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-houkan-st"
          ]
        },
        {
          "kind": "requirements",
          "id": "kanri2-todokede-fuyo",
          "text": "令和8年度改定で施設基準の届出が不要になった(令和6年度は管理療養費1・2のいずれかの届出が要った)。",
          "ask": "q_nv_todokede",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-r8-houkan-st"
          ]
        }
      ],
      "we_do_not_say": "区分ごとの額は、原本の表を確かめるまで一切出さない。",
      "sources": [
        "mhlw-r8-houkan-st",
        "mhlw-santei-houhou-genko"
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
          "text": "利用者またはその家族等から電話等により看護に関する意見を求められた場合に、常時対応できる体制にあるものとして地方厚生局長等に届け出ていること。",
          "ask": "q_nv_kinkyuji_taisei",
          "confirmed": false,
          "unconfirmed_reason": "令和6年度の通知で確認した文言である。令和8年6月施行版の通知の原文に未着。",
          "source_ref": [
            "mhlw-r6-hohatsu12"
          ]
        },
        {
          "kind": "requirements",
          "id": "24h-futankeigen",
          "text": "6,800円の区分は『看護業務の負担の軽減に資する十分な業務管理等の体制』が要る。ア 夜間対応した翌日の勤務間隔の確保 / イ 夜間対応に係る勤務の連続回数が2連続まで / ウ 夜間対応後の暦日の休日確保 / エ 夜間勤務のニーズを踏まえた勤務体制の工夫 / オ ICT・AI・IoT等の活用による業務負担軽減 / カ 電話等の連絡・相談を担当する者への支援体制 のうち、アまたはイを含む2項目以上を満たすこと。",
          "ask": "q_nv_24h_futan",
          "confirmed": false,
          "unconfirmed_reason": "令和6年度の施設基準通知(保医発0305第7号)で確認した内容である。令和8年6月施行版で項目や『アまたはイを含む2項目以上』が変わっていないかを未確認。",
          "source_ref": [
            "mhlw-r6-hohatsu12"
          ]
        }
      ],
      "we_do_not_say": "6,800円で算定できます、とは言わない。どの取組を満たしているかを並べるところまで。",
      "sources": [
        "mhlw-santei-houhou-genko",
        "mhlw-r8-houkan-st",
        "mhlw-r6-hohatsu12"
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
        "confirmed": false,
        "unconfirmed_reason": "現行告示(法令等データベース)から読み取った額である。同じ額を別の資料で突き合わせていない。一つの資料をそう読んだ、という段階。",
        "source_ref": [
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
          "text": "利用者1人につき週3日を限度とする。ただし基準告示に規定する疾病等の利用者(特掲診療料の施設基準等 別表第七・別表第八に該当する者等)は週4日以上算定できる。",
          "ask": "q_nv_beppyo7",
          "confirmed": false,
          "unconfirmed_reason": "令和6年度の通知で確認した。令和8年6月施行版の通知の原文に未着。",
          "source_ref": [
            "mhlw-r6-hohatsu12",
            "mhlw-tokkei-beppyo7"
          ]
        },
        {
          "kind": "requirements",
          "id": "kihon-i-senmon",
          "text": "ハ(12,850円)は、専門の研修を受けた看護師が行う場合である。在籍していなければ、この区分は最初から選べない。",
          "ask": "q_nv_tokutei_koui",
          "confirmed": false,
          "unconfirmed_reason": "額は現行告示で確認したが、研修の要件(600時間以上・修了証)の令和8年6月施行版の原文に未着。",
          "source_ref": [
            "mhlw-santei-houhou-genko"
          ]
        }
      ],
      "we_do_not_say": "この区分で算定できます、とは言わない。",
      "sources": [
        "mhlw-santei-houhou-genko",
        "mhlw-r6-hohatsu12"
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
        "confirmed": false,
        "unconfirmed_reason": "現行告示から読み取った額である。別資料との突き合わせをしていない。",
        "source_ref": [
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
          "text": "特別な管理を必要とする利用者に対して常時対応できる体制が整備されているものとして地方厚生局長等に届け出ていること。月1回に限る。",
          "ask": "q_nv_todokede",
          "confirmed": false,
          "unconfirmed_reason": "令和6年度の通知で確認した。令和8年6月施行版の原文に未着。",
          "source_ref": [
            "mhlw-r6-hohatsu12"
          ]
        },
        {
          "kind": "requirements",
          "id": "tk-taisho",
          "text": "5,000円と2,500円それぞれの対象となる状態の列挙(在宅悪性腫瘍等患者指導管理、気管カニューレ使用、留置カテーテル使用などの区分)は、まだ原文で取れていない。",
          "ask": "q_nv_kasan",
          "confirmed": false,
          "unconfirmed_reason": "告示・通知の当該箇所に到達できていない。対象状態が分からなければ、どちらの額かを判定できない。",
          "source_ref": []
        }
      ],
      "we_do_not_say": "重症度が高いので5,000円です、とは言わない。対象状態の列挙が手元に無い。",
      "sources": [
        "mhlw-santei-houhou-genko",
        "mhlw-r6-hohatsu12"
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
        "confirmed": false,
        "unconfirmed_reason": "現行告示から読み取った額である。別資料との突き合わせをしていない。",
        "source_ref": [
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
          "text": "訪問看護計画に基づき定期的に行う訪問以外で、利用者またはその家族等の緊急の求めに応じ、主治医の指示により訪問した場合に、1日1回に限り算定する。",
          "ask": "q_nv_kinkyuji_taisei",
          "confirmed": false,
          "unconfirmed_reason": "令和6年度の通知で確認した。令和8年6月施行版の原文に未着。",
          "source_ref": [
            "mhlw-r6-hohatsu12"
          ]
        },
        {
          "kind": "requirements",
          "id": "kinkyu-riyu-kisai",
          "text": "令和6年度改定で、加算の算定理由を訪問看護療養費明細書に記載することが必要とされた。記載が無ければ返戻の理由になりうる。",
          "ask": "q_nv_mayotta",
          "confirmed": false,
          "unconfirmed_reason": "令和6年度の改定概要で確認した。令和8年6月施行版で残っているかを未確認。",
          "source_ref": [
            "mhlw-r6-hohatsu12"
          ]
        }
      ],
      "we_do_not_say": "緊急なので算定できます、とは言わない。",
      "sources": [
        "mhlw-santei-houhou-genko",
        "mhlw-r6-hohatsu12"
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
          "text": "6歳未満の利用者に対して訪問看護を実施した場合に、1日1回に限り算定する。",
          "ask": "q_nv_kasan",
          "confirmed": false,
          "unconfirmed_reason": "令和6年度の通知で確認した。令和8年6月施行版の原文に未着。",
          "source_ref": [
            "mhlw-r6-hohatsu12"
          ]
        },
        {
          "kind": "requirements",
          "id": "nyuyoji-1800",
          "text": "1,800円の対象は、超重症児・準超重症児、別表第七に掲げる疾病等の者、別表第八に該当する者。令和8年度改定で『それ以外』側の評価が見直された(1,300円 -> 1,400円)。",
          "ask": "q_nv_beppyo7",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-santei-houhou-genko",
            "mhlw-r8-houkan-st"
          ]
        }
      ],
      "we_do_not_say": "1,800円の対象です、とは言わない。",
      "sources": [
        "mhlw-santei-houhou-genko",
        "mhlw-r8-houkan-st",
        "mhlw-r6-hohatsu12"
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
        "confirmed": false,
        "unconfirmed_reason": "現行告示から読み取った額である。1と2の区分の基準(在宅で死亡した場合と、特別養護老人ホーム等で看取り介護加算等を算定している場合の別)の原文に未着。",
        "source_ref": [
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
          "text": "主治医の指示により、死亡日および死亡日前14日以内に2回以上訪問看護を実施し、ターミナルケアに係る支援体制について利用者および家族等に説明した上でターミナルケアを行うこと。",
          "ask": "q_nv_kasan",
          "confirmed": false,
          "unconfirmed_reason": "令和6年度告示の注で確認した。令和8年6月施行版の原文に未着。",
          "source_ref": [
            "mhlw-r6-hohatsu12"
          ]
        },
        {
          "kind": "requirements",
          "id": "tc-kubun",
          "text": "1と2のどちらになるかは、利用者が亡くなった場所と、そこで看取りに係る加算が算定されているかで分かれる。この区分の原文が手元に無い。",
          "ask": "q_nv_kasan",
          "confirmed": false,
          "unconfirmed_reason": "告示・通知の当該箇所に到達できていない。",
          "source_ref": []
        }
      ],
      "we_do_not_say": "1で算定できます、とは言わない。",
      "sources": [
        "mhlw-santei-houhou-genko",
        "mhlw-r6-hohatsu12"
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
          "text": "訪問看護医療情報連携加算(1,000円・月1回)は、利用者の同意取得、次回訪問予定日、計画変更の有無、ケアの留意点、人生の最終段階における医療・ケアの希望等の記録が要る。記録の型を先に作っておかないと、算定できても後から出せない。",
          "ask": "q_nv_todokede",
          "confirmed": false,
          "unconfirmed_reason": "概要資料の記載である。施設基準通知の原文に未着。",
          "source_ref": [
            "mhlw-r8-houkan-st"
          ]
        },
        {
          "kind": "requirements",
          "id": "r8-kiroku-jikoku",
          "text": "訪問看護記録書に『実際の訪問開始時刻と終了時刻』を記載することが明確化された。",
          "ask": "q_nv_shido",
          "confirmed": false,
          "unconfirmed_reason": "概要資料の記載である。通知の原文に未着。",
          "source_ref": [
            "mhlw-r8-houkan-st"
          ]
        },
        {
          "kind": "requirements",
          "id": "r8-oshiin",
          "text": "訪問看護計画書・報告書は書面の場合に署名・押印を求めないこととし、様式例から押印欄が削除された。訪問看護指示書の押印欄も削除された。",
          "ask": "q_nv_iryo_youshiki",
          "confirmed": false,
          "unconfirmed_reason": "概要資料の記載である。様式そのものを取得していない。",
          "source_ref": [
            "mhlw-r8-houkan-st"
          ]
        }
      ],
      "we_do_not_say": "新設分が算定できます、とは言わない。まず額と要件の原文を取る。",
      "sources": [
        "mhlw-r8-houkan-st"
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
          "text": "別表第七に該当する利用者が何人いるかを把握していること。該当者は要介護でも医療保険側になるため、ここを取り違えると保険を間違える。",
          "ask": "q_nv_beppyo7",
          "confirmed": false,
          "unconfirmed_reason": "別表第七の20項目は取得済み。ただし別表第八の全項目の原文はまだ取れていない。",
          "source_ref": [
            "mhlw-tokkei-beppyo7",
            "kouseikyoku-kinki-r6-shudan"
          ]
        },
        {
          "kind": "requirements",
          "id": "fw-tokubetsu-kikan",
          "text": "特別訪問看護指示書が交付されている期間(交付日から14日以内・14日を限度)は医療保険側になる。",
          "ask": "q_nv_tokubetsu_days",
          "confirmed": false,
          "unconfirmed_reason": "令和6年度の通知と厚生局資料で確認した。令和8年6月施行版の原文に未着。",
          "source_ref": [
            "mhlw-r6-hohatsu12",
            "kouseikyoku-kinki-r6-shudan"
          ]
        },
        {
          "kind": "requirements",
          "id": "fw-seishinka",
          "text": "精神科訪問看護基本療養費を算定する場合は医療保険側になる。認知症を主たる傷病とする場合の扱いは、まだ原文で確かめていない。",
          "ask": "q_nv_seishinka",
          "confirmed": false,
          "unconfirmed_reason": "厚生局資料で3つの例外は確認したが、認知症の扱いの明示的な記載を確認できていない。",
          "source_ref": [
            "kouseikyoku-kinki-r6-shudan"
          ]
        }
      ],
      "we_do_not_say": "この方は医療保険です、とは言わない。振り分けの分岐点と、どの分岐が未確認かを示すところまで。",
      "sources": [
        "kouseikyoku-kinki-r6-shudan",
        "mhlw-tokkei-beppyo7",
        "mhlw-r6-hohatsu12"
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
        "value": "20分未満 314単位 / 30分未満 471単位 / 30分以上1時間未満 823単位 / 1時間以上1時間30分未満 1,128単位。理学療法士・作業療法士・言語聴覚士による場合は20分未満 294単位(1時間未満・1時間30分未満の値は読み取れていない)。",
        "confirmed": false,
        "unconfirmed_reason": "二つの資料で値が違った。令和8年6月施行の表では 314/471/823/1,128単位、令和6年4月改定の表では 313/470/821/1,125単位と出た。本当に令和8年で上がったのか、どちらかの読み取りが1ずつずれているのかを、原本の表で確かめる。",
        "source_ref": [
          "mhlw-001195509",
          "mhlw-santei-kouzou-r8",
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
          "id": "kihon-jikan",
          "text": "訪問の時間区分(20分未満/30分未満/30分以上1時間未満/1時間以上1時間30分未満)ごとに単位数が違う。実際の訪問開始時刻と終了時刻の記録が無ければ、どの区分かを裏づけられない。",
          "ask": "q_nv_shido",
          "confirmed": false,
          "unconfirmed_reason": "令和8年6月施行の算定構造 PDF を、要約経由で読んだ値である。同じ PDF を二度読ませたところ、緊急時訪問看護加算と特別管理加算の単位数が入れ替わって出た(conflicts: santei-kouzou-r8-yomitori 参照)。読み取りが安定していないので、原本の表を人が見て確定するまで確定にしない。",
          "source_ref": [
            "mhlw-santei-kouzou-r8"
          ]
        },
        {
          "kind": "requirements",
          "id": "kihon-junkangoshi",
          "text": "准看護師による訪問が1回でもある場合、所定単位数に 98/100 を乗じる。",
          "ask": "q_nv_staff",
          "confirmed": false,
          "unconfirmed_reason": "令和8年6月施行の算定構造 PDF を、要約経由で読んだ値である。同じ PDF を二度読ませたところ、緊急時訪問看護加算と特別管理加算の単位数が入れ替わって出た(conflicts: santei-kouzou-r8-yomitori 参照)。読み取りが安定していないので、原本の表を人が見て確定するまで確定にしない。",
          "source_ref": [
            "mhlw-santei-kouzou-r8"
          ]
        }
      ],
      "we_do_not_say": "算定できます、とは言わない。要件を並べ、どれが未確認かを示すところまで。",
      "sources": [
        "mhlw-santei-kouzou-r8",
        "mhlw-r8-kaigo-index"
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
          "text": "(Ⅰ)(Ⅱ)共通: 利用者又はその家族等から電話等により看護に関する意見を求められた場合に常時対応できる体制にあること。(Ⅰ)のみ: 緊急時訪問における看護業務の負担の軽減に資する十分な業務管理等の体制の整備が行われていること。届出が要る。",
          "ask": "q_nv_kinkyuji_taisei",
          "confirmed": true,
          "unconfirmed_reason": null,
          "source_ref": [
            "mhlw-kijun-kokuji95",
            "caretasukeru-kinkyuji"
          ]
        },
        {
          "kind": "requirements",
          "id": "kinkyuji-todokede",
          "text": "体制届出を出していなければ算定できない。出した加算の名前と提出先を押さえる。",
          "ask": "q_nv_todokede",
          "confirmed": false,
          "unconfirmed_reason": "令和8年6月施行の算定構造 PDF を、要約経由で読んだ値である。同じ PDF を二度読ませたところ、緊急時訪問看護加算と特別管理加算の単位数が入れ替わって出た(conflicts: santei-kouzou-r8-yomitori 参照)。読み取りが安定していないので、原本の表を人が見て確定するまで確定にしない。",
          "source_ref": [
            "mhlw-santei-kouzou-r8"
          ]
        }
      ],
      "we_do_not_say": "算定できます、とは言わない。要件を並べ、どれが未確認かを示すところまで。 単位数は原本を見るまで一切出さない。",
      "sources": [
        "mhlw-santei-kouzou-r8"
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
          "text": "新規に訪問看護計画書を作成した利用者に対する初回の訪問であること。(Ⅰ)と(Ⅱ)の分かれ目(退院・退所直後かどうか等)は原文で未確認。",
          "ask": "q_nv_shokai",
          "confirmed": false,
          "unconfirmed_reason": "令和8年6月施行の算定構造 PDF を、要約経由で読んだ値である。同じ PDF を二度読ませたところ、緊急時訪問看護加算と特別管理加算の単位数が入れ替わって出た(conflicts: santei-kouzou-r8-yomitori 参照)。読み取りが安定していないので、原本の表を人が見て確定するまで確定にしない。",
          "source_ref": [
            "mhlw-santei-kouzou-r8"
          ]
        },
        {
          "kind": "requirements",
          "id": "shokai-taiin",
          "text": "退院・退所の直後に受けた件数を押さえる。区分の判定に効く。",
          "ask": "q_nv_shokai",
          "confirmed": false,
          "unconfirmed_reason": "令和8年6月施行の算定構造 PDF を、要約経由で読んだ値である。同じ PDF を二度読ませたところ、緊急時訪問看護加算と特別管理加算の単位数が入れ替わって出た(conflicts: santei-kouzou-r8-yomitori 参照)。読み取りが安定していないので、原本の表を人が見て確定するまで確定にしない。",
          "source_ref": [
            "mhlw-santei-kouzou-r8"
          ]
        }
      ],
      "we_do_not_say": "算定できます、とは言わない。要件を並べ、どれが未確認かを示すところまで。",
      "sources": [
        "mhlw-santei-kouzou-r8"
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
          "text": "病院等の職員と共同して在宅療養上必要な指導を行い、その内容を文書により提供すること。",
          "ask": "q_nv_taiin_kyodo",
          "confirmed": false,
          "unconfirmed_reason": "令和8年6月施行の算定構造 PDF を、要約経由で読んだ値である。同じ PDF を二度読ませたところ、緊急時訪問看護加算と特別管理加算の単位数が入れ替わって出た(conflicts: santei-kouzou-r8-yomitori 参照)。読み取りが安定していないので、原本の表を人が見て確定するまで確定にしない。",
          "source_ref": [
            "mhlw-santei-kouzou-r8"
          ]
        },
        {
          "kind": "requirements",
          "id": "tk-bunsho",
          "text": "文書を渡した記録が残っていなければ、後から出せない。",
          "ask": "q_nv_taiin_kyodo",
          "confirmed": false,
          "unconfirmed_reason": "令和8年6月施行の算定構造 PDF を、要約経由で読んだ値である。同じ PDF を二度読ませたところ、緊急時訪問看護加算と特別管理加算の単位数が入れ替わって出た(conflicts: santei-kouzou-r8-yomitori 参照)。読み取りが安定していないので、原本の表を人が見て確定するまで確定にしない。",
          "source_ref": [
            "mhlw-santei-kouzou-r8"
          ]
        }
      ],
      "we_do_not_say": "算定できます、とは言わない。要件を並べ、どれが未確認かを示すところまで。",
      "sources": [
        "mhlw-santei-kouzou-r8",
        "mhlw-001195509"
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
          "text": "緊急時訪問看護加算・特別管理加算・ターミナルケア加算の算定実績の割合が要件になる。直近の実績件数を押さえないと、届出の可否が判定できない。",
          "ask": "q_nv_kango_taisei",
          "confirmed": false,
          "unconfirmed_reason": "令和8年6月施行の算定構造 PDF を、要約経由で読んだ値である。同じ PDF を二度読ませたところ、緊急時訪問看護加算と特別管理加算の単位数が入れ替わって出た(conflicts: santei-kouzou-r8-yomitori 参照)。読み取りが安定していないので、原本の表を人が見て確定するまで確定にしない。",
          "source_ref": [
            "mhlw-santei-kouzou-r8"
          ]
        },
        {
          "kind": "requirements",
          "id": "kt-kango-wariai",
          "text": "看護職員の割合(6割以上)の要件がある。原文で未確認。",
          "ask": "q_nv_staff",
          "confirmed": false,
          "unconfirmed_reason": "令和8年6月施行の算定構造 PDF を、要約経由で読んだ値である。同じ PDF を二度読ませたところ、緊急時訪問看護加算と特別管理加算の単位数が入れ替わって出た(conflicts: santei-kouzou-r8-yomitori 参照)。読み取りが安定していないので、原本の表を人が見て確定するまで確定にしない。",
          "source_ref": [
            "mhlw-santei-kouzou-r8"
          ]
        },
        {
          "kind": "requirements",
          "id": "kt-1-kinkyuji",
          "text": "(Ⅰ) 算定日が属する月の前六月間において、利用者の総数のうち緊急時訪問看護加算を算定した利用者の占める割合が百分の五十以上であること",
          "ask": "q_nv_kango_taisei",
          "confirmed": false,
          "unconfirmed_reason": "告示第95号(statute・現行)から取れた文言だが、一度しか読めていない。同じ URL に &mode=0 を足して二度目を読ませたところ、別の告示(第67号)が返ってきた。厚労省の t_doc は、同じ dataId でも返す法令が変わることがある(attempts 参照)。二度目の読みが取れない以上、規律10により確定にしない。e-Gov など、条を指定して安定して返る経路で二度目を取ること。",
          "source_ref": [
            "mhlw-kijun-kokuji95"
          ]
        },
        {
          "kind": "requirements",
          "id": "kt-1-tokubetsu",
          "text": "(Ⅰ) 算定日が属する月の前六月間において、特別管理加算を算定した利用者の占める割合が百分の二十以上であること",
          "ask": "q_nv_kango_taisei",
          "confirmed": false,
          "unconfirmed_reason": "告示第95号(statute・現行)から取れた文言だが、一度しか読めていない。同じ URL に &mode=0 を足して二度目を読ませたところ、別の告示(第67号)が返ってきた。厚労省の t_doc は、同じ dataId でも返す法令が変わることがある(attempts 参照)。二度目の読みが取れない以上、規律10により確定にしない。e-Gov など、条を指定して安定して返る経路で二度目を取ること。",
          "source_ref": [
            "mhlw-kijun-kokuji95"
          ]
        },
        {
          "kind": "requirements",
          "id": "kt-1-terminal",
          "text": "(Ⅰ) 算定日が属する月の前十二月間において、ターミナルケア加算を算定した利用者が五名以上であること",
          "ask": "q_nv_kango_taisei",
          "confirmed": false,
          "unconfirmed_reason": "告示第95号(statute・現行)から取れた文言だが、一度しか読めていない。同じ URL に &mode=0 を足して二度目を読ませたところ、別の告示(第67号)が返ってきた。厚労省の t_doc は、同じ dataId でも返す法令が変わることがある(attempts 参照)。二度目の読みが取れない以上、規律10により確定にしない。e-Gov など、条を指定して安定して返る経路で二度目を取ること。",
          "source_ref": [
            "mhlw-kijun-kokuji95"
          ]
        },
        {
          "kind": "requirements",
          "id": "kt-1-kangoshoku",
          "text": "(Ⅰ) 当該事業所において指定訪問看護の提供に当たる従業者の総数のうち、看護職員の占める割合が百分の六十以上であること",
          "ask": "q_nv_staff",
          "confirmed": false,
          "unconfirmed_reason": "告示第95号(statute・現行)から取れた文言だが、一度しか読めていない。同じ URL に &mode=0 を足して二度目を読ませたところ、別の告示(第67号)が返ってきた。厚労省の t_doc は、同じ dataId でも返す法令が変わることがある(attempts 参照)。二度目の読みが取れない以上、規律10により確定にしない。e-Gov など、条を指定して安定して返る経路で二度目を取ること。",
          "source_ref": [
            "mhlw-kijun-kokuji95"
          ]
        },
        {
          "kind": "requirements",
          "id": "kt-2-kinkyuji",
          "text": "(Ⅱ) 算定日が属する月の前六月間において、緊急時訪問看護加算を算定した利用者の占める割合が百分の五十以上であること",
          "ask": "q_nv_kango_taisei",
          "confirmed": false,
          "unconfirmed_reason": "告示第95号(statute・現行)から取れた文言だが、一度しか読めていない。同じ URL に &mode=0 を足して二度目を読ませたところ、別の告示(第67号)が返ってきた。厚労省の t_doc は、同じ dataId でも返す法令が変わることがある(attempts 参照)。二度目の読みが取れない以上、規律10により確定にしない。e-Gov など、条を指定して安定して返る経路で二度目を取ること。",
          "source_ref": [
            "mhlw-kijun-kokuji95"
          ]
        },
        {
          "kind": "requirements",
          "id": "kt-2-terminal",
          "text": "(Ⅱ) 算定日が属する月の前十二月間において、ターミナルケア加算を算定した利用者が一名以上であること",
          "ask": "q_nv_kango_taisei",
          "confirmed": false,
          "unconfirmed_reason": "告示第95号(statute・現行)から取れた文言だが、一度しか読めていない。同じ URL に &mode=0 を足して二度目を読ませたところ、別の告示(第67号)が返ってきた。厚労省の t_doc は、同じ dataId でも返す法令が変わることがある(attempts 参照)。二度目の読みが取れない以上、規律10により確定にしない。e-Gov など、条を指定して安定して返る経路で二度目を取ること。",
          "source_ref": [
            "mhlw-kijun-kokuji95"
          ]
        }
      ],
      "we_do_not_say": "算定できます、とは言わない。要件を並べ、どれが未確認かを示すところまで。",
      "sources": [
        "mhlw-santei-kouzou-r8",
        "mhlw-001195509",
        "mhlw-kijun-kokuji95"
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
          "text": "看護師等ごとに研修計画を作成し、実施していること。",
          "ask": "q_nv_service_taisei",
          "confirmed": false,
          "unconfirmed_reason": "令和8年6月施行の算定構造 PDF を、要約経由で読んだ値である。同じ PDF を二度読ませたところ、緊急時訪問看護加算と特別管理加算の単位数が入れ替わって出た(conflicts: santei-kouzou-r8-yomitori 参照)。読み取りが安定していないので、原本の表を人が見て確定するまで確定にしない。",
          "source_ref": [
            "mhlw-santei-kouzou-r8"
          ]
        },
        {
          "kind": "requirements",
          "id": "st-kaigi",
          "text": "利用者に関する情報を共有する会議を定期的に開催していること。",
          "ask": "q_nv_service_taisei",
          "confirmed": false,
          "unconfirmed_reason": "令和8年6月施行の算定構造 PDF を、要約経由で読んだ値である。同じ PDF を二度読ませたところ、緊急時訪問看護加算と特別管理加算の単位数が入れ替わって出た(conflicts: santei-kouzou-r8-yomitori 参照)。読み取りが安定していないので、原本の表を人が見て確定するまで確定にしない。",
          "source_ref": [
            "mhlw-santei-kouzou-r8"
          ]
        },
        {
          "kind": "requirements",
          "id": "st-kinzoku",
          "text": "勤続年数の要件がある((Ⅰ)と(Ⅱ)の分かれ目)。年数の閾値は原文で未確認。",
          "ask": "q_nv_staff",
          "confirmed": false,
          "unconfirmed_reason": "令和8年6月施行の算定構造 PDF を、要約経由で読んだ値である。同じ PDF を二度読ませたところ、緊急時訪問看護加算と特別管理加算の単位数が入れ替わって出た(conflicts: santei-kouzou-r8-yomitori 参照)。読み取りが安定していないので、原本の表を人が見て確定するまで確定にしない。",
          "source_ref": [
            "mhlw-santei-kouzou-r8"
          ]
        }
      ],
      "we_do_not_say": "算定できます、とは言わない。要件を並べ、どれが未確認かを示すところまで。",
      "sources": [
        "mhlw-santei-kouzou-r8",
        "mhlw-001195509"
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
          "text": "該当する研修を修了した看護師が在籍していなければ、最初から算定できない。",
          "ask": "q_nv_tokutei_koui",
          "confirmed": false,
          "unconfirmed_reason": "令和8年6月施行の算定構造 PDF を、要約経由で読んだ値である。同じ PDF を二度読ませたところ、緊急時訪問看護加算と特別管理加算の単位数が入れ替わって出た(conflicts: santei-kouzou-r8-yomitori 参照)。読み取りが安定していないので、原本の表を人が見て確定するまで確定にしない。",
          "source_ref": [
            "mhlw-santei-kouzou-r8"
          ]
        },
        {
          "kind": "requirements",
          "id": "senmon-tejunsho",
          "text": "特定行為研修修了者の場合は、手順書に基づく計画的な管理であること。",
          "ask": "q_nv_tokutei_koui",
          "confirmed": false,
          "unconfirmed_reason": "令和8年6月施行の算定構造 PDF を、要約経由で読んだ値である。同じ PDF を二度読ませたところ、緊急時訪問看護加算と特別管理加算の単位数が入れ替わって出た(conflicts: santei-kouzou-r8-yomitori 参照)。読み取りが安定していないので、原本の表を人が見て確定するまで確定にしない。",
          "source_ref": [
            "mhlw-santei-kouzou-r8"
          ]
        }
      ],
      "we_do_not_say": "算定できます、とは言わない。要件を並べ、どれが未確認かを示すところまで。",
      "sources": [
        "mhlw-santei-kouzou-r8"
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
          "text": "情報通信機器を用いた在宅での看取りに係る研修を受けた看護師が、医師の死亡診断の補助を行うこと。",
          "ask": "q_nv_tokutei_koui",
          "confirmed": false,
          "unconfirmed_reason": "令和8年6月施行の算定構造 PDF を、要約経由で読んだ値である。同じ PDF を二度読ませたところ、緊急時訪問看護加算と特別管理加算の単位数が入れ替わって出た(conflicts: santei-kouzou-r8-yomitori 参照)。読み取りが安定していないので、原本の表を人が見て確定するまで確定にしない。",
          "source_ref": [
            "mhlw-santei-kouzou-r8"
          ]
        },
        {
          "kind": "requirements",
          "id": "es-terminal",
          "text": "ターミナルケア加算を算定していることが前提になる。原文で未確認。",
          "ask": "q_nv_kango_taisei",
          "confirmed": false,
          "unconfirmed_reason": "令和8年6月施行の算定構造 PDF を、要約経由で読んだ値である。同じ PDF を二度読ませたところ、緊急時訪問看護加算と特別管理加算の単位数が入れ替わって出た(conflicts: santei-kouzou-r8-yomitori 参照)。読み取りが安定していないので、原本の表を人が見て確定するまで確定にしない。",
          "source_ref": [
            "mhlw-santei-kouzou-r8"
          ]
        }
      ],
      "we_do_not_say": "算定できます、とは言わない。要件を並べ、どれが未確認かを示すところまで。",
      "sources": [
        "mhlw-santei-kouzou-r8"
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
          "text": "口腔の健康状態の評価を実施し、その情報を歯科医療機関および介護支援専門員に提供すること。",
          "ask": "q_nv_kouku",
          "confirmed": false,
          "unconfirmed_reason": "令和8年6月施行の算定構造 PDF を、要約経由で読んだ値である。同じ PDF を二度読ませたところ、緊急時訪問看護加算と特別管理加算の単位数が入れ替わって出た(conflicts: santei-kouzou-r8-yomitori 参照)。読み取りが安定していないので、原本の表を人が見て確定するまで確定にしない。",
          "source_ref": [
            "mhlw-santei-kouzou-r8"
          ]
        },
        {
          "kind": "requirements",
          "id": "kk-kiroku",
          "text": "提供した記録が残っていなければ、後から出せない。",
          "ask": "q_nv_kouku",
          "confirmed": false,
          "unconfirmed_reason": "令和8年6月施行の算定構造 PDF を、要約経由で読んだ値である。同じ PDF を二度読ませたところ、緊急時訪問看護加算と特別管理加算の単位数が入れ替わって出た(conflicts: santei-kouzou-r8-yomitori 参照)。読み取りが安定していないので、原本の表を人が見て確定するまで確定にしない。",
          "source_ref": [
            "mhlw-santei-kouzou-r8"
          ]
        }
      ],
      "we_do_not_say": "算定できます、とは言わない。要件を並べ、どれが未確認かを示すところまで。",
      "sources": [
        "mhlw-santei-kouzou-r8"
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
          "text": "訪問の時間帯で決まる。実際の訪問開始時刻の記録が無ければ裏づけられない。",
          "ask": "q_nv_yakan",
          "confirmed": false,
          "unconfirmed_reason": "令和8年6月施行の算定構造 PDF を、要約経由で読んだ値である。同じ PDF を二度読ませたところ、緊急時訪問看護加算と特別管理加算の単位数が入れ替わって出た(conflicts: santei-kouzou-r8-yomitori 参照)。読み取りが安定していないので、原本の表を人が見て確定するまで確定にしない。",
          "source_ref": [
            "mhlw-santei-kouzou-r8"
          ]
        }
      ],
      "we_do_not_say": "算定できます、とは言わない。要件を並べ、どれが未確認かを示すところまで。",
      "sources": [
        "mhlw-santei-kouzou-r8"
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
          "text": "同一建物に居住する利用者の人数を、月ごとに数えていること。数えていなければ、正しい率を当てられない。",
          "ask": "q_nv_douitsu_tatemono",
          "confirmed": false,
          "unconfirmed_reason": "令和8年6月施行の算定構造 PDF を、要約経由で読んだ値である。同じ PDF を二度読ませたところ、緊急時訪問看護加算と特別管理加算の単位数が入れ替わって出た(conflicts: santei-kouzou-r8-yomitori 参照)。読み取りが安定していないので、原本の表を人が見て確定するまで確定にしない。",
          "source_ref": [
            "mhlw-santei-kouzou-r8"
          ]
        }
      ],
      "we_do_not_say": "算定できます、とは言わない。要件を並べ、どれが未確認かを示すところまで。 何割減算になるかは、人数を数えたあとの話である。",
      "sources": [
        "mhlw-santei-kouzou-r8"
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
          "text": "事業所の所在地、または利用者の居住地が、指定された地域に当たるかどうかで決まる。指定地域の一覧は保険者(市町村)が示す。",
          "ask": "q_nv_chiiki",
          "confirmed": false,
          "unconfirmed_reason": "令和8年6月施行の算定構造 PDF を、要約経由で読んだ値である。同じ PDF を二度読ませたところ、緊急時訪問看護加算と特別管理加算の単位数が入れ替わって出た(conflicts: santei-kouzou-r8-yomitori 参照)。読み取りが安定していないので、原本の表を人が見て確定するまで確定にしない。",
          "source_ref": [
            "mhlw-santei-kouzou-r8"
          ]
        },
        {
          "kind": "requirements",
          "id": "ch-idou",
          "text": "片道の移動時間が要件になる区分がある。原文で未確認。",
          "ask": "q_nv_chiiki",
          "confirmed": false,
          "unconfirmed_reason": "令和8年6月施行の算定構造 PDF を、要約経由で読んだ値である。同じ PDF を二度読ませたところ、緊急時訪問看護加算と特別管理加算の単位数が入れ替わって出た(conflicts: santei-kouzou-r8-yomitori 参照)。読み取りが安定していないので、原本の表を人が見て確定するまで確定にしない。",
          "source_ref": [
            "mhlw-santei-kouzou-r8"
          ]
        }
      ],
      "we_do_not_say": "算定できます、とは言わない。要件を並べ、どれが未確認かを示すところまで。",
      "sources": [
        "mhlw-santei-kouzou-r8"
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
          "text": "その月に、医療保険の訪問看護が必要として主治医が発行した訪問看護指示の文書があるか。あるなら、その指示期間の日数を数えているか。",
          "ask": "q_nv_shiji",
          "confirmed": false,
          "unconfirmed_reason": "要件の文は算定構造の列見出しから起こしたもので、留意事項通知の本文には当たれていない。日数の数え方(初日・末日の扱い)も未確認。",
          "source_ref": [
            "mhlw-santei-kouzou-r8"
          ]
        }
      ],
      "we_do_not_say": "減算に該当します、とは言わない。指示期間の日数が数えられているかを見るところまで。",
      "sources": [
        "mhlw-santei-kouzou-r8",
        "mhlw-001195509"
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
          "text": "算定要件(訪問介護員等と連携して行う内容、記録の残し方、届出の要否)は、算定構造には載っていない。",
          "ask": "q_nv_kasan",
          "confirmed": false,
          "unconfirmed_reason": "算定構造は単位数の図表であって、算定要件の本文を含まない。留意事項通知(老企第36号)で確認する。",
          "source_ref": [
            "mhlw-santei-kouzou-r8"
          ]
        }
      ],
      "we_do_not_say": "算定できます、とは言わない。要件を並べ、どれが未確認かを示すところまで。",
      "sources": [
        "mhlw-santei-kouzou-r8",
        "mhlw-001195509"
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
          "text": "処遇改善計画書の作成・届出、実績報告などの要件を満たしているか。区分((Ⅳ)に準ずる要件、令和8年度特例要件)のどれで届け出たか。",
          "ask": "q_nv_todokede",
          "confirmed": false,
          "unconfirmed_reason": "要件の本文(令和8年3月13日 老発0313第6号など)には、まだ当たれていない。",
          "source_ref": [
            "mhlw-r8-kaigo-index"
          ]
        }
      ],
      "we_do_not_say": "算定できます、とは言わない。届出の状態と、要件のどれが未確認かを示すところまで。",
      "sources": [
        "mhlw-santei-kouzou-r8",
        "mhlw-r8-kaigo-index"
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
      "next": "訪問看護費の算定構造にある加算を、算定要件と体制届出の別つきで網羅する。"
    },
    {
      "gap": "このデータベースは令和6年度改定(2024)を見て作った。令和8年度改定が医療・介護の両方で令和8年6月に施行されている。既にある8項目は、まだ令和8年6月施行版で確かめ直していない。",
      "consequence": "請求前チェックと加算の取りこぼし探しを、古い単位数で動かすことになる。実際に額が動いている(訪問看護管理療養費 月の初日 機能強化型1 13,230円 -> 13,760円、乳幼児加算 1,300円 -> 1,400円、機能強化型4の新設)。古い物差しで『取りこぼしがあります』と言えば、それは支援ではなく誤誘導である。",
      "next": "令和8年6月施行の算定構造(mhlw-santei-kouzou-r8)と現行告示(mhlw-santei-houhou-genko)に1項目ずつ当て直し、effect.revision を r8-kaigo / r8-iryo に更新する。当て直しが済んだ項目から revision_recheck.needed を false にする。"
    },
    {
      "gap": "医療保険の訪問看護指示期間の日数につき減算(1日につき −97単位)が、この版に項目として入っていない。",
      "consequence": "医療保険へ移った期間の日割り減算を、内部MCPは知らない。取りこぼしではなく、過大請求の側の穴である。",
      "next": "算定構造の位置237の列(令和8・令和6とも −97単位)を出典に、項目として起こす。",
      "found_at": "2026-08-24",
      "found_how": "生テキストで算定構造を読み直したときに見つけた。"
    },
    {
      "gap": "看護・介護職員連携強化加算(1月につき +250単位)が入っていない。",
      "consequence": "算定できる加算を1つ知らない。",
      "next": "算定構造に『へ 看護・介護職員連携強化加算 （１月につき ＋２５０単位）』とある(令和8・令和6とも)。",
      "found_at": "2026-08-24",
      "found_how": "生テキストで算定構造を読み直したときに見つけた。"
    },
    {
      "gap": "訪問看護費の『ハ 定期巡回・随時対応型訪問介護看護事業所と連携する場合』(1月につき 2,961単位)が入っていない。",
      "consequence": "訪問看護費はイ(ステーション)・ロ(病院又は診療所)・ハ(定期巡回連携型)の三本立てだが、ハが無い。",
      "next": "算定構造に『（1月につき ２，９６１単位）』とある。ハの行だけ加算の値が違う列がある点に注意。",
      "found_at": "2026-08-24",
      "found_how": "生テキストで算定構造を読み直したときに見つけた。"
    },
    {
      "gap": "サービス提供体制強化加算のうち『ハを算定する場合』(1月につき +50単位 /+25単位)が入っていない。",
      "consequence": "ハを算定する事業所では、いま入っている 6単位/3単位 は当てはまらない。",
      "next": "算定構造に『（１）イ及びロを算定する場合 1回につき+6/+3』『（２）ハを算定する場合 1月につき+50/+25』とある。",
      "found_at": "2026-08-24",
      "found_how": "生テキストで算定構造を読み直したときに見つけた。"
    },
    {
      "gap": "介護職員等処遇改善加算の率(所定単位×18/1000)が項目として入っていない。",
      "consequence": "令和8年度臨時改定で訪問看護に新設された、唯一の変更点である。",
      "next": "算定構造に『ヌ 介護職員等処遇改善加算 （1月につき ＋所定単位×１８／１０００）』とある。二次資料の『1.8%』と一致。",
      "found_at": "2026-08-24",
      "found_how": "生テキストで算定構造を読み直したときに見つけた。"
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
