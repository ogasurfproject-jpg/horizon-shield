/**
 * 出来事の題名から、読み直しが要りそうな JHNRD の項目を挙げる。候補を挙げるだけで、項目は書き換えない。
 * 当たらなかったときは『全項目を見る』ではなく『当たりなし(人が振り分ける)』と返す。黙って全部に広げない。
 */
export const KEYWORD_IMPACT = [
  { kw: ["ベースアップ"], ids: ["iryo-baseup"] },
  { kw: ["物価対応"], ids: ["iryo-bukka"] },
  { kw: ["包括型"], ids: ["iryo-hokatsu"] },
  { kw: ["遠隔診療補助", "遠隔死亡診断"], ids: ["iryo-enkaku", "kaigo-kasan-enkaku-shibo"] },
  { kw: ["医療情報連携", "在宅患者連携", "カンファレンス"], ids: ["iryo-kasan-renkei"] },
  { kw: ["医療DX", "電子資格確認", "オンライン資格確認"], ids: ["iryo-kasan-kanri-sonota"] },
  { kw: ["精神科訪問看護"], ids: ["iryo-seishin-kihon", "iryo-seishin-kasan"] },
  { kw: ["管理療養費", "機能強化型"], ids: ["iryo-kanri-shonichi", "iryo-kanri-2nichime"] },
  { kw: ["24時間対応"], ids: ["iryo-kasan-24h"] },
  { kw: ["特別管理"], ids: ["iryo-kasan-tokubetsu-kanri", "kasan-tokubetsu-kanri"] },
  { kw: ["緊急訪問看護", "緊急時訪問看護"], ids: ["iryo-kasan-kinkyu", "kaigo-kasan-kinkyuji"] },
  { kw: ["複数名"], ids: ["iryo-kasan-fukusumei", "kaigo-kasan-fukusumei"] },
  { kw: ["長時間"], ids: ["iryo-kasan-chojikan", "kaigo-kasan-chojikan"] },
  { kw: ["ターミナル"], ids: ["iryo-terminal", "kasan-terminal"] },
  { kw: ["退院"], ids: ["iryo-kasan-taiin", "kaigo-kasan-taiin-kyodo"] },
  { kw: ["看護体制強化"], ids: ["kaigo-kasan-kango-taisei"] },
  { kw: ["処遇改善"], ids: ["kaigo-kasan-shogu-kaizen"] },
  { kw: ["業務継続計画", "BCP"], ids: ["genzan-bcp"] },
  { kw: ["虐待防止"], ids: ["genzan-gyakutai"] },
  { kw: ["指示書", "特別訪問看護指示"], ids: ["shiji-tsujo", "shiji-tokubetsu"] },
  { kw: ["同一建物"], ids: ["iryo-kihon-ii", "kaigo-genzan-douitsu-tatemono"] },
  { kw: ["介護予防訪問看護"], ids: ["yobou-kihon", "yobou-pt-12getsu"] },
  { kw: ["理学療法士", "作業療法士", "言語聴覚士"], ids: ["pt-ot-st", "kaigo-pt-kaisu", "yobou-pt-12getsu"] },
  { kw: ["口腔"], ids: ["kaigo-kasan-kouku"] },
  { kw: ["サービス提供体制強化"], ids: ["kaigo-kasan-service-taisei"] },
  { kw: ["初回加算"], ids: ["kaigo-kasan-shokai"] },
  { kw: ["定期巡回"], ids: ["kaigo-kihon-teiki-junkai"] },
  // [2026-09-26 seed.24]
  { kw: ["准看護師"], ids: ["genzan-junkangoshi", "kaigo-kihon-st"] },
  { kw: ["特別な指示", "特別指示"], ids: ["kaigo-tokubetsu-shiji-14", "kaigo-genzan-iryo-shiji-nissuu", "shiji-tokubetsu"] },
];

// 訪問看護の話かどうかの目印。これが無い疑義解釈や最新情報は、題名だけでは振り分けない(人が見る)。
export const NURSING_MARK = ["訪問看護", "療養費", "居宅サービス", "介護予防サービス", "介護報酬", "診療報酬", "疑義解釈", "訂正"];

export function impactOf(text) {
  const t = String(text || "");
  const ids = new Set();
  const hit = [];
  for (const row of KEYWORD_IMPACT) {
    for (const k of row.kw) if (t.includes(k)) { hit.push(k); row.ids.forEach((i) => ids.add(i)); }
  }
  const nursing = NURSING_MARK.filter((k) => t.includes(k));
  return { items: [...ids].sort(), keywords: [...new Set(hit)], nursing_marks: nursing,
    triage: ids.size ? "candidate_items" : (nursing.length ? "human_triage" : "not_nursing_or_unknown") };
}
