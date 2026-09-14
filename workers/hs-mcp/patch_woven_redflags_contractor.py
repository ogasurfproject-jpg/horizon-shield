# -*- coding: utf-8 -*-
"""
patch_woven_redflags_contractor.py (2026-09-14)
red_flag_check と find_verified_contractor を woven-specific + recompute へ。
fail-closed: 各置換は「1回だけ一致」を確認してから当てる。1つでも外れたら1バイトも書かない。
使い方: cd ~/horizon-shield && python3 workers/hs-mcp/patch_woven_redflags_contractor.py
"""
import io, os, sys, time, shutil

P = "workers/hs-mcp/src/mcp.js"
FORBIDDEN = ["—", "–", "―", "−"]  # em / en / bar / minus

if not os.path.exists(P):
    print("NG %s が無い。リポジトリ根から実行しているか確認" % P); sys.exit(1)

src = io.open(P, encoding="utf-8").read()
edits = []  # (label, old, new)

# --- A: RED_FLAG_RULESET を追加 ---
A_old = 'const AUDIT_RULESET = { id: "hs-audit-verdict", version: "1" };'
A_new = A_old + '\nconst RED_FLAG_RULESET = { id: "hs-red-flag-universal", version: "1" };'
edits.append(("A ruleset", A_old, A_new))

# --- C: red_flag_check ハンドラ出力 ---
C_old = (
    '    return txt({\n'
    '      input: t, flags: hits.map(h => ({ severity: h.severity, warning: h.warning })),\n'
    '      result: hits.length + "件の注意点に該当しました。",\n'
    '      note: "これは代表的な手口の判定です。見積もり全体の網羅診断はKIRA(有料)で。",\n'
    '      source: "大賀俊勝(建設実務30年) / HORIZON SHIELD", full_diagnosis: SITE + "/hs-reverse-estimate/",\n'
    '      next_actions: NEXT_ACTIONS\n'
    '    });'
)
C_new = (
    '    return txt({\n'
    '      input: t, flags: hits.map(h => ({ severity: h.severity, warning: h.warning, self_check: h.self_check, matched_terms: h.key.filter(k => t.includes(k)) })),\n'
    '      result: hits.length + "件の注意点に該当しました。",\n'
    '      note: "これは代表的な手口の判定です。見積もり全体の網羅診断はKIRA(有料)で。",\n'
    '      how_to_act: "各 flag の self_check は、あなた自身が今その場で実行できる対抗手順です。warning が手口の説明、self_check が自分でできる確認です。",\n'
    '      ruleset: RED_FLAG_RULESET,\n'
    '      verify: "この判定は機械的です。あなたの文言に matched_terms の語が含まれるかだけで出しており、ルールセットは公開の代表的手口(hs-red-flag-universal v1)。matched_terms を自分の文言と照らせば、第三者が同じ判定を再計算できます。",\n'
    '      source: "大賀俊勝(建設実務30年) / HORIZON SHIELD", full_diagnosis: SITE + "/hs-reverse-estimate/",\n'
    '      next_actions: NEXT_ACTIONS\n'
    '    });'
)
edits.append(("C red_flag handler", C_old, C_new))

# --- D: find_verified_contractor に self_check を差し込む ---
D_old = ('      directory_size: { total_listed: all.length, verified_total: verifiedTotal, '
         'note: "名簿は小さい。0 件は 0 件と返す。 / The directory is small; zero is reported as zero." },')
D_new = (
    '      self_check: [\n'
    '        "検証済みかに関わらず、どの業者でも自分で確かめられる3点があります。",\n'
    '        "1) 建設業許可: 国土交通省の建設業者検索で許可番号を照合し、名義貸しや無許可を弾く。",\n'
    '        "2) 見積: 『一式』でなく数量×単価の内訳で出させ、audit_estimate の適正レンジと各項目を自分で照らす。",\n'
    '        "3) 追加費用: 別途工事の有無と諸経費の上限を、契約前に書面で固定する。"\n'
    '      ],\n'
    + D_old
)
edits.append(("D find_contractor self_check", D_old, D_new))

# 適用(各置換は1回だけ一致)
for label, old, new in edits:
    n = src.count(old)
    if n != 1:
        print("NG [%s] %d 箇所一致(1でない)。1バイトも書かずに中止。" % (label, n))
        print("    anchor head: %r" % old[:70]); sys.exit(1)
    src = src.replace(old, new)
    print("OK  [%s] 置換した" % label)

# --- B: RED_FLAGS_UNIVERSAL の各行に self_check を織り込む(行内注入) ---
SC = {
    'key: ["一式"':     '内訳を『数量×単価』の行に割らせ、audit_estimate の適正レンジと各項目を自分で照らす。割るのを渋る項目に過剰が隠れとる。',
    'key: ["諸経費"':   '諸経費の額を工事総額で割り、自分で比率を出す。0.16 を超えたら根拠を書面で問い、0.20 超は高い。',
    'key: ["今日"':     'その価格を3日後まで有効にして書面でくれと頼む。応じん割引は元値を盛った見せかけ。同じ条件で他社にも相見積もりを取る。',
    'key: ["訪問"':     'その場で契約せず、契約日を記録する。訪問販売は8日以内クーリングオフ可。業者名・住所・許可番号を必ず控える。',
    'key: ["知り合い"': '関係に関わらず、audit_estimate の適正レンジと相見積もりで単価を照らす。身内価格ほど第三者基準で確かめる。',
    'key: ["無料点検"': '危ないと言われた箇所を写真と劣化の程度で説明させ、別の業者にも同じ箇所を無料で見せる。2社が同じ所を指すかで真偽が分かる。',
}
mark = "const RED_FLAGS_UNIVERSAL = ["
start = src.find(mark)
if start < 0:
    print("NG RED_FLAGS_UNIVERSAL が無い"); sys.exit(1)
end = src.find("];", start)
if end < 0:
    print("NG RED_FLAGS_UNIVERSAL の閉じが無い"); sys.exit(1)
block = src[start:end]
lines = block.split("\n")
out, injected = [], 0
for ln in lines:
    sc = None
    for anchor, text in SC.items():
        if anchor in ln:
            sc = text; break
    if sc is not None:
        idx = ln.rfind('" }')
        if idx < 0:
            print("NG flag 行の末尾 '\" }' が無い: %r" % ln[:60]); sys.exit(1)
        ln = ln[:idx] + '", self_check: "' + sc + '" }' + ln[idx + 3:]
        injected += 1
    out.append(ln)
if injected != 6:
    print("NG self_check 注入 %d 件(6 でない)。中止。" % injected); sys.exit(1)
src = src[:start] + "\n".join(out) + src[end:]
print("OK  [B red_flags self_check] 6 件注入")

# 禁止ダッシュ混入チェック(新規追加分の語を狙って全体走査)
for d in FORBIDDEN:
    if d in "".join(SC.values()) + C_new + D_new + A_new:
        print("NG 追加テキストに禁止ダッシュ。中止。"); sys.exit(1)

# バックアップして書き出し
bak = P + ".bak." + time.strftime("%Y%m%dT%H%M%S")
shutil.copyfile(P, bak)
io.open(P, "w", encoding="utf-8").write(src)
print("")
print("書いた: %s" % P)
print("backup: %s" % bak)
print("self_check 総数: %d (red_flags 6)" % src.count("self_check:"))
print("RED_FLAG_RULESET: %s" % ("有" if "RED_FLAG_RULESET" in src else "無"))
