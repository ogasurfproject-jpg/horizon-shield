import os, json, datetime, urllib.request, base64

HATENA_ID = os.environ['HATENA_ID']
HATENA_API_KEY = os.environ['HATENA_API_KEY']
HATENA_BLOG_ID = os.environ['HATENA_BLOG_ID']

date_str = datetime.date.today().isoformat()
slug = 'article-' + date_str

index_file = 'blog/index.json'
if not os.path.exists(index_file):
    print('No index.json found, skipping')
    exit(0)

with open(index_file, encoding='utf-8') as f:
    index = json.load(f)

articles = index.get('articles', [])
if not articles:
    print('No articles found, skipping')
    exit(0)

article = articles[0]
if article.get('slug') != slug:
    print(f'Today article not found (got {article.get("slug")}), skipping')
    exit(0)

# 重複チェック：既に今日の記事が投稿済みか確認
credentials = base64.b64encode(f'{HATENA_ID}:{HATENA_API_KEY}'.encode()).decode()
list_req = urllib.request.Request(
    f'https://blog.hatena.ne.jp/{HATENA_ID}/{HATENA_BLOG_ID}/atom/entry',
    headers={'Authorization': f'Basic {credentials}'},
    method='GET'
)
try:
    with urllib.request.urlopen(list_req) as r:
        feed_xml = r.read().decode('utf-8')
        if article['title'] in feed_xml:
            print(f'SKIP: Already posted today - {article["title"]}')
            exit(0)
except Exception as e:
    print(f'Warning: Could not check duplicates: {e}')

title = article['title']
title = article['title']
url = 'https://shield.the-horizons-innovation.com' + article['url']

html_file = 'blog/' + slug + '.html'
with open(html_file, encoding='utf-8') as f:
    content = f.read()

entry_xml = f'''<?xml version="1.0" encoding="utf-8"?>
<entry xmlns="http://www.w3.org/2005/Atom">
  <title>{title}</title>
  <content type="text/html"><![CDATA[
{content}
  ]]></content>
  <category term="建設費診断" />
  <app:control xmlns:app="http://www.w3.org/2007/app">
    <app:draft>no</app:draft>
  </app:control>
</entry>'''

endpoint = f'https://blog.hatena.ne.jp/{HATENA_ID}/{HATENA_BLOG_ID}/atom/entry'
credentials = base64.b64encode(f'{HATENA_ID}:{HATENA_API_KEY}'.encode()).decode()

req = urllib.request.Request(
    endpoint,
    data=entry_xml.encode('utf-8'),
    headers={
        'Content-Type': 'application/atom+xml',
        'Authorization': f'Basic {credentials}',
    },
    method='POST'
)

try:
    with urllib.request.urlopen(req) as r:
        print(f'SUCCESS: Posted to Hatena Blog - {title}')
        print(f'Status: {r.status}')
except urllib.error.HTTPError as e:
    print(f'ERROR: {e.code} {e.reason}')
    print(e.read().decode())
    exit(1)
