// Server-only state machine. A durable store must serialize each match transaction.
import { randomInt, randomUUID } from 'node:crypto';
import { calculateAnswer, is24, playablePool, operationHint, firstStepHint } from './math-rules.mjs';

export class MatchError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new MatchError(code); };
const levels = ['easy', 'medium', 'hard'];
const bases = {easy: 10, medium: 20, hard: 30};
const hintLimits = {easy: 2, medium: 1, hard: 0};
const charges = {easy: 5, medium: 10, hard: 0};
const keyOf = nums => [...nums].sort((a,b) => a-b).join(',');
const safeTime = n => Number.isSafeInteger(n) && n >= 0;
const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id);

export function validateSettings(settings) {
  if (!settings || ![5,10,15,20].includes(settings.count) ||
      !Number.isInteger(settings.duration) || settings.duration < 1 || settings.duration > 120 ||
      !['basic','advanced'].includes(settings.mode) ||
      ![...levels,'mixed'].includes(settings.difficulty) || !['live','final'].includes(settings.ranking)) fail('invalid_settings');
  if (settings.difficulty === 'mixed' && (!Array.isArray(settings.mix) || settings.mix.length !== 3 ||
      settings.mix.some(n => !Number.isInteger(n) || n < 0 || n > settings.count) ||
      settings.mix.reduce((a,b) => a+b,0) !== settings.count)) fail('invalid_mix');
  return structuredClone(settings);
}

function shuffled(items, choose) {
  const out = [...items];
  for (let i=out.length-1; i>0; i--) {
    const j = choose(i+1);
    if (!Number.isInteger(j) || j < 0 || j > i) fail('invalid_random_source');
    [out[i],out[j]] = [out[j],out[i]];
  }
  return out;
}

export function createMatch({roomId, hostId, members, settings}, now, choose = randomInt) {
  settings = validateSettings(settings);
  if (!safeTime(now) || !validId(roomId) || !validId(hostId) || !Array.isArray(members) ||
      members.length < 2 || members.length > 50 || !members.some(m => m.id === hostId) ||
      members.some(m => !validId(m.id) || m.ready !== true || typeof m.name !== 'string' || m.name.length > 60) ||
      new Set(members.map(m => m.id)).size !== members.length) fail('not_ready');
  const used = new Set(), questions = [];
  const counts = settings.difficulty === 'mixed' ? settings.mix : levels.map(d => d === settings.difficulty ? settings.count : 0);
  for (const [index, difficulty] of levels.entries()) {
    const pool = shuffled(playablePool(settings.mode,difficulty), choose).filter(p => !used.has(keyOf(p.nums)));
    // Deduplicate within each pool, too; match order is common to every participant.
    for (const puzzle of pool) {
      if (questions.filter(q => q.difficulty === difficulty).length >= counts[index]) break;
      if (used.has(keyOf(puzzle.nums))) continue;
      if (!is24(calculateAnswer(puzzle.solution,puzzle.nums,settings.mode))) fail('invalid_bank');
      used.add(keyOf(puzzle.nums));
      questions.push({id: randomUUID(), nums: [...puzzle.nums], solution: puzzle.solution, mode: settings.mode, difficulty});
    }
    if (questions.filter(q => q.difficulty === difficulty).length !== counts[index]) fail('insufficient_bank');
  }
  return {version: 1, roomId, hostId, settings, status: 'running', startsAt: now,
    deadline: now + settings.duration*60000, endedAt: null, reason: null,
    questions: shuffled(questions, choose), players: members.map(m => ({id:m.id, name:m.name,
      index:0, score:0, solved:0, skipped:0, completed:0, hints:0, status:'active',
      questionStartedAt:now, elapsedTotal:0, finishedAt:null, receipts:[]}))};
}

function playerFor(match, actor) {
  const player = match.players.find(p => p.id === actor);
  if (!player) fail('not_member');
  return player;
}
function finish(match, now) {
  if (match.status === 'finished') return;
  if (now >= match.deadline || match.players.every(p => p.finishedAt !== null)) {
    match.status = 'finished';
    match.endedAt = now >= match.deadline ? match.deadline : now;
    match.reason = now >= match.deadline ? 'time' : 'complete';
  }
}

export function applyCommand(original, actor, command, now) {
  if (!safeTime(now) || now < original.startsAt) fail('invalid_server_time');
  const match = structuredClone(original);
  const player = playerFor(match, actor);
  if (now < player.questionStartedAt) fail('invalid_server_time');
  if (!command || Object.keys(command).some(k => !['requestId','questionId','type','formula'].includes(k)) ||
      !validId(command.requestId) || command.requestId.length < 8 ||
      !['answer','hint','next'].includes(command.type) || typeof command.questionId !== 'string' ||
      (command.type === 'answer' && (typeof command.formula !== 'string' || command.formula.length > 512)) ||
      (command.type !== 'answer' && command.formula !== undefined)) fail('invalid_command');
  const signature = JSON.stringify([command.type,command.questionId,command.formula ?? null]);
  const prior = player.receipts.find(r => r.id === command.requestId);
  if (prior) {
    if (prior.signature !== signature) fail('idempotency_conflict');
    finish(match,now);
    return {match, result: structuredClone(prior.result)};
  }
  finish(match,now);
  if (match.status !== 'running' || player.finishedAt !== null) fail('match_finished');
  const q = match.questions[player.index];
  if (command.questionId !== q.id) fail('stale_question');
  if (player.receipts.length >= 1024) fail('request_budget');
  let result;
  const duration = Math.max(0,now - player.questionStartedAt);
  if (command.type === 'answer') {
    if (player.status !== 'active') fail('already_completed');
    let correct = false;
    try { correct = is24(calculateAnswer(command.formula,q.nums,q.mode)); }
    catch { /* Invalid formula is a rejected answer, never evaluated as JavaScript. */ }
    if (correct) {
      const bonus = duration <= 30000 ? 10 : duration <= 60000 ? 5 : 0;
      const points = Math.max(0,bases[q.difficulty] + bonus - player.hints*charges[q.difficulty]);
      player.score += points;
      player.solved++; player.completed++; player.status = 'solved'; player.elapsedTotal += duration;
      if (player.completed === match.questions.length) player.finishedAt = now;
      result = {correct:true, points};
    } else result = {correct:false, points:0};
  } else if (command.type === 'hint') {
    if (player.status !== 'active' || player.hints >= hintLimits[q.difficulty]) fail('hint_unavailable');
    player.hints++;
    result = {hint:player.hints === 1 ? operationHint(q.solution) : firstStepHint(q.solution),
      used:player.hints, penalty:player.hints*charges[q.difficulty]};
  } else {
    if (player.status === 'active') { player.skipped++; player.completed++; player.elapsedTotal += duration; }
    player.index++;
    player.hints = 0; player.questionStartedAt = now; player.status = 'active';
    if (player.index >= match.questions.length) player.finishedAt = now;
    result = {advanced:true};
  }
  player.receipts.push({id:command.requestId, signature, result:structuredClone(result)});
  match.version++;
  finish(match,now);
  return {match, result};
}

export function snapshot(original, actor, now) {
  if (!safeTime(now) || now < original.startsAt) fail('invalid_server_time');
  const match = structuredClone(original), player = playerFor(match,actor);
  finish(match,now);
  const q = match.questions[player.index];
  let ranking = null;
  if (match.settings.ranking === 'live' || match.status === 'finished') {
    const sorted = [...match.players].sort((a,b) => b.score-a.score || b.solved-a.solved || a.elapsedTotal-b.elapsedTotal || a.id.localeCompare(b.id));
    let rank=0, previous=null;
    ranking = sorted.map((p,i) => {
      const tie = JSON.stringify([p.score,p.solved,p.elapsedTotal]);
      if (tie !== previous) rank=i+1;
      previous=tie;
      return {rank, id:p.id, name:p.name, score:p.score, solved:p.solved, completed:p.completed, elapsedMs:p.elapsedTotal};
    });
  }
  return {version:match.version, roomId:match.roomId, status:match.status, startsAt:match.startsAt,
    deadline:match.deadline, endedAt:match.endedAt, reason:match.reason, serverNow:now,
    total:match.questions.length, me:{id:player.id, score:player.score, solved:player.solved,
      skipped:player.skipped, completed:player.completed, finished:player.finishedAt !== null},
    question:match.status === 'running' && player.finishedAt === null ? {id:q.id, nums:[...q.nums],
      mode:q.mode, difficulty:q.difficulty, index:player.index, startedAt:player.questionStartedAt,
      status:player.status, hints:player.hints, hintLimit:hintLimits[q.difficulty]} : null, ranking};
}
