'use strict';
(() => {
  const $ = id => document.getElementById(id);
  let room = null, host = false, ready = false, peerReady = false, connected = true;
  let ended = false, rankState = 'normal';
  const panels = ['create', 'join', 'lobby', 'ranking'];
  const difficultyNames = {easy:'ง่าย', medium:'ปานกลาง', hard:'ยาก', mixed:'ผสม'};
  function show(name) {
    panels.forEach(p => { $(p + '-panel').hidden = p !== name; });
    ['create', 'join'].forEach(p => {
      $(p + '-tab').disabled = !!room;
      if (p === name) $(p + '-tab').setAttribute('aria-current', 'page');
      else $(p + '-tab').removeAttribute('aria-current');
    });
    $(name + '-title').focus();
  }
  function settings() {
    return {name:$('room-name').value.trim(), count:Number($('question-count').value),
      duration:Number($('duration').value), mode:$('room-mode').value,
      difficulty:$('difficulty').value, ranking:$('ranking-mode').value,
      mix:['easy','medium','hard'].map(d => Number($('mix-' + d).value)), code:'240024'};
  }
  function description(r) {
    const level = r.difficulty === 'mixed' ? `ผสม (ง่าย ${r.mix[0]} / ปานกลาง ${r.mix[1]} / ยาก ${r.mix[2]})` : difficultyNames[r.difficulty];
    return `${r.count} ข้อ · ${r.duration} นาที · ${r.mode === 'basic' ? 'พื้นฐาน' : 'ขั้นสูง'} · ${level} · Ranking ${r.ranking === 'live' ? 'สด' : 'หลังจบ'}`;
  }
  function updateSummary() {
    const r = settings();
    $('mix-fields').hidden = r.difficulty !== 'mixed';
    $('mix-total').textContent = `รวม ${r.mix.reduce((a,b) => a+b,0)} / ${r.count} ข้อ (ต้องเท่ากับจำนวนโจทย์)`;
    $('room-summary').textContent = description(r);
    $('create-error').textContent = '';
  }
  $('create-form').addEventListener('input', updateSummary);
  updateSummary();
  $('create-tab').onclick = () => show('create');
  $('join-tab').onclick = () => show('join');
  function player(name, status) {
    const li = document.createElement('li');
    for (const text of [name, status]) { const span = document.createElement('span'); span.textContent = text; li.append(span); }
    return li;
  }
  function lobby() {
    $('lobby-title').textContent = room.name;
    $('lobby-code').textContent = room.code;
    $('lobby-rules').textContent = description(room);
    $('connection').textContent = connected ? 'สถานะจำลอง: เชื่อมต่อแล้ว' : 'สถานะจำลอง: หลุด · กำลังเชื่อมต่อใหม่ กดเครื่องมือสาธิตเพื่อเชื่อมต่ออีกครั้ง';
    $('players').replaceChildren(player(host ? 'คุณ · ครู / เจ้าของห้อง' : 'ครู · เจ้าของห้อง', 'พร้อม'),
      player(host ? 'มะลิ · ตัวอย่าง' : room.nickname + ' · คุณ', host ? (peerReady ? 'พร้อม' : 'ยังไม่พร้อม') : (!connected ? 'กำลังเชื่อมต่อใหม่' : ready ? 'พร้อม' : 'ยังไม่พร้อม')),
      player('ต้น · ตัวอย่าง', peerReady ? 'พร้อม' : 'ยังไม่พร้อม'));
    $('ready-button').hidden = host;
    $('ready-button').textContent = ready ? 'ยกเลิกพร้อม' : 'พร้อมแข่งขัน';
    $('ready-button').disabled = !connected;
    $('start-button').hidden = !host;
    $('start-button').disabled = !connected || !peerReady;
    $('demo-start').hidden = host;
    $('demo-start').disabled = !connected || !ready || !peerReady;
    $('demo-connection').textContent = connected ? 'จำลองการเชื่อมต่อหลุด' : 'จำลองเชื่อมต่ออีกครั้ง';
    $('start-reason').textContent = !connected ? 'รอเชื่อมต่ออีกครั้งก่อนเริ่ม' : (!peerReady || (!host && !ready)) ? 'รอให้ผู้เล่นทุกคนพร้อมก่อนเริ่ม' : host ? 'ผู้เล่นพร้อมแล้ว ครูเริ่มการแข่งขันจำลองได้' : 'พร้อมแล้ว รอครูเริ่ม (ใช้ปุ่มสาธิตด้านล่าง)';
  }
  async function busy(button, action) {
    button.disabled = true;
    const text = button.textContent; button.textContent = 'กำลังเตรียมห้องจำลอง…';
    try { await new Promise(resolve => setTimeout(resolve, 350)); action(); }
    finally { button.disabled = false; button.textContent = text; }
  }
  $('create-form').onsubmit = event => {
    event.preventDefault(); const r = settings();
    if (!r.name) { $('create-error').textContent = 'กรุณากรอกชื่อห้องที่ไม่ใช่ช่องว่าง'; return; }
    if (r.difficulty === 'mixed' && r.mix.reduce((a,b) => a+b,0) !== r.count) {
      $('create-error').textContent = 'จำนวนข้อแบบผสมต้องรวมเท่ากับจำนวนโจทย์'; return;
    }
    busy($('create-submit'), () => { room = r; host = true; ready = true; peerReady = false; connected = true; lobby(); show('lobby'); });
  };
  $('join-form').onsubmit = event => {
    event.preventDefault(); const nickname = $('nickname').value.trim(), code = $('room-code').value;
    const error = !nickname ? 'กรุณากรอกชื่อเล่นที่ไม่ใช่ช่องว่าง' : code === '111111' ? 'ห้องจำลองเต็มแล้ว ลองห้อง 240024' : code === '000000' ? 'ห้องจำลองปิดแล้ว ลองห้อง 240024' : code !== '240024' ? 'ไม่พบห้องจำลอง ใช้รหัส 240024' : '';
    $('join-error').textContent = error; if (error) return;
    busy($('join-submit'), () => {
      room = {name:'ม.5 · ห้องตัวอย่าง', count:10, duration:10, mode:'basic', difficulty:'mixed', mix:[4,3,3], ranking:'live', nickname, code};
      host = false; ready = false; peerReady = false; connected = true; lobby(); show('lobby');
    });
  };
  $('ready-button').onclick = () => { ready = !ready; lobby(); };
  $('demo-ready').onclick = () => { peerReady = !peerReady; lobby(); };
  $('demo-connection').onclick = () => { connected = !connected; lobby(); };
  function start() { ended = false; rankState = 'normal'; $('rank-filter').value = 'all'; renderRanking(); show('ranking'); }
  $('start-button').onclick = start; $('demo-start').onclick = start;
  function renderRanking() {
    const hidden = room.ranking === 'final' && !ended;
    $('ranking-description').textContent = `${room.name} · ${ended ? 'จบการแข่งขันจำลอง' : 'กำลังแข่งขันจำลอง'} · ${room.ranking === 'live' ? 'แสดงคะแนนสด (ข้อมูลคงที่จำลอง)' : 'แสดงคะแนนหลังจบ'}`;
    $('finish-button').hidden = ended;
    $('retry-ranking').hidden = hidden || rankState !== 'error';
    $('rankings').replaceChildren();
    $('ranking-status').textContent = hidden ? 'ซ่อนคะแนนและอันดับจนกว่าจะจบการแข่งขัน' : ({loading:'กำลังโหลดข้อมูลจำลอง…', empty:'ยังไม่มีผลการแข่งขันจำลอง', error:'โหลดข้อมูลจำลองไม่สำเร็จ กดลองโหลดอีกครั้ง', normal:'ข้อมูลตัวอย่าง · ไม่ใช่ผลจากการเล่นจริง'})[rankState];
    if (hidden || rankState !== 'normal') return;
    const rows = [{name:'มะลิ', score:120, correct:6, time:182, me:false}, {name:host ? 'คุณ · ครู' : room.nickname, score:100, correct:5, time:205, me:true}, {name:'ต้น', score:80, correct:4, time:230, me:false}];
    rows.sort((a,b) => b.score-a.score || b.correct-a.correct || a.time-b.time);
    const list = document.createElement('ol'); list.style.cssText = 'list-style:none;padding:0'; list.setAttribute('aria-label','อันดับ คะแนน ตอบถูก และเวลาที่ใช้');
    rows.forEach((row,i) => {
      if ($('rank-filter').value === 'me' && !row.me) return;
      const li = document.createElement('li'); li.className = 'rank-row';
      const place = document.createElement('span'); place.className = 'rank-place'; place.textContent = String(i+1);
      const body = document.createElement('div'), name = document.createElement('div'); name.className = 'rank-name'; name.textContent = row.name + (row.me ? ' (คุณ)' : ' · ตัวอย่าง');
      const stats = document.createElement('div'); stats.className = 'rank-stats';
      for (const text of [`${row.score} คะแนน`, `ถูก ${Math.min(row.correct,room.count)}/${room.count} ข้อ`, `เวลา ${Math.floor(row.time/60)}:${String(row.time%60).padStart(2,'0')} นาที`]) { const span = document.createElement('span'); span.textContent = text; stats.append(span); }
      body.append(name, stats); li.append(place,body); list.append(li);
    });
    $('rankings').append(list);
  }
  $('rank-filter').onchange = renderRanking;
  $('finish-button').onclick = () => { ended = true; renderRanking(); };
  $('retry-ranking').onclick = () => { rankState = 'normal'; renderRanking(); };
  document.querySelectorAll('[data-rank-state]').forEach(button => { button.onclick = () => { rankState = button.dataset.rankState; renderRanking(); }; });
  $('back-lobby').onclick = () => { lobby(); show('lobby'); };
  for (const id of ['leave-button','ranking-leave']) $(id).onclick = () => $('leave-dialog').showModal();
  $('cancel-leave').onclick = () => $('leave-dialog').close();
  $('confirm-leave').onclick = () => { $('leave-dialog').close(); room = null; $('announcement').textContent = 'ออกจากห้องจำลองแล้ว'; show('create'); };
})();
