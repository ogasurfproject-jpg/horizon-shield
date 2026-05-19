path = '/Users/oogatoshikatsu/Desktop/horizon-shield/hs-reverse-estimate/index.html'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

results = []

# パッチA: 絶対ルール7-10を追加
old_a = '学習データの古い日付を出力しない）。'
new_a = '''学習データの古い日付を出力しない）。
7. 【最重要・繰り返し禁止】会話履歴の直前のassistantメッセージで既に質問した内容を、形を変えても絶対に再度質問しない。同じ確認文を2回出したら失格。
8. 【最重要・即時PLAN】施主が「出して」「プランを」「算出」「見せて」「お願い」のいずれかを言ったら、情報不足でも即===PLAN===を出力する。不足項目は範囲幅で対応（例:80万円〜200万円のように広めに）。
9. 【最重要・回答抽出】返答する前に、会話履歴の全ユーザーメッセージから以下を必ず抽出する：地域/工事種別/規模(㎡or坪)/築年数/構造(木造/RC等)/予算/時期/賃貸or自宅/世帯数/設備数。既出情報は絶対に再質問しない。
10. 【最重要・エコー禁止】施主の発言をそのままオウム返しで確認しない。共感は1文以内に圧縮する。'''

if old_a in content:
    content = content.replace(old_a, new_a, 1)
    results.append('A: 絶対ルール7-10追加 OK')
else:
    results.append('A: NG 文字列なし')

# パッチB: フロント側指示文を具体化（2箇所同時置換）
old_b = "[指示：会社情報・電話番号・LINEアカウント・サービス料金は絶対に出力しない。ヒアリングを続けるか、5項目が揃っていれば===PLAN===を出力する]"
new_b = "[指示：会社情報・電話番号・LINEアカウント・サービス料金は絶対に出力しない。会話履歴の全ユーザーメッセージから既出情報(地域/工事種別/規模/築年数/構造/予算/時期/賃貸or自宅)を必ず抽出し、既出情報は絶対に再質問しない。直前のassistantメッセージと同じ質問を繰り返したら失格。施主が『出して』『プランを』『算出』のいずれかを言ったら即===PLAN===出力。5項目=①工事種別②規模(㎡or坪)③築年数/構造④地域(都道府県)⑤予算/時期。工事がフルリノベ・全面リフォームの場合は追加で⑥2世帯or単世帯⑦トイレ数⑧洗面台数⑨お風呂の階⑩キッチン数も確認すること]"

count_b = content.count(old_b)
if count_b > 0:
    content = content.replace(old_b, new_b)
    results.append(f'B: フロント指示文 {count_b}箇所書き換え OK')
else:
    results.append('B: NG 文字列なし')

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

for r in results:
    print(r)
