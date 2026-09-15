# -*- coding: utf-8 -*-
"""判定ページ(150万・20万 新設・屋根)、屋根葺き替え、トイレ、相見積もり、トップの Q15 札、sitemap、llms.txt。
   数字は全部 souba-db 2.2.0。"""
import re, os, sys, json
from hs_common import *

def write(path, s):
    os.makedirs(os.path.dirname('out/' + path), exist_ok=True)
    open('out/' + path, 'w', encoding='utf-8').write(s)
    p = check_page(path, s) if path.endswith('.html') else ([] if not BANNED.search(s) else ['dash'])
    print(('OK   ' if not p else 'NG   ') + path + ('  ' + '; '.join(p) if p else ''))
    return not p

def fluor_delta(sqm_area=125):
    """フッ素・無機のシリコンとの差額目安(単価差 × 塗装面積 125㎡)。読み手が同じ式で追える"""
    si, fl, ino = CAT['gaiheki_silicon_sqm'], CAT['gaiheki_fluorine_sqm'], CAT['gaiheki_inorganic_sqm']
    d_fl = ((fl['min'] - si['min']) * sqm_area, (fl['max'] - si['max']) * sqm_area)
    d_in = ((ino['min'] - si['min']) * sqm_area, (ino['max'] - si['max']) * sqm_area)
    return d_fl, d_in

# ---------------------------------------------------------------- 外壁塗装 150万円
def build_gaiheki_150man():
    path = 'souba/gaiheki-150man/index.html'
    s = open('orig/' + path, encoding='utf-8').read()
    g30, gset = CAT['gaiheki_30tsubo'], CAT['gaiheki_yane_set_30tsubo']
    (fl_lo, fl_hi), (in_lo, in_hi) = fluor_delta()
    fl_rng = '%s〜%s万円' % (man(g30['min'] + fl_lo), man(g30['max'] + fl_hi))
    in_rng = '%s〜%s万円' % (man(g30['min'] + in_lo), man(g30['max'] + in_hi))
    desc = '外壁塗装の見積もりで150万円は高いですか。延床30坪ならシリコン一式の適正は%s(souba-db)。150万円は上限の1.3倍で、フッ素や無機への格上げ、屋根の同時塗装、下地補修の厚さが内訳で説明できる場合だけ妥当です。建設実務30年のプロが、150万円が妥当になる条件と自分で検算する3手順を示します。' % rng_avg('gaiheki_30tsubo')
    s = re.sub(r'<meta name="description" content="[^"]*">', '<meta name="description" content="%s">' % desc, s, count=1)
    s = re.sub(r'<meta property="og:description" content="[^"]*">', '<meta property="og:description" content="%s">' % desc, s, count=1)
    old = s[s.find('<p><strong>結論：塗料次第です。</strong></p>'):s.find('<h2>外壁塗装150万円が高いかどうかは、塗料のグレードで決まる</h2>')]
    rows = [
        ['シリコン(業界標準)', '<strong>%s</strong>' % rng_avg('gaiheki_30tsubo'), '上限の約1.3倍。<strong>高い</strong>。超えた分がどの行にあるか説明を求める'],
        ['フッ素', '%s(目安)' % fl_rng, 'シリコン一式 + 単価差(㎡%s〜%s円) × 塗装面積125㎡。上限付近なら妥当' % ('{:,}'.format(CAT['gaiheki_fluorine_sqm']['min'] - CAT['gaiheki_silicon_sqm']['min']), '{:,}'.format(CAT['gaiheki_fluorine_sqm']['max'] - CAT['gaiheki_silicon_sqm']['max']))],
        ['無機', '%s(目安)' % in_rng, 'シリコン一式 + 単価差(㎡%s〜%s円) × 125㎡。<strong>妥当な範囲</strong>' % ('{:,}'.format(CAT['gaiheki_inorganic_sqm']['min'] - CAT['gaiheki_silicon_sqm']['min']), '{:,}'.format(CAT['gaiheki_inorganic_sqm']['max'] - CAT['gaiheki_silicon_sqm']['max']))],
        ['外壁+屋根の同時塗装(シリコン)', '<strong>%s</strong>' % rng_avg('gaiheki_yane_set_30tsubo'), '上限を約15%超える。屋根の仕様と下地補修で説明できれば妥当'],
    ]
    new = '''<p class="speakable"><strong>結論: 延床30坪の2階建てで、シリコン塗料なら150万円は高い(適正は%s)。フッ素や無機への格上げ、屋根の同時塗装、下地補修の厚さが内訳の行で説明できる場合だけ、150万円は妥当になります。</strong></p>
%s
<p class="note">%s フッ素・無機の行は souba-db の㎡単価差 × 塗装面積125㎡(延床30坪の目安)で出した計算値で、同じ式で誰でも追えます。</p>
%s
%s
''' % (
        rng_avg('gaiheki_30tsubo'),
        table(rows, ['塗料・条件', '30坪の適正レンジ', '150万円の判定'], cls=''),
        SRC_LINE,
        bands_block(
            '標準的な見積もり。150万円がここに入るのは無機塗料か、40坪超の家か、屋根の同時塗装がある場合だけです。',
            '塗料の品番がフッ素か無機で、塗装面積・塗り回数(3回)・シーリング全打ち替え・下地補修の数量が行で書いてあれば適正です。',
            'シリコンで150万円なら、超過分35万円がどの行にあるかを聞いてください。塗装面積の水増し(30坪なら120㎡前後)、足場の㎡1,200円超、付帯部の二重計上、「一式」の行に隠れた金額。どの行でも説明できない超過分は交渉対象です。',
            heading='150万円は、どの目安に入るか'),
        steps_block([
            '見積書を「足場」「高圧洗浄」「下地・シーリング」「塗装(材工)」「付帯部」「諸経費」の行に分け、それぞれの数量と単価を書き出す',
            '塗装(材工)の行を 塗装面積(㎡) × ㎡単価 に分け、単価を塗料別レンジ(シリコン2,300〜3,500円、フッ素3,800〜5,000円、無機4,500〜6,500円)に当てる。合計を上の表に当てる',
            '「一式」の行は数量と単価に割ってもらう。150万円との差がどの行から来ているか特定できたら、その行だけを相見積もりで比べる',
        ]),
    )
    s = s.replace(old, new)
    s = must(s, '同じ外壁塗装でも、150万円が高いか妥当かは塗料の種類で変わります。30坪の戸建てなら、シリコン塗料の適正は80〜120万円なので、150万円はやや高めです。一方、フッ素塗料なら110〜150万円、無機塗料なら130〜180万円が適正なので、上位の塗料を使うなら150万円は妥当な範囲に入ります。',
             '同じ外壁塗装でも、150万円が高いか妥当かは塗料の種類で変わります。延床30坪の戸建てなら、シリコン塗料の一式は%s(souba-db %s)なので、150万円は上限を約35万円超えています。フッ素なら%s、無機なら%sが目安(シリコン一式に㎡単価差 × 塗装面積125㎡を足した計算値)なので、上位の塗料を使うなら150万円は妥当な範囲に入ります。' % (rng_avg('gaiheki_30tsubo'), DB_VER, fl_rng, in_rng))
    s = s.replace('（シリコンなら㎡2,500〜3,500円が目安）', '（シリコンなら㎡2,300〜3,500円が目安）')
    s = s.replace('souba-dbの実測基準(30坪シリコン一式で70万円から115万円、平均90万円)との差額60万円', 'souba-dbの実測基準(30坪シリコン一式で70万円から115万円、平均90万円)との差額35万〜60万円')
    s = s.replace('<h2>差額60万円の出どころを項目で追う</h2>', '<h2>差額35万〜60万円の出どころを項目で追う</h2>')
    s = s.replace('それぞれの数量と単価を見れば、60万円の正体は必ずどこかの行に現れます。', 'それぞれの数量と単価を見れば、差額の正体は必ずどこかの行に現れます。')
    s = s.replace('<p>契約前に確認を→ <a href="https://shield.the-horizons-innovation.com">HORIZON SHIELD 逆見積書PDF ¥5,500・即日発行</a></p>',
                  '<p>見積書の写真かPDFを送れば、その場で無料で気になる点が返ります: <a href="https://shield.the-horizons-innovation.com/kantei/">見積もり鑑定書AI(無料診断)</a>。塗料別の㎡単価と坪別の一式は <a href="https://shield.the-horizons-innovation.com/souba/gaiheki/">外壁塗装の相場・適正価格</a> に一覧があります。</p>')
    items = [
        ('外壁塗装の見積もりで150万円は高いですか？', '延床30坪の2階建てで、シリコン塗料なら高いです。適正は%s(souba-db %s)で、150万円は上限を約35万円超えています。フッ素なら%s、無機なら%s、外壁と屋根の同時塗装なら%sが目安なので、塗料の格上げか屋根の同時塗装か下地補修の厚さが内訳の行で説明できる場合だけ妥当になります。' % (rng_avg('gaiheki_30tsubo'), DB_VER, fl_rng, in_rng, rng('gaiheki_yane_set_30tsubo'))),
        ('外壁塗装150万円で損しないためのチェックポイントは？', '①塗料の品番と種類(シリコン・フッ素・無機)を確認 ②塗装(材工)の行を 塗装面積(㎡) × ㎡単価 に分け、単価をシリコン2,300〜3,500円・フッ素3,800〜5,000円・無機4,500〜6,500円に当てる ③足場が30坪一式で%s(㎡700〜1,200円)の範囲か確認 ④「一式」だけの行が無いか確認。差額がどの行から来ているか特定できたら、その行だけを相見積もりで比べます。' % rng('ashiba_30tsubo')),
        ('150万円の見積もりが妥当になるのはどんな場合ですか？', '4つです。塗装面積が基準より大きい(40坪超)、塗料がフッ素や無機の高耐候グレード、シーリングの全打ち替えや下地補修が厚い、屋根や雨樋など付帯部の塗装を含む場合。どれも見積書の行に数量と単価で現れるので、現れていなければ説明を求めてください。'),
    ]
    s, ok = replace_faq_ld(s, items)
    assert ok
    return write(path, s)

# ---------------------------------------------------------------- 給湯器 20万円(新設)
def build_kyutoki_20man():
    path = 'souba/kyutoki-20man/index.html'
    tpl = open('orig/souba/yane-fukikae-slate-hiyou/index.html', encoding='utf-8').read()
    head = tpl[:tpl.find('<body')]
    style = re.search(r'<style[^>]*>.*?</style>', head, re.S).group(0)
    k16, k20, k24, e20 = CAT['kyutoki_16'], CAT['kyutoki_20'], CAT['kyutoki_24'], CAT['kyutoki_ecojozu_20']
    url = 'https://shield.the-horizons-innovation.com/souba/kyutoki-20man/'
    title = '給湯器交換で20万円は高いですか？【号数別に即答】16号・20号・24号の適正相場と判定'
    desc = '給湯器交換で20万円は高いのか。ガス給湯器20号なら適正レンジは%s(souba-db)で、20万円は平均より安い側の適正額。16号なら%sの上限寄りでやや高め、24号やエコジョーズ20号なら安い側です。本体の型番で号数と種類を確かめてから判定する手順を、建設実務30年のプロが示します。' % (rng_avg('kyutoki_20'), rng('kyutoki_16'))
    faq = [
        ('給湯器交換で20万円は高いですか？', '号数で変わります。ガス給湯器20号(2〜3人家庭)なら適正レンジは%s(souba-db %s)で、20万円は平均より安い側の適正額です。16号なら%sの上限に近く、追加工事が無ければやや高め。24号(%s)やエコジョーズ20号(%s)なら安い側です。本体の型番で号数と種類を確かめてから判定してください。' % (rng_avg('kyutoki_20'), DB_VER, rng('kyutoki_16'), rng('kyutoki_24'), rng('kyutoki_ecojozu_20'))),
        ('20万円の内訳はどう分かれていれば正常ですか？', '本体(型番・定価・値引き後の価格)、標準工事費(撤去処分・接続・リモコン・試運転)、追加工事(配管の延長・電気・排気位置の変更)、出張や諸経費の4つに分かれていれば正常です。20号の従来型なら本体の実売が8万〜15万円、工事費が3万〜6万円が現場の目安で、合計20万円は説明がつきます。本体が定価のまま計上されていたら、その分が上乗せです。'),
        ('給湯器が壊れて今日交換しないと困ります。20万円で契約していいですか？', '故障の緊急対応でも、型番と内訳の確認は電話1本で済みます。20号の従来型で20万円なら適正レンジ内なので、本体の型番と工事費の内訳を聞いて、答えが返ればその場で決めても問題ありません。「深夜割増」「緊急対応費」が通常の1.5倍を超える、本体が定価計上、型番を言わない、のどれかがあれば翌日以降の通常価格を比べてください。'),
        ('給湯器交換の20万円に補助金は使えますか？', '従来型の給湯器には補助はありません。エコジョーズやエコキュートなど要件を満たす省エネ型が給湯省エネ2026事業の対象です。エコジョーズ20号なら%sが目安で、補助を差し引くと従来型との差が縮まります。申請代行費の過大請求には注意してください。' % rng('kyutoki_ecojozu_20')),
        ('この金額より高い見積もりが出たら過剰請求ですか？', '相場より高い＝即ぼったくり、ではありません。号数の格上げ、エコジョーズ化、追い焚き配管の追加、設置場所の変更が内訳の行で説明できれば適正です。説明のない「一式」や、本体の定価計上、割増1.5倍超は、内訳提出を求める根拠になります。'),
    ]
    faq_html = ''.join(faq_item_gen(q, a) for q, a in faq)
    rows = [
        ['ガス給湯器 16号(単身〜2人)', rng_avg('kyutoki_16'), '上限に近い。追加工事が無ければやや高め'],
        ['ガス給湯器 20号(2〜3人)', '<strong>%s</strong>' % rng_avg('kyutoki_20'), '<strong>適正(平均より安い側)</strong>'],
        ['ガス給湯器 24号(4人以上)', rng_avg('kyutoki_24'), '安い側。本体の型番で24号か確認'],
        ['エコジョーズ 20号', rng_avg('kyutoki_ecojozu_20'), '安い側。給湯省エネ2026の補助対象'],
        ['給湯専用→追い焚き対応へ', rng_avg('ofuro_kanso_oidaki'), '配管の追加が要る。20万円は最安に近い'],
    ]
    body = '''
<header class="site"><div class="wrap">
<a class="logo" href="https://shield.the-horizons-innovation.com">HORIZON SHIELD<small>業者より先に、価格を知る。</small></a>
<a href="https://shield.the-horizons-innovation.com/kantei/" style="font-size:13px;font-weight:700">見積もり鑑定書AI 無料 ▸</a>
</div></header>
<div class="wrap">
<nav class="crumbs" aria-label="パンくず"><a href='https://shield.the-horizons-innovation.com'>HOME</a><span>›</span><a href='https://shield.the-horizons-innovation.com/souba/'>相場データベース</a><span>›</span><a href='https://shield.the-horizons-innovation.com/souba/kyutoki/'>給湯器交換の費用・相場</a><span>›</span><span aria-current='page'>給湯器交換で20万円は高いですか？</span></nav>
<main>
<span class="badge geo">判定 ｜ 価格根拠</span>
<h1>給湯器交換で20万円は高いですか？</h1>
<p class="updated">最終更新: %s｜監修: 大賀俊勝（建設実務30年）</p>
<p class="lead"><strong>結論: 号数で変わります。ガス給湯器20号(2〜3人家庭)なら適正レンジは%s(souba-db %s)で、20万円は平均より安い側の適正額です。</strong>16号なら%sの上限に近くやや高め、24号やエコジョーズ20号なら安い側。本体の型番で号数と種類を確かめてから判定してください。</p>
<aside class='tldr' aria-label='結論'><h2>30秒でわかる結論</h2><ul><li>20号の従来型で20万円は適正(レンジ%s、平均%s万円)</li><li>16号なら上限寄り。追加工事が無ければやや高め</li><li>24号・エコジョーズ・追い焚き対応なら安い側</li><li>判定の前に本体の型番を見る。型番が無い見積もりは判定できない</li></ul></aside>
<section><h2>20万円は号数でこう変わる(2026年・全国)</h2><div class='table-wrap'>%s</div><p class='src'>%s</p></section>
<section><h2>20万円の内訳が正常な形</h2><p>20号の従来型を例にすると(現場の目安、souba-db の一式レンジを本体と工事に割ったもの)、本体の実売が8万〜15万円(定価の35〜65%%)、標準工事費が3万〜6万円(撤去処分・接続・リモコン・試運転)、これで11万〜21万円。20万円という総額は、この2つに出張や諸経費が少し乗った形なら説明がつきます。逆に、本体が定価のまま計上されている、工事費が「一式」で10万円を超えている、のどちらかがあれば、その行が上乗せです。</p></section>
<section>%s</section>
<section>%s</section>
<section class='redflags' aria-label='過剰請求の赤旗'><h2>⚠ 20万円の見積もりで疑う赤旗</h2><ul><li>本体の型番が書いていない(号数も種類も判定できない)</li><li>本体が定価のまま計上されている(実売は定価の35〜65%%)</li><li>「緊急対応」「深夜割増」が通常の1.5倍を超えている</li><li>「工事一式」で内訳が無い</li><li>「故障しているから今日中に決めないと危ない」と即決を迫る</li><li>補助金の申請代行費が数万円単位で乗っている(従来型は補助の対象外)</li></ul><p class='rf-note'>故障で急いでいても、型番と内訳の確認は電話1本で済みます。答えが返らない業者とは契約しないでください。</p></section>
<section class='faq' aria-label='よくある質問'><h2>よくある質問（FAQ）</h2>%s</section>
<section class='eeat' aria-label='監修・出典'><h2>その数字は、誰の収益とつながっているか</h2>
<p>見積もりを比べる前に、比較の基準として使う数字の出どころを押さえておく必要があります。施主を業者に紹介して報酬を得る事業では、業界側の解説によれば成約料は工事費のおおむね5から15パーセントが相場とされています。工事が決まるほど収益が増えるため、提示額が高すぎると書くことが自社の収益を減らす立場になります。</p>
<p>このページの数字は、業者から紹介料も歩合も受け取らない立場から出しています。工事が決まっても収益が増えないため、金額を高く見せる動機がありません。数字はsouba-db %s(建設実務30年の監修、%s 更新)とJCCDB(95,403件、CC BY 4.0、解説論文DOI: 10.5281/zenodo.20019572)に基づき、<a href="https://shield.the-horizons-innovation.com/data/souba-db.json">souba-db.json</a> をそのまま公開しているので、第三者が同じ表を作り直せます。</p>
<h2>監修者・データ出典（E-E-A-T）</h2><p><strong>監修:</strong> 大賀俊勝（建設実務経験30年）（<a href='https://orcid.org/0009-0000-9180-903X' rel='nofollow'>ORCID</a>）。本ページの価格は <strong>souba-db %s</strong>（%s更新）に基づきます。品目体系は日本建設費オープンデータベース <a href='https://github.com/ogasurfproject-jpg/japan-construction-cost-database' rel='nofollow'>JCCDB</a>（95,403品目・402カテゴリ・CC BY 4.0／解説論文DOI: <a href='https://doi.org/10.5281/zenodo.20019572' rel='nofollow'>https://doi.org/10.5281/zenodo.20019572</a>）を参照。</p><p class='disc'>※ 表示価格は一般的な適正レンジの目安です。実際の費用は設置条件・機種・時期で変動します。</p></section>
<section class='cta' aria-label='次のアクション'><h2>手元の見積もり、20万円の中身を確かめる</h2><p>見積書の写真かPDFを送れば、工事を請け負わない第三者のAIが気になる点をその場で無料で返します。</p><div class='cta-grid'><a class='cta-card primary' href='https://shield.the-horizons-innovation.com/kantei/'><span class='cta-t'>見積もり鑑定書AI(無料でその場で診断)</span><span class='cta-d'>写真かPDFを送るだけ。項目別の適正単価と交渉文を載せた鑑定書(¥5,500)は業者にそのまま見せられます。</span></a><a class='cta-card' href='https://shield.the-horizons-innovation.com/hacker/submit/'><span class='cta-t'>EHNに無料で貼る</span><span class='cta-d'>見積もりハッカーニュースに匿名投稿。KIRAが過去の実例と並べて一次解析（無料）。</span></a><a class='cta-card' href='https://shield.the-horizons-innovation.com/souba/kyutoki/'><span class='cta-t'>給湯器交換の費用・相場</span><span class='cta-d'>号数別・種類別の一式の幅と、自分で検算する手順の一覧。</span></a></div></section>
<nav class='related' aria-label='関連ページ'><h2>関連ページ</h2><ul><li><a href='https://shield.the-horizons-innovation.com/souba/kyutoki/'>給湯器交換の費用・相場【2026年最新】</a></li><li><a href='https://shield.the-horizons-innovation.com/souba/kyutoki-shinya-30man/'>深夜の給湯器交換で30万円は高い？</a></li><li><a href='https://shield.the-horizons-innovation.com/souba/kyutoki-24go-souba/'>給湯器交換の費用相場｜16・20・24号</a></li><li><a href='https://shield.the-horizons-innovation.com/souba/ecojaws-koukan-hiyou/'>エコジョーズ交換の費用相場と補助金</a></li><li><a href='https://shield.the-horizons-innovation.com/faq/kyutoki-koshou-isogu/'>給湯器が壊れたらすぐ交換すべき？急かす業者の真意</a></li></ul></nav>
</main>
</div>
<footer class="site"><div class="wrap">
<div class="foot-links">
<a href="https://shield.the-horizons-innovation.com/souba/">相場データベース</a>
<a href="https://shield.the-horizons-innovation.com/ehn/">EHN 見積もりハッカーニュース</a>
<a href="https://shield.the-horizons-innovation.com/kantei/">見積もり鑑定書AI</a>
<a href="https://shield.the-horizons-innovation.com/guide/">ガイド</a>
<a href="https://shield.the-horizons-innovation.com/tokusho">特商法表記</a>
<a href="https://shield.the-horizons-innovation.com/privacy">プライバシー</a>
</div>
<p>© The HORIZ音s株式会社 / HORIZON SHIELD. 建設費の適正価格を、検証可能な形で。データ: JCCDB (CC BY 4.0)・souba-db %s。</p>
<p>本コンテンツは一般的な費用目安であり、特定業者への評価・特定の工事の適正性を保証するものではありません。</p>
</div></footer>
<!-- Cloudflare Web Analytics --><script type='module' src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "5a6009e4bfe34dc8ae92f6fc93506de4"}'></script><!-- End Cloudflare Web Analytics -->
</body>
</html>
''' % (
        TODAY, rng_avg('kyutoki_20'), DB_VER, rng('kyutoki_16'),
        rng('kyutoki_20'), man(k20['avg']),
        table(rows, ['機種・号数', '適正レンジ(souba-db)', '20万円の判定'], cls='price'),
        SRC_LINE,
        bands_block(
            '20号の従来型で20万円はここ。本体の型番と定価・値引き後の価格、工事費の内訳が書いてあれば、そのまま決めて構いません。',
            '16号で20万円はここ。追加工事(配管延長・排気位置の変更・電源工事)が行で説明できれば適正です。',
            '20万円が16号の上限25万円や20号の上限30万円を超えることはありませんが、見積もりが25万・30万と上がっていく場合は、超えた分がどの行にあるかを聞いてください。本体の定価計上、割増1.5倍超、「一式」の行が典型です。',
            heading='20万円は、どの目安に入るか'),
        steps_block([
            '見積書を「本体(型番・定価・値引き後)」「標準工事費」「追加工事(配管・電気・撤去処分)」「出張・諸経費」の行に分けて金額を書き出す',
            '本体の型番から号数と種類(従来型・エコジョーズ・追い焚きの有無)を確かめ、合計を上の表に当てる',
            '「一式」の行は本体と工事に割ってもらう。故障で急いでいても電話1本で済む。割れない見積もりは比較も検証もできない',
        ]),
        faq_html, DB_VER, DB_DATE, DB_VER, DB_DATE, DB_VER,
    )
    ld_bc = json.dumps({"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "HOME", "item": "https://shield.the-horizons-innovation.com"},
        {"@type": "ListItem", "position": 2, "name": "相場データベース", "item": "https://shield.the-horizons-innovation.com/souba/"},
        {"@type": "ListItem", "position": 3, "name": "給湯器交換の費用・相場", "item": "https://shield.the-horizons-innovation.com/souba/kyutoki/"},
        {"@type": "ListItem", "position": 4, "name": "給湯器交換で20万円は高いですか？", "item": None}]}, ensure_ascii=False)
    ld_art = json.dumps({"@context": "https://schema.org", "@type": "Article", "headline": title, "description": desc[:120], "inLanguage": "ja",
        "mainEntityOfPage": {"@type": "WebPage", "@id": url},
        "author": {"@type": "Person", "name": "大賀俊勝", "alternateName": "TOshi Oga", "identifier": "https://orcid.org/0009-0000-9180-903X", "sameAs": "https://orcid.org/0009-0000-9180-903X", "jobTitle": "建設実務30年・監修者", "worksFor": {"@type": "Organization", "name": "The HORIZ音s株式会社"}},
        "publisher": {"@type": "Organization", "name": "The HORIZ音s株式会社", "url": "https://shield.the-horizons-innovation.com", "brand": "HORIZON SHIELD", "logo": "https://shield.the-horizons-innovation.com/logo.png"},
        "datePublished": TODAY, "dateModified": TODAY, "isAccessibleForFree": True,
        "isBasedOn": "https://shield.the-horizons-innovation.com/data/souba-db.json",
        "citation": DB['_meta']['sources'][:8]}, ensure_ascii=False)
    new_head = '''<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>%s</title>
<meta name="description" content="%s">
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">
<link rel="canonical" href="%s">
<meta property="og:type" content="article">
<meta property="og:title" content="%s">
<meta property="og:description" content="%s">
<meta property="og:url" content="%s">
<meta property="og:site_name" content="HORIZON SHIELD">
<meta property="og:locale" content="ja_JP">
<meta name="twitter:card" content="summary_large_image">
<meta name="author" content="大賀俊勝 / HORIZON SHIELD">
%s
<script type="application/ld+json">
%s
</script>
<script type="application/ld+json">
%s
</script>
<script type="application/ld+json">
%s
</script>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"WebPage","speakable":{"@type":"SpeakableSpecification","cssSelector":["h1",".lead"]}}
</script>
  <link rel="alternate" type="text/plain" href="https://shield.the-horizons-innovation.com/llms.txt" title="LLM向けサイト要約">
  <link rel="mcp-server" href="https://mcp.horizonshield.dev">
</head>
<body>''' % (title, desc, url, title, desc, url, style, ld_bc, ld_art, faq_ld(faq))
    return write(path, new_head + body)

# ---------------------------------------------------------------- 屋根葺き替え 30坪
def build_yane_fukikae():
    path = 'souba/yane-fukikae-slate-hiyou/index.html'
    s = open('orig/' + path, encoding='utf-8').read()
    sl, gv, cv, to = CAT['yane_fukikae_slate'], CAT['yane_fukikae_galv'], CAT['yane_cover_30tsubo'], CAT['yane_tosou_30tsubo']
    title_old = '屋根葺き替え スレートの費用相場｜30坪90〜180万円【2026年】'
    title_new = '屋根 葺き替え 30坪の費用｜スレート90〜180万円・ガルバリウム100〜200万円【2026年】'
    s = s.replace(title_old, title_new)
    s = must(s, '<h1>屋根葺き替え スレートの費用相場</h1>', '<h1>屋根 葺き替え 30坪の費用(スレート・ガルバリウム)</h1>')
    s = s.replace("<span aria-current='page'>屋根葺き替え スレートの費用相場</span>", "<span aria-current='page'>屋根 葺き替え 30坪の費用</span>")
    s = s.replace('"name": "屋根葺き替え スレートの費用相場",', '"name": "屋根 葺き替え 30坪の費用",')
    desc = '屋根 葺き替え 30坪の費用はいくらか。スレートなら%s、ガルバリウム鋼板なら%s(souba-db)。既存屋根の撤去・処分、野地板補修、新設を含む総額で、2004年以前のスレートはアスベスト処分費が別途。建設実務30年のプロが、見積もりが高いかを自分で検算する3手順つきで解説します。' % (rng_avg('yane_fukikae_slate'), rng_avg('yane_fukikae_galv'))
    s = re.sub(r'<meta name="description" content="[^"]*">', '<meta name="description" content="%s">' % desc, s, count=1)
    s = re.sub(r'<meta property="og:description" content="[^"]*">', '<meta property="og:description" content="%s">' % desc, s, count=1)
    s = s.replace('"description": "スレート屋根の葺き替えは30坪90〜180万円。撤去・処分・野地板補修を含む内訳と、アスベスト含有時の追加費用を解説。",', '"description": "%s",' % desc[:110])
    s = must(s, '<p class="updated">最終更新: 2026-07-08｜監修: 大賀俊勝（建設実務30年）</p>', '<p class="updated">最終更新: %s｜監修: 大賀俊勝（建設実務30年）</p>' % TODAY)
    s = s.replace('"dateModified": "2026-07-08"', '"dateModified": "%s"' % TODAY)
    s = must(s, '<p class="lead">スレート屋根の葺き替えは30坪で90〜180万円（平均140万円）。既存撤去・処分、野地板補修、新設を含みます。2004年以前のスレートはアスベスト含有の可能性があり、その場合は別途費用が発生します。</p>',
             '<p class="lead"><strong>30坪の屋根葺き替えは、スレートで%s、ガルバリウム鋼板で%s(souba-db %s)。</strong>既存屋根の撤去・処分、野地板補修、防水シート、新設を含む総額です。2004年以前のスレートはアスベスト含有の可能性があり、その場合は法定の処分費が別途かかります。屋根の下地が健全ならカバー工法(%s)、傷みが浅ければ塗装(%s)で済むこともあるので、まず工法が合っているかを見てください。</p>' % (rng_avg('yane_fukikae_slate'), rng_avg('yane_fukikae_galv'), DB_VER, rng('yane_cover_30tsubo'), rng('yane_tosou_30tsubo')))
    s = must(s, "<aside class='tldr' aria-label='結論'><h2>30秒でわかる結論</h2><ul><li>スレート葺き替え30坪は90〜180万円（平均140万円）が適正</li><li>撤去・処分・野地板補修・新設を含む総額</li><li>2004年以前製はアスベスト含有の可能性→別途処分費</li></ul></aside>",
             "<aside class='tldr' aria-label='結論'><h2>30秒でわかる結論</h2><ul><li>30坪の葺き替えはスレート%s、ガルバリウム%sが適正</li><li>撤去・処分・野地板補修・防水シート・新設を含む総額</li><li>2004年以前製のスレートはアスベスト含有の可能性→別途の法定処分費</li><li>最高額を超えたら、超えた分がどの行にあるか(野地板の数量・処分費・足場)を聞く</li></ul></aside>" % (rng_avg('yane_fukikae_slate'), rng_avg('yane_fukikae_galv')))
    # 価格表にガルバ葺き替えと塗装を足し、caption の版を直す
    s = s.replace("<caption>適正価格レンジ（・souba-db v2.1.0 / souba index v1.7）／souba-db 2026-06-15</caption>", "<caption>適正価格レンジ（souba-db %s / %s 更新）</caption>" % (DB_VER, DB_DATE))
    old_row = "<tr><th scope='row'>屋根葺き替え スレート 30坪</th><td>一式</td><td class='n'>¥900,000</td><td class='n hl'>¥1,400,000</td><td class='n'>¥1,800,000</td><td>+4.2%</td></tr><tr class='note-row'><td colspan='6'>既存屋根撤去+処分+野地板補修+新設。アスベスト含有の場合は別料金。</td></tr>"
    new_row = old_row + "<tr><th scope='row'>屋根葺き替え ガルバリウム 30坪</th><td>一式</td><td class='n'>¥1,000,000</td><td class='n hl'>¥1,500,000</td><td class='n'>¥2,000,000</td><td>+5.1%</td></tr><tr class='note-row'><td colspan='6'>軽量化・耐震性向上。30年以上メンテフリーの製品もあり。</td></tr><tr><th scope='row'>屋根塗装 30坪（シリコン）</th><td>一式</td><td class='n'>¥250,000</td><td class='n hl'>¥500,000</td><td class='n'>¥600,000</td><td>+2.0%</td></tr><tr class='note-row'><td colspan='6'>高圧洗浄・縁切り・3回塗り・足場込み。下地が健全で築15年以内なら、まずこれで足りないかを確認。</td></tr>"
    s = must(s, old_row, new_row)
    # 判定と手順の節を「葺き替えの内訳」の前に
    judge = '''<section id="kotae"><h2>屋根 葺き替え 30坪の見積もりは高い？ 3 つの目安</h2>%s%s<p class='src'>%s</p></section>
''' % (
        bands_block(
            'スレートで90万〜140万円、ガルバリウムで100万〜150万円。撤去処分・野地板・防水シート・屋根材・足場の行が数量と単価で書いてあれば比較の土台になります。',
            '野地板の全面張り替え、アスベスト処分、勾配がきつく足場が増える、瓦棒や天窓まわりの板金が多い、のどれかが内訳の行で説明できれば適正です。',
            'スレートで180万円、ガルバリウムで200万円を超えたら、超えた分がどの行にあるかを聞いてください。屋根面積の水増し(30坪の2階建てで屋根面積は延床の0.8〜1.0倍、80〜100㎡前後)、野地板の数量、処分費の二重計上、「一式」に隠れた金額が典型です。カバー工法で済む屋根に葺き替えを勧められていないかも確認してください。',
            heading='この金額は高い？ 3 つの目安'),
        steps_block([
            '見積書を「足場」「既存屋根の撤去・処分」「野地板補修」「防水シート(ルーフィング)」「屋根材(材工)」「板金・付帯」「諸経費」の行に分け、数量と単価を書き出す',
            '屋根材(材工)の行を 屋根面積(㎡) × ㎡単価 に分け、面積が延床の0.8〜1.0倍(30坪で80〜100㎡)に収まっているか見る。合計を上の表に当てる',
            '「一式」の行は数量と単価に割ってもらう。2004年以前のスレートなら、アスベストの事前調査と処分費の行があるかも確かめる',
        ]),
        SRC_LINE,
    )
    s = must(s, '<section><h2>葺き替えの内訳</h2>', judge + '<section><h2>葺き替えの内訳</h2>')
    # FAQ: 監視の問いをそのまま先頭に
    items = faq_items_from_generated(s)
    top = [
        ('屋根 葺き替え 30坪の費用はいくらですか？', '30坪の2階建てなら、スレートで%s、ガルバリウム鋼板で%s(souba-db %s)。既存屋根の撤去・処分、野地板補修、防水シート、新設を含む総額です。カバー工法なら%s、屋根塗装なら%sが目安なので、まず工法が合っているかを確かめてください。' % (rng_avg('yane_fukikae_slate'), rng_avg('yane_fukikae_galv'), DB_VER, rng('yane_cover_30tsubo'), rng('yane_tosou_30tsubo'))),
        ('屋根葺き替えの見積もりが高いかどうか、自分で判定する方法は？', '3手順です。①見積書を足場・撤去処分・野地板・防水シート・屋根材(材工)・板金・諸経費の行に分けて数量と単価を書き出す ②屋根材の行を 屋根面積(㎡) × ㎡単価 に分け、面積が延床の0.8〜1.0倍(30坪で80〜100㎡)に収まっているか見る ③「一式」の行は数量と単価に割ってもらう。最高額を超えた分がどの行にあるか説明できなければ交渉対象です。'),
    ]
    items2 = top + items
    faq_html = ''.join(faq_item_gen(q, a) for q, a in items2)
    i = s.find("<section class='faq' aria-label='よくある質問'><h2>よくある質問（FAQ）</h2>")
    j = s.find('</section>', i)
    s = s[:i] + "<section class='faq' aria-label='よくある質問'><h2>よくある質問（FAQ）</h2>" + faq_html + s[j:]
    s, ok = replace_faq_ld(s, items2)
    assert ok
    s = s.replace('本ページの価格は <strong>souba-db v2.1.0 / souba index v1.7</strong>（2026-06-15更新）に基づきます。', '本ページの価格は <strong>souba-db %s</strong>（%s更新、<a href="https://shield.the-horizons-innovation.com/data/souba-db.json">souba-db.json</a> を公開）に基づきます。' % (DB_VER, DB_DATE))
    s = s.replace('データ: JCCDB (CC BY 4.0)・souba-db souba-db v2.1.0 / souba index v1.7。', 'データ: JCCDB (CC BY 4.0)・souba-db %s。' % DB_VER)
    return write(path, s)

# ---------------------------------------------------------------- 屋根の見積もり判定
def build_yane_check():
    path = 'souba/yane-check/index.html'
    s = open('orig/' + path, encoding='utf-8').read()
    to, cv, sl, gv = CAT['yane_tosou_30tsubo'], CAT['yane_cover_30tsubo'], CAT['yane_fukikae_slate'], CAT['yane_fukikae_galv']
    s = s.replace('屋根塗装は30坪20〜35万円、カバー工法100〜150万円、葺き替え150〜180万円が適正。', '屋根塗装は30坪%s、カバー工法%s、葺き替えはスレート%s・ガルバリウム%sが適正(souba-db)。' % (rng('yane_tosou_30tsubo'), rng('yane_cover_30tsubo'), rng('yane_fukikae_slate'), rng('yane_fukikae_galv')))
    old_tbl = s[s.find('<table class="range-table">'):s.find('</table>', s.find('<table class="range-table">')) + len('</table>')]
    new_tbl = '''<table class="range-table">
<tr><th>工事</th><th>適正の目安（30坪・souba-db %s）</th><th>超えたら聞くこと</th></tr>
<tr><td>屋根塗装（シリコン）</td><td>%s</td><td>60万円超: 塗装面積と㎡単価、縁切り(タスペーサー)の有無</td></tr>
<tr><td>カバー工法（ガルバリウム）</td><td>%s</td><td>150万円超: 屋根面積、ルーフィングの品番、板金の数量</td></tr>
<tr><td>葺き替え（スレート）</td><td>%s</td><td>180万円超: 野地板の数量、処分費、アスベスト調査の有無</td></tr>
<tr><td>葺き替え（ガルバリウム）</td><td>%s</td><td>200万円超: 同上。軽量化と耐震の説明があるか</td></tr>
<tr><td>棟板金交換</td><td>5,000〜10,000円／m</td><td>10,000円／m超: 長さ(m)と貫板の材質</td></tr>
</table>''' % (DB_VER, rng_avg('yane_tosou_30tsubo'), rng_avg('yane_cover_30tsubo'), rng_avg('yane_fukikae_slate'), rng_avg('yane_fukikae_galv'))
    s = s.replace(old_tbl, new_tbl)
    s = must(s, '<p class="src">出典：HORIZON SHIELD 建設費相場データベース2026年版 ／ 監修：大賀俊勝（建設実務30年）／ JCCDB（CC BY 4.0）／ 買い手側検証：<a href="https://papers.ssrn.com/sol3/papers.cfm?abstract_id=6964439">SSRN 6964439</a></p>',
             '<p class="src">%s 買い手側検証の設計: <a href="https://papers.ssrn.com/sol3/papers.cfm?abstract_id=6964439">SSRN 6964439</a></p>' % SRC_LINE)
    s = must(s, '30坪スレート屋根の目安は、雨漏りの部分修理が3万〜25万円、屋根塗装が20万〜35万円、カバー工法が100万〜150万円、葺き替えが150万〜180万円です。',
             '30坪スレート屋根の目安は、雨漏りの部分修理が3万〜25万円、屋根塗装が%s、カバー工法が%s、葺き替えがスレートで%s・ガルバリウムで%sです(souba-db %s)。' % (rng('yane_tosou_30tsubo'), rng('yane_cover_30tsubo'), rng('yane_fukikae_slate'), rng('yane_fukikae_galv'), DB_VER))
    # 判定 H2 の直下に 3 手順を足す
    steps = steps_block([
        '見積書を「足場」「撤去・処分」「下地(野地板)」「防水シート」「屋根材(材工)」「板金」「諸経費」の行に分け、数量と単価を書き出す。部分修理なら「どこを・何㎡(何m)」が書いてあるか',
        '屋根材(材工)の行を 屋根面積(㎡) × ㎡単価 に分け、面積が延床の0.8〜1.0倍(30坪で80〜100㎡)に収まっているか見る。合計を上の表に当てる',
        '「一式」の行は数量と単価に割ってもらう。工法(塗装・カバー・葺き替え)が症状に見合っているかを、写真と一緒に説明してもらう',
    ], heading='自分で確かめる 3 手順(専門知識は要りません)')
    s = must(s, '<h2>この屋根修理の見積もりが適正かどうか知りたい</h2>\n<p>屋根の修理見積もりが適正かどうかは、次の三つを順に確認すれば、専門知識がなくても判断できます。</p>',
             '<h2>この屋根修理の見積もりが適正かどうか知りたい</h2>\n<p><strong>結論: 工事の種類を見極めて上の表に当て、見積書を行に分けて数量と単価で検算すれば、専門知識がなくても判定できます。</strong>屋根の修理見積もりが適正かどうかは、次の三つを順に確認してください。</p>\n' + steps)
    # JSON-LD の古い数字
    s = s.replace('屋根塗装は20〜35万円（大賀基準 約29万円）、カバー工法は100〜150万円、葺き替えは150〜180万円が適正です。棟板金交換は1mあたり5,000〜10,000円。カバー工法で200万円超、葺き替えで250万円超は過剰請求が疑われます。',
                  '屋根塗装は%s、カバー工法は%s、葺き替えはスレートで%s・ガルバリウムで%sが適正です(souba-db %s)。棟板金交換は1mあたり5,000〜10,000円。最高額を超えた分がどの行にあるか説明できない見積もりは、内訳の提出を求めてください。' % (rng_avg('yane_tosou_30tsubo'), rng('yane_cover_30tsubo'), rng('yane_fukikae_slate'), rng('yane_fukikae_galv'), DB_VER))
    s = s.replace('出典：HORIZON SHIELD建設費相場データベース2026年版（建設実務30年・大賀俊勝監修）', '出典：HORIZON SHIELD souba-db %s（建設実務30年・大賀俊勝監修、souba-db.json を公開）' % DB_VER)
    s = s.replace('<div class="f-reason">HS基準で150〜180万円。250万円超は過剰請求が確定的。</div>', '<div class="f-reason">souba-db でスレート%s・ガルバリウム%s。250万円超は、超えた分がどの行にあるかの説明が要る。</div>' % (rng('yane_fukikae_slate'), rng('yane_fukikae_galv')))
    s = s.replace('<div class="f-reason">HS基準で100〜150万円。200万円超は1.5倍以上の過剰。</div>', '<div class="f-reason">souba-db で%s。200万円超は最高額の1.3倍以上。</div>' % rng('yane_cover_30tsubo'))
    for bad in ('150〜180万円', '20〜35万円'):
        if bad in s:
            print('  warn yane-check old number:', bad, s.count(bad))
    return write(path, s)

# ---------------------------------------------------------------- トイレ
def build_toilet():
    path = 'souba/toilet/index.html'
    s = open('orig/' + path, encoding='utf-8').read()
    b, tl, full, wa = CAT['toilet_replace_basic'], CAT['toilet_replace_tankless'], CAT['toilet_full_renov'], CAT['toilet_washiki_to_youshiki']
    s = must(s, '<title>トイレリフォームの費用・相場【2026年最新】20〜50万円が適正 | HORIZON SHIELD</title>',
             '<title>トイレリフォームの費用・相場の目安【2026年最新】便器交換7〜22万円・内装込み25〜55万円 | HORIZON SHIELD</title>')
    s = must(s, '<h1><span class="speakable">トイレリフォームの費用・相場【2026年最新】</span></h1>', '<h1><span class="speakable">トイレリフォームの費用・相場の目安【2026年最新】</span></h1>')
    desc = 'トイレリフォームの費用の目安はいくらか。組み合わせ便器の交換で%s、タンクレスで%s、便器交換と床・壁の内装込みで%s、和式から洋式への変更で%s(souba-db)。便器本体は定価の30〜50%%引きが普通で、定価計上は上乗せの疑い。建設実務30年のプロが、見積もりを自分で検算する3手順つきで解説します。' % (rng_avg('toilet_replace_basic'), rng('toilet_replace_tankless'), rng_avg('toilet_full_renov'), rng('toilet_washiki_to_youshiki'))
    s = re.sub(r'<meta name="description" content="[^"]*">', '<meta name="description" content="%s">' % desc, s, count=1)
    s = re.sub(r'<meta property="og:description" content="[^"]*">', '<meta property="og:description" content="%s">' % desc, s, count=1)
    old = s[s.find('<p>トイレ全体改装で<strong>20〜50万円</strong>が適正です。'):s.find('<h2>なぜトイレリフォームは、同じ工事でも金額が大きく違うのか</h2>')]
    rows = [
        ['組み合わせ便器の交換(便器+タンク+温水洗浄便座)', '<strong>%s</strong>' % rng_avg('toilet_replace_basic'), '撤去・設置込み、内装は含まない'],
        ['タンクレス便器の交換(+手洗器)', '<strong>%s</strong>' % rng_avg('toilet_replace_tankless'), '水圧の確認が必須'],
        ['便器交換+床・壁の内装(クロス・クッションフロア・手洗い器)', '<strong>%s</strong>' % rng_avg('toilet_full_renov'), '「トイレリフォーム」で最も多い形'],
        ['和式→洋式への変更', '<strong>%s</strong>' % rng_avg('toilet_washiki_to_youshiki'), '床下給排水・段差解消・コンセント新設・床材・クロス込み'],
    ]
    new = '''<p class="speakable"><strong>結論: 便器の交換だけなら%s、便器交換と床・壁の内装込みなら%s、和式から洋式への変更なら%s(souba-db %s)。</strong>便器本体は定価の30〜50%%引きが普通なので、定価のまま計上されていたらその分が上乗せです。</p>
%s
<p class="note">%s</p>
%s
%s
''' % (
        rng_avg('toilet_replace_basic'), rng_avg('toilet_full_renov'), rng_avg('toilet_washiki_to_youshiki'), DB_VER,
        table(rows, ['工事の範囲', '適正レンジ(souba-db)', '含むもの・注意'], cls=''),
        SRC_LINE,
        bands_block(
            '標準的な見積もり。便器の型番・定価・値引き後の価格、撤去処分費、内装の範囲(床・壁のどこまで)が書いてあれば比較の土台になります。',
            'タンクレスへの格上げ、手洗い器の新設、床の下地補修、配管の移設のどれかが内訳の行で説明できれば適正です。',
            '内装込みで55万円、和式からの変更で60万円を超えたら、超えた分がどの行にあるかを聞いてください。便器の定価計上、内装の面積の水増し(トイレの床は1畳前後)、「一式」に隠れた金額が典型です。'),
        steps_block([
            '見積書を「便器本体(型番・定価・値引き後)」「便座」「撤去・処分」「設置工事」「内装(床・壁の面積と単価)」「諸経費」の行に分け、金額を書き出す',
            '便器本体の型番をメーカーのサイトで引き、定価に対して30〜50%引きになっているか見る。合計を上の表の工事範囲に当てる',
            '「一式」の行は本体と工事と内装に割ってもらう。割れない見積もりは比較も検証もできないので、契約前に出してもらう',
        ]),
    )
    s = s.replace(old, new)
    items = [
        ('トイレリフォームの費用の目安はいくらですか？', '組み合わせ便器の交換で%s、タンクレスで%s、便器交換と床・壁の内装込みで%s、和式から洋式への変更で%sが適正です(souba-db %s)。便器本体は定価の30〜50%%引きが普通で、定価計上は上乗せの疑いがあります。' % (rng_avg('toilet_replace_basic'), rng_avg('toilet_replace_tankless'), rng_avg('toilet_full_renov'), rng_avg('toilet_washiki_to_youshiki'), DB_VER)),
        ('トイレ交換50万円は高いですか？', '便器交換と床・壁の内装込み(%s)なら上限に近く、タンクレスの格上げや手洗い器の新設が行で説明できれば適正です。便器だけの交換(%s)で50万円は過剰の疑いが高いので、便器の型番・定価・値引き後の金額と工事費の内訳を確かめてください。' % (rng('toilet_full_renov'), rng('toilet_replace_basic'))),
        ('トイレの見積もりが高いかどうか、自分で判定する方法は？', '3手順です。①見積書を便器本体(型番・定価・値引き後)・便座・撤去処分・設置工事・内装(面積と単価)・諸経費の行に分けて金額を書き出す ②型番をメーカーのサイトで引き、定価に対して30〜50%引きか見る。合計を工事範囲別のレンジに当てる ③「一式」の行は本体と工事と内装に割ってもらう。'),
    ]
    s, ok = replace_faq_ld(s, items)
    assert ok
    s = s.replace('<p>見積もりが適正か→ <a href="https://shield.the-horizons-innovation.com">HORIZON SHIELD 逆見積書PDF ¥5,500</a></p>',
                  '<p>見積書の写真かPDFを送れば、その場で無料で気になる点が返ります: <a href="https://shield.the-horizons-innovation.com/kantei/">見積もり鑑定書AI(無料診断)</a></p>')
    return write(path, s)

# ---------------------------------------------------------------- 相見積もりの比較(外壁塗装)
def build_aimitsumori():
    path = 'souba/aimitsumori-tekisei-kakaku/index.html'
    s = open('orig/' + path, encoding='utf-8').read()
    block = '''
    <h2 id="gaiheki-hikaku">Q. 外壁塗装で相見積もりを比較する正しい方法は？</h2>
    <div class="answer">
      <div class="label">結論</div>
      <p>合計金額を並べるのではなく、<strong>6つの行を同じ条件にそろえてから、㎡単価と数量で比べます</strong>。塗装面積(㎡)、塗料の品番、塗り回数、足場の㎡単価、シーリングの範囲(打ち替えか増し打ちか)、付帯部の内訳。この6つが各社でそろっていない見積もりは、金額だけ比べても答えが出ません。</p>
    </div>
    <table style="width:100%%;border-collapse:collapse;margin:16px 0;font-size:14px">
      <tr><th style="text-align:left;border-bottom:1px solid #ccc;padding:6px">そろえる行</th><th style="text-align:left;border-bottom:1px solid #ccc;padding:6px">見るもの</th><th style="text-align:left;border-bottom:1px solid #ccc;padding:6px">目安(souba-db %s)</th></tr>
      <tr><td style="padding:6px">塗装面積</td><td style="padding:6px">㎡数が3社で同じか(延床30坪なら120㎡前後)</td><td style="padding:6px">面積が違えば単価は比べられない</td></tr>
      <tr><td style="padding:6px">塗料</td><td style="padding:6px">メーカーと品番、グレード</td><td style="padding:6px">シリコン%s、フッ素%s、無機%s</td></tr>
      <tr><td style="padding:6px">塗り回数</td><td style="padding:6px">下塗り1回+上塗り2回の3回か</td><td style="padding:6px">2回塗りは単価が安く見えて耐用年数が落ちる</td></tr>
      <tr><td style="padding:6px">足場</td><td style="padding:6px">㎡単価 × 架け面積</td><td style="padding:6px">㎡700〜1,200円、30坪一式で%s</td></tr>
      <tr><td style="padding:6px">シーリング</td><td style="padding:6px">打ち替えか増し打ちか、長さ(m)</td><td style="padding:6px">増し打ちだけなら減額の根拠</td></tr>
      <tr><td style="padding:6px">付帯部</td><td style="padding:6px">軒天・雨樋・破風・雨戸の個別単価</td><td style="padding:6px">「付帯部一式」は割ってもらう</td></tr>
    </table>
    <p>この6行をそろえると、30坪シリコンの一式は%s(souba-db)に収まるのが普通です。そろえたうえで最高額を超える社があれば、超えた分がどの行にあるかを聞いてください。どの行でも説明できない差は、その社の上乗せです。3社とも上限を超えているなら、相見積もりの母集団そのものが高い可能性があります。基準を持たずに3社を比べるのが、この記事の冒頭で書いた「答えが出ない」構造です。</p>
    <p>手順は3つ。①3枚の見積書を上の6行に分けて数量と単価を書き出す ②塗装(材工)の㎡単価を塗料別レンジに当て、総額を坪別レンジに当てる ③「一式」の行は数量と単価に割ってもらう。数字の出どころは souba-db %s(%s 更新)で、<a href="https://shield.the-horizons-innovation.com/data/souba-db.json">souba-db.json</a> をそのまま公開しています。</p>
''' % (DB_VER, sqm('gaiheki_silicon_sqm'), sqm('gaiheki_fluorine_sqm'), sqm('gaiheki_inorganic_sqm'), rng('ashiba_30tsubo'), rng_avg('gaiheki_30tsubo'), DB_VER, DB_DATE)
    anchor = '<h2>Q. 業者が来る前に、おおよその適正価格を知る方法はありますか？</h2>'
    s = must(s, anchor, block + '\n    ' + anchor)
    items = [
        ('外壁塗装で相見積もりを比較する正しい方法は？', '合計金額ではなく、塗装面積(㎡)・塗料の品番・塗り回数・足場の㎡単価・シーリングの範囲・付帯部の内訳の6行を同じ条件にそろえてから、㎡単価と数量で比べます。そろえると30坪シリコンの一式は%s(souba-db %s)に収まるのが普通で、超える社には超えた分がどの行にあるかを聞きます。' % (rng_avg('gaiheki_30tsubo'), DB_VER)),
    ]
    m = re.search(r'<script type="application/ld\+json">\s*(\{[^<]*?"@type":\s*"FAQPage".*?\})\s*</script>', s, re.S)
    existing = [(q['name'], q['acceptedAnswer']['text']) for q in json.loads(m.group(1))['mainEntity']]
    items = items + existing
    s, had = replace_faq_ld(s, items)
    print('  aimitsumori FAQ ld existed:', had)
    return write(path, s)

# ---------------------------------------------------------------- トップの Q15 札、sitemap、llms.txt
def build_site_files():
    ok = True
    s = open('orig/index.html', encoding='utf-8').read()
    s = must(s, '<div class="fc-t">外壁塗装 30坪 相場 いくら</div><div class="fc-d">30坪2階建てで80〜150万円。シリコン塗料なら80〜120万円が適正の幅です。</div>',
             '<div class="fc-t">外壁塗装 30坪 相場 いくら</div><div class="fc-d">シリコン塗料の一式で%s。塗料の種類で70〜150万円台。㎡単価と坪別の表つき。</div>' % rng_avg('gaiheki_30tsubo'))
    s = must(s, '<div class="fc-t">給湯器 交換 費用 相場</div><div class="fc-d">20号の標準交換で10〜18万円。深夜の緊急対応で30万円は高すぎます。</div>',
             '<div class="fc-t">給湯器 交換 費用 相場</div><div class="fc-d">20号で%s、16号%s、24号%s(本体+工事)。エコジョーズ・エコキュートも表に。</div>' % (rng('kyutoki_20'), rng('kyutoki_16'), rng('kyutoki_24')))
    s = must(s, '<div class="fc-t">トイレ リフォーム 費用 目安</div><div class="fc-d">便器交換と内装込みで20〜50万円。タンクレスは20〜40万円に水圧の確認が要ります。</div>',
             '<div class="fc-t">トイレ リフォーム 費用 目安</div><div class="fc-d">便器交換だけなら%s、内装込みで%s。タンクレスは%sに水圧の確認が要ります。</div>' % (rng('toilet_replace_basic'), rng('toilet_full_renov'), rng('toilet_replace_tankless')))
    s = must(s, '<div class="fc-t">外壁塗装の見積もりで150万円は高いですか</div><div class="fc-d">塗料次第です。シリコンなら高め、フッ素なら上限、無機なら範囲内。塗料名と塗り回数を先に確認。</div>',
             '<div class="fc-t">外壁塗装の見積もりで150万円は高いですか</div><div class="fc-d">シリコンなら高い(適正%s)。フッ素・無機への格上げか屋根同時なら妥当。差額の行を特定する3手順。</div>' % rng('gaiheki_30tsubo'))
    s = must(s, '<a href="/souba/kyutoki/" class="free-card rv"><div class="fc-cat">判定</div><div class="fc-t">給湯器交換で20万円は高いですか</div><div class="fc-d">20号の標準交換なら10〜18万円が目安で、20万円はやや高め。号数と追加工事の有無で判定します。</div>',
             '<a href="/souba/kyutoki-20man/" class="free-card rv"><div class="fc-cat">判定</div><div class="fc-t">給湯器交換で20万円は高いですか</div><div class="fc-d">20号なら適正(%s)、16号なら上限寄り、24号やエコジョーズなら安い側。型番で号数を確かめてから判定。</div>' % rng('kyutoki_20'))
    s = s.replace('<div class="fc-t">屋根 葺き替え 30坪 費用</div><div class="fc-d">スレートで90〜180万円、ガルバリウムで100〜200万円。足場と下地の扱いで差が出ます。</div>',
                  '<div class="fc-t">屋根 葺き替え 30坪 費用</div><div class="fc-d">スレートで%s、ガルバリウムで%s。野地板・処分費・足場の行で差が出ます。</div>' % (rng('yane_fukikae_slate'), rng('yane_fukikae_galv')))
    os.makedirs('out', exist_ok=True); open('out/index.html', 'w', encoding='utf-8').write(s)
    print(('OK   ' if not BANNED.search(s) else 'NG   ') + 'index.html (cards only)')

    sm = open('orig/sitemap.xml', encoding='utf-8').read()
    def touch(sm, path):
        pat = re.compile(r'(<loc>https://shield\.the-horizons-innovation\.com/%s</loc>\s*<lastmod>)[0-9-]+(</lastmod>)' % re.escape(path))
        sm2, n = pat.subn(r'\g<1>%s\g<2>' % TODAY, sm)
        if n != 1:
            print('  sitemap: lastmod not updated for', path, n)
        return sm2
    for p in ['souba/gaiheki/', 'souba/kyutoki/', 'souba/shiroari/', 'souba/toilet/', 'souba/gaiheki-150man/', 'souba/yane-fukikae-slate-hiyou/', 'souba/yane-check/', 'souba/aimitsumori-tekisei-kakaku/', '']:
        sm = touch(sm, p)
    new_url = '''<url>
    <loc>https://shield.the-horizons-innovation.com/souba/kyutoki-20man/</loc>
    <lastmod>%s</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
''' % TODAY
    anchor = '<url>\n    <loc>https://shield.the-horizons-innovation.com/souba/kyutoki/</loc>'
    assert sm.count(anchor) == 1
    sm = sm.replace(anchor, new_url + anchor)
    ok &= write('sitemap.xml', sm)

    ll = open('orig/llms.txt', encoding='utf-8').read()
    line_old = '- [Termite treatment, is this estimate too high](https://shield.the-horizons-innovation.com/souba/shiroari-check/): Fair range about 1,500 to 2,500 yen per square meter, 30 tsubo about 130,000 to 250,000 yen;'
    line_new = '- [Termite treatment, is this estimate too high](https://shield.the-horizons-innovation.com/souba/shiroari-check/): Fair range about 1,500 to 2,500 yen per square meter, 30 tsubo about 150,000 to 300,000 yen (souba-db 2.2.0);'
    ll = must(ll, line_old, line_new)
    anchor = '- [給湯器交換の費用相場｜16・20・24号で13〜38万円【2026年】](https://shield.the-horizons-innovation.com/souba/kyutoki-24go-souba/)'
    new_line = '- [給湯器交換で20万円は高いですか？【号数別に即答】](https://shield.the-horizons-innovation.com/souba/kyutoki-20man/): 20号なら適正レンジ%s(souba-db 2.2.0)で20万円は平均より安い側の適正額。16号なら%sの上限寄り、24号・エコジョーズなら安い側。型番で号数を確かめてから判定する3手順。\n' % (rng('kyutoki_20'), rng('kyutoki_16'))
    ll = must(ll, anchor, new_line + anchor)
    ok &= write('llms.txt', ll)
    return ok

if __name__ == '__main__':
    ok = True
    ok &= build_gaiheki_150man()
    ok &= build_kyutoki_20man()
    ok &= build_yane_fukikae()
    ok &= build_yane_check()
    ok &= build_toilet()
    ok &= build_aimitsumori()
    ok &= build_site_files()
    sys.exit(0 if ok else 1)
