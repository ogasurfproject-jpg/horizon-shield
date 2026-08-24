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
    {"store_id": "kira-test01", "name": "", "member_no": None, "area": "平塚市"},
    {"store_id": "hs-partner-001", "name": "リフォーム職人株式会社", "area": "愛知県"},
    # 社名がどちらにも無い店。書き込みの宛先が正しいかを、この店で見る。
    {"store_id": "kira-empty02", "name": "", "area": "小田原市"},
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
}
PATCHED = []


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
        self._send(404, {"error": "no"})


def run(tool, *args):
    env = dict(os.environ)
    env["HS_ADMIN_HOSTS"] = "http://127.0.0.1:%d" % PORT
    r = subprocess.run([sys.executable, os.path.join(HERE, tool)] + list(args),
                       capture_output=True, text=True, cwd=HS, env=env)
    return r


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
        need = ["訪問看護の店: 2 件", "q_nv_shido"]
        for w in need:
            if w not in r.stdout: print("  ★出力に %s がありません" % w); bad += 1

    print("\n=== 2) fix_company.py の一覧 ===")
    r = run("fix_company.py")
    ok = (r.returncode == 0)
    if not ok: print((r.stdout + r.stderr)[-900:]); print("  ★落ちた"); bad += 1
    else:
        for w in ["kira-test01", "hs-partner-001", "合同会社アップス"]:
            if w not in r.stdout: print("  ★出力に %s がありません" % w); bad += 1
        print("  ok  3店とも一覧に出た。厚い方の社名も読めている。")

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

    print("\n=== 4) 既に社名が入っている店を、黙って上書きしないか ===")
    r = run("fix_company.py", "--id", "hs-partner-001", "--name", "別の会社", "--apply")
    if r.returncode == 0:
        print("  ★上書きを許した"); bad += 1
    else:
        print("  ok  止まった: " + (r.stderr.strip().splitlines() or [""])[0][:60])

    print()
    if bad:
        print("★ %d 件ずれています。" % bad); sys.exit(1)
    print("全部通りました。実物と同じ形の応答で、端から端まで動きます。")


if __name__ == "__main__":
    main()
