import json
import urllib.request
import re
import subprocess
import os

KIRA_PROXY = "https://hs-kira-proxy.oga-surf-project.workers.dev"
PDF_GEN = "https://hs-pdf-gen.oga-surf-project.workers.dev"
HTML_PATH = "/Users/oogatoshikatsu/Desktop/horizon-shield/hs-reverse-estimate/index.html"

# ========== HTMLからKIRA_SYSTEM抽出 ==========
with open(HTML_PATH, 'r', encoding='utf-8') as f:
    html = f.read()

m = re.search(r"const KIRA_SYSTEM = `(.+?)`;", html, re.DOTALL)
if not m:
    print("FATAL: KIRA_SYSTEM抽出失敗")
    exit(1)
KIRA_SYSTEM = m.group(1)
print(f"✓ KIRA_SYSTEM抽出 ({len(KIRA_SYSTEM)}文字)")

# ========== フロント指示文抽出 ==========
m2 = re.search(r"lastMsg2\.content \+ '(\\n\\n\[指示[^']+)'", html)
FRONT_INSTR = m2.group(1).replace('\\n', '\n') if m2 else ""
print(f"✓ FRONT_INSTR抽出 ({len(FRONT_INSTR)}文字)")

# ========== KIRA呼び出し関数 ==========
def call_kira(messages):
    msgs = [m.copy() for m in messages]
    if msgs and msgs[-1]['role'] == 'user':
        msgs[-1]['content'] = msgs[-1]['content'] + FRONT_INSTR
    
    body = json.dumps({
        "system": KIRA_SYSTEM,
        "messages": msgs,
        "max_tokens": 1000
    }).encode('utf-8')
    
    req = urllib.request.Request(
        KIRA_PROXY + "/gyaku-mitsumori-chat",
        data=body,
        headers={'Content-Type': 'application/json'},
        method='POST'
    )
    
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            data = json.loads(res.read().decode('utf-8'))
        return data['content'][0]['text']
    except Exception as e:
        return f"ERROR: {e}"

# ========== 会話シミュレーション ==========
conversation = []
user_inputs = [
    "千葉県・木造・築20年・80㎡フルリノベ・賃貸用",
    "単世帯です。トイレ1個、洗面1個、お風呂1階、キッチン1個",
    "予算300万くらい。秋完成希望。他に気になる箇所はない",
    "プランを出してください",
]

for i, user_input in enumerate(user_inputs, 1):
    conversation.append({"role": "user", "content": user_input})
    print(f"\n{'='*70}")
    print(f"Turn {i} USER: {user_input}")
    print('='*70)
    
    reply = call_kira(conversation)
    print(f"\nKIRA:\n{reply}")
    
    conversation.append({"role": "assistant", "content": reply})
    
    if "===PLAN===" in reply:
        print(f"\n{'#'*70}")
        print(f"✅ Turn {i}でPLAN出力検出！")
        print('#'*70)
        break

# ========== PLAN抽出 ==========
final_reply = conversation[-1]['content']
plan_match = re.search(r"===PLAN===(.+?)===END===", final_reply, re.DOTALL)

if plan_match:
    print("\n\n========== 抽出したPLAN ==========")
    print(plan_match.group(0))
    print("====================================")

# ========== PDF出力テスト ==========
print("\n\n===== PDF生成テスト =====")
pdf_body = json.dumps({
    "koji_type": "gaiheki_30tsubo",
    "teiji_kingaku": 1800000,
    "region": "kanto",
    "customer_name": "テスト様（フルリノベ検証）"
}).encode('utf-8')

req = urllib.request.Request(
    PDF_GEN + "/generate-test",
    data=pdf_body,
    headers={'Content-Type': 'application/json'},
    method='POST'
)

try:
    with urllib.request.urlopen(req, timeout=60) as res:
        pdf_data = res.read()
    
    pdf_path = '/Users/oogatoshikatsu/Downloads/test-hs-pdf.pdf'
    with open(pdf_path, 'wb') as f:
        f.write(pdf_data)
    print(f"✓ PDF生成成功 ({len(pdf_data)} bytes)")
    print(f"→ {pdf_path}")
    
    subprocess.run(['open', pdf_path])
    print("✓ PDFを開きました")
except Exception as e:
    print(f"✗ PDF生成失敗: {e}")
