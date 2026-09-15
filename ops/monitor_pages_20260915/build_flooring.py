# -*- coding: utf-8 -*-
"""souba/flooring/ を souba-db 2.2.0 に揃え、j038「フローリング 張替え 見積もり 30万 妥当」の判定節を足す。
   perplexity の索引に載っとる数少ないサブページ(p026 で 4 位、j038 で 10 位に見えた)。"""
import re, os, sys, json
from hs_common import *

def write(path, s):
    os.makedirs(os.path.dirname('out/' + path), exist_ok=True)
    open('out/' + path, 'w', encoding='utf-8').write(s)
    p = check_page(path, s)
    print(('OK   ' if not p else 'NG   ') + path + ('  ' + '; '.join(p) if p else ''))
    return not p

def build():
    path = 'souba/flooring/index.html'
    s = open('orig/' + path, encoding='utf-8').read()
    sq, h6, k6, m6 = CAT['floor_harikae_sqm'], CAT['floor_harikae_6jo'], CAT['floor_kasanebari_6jo'], CAT['floor_mugen_6jo']
    full6 = CAT['toko_shuri_matsu']
    s = must(s, '<title>フローリング張替えの費用・相場【2026年最新】㎡6,000〜10,000円が適正 | HORIZON SHIELD</title>',
             '<title>フローリング張替えの費用・相場【2026年最新】6畳で%s・㎡%s | HORIZON SHIELD</title>' % (rng('floor_harikae_6jo'), sqm('floor_harikae_sqm').replace('円/㎡', '円')))
    desc = 'フローリング張替えの費用はいくらか。複合フローリングの張り替えは㎡%s、6畳(10㎡)で%s、重ね張りなら%s、無垢材なら%s(souba-db)。既存床の撤去と下地補修まで含む全面張替は%s。30万円の見積もりが妥当かを工法と面積で判定する3手順を、建設実務30年のプロが示します。' % (sqm('floor_harikae_sqm').replace('円/㎡', '円'), rng_avg('floor_harikae_6jo'), rng('floor_kasanebari_6jo'), rng('floor_mugen_6jo'), rng('toko_shuri_matsu'))
    s = re.sub(r'<meta name="description" content="[^"]*">', '<meta name="description" content="%s">' % desc, s, count=1)
    s = re.sub(r'<meta property="og:description" content="[^"]*">', '<meta property="og:description" content="%s">' % desc, s, count=1)
    old = s[s.find('<p>合板フローリングで<strong>㎡6,000〜10,000円</strong>'):s.find('<h2>なぜフローリング張替えは、同じ広さでも金額が違うのか</h2>')]
    rows = [
        ['複合(合板)フローリング 張り替え', sqm('floor_harikae_sqm'), '<strong>%s</strong>' % rng_avg('floor_harikae_6jo'), '既存撤去・下地調整・家具移動込み。1日工事'],
        ['重ね張り(既存床の上に新規)', '', '<strong>%s</strong>' % rng_avg('floor_kasanebari_6jo'), '廃材処分が減る。床が上がるので建具の調整に注意'],
        ['無垢フローリング 張り替え', '', '<strong>%s</strong>' % rng_avg('floor_mugen_6jo'), '材料が2倍前後。下地補修込み'],
        ['全面張替(既存撤去+根太・下地補修+床下対応)', '', '<strong>%s</strong>' % rng_avg('toko_shuri_matsu'), '床鳴りや沈みがある部屋。下地の傷みで幅が出る'],
    ]
    new = '''<p class="speakable"><strong>結論: 複合フローリングの張り替えは㎡%s、6畳(約10㎡)で%s(souba-db %s)。</strong>重ね張りなら%s、無垢材なら%s。床鳴りや沈みがあって根太や下地まで直す全面張替は%sになります。</p>
%s
<p class="note">%s</p>
<h2 id="30man">フローリング張替えの見積もりで30万円は妥当？</h2>
<p><strong>結論: 6畳の複合フローリングを張り替えるだけなら高い(適正は%s)。無垢材か、床下や根太の補修が入る全面張替なら妥当な範囲です。</strong>見積書の「工法」と「面積」と「下地補修の行」を見れば、どちらかはすぐ分かります。</p>
%s
%s
''' % (
        sqm('floor_harikae_sqm').replace('円/㎡', '円'), rng_avg('floor_harikae_6jo'), DB_VER, rng('floor_kasanebari_6jo'), rng('floor_mugen_6jo'), rng('toko_shuri_matsu'),
        table(rows, ['工法・材料', '㎡単価', '6畳の適正レンジ(souba-db)', '含むもの・注意'], cls=''),
        SRC_LINE,
        rng_avg('floor_harikae_6jo'),
        bands_block(
            '複合フローリングの張り替えで6畳9万〜14万円、重ね張りで8万〜13万円。材料の品番と㎡数、既存撤去と家具移動の有無が書いてあれば比較の土台になります。',
            '無垢材への格上げ、根太や下地合板の補修、巾木の交換、建具の調整のどれかが内訳の行で説明できれば適正です。30万円はここか次の帯です。',
            '複合の張り替えで20万円、無垢や全面張替で35万〜50万円を超えたら、超えた分がどの行にあるかを聞いてください。面積の水増し(6畳は約10㎡)、㎡単価の上乗せ(複合で㎡15,000円超)、「一式」に隠れた下地補修が典型です。',
            heading='30万円は、どの目安に入るか'),
        steps_block([
            '見積書を「既存床の撤去・処分」「下地補修(根太・合板)」「フローリング材(品番・㎡数・㎡単価)」「施工費」「巾木・建具調整」「家具移動・諸経費」の行に分け、数量と単価を書き出す',
            'フローリング材の行を 面積(㎡) × ㎡単価 に分け、単価を上の表に当てる。6畳は約10㎡、8畳は約13㎡、12畳は約20㎡',
            '「一式」の行は数量と単価に割ってもらう。工法(張り替えか重ね張りか)と、下地補修が要る理由(床鳴り・沈み・写真)を書面でもらう',
        ]),
    )
    s = s.replace(old, new)
    s = s.replace('<p>見積もりが適正か→ <a href="https://shield.the-horizons-innovation.com">HORIZON SHIELD 逆見積書PDF ¥5,500</a></p>',
                  '<p>見積書の写真かPDFを送れば、その場で無料で気になる点が返ります: <a href="https://shield.the-horizons-innovation.com/kantei/">見積もり鑑定書AI(無料診断)</a></p>')
    items = [
        ('フローリング張替えの費用はいくらですか？', '複合(合板)フローリングの張り替えは㎡%s、6畳(約10㎡)で%s。重ね張りなら%s、無垢材なら%s、既存撤去と根太・下地の補修まで含む全面張替は%sが適正です(souba-db %s)。' % (sqm('floor_harikae_sqm').replace('円/㎡', '円'), rng_avg('floor_harikae_6jo'), rng('floor_kasanebari_6jo'), rng('floor_mugen_6jo'), rng('toko_shuri_matsu'), DB_VER)),
        ('フローリング張替えの見積もりで30万円は妥当ですか？', '6畳の複合フローリングを張り替えるだけなら高いです(適正は%s)。無垢材(%s)か、床鳴りや沈みで根太や下地まで直す全面張替(%s)なら妥当な範囲です。見積書の工法・面積・下地補修の行を見て、どちらに当たるかを確かめてください。' % (rng('floor_harikae_6jo'), rng('floor_mugen_6jo'), rng('toko_shuri_matsu'))),
        ('フローリング張替え6畳で20万円は高いですか？', '複合フローリングなら適正レンジ%sの上限です。無垢材や下地補修が入っていれば適正の範囲。材料の品番と㎡単価(複合で%s)、下地補修の有無を確かめてください。' % (rng('floor_harikae_6jo'), sqm('floor_harikae_sqm'))),
        ('フローリングの見積もりが高いかどうか、自分で判定する方法は？', '3手順です。①見積書を既存撤去・下地補修・フローリング材(品番・㎡数・㎡単価)・施工費・巾木建具・家具移動の行に分けて数量と単価を書き出す ②材料の行を 面積(㎡) × ㎡単価 に分け、単価を工法別レンジに当てる(6畳は約10㎡) ③「一式」の行は割ってもらい、下地補修が要る理由を書面でもらう。'),
    ]
    s, ok = replace_faq_ld(s, items)
    assert ok
    for bad in ('6,000〜10,000円', '10〜20万円', '4,000〜8,000円'):
        if bad in s:
            print('  warn flooring old number:', bad, s.count(bad))
    return write(path, s)

if __name__ == '__main__':
    sys.exit(0 if build() else 1)
