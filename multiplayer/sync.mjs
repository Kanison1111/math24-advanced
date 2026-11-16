// Events invalidate snapshots. Never merge untrusted/out-of-order row payloads.
export class RoomSync {
  constructor({load,subscribe,onSnapshot,onState,pollMs=10000,retryBase=1000,random=Math.random}) {
    Object.assign(this,{load,subscribe,onSnapshot,onState,pollMs,retryBase,random});this.current=null;
  }
  start(roomId) {
    this.stop();
    const ctx={roomId,cancelled:false,running:false,dirty:false,failures:0,timer:null,unsubscribe:null};this.current=ctx;
    ctx.unsubscribe=this.subscribe?.(roomId,event=>{
      if(ctx.cancelled)return;
      if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(event))this.onState('reconnecting');
      this.refresh(ctx);
    });
    this.refresh(ctx);
  }
  async refresh(ctx=this.current) {
    if(!ctx||ctx.cancelled)return;
    if(ctx.running){ctx.dirty=true;return;}
    clearTimeout(ctx.timer);ctx.running=true;
    try {
      let rounds=0;
      do {
        ctx.dirty=false;
        const snapshot=await this.load(ctx.roomId);
        if(ctx.cancelled||this.current!==ctx)return;
        ctx.failures=0;this.onSnapshot(snapshot);this.onState('connected');
      }while(ctx.dirty&&++rounds<5);
    }catch(error){
      if(!ctx.cancelled){ctx.failures++;this.onState('reconnecting',error);}
    }finally{
      ctx.running=false;
      if(!ctx.cancelled&&this.current===ctx) {
        const wait=ctx.dirty?0:ctx.failures?Math.min(30000,this.retryBase*2**Math.min(ctx.failures-1,5))*(.8+.4*this.random()):this.pollMs;
        ctx.timer=setTimeout(()=>this.refresh(ctx),wait);
      }
    }
  }
  stop() {const ctx=this.current;if(ctx){ctx.cancelled=true;clearTimeout(ctx.timer);ctx.unsubscribe?.();}this.current=null;}
}
export function subscribeRoom(client,roomId,onEvent) {
  const channel=client.channel('math24-room-'+roomId)
    .on('postgres_changes',{event:'*',schema:'public',table:'math24_rooms',filter:'id=eq.'+roomId},()=>onEvent('CHANGE'))
    .on('postgres_changes',{event:'*',schema:'public',table:'math24_room_members',filter:'room_id=eq.'+roomId},()=>onEvent('CHANGE'))
    .subscribe(status=>onEvent(status));
  return ()=>{void client.removeChannel(channel);};
}
