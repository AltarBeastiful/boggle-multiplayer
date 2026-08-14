# Backlog

Features asked for, in the order they were raised. Each one records what it has
to do and the awkward part, so the work can be picked up without rediscovering
it. What is done stays here, struck through, when what it turned out to need is
worth remembering.

## 1. Save the room in progress, so a deploy does not end it

Rooms live in the process ([ADR 0001](adr/0001-architecture.md), decision 3), so
every deploy cuts short whatever is being played. A round lasts three minutes
and a deploy takes seconds, which was the reasoning; it stops being true the
moment somebody is actually playing.

What has to survive is small: the room code, the settings, the players with
their scores and their words, and the current round with its board and its
`endsAt`. The solution map does not, since solving a grid again takes one or two
milliseconds.

The awkward part is the clock. A round saved with three seconds left and
restored forty seconds later has to end at once rather than resume, so the
restore has to compare `endsAt` with the present and close the round when it has
passed. Same for the pre-round countdown. An untimed round has no such question,
having no `endsAt` at all.

`server/src/store.ts` already does the writing, atomically and coalesced, for
the grille du jour. This needs the same treatment applied to a much larger
object, and a decision on when to write: on every accepted word is the honest
answer, since that is what a player would hate to lose.

## 2. Shorten the trace shown when a word is accepted

The trace still holds the eye too long. Today it is `TRACE_DURATION_MS = 380` in
`client/src/lib/config.ts`, with a 260 ms `boggle-trace` pulse in `index.css`,
and the tiles carry the full `--tile-active` fill for the whole time.

Shortening the delay alone would make it read as a flicker. The style is the
part to change: a fainter fill, or an outline rather than a fill, would let the
same information land in less time, because a weaker mark needs less time to be
understood and less time to fade. Worth trying at around 220 ms with a lighter
tile.

To be judged on the real thing, several words in a row: the question is not
whether one trace looks good but whether the grid is neutral again by the time
the next word is typed.

---

## ~~Choose, at the buzzer, between the solutions and playing on~~ (done)

The buzzer no longer takes the grid away: it is replaced by a "Voir les
solutions" button, and each player leaves when they choose.

The fear that the room phase would have to stop being a single value proved
unfounded. The server still ends the round for everyone at once, which is right,
since scoring must be simultaneous. Only the *view* is private, and a view is
client state. One `useState` in `App` did it.

## ~~An untimed mode, ended by the host~~ (done)

`roundSeconds: null` rather than a very large number, so "there is no clock"
cannot be read as "the clock is long", and the type checker points at every
place that has to handle it. `endsAt` is null to match, and no timer is armed.

## ~~"Grille du jour" on the home page~~ (done)

The grid is derived from the date and never stored: `dailySeed(day)` feeds the
generator, so any server rebuilds the same grid for the same day, and a restart
costs nothing. The day turns over at midnight in Paris, which is the point of
`DAILY_TIME_ZONE`: midnight UTC falls at one or two in the morning where the
players are.

The rules are fixed rather than the host's to choose, because a leaderboard
across players only means something if they played the same game.

## ~~A leaderboard on the "grille du jour"~~ (done)

This was the first thing in the project that had to outlive the process, and it
brought `server/src/store.ts`: one JSON file per day, written atomically and
coalesced. What is saved is only the words found, never the score: points and
paths are recomputed from the grid, so a saved day cannot preserve a stale
score.

Only finished attempts are ranked. Ranking a grid still being played would let
anyone sit at the top of the day with a score they had not stopped improving.
Ties on score are broken by time, which is what gives the informative clock a
purpose.

## ~~Identical nicknames in an ordinary game~~ (done)

Numbered on display rather than refused, in join order, with case and accents
folded for the comparison. Applied once where names become public, so the lobby,
the standings, the solutions and the daily leaderboard all get it.
