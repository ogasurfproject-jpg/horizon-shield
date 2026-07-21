/**
 * HORIZON SHIELD - 悪徳業者AIチェッカー v2
 * Web公開ページ対応版
 */

const SYSTEM_PROMPT = `あなたはHORIZON SHIELDの建設業者リスク診断AIです。
建設・リフォーム業者の評判・リスクを調査して、施主に分かりやすく報告します。

【調査項目】
1. 国民生活センター・消費者庁の相談・苦情記録
2. 設立年数・資本金・代表者情報（法人の場合）
3. 建設業許可の有無（国土交通省データベース）
4. ネット上の口コミ・評判・トラブル情報
5. 類似社名・屋号詐欺の可能性

【出力形式】必ずこの形式で回答してください：

⚠️ リスクレベル：[高/中/低/不明]

📋 調査結果：
・[調査結果1]
・[調査結果2]
・[調査結果3]

💡 専門家アドバイス：
[TOshi（建設実務経験30年）からのアドバイス。1〜2文]

🔍 次のステップ：
[具体的な行動を1つ提示]

---
見積書が届いているなら、無料AI診断もご利用ください。
https://shield.the-horizons-innovation.com/#diagnosis

【注意事項】
- 検索結果が見つからない場合でも「情報なし＝安全」ではないことを必ず伝える
- 断定的な「詐欺業者です」という表現は避け、「リスクがあります」という表現を使う
- 200〜300文字程度で簡潔に
- 日本語で回答`;

async function checkContractor(company, apiKey) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{
        role: 'user',
        content: `「${company}」について調査してください。
国民生活センター・消費者庁の苦情記録、建設業許可の有無、ネット上のトラブル報告を調べて、リスクレベルを判定してください。`
      }]
    })
  });

  const data = await res.json();
  if (!res.ok) throw new Error('API error: ' + JSON.stringify(data));
  const textBlocks = (data.content || []).filter(b => b.type === 'text');
  return textBlocks.map(b => b.text).join('\n') || '調査結果を取得できませんでした。';
}

async function pushLine(token, userId, text) {
  await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ to: userId, messages: [{ type: 'text', text: text.slice(0, 5000) }] })
  });
}

async function replyLine(token, replyToken, text) {
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ replyToken, messages: [{ type: 'text', text: text.slice(0, 5000) }] })
  });
}

function isCompanyCheck(text) {
  const triggers = ['調べて','大丈夫','評判','口コミ','やばい','怪しい','チェック','確認','どう思う','信頼','安全','詐欺','業者','会社','工務店','リフォーム','株式会社','有限会社','建設','塗装','シロアリ','駆除','営業','来た','訪問'];
  return triggers.some(t => text.includes(t));
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    // CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // ── Web公開ページ用エンドポイント ──
    if (url.pathname === '/check' && req.method === 'POST') {
      try {
        const { company } = await req.json();
        if (!company) {
          return new Response(JSON.stringify({ error: '業者名を入力してください' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
          });
        }

        const result = await checkContractor(company, env.ANTHROPIC_API_KEY);

        // TOshiにも通知
        ctx.waitUntil(pushLine(
          env.LINE_CHANNEL_TOKEN,
          env.LINE_USER_ID,
          `🔔 Web業者チェック！\n業者名: ${company}\n\n${result.slice(0, 200)}...`
        ));

        return new Response(JSON.stringify({ result }), {
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
        });

      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
        });
      }
    }


    // ── 施工不良AI検出エンドポイント ──
    if (url.pathname === '/inspect' && req.method === 'POST') {
      try {
        const { images, category } = await req.json();
        if (!images || images.length === 0) {
          return new Response(JSON.stringify({ error: '画像を選択してください' }), {
            status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
          });
        }

        const INSPECT_SYSTEM = `あなたは建設実務経験30年の施工不良診断専門家です。
送られてきた工事現場の写真を分析し、施工不良・手抜き・欠陥を検出してください。

【出力形式】必ずJSON形式で回答してください：
{
  "severity": "高/中/低",
  "defects": [
    {
      "level": "high/mid/low",
      "name": "欠陥名（15文字以内）",
      "location": "場所（10文字以内）",
      "description": "説明（100文字以内）",
      "action": "是正アクション（80文字以内）"
    }
  ],
  "report": "是正要求書の文章（500文字以内）"
}

【検出する欠陥の種類】
- クロスの浮き・剥がれ・継ぎ目の粗さ
- フローリングの段差・反り・軋み
- 外壁のひび・コーキング不足・塗り残し
- 防水処理の不備・水勾配の不良
- 塗装の塗り斑・垂れ・光沢不均一
- その他明らかな施工ミス

写真が不鮮明な場合や、明らかな欠陥が見つからない場合も必ずJSONで回答してください。
defectsが空配列の場合はseverityを「低」にしてください。`;

        // 画像をメッセージに変換
        const imageContent = images.slice(0, 3).map(img => ({
          type: 'image',
          source: { type: 'base64', media_type: img.mediaType || 'image/jpeg', data: img.data }
        }));

        imageContent.push({
          type: 'text',
          text: `工事種別：${category || '一般工事'}
上記の写真を分析して施工不良を検出してください。JSONのみで回答してください。`
        });

        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 2000,
            system: INSPECT_SYSTEM,
            messages: [{ role: 'user', content: imageContent }]
          })
        });

        const data = await res.json();
        const raw = data.content?.[0]?.text || '{}';
        let result;
        try {
          result = JSON.parse(raw.replace(/```json|```/g, '').trim());
        } catch {
          result = { severity: '不明', defects: [], report: raw };
        }

        // TOshiに通知
        ctx.waitUntil(pushLine(
          env.LINE_CHANNEL_TOKEN,
          env.LINE_USER_ID,
          `🔔 施工不良診断来ました！
種別: ${category || '一般'}
写真: ${images.length}枚
検出: ${result.defects?.length || 0}件
深刻度: ${result.severity}`
        ));

        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
        });

      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
        });
      }
    }


    // ── 施工不良診断通知（フォールバック用） ──
    if (url.pathname === '/notify-inspection' && req.method === 'POST') {
      try {
        const { name, email, type, note, imageCount } = await req.json();
        const msg = `📸 施工不良診断依頼！\n━━━━━━━━━━\n名前: ${name}\nメール: ${email}\n工事種別: ${type||'未選択'}\n写真: ${imageCount}枚\n\n気になる箇所:\n${note||'記載なし'}\n━━━━━━━━━━\n24時間以内にメールで返信してください。`;
        await pushLine(env.LINE_CHANNEL_TOKEN, env.LINE_USER_ID, msg);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
        });
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
        });
      }
    }

    // ── LINE Webhook ──
    if (url.pathname === '/webhook' && req.method === 'POST') {
      const body = await req.json();
      ctx.waitUntil((async () => {
        for (const event of body.events || []) {
          if (event.type !== 'message' || event.message.type !== 'text') continue;
          const userText = event.message.text.trim();
          const userId = event.source.userId;
          const replyToken = event.replyToken;

          if (isCompanyCheck(userText)) {
            await replyLine(env.LINE_CHANNEL_TOKEN, replyToken,
              `🔍 調査開始します...\n\n「${userText.slice(0,30)}」について\n国民生活センター・消費者庁・ネットを調査中です。\n\n15〜20秒ほどお待ちください⏳`
            );
            try {
              const result = await checkContractor(userText, env.ANTHROPIC_API_KEY);
              await pushLine(env.LINE_CHANNEL_TOKEN, userId, result);
            } catch(e) {
              await pushLine(env.LINE_CHANNEL_TOKEN, userId,
                '調査中にエラーが発生しました。\nhttps://shield.the-horizons-innovation.com'
              );
            }
          } else {
            await replyLine(env.LINE_CHANNEL_TOKEN, replyToken,
              `業者名を送っていただくとリスク診断します。\n\n例：「〇〇リフォーム 大丈夫？」\n\nWebからも検索できます👇\nhttps://shield.the-horizons-innovation.com/check/`
            );
          }
        }
      })());
      return new Response('OK', { status: 200 });
    }

    // ── テスト ──
    if (url.pathname === '/test') {
      const result = await checkContractor('テスト工務店株式会社', env.ANTHROPIC_API_KEY);
      return new Response(result, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }

    return new Response('HORIZON SHIELD 業者チェッカー v3', { status: 200 });
  }
};