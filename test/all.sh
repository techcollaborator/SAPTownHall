#!/bin/zsh
# Runs every check in sequence. Takes about 8 minutes; the browser ones are the slow part.
cd "$(dirname "$0")/.."
fails=0
run() {
  local label=$1; shift
  print ""
  print "════ $label ════"
  local t0=$SECONDS
  if "$@"; then
    print "  (${$((SECONDS - t0))}s)"
  else
    fails=$((fails + 1))
    print "  ^^ FAILED after $((SECONDS - t0))s"
  fi
}

run "prompt banks"                    node test/prompts.js
run "moderation filter"               node test/moderation.js
run "host controls and team maths"    node test/hostcontrols.js
run "team game \u00b7 100 players"         node test/teams.js 100 5
run "team game \u00b7 12 players"          node test/teams.js 12 3
run "full game · 3 players"           node test/simulate.js 3
run "full game · 4 players"           node test/simulate.js 4
run "full game · 8 players"           node test/simulate.js 8
run "full game · 12 players"          node test/simulate.js 12
run "chaos · dropouts and silence"    node test/stress.js
run "browser · lobby and custom prompts" node test/lobby.js
run "browser · screen matches server" node test/dom-check.js
run "browser · reconnect and refresh" node test/reconnect.js
run "layout · 3 players"              node test/layout.js 3
run "layout · 4 players"              node test/layout.js 4
run "layout · 8 players"              node test/layout.js 8
run "layout · 12 players"             node test/layout.js 12

print ""
print "════════════════════════════════════"
if [[ $fails -eq 0 ]]; then print "  EVERYTHING PASSED"; else print "  $fails SUITE(S) FAILED"; fi
exit $fails
