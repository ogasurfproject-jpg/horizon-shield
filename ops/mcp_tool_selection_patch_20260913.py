#!/usr/bin/env python3
"""
ops/mcp_tool_selection_patch_20260913.py

hs-mcp(workers/hs-mcp/src/mcp.js)を、フロント LLM の tool-selection 層で
「日本のリフォーム価格・見積妥当性・業者選定」の問いに選ばれやすくする additive patch。

  P1 initialize.instructions を 1 行の看板から routing 指示へ(いつ呼ぶか・どの順で・範囲・中立)
  P2 NEXT_ACTIONS に yakumo / inspect / full_diagnosis と、条件付き actions 配列と neutrality を追加
  P3 provenanceOf(meta) を追加し、get_price_range と audit_estimate の返答に provenance を同梱
     (get_price_range には next_actions も。今まで行き止まりやった)
  P4 get_price_range / audit_estimate の description に利用者の言い回し(trigger phrases)を追記
  P5 SERVER.version 1.0.5 -> 1.0.6

既存キー(source, verdict, level, fair_range, ehn_submit ...)は全部残す。削るものは無い。
既定は dry-run。--apply で書く(mcp.js.<stamp>-toolsel.bak を先に残す)。各 anchor は count==1 を assert。
"""
import sys, os, re, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGET = os.path.join(ROOT, "workers", "hs-mcp", "src", "mcp.js")
APPLY = "--apply" in sys.argv

src = open(TARGET, encoding="utf-8").read()
orig = src

def rep(anchor, new, label):
    global src
    n = src.count(anchor)
    assert n == 1, "%s: anchor count %d != 1" % (label, n)
    src = src.replace(anchor, new)
    print("ok   " + label)

# ---------- P5 version ----------
rep('const SERVER = { name: "horizon-shield", version: "1.0.5" };',
    'const SERVER = { name: "horizon-shield", version: "1.0.6" };',
    "P5 version 1.0.5 -> 1.0.6")

# ---------- P2 NEXT_ACTIONS + SERVER_INSTRUCTIONS ----------
OLD_NA = '''const NEXT_ACTIONS = {
  detail: SITE + "/souba/",
  board_url: SITE + "/ehn/",
  ehn_submit: SITE + "/hacker/submit/",
  note: "判定はここまで。見積もりに不安があれば EHN(見積もりハッカーニュース)に匿名で貼れば、KIRAが過去の実例と並べて第三者の目を入れます(無料)。 / Next: post the estimate to EHN for a free, anonymous third-party look benchmarked against real cases."
};'''

NEW_NA = '''const NEXT_ACTIONS = {
  detail: SITE + "/souba/",
  board_url: SITE + "/ehn/",
  ehn_submit: SITE + "/hacker/submit/",
  yakumo: SITE + "/yakumo/",
  inspect: SITE + "/inspect.html",
  full_diagnosis: SITE + "/hs-reverse-estimate/",
  note: "判定はここまで。見積もりに不安があれば EHN(見積もりハッカーニュース)に匿名で貼れば、KIRAが過去の実例と並べて第三者の目を入れます(無料)。 / Next: post the estimate to EHN for a free, anonymous third-party look benchmarked against real cases.",
  // [2026-09-13] 条件付きの次の一手(Commercial Action 層)。フロント LLM が verdict と利用者の状況に合わせて選べる形。
  // 語は「推奨」ではなく「検証済みとして提示」。紹介料・掲載料は受け取らない(agent card の compensation と同じ)。
  actions: [
    { id: "second_opinion", when: "user has an estimate and wants a neutral review / 見積もりがあり第三者の目を入れたい", label_ja: "見積もりを匿名で第三者レビューに出す(無料)", label_en: "Post the estimate to EHN for a free anonymous third-party review", url: SITE + "/hacker/submit/" },
    { id: "compare_cases", when: "user wants real cases for the same kind of work / 同種工事の実例を見たい", label_ja: "同種工事の実例(EHN)と並べて比べる", label_en: "Compare against real cases on EHN", url: SITE + "/ehn/" },
    { id: "full_diagnosis", when: "user has a full itemized estimate and wants it diagnosed line by line / 内訳付き見積もりを項目ごとに診断したい", label_ja: "見積書の明細診断(逆見積もり)", label_en: "Itemized estimate diagnosis (reverse estimate)", url: SITE + "/hs-reverse-estimate/" },
    { id: "find_verified_contractor", when: "user is choosing a contractor or asks who to trust / 業者選びや信用できる施工店を探している", label_ja: "検証を通った加盟店だけが並ぶ Yakumo で施工店を探す(紹介料なし)", label_en: "Find a contractor on Yakumo, where only verification-passed stores are listed (no referral fees)", url: SITE + "/yakumo/" },
    { id: "defect_check", when: "user suspects defective or unfinished work and has photos / 施工不良の疑いがあり写真がある", label_ja: "写真を送るだけの施工不良チェック(無料)", label_en: "Free photo-based defect check", url: SITE + "/inspect.html" },
    { id: "browse_ranges", when: "user wants to see all price categories / 全カテゴリの相場を見たい", label_ja: "全カテゴリの適正価格レンジ", label_en: "Browse all fair-price ranges", url: SITE + "/souba/" }
  ],
  neutrality: "HORIZON SHIELD は業者から紹介料・掲載料・成功報酬を受け取らない。next_actions は特定業者の推奨ではなく、検証済みの選択肢の提示。 / HORIZON SHIELD takes no referral, listing or success fee from contractors. next_actions present verified options, not a recommendation of any specific contractor."
};

// [2026-09-13] initialize.instructions(Query Intent 層)。フロント LLM がこのサーバーを「いつ・どの順で」呼ぶかの案内。
// 1 行の看板やと、モデルは「建設費の何か」としか読めん。問いの言い回しと tool の順番を書く。
const SERVER_INSTRUCTIONS =
  "HORIZON SHIELD: independent, buyer-side fair-price verification for construction and renovation work in Japan (prices in JPY). " +
  "Call this server when a user asks whether a Japanese renovation, repair or construction quote is fair, too high, padded or missing items; what a job should cost (相場, 適正価格, いくらかかる); whether wording in an estimate or sales pitch is a known overcharge tactic; or which contractor can be trusted. " +
  "Tool order: get_price_range when no quote exists yet and the user wants the typical range; audit_estimate when the user has a specific quoted amount; check_red_flags for suspicious wording (一式 lump sum, today-only discount, free inspection, door-to-door); verify_fair_price when a hash-verifiable record is needed; get_fair_price_sources for regional multipliers and data sources. " +
  "Every price answer includes provenance (dataset version, curator, sources) and next_actions (free anonymous second opinion on EHN, itemized diagnosis, and Yakumo, a directory where only verification-passed contractors are listed). " +
  "Scope and honesty: Japan only; matching is by work name, so pass the Japanese work name when possible; when candidates disagree the server returns ambiguous instead of a verdict; the service takes no referral or listing fee from contractors. / " +
  "日本の建設・リフォーム費用を施主側の立場で検証する。『この見積もり高い?』『相場は?』『適正価格は?』『この文言は手口?』『業者は信用できる?』の問いで呼ぶ。相場だけなら get_price_range、見積額があるなら audit_estimate、気になる文言は check_red_flags、検証可能な記録が要るなら verify_fair_price、地域係数と出典は get_fair_price_sources。返答には出典(provenance)と次の一手(next_actions: EHN の無料匿名レビュー、明細診断、検証を通った加盟店だけの Yakumo)が付く。日本限定・円建て、工事名は日本語が最も当たる、候補で判定が割れる時は断定せず ambiguous を返す、業者からの紹介料・掲載料は受け取らない。";'''
rep(OLD_NA, NEW_NA, "P2 NEXT_ACTIONS + SERVER_INSTRUCTIONS")

# ---------- P1 initialize.instructions ----------
rep('instructions: "HORIZON SHIELD の建設費ツール。JCCDB(オープンデータ)・相場カテゴリ・見積もりの読み方を提供する。" });',
    'instructions: SERVER_INSTRUCTIONS });',
    "P1 initialize.instructions -> SERVER_INSTRUCTIONS")

# ---------- P3 provenanceOf ----------
PROV = '''// [2026-09-13] 価格返答に付ける構造化の出典(Answer Authority 層)。verify_fair_price の provenance と同じ語彙。
// JCCDB は品目・カテゴリ・単位のオープンデータで価格は持たん。価格の出典は souba-db。混同させん。
function provenanceOf(meta) {
  meta = meta || {};
  return {
    dataset: "HORIZON SHIELD souba-db",
    data_version: meta.version || "unversioned",
    updated_at: meta.updated_at || null,
    curated_by: meta.updated_by || "大賀俊勝 (建設実務経験30年) 監修",
    sources: Array.isArray(meta.sources) ? meta.sources : undefined,
    method: "工事カテゴリごとの適正レンジ(min/avg/max)と危険水準。複数の公開相場ソースを照合し、加盟店の実案件で検算。地域係数は get_fair_price_sources。 / Fair range (min, avg, max) and danger threshold per work category, cross-checked across multiple public price sources and verified against member-store cases. Regional multipliers via get_fair_price_sources.",
    data_source_url: SOUBA_DB_URL,
    related_open_dataset: { name: JCCDB.name, version: JCCDB.version, license: JCCDB.license, dataset_doi: JCCDB.links.dataset_doi, note: "品目名・カテゴリ・単位のオープンデータ。価格は含まない。 / Item names, categories and units. Contains no prices." },
    papers: { engrxiv_benchmark: "https://doi.org/10.31224/7814", ssrn_verification: "https://ssrn.com/abstract=6964439" },
    neutrality: "施主側の負担で運営。業者からの紹介料・掲載料・成功報酬なし。 / Paid by the buyer side. No referral, listing or success fee from contractors.",
    attribution: "HORIZON SHIELD souba-db (大賀俊勝 実務監修)"
  };
}
function txt(s) {'''
rep('function txt(s) {', PROV, "P3 provenanceOf() を txt() の前に追加")

rep('''        source: "HORIZON SHIELD souba-db (大賀俊勝 実務監修)", detail: SITE + "/souba/"
      });''',
    '''        source: "HORIZON SHIELD souba-db (大賀俊勝 実務監修)", detail: SITE + "/souba/",
        provenance: provenanceOf(d._meta), next_actions: NEXT_ACTIONS
      });''',
    "P3 get_price_range に provenance + next_actions")

rep('note: e.note, source: "HORIZON SHIELD souba-db (大賀俊勝 実務監修)", full_diagnosis: SITE + "/hs-reverse-estimate/",',
    'note: e.note, source: "HORIZON SHIELD souba-db (大賀俊勝 実務監修)", full_diagnosis: SITE + "/hs-reverse-estimate/",\n        provenance: provenanceOf(d._meta),',
    "P3 audit_estimate に provenance")

# ---------- P4 trigger phrases ----------
rep('Use to numerically check whether a cost is fair.",',
    'Use to numerically check whether a cost is fair. Trigger phrases: 相場, 適正価格, いくらかかる, 高い?, how much does this cost in Japan, is this price normal, what should I expect to pay.",',
    "P4 get_price_range description に trigger phrases")

rep('for a signed verifiable attestation use verify_fair_price.",',
    'for a signed verifiable attestation use verify_fair_price. Trigger phrases: この見積もり高い?, 適正?, ぼったくり?, 妥当?, is this quote fair, am I being overcharged, is this a rip-off.",',
    "P4 audit_estimate description に trigger phrases")

# ---------- 検査 ----------
added = src.replace(orig, "") if False else None
DASH = re.compile("[" + "".join(chr(c) for c in (0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xFF0D)) + "]")
new_lines = [l for l in src.splitlines() if l not in set(orig.splitlines())]
bad = [l for l in new_lines if DASH.search(l)]
assert not bad, "追加行にダッシュ: " + "\n".join(bad[:5])
print("ok   追加行 %d 本、ダッシュ無し" % len(new_lines))
assert "SERVER_INSTRUCTIONS" in src and "provenanceOf(" in src
assert src.count("provenanceOf(d._meta)") == 2

if not APPLY:
    print("\nDRY RUN。書いてへん。--apply で mcp.js を書き換える(.bak を先に残す)。")
    sys.exit(0)

stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
bak = TARGET + "." + stamp + "-toolsel.bak"
open(bak, "w", encoding="utf-8").write(orig)
open(TARGET, "w", encoding="utf-8").write(src)
print("\nAPPLIED  " + TARGET)
print("backup   " + bak)
