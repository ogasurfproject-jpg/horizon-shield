path = '/Users/oogatoshikatsu/Desktop/horizon-shield/workers/hs-kira-proxy-CURRENT/hs-kira-proxy/src/kira-proxy-v2.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

changes = 0

# === REVERT 1: ヘルパー関数2つ削除 ===
# extractFactsFromMessagesHS 〜 enrichSystemPromptWithSoubaData直前まで
marker_start = '\n// \u2605\u2605\u2605 \u30e6\u30fc\u30b6\u30fc\u56de\u7b54\u304b\u3089\u69cb\u9020\u5316\u4e8b\u5b9f\u62bd\u51fa'
marker_end = 'async function enrichSystemPromptWithSoubaData'
if 'extractFactsFromMessagesHS' in content:
    idx_start = content.find('function extractFactsFromMessagesHS')
    idx_end = content.find(marker_end)
    if idx_start > 0 and idx_end > idx_start:
        # ヘルパーのコメント行も含めて削除（少し手前から）
        search_back = content.rfind('\n', 0, idx_start)
        if search_back > 0:
            # コメント行を含む開始位置を探す
            check = content[max(0,search_back-200):idx_start]
            comment_pos = check.rfind('\n// ')
            if comment_pos >= 0:
                idx_start = max(0,search_back-200) + comment_pos
            else:
                idx_start = search_back
        content = content[:idx_start] + '\n' + content[idx_end:]
        changes += 1
        print("OK 1: ヘルパー関数2つ削除")
    else:
        print("NG 1: マーカー位置不正 start=%d end=%d" % (idx_start, idx_end))
else:
    print("Skip 1: extractFactsFromMessagesHS不在")

# === REVERT 2: let userText → const userText ===
old2 = '    let userText = messages'
new2 = '    const userText = messages'
if old2 in content:
    content = content.replace(old2, new2, 1)
    changes += 1
    print("OK 2: let→const 復元")
else:
    print("Skip 2: let userText不在")

# === REVERT 3: isFullRenovation判定 + エイリアス展開ブロック削除 ===
alias_start_marker = '    // \u2605 \u30d5\u30eb\u30ea\u30ce\u30d9\u5224\u5b9a'
alias_end_marker = '    const matchedCategories'
if alias_start_marker in content:
    idx_s = content.find(alias_start_marker)
    idx_e = content.find(alias_end_marker)
    if idx_s > 0 and idx_e > idx_s:
        content = content[:idx_s] + content[idx_e:]
        changes += 1
        print("OK 3: isFullRenovation + エイリアス展開削除")
    else:
        print("NG 3: マーカー位置不正")
else:
    # 別のマーカーを試す
    alt = '    const isFullRenovation'
    if alt in content:
        idx_s = content.find(alt)
        idx_e = content.find(alias_end_marker)
        # isFullRenovation行の前の行頭から
        idx_s = content.rfind('\n', 0, idx_s)
        if idx_s > 0 and idx_e > idx_s:
            content = content[:idx_s+1] + content[idx_e:]
            changes += 1
            print("OK 3b: isFullRenovation + エイリアス削除(alt)")
        else:
            print("NG 3b")
    else:
        print("Skip 3: isFullRenovation不在")

# === REVERT 4: if(isFullRenovation)ブロック全体削除 + return修正 ===
reno_block = "    // \u2605\u2605\u2605 \u30d5\u30eb\u30ea\u30ce\u30d9\u5c02\u7528\uff1a\u60c5\u5831\u304c\u547d"
if reno_block in content:
    idx_s = content.find(reno_block)
    # ブロックの終了を探す: "return originalSystem + enrichmentBlock + realCasesBlock;" の行
    clean_return = '    return originalSystem + enrichmentBlock + realCasesBlock;'
    idx_e = content.find(clean_return, idx_s)
    if idx_e > idx_s:
        # clean_returnの直前の改行まで削除
        content = content[:idx_s] + content[idx_e:]
        changes += 1
        print("OK 4: isFullRenovationブロック削除")
    else:
        print("NG 4: clean return見つからず")
else:
    # 直接if文を探す
    alt4 = 'if (typeof isFullRenovation'
    if alt4 in content:
        idx_s = content.find(alt4)
        idx_s = content.rfind('\n', 0, idx_s)
        clean_return = '    return originalSystem + enrichmentBlock + realCasesBlock;'
        idx_e = content.find(clean_return, idx_s)
        if idx_e > idx_s:
            content = content[:idx_s+1] + content[idx_e:]
            changes += 1
            print("OK 4b: isFullRenovationブロック削除(alt)")
        else:
            print("NG 4b")
    else:
        print("Skip 4: isFullRenovationブロック不在")

# === 最終確認 ===
poison_check = 0
for kw in ['extractFactsFromMessagesHS','buildFactsBlockHS','isFullRenovation','fullRenoBlock','_factsBlock']:
    if kw in content:
        poison_check += 1
        print("WARNING: まだ残ってる: " + kw)

if poison_check == 0 and changes > 0:
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("\n✅ 全%d箇所の汚染除去完了。ファイル書き込み済み。" % changes)
elif poison_check > 0:
    print("\n❌ まだ%d個の汚染が残ってる。ファイル書き込みしない。" % poison_check)
else:
    print("\n⚠️ 変更0件。何もしなかった。")
