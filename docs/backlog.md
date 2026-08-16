# Backlog

Features asked for, in the order they were raised. Each one records what it has
to do and the awkward part, so the work can be picked up without rediscovering
it. What is done stays here, struck through, when what it turned out to need is
worth remembering.

Nothing is outstanding. What follows is what was asked for and built.

---

## ~~The conjugations that were not there~~ (done)

Reported as `gradera`, refused although `grader` is accepted. It was not one
word: 7,118 forms were missing, across 706 verbs the game already knew, with
`nourrir` short of its entire future.

The rule that made the repair safe to apply unattended: **only verbs the
dictionary already accepts are completed**. It adds no vocabulary, takes no view
on what belongs in a family game, and cannot let a deliberately excluded verb
back in through its own conjugation.

Three traps, all found by looking rather than by reasoning:

- Lexique cannot see this gap. It knows `grader` only as a noun, so the
  reference had to be Wiktionary, the only one of the two carrying conjugation.
- Wiktionary *describes* French. It also holds pre-1835 spelling (`avoit`),
  regional forms (`mangeont`), jokes (`boivez`) and children's regularisations
  — `fontsaient`, glossed as such. All filtered; `rare` deliberately kept, since
  `gésir` is rare and correct.
- `\p{L}` let in `aboutißẽt`, and ß uppercases to SS, so it would have entered
  the dictionary as ABOUTISSET: real-looking, traceable, non-existent.

Then the same class of mistake twice over: the audit and the definitions builder
both built the dictionary from the bare npm package, ignoring `extra-words.txt`.
The definitions build therefore left every added word without a bundled
definition — the words added because they were missing became the only ones
needing a network call. Hence `scripts/game-dictionary.mjs`, one helper for all
three scripts.

And the first pass silently skipped every pronominal verb in French, `enfuira`
included, because Wiktionary files those under `s’enfuir` and the apostrophe
failed the lookup without failing anything else. Nothing reported it; it was
found by probing a verb that ought to have been fixed and was not.

---

## ~~Dice that do not all land the right way up~~ (done)

Four orientations, because a cube in a square cell has four, and a setting for
whoever wants the letters upright.

The throw is derived from the letters rather than sent: `dieOrientations(cells,
salt)` hashes the grid into a seed. Sending it would have meant threading an
array through `RoundState`, `RoundResults`, the stored room and the daily
record, four places to keep in step for something no rule depends on. Deriving
it also handed us reconnection for free.

The awkward part was not the rotation but `M`/`W` and `N`/`Z`, which become each
other when turned. They are underlined, and underlined *always*, since an
unmarked M would otherwise mean "this one is upright" and reading the grid would
turn into a chain of deductions. The mark had to be positioned by hand: a CSS
border sits at the font's descender, which on a turned die reads as a stray tick
beside the letter rather than the floor under it.

## ~~Awards at the end of a game, in the manner of TowerFall~~ (done)

Twelve of them, plus two so that nobody leaves empty-handed. A player keeps at
most three, ordered by what says most about them.

Each one goes to a single player. The first draft handed every threshold to
everyone who cleared it, which meant a fast room produced nothing but Lièvres —
a word that then told nobody apart. Every rule became "whoever did this most,
among those who did it enough at all", and the cap had to learn to pass an
award down to the next qualifier rather than drop it, or a dominant player would
win eight, keep three, and silently take five off everybody else.

Counters rather than a log: twenty numbers per player, bumped on submission and
folded in at the end of each round. `waitMs` and `waits` say "a word every
eleven seconds" as well as three hundred timestamps would, and they go to disk
with the room without any thought.

What nearly went wrong was the thresholds. "Found what nobody else did" at four
words in ten, and "thought like everybody else" at six in ten, between them
covered every player who had found anything — two rules that carried no
information at all. A unit test built around a deliberately unremarkable player
caught it: they came out a Fantôme. The bands were pulled apart to leave
ordinary play ordinary, which is what makes the rest mean something.

---

## ~~Shorten the trace shown when a word is accepted~~ (done)

380 ms down to 200, with the pulse from 260 ms to 170 and its scale from 1.035
to 1.02. Shortening alone would have made it a flicker, so the mark changed
too: a new `--tile-trace`, much paler than `--tile-active`, on the principle
that a weaker mark is understood faster and can therefore leave sooner.

The two reasons a path lights up had to be told apart, which the code did not
do before. The flick after a word is accepted is a confirmation and is now
faint; a path held under the cursor is being read and keeps the full mark.
Hence `faintHighlight` on `BoardGrid`, which a path being built overrides in
any case.

## ~~Choose, at the buzzer, between the solutions and playing on~~ (done)

The buzzer keeps the grid and offers two ways on: read the answers, or carry on
searching off the clock. Each player chooses for themselves.

The fear that the room phase would have to stop being a single value proved
unfounded. The server still ends the round for everyone at once, which is right,
since scoring must be simultaneous. Only the *view* is private, and a view is
client state.

Practice words are judged by the server against the finished round and recorded
nowhere. Keeping them out of the score was the easy part; keeping them out of
the *same list* mattered as much, since a shared list would have quietly
inflated a total that was already settled.

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

## ~~Save the room in progress, so a deploy does not end it~~ (done)

Written through `touch()`, which every mutation already called, so "something
changed" and "save it" became the same thing. Only what cannot be recomputed is
kept: each player's words are stored as words, and the grid is solved again on
the way back in to give them points and paths.

The clock was the delicate part, as expected. A round whose buzzer went while
the server was down closes on restore instead of resuming, and
`scripts/test-restart.mjs` proves it by moving the saved `endsAt` into the past
and starting the server again.

## ~~Identical nicknames in an ordinary game~~ (done)

Numbered on display rather than refused, in join order, with case and accents
folded for the comparison. Applied once where names become public, so the lobby,
the standings, the solutions and the daily leaderboard all get it.
