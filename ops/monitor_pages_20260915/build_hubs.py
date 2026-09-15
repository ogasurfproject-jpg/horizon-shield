# -*- coding: utf-8 -*-
"""souba-v2 型の相場ハブ 3 本(gaiheki / kyutoki / shiroari)を、買い手の言葉で直答する形に直す。
   数字は souba-db 2.2.0 の正値に揃える。内部用語(souba-v2 JSON、red_flags、v2_to_v3_changes 等)を消す。"""
import re, os, sys, json
from hs_common import *

def write(path, s):
    os.makedirs(os.path.dirname('out/' + path), exist_ok=True)
    open('out/' + path, 'w', encoding='utf-8').write(s)
    p = check_page(path, s)
    print(('OK   ' if not p else 'NG   ') + path + ('  ' + '; '.join(p) if p else ''))
    return not p

def common_cleanup(s, red_title):
    s = must(s, '<p class="subtitle">建設実務30年のプロが監修。souba-v2 JSONの全国ベース知識（算出式・原価内訳・詐欺検知）を公開。</p>',
             '<p class="subtitle">%s</p>' % SUBTITLE[red_title])
    s = must(s, '<span class="badge">建設実務30年 監修 ｜ 2026年4月更新</span>', '<span class="badge">建設実務30年 監修 ｜ 2026年9月更新 ｜ souba-db %s</span>' % DB_VER)
    s = must(s, '<h2>HS基準の価格算出式（horizon_shield_standard）</h2>', '<h2>適正価格の考え方(算出式)</h2>')
    s = must(s, '<h2>詐欺・過剰請求の検知（red_flags）</h2>', '<h2>過剰請求を疑う赤旗(%sで多い手口)</h2>' % red_title)
    s = must(s, '<h2>交渉術（negotiation_tips）</h2>', '<h2>値引き交渉で使える根拠</h2>')
    s = must(s, '<h2>業者規模別の目安（business_size_based_pricing）</h2>', '<h2>業者の規模で変わる価格の目安</h2>')
    s = s.replace('<p>以下は souba-db の red_flags から抽出した、', '<p>以下は souba-db の赤旗一覧から抽出した、')
    s = s.replace('HS哲学：業者を敵視せず、規模と品質に対する妥当な利益率を透明化する。', '業者を敵視せず、規模と品質に対する妥当な利益率を透明化する立場です。')
    s = s.replace('<p><strong>知識ソース（knowledge_source）:</strong></p>', '<p><strong>知識ソース:</strong></p>')
    s = s.replace('<strong>TOshi注意:</strong> アリプロ等大手は大量仕入れで', '<strong>現場からの注意:</strong> 大手は大量仕入れで')
    s = s.replace('TOshi注意:', '現場からの注意:').replace('TOshi Rule', 'HS基準').replace('cost_breakdown_toshi_rule', '原価内訳')
    # 内部の変更履歴・哲学メモは消す(読み手は施主)
    s = re.sub(r'<li><strong>horizons_philosophy:</strong>.*?</li>', '', s, flags=re.S)
    s = re.sub(r'<li><strong>v2_to_v3_changes:</strong>.*?</li>', '', s, flags=re.S)
    s = re.sub(r'<li><strong>v3_to_v3_1_changes:</strong>.*?</li>', '', s, flags=re.S)
    s = re.sub(r'<li><strong>HS重要度[^<]*</strong>[^<]*</li>', '', s)
    # 算出式のパラメータ名を日本語に
    s = s.replace('<ul><li>material_markup_from_trade_price: 1.2</li><li>general_overhead_pct_ideal: 15</li><li>general_overhead_pct_acceptable_max: 20</li><li>tax_pct: 10</li><li>trade_price_ratio_from_list: 0.65</li></ul>',
                  '<ul><li>材料は仕入れ値の1.2倍まで(それ以上の上乗せは説明を求める)</li><li>一般管理費は原価の15%が目安、20%までが許容</li><li>消費税10%</li><li>塗料や機器の仕入れは定価の65%前後(定価計上は上乗せの疑い)</li></ul>')
    s = s.replace('<ul><li>material_markup_from_trade_price: 1.2</li><li>general_overhead_pct_ideal: 15</li><li>general_overhead_pct_acceptable_max: 20</li><li>tax_pct: 10</li></ul>',
                  '<ul><li>材料は仕入れ値の1.2倍まで(それ以上の上乗せは説明を求める)</li><li>一般管理費は原価の15%が目安、20%までが許容</li><li>消費税10%</li></ul>')
    s = s.replace('"dateModified":"2026-06-21"', '"dateModified":"%s"' % TODAY)
    # 「時事コスト要因」が内部の版履歴だけなら節ごと消す(競合名も混ざる)
    i = s.find('<div class="section">\n    <h2>2026年の時事コスト要因</h2>')
    if i >= 0:
        j = s.find('</div>', i) + len('</div>')
        block = s[i:j]
        if re.search(r'<li><strong>v1\.\d:</strong>', block) or '<ul></ul>' in block:
            s = s[:i] + s[j:]
    # 業者規模の表が空の参照だけなら、共通の粗利率の目安を入れる
    s = s.replace('<tr><td colspan="3">souba-db の business_size_based_pricing を参照</td></tr>',
                  '<tr><td>1 個人事業 職人</td><td>25-35%</td><td>価格重視。信頼できる個人業者を知っている場合</td></tr><tr><td>2 中小工務店 地域チェーン</td><td>25-35%</td><td>第一候補</td></tr><tr><td>3 人気工務店 長期保証重視</td><td>30-40%</td><td>品質・保証重視</td></tr><tr><td>4 大手リフォーム</td><td>35-45%</td><td>安心料として払う価値がある場合</td></tr>')
    return s

SUBTITLE = {
    '外壁塗装': '外壁塗装 30坪の相場はいくらか。塗料別の㎡単価と一式の幅を、建設実務30年の監修つき相場データ souba-db の数字で答えます。数量と単価で自分で検算できる形にしています。',
    '給湯器交換': '給湯器交換の費用相場はいくらか。号数別・種類別の一式の幅を、建設実務30年の監修つき相場データ souba-db の数字で答えます。20万円は高いのかも号数で判定できます。',
    'シロアリ駆除': 'シロアリ駆除の費用と適正価格はいくらか。坪数別の一式の幅と㎡単価を、建設実務30年の監修つき相場データ souba-db の数字で答えます。訪問販売の100万円見積もりの正体も書いています。',
}

# ---------------------------------------------------------------- 外壁塗装
def build_gaiheki():
    path = 'souba/gaiheki/index.html'
    s = open('orig/' + path, encoding='utf-8').read()
    g30, g20, g40, gset = CAT['gaiheki_30tsubo'], CAT['gaiheki_20tsubo'], CAT['gaiheki_40tsubo'], CAT['gaiheki_yane_set_30tsubo']
    a30 = CAT['ashiba_30tsubo']
    # 題名・H1・説明: 数字を souba-db に揃える(80〜150 → 70〜150。シリコン一式の最安は70万円)
    s = must(s, '<title>外壁塗装の相場・適正価格【2026年最新】30坪で80〜150万円 | HORIZON SHIELD</title>',
             '<title>外壁塗装の相場・適正価格【2026年最新】30坪で70〜150万円(シリコン70〜115万円) | HORIZON SHIELD</title>')
    s = must(s, '外壁塗装の相場・適正価格<br>【2026年最新】30坪で80〜150万円', '外壁塗装の相場・適正価格<br>【2026年最新】30坪で70〜150万円')
    s = must(s, '外壁塗装の相場・適正価格を建設実務30年のプロがsouba-dbの実測データで解説します。適正相場の目安は80万〜150万円。',
             '外壁塗装 30坪の相場はいくらか。シリコン塗料なら一式70万〜115万円(平均90万円)、塗料の種類で70万〜150万円台。建設実務30年のプロが監修する相場データ souba-db の数字で答えます。', count=2)
    s = common_cleanup(s, '外壁塗装')

    # 最初の節を「直答」に差し替え
    old_first = s[s.find('<h2>外壁塗装の適正相場（全国・2026年版）</h2>'):s.find('<h2>適正価格の考え方(算出式)</h2>')]
    rows_size = [
        ['20坪(延床)', 'シリコン 一式', '<strong>%s</strong>' % rng_avg('gaiheki_20tsubo'), '足場・養生・3回塗り・付帯部塗装込み'],
        ['30坪(延床)', 'シリコン 一式', '<strong>%s</strong>' % rng_avg('gaiheki_30tsubo'), '一般的な2階建て。最も多い問い合わせ'],
        ['40坪(延床)', 'シリコン 一式', '<strong>%s</strong>' % rng_avg('gaiheki_40tsubo'), '2〜3週間の工期'],
        ['30坪 外壁+屋根セット', 'シリコン 一式', '<strong>%s</strong>' % rng_avg('gaiheki_yane_set_30tsubo'), '足場1回分で済むぶん安い。200万円超は理由を聞く'],
        ['足場(30坪 2階建て)', '一式', '%s' % rng_avg('ashiba_30tsubo'), '架け面積200㎡前後。㎡700〜1,200円'],
    ]
    rows_grade = [
        ['シリコン', sqm('gaiheki_silicon_sqm'), '10〜15年', '業界標準。迷ったらここ。㎡5,000円超は過剰'],
        ['ラジカル', sqm('gaiheki_radical_sqm'), '12〜16年', 'シリコン改良型'],
        ['フッ素', sqm('gaiheki_fluorine_sqm'), '15〜20年', '高耐候。シリコンとの差額は 単価差 × 塗装面積'],
        ['無機', sqm('gaiheki_inorganic_sqm'), '20〜25年', '最上位グレード'],
    ]
    new_first = '''<h2 id="kotae">外壁塗装 30坪の相場はいくら？(2026年・全国)</h2>
    <p class="speakable"><strong>30坪(延床)の2階建てなら、シリコン塗料の一式で%s。</strong>足場・高圧洗浄・養生・3回塗り・付帯部塗装を含む総額です。塗料をフッ素や無機に上げると、㎡単価の差 × 塗装面積(30坪で120㎡前後)の分だけ上がり、塗料の種類を問わず 70万〜150万円台 に収まるのが普通です。</p>
    %s
    <p class="note">%s</p>
    <h3>塗料グレード別の㎡単価(足場・高圧洗浄・下塗り込み)</h3>
    %s
    %s
    %s
    <p class="note">この表の作り方: 見積書の「塗装(材工)」の行を 数量(㎡) × 単価(円/㎡) に分け、単価を上の塗料別レンジに、総額を坪別レンジに当てるだけです。同じ数字は MCP ツール audit_estimate に金額を渡しても返ります。</p>
  </div>

  <div class="section">
    ''' % (
        rng_avg('gaiheki_30tsubo'),
        table(rows_size, ['規模', '仕様', '適正レンジ(souba-db)', '含むもの・目安']),
        SRC_LINE,
        table(rows_grade, ['塗料', '㎡単価(適正)', '耐用年数', '目安']),
        bands_block(
            '標準的な見積もり。塗料の品番、塗装面積(㎡)、塗り回数(3回)が書いてあれば、そのまま比較の土台にできます。',
            'フッ素や無機への格上げ、シーリングの全打ち替え、下地補修が厚い、付帯部(軒天・雨樋・破風)が多い、のどれかが内訳の行で説明できれば適正です。',
            '超えた分がどの行にあるかを聞いてください。塗装面積が水増しされていないか(30坪なら120㎡前後、延床面積の約1.2〜1.4倍)、足場が㎡1,200円を超えていないか、「一式」の行に金額が隠れていないか。どの行でも説明できない超過分は交渉対象です。'),
        steps_block([
            '見積書を「足場」「高圧洗浄」「下地・シーリング」「塗装(材工)」「付帯部」「諸経費」の行に分け、それぞれの数量と単価を書き出す',
            '塗装(材工)の㎡単価を上の塗料別レンジに当て、総額を坪別レンジに当てる。塗装面積は延床の1.2〜1.4倍が目安(30坪なら120㎡前後)',
            '「一式」の行は数量と単価に割ってもらう。割れない行は比較も検証もできないので、契約前に出してもらう',
        ]),
    )
    s = s.replace(old_first, new_first)
    # 原価内訳の表: 英語キーを日本語に、単価を souba-db に
    s = must(s, '<tr><td>silicon</td><td>業界標準・最多使用</td><td class="ok">¥2,300〜¥3,500/㎡</td><td>8〜12年</td></tr><tr><td>radical</td><td>新標準・シリコン改良型</td><td class="ok">¥2,500〜¥3,500/㎡</td><td>10〜13年</td></tr><tr><td>fluorine</td><td>高耐久</td><td class="ok">¥3,500〜¥4,500/㎡</td><td>15〜20年</td></tr><tr><td>inorganic</td><td>最上位グレード</td><td class="ok">¥4,500〜¥6,000/㎡</td><td>15〜25年</td></tr>',
             '<tr><td>シリコン</td><td>業界標準・最多使用</td><td class="ok">¥2,300〜¥3,500/㎡</td><td>10〜15年</td></tr><tr><td>ラジカル</td><td>新標準・シリコン改良型</td><td class="ok">¥2,800〜¥4,000/㎡</td><td>12〜16年</td></tr><tr><td>フッ素</td><td>高耐久</td><td class="ok">¥3,800〜¥5,000/㎡</td><td>15〜20年</td></tr><tr><td>無機</td><td>最上位グレード</td><td class="ok">¥4,500〜¥6,500/㎡</td><td>20〜25年</td></tr>')
    s = must(s, '<tr><td>acrylic</td><td>時代遅れ・現代ではほぼ使われない</td>', '<tr><td>アクリル</td><td>時代遅れ・現代ではほぼ使われない</td>')
    s = must(s, '<tr><td>urethane</td><td>廃れ気味</td>', '<tr><td>ウレタン</td><td>廃れ気味</td>')
    s = must(s, '<h3>30坪標準_原価分解_2026年4月</h3>', '<h3>30坪の原価分解(2026年)</h3>')
    s = must(s, '<h4>①材料費_塗料</h4>', '<h4>① 材料費(塗料)</h4>')
    s = must(s, '<h4>②人工費_塗装職人</h4>', '<h4>② 人工費(塗装職人)</h4>')
    s = must(s, '<h4>③足場費</h4>', '<h4>③ 足場費</h4>')
    s = must(s, '<h4>④副資材_マスキング_養生</h4>', '<h4>④ 副資材(マスキング・養生)</h4>')
    s = must(s, '<li><strong>⑤原価小計_シリコン仕様:</strong>', '<li><strong>⑤ 原価小計(シリコン仕様):</strong>')
    s = must(s, '<h4>⑥_業者規模別_税込HS価格_シリコン</h4>', '<h4>⑥ 業者規模別の税込目安(シリコン)</h4>')
    s = must(s, '<li><strong>30坪標準_1回設置:</strong>', '<li><strong>30坪標準・1回設置:</strong>')
    s = s.replace('<li><strong>note:</strong> roof_constructionと同時施工で足場共有→¥15-30万節約（v3.0の¥30-80万は誇張・訂正済み）</li>', '<li><strong>屋根と同時施工:</strong> 足場を共有できるため¥15-30万の節約になる</li>')
    s = s.replace('<li><strong>HS推奨:</strong> 2026年4月以降', '<li><strong>確認の勧め:</strong> 2026年4月以降')
    # FAQ: 監視の問いをそのままの言葉で先頭に、既存の数字を souba-db に
    items = faq_items_from_page(s)
    fixed = []
    for q, a in items:
        if q == '外壁塗装の相場はいくらですか？':
            a = '30坪2階建てで、シリコン塗料の一式なら%s。塗料の種類を問わず70万〜150万円台が普通です。㎡単価はシリコン2,300〜3,500円、ラジカル2,800〜4,000円、フッ素3,800〜5,000円、無機4,500〜6,500円。足場は30坪一式で%s(㎡700〜1,200円)。出典は souba-db %s。' % (rng_avg('gaiheki_30tsubo'), rng('ashiba_30tsubo'), DB_VER)
        elif q == '外壁塗装200万円は高いですか？':
            a = '30坪2階建ての場合、シリコン一式の最高額は115万円、外壁と屋根のセットでも130万円です。200万円はそれを大きく超えるので、超えた分がどの行にあるかを聞き、相見積もりを取ってください。無機塗料と屋根同時と下地補修が重なった場合だけ、200万円前後が説明できることがあります。'
        elif q == '外壁塗装で過剰請求される典型的なパターンは？':
            a = '主に4つです。①シリコン塗装なのに㎡5,000円以上②足場費用が㎡1,200円を大きく超える③外壁と屋根で足場を二重計上④見積書が「一式」のみで内訳なし。30坪で150万円を超えたら、まず内訳の行ごとに理由を確認してください。'
        elif q == '外壁塗装の見積もりが適正か確認する方法は？':
            a = '㎡単価で確認するのが最も確実です。塗装(材工)の行を数量(㎡)と単価に分け、単価を塗料別レンジに、総額を坪別レンジに当てます。「一式」とだけ書かれている場合は内訳の開示を求めてください。写真かPDFを送れば無料でその場で確認できる見積もり鑑定書AI(/kantei/)もあります。'
        elif q == 'HS基準の価格はどう算出されますか？':
            a = '材料仕入れ値×1.2＋職人人工×日当＋付帯工事実費＋（原価×一般管理費率15%）＋消費税10%が基本式です。業者規模に応じた妥当な利益率を上乗せしたものが適正価格の目安で、公開している souba-db の各レンジはこの式と複数の公開相場・加盟店の実案件で照合しています。'
        fixed.append((q, a))
    top = [
        ('外壁塗装 30坪の相場はいくらですか？', '延床30坪の2階建てなら、シリコン塗料の一式で%s。足場・高圧洗浄・養生・3回塗り・付帯部塗装を含む総額です(souba-db %s)。20坪は%s、40坪は%s、外壁と屋根のセットなら%sが目安です。' % (rng_avg('gaiheki_30tsubo'), DB_VER, rng('gaiheki_20tsubo'), rng('gaiheki_40tsubo'), rng('gaiheki_yane_set_30tsubo'))),
        ('外壁塗装の見積もりが高いかどうか、自分で判定する方法は？', '3手順です。①見積書を足場・高圧洗浄・下地シーリング・塗装(材工)・付帯部・諸経費の行に分けて数量と単価を書き出す ②塗装(材工)の㎡単価を塗料別レンジ(シリコン2,300〜3,500円など)に当て、総額を坪別レンジに当てる ③「一式」の行は数量と単価に割ってもらう。最高額を超えた分がどの行にあるか説明できなければ交渉対象です。'),
    ]
    items2 = top + fixed
    faq_html = '\n    '.join(faq_item_html(q, a) for q, a in items2)
    i = s.find('<h2>よくある質問（FAQ）</h2>'); j = s.find('</div>\n\n  <div class="section">', i)
    old_faq = s[s.find('<div class="faq-item">', i):j]
    s = s.replace(old_faq, faq_html + '\n  ', 1)
    s, ok = replace_faq_ld(s, items2)
    assert ok
    # 出典
    s = must(s, '<p><strong>相場データ：</strong>HORIZON SHIELD建設費相場データベース2026年版（souba-v2/gaiheki_tosou.json）</p>',
             '<p><strong>相場データ：</strong>HORIZON SHIELD souba-db %s(%s 更新)。<a href="https://shield.the-horizons-innovation.com/data/souba-db.json">souba-db.json</a> をそのまま公開しており、このページの表は同じファイルから作り直せます。</p>' % (DB_VER, DB_DATE))
    return write(path, s)

# ---------------------------------------------------------------- 給湯器
def build_kyutoki():
    path = 'souba/kyutoki/index.html'
    s = open('orig/' + path, encoding='utf-8').read()
    s = must(s, '<title>給湯器交換の費用・相場【2026年最新】20号で10〜18万円が適正 | HORIZON SHIELD</title>',
             '<title>給湯器交換の費用・相場【2026年最新】20号で15〜30万円・16号13〜25万円・24号18〜38万円 | HORIZON SHIELD</title>')
    s = must(s, '給湯器交換の費用・相場<br>【2026年最新】20号で10〜18万円', '給湯器交換の費用・相場<br>【2026年最新】20号で15〜30万円')
    s = re.sub(r'<meta name="description" content="[^"]*">',
               '<meta name="description" content="給湯器交換の費用相場はいくらか。ガス給湯器は16号13〜25万円・20号15〜30万円・24号18〜38万円、エコジョーズ20号20〜38万円、エコキュート370Lで35〜58万円(工事費込み)。建設実務30年のプロが監修する相場データ souba-db の数字で、20万円が高いかどうかも号数で判定します。">', s, count=1)
    s = re.sub(r'<meta property="og:description" content="[^"]*">',
               '<meta property="og:description" content="給湯器交換の費用相場はいくらか。ガス給湯器は16号13〜25万円・20号15〜30万円・24号18〜38万円、エコジョーズ20号20〜38万円、エコキュート370Lで35〜58万円(工事費込み)。">', s, count=1)
    s = common_cleanup(s, '給湯器交換')
    old_first = s[s.find('<h2>給湯器交換の適正相場（全国・2026年版）</h2>'):s.find('<h2>適正価格の考え方(算出式)</h2>')]
    rows = [
        ['ガス給湯器 16号', '一式(本体+工事)', '<strong>%s</strong>' % rng_avg('kyutoki_16'), '単身〜2人'],
        ['ガス給湯器 20号', '一式(本体+工事)', '<strong>%s</strong>' % rng_avg('kyutoki_20'), '2〜3人。最も多い交換'],
        ['ガス給湯器 24号', '一式(本体+工事)', '<strong>%s</strong>' % rng_avg('kyutoki_24'), '4人以上'],
        ['エコジョーズ 20号', '一式(本体+工事)', '<strong>%s</strong>' % rng_avg('kyutoki_ecojozu_20'), '省エネ型。給湯省エネ2026の補助対象'],
        ['エコジョーズ 24号', '一式(本体+工事)', '<strong>%s</strong>' % rng_avg('kyutoki_ecojozu_24'), '省エネ型'],
        ['給湯専用→追い焚き対応へ', '一式', '<strong>%s</strong>' % rng_avg('ofuro_kanso_oidaki'), '配管の追加で幅が出る'],
        ['エコキュート 370L フルオート', '一式(本体+標準工事)', '<strong>%s</strong>' % rng_avg('ecocute_370'), '基礎・200V電気・配管・撤去込み'],
    ]
    new_first = '''<h2 id="kotae">給湯器交換の費用相場はいくら？(2026年・全国)</h2>
    <p class="speakable"><strong>ガス給湯器20号(2〜3人家庭)の交換で%s。</strong>本体と標準工事費(撤去・接続・試運転)を含む一式の幅です。16号なら%s、24号なら%s、省エネ型のエコジョーズ20号は%s。電気のエコキュート370Lは%sになります。</p>
    %s
    <p class="note">%s</p>
    %s
    %s
    <p class="note">「給湯器交換で20万円は高いですか」は号数で答えが変わります。20号なら平均より安い側、16号なら上限に近い側です。号数別の判定と、20万円が妥当になる条件は <a href="https://shield.the-horizons-innovation.com/souba/kyutoki-20man/">給湯器交換で20万円は高いですか？</a> にまとめました。</p>
  </div>

  <div class="section">
    ''' % (
        rng_avg('kyutoki_20'), rng('kyutoki_16'), rng('kyutoki_24'), rng('kyutoki_ecojozu_20'), rng('ecocute_370'),
        table(rows, ['機種・号数', '単位', '適正レンジ(souba-db)', '目安']),
        SRC_LINE,
        bands_block(
            '標準的な見積もり。本体の型番と定価、値引き後の本体価格、工事費の内訳(撤去処分・接続・リモコン・出張)が書いてあれば比較の土台になります。',
            '号数の格上げ(20号→24号)、エコジョーズ化、追い焚き配管の追加、排気位置や設置場所の変更のどれかが内訳で説明できれば適正です。',
            '超えた分がどの行にあるかを聞いてください。本体が定価のまま計上されていないか(実売は定価の35〜65%が普通)、「緊急対応」「深夜割増」が1.5倍を超えていないか、補助金の申請代行費が過大でないか。説明できない超過分は交渉対象です。'),
        steps_block([
            '見積書を「本体(型番・定価・値引き後)」「標準工事費」「追加工事(配管・電気・撤去処分)」「出張・諸経費」の行に分けて金額を書き出す',
            '本体の型番から号数と種類(従来型かエコジョーズか)を確かめ、合計を上の号数別レンジに当てる',
            '「一式」の行は本体と工事に割ってもらう。割れない見積もりは比較できないので、契約前に出してもらう。故障で急いでいても、この3手順は電話1本で済みます',
        ]),
    )
    s = s.replace(old_first, new_first)
    s = s.replace('<p class="note">出典：HORIZON SHIELD建設費相場データベース2026年版（souba-v2/water_heater_reform.json・大賀俊勝 建設実務経験30年監修）</p>', '')
    # 本文中の古い数字を捜索して直す
    s = s.replace('ガス給湯器20号の標準交換で<strong>10〜18万円</strong>', 'ガス給湯器20号の交換で<strong>%s</strong>' % rng('kyutoki_20'))
    # FAQ
    items = faq_items_from_page(s)
    fixed = []
    for q, a in items:
        if q == '給湯器交換の相場はいくらですか？':
            a = 'ガス給湯器20号の交換で%s、16号は%s、24号は%s(本体+工事費)。エコジョーズ20号は%s、エコキュート370Lは%sが目安です(souba-db %s)。' % (rng_avg('kyutoki_20'), rng('kyutoki_16'), rng('kyutoki_24'), rng('kyutoki_ecojozu_20'), rng('ecocute_370'), DB_VER)
        elif q == '給湯器交換25万円は高いですか？':
            a = 'ガス20号の従来型なら適正レンジ%sの中で平均より上、24号やエコジョーズ20号(%s)なら平均に近い金額です。本体の型番と定価・値引き後の価格、工事費の内訳を確かめて、号数と種類に見合っているかで判定してください。' % (rng('kyutoki_20'), rng('kyutoki_ecojozu_20'))
        elif q == 'エコキュートとガス給湯器の選び方は？':
            a = 'ガス20号は%s、エコキュート370Lは%sが目安です。初期費用はエコキュートが高い一方、ランニングコストは最安クラス。給湯省エネ2026事業の補助金要件も確認してください。' % (rng('kyutoki_20'), rng('ecocute_370'))
        fixed.append((q, a))
    top = [
        ('給湯器交換の費用相場はいくらですか？', 'ガス給湯器20号(2〜3人家庭)の交換で%s。本体と標準工事費を含みます。16号は%s、24号は%s、エコジョーズ20号は%s、エコキュート370Lは%s(souba-db %s)。' % (rng_avg('kyutoki_20'), rng('kyutoki_16'), rng('kyutoki_24'), rng('kyutoki_ecojozu_20'), rng('ecocute_370'), DB_VER)),
        ('給湯器交換で20万円は高いですか？', '号数で変わります。20号の従来型なら適正レンジ%sの平均より安い側で、多くの場合は適正です。16号なら上限に近く、追加工事が無ければやや高め。24号やエコジョーズなら安い側です。本体の型番で号数と種類を確かめてから判定してください。'.replace('%s', rng('kyutoki_20'))),
    ]
    items2 = top + fixed
    faq_html = '\n    '.join(faq_item_html(q, a) for q, a in items2)
    i = s.find('<h2>よくある質問（FAQ）</h2>'); j = s.find('</div>\n\n  <div class="section">', i)
    old_faq = s[s.find('<div class="faq-item">', i):j]
    s = s.replace(old_faq, faq_html + '\n  ', 1)
    s, ok = replace_faq_ld(s, items2)
    assert ok
    s = s.replace('HORIZON SHIELD建設費相場データベース2026年版（souba-v2/water_heater_reform.json）',
                  'HORIZON SHIELD souba-db %s(%s 更新)。<a href="https://shield.the-horizons-innovation.com/data/souba-db.json">souba-db.json</a> をそのまま公開しており、このページの表は同じファイルから作り直せます' % (DB_VER, DB_DATE))
    # 残る古い数字の検査
    for bad in ('10〜18万円', '8〜15万円', '12〜22万円'):
        if bad in s:
            print('  warn: old number still present in kyutoki:', bad, s.count(bad))
    return write(path, s)

# ---------------------------------------------------------------- シロアリ
def build_shiroari():
    path = 'souba/shiroari/index.html'
    s = open('orig/' + path, encoding='utf-8').read()
    s = must(s, '<title>シロアリ駆除の費用・相場【2026年最新】30坪で15〜30万円が適正 | HORIZON SHIELD</title>',
             '<title>シロアリ駆除の費用・適正価格【2026年最新】30坪で15〜30万円・㎡1,500〜2,500円 | HORIZON SHIELD</title>')
    s = re.sub(r'<meta name="description" content="[^"]*">',
               '<meta name="description" content="シロアリ駆除の費用と適正価格はいくらか。バリア工法で㎡1,500〜2,500円(205社調査の平均1,867円)、20坪で9.9〜20万円、30坪で15〜30万円が一式の幅。建設実務30年のプロが監修する相場データ souba-db の数字で、訪問販売の100万円見積もりと床下換気扇の抱き合わせも見分けます。">', s, count=1)
    s = re.sub(r'<meta property="og:description" content="[^"]*">',
               '<meta property="og:description" content="シロアリ駆除の費用と適正価格。バリア工法で㎡1,500〜2,500円、20坪で9.9〜20万円、30坪で15〜30万円。訪問販売の100万円見積もりの見分け方。">', s, count=1)
    s = common_cleanup(s, 'シロアリ駆除')
    old_first = s[s.find('<h2>シロアリ駆除の適正相場（全国・2026年版）</h2>'):s.find('<h2>適正価格の考え方(算出式)</h2>')]
    rows = [
        ['㎡単価(バリア工法)', '駆除・予防の薬剤散布', '<strong>%s</strong>' % sqm('shiroari_kujo_sqm'), '2026年4月 全国205社調査の平均1,867円/㎡(坪6,160円)'],
        ['20坪(1階床面積)', '一式・5年保証付き', '<strong>%s</strong>' % rng_avg('shiroari_kujo_20tsubo'), '延床40坪相当'],
        ['30坪(1階床面積)', '一式・5年保証付き', '<strong>%s</strong>' % rng_avg('shiroari_kujo_30tsubo'), '延床60坪相当。訪問業者で100万円超の見積もりが多発'],
        ['床下点検口の新設', '1箇所', rng_avg('shiroari_tenkenguchi'), '45cm角の標準品'],
        ['床下換気扇', '1台', rng_avg('shiroari_kankiouji'), '不要なのに高額で抱き合わせる典型。必要性を先に問う'],
    ]
    new_first = '''<h2 id="kotae">シロアリ駆除の費用と適正価格はいくら？(2026年・全国)</h2>
    <p class="speakable"><strong>1階床面積30坪でバリア工法なら一式%s、20坪なら%s。</strong>㎡単価は%s(全国205社調査の平均1,867円/㎡)。薬剤散布と5年保証を含む幅です。床下は見えないぶん、訪問販売で100万円を超える見積もりが出やすい工事です。</p>
    %s
    <p class="note">%s</p>
    %s
    %s
  </div>

  <div class="section">
    ''' % (
        rng_avg('shiroari_kujo_30tsubo'), rng('shiroari_kujo_20tsubo'), sqm('shiroari_kujo_sqm'),
        table(rows, ['区分', '単位・条件', '適正レンジ(souba-db)', '目安']),
        SRC_LINE,
        bands_block(
            '標準的な見積もり。施工面積(㎡または坪)と㎡単価、薬剤名、保証年数が書いてあれば比較できます。',
            '施工面積が広い、被害箇所の木部処理が多い、点検口の新設が要る、のどれかが内訳で説明できれば適正です。',
            '30坪で30万円を超えたら、超えた分がどの行にあるかを聞いてください。床下換気扇や調湿剤の抱き合わせ、施工面積の水増し(1階床面積で計算するのが基本)、「一式」の行に隠れた金額。突然の訪問で「床下が危ない」と言われた場合は、その場で契約せず、訪問販売なら8日以内のクーリングオフが使えます。'),
        steps_block([
            '見積書を「駆除(薬剤散布)」「木部処理」「点検口・換気扇などの追加」「諸経費」の行に分け、数量(㎡)と単価を書き出す',
            '駆除の行を 施工面積(㎡) × ㎡単価 で検算し、単価を㎡1,500〜2,500円のレンジに、合計を坪別レンジに当てる。施工面積は1階の床面積(30坪なら約99㎡)が基本',
            '換気扇・調湿剤・防カビの行は「なぜ必要か」を書面で出してもらう。理由が無ければ外す。「一式」の行は数量と単価に割ってもらう',
        ]),
    )
    s = s.replace(old_first, new_first)
    s = s.replace('<p class="note">出典：HORIZON SHIELD建設費相場データベース2026年版（souba-v2/termite_work.json・大賀俊勝 建設実務経験30年監修）</p>', '')
    items = faq_items_from_page(s)
    fixed = []
    for q, a in items:
        if q == 'シロアリ駆除の相場はいくらですか？':
            a = '1階床面積30坪で%s、20坪で%sが適正です(souba-db %s)。業界平均は1,867円/㎡(2026年4月205社調査)で、㎡2,500円や坪1万円を超える請求は理由を聞く水準です。' % (rng_avg('shiroari_kujo_30tsubo'), rng('shiroari_kujo_20tsubo'), DB_VER)
        elif q == 'シロアリ駆除30坪で50万円は高いですか？':
            a = '適正レンジ(%s)の1.7倍以上で、過剰請求の可能性が高いです。施工面積と㎡単価、換気扇や調湿剤の抱き合わせが無いかを確かめてください。訪問販売なら8日以内にクーリングオフできます。' % rng('shiroari_kujo_30tsubo')
        fixed.append((q, a))
    top = [
        ('シロアリ駆除の費用の適正価格はいくらですか？', 'バリア工法で㎡%s(全国205社調査の平均1,867円/㎡)。1階床面積20坪で%s、30坪で%sが一式の幅で、薬剤散布と5年保証を含みます(souba-db %s)。100万円を超える見積もりは、換気扇や調湿剤の抱き合わせか施工面積の水増しをまず疑ってください。' % (sqm('shiroari_kujo_sqm').replace('円/㎡', '円'), rng('shiroari_kujo_20tsubo'), rng_avg('shiroari_kujo_30tsubo'), DB_VER)),
        ('シロアリ駆除の見積もりが高いかどうか、自分で判定する方法は？', '3手順です。①見積書を駆除(薬剤散布)・木部処理・追加(点検口・換気扇)・諸経費の行に分けて数量と単価を書き出す ②駆除の行を 施工面積(㎡) × ㎡単価 で検算し、単価を㎡1,500〜2,500円に、合計を坪別レンジに当てる ③換気扇・調湿剤の行は必要な理由を書面でもらい、無ければ外す。'),
    ]
    items2 = top + fixed
    faq_html = '\n    '.join(faq_item_html(q, a) for q, a in items2)
    i = s.find('<h2>よくある質問（FAQ）</h2>'); j = s.find('</div>\n\n  \n', i)
    if j < 0:
        j = s.find('</div>\n\n  <div class="section">', i)
    old_faq = s[s.find('<div class="faq-item">', i):j]
    s = s.replace(old_faq, faq_html + '\n  ', 1)
    s, ok = replace_faq_ld(s, items2)
    assert ok
    s = s.replace('HORIZON SHIELD建設費相場データベース2026年版（souba-v2/termite_work.json）',
                  'HORIZON SHIELD souba-db %s(%s 更新)。<a href="https://shield.the-horizons-innovation.com/data/souba-db.json">souba-db.json</a> をそのまま公開しており、このページの表は同じファイルから作り直せます' % (DB_VER, DB_DATE))
    return write(path, s)

if __name__ == '__main__':
    ok = True
    ok &= build_gaiheki()
    ok &= build_kyutoki()
    ok &= build_shiroari()
    sys.exit(0 if ok else 1)
