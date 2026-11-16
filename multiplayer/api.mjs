import {ClientError,publicUrl} from './session.mjs';
export class OnlineAPI {
  constructor(base,{session,fetchImpl=fetch,challenge=async()=>{throw new ClientError('captcha_required');}}={}) {
    this.base=publicUrl(base).href.replace(/\/$/,'')+'/';this.session=session;this.fetch=(...args)=>fetchImpl(...args);this.challenge=challenge;this.pending=new Map();this.capabilities=null;
  }
  async request(path,options={}) {
    let response;try {response=await this.fetch(new URL(path,this.base),{...options,cache:'no-store',signal:AbortSignal.timeout(10000)});}catch{throw new ClientError('connection_lost');}
    let body;try {body=await response.json();}catch{throw new ClientError('invalid_response');}
    if(!response.ok)throw new ClientError(typeof body?.error==='string'?body.error:'request_unavailable',response.status);
    return body;
  }
  async check() {
    const caps=await this.request('capabilities');
    if(caps.ready!==true||!['online','offline-test-double'].includes(caps.mode))throw new ClientError('online_unavailable');
    this.capabilities=caps;return caps;
  }
  async call(action,roomId,params={}) {
    if(!this.capabilities)throw new ClientError('online_unavailable');
    const session=await this.session.ensure();
    const path=action+(roomId?'/'+encodeURIComponent(roomId):'');
    if(action==='snapshot')return this.request(path,{headers:{authorization:'Bearer '+session.access_token}});
    const key=JSON.stringify([action,roomId,params]);
    const requestId=this.pending.get(key)??crypto.randomUUID();this.pending.set(key,requestId);
    const challengeToken=['create','join'].includes(action)?await this.challenge(action):undefined;
    try {
      const data=await this.request(path,{method:'POST',headers:{authorization:'Bearer '+session.access_token,'content-type':'application/json'},
        body:JSON.stringify({...params,requestId,...(challengeToken?{challengeToken}:{})})});
      this.pending.delete(key);return data;
    } catch(error) {
      if(error.status)this.pending.delete(key); // Only transport uncertainty retains the same intent ID.
      throw error;
    }
  }
}
