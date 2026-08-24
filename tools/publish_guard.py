#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""公開する直前の束を見て、出してはいけないものが混ざっていないか確かめる。

なぜ要るか (2026-08-24):
  static.yml は `rsync -a ./ _public/` でリポジトリ全体を複製してから、
  tools/ workers/ .github/ と *.py *.md を削る。削り方は「拡張子と場所」で決めている。
  だからルートに置かれた .html や .docx は、そのまま公開側に残る。

  いまこの手元のルートには、生きている管理鍵の入った HORIZON_SHIELD_鍵マネージャ.html と、
  お客様の契約書 .docx/.pdf が置いてある。git は無視しているので CI の checkout には
  現れない。つまり今日は安全である。安全なのは、無視の設定が効いている間だけである。
  一度でも git add -A で入れば、次の push で世界に出る。

  「出さない」を無視の設定だけに預けない。出る直前にもう一度見る。

なぜ二段になっているか (2026-08-24、同日):
  最初の版は「鍵の名前が本文に出てきたら赤」にした。走らせたら10件出た。
  中を見ると、全部 process.env.ANTHROPIC_API_KEY のような参照で、値は一つも無い。
  yakumo/admin/index.html に至っては、入力欄の placeholder である。

  名前が出ることと、値が出ることは違う。これを一緒にすると、
  「いつも赤い門」ができる。いつも赤い門は、誰も見なくなる。
  だから赤にするのは値と書類だけにして、名前は「控え」に落とした。
"""
import os
import re
import sys

# 名前が出てくるだけのもの。参照であって値ではない。控えに残すが、止めない。
SECRET_NAMES = [
    "HEARING_ADMIN_SECRET",
    "LEDGER_ADMIN_TOKEN",
    "CLOUDFLARE_API_TOKEN",
    "LINE_CHANNEL_TOKEN",
    "LINE_CHANNEL_SECRET",
    "ANTHROPIC_API_KEY",
]

# 値そのもの。これが出たら止める。
# 1) 既知の鍵の名前に、長い文字列が直に代入されている
VALUE_ASSIGN = re.compile(
    r"(?:%s)\s*[:=]\s*[\"'`]([^\"'`\s]{16,})[\"'`]" % "|".join(SECRET_NAMES)
)
# 2) 名前が無くても、それ自体が鍵と分かる形
VALUE_SHAPES = [
    (re.compile(r"sk-ant-api\w{2}-[A-Za-z0-9_\-]{20,}"), "Anthropic の鍵"),
    (re.compile(r"github_pat_[A-Za-z0-9_]{20,}"), "GitHub の鍵"),
    (re.compile(r"\bghp_[A-Za-z0-9]{30,}"), "GitHub の鍵"),
    (re.compile(r"\bxox[baprs]-[A-Za-z0-9\-]{20,}"), "Slack の鍵"),
    (re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"), "秘密鍵"),
]

# 名前に出てはいけない語。お客様の書類と鍵の一覧。
FORBIDDEN_NAME = ["鍵マネージャ", "鍵一覧", "契約書", "ご請求書", "残金お支払い", "判定書"]

# 中身を読む拡張子。画像や PDF は読まない(名前だけ見る)。
TEXTISH = (".html", ".htm", ".js", ".mjs", ".json", ".txt", ".css",
           ".yml", ".yaml", ".xml", ".csv", ".jsonc")

# 値らしく見えるが値ではないもの。ここに入れるときは理由を書く。
ALLOW_VALUE = [
    "YOUR_", "xxxxx", "XXXXX", "例:", "placeholder", "PLACEHOLDER", "<your",
]


def looks_allowed(v):
    return any(a in v for a in ALLOW_VALUE)


def scan(root):
    stop, note = [], []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d != ".git"]
        for fn in filenames:
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, root)

            for word in FORBIDDEN_NAME:
                if word in fn:
                    stop.append((rel, "書類の名前に「%s」が入っている" % word))
            if fn.startswith(".env") or fn.endswith((".key", ".pem", ".p12")):
                stop.append((rel, "鍵の形をしたファイル"))

            if not fn.lower().endswith(TEXTISH):
                continue
            try:
                with open(full, "rb") as f:
                    blob = f.read(2_000_000)
            except OSError as e:
                stop.append((rel, "読めなかった: %s" % e))
                continue
            text = blob.decode("utf-8", "replace")

            for m in VALUE_ASSIGN.finditer(text):
                if not looks_allowed(m.group(1)):
                    stop.append((rel, "鍵に値が直に書いてある(%d文字)" % len(m.group(1))))
            for rx, what in VALUE_SHAPES:
                if rx.search(text):
                    stop.append((rel, "%sの形をした文字列がある" % what))
            for name in SECRET_NAMES:
                if name in text:
                    note.append((rel, name))
    return stop, note


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else "_public"
    if not os.path.isdir(root):
        print("公開する束が見つかりません: %s" % root)
        return 2
    n = sum(len(fs) for _, _, fs in os.walk(root))
    stop, note = scan(root)
    print("公開直前の検査: %s (%d ファイル)" % (root, n))
    print("")

    if note:
        files = sorted({r for r, _ in note})
        print("  控え: 鍵の「名前」が出てくるファイル %d 件 (値ではない。止めない)" % len(files))
        for r in files[:20]:
            names = sorted({x for f, x in note if f == r})
            print("    %s  ← %s" % (r, "、".join(names)))
        if len(files) > 20:
            print("    ほか %d 件" % (len(files) - 20))
        print("")

    if not stop:
        print("  値と書類は、束に入っていません。公開してよい状態です。")
        return 0

    print("  出してはいけないものが %d 件、公開する束に入っています:" % len(stop))
    seen = set()
    for rel, why in stop:
        if (rel, why) in seen:
            continue
        seen.add((rel, why))
        print("    %s\n      %s" % (rel, why))
    print("")
    print("  公開を止めました。束から外すか、.gitignore と履歴を確かめてください。")
    return 1


if __name__ == "__main__":
    sys.exit(main())
