import {isPublicApiKey} from '../shared/public-key.mjs';
export class ClientError extends Error {
  constructor(code,status=0) { super(code);this.code=code;this.status=status; }
}
export function publicUrl(value) {
  let url;try {url=new URL(value);}catch {throw new ClientError('configuration_required');}
  if(url.username||url.password||url.search||url.hash||
    (url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))))throw new ClientError('configuration_required');
  return url;
}
export function validatePublicConfig(config) {
  const project=publicUrl(config.supabaseUrl),gateway=publicUrl(config.gatewayUrl);
  if(project.pathname!=='/'||!isPublicApiKey(config.publishableKey))throw new ClientError('configuration_required');
  return {...config,supabaseUrl:project.href,gatewayUrl:gateway.href.replace(/\/$/,'')};
}
// Offline integration must never fall through to real Supabase Auth.
export function fixtureMode(config,capabilities,factory) {
  if(capabilities.mode!=='offline-test-double')return false;
  if(!['localhost','127.0.0.1','[::1]'].includes(publicUrl(config.supabaseUrl).hostname)||typeof factory!=='function')throw new ClientError('online_unavailable');
  return true;
}
export class Session {
  constructor(client,storage,key) {this.client=client;this.storage=storage;this.key=key;this.pending=null;this.listeners=new Set();
    const {data}=client.auth.onAuthStateChange((event,session)=>{
      queueMicrotask(()=>{for(const fn of this.listeners)fn(event,session);});
    });this.subscription=data?.subscription;
  }
  seen() {try{return this.storage.getItem(this.key)==='yes';}catch{return true;}}
  mark() {try{this.storage.setItem(this.key,'yes');}catch{/* Do not leak storage exceptions. */}}
  onChange(fn) {this.listeners.add(fn);return ()=>this.listeners.delete(fn);}
  ensure({allowCreate=false,newIdentity=false,captchaToken}={}) {
    if(this.pending)return this.pending;
    this.pending=this.obtain({allowCreate,newIdentity,captchaToken}).catch(error=>{throw error instanceof ClientError?error:new ClientError('connection_lost');}).finally(()=>{this.pending=null;});
    return this.pending;
  }
  async obtain({allowCreate,newIdentity,captchaToken}) {
    if(newIdentity){const result=await this.client.auth.signOut({scope:'local'});if(result.error)throw new ClientError('signin_failed');}
    const {data,error}=await this.client.auth.getSession();
    if(error)throw new ClientError([401,403].includes(error.status)?'session_expired':'connection_lost');
    if(data?.session?.access_token) {
      const user=await this.client.auth.getUser();
      if(user.error)throw new ClientError([401,403].includes(user.error.status)?'session_expired':'connection_lost');
      if(user.data?.user?.id!==data.session.user.id)throw new ClientError('session_expired');
      this.mark();return data.session;
    }
    if(!allowCreate||(this.seen()&&!newIdentity))throw new ClientError('session_expired');
    const token=typeof captchaToken==='function'?await captchaToken():captchaToken;
    const result=await this.client.auth.signInAnonymously({options:{captchaToken:token}});
    if(result.error||!result.data?.session?.access_token)throw new ClientError('signin_failed');
    this.mark();return result.data.session;
  }
  close() {this.subscription?.unsubscribe();this.listeners.clear();}
}
