import {issueCapability,budgets,ProtectionError} from './protection.mjs';
import {MatchError} from './match-engine.mjs';
import {rpcRequest} from './room-contract.mjs';

const uuid=/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const roomActions=new Set(['create','join','ready','leave']);
export const BLOCKERS=['reviewed_baseline','database_rpc_guard','durable_match_repository','auth_abuse_protection','real_database_e2e'];

async function readLimited(request) {
  if(!request.body)return '';
  const reader=request.body.getReader(),chunks=[];let size=0;
  while(true) {
    const {value,done}=await reader.read();if(done)break;
    size+=value.length;
    if(size>8192) {await reader.cancel();throw new ProtectionError('request_too_large');}
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// Inject verified integrations. Without them the gateway advertises unavailable
// and refuses mutations, rather than forwarding to unguarded dev RPCs.
export function createGateway({auth,rooms,matches,limiter,challenge,capabilityKey,networkHash,
  readiness=async()=>({ready:false,mode:'unavailable',blockers:BLOCKERS}),allowedOrigins=[],clock=Date.now}) {
  return async function handle(request) {
    const origin=request.headers.get('origin');
    if(origin && !allowedOrigins.includes(origin)) return json({error:'origin_denied'},403);
    const headers=origin?{'access-control-allow-origin':origin,'vary':'Origin'}:{};
    const respond=(body,status=200)=>{
      const response=json(body,status);
      for(const [key,value]of Object.entries(headers))response.headers.set(key,value);
      return response;
    };
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,
      'access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'authorization, content-type'}});
    try {
      const url=new URL(request.url), state=await readiness();
      if(url.pathname==='/capabilities' && request.method==='GET')return respond(state);
      if(!state.ready || !auth || !rooms || !matches || !limiter || !challenge || !networkHash || !capabilityKey)
        return respond({error:'online_unavailable',blockers:state.blockers??BLOCKERS},503);
      const bearer=request.headers.get('authorization');
      if(!bearer?.startsWith('Bearer ') || bearer.length>8192)return respond({error:'session_required'},401);
      // Auth integration must validate with Supabase Auth or a verified JWT/JWKS.
      // Decoding a JWT payload without verification is never accepted here.
      const user=await auth(bearer.slice(7));
      if(!user?.id || !uuid.test(user.id))return respond({error:'session_required'},401);
      const segments=url.pathname.split('/').filter(Boolean);
      const action=segments[0];
      if(![...roomActions,'start','snapshot','answer','hint','next'].includes(action))return respond({error:'not_found'},404);
      const read=action==='snapshot';
      if(request.method!==(read?'GET':'POST'))return respond({error:'method_not_allowed'},405);
      const roomId=segments[1];
      if(segments.length>(['create','join'].includes(action)?1:2) || (!['create','join'].includes(action) && !uuid.test(roomId??'')))return respond({error:'invalid_room'},400);
      let body={};
      if(!read) {
        const raw=await readLimited(request);
        if(raw.length>8192)return respond({error:'request_too_large'},413);
        body=JSON.parse(raw);
        if(!body || typeof body!=='object' || Array.isArray(body))return respond({error:'invalid_request'},400);
      }
      const network=await networkHash(request); // Trusted server transport, not XFF from the browser.
      if(!await limiter.consume(budgets(user.id,network,action),clock()))return respond({error:'rate_limited'},429);
      if(read)return respond(await rooms.snapshot(roomId,user.id,()=>matches.read(roomId,user.id)));
      if(typeof body.requestId!=='string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(body.requestId))return respond({error:'invalid_request'},400);
      const {requestId,challengeToken,...params}=body;
      if(['create','join'].includes(action))await challenge(challengeToken,action);
      if(roomActions.has(action) || action==='start')rpcRequest(action,params,roomId);
      const proof=issueCapability(capabilityKey,{actor:user.id,action,params:{...params,...(roomId?{roomId}:{})},requestId},clock());
      if(roomActions.has(action))return respond(await rooms.mutate({action,actor:user.id,roomId,params,requestId,proof}));
      // The repository must consume/verify proof within the same DB transaction,
      // not just trust that the HTTP gateway already checked it.
      const context={action,actor:user.id,roomId,params,requestId,proof};
      if(action==='start')return respond(await matches.start(roomId,user.id,context));
      return respond(await matches.command(roomId,user.id,{...params,type:action,requestId},context));
    } catch(error) {
      if(error instanceof MatchError)return respond({error:error.code},error.code==='not_member'||error.code==='not_owner'?403:409);
      if(error instanceof SyntaxError)return respond({error:'invalid_request'},400);
      if(error instanceof ProtectionError)return respond({error:error.message==='request_too_large'?'request_too_large':'request_denied'},error.message==='request_too_large'?413:403);
      // Do not expose provider messages, query text, tokens, codes or stack traces.
      return respond({error:'request_unavailable'},503);
    }
  };
}
