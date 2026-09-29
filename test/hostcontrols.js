/* Fast unit tests on the Room class itself: the host's moderation controls, and the
   awkward team arithmetic (odd team counts, tiny rooms, everyone in the final). */
import { Room } from '../src/game.js';

const fail = [];
const check = (c, l) => { if (!c) fail.push(l); console.log(`   ${c ? '✓' : '✗'} ${l}`); };

/** A room with n players, teams of `size`, wound forward to the host review step. */
function roomAtReview(n, size, rounds = 2) {
  const room = new Room('TEST', {});
  for (let i = 0; i < n; i++) room.join(`P${i + 1}`);
  room.settings = { ...room.settings, draftSeconds: 9999, pickSeconds: 9999, voteSeconds: 9999, revealSeconds: 9999, scoreSeconds: 9999 };
  room.start({ mode: 'teams', teamSize: size, totalRounds: rounds });
  for (const m of room.matchups) {
    for (const side of m.sides) {
      for (const pid of room.teams.get(side).memberIds) room.submitDraft(pid, `${room.players.get(pid).name} wrote this`);
    }
  }
  room.advance();   // picking -> review
  return room;
}

/* ---- team arithmetic ---- */
{
  const room = roomAtReview(100, 5);
  check(room.teams.size === 20, `100 people, 5 a side → 20 teams (${room.teams.size})`);
  check(room.matchups.length === 10, `→ 10 matchups a round (${room.matchups.length})`);
  check(room.matchups.every(m => m.sides.length === 2), 'all straight two-team matchups');
  room.destroy();
}
{
  // An odd number of teams: the spare team joins the last matchup as a three-way.
  const room = roomAtReview(35, 5);
  check(room.teams.size === 7, `35 people, 5 a side → 7 teams (${room.teams.size})`);
  const sizes = room.matchups.map(m => m.sides.length);
  check(sizes.length === 3 && sizes.filter(x => x === 3).length === 1,
    `7 teams → ${sizes.length} matchups, one of them a three-way (${sizes.join('/')})`);
  check(new Set(room.matchups.flatMap(m => m.sides)).size === 7, 'every team is in exactly one matchup');
  room.destroy();
}
{
  const room = roomAtReview(4, 5);
  check(room.teams.size === 2, `4 people asking for teams of 5 still makes 2 teams (${room.teams.size})`);
  room.destroy();
}

/* ---- the review gate ---- */
{
  const room = roomAtReview(20, 5);
  check(room.phase === 'review', 'the round stops at review, with no timer');
  check(room.deadline === null, 'and no clock runs, so the host is never rushed');
  const rows = room.reviewList();
  check(rows.length === 4, `every team answer is listed (${rows.length})`);
  check(rows.every(r => r.text && r.name && r.authorName), 'each row has the answer, team and author');

  // Pulling an answer leaves its matchup with one side, so the matchup is dropped entirely.
  const victim = rows[0];
  room.toggleExclude(victim.matchupId, victim.sideId);
  check(room.reviewList().find(r => r.sideId === victim.sideId).excluded, 'an excluded answer is marked');
  room.toggleExclude(victim.matchupId, victim.sideId);
  check(!room.reviewList().find(r => r.sideId === victim.sideId).excluded, 'and can be put back');
  room.toggleExclude(victim.matchupId, victim.sideId);

  const before = room.matchups.length;
  room.startVotingFromReview();
  check(room.matchups.length === before - 1, 'a matchup left with one side is dropped, not shown alone');
  check(room.matchups.every(m => !m.sides.includes(victim.sideId)), 'the pulled answer is gone from the game');
  check(room.phase === 'voting', 'and the game moves to voting');
  room.destroy();
}
{
  // Pull everything: the round should end cleanly rather than hang.
  const room = roomAtReview(20, 5);
  for (const r of room.reviewList()) room.toggleExclude(r.matchupId, r.sideId);
  room.startVotingFromReview();
  check(room.phase === 'scores', 'pulling every answer ends the round instead of hanging');
  check(room.teamBoard().every(t => t.score === 0), 'and nobody scores from a round with nothing in it');
  room.destroy();
}

/* ---- flags and voiding ---- */
{
  const room = roomAtReview(20, 5);
  room.startVotingFromReview();
  const m = room.matchups[0];
  const voters = room._eligibleVoters(m);
  check(voters.length === 10, `the two teams on screen step aside, 10 others judge (${voters.length})`);
  check(voters.every(id => !m.sides.includes(room.players.get(id).teamId)), 'no judge is on a competing team');

  room.flagAnswer(voters[0], m.id, m.sides[0]);
  room.flagAnswer(voters[1], m.id, m.sides[0]);
  room.flagAnswer(voters[0], m.id, m.sides[0]);   // same person twice
  check(room.hostView().voting.answers.find(a => a.key === m.sides[0]).flags === 2,
    'reports are counted once per person and shown to the host');

  room.submitVote(voters[0], m.id, m.sides[0]);
  room.advance();                                  // close voting -> reveal
  const team = room.teams.get(m.sides[0]);
  check(team.score > 0, `points landed on the reveal (${team.score})`);
  room.voidMatchup();
  check(team.score === 0, 'voiding the matchup takes the points back off');
  check(room.list.every(p => (p.authoredPoints ?? 0) === 0), 'and the author loses the credit too');
  room.destroy();
}

/* ---- the grand final ---- */
{
  const room = new Room('FIN', {});
  for (let i = 0; i < 30; i++) room.join(`P${i + 1}`);
  room.settings = { ...room.settings, draftSeconds: 9999, pickSeconds: 9999, voteSeconds: 9999 };
  room.start({ mode: 'teams', teamSize: 5, totalRounds: 3, finalists: 4 });
  room.teams.get('t1').score = 500;   // rig the standings
  room.teams.get('t2').score = 400;
  room.teams.get('t3').score = 300;
  room.teams.get('t4').score = 200;
  room.round = 2;
  const finalMatchups = room._buildTeamMatchups(3);
  check(finalMatchups.length === 1, 'the grand final is a single matchup');
  check(finalMatchups[0].sides.length === 4, `between the top 4 teams (${finalMatchups[0].sides.length})`);
  check(finalMatchups[0].sides.join() === 't1,t2,t3,t4', 'and it is the top four by score');
  room.matchups = finalMatchups;
  const judges = room._eligibleVoters(finalMatchups[0]);
  check(judges.length === 10, `the other ${room.teams.size - 4} teams judge it (${judges.length} people)`);
  room.destroy();
}

console.log(fail.length ? `  FAILED (${fail.length}): ${fail.join('; ')}` : '  ALL CHECKS PASSED');
process.exit(fail.length ? 1 : 0);
