# -*- coding: utf-8 -*-
# provision_store.py : Yakumoモールに加盟店を1件追加する量産CLI。
#   data/yakumo-contractors.json(単一真実源)に contractor を1件足す。
#   --webmcp を付けた店だけ webmcp ブロック(有料オプション=課金ゲート対象)を持つ。
#   表向きは全店同一のKIRA(Glama仕様・名前なし)。store_idで裏個別識別。
#   出力: store別 MCP URL と 埋め込みスニペット。fail-closed(重複/必須欠落で停止)。
#
# 例:
#   python3 tools/yakumo/provision_store.py --member No.002 --store hs-partner-002 \
#       --company "山田塗装株式会社" --area "神奈川県平塚市" \
#       --areas "神奈川県,平塚市,茅ヶ崎市" --works "外壁塗装,屋根,防水" --webmcp
#   （--webmcp を付けなければ honbu のみ=弟子(WebMCP)は立たない）

import json, sys, argparse, re, os

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CONTRACTORS = os.path.join(REPO_ROOT, "data", "yakumo-contractors.json")
WEBMCP = "https://hs-webmcp.oga-surf-project.workers.dev"
HS_HEARING = "https://hs-hearing.oga-surf-project.workers.dev/mcp"

BASE_FEE = 29800
WEBMCP_ADDON = 12000

def member_to_no(member):
    # "No.002" -> "no002"
    m = re.search(r'(\d+)', member or "")
    if not m:
        return None
    return "no" + m.group(1).zfill(3)

def splitcsv(s):
    return [x.strip() for x in (s or "").split(",") if x.strip()]

def main():
    pa = argparse.ArgumentParser()
    pa.add_argument("--member", required=True, help="加盟店番号。例: No.002")
    pa.add_argument("--store", required=True, help="store_id。例: hs-partner-002")
    pa.add_argument("--company", required=True, help="会社名")
    pa.add_argument("--area", required=True, help="所在地。例: 神奈川県平塚市")
    pa.add_argument("--areas", default="", help="対応エリア(カンマ区切り)")
    pa.add_argument("--works", required=True, help="対応工種(カンマ区切り)。例: 外壁塗装,屋根")
    pa.add_argument("--webmcp", action="store_true", help="WebMCP有料オプション契約(弟子=横に立つKIRAを立てる)")
    pa.add_argument("--embed-id", default="", help="embed_id(省略時は memberから自動: no002 等)")
    pa.add_argument("--joined-at", default="", help="加盟日 YYYY-MM-DD(省略可)")
    args = pa.parse_args()

    no = member_to_no(args.member)
    if not no:
        print("STOP: --member から番号が取れない: " + args.member); sys.exit(1)
    embed_id = args.embed_id.strip() or no

    with open(CONTRACTORS, encoding="utf-8") as f:
        db = json.load(f)
    contractors = db.setdefault("contractors", [])

    # fail-closed: 重複チェック
    for c in contractors:
        if c.get("store_id") == args.store:
            print("STOP: store_id 重複: " + args.store); sys.exit(1)
        if c.get("member_no") == args.member:
            print("STOP: member_no 重複: " + args.member); sys.exit(1)

    areas = splitcsv(args.areas) or [args.area]
    works = splitcsv(args.works)
    if not works:
        print("STOP: --works が空"); sys.exit(1)

    total = BASE_FEE + (WEBMCP_ADDON if args.webmcp else 0)
    rec = {
        "member_no": args.member,
        "store_id": args.store,
        "name": args.company,
        "rep": None,
        "area": args.area,
        "areas_served": areas,
        "works": works,
        "license_verified": False,
        "status": "onboarding",
        "verification": "pending",
        "fairness_score": None,
        "integrity_tier": None,
        "red_flags_detected": None,
        "claim_sha256": None,
        "ptka_block": None,
        "profile_url": "/yakumo/" + no + "/",
        "mcp_url": HS_HEARING,
        "webmcp_option": bool(args.webmcp),
        "plan": {
            "base_tier": "honbu",
            "base_fee_ex_tax": BASE_FEE,
            "webmcp_addon_ex_tax": WEBMCP_ADDON if args.webmcp else 0,
            "total_ex_tax": total,
            "currency": "JPY",
            "tax_note": "全て税抜。税込は各自 x1.1。",
        },
        "hearing": {"sent": False, "completed": False, "last_answer_at": None},
        "joined_at": args.joined_at or None,
        "verified_at": None,
    }
    if args.webmcp:
        rec["webmcp"] = {
            "enabled": True,
            "requires_option": True,
            "store_id": args.store,
            "endpoint": WEBMCP + "/mcp?store=" + args.store,
            "embed_id": embed_id,
            "audit_engine": "kira-neutral",
            "note": "表向きは全店同一のKIRA(Glama仕様・名前なし)。store_idで裏個別識別と課金ゲートのみ。",
            "provisioned_at": None,
            "status": "draft",
        }

    contractors.append(rec)
    with open(CONTRACTORS, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print("OK: " + args.member + " (" + args.company + ") を追加。webmcp_option=" + str(bool(args.webmcp)))
    print("  月額(税抜): " + format(total, ",") + " 円" + ("  (honbu " + format(BASE_FEE, ",") + " + WebMCP " + format(WEBMCP_ADDON, ",") + ")" if args.webmcp else "  (honbuのみ)"))
    print("  真実源: data/yakumo-contractors.json を更新した。")
    if args.webmcp:
        print("")
        print("  この店のWebMCP(裏で個別識別・名前なしのKIRA):")
        print("    MCP URL : " + WEBMCP + "/mcp?store=" + args.store)
        print("    A2A card: " + WEBMCP + "/.well-known/agent-card.json")
        print("    埋め込みスニペット(自社サイトの </body> 直前に貼る):")
        print('      <script src="' + WEBMCP + "/embed.js?store=" + args.store + '" async></script>')
        print("    ※ 反映: git add data/yakumo-contractors.json && commit && push -> Pages更新後、上のstore_idが課金ゲートを通過する。")
    else:
        print("  honbuのみ(WebMCP未契約)なので、この店に弟子(横に立つKIRA)は立たない。")
    print("")
    print("次: git diff で確認 -> 本人が commit / push。")

if __name__ == "__main__":
    main()
