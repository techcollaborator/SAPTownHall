import { createSocket, $, h, clear, promptHtml, toast, startTicker, paintTimer, blip, fanfare, backend, SPLIT_DEPLOY } from './net.js';

const stage = $('#stage');
const roundTag = $('#round-tag');
const skipBtn = $('#skip');
const connEl = $('#conn');

let state = null;
let phaseSeen = null;
let stageSig = null;
// Where phones should go. Deployed, that's simply this site; running locally on
// localhost, phones can't reach "localhost", so we swap in the machine's wifi address.
let joinHost = location.host;
let joinProto = location.protocol;
let promptDraft = '';   // kept across re-renders so a join never eats what you're typing

const CODE_KEY = 'qs.host.code';

if (!SPLIT_DEPLOY) fetch(backend('/api/net')).then(r => r.json()).then(({ lan }) => {
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) && lan) { joinHost = lan; joinProto = 'http:'; }
  if (state?.phase === 'lobby') render();   // signature includes joinHost, so this repaints
}).catch(() => {});

// ?room=ABCD reattaches this screen to a room that's already running.
const wantedCode = (new URLSearchParams(location.search).get('room') ?? '').toUpperCase().trim();

const sock = createSocket({
  hello: () => {
    const saved = wantedCode || sessionStorage.getItem(CODE_KEY);
    return saved ? { t: 'host:resume', code: saved } : { t: 'host:create' };
  },
  onJoined: msg => sessionStorage.setItem(CODE_KEY, msg.code),
  onError: msg => {
    if (msg.fatal) { sessionStorage.removeItem(CODE_KEY); sock.send({ t: 'host:create' }); }
    else toast(msg.error);
  },
  onState: s => { state = s; render(); },
  onStatus: st => {
    // Only speak up when something is wrong — a permanent "connected" badge is just noise.
    connEl.textContent = st === 'offline' ? 'reconnecting…' : st;
    connEl.classList.toggle('bad', st !== 'online');
    connEl.classList.toggle('hidden', st === 'online');
  }
});

skipBtn.addEventListener('click', () => sock.send({ t: 'host:advance' }));

// The laptop is usually across the room, so give the big screen keyboard controls.
addEventListener('keydown', e => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName ?? '');
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === ' ' || e.key === 'Enter') {
    if (state?.phase === 'lobby') {
      if (state.players.length >= state.minPlayers) sock.send({ t: 'host:start', settings: readSettings() });
    } else {
      sock.send({ t: 'host:advance' });
    }
    e.preventDefault();
  } else if (e.key === 'f' || e.key === 'F') {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }
});

/* --------------------------------------------------------------- countdown */

let phaseTotal = null;
startTicker(
  () => state?.deadline ? { deadline: state.deadline, now: sock.now, total: phaseTotal } : null,
  (left, total) => paintTimer($('#timer-bar'), $('#clock'), left, total)
);

/** Teams in team mode, players in solo. */
function standings(s) {
  return (s.mode === 'teams' ? s.teams : s.scoreboard) ?? [];
}

function totalForPhase(s) {
  const t = s.settings ?? {};
  if (s.phase === 'drafting') return t.draftSeconds;
  if (s.phase === 'picking') return t.pickSeconds;
  if (s.phase === 'writing') return s.roundKind === 'final' ? t.finalWriteSeconds : t.writeSeconds;
  if (s.phase === 'voting') return t.voteSeconds;
  if (s.phase === 'reveal') return t.revealSeconds;
  if (s.phase === 'scores') return t.scoreSeconds;
  return null;
}

/* ----------------------------------------------------------------- render */

function render() {
  if (!state) return;
  phaseTotal = totalForPhase(state);
  if (!state.deadline) paintTimer($('#timer-bar'), $('#clock'), null, null);

  roundTag.textContent = state.phase === 'lobby' ? ''
    : state.round === 3 ? `LAST LASH · ×3`
    : `ROUND ${state.round} OF ${state.totalRounds} · ×${state.multiplier}`;
  skipBtn.classList.toggle('hidden',
    !['writing', 'drafting', 'picking', 'voting', 'reveal', 'scores'].includes(state.phase));

  if (state.phase !== phaseSeen) {
    if (state.phase === 'voting') blip(520, 130);
    if (state.phase === 'reveal') blip(760, 160, 'square');
    if (state.phase === 'scores') blip(420, 200);
    if (state.phase === 'final') fanfare();
    phaseSeen = state.phase;
  }

  const sig = signature(state);
  if (sig === stageSig) return;
  stageSig = sig;

  clear(stage);
  stage.append(({
    lobby: viewLobby, writing: viewWriting, drafting: viewDrafting, picking: viewPicking,
    review: viewReview, voting: viewVoting, reveal: viewReveal,
    scores: viewScores, final: viewFinal
  }[state.phase] ?? viewLobby)());
}

/** Everything the current view draws. Same string in, same pixels out — so skip the rebuild. */
function signature(s) {
  const base = `${s.phase}:${s.round}`;
  switch (s.phase) {
    case 'lobby':
      return `${base}:${s.code}:${joinHost}:${s.customPromptCount}:${s.mode}:${s.settings.teamSize}:` +
        (s.players ?? []).map(p => `${p.id}${p.name}${p.connected}`).join(',');
    case 'drafting':
      return `${base}:${s.drafting?.written}/${s.drafting?.expected}:` +
        (s.drafting?.teams ?? []).map(t => `${t.name}${t.drafts}`).join(',');
    case 'picking':
      return `${base}:` + (s.picking?.teams ?? []).map(t => `${t.name}${t.locked}${t.waiting}`).join(',');
    case 'review':
      return `${base}:` + (s.review?.rows ?? []).map(r => `${r.sideId}${r.excluded}${r.flagged}`).join(',');
    case 'writing':
      return `${base}:${(s.writing?.done ?? []).map(p => p.name + p.away).join(',')}` +
        `|${(s.writing?.waiting ?? []).map(p => p.name + p.away).join(',')}`;
    case 'voting':
      return `${base}:${s.voting?.matchupId}:${s.voting?.votedCount}/${s.voting?.voterCount}:` +
        `${(s.voting?.answers ?? []).map(a => a.flags).join(',')}:` +
        (s.voting?.judges ?? []).map(j => `${j.name}${j.voted}${j.away}`).join(',');
    case 'reveal':
      return `${base}:${s.reveal?.prompt}:${(s.reveal?.scored ?? []).map(x => `${x.playerId}${x.votes}${x.points}`).join(',')}`;
    case 'scores':
      return `${base}:${standings(s).map(r => `${r.id}${r.score}${r.roundPoints}`).join(',')}`;
    case 'final':
      return `${base}:${standings(s).map(r => `${r.id}${r.score}`).join(',')}:${s.topAuthor?.name ?? ''}`;
    default:
      return base;
  }
}

/* ------------------------------------------------------------------ lobby */

function viewLobby() {
  const joinUrl = `${joinProto}//${joinHost}/play?room=${state.code}`;
  const count = state.players.length;
  const wrap = h('div', { class: 'stack' });

  wrap.append(h('div', { class: 'joincode' },
    h('div', { class: 'center' },
      h('div', { class: 'muted', style: 'font-weight:800;letter-spacing:.2em' }, 'GO TO'),
      h('div', { class: 'url' }, `${joinHost}`),
      h('div', { class: 'muted', style: 'margin:14px 0 4px;font-weight:800;letter-spacing:.2em' }, 'ROOM CODE'),
      h('div', { class: 'code' }, state.code)
    ),
    h('img', { src: backend(`/qr.svg?d=${encodeURIComponent(joinUrl)}`), alt: 'Join QR code', onerror(){ this.remove(); } })
  ));

  // A town hall roster is too long to plate up in full, so past a point it's a headcount.
  const CAP = 28;
  const players = state.players ?? [];
  wrap.append(h('div', { class: 'lobby-players' },
    count ? [
      ...players.slice(0, CAP).map(p => h('div', { class: `plate ${p.connected ? '' : 'away'} ${p.isBot ? 'bot' : ''}` },
        h('span', { class: 'dot', style: `background:${p.color}` }),
        p.name,
        h('span', { class: 'x', title: 'Remove', onclick: () => sock.send({ t: 'host:kick', playerId: p.id }) }, '×')
      )),
      count > CAP ? h('div', { class: 'plate' }, `+ ${count - CAP} more`) : null
    ] : h('div', { class: 'muted', style: 'font-size:1.2rem' }, 'Waiting for people to join…')
  ));

  const teamMode = state.mode === 'teams';
  const floor = teamMode ? (state.minTeamPlayers ?? 4) : state.minPlayers;
  const teamsWhenStarting = Math.max(2, Math.round(count / (state.settings.teamSize || 5)));

  wrap.append(h('div', { class: 'row center', style: 'justify-content:center;gap:14px;flex-wrap:wrap' },
    h('button', {
      disabled: count < floor,
      onclick: () => sock.send({ t: 'host:start', settings: readSettings() })
    }, count < floor
      ? `Need ${floor - count} more`
      : teamMode
        ? `Start — ${count} people, ${teamsWhenStarting} teams`
        : `Start the game (${count})`),
    h('div', { class: 'pill' }, `${count} here`),
    teamMode ? h('div', { class: 'pill' }, `${teamsWhenStarting} teams of ~${state.settings.teamSize}`) : null,
    h('div', { class: 'pill' }, `${state.customPromptCount} custom prompts`)
  ));

  wrap.append(hostTools());
  return wrap;
}

function hostTools() {
  const s = state.settings;
  const d = h('details', { class: 'host-tools card' },
    h('summary', {}, 'Game options & custom prompts'),
    h('div', { class: 'stack', style: 'margin-top:16px' },
      h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap' },
        h('button', {
          id: 'mode-teams', class: `small ${s.mode === 'teams' ? '' : 'ghost'}`,
          onclick: () => sock.send({ t: 'host:settings', settings: { mode: 'teams' } })
        }, 'Teams (town hall)'),
        h('button', {
          id: 'mode-solo', class: `small ${s.mode === 'solo' ? '' : 'ghost'}`,
          onclick: () => sock.send({ t: 'host:settings', settings: { mode: 'solo' } })
        }, 'Individuals (small group)')
      ),
      h('div', { class: 'settings-grid' },
        s.mode === 'teams' ? numField('teamSize', 'People per team', s.teamSize) : null,
        s.mode === 'teams' ? numField('finalists', 'Teams in the final', s.finalists) : null,
        s.mode === 'teams' ? numField('draftSeconds', 'Write time (s)', s.draftSeconds) : null,
        s.mode === 'teams' ? numField('pickSeconds', 'Team picks (s)', s.pickSeconds) : null,
        s.mode === 'solo' ? numField('writeSeconds', 'Write time (s)', s.writeSeconds) : null,
        s.mode === 'solo' ? numField('finalWriteSeconds', 'Final write (s)', s.finalWriteSeconds) : null,
        numField('voteSeconds', 'Vote time (s)', s.voteSeconds),
        numField('revealSeconds', 'Reveal (s)', s.revealSeconds),
        numField('scoreSeconds', 'Scoreboard (s)', s.scoreSeconds),
        numField('totalRounds', 'Rounds (1-5)', s.totalRounds)
      ),
      h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap;align-items:center' },
        h('span', { class: 'muted', style: 'font-size:.8rem;font-weight:800;text-transform:uppercase;letter-spacing:.06em' },
          'Rehearse without a room full of people'),
        ...[20, 50, 100].map(n => h('button', {
          class: 'ghost small',
          onclick: () => sock.send({ t: 'host:bots', count: n })
        }, `+${n} bots`)),
        state.botCount ? h('span', { class: 'pill' }, `${state.botCount} bots in`) : null
      ),
      h('label', { class: 'row', style: 'gap:10px;font-weight:700' },
        h('input', { type: 'checkbox', id: 'useCustomOnly', style: 'width:auto', ...(s.useCustomOnly ? { checked: true } : {}) }),
        'Use only my custom prompts'
      ),
      h('div', { class: 'stack' },
        h('div', { class: 'muted', style: 'font-size:.8rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase' },
          'Custom prompts — one per line. Use <BLANK> for a fill-in-the-blank slot.'),
        h('textarea', {
          class: 'prompts', id: 'prompt-box',
          placeholder: "The worst thing to say at Dave's leaving do\nOur team's real motto is <BLANK>",
          oninput: e => { promptDraft = e.target.value; }
        }),
        h('button', {
          class: 'ghost small', style: 'justify-self:start',
          onclick: () => {
            const text = $('#prompt-box').value;
            promptDraft = text;
            sock.send({ t: 'host:prompts', text });
            const count = text.split('\n').filter(l => l.trim()).length;
            toast(count ? `${count} custom prompt${count === 1 ? '' : 's'} saved for this room.` : 'Custom prompts cleared.');
          }
        }, 'Save prompts')
      )
    )
  );
  if (promptDraft) queueMicrotask(() => { const box = $('#prompt-box'); if (box) box.value = promptDraft; });
  return d;
}

const numField = (id, label, val) => h('label', {}, label, h('input', { type: 'number', id, value: val }));

function readSettings() {
  const get = id => $('#' + id) ? Number($('#' + id).value) : undefined;
  return {
    mode: state?.settings?.mode,
    teamSize: get('teamSize'), finalists: get('finalists'),
    draftSeconds: get('draftSeconds'), pickSeconds: get('pickSeconds'),
    writeSeconds: get('writeSeconds'), finalWriteSeconds: get('finalWriteSeconds'),
    voteSeconds: get('voteSeconds'), revealSeconds: get('revealSeconds'),
    scoreSeconds: get('scoreSeconds'), totalRounds: get('totalRounds'),
    useCustomOnly: $('#useCustomOnly') ? $('#useCustomOnly').checked : undefined
  };
}

/* ---------------------------------------------------------------- writing */

function viewWriting() {
  const w = state.writing ?? { done: [], waiting: [], promptCount: 0 };
  return h('div', { class: 'stack center' },
    h('div', { class: 'prompt-big' },
      state.roundKind === 'final' ? 'One last prompt. Everybody answers.' : 'Check your phones!'),
    h('p', { class: 'muted', style: 'font-size:1.2rem;margin:0' },
      state.roundKind === 'final'
        ? 'Best answer takes triple points.'
        : `${w.promptCount} prompts out there — two answers each.`),
    h('div', { class: 'waiting-grid', style: 'margin-top:10px' },
      w.done.map(p => h('div', { class: `plate done ${p.away ? 'away' : ''}` },
        h('span', { class: 'dot', style: `background:${p.color}` }), p.name, ' ✓')),
      w.waiting.map(p => h('div', { class: `plate ${p.away ? 'away' : ''}` },
        h('span', { class: 'dot', style: `background:${p.color}` }), p.name, p.away ? ' (away)' : ''))
    ),
    w.waiting.length === 0 ? h('div', { class: 'tally' }, 'Everyone\'s in!') : null
  );
}

/* --------------------------------------------------------- team: drafting */

function viewDrafting() {
  const d = state.drafting ?? { written: 0, expected: 0, prompts: 0, teams: [], sittingOut: 0 };
  const pct = d.expected ? Math.round((d.written / d.expected) * 100) : 0;
  return h('div', { class: 'stack center' },
    h('div', { class: 'prompt-big' },
      state.roundKind === 'final' ? 'Grand final — finalists, check your phones!' : 'Check your phones!'),
    h('p', { class: 'muted', style: 'font-size:1.15rem;margin:0' },
      `Everyone writes one idea. Your team then picks the one it sends up. ` +
      `${d.prompts} matchup${d.prompts === 1 ? '' : 's'} this round.`),
    d.sittingOut ? h('p', { class: 'muted', style: 'margin:0' },
      `${d.sittingOut} people are judges this round.`) : null,
    h('div', { class: 'tally' }, `${d.written} of ${d.expected} ideas in`),
    h('div', { class: 'bigbar' }, h('i', { style: `width:${pct}%` })),
    h('div', { class: 'waiting-grid' }, d.teams.map(t => h('div', {
      class: `plate ${t.drafts >= t.size ? 'done' : ''}`
    },
      h('span', { class: 'dot', style: `background:${t.color}` }),
      t.name,
      h('span', { class: 'muted' }, ` ${t.drafts}/${t.size}`)
    )))
  );
}

/* ---------------------------------------------------------- team: picking */

function viewPicking() {
  const pk = state.picking ?? { teams: [] };
  const locked = pk.teams.filter(t => t.locked).length;
  return h('div', { class: 'stack center' },
    h('div', { class: 'prompt-big' }, 'Teams, pick your best line'),
    h('p', { class: 'muted', style: 'font-size:1.15rem;margin:0' },
      'Vote for a teammate\'s idea on your phone. Captains can lock it in early.'),
    h('div', { class: 'tally' }, `${locked} of ${pk.teams.length} teams locked in`),
    h('div', { class: 'waiting-grid' }, pk.teams.map(t => h('div', {
      class: `plate ${t.locked ? 'done' : ''}`
    },
      h('span', { class: 'dot', style: `background:${t.color}` }),
      t.name,
      t.locked ? ' ✓' : h('span', { class: 'muted' }, ` ${t.ideas} ideas`)
    )))
  );
}

/* ----------------------------------------------------- host review (moderation) */

function viewReview() {
  const r = state.review ?? { rows: [], total: 0, flagged: 0, excluded: 0 };
  const usable = r.total - r.excluded;
  return h('div', { class: 'stack' },
    h('div', { class: 'row spread', style: 'flex-wrap:wrap;gap:12px' },
      h('div', {},
        h('div', { class: 'display', style: 'font-size:clamp(1.3rem,2.6vw,2.2rem)' }, 'Your call before this goes up'),
        h('div', { class: 'muted', style: 'font-size:.95rem' },
          `${r.total} answers · ${r.flagged} auto-flagged · ${r.excluded} pulled. Nothing is on the big screen yet.`)
      ),
      h('div', { class: 'row', style: 'gap:10px' },
        r.flagged ? h('span', { class: 'pill flagpill' }, `⚑ ${r.flagged} to check`) : h('span', { class: 'pill' }, '⚑ none flagged'),
        h('button', { onclick: () => sock.send({ t: 'host:approve' }) }, `Put ${usable} answers up ▸`)
      )
    ),
    h('div', { class: 'reviewlist' }, r.rows.length
      ? r.rows.map(row => h('div', { class: `reviewrow ${row.excluded ? 'pulled' : ''} ${row.flagged ? 'flagged' : ''}` },
          h('div', { class: 'reviewmeta' },
            h('span', { class: 'dot', style: `background:${row.color}` }),
            h('strong', {}, row.name),
            h('span', { class: 'muted' }, ` · ${row.authorName}`),
            row.flagged ? h('span', { class: 'flagtag' }, `⚑ ${row.flagReason ?? 'check this'}`) : null,
            row.safety ? h('span', { class: 'muted' }, ' · ran out of time') : null
          ),
          h('div', { class: 'reviewtext' }, row.text),
          h('div', { class: 'reviewprompt muted' }, row.prompt),
          h('button', {
            class: `small ${row.excluded ? '' : 'ghost'}`,
            onclick: () => sock.send({ t: 'host:exclude', matchupId: row.matchupId, sideId: row.sideId })
          }, row.excluded ? 'Pulled — put it back' : 'Pull this one')
        ))
      : h('div', { class: 'muted center' }, 'No answers came in.')
    )
  );
}

/* ----------------------------------------------------------------- voting */

function viewVoting() {
  const v = state.voting;
  const stacked = v.answers.length > 2;
  return h('div', { class: 'stack' },
    h('div', { class: 'center muted', style: 'font-weight:800;letter-spacing:.2em' },
      state.roundKind === 'final' ? 'PICK THE BEST' : `MATCH ${v.index} OF ${v.total}`),
    h('div', { class: 'prompt-big', html: promptHtml(v.prompt) }),
    stacked
      ? h('div', columnProps(v.answers.length), v.answers.map(a => h('div', { class: 'answer' }, a.text)))
      : h('div', { class: 'duel' },
          h('div', { class: 'answer' }, v.answers[0].text),
          h('div', { class: 'vs' }, 'VS'),
          h('div', { class: 'answer' }, v.answers[1].text)),
    h('div', { class: 'center' },
      v.contenders?.length ? h('div', { class: 'row', style: 'justify-content:center;gap:10px;flex-wrap:wrap;margin-bottom:10px' },
        v.contenders.map(c => h('span', { class: 'pill' },
          h('span', { class: 'dot', style: `background:${c.color}` }), c.name))) : null,
      h('div', { class: 'tally' }, `${v.votedCount} / ${v.voterCount} votes in`),
      v.voterCount > 12
        ? h('div', { class: 'bigbar', style: 'margin-top:10px' },
            h('i', { style: `width:${v.voterCount ? Math.round((v.votedCount / v.voterCount) * 100) : 0}%` }))
        : h('div', { class: 'waiting-grid', style: 'margin-top:12px' },
            v.judges.map(j => h('div', { class: `plate ${j.voted ? 'done' : ''} ${j.away ? 'away' : ''}` },
              h('span', { class: 'dot', style: `background:${j.color}` }), j.name,
              j.voted ? ' ✓' : j.away ? ' (away)' : ''))),
      v.answers.some(a => a.flags) ? h('div', { class: 'row', style: 'justify-content:center;gap:12px;margin-top:12px' },
        h('span', { class: 'flagtag' }, `⚑ ${v.answers.reduce((a, x) => a + x.flags, 0)} reports from the room`),
        h('button', { class: 'ghost small', onclick: () => sock.send({ t: 'host:void' }) }, 'Pull this matchup')
      ) : null
    )
  );
}

/* ----------------------------------------------------------------- reveal */

function viewReveal() {
  const r = state.reveal;
  if (!r) return h('div', {});
  const top = Math.max(...r.scored.map(s => s.votes));
  const card = s => h('div', {
    class: `answer revealed ${s.votes === top && top > 0 ? 'winner' : ''} ${s.safety ? 'safety' : ''}`
  },
    s.shutout ? h('div', { class: 'quiplash' }, 'QUIPSMASH!') : null,
    h('div', {}, s.text),
    h('div', { class: 'who' },
      h('span', { class: 'dot', style: `background:${s.color}` }), s.name,
      s.authorName ? h('span', { class: 'muted byline' }, ` — ${s.authorName}`) : null),
    h('div', { class: 'votes' }, s.voters.map((_, i) =>
      h('i', { style: `animation-delay:${i * 90}ms` }))),
    h('div', { class: 'pts' }, s.points > 0 ? `+${s.points}` : '+0')
  );
  const stacked = r.scored.length > 2;
  return h('div', { class: 'stack' },
    h('div', { class: 'center muted', style: 'font-weight:800;letter-spacing:.2em' },
      r.totalVotes === 0 ? 'NOBODY VOTED' : `${r.index ?? 1} OF ${r.total ?? 1}`),
    h('div', { class: 'prompt-big', html: promptHtml(r.prompt) }),
    stacked
      ? h('div', columnProps(r.scored.length), r.scored.map(s => h('div', {
          class: `answer revealed ${s.votes === top && top > 0 ? 'winner' : ''} ${s.safety ? 'safety' : ''}`
        },
          h('div', {}, s.text),
          h('div', { class: 'right' },
            s.shutout ? h('div', { class: 'smash-pill' }, 'QUIPSMASH!') : null,
            h('div', { class: 'who' },
              h('span', { class: 'dot', style: `background:${s.color}` }), s.name,
              s.authorName ? h('span', { class: 'muted byline' }, ` — ${s.authorName}`) : null),
            h('div', { class: 'votes' }, s.voters.map((_, i) => h('i', { style: `animation-delay:${i * 80}ms` }))),
            h('div', { class: 'pts' }, `+${s.points}`)
          )))
        )
      : h('div', { class: 'duel' }, card(r.scored[0]), h('div', { class: 'vs' }, 'VS'), card(r.scored[1]))
  );
}

/** Long answer lists go two- or three-up so they still fit on a TV. */
function columnProps(count) {
  // Measured against a 1280×720 TV: four or more answers in a single column runs off
  // the bottom once the prompt and the judges strip have taken their share.
  const cols = count > 8 ? 3 : count > 3 ? 2 : 1;
  return {
    class: `stack-answers ${cols > 1 ? `two-col cols-${cols}` : ''}`,
    style: cols > 1 ? `--cols:${cols};--rows:${Math.ceil(count / cols)}` : null
  };
}

/* ------------------------------------------------------------- scoreboard */

function viewScores() {
  const rows = standings(state);
  return h('div', { class: 'stack' },
    h('div', { class: 'prompt-big' },
      state.round >= state.totalRounds ? `End of the ${state.roundLabel}` : `End of round ${state.round}`),
    board(rows, true),
    h('div', { class: 'center muted' },
      state.round < state.totalRounds
        ? (state.mode === 'teams' && state.round + 1 >= state.totalRounds
          ? `Next: the grand final — top ${Math.min(state.settings.finalists, rows.length)} teams only`
          : 'Next round starting…')
        : '')
  );
}

function board(rows, showGain, { twoColAbove = 7, maxCols = 2 } = {}) {
  // Twenty teams in two columns is ten rows deep, which needs tighter rows to fit a TV;
  // on the final screen the podium takes most of the height, so the tail goes three-up.
  const cols = rows.length > twoColAbove ? (rows.length > 8 ? maxCols : 2) : 1;
  const dense = rows.length > 14 || cols > 2;
  return h('div', {
    class: `board ${cols > 1 ? 'two-col' : ''} ${dense ? 'dense' : ''}`,
    style: cols > 1 ? `--cols:${cols};--rows:${Math.ceil(rows.length / cols)}` : null
  }, rows.map((p, i) =>
    h('div', { class: 'line', style: `animation-delay:${i * 70}ms` },
      h('div', { class: 'rank' }, `#${p.rank}`),
      h('div', { class: 'row', style: 'gap:10px;min-width:0' },
        h('span', { class: 'dot', style: `background:${p.color}` }),
        h('span', { class: 'nowrap' }, p.name),
        p.members?.length ? h('span', { class: 'muted roster' }, p.members.join(', ')) : null),
      showGain && p.roundPoints ? h('div', { class: 'gain' }, `+${p.roundPoints}`) : h('div'),
      h('div', { class: 'total' }, p.score.toLocaleString())
    )));
}

/* ------------------------------------------------------------------ final */

function viewFinal() {
  const rows = standings(state);
  const podiumOrder = [rows[1], rows[0], rows[2]].filter(Boolean); // 2nd, 1st, 3rd
  return h('div', { class: 'stack' },
    h('div', {
      class: 'prompt-big',
      style: `color:var(--yellow)${rows.length > 6 ? ';font-size:min(clamp(1.4rem,3.4vw,3rem),6.5vh)' : ''}`
    }, rows[0] ? `${rows[0].name} wins!` : 'Game over'),
    h('div', { class: `podium ${rows.length > 6 ? 'compact' : ''}` }, podiumOrder.map(p => h('div', { class: `step rank-${p.rank}` },
      p.rank === 1 ? h('div', { class: 'crown' }, '👑') : null,
      h('div', { class: 'name' }, p.name),
      h('div', { class: 'bar', style: `animation-delay:${p.rank * 120}ms` }, p.score.toLocaleString())
    ))),
    // The podium already eats most of the screen, so the also-rans go two-up sooner.
    rows.length > 3 ? board(rows.slice(3), false, { twoColAbove: 3, maxCols: 3 }) : null,
    state.topAuthor ? h('div', { class: 'center award' },
      h('span', { class: 'muted' }, 'Sharpest quip of the night: '),
      h('strong', {}, state.topAuthor.name),
      state.topAuthor.teamName ? h('span', { class: 'muted' }, ` (${state.topAuthor.teamName})`) : null,
      h('span', { class: 'pts' }, ` ${state.topAuthor.points.toLocaleString()} pts written`)
    ) : null,
    h('div', { class: 'row', style: 'justify-content:center;gap:16px' },
      h('button', { onclick: () => sock.send({ t: 'host:start', settings: {} }) }, 'Rematch (same players)'),
      h('button', { class: 'ghost', onclick: () => sock.send({ t: 'host:lobby' }) }, 'Back to lobby')
    )
  );
}
