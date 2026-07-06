import os, json, datetime, urllib.request, base64

HATENA_ID = os.environ['HATENA_ID']
HATENA_API_KEY = os.environ['HATENA_API_KEY']
HATENA_BLOG_ID = os.environ['HATENA_BLOG_ID']

date_str = datetime.date.today().isoformat()

# --- HS-HATENA-DISCOVER v1 (2026-07-06): slug-format-agnostic discovery ---
# old engine wrote article-<date>, new engine writes souba-<theme>-<date>.
# index.json is a fossil (zero consumers); discover today's article from blog/ directly.
import glob, re
candidates = sorted(glob.glob('blog/*-' + date_str + '.html'))
if not candidates:
    print('Today article not found (no blog/*-' + date_str + '.html), skipping')
    exit(0)
if len(candidates) > 1:
    candidates.sort(key=os.path.getmtime)
    print('NOTE: ' + str(len(candidates)) + ' articles for today, using latest: ' + candidates[-1])
html_file = candidates[-1]
slug = os.path.basename(html_file)[:-5]

with open(html_file, encoding='utf-8') as f:
    content = f.read()

_h1 = re.search(r'<h1>(.*?)</h1>', content, re.S)
if _h1:
    title = re.sub(r'<[^>]+>', '', _h1.group(1)).strip()
else:
    _t = re.search(r'<title>(.*?)</title>', content, re.S)
    title = _t.group(1).split('|')[0].strip() if _t else slug

url = 'https://shield.the-horizons-innovation.com/blog/' + slug + '.html'
print('FOUND: ' + html_file + ' | ' + title)

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
        if title in feed_xml:
            print('SKIP: Already posted today - ' + title)
            exit(0)
except Exception as e:
    print(f'Warning: Could not check duplicates: {e}')

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
