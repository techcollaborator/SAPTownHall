import { createSocket, $, h, clear, promptHtml, toast, startTicker, paintTimer, blip } from './net.js';

const stage = $('#stage');
const head = $('#head');
const connEl = $('#conn');

let state = null, joined = false, sig = null, phaseSeen = null;
let writeIdx = 0;
const drafts = new Map();     // matchupId -> in-progress text

const params = new URLSearchParams(location.search);
const codeFromUrl = (params.get('room') ?? '').toUpperCase();
const tokenKey = code => `qs.token.${code}`;
const nameKey = 'qs.name';

const nameFromUrl = (params.get('name') ?? '').slice(0, 14);
$('#code').value = codeFromUrl || sessionStorage.getItem('qs.code') || '';
$('#name').value = nameFromUrl || localStorage.getItem(nameKey) || '';

const sock = createSocket({
  hello: () => {
    // Careful: the join form is gone once we're in a game, so never read the DOM for this.
    const code = (sessionStorage.getItem('qs.code') || codeFromUrl || $('#code')?.value || '')
      .toUpperCase().trim();
    const token = code ? localStorage.getItem(tokenKey(code)) : null;
    // Auto-rejoin on refresh/reconnect when we already have a seat.
    if (code && token) return { t: 'player:join', code, token, name: localStorage.getItem(nameKey) ?? '' };
    // ?room=ABCD&name=Sam joins straight away (handy for QR links).
    if (codeFromUrl && nameFromUrl) {
      localStorage.setItem(nameKey, nameFromUrl);
      return { t: 'player:join', code: codeFromUrl, name: nameFromUrl };
    }
    return null;
  },
  onJoined: msg => {
    joined = true;
    sessionStorage.setItem('qs.code', msg.code);
    if (msg.token) localStorage.setItem(tokenKey(msg.code), msg.token);
    head.classList.remove('hidden');
    $('#room-pill').textContent = msg.code;
  },
  onError: msg => {
    toast(msg.error);
    if (msg.fatal) {
      joined = false; sig = null; state = null;
      head.classList.add('hidden');
      const code = ($('#code').value || codeFromUrl).toUpperCase();
      if (code) localStorage.removeItem(tokenKey(code));
      renderJoinForm();
    }
  },
  onState: s => { state = s; render(); },
  onStatus: st => {
    // Only speak up when something is wrong — a permanent "connected" badge is just noise.
    connEl.textContent = st === 'offline' ? 'reconnecting…' : st;
    connEl.classList.toggle('bad', st !== 'online');
    connEl.classList.toggle('hidden', st === 'online');
  }
});

/* ------------------------------------------------------------------- join */

function wireJoinForm() {
  const form = $('#join-form');
  if (!form) return;
  form.addEventListener('submit', e => {
    e.preventDefault();
    const code = $('#code').value.toUpperCase().trim();
    const name = $('#name').value.trim();
    if (code.length !== 4) return toast('Room codes are 4 letters.');
    if (!name) return toast('Pick a name!');
    localStorage.setItem(nameKey, name);
    sessionStorage.setItem('qs.code', code);
    sock.send({ t: 'player:join', code, name, token: localStorage.getItem(tokenKey(code)) ?? undefined });
  });
}
wireJoinForm();

function renderJoinForm() {
  clear(stage).append(
    h('form', { class: 'stack', id: 'join-form' },
      h('div', { class: 'display center', style: 'font-size:3rem;line-height:1' }, 'QUIPSMASH'),
      h('input', { id: 'code', placeholder: 'ROOM CODE', maxlength: '4', autocomplete: 'off', autocapitalize: 'characters',
        value: ($('#code')?.value ?? codeFromUrl ?? ''),
        style: 'text-transform:uppercase;font-family:var(--display);font-size:2rem;text-align:center;letter-spacing:.3em' }),
      h('input', { id: 'name', placeholder: 'Your name', maxlength: '14', autocomplete: 'off',
        value: localStorage.getItem(nameKey) ?? '', style: 'text-align:center;font-weight:800' }),
      h('button', { type: 'submit' }, 'Join the game')
    )
  );
  wireJoinForm();
}

/* --------------------------------------------------------------- countdown */

let phaseTotal = null;
startTicker(
  () => (joined && state?.deadline && ['writing', 'voting'].includes(state.phase))
    ? { deadline: state.deadline, now: sock.now, total: phaseTotal } : null,
  (left, total) => paintTimer($('#timer-bar'), null, left, total)
);

/* ----------------------------------------------------------------- render */

function render() {
  if (!state || !joined) return;
  const t = state.settings ?? {};
  phaseTotal = state.phase === 'writing'
    ? (state.roundKind === 'final' ? t.finalWriteSeconds : t.writeSeconds)
    : state.phase === 'voting' ? t.voteSeconds : null;
  if (!phaseTotal) paintTimer($('#timer-bar'), null, null, null);

  if (state.you) {
    $('#me-dot').style.background = state.you.teamColor ?? state.you.color;
    $('#me-name').textContent = state.you.teamName
      ? `${state.you.name} · ${state.you.teamName}`
      : state.you.name;
    $('#me-score').textContent = state.you.score.toLocaleString();
    $('#room-pill').textContent = state.code;
    head.classList.remove('hidden');
  }

  if (state.phase !== phaseSeen) {
    writeIdx = 0;
    if (state.phase === 'writing' || state.phase === 'voting') {
      navigator.vibrate?.(35);
      blip(state.phase === 'writing' ? 640 : 480, 100);
    }
    phaseSeen = state.phase;
  }

  const next = signature();
  if (next === sig) return;   // don't blow away what someone is typing
  sig = next;

  clear(stage).append(({
    lobby: viewLobby, writing: viewWriting, drafting: viewDrafting, picking: viewPicking,
    review: viewReview, voting: viewVoting, reveal: viewReveal,
    scores: viewScores, final: viewFinal
  }[state.phase] ?? viewLobby)());
}

function signature() {
  const s = state;
  const team = s.you?.teamId ?? '';
  switch (s.phase) {
    case 'lobby': return `lobby:${s.playerCount}:${s.you?.name}`;
    case 'drafting': return `d:${s.round}:${team}:${s.draft?.submitted}:${s.draft?.matchupId}`;
    case 'picking': return `p:${s.round}:${s.pick?.myVote}:${s.pick?.locked}:${(s.pick?.options ?? []).map(o => o.id + o.votes).join(',')}`;
    case 'review': return `rv:${s.round}`;
    case 'writing': return `w:${s.round}:${writeIdx}:${(s.write ?? []).map(x => x.matchupId + x.submitted).join('|')}`;
    case 'voting': return `v:${s.vote?.matchupId}:${s.vote?.myVote}:${s.vote?.canVote}:` +
      (s.vote?.options ?? []).map(o => o.flagged).join(',');
    case 'reveal': return `r:${s.reveal?.prompt}:${s.reveal?.youGained}`;
    case 'scores': return `s:${s.round}:${s.you?.score}`;
    case 'final': return `f:${(s.board ?? []).map(p => p.id + p.score).join('|')}`;
    default: return s.phase;
  }
}

const statusCard = (big, sub) => h('div', { class: 'stack center' },
  h('div', { class: 'big-status' }, big),
  sub ? h('p', { class: 'muted', style: 'margin:0;font-size:1.05rem' }, sub) : null
);

/* ------------------------------------------------------------------ views */

function viewLobby() {
  const me = state.you;
  return h('div', { class: 'stack center' },
    h('div', { class: 'big-status' }, `You're in, ${me?.name ?? ''}!`),
    h('p', { class: 'muted', style: 'margin:0' },
      state.mode === 'teams'
        ? 'Teams get drawn when the host starts. Watch the big screen.'
        : 'Waiting for the host to start the game.'),
    h('div', { class: 'pill', style: 'margin:0 auto' }, `${state.hereCount} here`)
  );
}

function viewWriting() {
  const list = state.write ?? [];
  if (!list.length) return statusCard('Sit this one out', 'You joined mid-round — you\'ll be in the next one.');

  // Anything the server has confirmed no longer needs a local draft.
  for (const x of list) if (x.submitted) drafts.delete(x.matchupId);

  const pending = list.findIndex(x => !x.submitted);
  if (pending === -1) {
    return h('div', { class: 'stack' },
      statusCard('Answers in! 🎉', 'Waiting for everyone else to finish.'),
      h('div', { class: 'stack' }, list.map(x => h('div', { class: 'card' },
        h('div', { class: 'muted', style: 'font-size:.85rem', html: promptHtml(x.prompt) }),
        h('div', { style: 'font-weight:800;margin-top:8px' }, x.answer)
      )))
    );
  }

  writeIdx = pending;
  const item = list[pending];
  const input = h('textarea', {
    id: 'answer', rows: '3', maxlength: String(state.maxAnswerLen),
    placeholder: 'Be funny. Be quick.', autocomplete: 'off',
    style: 'font-size:1.15rem;font-weight:700'
  });
  input.value = drafts.get(item.matchupId) ?? '';

  const counter = h('div', { class: 'counter' });
  const paint = () => {
    const left = state.maxAnswerLen - input.value.length;
    counter.textContent = `${left} characters left`;
    counter.classList.toggle('warn', left <= 12);
  };
  input.addEventListener('input', () => { drafts.set(item.matchupId, input.value); paint(); });
  paint();

  const submit = () => {
    const text = input.value.trim();
    if (!text) return toast('Write something first!');
    sock.send({ t: 'answer', matchupId: item.matchupId, text });
    drafts.set(item.matchupId, text);   // keep it until the server confirms, in case it bounces
    blip(880, 90);
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  });

  queueMicrotask(() => input.focus({ preventScroll: true }));

  return h('div', { class: 'stack' },
    h('div', { class: 'muted', style: 'font-weight:800;letter-spacing:.12em;font-size:.78rem' },
      state.roundKind === 'final' ? 'LAST LASH · TRIPLE POINTS' : `PROMPT ${pending + 1} OF ${list.length} · ×${state.multiplier}`),
    h('div', { class: 'prompt', html: promptHtml(item.prompt) }),
    input, counter,
    h('button', { onclick: submit }, 'Send it')
  );
}

function viewDrafting() {
  const d = state.draft;
  if (!d) {
    return h('div', { class: 'stack center' },
      teamBadge(),
      statusCard('You\'re a judge this round', 'Your team is sitting this one out. Watch the screen and get ready to vote.')
    );
  }
  if (d.submitted) {
    return h('div', { class: 'stack' },
      teamBadge(),
      statusCard('Idea sent 🎉', `${d.teamDrafts} of ${d.teamSize} on your team have written something.`),
      h('div', { class: 'card' },
        h('div', { class: 'muted', style: 'font-size:.85rem', html: promptHtml(d.prompt) }),
        h('div', { style: 'font-weight:800;margin-top:8px' }, d.mine)),
      h('p', { class: 'muted center', style: 'margin:0;font-size:.9rem' },
        'Next your team votes on which idea to send up.')
    );
  }

  const input = h('textarea', {
    id: 'answer', rows: '3', maxlength: String(state.maxAnswerLen),
    placeholder: 'One funny line. Your team votes on the best.', autocomplete: 'off',
    style: 'font-size:1.15rem;font-weight:700'
  });
  input.value = drafts.get(d.matchupId) ?? '';
  const counter = h('div', { class: 'counter' });
  const paint = () => {
    const left = state.maxAnswerLen - input.value.length;
    counter.textContent = `${left} characters left`;
    counter.classList.toggle('warn', left <= 12);
  };
  input.addEventListener('input', () => { drafts.set(d.matchupId, input.value); paint(); });
  paint();
  const submit = () => {
    const text = input.value.trim();
    if (!text) return toast('Write something first!');
    sock.send({ t: 'draft', text });
    blip(880, 90);
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  });
  queueMicrotask(() => input.focus({ preventScroll: true }));

  return h('div', { class: 'stack' },
    teamBadge(),
    h('div', { class: 'muted', style: 'font-weight:800;letter-spacing:.12em;font-size:.78rem' },
      state.roundKind === 'final' ? 'GRAND FINAL · TRIPLE POINTS' : `ROUND ${state.round} · ×${state.multiplier}`),
    h('div', { class: 'prompt', html: promptHtml(d.prompt) }),
    input, counter,
    h('button', { onclick: submit }, 'Send to my team')
  );
}

function viewPicking() {
  const pk = state.pick;
  if (!pk) return h('div', { class: 'stack center' }, teamBadge(), statusCard('Sit tight', 'Other teams are choosing.'));
  if (pk.locked) {
    return h('div', { class: 'stack' }, teamBadge(),
      statusCard('Locked in ✓', 'Your captain sent it. Watch the big screen.'));
  }
  const voted = !!pk.myVote;
  return h('div', { class: 'stack' },
    teamBadge(),
    h('div', { class: 'muted', style: 'font-weight:800;letter-spacing:.12em;font-size:.78rem' },
      voted ? 'VOTE IN — WAITING FOR THE TEAM' : 'WHICH LINE SHOULD WE SEND?'),
    h('div', { class: 'prompt', html: promptHtml(pk.prompt) }),
    h('div', { class: 'stack' }, pk.options.map(o => h('button', {
      class: `vote-btn ${pk.myVote === o.id ? 'chosen' : ''} ${o.mine ? 'mine' : ''}`,
      disabled: o.mine && pk.options.length > 1,
      onclick: () => { sock.send({ t: 'pick', draftId: o.id }); blip(760, 90); navigator.vibrate?.(20); }
    },
      h('span', {}, o.text),
      o.mine ? h('span', { class: 'muted tag' }, 'yours') : null,
      o.votes ? h('span', { class: 'tag votes-tag' }, `${o.votes}`) : null
    ))),
    pk.isLeader ? h('button', {
      class: 'cyan',
      onclick: () => { sock.send({ t: 'lock' }); blip(980, 120); }
    }, 'Captain: lock it in ▸') : null,
    h('p', { class: 'muted center', style: 'margin:0;font-size:.85rem' },
      pk.isLeader ? 'You break ties, so vote too.' : 'Your captain can lock it in early.')
  );
}

function viewReview() {
  return h('div', { class: 'stack center' },
    teamBadge(),
    statusCard('Answers are in', state.waiting?.reason ?? 'The host is having a quick look before anything goes up.')
  );
}

/** A small strip showing which team you're on, and who's with you. */
function teamBadge() {
  const you = state.you;
  if (!you?.teamName) return h('div', { class: 'hidden' });
  return h('div', { class: 'teambadge' },
    h('span', { class: 'dot', style: `background:${you.teamColor}` }),
    h('strong', {}, you.teamName),
    you.isLeader ? h('span', { class: 'tag captain' }, 'captain') : null,
    you.teammates.length ? h('span', { class: 'muted mates' }, `with ${you.teammates.join(', ')}`) : null
  );
}

function viewVoting() {
  const v = state.vote;
  if (!v) return statusCard('Hang on…');
  if (!v.canVote) {
    return h('div', { class: 'stack' },
      h('div', { class: 'muted', style: 'font-weight:800;letter-spacing:.12em;font-size:.78rem' },
        `MATCH ${v.index} OF ${v.total}`),
      h('div', { class: 'prompt', html: promptHtml(v.prompt) }),
      statusCard('This one\'s yours!', v.reason ?? 'Look at the big screen and hope for the best.')
    );
  }
  const voted = !!v.myVote;
  return h('div', { class: 'stack' },
    h('div', { class: 'muted', style: 'font-weight:800;letter-spacing:.12em;font-size:.78rem' },
      voted ? 'VOTE LOCKED IN' : `WHICH IS FUNNIER? · MATCH ${v.index} OF ${v.total}`),
    h('div', { class: 'prompt', html: promptHtml(v.prompt) }),
    h('div', { class: 'stack' }, v.options.map(o => h('div', { class: 'voterow' },
      h('button', {
        class: `vote-btn ${v.myVote === o.id ? 'chosen' : ''} ${o.mine ? 'mine' : ''}`,
        disabled: voted || o.mine,
        onclick: () => { sock.send({ t: 'vote', matchupId: v.matchupId, targetId: o.id }); blip(760, 90); navigator.vibrate?.(20); }
      }, o.text),
      h('button', {
        class: `flagbtn ${o.flagged ? 'flagged' : ''}`,
        title: 'Report this answer to the host',
        onclick: () => { if (!o.flagged) sock.send({ t: 'flag', matchupId: v.matchupId, sideId: o.id }); }
      }, '⚑')
    ))),
    voted ? h('p', { class: 'muted center', style: 'margin:0' }, 'Nice. Watch the big screen.') : null
  );
}

function viewReveal() {
  const r = state.reveal;
  const gained = r?.youGained ?? 0;
  const mySide = state.you?.teamId ?? state.you?.id;
  const mine = r?.scored?.find(s => s.sideId === mySide);
  return h('div', { class: 'stack center' },
    mine
      ? h('div', { class: 'stack center' },
          h('div', { class: `gain ${gained ? '' : 'zero'}` }, gained ? `+${gained}` : 'No points'),
          h('p', { class: 'muted', style: 'margin:0' },
            (mine.shutout ? 'CLEAN SWEEP! Every single vote.'
              : mine.votes ? `${mine.votes} vote${mine.votes === 1 ? '' : 's'} for ${state.you?.teamName ?? 'you'}.`
              : 'Nobody picked it. Brutal.') +
            (r.wasYourAnswer ? ' That was your line!' : '')))
      : statusCard('Watch the screen', 'Results coming up.'),
    h('div', { class: 'score', style: 'font-size:1.6rem' },
      `${state.you?.teamName ? state.you.teamName + ': ' : 'Total: '}${(state.you?.score ?? 0).toLocaleString()}`)
  );
}

function viewScores() {
  const rows = state.board ?? [];
  const mineId = state.you?.teamId ?? state.you?.id;
  const me = rows.find(r => r.id === mineId);
  return h('div', { class: 'stack center' },
    teamBadge(),
    h('div', { class: 'big-status' }, me ? `#${me.rank} of ${rows.length}` : 'Scores'),
    h('div', { class: 'score', style: 'font-size:2rem' }, (me?.score ?? 0).toLocaleString()),
    h('p', { class: 'muted', style: 'margin:0' },
      state.round < state.totalRounds ? 'Next round coming right up.' : 'Final scores on the big screen!')
  );
}

function viewFinal() {
  const rows = state.board ?? [];
  const mineId = state.you?.teamId ?? state.you?.id;
  const me = rows.find(r => r.id === mineId);
  const won = me?.rank === 1;
  const iAmTopAuthor = state.topAuthor && state.topAuthor.name === state.you?.name;
  return h('div', { class: 'stack center' },
    teamBadge(),
    h('div', { class: 'big-status' }, won ? '👑 Winners!' : `Finished #${me?.rank ?? '-'} of ${rows.length}`),
    h('div', { class: 'score', style: 'font-size:2.2rem' }, (me?.score ?? 0).toLocaleString()),
    state.you?.ownPoints ? h('p', { class: 'muted', style: 'margin:0' },
      `Your own lines earned ${state.you.ownPoints.toLocaleString()} of that.`) : null,
    iAmTopAuthor ? h('div', { class: 'award' }, '✍️ Sharpest quip of the night — that\'s you.') : null,
    h('p', { class: 'muted', style: 'margin:0' }, 'Stay put — the host can start a rematch.')
  );
}
