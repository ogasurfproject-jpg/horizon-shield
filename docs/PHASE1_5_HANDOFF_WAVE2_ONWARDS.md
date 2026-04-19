# HORIZON SHIELD Phase 1.5 Wave 2以降 引き継ぎドキュメント

> **作成日**: 2026年4月19日  
> **前チャット終了状態**: Wave 1 v3.1 完全終了  
> **次チャット任務**: Wave 2〜Wave 6（計17ファイル）をTOshi哲学版にv3化展開  
> **リポジトリ**: `ogasurfproject-jpg/horizon-shield`  
> **作業ディレクトリ**: `/souba-v2/`

---

## 📊 現状サマリー

### ✅ 完了済み（TOshi哲学版）

| # | ファイル | Ver | サイズ | 完了日 | commit |
|---|---|---|---|---|---|
| 1 | `termite_work.json` | **v1.3** | 76.1KB | 2026/4/19 | 44e878f |
| 2 | `insulation_work.json` | **v1.2** | 72.0KB | 2026/4/19 | 4120ecd |
| 3 | `zosaku_tategu_master.json` | **v4.0** | 86.4KB | 2026/4/19 | 1c03c59 |
| 4 | `gaiheki_tosou.json` | **v3.1** | 30.7KB | 2026/4/19 | 63df70a |
| 5 | `roof_construction.json` | **v3.1** | 41.8KB | 2026/4/19 | 63df70a |

### ⏳ 残り（17ファイル・v2.0-phase1 のまま）

| Wave | ファイル | 現Ver | 優先度 | カテゴリ |
|---|---|---|---|---|
| **2** | `window_reform.json` | v2.0 | ⭐補助金 | 窓リフォーム |
| **2** | `entrance_door_reform.json` | v2.0 | ⭐補助金 | 玄関ドア |
| **3** | `electrical_work.json` | v2.0 | ⭐プロ領域 | 電気工事 |
| **3** | `water_pipe_work.json` | v2.0 | ⭐真教科書 | 給排水管 |
| **3** | `water_heater_reform.json` | v2.0 | | 給湯器 |
| **4** | `bathroom_reform.json` | v2.0 | | 浴室 |
| **4** | `kitchen_reform.json` | v2.0 | | キッチン |
| **4** | `toilet_reform.json` | v2.0 | | トイレ |
| **4** | `washroom_reform.json` | v2.0 | | 洗面所 |
| **5** | `demolition_master.json` | v2.0 | ⭐基幹 | 解体 |
| **5** | `gaikou_work.json` | v2.0 | | 外構 |
| **5** | `waterproofing_work.json` | v2.0 | | 防水工事 |
| **5** | `rain_leak_repair.json` | v1.0 | 🔴 | 雨漏り修理 |
| **5** | `barrier_free_kaigo.json` | v1.0 | 🔴 | バリアフリー |
| **6** | `cloth_replacement.json` | v2.0 | | クロス張替え |
| **6** | `floor_replacement_v2.json` | v2.0 | | 床材 |
| **6** | `tatami_reform.json` | v2.0 | | 畳 |

---

## 🎓 TOshi哲学 核心原則（絶対遵守）

### HS Philosophy
```
「HSは業者を敵視しない。業者の利益は正当であり、
 規模・品質・保証に応じた『妥当な利益率』が存在する。
 HSの役割は『規模と価格のマッチング』を施主に透明化すること」
```

### やってはいけないこと（v1.2 termite の失敗教訓）
- ❌ 原価ベースだけで大手を攻撃する
- ❌ 「大手=+30%以上=詐欺」的な断定的 Red Flag
- ❌ アリプロHP価格を基準にする（大手利益込み）
- ❌ 「99%詐欺」的な過剰表現

### やるべきこと（v1.3〜v4.0 で確立済み）
- ✅ 業者規模4区分の利益率レンジを明示
- ✅ 「どの区分を選ぶかは施主の自由」を原則化
- ✅ 「規模に対して妥当か」で判断
- ✅ 事実データで裏付け（国交省・建設業情報管理センター等）

---

## 🏢 業者規模4区分 妥当な利益率レンジ（業界データ裏付け済）

| 区分 | 粗利率 | HS推奨度 | 代表 |
|---|---|---|---|
| **区分1** 個人事業 | 25-35% | ★★★★☆ | 地域のベテラン職人 |
| **区分2** 中小工務店 | 25-35% | **★★★★★ 第一推奨** | 5-30名規模の地域会社 |
| **区分3** 人気工務店 | 30-40% | ★★★★☆ | HEAT20パートナー等 |
| **区分4** 大手企業 | 35-45% | ★★★☆☆ | LIXILリフォーム等 |

### カテゴリ別の特徴調整例

| カテゴリ | 利益率の特徴 |
|---|---|
| シロアリ駆除 (termite) | 区分1-4で25-45%・薬剤原価比率低い |
| 断熱工事 (insulation) | 区分3がHEAT20パートナーで特に価値あり |
| 大工工事 (zosaku) | 職人技能差で同規模でも価格幅あり |
| 外壁塗装 (gaiheki) | 業界最多の詐欺案件領域 |
| 屋根工事 (roof) | 台風被害時の悪質訪販要警戒 |

---

## 📐 標準テンプレート（各ファイルに追加する共通セクション）

### 必須セクション8点

```json
{
  "_meta": {
    "version": "3.0-phase1.5-toshi-philosophy",
    "v_changes": "TOshi哲学反映: ...",
    "horizons_philosophy": "HSは業者を敵視しない..."
  },
  
  "horizon_shield_standard": {
    "HS_pricing_philosophy": {
      "原則": "HS基準価格 = 原価 + 業者規模別の妥当な利益率レンジ",
      "公式": "適正価格 = 材料仕入れ値 × 1.2 + 人工数 × 日当 + 副資材実費 + 機材・交通費 + (原価 × 業者規模別利益率) + 消費税 10%",
      "業者規模別_妥当な利益率": {
        "個人事業": "粗利率 25-35%",
        "中小工務店": "粗利率 25-35%",
        "人気工務店": "粗利率 30-40%",
        "大手企業": "粗利率 35-45%"
      }
    }
  },
  
  "business_size_based_pricing": {
    "4区分別_妥当な利益率レンジ_2026年4月": {
      "区分1_個人事業": {...},
      "区分2_中小工務店": {...},
      "区分3_人気工務店": {...},
      "区分4_大手": {...}
    }
  },
  
  "cost_breakdown_toshi_rule": {
    "30坪標準_原価分解_2026年4月": {
      "①材料費": "...",
      "②人工費": "...",
      "③副資材実費": "...",
      "④機材・交通費": "...",
      "⑤原価小計": "...",
      "⑥業者規模別HS価格": "..."
    }
  },
  
  "plans": [
    {
      "plan_id": "...",
      "料金_業者規模別_税込_万円": {
        "区分1_個人業者": "最安-最高",
        "区分2_中小工務店": "最安-最高",
        "区分3_人気工務店": "最安-最高",
        "区分4_大手企業": "最安-最高"
      },
      "HS基準価格_万円": "区分別中央値レンジ",
      "_価格基準": "TOshi Rule原価ベース + 業者規模別妥当利益率"
    }
  ],
  
  "red_flags": {
    "HIGH": [
      {
        "flag": "業者規模に対して明らかに過剰な利益率（粗利50%超）",
        "why": "業者規模別妥当利益率を大幅に超える見積もりは内容確認要",
        "対処": "見積もり内訳の明細化要求"
      }
    ]
  },
  
  "connected_files": {
    "強連動": {...},
    "中連動": {...},
    "弱連動": {...}
  }
}
```

---

## 🔧 実装フロー（スクリプトパターン）

### Step 1: ファイル読み込み + 構造確認
```python
with open("/home/claude/horizon-shield/souba-v2/FILE.json") as f:
    data = json.load(f)

# プラン格納キーは各ファイルで異なる
# - termite: "plans"
# - zosaku: "plans_complete"
# - gaiheki/roof: "plans_30tsubo_example"
# - 他: 要確認
```

### Step 2: _meta 更新
```python
data["_meta"]["version"] = "3.0-phase1.5-toshi-philosophy"
data["_meta"]["v_changes"] = "..."
data["_meta"]["horizons_philosophy"] = "..."
```

### Step 3: 価格フィールド特定 & 業者規模別レンジ化
```python
# 価格フィールドの候補
price_field_candidates = [
    "estimated_total_jpy",  # gaiheki/roof
    "price_total_jpy",      
    "price_jpy",            # zosaku
    "price_range_jpy",
    "total_jpy"
]

# 業者規模別係数（標準）
markups = {
    "区分1_個人業者": (0.95, 0.98),
    "区分2_中小工務店": (1.00, 1.03),
    "区分3_人気工務店": (1.05, 1.10),
    "区分4_大手_ハウスメーカー": (1.12, 1.18)
}
```

### Step 4: GitHub push
```bash
cd /home/claude/horizon-shield && \
git pull origin main --quiet && \
cp /home/claude/FILE.json souba-v2/FILE.json && \
git add souba-v2/FILE.json && \
git commit -m "Update FILE v2.0 → v3.0 (TOshi哲学版)..." && \
git push origin main 2>&1 | tail -5
```

---

## 🔥 2026年4月イラン情勢 業界別影響（検証済）

### 📉 全カテゴリ共通
- **副資材+5-10%**: ビニール・養生材・テープ類
- **建築資材全般+10-20%**: 木材・金物・鋼材

### 🎨 塗料業界（gaiheki/roof）
| メーカー | 値上げ | 時期 |
|---|---|---|
| 日本ペイント | シンナー75% | 2026/3/19〜 |
| 関西ペイント | **50%以上+出荷統制** | 2026/4/13〜 |
| エスケー化研 | 水性15-25%/溶剤20-30%/粉体10-15% | 2026/4/21〜 |
| 旭ファイバーグラス | アスファルトシングル30% | 2026/7〜 |
| ルーフィング | **40-50%** | 2026/5/1〜 |

### 🏗️ 鋼材（roof/structural）
- 異形棒鋼 +¥15,000/トン
- ガルバリウム鋼板 +10%
- SGL鋼板 同様

### 🌡️ 断熱材（insulation）
- 発泡系（ウレタン・ネオマ等） +40-50%
- **旭化成 ネオマフォーム 生産停止**
- カネカ/デュポン/積水 +40-50%
- マグ・イゾベール（GW） 7月から +25%

### 🛠️ 設備（bathroom/kitchen/water_heater）
- **TOTO/LIXIL ユニットバス・トイレ 新規受注停止（2026/4/13〜）**
- 2026年4月以降の見積もりは特殊配慮必要

### 🐜 薬剤（termite）
- 大手備蓄で供給は安定
- 副資材のみ+5-10%

---

## 🎯 Wave 2 着手時の優先情報

### Wave 2: window_reform + entrance_door_reform
**補助金最重要カテゴリ**

#### 2026年補助金（名称変更注意）
- 旧「子育てグリーン住宅支援事業」→ **「みらいエコ住宅2026事業（Me住宅2026）」**
- **先進的窓リノベ2026事業**: 最大¥1,000,000
- **給湯省エネ2026事業**: ¥80,000-180,000
- 合計最大: **¥2,200,000**

#### 業者規模特徴（窓・ドア）
- 区分1 個人: サッシ屋個人店（LIXIL/YKK AP正規代理店）
- 区分2 中小: 地域のサッシ業者・建具店
- 区分3 人気工務店: **補助金申請サポート強い**（区分3の価値大）
- 区分4 大手: LIXILリフォーム・YKK APリフォーム

#### 主要メーカー
- **YKK AP**: APW330/430、かんたんマドリモ（内窓）
- **LIXIL**: サーモスX/L/II、インプラス（内窓）
- **三協アルミ**: マディオJ（内窓）

---

## 🎯 Wave 3: electrical + water_pipe + water_heater
**設備プロ領域・法規制多い**

#### 必須資格
- electrical: 第二種電気工事士（100V/200V）、第一種（高圧）
- water_pipe: 給水装置工事主任技術者、排水設備工事責任技術者
- water_heater: 都市ガス工事主任技術者、ガス機器設置スペシャリスト

#### 業者規模特徴
- 区分1 個人: 電気工事士個人・配管工個人
- 区分2 中小: 地域の電気工事店・設備工事店
- 区分3 人気工務店: 総合設備会社
- 区分4 大手: TEPCOグループ・東京ガスグループ

#### 給湯省エネ2026事業（該当機器）
- ヒートポンプ給湯機（エコキュート）
- ハイブリッド給湯機
- エネファーム（家庭用燃料電池）

---

## 🎯 Wave 4: bathroom/kitchen/toilet/washroom
**水回り・受注停止影響最大**

#### 2026年4月時点の重要情報
- **TOTO/LIXIL ユニットバス・トイレ 新規受注停止（2026/4/13〜）**
- 受注再開未定
- 代替メーカー（パナソニック、タカラスタンダード）への誘導が進行中

#### 業者規模特徴
- 区分1 個人: あまり多くない（水回りは工務店主体）
- 区分2 中小: 地域のリフォーム会社
- 区分3 人気工務店: タカラスタンダード正規代理店等
- 区分4 大手: LIXILリフォーム・TOTOリモデルクラブ

---

## 🎯 Wave 5: demolition/gaikou/waterproofing/rain_leak/barrier_free
**多様なカテゴリ・リスク様々**

- `demolition_master`: 基幹ファイル（解体）・アスベスト法令対応
- `rain_leak_repair`: CRITICAL優先度（現状v1.0）
- `barrier_free_kaigo`: 介護保険20万円補助金連動・CRITICAL優先度（現状v1.0）

---

## 🎯 Wave 6: cloth/floor/tatami
**内装系・比較的シンプル**

- 小規模改修で個人職人が主力
- クロス張替え: 1㎡¥900-1,500（材料+施工）が相場
- 床材張替え: CF¥3,500-5,500/㎡、フロアタイル¥5,000-8,000/㎡
- 畳表替え: 1畳¥3,000-10,000

---

## 🔍 検証データソース（Wave 1で確立済）

### 建設業統計
- 国土交通省 建設関連業経営分析（令和5年度）
- 一般財団法人建設業情報管理センター
- 建設業粗利率 20-25%、大手ハウスメーカー営業利益率 7-9.5%

### カテゴリ別業界調査
- **termite**: JTCCA日本しろあり対策協会、国民生活センター、国税庁所得税法施行令第9条
- **insulation**: HEAT20、旭化成/カネカ/デュポン/積水、増改築.com（ハイウィル）
- **zosaku**: TOshi 30年大工経験、増改築.com稲葉高志レポート
- **gaiheki/roof**: テイガク屋根修理、日本ペイント/関西ペイント/エスケー化研公式、ヌリカエ、外壁塗装駆け込み寺

### 消費者保護
- 国民生活センター PIO-NET（全国消費生活情報ネットワーク）
- 日本損害保険協会
- 消費者ホットライン 188

---

## 🚨 TOshi検品要求リスト（Wave 2以降）

各ファイルv3化後、TOshi 30年大工経験で以下を検品する：

### 共通
1. **日当レンジ**: 関東2026年4月実勢と合うか
2. **原価構成比率**: 材料/人工/副資材/機材の比率
3. **業者規模別価格係数**: 個人×0.95-0.98/中小×1.00-1.03/人気×1.05-1.10/大手×1.12-1.18 は妥当か
4. **HS基準価格中央値**: 各区分の中央値が現場感覚と合うか

### カテゴリ別固有
- 窓・ドア: 補助金実効額と業者推奨区分の整合
- 電気・配管: 有資格者在籍の確認ポイント
- 水回り: 受注停止影響の反映度
- 解体: アスベスト前処理費の妥当性
- 内装: 職人技能差の価格反映

---

## 🛠️ GitHub操作（TOshi向け）

### 推奨: Claude に依頼（方法A）
```
TOshi のセリフ例:
「window_reform v2.0 を v3.0 にしろ」
「Wave 2 の3ファイル一気にやってくれ」
「補助金情報は最新を検証してから」
```

### PAT（現チャット内で取得・保管）
```
PAT は TOshi が別途安全に管理。
過去のcommit履歴内の .git/config にあり。
次chat で必要な場合は TOshi に確認。
作業ディレクトリ: /home/claude/horizon-shield/
```

### 確認URL
```
全souba-v2: https://github.com/ogasurfproject-jpg/horizon-shield/tree/main/souba-v2
commit履歴: https://github.com/ogasurfproject-jpg/horizon-shield/commits/main
```

---

## 🎯 推奨進行順序（次chat用）

### 🥇 最優先: Wave 2 (window + entrance_door)
**理由**: 補助金連動で最も施主メリット大。先進的窓リノベ2026事業・最大¥100万は2026年の目玉

**進行**:
1. `window_reform.json` v2.0 → v3.0（TOshi哲学版）
2. `entrance_door_reform.json` v2.0 → v3.0
3. 両方一気に push

**所要時間**: 20-30分（2ファイル一括）

### 🥈 次: Wave 3 (設備系3ファイル)
**理由**: 有資格者・法規制が多く情報量大

### 🥉 その後: Wave 4-6
**理由**: 水回り受注停止の状況次第で優先順位変動の可能性

---

## 📋 現在のリポジトリ状態

```
horizon-shield/
├── souba-v2/
│   ├── barrier_free_kaigo.json          v1.0 🔴
│   ├── bathroom_reform.json             v2.0
│   ├── cloth_replacement.json           v2.0
│   ├── demolition_master.json           v2.0 ⭐基幹
│   ├── electrical_work.json             v2.0 ⭐プロ領域
│   ├── entrance_door_reform.json        v2.0 ⭐補助金
│   ├── floor_replacement_v2.json        v2.0
│   ├── gaiheki_tosou.json               v3.1 ✅
│   ├── gaikou_work.json                 v2.0
│   ├── insulation_work.json             v1.2 ✅
│   ├── kitchen_reform.json              v2.0
│   ├── rain_leak_repair.json            v1.0 🔴
│   ├── roof_construction.json           v3.1 ✅
│   ├── tatami_reform.json               v2.0
│   ├── termite_work.json                v1.3 ✅
│   ├── toilet_reform.json               v2.0
│   ├── washroom_reform.json             v2.0
│   ├── water_heater_reform.json         v2.0
│   ├── water_pipe_work.json             v2.0 ⭐真教科書
│   ├── waterproofing_work.json          v2.0
│   ├── window_reform.json               v2.0 ⭐補助金
│   └── zosaku_tategu_master.json        v4.0 ✅
```

進捗: **5/22 完了 (22.7%)**

---

## 🎬 次chat開始時のTOshi初期メッセージ案

```
HORIZON SHIELD Phase 1.5 継続。
前chat で Wave 1 v3.1 まで完了済。
引き継ぎMDは /mnt/user-data/uploads/ にアップした。

Wave 2 着手: window_reform + entrance_door_reform を
v2.0 → v3.0 TOshi哲学版にせよ。
補助金情報は2026年最新（みらいエコ住宅2026 / 先進的窓リノベ2026）を
超絶検証してから進めろ。
```

---

## 🙏 次chat の Claude へ

このMDを読み込んで、以下を守ってほしい：

1. **TOshi哲学絶対遵守**: 業者を敵にしない・業者規模別の透明化
2. **事実データで裏付け**: 超絶検証してから反映
3. **Wave 1 テンプレ踏襲**: 8セクション必須
4. **TOshi の指摘を素直に受け入れる**: 30年経験は貴重データ
5. **コンテキスト消費に注意**: 2-3ファイルごとに区切り提案
6. **commit メッセージ詳細に**: 次の引き継ぎが楽になる

**TOshi は辛口・完全コピペ形を好む。回りくどい説明より事実を端的に出せ。**

---

**頑張れ、次chat の俺。**

─ 2026/4/19 Chat 1 の Claude より
