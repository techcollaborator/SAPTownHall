/* The awkward-reality test: someone pockets their phone, someone's battery dies mid-round,
   someone writes but never votes, and a latecomer tries to barge in. Nothing may hang. */
import { startServer, startHost, joinBot, reporter, sleep, log, connect } from './harness.js';

const PORT = 4111;
const { check, finish } = reporter();

await startServer(PORT);
const host = await startHost(PORT);

/* Four very different party guests. */
const keen   = await joinBot(PORT, host.code, 'Keen');
const silent = await joinBot(PORT, host.code, 'Silent', { answer: false, vote: false });
const lurker = await joinBot(PORT, host.code, 'Lurker', { vote: false });
let dropped = false;
const flaky  = await joinBot(PORT, host.code, 'Flaky', {
  onState: (s, bot) => {
    if (dropped || s.round !== 1 || s.phase !== 'writing') return;
    dropped = true;
    setTimeout(async () => {
      bot.conn.ws.close();            // battery dies
      await sleep(500);
      await bot.rejoin();             // and they plug it in
      bot.cameBack = true;
    }, 300);
  }
});
await sleep(400);
check(host.state.players.length === 4, '4 players joined');

host.send({ t: 'host:start', settings: { mode: 'solo', writeSeconds: 10, finalWriteSeconds: 10, voteSeconds: 5, revealSeconds: 2, scoreSeconds: 2 } });
await host.waitFor(s => s.phase === 'final', 'the game to finish despite the chaos', 240_000);

log('');
check(host.reveals.length === 4 + 4 + 1, `all 9 matchups resolved (got ${host.reveals.length})`);
check(host.reveals.some(r => r.scored.some(s => s.safety)), 'the silent player got auto-filled safety quips');
check(host.reveals.every(r => r.scored.every(s => s.text.length > 0)), 'no blank answer was ever shown');
check(flaky.cameBack && host.state.players.find(p => p.name === 'Flaky')?.connected === true,
  'the dropped player rejoined on their token and kept their seat');
check(host.state.players.length === 4, 'nobody was lost from the roster');
check(host.state.scoreboard.every(p => Number.isFinite(p.score) && p.score >= 0), 'all scores are sane numbers');
check(host.reveals.every(r => r.scored.reduce((a, s) => a + s.votes, 0) === r.totalVotes), 'vote tallies add up');
check(host.state.scoreboard.reduce((a, p) => a + p.score, 0) > 0, 'points still got awarded with half the room idle');

// Only Keen and Flaky ever cast a vote, so no one else may appear as a voter.
const allVoters = host.reveals.flatMap(r => r.scored.flatMap(s => s.voters));
check(allVoters.length > 0, `votes were recorded (${allVoters.length})`);
check(!allVoters.includes('Lurker'), 'the player who never voted is never credited with a vote');
check(!allVoters.includes('Silent'), 'the player who ignored their phone never voted either');
check(allVoters.every(v => v === 'Keen' || v === 'Flaky'), 'every recorded vote came from someone who actually voted');

/* Rules that must hold whatever a client sends */
const late = await connect(PORT, () => {});
late.send({ t: 'player:join', code: host.code, name: 'Latecomer' });
await sleep(250);
check(host.state.players.length === 4, 'joining mid-game is refused');

const rogue = await connect(PORT, () => {});
rogue.send({ t: 'host:advance' });
rogue.send({ t: 'host:lobby' });
rogue.send({ t: 'vote', matchupId: 'nope', targetId: 'nope' });
rogue.send({ t: 'answer', matchupId: 'nope', text: 'x' });
rogue.send({ t: 'nonsense' });
rogue.ws.send('not even json');
await sleep(300);
check(host.state.phase === 'final', 'a client with no role cannot drive the game');

host.send({ t: 'host:lobby' });
await sleep(250);
check(host.state.phase === 'lobby' && host.state.scoreboard.every(p => p.score === 0), 'back-to-lobby resets scores');

host.send({ t: 'host:start', settings: { mode: 'solo',} });
await sleep(300);
check(host.state.phase === 'writing' && host.state.round === 1, 'a rematch starts cleanly from the lobby');

finish();
