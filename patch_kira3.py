path = '/Users/oogatoshikatsu/Desktop/horizon-shield/hs-reverse-estimate/index.html'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 「ヒアリングを続けるか、5項目が揃っていれば」というユニークな部分を狙う
import re

# 該当箇所を正規表現で発見
pattern = re.compile(r"content: lastMsg2\.content \+ '\\n\\n\[指示：[^']+'")
matches = pattern.findall(content)
print(f"見つかった箇所数: {len(matches)}")
for i, m in enumerate(matches):
    print(f"--- match {i+1} ---")
    print(repr(m))
