import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createMatch, applyCommand, snapshot } from '../../server/match-engine.mjs';
import { calculateAnswer, is24, playablePool } from '../../server/math-rules.mjs';

const settings = {count:5,duration:10,mode:'basic',difficulty:'easy',ranking:'live'};
const fixture = (extra={}) => createMatch({roomId:'room-a',hostId:'host',members:[{id:'host',name:'เจ้าของ',ready:true},{id:'peer',name:'เพื่อน',ready:true}],settings:{...settings,...extra}},1000, n=>n-1);
let sequence=0;
function command(match,actor,type,now,formula) {
  const q = match.questions[match.players.find(p=>p.id===actor).index];
  return applyCommand(match,actor,{type,questionId:q.id,requestId:`request-${++sequence}`, ...(formula!==undefined?{formula}:{})},now);
}

test('generated server rules have not drifted from unchanged single-player source',()=>{
  execFileSync('python3',['-B','scripts/multiplayer/sync_rules.py','--check']);
});
test('every playable source-bank solution is accepted, including advanced and negative cards',()=>{
  let checked=0;
  for(const mode of ['basic','advanced']) for(const difficulty of ['easy','medium','hard'])
    for(const q of playablePool(mode,difficulty)) {
      assert.ok(is24(calculateAnswer(q.solution,q.nums,mode))); checked++;
    }
  assert.ok(checked>100);
});
test('exact fractions, precedence and advanced syntax use original parser',()=>{
  assert.ok(is24(calculateAnswer('8÷(3−8÷3)',[8,3,8,3],'basic')));
  assert.ok(is24(calculateAnswer('√9*(8-1)+3',[9,8,1,3],'advanced')));
  assert.ok(is24(calculateAnswer('4!+1-2+1',[4,1,2,1],'advanced')));
  assert.throws(()=>calculateAnswer('4!+1-2+1',[4,1,2,1],'basic'));
  assert.throws(()=>calculateAnswer('12+3+4',[1,2,3,4],'basic'));
  assert.throws(()=>calculateAnswer('1;globalThis.compromised=true',[1,2,3,4],'basic'));
});
test('shared question ids/order and server deadline are common to both participants',()=>{
  const m=fixture(), a=snapshot(m,'host',1000), b=snapshot(m,'peer',1100);
  assert.deepEqual(a.question,b.question); assert.equal(a.deadline,601000);
  assert.equal(new Set(m.questions.map(q=>[...q.nums].sort().join(','))).size,5);
});
test('snapshot never exposes solutions, receipts or future questions',()=>{
  const output=JSON.stringify(snapshot(fixture(),'host',1000));
  for(const key of ['solution','receipts','questions','formula']) assert.ok(!output.includes(`"${key}"`));
});
test('mixed difficulty counts are validated and shared',()=>{
  const m=fixture({difficulty:'mixed',mix:[2,1,2]});
  assert.deepEqual(['easy','medium','hard'].map(d=>m.questions.filter(q=>q.difficulty===d).length),[2,1,2]);
  assert.throws(()=>fixture({difficulty:'mixed',mix:[1,1,1]}),/invalid_mix/);
});
test('unsupported bank size fails explicitly instead of silently repeating/reclassifying puzzles',()=>{
  assert.throws(()=>fixture({count:20,mode:'advanced',difficulty:'easy'}),/insufficient_bank/);
});
test('server rejects unready users, duplicates, outsiders and invalid settings',()=>{
  assert.throws(()=>createMatch({roomId:'a',hostId:'host',members:[{id:'host',name:'h',ready:true},{id:'peer',name:'p',ready:false}],settings},1000),/not_ready/);
  assert.throws(()=>fixture({duration:0}),/invalid_settings/);
  assert.throws(()=>snapshot(fixture(),'outsider',1000),/not_member/);
  const m=fixture();
  assert.throws(()=>applyCommand(m,'outsider',{type:'next',requestId:'request-outsider',questionId:m.questions[0].id},1001),/not_member/);
});
test('score boundaries match 30s/60s inclusive bonuses for all difficulties',()=>{
  for(const [difficulty,base] of [['easy',10],['medium',20],['hard',30]]) for(const [elapsed,bonus] of [[0,10],[30000,10],[30001,5],[60000,5],[60001,0]]) {
    const m=fixture({difficulty});
    const {match,result}=command(m,'host','answer',1000+elapsed,m.questions[0].solution);
    assert.equal(result.points,base+bonus); assert.equal(match.players[0].score,base+bonus);
    assert.equal(m.players[0].score,0,'input state stays immutable for transaction retries');
  }
});
test('replayed request gives original result without additional points or hint charges',()=>{
  const m=fixture(), body={type:'answer',requestId:'request-replay',questionId:m.questions[0].id,formula:m.questions[0].solution};
  const first=applyCommand(m,'host',body,2000), second=applyCommand(first.match,'host',body,3000);
  assert.deepEqual(first.result,second.result); assert.equal(second.match.players[0].score,20);
  assert.throws(()=>applyCommand(first.match,'host',{...body,formula:'1+2'},3000),/idempotency_conflict/);
});
test('fresh request cannot score an already solved question',()=>{
  const m=fixture(); const first=command(m,'host','answer',2000,m.questions[0].solution);
  assert.throws(()=>command(first.match,'host','answer',3000,m.questions[0].solution),/already_completed/);
});
test('hint limits and penalties match existing rules and never deduct accumulated score',()=>{
  for(const [difficulty,limit,charge] of [['easy',2,5],['medium',1,10],['hard',0,0]]) {
    let m=fixture({difficulty});
    for(let i=0;i<limit;i++) m=command(m,'host','hint',2000).match;
    assert.equal(m.players[0].score,0);
    assert.throws(()=>command(m,'host','hint',2000),/hint_unavailable/);
    const solved=command(m,'host','answer',2000,m.questions[0].solution);
    assert.equal(solved.result.points,({easy:10,medium:20,hard:30}[difficulty])+10-limit*charge);
  }
});
test('skipping counts once and preserves previously earned points',()=>{
  let m=fixture(); m=command(m,'host','answer',2000,m.questions[0].solution).match;
  m=command(m,'host','next',2100).match;
  const body={type:'next',requestId:'request-skip',questionId:m.questions[1].id};
  m=applyCommand(m,'host',body,2200).match;
  m=applyCommand(m,'host',body,2300).match;
  assert.equal(m.players[0].skipped,1); assert.equal(m.players[0].score,20); assert.equal(m.players[0].index,2);
});
test('stale questions, excessive formulas and browser-supplied points are rejected',()=>{
  const m=fixture(), base={type:'answer',requestId:'request-safe',questionId:m.questions[0].id,formula:m.questions[0].solution};
  assert.throws(()=>applyCommand(m,'host',{...base,score:999999},2000),/invalid_command/);
  assert.throws(()=>applyCommand(m,'host',{...base,questionId:'stale'},2000),/stale_question/);
  assert.throws(()=>applyCommand(m,'host',{...base,formula:'('.repeat(513)},2000),/invalid_command/);
});
test('invalid answers never award points or advance progress',()=>{
  const m=fixture(); const next=command(m,'host','answer',2000,'not valid');
  assert.deepEqual(next.result,{correct:false,points:0}); assert.equal(next.match.players[0].completed,0);
});
test('server deadline rejects late submissions and reveals final ranking without a client finish command',()=>{
  const m=fixture({ranking:'final'});
  assert.equal(snapshot(m,'host',2000).ranking,null);
  assert.throws(()=>command(m,'host','answer',m.deadline,m.questions[0].solution),/match_finished/);
  const end=snapshot(m,'host',m.deadline+500);
  assert.equal(end.status,'finished'); assert.equal(end.reason,'time'); assert.equal(end.endedAt,m.deadline);
  assert.equal(end.question,null); assert.equal(end.ranking.length,2);
});
test('two participants complete common five-question competition, ties share rank',()=>{
  let m=fixture({ranking:'final'});
  for(let i=0;i<5;i++) {
    for(const actor of ['host','peer']) {
      m=command(m,actor,'answer',2000+i*2000,m.questions[i].solution).match;
      if(i<4) m=command(m,actor,'next',2100+i*2000).match;
    }
  }
  assert.equal(m.status,'finished'); assert.equal(m.reason,'complete');
  const view=snapshot(m,'host',11000);
  assert.equal(view.me.solved,5); assert.equal(view.me.score,100);
  assert.deepEqual(view.ranking.map(p=>p.rank),[1,1]);
  assert.equal(view.question,null);
});
test('next question starts its own server timer, waiting after a correct answer gives no bonus advantage',()=>{
  let m=fixture(); m=command(m,'host','answer',2000,m.questions[0].solution).match;
  m=command(m,'host','next',20000).match;
  const solved=command(m,'host','answer',51001,m.questions[1].solution);
  assert.equal(solved.result.points,15); assert.equal(solved.match.players[0].elapsedTotal,32001);
});
