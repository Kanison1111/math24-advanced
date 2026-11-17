import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
export class ProtectionError extends Error {}
const deny = () => { throw new ProtectionError('request_denied'); };

// The DB guard must verify this exact signed wire payload and compare its params
// as JSONB to actual RPC arguments, then consume the nonce in the transaction.
export function issueCapability(key, {actor,action,params,requestId}, now) {
  if (typeof key !== 'string' || key.length < 32) throw new ProtectionError('server_key_missing');
  const payload=Buffer.from(JSON.stringify({v:1,actor,action,params,requestId,nonce:randomUUID(),expiresAt:now+30000})).toString('base64url');
  return payload+'.'+createHmac('sha256',key).update(payload).digest('hex');
}
export function verifyCapability(key, proof, {actor,action,params,requestId}, now) {
  if (typeof key !== 'string' || key.length < 32 || typeof proof !== 'string' || proof.length>8192) deny();
  const [payload,signature,...extra]=proof.split('.');
  if (extra.length || !/^[A-Za-z0-9_-]+$/.test(payload??'') || !/^[a-f0-9]{64}$/.test(signature??'')) deny();
  const expected=createHmac('sha256',key).update(payload).digest();
  if (!timingSafeEqual(expected,Buffer.from(signature,'hex'))) deny();
  let data;
  try { data=JSON.parse(Buffer.from(payload,'base64url').toString()); } catch { deny(); }
  if (data.v!==1 || data.actor!==actor || data.action!==action || data.requestId!==requestId ||
      JSON.stringify(data.params)!==JSON.stringify(params) || !Number.isSafeInteger(data.expiresAt) ||
      data.expiresAt<=now || data.expiresAt>now+30000 || typeof data.nonce!=='string') deny();
  return data;
}
export async function verifyTurnstile({secret,hostnames,token,action,fetchImpl=fetch}) {
  if (!secret || !Array.isArray(hostnames) || !hostnames.length || typeof token!=='string' || !token || token.length>2048) deny();
  let value;
  try {
    const response=await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify',{
      method:'POST',body:new URLSearchParams({secret,response:token}),signal:AbortSignal.timeout(5000)});
    if (!response.ok) deny();
    value=await response.json();
  } catch { deny(); }
  if (value.success!==true || !hostnames.includes(value.hostname) || value.action!==action) deny();
  return true;
}

export function budgets(actor, trustedNetworkHash, action) {
  if (!actor || !trustedNetworkHash || !['create','join','ready','start','leave','answer','hint','next','snapshot'].includes(action)) deny();
  // Proposed initial operational limits, not a claim that dev has them installed.
  const write=action!=='snapshot';
  return [
    {key:`uid:${actor}:${action}`,limit:action==='create'?3:action==='join'?5:write?90:120,windowMs:action==='join'?600000:60000},
    {key:`network:${trustedNetworkHash}:${action}`,limit:action==='create'?20:action==='join'?100:600,windowMs:60000},
    {key:`global:${action}`,limit:action==='create'?200:2000,windowMs:60000},
  ];
}
