'use strict';
/**
 * note 連載の検査。ネットワークに出ない。投稿の前に毎回走らせる(workflow の「物語の検査」)。
 *   node note-post/test_story.js
 * 見ること:
 *   ・筋書きがそろっている(本編72話が1から順に、題・筋・目盛り・出す名前がある、題が重ならない)
 *   ・設定書、筋書き、書き置きの回に、長いダッシュも機械の名前も無い
 *   ・書き置きの回が門を通る
 *   ・次の話の選び方(本編 → 外伝の種 → 外伝の自由題、在庫が切れない)
 *   ・本文の整え方と門(見出し、記号、ダッシュ、前置き、社名、出す名前)
 *   ・note の全文、LINE の文に、フィクションの断り書きと会社の案内があり、機械の名前が無い
 *   ・同じ日に二度出さない
 *   ・書く部品(generate)が、門に落ちたら書き直し、無いモデルは飛ばし、自由題の題と目盛りを取り出す
 *   ・門に落ちた理由が次の書き直しの指示に入り、1 回目の指示には入らない
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('./story');

let fail = 0, checks = 0;
function check(label, cond, detail) {
  checks++;
  console.log((cond ? '  ok   ' : '  NG   ') + label + (detail ? '  ' + detail : ''));
  if (!cond) fail++;
}

const outline = S.loadOutline();
const bible = S.loadBible();
const mains = S.mainEpisodes(outline);
const seeds = S.gaidenSeeds(outline);

console.log('1) 筋書きがそろっている');
check('本編は72話', mains.length === 72, String(mains.length));
check('本編の番号が1から順に並ぶ', mains.every((e, i) => e.no === i + 1));
check('部は6つ', (outline.parts || []).length === 6);
check('どの話にも題・筋・目盛り・出す名前がある', mains.every((e) => e.title && e.beats && e.beats.length > 40 && e.line && Array.isArray(e.must) && e.must.length));
check('本編の題が重ならない', new Set(mains.map((e) => e.title)).size === mains.length);
const lines = mains.map((e) => e.line).filter((l) => l !== outline.motto);
check('目盛りの言葉が重ならない(芯の言葉を除く)', new Set(lines).size === lines.length);
check('芯の言葉は第7話と第70話', mains.filter((e) => e.line === outline.motto).map((e) => e.no).join(',') === '7,70');
check('社名を本文に出してよいのは第71話だけ', mains.filter((e) => e.allow_brand).map((e) => e.no).join(',') === '71');
check('外伝の種は20', seeds.length === 20);
check('外伝の種の題が重ならない、本編とも重ならない', new Set(seeds.map((g) => g.title).concat(mains.map((e) => e.title))).size === seeds.length + mains.length);
check('外伝の自由題の題材がある', (outline.gaiden_topics || []).length >= 10);

console.log('\n2) 設定書・筋書き・書き置きに、ダッシュも機械の名前も無い');
const files = ['bible.md', 'outline.json'].map((f) => path.join(S.STORY_DIR, f))
  .concat(fs.readdirSync(path.join(S.STORY_DIR, 'episodes')).map((f) => path.join(S.STORY_DIR, 'episodes', f)));
for (const f of files) {
  const t = fs.readFileSync(f, 'utf8');
  check(path.basename(f) + ' に長いダッシュが無い', !S.DASH_TEST.test(t));
  check(path.basename(f) + ' に機械の名前が無い', !S.MACHINE_RE.test(t));
}

console.log('\n3) 書き置きの回が門を通る');
const pre = fs.readdirSync(path.join(S.STORY_DIR, 'episodes')).filter((f) => f.endsWith('.txt'));
check('書き置きは3話以上', pre.length >= 3, pre.join(','));
for (const f of pre) {
  const key = f.replace(/\.txt$/, '');
  const ep = S.episodeByKey(outline, { posted: [] }, key);
  check(key + ' は筋書きにある', !!ep);
  if (!ep) continue;
  const body = fs.readFileSync(path.join(S.STORY_DIR, 'episodes', f), 'utf8');
  const g = S.gateBody(body, ep);
  check(key + ' が門を通る', g.ok, g.reasons.join(' / '));
  check(key + ' は整えても字が変わらない(もう整っている)', S.cleanBody(body).replace(/\s/g, '') === body.replace(/\s/g, ''));
}

console.log('\n4) 次の話の選び方(在庫が切れない)');
check('最初は第1話', S.nextEpisode(outline, { posted: [] }).key === 'main-001');
const st3 = { posted: ['main-001', 'main-002'].map((k) => ({ key: k, kind: 'main' })) };
check('2話出したら第3話', S.nextEpisode(outline, st3).key === 'main-003');
const stAllMain = { posted: mains.map((e) => ({ key: e.key, kind: 'main' })) };
check('本編を出し終えたら外伝1', S.nextEpisode(outline, stAllMain).key === 'gaiden-001');
const stAll = { posted: stAllMain.posted.concat(seeds.map((g) => ({ key: g.key, kind: 'gaiden' }))) };
const free = S.nextEpisode(outline, stAll);
check('外伝の種も出し終えたら、自由題の外伝21', free.free === true && free.key === 'gaiden-021', free.key);
check('自由題には題材がある', !!free.topic);
const stMore = { posted: stAll.posted.concat([{ key: 'gaiden-021', kind: 'gaiden' }]) };
check('自由題はその次も出る(在庫切れにならない)', S.nextEpisode(outline, stMore).key === 'gaiden-022');
check('残りの数', JSON.stringify(S.remaining(outline, st3)) === JSON.stringify({ main: 70, seeds: 20 }));
check('第1話の次の予告は第2話', S.peekNext(outline, { posted: [] }, mains[0]).key === 'main-002');
check('第72話の次の予告は外伝1', S.peekNext(outline, { posted: [] }, mains[71]).key === 'gaiden-001');
check('外伝20の次は自由題なので予告しない', S.peekNext(outline, { posted: [] }, seeds[19]) === null);

console.log('\n5) 整え方と門');
const ep4 = mains[3];
const long = 'ムニョスは航一と美波を見た。'.repeat(140);
const messy = '第4話「二十八年ぶりの握手」\n\n## 朝\n\n**ムニョス**は言った' + String.fromCharCode(0x2015, 0x2015) + '航一。\n***\n' + long + '\n\n今日の目盛り\n「屋根に」';
const c = S.cleanBody(messy);
check('題の行を落とす', !c.startsWith('第4話'));
check('見出しの行を落とす', !c.includes('## 朝') && !c.includes('#'));
check('太字の記号を落とす', !c.includes('*'));
check('ダッシュを三点リーダーに', !S.DASH_TEST.test(c) && c.includes('言った……航一'));
check('区切りの記号は ◇ に', c.includes('\n\n◇\n\n'));
check('今日の目盛りから後は落とす', !c.includes('今日の目盛り'));
check('整えた本文は門を通る', S.gateBody(c, ep4).ok, S.gateBody(c, ep4).reasons.join(' / '));
check('機械の名前があれば落とす', !S.gateBody(c + 'AIが', ep4).ok);
check('全角のAIも落とす', !S.gateBody(c + 'ＡＩ', ep4).ok);
check('英単語の中の AI は落とさない(例 SAID)', S.gateBody(c + 'SAID', ep4).ok);
check('前置きがあれば落とす', !S.gateBody('はい、書きました。' + c, ep4).ok);
check('社名があれば落とす', !S.gateBody(c + 'HORIZON SHIELD', ep4).ok);
check('第71話だけは社名を通す', S.gateBody(c + 'HORIZON SHIELD', Object.assign({}, ep4, { allow_brand: true })).ok);
check('出す名前が無ければ落とす', !S.gateBody(c.replace(/航一/g, '男'), ep4).ok);
check('短すぎれば落とす', !S.gateBody('ムニョスと航一と美波。', ep4).ok);
check('URL があれば落とす', !S.gateBody(c + 'https://example.com', ep4).ok);

console.log('\n6) note の全文と LINE の文');
const ep1 = mains[0];
const post = S.composePost(outline, ep1, 'ムニョスは本文。', mains[1]);
check('今日の目盛りが付く', post.includes('今日の目盛り\n「' + ep1.line + '」'));
check('次回の予告が付く', post.includes('次回 第2話「八つ目の雲」'));
check('フィクションの断り書きが付く', post.includes('この連載はフィクションです。'));
check('会社の案内とURLが付く', post.includes('HORIZON SHIELD は、住む人の側に立って') && post.includes(S.LP_URL));
check('LINE の相談先が付く', post.includes(S.LINE_URL));
check('全文に機械の名前が無い', !S.MACHINE_RE.test(post));
check('全文にダッシュが無い', !S.DASH_TEST.test(post));
check('最終話は本編完と外伝の知らせ', S.composePost(outline, mains[71], 'x', null).includes('本編 完'));
const bc = S.broadcastText(outline, ep1, 'https://note.com/horizon_shield/n/x');
check('LINE の友だちへの文に機械の名前が無い', !S.MACHINE_RE.test(bc) && bc.includes('続きを読む'));
const on = S.ownerNotice(outline, ep1, 'https://note.com/horizon_shield/n/x', { main: 71, seeds: 20 }, 'prewritten');
check('TOshi への知らせに X に貼る文', on.includes('X に貼る文') && on.includes('#連載小説'));
check('題の形', S.fullTitle(outline, ep1) === '『大工ムニョスは「一式」を許さない』第1話「見積書は、こっち側から読む」');

console.log('\n7) 同じ日に二度出さない');
const now = new Date('2026-10-01T00:05:00Z');
check('今朝(JST)出していれば、出さない', S.alreadyPostedToday({ posted: [{ key: 'main-001', at: '2026-10-01T00:01:00Z' }] }, now));
check('昨日なら出す', !S.alreadyPostedToday({ posted: [{ key: 'main-001', at: '2026-09-30T00:01:00Z' }] }, now));
check('JST の日付で見る(UTC では前日でも JST で今日なら出さない)', S.alreadyPostedToday({ posted: [{ key: 'main-001', at: '2026-09-30T23:30:00Z' }] }, now));

console.log('\n8) 公開した回を残す');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'story-'));
  const st = S.savePosted(ep1, 'ほんぶん', 'https://note.com/horizon_shield/n/abc', now, 'prewritten', tmp);
  check('state に残る', st.posted.length === 1 && st.posted[0].key === 'main-001' && st.posted[0].url.endsWith('/abc'));
  check('本文が posted/ に残る', fs.readFileSync(path.join(tmp, 'posted', 'main-001.txt'), 'utf8') === 'ほんぶん\n');
  const st2 = S.savePosted(ep1, 'ほんぶん2', 'u2', now, 'prewritten', tmp);
  check('同じ回を二度残しても一件', st2.posted.length === 1);
}

(async () => {
  console.log('\n9) 書く部品(模擬の応答で)');
  const good = S.cleanBody(messy);
  const mk = (responses) => {
    let i = 0; const seen = [];
    const users = [];
    const f = async (url, init) => {
      const body = JSON.parse(init.body); seen.push(body.model); users.push(body.messages[0].content);
      const r = responses[Math.min(i++, responses.length - 1)];
      return { ok: r.status === 200, status: r.status, json: async () => r.json };
    };
    f.seen = seen; f.users = users; return f;
  };
  const ctx = { bible, outline, state: { posted: [] }, prevBody: 'まえのはなし' };
  {
    const f = mk([{ status: 200, json: { content: [{ type: 'text', text: 'はい、書きました。\n' + good }] } },
                  { status: 200, json: { content: [{ type: 'text', text: good }] } }]);
    const r = await S.generate(ep4, ctx, { apiKey: 'k', fetchImpl: f, models: ['m1'], sleep: async () => {} });
    check('門に落ちたら書き直して通す', r.ok && r.tries === 2, JSON.stringify(r.reasons || ''));
  }
  {
    const f = mk([{ status: 404, json: { error: { type: 'not_found_error', message: 'model' } } },
                  { status: 200, json: { content: [{ type: 'text', text: good }] } }]);
    const r = await S.generate(ep4, ctx, { apiKey: 'k', fetchImpl: f, models: ['nai', 'aru'], sleep: async () => {} });
    check('無いモデルは飛ばして次で書く', r.ok && r.model === 'aru', f.seen.join(','));
  }
  {
    const noName = good.replace(/航一/g, 'あの人');
    const f = mk([{ status: 200, json: { content: [{ type: 'text', text: noName }] } },
                  { status: 200, json: { content: [{ type: 'text', text: good }] } }]);
    const r = await S.generate(ep4, ctx, { apiKey: 'k', fetchImpl: f, models: ['m1'], sleep: async () => {} });
    check('名が出ない稿は書き直して通す', r.ok && r.tries === 2, JSON.stringify(r.reasons || ''));
    check('1 回目の指示に、落ちた理由は入らない', f.users.length === 2 && !f.users[0].includes('前の稿は出せなかった'));
    check('2 回目の指示に、落ちた理由と名の書き方が入る', f.users[1].includes('前の稿は出せなかった。直す所: 「航一」が出てこない') && f.users[1].includes('必ず出す名前は、呼びかけや地の文で、本文の中に文字で書く'));
    check('2 回目の指示も、1 回目の指示をそのまま含む', f.users[1].startsWith(f.users[0]));
  }
  {
    const f = mk([{ status: 200, json: { content: [{ type: 'text', text: good.slice(0, 300) }] } },
                  { status: 200, json: { content: [{ type: 'text', text: good.slice(0, 300) }] } },
                  { status: 200, json: { content: [{ type: 'text', text: good }] } }]);
    const r = await S.generate(ep4, ctx, { apiKey: 'k', fetchImpl: f, models: ['m1'], sleep: async () => {} });
    check('短すぎる稿の理由と長さが次の指示に入り、理由は前の 1 回分だけ', r.ok && r.tries === 3 && f.users[1].includes('短すぎる(') && f.users[1].includes('長さは1800字から2400字') && f.users[2].split('前の稿は出せなかった').length === 2, JSON.stringify(r.reasons || ''));
    check('理由が無ければ足す文は空', S.retryNote([]) === '' && S.retryNote(['長すぎる(4000字)']).includes('長さは1800字から2400字') && !S.retryNote(['URL が本文にある']).includes('長さ'));
  }
  {
    const f = mk([{ status: 200, json: { content: [{ type: 'text', text: 'AIです' }] } }]);
    const r = await S.generate(ep4, ctx, { apiKey: 'k', fetchImpl: f, models: ['m1'], sleep: async () => {} });
    check('ずっと門に落ちれば、出さずに止める', !r.ok && r.reasons.length >= 1);
  }
  {
    const freeEp = S.nextEpisode(outline, stAll);
    const txt = '題: 雨どいの秋\n' + good.replace(/航一|美波/g, 'ムニョス') + '\n目盛り: 外す前に、何を付けるか聞く';
    const f = mk([{ status: 200, json: { content: [{ type: 'text', text: txt }] } }]);
    const r = await S.generate(freeEp, Object.assign({}, ctx, { usedTitles: [] }), { apiKey: 'k', fetchImpl: f, models: ['m1'], sleep: async () => {} });
    check('自由題の外伝は題と目盛りを取り出す', r.ok && r.title === '雨どいの秋' && r.line === '外す前に、何を付けるか聞く', JSON.stringify(r.reasons || r.title));
  }
  {
    const p = S.buildPrompt(bible, outline, { posted: [] }, ep4, 'まえ');
    check('指示に筋・目盛り・次の題・出す名前が入る', p.user.includes(ep4.beats) && p.user.includes(ep4.line) && p.user.includes('八日間の約束') && p.user.includes('必ず出す名前'));
    check('指示にこの部のこれまでが入る', p.user.includes('第3話「部長は、嘘をつかない」'));
    check('設定書が system に入る', p.system.includes('八雲の物差し'));
  }

  console.log('\n10) 見出し画像の絵(模擬の応答で)');
  {
    const A = require('./art');
    const b64 = Buffer.from('P'.repeat(400)).toString('base64');
    const ref = Buffer.from('R'.repeat(400)).toString('base64');
    const i1 = A.findImage({ output_image: { data: b64, mime_type: 'image/png' } });
    check('Interactions の形(output_image.data)から絵を取り出す', i1 && i1.data === b64 && i1.mime === 'image/png');
    const i2 = A.findImage({ candidates: [{ content: { parts: [{ text: 'x' }, { inlineData: { mimeType: 'image/jpeg', data: b64 } }] } }] });
    check('generateContent の形(inlineData)から絵を取り出す', i2 && i2.data === b64 && i2.mime === 'image/jpeg');
    const i3 = A.findImage({ input: [{ type: 'image', mime_type: 'image/png', data: ref }], outputs: [{ type: 'image', mime_type: 'image/png', data: b64 }] });
    check('渡した見本の絵を、返ってきた絵と取り違えない', i3 && i3.data === b64);
    check('絵が無い応答は null', A.findImage({ outputs: [{ type: 'text', text: 'no' }] }) === null);
    const ep1 = mains[0];
    const pr = A.artPrompt(outline, ep1, 'SCENE');
    check('絵の指示に場面・人物・舞台・禁止事項が入る', pr.includes('SCENE') && pr.includes('Muñoz') && pr.includes('Minami') && pr.includes('Haru') && pr.includes('Shiomi') && pr.includes('no text'));
    const pr7 = A.artPrompt(outline, mains[6], 'SCENE7');
    check('昔話の回は今の人物を描かせない', !pr7.includes('Muñoz') && !pr7.includes('Shiomi'));
    check('筋書きに場面がある回は、それを使う', (await A.sceneFromBeats(ep1, {})) === ep1.scene);
    check('場面が無く鍵も無ければ、決まり文句', (await A.sceneFromBeats(mains[20], {})).includes('Spanish carpenter'));
    check('OpenAI の形(data[0].b64_json)から絵を取り出す', (A.findImage({ data: [{ b64_json: b64 }], output_format: 'png' }) || {}).data === b64);
    // OpenAI で描く: 1つ目のモデルは 404、2つ目で絵が返る。寸法で断られたら次の寸法
    let calls = [];
    const f = async (url, init) => {
      const body = JSON.parse(init.body); calls.push(url.replace(/^https:\/\/[^/]+/, '') + ' ' + body.model + ' ' + (body.size || ''));
      if (body.model === 'm-nai') return { ok: false, status: 404, json: async () => ({ error: { message: 'model not found' } }) };
      if (body.size === '1536x864') return { ok: false, status: 400, json: async () => ({ error: { message: 'Invalid size' } }) };
      return { ok: true, status: 200, json: async () => ({ data: [{ b64_json: b64 }], output_format: 'png' }) };
    };
    const d = await A.drawOpenAI('p', [], { openaiKey: 'k', fetchImpl: f, openaiModels: ['m-nai', 'm-aru'] });
    check('無いモデルは飛ばし、寸法で断られたら横長の標準寸法で描く', d.ok && d.model === 'm-aru' && calls.some((c) => c.includes('1536x1024')), calls.join(' / '));
    check('見本が無いときは generations を使う', calls.every((c) => c.startsWith('/v1/images/generations')));
    // OpenAI が駄目なら Gemini に回る
    const f3 = async (url, init) => {
      if (String(url).includes('api.openai.com')) return { ok: false, status: 401, json: async () => ({ error: { message: 'bad key' } }) };
      return { ok: true, status: 200, json: async () => ({ output_image: { data: b64, mime_type: 'image/png' } }) };
    };
    const d3 = await A.drawAny('p', [], { openaiKey: 'k', geminiKey: 'g', fetchImpl: f3, openaiModels: ['m'], geminiModels: ['gm'] });
    check('OpenAI が駄目なら Gemini で描く', d3.ok && d3.via.startsWith('gemini'), JSON.stringify(d3.tried || ''));
    // 人物の見本が無ければ先に作って保存し、その回の絵に見本を添える(edits に images で渡す)
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'art-'));
    const sheet = path.join(tmp, 'cast.png');
    let sent = [];
    const f2 = async (url, init) => { const body = JSON.parse(init.body); sent.push(url.replace(/^https:\/\/[^/]+/, '') + ':' + ((body.images || []).length)); return { ok: true, status: 200, json: async () => ({ data: [{ b64_json: b64 }] }) }; };
    const a = await A.makeArt(outline, ep1, { openaiKey: 'k', fetchImpl: f2, openaiModels: ['m'], castSheetPath: sheet });
    check('見本が無ければ先に作って保存する', a.ok && fs.existsSync(sheet) && a.notes.some((n) => n.includes('見本を作った')));
    check('その回の絵は edits に見本を1枚添えて描く', sent.length === 2 && sent[0] === '/v1/images/generations:0' && sent[1] === '/v1/images/edits:1', JSON.stringify(sent));
    const a2 = await A.makeArt(outline, ep1, {});
    check('鍵が無ければ、絵なし(文字だけに戻る)', !a2.ok && a2.why.includes('OPENAI_API_KEY'));
    const html = S.eyecatchHtml(outline, ep1, 'data:image/png;base64,' + b64);
    check('絵があれば、絵を敷いた見出し画像になる', html.includes('class="art"') && html.includes('第1話') && html.includes('見積書は、こっち側から読む'));
    check('絵が無ければ、文字だけの見出し画像', !S.eyecatchHtml(outline, ep1).includes('class="art"'));
  }

  const EXPECT = 124;
  console.log('\n確かめた数: ' + checks + ' (最低 ' + EXPECT + ')');
  if (checks < EXPECT) { console.log('  NG   試験がまるごと走っていません。'); fail++; }
  console.log(fail ? fail + ' 件 失敗' : '連載の検査 すべて通過');
  process.exit(fail ? 1 : 0);
})();
