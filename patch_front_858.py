path = '/Users/oogatoshikatsu/Desktop/horizon-shield/hs-reverse-estimate/index.html'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

old = r"""content: lastMsg2.content + '\n\n[指示：会社情報・電話番号・LINEアカウント・サービス料金は絶対に出力しない。会話履歴の全ユーザーメッセージから既出情報(地域/工事種別/規模/築年数/構造/予算/時期/賃貸or自宅/世帯数/設備数)を必ず抽出し既出情報は再質問しない。直前のassistantメッセージと同じ質問を繰り返したら失格。施主が「出して」「プランを」「算出」「見せて」のいずれかを言ったら情報不足でも即===PLAN===出力。5項目=工事種別/規模(㎡or坪)/築年数構造/地域(都道府県)/予算時期。工事がフルリノベ全面リフォームの場合は追加で2世帯or単世帯・トイレ数・洗面台数・お風呂の階・キッチン数も確認すること]'"""

new = r"""content: lastMsg2.content + '\n\n[指示：会社情報・電話番号・LINE・料金は出力しない。会話履歴から既出情報を抽出し、既に答えた項目は再質問しない。必須5項目=①地域(都道府県)②工事種別③規模(㎡)④構造・築年数⑤グレード感(コスパ/標準/こだわり)。予算は聞かずこちらが算出する。フルリノベの場合は追加で⑥世帯数⑦トイレ数⑧洗面台数⑨お風呂の階⑩キッチン数も確認。未確認項目だけを1〜2個ずつ質問。施主が「出して」「プランを」「算出」「見せて」と言ったら即===PLAN===形式で3プラン出力。]'"""

if old in content:
    content = content.replace(old, new, 1)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("✅ 行858 指示文書き換え完了")
else:
    print("NG: アンカー不一致。手動確認必要")
