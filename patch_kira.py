path = '/Users/oogatoshikatsu/Desktop/horizon-shield/hs-reverse-estimate/index.html'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

old = '# ヒアリング5項目\n①工事の種類・内容\n②規模(面積・数量など)\n③建物の状況(築年数・構造など)\n④地域(都道府県)\n⑤希望時期・予算感'

new = '''# ヒアリング5項目
①工事の種類・内容
②規模(面積・数量など)
③建物の状況(築年数・構造など)
④地域(都道府県)
⑤希望時期・予算感

【絶対ルール】会話履歴に既に含まれている情報は絶対に再度質問しない。施主が最初のメッセージで複数の情報を提供した場合、それらは全て回答済みとして扱いスキップすること。

# フルリノベ・全面改装の場合の追加ヒアリング
工事種別がフルリノベ・全面リフォームと判断された場合、5項目確認後にさらに以下を確認する：
⑥2世帯住宅か単世帯か
⑦トイレの数（1個・2個・3個以上）
⑧洗面台の数（1個・2個・3個以上）
⑨お風呂の場所（1階・2階）
⑩キッチンの数（1個・2個）
これらも一度に1〜2個ずつ聞くこと。全て揃ったら「他に気になる箇所はありますか？」と確認してからPLANを出力する。'''

if old in content:
    content = content.replace(old, new, 1)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("OK: パッチ適用成功")
else:
    print("NG: 対象文字列が見つからない")
