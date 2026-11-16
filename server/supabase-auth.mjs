import {isPublicApiKey} from '../shared/public-key.mjs';
// Verification against Supabase Auth; no unverified JWT-payload authorization.
export function supabaseAuthenticator(projectUrl,publishableKey,fetchImpl=fetch) {
  const url=new URL(projectUrl);
  if(url.protocol!=='https:' && !(['127.0.0.1','localhost'].includes(url.hostname)&&url.protocol==='http:'))throw Error('invalid_auth_url');
  if(url.pathname!=='/'||url.username||url.password||url.search||url.hash)throw Error('invalid_auth_url');
  if(!isPublicApiKey(publishableKey))throw Error('publishable_key_required');
  return async token=>{
    const response=await fetchImpl(new URL('/auth/v1/user',url),{headers:{apikey:publishableKey,authorization:`Bearer ${token}`},signal:AbortSignal.timeout(5000)});
    if(response.status===401||response.status===403)return null;
    if(!response.ok)throw Error('auth_unavailable');
    const user=await response.json();
    return user?.id?{id:user.id,isAnonymous:user.is_anonymous===true}:null;
  };
}
