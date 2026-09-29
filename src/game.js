import { randomUUID } from 'node:crypto';
import { MAIN_PROMPTS, FINAL_PROMPTS, SAFETY_QUIPS, TEAM_NAMES, shuffle } from './prompts.js';
import { screen, screenName } from './moderation.js';

export const MIN_PLAYERS = 3;          // solo mode
export const MIN_TEAM_PLAYERS = 4;     // team mode needs two teams of two
export const MAX_PLAYERS = 120;        // a full town hall, with room to spare
export const DEFAULT_TEAM_SIZE = 5;
export const MAX_ANSWER_LEN = 80;
// How long we keep waiting for someone who just dropped off. Long enough to survive a
// phone locking or a wifi blip, short enough that a walk-out doesn't stall the party.
export const DROPOUT_GRACE_MS = 12_000;

const BOT_FIRST = ['Alex', 'Priya', 'Marcus', 'Ines', 'Wei', 'Aoife', 'Kwame', 'Sofia',
  'Dimitri', 'Yara', 'Nils', 'Tomiwa', 'Hana', 'Diego', 'Lena', 'Omar', 'Mei', 'Rafael',
  'Zara', 'Jonas', 'Nadia', 'Pieter', 'Aisha', 'Lars', 'Bea'];
const BOT_LAST = ['from Finance', 'in Basis', 'on Data', 'from PMO', 'in Testing',
  'on Integration', 'from Change', 'in Security', 'on Reporting', 'from Supply Chain'];
const BOT_LINES = [
  'Parked for now', 'A very confident guess', 'Ask the Basis team',
  'It worked in the sandbox', 'Blame the interface', 'Per my previous email',
  'Amber, obviously', 'Another Z-table', 'Coffee, then panic',
  'The consultant did it', 'Deferred to phase 2', 'A 90-slide deck',
  'Somebody else\'s transport', 'Standard functionality', 'Raise a ticket',
  'It was in the blueprint', 'Escalate and hope', 'One more workshop'
];
const botLine = () => `${BOT_LINES[Math.floor(Math.random() * BOT_LINES.length)]}`;

const COLORS = [
  '#ff5d73', '#ffb23f', '#ffe066', '#7bdc7b', '#3ecfcf', '#4aa8ff',
  '#8f7bff', '#e46bff', '#ff8fb8', '#b6d94c', '#00d0a0', '#ff7a3d'
];

export const DEFAULT_SETTINGS = {
  mode: 'teams',          // 'teams' for a town hall, 'solo' for a small group
  teamSize: DEFAULT_TEAM_SIZE,
  finalists: 4,           // how many teams reach the grand final
  writeSeconds: 75,       // solo: time to write
  finalWriteSeconds: 100,
  draftSeconds: 50,       // teams: time for each member to write their idea
  pickSeconds: 30,        // teams: time for the team to choose its answer
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
    this.teams = new Map();       // teamId -> team (team mode only)
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
    this._botTimers = new Set();
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
    const vetted = screenName(raw);
    if (!vetted.ok) return '';
    let name = vetted.name.slice(0, 14);
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

  get isTeamMode() { return this.settings.mode === 'teams'; }

  /* ------------------------------------------------------------------- teams */

  /**
   * Splits everyone present into teams of roughly `teamSize`. 100 people at 5 a side
   * makes 20 teams, which is 10 matchups a round. Sizes differ by at most one.
   */
  formTeams() {
    const people = shuffle(this.present);
    const size = Math.max(2, Math.min(12, this.settings.teamSize || DEFAULT_TEAM_SIZE));
    const count = Math.max(2, Math.round(people.length / size));
    const names = shuffle(TEAM_NAMES);

    this.teams.clear();
    for (let i = 0; i < count; i++) {
      const id = `t${i + 1}`;
      this.teams.set(id, {
        id,
        name: names[i] ?? `Team ${i + 1}`,
        color: COLORS[i % COLORS.length],
        leaderId: null,
        memberIds: [],
        score: 0,
        roundPoints: 0
      });
    }

    const ids = [...this.teams.keys()];
    people.forEach((p, i) => {
      const team = this.teams.get(ids[i % count]);
      p.teamId = team.id;
      p.isLeader = false;
      team.memberIds.push(p.id);
    });

    // Someone has to break a tied team vote, so each team gets a captain.
    for (const team of this.teams.values()) {
      const first = team.memberIds.find(id => this.players.get(id)?.connected) ?? team.memberIds[0];
      team.leaderId = first ?? null;
      const leader = this.players.get(team.leaderId);
      if (leader) leader.isLeader = true;
    }
  }

  teamOf(playerId) {
    const p = this.players.get(playerId);
    return p?.teamId ? this.teams.get(p.teamId) : null;
  }

  /** The matchup a given side (player or team) is competing in this round. */
  _matchupForSide(sideId) {
    return this.matchups.find(m => m.sides.includes(sideId)) ?? null;
  }

  /** Name and colour of a side, whichever kind of side it is. */
  _side(sideId) {
    const thing = this.isTeamMode ? this.teams.get(sideId) : this.players.get(sideId);
    return { name: thing?.name ?? '???', color: thing?.color ?? '#888' };
  }

  /** Points go to the team in team mode, to the player in solo. */
  _award(sideId, points) {
    const target = this.isTeamMode ? this.teams.get(sideId) : this.players.get(sideId);
    if (!target) return;
    target.score += points;
    target.roundPoints += points;
  }

  /**
   * Teams ranked high to low. Rosters are only worth sending to the big screen — phones
   * show a rank and a score, so 20 teams' worth of member names is dead weight there.
   */
  teamBoard({ rosters = true } = {}) {
    return [...this.teams.values()]
      .slice()
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .map((t, i) => ({
        rank: i + 1, id: t.id, name: t.name, color: t.color,
        score: t.score, roundPoints: t.roundPoints,
        size: t.memberIds.length,
        ...(rosters ? {
          members: t.memberIds.map(id => this.players.get(id)?.name).filter(Boolean),
          here: t.memberIds.filter(id => this.players.get(id)?.connected).length
        } : {})
      }));
  }

  /** The individual whose lines won the most points — a nice extra award at the end. */
  topAuthor() {
    const best = this.list
      .filter(p => (p.authoredPoints ?? 0) > 0)
      .sort((a, b) => b.authoredPoints - a.authoredPoints)[0];
    if (!best) return null;
    return {
      name: best.name, color: best.color, points: best.authoredPoints,
      teamName: this.teams.get(best.teamId)?.name ?? null
    };
  }

  /**
   * What a round is worth and what it's called. The last round is always the finale:
   * everyone left standing answers one prompt and the whole room votes.
   */
  roundInfo(round = this.round) {
    const total = this.settings.totalRounds;
    const isFinal = round >= total;
    return {
      multiplier: round,
      kind: isFinal ? 'final' : 'duel',
      label: isFinal ? (this.isTeamMode ? 'Grand Final' : 'Last Lash') : `Round ${round}`
    };
  }

  /* ------------------------------------------------------------------- flow */

  start(settings = {}) {
    if (this.phase !== 'lobby' && this.phase !== 'final') {
      return { ok: false, error: 'Game already running.' };
    }
    this.settings = { ...this.settings, ...sanitizeSettings(settings) };
    const ready = this.active;
    const floor = this.isTeamMode ? MIN_TEAM_PLAYERS : MIN_PLAYERS;
    if (ready.length < floor) {
      return { ok: false, error: `You need at least ${floor} players${this.isTeamMode ? ' for team mode' : ''}.` };
    }
    for (const p of this.list) { p.score = 0; p.roundPoints = 0; p.authoredPoints = 0; }
    if (this.isTeamMode) this.formTeams();
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
    for (const t of this.teams.values()) t.roundPoints = 0;

    if (this.isTeamMode) {
      this._setPhase('drafting', this.settings.draftSeconds, () => this._finishDrafting());
      return;
    }
    const seconds = this.roundInfo(round).kind === 'final'
      ? this.settings.finalWriteSeconds
      : this.settings.writeSeconds;
    this._setPhase('writing', seconds, () => this._finishWriting());
  }

  _buildMatchups(round) {
    if (this.isTeamMode) return this._buildTeamMatchups(round);

    const players = shuffle(this.present).map(p => p.id);
    const n = players.length;
    if (this.roundInfo(round).kind === 'final') {
      return [this._matchup(players, this._drawPrompt(true))];
    }
    // Circle pairing: player i is paired with player i+k. Every player lands in
    // exactly two matchups, and k=2 (when it can't collide) mixes up round 2.
    const k = n >= 5 ? (round === 2 ? 2 : 1) : 1;
    return players.map((_, i) =>
      this._matchup([players[i], players[(i + k) % n]], this._drawPrompt(false))
    );
  }

  /**
   * Team rounds: teams are paired off, and every pair gets its own prompt, so the room
   * hears ten different prompts a round instead of the same one ten times. An odd team
   * out joins the last matchup, making it a three-way.
   *
   * The grand final is one prompt for the top few teams, judged by everyone else.
   */
  _buildTeamMatchups(round) {
    const info = this.roundInfo(round);
    if (info.kind === 'final') {
      const wanted = Math.max(2, Math.min(this.settings.finalists, this.teams.size));
      const finalists = this.teamBoard().slice(0, wanted).map(t => t.id);
      return [this._matchup(finalists, this._drawPrompt(true))];
    }

    const ids = shuffle([...this.teams.keys()]);
    const matchups = [];
    for (let i = 0; i + 1 < ids.length; i += 2) {
      matchups.push(this._matchup([ids[i], ids[i + 1]], this._drawPrompt(false)));
    }
    if (ids.length % 2 === 1) {
      const odd = ids[ids.length - 1];
      if (matchups.length) matchups[matchups.length - 1].sides.push(odd);
      else matchups.push(this._matchup([odd], this._drawPrompt(false)));
    }
    return matchups;
  }

  /* ---------------------------------------------------------- team: drafting */

  /** Each member writes their own idea for their team's prompt. */
  submitDraft(playerId, text) {
    if (this.phase !== 'drafting') return { ok: false, error: 'Too late!' };
    const player = this.players.get(playerId);
    const team = this.teamOf(playerId);
    if (!player || !team) return { ok: false, error: "You're not on a team this round." };
    const m = this._matchupForSide(team.id);
    if (!m) return { ok: false, error: 'Your team sits this round out — you get to judge.' };

    const raw = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_ANSWER_LEN);
    if (!raw) return { ok: false, error: 'Write something!' };
    const checked = screen(raw);

    m.drafts[team.id] ??= [];
    const list = m.drafts[team.id];
    const mine = list.find(d => d.authorId === playerId);
    if (mine) {
      mine.text = checked.text;
      mine.flagged = checked.flagged;
      mine.flagReason = checked.reason;
    } else {
      list.push({
        id: randomUUID(), authorId: playerId, text: checked.text,
        flagged: checked.flagged, flagReason: checked.reason, votes: []
      });
    }
    this.touch();
    this._maybeFinishDrafting();
    return { ok: true, flagged: checked.flagged };
  }

  /** Players who owe their team an idea. */
  _pendingDrafters() {
    const pending = [];
    for (const p of this.present) {
      if (!p.teamId) continue;
      const m = this._matchupForSide(p.teamId);
      if (!m) continue;                                   // team is sitting this round out
      const drafts = m.drafts[p.teamId] ?? [];
      if (!drafts.some(d => d.authorId === p.id)) pending.push(p.id);
    }
    return pending;
  }

  _maybeFinishDrafting() {
    if (this.phase === 'drafting' && this._pendingDrafters().length === 0) this._finishDrafting();
  }

  _finishDrafting() {
    if (this.phase !== 'drafting') return;
    const safeties = shuffle(SAFETY_QUIPS);
    let si = 0;
    for (const m of this.matchups) {
      for (const sideId of m.sides) {
        m.drafts[sideId] ??= [];
        if (m.drafts[sideId].length === 0) {
          // Nobody on the team wrote anything, so they get a placeholder to vote on.
          m.drafts[sideId].push({
            id: randomUUID(), authorId: null, text: safeties[si++ % safeties.length],
            safety: true, flagged: false, votes: []
          });
        }
      }
    }
    this._setPhase('picking', this.settings.pickSeconds, () => this._finishPicking());
  }

  /* ----------------------------------------------------------- team: picking */

  /** A team member votes for the idea their team should send out. */
  pickVote(playerId, draftId) {
    if (this.phase !== 'picking') return { ok: false, error: 'That vote has closed.' };
    const team = this.teamOf(playerId);
    if (!team) return { ok: false, error: "You're not on a team." };
    const m = this._matchupForSide(team.id);
    const drafts = m?.drafts[team.id] ?? [];
    const target = drafts.find(d => d.id === draftId);
    if (!target) return { ok: false, error: 'That idea is not on your team\'s list.' };
    if (target.authorId === playerId && drafts.length > 1) {
      return { ok: false, error: 'Pick a teammate\'s idea, not your own.' };
    }
    for (const d of drafts) d.votes = d.votes.filter(v => v !== playerId);
    target.votes.push(playerId);
    this.touch();
    this._maybeFinishPicking();
    return { ok: true };
  }

  /** The captain can send the team's answer early instead of waiting for the clock. */
  lockTeam(playerId) {
    if (this.phase !== 'picking') return { ok: false, error: 'Too late.' };
    const team = this.teamOf(playerId);
    if (!team) return { ok: false, error: "You're not on a team." };
    if (team.leaderId !== playerId) return { ok: false, error: 'Only the captain can lock it in.' };
    const m = this._matchupForSide(team.id);
    if (!m) return { ok: false, error: 'Nothing to lock in.' };
    m.ready[team.id] = true;
    this.touch();
    this._maybeFinishPicking();
    return { ok: true };
  }

  _maybeFinishPicking() {
    if (this.phase !== 'picking') return;
    const everyoneVoted = this._pendingPickers().length === 0;
    const allLocked = this.matchups.every(m => m.sides.every(s => m.ready[s]));
    if (everyoneVoted || allLocked) this._finishPicking();
  }

  _pendingPickers() {
    const pending = [];
    for (const p of this.present) {
      if (!p.teamId) continue;
      const m = this._matchupForSide(p.teamId);
      if (!m || m.ready[p.teamId]) continue;
      const drafts = m.drafts[p.teamId] ?? [];
      if (drafts.length <= 1) continue;                   // nothing to choose between
      if (!drafts.some(d => d.votes.includes(p.id))) pending.push(p.id);
    }
    return pending;
  }

  /** Turns each team's internal vote into the one answer it sends to the big screen. */
  _finishPicking() {
    if (this.phase !== 'picking') return;
    for (const m of this.matchups) {
      for (const sideId of m.sides) {
        const drafts = m.drafts[sideId] ?? [];
        if (!drafts.length) continue;
        const most = Math.max(...drafts.map(d => d.votes.length));
        let tied = drafts.filter(d => d.votes.length === most);
        if (tied.length > 1) {
          // Captain's vote breaks a tie; failing that, a coin toss.
          const leaderId = this.teams.get(sideId)?.leaderId;
          const leaderPick = tied.find(d => d.votes.includes(leaderId));
          tied = leaderPick ? [leaderPick] : shuffle(tied);
        }
        const winner = tied[0];
        m.answers[sideId] = {
          text: winner.text,
          authorId: winner.authorId,
          draftId: winner.id,
          safety: !!winner.safety,
          flagged: !!winner.flagged,
          flagReason: winner.flagReason ?? null,
          teamVotes: winner.votes.length
        };
      }
      m.order = shuffle(m.sides);
    }
    // No clock here: nothing reaches the screen until the host has looked at it.
    this._setPhase('review', null, () => {});
  }

  /* ------------------------------------------------------------ host review */

  /** Host pulls (or restores) one team's answer before anything is projected. */
  toggleExclude(matchupId, sideId) {
    if (this.phase !== 'review') return { ok: false, error: 'Not reviewing right now.' };
    const m = this.matchups.find(x => x.id === matchupId);
    if (!m || !m.sides.includes(sideId)) return { ok: false, error: 'No such answer.' };
    if (m.excluded[sideId]) delete m.excluded[sideId];
    else m.excluded[sideId] = true;
    this.touch();
    return { ok: true };
  }

  /** Everything the host needs to eyeball, flagged answers first. */
  reviewList() {
    const rows = [];
    for (const m of this.matchups) {
      for (const sideId of m.sides) {
        const a = m.answers[sideId];
        if (!a) continue;
        const author = a.authorId ? this.players.get(a.authorId) : null;
        rows.push({
          matchupId: m.id, sideId, prompt: m.prompt,
          ...this._side(sideId),
          text: a.text,
          authorName: author?.name ?? (a.safety ? 'nobody — ran out of time' : 'unknown'),
          safety: a.safety,
          flagged: a.flagged,
          flagReason: a.flagReason,
          excluded: !!m.excluded[sideId]
        });
      }
    }
    return rows.sort((a, b) => (b.flagged ? 1 : 0) - (a.flagged ? 1 : 0));
  }

  /** Host is happy: drop anything excluded and start the voting. */
  startVotingFromReview() {
    if (this.phase !== 'review') return { ok: false, error: 'Not reviewing right now.' };
    for (const m of this.matchups) {
      m.sides = m.sides.filter(s => !m.excluded[s]);
      m.order = (m.order ?? m.sides).filter(s => m.sides.includes(s));
    }
    this.matchups = this.matchups.filter(m => m.sides.length >= 2);
    this.voteIndex = 0;
    if (!this.matchups.length) { this._finishRound(); return { ok: true }; }
    this._startVoting();
    return { ok: true };
  }

  /* --------------------------------------------------------------- reporting */

  /** A player reports an answer while it's on screen. The host sees the count live. */
  flagAnswer(playerId, matchupId, sideId) {
    const m = this.matchups.find(x => x.id === matchupId);
    if (!m || !m.sides.includes(sideId)) return { ok: false, error: 'No such answer.' };
    if (!this.players.has(playerId)) return { ok: false, error: 'Unknown player.' };
    m.flags[sideId] ??= [];
    if (!m.flags[sideId].includes(playerId)) m.flags[sideId].push(playerId);
    this.touch();
    return { ok: true };
  }

  /** Host kills the matchup on screen right now. Nobody scores from it. */
  voidMatchup() {
    if (this.phase !== 'voting' && this.phase !== 'reveal') return { ok: false, error: 'Nothing to void.' };
    const m = this.matchups[this.voteIndex];
    if (!m) return { ok: false, error: 'Nothing to void.' };
    if (m.results) {
      // Already scored on the reveal, so take those points back off — including the
      // individual credit, or a pulled answer could still win the writing award.
      for (const r of m.results.scored) {
        this._award(r.sideId, -r.points);
        const author = r.authorId ? this.players.get(r.authorId) : null;
        if (author) author.authoredPoints = Math.max(0, (author.authoredPoints ?? 0) - r.points);
      }
      m.results = null;
      this.lastReveal = null;
    }
    m.voided = true;
    m.votes = {};
    this._nextAfterReveal();
    return { ok: true };
  }

  /* ------------------------------------------------------------------- bots */

  /** Fake players, so a 100-person game can be rehearsed by one person. */
  addBots(count) {
    if (this.phase !== 'lobby') return { ok: false, error: 'Only in the lobby.' };
    const want = Math.max(1, Math.min(Number(count) || 0, MAX_PLAYERS - this.players.size));
    for (let i = 0; i < want; i++) {
      const res = this.join(`${BOT_FIRST[i % BOT_FIRST.length]} ${BOT_LAST[(i * 7) % BOT_LAST.length]}`);
      if (!res.ok) break;
      res.player.isBot = true;
    }
    this.touch();
    return { ok: true, added: want };
  }

  get bots() { return this.list.filter(p => p.isBot); }

  _clearBotTimers() {
    for (const t of this._botTimers) clearTimeout(t);
    this._botTimers.clear();
  }

  _later(fn, ms) {
    const t = setTimeout(() => { this._botTimers.delete(t); try { fn(); } catch { /* bot, not critical */ } }, ms);
    this._botTimers.add(t);
  }

  /** Bots play along with whatever phase just started. */
  _runBots() {
    const bots = this.bots;
    if (!bots.length) return;
    const jitter = () => 250 + Math.random() * 1200;

    if (this.phase === 'drafting') {
      for (const bot of bots) this._later(() => this.submitDraft(bot.id, botLine()), jitter());
    } else if (this.phase === 'picking') {
      for (const bot of bots) this._later(() => {
        const team = this.teamOf(bot.id);
        const m = team && this._matchupForSide(team.id);
        const options = (m?.drafts[team?.id] ?? []).filter(d => d.authorId !== bot.id);
        const pick = options[Math.floor(Math.random() * options.length)];
        if (pick) this.pickVote(bot.id, pick.id);
      }, jitter());
    } else if (this.phase === 'writing') {
      for (const bot of bots) this._later(() => {
        for (const m of this.matchups.filter(x => x.sides.includes(bot.id))) {
          this.submitAnswer(bot.id, m.id, botLine());
        }
      }, jitter());
    } else if (this.phase === 'voting') {
      const m = this.matchups[this.voteIndex];
      if (!m) return;
      for (const bot of bots) this._later(() => {
        const current = this.matchups[this.voteIndex];
        if (!current || this.phase !== 'voting') return;
        const choices = current.sides.filter(s => s !== (this.isTeamMode ? bot.teamId : bot.id));
        const pick = choices[Math.floor(Math.random() * choices.length)];
        if (pick) this.submitVote(bot.id, current.id, pick);
      }, jitter());
    }
  }

  /**
   * A matchup is a prompt plus the sides competing on it. A side is one player in solo
   * mode and one team in team mode; everything downstream is keyed by that side id.
   */
  _matchup(sideIds, prompt) {
    return {
      id: randomUUID(),
      prompt,
      sides: sideIds,
      answers: {},    // sideId -> { text, safety, authorId, flagged }
      drafts: {},     // sideId -> [{ id, authorId, text, votes: [], flagged }]  (team mode)
      votes: {},      // voterId -> sideId
      flags: {},      // sideId -> [playerId]  (players reporting an answer)
      excluded: {},   // sideId -> true  (pulled by the host before voting)
      ready: {},      // sideId -> true  (team locked its answer in early)
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
    if (!m || !m.sides.includes(playerId)) return { ok: false, error: 'Not your prompt.' };
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
      const owed = this.matchups.filter(m => m.sides.includes(p.id));
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
      for (const pid of m.sides) {
        if (!m.answers[pid]) {
          m.answers[pid] = { text: safeties[si++ % safeties.length], safety: true };
        }
      }
      m.order = shuffle(m.sides); // display order, so position doesn't leak authorship
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
    return this._voters(m, this.active);
  }

  /** Who we're still waiting on — includes anyone inside their dropout grace period. */
  _awaitedVoters(m) {
    return this._voters(m, this.present);
  }

  _voters(m, pool) {
    if (this.isTeamMode) {
      // You can't judge your own team's answer, but everyone else in the room can.
      const outsiders = pool.filter(p => !p.teamId || !m.sides.includes(p.teamId));
      if (outsiders.length) return outsiders.map(p => p.id);
      // Small room, and every remaining team is in this matchup — so they judge each
      // other instead. Voting for your own team is still refused.
      return pool.map(p => p.id);
    }
    // Last Lash: everyone wrote one, so everyone judges (they just can't pick their own).
    if (m.sides.length > 2) return pool.map(p => p.id);
    return pool.filter(p => !m.sides.includes(p.id)).map(p => p.id);
  }

  submitVote(voterId, matchupId, targetId) {
    if (this.phase !== 'voting') return { ok: false, error: 'Voting is closed.' };
    const m = this.matchups[this.voteIndex];
    if (!m || m.id !== matchupId) return { ok: false, error: 'That vote is stale.' };
    if (!this._eligibleVoters(m).includes(voterId)) return { ok: false, error: "You can't vote here." };
    if (!m.sides.includes(targetId)) return { ok: false, error: 'Invalid choice.' };
    const own = this.isTeamMode ? this.players.get(voterId)?.teamId : voterId;
    if (targetId === own) return { ok: false, error: "You can't vote for your own answer." };
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
    const multiplier = this.roundInfo().multiplier;
    const tally = {};
    for (const pid of m.sides) tally[pid] = [];
    for (const [voter, target] of Object.entries(m.votes)) {
      if (tally[target]) tally[target].push(voter);
    }
    const totalVotes = Object.values(tally).reduce((a, v) => a + v.length, 0);
    const scored = m.sides.map(sideId => {
      const votes = tally[sideId].length;
      const share = totalVotes ? votes / totalVotes : 0;
      let points = Math.round(share * 1000 * multiplier);
      const shutout = totalVotes >= 2 && votes === totalVotes;
      if (shutout) points = Math.round(points * 1.25); // all the votes — QUIPSMASH bonus
      const answer = m.answers[sideId];
      const author = answer?.authorId ? this.players.get(answer.authorId) : null;
      return {
        sideId,
        playerId: sideId,                    // kept for solo-mode clients
        ...this._side(sideId),
        text: answer?.text ?? '',
        safety: !!answer?.safety,
        flagged: !!answer?.flagged,
        authorName: author?.name ?? null,    // team mode: who actually wrote it
        authorId: answer?.authorId ?? null,
        flags: (m.flags[sideId] ?? []).length,
        votes,
        // Never drop a voter: the count beside an answer has to match its dots.
        voters: tally[sideId].map(v => this.players.get(v)?.name ?? 'someone'),
        points,
        shutout
      };
    }).sort((a, b) => b.votes - a.votes);

    for (const r of scored) {
      this._award(r.sideId, r.points);
      // Credit the individual too, for the sharpest-quip award at the end.
      const author = r.authorId ? this.players.get(r.authorId) : null;
      if (author) author.authoredPoints = (author.authoredPoints ?? 0) + r.points;
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
      case 'drafting': this._finishDrafting(); break;
      case 'picking': this._finishPicking(); break;
      case 'review': this.startVotingFromReview(); break;
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
    this.teams.clear();
    for (const p of this.list) {
      p.score = 0; p.roundPoints = 0; p.authoredPoints = 0;
      p.teamId = null; p.isLeader = false;
    }
    this.touch();
  }

  /* ------------------------------------------------------------------ utils */

  _setPhase(phase, seconds, cb) {
    if (process.env.QS_DEBUG) console.error(`[phase] r${this.round} ${this.phase} -> ${phase} (m ${this.voteIndex}/${this.matchups.length}, ${seconds}s, active ${this.active.length})`);
    this._clearTimer();
    this.phase = phase;
    this.deadline = seconds ? Date.now() + seconds * 1000 : null;
    if (seconds) this._timer = setTimeout(() => { this._timer = null; cb(); }, seconds * 1000);
    this._clearBotTimers();
    this._runBots();
    this.touch();
  }

  _clearTimer() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
  }

  destroy() {
    this._clearTimer();
    this._clearBotTimers();
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
    const base = this._common(true);

    if (this.isTeamMode) {
      base.teams = this.teamBoard();
      base.topAuthor = this.topAuthor();
    }

    if (this.phase === 'drafting') {
      const pending = new Set(this._pendingDrafters());
      const playing = this.present.filter(p => p.teamId && this._matchupForSide(p.teamId));
      base.drafting = {
        prompts: this.matchups.length,
        written: playing.length - pending.size,
        expected: playing.length,
        sittingOut: this.present.filter(p => p.teamId && !this._matchupForSide(p.teamId)).length,
        teams: this.matchups.flatMap(m => m.sides.map(sideId => ({
          ...this._side(sideId),
          drafts: (m.drafts[sideId] ?? []).length,
          size: this.teams.get(sideId)?.memberIds.length ?? 0
        })))
      };
    }

    if (this.phase === 'picking') {
      const pending = new Set(this._pendingPickers());
      base.picking = {
        teams: this.matchups.flatMap(m => m.sides.map(sideId => ({
          ...this._side(sideId),
          ideas: (m.drafts[sideId] ?? []).length,
          locked: !!m.ready[sideId],
          waiting: (this.teams.get(sideId)?.memberIds ?? []).filter(id => pending.has(id)).length
        }))),
        settled: this.matchups.flatMap(m => m.sides).filter(sideId => {
          const mm = this._matchupForSide(sideId);
          return mm?.ready[sideId];
        }).length
      };
    }

    if (this.phase === 'review') {
      const rows = this.reviewList();
      base.review = {
        rows,
        total: rows.length,
        flagged: rows.filter(r => r.flagged).length,
        excluded: rows.filter(r => r.excluded).length,
        matchups: this.matchups.length
      };
    }
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
        answers: (m.order ?? m.sides).map(sideId => ({
          key: sideId,
          text: m.answers[sideId]?.text ?? '',
          flags: (m.flags[sideId] ?? []).length
        })),
        votedCount: Object.keys(m.votes).length,
        voterCount: eligible.length,
        // A town hall has too many judges to list by name, so only small rooms get plates.
        judges: eligible.length <= 12 ? eligible.map(id => ({
          name: this.players.get(id).name,
          color: this.players.get(id).color,
          voted: !!m.votes[id],
          away: !this.players.get(id).connected
        })) : [],
        contenders: this.isTeamMode ? m.sides.map(sideId => this._side(sideId)) : []
      };
    }
    if (this.phase === 'reveal') {
      base.reveal = { ...this.lastReveal, index: this.voteIndex + 1, total: this.matchups.length };
    }
    return base;
  }

  playerView(playerId) {
    const me = this.players.get(playerId);
    const base = this._common(false);
    if (!me) { base.you = null; return base; }

    const team = this.teamOf(playerId);
    base.you = {
      id: me.id, name: me.name, color: me.color,
      score: this.isTeamMode ? (team?.score ?? 0) : me.score,
      ownPoints: me.authoredPoints ?? 0,
      teamId: team?.id ?? null,
      teamName: team?.name ?? null,
      teamColor: team?.color ?? null,
      isLeader: !!me.isLeader,
      teammates: team ? team.memberIds.filter(id => id !== playerId)
        .map(id => this.players.get(id)?.name).filter(Boolean) : []
    };

    if (this.isTeamMode) {
      const myMatchup = team ? this._matchupForSide(team.id) : null;

      if (this.phase === 'drafting') {
        base.draft = myMatchup ? {
          matchupId: myMatchup.id,
          prompt: myMatchup.prompt,
          mine: (myMatchup.drafts[team.id] ?? []).find(d => d.authorId === playerId)?.text ?? '',
          submitted: (myMatchup.drafts[team.id] ?? []).some(d => d.authorId === playerId),
          teamDrafts: (myMatchup.drafts[team.id] ?? []).length,
          teamSize: team.memberIds.length
        } : null;
      }

      if (this.phase === 'picking') {
        const drafts = myMatchup ? (myMatchup.drafts[team.id] ?? []) : [];
        base.pick = myMatchup ? {
          matchupId: myMatchup.id,
          prompt: myMatchup.prompt,
          locked: !!myMatchup.ready[team.id],
          isLeader: !!me.isLeader,
          myVote: drafts.find(d => d.votes.includes(playerId))?.id ?? null,
          // Anonymous inside the team too, so people vote for the funniest line
          // rather than for their friend.
          options: drafts.map(d => ({
            id: d.id, text: d.text, mine: d.authorId === playerId, votes: d.votes.length
          }))
        } : null;
      }

      if (this.phase === 'review') {
        base.waiting = { reason: 'The host is checking the answers before they go up.' };
      }
    }

    if (this.phase === 'writing') {
      base.write = this.matchups
        .filter(m => m.sides.includes(playerId))
        .map(m => ({
          matchupId: m.id,
          prompt: m.prompt,
          answer: m.answers[playerId]?.text ?? '',
          submitted: !!m.answers[playerId]
        }));
    }
    if (this.phase === 'voting') {
      const m = this.matchups[this.voteIndex];
      const mySide = this.isTeamMode ? me.teamId : playerId;
      const isAuthor = m.sides.includes(mySide);
      const canVote = this._eligibleVoters(m).includes(playerId);
      base.vote = {
        matchupId: m.id,
        prompt: m.prompt,
        index: this.voteIndex + 1,
        total: this.matchups.length,
        canVote,
        reason: canVote ? null
          : (isAuthor
            ? (this.isTeamMode ? "Your team's answer is up — sit tight." : 'This one is yours — sit tight.')
            : 'Not your call this time.'),
        myVote: m.votes[playerId] ?? null,
        options: (m.order ?? m.sides).map(sideId => ({
          id: sideId,
          text: m.answers[sideId]?.text ?? '',
          mine: sideId === mySide,
          flagged: (m.flags[sideId] ?? []).includes(playerId)
        }))
      };
    }
    if (this.phase === 'reveal') {
      const mySide = this.isTeamMode ? me.teamId : playerId;
      const mine = this.lastReveal?.scored.find(s => s.sideId === mySide);
      base.reveal = {
        ...this.lastReveal,
        youGained: mine?.points ?? 0,
        wasYourAnswer: mine?.authorId === playerId
      };
    }
    return base;
  }

  /**
   * Shared fields. `forHost` decides whether the whole roster travels: with 100 phones
   * connected, sending every player a 100-row roster on every vote is a lot of traffic
   * for something no phone displays.
   */
  _common(forHost = false) {
    const common = {
      code: this.code,
      phase: this.phase,
      round: this.round,
      roundLabel: this.round ? this.roundInfo().label : '',
      roundKind: this.round ? this.roundInfo().kind : null,
      multiplier: this.round ? this.roundInfo().multiplier : 1,
      totalRounds: this.settings.totalRounds,
      deadline: this.deadline,
      serverNow: Date.now(),
      message: this.message,
      minPlayers: MIN_PLAYERS,
      minTeamPlayers: MIN_TEAM_PLAYERS,
      maxPlayers: MAX_PLAYERS,
      maxAnswerLen: MAX_ANSWER_LEN,
      customPromptCount: this.customPrompts.length,
      settings: this.settings,
      mode: this.settings.mode,
      playerCount: this.list.length,
      hereCount: this.active.length,
      teamCount: this.teams.size,
      botCount: this.bots.length
    };

    if (forHost) {
      common.players = this.list.map(p => ({
        id: p.id, name: p.name, color: p.color, score: p.score,
        connected: p.connected, teamId: p.teamId ?? null, isBot: !!p.isBot,
        isLeader: !!p.isLeader
      }));
      common.scoreboard = this.scoreboard();
      return common;
    }

    // Phones only need standings when standings are on screen.
    if (['scores', 'final'].includes(this.phase)) {
      common.board = this.isTeamMode ? this.teamBoard({ rosters: false }) : this.scoreboard();
      if (this.isTeamMode) common.topAuthor = this.topAuthor();
    }
    if (this.phase === 'lobby' && !this.isTeamMode) common.scoreboard = this.scoreboard();
    return common;
  }
}

export function sanitizeSettings(s = {}) {
  const out = {};
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v))));
  if (s.mode === 'teams' || s.mode === 'solo') out.mode = s.mode;
  if (Number.isFinite(Number(s.teamSize))) out.teamSize = clamp(s.teamSize, 2, 12);
  if (Number.isFinite(Number(s.finalists))) out.finalists = clamp(s.finalists, 2, 8);
  if (Number.isFinite(Number(s.draftSeconds))) out.draftSeconds = clamp(s.draftSeconds, 10, 300);
  if (Number.isFinite(Number(s.pickSeconds))) out.pickSeconds = clamp(s.pickSeconds, 8, 180);
  if (Number.isFinite(Number(s.writeSeconds))) out.writeSeconds = clamp(s.writeSeconds, 10, 300);
  if (Number.isFinite(Number(s.finalWriteSeconds))) out.finalWriteSeconds = clamp(s.finalWriteSeconds, 10, 300);
  if (Number.isFinite(Number(s.voteSeconds))) out.voteSeconds = clamp(s.voteSeconds, 5, 120);
  if (Number.isFinite(Number(s.revealSeconds))) out.revealSeconds = clamp(s.revealSeconds, 2, 30);
  if (Number.isFinite(Number(s.scoreSeconds))) out.scoreSeconds = clamp(s.scoreSeconds, 2, 60);
  if (Number.isFinite(Number(s.totalRounds))) out.totalRounds = clamp(s.totalRounds, 1, 5);
  if (typeof s.useCustomOnly === 'boolean') out.useCustomOnly = s.useCustomOnly;
  return out;
}
