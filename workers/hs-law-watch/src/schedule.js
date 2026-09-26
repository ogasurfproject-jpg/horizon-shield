/**
 * 日付が先に分かっている変更。告示に日付つきで書き込まれているもの(statute)と、審議会の日程案(agency、予定であって決定ではない)を分けて持つ。
 * 期日の 60 / 30 / 7 / 0 日前に出来事を1回ずつ出す(同じ知らせを二度出さない)。
 */
export const SCHEDULED = [
  { id: "r9-06-iryo-baseup", date: "2027-06-01", basis: "statute",
    title: "訪問看護ベースアップ評価料: (Ⅰ)は所定額の100分の200、継続賃上げは2,880円、(Ⅱ)19〜36の算定開始",
    source: "令和8年厚生労働省告示第74号 別表 07 注4〜注6・注8(https://www.mhlw.go.jp/content/12400000/001665206.pdf)",
    items: ["iryo-baseup"] },
  { id: "r9-06-iryo-bukka", date: "2027-06-01", basis: "statute",
    title: "訪問看護物価対応料: 所定額の100分の200",
    source: "令和8年厚生労働省告示第74号 別表 08 注3", items: ["iryo-bukka"] },
  { id: "r9-kaigo-toushin", date: "2027-01-15", basis: "agency_plan",
    title: "令和9年度介護報酬改定 諮問・答申の見込み(日程案。決定ではない)",
    source: "社会保障審議会 介護給付費分科会 第256回 資料4 p.2(https://www.mhlw.go.jp/content/12300000/001695747.pdf)",
    items: [], note: "日程案の『2027年1月頃』を 1月15日 に置いた仮の日付。実際の開催は mhlw-kyufuhi-bunkakai の一覧で拾う。" },
  { id: "r9-roumu-tanka", date: "2027-02-15", basis: "custom",
    title: "公共工事設計労務単価(令和9年3月適用)の公表見込み(例年2月中旬。予定であって決定ではない)",
    source: "令和8年は 2026-02-17 公表(https://www.mlit.go.jp/report/press/tochi_fudousan_kensetsugyo14_hh_000001_00337.html)",
    items: [], domain: "construction" },
];

export const LEAD_DAYS = [60, 30, 7, 0];

export function dueNotices(todayIso) {
  // 期日までの日数が入っている一番小さい段(60/30/7/0)を1つだけ出す。cron が1日抜けても段は取りこぼさない。
  // 同じ段の知らせは event_id(= id:段)で1回に絞られる(worker 側の INSERT OR IGNORE)。
  const today = Date.parse(todayIso + "T00:00:00Z");
  const out = [];
  for (const s of SCHEDULED) {
    const days = Math.round((Date.parse(s.date + "T00:00:00Z") - today) / 86400000);
    if (days < -3) continue;
    const tier = [...LEAD_DAYS].sort((a, b) => a - b).find((l) => days <= l);
    if (tier === undefined) continue;
    out.push({ key: `${s.id}:${tier}`, lead: tier, days, ...s });
  }
  return out;
}
