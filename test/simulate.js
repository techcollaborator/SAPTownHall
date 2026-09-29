/* A full game, start to finish, with N well-behaved bots. Usage: node test/simulate.js [players] */
import { startServer, startHost, joinBot, reporter, sleep, log } from './harness.js';

const N = Number(process.argv[2] ?? 4);
const PORT = 4000 + (N % 40);
const { check, finish } = reporter();

await startServer(PORT);
const host = await startHost(PORT);
check(/^[A-Z]{4}$/.test(host.code), `room code generated (${host.code})`);

const bots = [];
for (let i = 0; i < N; i++) {
  bots.push(await joinBot(PORT, host.code, `Bot${i + 1}`, {
    answer: item => `Bot${i + 1} on "${item.prompt.slice(0, 16)}"`,
    vote: choices => choices[Math.floor(Math.random() * choices.length)],
    pace: () => 30 + Math.random() * 120
  }));
}
await sleep(300);
check(host.state.players.length === N, `${N} players in the lobby`);

host.send({ t: 'host:start', settings: { mode: 'solo', writeSeconds: 20, finalWriteSeconds: 20, voteSeconds: 20, revealSeconds: 2, scoreSeconds: 2 } });
await host.waitFor(s => s.phase === 'final', 'the end of the game', 120_000);

log('');
check(['writing', 'voting', 'reveal', 'scores', 'final'].every(p => host.phases.has(p)), 'every phase occurred');
check(host.reveals.length === N * 2 + 1, `matchup count = ${N}+${N}+1 (got ${host.reveals.length})`);
check(bots.every(b => b.writeCounts[1] === 2 && b.writeCounts[2] === 2), 'each player wrote 2 answers in rounds 1 & 2');
check(bots.every(b => b.writeCounts[3] === 1), 'each player wrote 1 answer in the Last Lash');
check(host.reveals.at(-1).scored.length === N, 'the Last Lash pitted everyone against each other');
check(host.reveals.slice(0, N * 2).every(r => r.scored.length === 2), 'every earlier matchup was a straight duel');
check(host.reveals.every(r => r.totalVotes > 0), 'every matchup drew votes');
check(host.reveals.every(r => !r.scored.some(s => s.safety)), 'no safety quips needed (bots all answered)');
check(host.reveals.every(r => !r.scored.some(s => s.voters.includes(s.name))), 'nobody voted for their own answer');
check(host.reveals.every(r => r.scored.reduce((a, s) => a + s.votes, 0) === r.totalVotes), 'vote tallies add up');
check(host.reveals.every(r => r.scored.every(s => s.voters.length === s.votes)), 'each vote is attributed to a voter');

const prompts = host.reveals.map(r => r.prompt);
check(new Set(prompts).size === prompts.length, 'no prompt was used twice in one game');
const pairs = host.reveals.slice(0, N * 2).map(r => r.scored.map(s => s.name).sort().join('+'));
check(new Set(pairs).size >= Math.min(N, pairs.length - 1), 'matchups are varied rather than repeats');

const total = host.state.scoreboard.reduce((a, p) => a + p.score, 0);
const floor = N * 1000 + N * 2000 + 3000;
check(total >= floor, `points awarded (${total.toLocaleString()} ≥ ${floor.toLocaleString()})`);
check(host.state.scoreboard.every((p, i) => p.rank === i + 1), 'ranks numbered 1..n');
check(host.state.scoreboard.every((p, i, a) => i === 0 || a[i - 1].score >= p.score), 'scoreboard sorted high → low');

bots[0].conn.ws.close();
await sleep(300);
check(host.state.players.find(p => p.name === 'Bot1')?.connected === false, 'a dropout shows as away');

finish();
