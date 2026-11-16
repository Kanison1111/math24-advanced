import {createMatch, applyCommand, snapshot, MatchError} from './match-engine.mjs';

// No default/in-memory production store. Repository must use a real transaction
// locking the existing room row + match state, and recheck live membership.
export class MatchService {
  constructor(repository, clock=Date.now) { this.repository=repository; this.clock=clock; }
  async transact(roomId,actor,work) {
    return this.repository.transaction(roomId,async tx=>{
      const room=await tx.readRoom();
      if (!room || !room.members.some(m=>m.id===actor)) throw new MatchError('not_member');
      return work(tx,room,this.clock());
    });
  }
  start(roomId,actor,context) {
    return this.transact(roomId,actor,async(tx,room,now)=>{
      if(room.hostId!==actor) throw new MatchError('not_owner');
      if(!context?.proof || context.actor!==actor || context.roomId!==roomId || context.action!=='start' ||
          Object.keys(context.params??{}).length || context.requestId===undefined) throw new MatchError('authorization_required');
      await tx.authorize(context);
      let state=await tx.readMatch();
      if(!state) {
        if(room.status!=='waiting') throw new MatchError('not_waiting');
        state=createMatch({roomId,hostId:room.hostId,members:room.members,settings:room.settings},now);
        // Must call existing math24_start_room in THIS transaction with the
        // verified actor and proof. Never commit start separately from match.
        await tx.startRoom(); await tx.saveMatch(state);
      }
      return snapshot(state,actor,now);
    });
  }
  read(roomId,actor) {
    return this.transact(roomId,actor,async(tx,room,now)=>{
      const state=await tx.readMatch();
      if(!state) throw new MatchError('not_started');
      const view=snapshot(state,actor,now);
      if(view.status==='finished' && state.status!=='finished') {
        state.status=view.status; state.endedAt=view.endedAt; state.reason=view.reason;
        await tx.saveMatch(state);
      }
      return view;
    });
  }
  command(roomId,actor,command,context) {
    return this.transact(roomId,actor,async(tx,room,now)=>{
      const {type,requestId,...params}=command;
      if(!context?.proof || context.actor!==actor || context.roomId!==roomId || context.action!==type ||
          context.requestId!==requestId || JSON.stringify(context.params)!==JSON.stringify(params)) throw new MatchError('authorization_required');
      await tx.authorize(context);
      const state=await tx.readMatch();
      if(!state) throw new MatchError('not_started');
      const {match,result}=applyCommand(state,actor,command,now);
      await tx.saveMatch(match);
      return {result,snapshot:snapshot(match,actor,now)};
    });
  }
}
