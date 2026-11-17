import test from 'node:test';
import assert from 'node:assert/strict';
import {Session,ClientError,validatePublicConfig,fixtureMode} from '../../multiplayer/session.mjs';
import {OnlineAPI} from '../../multiplayer/api.mjs';
import {RoomSync,subscribeRoom} from '../../multiplayer/sync.mjs';
const memory=()=>{const values=new Map();return {getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};};
function sdk({existing=null,user=existing?.user}={}){
  let created=0,active=existing;
  return {auth:{getSession:async()=>({data:{session:active}}),getUser:async()=>({data:{user}}),
    onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>{active=null;return {error:null};},
    signInAnonymously:async()=>{created++;return {data:{session:{access_token:'fixture',user:{id:'fixture-user'}}}};}},count:()=>created};
}
test('session reuses an existing verified identity and does not create anonymous accounts',async()=>{
  const client=sdk({existing:{access_token:'existing',user:{id:'a'}}}),session=new Session(client,memory(),'key');
  assert.equal((await session.ensure()).user.id,'a');assert.equal(client.count(),0);
});
test('simultaneous session requests create at most one fixture identity',async()=>{
  const client=sdk(),session=new Session(client,memory(),'key');
  await Promise.all([session.ensure({allowCreate:true}),session.ensure({allowCreate:true})]);assert.equal(client.count(),1);
});
test('lost session never silently creates a replacement identity',async()=>{
  const client=sdk(),storage=memory();storage.setItem('key','yes');const session=new Session(client,storage,'key');
  await assert.rejects(session.ensure({allowCreate:true}),/session_expired/);assert.equal(client.count(),0);
  await session.ensure({allowCreate:true,newIdentity:true});assert.equal(client.count(),1);
});
test('configuration rejects secrets, credentials in URLs, and non-TLS remote endpoints',()=>{
  const valid={supabaseUrl:'https://fixture.supabase.co',gatewayUrl:'https://gateway.invalid/api',publishableKey:'sb_publishable_fixture'};
  assert.equal(validatePublicConfig(valid).gatewayUrl,'https://gateway.invalid/api');
  for(const change of [{publishableKey:'sb_secret_'+'fixture'},{gatewayUrl:'http://remote.invalid'},{supabaseUrl:'https://reader:password@fixture.supabase.co'}])assert.throws(()=>validatePublicConfig({...valid,...change}),/configuration_required/);
});
test('blocked gateway capabilities prevent calling any mutation',async()=>{
  const api=new OnlineAPI('https://fixture.invalid/api',{fetchImpl:async()=>new Response('{"ready":false}')});
  await assert.rejects(api.check(),/online_unavailable/);await assert.rejects(api.call('create',null,{}),/online_unavailable/);
});
test('transport retry preserves request id and does not fall back to direct Supabase RPC',async()=>{
  const seen=[];let calls=0;
  const api=new OnlineAPI('https://fixture.invalid/api',{session:{ensure:async()=>({access_token:'fixture'})},challenge:async()=> 'fixture',
    fetchImpl:async(url,options)=>{seen.push({url:String(url),body:JSON.parse(options.body)});if(!calls++)throw Error('lost');return new Response('{}');}});
  api.capabilities={ready:true,mode:'offline-test-double'};
  await assert.rejects(api.call('join',null,{code:'000123',nickname:'a'}),/connection_lost/);
  await api.call('join',null,{code:'000123',nickname:'a'});
  assert.equal(seen[0].body.requestId,seen[1].body.requestId);assert.equal(seen[0].url,'https://fixture.invalid/api/join');
});
test('in-flight snapshot from a previous room cannot overwrite the new room',async()=>{
  let resolveOld;const seen=[];
  const sync=new RoomSync({load:async id=>id==='old'?new Promise(resolve=>resolveOld=resolve):{id},onSnapshot:v=>seen.push(v),onState(){},pollMs:60000});
  sync.start('old');sync.start('new');await new Promise(resolve=>setTimeout(resolve,0));resolveOld({id:'old'});await new Promise(resolve=>setTimeout(resolve,0));sync.stop();
  assert.deepEqual(seen,[{id:'new'}]);
});
test('events during snapshot fetch cause another snapshot rather than applying payloads',async()=>{
  let event,resolveFirst,calls=0;const seen=[];
  const sync=new RoomSync({load:async()=>++calls===1?new Promise(resolve=>resolveFirst=resolve):{version:2},
    subscribe:(id,fn)=>{event=fn;return ()=>{};},onSnapshot:value=>seen.push(value.version),onState(){},pollMs:60000});
  sync.start('room');event('CHANGE');resolveFirst({version:1});await new Promise(resolve=>setTimeout(resolve,0));sync.stop();
  assert.deepEqual(seen,[1,2]);assert.equal(calls,2);
});
test('Realtime subscriptions scope the two existing tables and clean up on leave',()=>{
  const filters=[];let removed=false;
  const channel={on(event,filter,callback){filters.push(filter);return this;},subscribe(){return this;}};
  const unsubscribe=subscribeRoom({channel:()=>channel,removeChannel:()=>{removed=true;}},'room',()=>{});
  assert.deepEqual(filters.map(f=>[f.table,f.filter]),[['math24_rooms','id=eq.room'],['math24_room_members','room_id=eq.room']]);unsubscribe();assert.equal(removed,true);
});

test('explicit replacement clears an invalid cached session before creating a new identity',async()=>{
  const client=sdk({existing:{access_token:'revoked',user:{id:'old'}},user:null}),session=new Session(client,memory(),'key');
  await assert.rejects(session.ensure(),/session_expired/);
  const next=await session.ensure({allowCreate:true,newIdentity:true});
  assert.equal(next.user.id,'fixture-user');assert.equal(client.count(),1);
});
test('transient Auth verification failures do not encourage or create replacement accounts',async()=>{
  const client=sdk({existing:{access_token:'existing',user:{id:'a'}}});
  client.auth.getUser=async()=>({error:{status:503}});
  const session=new Session(client,memory(),'key');
  await assert.rejects(session.ensure({allowCreate:true}),/connection_lost/);assert.equal(client.count(),0);
});

test('offline mode requires a loopback Auth fixture and never falls through to real Supabase',()=>{
  const caps={mode:'offline-test-double'};
  assert.equal(fixtureMode({supabaseUrl:'http://127.0.0.1:9999'},caps,()=>{}),true);
  assert.throws(()=>fixtureMode({supabaseUrl:'https://real-project.supabase.co'},caps,()=>{}),/online_unavailable/);
  assert.throws(()=>fixtureMode({supabaseUrl:'http://localhost:9999'},caps,undefined),/online_unavailable/);
  assert.equal(fixtureMode({supabaseUrl:'https://real-project.supabase.co'},{mode:'online'},()=>{}),false);
});
test('legacy anon API keys are accepted for Local Supabase while service-role keys are rejected',()=>{
  const token=role=>[Buffer.from('{"alg":"HS256"}').toString('base64url'),Buffer.from(JSON.stringify({role})).toString('base64url'),'fixture-signature'].join('.');
  const config={supabaseUrl:'http://127.0.0.1:54321',gatewayUrl:'http://127.0.0.1:54330',publishableKey:token('anon')};
  assert.equal(validatePublicConfig(config).publishableKey,config.publishableKey);
  assert.throws(()=>validatePublicConfig({...config,publishableKey:token('service_role')}),/configuration_required/);
});
