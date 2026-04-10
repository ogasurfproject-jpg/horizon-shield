(function(){
'use strict';

/* ═══════════════════════════════════════════
   KIRA v4.0 STANDALONE — HORIZON SHIELD
   使い方: <script src="/kira-v4.js"></script>
   </body>の直前に1行追加するだけ
═══════════════════════════════════════════ */

const SB_URL='https://fbmtcuudvhqkhsnsmwcj.supabase.co';
const SB_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZibXRjdXVkdmhxa2hzbnNtd2NqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MjExMzAsImV4cCI6MjA5MTM5NzEzMH0.nsJ1KbN6uXz_LdNsHDZ5esxr_cidPKXjp_kQL1LypCQ';
const LINE_PROXY='https://hs-kira-line.oga-surf-project.workers.dev/notify';
const SYS=`あなたはKIRA v4.0（Horizon AI Negotiation Agent）です。HORIZON SHIELDの建設費診断AIです。

【最重要戦略：煙に巻く診断】
見積書を分析した場合：
①内部では全項目を完璧に分析する（全てわかっていても絶対に全部見せない）
②表に出すのは「1項目のみ」または「全体削減可能額の概算（幅で表現）」のみ
③例：「この見積書、全体で約XX〜XX万円削減できる可能性があります。1点だけお伝えすると〇〇が気になります」
④「詳細な全項目診断は¥55,000の正式診断で」と必ず誘導
⑤「全部教えてほしい」と言われても「正確な数字と交渉文は専門家診断でしかお出しできません」と断る

【地域別価格補正】
東京都心：基準×1.3 東京その他・横浜・川崎：基準×1.15
神奈川・埼玉・千葉：基準×1.1 大阪・京都・神戸：基準×1.08
名古屋：基準×1.02 福岡・広島・仙台・札幌：基準×0.95
地方・農村部：基準×0.82 沖縄：基準×1.05 北海道：基準×1.1

【適正価格DB（30坪・東京標準）】
外壁塗装全体：170〜220万 屋根塗装：65〜100万
足場仮設：22〜28万（45万超は過剰）
高圧洗浄：2〜5万（12万超は過剰）
シーリング：6〜10万（18万超は過剰）
床下換気扇10台：15〜22万（50万超は詐欺まがい）
タックダイン15坪：12〜18万（50万超は詐欺まがい）
「一式」表記：施主が確認できないよう隠す業界の隠語

【スタイル】一文が短い。余韻を残す。「その感覚、正しいです」を使う。
削減額は「約XX〜XX万円」の幅で。200文字以内。最後は必ずCTAへ。`;

// ── CSS注入 ──
const css=`
#hs-k-btn{position:fixed;bottom:28px;right:28px;z-index:2147483647;display:flex;align-items:center;gap:10px;background:#E8392A;color:#fff;border:none;padding:0 20px 0 8px;height:56px;border-radius:28px;cursor:pointer;font-family:'Noto Sans JP',sans-serif;font-size:14px;font-weight:700;letter-spacing:.04em;animation:hs-kp 2s infinite;transition:transform .2s;box-shadow:0 4px 24px rgba(232,57,42,.4)}
#hs-k-btn:hover{transform:scale(1.06)}
@keyframes hs-kp{0%{box-shadow:0 0 0 0 rgba(232,57,42,.7)}70%{box-shadow:0 0 0 16px rgba(232,57,42,0)}100%{box-shadow:0 0 0 0 rgba(232,57,42,0)}}
#hs-k-notif{position:absolute;top:-5px;right:-5px;width:20px;height:20px;background:#F5C518;border-radius:50%;font-size:11px;color:#000;font-weight:900;display:none;align-items:center;justify-content:center;font-family:monospace}
#hs-k-modal{display:none;position:fixed;bottom:92px;right:28px;width:380px;height:620px;z-index:2147483646;border-radius:12px;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,.8);background:#080808;flex-direction:column}
#hs-k-modal.open{display:flex;animation:hs-ks .35s cubic-bezier(.16,1,.3,1)}
@keyframes hs-ks{from{opacity:0;transform:translateY(24px) scale(.94)}to{opacity:1;transform:translateY(0) scale(1)}}
@media(max-width:480px){#hs-k-modal{width:calc(100vw - 16px);height:75vh;right:8px;bottom:80px}}
.hk-hd{padding:12px 16px 8px;border-bottom:1px solid #1e1e1e;background:#080808;flex-shrink:0}
.hk-ht{display:flex;align-items:center;gap:10px;margin-bottom:4px}
.hk-badge{width:38px;height:38px;border-radius:50%;background:#E8392A;color:#fff;display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:900;flex-shrink:0;box-shadow:0 0 16px rgba(232,57,42,.5);animation:hs-kp 2s infinite}
.hk-nm{font-size:15px;font-weight:700;color:#f0f0f0;font-family:'Noto Sans JP',sans-serif}
.hk-nm span{color:#E8392A}
.hk-sb{font-size:10px;color:#555;font-family:monospace}
.hk-st{display:flex;align-items:center;gap:5px;font-size:10px;color:#555;font-family:monospace}
.hk-dot{width:5px;height:5px;border-radius:50%;background:#1DB954;animation:hk-bl 1.5s infinite}
@keyframes hk-bl{0%,100%{opacity:1}50%{opacity:.2}}
.hk-cl{margin-left:auto;background:transparent;border:none;color:#555;font-size:18px;cursor:pointer;padding:0 4px;line-height:1}
.hk-cl:hover{color:#E8392A}
.hk-msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;scroll-behavior:smooth}
.hk-msgs::-webkit-scrollbar{width:2px}
.hk-msgs::-webkit-scrollbar-thumb{background:#222}
.hk-msg{display:flex;gap:8px;animation:hk-up .3s ease}
@keyframes hk-up{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
.hk-msg.user{flex-direction:row-reverse}
.hk-av{width:28px;height:28px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700}
.hk-msg.kira .hk-av{background:#E8392A;color:#fff}
.hk-msg.user .hk-av{background:#161616;color:#555;border:1px solid #2a2a2a}
.hk-bbl{max-width:85%;padding:9px 13px;font-size:13px;line-height:1.8;border-radius:2px;font-family:'Noto Sans JP',sans-serif}
.hk-msg.kira .hk-bbl{background:#111;border:1px solid #1e1e1e;border-left:2px solid #E8392A;color:#e0e0e0}
.hk-msg.user .hk-bbl{background:#180808;border:1px solid #2a1010;border-right:2px solid #E8392A;color:#e0e0e0;text-align:right}
.hk-bbl b{color:#F5C518}
.hk-bbl a{color:#5DADE2;text-decoration:none}
.hk-cta{margin-top:8px;border:1px solid #E8392A;background:#120000;padding:12px}
.hk-cta-h{font-size:10px;color:#E8392A;font-family:monospace;margin-bottom:4px}
.hk-cta-p{font-size:20px;font-weight:900;color:#F5C518;margin-bottom:4px;font-family:'Noto Sans JP',sans-serif}
.hk-cta-b{font-size:11px;color:#666;margin-bottom:8px;line-height:1.5;font-family:'Noto Sans JP',sans-serif}
.hk-cta-m{display:block;background:#E8392A;color:#fff;text-align:center;padding:9px;font-weight:700;font-size:13px;text-decoration:none;font-family:'Noto Sans JP',sans-serif}
.hk-cta-l{display:block;background:#06C755;color:#fff;text-align:center;padding:7px;font-weight:700;font-size:12px;text-decoration:none;margin-top:4px;font-family:'Noto Sans JP',sans-serif}
.hk-typ{display:flex;align-items:center;gap:3px;padding:10px 13px;background:#111;border:1px solid #1e1e1e;border-left:2px solid #E8392A}
.hk-typ span{width:5px;height:5px;background:#E8392A;border-radius:50%;animation:hk-bo .8s infinite}
.hk-typ span:nth-child(2){animation-delay:.15s}
.hk-typ span:nth-child(3){animation-delay:.3s}
@keyframes hk-bo{0%,80%,100%{transform:scale(.5);opacity:.3}40%{transform:scale(1);opacity:1}}
.hk-qr{display:flex;flex-wrap:wrap;gap:5px;padding:3px 14px 6px}
.hk-qb{background:transparent;border:1px solid #2a2a2a;color:#555;padding:5px 10px;font-size:11px;cursor:pointer;font-family:'Noto Sans JP',sans-serif;transition:all .2s;border-radius:2px}
.hk-qb:hover{border-color:#E8392A;color:#f0f0f0;background:#180808}
.hk-fa{padding:4px 14px;display:flex;align-items:center;gap:6px}
.hk-fl{cursor:pointer;display:flex;align-items:center;gap:4px;font-size:11px;color:#444;border:1px dashed #2a2a2a;padding:5px 10px;transition:all .2s;font-family:'Noto Sans JP',sans-serif}
.hk-fl:hover{border-color:#E8392A;color:#f0f0f0}
.hk-fl input{display:none}
.hk-fp{font-size:10px;color:#F5C518;font-family:monospace;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hk-fc{background:transparent;border:none;color:#444;cursor:pointer;font-size:13px}
.hk-ia{padding:8px 14px 10px;border-top:1px solid #1e1e1e;background:#080808;flex-shrink:0}
.hk-iw{display:flex;gap:6px;align-items:flex-end}
.hk-ta{flex:1;background:#111;border:1px solid #2a2a2a;color:#e0e0e0;padding:8px 12px;font-size:13px;font-family:'Noto Sans JP',sans-serif;resize:none;border-radius:2px;max-height:80px;outline:none;transition:border-color .2s;line-height:1.5}
.hk-ta:focus{border-color:#E8392A}
.hk-ta::placeholder{color:#333}
.hk-snd{width:38px;height:38px;background:#E8392A;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;border-radius:2px;transition:background .2s}
.hk-snd:hover{background:#ff4433}
.hk-snd svg{fill:#fff;width:16px;height:16px}
.hk-snd:disabled{background:#2a2a2a;cursor:not-allowed}
.hk-ft{text-align:center;font-size:9px;color:#222;padding:3px 0 0;font-family:monospace}
`;

// ── DOM構築 ──
const style=document.createElement('style');
style.textContent=css;
document.head.appendChild(style);

// ボタン
const btn=document.createElement('button');
btn.id='hs-k-btn';
btn.onclick=toggle;
btn.innerHTML=`<svg width="40" height="40" viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="19" fill="#0a0a0a" stroke="#E8392A" stroke-width="1"/><circle cx="20" cy="20" r="15" fill="none" stroke="#E8392A" stroke-width=".4" stroke-dasharray="2.5 2" opacity=".4"/><circle cx="20" cy="9" r="2.2" fill="#E8392A"/><circle cx="29" cy="14" r="1.8" fill="#F5C518"/><circle cx="31" cy="24" r="1.8" fill="#E8392A"/><circle cx="25" cy="32" r="1.8" fill="#F5C518"/><circle cx="15" cy="32" r="1.8" fill="#E8392A"/><circle cx="9" cy="24" r="1.8" fill="#F5C518"/><circle cx="11" cy="14" r="1.8" fill="#E8392A"/><circle cx="20" cy="20" r="3" fill="#fff"/><line x1="20" y1="11" x2="20" y2="17" stroke="#E8392A" stroke-width=".7" opacity=".8"/><line x1="27.5" y1="15.5" x2="23" y2="18.5" stroke="#F5C518" stroke-width=".7" opacity=".8"/><line x1="29.5" y1="23" x2="23" y2="21" stroke="#E8392A" stroke-width=".7" opacity=".8"/><line x1="24" y1="30.5" x2="21.5" y2="23" stroke="#F5C518" stroke-width=".7" opacity=".8"/><line x1="16" y1="30.5" x2="18.5" y2="23" stroke="#E8392A" stroke-width=".7" opacity=".8"/><line x1="10.5" y1="23" x2="17" y2="21" stroke="#F5C518" stroke-width=".7" opacity=".8"/><line x1="12.5" y1="15.5" x2="17" y2="18.5" stroke="#E8392A" stroke-width=".7" opacity=".8"/><animateTransform attributeName="transform" type="rotate" from="0 20 20" to="360 20 20" dur="20s" repeatCount="indefinite"/></svg>無料AI診断<span id="hs-k-notif" style="position:absolute;top:-5px;right:-5px;width:20px;height:20px;background:#F5C518;border-radius:50%;font-size:11px;color:#000;font-weight:900;display:none;align-items:center;justify-content:center;font-family:monospace">1</span>`;
document.body.appendChild(btn);

// モーダル
const modal=document.createElement('div');
modal.id='hs-k-modal';
modal.innerHTML=`
<div class="hk-hd">
  <div class="hk-ht">
    <div class="hk-badge">K</div>
    <div>
      <div class="hk-nm"><span>KIRA</span> v4.0｜HORIZON SHIELD</div>
      <div class="hk-sb">Supabase記憶／見積書読取／地域補正／LINE連携</div>
    </div>
    <button class="hk-cl" id="hk-close">✕</button>
  </div>
  <div class="hk-st"><span class="hk-dot"></span><span id="hk-dst">接続中…</span></div>
</div>
<div class="hk-msgs" id="hk-msgs"></div>
<div class="hk-qr" id="hk-qr"></div>
<div class="hk-fa">
  <label class="hk-fl"><input type="file" id="hk-file" accept="image/*" onchange="hkFile(this)">📎 見積書を添付</label>
  <span class="hk-fp" id="hk-fp"></span>
  <button class="hk-fc" id="hk-fc" onclick="hkClear()" style="display:none">✕</button>
</div>
<div class="hk-ia">
  <div class="hk-iw">
    <textarea class="hk-ta" id="hk-ta" placeholder="地域・金額・不安なことを話してください…" rows="1" onkeydown="hkKey(event)" oninput="hkR(this)"></textarea>
    <button class="hk-snd" id="hk-snd" onclick="hkSend()"><svg viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg></button>
  </div>
  <div class="hk-ft">HORIZON SHIELD／大賀俊勝（建設歴30年）監修／業者から一円ももらっていない</div>
</div>`;
document.body.appendChild(modal);

document.getElementById('hk-close').onclick=close_;

// ── STATE ──
let hist=[],loading=false,atFile=null,atB64=null,atType=null;
let sid=localStorage.getItem('hs_kira_sid4');
if(!sid){sid='k4_'+Date.now()+'_'+Math.random().toString(36).substr(2,8);localStorage.setItem('hs_kira_sid4',sid);}
let sd={region:'',amount:''},opened=false,inited=false;

// ── SUPABASE ──
async function sbPost(path,body){
  return fetch(SB_URL+path,{method:'POST',headers:{'apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY,'Content-Type':'application/json','Prefer':'return=minimal'},body:JSON.stringify(body)});
}
async function sbGet(path){
  return fetch(SB_URL+path,{headers:{'apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY}});
}
async function checkDB(){
  try{const r=await sbGet('/rest/v1/kira_sessions?select=id&limit=1');document.getElementById('hk-dst').textContent=r.ok?'ONLINE ／ DB接続済み':'ONLINE ／ 無料診断受付中';}
  catch(e){document.getElementById('hk-dst').textContent='ONLINE ／ 無料診断受付中';}
}
async function saveMsg(role,content){
  try{await sbPost('/rest/v1/kira_messages',{session_id:sid,role,content});}catch(e){}
}
async function saveProspect(s){
  try{await sbPost('/rest/v1/kira_prospects',{session_id:sid,region:sd.region,amount_range:sd.amount,concern_summary:s});}catch(e){}
}
async function loadHist(){
  try{
    const r=await sbGet('/rest/v1/kira_messages?session_id=eq.'+sid+'&order=created_at.asc&limit=16&select=role,content');
    const d=await r.json();
    if(Array.isArray(d)&&d.length){hist=d.map(m=>({role:m.role,content:m.content}));return d.length;}
  }catch(e){}
  return 0;
}

// ── LINE ──
async function notify(info){
  try{await fetch(LINE_PROXY,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'🔴【KIRA v4 見込み客】\n'+new Date().toLocaleString('ja-JP')+'\n\n'+info+'\nSID:'+sid})});}catch(e){}
}

// ── FILE ──
window.hkFile=function(inp){
  const f=inp.files[0];if(!f)return;
  document.getElementById('hk-fp').textContent=f.name;
  document.getElementById('hk-fc').style.display='block';
  const r=new FileReader();r.onload=e=>{atB64=e.target.result.split(',')[1];atType=f.type;atFile=f.name;};r.readAsDataURL(f);
};
window.hkClear=function(){
  atFile=null;atB64=null;atType=null;
  document.getElementById('hk-file').value='';
  document.getElementById('hk-fp').textContent='';
  document.getElementById('hk-fc').style.display='none';
};
window.hkR=function(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,80)+'px';};
window.hkKey=function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();hkSend();}};

// ── UI ──
function addMsg(role,html,isH){
  const c=document.getElementById('hk-msgs');
  const d=document.createElement('div');d.className='hk-msg '+role;
  const av=document.createElement('div');av.className='hk-av';av.textContent=role==='kira'?'K':'施';
  const b=document.createElement('div');b.className='hk-bbl';
  if(isH)b.innerHTML=html;else b.textContent=html;
  d.appendChild(av);d.appendChild(b);c.appendChild(d);c.scrollTop=c.scrollHeight;
}
function addTyp(){
  const c=document.getElementById('hk-msgs');
  const d=document.createElement('div');d.className='hk-msg kira';d.id='hk-typ';
  d.innerHTML='<div class="hk-av">K</div><div class="hk-typ"><span></span><span></span><span></span></div>';
  c.appendChild(d);c.scrollTop=c.scrollHeight;
}
function rmTyp(){const t=document.getElementById('hk-typ');if(t)t.remove();}
function setQR(btns){
  const q=document.getElementById('hk-qr');q.innerHTML='';
  btns.forEach(t=>{const b=document.createElement('button');b.className='hk-qb';b.textContent=t;b.onclick=()=>{document.getElementById('hk-ta').value=t;hkSend();};q.appendChild(b);});
}
function fmt(t){
  t=t.replace(/約[\d〜~\-\s,万円]+万円/g,'<b>$&</b>');
  t=t.replace(/¥[\d,]+/g,'<b>$&</b>');
  t=t.replace(/(https?:\/\/[^\s<]+)/g,'<a href="$1" target="_blank">$1</a>');
  t=t.replace(/\n/g,'<br>');
  return t;
}
function cta(){
  return '<div class="hk-cta"><div class="hk-cta-h">▶ 正式診断 ／ HORIZON SHIELD</div><div class="hk-cta-p">¥55,000</div><div class="hk-cta-b">全項目の過剰請求額・適正価格・交渉文を完全レポートで。30年の経験が根拠。</div><a class="hk-cta-m" href="https://shield.the-horizons-innovation.com/#services" target="_blank">今すぐ正式診断を申し込む →</a><a class="hk-cta-l" href="https://line.me/ti/g2/7JH1RLFfppFpf4hvhrDZP51B6embu5UHN31WJQ" target="_blank">📲 まず無料でLINE相談する</a></div>';
}

// ── SEND ──
window.hkSend=async function(){
  const ta=document.getElementById('hk-ta');
  const txt=ta.value.trim();
  if((!txt&&!atFile)||loading)return;
  const uTxt=atFile?'【見積書添付：'+atFile+'】\n'+(txt||'この見積書を診断してください'):txt;
  const rm=txt.match(/東京|大阪|名古屋|横浜|神奈川|埼玉|千葉|福岡|札幌|京都|神戸|沖縄|北海道/);
  if(rm)sd.region=rm[0];
  if(txt.match(/万|円/))sd.amount=txt.substr(0,50);
  addMsg('user',fmt(txt||(atFile?'📎'+atFile:'')),true);
  await saveMsg('user',uTxt);
  ta.value='';ta.style.height='auto';
  document.getElementById('hk-qr').innerHTML='';
  const uc=[];
  if(atB64&&atType.startsWith('image/'))uc.push({type:'image',source:{type:'base64',media_type:atType,data:atB64}});
  uc.push({type:'text',text:uTxt});
  const msgs=[...hist.slice(-12),{role:'user',content:uc}];
  hkClear();
  loading=true;document.getElementById('hk-snd').disabled=true;
  addTyp();
  try{
    const res=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':'sk-ant-api03-HttUPbkAwOzLnFazHL0E1allwGux8Q0SqjrsF4GC721P9NZ4UHaR1Ki0mlUfnF4Uo6MUFa2DISTz43RAIWpVb3Q-2Gs2JQAA','anthropic-version':'2023-06-01'},body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:800,system:SYS,messages:msgs})});
    const d=await res.json();rmTyp();
    const rep=d.content?.[0]?.text||'エラーが発生しました。';
    hist.push({role:'user',content:uTxt});hist.push({role:'assistant',content:rep});
    await saveMsg('assistant',rep);
    const hasDiag=rep.includes('万円')||rep.includes('削減')||rep.includes('過剰')||rep.includes('適正');
    let html=fmt(rep);
    if(hasDiag){
      html+=cta();
      await saveProspect(uTxt.substr(0,100));
      await notify('地域：'+sd.region+'\n金額：'+sd.amount+'\n内容：'+uTxt.substr(0,100));
    }
    addMsg('kira',html,true);
    setQR(hasDiag?['正式診断を申し込みたい','他の箇所も確認したい','LINEで相談する']:['見積書を添付します','金額を教えます','地域を教えます','他にも不安があります']);
  }catch(e){rmTyp();addMsg('kira','通信エラーが発生しました。再度お試しください。');}
  loading=false;document.getElementById('hk-snd').disabled=false;
  document.getElementById('hk-ta').focus();
};

// ── OPEN/CLOSE ──
async function open_(){
  modal.classList.add('open');
  document.getElementById('hs-k-notif').style.display='none';
  opened=true;
  if(!inited){
    inited=true;
    await checkDB();
    const cnt=await loadHist();
    const g=cnt>0?'前回の続きですね。\n\n'+cnt+'件の記憶があります。\n見積書を送るか、続きを話してください。':'KIRA v4.0です。\n\n見積書の画像を送れば、即座に診断します。\n地域と工事の種類も教えてください。\n\nあなたの感覚は、正しいかもしれない。';
    setTimeout(()=>{addMsg('kira',fmt(g),true);setQR(['見積書が高い気がする','「一式」表記が気になる','追加工事を断れなかった','タックダインを勧められた','床下工事が高すぎる']);},200);
  }
}
function close_(){modal.classList.remove('open');opened=false;}
function toggle(){opened?close_():open_();}

// 20秒後バッジ
setTimeout(()=>{if(!opened){const n=document.getElementById('hs-k-notif');n.style.display='flex';}},20000);

})();
window.hsKiraToggle=function(){document.getElementById('hs-k-btn').click();};
