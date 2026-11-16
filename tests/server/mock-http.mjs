// ONLY for offline browser integration tests. Never deploy/import in production.
import http from 'node:http';
import {Readable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {FakeRepository,TEST_KEY} from './fake-repository.mjs';
import {MatchService} from '../../server/match-service.mjs';
import {MatchError} from '../../server/match-engine.mjs';
import {createGateway} from '../../server/gateway.mjs';
import {verifyCapability} from '../../server/protection.mjs';
import {capabilityParams} from '../../server/room-contract.mjs';
let offset=0;const clock=()=>Date.now()+offset;
const repo=new FakeRepository(clock);repo.records.clear();
const matches=new MatchService(repo,clock);
let nextCode=240024, denyBudget=false;
const envelopes=new Map();
const rooms={
  async snapshot(id,actor,loadMatch){
    const record=repo.records.get(id);
    if(!record?.room.members.some(m=>m.id===actor))throw new MatchError('not_member');
    return {room:{id,name:record.room.name,code:record.room.code,hostId:record.room.hostId,status:record.room.status,settings:record.room.settings},
      members:record.room.members.map(m=>({...m})),meId:actor,match:record.match?await loadMatch():null};
  },
  async mutate({action,actor,roomId,params,requestId,proof}) {
    const payload=verifyCapability(TEST_KEY,proof,{actor,action,params:capabilityParams(action,params,roomId),requestId},clock());
    const receiptKey=actor+':'+requestId;
    if(envelopes.has(receiptKey))return structuredClone(envelopes.get(receiptKey));
    if(action==='create') {
      roomId=randomUUID();repo.records.set(roomId,{room:{id:roomId,name:params.name,code:String(nextCode++),hostId:actor,status:'waiting',settings:params,
        members:[{id:actor,name:'ผู้สร้าง',ready:true}]},match:null,nonces:[payload.nonce]});
    }else if(action==='join') {
      const record=[...repo.records.values()].find(r=>r.room.code===params.code);
      if(!record||record.room.status!=='waiting'||record.room.members.length>=50)throw new MatchError('room_unavailable');
      roomId=record.room.id;
      if(!record.room.members.some(m=>m.id===actor))record.room.members.push({id:actor,name:params.nickname,ready:false});
    }else {
      const record=repo.records.get(roomId),member=record?.room.members.find(m=>m.id===actor);
      if(!member)throw new MatchError('not_member');
      if(action==='ready'){
        if(record.room.status!=='waiting')throw new MatchError('not_waiting');member.ready=params.ready;
      }else if(action==='leave') {
        if(record.room.hostId===actor){record.room.status='closed';record.room.members=[];}
        else record.room.members=record.room.members.filter(m=>m.id!==actor);
        return {left:true};
      }
    }
    const result=await rooms.snapshot(roomId,actor,()=>matches.read(roomId,actor));
    envelopes.set(receiptKey,structuredClone(result));return result;
  },
};
const gateway=createGateway({auth:async token=>token.startsWith('offline:')?{id:token.slice(8)}:null,rooms,matches,
  limiter:{consume:async()=>!denyBudget},challenge:async token=>{if(token!=='offline-fixture-token')throw Error('fixture challenge missing');},
  capabilityKey:TEST_KEY,networkHash:async()=> 'offline-loopback',clock,
  allowedOrigins:[process.env.MATH24_TEST_ORIGIN].filter(Boolean),
  readiness:async()=>({ready:true,mode:'offline-test-double',blockers:['real_supabase_not_tested']})});
const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://127.0.0.1');
    if(url.pathname.startsWith('/_test/')) {
      let result={};
      const id=url.searchParams.get('room'),actor=url.searchParams.get('actor');
      if(url.pathname==='/_test/rate')denyBudget=url.searchParams.get('deny')==='1';
      else if(url.pathname==='/_test/solution') {
        const state=repo.records.get(id)?.match,p=state?.players.find(p=>p.id===actor);
        result={solution:state?.questions[p?.index]?.solution};
      }else if(url.pathname==='/_test/full') {
        const room=repo.records.get(id).room;
        while(room.members.length<50)room.members.push({id:randomUUID(),name:'Fixture',ready:true});
      }else if(url.pathname==='/_test/expire')offset+=121*60000;
      else if(url.pathname==='/_test/records')result={rooms:[...repo.records.keys()]};
      res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result));return;
    }
    const request=new Request('http://127.0.0.1'+req.url,{method:req.method,headers:req.headers,
      ...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{})});
    const response=await gateway(request);
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(500,{'content-type':'application/json'});res.end('{"error":"offline_fixture_failure"}');}
});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port,mode:'OFFLINE TEST DOUBLE'})));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
