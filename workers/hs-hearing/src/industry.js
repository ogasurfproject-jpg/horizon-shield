/* ------------------------------------------------------------------
   業種。

   2026-08-23。合同会社あっぷす様(訪問看護)が LINE に「加盟店希望」と
   打たれたところ、建設業のヒアリングが返った。「対応できる工種と強み
   (例: 外壁塗装、無機3回塗り10年保証)」である。訪問看護に工種は無い。

   原因は合言葉の不足ではない。「加盟店希望」は正しい言葉であり、
   実際に加盟していただいた。壊れていたのは、合言葉が業種を聞く前に
   商品を決めてしまう構造のほうである。初回接触で無条件に Yakumo の
   店レコードを作っていた(hearing.js の「初回: 店レコードを自動作成」)。

   合言葉を業種ごとに増やす道もある。採らなかった理由は二つ。
     1. お客様に、我々の商品分類を先に覚えていただく設計になる。
        我々のアウトリーチ自身が「加盟店希望と送ってください」と
        言っている以上、次も「加盟店希望」と打たれる。
     2. N業種 × M商品 の合言葉は、増やすたびに「間違った先へ送る口」が
        1つ増える。今日と同じ事故が、業種の数だけ起きうる。

   採った道: 入口は1つのまま。分岐を1問だけ後ろにずらす。
     加盟店希望 → 「まず、ご業種だけ教えてください」 → 業種でヒアリングを選ぶ
   こちらから声をかけた相手は業種が分かっているので、登録リンクに
   業種を埋めればこの1問も飛ばせる。増やすのは合言葉ではなく、この表である。

   分からないときは推測しない。大賀に回す。業種を間違えたヒアリングは、
   お客様の時間を奪った上で、こちらが話を聞いていないことの証拠になる。
   ------------------------------------------------------------------ */

/* ------------------------------------------------------------------
   名乗りの使い分け。

   名前は約束である。「担当の大賀が」と書いた瞬間、大賀が実際に読んで
   返すという約束になる。自動応答がその約束を勝手に出すと、返事が
   来なかったときに、こちらが嘘をついたことになる。

     SIGN_PERSON ... 人が必ず動くところ。金額、契約、判断、謝罪、
                     業種が判らないときの引き取り。
                     要対応の通知が飛ぶことが条件。
     SIGN_DESK   ... 自動が答えるところ。受領確認、ヒアリングの質問、案内。

   大賀さんが手で書いた文には、そのまま名前を使ってよい。
   書いた本人が動いているので、約束が嘘にならない。
   ------------------------------------------------------------------ */
export const SIGN_PERSON = "担当の大賀";
export const SIGN_DESK = "運営事務局";

export const DEFAULT_INDUSTRY = "construction";

/* 業種が判らないまま溜めておく入口の寿命(ミリ秒)。
   放置された intake を永久に残さない。 */
export const INTAKE_TTL_MS = 72 * 3600 * 1000;

export const INDUSTRIES = {
  /* ---------------------------------------------------------------- */
  construction: {
    key: "construction",
    label: "建設・リフォーム",
    short: "建設",
    product: "Yakumo",
    /* Yakumo のモールに並ぶ業種。 */
    mall: "yakumo",
    /* 判定に使う語。長い語ほど先に置く。 */
    keywords: [
      "外壁塗装", "屋根塗装", "防水工事", "リフォーム", "工務店", "塗装店", "塗装業",
      "解体工事", "内装工事", "電気工事", "水道工事", "設備工事", "外構工事", "造園",
      "建築", "建設", "土木", "塗装", "板金", "左官", "大工", "鳶", "設備", "内装",
      "リノベ", "住宅", "新築", "改修", "屋根", "外構", "防水", "サッシ", "エクステリア",
    ],
    /* 語彙。ヒアリングの文面と抽出プロンプトが使う。 */
    words: {
      works: "対応できる工種",
      works_eg: "外壁塗装、無機3回塗り10年保証",
      license: "建設業許可番号",
      customer: "施主さま",
      area: "対応エリア(市区町村)",
    },
    opening:
      "加盟のご希望、ありがとうございます。\n" +
      "建設・リフォームの窓口として、ここからは自動でお伺いします(内容は運営事務局が必ず確認します)。\n\n" +
      "まず、次の3つをこのままご返信ください。まとめて1通で大丈夫です。\n" +
      "1) 会社名(屋号)\n" +
      "2) 対応エリア(市区町村)\n" +
      "3) 対応できる工種と強み(例: 外壁塗装、無機3回塗り10年保証)",
    llm_sys:
      "You extract structured data from a Japanese renovation/construction contractor's reply. " +
      "Output ONLY a JSON object (no prose, no code fences) with keys: company (string), rep (string), " +
      "license (string, construction licence number), area (string, city level), areas (comma-separated string of service areas), " +
      "works (array of trade strings in Japanese e.g. 外壁塗装), strengths (string), faqs (array of objects with q and a), " +
      "trust (string), contact (string), hours (string). " +
      "Do NOT invent prices or amounts. Unknown fields: empty string or empty array." +
      " CRITICAL: if the provider marks an item as conditional or partial (要相談, 応相談, 要確認, 応談, 一部, 場合により), you MUST keep that qualifier attached to the item itself, for example \"二宮町(要相談)\". Never list a conditional item as if it were unconditional, and never drop a scope word such as 全域 or 一部. Dropping a qualifier turns something the provider did not say into something we publish in their name.",
    /* 建設は現状の QUESTION_BANK をそのまま使う。 */
    /* 建設だけの現場質問。JCCDB(建設費のデータベース)の穴を埋めるための問い。
       ここへの答えは相場そのものではない。加盟店が現に扱っている事実である。
       JCCDB に入れるのは、複数店の答えが揃い、出所を書けるようになってから。
       1店の答えを相場として出した瞬間に、その店の値付けが『相場』になる。 */
    bank: {
      /* CONSTRUCTION_BANK_BEGIN 生成物。手で編集しないこと。 */
      /*   元       : data/construction/field_questions.json
           作り直し : python3 tools/construction/sync_questions.py --write
           検査     : python3 tools/construction/sync_questions.py --check */
      q_cn_souba_nai: {
        w: 8,
        purpose: "field",
        fills_gap: "JCCDB に品目そのものが無い箇所",
        gives: "相場表に足すべき工種・単位の候補",
        text:
          "直近の見積で、こちらの相場表に載っていない工種や単位はありましたか。「載っていない」と思ったものを、名前だけで構いませんので挙げてください。無ければ「無い」で構いません。",
      },
      q_cn_zairyo_ugoki: {
        w: 8,
        purpose: "field",
        fills_gap: "JCCDB の価格が、いつの時点のものかが分からない箇所",
        gives: "見直しが要る品目と、その向き",
        text:
          "この1年で、仕入れ値が目に見えて動いた材料はありますか。材料名と、上がったか下がったか、感覚で構いません。",
      },
      q_cn_chiiki_sa: {
        w: 7,
        purpose: "field",
        fills_gap: "JCCDB が地域差を持っていない箇所",
        gives: "地域係数を置くべき項目",
        text:
          "この地域だけ他と違う、と感じる単価や慣習はありますか。運搬費、駐車場、近隣対応、どんなことでも構いません。",
      },
      q_cn_takai_iwareta: {
        w: 7,
        purpose: "field",
        fills_gap: "JCCDB の上限が、実際の説明と噛み合っていない箇所",
        gives: "説明が要る項目と、通じる説明の言い方",
        text:
          "施主さまから「他社と比べて高い」と言われたことのある項目はありますか。項目名と、そのときどう説明されたかを教えてください。",
      },
      q_cn_shokei: {
        w: 6,
        purpose: "field",
        fills_gap: "諸経費率の判定が、根拠なく一律になっている箇所",
        gives: "諸経費に何が入っているかの実際",
        text:
          "諸経費は、どういう考え方で乗せていますか。何パーセントか、何を含めているか。決めていなければ「決めていない」で構いません。",
      },
      q_cn_isshiki: {
        w: 6,
        purpose: "field",
        fills_gap: "「一式」を一律に減点している判定の根拠",
        gives: "内訳を出せない正当な場面と、出せるはずの場面の別",
        text:
          "見積で「一式」と書くのは、どういう場面ですか。内訳を出しにくいものがあれば、その理由も教えてください。",
      },
      /* CONSTRUCTION_BANK_END */
    },

    /* 物差し。建設における JCCDB。訪問看護の JHNRD と同じ位置に立つ。
       2026-08-23、ここが書かれていなかった。訪問看護だけが物差しに繋がっていて、
       建設は繋がっていない状態だった。片方だけ濃くなるので、揃える。
       ファイルではなく MCP 経由で参照するため、kind を書いてある。 */
    /* 名乗り。この業種の方に、こちらが何と名乗るか。
       2026-08-23、ここが無かったので全業種に「Yakumo運営です」と送っていた。
       Yakumo は建設のモールである。訪問看護の平田様に「Yakumo運営」と名乗るのは、
       相手の業界ではない看板を出していることになる。 */
    sender: "Yakumo運営",

    rules_db: { kind: "mcp", name: "JCCDB", server: "HORIZON_SHIELD",
                tool: "get_jccdb_dataset_info" },

    /* 生成の配分。全業種で同じ方針。
       これは方針であって測定結果ではない。根拠が無いことは
       data/visibility/requirements.json の known_gaps に書いてある。 */
    golden_ratio: { geo: 40, aeo: 30, llmo: 20, webmcp: 10 },
  },

  /* ---------------------------------------------------------------- */
  nursing: {
    key: "nursing",
    label: "訪問看護",
    short: "訪問看護",
    product: "AI事務員",
    /* Yakumo のモールは建設業向け。訪問看護は対象外なので、
       専用の窓口を独自ドメインに建てる(ご提案 06 のとおり)。 */
    /* 2026-08-23: null のままだった。レジストリには "care" と書いてあり、
       ページ側の検査(tools/pagecheck/validate.py)も /care/ で分岐している。
       ここだけ null で、検査は mall を比べていなかったので気づかなかった。
       比べていない項目は、書いてあっても効いていない。 */
    mall: "care",
    keywords: [
      "訪問看護ステーション", "訪問看護", "居宅介護支援", "訪問介護", "訪問リハビリ",
      "看護小規模多機能", "小規模多機能", "デイサービス", "通所介護", "地域包括",
      "精神科訪問看護", "居宅療養", "介護事業", "介護施設", "老健", "特養",
      "ケアマネ", "ケアマネージャー", "ケアマネジャー", "訪看", "看護師", "准看護師",
      "理学療法士", "作業療法士", "言語聴覚士", "国保連", "介護保険", "医療保険",
      "看護", "介護", "在宅医療", "ナース",
    ],
    words: {
      works: "対応できる医療処置",
      works_eg: "在宅酸素、人工呼吸器、中心静脈栄養、褥瘡処置、ターミナルケア、精神科訪問看護",
      license: "事業所番号(指定訪問看護事業所番号)",
      customer: "利用者さま",
      area: "訪問できるエリア(市区町村)",
    },
    opening:
      "訪問看護でしたら、こちらの窓口でお受けします。ありがとうございます。\n" +
      "ここからは自動でお伺いします(内容は運営事務局が必ず確認します)。\n\n" +
      "まず、次の3つをこのままご返信ください。まとめて1通で大丈夫です。\n" +
      "1) 事業所名(法人名)\n" +
      "2) 訪問できるエリア(市区町村)\n" +
      "3) 対応できる医療処置(例: 在宅酸素、人工呼吸器、褥瘡処置、ターミナルケア)\n\n" +
      "声で言っていただいても、写真一枚でも構いません。文字にするのはこちらの仕事です。",

    /* 建設業向けのヒアリングを先に送ってしまった相手に出す版。
       取り消したことを言わずに次の質問に移ると、相手は前の質問に
       答えようとして、答えられずに止まる。先に取り消す。 */
    opening_after_wrong:
      "訪問看護でしたら、こちらの窓口でお受けします。ありがとうございます。\n" +
      "先にお送りした3つの質問は建設・リフォーム向けのもので、御社には当てはまりません。お答えいただかなくて結構です。取り違えました、失礼しました。\n\n" +
      "あらためて、次の3つをこのままご返信ください。まとめて1通で大丈夫です。\n" +
      "1) 事業所名(法人名)\n" +
      "2) 訪問できるエリア(市区町村)\n" +
      "3) 対応できる医療処置(例: 在宅酸素、人工呼吸器、褥瘡処置、ターミナルケア)\n\n" +
      "声で言っていただいても、写真一枚でも構いません。文字にするのはこちらの仕事です。",
    llm_sys:
      "You extract structured data from a Japanese home-visit nursing provider's (訪問看護ステーション) reply. " +
      "Output ONLY a JSON object (no prose, no code fences) with keys: company (string, the office or corporation name), " +
      "rep (string, the person in charge / 管理者), license (string, the designated office number 事業所番号), " +
      "area (string, city level), areas (comma-separated string of areas they can visit), " +
      "works (array of Japanese strings naming medical procedures they can perform at home, e.g. 在宅酸素, 人工呼吸器, 中心静脈栄養, 褥瘡処置, ターミナルケア, 精神科訪問看護), " +
      "strengths (string), faqs (array of objects with q and a), trust (string), contact (string), hours (string, including whether they run 24-hour on-call). " +
      "This is medical and long-term-care billing. Do NOT invent prices, 単位数, 加算 names, or amounts. " +
      "Do NOT infer a medical procedure they did not name. Unknown fields: empty string or empty array." +
      " CRITICAL: if the provider marks an item as conditional or partial (要相談, 応相談, 要確認, 応談, 一部, 場合により), you MUST keep that qualifier attached to the item itself, for example \"二宮町(要相談)\". Never list a conditional item as if it were unconditional, and never drop a scope word such as 全域 or 一部. Dropping a qualifier turns something the provider did not say into something we publish in their name.",

    /* 既にある共通の設問を、訪問看護の言葉に置き換える。
       ここを空にしておくと「工種ごとの強み(例: 外壁塗装は無機3回塗り)」
       「施主さんからよく聞かれる質問」が訪問看護の事業所に届く。
       今日の事故と同じことが、追撃質問で毎週くり返される。
       配点は共通側のままで、変えるのは文面だけ。 */
    overrides: {
      q_focus: {
        text:
          "いちばん先に効かせたいのは、どちらですか。両方でも構いません。\n" +
          "1 利用者さまを増やす(ケアマネさんからの相談を増やす)\n" +
          "2 看護師の採用\n" +
          "番号か言葉で、そのままご返信ください。",
      },
      q_areas: {
        text: "訪問できるエリアを市区町村名で、思いつく限り挙げてください。ケアマネさんはこの地名で探します。訪問できない地域があれば、それも書いてください。",
      },
      q_strengths: {
        text:
          "他の訪問看護ステーションと違うところを、具体的に教えてください。\n" +
          "できる医療処置(在宅酸素、人工呼吸器、中心静脈栄養、褥瘡処置、ターミナルケア、精神科訪問看護など)、" +
          "24時間対応の体制、リハビリ職の在籍、看取りの実績など。得意なものだけで構いません。",
      },
      q_faqs: {
        text:
          "ケアマネさんやご家族から、よく聞かれる質問と答えを3つほど教えてください。\n" +
          "(例: Q 医療保険と介護保険、どちらになりますか。 A ...) そのまま御社の窓口の素材になります。",
      },
      q_trust: {
        text: "信頼の裏づけになるものを教えてください。開設年、看護師の人数と経験年数、看取りの件数、機能強化型の届出、研修や資格(認定看護師など)、連携している医療機関。",
      },
      q_contact: {
        text: "ケアマネさん・ご家族からの連絡先(電話・FAX・メール)と、受付時間、緊急時の受け方を教えてください。",
      },
      q_license: {
        text: "事業所番号(指定訪問看護事業所番号)を教えてください。掲載すると、ケアマネさんが確認できます。",
      },
      q_story: {
        text: "この事業所を始めたきっかけを、ひとことお聞かせください。AIが御社を語るときの芯になります。",
      },
      q_cases: {
        text: "こういう方を見てきた、という例を2〜3件、題名だけで構いませんので教えてください(例: 独居のターミナル、人工呼吸器を使う小児)。お名前や個人が分かることは書かないでください。",
      },
    },

    /* 訪問看護だけの追撃質問。共通側に無い qid だけをここに置く。
       前半は業務データベース(請求が通るかどうか)、後半は外向き(集客と求人)。
       ご提案 03「出す前に見る目と、切れる前に言う口」に必要な材料がこれ。 */
    bank: {
      /* 生成物。手で編集しないこと。
         算定要件と現場質問 : jhnrd/data/rules_2024.json の questions[]
         業務・集客・採用   : data/nursing/questions_local.json
         作り直し           : python3 tools/nursing/sync_questions.py --write
         ずれの検査         : python3 tools/nursing/sync_questions.py --check
    
         訊き方について。これは相手を試す質問ではない。揃っていないものを
         見つけるのがこちらの仕事なので、「できていますか」ではなく
         「いまどうなっていますか」と訊く。揃っていないと答えやすい形にする。
         設問文に要件の中身を書くときは、DB で confirmed:true のものだけにする。
         お客様に自社の遵守状況について断定を伝えるのは、いちばんやってはいけない。 */
    
      /* --- 業務の回り方 (弊社) --- */
      q_nv_system: {
        w: 10,
        purpose: "ops",
        text: "いま使っている記録・請求のシステム名を教えてください。手書きやエクセルでしたら、そのままそう教えてください。",
      },
    
      /* --- 算定要件を確かめる (JHNRD) --- */
      /* shiji-tokubetsu/tk-count、shiji-tokubetsu/tk-expiry、shiji-tsujo/ts-expiry、kaigo-genzan-iryo-shiji-nissuu/iryo-shiji-kikan */
      q_nv_shiji: {
        w: 10,
        purpose: "requirement",
        text: "訪問看護指示書の期限は、いまどうやって管理していますか。紙のファイル、エクセル、システム、人の記憶。実際のところで構いません。",
      },
    
      /* --- 業務の回り方 (弊社) --- */
      q_nv_insurance: {
        w: 8,
        purpose: "ops",
        text: "利用者さまのおおよその人数と、医療保険と介護保険のだいたいの割合を教えてください。正確でなくて構いません。",
      },
    
      /* --- 算定要件を確かめる (JHNRD) --- */
      /* kasan-tokubetsu-kanri/tk-target、kasan-terminal/tm-record、iryo-kasan-tokubetsu-kanri/tk-taisho、iryo-kasan-nyuyoji/nyuyoji-taisho、iryo-terminal/tc-yoken、iryo-terminal/tc-kubun、kaigo-kasan-renkei-kyoka/renkei-youken */
      q_nv_kasan: {
        w: 10,
        purpose: "requirement",
        text: "いま算定している加算を、思いつくだけ挙げてください。抜けているものを探すのがこちらの仕事なので、漏れていて構いません。",
      },
      /* genzan-bcp/bcp-plan、genzan-bcp/bcp-plan-d、genzan-bcp/bcp-review、iryo-kanri-shonichi/kanri-anzen */
      q_nv_bcp_plan: {
        w: 6,
        purpose: "requirement",
        text: "業務継続計画(BCP)は、いまどうなっていますか。感染症のぶんと災害のぶん、それぞれについて「策定済み」「作成中」「これから」のどれかで構いません。片方だけ、という状態もそのまま教えてください。",
      },
      /* genzan-bcp/bcp-train */
      q_nv_bcp_train: {
        w: 5,
        purpose: "requirement",
        text: "その計画に基づく研修と訓練は、直近1年で実施しましたか。「した」「していない」「覚えていない」で構いません。",
      },
      /* genzan-bcp/bcp-stock */
      q_nv_bcp_stock: {
        w: 4,
        purpose: "requirement",
        text: "感染症・災害用の備蓄品は、どなたが管理していますか。決まっていなければ「決まっていない」で構いません。",
      },
      /* genzan-gyakutai/gy-committee */
      q_nv_gy_committee: {
        w: 6,
        purpose: "requirement",
        text: "高齢者虐待防止のための委員会は、直近1年で何回開かれましたか。0回でも構いません。回数をそのまま教えてください。",
      },
      /* genzan-gyakutai/gy-policy */
      q_nv_gy_policy: {
        w: 5,
        purpose: "requirement",
        text: "高齢者虐待防止のための指針は、いまどうなっていますか。「整備済み」「作りかけ」「まだ」のどれかで構いません。",
      },
      /* genzan-gyakutai/gy-training */
      q_nv_gy_training: {
        w: 6,
        purpose: "requirement",
        text: "高齢者虐待防止の研修は、直近1年で何回実施しましたか。0回でも構いません。回数をそのまま教えてください。",
      },
      /* genzan-gyakutai/gy-officer */
      q_nv_gy_officer: {
        w: 5,
        purpose: "requirement",
        text: "高齢者虐待防止措置の担当者は決まっていますか。お名前は要りません。決まっているかどうかだけで構いません。",
      },
    
      /* --- 業務の回り方 (弊社) --- */
      q_nv_henrei: {
        w: 8,
        purpose: "ops",
        text: "直近半年で返戻はありましたか。あった場合、理由が分かっていれば教えてください。分からないままでも構いません。",
      },
      q_nv_oncall: {
        w: 8,
        purpose: "ops",
        text: "24時間対応体制加算は算定していますか。オンコールは何人で回していますか。",
      },
    
      /* --- 算定要件を確かめる (JHNRD) --- */
      /* genzan-junkangoshi/jk-staff、pt-ot-st/pt-staff、kaigo-kihon-st/kihon-junkangoshi、kaigo-kasan-kango-taisei/kt-kango-wariai、kaigo-kasan-service-taisei/st-kinzoku */
      q_nv_staff: {
        w: 8,
        purpose: "requirement",
        text: "看護師の人数(常勤・非常勤)と、理学療法士・作業療法士・言語聴覚士がいらっしゃれば人数を教えてください。",
      },
    
      /* --- 業務の回り方 (弊社) --- */
      q_nv_shimekiri: {
        w: 6,
        purpose: "ops",
        text: "毎月の請求は、どなたが、いつからいつまでの間に作っていますか。締切前のいちばん苦しい日を教えてください。",
      },
    
      /* --- まだ条文を確認できていないことを、現場に尋ねる (JHNRD)。答えは field_reports に入る。規則の出典にはしない --- */
      /* 埋めようとしている穴: 訪問看護指示書の有効期間について、条文を確認できていない */
      q_nv_shiji_period: {
        w: 6,
        purpose: "field",
        text: "訪問看護指示書は、御社では何か月ごとに更新していますか。制度としてどうかではなく、実際の回し方を教えてください。こちらはまだ条文を確認できていないので、現場でどうされているかを先に伺っています。",
      },
      /* 埋めようとしている穴: 特別訪問看護指示書の交付回数・日数について、条文を確認できていない */
      q_nv_tokubetsu_days: {
        w: 5,
        purpose: "field",
        text: "特別訪問看護指示書を受けたことはありますか。あれば、御社では何日ぶんとして運用していますか。交付が月2回になった例があれば、その状況も教えてください。こちらで条文を確認できたら、御社の運用とずれがないかをお知らせします。",
      },
      /* 埋めようとしている穴: 告示・省令・通知の原文にほとんど当たれておらず、実際に何が確認されるのかを持っていない */
      q_nv_shido: {
        w: 8,
        purpose: "field",
        text: "実地指導(運営指導)を受けたことはありますか。受けた年と、そのとき「見せてください」と言われた書類、指摘された点を、覚えている範囲で教えてください。指摘があったこと自体は珍しくありませんので、そのまま教えていただいて構いません。こちらはまだ条文の原文に当たれていないので、実際に何が見られるのかを、先に現場から教えていただきたいのです。",
      },
    
      /* --- 外向き・ケアマネさん向けの集客 (弊社) --- */
      q_nv_work_notes: {
        w: 12,
        purpose: "outbound",
        text: "対応できる医療処置のうち、いちばん多いものを1つ選んで、その方のご家族やケアマネさんに、いつもお伝えしていることを教えてください。気をつけて見ている点、ご家族にお願いしていること、困りやすいところなど。教科書に書いてあることではなく、御社が実際にやっていることをそのまま。これは、その処置を探している方に届くページの中身になります。",
      },
      q_nv_capacity: {
        w: 10,
        purpose: "outbound",
        text: "いま新しい利用者さまを受け入れられますか。受け入れられる曜日や時間帯に偏りがあれば、それも教えてください。ケアマネさんがいちばん先に知りたいところです。",
      },
    
      /* --- まだ条文を確認できていないことを、現場に尋ねる (JHNRD)。答えは field_reports に入る。規則の出典にはしない --- */
      /* 埋めようとしている穴: 加算が2項目しか入っておらず、どこから調べるべきかの順番が無い */
      q_nv_kasan_miteki: {
        w: 8,
        purpose: "field",
        text: "いま算定していない加算のうち、「取れるかもしれないが手が回っていない」「要件がよく分からない」と思っているものがあれば、名前だけで構いませんので挙げてください。分からないまま挙げていただくのが、いちばん助かります。こちらの算定要件データベースは加算がまだ2項目しか入っておらず、どこから調べるかを、現場の関心の順で決めたいと思っています。",
      },
    
      /* --- 外向き・ケアマネさん向けの集客 (弊社) --- */
      q_nv_caremane: {
        w: 8,
        purpose: "outbound",
        text: "ケアマネさんから相談が来たとき、どこに、どうやって連絡が来るのが御社にとっていちばん楽ですか。電話、FAX、メール、LINE。",
      },
    
      /* --- まだ条文を確認できていないことを、現場に尋ねる (JHNRD)。答えは field_reports に入る。規則の出典にはしない --- */
      /* 埋めようとしている穴: 医療保険(訪問看護療養費)側が1項目も入っていない */
      q_nv_iryo_youshiki: {
        w: 7,
        purpose: "field",
        text: "医療保険での訪問看護について伺います。医療保険のほうで実際に使っている様式の名前と、算定している療養費・加算があれば教えてください。こちらのデータベースは介護保険側しか入っておらず、医療保険側はこれから作ります。御社が実際に扱っている名前が、そのまま調べる手がかりになります。",
      },
    
      /* --- 外向き・ケアマネさん向けの集客 (弊社) --- */
      q_nv_faq: {
        w: 8,
        purpose: "outbound",
        text: "ケアマネさんやご家族から、よく聞かれることを3つ挙げてください。答えもそのままで構いません。",
      },
    
      /* --- まだ条文を確認できていないことを、現場に尋ねる (JHNRD)。答えは field_reports に入る。規則の出典にはしない --- */
      /* 埋めようとしている穴: このデータベースが答えるべき問いが、こちらの想像で決まっている */
      q_nv_mayotta: {
        w: 7,
        purpose: "field",
        text: "請求のときに「これはどちらだろう」と迷ったことを、思い出せる範囲で教えてください。医療保険か介護保険か、この加算は取れるのか、この日は算定してよいのか。答えが出たか出なかったかは問いません。迷ったこと自体が、このデータベースが答えるべき問いになります。",
      },
    
      /* --- 外向き・ケアマネさん向けの集客 (弊社) --- */
      q_nv_story: {
        w: 6,
        purpose: "outbound",
        text: "この事業所を始めたきっかけを、一言で構いませんので教えてください。ここは数字では書けないところです。",
      },
    
      /* --- まだ条文を確認できていないことを、現場に尋ねる (JHNRD)。答えは field_reports に入る。規則の出典にはしない --- */
      /* 埋めようとしている穴: 加算について、体制届出が要るものと要らないものの区別を持っていない */
      q_nv_todokede: {
        w: 6,
        purpose: "field",
        text: "加算の体制届出は、いつ、どこへ出していますか。出した加算の名前と、提出先(都道府県か市町村か)、締切の感覚を教えてください。届出が要る加算と要らない加算の区別を、こちらはまだ持っていません。",
      },
      /* 埋めようとしている穴: 保険者・都道府県ごとの運用差を1件も記録していない */
      q_nv_local_rule: {
        w: 5,
        purpose: "field",
        text: "保険者(市町村)や都道府県から、独自の様式や独自の取り扱いを言われたことはありますか。「この地域ではこうしてください」と言われた経験があれば教えてください。制度は全国共通のはずでも、運用が違うことがあります。こちらはそこをまだ何も持っていないので、1件でも助かります。",
      },
    
      /* --- 外向き・看護師の採用 (弊社) --- */
      q_nv_recruit_role: {
        w: 8,
        purpose: "recruit",
        text: "いま募集している職種と人数を教えてください。募集していなければ「今はなし」で構いません。",
      },
      q_nv_recruit_oncall: {
        w: 10,
        purpose: "recruit",
        text: "採用でいちばん聞かれるのはオンコールの実態です。月に何回、実際に呼ばれるのは何回くらいか、正直なところを教えてください。良く見せると、来た人が辞めます。",
      },
      q_nv_recruit_edu: {
        w: 8,
        purpose: "recruit",
        text: "新しく入った看護師さんに、最初の3か月で何をしていますか。同行訪問の回数、教育担当が付くかどうかなど、実際の形で教えてください。",
      },
    
      /* --- 算定要件を確かめる (JHNRD) --- */
      /* iryo-kasan-24h/24h-futankeigen */
      q_nv_24h_futan: {
        w: 9,
        purpose: "requirement",
        text: "24時間対応体制加算について伺います。夜間に対応した翌日の勤務間隔の確保、夜間対応の連続回数を2回までにする、夜間対応後に暦日の休日を確保する、勤務体制の工夫、ICTの活用、電話対応者への支援体制。このうち、御社で実際にやっているものを挙げてください。1つも無ければ「無し」で構いません。",
      },
      /* iryo-kihon-i/kihon-i-kaisu、iryo-kasan-nyuyoji/nyuyoji-1800、furiwake-iryo-kaigo/fw-beppyo7-count */
      q_nv_beppyo7: {
        w: 9,
        purpose: "requirement",
        text: "いま訪問している利用者さんのうち、末期の悪性腫瘍、筋萎縮性側索硬化症、多発性硬化症、パーキンソン病関連疾患、人工呼吸器を使用している状態など、いわゆる別表第七に当たる方は何人いらっしゃいますか。人数だけで構いません。分からなければ「分からない」で構いません。",
      },
      /* kaigo-kasan-chiiki/ch-shitei、kaigo-kasan-chiiki/ch-idou */
      q_nv_chiiki: {
        w: 5,
        purpose: "requirement",
        text: "御社の事業所や利用者さんのお住まいが、特別地域や中山間地域に指定されている場所に当たることはありますか。片道の移動に1時間近くかかる訪問があるかどうかでも構いません。",
      },
      /* iryo-kanri-2nichime/kanri2-kubun、kaigo-genzan-douitsu-tatemono/dt-ninzu */
      q_nv_douitsu_tatemono: {
        w: 8,
        purpose: "requirement",
        text: "同じ建物(集合住宅やサービス付き高齢者向け住宅など)に住む利用者さんは、いちばん多い建物で何人いらっしゃいますか。また、1日に同じ建物へ何人訪問することがありますか。人数がそのまま減算と単価に効きます。",
      },
      /* kaigo-kasan-kango-taisei/kt-jisseki、kaigo-kasan-enkaku-shibo/es-terminal */
      q_nv_kango_taisei: {
        w: 7,
        purpose: "requirement",
        text: "直近1年で、ターミナルケア(お看取りまで関わった件数)と、特別管理加算を算定した利用者さんの人数を教えてください。おおよそで構いません。届出の要件がこの実績で決まります。",
      },
      /* iryo-kasan-24h/24h-taisei、iryo-kasan-kinkyu/kinkyu-yoken、kaigo-kasan-kinkyuji/kinkyuji-taisei */
      q_nv_kinkyuji_taisei: {
        w: 8,
        purpose: "requirement",
        text: "夜間や休日に、利用者さんやご家族から電話が入る体制はどうなっていますか。誰が受けるか、携帯を持ち回っているか、受けたあとどう動くか。実際の回し方を教えてください。",
      },
      /* kaigo-kasan-kouku/kk-hyoka、kaigo-kasan-kouku/kk-kiroku */
      q_nv_kouku: {
        w: 6,
        purpose: "requirement",
        text: "訪問の際に、口の中の状態(食べこぼし、むせ、汚れ、義歯の具合)を見て歯科につなぐことはありますか。つないだ記録を残していますか。「やっていない」で構いません。",
      },
      /* iryo-kanri-shonichi/kanri-kyoka-kubun、iryo-kanri-shonichi/kanri-kyoka4-shinsetsu */
      q_nv_kyoka_kata: {
        w: 9,
        purpose: "requirement",
        text: "訪問看護管理療養費の届出区分を教えてください。機能強化型1・2・3・4のいずれかを届け出ていますか、それとも届出はしていませんか。「分からない」でも構いません。月の初日の額がここで決まります。",
      },
      /* furiwake-iryo-kaigo/fw-seishinka */
      q_nv_seishinka: {
        w: 6,
        purpose: "requirement",
        text: "精神科の訪問看護はやっていますか。やっている場合、精神科訪問看護指示書を受けている利用者さんは何人ですか。",
      },
      /* kaigo-kasan-service-taisei/st-kenshu、kaigo-kasan-service-taisei/st-kaigi */
      q_nv_service_taisei: {
        w: 6,
        purpose: "requirement",
        text: "看護師さんごとの研修計画は作っていますか。また、利用者さんの情報を共有する会議は定期的に開いていますか。「作っていない」「開いていない」で構いません。",
      },
      /* kaigo-kasan-shokai/shokai-shinki、kaigo-kasan-shokai/shokai-taiin */
      q_nv_shokai: {
        w: 6,
        purpose: "requirement",
        text: "新しい利用者さんを受けるとき、初回の訪問はどなたが行きますか。また、退院や退所の直後に受けることはどのくらいありますか。月に何件くらいか、感覚で構いません。",
      },
      /* kaigo-kasan-taiin-kyodo/tk-kyodo、kaigo-kasan-taiin-kyodo/tk-bunsho */
      q_nv_taiin_kyodo: {
        w: 6,
        purpose: "requirement",
        text: "利用者さんが退院するとき、病院に出向いて(またはオンラインで)病院の職員と一緒に指導をすることはありますか。あれば、月に何件くらいか、そのとき文書を渡しているかも教えてください。",
      },
      /* iryo-kihon-i/kihon-i-senmon、kaigo-kasan-senmon-kanri/senmon-zaiseki、kaigo-kasan-senmon-kanri/senmon-tejunsho、kaigo-kasan-enkaku-shibo/es-kenshu */
      q_nv_tokutei_koui: {
        w: 7,
        purpose: "requirement",
        text: "緩和ケア・褥瘡ケア・人工肛門/人工膀胱ケアの専門研修を修了した看護師、または特定行為研修を修了した看護師は在籍していますか。いらっしゃれば、どの分野の研修かも教えてください。いなければ「いない」で構いません。",
      },
      /* kaigo-kasan-yakan/yk-jikan */
      q_nv_yakan: {
        w: 5,
        purpose: "requirement",
        text: "夜間(18時〜22時)、早朝(6時〜8時)、深夜(22時〜6時)の訪問はありますか。月に何件くらいか、感覚で構いません。",
      },
    },

    /* 算定要件データベース。建設における JCCDB と同じ位置に立つ外部の物差し。
       これが無ければ「取りこぼしがある」「減算の危険がある」は我々の感想にすぎない。
       上の q_nv_* は、このデータベースの requirements[].ask と1対1で結ぶ。
       結べない設問は、集めても突き合わせられない。 */
    /* 名乗り。訪問看護の窓口として名乗る。Yakumo(建設のモール)とは名乗らない。 */
    sender: "HORIZON SHIELD 訪問看護窓口",

    rules_db: "data/nursing/rules_2024.json",

    /* 生成の配分。ご指示の黄金比。 */
    golden_ratio: { geo: 40, aeo: 30, llmo: 20, webmcp: 10 },
  },
};

/* 業種が分からなかったとき。推測しない。 */
export const UNKNOWN_INDUSTRY = "unknown";

export function industryOf(key) {
  return INDUSTRIES[key] || null;
}

export function industryLabel(key) {
  const i = INDUSTRIES[key];
  return i ? i.label : "";
}

export function industryWords(key) {
  const i = INDUSTRIES[key];
  return (i && i.words) || INDUSTRIES[DEFAULT_INDUSTRY].words;
}

/* 業種を尋ねる、ただ1問。 */
export function askIndustryText() {
  return (
    "加盟のご希望、ありがとうございます。\n" +
    "ご案内の中身が業種によって変わりますので、先に1つだけ教えてください。\n\n" +
    "御社のご業種は、次のどれに近いですか。番号でも、言葉のままでも構いません。\n" +
    "1) 建設・リフォーム(塗装、屋根、内装、外構など)\n" +
    "2) 訪問看護・介護\n" +
    "3) それ以外\n\n" +
    "3 の場合は、ご業種をそのまま書いてください。担当の大賀がお返事します。"
  );
}

/* 番号で答えられたとき。 */
const NUMBERED = { "1": "construction", "2": "nursing", "3": UNKNOWN_INDUSTRY };

/*
  文面から業種を決める。

  返すもの: { key, via, matched } または null(判らない)。
  null を返したら、それは「判らなかった」であって「その他」ではない。
  呼ぶ側は推測で先に進まず、もう一度尋ねるか、人に回すこと。
*/
export function classifyIndustry(text) {
  const t = String(text || "").trim();
  if (!t) return null;

  /* 番号だけの短い返事 */
  const bare = t.replace(/[\s。、.]/g, "");
  if (NUMBERED[bare]) {
    const k = NUMBERED[bare];
    return k === UNKNOWN_INDUSTRY
      ? { key: UNKNOWN_INDUSTRY, via: "numbered", matched: bare }
      : { key: k, via: "numbered", matched: bare };
  }

  /* 語による判定。複数の業種に当たったら判らないものとして扱う。
     「介護施設の内装工事」のような文は、人が読むべきである。 */
  const hits = [];
  for (const key of Object.keys(INDUSTRIES)) {
    const ind = INDUSTRIES[key];
    for (const w of ind.keywords) {
      if (t.indexOf(w) >= 0) {
        hits.push({ key, matched: w, len: w.length });
        break;
      }
    }
  }
  if (hits.length === 1) {
    return { key: hits[0].key, via: "keyword", matched: hits[0].matched };
  }
  if (hits.length > 1) {
    /* いちばん長く一致した語を採るが、差が無いなら判らないままにする。 */
    hits.sort((a, b) => b.len - a.len);
    if (hits[0].len >= hits[1].len + 2) {
      return { key: hits[0].key, via: "keyword-longest", matched: hits[0].matched, ambiguous: true };
    }
    return null;
  }
  return null;
}

/*
  業種ごとの、最初の3問。

  afterWrong は「先に別の業種のヒアリングを送ってしまった」場合。
  取り消しを言わずに次の質問へ移ると、相手は前の質問に答えようとして、
  答えられずに止まる。止まった理由はこちらにあるのに、相手が悪いように見える。
*/
/*
  業種を決めた文が、すでに答えだったときに返す文。

  ここで同じ質問をくり返してはいけない。答えた直後に同じことを訊かれると、
  相手からは、こちらが読んでいないように見える。実際 2026-08-23 22:30 に
  そうなった。受け取ったことだけを言い、足りないぶんは後から少しずつ訊く。
*/
export function ackText(key, afterWrong) {
  const i = INDUSTRIES[key];
  const label = i ? i.label : "";
  const head = afterWrong
    ? ((label ? label + "でしたら、こちらの窓口でお受けします。" : "") +
       "先にお送りした3つの質問は業種を取り違えたものでした。失礼しました。\n\n")
    : ((label ? label + "の窓口としてお受けします。ありがとうございます。\n\n" : ""));
  return (
    head +
    "いただいた内容は、そのまま受け取りました。同じことは、もうお尋ねしません。\n" +
    "足りないところがあれば、こちらから少しずつお伺いします。まとめて答えていただく必要はありません。\n\n" +
    "写真や音声でも構いません。文字にするのはこちらの仕事です。"
  );
}

export function openingText(key, afterWrong) {
  const i = INDUSTRIES[key];
  if (!i) return askIndustryText();
  if (afterWrong && i.opening_after_wrong) return i.opening_after_wrong;
  return i.opening;
}

/* 抽出プロンプト。業種が無いものは建設として扱う(既存レコードの後方互換)。 */
export function llmSystemPrompt(key) {
  const i = INDUSTRIES[key] || INDUSTRIES[DEFAULT_INDUSTRY];
  return i.llm_sys;
}

/* autopilot の QUESTION_BANK に重ねる、業種ぶんの追撃質問。 */
export function industryBank(key) {
  const i = INDUSTRIES[key];
  return (i && i.bank) || null;
}

/*
  ある業種の、ある qid の文面。

  上書き(共通の設問を業種の言葉に言い換えたもの)を先に見て、
  次に業種だけの設問を見る。どちらにも無ければ null を返し、
  呼ぶ側が共通の QUESTION_BANK を使う。

  上書きは文面だけで、配点は共通側のままである。上書きを配点として
  数えると、同じ設問が二重に効いてしまう。
*/
/* データベースを厚くするための設問(purpose: "field")の id。
   2026-08-23。設問を DB から生成しただけでは足りなかった。
   重みで並べると、集客の設問(w15)と実績の設問(w10)が前に立ち、
   データベースを厚くする設問(w5〜8)は2週間後ろに並んでいた。
   置いてあることと、届くことは別である。
   毎回2問のうち1問をここから出す。nextQuestions がこれを使う。 */
export function dbBuildingQids(key) {
  const i = INDUSTRIES[key];
  if (!i || !i.bank) return [];
  return Object.keys(i.bank).filter((q) => i.bank[q].purpose === "field");
}

/* こちらが何と名乗るか。業種が分からないときは、業界の看板を出さない。
   分からないまま「Yakumo運営」と名乗れば、建設以外の方には嘘になる。 */
export function senderName(key) {
  const i = INDUSTRIES[key];
  return (i && i.sender) || "HORIZON SHIELD 運営事務局";
}

export function questionFor(key, qid) {
  const i = INDUSTRIES[key];
  if (!i) return null;
  if (i.overrides && i.overrides[qid]) return i.overrides[qid];
  if (i.bank && i.bank[qid]) return i.bank[qid];
  return null;
}

/* q_focus の言い換え。無ければ null で、既定の文面が使われる。 */
export function focusText(key) {
  const q = questionFor(key, "q_focus");
  return q ? q.text : null;
}

/* 生成の配分。 */
export function goldenRatio(key) {
  const i = INDUSTRIES[key];
  return (i && i.golden_ratio) || null;
}
