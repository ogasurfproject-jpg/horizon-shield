path = '/Users/oogatoshikatsu/Desktop/horizon-shield/hs-reverse-estimate/index.html'
with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if 'lastMsg2.content' in line and '+' in line:
        print(f"--- line {i+1} ---")
        print(repr(line))
