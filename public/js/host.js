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

function totalForPhase(s) {
  const t = s.settings ?? {};
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
  skipBtn.classList.toggle('hidden', !['writing', 'voting', 'reveal', 'scores'].includes(state.phase));

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
    lobby: viewLobby, writing: viewWriting, voting: viewVoting,
    reveal: viewReveal, scores: viewScores, final: viewFinal
  }[state.phase] ?? viewLobby)());
}

/** Everything the current view draws. Same string in, same pixels out — so skip the rebuild. */
function signature(s) {
  const base = `${s.phase}:${s.round}`;
  switch (s.phase) {
    case 'lobby':
      return `${base}:${s.code}:${joinHost}:${s.customPromptCount}:` +
        s.players.map(p => `${p.id}${p.name}${p.connected}`).join(',');
    case 'writing':
      return `${base}:${(s.writing?.done ?? []).map(p => p.name + p.away).join(',')}` +
        `|${(s.writing?.waiting ?? []).map(p => p.name + p.away).join(',')}`;
    case 'voting':
      return `${base}:${s.voting?.matchupId}:${(s.voting?.judges ?? []).map(j => `${j.name}${j.voted}${j.away}`).join(',')}`;
    case 'reveal':
      return `${base}:${s.reveal?.prompt}:${(s.reveal?.scored ?? []).map(x => `${x.playerId}${x.votes}${x.points}`).join(',')}`;
    case 'scores':
      return `${base}:${s.scoreboard.map(p => `${p.id}${p.score}${p.roundPoints}`).join(',')}`;
    case 'final':
      return `${base}:${s.scoreboard.map(p => `${p.id}${p.score}`).join(',')}`;
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

  wrap.append(h('div', { class: 'lobby-players' },
    count ? state.players.map(p => h('div', { class: `plate ${p.connected ? '' : 'away'}` },
      h('span', { class: 'dot', style: `background:${p.color}` }),
      p.name,
      h('span', { class: 'x', title: 'Remove', onclick: () => sock.send({ t: 'host:kick', playerId: p.id }) }, '×')
    )) : h('div', { class: 'muted', style: 'font-size:1.2rem' }, 'Waiting for players to join…')
  ));

  wrap.append(h('div', { class: 'row center', style: 'justify-content:center;gap:18px;flex-wrap:wrap' },
    h('button', {
      disabled: count < state.minPlayers,
      onclick: () => sock.send({ t: 'host:start', settings: readSettings() })
    }, count < state.minPlayers ? `Need ${state.minPlayers - count} more player${state.minPlayers - count === 1 ? '' : 's'}` : `Start the game (${count})`),
    h('div', { class: 'pill' }, `${state.customPromptCount} custom prompts loaded`)
  ));

  wrap.append(hostTools());
  return wrap;
}

function hostTools() {
  const s = state.settings;
  const d = h('details', { class: 'host-tools card' },
    h('summary', {}, 'Game options & custom prompts'),
    h('div', { class: 'stack', style: 'margin-top:16px' },
      h('div', { class: 'settings-grid' },
        numField('writeSeconds', 'Write time (s)', s.writeSeconds),
        numField('finalWriteSeconds', 'Final write (s)', s.finalWriteSeconds),
        numField('voteSeconds', 'Vote time (s)', s.voteSeconds),
        numField('revealSeconds', 'Reveal (s)', s.revealSeconds),
        numField('scoreSeconds', 'Scoreboard (s)', s.scoreSeconds),
        numField('totalRounds', 'Rounds (1-3)', s.totalRounds)
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
      h('div', { class: 'tally' }, `${v.votedCount} / ${v.voterCount} votes in`),
      h('div', { class: 'waiting-grid', style: 'margin-top:12px' },
        v.judges.map(j => h('div', { class: `plate ${j.voted ? 'done' : ''} ${j.away ? 'away' : ''}` },
          h('span', { class: 'dot', style: `background:${j.color}` }), j.name,
          j.voted ? ' ✓' : j.away ? ' (away)' : '')))
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
    h('div', { class: 'who' }, h('span', { class: 'dot', style: `background:${s.color}` }), s.name),
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
            h('div', { class: 'who' }, h('span', { class: 'dot', style: `background:${s.color}` }), s.name),
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
  return h('div', { class: 'stack' },
    h('div', { class: 'prompt-big' }, `End of ${state.round === 3 ? 'the Last Lash' : `round ${state.round}`}`),
    board(state.scoreboard, true),
    h('div', { class: 'center muted' }, state.round < state.totalRounds ? 'Next round starting…' : '')
  );
}

function board(rows, showGain, { twoColAbove = 7 } = {}) {
  const twoCol = rows.length > twoColAbove;
  return h('div', {
    class: `board ${twoCol ? 'two-col' : ''}`,
    style: twoCol ? `--rows:${Math.ceil(rows.length / 2)}` : null
  }, rows.map((p, i) =>
    h('div', { class: 'line', style: `animation-delay:${i * 70}ms` },
      h('div', { class: 'rank' }, `#${p.rank}`),
      h('div', { class: 'row', style: 'gap:10px' }, h('span', { class: 'dot', style: `background:${p.color}` }), p.name),
      showGain && p.roundPoints ? h('div', { class: 'gain' }, `+${p.roundPoints}`) : h('div'),
      h('div', { class: 'total' }, p.score.toLocaleString())
    )));
}

/* ------------------------------------------------------------------ final */

function viewFinal() {
  const rows = state.scoreboard;
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
    rows.length > 3 ? board(rows.slice(3), false, { twoColAbove: 3 }) : null,
    h('div', { class: 'row', style: 'justify-content:center;gap:16px' },
      h('button', { onclick: () => sock.send({ t: 'host:start', settings: {} }) }, 'Rematch (same players)'),
      h('button', { class: 'ghost', onclick: () => sock.send({ t: 'host:lobby' }) }, 'Back to lobby')
    )
  );
}
