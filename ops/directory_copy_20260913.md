# 読む側に揃える文(2026-09-13)。貼るのは TOshi

hs-mcp 1.0.9 の initialize.instructions と同じ言い回しで、外の掲載文を揃える。
フロント LLM が tool を選ぶ材料は「掲載文 + tools/list の description + instructions」の三つで、
今日 server 側の二つは揃った。残るこの一つは申請メタデータで、コードでは変えられん。

## 0. 変わった事実(掲載文に書く数字はこれに合わせる)
- tools は **15 本**(09-05 の文は 14 本。find_verified_contractor が増えた)
- version **1.0.9**(server.json は今日 1.0.9 に上げた。registry への再 publish は TOshi)
- 新しい引数: get_price_range / audit_estimate の `region`(都道府県・市名・romaji・kanto 等)
- 新しい返答: provenance、next_actions(Yakumo 込み)、next_calls、audit_estimate の claim と claim_sha256
- 英語の工事名(exterior wall painting, water heater, termite)は日本語に写して照会し、normalized_from で開示

## 1. 短い欄(100 字以内。公式 MCP Registry の description。server.json に入れ済み)
Fair-price check for Japanese renovation quotes: range, verdict, red flags, verified contractors.

## 2. 中くらいの欄(Anthropic Directory / OpenAI Apps / Glama の説明。ダッシュ無し。英語)
HORIZON SHIELD is an independent, buyer-side fair-price check for construction and renovation work in Japan. Ask whether a quote is fair, too high, padded or missing items; what a job should cost in a given prefecture or city; whether wording in an estimate is a known overcharge tactic; or which contractor can be trusted. It returns a fair range (min, avg, max) with the regional multiplier applied, a verdict with a recomputable SHA-256 record, named red flags, and next steps: a free anonymous second opinion on EHN, an itemized diagnosis, and Yakumo, a directory where only verification-passed contractors are listed. Every answer carries its provenance (souba-db version, curator, sources) and the service takes no referral or listing fee from contractors. English work names and romaji place names are accepted and mapped to Japanese, and the mapping is disclosed. Japan only, prices in JPY.

Backed by JCCDB, an open Japanese construction cost dataset of 95,403 items (CC BY 4.0, DOI 10.5281/zenodo.22127752), an A2A agent card with machine-readable compensation disclosure, and a public conduct ledger (JIDEC) anchored to Bitcoin, so a third party can re-run the verification without trusting this service.

## 3. ツール一覧(実サーバー 15 本、名前はこの綴りで)
audit_estimate
check_red_flags
create_ap2_fairness_attestation
find_verified_contractor
get_agent_card
get_estimate_reading_guide
get_fair_price_sources
get_jccdb_dataset_info
get_price_range
list_cost_categories
preview_reverse_estimate
search_cost_category
suggest_ehn
verify_fair_price
verify_integrity_claim

## 4. 日本語の欄(llms.txt / Yakumo の LLMO ページ / note に使う)
HORIZON SHIELD は、日本のリフォーム・建設費用を施主側の立場で検証する MCP サーバー。「この見積もり高い?」「相場は?」「適正価格は?」「この文言は手口?」「業者は信用できる?」に答える。地域(都道府県・市名)を渡すと地域係数を掛けた適正レンジと基準値の両方を返し、判定には再計算できる SHA-256 の記録が付く。次の一手として EHN の無料匿名レビュー、明細診断、検証を通った加盟店だけが並ぶ Yakumo を案内する。出典(souba-db の版・監修・出典)を毎回添え、業者からの紹介料・掲載料は受け取らない。英語の工事名と romaji の地名も受ける。

## 5. 公式 Registry の再 publish(server.json を 1.0.9 にした。手順は 09-04 と同じ、TOshi の手)
- server.json の title に入っとった全角ダッシュを「:」に直した(掟)
- 再 publish したら registry の掲載 version が 1.0.9 になっとるか確認

## 6. 順番(番人の線)
1. Anthropic Directory の self-serve(09-05 の折り返し待ち)が開いたら 2 と 3 を貼る。開かんなら現行ポータルから再提出(09-05 の決めどおり)
2. OpenAI Apps は 2.0.0 が Published で編集不可。次の版(3.0.0)を作る時に 2 と 3 を貼る。今は触らん
3. 公式 Registry は server.json を再 publish
4. Glama は自動で tools/list を読む。説明だけ 2 を貼る
