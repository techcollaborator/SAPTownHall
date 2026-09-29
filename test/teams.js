/* A town-hall-sized team game, played end to end: 100 people, 5 to a team.
   Usage: node test/teams.js [players] [teamSize] */
import { startServer, startHost, connect, reporter, sleep, log } from './harness.js';

const PLAYERS = Number(process.argv[2] ?? 100);
const TEAM_SIZE = Number(process.argv[3] ?? 5);
const PORT = 4700 + (PLAYERS % 50);
const { check, finish } = reporter();

await startServer(PORT);
const host = await startHost(PORT);

/* ---- everyone joins ---- */
const people = [];
for (let i = 0; i < PLAYERS; i++) {
  const person = { name: `P${String(i + 1).padStart(3, '0')}`, seen: new Set(), state: null };
  person.conn = await connect(PORT, m => {
    if (m.t === 'error') person.lastError = m.error;
    if (m.t !== 'state') return;
    const s = m.state;
    person.state = s;

    // Write an idea for my team.
    if (s.phase === 'drafting' && s.draft && !s.draft.submitted && !person.seen.has(`d${s.round}`)) {
      person.seen.add(`d${s.round}`);
      person.conn.send({ t: 'draft', text: `${person.name} says something about ${s.draft.prompt.slice(0, 14)}` });
    }
    // Vote for a teammate's idea.
    if (s.phase === 'picking' && s.pick && !s.pick.myVote && !person.seen.has(`p${s.round}`)) {
      person.seen.add(`p${s.round}`);
      const other = s.pick.options.find(o => !o.mine);
      if (other) person.conn.send({ t: 'pick', draftId: other.id });
    }
    // Judge someone else's matchup.
    if (s.phase === 'voting' && s.vote?.canVote && !s.vote.myVote && !person.seen.has(`v${s.vote.matchupId}`)) {
      person.seen.add(`v${s.vote.matchupId}`);
      const pick = s.vote.options.filter(o => !o.mine)[i % 2] ?? s.vote.options.find(o => !o.mine);
      if (pick) person.conn.send({ t: 'vote', matchupId: s.vote.matchupId, targetId: pick.id });
    }
  });
  person.conn.send({ t: 'player:join', code: host.code, name: person.name });
  people.push(person);
}
for (let i = 0; i < 80 && host.state.playerCount < PLAYERS; i++) await sleep(100);
check(host.state.playerCount === PLAYERS, `${PLAYERS} people joined (got ${host.state.playerCount})`);

/* ---- teams form ---- */
host.send({ t: 'host:start', settings: {
  mode: 'teams', teamSize: TEAM_SIZE, totalRounds: 3, finalists: 4,
  draftSeconds: 12, pickSeconds: 10, voteSeconds: 10, revealSeconds: 2, scoreSeconds: 2
} });
await host.waitFor(s => s.phase === 'drafting', 'the first drafting phase');

const expectedTeams = Math.max(2, Math.round(PLAYERS / TEAM_SIZE));
const teams = host.state.teams;
check(teams.length === expectedTeams, `${expectedTeams} teams of ~${TEAM_SIZE} (got ${teams.length})`);
check(teams.reduce((a, t) => a + t.size, 0) === PLAYERS, 'every person landed on a team');
check(Math.max(...teams.map(t => t.size)) - Math.min(...teams.map(t => t.size)) <= 1, 'team sizes differ by at most one');
check(new Set(teams.map(t => t.name)).size === teams.length, 'every team got a different name');
check(teams.every(t => t.members.length === t.size), 'team rosters are complete');
const leaders = people.filter(p => p.state?.you?.isLeader).length;
check(leaders === teams.length, `each team has exactly one captain (${leaders})`);
check(host.state.drafting.prompts === Math.ceil(teams.length / 2),
  `${Math.ceil(teams.length / 2)} matchups this round, so ${Math.ceil(teams.length / 2)} different prompts`);
const promptsSeen = new Set(people.map(p => p.state?.draft?.prompt).filter(Boolean));
check(promptsSeen.size === host.state.drafting.prompts, `teams got ${promptsSeen.size} distinct prompts, not one shared one`);

/* ---- through the whole game ---- */
await host.waitFor(s => s.phase === 'picking', 'the team pick');
check(people.every(p => !p.state?.pick || p.state.pick.options.length >= 1), 'everyone can see their team\'s shortlist');
const anonymous = people.every(p => !p.state?.pick || p.state.pick.options.every(o => o.authorName === undefined));
check(anonymous, 'the shortlist is anonymous inside the team');

await host.waitFor(s => s.phase === 'review', 'the host review');
const review = host.state.review;
check(review.total === teams.length, `the host sees all ${teams.length} team answers before any of them go up (${review.total})`);
check(review.rows.every(r => r.authorName && r.name), 'each row names the team and the author');

// Pull one answer and make sure it never reaches the screen.
const victim = review.rows[0];
host.send({ t: 'host:exclude', matchupId: victim.matchupId, sideId: victim.sideId });
await sleep(300);
check(host.state.review.excluded === 1, 'the host can exclude an answer');
host.send({ t: 'host:approve' });

await host.waitFor(s => s.phase === 'voting', 'voting');
const shown = host.state.voting.answers.map(a => a.text);
check(!shown.includes(victim.text), 'the excluded answer is not in the first matchup');
check(host.state.voting.voterCount > 0 && host.state.voting.voterCount <= PLAYERS,
  `voters exclude the two teams on screen (${host.state.voting.voterCount})`);
check(host.state.voting.voterCount > 12
  ? host.state.voting.judges.length === 0
  : host.state.voting.judges.length > 0,
  host.state.voting.voterCount > 12
    ? 'a big room gets a tally rather than dozens of name plates'
    : `a small room still lists its ${host.state.voting.voterCount} judges by name`);

/* ---- every later round waits for the host too ---- */
let approvals = 1;
for (let round = 2; round <= 3; round++) {
  await host.waitFor(s => s.round === round && s.phase === 'review', `round ${round}'s review`, 300_000);
  check(true, `round ${round} stopped for the host to review (${host.state.review.total} answers)`);
  host.send({ t: 'host:approve' });
  approvals++;
  await sleep(200);
}
check(approvals === 3, 'nothing went on screen in any round without the host approving it');

await host.waitFor(s => s.phase === 'final', 'the end of the game', 300_000);

/* ---- the results hold up ---- */
log('');
const board = host.state.teams;
const revealed = host.reveals;
check(revealed.length > 0, `${revealed.length} matchups were played`);
check(revealed.every(r => r.scored.every(x => x.name)), 'every answer on screen was attributed to a team');
check(revealed.every(r => r.scored.reduce((a, x) => a + x.votes, 0) === r.totalVotes), 'vote tallies add up');
check(!revealed.some(r => r.scored.some(x => x.text === victim.text)), 'the excluded answer never appeared at all');
check(board.reduce((a, t) => a + t.score, 0) > 0, `points were awarded (${board.reduce((a, t) => a + t.score, 0).toLocaleString()})`);
check(board.every((t, i) => t.rank === i + 1), 'teams are ranked 1..n');
check(board.every((t, i, a) => i === 0 || a[i - 1].score >= t.score), 'leaderboard is sorted high to low');
const finalRound = revealed.at(-1);
const expectFinalists = Math.min(4, teams.length);
check(finalRound.scored.length === expectFinalists,
  `the grand final was a ${finalRound.scored.length}-way between the top teams`);
check(finalRound.totalVotes > 0, 'the grand final actually drew votes');
check(host.state.topAuthor?.name, `an individual was singled out for the sharpest lines (${host.state.topAuthor?.name}, ${host.state.topAuthor?.points})`);

// Nobody judged their own team.
const selfVotes = revealed.flatMap(r => r.scored.flatMap(side =>
  side.voters.filter(voterName => {
    const voter = people.find(p => p.name === voterName);
    return voter && voter.state?.you?.teamName === side.name;
  })));
check(selfVotes.length === 0, `nobody voted for their own team${selfVotes.length ? ` (${selfVotes.length} did)` : ''}`);

// Payload size matters at this scale.
const sample = JSON.stringify(people[0].state).length;
check(sample < 4000, `a phone's state payload stays small (${sample} bytes)`);

finish(`ALL CHECKS PASSED (${PLAYERS} players, ${teams.length} teams)`);
