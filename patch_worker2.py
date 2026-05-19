path = '/Users/oogatoshikatsu/Desktop/horizon-shield/workers/hs-kira-proxy-CURRENT/hs-kira-proxy/src/kira-proxy-v2.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# enrichSystemPromptWithSoubaData の冒頭、userText生成直後にエイリアス展開を追加
old = """    const userText = messages
      .filter(m => m.role === 'user')
      .map(m => typeof m.content === 'string' ? m.content : '')
      .join(' ');

    if (!userText) return originalSystem;

    const matchedCategories = [];"""

new = """    let userText = messages
      .filter(m => m.role === 'user')
      .map(m => typeof m.content === 'string' ? m.content : '')
      .join(' ');

    if (!userText) return originalSystem;

    // ★ エイリアス展開：施主表現 → souba-dbカテゴリ名へ変換
    const aliases = [
      { from: /フルリノベ|全面リフォーム|全面リノベ|フルリフォーム/g, addCategories: ['戸建てリノベ', 'マンションリノベ'] },
      { from: /フルリノベ.*マンション|マンション.*フルリノベ|マンション.*リノベ/g, addCategories: ['マンションリノベ'] },
      { from: /フルリノベ.*戸建|戸建.*フルリノベ|戸建.*リノベ/g, addCategories: ['戸建てリノベ'] },
    ];
    for (const a of aliases) {
      if (a.from.test(userText)) {
        userText += ' ' + a.addCategories.join(' ');
      }
    }

    const matchedCategories = [];"""

if old in content:
    content = content.replace(old, new)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("OK: エイリアス展開追加成功")
else:
    print("NG: 対象文字列なし")
