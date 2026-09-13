#!/usr/bin/env python3
"""
ops/mcp_tool_selection_patch2_20260913.py  (patch1 = ops/mcp_tool_selection_patch_20260913.py の続き)

hs-mcp 1.0.6 -> 1.0.7。tool-selection 層の残り 3 つを埋める。全部 additive、region 無しの呼び出しは従来と同じ返答。

  R1 region 引数(都道府県・市名・鍵)を get_price_range / audit_estimate に追加。souba-db _meta.region_multipliers を
     照会で実際に掛ける(今まで get_fair_price_sources で見せるだけやった)。工事名に地域が入っとる行には掛けん(二重計上)。
     audit_estimate は候補全部を先に掛けてから既存の判定(割れたら断定せん)に通す。返答に region ブロック(applied、基準値)。
  R2 audit_estimate の返答に claim(判定の記録)と verification.claim_sha256。台帳には書かん(書くのは verify_fair_price)。
  R3 新 tool find_verified_contractor(area, work): Yakumo の検証済み施工店を同じサーバーで引く。一次ソースは hs-hearing の
     公開ライブ(KV、金額なし)、落ちたら公開済み静的 JSON。公開項目だけに削って返す。verified と pending を分け、0 件は 0 件。
     名簿の大きさ(directory_size)も返す。NEXT_ACTIONS.actions の find_verified_contractor に tool 名を足す。
  R4 SERVER_INSTRUCTIONS に find_verified_contractor と region の案内。version 1.0.7。

既定は dry-run。--apply で書く(.bak を先に残す)。各 anchor は count==1 を assert。
"""
import sys, os, re, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGET = os.path.join(ROOT, "workers", "hs-mcp", "src", "mcp.js")
TEST1 = os.path.join(ROOT, "workers", "hs-mcp", "test", "tool_selection.test.mjs")
APPLY = "--apply" in sys.argv

src = open(TARGET, encoding="utf-8").read()
orig = src

def rep(anchor, new, label):
    global src
    n = src.count(anchor)
    assert n == 1, "%s: anchor count %d != 1" % (label, n)
    src = src.replace(anchor, new)
    print("ok   " + label)

# ---------- R4 version ----------
rep('const SERVER = { name: "horizon-shield", version: "1.0.6" };',
    'const SERVER = { name: "horizon-shield", version: "1.0.7" };',
    "R4 version 1.0.6 -> 1.0.7")

# ---------- R1 region helpers + R3 yakumo view (before txt) ----------
HELPERS = '''// [2026-09-13 patch2] 地域係数(souba-db _meta.region_multipliers)を照会で使う。今まで get_fair_price_sources で見せるだけやった。
// 鍵は all/kanto/kinki/chubu/tohoku/other。都道府県名と、県名を含まん主な市名を鍵に写す。写せん地名は基準値(all)のまま、その旨を返す。
const REGION_PREFS = {
  kanto: ["東京", "神奈川", "千葉", "埼玉", "茨城", "栃木", "群馬"],
  kinki: ["大阪", "京都", "兵庫", "奈良", "滋賀", "和歌山", "三重"],
  chubu: ["愛知", "岐阜", "静岡", "長野", "山梨", "新潟", "富山", "石川", "福井"],
  tohoku: ["青森", "岩手", "宮城", "秋田", "山形", "福島"],
  other: ["北海道", "鳥取", "島根", "岡山", "広島", "山口", "徳島", "香川", "愛媛", "高知", "福岡", "佐賀", "長崎", "熊本", "大分", "宮崎", "鹿児島", "沖縄"]
};
const REGION_CITIES = {
  kanto: ["横浜", "川崎", "相模原", "平塚", "藤沢", "茅ヶ崎", "鎌倉", "小田原", "厚木", "横須賀", "船橋", "柏市", "さいたま", "川口", "宇都宮", "水戸", "前橋", "高崎"],
  kinki: ["神戸", "堺市", "姫路", "西宮", "尼崎", "大津", "四日市", "津市"],
  chubu: ["名古屋", "長久手", "日進", "豊田", "岡崎", "一宮", "浜松", "松本", "甲府", "金沢"],
  tohoku: ["仙台", "盛岡", "郡山"],
  other: ["札幌", "旭川", "函館", "北九州", "那覇"]
};
function resolveRegion(input, multipliers) {
  const m = multipliers || {};
  const raw = String(input || "").trim();
  if (!raw) return null;
  const key = raw.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(m, key)) return { requested: raw, key, multiplier: Number(m[key]) || 1, matched_by: "key" };
  for (const table of [REGION_PREFS, REGION_CITIES]) {
    for (const k of Object.keys(table)) {
      if (table[k].some(n => raw.includes(n))) {
        if (!Object.prototype.hasOwnProperty.call(m, k)) return { requested: raw, key: null, multiplier: 1, matched_by: "unknown", note: "region " + k + " is not present in souba-db region_multipliers; base values returned." };
        return { requested: raw, key: k, multiplier: Number(m[k]) || 1, matched_by: table === REGION_PREFS ? "prefecture" : "city" };
      }
    }
  }
  return { requested: raw, key: null, multiplier: 1, matched_by: "unknown", note: "地名を地域に写せませんでした。基準値(all)のまま返します。都道府県名か kanto/kinki/chubu/tohoku/other を渡してください。 / Could not map this place to a region; base values returned. Pass a prefecture name or one of kanto, kinki, chubu, tohoku, other." };
}
// 工事名そのものに地域が入っとる行(例: 外構フルセット 関東)には係数を掛けん。二重計上になる。
const WORK_HAS_REGION = /関東|近畿|関西|中部|東北|北海道|九州|四国|首都圏/;
function applyRegion(e, reg) {
  if (!reg || !reg.key || reg.multiplier === 1 || WORK_HAS_REGION.test(String(e.work || ""))) return { e, applied: false };
  const k = reg.multiplier;
  const r = (v) => (typeof v === "number" && Number.isFinite(v)) ? Math.round(v * k) : v;
  return { e: Object.assign({}, e, { min: r(e.min), avg: r(e.avg), max: r(e.max), danger: r(e.danger) }), applied: true };
}
function regionBlock(reg, applied, base) {
  if (!reg) return undefined;
  const out = {
    requested: reg.requested, key: reg.key, multiplier: reg.key ? reg.multiplier : null, matched_by: reg.matched_by, applied,
    basis: "souba-db _meta.region_multipliers (see get_fair_price_sources)"
  };
  if (base) out.fair_range_base = base;
  if (reg.note) out.note = reg.note;
  else if (reg.key && !applied) out.note = "工事名に地域が含まれるため係数は掛けていません(二重計上を避ける)。 / Not applied because the work name already carries a region.";
  return out;
}

// [2026-09-13 patch2] Action 層を URL やなく tool に。価格 -> 検証済み施工店 を同じサーバーで繋ぐ。
// 一次ソースは hs-hearing の公開ライブ(KV、金額なし)。落ちたら公開済み静的 JSON。どちらも公開項目だけに削って返す。
const YAKUMO_LIVE_URL = "https://hearing.horizonshield.dev/contractors.json";
const YAKUMO_STATIC_URL = SITE + "/data/yakumo-contractors.json";
function yakumoPublicView(c) {
  const verified = c.verification === "verified" && c.fairness_score != null;
  return {
    member_no: c.member_no || null, name: c.name, area: c.area || null,
    areas_served: Array.isArray(c.areas_served) ? c.areas_served : [], works: Array.isArray(c.works) ? c.works : [],
    verification: verified ? "verified" : "pending",
    fairness_score: verified ? c.fairness_score : null,
    integrity_tier: verified ? (c.integrity_tier || null) : null,
    red_flags_detected: verified ? (c.red_flags_detected != null ? c.red_flags_detected : null) : null,
    verified_at: verified ? (c.verified_at || null) : null,
    profile_url: c.profile_url ? (String(c.profile_url).startsWith("http") ? c.profile_url : SITE + c.profile_url) : SITE + "/yakumo/",
    note: verified ? "検証済み(KIRA 適正診断 通過)。金額は出しません。 / Verified: passed the KIRA fairness audit. No prices shown." : "検証手続き中。通過するまでスコアは出しません(fail-closed)。 / Pending: no score until verification passes."
  };
}
function txt(s) {'''
rep('function txt(s) {', HELPERS, "R1/R3 helpers (resolveRegion, applyRegion, regionBlock, yakumoPublicView) を txt() の前に追加")

# ---------- R1 inputSchema: region ----------
rep('inputSchema: { type: "object", properties: { query: { type: "string", description: "工事名やキーワード(日本語)" } }, required: ["query"] }\n  },\n  {\n    name: "audit_estimate",',
    'inputSchema: { type: "object", properties: { query: { type: "string", description: "工事名やキーワード(日本語)" }, region: { type: "string", description: "(任意) 地域。都道府県か市名(例: 神奈川県, 平塚市, 名古屋市)か kanto/kinki/chubu/tohoku/other。渡すと souba-db の地域係数を掛けた値と基準値の両方を返す。 / (optional) Prefecture, city, or one of kanto, kinki, chubu, tohoku, other. Applies the regional multiplier and returns base values alongside." } }, required: ["query"] }\n  },\n  {\n    name: "audit_estimate",',
    "R1 get_price_range inputSchema に region")

rep('    }, required: ["work", "quoted_price"] }\n  },\n  {\n    name: "preview_reverse_estimate",',
    '''      ,region: { type: "string", description: "(任意) 地域。都道府県か市名(例: 神奈川県, 平塚市)か kanto/kinki/chubu/tohoku/other。渡すと地域係数を掛けたレンジで判定し、基準値も返す。 / (optional) Prefecture, city, or region key. The verdict then uses the regionally adjusted range; base values are returned too." }
    }, required: ["work", "quoted_price"] }
  },
  {
    name: "preview_reverse_estimate",''',
    "R1 audit_estimate inputSchema に region")

# ---------- R1 get_price_range handler ----------
rep('''      const out = hit.map(e => ({
        work: e.work, unit: e.unit, min: e.min, avg: e.avg, max: e.max,
        trend: e.trend, trend_val: e.trend_val, note: e.note,
        ...((opts && opts.authCtx) ? { danger_over_charge_threshold: e.danger, overcharge_rate_pct: e.overcharge_rate } : {})
      }));
      return txt({
        query: q, currency: "JPY", count: out.length, prices: out,''',
    '''      const reg = resolveRegion(args.region, ((d && d._meta) || {}).region_multipliers);
      let anyApplied = false;
      const out = hit.map(e0 => {
        const ar = applyRegion(e0, reg); const e = ar.e; if (ar.applied) anyApplied = true;
        return {
          work: e.work, unit: e.unit, min: e.min, avg: e.avg, max: e.max,
          trend: e.trend, trend_val: e.trend_val, note: e.note,
          ...(ar.applied ? { base: { min: e0.min, avg: e0.avg, max: e0.max } } : {}),
          ...((opts && opts.authCtx) ? { danger_over_charge_threshold: e.danger, overcharge_rate_pct: e.overcharge_rate } : {})
        };
      });
      return txt({
        query: q, currency: "JPY", count: out.length, prices: out,
        ...(reg ? { region: regionBlock(reg, anyApplied) } : {}),''',
    "R1 get_price_range に region を掛ける")

# ---------- R1 audit_estimate: 候補全部を先に掛ける ----------
rep('''        : "該当工事の適正データが見つかりませんでした: " + work + " / get_price_range で工事名を確認できます。");
      // 単価建ての候補に総額らしい金額を渡しているものは、候補から外す（明らかに指していない）。''',
    '''        : "該当工事の適正データが見つかりませんでした: " + work + " / get_price_range で工事名を確認できます。");
      // [2026-09-13 patch2] 地域係数は候補全部に先に掛ける。掛けた後で既存の「割れたら断定せん」に通す(掛けてから割れる事がある)。
      const reg = resolveRegion(args.region, ((d && d._meta) || {}).region_multipliers);
      const candBase = cand;
      let regionApplied = false;
      cand = cand.map(c => { const ar = applyRegion(c, reg); if (ar.applied) regionApplied = true; return ar.e; });
      // 単価建ての候補に総額らしい金額を渡しているものは、候補から外す（明らかに指していない）。''',
    "R1 audit_estimate 候補に region を掛ける")

# ---------- R2 audit_estimate: resp に組み替えて claim + hash ----------
rep('''      const overAvg = e.avg ? Math.round((price / e.avg - 1) * 100) : null;
      return txt({
        work: e.work, work_query: work, unit: e.unit, your_price: price, currency: "JPY",''',
    '''      const overAvg = e.avg ? Math.round((price / e.avg - 1) * 100) : null;
      const eBase = candBase.find(x => x.work === e.work) || e;
      const resp = ({
        work: e.work, work_query: work, unit: e.unit, your_price: price, currency: "JPY",''',
    "R2 audit_estimate return txt({ -> const resp = ({")

rep('''        provenance: provenanceOf(d._meta),
        next_actions: NEXT_ACTIONS,''',
    '''        provenance: provenanceOf(d._meta),
        ...(reg ? { region: regionBlock(reg, regionApplied, { min: eBase.min, avg: eBase.avg, max: eBase.max }) } : {}),
        next_actions: NEXT_ACTIONS,''',
    "R1 audit_estimate 返答に region ブロック")

rep('''      });
    } catch (e) { return failTxt("価格データの取得に失敗しました。" + SITE + "/souba/ を参照してください。"); }
  }
  if (name === "red_flag_check") {''',
    '''      });
      // [2026-09-13 patch2] 判定の記録とその指紋。台帳には書かん(書くのは verify_fair_price)。時刻込みなので呼ぶたびに hash は変わる。
      const observed_at = new Date().toISOString();
      const claim = {
        tool: "audit_estimate", work: resp.work, unit: resp.unit, quoted_price: price, currency: "JPY",
        fair_range: resp.fair_range, verdict, level,
        region: resp.region ? { key: resp.region.key, multiplier: resp.region.multiplier, applied: resp.region.applied } : null,
        data_version: (d && d._meta && d._meta.version) || "unversioned", observed_at
      };
      resp.claim = claim;
      resp.verification = {
        claim_sha256: await sha256hex(JSON.stringify(claim)),
        recompute: "SHA-256(JSON.stringify(claim)) を計算すれば一致する。台帳には書いていない。検証可能な記録が要るなら verify_fair_price。 / Recompute SHA-256 over JSON.stringify(claim). Not written to the ledger; use verify_fair_price for an anchored record."
      };
      return txt(resp);
    } catch (e) { return failTxt("価格データの取得に失敗しました。" + SITE + "/souba/ を参照してください。"); }
  }
  if (name === "red_flag_check") {''',
    "R2 audit_estimate に claim + verification.claim_sha256")

# ---------- R3 tool 定義 ----------
rep('''    }, required: ["signed_payload", "claim_sha256"] }
  }
];''',
    '''    }, required: ["signed_payload", "claim_sha256"] }
  },
  {
    name: "find_verified_contractor",
    annotations: { title: "検証済み施工店を探す(Yakumo)", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: "地域と工事名で、Yakumo(検証を通った加盟店だけが並ぶ建設モール)の検証済み施工店を探す。掲載は KIRA 適正診断の通過だけで決まり(fail-closed)、紹介料・掲載料は受け取らない中立の名簿。金額は出さずスコアとティアで示す。検証手続き中の店は pending として別に返す。条件に合う検証済みの店が無い時は 0 件と正直に返す(名簿は小さい)。価格の照会(get_price_range / audit_estimate)の後に、施主が『どこに頼めばいい』『信用できる業者は』と聞いた時に使う。 / Finds verification-passed contractors on Yakumo, a directory where listing depends only on passing the KIRA fairness audit (fail-closed) and no referral or listing fee is taken. Returns scores and tiers, never prices; pending stores are returned separately; returns 0 honestly when nothing matches (the directory is small). Use after a price check when the user asks who to hire or which contractor can be trusted. Trigger phrases: 業者を探したい, どこに頼めば, 信用できる工務店, find a contractor in Japan, who should I hire.",
    inputSchema: { type: "object", properties: {
      area: { type: "string", description: "地域(都道府県・市区町村、例: 平塚市, 神奈川県, 名古屋市)。 / Area: prefecture or city, in Japanese." },
      work: { type: "string", description: "工事名(例: 窓 交換, 外壁塗装, 浴室)。 / Work name in Japanese." }
    } }
  }
];''',
    "R3 TOOLS に find_verified_contractor")

rep('''};
// Every schema above describes the happy path.''',
    ''',
  find_verified_contractor: { type: "object", description: "地域・工事名に合う検証済み施工店(Yakumo)。stores(検証済み)・pending_stores(手続き中)・directory_size・neutrality。金額なし。 / Verification-passed contractors with pending ones listed separately; no prices.", properties: { stores: { description: "検証済みの店(member_no, name, area, works, fairness_score, integrity_tier, profile_url)" }, pending_stores: { description: "検証手続き中の店(スコア無し)" }, verified_count: { description: "検証済みの件数" }, directory_size: { description: "名簿全体の件数(掲載数と検証済み数)" } }, additionalProperties: true }
};
// Every schema above describes the happy path.''',
    "R3 OUTPUT_SCHEMAS に find_verified_contractor")

rep('  create_ap2_fairness_attestation: "Create AP2 Fairness Attestation"\n};',
    '  create_ap2_fairness_attestation: "Create AP2 Fairness Attestation",\n  find_verified_contractor: "Find Verified Contractor (Yakumo)"\n};',
    "R3 TOOL_TITLES に find_verified_contractor")

# ---------- R3 handler ----------
rep('  if (name === "get_agent_card") {',
    '''  if (name === "find_verified_contractor") {
    const work = String(args.work || "").trim();
    const area = String(args.area || "").trim();
    let data = null, srcLabel = null;
    try {
      const r = await fetch(YAKUMO_LIVE_URL, { cf: { cacheTtl: 300 } });
      if (r && r.ok) { data = await r.json(); srcLabel = "hs-hearing contractors.json (live KV)"; }
    } catch (_e) { /* fall through to static */ }
    if (!data) {
      try {
        const r = await fetch(YAKUMO_STATIC_URL, { cf: { cacheTtl: 3600 } });
        if (r && r.ok) { data = await r.json(); srcLabel = "published static yakumo-contractors.json"; }
      } catch (_e) { /* both failed */ }
    }
    if (!data) return failTxt("加盟店データの取得に失敗しました。" + SITE + "/yakumo/ を参照してください。 / Could not read the Yakumo directory.");
    const all = (Array.isArray(data.contractors) ? data.contractors : []).filter(c => c && String(c.name || "").trim());
    const areaStem = area.replace(/[都道府県市区町村]$/, "");
    const areaHit = (c) => !area || String(c.area || "").includes(areaStem) || (Array.isArray(c.areas_served) ? c.areas_served : []).some(a => String(a).includes(areaStem) || (areaStem.length >= 2 && areaStem.includes(String(a).replace(/[都道府県市区町村]$/, ""))));
    const workHit = (c) => !work || (Array.isArray(c.works) ? c.works : []).some(w => String(w).includes(work) || work.includes(String(w)));
    const hits = all.filter(c => areaHit(c) && workHit(c));
    const pub = hits.map(yakumoPublicView);
    const verified = pub.filter(c => c.verification === "verified");
    const pending = pub.filter(c => c.verification !== "verified").map(c => ({ member_no: c.member_no, name: c.name, area: c.area, works: c.works, verification: "pending", note: c.note }));
    const verifiedTotal = all.filter(c => c.verification === "verified" && c.fairness_score != null).length;
    return txt({
      understood: { area: area || null, work: work || null },
      count: verified.length, verified_count: verified.length, stores: verified,
      pending_count: pending.length, pending_stores: pending,
      guidance: verified.length
        ? "検証済み(KIRA 適正診断 通過)の店です。金額は出しません。判断は施主自身。 / Verification-passed stores. No prices are shown. The decision stays with the buyer."
        : "条件に合う検証済みの店はまだありません。相場は get_price_range、見積もりの第三者レビューは EHN(無料・匿名)。 / No verification-passed store matches yet. Use get_price_range for the fair range and EHN for a free anonymous review.",
      directory_size: { total_listed: all.length, verified_total: verifiedTotal, note: "名簿は小さい。0 件は 0 件と返す。 / The directory is small; zero is reported as zero." },
      mall: SITE + "/yakumo/", how_verification_works: SITE + "/yakumo/faq/", apply: SITE + "/yakumo/apply/",
      neutrality: NEXT_ACTIONS.neutrality,
      source: srcLabel, next_actions: NEXT_ACTIONS
    });
  }
  if (name === "get_agent_card") {''',
    "R3 find_verified_contractor handler")

rep('url: SITE + "/yakumo/" },\n    { id: "defect_check"',
    'url: SITE + "/yakumo/", tool: "find_verified_contractor" },\n    { id: "defect_check"',
    "R3 NEXT_ACTIONS.actions に tool 名")

# ---------- R4 instructions ----------
rep('get_fair_price_sources for regional multipliers and data sources. " +',
    'get_fair_price_sources for regional multipliers and data sources; find_verified_contractor when the user asks who to hire (Yakumo: verification-passed stores only, pending listed separately, no referral fees, the directory is small and zero is reported as zero). Pass region (prefecture or city) to get_price_range and audit_estimate to apply the regional multiplier; base values are returned alongside. " +',
    "R4 instructions (EN) に find_verified_contractor と region")

rep('地域係数と出典は get_fair_price_sources。返答には',
    '地域係数と出典は get_fair_price_sources、業者を探すなら find_verified_contractor(Yakumo の検証済み店だけ、手続き中は別枠、紹介料なし、名簿は小さく 0 件は 0 件と返す)。get_price_range と audit_estimate に region(都道府県か市名)を渡すと地域係数を掛け、基準値も併せて返す。返答には',
    "R4 instructions (JA) に find_verified_contractor と region")

# ---------- 検査 ----------
DASH = re.compile("[" + "".join(chr(c) for c in (0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xFF0D)) + "]")
new_lines = [l for l in src.splitlines() if l not in set(orig.splitlines())]
bad = [l for l in new_lines if DASH.search(l)]
assert not bad, "追加行にダッシュ: " + "\n".join(bad[:5])
print("ok   追加行 %d 本、ダッシュ無し" % len(new_lines))
for must in ["resolveRegion(", "applyRegion(", "regionBlock(", "yakumoPublicView(", 'name: "find_verified_contractor"', "resp.claim = claim", "candBase"]:
    assert must in src, must
assert src.count("resolveRegion(args.region") == 2

# test1 の固定値も更新(14 -> 15、1.0.6 -> 1.0.7)
t = open(TEST1, encoding="utf-8").read()
t_new = t.replace('chk("tools は 14 本のまま", r.tools.length === 14, r.tools.length);', 'chk("tools は 15 本(14 + find_verified_contractor)", r.tools.length === 15, r.tools.length);')
t_new = t_new.replace('chk("serverInfo.version は 1.0.6", r.serverInfo && r.serverInfo.version === "1.0.6", JSON.stringify(r.serverInfo));', 'chk("serverInfo.version は 1.0.7", r.serverInfo && r.serverInfo.version === "1.0.7", JSON.stringify(r.serverInfo));')
t_new = t_new.replace('chk("next_actions.actions が付く", o.next_actions && Array.isArray(o.next_actions.actions) && o.next_actions.actions.length === 6);', 'chk("next_actions.actions が付く", o.next_actions && Array.isArray(o.next_actions.actions) && o.next_actions.actions.length === 6);')
assert t_new != t and t_new.count("1.0.7") == 2 and "=== 15" in t_new and "1.0.6" not in t_new
print("ok   test1 の固定値(15 本、1.0.7)")

if not APPLY:
    print("\nDRY RUN。書いてへん。--apply で mcp.js と test1 を書き換える(.bak を先に残す)。")
    sys.exit(0)

stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
bak = TARGET + "." + stamp + "-toolsel2.bak"
open(bak, "w", encoding="utf-8").write(orig)
open(TARGET, "w", encoding="utf-8").write(src)
open(TEST1, "w", encoding="utf-8").write(t_new)
print("\nAPPLIED  " + TARGET)
print("APPLIED  " + TEST1)
print("backup   " + bak)
