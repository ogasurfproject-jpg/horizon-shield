import os, json, re, urllib.request, datetime, time

TOPICS = [
    'シロアリ駆除の見積もり20万円は高い? 薬剤の原価から逆算する',
    '床下換気扇30万円の見積もり。本当に必要な工事か、効果はあるのか',
    '基礎補強で75万円。アラミド繊維の材料費が10万円台という事実',
    '床下調湿剤30万円の正体。ゼオライトは1坪2千円、なぜ見積もりは膨らむ',
    'リフォーム見積もりが高いか分からないのは、日本に適正価格の物差しが無いから',
    '相見積もりを3社取っても比べられない。基準が無ければ全部高いこともある',
    '一式見積もりはなぜ危険か。内訳が消える瞬間に過剰請求が紛れる',
    '無料一括見積もりサイトの手数料は、最終的に誰が払っているのか',
    '訪問販売の床下工事で即決を迫られたら。クーリングオフと消費者ホットライン188',
    '外壁塗装シリコン30坪で150万円は適正か。坪単価で検算する',
    '屋根の葺き替え見積もりが高い? 材料と工程を分けて見る方法',
    '同じ工事でも見積もりは120万〜180万と割れる。妥当が90万なら全部高い',
    'キッチンリフォーム150万円の見積もり。本体価格と工事費を分けて検算する',
    'ユニットバス交換100万円は妥当か。商品代と施工費の内訳を開く',
    'トイレ交換20万円。便器代と工事費の相場を分けて見る',
    'クロス張り替えの単価。1平米いくらが適正か、数量の水増しを見抜く',
    'フローリング張り替えの見積もり。重ね張りと張り替えで費用がどう変わるか',
    '雨漏り修理の見積もりが高い。原因調査と補修を分けて考える',
    '屋根塗装と葺き替え、どちらを選ぶべきか。費用と寿命で判断する',
    '外壁塗装の足場代は適正か。面積と単価で足場費用を検算する',
    'シーリング打ち替えの費用。打ち増しとの違いと、見積もりの見方',
    '給湯器交換の見積もり。エコキュートとガス給湯器で費用がどう違うか',
    '内窓・二重窓の見積もり。断熱リフォームの補助金と実費を分けて考える',
    '解体工事の見積もりが高い。坪単価と廃材処分費の内訳を確認する',
    '外構工事の見積もり。ブロック塀とフェンスの単価を分けて見る',
    '地盤改良の見積もりは妥当か。工法ごとの費用相場を知る',
    '基礎のひび割れ補修。注入工法の費用と、過剰な提案の見分け方',
    'リフォームローンと現金、どちらが得か。金利と総支払額で比べる',
    '見積書の諸経費は何割が適正か。現場管理費の根拠を問う',
    '相見積もりを同じ条件に揃える、正規化のやり方',
    '値引きとダウングレードの違い。材料の型番が変わっていないか確認する',
    '無料点検商法の手口。不安をあおる営業の見抜き方',
    '火災保険でリフォームできるという勧誘。本当か、注意点は何か',
    'リフォーム瑕疵保険とは何か。入るべきかどうかの判断材料',
    '契約前に確認する見積書のチェックポイント',
    '工事中の追加費用はなぜ発生するか。事前に防ぐ方法',
    '近所と同じ工事なのに金額が違う理由。条件の差を読み解く',
    '建設費が上がり続ける理由。資材価格と人件費の動きを知る',
    'AIで見積もりを検証するとは何をするのか。人の目との違い',
    '見積もりの一式を、内訳に分けてもらう頼み方',
    '中古住宅を買ってリフォームする前に、相場を掴む方法',
    '店舗・テナントの内装工事。坪単価の相場と見積もりの注意点',
    '給排水管の交換工事。見えない部分の費用をどう確認するか',
    'バリアフリー改修の費用と、使える補助金の調べ方',
]

topic = os.environ.get('TOPIC', '').strip()
if not topic:
    _recent = set()
    try:
        with open('blog/index.json', encoding='utf-8') as _f:
            _recent = {_a.get('title', '') for _a in json.load(_f).get('articles', [])}
    except Exception:
        _recent = set()
    _pool = [t for t in TOPICS if t not in _recent]
    if not _pool:
        _pool = TOPICS
    topic = _pool[int(time.time() / 86400) % len(_pool)]

date_str = datetime.date.today().isoformat()
slug = 'article-' + date_str

api_key = os.environ['ANTHROPIC_API_KEY']
prompt = (
    '建設費診断の専門家として「' + topic + '」というテーマでブログ記事を書いてください。\n\n'
    '【厳守事項】\n'
    '- <h2>タグと<p>タグだけを使う\n'
    '- markdownは絶対に使わない（#、##、**、*は使わない）\n'
    '- HTMLタグ以外の記号は使わない\n'
    '- 800〜1200文字\n'
    '- 具体的な数字と事例を入れる\n'
    '- 最後のpタグに「見積書が気になる方はLINEで無料診断ができます」と書く\n\n'
    '出力例：\n'
    '<h2>見出しのテキスト</h2>\n'
    '<p>本文のテキスト</p>\n'
    '<h2>次の見出し</h2>\n'
    '<p>本文のテキスト</p>'
)

req_data = json.dumps({
    'model': 'claude-haiku-4-5-20251001',
    'max_tokens': 1500,
    'messages': [{'role': 'user', 'content': prompt}]
}).encode('utf-8')

req = urllib.request.Request(
    'https://api.anthropic.com/v1/messages',
    data=req_data,
    headers={'Content-Type': 'application/json', 'x-api-key': api_key, 'anthropic-version': '2023-06-01'}
)
with urllib.request.urlopen(req) as r:
    content = json.loads(r.read())['content'][0]['text']

# === [PATCH 2026-06-15] コードフェンス除去(```html / ``` の本番HTML生混入の根治) ===
# モデルが厳守事項に反してフェンスで囲って返すことがある。
# 単独行のフェンスを全除去し、先頭末尾のインラインフェンスも剥がす。
content = content.strip()
content = re.sub(r'^\s*```[A-Za-z0-9]*[ \t]*\r?\n', '', content)   # 先頭フェンス行
content = re.sub(r'\r?\n[ \t]*```[ \t]*\s*$', '', content)         # 末尾フェンス行
content = '\n'.join(
    line for line in content.splitlines()
    if not re.match(r'^\s*```[A-Za-z0-9]*\s*$', line)             # 残った単独フェンス行
)
content = content.strip()
# === [/PATCH 2026-06-15] ===

# === [PATCH 2026-06-18] タイトル/説明文の重複防止: 日付付与＋本文からdesc生成 ===
_pm = re.search(r'<p[^>]*>(.*?)</p>', content, re.S)
_intro = re.sub(r'<[^>]+>', '', _pm.group(1)) if _pm else ''
_intro = re.sub(r'\s+', '', _intro)
for _ch in (chr(0x2014), chr(0x2013), chr(0x2015)):
    _intro = _intro.replace(_ch, chr(0x3001))
_intro = _intro.replace(chr(0x0022), '')
if len(_intro) >= 40:
    meta_desc = _intro[:110]
    if not meta_desc.endswith(chr(0x3002)):
        meta_desc = meta_desc.rstrip(chr(0x3001)) + chr(0x3002)
else:
    meta_desc = topic + ' ' + date_str
title_unique = topic + chr(0x3010) + date_str + chr(0x3011) + ' | HORIZON SHIELD 建設費診断'
# === [/PATCH 2026-06-18] ===

os.makedirs('blog', exist_ok=True)

article_html = (
    '<!DOCTYPE html>\n'
    '<html lang="ja">\n'
    '<head>\n'
    '<meta charset="UTF-8">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
    '<meta name="description" content="' + meta_desc + '">\n'
    '<link rel="canonical" href="https://shield.the-horizons-innovation.com/blog/' + slug + '.html">\n'
    '<title>' + title_unique + '</title>\n'
    '<style>\n'
    'body{font-family:"Hiragino Sans",sans-serif;background:#0a0a0a;color:#e0e0e0;margin:0;padding:0}\n'
    '.container{max-width:800px;margin:0 auto;padding:40px 20px}\n'
    '.back{color:#f97316;text-decoration:none;font-size:14px}\n'
    'h1{font-size:28px;color:#fff;line-height:1.4;margin:20px 0}\n'
    '.date{color:#888;font-size:14px;margin-bottom:30px}\n'
    'h2{font-size:20px;color:#f97316;border-left:4px solid #f97316;padding-left:12px;margin:32px 0 16px}\n'
    'p{line-height:1.8;margin-bottom:20px;color:#ccc}\n'
    '.cta{background:#1a1a1a;border:1px solid #f97316;border-radius:12px;padding:30px;margin:40px 0;text-align:center}\n'
    '.cta-title{color:#f97316;font-weight:bold;font-size:18px;margin-bottom:16px}\n'
    '.cta a{display:inline-block;background:#06c755;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:16px;font-weight:bold}\n'
    'footer{text-align:center;padding:40px 0;color:#555;font-size:12px;border-top:1px solid #222;margin-top:60px}\n'
    'footer a{color:#f97316;text-decoration:none}\n'
    '</style>\n'
    '</head>\n'
    '<body>\n'
    '<div class="container">\n'
    '<a class="back" href="https://shield.the-horizons-innovation.com">← HORIZON SHIELDトップへ</a>\n'
    '<h1>' + topic + '</h1>\n'
    '<div class="date">' + date_str + ' | 建設費診断専門家 大賀俊勝</div>\n'
    '<article>\n'
    + content +
    '\n</article>\n'
    '<div class="cta">\n'
    '<p class="cta-title">あなたの見積書、無料で診断します</p>\n'
    '<a href="https://line.me/R/ti/p/@172piime">LINEで無料相談する</a>\n'
    '</div>\n'
    '<footer>\n'
    '<a href="https://shield.the-horizons-innovation.com">HORIZON SHIELD</a> | \n'
    '<a href="https://shield.the-horizons-innovation.com/blog/">ブログ一覧</a><br><br>\n'
    '© 2026 The HORIZ音s株式会社\n'
    '</footer>\n'
    '</div>\n'
    '</body>\n'
    '</html>'
)

with open('blog/' + slug + '.html', 'w', encoding='utf-8') as f:
    f.write(article_html)

index_file = 'blog/index.json'
if os.path.exists(index_file):
    with open(index_file, encoding='utf-8') as f:
        index = json.load(f)
else:
    index = {'articles': []}

index['articles'] = [a for a in index['articles'] if a.get('slug') != slug]
index['articles'].insert(0, {'slug': slug, 'title': topic, 'date': date_str, 'url': '/blog/' + slug + '.html'})
index['articles'] = index['articles'][:30]

with open(index_file, 'w', encoding='utf-8') as f:
    json.dump(index, f, ensure_ascii=False, indent=2)

items = ''.join([
    '<li><a href="https://shield.the-horizons-innovation.com' + a['url'] + '">' + a['title'] + '</a>'
    '<span style="color:#666;font-size:13px"> ' + a['date'] + '</span></li>'
    for a in index['articles']
])

blog_index = (
    '<!DOCTYPE html>\n'
    '<html lang="ja">\n'
    '<head>\n'
    '<meta charset="UTF-8">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
    '<title>建設費・リフォーム情報ブログ | HORIZON SHIELD</title>\n'
    '<style>\n'
    'body{font-family:"Hiragino Sans",sans-serif;background:#0a0a0a;color:#e0e0e0;margin:0;padding:0}\n'
    '.container{max-width:800px;margin:0 auto;padding:40px 20px}\n'
    'h1{font-size:24px;color:#fff;margin-bottom:8px}\n'
    '.subtitle{color:#888;margin-bottom:40px}\n'
    'ul{list-style:none;padding:0}\n'
    'li{border-bottom:1px solid #222;padding:20px 0}\n'
    'a.article{color:#e0e0e0;text-decoration:none;font-size:16px;font-weight:bold;display:block;margin-bottom:4px}\n'
    'a.article:hover{color:#f97316}\n'
    'a.back{color:#f97316;text-decoration:none;font-size:14px;display:block;margin-bottom:30px}\n'
    '</style>\n'
    '</head>\n'
    '<body>\n'
    '<div class="container">\n'
    '<a class="back" href="https://shield.the-horizons-innovation.com">← トップへ戻る</a>\n'
    '<h1>建設費・リフォーム情報ブログ</h1>\n'
    '<p class="subtitle">建設費診断の専門家が、見積もりの適正価格や悪徳業者の手口を解説します</p>\n'
    '<ul>' + items + '</ul>\n'
    '</div>\n'
    '</body>\n'
    '</html>'
)

with open('blog/index.html', 'w', encoding='utf-8') as f:
    f.write(blog_index)

print('SUCCESS: ' + slug + ' - ' + topic)
