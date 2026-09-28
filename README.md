# Quipsmash — a custom Quiplash clone

Write the funniest answer to a prompt. Everyone else votes. Points, podium, bragging rights.
One shared screen (TV or laptop), one phone per player. Runs entirely on your own wifi — no
accounts, no internet, no Jackbox subscription.

```bash
npm install
npm start
```

Then:

1. On the **TV or laptop**, open `http://localhost:3000/host` — you'll get a 4-letter room code and a QR code.
2. Everyone else points their **phone** at the address shown on screen (or scans the QR) and types the code.
3. Hit **Start the game** once 3+ people have joined.

## How a game plays

| Round | What happens | Points |
| --- | --- | --- |
| **Round 1** | Everyone gets 2 prompts. Each prompt goes to exactly 2 players, who don't know who they're up against. Everyone *not* in a matchup votes for the funnier answer. | up to 1,000 |
| **Round 2** | Same again, freshly shuffled so you face different opponents. | up to 2,000 |
| **Last Lash** | One prompt, everyone answers it, everyone votes (you can't vote for yourself). | up to 3,000 |

Points are split by vote share, so a 3–1 win pays better than a 2–2 squeak. Take **every** vote
in a matchup and you get a **QUIPSMASH** — a 25% bonus and a badge on the big screen.

Miss the timer and a "safety quip" gets submitted on your behalf. It will not be funny. That's the point.

## Custom prompts

Two ways, and you can use both at once:

- **`prompts.custom.json`** — edit the `prompts` array. Loaded when a room is created, so they're
  available in every game. Great for an in-joke pack you reuse.
- **The host screen** — open *Game options & custom prompts*, paste one prompt per line, hit
  **Save prompts**. Applies to that room only, no restart needed.

Write `<BLANK>` anywhere and it renders as a fill-in-the-blank slot on both screens:

```
Our team's actual motto is <BLANK>
```

Tick **Use only my custom prompts** to drop the built-in bank entirely — handy for a themed
night (work leaving-do, stag, family Christmas).

The built-in bank has 123 main prompts and 20 Last Lash prompts; prompts never repeat within a game.

## Host controls

- **Skip ▸** (top right) ends the current phase immediately — rescues you from someone who wandered off to the kitchen.
- Keyboard, for when the laptop is across the room: **space** starts the game / skips the current
  phase, **F** toggles fullscreen.
- **Game options** sets the timers (write / vote / reveal / scoreboard) and the number of rounds (1–3).
- Click the **×** on a player's name in the lobby to remove them.
- **Rematch** keeps the same players and resets scores; **Back to lobby** reopens joining.

## Playing on phones

- Players are 3–12. Answers are capped at 80 characters.
- Refreshing, locking your phone, or losing wifi is fine — you rejoin your same seat with your
  score intact (it's remembered per room in `localStorage`). The big screen dims anyone who's away.
- A dropout gets a 12-second grace period (`DROPOUT_GRACE_MS` in `src/game.js`) before the game
  stops waiting for them, so a brief wifi blip doesn't cost you your turn — and a half-typed
  answer is still there when you come back. After that the round moves on without them, and the
  phase timer caps the wait regardless.
- Lost the big screen (browser crash, wrong tab)? Reopen `/host?room=CODE` to reattach to the
  running game. Nothing is lost.

## Layout

```
server.js            HTTP + WebSocket server, static file serving, QR endpoint
src/game.js          the whole game: state machine, matchup pairing, scoring, timers
src/prompts.js       prompt banks + safety quips
src/rooms.js         room registry, codes, idle cleanup
public/host.html     the big screen
public/player.html   the phone controller
public/js/net.js     shared socket/DOM helpers
test/                see below
```

The server is authoritative: clients only ever send "here's my answer" / "here's my vote", and
every view is rendered from state the server pushes. Answers are never sent to a phone that could
use them to work out who wrote what, and authorship is only revealed at the reveal.

## Tests

```bash
npm run test:all       # everything below, in sequence (~8 min)
npm test               # a full 4-player game, headless, ~20s
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

`test:browser`, `test:reconnect` and `test:layout` need a Chromium-family browser at the path set
in `EDGE` at the top of those files (defaults to Microsoft Edge on macOS).

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
- Scoring is `_scoreMatchup` in the same file: `share × 1000 × roundMultiplier`, plus the 25% shutout bonus.
- With more than 6 answers on screen (a big-room Last Lash) the host screen switches to two or
  three columns and scales type down — see `columnProps` in `public/js/host.js`. Everything on the
  big screen is sized against viewport *height* as well as width, so a 720p TV doesn't clip.
- Round structure is the `ROUNDS` table at the top of `src/game.js` — add a 4th round or change a
  multiplier there and the pairing, points and UI follow.
