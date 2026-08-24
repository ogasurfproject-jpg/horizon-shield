# -*- coding: utf-8 -*-
"""
管理APIを使う道具を、模擬のサーバに通して確かめる。

なぜ要る (2026-08-24):
  この一群の道具は、書いた直後に3回落ちた。全部お客様のデータに当てた瞬間である。
    ・error を文字列で返すサーバに当たって AttributeError
    ・--id で指した店とは別の店を書き換えようとした(変数の使い回し)
    ・/admin/stores の欄名を id と書いた。実際は store_id。全部 None になって落ちた

  どれも「実際の応答の形」を知らずに書いたことが原因である。
  模擬のサーバを立てて、実物と同じ形を返させ、道具を端から端まで通す。
  落ちるなら、お客様のデータではなく、ここで落ちる。

  python3 tools/nursing/admin_tools_test.py
"""

import io, json, os, subprocess, sys, threading, time
from http.server import BaseHTTPRequestHandler, HTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
HS = os.path.abspath(os.path.join(HERE, "..", ".."))
PORT = 8907

# 実物と同じ形。storeToContractor が作る行は store_id と name を持つ。
STORES = [
    {"store_id": "kira-test01", "name": "", "member_no": None, "area": "平塚市",
     "industry": "nursing"},
    {"store_id": "hs-partner-001", "name": "リフォーム職人株式会社", "area": "愛知県",
     "industry": "construction"},
    # 社名がどちらにも無い店。書き込みの宛先が正しいかを、この店で見る。
    {"store_id": "kira-empty02", "name": "", "area": "小田原市", "industry": None},
    # どの試験も書き換えない店。「社名が無い」の検出は、これで見る。
    # 2026-08-24: 最初これを用意せず、試験3が書き込んだ社名を試験5が見ていた。
    #   試験どうしが状態を共有すると、順番を変えただけで結果が変わる。
    {"store_id": "kira-noname04", "name": "", "area": "秦野市"},
]
EXPORTS = {
    "kira-test01": {"ok": True, "answered_at": "2026-08-24T00:30:00Z", "profile": {
        "company": "合同会社アップス さざなみ訪問看護ステーション", "industry": "nursing",
        "area": "平塚市",
        "extra": {"q_nv_shido": {"text": "令和5年に実地指導を受けました。BCPの研修記録を求められました。",
                                 "at": "2026-08-24T00:30:00Z", "attributed": "numbered",
                                 "with": ["q_nv_system"], "asked": "実地指導について"}}}},
    "hs-partner-001": {"ok": True, "answered_at": "2026-08-21T00:24:19Z", "profile": {
        "company": "リフォーム職人株式会社", "industry": None, "area": "愛知県", "extra": {}}},
    "kira-empty02": {"ok": True, "answered_at": "2026-08-24T01:00:00Z", "profile": {
        "company": "", "industry": "nursing", "area": "小田原市", "extra": {}}},
    "kira-noname04": {"ok": True, "answered_at": None, "profile": {
        "company": "", "industry": "nursing", "area": "秦野市", "extra": {}}},
}
PATCHED = []
MODE_WRITES = []
AUTOPILOT = {
    # 平田さんの形: 共通の設問は送ってあるが、DBを厚くする現場質問は一度も送っていない
    # 実際に平田様の記録で見つけた形: 返事待ちは立っているのに asked が空。
    "kira-test01": {"asked": [],
                    "pending": {"qids": ["q_focus", "q_strengths"],
                                "sent_at": "2026-08-23T21:17:00Z", "via": "line"}},
    "hs-partner-001": {"asked": [{"qid": "q_areas", "at": "2026-08-01T21:17:00Z"}] * 3,
                       "pending": {"qids": ["q_areas"], "sent_at": "2026-08-01T21:17:00Z",
                                   "via": "email"}},
    "kira-empty02": {"asked": [], "pending": None},
    "kira-noname04": {"asked": [], "pending": None},
}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def _send(self, code, obj):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code); self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(b))); self.end_headers(); self.wfile.write(b)

    def _auth(self):
        if not self.headers.get("X-Admin-Key"):
            self._send(403, {"error": "forbidden"}); return False
        return True

    def do_GET(self):
        if not self._auth(): return
        if self.path == "/admin/stores":
            return self._send(200, {"ok": True, "stores": STORES})
        if self.path.startswith("/admin/autopilot/"):
            sid = self.path[len("/admin/autopilot/"):]
            if sid not in EXPORTS:
                return self._send(404, {"error": "not_found"})
            return self._send(200, {"ok": True, "completeness": 42,
                "autopilot": AUTOPILOT.get(sid, {"asked": [], "pending": None})})
        if self.path.startswith("/admin/export/"):
            sid = self.path[len("/admin/export/"):]
            if sid in EXPORTS: return self._send(200, EXPORTS[sid])
            return self._send(404, {"error": "not_found"})
        self._send(404, {"error": "no"})

    def do_POST(self):
        if not self._auth(): return
        n = int(self.headers.get("content-length") or 0)
        b = json.loads(self.rfile.read(n).decode() or "{}")
        if self.path == "/admin/profile-patch":
            if "fields" not in b:
                return self._send(400, {"error": "no_allowed_field"})
            PATCHED.append(b)
            sid = b.get("store_id")
            EXPORTS[sid]["profile"].update(b["fields"])
            return self._send(200, {"ok": True, "store_id": sid, "applied": b["fields"]})
        if self.path == "/admin/hearing-mode":
            sid = b.get("store_id")
            mode = b.get("mode")
            if mode not in ("prospect", "onboarding"):
                return self._send(400, {"error": "mode は prospect か onboarding", "got": mode})
            row = [r for r in STORES if r["store_id"] == sid]
            if not row:
                return self._send(404, {"error": "not_found"})
            frm = row[0].get("hearing_mode") or "prospect"
            row[0]["hearing_mode"] = mode
            MODE_WRITES.append(b)
            return self._send(200, {"ok": True, "store_id": sid, "from": frm, "to": mode})
        self._send(404, {"error": "no"})


def run(tool, *args):
    env = dict(os.environ)
    env["HS_ADMIN_HOSTS"] = "http://127.0.0.1:%d" % PORT
    # 試験は本物の鍵を要らない。模擬のサーバは値を見ない。
    # 鍵マネージャはリポジトリに入っていないので、CI ではこれが無いと必ず落ちる。
    env["HS_ADMIN_KEY"] = "test-key-not-a-real-secret"
    r = subprocess.run([sys.executable, os.path.join(HERE, tool)] + list(args),
                       capture_output=True, text=True, cwd=HS, env=env)
    return r


FAILS = []


def must(label, cond, r=None, extra=""):
    """通ったか落ちたかを1行で言う。落ちたときだけ、道具の出力を出す。"""
    print(("  ok  " if cond else "  ★NG ") + label + (("  " + extra) if extra else ""))
    if not cond:
        FAILS.append(label)
        if r is not None:
            for line in (r.stdout + r.stderr).strip().splitlines()[-12:]:
                print("        " + line)
    return cond


def main():
    srv = HTTPServer(("127.0.0.1", PORT), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    time.sleep(0.3)
    bad = 0

    print("=== 1) collect_field_reports.py を端から端まで ===")
    r = run("collect_field_reports.py")
    ok = (r.returncode == 0)
    print(r.stdout.strip()[-700:] if ok else (r.stdout + r.stderr)[-900:])
    if not ok: print("  ★落ちた (終了コード %d)" % r.returncode); bad += 1
    else:
        need = ["訪問看護の店: 3 件", "q_nv_shido"]
        for w in need:
            if w not in r.stdout: print("  ★出力に %s がありません" % w); bad += 1

    print("\n=== 2) fix_company.py の一覧 ===")
    r = run("fix_company.py")
    ok = (r.returncode == 0)
    if not ok: print((r.stdout + r.stderr)[-900:]); print("  ★落ちた"); bad += 1
    else:
        for w in ["kira-test01", "hs-partner-001", "合同会社アップス"]:
            if w not in r.stdout: print("  ★出力に %s がありません" % w); bad += 1
        print("  ok  4店とも一覧に出た。厚い方の社名も読めている。")

    print("\n=== 3) 指した店と別の店を書き換えないか ===")
    r = run("fix_company.py", "--id", "kira-empty02", "--name", "テスト社名", "--apply")
    if r.returncode != 0:
        print((r.stdout + r.stderr)[-600:]); print("  ★落ちた"); bad += 1
    elif not PATCHED:
        print("  ★書き込まれていない"); bad += 1
    elif PATCHED[-1].get("store_id") != "kira-empty02":
        print("  ★別の店を書き換えた: %s" % PATCHED[-1].get("store_id")); bad += 1
    elif "fields" not in PATCHED[-1]:
        print("  ★送る形が違う(fields で包んでいない)"); bad += 1
    else:
        print("  ok  kira-empty02 に fields で包んで送っている(一覧の最後の店ではない)")

    print("\n=== 5) hearing_status.py が不備を名指しするか ===")
    r = run("hearing_status.py")
    if r.returncode != 0:
        print((r.stdout + r.stderr)[-700:]); print("  ★落ちた"); bad += 1
    else:
        want = ["まだ一度も送っていない", "生成器が missing", "返事待ちが",
                "store: 側に業種が無い", "社名がどちらにも無い",
                "送信履歴が失われている",
                "store: 側に業種が無い"]
        for w in want:
            if w not in r.stdout:
                print("  ★出力に「%s」がありません" % w); bad += 1
        if all(w in r.stdout for w in want):
            print("  ok  送っていない設問・出口なし・放置・業種なし・社名なしを全部名指しした")

    print("\n=== 4) 既に社名が入っている店を、黙って上書きしないか ===")
    r = run("fix_company.py", "--id", "hs-partner-001", "--name", "別の会社", "--apply")
    if r.returncode == 0:
        print("  ★上書きを許した"); bad += 1
    else:
        print("  ok  止まった: " + (r.stderr.strip().splitlines() or [""])[0][:60])

    print("\n=== 7) 立場の切り替えが、指した店にだけ効くか ===")
    # 既定では何も書かない
    r = run("set_hearing_mode.py", "--id", "kira-test01", "--mode", "onboarding")
    must("--write を付けなければ書かない",
         (not MODE_WRITES) and "何も書いていません" in r.stdout, r)
    must("何がどう変わるかを先に出す",
         "48時間おき" in r.stdout and "needs_human" in r.stdout, r)
    # 実際に書く
    r = run("set_hearing_mode.py", "--id", "kira-test01", "--mode", "onboarding", "--write")
    must("--write で書く", len(MODE_WRITES) == 1 and MODE_WRITES[0]["store_id"] == "kira-test01",
         r, "書いた先=%s" % [w.get("store_id") for w in MODE_WRITES])
    must("書いた結果を言う", "prospect -> onboarding" in r.stdout, r)
    # 一覧に無い店IDは拒む
    r = run("set_hearing_mode.py", "--id", "kira-nonexistent99", "--mode", "onboarding", "--write")
    must("一覧に無い店には書かない",
         len(MODE_WRITES) == 1 and r.returncode == 1, r,
         "書いた先=%s" % [w.get("store_id") for w in MODE_WRITES])

    print("\n=== 6) 口が業種を返さないとき、「無い」と言わないか ===")
    # 2026-08-24: /admin/stores は industry を返していなかった。
    #   道具は1行ずつ見て undefined を得て、「業種が無い」と報告し続けた。
    #   書き込みは成功していたのに、3社とも不備として名指しし続けた。
    #   「その欄がどの行にも無い」と「その口がその欄を返さない」は別である。
    global STORES
    saved = [dict(x) for x in STORES]
    for x in STORES:
        x.pop("industry", None)
    r = run("hearing_status.py")
    STORES[:] = saved
    if r.returncode != 0:
        print((r.stdout + r.stderr)[-500:]); print("  ★落ちた"); bad += 1
    elif "store: 側に業種が無い" in r.stdout:
        print("  ★ 見えない欄について「無い」と言っている"); bad += 1
    elif "見えません" not in r.stdout:
        print("  ★ 見えないことを言っていない"); bad += 1
    else:
        print("  ok  「この口からは見えません」と言い、「無い」とは言わない")

    bad += len(FAILS)
    print()
    if bad:
        print("★ %d 件ずれています。" % bad); sys.exit(1)
    print("全部通りました。実物と同じ形の応答で、端から端まで動きます。")


if __name__ == "__main__":
    main()
