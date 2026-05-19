path = '/Users/oogatoshikatsu/Desktop/horizon-shield/hs-reverse-estimate/index.html'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# requestFinalPlan() 関数を見つけて、user メッセージを超強化版に書き換え
old = "conversationHistory.push({ role: 'user', content: 'これまでの情報をもとに、今すぐ===PLAN===形式で3プランを算出してください。情報が足りなくても概算で構いません。会社情報は出力しないでください。' });"

new = """conversationHistory.push({ role: 'user', content: '【強制指示】既に十分な情報が揃っています。これ以上の質問は絶対に禁止。今すぐ下記の正確なフォーマットで3プランを出力してください。\\n\\n===PLAN===\\n工事内容：会話履歴の工事種別をここに記載\\n松：◯◯万円〜◯◯万円（大手リフォーム会社）\\n竹：◯◯万円〜◯◯万円（中小工務店・推奨）\\n梅：◯◯万円〜◯◯万円（個人事業者）\\nアドバイス：交渉のコツ2〜3文\\n出典：HORIZON SHIELD souba-db v15 / 日銀CGPI 2026-04 / 戦時係数×1.0935 / 算出日：2026年5月\\n===END===\\n\\n金額は会話で言及された規模・地域・築年数から推定してください。フルリノベ80㎡なら松1500-2200万、竹1000-1500万、梅700-1000万が目安。質問は一切禁止。即出力。' });"""

count = content.count(old)
print(f"見つかった箇所数: {count}")

if count > 0:
    content = content.replace(old, new)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("OK: requestFinalPlan強化成功")
else:
    print("NG: 対象文字列なし")
