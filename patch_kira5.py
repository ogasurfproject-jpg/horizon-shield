path = '/Users/oogatoshikatsu/Desktop/horizon-shield/hs-reverse-estimate/index.html'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

old = "lastMsg2.content + '\\n\\n[指示：会社情報・電話番号・LINEアカウント・サービス料金は絶対に出力しない。ヒアリングを続けるか、5項目が揃っていれば===PLAN===を出力する]'"

new = "lastMsg2.content + '\\n\\n[指示：会社情報・電話番号・LINEアカウント・サービス料金は絶対に出力しない。会話履歴の全ユーザーメッセージから既出情報(地域/工事種別/規模/築年数/構造/予算/時期/賃貸or自宅/世帯数/設備数)を必ず抽出し、既出情報は絶対に再質問しない。直前のassistantメッセージと同じ質問を繰り返したら失格。施主が「出して」「プランを」「算出」「見せて」のいずれかを言ったら情報不足でも即===PLAN===出力。5項目=工事種別/規模(㎡or坪)/築年数・構造/地域(都道府県)/予算・時期。工事がフルリノベ・全面リフォームの場合は追加で2世帯or単世帯・トイレ数・洗面台数・お風呂の階・キッチン数も確認すること]'"

count = content.count(old)
print(f"見つかった箇所数: {count}")

if count > 0:
    content = content.replace(old, new)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("OK: フロント指示文書き換え成功")
else:
    print("NG: マッチしない")
