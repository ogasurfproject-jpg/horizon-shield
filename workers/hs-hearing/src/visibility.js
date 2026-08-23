/* 生成物。手で編集しないこと。
 *   もと    : data/visibility/requirements.json
 *   作り直し: python3 tools/visibility/sync_questions.py --write
 *   検査    : python3 tools/visibility/sync_questions.py --check
 *
 * AIと検索から見つけてもらうための設問。業種を問わず、全加盟店に同じだけ届く。
 * 業種ごとの要件データベースと直交する軸である。
 *
 * この資料が他と違うところ: 効果が確かめられていないものを、確かめられていないと書く。
 * 仕様に書いてあること(spec)と、それがAIの推薦に効くか(effect)は別に持っている。
 * 現時点で effect が確認できた項目は 0 / 4 件である。
 */

export const VISIBILITY_VERSION = "visibility.seed.1";
export const GOLDEN_RATIO = {"geo": 40, "aeo": 30, "llmo": 20, "webmcp": 10};

export const VISIBILITY_BANK = {
  /* GEO — 所在と業態を、機械が読める形で名乗る */
  q_ai_place: {
    w: 9,
    axis: "GEO",
    text: "AIや検索から見つけてもらうために、まず所在をはっきりさせます。正式な社名、住所、電話番号、営業時間、対応できる地域を教えてください。ホームページやGoogleのプロフィールに載せているものと違いがあれば、その違いもそのまま教えてください。表記がばらついていること自体が、よくある詰まりです。",
  },
  /* AEO — よくある問いに、答えの形で答えておく */
  q_ai_questions: {
    w: 9,
    axis: "AEO",
    text: "お客様から実際によく聞かれることを、聞かれる言葉のまま3つ挙げてください。きれいに言い換えないでください。実際の言い方のほうが、同じことを尋ねる人に届きます。答えも、いつも話している通りで構いません。",
  },
  /* LLMO — AIに向けて、要点と地図を置く */
  q_ai_summary: {
    w: 8,
    axis: "LLMO",
    text: "御社を一度も見たことがない人に、20秒で説明するとしたら何と言いますか。何をする会社で、誰のためで、他とどこが違うか。うまい言い回しより、いつもお客様に話している言葉のほうが役に立ちます。",
  },
  /* WebMCP — AIが直接呼べる口を開ける */
  q_ai_tools: {
    w: 7,
    axis: "WebMCP",
    text: "お客様やAIが、御社に直接尋ねられるとしたら、何を尋ねられるようにしておきたいですか。空き状況、対応できる範囲、料金の目安、対応できる地域など。『これは自動で答えてよい』『これは必ず人が出る』の線引きも合わせて教えてください。その線引きが、こちらで作る窓口の設計そのものになります。",
  },
  /* measure */
  q_ai_found: {
    w: 8,
    axis: "measure",
    text: "いま、お客様は御社をどうやって見つけていますか。紹介、検索、看板、SNS、以前からの付き合い。割合はだいたいで構いません。『AIで見つけた』というお客様がいたら、それは貴重なので必ず教えてください。こちらはAIからの流入をまだ1件も測れていないので、実例が要ります。",
  },
};

/* 可視性の設問の id。これも『データベースを熱くする』側に数える。 */
export function visibilityQids() { return Object.keys(VISIBILITY_BANK); }
export function visibilityQuestion(qid) { return VISIBILITY_BANK[qid] || null; }
