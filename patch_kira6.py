path = '/Users/oogatoshikatsu/Desktop/horizon-shield/hs-reverse-estimate/index.html'
with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# 'lastMsg2.content +' を含む行を全て発見
target_indices = []
for i, line in enumerate(lines):
    if 'lastMsg2.content' in line and "+ '\\n\\n[指示" in line:
        target_indices.append(i)

print(f"対象行: {[i+1 for i in target_indices]}")

if not target_indices:
    print("NG: 対象行なし")
else:
    for idx in target_indices:
        print(f"置換前 line {idx+1}:")
        print(repr(lines[idx]))
        
        # インデント保持
        original = lines[idx]
        indent_len = len(original) - len(original.lstrip())
        indent = original[:indent_len]
        
        new_line = indent + "content: lastMsg2.content + '\\n\\n[指示：会社情報・電話番号・LINEアカウント・サービス料金は絶対に出力しない。会話履歴の全ユーザーメッセージから既出情報(地域/工事種別/規模/築年数/構造/予算/時期/賃貸or自宅/世帯数/設備数)を必ず抽出し既出情報は再質問しない。直前のassistantメッセージと同じ質問を繰り返したら失格。施主が「出して」「プランを」「算出」「見せて」のいずれかを言ったら情報不足でも即===PLAN===出力。5項目=工事種別/規模(㎡or坪)/築年数構造/地域(都道府県)/予算時期。工事がフルリノベ全面リフォームの場合は追加で2世帯or単世帯・トイレ数・洗面台数・お風呂の階・キッチン数も確認すること]'\n"
        
        lines[idx] = new_line
        print(f"置換後 line {idx+1}:")
        print(repr(new_line))

    with open(path, 'w', encoding='utf-8') as f:
        f.writelines(lines)
    print(f"OK: {len(target_indices)}箇所書き換え成功")
