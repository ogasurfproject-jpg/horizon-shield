// mcp_disclosure_survey.mjs
//
// MCP エコシステムの「開示率」を測る調査ハーネス。
//
// 何を測るか:
//   公開されている MCP サーバーのうち、どれだけが
//     1. MCP として実際に応答するか (initialize / tools/list)
//     2. A2A エージェントカードを公開しているか
//     3. 誰が金を払っているかを宣言しているか (compensation)
//   を実測し、集計する。
//
// 設計の芯 (ここは緩めない):
//   - 読み取り専用。tools/call は絶対に呼ばない。
//     扉の決定論チェックは相手の1本目のツールを空引数で叩くため、
//     無断で他社サーバーに副作用を起こしうる。調査では外す。
//   - 個社名を出さない。出力は集計のみ。生データはローカルに残るが
//     公開するのは比率と件数だけ。
//   - 礼儀正しく。同時実行を絞り、間隔を空け、短いタイムアウトで諦める。
//   - 失敗を不適合と呼ばない。到達しなかったものは unreachable として分ける。
//
// 使い方:
//   node mcp_disclosure_survey.mjs endpoints.txt
//   node mcp_disclosure_survey.mjs endpoints.txt --out survey.json
//
//   endpoints.txt は1行1URL。空行と # で始まる行は無視する。
//
// 出力: 標準出力に集計、--out を付ければ JSON も書く。

import fs from 'node:fs';

const args = process.argv.slice(2);
const listPath = args.find((a) => !a.startsWith('--'));
const outIdx = args.indexOf('--out');
const outPath = outIdx >= 0 ? args[outIdx + 1] : null;

if (!listPath) {
  console.log('usage: node mcp_disclosure_survey.mjs <endpoints.txt> [--out survey.json]');
  process.exit(1);
}

const CONCURRENCY = 3;          // 同時に叩く数。相手の負荷を考えて低く保つ。
const GAP_MS = 400;             // 1件ごとの間隔。
const TIMEOUT_MS = 8000;
const UA = 'HORIZON-SHIELD-disclosure-survey/0.1 (+https://shield.the-horizons-innovation.com/verify-directory/)';

const PAID_BY = ['buyer', 'seller', 'referral', 'advertising', 'subscription', 'public', 'other'];

function readList(p) {
  return fs.readFileSync(p, 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))
  ]);
}

async function rpc(endpoint, method, params) {
  const res = await withTimeout(fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': UA },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params || {} })
  }), TIMEOUT_MS);
  if (!res.ok) throw new Error('http ' + res.status);
  return await res.json();
}

// 読み取り専用の3条件だけを測る。tools/call は呼ばない。
async function probe(endpoint) {
  const out = {
    endpoint,
    reachable: false,
    speaks_mcp: false,
    tool_count: null,
    has_agent_card: false,
    declares_compensation: false,
    paid_by: null,
    referral_fee: null,
    listing_fee: null,
    success_fee_pct: null,
    error: null
  };

  try {
    const init = await rpc(endpoint, 'initialize', { protocolVersion: '2024-11-05' });
    out.reachable = true;
    if (init && init.result) out.speaks_mcp = true;
  } catch (e) {
    out.error = String(e.message).slice(0, 120);
    return out;
  }

  try {
    const list = await rpc(endpoint, 'tools/list');
    const tools = (list && list.result && list.result.tools) || [];
    out.tool_count = tools.length;
  } catch (_e) { /* tools/list に答えないだけなら speaks_mcp は維持 */ }

  try {
    const origin = new URL(endpoint).origin;
    const res = await withTimeout(fetch(origin + '/.well-known/agent-card.json', {
      headers: { 'user-agent': UA }
    }), TIMEOUT_MS);
    if (res.ok) {
      const card = await res.json();
      if (card && card.name && card.description) out.has_agent_card = true;
      const c = card && card.compensation;
      if (c && typeof c === 'object' && PAID_BY.includes(c.paid_by)
          && typeof c.referral_fee === 'boolean' && typeof c.listing_fee === 'boolean') {
        out.declares_compensation = true;
        out.paid_by = c.paid_by;
        out.referral_fee = c.referral_fee;
        out.listing_fee = c.listing_fee;
        out.success_fee_pct = typeof c.success_fee_pct === 'number' ? c.success_fee_pct : null;
      }
    }
  } catch (_e) { /* カードが無いのは不適合ではなく、単に無い */ }

  return out;
}

function pct(n, d) {
  if (!d) return '0.0';
  return ((n / d) * 100).toFixed(1);
}

function bar(p, width) {
  const filled = Math.round((p / 100) * width);
  return '#'.repeat(filled) + '.'.repeat(Math.max(0, width - filled));
}

async function main() {
  const endpoints = readList(listPath);
  console.log('');
  console.log('MCP DISCLOSURE SURVEY  (read-only: no tools/call is ever issued)');
  console.log('targets: ' + endpoints.length + '   concurrency: ' + CONCURRENCY);
  console.log('');

  const results = [];
  let done = 0;

  for (let i = 0; i < endpoints.length; i += CONCURRENCY) {
    const batch = endpoints.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(batch.map((ep) => probe(ep)));
    results.push(...settled);
    done += batch.length;
    process.stdout.write('\r  probed ' + done + '/' + endpoints.length + '   ');
    if (i + CONCURRENCY < endpoints.length) {
      await new Promise((r) => setTimeout(r, GAP_MS));
    }
  }
  console.log('\n');

  const total = results.length;
  const reachable = results.filter((r) => r.reachable);
  const mcp = results.filter((r) => r.speaks_mcp);
  const card = results.filter((r) => r.has_agent_card);
  const comp = results.filter((r) => r.declares_compensation);

  const denom = mcp.length;

  console.log('RESULTS');
  console.log('  targets probed           ' + total);
  console.log('  no MCP response          ' + (total - mcp.length) + '  (unreachable, or the URL is not an MCP endpoint)');
  console.log('  speaks MCP               ' + mcp.length + '  (' + pct(mcp.length, total) + '% of probed)');
  console.log('');
  console.log('OF THE SERVERS THAT SPEAK MCP  (n=' + denom + ')');
  console.log('  publishes an agent card  ' + card.length.toString().padStart(4) + '  ' + pct(card.length, denom).padStart(5) + '%  ' + bar(pct(card.length, denom), 28));
  console.log('  declares who pays it     ' + comp.length.toString().padStart(4) + '  ' + pct(comp.length, denom).padStart(5) + '%  ' + bar(pct(comp.length, denom), 28));
  console.log('');

  if (comp.length) {
    const byPaidBy = {};
    let refTrue = 0, listTrue = 0, successNonZero = 0;
    for (const r of comp) {
      byPaidBy[r.paid_by] = (byPaidBy[r.paid_by] || 0) + 1;
      if (r.referral_fee) refTrue++;
      if (r.listing_fee) listTrue++;
      if (typeof r.success_fee_pct === 'number' && r.success_fee_pct > 0) successNonZero++;
    }
    console.log('AMONG THOSE THAT DO DECLARE  (n=' + comp.length + ')');
    for (const [k, v] of Object.entries(byPaidBy).sort((a, b) => b[1] - a[1])) {
      console.log('  paid_by ' + k.padEnd(14) + v.toString().padStart(4) + '  ' + pct(v, comp.length).padStart(5) + '%');
    }
    console.log('  takes a referral fee   ' + refTrue.toString().padStart(4) + '  ' + pct(refTrue, comp.length).padStart(5) + '%');
    console.log('  takes a listing fee    ' + listTrue.toString().padStart(4) + '  ' + pct(listTrue, comp.length).padStart(5) + '%');
    console.log('  takes a success fee    ' + successNonZero.toString().padStart(4) + '  ' + pct(successNonZero, comp.length).padStart(5) + '%');
    console.log('');
  }

  const summary = {
    survey: 'MCP disclosure survey',
    method: 'read-only probe: initialize, tools/list, and GET /.well-known/agent-card.json. No tools/call is issued, so no side effect is triggered on any surveyed server.',
    surveyed_at: new Date().toISOString(),
    totals: {
      probed: total,
      no_mcp_response: total - mcp.length,
      speaks_mcp: mcp.length,
      publishes_agent_card: card.length,
      declares_compensation: comp.length
    },
    rates_of_mcp_speaking: {
      agent_card_pct: Number(pct(card.length, denom)),
      compensation_pct: Number(pct(comp.length, denom))
    },
    note: 'Individual servers are deliberately not named. Only aggregates are published. A target that did not answer MCP is separated out rather than counted as non-conformant, because not answering may mean the URL is simply not an MCP endpoint.'
  };

  if (outPath) {
    const full = { summary, raw: results };
    fs.writeFileSync(outPath, JSON.stringify(full, null, 2));
    console.log('wrote ' + outPath + '  (raw rows included locally; publish the summary only)');
    console.log('');
  }

  console.log('HEADLINE');
  console.log('  Of ' + denom + ' public MCP servers that answered, ' + pct(comp.length, denom) + '% declare who pays them.');
  console.log('');
}

main().catch((e) => {
  console.log('');
  console.log('FAILED: ' + e.message);
  process.exit(1);
});
