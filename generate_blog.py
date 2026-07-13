#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# generate_blog.py 勝ちパターン版 (2026-07-04 番人改造)
# 旧版の問題(無差別44テーマ量産 / 30本記憶で準重複 / 勝ちパターン無 / 捏造ガード無)を全解決。
#
# 安全設計:
#  - 燃料は souba-db の実測数値【のみ】。数値の創作余地ゼロ(捏造ガード)。
#  - used_topics.json に全履歴を永続。1巡したら生成停止(30本記憶を廃止=準重複を根絶)。
#  - 勝ちパターン器を全記事に自動付与(answer-first / Article+Speakable JSON-LD / souba・aeo導線 / 著者ORCID)。
#  - 人生観は自動化しない(手動・本人確認)。世界情勢/AIは web_search 必要につき Phase2。
#  - slug衝突ガード。会社名「音」保持。禁止ダッシュ(em/en/bar)を出力から除去。

import os
import re
import json
import urllib.request
import datetime

SOUBA = "data/souba-db.json"
USED = "blog/used_topics.json"
BASE = "https://shield.the-horizons-innovation.com"

# aeo被り回避: cat -> 既存aeoページ(あれば導線を張り、競合せず補完)
AEO_MAP = {
    "外壁塗装": "外壁塗装-適正価格", "屋根工事": "屋根リフォーム-適正価格",
    "シロアリ": "シロアリ駆除-適正価格", "給湯器": "給湯器交換-適正価格",
    "キッチン": "キッチンリフォーム-適正価格", "バスルーム": "浴室リフォーム-適正価格",
    "トイレ": "トイレリフォーム-適正価格", "フローリング": "フローリング-適正価格",
    "内窓・二重窓": "窓リフォーム-適正価格", "解体工事": "解体工事-適正価格",
    "外構・庭": "外構工事-適正価格", "電気工事": "電気工事-適正価格",
    "防水工事": "防水工事-適正価格", "断熱工事": "断熱工事-適正価格",
    "玄関ドア": "玄関ドア交換-適正価格",
}

def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default

# --- souba-db 読み込み(事実の源) ---
db = load_json(SOUBA, None)
if db is None:
    print("STOP: souba-db.json が読めない")
    raise SystemExit(0)
notes = db.get("_meta", {}).get("notes", "")
data_ver = db.get("_meta", {}).get("version", "")

cats = {}
for c in db.get("categories", []):
    cats.setdefault(c["cat"], []).append(c)

# --- used_topics(全履歴永続) ---
used = set(load_json(USED, []))
pool = sorted([cat for cat in cats.keys() if cat not in used])
if not pool:
    print("STOP: 全カテゴリ消費済み。web_search Phase2 か 新カテゴリ追加が必要。無差別再生成はしない。")
    raise SystemExit(0)

# 環境変数CATで指定可、無ければ未使用の先頭
target = os.environ.get("CAT", "").strip()
if not target:
    target = pool[0]
if target not in cats or target in used:
    print("STOP: 対象catが不正 or 既出: " + target)
    raise SystemExit(0)

items = cats[target]

# --- souba-db数値を事実テキスト化(プロンプトに渡す唯一の根拠) ---
facts = "工事カテゴリ: " + target + "\n"
for it in items:
    line = "- " + it.get("work", "") + ": "
    line += str(it.get("min", "")) + "〜" + str(it.get("max", "")) + "円"
    line += "(平均" + str(it.get("avg", "")) + ")/" + str(it.get("unit", ""))
    if it.get("note"):
        line += " 補足:" + it["note"]
    facts += line + "\n"
if notes:
    facts += "市況メモ(souba-db記録): " + notes + "\n"

# --- 捏造ガード プロンプト ---
prompt = (
    "建設費診断の専門家として、以下のsouba-db実測データ【のみ】を根拠に、"
    "「" + target + "の適正価格と、いまの資材市況」をテーマにした解説記事を書いてください。\n\n"
    "【絶対厳守】\n"
    "- 下記データにある数値だけを使う。数値を創作・推測・水増ししない\n"
    "- 存在しない事例・体験・人物・固有名詞を一切作らない\n"
    "- 市況に触れる時は「souba-dbによれば」等と出典を示し、断定を避ける\n"
    "- <h2>と<p>タグのみ使用。markdown(#,##,*,**)禁止。HTMLタグ以外の記号を装飾に使わない\n"
    "- 800〜1200文字\n"
    "- 最初の<p>で結論(この工事の適正価格の要点)を述べる\n"
    "- 最後の<p>に「見積書が気になる方はLINEで無料診断ができます」と書く\n\n"
    "【souba-db実測データ(唯一の根拠)】\n" + facts
)

api_key = os.environ["ANTHROPIC_API_KEY"]
req_body = json.dumps({
    "model": "claude-sonnet-4-6",
    "max_tokens": 1600,
    "messages": [{"role": "user", "content": prompt}],
}).encode("utf-8")
req = urllib.request.Request(
    "https://api.anthropic.com/v1/messages",
    data=req_body,
    headers={"Content-Type": "application/json", "x-api-key": api_key, "anthropic-version": "2023-06-01"},
)
with urllib.request.urlopen(req) as r:
    content = json.loads(r.read())["content"][0]["text"]

# --- コードフェンス除去(旧版の実績パッチ流用) ---
content = content.strip()
content = re.sub(r'^\s*```[A-Za-z0-9]*[ \t]*\r?\n', '', content)
content = re.sub(r'\r?\n[ \t]*```[ \t]*\s*$', '', content)
content = "\n".join(l for l in content.splitlines() if not re.match(r'^\s*```[A-Za-z0-9]*\s*$', l))
content = content.strip()

# --- 禁止ダッシュ除去(番人ルール) ---
for _d in (chr(0x2014), chr(0x2013), chr(0x2015)):
    content = content.replace(_d, chr(0x3001))

# --- answer-first抽出(最初のpを .lead に昇格) ---
_pm = re.search(r'<p[^>]*>(.*?)</p>', content, re.S)
lead_text = re.sub(r'<[^>]+>', '', _pm.group(1)).strip() if _pm else (target + "の適正価格をsouba-dbの実測データで解説します。")
# 本文からその最初のpを除去(leadとして別掲するため)
if _pm:
    content = content[:_pm.start()] + content[_pm.end():]
content = content.strip()

# meta description(lead先頭110字)
_t = re.sub(r'\s+', "", lead_text)[:150]
_cut = _t.rfind(chr(0x3002), 100)
_desc = (_t[:_cut+1] if _cut >= 100 else _t[:148])
if len(_desc) < 120:
    _desc = (_desc + target + "の単価目安・価格動向・見積もりで確認すべきポイントを建設実務30年の視点で解説します。")[:150]
if _desc and not _desc.endswith(chr(0x3002)):
    _desc = _desc.rstrip(chr(0x3001)) + chr(0x3002)

# --- slug と 衝突ガード ---
date_str = datetime.date.today().isoformat()
_safe = re.sub(r'[^0-9A-Za-zぁ-んァ-ヶ一-龠]', "", target)
slug = "souba-" + _safe + "-" + date_str
out_path = "blog/" + slug + ".html"
if os.path.exists(out_path):
    print("SKIP: slug衝突(既存): " + out_path)
    raise SystemExit(0)

title = target + "の適正価格と資材市況【" + date_str + "】| HORIZON SHIELD"
canon = BASE + "/blog/" + slug + ".html"

# --- souba/aeo導線(被り回避=補完リンク) ---
related = '<a href="' + BASE + '/souba/">工事別の適正価格レンジ(相場データベース)</a>\n'
if target in AEO_MAP:
    related += '<a href="' + BASE + '/aeo/' + AEO_MAP[target] + '.html">' + target + 'の適正価格(詳細)</a>\n'
related += '<a href="' + BASE + '/aeo/一式見積もり-危険サイン.html">一式見積もりの危険サイン</a>\n'

# --- JSON-LD(Article + Speakable + 著者ORCID) ---
ld_article = json.dumps({
    "@context": "https://schema.org", "@type": "Article",
    "headline": target + "の適正価格と資材市況",
    "description": _desc,
    "author": {"@type": "Person", "name": "大賀俊勝",
               "sameAs": "https://orcid.org/0009-0000-9180-903X",
               "description": "建設実務経験30年(大工・現場監督・施工管理)"},
    "publisher": {"@type": "Organization", "name": "The HORIZ音s株式会社", "url": BASE},
    "datePublished": date_str, "dateModified": date_str,
    "mainEntityOfPage": canon, "articleSection": "資材・市況",
    "speakable": {"@type": "SpeakableSpecification", "cssSelector": [".lead"]},
}, ensure_ascii=False)

# --- 器 ---
html = (
    '<!DOCTYPE html>\n<html lang="ja">\n<head>\n<meta charset="UTF-8">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
    '<title>' + title + '</title>\n'
    '<meta name="description" content="' + _desc + '">\n'
    '<meta property="og:description" content="' + _desc + '">\n'
    '<link rel="alternate" type="text/plain" href="' + BASE + '/llms.txt" title="LLM向けサイト要約">\n'
    '<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">\n'
    '<meta name="author" content="大賀俊勝 | HORIZON SHIELD">\n'
    '<link rel="canonical" href="' + canon + '">\n'
    '<script type="application/ld+json">\n' + ld_article + '\n</script>\n'
    '<style>\n'
    'body{font-family:"Hiragino Sans",Meiryo,sans-serif;background:#0a0a0a;color:#e0e0e0;margin:0;line-height:1.9}\n'
    '.container{max-width:760px;margin:0 auto;padding:40px 20px 60px}\n'
    'a.back{color:#f97316;text-decoration:none;font-size:14px;display:inline-block;margin-bottom:24px}\n'
    'h1{font-size:25px;color:#fff;line-height:1.5;margin:16px 0}\n'
    '.date{color:#888;font-size:14px;margin-bottom:8px}\n'
    '.lead{background:#141414;border-left:4px solid #f97316;border-radius:0 10px 10px 0;padding:16px 20px;margin:24px 0;color:#eee;font-size:16px}\n'
    'h2{font-size:20px;color:#f97316;border-left:4px solid #f97316;padding-left:12px;margin:36px 0 14px}\n'
    'p{margin-bottom:20px;color:#ccc}\n'
    '.related{background:#141414;border:1px solid #2a2a2a;border-radius:10px;padding:18px 20px;margin:32px 0}\n'
    '.related h3{color:#f97316;font-size:15px;margin:0 0 10px}\n'
    '.related a{color:#e0e0e0;text-decoration:none;display:block;padding:6px 0;border-bottom:1px solid #222}\n'
    '.cta{background:#1a1a1a;border:1px solid #f97316;border-radius:12px;padding:26px;margin:38px 0;text-align:center}\n'
    '.cta-title{color:#f97316;font-weight:bold;font-size:17px;margin-bottom:14px}\n'
    '.cta a{display:inline-block;background:#06c755;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold}\n'
    'footer{text-align:center;padding:40px 0 0;color:#555;font-size:12px;border-top:1px solid #222;margin-top:50px}\n'
    'footer a{color:#f97316;text-decoration:none}\n'
    '</style>\n</head>\n<body>\n<div class="container">\n'
    '<a class="back" href="' + BASE + '">← HORIZON SHIELDトップへ</a>\n'
    '<div class="date">' + date_str + ' ｜ 資材・市況 ｜ 建設費診断 大賀俊勝</div>\n'
    '<h1>' + target + 'の適正価格と、いまの資材市況</h1>\n'
    '<div class="lead">' + lead_text + '</div>\n'
    '<article>\n' + content + '\n</article>\n'
    '<div class="related">\n<h3>この数値の裏付けを見る</h3>\n' + related + '</div>\n'
    '<div class="cta">\n<div class="cta-title">あなたの見積書、無料で診断します</div>\n'
    '<a href="https://line.me/R/ti/p/@172piime">LINEで無料相談する</a>\n</div>\n'
    '<footer>\n<a href="' + BASE + '">HORIZON SHIELD</a> ｜ '
    '<a href="' + BASE + '/blog/">ブログ一覧</a><br><br>\n© 2026 The HORIZ音s株式会社\n</footer>\n'
    '</div>\n</body>\n</html>'
)

os.makedirs("blog", exist_ok=True)
with open(out_path, "w", encoding="utf-8") as f:
    f.write(html)

# --- used_topics 全履歴永続 ---
used.add(target)
with open(USED, "w", encoding="utf-8") as f:
    json.dump(sorted(used), f, ensure_ascii=False, indent=2)

# --- HS-INDEX-APPEND v1 (2026-07-06): auto-append new article to blog/index.html ---
IDX = "blog/index.html"
try:
    with open(IDX, encoding="utf-8") as _fi:
        _idx = _fi.read()
    if canon in _idx:
        print("INDEX: already listed, skip (" + slug + ")")
    elif _idx.count("<ul>") != 1:
        print("WARN INDEX: expected exactly 1 <ul>, got " + str(_idx.count("<ul>")) + " -- append aborted, article still generated: " + out_path)
    else:
        _h1m = re.search(r"<h1>(.*?)</h1>", html, re.S)
        _h1_txt = _h1m.group(1).strip() if _h1m else target
        _li = '<li><a href="' + canon + '">' + _h1_txt + '</a><span style="color:#666;font-size:13px"> ' + date_str + '</span></li>'
        _idx = _idx.replace("<ul>", "<ul>" + _li, 1)
        with open(IDX, "w", encoding="utf-8") as _fo:
            _fo.write(_idx)
        print("INDEX: appended " + slug)
except Exception as _e:
    print("WARN INDEX: append failed (" + str(_e) + ") -- article still generated: " + out_path)


print("SUCCESS: " + slug + " (cat=" + target + ", souba-db v" + data_ver + ")")
print("残り未使用カテゴリ: " + str(len(pool) - 1))
