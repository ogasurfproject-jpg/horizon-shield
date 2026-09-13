#!/usr/bin/env python3
# sitemap.xml をコア allowlist だけに絞る。既定 dry-run。--apply で書き込み(必ず .bak)。
# noindex は当てへん(Bing の索引を殺さんため)。sitemap.xml から外すだけ。
# 外した生きページは 2 本の別 sitemap に移す(robots.txt には載せへん。Bing Webmaster に手で出す用):
#   sitemap-archive.xml : yakumo 以外の生きページ
#   sitemap-yakumo.xml  : /yakumo/ の生きページ(以後、ボット generate.py はこっちに追記する)
# noindex ページと、ファイルが無い(404)ページは、どの sitemap にも入れへん。
import re, sys, os, datetime, urllib.parse, collections
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SM=os.path.join(ROOT,'sitemap.xml'); CORE=os.path.join(ROOT,'ops','sitemap_core_20260913.txt')
ARCH=os.path.join(ROOT,'sitemap-archive.xml'); YAK=os.path.join(ROOT,'sitemap-yakumo.xml')
BASE='https://shield.the-horizons-innovation.com'
HEAD='<?xml version=\'1.0\' encoding=\'utf-8\'?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
apply='--apply' in sys.argv
allow=set(); globs=[]
for line in open(CORE,encoding='utf-8'):
    s=line.strip()
    if not s or s.startswith('#'): continue
    if s.startswith('@'): globs.append(s[1:].rstrip('*')); continue
    allow.add(s)
src=open(SM,encoding='utf-8').read()
blocks=re.findall(r'<url>.*?</url>',src,flags=re.S)
head=src[:src.find('<url>')]; tail=src[src.rfind('</url>')+len('</url>'):]

def state(path):
    # live / noindex / missing
    f=path.lstrip('/') or 'index.html'
    if f.endswith('/'): f+='index.html'
    f=os.path.join(ROOT,f)
    if not os.path.isfile(f): return 'missing'
    s=open(f,encoding='utf-8',errors='ignore').read(20000)
    m=re.search(r'name="robots"[^>]*content="([^"]*)"',s)
    if m and 'noindex' in m.group(1): return 'noindex'
    return 'live'

keep=[];drop=[]
for b in blocks:
    m=re.search(r'<loc>(.*?)</loc>',b); loc=m.group(1).strip() if m else ''
    path=urllib.parse.unquote(loc.replace(BASE,''))
    if path=='' : path='/'
    ok = path in allow or any(path.lstrip('/').startswith(g) for g in globs)
    (keep if ok else drop).append((path,b))
sec=lambda p:(p.strip('/').split('/')[0] or '(top)')
kc=collections.Counter(sec(p) for p,_ in keep); dc=collections.Counter(sec(p) for p,_ in drop)
print(f"sitemap.xml: {len(blocks)} -> keep {len(keep)} / remove {len(drop)}")
print("KEEP by section:", dict(kc.most_common()))
print("REMOVE by section:", dict(dc.most_common()))
missing=[a for a in allow if a not in {p for p,_ in keep}]
if missing: print("allowlist に無い(存在せず or sitemap未掲載):", missing)

arch=[];yak=[];gone=collections.Counter()
for p,b in drop:
    st=state(p)
    if st!='live': gone[st]+=1; continue
    (yak if p.startswith('/yakumo/') else arch).append((p,b))
print(f"sitemap-archive.xml(Bing用): {len(arch)} / sitemap-yakumo.xml(Bing用+ボット追記先): {len(yak)} / どこにも入れへん: {dict(gone)}")

with open(os.path.join(ROOT,'ops','sitemap_removed_20260913.txt'),'w',encoding='utf-8') as f:
    f.write('\n'.join(p for p,_ in drop)+'\n')
with open(os.path.join(ROOT,'ops','sitemap_kept_20260913.txt'),'w',encoding='utf-8') as f:
    f.write('\n'.join(p for p,_ in keep)+'\n')
if not apply:
    print("dry-run。書き込みは --apply。除外一覧 ops/sitemap_removed_20260913.txt / 残す一覧 ops/sitemap_kept_20260913.txt")
    sys.exit(0)

stamp=datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
def write_xml(dst, items, expect):
    if os.path.exists(dst):
        open(dst+f'.{stamp}.bak','w',encoding='utf-8').write(open(dst,encoding='utf-8').read())
    new=HEAD+'\n'.join(b for _,b in items)+'\n</urlset>\n'
    open(dst,'w',encoding='utf-8').write(new)
    chk=len(re.findall(r'<loc>',new)); assert chk==expect, f"{os.path.basename(dst)} count mismatch {chk}!={expect}"
    return chk

bak=SM+f'.{stamp}.bak'; open(bak,'w',encoding='utf-8').write(src)
new=head+'\n'.join(b for _,b in keep)+tail
open(SM,'w',encoding='utf-8').write(new)
chk=len(re.findall(r'<loc>',new)); assert chk==len(keep), f"sitemap.xml count mismatch {chk}!={len(keep)}"
a=write_xml(ARCH,arch,len(arch)); y=write_xml(YAK,yak,len(yak))
print(f"applied. backup={os.path.basename(bak)} sitemap.xml={chk} sitemap-archive.xml={a} sitemap-yakumo.xml={y}")
