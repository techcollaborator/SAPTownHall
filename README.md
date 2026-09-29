# Quipsmash — a party game for SAP town halls

Write the funniest answer to a prompt. Your team picks its best line. The whole room votes.
Built for a practice town hall: **100 people in teams of 5 on one big screen**, with a host
moderation step so nothing reaches the projector unseen.

Runs on your own wifi, or deploy it (see below). No accounts, no Jackbox subscription.

```bash
npm install
npm start
```

1. On the **big screen**, open `http://localhost:3000/host` — you get a 4-letter room code and a QR code.
2. Everyone else opens the address on screen on their **phone**, or scans the QR, and types the code.
3. Hit **Start** once people are in. Teams are drawn automatically.

## Two modes

| | **Teams** (the default) | **Individuals** |
| --- | --- | --- |
| For | a town hall, 8–120 people | a small group, 3–12 |
| Each round | everyone writes an idea, their team picks one, teams go head to head | you're on your own |
| Host review | yes — every answer is checked before it goes up | no, it's a living room |

Switch between them in **Game options** on the host screen.

## How a team game plays

Each round runs in four beats. With 100 people at 5 a side that's 20 teams, so each round is
**10 matchups on 10 different prompts** — the room doesn't hear the same prompt ten times.

1. **Write** (50s) — everyone gets their team's prompt and writes one line.
2. **Team picks** (30s) — the team votes on its own shortlist, anonymously, so the funniest line
   wins rather than the loudest voice. The captain can lock it in early and breaks ties.
3. **Host review** — *the game pauses here.* You see all 20 answers with the team, the author and
   anything the filter flagged, and can pull any of them. Nothing is on screen yet.
4. **Vote** — matchup by matchup. Everyone except the two teams on screen votes. Points land, the
   leaderboard moves.

The last round is the **grand final**: the top 4 teams answer one prompt and the other 16 teams
are the judges. Each round is worth more than the last (round 1 ×1, round 2 ×2, and so on), so
the final is where it's won and it's still anyone's game going in.

Points are split by vote share, so a 40–10 win pays more than a 26–24 squeak. Take **every** vote
and that's a **clean sweep** — a 25% bonus and a badge on screen. At the end, alongside the team
podium, the individual whose lines earned the most points gets a **sharpest quip** award.

Timings are adjustable; the defaults put a 3-round, 100-person game at roughly 20 minutes.

## Keeping it safe for a town hall

Three layers, because a bad line on a projector in front of the whole practice is expensive:

1. **A filter** masks clear profanity and flags the answer. It's built to leave ordinary
   consulting language alone — `assignment`, `classification`, `parse`, `rehearsal`, `cockpit`,
   `S4HANA` and `INC0042` all pass untouched. Display names with profanity are refused at the door.
2. **The host review step**, above. The game will not move on until you approve, and flagged
   answers sort to the top of the list.
3. **A report button** on every answer while it's on screen. Reports show up live on the host
   screen with a **Pull this matchup** button that kills it and awards nobody any points.

There's no chat anywhere in the game, and authors stay hidden until the reveal.

Worth being clear about the limits: layer 1 is a word list, so it catches swearing and obvious
evasions (`f*ck`, `f4ck`, `sh1t`, spaced-out letters) and nothing else. It cannot judge a line
that is perfectly clean but aimed at a colleague, a customer, or a decision someone in the room
made. **The host review step is the real safeguard** — read the answers, not just the flags. Every
answer carries the author's name there, which tends to keep people sensible on its own.

## Prompts

The built-in bank is SAP-specific: **139 prompts** plus **30 grand-final prompts**, aimed at
systems, process and jargon rather than at any person, customer, or anything to do with pay,
reviews or headcount.

Sizing, so you know it's enough: 20 teams means 10 prompts a round. A 3-round game uses 21 and a
5-round game 41, so the bank covers several town halls without a repeat. Prompts never repeat
inside one game.

Add your own two ways, and you can use both:

- **`prompts.custom.json`** — edit the `prompts` array. Picked up when a room is created.
- **The host screen** — open *Game options & custom prompts*, paste one per line, **Save prompts**.
  Applies to that room only, no restart.

Write `<BLANK>` anywhere and it renders as a fill-in-the-blank slot:

```
Our team's real motto is <BLANK>
```

Tick **Use only my custom prompts** to drop the built-in bank — handy for a themed session.
`prompts.party.json` holds the original general-purpose pack if you want a non-work game.

## Rehearsing without 100 people

In **Game options**, **+20 / +50 / +100 bots** fills the room with fake players that write, vote
in their teams and judge matchups on their own. Run a full game by yourself to time the rounds
before the real thing.

## Host controls

- **Skip ▸** ends the current phase immediately — for when someone has wandered off to the kitchen.
- **Space** starts the game and skips phases; **F** toggles fullscreen. Handy from the back of a room.
- **Pull this matchup** during voting voids it: no points, straight to the next one.
- **Rematch** keeps everyone and redraws teams; **Back to lobby** reopens joining.
- Click the **×** on a name in the lobby to remove someone.
- Lost the big screen? Reopen `/host?room=CODE` to reattach to the running game.

## On phones

- Refreshing, locking your phone or losing wifi is fine — you keep your seat, your team and your
  score (remembered per room in `localStorage`).
- A dropout has 12 seconds of grace (`DROPOUT_GRACE_MS` in `src/game.js`) before the game stops
  waiting, so a brief blip doesn't cost your turn and a half-typed line is still there.
- Miss the timer and a placeholder is submitted for you. It is deliberately not funny.

## Layout

```
server.js            HTTP + WebSocket server, static files, QR endpoint
src/game.js          the whole game: teams, rounds, matchups, scoring, timers, bots
src/moderation.js    profanity filter and name screening
src/prompts.js       SAP prompt banks, safety placeholders, team names
src/rooms.js         room registry, codes, idle cleanup
public/host.html     the big screen
public/player.html   the phone
public/js/net.js     shared socket/DOM helpers
test/                see below
```

The server is authoritative. Phones only ever send "here's my line" / "here's my vote", and every
screen is drawn from state the server pushes. Phone payloads are deliberately small (~1–3KB) and
broadcasts are rate-limited, because a single matchup in a 100-person room draws ~90 votes.

## Tests

```bash
npm run test:all       # everything below, in sequence (~12 min)
npm test               # a full 4-player individual game, headless, ~20s
npm run test:teams     # a 100-person, 20-team game end to end, including the review gate
npm run test:townhall  # the same in a real browser, driven by the rehearsal bots
npm run test:moderation # the filter: catches evasions, leaves SAP vocabulary alone
npm run test:host      # host controls and team arithmetic (odd team counts, pulling answers)
npm run test:chaos     # silent players, a phone that dies mid-round, timeouts, a latecomer
npm run test:lobby     # real browser: join code, QR, and custom prompts end to end
npm run test:browser   # real browser: the reveal on screen must match the server exactly,
                       #   and no author's name may leak while voting is still open
npm run test:reconnect # real browser: phone loses wifi, comes back, then refreshes
npm run test:layout    # nothing overlaps or spills off screen — 3 TV sizes + a phone,
                       #   at every phase, with 3 / 4 / 8 / 12 players
npm run test:prompts   # prompt banks: no duplicates, nothing too long, <BLANK> slots present
npm run test:shots     # plays a game in a browser and saves screenshots to test/shots/
```

`test/harness.js` holds the shared plumbing: a server and headless browser that are always
killed on exit (even on a throw), a small Chrome-DevTools-Protocol client, and scriptable bot
players — `joinBot(port, code, name, { answer, vote, pace })`, where `answer` or `vote` can be
`false` to simulate someone who ignores their phone.

The browser suites (`test:browser`, `test:townhall`, `test:lobby`, `test:reconnect`, `test:layout`,
`test:shots`) need a Chromium-family browser. It defaults to Microsoft Edge on macOS; point
`QS_BROWSER` at any Chromium binary to change that:

```bash
QS_BROWSER="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run test:townhall
```

## Deploying (Vercel + Render)

Vercel can't hold WebSocket connections or keep a game in memory, so the deploy is split:

- **Render** runs `server.js`, which holds the rooms, the timers and the WebSockets (`render.yaml`).
- **Vercel** serves the pages in `public/` (`vercel.json`). At build time it writes the Render
  address into `public/js/config.js`, so the pages know where the game server is.

Both deploy from the same GitHub repo.

1. **Render first.** New → Blueprint → pick the repo. It reads `render.yaml` and creates
   `quipsmash-server`. Copy its URL, e.g. `https://quipsmash-server.onrender.com`.
2. **Then Vercel.** Add New → Project → import the repo. Before deploying, add the
   environment variable `QS_BACKEND_URL` = the Render URL (no trailing slash). Deploy.
3. Open `https://<your-app>.vercel.app/host` on the TV. Phones go to the address it shows.

Every push to `main` redeploys both. If you change the Render URL, update `QS_BACKEND_URL`
in Vercel and redeploy.

On Render's free plan the server goes to sleep after about 15 minutes idle. The first visit
after that takes around 30 seconds while it wakes; the host screen shows "reconnecting…" and
catches up on its own. Open `/host` a minute before people arrive. A restart or redeploy
ends any game in progress, because rooms live in memory.

## Notes and deliberate choices

- **Anyone who knows the room code can open the host screen** (`/host?room=CODE`) and skip phases
  or kick players. That's what makes recovering a crashed big screen painless; on a living-room
  wifi it's the right trade. Don't run this on a network you don't trust.
- Rooms live in memory only. Restarting the server ends any game in progress, and idle rooms are
  swept after 20 minutes.
- `window.__quipsmash` on either page exposes `{ send, drop, state, now }` for poking at a live
  game from devtools — `__quipsmash.drop()` fakes a dropped connection.

## Config

- `PORT` — defaults to 3000.
- Players on phones need to reach the machine running the server, so keep everyone on the same
  wifi. The host screen prints the exact address to use; it prefers your real wifi/ethernet
  address over VPN tunnels, but if you're on a VPN and phones can't connect, disconnect it.

## Tuning it for your group

- Timers live in `DEFAULT_SETTINGS` in `src/game.js` (and are overridable per game from the host screen).
- Scoring is `_scoreMatchup` in `src/game.js`: `share × 1000 × roundMultiplier`, plus the 25% sweep bonus.
- Team sizes, the number of finalists and every timer are host settings; their defaults are
  `DEFAULT_SETTINGS` in `src/game.js`.
- The word lists live in `src/moderation.js`. `BANNED` is matched whole-word, `SUBSTRING_ROOTS`
  anywhere inside a word, and `ALLOWLIST` vouches for words that merely contain one — add to the
  allowlist first if the filter ever flags something ordinary.
- With more than 6 answers on screen (a big-room Last Lash) the host screen switches to two or
  three columns and scales type down — see `columnProps` in `public/js/host.js`. Everything on the
  big screen is sized against viewport *height* as well as width, so a 720p TV doesn't clip.
- Round structure is the `ROUNDS` table at the top of `src/game.js` — add a 4th round or change a
  multiplier there and the pairing, points and UI follow.
