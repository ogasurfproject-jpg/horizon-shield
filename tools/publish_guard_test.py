#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""publish_guard.py が、止めるべきものを止め、止めなくてよいものを通すか。

門は、作った日には必ず正しく見える。正しく見えるだけでは足りない。
「今日ここにある本物の束」で緑になり、「本当に危ない束」で赤になることを、
両側から確かめる。片側しか確かめない門は、いつも緑かいつも赤のどちらかになる。
"""
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
GUARD = os.path.join(HERE, "publish_guard.py")


def run(files):
    d = tempfile.mkdtemp(prefix="pgtest_")
    for name, body in files.items():
        p = os.path.join(d, name)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8") as f:
            f.write(body)
    r = subprocess.run([sys.executable, GUARD, d], capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr


CASES = [
    ("普通のページは通る",
     {"index.html": "<h1>こんにちは</h1>"}, 0, None),

    ("鍵の名前が参照として出るだけなら通す(placeholder)",
     {"yakumo/admin/index.html":
      '<input type="password" placeholder="HEARING_ADMIN_SECRET">'}, 0, "控え"),

    ("鍵の名前が process.env の参照でも通す",
     {"a/broadcast.js": "const t = process.env.LINE_CHANNEL_TOKEN;"}, 0, "控え"),

    ("鍵に値が直に書いてあれば止める",
     {"leak.js": 'const HEARING_ADMIN_SECRET = "s3cr3t_value_abcdefghijklmnop";'},
     1, "値が直に書いてある"),

    ("Anthropic の鍵の形をした文字列があれば止める",
     {"leak2.js": 'fetch(h={"x-api-key":"sk-ant-api03-AAAAbbbbCCCCddddEEEEffffGGGG"})'},
     1, "Anthropic の鍵"),

    ("秘密鍵そのものがあれば止める",
     {"id.txt": "-----BEGIN PRIVATE KEY-----\nMIIB\n"}, 1, "秘密鍵"),

    ("鍵マネージャという名前のファイルは止める",
     {"HORIZON_SHIELD_鍵マネージャ.html": "<p>なにも書いていない</p>"},
     1, "鍵マネージャ"),

    ("お客様の契約書は止める",
     {"HORIZON_SHIELD_アップス_契約書_ドラフト.docx": "x"}, 1, "契約書"),

    (".env は止める",
     {".env.production": "A=1"}, 1, "鍵の形をしたファイル"),

    ("値の欄が見本(YOUR_)なら止めない",
     {"doc.html": 'ANTHROPIC_API_KEY = "YOUR_KEY_HERE_PLEASE"'}, 0, None),
]


def main():
    ng = 0
    print("公開直前の門の検査: %d 件\n" % len(CASES))
    for title, files, want_rc, want_text in CASES:
        rc, out = run(files)
        ok = (rc == want_rc) and (want_text is None or want_text in out)
        if not ok:
            ng += 1
            print("  NG  %s" % title)
            print("      期待 rc=%s 実際 rc=%s" % (want_rc, rc))
            if want_text and want_text not in out:
                print("      期待した言葉が出ていない: %s" % want_text)
            print("      ---- 出力 ----")
            for line in out.strip().splitlines():
                print("      " + line)
        else:
            print("  ok  %s" % title)
    print("")
    if ng:
        print("%d 件おかしい。門が働いていない。" % ng)
        return 1
    print("止めるべきものを止め、通すべきものを通しました。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
