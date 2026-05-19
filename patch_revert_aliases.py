path = '/Users/oogatoshikatsu/Desktop/horizon-shield/workers/hs-kira-proxy-CURRENT/hs-kira-proxy/src/kira-proxy-v2.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

old = """    // \u2605 \u30a8\u30a4\u30ea\u30a2\u30b9\u5c55\u958b\uff1a\u65bd\u4e3b\u8868\u73fe \u2192 souba-db\u30ab\u30c6\u30b4\u30ea\u540d\u3078\u5909\u63db
    const aliases = [
      { from: /\u30d5\u30eb\u30ea\u30ce\u30d9|\u5168\u9762\u30ea\u30d5\u30a9\u30fc\u30e0|\u5168\u9762\u30ea\u30ce\u30d9|\u30d5\u30eb\u30ea\u30d5\u30a9\u30fc\u30e0/g, addCategories: ['\u6238\u5efa\u3066\u30ea\u30ce\u30d9', '\u30de\u30f3\u30b7\u30e7\u30f3\u30ea\u30ce\u30d9'] },
      { from: /\u30d5\u30eb\u30ea\u30ce\u30d9.*\u30de\u30f3\u30b7\u30e7\u30f3|\u30de\u30f3\u30b7\u30e7\u30f3.*\u30d5\u30eb\u30ea\u30ce\u30d9|\u30de\u30f3\u30b7\u30e7\u30f3.*\u30ea\u30ce\u30d9/g, addCategories: ['\u30de\u30f3\u30b7\u30e7\u30f3\u30ea\u30ce\u30d9'] },
      { from: /\u30d5\u30eb\u30ea\u30ce\u30d9.*\u6238\u5efa|\u6238\u5efa.*\u30d5\u30eb\u30ea\u30ce\u30d9|\u6238\u5efa.*\u30ea\u30ce\u30d9/g, addCategories: ['\u6238\u5efa\u3066\u30ea\u30ce\u30d9'] },
    ];
    for (const a of aliases) {
      if (a.from.test(userText)) {
        userText += ' ' + a.addCategories.join(' ');
      }
    }

"""

if old in content:
    content = content.replace(old, '', 1)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("\u2705 \u30a8\u30a4\u30ea\u30a2\u30b9\u5c55\u958b\u30d6\u30ed\u30c3\u30af\u524a\u9664\u5b8c\u4e86")
else:
    print("NG: \u30a2\u30f3\u30ab\u30fc\u5931\u6557\u3002\u624b\u52d5\u78ba\u8a8d\u5fc5\u8981")
