# -*- coding: utf-8 -*-
"""
patch_yakumo_ai_model.py (2026-08-15) — やくもの自動回答が止まった件の修理

何が起きたか:
  Cloudflare Workers AI の @cf/meta/llama-3.1-8b-instruct が 2026-05-30 に提供終了。
  hs-hearing がその1本に賭けていたため、KIRA経由の自動構造化が
  「llm-error:AiError: 5028 ... was dep」で落ち、加盟店の顧客対応が手動送りになった。

何を直すか:
  1) autopilot.js に AI_MODEL_CHAIN を新設して export する(単一の出どころ)
     現行のモデルを上から順に並べる。1本落ちても次で続く。
  2) autopilot.js のフォーカス判定を、廃止モデル直書きからチェーン参照へ
  3) hearing.js の llmStructure をチェーン方式へ。全滅したときは
     「何を試して何と言われたか」を理由に残す(黙って失敗しない)

fail-closed:
  - 既定は dry-run。--apply を付けた時だけ書く
  - 全アンカーは 期待1件。1件でなければ1バイトも書かない
  - 適用後に不変条件を検査し、失敗したら書かずに終了

使い方:
  cd ~/Desktop/hs-docfix
  python3 patch_yakumo_ai_model.py
  python3 patch_yakumo_ai_model.py --apply
"""
import io, sys

APPLY = "--apply" in sys.argv

A = "workers/hs-hearing/src/autopilot.js"
H = "workers/hs-hearing/src/hearing.js"

DEAD = '@cf/meta/llama-3.1-8b-instruct'

# ---------------------------------------------------------------- autopilot.js

A_CHAIN_ANCHOR = 'export const FOCUS_KEYS = ["recruit", "leads", "homeowners", "franchise", "brand"];'

A_CHAIN_NEW = '''/* ------------------------------ AIモデルの綱 ------------------------------ */
// Workers AI のモデルは予告のうえ提供終了になる。1本に賭けると、その日に顧客対応が止まる。
// 2026-05-30 に llama-3.1/3/2 系が終了し、実際に止まった。二度目は無い形にする。
// 上から順に試し、最初に応答したものを使う。env.LLM_MODEL が設定されていればそれを優先。
export const AI_MODEL_CHAIN = [
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/zai-org/glm-4.7-flash",
  "@cf/google/gemma-4-26b-a4b-it",
];

''' + A_CHAIN_ANCHOR

A_CALL_OLD = '''      const r = await env.AI.run(env.LLM_MODEL || "%s", {
        messages: [
          { role: "system", content: "Classify a Japanese contractor's primary goal. Reply with EXACTLY one word from: recruit, leads, homeowners, franchise, brand, unknown." },
          { role: "user", content: corpus.slice(0, 1500) },
        ], max_tokens: 8,
      });
      const out = S((r && (r.response || r.result)) || "", 40).toLowerCase();''' % DEAD

A_CALL_NEW = '''      const msgs = [
        { role: "system", content: "Classify a Japanese contractor's primary goal. Reply with EXACTLY one word from: recruit, leads, homeowners, franchise, brand, unknown." },
        { role: "user", content: corpus.slice(0, 1500) },
      ];
      let raw = "";
      for (const model of (env.LLM_MODEL ? [env.LLM_MODEL] : AI_MODEL_CHAIN)) {
        try {
          const r = await env.AI.run(model, { messages: msgs, max_tokens: 8 });
          raw = (r && (r.response || r.result)) || "";
          if (raw) break;
        } catch (_e) { /* 次のモデルへ。ここは補助判定なので落ちても本流は止めない */ }
      }
      const out = S(raw, 40).toLowerCase();'''

# ---------------------------------------------------------------- hearing.js

H_CALL_OLD = '''      const r = await env.AI.run(env.LLM_MODEL || "%s", { messages: [{ role: "system", content: sys }, { role: "user", content: usr }], max_tokens: 900 });
      out = (r && (r.response || r.result || r.output_text)) || "";''' % DEAD

H_CALL_NEW = '''      // モデル1本に賭けない。提供終了で顧客対応が止まった事故(2026-08-15)の再発防止。
      const tried = [];
      for (const model of (env.LLM_MODEL ? [env.LLM_MODEL] : AP.AI_MODEL_CHAIN)) {
        try {
          const r = await env.AI.run(model, { messages: [{ role: "system", content: sys }, { role: "user", content: usr }], max_tokens: 900 });
          out = (r && (r.response || r.result || r.output_text)) || "";
          if (out) break;
          tried.push(model + " -> empty");
        } catch (e) {
          tried.push(model + " -> " + String((e && e.message) || e).slice(0, 60));
        }
      }
      // 黙って失敗しない。何を試して何と言われたかを理由に残す。
      if (!out) return { ok: false, reason: "llm-all-models-failed: " + tried.join(" | ") };'''


def one(text, needle, label):
    n = text.count(needle)
    print("  %s %s: 期待1 実際%d" % ("OK " if n == 1 else "NG ", label, n))
    return n == 1


def main():
    at = io.open(A, encoding="utf-8").read()
    ht = io.open(H, encoding="utf-8").read()

    ok = True
    print("[autopilot] " + A)
    ok &= one(at, A_CHAIN_ANCHOR, "FOCUS_KEYS 行(綱の挿入点)")
    ok &= one(at, A_CALL_OLD, "廃止モデルの呼び出し")
    if "AI_MODEL_CHAIN" in at:
        print("  NG AI_MODEL_CHAIN が既にある(二重適用)"); ok = False

    print("[hearing] " + H)
    ok &= one(ht, H_CALL_OLD, "廃止モデルの呼び出し")
    ok &= one(ht, 'import * as AP from "./autopilot.js";', "AP の取り込み")
    if "AI_MODEL_CHAIN" in ht:
        print("  NG AI_MODEL_CHAIN が既にある(二重適用)"); ok = False

    if not ok:
        print("\n★ 前提が違う。1バイトも書かずに終了する。")
        sys.exit(1)

    if not APPLY:
        print("\ndry-run 合格。全アンカー一意。--apply を付ければ書く。")
        return

    anew = at.replace(A_CHAIN_ANCHOR, A_CHAIN_NEW, 1).replace(A_CALL_OLD, A_CALL_NEW, 1)
    hnew = ht.replace(H_CALL_OLD, H_CALL_NEW, 1)

    checks = [
        (anew.count("export const AI_MODEL_CHAIN") == 1, "autopilot: 綱の定義が1つ"),
        (anew.count("@cf/meta/llama-3.3-70b-instruct-fp8-fast") == 1, "autopilot: 先頭モデルが1つ"),
        (DEAD not in anew, "autopilot: 廃止モデルが消えた"),
        (anew.count("AI_MODEL_CHAIN") == 2, "autopilot: 定義と参照で2箇所"),
        (DEAD not in hnew, "hearing: 廃止モデルが消えた"),
        (hnew.count("AP.AI_MODEL_CHAIN") == 1, "hearing: 綱の参照が1つ"),
        (hnew.count("llm-all-models-failed") == 1, "hearing: 全滅時の理由が1つ"),
        (hnew.count("gpt-4o-mini") == ht.count("gpt-4o-mini"), "hearing: 外部LLM経路は触っていない"),
        (anew.count("FOCUS_KEYS") == at.count("FOCUS_KEYS"), "autopilot: FOCUS_KEYS の数は不変"),
    ]
    bad = [l for o, l in checks if not o]
    for o, l in checks:
        print("  %s %s" % ("OK " if o else "NG ", l))
    if bad:
        print("\n★ 適用後検査に失敗。書かずに終了する。")
        sys.exit(1)

    io.open(A, "w", encoding="utf-8", newline="").write(anew)
    io.open(H, "w", encoding="utf-8", newline="").write(hnew)
    print("\n書いた: %s" % A)
    print("書いた: %s" % H)
    print("\n次: 1) git add -f patch_yakumo_ai_model.py && git add %s %s" % (A, H))
    print("    2) git commit して push")
    print("    3) cd workers/hs-hearing && npx wrangler deploy")
    print("    4) 実際に1通流して、LINEに構造化結果が返るか確認する")


if __name__ == "__main__":
    main()
