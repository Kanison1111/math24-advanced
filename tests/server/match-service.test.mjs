import test from 'node:test';
import assert from 'node:assert/strict';
import {MatchService} from '../../server/match-service.mjs';
import {issueCapability} from '../../server/protection.mjs';
import {FakeRepository,TEST_KEY,HOST,PEER,OUTSIDER,ROOM} from './fake-repository.mjs';
let seq=0;
function setup(){let now=1000;const clock=()=>now;const repo=new FakeRepository(clock);return {repo,service:new MatchService(repo,clock),clock,setTime:n=>now=n};}
function context(actor,action,params={},requestId=`request-${++seq}`){return {actor,action,params,roomId:ROOM,requestId,
  proof:issueCapability(TEST_KEY,{actor,action,params:{...params,roomId:ROOM},requestId},1000)};}
test('only current host can start, and concurrent start retains one server deadline and queue',async()=>{
  const {repo,service}=setup();
  await assert.rejects(service.start(ROOM,PEER,context(PEER,'start')),/not_owner/);
  const [a,b]=await Promise.all([service.start(ROOM,HOST,context(HOST,'start')),service.start(ROOM,HOST,context(HOST,'start'))]);
  assert.equal(a.question.id,b.question.id); assert.equal(a.deadline,b.deadline);
  assert.equal(repo.records.get(ROOM).room.status,'started');
});
test('match generation and existing start transition roll back together on persistence failure',async()=>{
  const {repo,service}=setup(); repo.failSave=true;
  await assert.rejects(service.start(ROOM,HOST,context(HOST,'start')),/fixture write failure/);
  assert.equal(repo.records.get(ROOM).room.status,'waiting'); assert.equal(repo.records.get(ROOM).match,null);
});
test('concurrent duplicate submissions award exactly once under repository transaction lock',async()=>{
  const {repo,service}=setup(); const view=await service.start(ROOM,HOST,context(HOST,'start'));
  const body={type:'answer',requestId:'duplicate-request',questionId:view.question.id,formula:repo.records.get(ROOM).match.questions[0].solution};
  const params={questionId:body.questionId,formula:body.formula};
  const [a,b]=await Promise.all([service.command(ROOM,HOST,body,context(HOST,'answer',params,body.requestId)),service.command(ROOM,HOST,body,context(HOST,'answer',params,body.requestId))]);
  assert.deepEqual(a.result,b.result); assert.equal(repo.records.get(ROOM).match.players[0].score,20);
});
test('reconnect reads authoritative progress; removed members and other users are rejected',async()=>{
  const {repo,service}=setup(); await service.start(ROOM,HOST,context(HOST,'start'));
  assert.equal((await service.read(ROOM,PEER)).me.id,PEER);
  await assert.rejects(service.read(ROOM,OUTSIDER),/not_member/);
  repo.records.get(ROOM).room.members=repo.records.get(ROOM).room.members.filter(m=>m.id!==PEER);
  await assert.rejects(service.read(ROOM,PEER),/not_member/);
});
test('expiry is persisted on server read without relying on a browser finish button',async()=>{
  const {repo,service,setTime}=setup(); await service.start(ROOM,HOST,context(HOST,'start'));setTime(601000);
  const view=await service.read(ROOM,HOST);
  assert.equal(view.status,'finished');assert.equal(repo.records.get(ROOM).match.status,'finished');
});
test('service rejects absent, forged and replayed proofs in the transaction',async()=>{
  const {service}=setup();await assert.rejects(service.start(ROOM,HOST),/authorization_required/);
  const good=context(HOST,'start');
  await service.start(ROOM,HOST,good);
  await assert.rejects(service.start(ROOM,HOST,good),/proof_replayed/);
  await assert.rejects(service.start(ROOM,HOST,{...context(HOST,'start'),proof:'bad'}),/request_denied/);
});
test('proof for a different actor or operation cannot authorize a host command',async()=>{
  const {service}=setup();
  await assert.rejects(service.start(ROOM,HOST,context(PEER,'start')),/authorization_required/);
  await assert.rejects(service.start(ROOM,HOST,context(HOST,'leave')),/authorization_required/);
});
