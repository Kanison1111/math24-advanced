import test from 'node:test';
import assert from 'node:assert/strict';
import {issueCapability,verifyCapability,verifyTurnstile,budgets} from '../../server/protection.mjs';
import {rpcRequest,capabilityParams} from '../../server/room-contract.mjs';
import {createGateway} from '../../server/gateway.mjs';
const key='offline-test-only-'.repeat(3), binding={actor:'actor-a',action:'join',params:{code:'000123',nickname:'a'},requestId:'request-a'};
test('signed capability binds actor, operation, args, request id and expiry',()=>{
  const proof=issueCapability(key,binding,1000);
  assert.equal(verifyCapability(key,proof,binding,1001).actor,'actor-a');
  for(const changed of [{actor:'actor-b'},{action:'create'},{requestId:'request-b'},{params:{...binding.params,code:'000124'}}])
    assert.throws(()=>verifyCapability(key,proof,{...binding,...changed},1001),/request_denied/);
  assert.throws(()=>verifyCapability(key,proof,binding,31000),/request_denied/);
  assert.throws(()=>verifyCapability(key,proof+'x',binding,1001),/request_denied/);
});
test('missing signing key fails closed',()=>{
  assert.throws(()=>issueCapability('',binding,1000),/server_key_missing/);
  assert.throws(()=>verifyCapability('',issueCapability(key,binding,1000),binding,1001),/request_denied/);
});
test('Turnstile server verification validates success, hostname and action',async()=>{
  let called;
  const cfg={secret:'offline-fixture',hostnames:['fixture.invalid'],token:'fixture-token',action:'join',
    fetchImpl:async(url,options)=>{called={url,options};return new Response(JSON.stringify({success:true,hostname:'fixture.invalid',action:'join'}));}};
  assert.equal(await verifyTurnstile(cfg),true);
  assert.equal(called.url,'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  for(const value of [{success:false},{success:true,hostname:'evil.invalid',action:'join'},{success:true,hostname:'fixture.invalid',action:'create'}])
    await assert.rejects(verifyTurnstile({...cfg,fetchImpl:async()=>new Response(JSON.stringify(value))}),/request_denied/);
  await assert.rejects(verifyTurnstile({...cfg,fetchImpl:async()=>{throw Error('outage');}}),/request_denied/);
});
test('limiter budgets include uid, trusted network and global scopes',()=>{
  const a=budgets('one','shared-network','join'),b=budgets('two','shared-network','join');
  assert.notEqual(a[0].key,b[0].key); assert.equal(a[1].key,b[1].key);assert.equal(a[2].key,b[2].key);
  assert.equal(a[0].limit,5); assert.equal(a[0].windowMs,600000);
  assert.throws(()=>budgets('one','','join'),/request_denied/);
});
test('RPC mapper uses existing signatures, preserves leading-zero codes and rejects forged owners',()=>{
  assert.deepEqual(rpcRequest('join',{code:'000123',nickname:' เพื่อน '}),{name:'math24_join_room',args:{p_code:'000123',p_nickname:'เพื่อน'}});
  const settings={name:'ห้อง',count:5,duration:10,mode:'basic',difficulty:'easy',ranking:'live'};
  assert.equal(rpcRequest('create',settings).args.p_mix_easy,0);
  assert.throws(()=>rpcRequest('create',{...settings,owner_id:'another-user'}),/invalid_room_request/);
  assert.throws(()=>rpcRequest('ready',{ready:true,user_id:'another-user'},'room'),/invalid_room_request/);
});
test('gateway without database guards advertises blocked and refuses mutation',async()=>{
  const gateway=createGateway({});
  const capabilities=await (await gateway(new Request('http://fixture/capabilities'))).json();
  assert.equal(capabilities.ready,false);
  const response=await gateway(new Request('http://fixture/create',{method:'POST',body:'{}'}));
  assert.equal(response.status,503);
});
test('gateway rejects untrusted origins even before readiness checks',async()=>{
  const response=await createGateway({})(new Request('http://fixture/capabilities',{headers:{Origin:'https://evil.invalid'}}));
  assert.equal(response.status,403);
});
test('Supabase authenticator verifies users remotely and rejects server secrets as public config',async()=>{
  const {supabaseAuthenticator}=await import('../../server/supabase-auth.mjs');
  let seen;
  const auth=supabaseAuthenticator('https://fixture.supabase.co','sb_publishable_fixture',async(url,options)=>{
    seen={url:String(url),headers:options.headers};return new Response(JSON.stringify({id:'verified-id',is_anonymous:true}));
  });
  assert.deepEqual(await auth('fixture-user-token'),{id:'verified-id',isAnonymous:true});
  assert.equal(seen.url,'https://fixture.supabase.co/auth/v1/user');
  assert.equal(seen.headers.authorization,'Bearer fixture-user-token');
  assert.throws(()=>supabaseAuthenticator('https://fixture.supabase.co','sb_secret_'+'not-real'),/publishable_key_required/);
  const reject=supabaseAuthenticator('https://fixture.supabase.co','sb_publishable_fixture',async()=>new Response('{}',{status:401}));
  assert.equal(await reject('not-a-valid-jwt'),null);
});
test('gateway supports an explicit function/API base path and rejects paths outside it',async()=>{
  const gateway=createGateway({basePath:'/functions/v1/math24-online'});
  const response=await gateway(new Request('https://fixture.invalid/functions/v1/math24-online/capabilities'));
  assert.equal(response.status,200);assert.equal((await response.json()).ready,false);
  assert.equal((await gateway(new Request('https://fixture.invalid/capabilities'))).status,404);
});

test('room capability binds normalized RPC args, including trimmed names and non-mixed zero counts',()=>{
  const params={name:'  room  ',count:5,duration:10,mode:'basic',difficulty:'easy',ranking:'live',mix:[4,3,3]};
  const bound=capabilityParams('create',params);
  assert.equal(bound.rpc,'math24_create_room');assert.equal(bound.args.p_name,'room');
  assert.deepEqual([bound.args.p_mix_easy,bound.args.p_mix_medium,bound.args.p_mix_hard],[0,0,0]);
  assert.deepEqual(capabilityParams('join',{code:'000123',nickname:' peer '}),{rpc:'math24_join_room',args:{p_code:'000123',p_nickname:'peer'}});
  assert.notDeepEqual(capabilityParams('start',{},'room-a'),capabilityParams('start',{},'room-b'));
});
test('legacy anon API-key compatibility still delegates user verification to Supabase Auth',async()=>{
  const {supabaseAuthenticator}=await import('../../server/supabase-auth.mjs');
  const token=role=>[Buffer.from('{"alg":"HS256"}').toString('base64url'),Buffer.from(JSON.stringify({role})).toString('base64url'),'fixture-signature'].join('.');
  let verified=false;
  const auth=supabaseAuthenticator('http://127.0.0.1:54321',token('anon'),async()=>{verified=true;return new Response('{}',{status:401});});
  assert.equal(await auth('forged-user-token'),null);assert.equal(verified,true);
  assert.throws(()=>supabaseAuthenticator('http://127.0.0.1:54321',token('service_role')),/publishable_key_required/);
});
