// Verified signatures from PR #12. This maps arguments; it does not bypass guards.
import {MatchError,validateSettings} from './match-engine.mjs';
const reject=()=>{throw new MatchError('invalid_room_request');};
export function rpcRequest(action,params,roomId) {
  const allowed={create:['name','count','duration','mode','difficulty','ranking','mix'],
    join:['code','nickname'],ready:['ready'],start:[],leave:[]}[action];
  if(!allowed || !params || Object.keys(params).some(k=>!allowed.includes(k)))reject();
  if(action==='create') {
    validateSettings(params);
    if(typeof params.name!=='string'||!params.name.trim()||params.name.length>60)reject();
    const mix=params.difficulty==='mixed'?params.mix:[0,0,0];
    return {name:'math24_create_room',args:{p_name:params.name.trim(),p_question_count:params.count,
      p_duration_minutes:params.duration,p_mode:params.mode,p_difficulty:params.difficulty,
      p_ranking_mode:params.ranking,p_mix_easy:mix[0],p_mix_medium:mix[1],p_mix_hard:mix[2]}};
  }
  if(action==='join') {
    if(typeof params.code!=='string'||!/^\d{6}$/.test(params.code)||typeof params.nickname!=='string'||!params.nickname.trim()||params.nickname.length>24)reject();
    return {name:'math24_join_room',args:{p_code:params.code,p_nickname:params.nickname.trim()}};
  }
  if(typeof roomId!=='string'||!roomId)reject();
  if(action==='ready'&&typeof params.ready!=='boolean')reject();
  return {name:{ready:'math24_set_ready',start:'math24_start_room',leave:'math24_leave_room'}[action],
    args:{p_room_id:roomId,...(action==='ready'?{p_ready:params.ready}:{})}};
}

// Sign exactly the normalized named arguments the existing RPC will receive.
// The future DB guard compares payload.params.rpc/args as JSONB, not raw UI fields.
export function capabilityParams(action,params,roomId) {
  if(['create','join','ready','start','leave'].includes(action)) {
    const rpc=rpcRequest(action,params,roomId);
    return {rpc:rpc.name,args:rpc.args};
  }
  return {...params,roomId};
}
