// OFFLINE TEST DOUBLE ONLY. No production database schema is constructed here.
import {verifyCapability} from '../../server/protection.mjs';
import {MatchError} from '../../server/match-engine.mjs';
import {capabilityParams} from '../../server/room-contract.mjs';
export const TEST_KEY='offline-only-capability-key-'.repeat(2);
export const HOST='00000000-0000-4000-8000-000000000001';
export const PEER='00000000-0000-4000-8000-000000000002';
export const OUTSIDER='00000000-0000-4000-8000-000000000003';
export const ROOM='00000000-0000-4000-8000-000000000010';
export class FakeRepository {
  constructor(clock=()=>1000) {
    this.clock=clock; this.queues=new Map(); this.records=new Map(); this.failSave=false;
    this.records.set(ROOM,{room:{id:ROOM,name:'Offline fixture',code:'240024',hostId:HOST,status:'waiting',
      settings:{count:5,duration:10,mode:'basic',difficulty:'easy',ranking:'live'},
      members:[{id:HOST,name:'Host',ready:true},{id:PEER,name:'Peer',ready:true}]},match:null,nonces:[]});
  }
  async transaction(roomId,work) {
    const previous=this.queues.get(roomId)??Promise.resolve();
    let release;
    const next=new Promise(resolve=>release=resolve);
    this.queues.set(roomId,next);
    await previous;
    try {
      const record=structuredClone(this.records.get(roomId));
      const result=await work({
        readRoom:async()=>record?.room,
        readMatch:async()=>record?.match,
        startRoom:async()=>{if(this.rejectStart)return false;record.room.status='started';return true;},
        authorize:async context=>{
          const payload=verifyCapability(TEST_KEY,context.proof,{actor:context.actor,action:context.action,
            params:capabilityParams(context.action,context.params,context.roomId),requestId:context.requestId},this.clock());
          if(record.nonces.includes(payload.nonce))throw new MatchError('proof_replayed');
          record.nonces.push(payload.nonce);
        },
        saveMatch:async state=>{if(this.failSave)throw Error('fixture write failure');record.match=structuredClone(state);},
      });
      this.records.set(roomId,record);
      return result;
    } finally {
      release();
      if(this.queues.get(roomId)===next)this.queues.delete(roomId);
    }
  }
}
