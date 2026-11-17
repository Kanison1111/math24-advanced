import {ClientError,Session,validatePublicConfig,fixtureMode} from './session.mjs';
import {OnlineAPI} from './api.mjs';
import {RoomSync,subscribeRoom} from './sync.mjs';
const $=id=>document.getElementById(id);
const messages={configuration_required:'ยังไม่ได้ตั้งค่าการเชื่อมต่อ Online',online_unavailable:'Online ยังไม่เปิดใช้งาน ต้องตรวจฐานข้อมูลและระบบป้องกันก่อน',
  session_expired:'เซสชันหมดอายุหรือสูญหาย กรุณาเชื่อมต่อใหม่ หรือตั้งใจเริ่มด้วยตัวตนใหม่',signin_failed:'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่',
  connection_lost:'ขาดการเชื่อมต่อ กำลังลองเชื่อมต่อใหม่',invalid_response:'ข้อมูลตอบกลับไม่ถูกต้อง',rate_limited:'ทำรายการถี่เกินไป กรุณารอสักครู่',
  room_unavailable:'เข้าห้องไม่ได้ กรุณาตรวจรหัสหรือสอบถามเจ้าของห้อง',room_full:'เข้าห้องไม่ได้ กรุณาตรวจรหัสหรือสอบถามเจ้าของห้อง',
  not_member:'ห้องปิดแล้วหรือคุณไม่ได้เป็นสมาชิกห้องนี้',not_owner:'เฉพาะเจ้าของห้องเท่านั้นที่เริ่มได้',not_ready:'รอให้สมาชิกอย่างน้อย 2 คนพร้อมก่อนเริ่ม',start_rejected:'เริ่มไม่ได้ ห้องอาจหมดอายุหรือสถานะเปลี่ยนแล้ว กรุณาลองโหลดใหม่',
  captcha_required:'ต้องตั้งค่าการยืนยันตัวตนก่อนใช้งาน',captcha_unavailable:'ยืนยันตัวตนไม่สำเร็จ กรุณาลองใหม่',
  insufficient_bank:'คลังโจทย์ระดับนี้มีชุดไม่ซ้ำไม่พอ กรุณาเลือก 5/10 ข้อหรือปรับจำนวนข้อแบบผสม',match_finished:'การแข่งขันจบแล้ว',
  stale_question:'โจทย์เปลี่ยนแล้ว กำลังโหลดสถานะล่าสุด',request_denied:'ไม่สามารถทำรายการได้ กรุณาลองใหม่',
  already_completed:'ข้อนี้รับคะแนนไปแล้ว กดข้อถัดไปเพื่อไปต่อ',hint_unavailable:'ไม่มีคำใบ้เพิ่มเติมสำหรับข้อนี้',
  invalid_mix:'จำนวนข้อแบบผสมต้องรวมเท่ากับจำนวนโจทย์',session_required:'กรุณาเชื่อมต่อใหม่'};
let api,client,session,sync,cfg,roomId=null,current=null,connected=false,busy=false,receiptTime=0,previousQuestion=null;
let roomStorageKey='';
const feedback=text=>{$('feedback').textContent=text;};
function report(error) {
  feedback(messages[error?.code]??'ทำรายการไม่สำเร็จ กรุณาลองใหม่');
  if(['session_expired','session_required'].includes(error?.code)){$('new-session').hidden=false;connected=false;}
  if(['connection_lost','request_unavailable'].includes(error?.code))connected=false;
  buttons();
}
function remember(value){try{if(value)localStorage.setItem(roomStorageKey,value);else localStorage.removeItem(roomStorageKey);}catch{/* Session continues without room recovery. */}}
function recalled(){try{return localStorage.getItem(roomStorageKey);}catch{return null;}}
async function challenge(action) {
  if(api?.capabilities?.mode==='offline-test-double')return 'offline-fixture-token';
  if(!cfg.turnstileSiteKey)throw new ClientError('captcha_required');
  if(!globalThis.turnstile)await new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;
    script.onload=resolve;script.onerror=()=>reject(new ClientError('captcha_unavailable'));document.head.append(script);
  });
  return new Promise((resolve,reject)=>{
    let widget;
    const finish=(error,token)=>{clearTimeout(timer);if(widget!==undefined)turnstile.remove(widget);$('challenge-box').replaceChildren();error?reject(error):resolve(token);};
    const timer=setTimeout(()=>finish(new ClientError('captcha_unavailable')),120000);
    widget=turnstile.render($('challenge-box'),{sitekey:cfg.turnstileSiteKey,action,
      callback:token=>finish(null,token),'error-callback':()=>finish(new ClientError('captcha_unavailable')),
      'expired-callback':()=>finish(new ClientError('captcha_unavailable'))});
  });
}
function buttons() {
  $('create-fields').disabled=!connected||busy||!!roomId;
  $('join-fields').disabled=!connected||busy||!!roomId;
  $('connect').disabled=busy;
  const snapshot=current?.match,q=snapshot?.question,active=snapshot?.status==='running';
  const mutable=connected&&!busy;
  const me=current?.members?.find(p=>p.id===current.meId);
  $('ready-button').disabled=!mutable||current?.room?.status!=='waiting';
  $('ready-button').textContent=me?.ready?'ยกเลิกพร้อม':'พร้อมแข่งขัน';
  const host=!!current&&current.room.hostId===current.meId;
  $('start-button').hidden=!host;
  $('start-button').disabled=!mutable||current?.room?.status!=='waiting'||(current?.members?.length??0)<2||!current?.members?.every(p=>p.ready);
  $('leave-button').disabled=!mutable;
  $('submit-answer').disabled=!mutable||!active||!q||q.status!=='active';
  $('answer').disabled=$('submit-answer').disabled;
  $('hint-button').disabled=!mutable||!active||!q||q.status!=='active'||q.hints>=q.hintLimit;
  $('hint-button').textContent=q?`คำใบ้ ${q.hints}/${q.hintLimit}`:'คำใบ้';
  $('next-button').disabled=!mutable||!active||!q;
  for(const button of $('keypad').querySelectorAll('button'))button.disabled=$('answer').disabled||(button.dataset.special==='yes'&&q?.mode!=='advanced');
}
function clearRoom() {
  sync?.stop();roomId=null;current=null;previousQuestion=null;remember(null);
  $('entry').hidden=false;$('room-panel').hidden=true;$('match-panel').hidden=true;$('ranking-panel').hidden=true;
  $('players').replaceChildren();$('numbers').replaceChildren();$('rankings').replaceChildren();buttons();
}
function render(data) {
  if(!data?.room?.id||!Array.isArray(data.members))throw new ClientError('invalid_response');
  const previousStatus=current?.match?.status;
  current=data;receiptTime=performance.now();
  $('entry').hidden=true;$('room-panel').hidden=false;
  $('room-title').textContent=data.room.name;$('lobby-code').textContent=data.room.code;
  $('players').replaceChildren(...data.members.map(p=>{
    const li=document.createElement('li'),name=document.createElement('span'),state=document.createElement('span');
    name.textContent=p.name+(p.id===data.room.hostId?' · เจ้าของห้อง':'')+(p.id===data.meId?' · คุณ':'');
    state.textContent=p.ready?'พร้อม':'ยังไม่พร้อม';li.append(name,state);return li;
  }));
  const match=data.match;$('match-panel').hidden=!match;$('ranking-panel').hidden=!match;
  if(match) {
    $('match-title').textContent=match.status==='finished'?'จบการแข่งขัน':'การแข่งขัน';
    $('score').textContent=String(match.me.score);
    $('progress').textContent=`ทำแล้ว ${match.me.completed}/${match.total} · ถูก ${match.me.solved} · ข้าม ${match.me.skipped}${match.me.finished&&match.status==='running'?' · รอผู้เล่นที่เหลือ':''}`;
    const q=match.question;
    $('numbers').replaceChildren(...(q?.nums??[]).map(n=>{const tile=document.createElement('span');tile.textContent=String(n);return tile;}));
    if(q?.id!==previousQuestion){$('answer').value='';previousQuestion=q?.id??null;}
    $('answer-form').hidden=!q;$('next-button').hidden=!q;
    $('ranking-status').textContent=match.ranking===null?'ซ่อนอันดับจนกว่าการแข่งขันจบ':match.status==='finished'?'ผลการแข่งขัน':'คะแนนสด';
    $('rankings').replaceChildren(...(match.ranking??[]).map(row=>{const li=document.createElement('li');li.value=row.rank;li.textContent=`${row.name} · ${row.score} คะแนน · ถูก ${row.solved}/${match.total} · ${(row.elapsedMs/1000).toFixed(1)} วินาที`;return li;}));
    if(match.status==='finished'&&$('skip-dialog').open)$('skip-dialog').close();
    if(previousStatus!==match.status)$('match-title').focus();
  }
  tick();buttons();
}
function tick() {
  const match=current?.match;if(!match)return;
  const left=match.status==='finished'?0:Math.max(0,match.deadline-(match.serverNow+performance.now()-receiptTime));
  const seconds=Math.ceil(left/1000);$('timer').textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
}
function startSync(id) {if(typeof id!=='string'||!/^([0-9a-f]{8}-)([0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id))throw new ClientError('invalid_response');roomId=id;remember(id);connected=false;sync.start(id);buttons();}
async function connect(newIdentity=false) {
  if(busy)return;busy=true;buttons();
  try {
    cfg=validatePublicConfig(globalThis.MATH24_ONLINE_CONFIG??{});
    roomStorageKey='math24-online-room:'+cfg.supabaseUrl;
    if(!api){api=new OnlineAPI(cfg.gatewayUrl,{challenge});}
    const capabilities=await api.check(); // No anonymous signup before readiness.
    const offline=fixtureMode(cfg,capabilities,globalThis.MATH24_SDK_FACTORY);
    $('mode-label').textContent=capabilities.mode==='offline-test-double'?'Mock API / Offline test · ไม่ใช่ Supabase จริง':'โหมด Multiplayer Online';
    $('availability').textContent=capabilities.mode==='offline-test-double'?'การทดสอบระบบผ่าน API จำลอง ข้อมูลและบัญชีนี้ไม่ใช่ฐานข้อมูลจริง':'กำลังใช้ข้อมูลห้องและผลการแข่งขันจากระบบกลาง';
    if(!client) {
      const factory=offline?globalThis.MATH24_SDK_FACTORY:(await import('./vendor/supabase.mjs')).createClient;
      client=factory(cfg.supabaseUrl,cfg.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
      session=new Session(client,localStorage,'math24-online-seen:'+cfg.supabaseUrl);api.session=session;
      session.onChange((event,value)=>{
        if(event==='TOKEN_REFRESHED'&&value?.access_token){Promise.resolve(client.realtime?.setAuth(value.access_token)).catch(()=>{});sync?.refresh();}
        if(event==='SIGNED_OUT'){clearRoom();connected=false;report(new ClientError('session_expired'));}
      });
      sync=new RoomSync({load:id=>api.call('snapshot',id),subscribe:(id,onEvent)=>subscribeRoom(client,id,onEvent),
        pollMs:capabilities.mode==='offline-test-double'?250:10000,
        onSnapshot:render,onState:(state,error)=>{
          connected=state==='connected';$('connection').textContent=connected?'เชื่อมต่อแล้ว':'กำลังเชื่อมต่อใหม่ — รอสถานะล่าสุด';
          if(error?.code==='not_member'){clearRoom();report(error);}else if(error?.code==='session_required'||error?.code==='session_expired'){sync.stop();report(error);}
          buttons();
        }});
    }
    await session.ensure({allowCreate:true,newIdentity,captchaToken:()=>challenge('signup')});
    $('new-session').hidden=true;connected=true;feedback('เชื่อมต่อแล้ว สร้างห้องหรือเข้าร่วมห้องได้');
    const saved=newIdentity?null:recalled();if(saved)startSync(saved);
  }catch(error){report(error);}finally{busy=false;buttons();}
}
async function action(fn) {
  if(busy||!connected)return;busy=true;buttons();
  try{await fn();}catch(error){report(error);sync?.refresh();}finally{busy=false;buttons();}
}
function settings() {
  const value={name:$('room-name').value.trim(),count:Number($('question-count').value),duration:Number($('duration').value),mode:$('room-mode').value,
    difficulty:$('difficulty').value,ranking:$('ranking-mode').value,mix:['easy','medium','hard'].map(d=>Number($('mix-'+d).value))};
  if(value.difficulty==='mixed'&&value.mix.reduce((a,b)=>a+b,0)!==value.count)throw new ClientError('invalid_mix');
  if((value.mode==='basic'&&value.difficulty==='medium'||value.mode==='advanced'&&value.difficulty==='easy')&&value.count>14)throw new ClientError('insufficient_bank');
  if(value.difficulty==='mixed'&&(value.mode==='basic'&&value.mix[1]>14||value.mode==='advanced'&&value.mix[0]>14))throw new ClientError('insufficient_bank');
  return value;
}
function options() {
  $('mix-fields').hidden=$('difficulty').value!=='mixed';
  const limited=$('room-mode').value==='basic'&&$('difficulty').value==='medium'||$('room-mode').value==='advanced'&&$('difficulty').value==='easy';
  for(const option of $('question-count').options)option.disabled=limited&&Number(option.value)>14;
  $('bank-note').textContent=limited?'ระดับนี้รองรับโจทย์ไม่ซ้ำได้ 5 หรือ 10 ข้อในคลังปัจจุบัน':'';
}
$('room-mode').onchange=options;$('difficulty').onchange=options;options();
$('connect').onclick=()=>connect();$('new-session').onclick=()=>{remember(null);connect(true);};
$('create-form').onsubmit=event=>{event.preventDefault();action(async()=>{const data=await api.call('create',null,settings());startSync(data.room.id);});};
$('join-form').onsubmit=event=>{event.preventDefault();action(async()=>{const data=await api.call('join',null,{code:$('room-code').value,nickname:$('nickname').value.trim()});startSync(data.room.id);});};
$('ready-button').onclick=()=>action(async()=>{const me=current.members.find(p=>p.id===current.meId);await api.call('ready',roomId,{ready:!me.ready});await sync.refresh();});
$('start-button').onclick=()=>action(async()=>{await api.call('start',roomId);await sync.refresh();});
$('leave-button').onclick=()=>$('leave-dialog').showModal();$('leave-cancel').onclick=()=>$('leave-dialog').close();
$('leave-confirm').onclick=()=>action(async()=>{await api.call('leave',roomId);$('leave-dialog').close();clearRoom();feedback('ออกจากห้องแล้ว');});
$('answer-form').onsubmit=event=>{event.preventDefault();action(async()=>{
  const q=current.match.question;const data=await api.call('answer',roomId,{questionId:q.id,formula:$('answer').value});
  feedback(data.result.correct?`ถูกต้อง · +${data.result.points} คะแนน`:'สูตรยังไม่ถูกต้อง ลองใหม่ได้');await sync.refresh();
});};
$('hint-button').onclick=()=>action(async()=>{const data=await api.call('hint',roomId,{questionId:current.match.question.id});feedback(data.result.hint);await sync.refresh();});
async function next(){await api.call('next',roomId,{questionId:current.match.question.id});await sync.refresh();}
$('next-button').onclick=()=>{if(current.match.question.status==='active')$('skip-dialog').showModal();else action(next);};
$('skip-cancel').onclick=()=>$('skip-dialog').close();$('skip-confirm').onclick=()=>{$('skip-dialog').close();action(next);};
for(const [label,value,special]of [...'1234567890'.split('').map(n=>[n,n,false]),['+','+',false],['−','-',false],['×','*',false],['÷','/',false],['(','(',false],[')',')',false],['(−','(-)',false],['√','√(',true],['!','!',true],['xⁿ','^(',true],['⌫','BACK',false],['C','CLEAR',false]]){
  const button=document.createElement('button');button.type='button';button.textContent=label;button.dataset.special=special?'yes':'no';
  button.onclick=()=>{const input=$('answer'),start=input.selectionStart,end=input.selectionEnd;if(value==='CLEAR')input.value='';else if(value==='BACK')input.setRangeText('',start===end?Math.max(0,start-1):start,end,'end');else {if(value==='0'&&input.value.slice(0,start).endsWith('(-')){feedback('จำนวนลบใช้เลข 1–9');return;}input.setRangeText(value,start,end,'end');if(value==='(-)')input.setSelectionRange(start+2,start+2);else if(/^[1-9]$/.test(value)&&/\(-[1-9]$/.test(input.value.slice(0,input.selectionStart))&&input.value[input.selectionStart]===')')input.setSelectionRange(input.selectionStart+1,input.selectionStart+1);}input.focus({preventScroll:true});};$('keypad').append(button);
}
function resumeSync(){if(!sync||!roomId)return;if(!sync.current)startSync(roomId);else sync.refresh();}
window.addEventListener('pageshow',event=>{if(event.persisted)resumeSync();});
window.addEventListener('online',resumeSync);window.addEventListener('offline',()=>{connected=false;$('connection').textContent='ขาดการเชื่อมต่อ — รอสถานะล่าสุด';buttons();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')resumeSync();});
window.addEventListener('pagehide',()=>sync?.stop());setInterval(tick,250);buttons();
