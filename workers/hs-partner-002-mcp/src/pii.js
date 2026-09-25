/* 2026-09-25 公開面に出す自由記述の掃除。

   二つを分けて持つ。
   1) 第三者の個人名。加盟店の返事や見積の件名に、施主の名前が「益田様」「田中さん」の形で混ざる。
      これは加盟店の情報ではなく、その施主の情報である。生成頁にも MCP にも、生成の LLM にも渡さない。
      実害: 001 の公開プロフィール(MCP)に「益田様新店舗」、002 に「古木様」「鴨宮瀬戸様」「八幡宮」が出ていた
      (番人が live で確認)。
   2) 門を理由なく止める文字。門(tools/pagecheck/validate.py)は fail-closed で、ゼロ幅文字・双方向制御・
      制御文字・12文字以上の英数字の連なり(base64 と見なす)が1つでもあれば、その店の頁を全部止める。
      LINE の返事の絵文字(ゼロ幅結合子を含むもの)1つで 11 枚が出なくなる。2026-09-07 の百万円と同じ型。

   加盟店自身の連絡先・住所は消さない。AI と施主に見つけてもらうための情報で、消すと本末転倒になる。
   氏名の判定は敬称(様・さま・さん・ちゃん・くん・邸・氏)で行う。敬称の無い名前は拾えない。これは限界である。
   同じ内容の写しを hs-partner-001-mcp / hs-partner-002-mcp の src/pii.js に置く。正本はここ。 */

// ---- 見えない文字と絵文字 ----
const INVISIBLE_RE = /[​-‍⁠﻿­᠎‪-‮⁦-⁩‎‏؜\x00-\x08\x0B\x0C\x0E-\x1F\x7F︀-️⃣]/g;
const EMOJI_RE = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\u{1F1E6}-\u{1F1FF}]/gu;
export function stripInvisible(s) {
  return String(s == null ? "" : s).replace(INVISIBLE_RE, "").replace(EMOJI_RE, "");
}

// ---- 第三者の個人名(敬称で判定) ----
const NAME_RE = /([\p{Script=Han}\p{Script=Katakana}ー々〆〇ヶA-Za-z]{1,8}?)(様|さま|さん|ちゃん|くん|邸|氏)/gu;
// 敬称ではない「様」「邸」「氏」: 様式・様々・様子・様相・様態・様変わり / 邸宅・邸内 / 氏名
const SAMA_NOT_HON_NEXT = new Set(["式", "々", "子", "相", "態", "変"]);
const TEI_NOT_HON_NEXT = new Set(["宅", "内"]);
// 語そのものがこの形なら人名ではない(一・多・子は、ここに一致した時だけ残す。健一様・本多様・恵子様は伏せる)
const KEEP_EXACT = new Set(["皆", "客", "奥", "父", "母", "兄", "姉", "弟", "妹", "娘", "孫", "隣", "嬢", "子", "一", "多", "〇〇"]);
// この語で終われば人名ではない(役割・続柄・職種。どれも人名の終わりにはならない語だけ)
const KEEP_SUFFIX = [
  "施主", "主人", "他人", "個人", "旦那", "息子", "両親", "家族", "親戚", "祖父", "祖母", "義父", "義母",
  "得意", "顧客", "取引先", "客先", "先方", "業者", "職人", "大工", "左官", "担当", "担当者", "営業", "監督",
  "棟梁", "親方", "師匠", "先輩", "後輩", "友人", "友達", "大家", "管理人", "住人", "入居者", "利用者",
  "購入者", "関係者", "責任者", "施工者", "設計者", "管理者", "社長", "店長", "部長", "課長", "所長", "会長",
  "院長", "園長", "校長", "係長", "班長", "室長", "工場長", "医者", "医師", "看護師", "講師", "技師",
  "設計士", "建築士", "税理士", "弁護士", "塗装屋", "電気屋", "水道屋", "ガス屋", "植木屋", "材木屋",
  "左官屋", "瓦屋", "畳屋", "建具屋", "板金屋", "設備屋", "内装屋", "解体屋", "オーナー", "近所", "多種多",
];
// 「X様」で一語になる字(仕様・同様・模様・有様・各様・別様・左様・異様・神様・殿様・御社様・お宅様・ご家族様 など)
const SAMA_COMPOUND_LAST = new Set(["仕", "同", "模", "有", "両", "各", "別", "左", "然", "異", "今", "神", "王", "殿", "貴", "社", "宅", "族", "親"]);
// 「X邸」で一語になる字(豪邸・私邸・官邸・公邸・本邸・別邸・新邸・旧邸)
const TEI_COMPOUND_LAST = new Set(["豪", "私", "官", "公", "本", "別", "新", "旧"]);

function isGeneric(base, hon) {
  if (KEEP_EXACT.has(base)) return true;
  for (const w of KEEP_SUFFIX) if (base.endsWith(w)) return true;
  const last = base.charAt(base.length - 1);
  if ((hon === "様" || hon === "さま") && SAMA_COMPOUND_LAST.has(last)) return true;
  if (hon === "邸" && TEI_COMPOUND_LAST.has(last)) return true;
  return false;
}
export function scrubNames(s) {
  const str = String(s == null ? "" : s);
  return str.replace(NAME_RE, (m, base, hon, off) => {
    const next = str.charAt(off + m.length);
    if (hon === "様" && SAMA_NOT_HON_NEXT.has(next)) return m;
    if (hon === "邸" && TEI_NOT_HON_NEXT.has(next)) return m;
    if (hon === "氏" && next === "名") return m;
    if (isGeneric(base, hon)) return m;
    return "〇〇" + hon;
  });
}

// ---- URL・メール・電話・長い英数字 ----
const URL_RE = /(?:https?:\/\/|www\.)[^\s　、。」』)）]+/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /(?<!\d)(?:\+81[-\s]?|0)\d{1,4}[-\s(（)）]?\d{1,4}[-\s(（)）]?\d{3,4}(?!\d)/g;
const LONG_ASCII_RE = /[A-Za-z0-9+\/]{12,}/g;
function breakLongAscii(s) {
  return s.replace(LONG_ASCII_RE, (m) => m.match(/.{1,8}/g).join(" "));
}
function tidy(s) {
  return s.replace(/[ \t　]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

// 生成頁に出す、加盟店自身の文(強み・実績・FAQ など)。人名と、門を止める文字だけを取る。
export function cleanForPage(s) {
  return tidy(breakLongAscii(scrubNames(stripInvisible(s))));
}

// 返事を FAQ の答えとして出す形にする。挨拶・URL・メールも取る。薄いものは出さない(null)。
const GREET_HEAD = /^(?:(?:いつも)?お世話になっております|お疲れ様です|お疲れさまです|こんにちは|こんばんは|おはようございます|ご連絡ありがとうございます|ご質問ありがとうございます|ありがとうございます)[。．.!！、,\s]*/;
const GREET_TAIL = /[\s、,]*(?:(?:どうぞ)?(?:よろしく|宜しく)お願い(?:いた|致)?し(?:ます|上げます)|(?:よろしく|宜しく)お願い申し上げます|以上(?:です|となります))[。．.!！\s]*$/;
const TRIVIAL_RE = /^(?:特に|とくに)?(?:なし|無し|ない|ないです|無いです|ありません|ございません|わかりません|分かりません|不明)[。．.!！]*$/;
const THIN_RE = /(?:ありません|ないです|無いです|特になし|特にない|思いつきません|わかりません|分かりません)/;
export function cleanAnswer(s, max = 600) {
  let t = stripInvisible(s);
  t = scrubNames(t).replace(URL_RE, "").replace(EMAIL_RE, "");
  t = tidy(breakLongAscii(t));
  let prev;
  do { prev = t; t = t.replace(GREET_HEAD, "").replace(GREET_TAIL, "").trim(); } while (t !== prev);
  if (!t || t.length < 12) return null;
  if (TRIVIAL_RE.test(t)) return null;
  if (t.length < 30 && THIN_RE.test(t)) return null;
  return t.slice(0, max);
}

// ---- 監査した見積の件名(公開プロフィールの audit_evidence.works) ----
// 顧客を名指しする語(寺社・病院・学校・店舗名・会社名)は語ごと落とす。地名で同じ終わり方をするものは残す。
const ORG_TAIL_RE = /(?:宮|神社|大社|寺|院|教会|病院|医院|クリニック|学校|幼稚園|保育園|こども園|店|株式会社|有限会社|合同会社|\(株\)|㈱)$/;
const ORG_HEAD_RE = /^(?:株式会社|有限会社|合同会社|\(株\)|㈱)/;
const PLACE_KEEP = new Set(["宇都宮", "西宮", "大宮", "一宮", "二宮", "国分寺"]);
function isOrgToken(w) {
  if (PLACE_KEEP.has(w)) return false;
  return ORG_TAIL_RE.test(w) || ORG_HEAD_RE.test(w);
}
export function scrubWorkText(s) {
  let t = scrubNames(stripInvisible(s)).replace(EMAIL_RE, "").replace(URL_RE, "").replace(PHONE_RE, "");
  const toks = t.split(/[\s　]+/).filter(Boolean).filter((w) => !isOrgToken(w));
  return toks.join(" ").trim();
}
export function scrubWorks(list) {
  const out = [], seen = new Set();
  for (const w of (Array.isArray(list) ? list : [])) {
    const t = scrubWorkText(w);
    if (t && !seen.has(t)) { seen.add(t); out.push(t); }
  }
  return out.slice(0, 8);
}
export function scrubEvidence(ae) {
  if (!ae || typeof ae !== "object") return ae || null;
  return { ...ae, works: scrubWorks(ae.works) };
}

// ---- 生成に渡す profile(写し)を掃除する。元の profile は触らない(配列・中身は作り直す) ----
function cleanItem(v) {
  if (typeof v === "string") return cleanForPage(v);
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = { ...v };
    for (const k of ["text", "title", "desc", "description", "body", "q", "a"]) if (typeof o[k] === "string") o[k] = cleanForPage(o[k]);
    return o;
  }
  return v;
}
export function cleanProfileForPage(cp) {
  if (!cp || typeof cp !== "object") return cp;
  for (const k of ["strengths", "trust", "story", "ng"]) if (typeof cp[k] === "string") cp[k] = cleanForPage(cp[k]);
  if (Array.isArray(cp.cases)) cp.cases = cp.cases.map(cleanItem);
  if (Array.isArray(cp.faqs)) cp.faqs = cp.faqs.map(cleanItem);
  if (cp.extra && typeof cp.extra === "object" && !Array.isArray(cp.extra)) {
    const ne = {};
    // 当て先の決まらない生の返事(_unsorted など _ で始まる内部の欄)は外に出さない。生成器も読まない。
    for (const [k, v] of Object.entries(cp.extra)) { if (k.charAt(0) === "_") continue; ne[k] = cleanItem(v); }
    cp.extra = ne;
  }
  return cp;
}

// ---- 用紙の送信(raw)を取り込む前に、人名だけを伏せる。加盟店自身の名乗り・連絡先の欄は触らない ----
const FORM_SKIP = new Set(["company", "rep", "contact", "email", "tel", "phone", "token", "code", "member_no", "store_id", "industry"]);
function scrubDeep(v, depth) {
  if (depth > 5) return v;
  if (typeof v === "string") return scrubNames(v);
  if (Array.isArray(v)) return v.map((x) => scrubDeep(x, depth + 1));
  if (v && typeof v === "object") {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = FORM_SKIP.has(k) ? x : scrubDeep(x, depth + 1);
    return o;
  }
  return v;
}
export function scrubFormRaw(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  for (const [k, v] of Object.entries(raw)) if (!FORM_SKIP.has(k)) raw[k] = scrubDeep(v, 0);
  return raw;
}

// ---- 加盟店MCPが AI に返す値。人名・見えない文字を取り、金額を伏せる(MCP は「金額を含まない」と名乗っている) ----
const MONEY_RES = [
  /(?:[¥￥]\s*\d[\d,.]*|\d[\d,.]*\s*[万億千百]?\s*[円圓]|\d[\d,.]*\s*(?:JPY|yen)\b|\bJPY\s*\d[\d,.]*|(?:US)?\$\s*\d[\d,.]*|\d[\d,.]*\s*(?:USD|EUR)\b)/gi,
  /[〇零一二三四五六七八九十百千壱弐参拾佰仟]+\s*[万億千百萬]?\s*[円圓]/g,
  /(?:税込|税抜|総額|合計|費用|価格|単価|相場|見積|金額|料金|報酬|給与|月給|日給|年収)[^\d\n]{0,6}\d{1,3}(?:,\d{3})+|\d{1,3}(?:,\d{3})+[^\d\n]{0,3}(?:税込|税抜)/g,
];
export function scrubForMcp(v, depth = 0) {
  if (depth > 5) return v;
  if (typeof v === "string") {
    let t = scrubNames(stripInvisible(v));
    for (const r of MONEY_RES) t = t.replace(r, "(金額 非公開)");
    return t;
  }
  if (Array.isArray(v)) return v.map((x) => scrubForMcp(x, depth + 1));
  if (v && typeof v === "object") {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = scrubForMcp(x, depth + 1);
    return o;
  }
  return v;
}
