path = '/Users/oogatoshikatsu/Desktop/horizon-shield/workers/hs-kira-proxy-CURRENT/hs-kira-proxy/src/kira-proxy-v2.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

old = """        if (cached && cached.ai_output) {"""
new = """        if (false && cached && cached.ai_output) { // ★キャッシュ無効化：会話型では毎回LLMに投げる"""

if old in content:
    content = content.replace(old, new, 1)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("✅ キャッシュ無効化完了")
else:
    print("NG: アンカー不一致")
