import { randomUUID } from 'node:crypto';
import { MAIN_PROMPTS, FINAL_PROMPTS, SAFETY_QUIPS, shuffle } from './prompts.js';

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 12;
export const MAX_ANSWER_LEN = 80;
// How long we keep waiting for someone who just dropped off. Long enough to survive a
// phone locking or a wifi blip, short enough that a walk-out doesn't stall the party.
export const DROPOUT_GRACE_MS = 12_000;

const COLORS = [
  '#ff5d73', '#ffb23f', '#ffe066', '#7bdc7b', '#3ecfcf', '#4aa8ff',
  '#8f7bff', '#e46bff', '#ff8fb8', '#b6d94c', '#00d0a0', '#ff7a3d'
];

const ROUNDS = {
  1: { multiplier: 1, label: 'Round 1', kind: 'duel' },
  2: { multiplier: 2, label: 'Round 2', kind: 'duel' },
  3: { multiplier: 3, label: 'Last Lash', kind: 'final' }
};

export const DEFAULT_SETTINGS = {
  writeSeconds: 75,
  finalWriteSeconds: 100,
  voteSeconds: 25,
  revealSeconds: 7,
  scoreSeconds: 9,
  totalRounds: 3,
  useCustomOnly: false
};

export class Room {
  constructor(code, { onUpdate = () => {}, customPrompts = [] } = {}) {
    this.code = code;
    this.onUpdate = onUpdate;
    this.customPrompts = customPrompts;
    this.settings = { ...DEFAULT_SETTINGS };
    this.players = new Map();     // id -> player
    this.tokens = new Map();      // token -> id
    this.phase = 'lobby';
    this.round = 0;
    this.matchups = [];
    this.voteIndex = 0;
    this.deadline = null;
    this.lastReveal = null;
    this.message = null;
    this.createdAt = Date.now();
    this._timer = null;
    this._graceTimers = new Set();
    this._deck = [];
    this._finalDeck = [];
  }

  /* ------------------------------------------------------------------ players */

  get list() { return [...this.players.values()]; }
  get active() { return this.list.filter(p => p.connected); }
  /** Connected, or dropped so recently that we're still holding their place. */
  get present() { return this.list.filter(p => this._present(p.id)); }

  _present(id) {
    const p = this.players.get(id);
    if (!p) return false;
    return p.connected || (p.awaySince != null && Date.now() - p.awaySince < DROPOUT_GRACE_MS);
  }

  join(rawName, token) {
    if (token && this.tokens.has(token)) {
      const p = this.players.get(this.tokens.get(token));
      if (p) {
        p.connected = true;
        if (rawName) p.name = this._uniqueName(rawName, p.id);
        this.touch();
        return { ok: true, player: p, token, rejoined: true };
      }
    }
    const name = this._uniqueName(rawName);
    if (!name) return { ok: false, error: 'Enter a name first.' };
    if (this.phase !== 'lobby') {
      return { ok: false, error: 'That game is already in progress. Wait for the next one!' };
    }
    if (this.players.size >= MAX_PLAYERS) {
      return { ok: false, error: `This room is full (${MAX_PLAYERS} players).` };
    }
    const id = randomUUID();
    const newToken = randomUUID();
    const player = {
      id, name, score: 0, connected: true,
      color: COLORS[this.players.size % COLORS.length],
      roundPoints: 0
    };
    this.players.set(id, player);
    this.tokens.set(newToken, id);
    this.touch();
    return { ok: true, player, token: newToken };
  }

  _uniqueName(raw, ignoreId) {
    let name = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 14);
    if (!name) return '';
    const taken = new Set(this.list.filter(p => p.id !== ignoreId).map(p => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; i < 40; i++) {
      const candidate = `${name} ${i}`.slice(0, 16);
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return `${name}?`;
  }

  setConnected(playerId, connected) {
    const p = this.players.get(playerId);
    if (!p) return;
    p.connected = connected;
    p.awaySince = connected ? null : Date.now();
    if (!connected && this.phase === 'lobby') {
      // Free the slot entirely if they bail before the game starts.
      this.players.delete(playerId);
      for (const [t, id] of this.tokens) if (id === playerId) this.tokens.delete(t);
    }
    this.touch();
    if (connected) return;
    // Don't cut the round short for them yet — re-check once their grace period is up.
    const t = setTimeout(() => {
      this._graceTimers.delete(t);
      if (this.phase === 'writing') this._maybeFinishWriting();
      else if (this.phase === 'voting') this._maybeFinishVoting();
      else this.touch();
    }, DROPOUT_GRACE_MS + 150);
    this._graceTimers.add(t);
  }

  kick(playerId) {
    const p = this.players.get(playerId);
    if (!p) return;
    for (const [t, id] of this.tokens) if (id === playerId) this.tokens.delete(t);
    if (this.phase === 'lobby') {
      this.players.delete(playerId);
    } else {
      // Mid-game the matchups are already built around them, so leave their answers in
      // play (pulling them would leave a card with no author) — just stop waiting for
      // them, and don't let them back in on their old token.
      p.connected = false;
      p.awaySince = 0;
      p.kicked = true;
      this._maybeFinishWriting();
      this._maybeFinishVoting();
    }
    this.touch();
  }

  /* ------------------------------------------------------------------- flow */

  start(settings = {}) {
    if (this.phase !== 'lobby' && this.phase !== 'final') {
      return { ok: false, error: 'Game already running.' };
    }
    const ready = this.active;
    if (ready.length < MIN_PLAYERS) {
      return { ok: false, error: `You need at least ${MIN_PLAYERS} players.` };
    }
    this.settings = { ...this.settings, ...sanitizeSettings(settings) };
    for (const p of this.list) { p.score = 0; p.roundPoints = 0; }
    const pool = this.settings.useCustomOnly && this.customPrompts.length
      ? this.customPrompts
      : [...this.customPrompts, ...MAIN_PROMPTS];
    this._pool = pool;
    this._finalPool = (this.settings.useCustomOnly && this.customPrompts.length)
      ? this.customPrompts
      : FINAL_PROMPTS;
    this._deck = shuffle(this._pool);
    this._finalDeck = shuffle(this._finalPool);
    this.round = 0;
    this.message = null;
    this._beginRound(1);
    return { ok: true };
  }

  _beginRound(round) {
    this.round = round;
    this.matchups = this._buildMatchups(round);
    this.voteIndex = 0;
    this.lastReveal = null;
    for (const p of this.list) p.roundPoints = 0;
    const seconds = ROUNDS[round].kind === 'final'
      ? this.settings.finalWriteSeconds
      : this.settings.writeSeconds;
    this._setPhase('writing', seconds, () => this._finishWriting());
  }

  _buildMatchups(round) {
    const players = shuffle(this.present).map(p => p.id);
    const n = players.length;
    if (ROUNDS[round].kind === 'final') {
      return [this._matchup(players, this._drawPrompt(true))];
    }
    // Circle pairing: player i is paired with player i+k. Every player lands in
    // exactly two matchups, and k=2 (when it can't collide) mixes up round 2.
    const k = n >= 5 ? (round === 2 ? 2 : 1) : 1;
    return players.map((_, i) =>
      this._matchup([players[i], players[(i + k) % n]], this._drawPrompt(false))
    );
  }

  _matchup(playerIds, prompt) {
    return {
      id: randomUUID(),
      prompt,
      players: playerIds,
      answers: {},    // playerId -> { text, safety }
      votes: {},      // voterId -> playerId
      results: null
    };
  }

  _drawPrompt(final) {
    const deck = final ? this._finalDeck : this._deck;
    if (!deck.length) {
      // Long game, small prompt pack: reshuffle the same pool rather than falling back
      // to the built-in bank, which would ignore "use only my custom prompts".
      deck.push(...shuffle(final ? (this._finalPool ?? FINAL_PROMPTS) : (this._pool ?? MAIN_PROMPTS)));
    }
    return deck.pop();
  }

  /* ---------------------------------------------------------------- writing */

  submitAnswer(playerId, matchupId, text) {
    if (this.phase !== 'writing') return { ok: false, error: 'Too late!' };
    const m = this.matchups.find(x => x.id === matchupId);
    if (!m || !m.players.includes(playerId)) return { ok: false, error: 'Not your prompt.' };
    const clean = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_ANSWER_LEN);
    if (!clean) return { ok: false, error: 'Write something!' };
    m.answers[playerId] = { text: clean, safety: false };
    this.touch();
    this._maybeFinishWriting();
    return { ok: true };
  }

  _pendingWriters() {
    const pending = [];
    for (const p of this.present) {
      const owed = this.matchups.filter(m => m.players.includes(p.id));
      if (owed.some(m => !m.answers[p.id])) pending.push(p.id);
    }
    return pending;
  }

  _maybeFinishWriting() {
    if (this.phase === 'writing' && this._pendingWriters().length === 0) this._finishWriting();
  }

  _finishWriting() {
    if (this.phase !== 'writing') return;
    const safeties = shuffle(SAFETY_QUIPS);
    let si = 0;
    for (const m of this.matchups) {
      for (const pid of m.players) {
        if (!m.answers[pid]) {
          m.answers[pid] = { text: safeties[si++ % safeties.length], safety: true };
        }
      }
      m.order = shuffle(m.players); // display order, so position doesn't leak authorship
    }
    this.voteIndex = 0;
    this._startVoting();
  }

  /* ----------------------------------------------------------------- voting */

  _startVoting() {
    const m = this.matchups[this.voteIndex];
    if (!m) return this._finishRound();
    if (this._eligibleVoters(m).length === 0) {
      // Nobody left to judge this one — award nothing and move along.
      this._scoreMatchup(m);
      return this._nextAfterReveal();
    }
    this._setPhase('voting', this.settings.voteSeconds, () => this._finishVoting());
  }

  /** Who is allowed to cast a vote on this matchup right now. */
  _eligibleVoters(m) {
    // Last Lash: everyone answered, so everyone judges (they just can't pick their own).
    if (m.players.length > 2) return this.active.map(p => p.id);
    return this.active.filter(p => !m.players.includes(p.id)).map(p => p.id);
  }

  /** Who we're still waiting on — includes anyone inside their dropout grace period. */
  _awaitedVoters(m) {
    if (m.players.length > 2) return this.present.map(p => p.id);
    return this.present.filter(p => !m.players.includes(p.id)).map(p => p.id);
  }

  submitVote(voterId, matchupId, targetId) {
    if (this.phase !== 'voting') return { ok: false, error: 'Voting is closed.' };
    const m = this.matchups[this.voteIndex];
    if (!m || m.id !== matchupId) return { ok: false, error: 'That vote is stale.' };
    if (!this._eligibleVoters(m).includes(voterId)) return { ok: false, error: "You can't vote here." };
    if (!m.players.includes(targetId) || targetId === voterId) return { ok: false, error: 'Invalid choice.' };
    if (m.votes[voterId]) return { ok: false, error: 'You already voted.' };
    m.votes[voterId] = targetId;
    this.touch();
    this._maybeFinishVoting();
    return { ok: true };
  }

  _maybeFinishVoting() {
    if (this.phase !== 'voting') return;
    const m = this.matchups[this.voteIndex];
    if (!m) return;
    const awaited = this._awaitedVoters(m);
    if (awaited.length === 0 || awaited.every(id => m.votes[id])) this._finishVoting();
  }

  _finishVoting() {
    if (this.phase !== 'voting') return;
    if (!this.matchups[this.voteIndex]) return;
    const m = this.matchups[this.voteIndex];
    this._scoreMatchup(m);
    this._setPhase('reveal', this.settings.revealSeconds, () => this._nextAfterReveal());
  }

  _scoreMatchup(m) {
    const multiplier = ROUNDS[this.round].multiplier;
    const tally = {};
    for (const pid of m.players) tally[pid] = [];
    for (const [voter, target] of Object.entries(m.votes)) {
      if (tally[target]) tally[target].push(voter);
    }
    const totalVotes = Object.values(tally).reduce((a, v) => a + v.length, 0);
    const scored = m.players.map(pid => {
      const votes = tally[pid].length;
      const share = totalVotes ? votes / totalVotes : 0;
      let points = Math.round(share * 1000 * multiplier);
      const shutout = totalVotes >= 2 && votes === totalVotes;
      if (shutout) points = Math.round(points * 1.25); // all the votes — QUIPSMASH bonus
      return {
        playerId: pid,
        name: this.players.get(pid)?.name ?? '???',
        color: this.players.get(pid)?.color ?? '#888',
        text: m.answers[pid]?.text ?? '',
        safety: !!m.answers[pid]?.safety,
        votes,
        // Never drop a voter: the count beside an answer has to match its dots.
        voters: tally[pid].map(v => this.players.get(v)?.name ?? 'someone'),
        points,
        shutout
      };
    }).sort((a, b) => b.votes - a.votes);

    for (const r of scored) {
      const p = this.players.get(r.playerId);
      if (p) { p.score += r.points; p.roundPoints += r.points; }
    }
    m.results = { prompt: m.prompt, totalVotes, multiplier, scored };
    this.lastReveal = m.results;
    this.touch();
  }

  _nextAfterReveal() {
    this.voteIndex++;
    if (this.voteIndex >= this.matchups.length) return this._finishRound();
    this._startVoting();
  }

  /* ------------------------------------------------------------ round / end */

  _finishRound() {
    const last = this.round >= this.settings.totalRounds;
    this._setPhase(last ? 'final' : 'scores', last ? null : this.settings.scoreSeconds,
      () => this._beginRound(this.round + 1));
    if (last) this._clearTimer();
  }

  /** Host "skip ahead" button: end the current phase immediately. */
  advance() {
    switch (this.phase) {
      case 'writing': this._finishWriting(); break;
      case 'voting': this._finishVoting(); break;
      case 'reveal': this._nextAfterReveal(); break;
      case 'scores': this._beginRound(this.round + 1); break;
      default: break;
    }
  }

  backToLobby() {
    this._clearTimer();
    this.phase = 'lobby';
    this.round = 0;
    this.matchups = [];
    this.voteIndex = 0;
    this.lastReveal = null;
    this.deadline = null;
    for (const p of this.list) { p.score = 0; p.roundPoints = 0; }
    this.touch();
  }

  /* ------------------------------------------------------------------ utils */

  _setPhase(phase, seconds, cb) {
    if (process.env.QS_DEBUG) console.error(`[phase] r${this.round} ${this.phase} -> ${phase} (m ${this.voteIndex}/${this.matchups.length}, ${seconds}s, active ${this.active.length})`);
    this._clearTimer();
    this.phase = phase;
    this.deadline = seconds ? Date.now() + seconds * 1000 : null;
    if (seconds) this._timer = setTimeout(() => { this._timer = null; cb(); }, seconds * 1000);
    this.touch();
  }

  _clearTimer() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
  }

  destroy() {
    this._clearTimer();
    for (const t of this._graceTimers) clearTimeout(t);
    this._graceTimers.clear();
  }

  touch() { this.onUpdate(this); }

  scoreboard() {
    return this.list
      .slice()
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .map((p, i) => ({
        rank: i + 1, id: p.id, name: p.name, color: p.color,
        score: p.score, roundPoints: p.roundPoints, connected: p.connected
      }));
  }

  /* -------------------------------------------------------- serialized views */

  hostView() {
    const base = this._common();
    if (this.phase === 'writing') {
      const pending = new Set(this._pendingWriters());
      base.writing = {
        done: this.present.filter(p => !pending.has(p.id)).map(p => ({ name: p.name, color: p.color, away: !p.connected })),
        waiting: this.present.filter(p => pending.has(p.id)).map(p => ({ name: p.name, color: p.color, away: !p.connected })),
        promptCount: this.matchups.length
      };
    }
    if (this.phase === 'voting') {
      const m = this.matchups[this.voteIndex];
      // Count the people we're actually waiting on, so "3/4 votes in" explains the pause.
      const eligible = this._awaitedVoters(m);
      base.voting = {
        matchupId: m.id,
        prompt: m.prompt,
        index: this.voteIndex + 1,
        total: this.matchups.length,
        answers: (m.order ?? m.players).map(pid => ({ key: pid, text: m.answers[pid].text })),
        votedCount: Object.keys(m.votes).length,
        voterCount: eligible.length,
        judges: eligible.map(id => ({
          name: this.players.get(id).name,
          color: this.players.get(id).color,
          voted: !!m.votes[id],
          away: !this.players.get(id).connected
        }))
      };
    }
    if (this.phase === 'reveal') {
      base.reveal = { ...this.lastReveal, index: this.voteIndex + 1, total: this.matchups.length };
    }
    return base;
  }

  playerView(playerId) {
    const me = this.players.get(playerId);
    const base = this._common();
    base.you = me ? { id: me.id, name: me.name, color: me.color, score: me.score } : null;
    if (!me) return base;

    if (this.phase === 'writing') {
      base.write = this.matchups
        .filter(m => m.players.includes(playerId))
        .map(m => ({
          matchupId: m.id,
          prompt: m.prompt,
          answer: m.answers[playerId]?.text ?? '',
          submitted: !!m.answers[playerId]
        }));
    }
    if (this.phase === 'voting') {
      const m = this.matchups[this.voteIndex];
      const isAuthor = m.players.includes(playerId);
      const canVote = this._eligibleVoters(m).includes(playerId);
      base.vote = {
        matchupId: m.id,
        prompt: m.prompt,
        index: this.voteIndex + 1,
        total: this.matchups.length,
        canVote,
        reason: canVote ? null : (isAuthor ? 'This one is yours — sit tight.' : 'Not your call this time.'),
        myVote: m.votes[playerId] ?? null,
        options: (m.order ?? m.players).map(pid => ({
          id: pid,
          text: m.answers[pid].text,
          mine: pid === playerId
        }))
      };
    }
    if (this.phase === 'reveal') {
      base.reveal = {
        ...this.lastReveal,
        youGained: this.lastReveal?.scored.find(s => s.playerId === playerId)?.points ?? 0
      };
    }
    return base;
  }

  _common() {
    return {
      code: this.code,
      phase: this.phase,
      round: this.round,
      roundLabel: ROUNDS[this.round]?.label ?? '',
      roundKind: ROUNDS[this.round]?.kind ?? null,
      multiplier: ROUNDS[this.round]?.multiplier ?? 1,
      totalRounds: this.settings.totalRounds,
      deadline: this.deadline,
      serverNow: Date.now(),
      message: this.message,
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
      maxAnswerLen: MAX_ANSWER_LEN,
      customPromptCount: this.customPrompts.length,
      settings: this.settings,
      players: this.list.map(p => ({
        id: p.id, name: p.name, color: p.color, score: p.score, connected: p.connected
      })),
      scoreboard: this.scoreboard()
    };
  }
}

export function sanitizeSettings(s = {}) {
  const out = {};
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v))));
  if (Number.isFinite(Number(s.writeSeconds))) out.writeSeconds = clamp(s.writeSeconds, 10, 300);
  if (Number.isFinite(Number(s.finalWriteSeconds))) out.finalWriteSeconds = clamp(s.finalWriteSeconds, 10, 300);
  if (Number.isFinite(Number(s.voteSeconds))) out.voteSeconds = clamp(s.voteSeconds, 5, 120);
  if (Number.isFinite(Number(s.revealSeconds))) out.revealSeconds = clamp(s.revealSeconds, 2, 30);
  if (Number.isFinite(Number(s.scoreSeconds))) out.scoreSeconds = clamp(s.scoreSeconds, 2, 60);
  if (Number.isFinite(Number(s.totalRounds))) out.totalRounds = clamp(s.totalRounds, 1, 3);
  if (typeof s.useCustomOnly === 'boolean') out.useCustomOnly = s.useCustomOnly;
  return out;
}
