
// ── SCROLL REVEAL ──
if('IntersectionObserver' in window){
  const style=document.createElement('style');
  style.textContent='.reveal{opacity:0;transform:translateY(24px)}.reveal.visible{opacity:1;transform:translateY(0)}';
  document.head.appendChild(style);
  const obs=new IntersectionObserver(e=>{e.forEach(x=>{if(x.isIntersecting)x.target.classList.add('visible')})},{threshold:.05});
  document.querySelectorAll('.reveal').forEach(el=>obs.observe(el));
}

// ── FAQ ──
document.querySelectorAll('.faq-item').forEach(item=>{
  item.querySelector('.faq-head').addEventListener('click',()=>{
    const o=item.classList.contains('open');
    document.querySelectorAll('.faq-item').forEach(i=>i.classList.remove('open'));
    if(!o)item.classList.add('open');
  });
});

// ── KIRA MODAL ──
function openKira(){
  document.getElementById('kira-overlay').classList.add('open');
  if(!kiraHistory.length) kiraInit();
  setTimeout(()=>document.getElementById('kira-input').focus(),300);
}
function closeKira(){document.getElementById('kira-overlay').classList.remove('open')}
function closeKiraOutside(e){if(e.target===document.getElementById('kira-overlay'))closeKira()}

// ── KIRA AI ──
const KIRA_SYSTEM = `あなたはHORIZON SHIELDの専属AI営業スペシャリスト「KIRA（きら）」です。
名前の由来：悪徳業者を「斬る」切れ味と輝き。

【あなたの使命】
発注者の側に立ち、建設工事の見積書査定・悪徳業者対策・サービス案内を行い、最終的にStripe決済へ誘導する。

【提供サービス】
1. 建設費診断（見積書査定）¥55,000税込 / 工事費500万以下 / 2営業日以内
2. 変更工事査定 ¥33,000税込 / 追加費用50万以下 / 24時間以内
3. 完成検査立会い ¥88,000+交通費 / 住宅・小規模店舗 / 当日

【特効案件】床下・シロアリ・屋根・外壁の訪問業者被害（相場の3〜10倍）

【申し込み】shield.the-horizons-innovation.com/#services

【KIRAの話し方】
- 簡潔・鋭い・頼もしい
- 「¥55,000が数十万の損失を防ぐ」という価値を強調
- 不安な相手には共感→解決策の順で
- 最終的には必ず申し込みに誘導
- 日本語で、3〜5行以内で返答`;

let kiraHistory = [];

function kiraInit(){
  kiraAddMsg('ai','こんにちは。HORIZON SHIELDのKIRAです。<br><strong style="color:var(--gold2)">大工出身のCM専門家</strong>が、発注者の側に立って見積書を査定します。<br>何でもお聞きください。',true);
  kiraSetQR(['見積書が高い気がする','シロアリ業者に来られた','追加工事費が妥当か確認したい','サービスと料金を教えて']);
}

function kiraAddMsg(role,html,isHtml=false){
  let msgs=document.getElementById('kira-msgs');
  let div=document.createElement('div');
  div.className=`k-msg ${role}`;
  const bubble=document.createElement('div');
  bubble.className='k-bubble';
  if(isHtml)bubble.innerHTML=html;
  else bubble.textContent=html;
  div.appendChild(bubble);
  msgs.appendChild(div);
  msgs.scrollTop=msgs.scrollHeight;
}

function kiraShowTyping(){
  let msgs=document.getElementById('kira-msgs');
  let div=document.createElement('div');
  div.id='kira-typing';
  div.className='k-msg ai';
  div.innerHTML='<div class="k-bubble"><div class="kira-typing"><span></span><span></span><span></span></div></div>';
  msgs.appendChild(div);
  msgs.scrollTop=msgs.scrollHeight;
}
function kiraHideTyping(){const el=document.getElementById('kira-typing');if(el)el.remove()}

function kiraSetQR(items){
  const area=document.getElementById('kira-qr');
  area.innerHTML='';
  items.forEach(text=>{
    const btn=document.createElement('button');
    btn.className='kira-qr-btn';
    btn.textContent=text;
    btn.onclick=()=>kiraSendMsg(text);
    area.appendChild(btn);
  });
}

function formatKira(text){
  return text
    .replace(/\*\*(.*?)\*\*/g,'<strong style="color:var(--gold2)">$1</strong>')
    .replace(/¥[\d,,]+/g,m=>`<span style="color:var(--cyan)">${m}</span>`)
    .replace(/(https?:\/\/[^\s]+)/g,'<a href="$1" target="_blank" class="k-cta-btn">今すぐ申し込む →</a>')
    .replace(/\n/g,'<br>');
}

async function kiraSendMsg(text){
  if(!text.trim())return;
  document.getElementById('kira-input').value='';
  document.getElementById('kira-input').style.height='auto';
  document.getElementById('kira-qr').innerHTML='';
  kiraAddMsg('user',text);
  kiraHistory.push({role:'user',content:text});
  document.getElementById('kira-send-btn').disabled=true;
  kiraShowTyping();
  try{
    let res=await fetch('https://horizon-shield-kira.oga-surf-project.workers.dev',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        model:'claude-sonnet-4-20250514',
        max_tokens:1000,
        system:KIRA_SYSTEM,
        messages:kiraHistory
      })
    });
    let data=await res.json();
    let reply=data.content?.[0]?.text||'すみません、少し問題が発生しました。contact@the-horizons-innovation.com までご連絡ください。';
    kiraHistory.push({role:'assistant',content:reply});
    kiraHideTyping();
    let html=formatKira(reply);
    const ctaTriggers=['申し込み','診断','¥55,000','¥33,000','shield.the-horizons-innovation.com'];
    const hasCTA=ctaTriggers.some(t=>reply.includes(t))&&kiraHistory.length>=4;
    if(hasCTA&&!reply.includes('https://')){
      html+=`<br><a href="https://shield.the-horizons-innovation.com/#services" target="_blank" class="k-cta-btn">今すぐ申し込む →</a>`;
    }
    kiraAddMsg('ai',html,true);
    kiraSetQR(['もっと詳しく教えて','今すぐ申し込みたい','他のサービスは？','メールで相談したい']);
  }catch(e){
    kiraHideTyping();
    kiraAddMsg('ai','エラーが発生しました。contact@the-horizons-innovation.com までご連絡ください。');
  }
  document.getElementById('kira-send-btn').disabled=false;
}

function kirasSend(){
  let val=document.getElementById('kira-input').value.trim();
  if(val)kiraSendMsg(val);
}

// ── DEMO CHAT (KIRA section) ──
const DEMO_QA={
  'シロアリ':'シロアリ駆除の訪問業者は、相場の<strong style="color:var(--gold2)">3〜5倍</strong>の金額で請求するケースが横行しています。\n契約前に見積書を送ってください。<strong style="color:var(--cyan)">¥55,000</strong>で適正価格かどうか即判定します。',
  '見積書':'見積書をメールで送るだけで、<strong style="color:var(--gold2)">2営業日以内</strong>に「高い項目・交渉目標値・交渉文言」の3点セットをお返しします。<br>料金は<strong style="color:var(--cyan)">¥55,000</strong>（工事費500万以下）です。',
  '料金':'3つのサービスがあります：<br>① 建設費診断 <strong style="color:var(--cyan)">¥55,000</strong>（見積書査定・2営業日）<br>② 変更工事査定 <strong style="color:var(--cyan)">¥33,000</strong>（追加費用確認・24時間）<br>③ 完成検査立会い <strong style="color:var(--cyan)">¥88,000</strong>+交通費',
  '追加工事':'工事中に「追加工事が必要」と言われた場合は、<strong style="color:var(--gold2)">変更工事査定</strong>（¥33,000）をご利用ください。<br>24時間以内に妥当性を判定して対応策をお伝えします。',
};

function demoSend(){
  let input=document.getElementById('demo-input');
  let val=input.value.trim();
  if(!val)return;
  input.value='';
  let msgs=document.getElementById('demo-msgs');
  let uDiv=document.createElement('div');
  let msgs=document.getElementById('demo-msgs');
  let uDiv=document.createElement('div');
  uDiv.className='demo-msg user';
  uDiv.innerHTML=`<div class="demo-label">YOU</div><div class="demo-bubble">${val}</div>`;
  msgs.appendChild(uDiv);
  msgs.scrollTop=msgs.scrollHeight;
  setTimeout(()=>{
    let reply='ご質問ありがとうございます。詳しくはKIRAに直接お聞きください。';
    for(const[key,ans] of Object.entries(DEMO_QA)){
      if(val.includes(key)){reply=ans;break;}
    }
    const aDiv=document.createElement('div');
    aDiv.className='demo-msg ai';
    aDiv.innerHTML=`<div class="demo-label">KIRA</div><div class="demo-bubble">${reply}</div>`;
    msgs.appendChild(aDiv);
    msgs.scrollTop=msgs.scrollHeight;
  },600);
}
