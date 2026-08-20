# Backlog

Features asked for, in the order they were raised. Each one records what it has
to do and the awkward part, so the work can be picked up without rediscovering
it. What is done stays here, struck through, when what it turned out to need is
worth remembering.

Nothing is outstanding. What follows is what was asked for and built.

---

## ~~The conjugations that were not there~~ (done)

Reported as `gradera`, refused although `grader` is accepted. It was not one
word: 7,118 forms were missing across 706 verbs the game already knew, with
`nourrir` short of its entire future. Then the verbs it had never had at all,
which came to 27,600 words more.

Two rules, one per half. Completing a verb the dictionary already accepts needs
no judgement, so it is done unattended. Adding a verb outright does, and the
judgement is delegated to a corpus: **has anyone actually used the word**, per
Lexique 3.83. Wiktionary conjugates 24,281 verbs the game lacked, and taking
them all would have added 772,000 words, tripling the dictionary with
`encyclopédier` and `concupiscer`.

The two remaining conditions take opposite quantifiers, and getting that wrong
put `enculer` at the top of the list. **Any** live sense keeps a verb, because
tags sit on senses and `cibler` is dated in one reading and current in another
(aggregating them threw out `zapper`, `cibler` and `zoomer`). But **no** sense
may be vulgar: a word with one coarse meaning is a coarse word.

Three traps, all found by looking rather than by reasoning:

- Lexique cannot see this gap. It knows `grader` only as a noun, so the
  reference had to be Wiktionary, the only one of the two carrying conjugation.
- Wiktionary *describes* French. It also holds pre-1835 spelling (`avoit`),
  regional forms (`mangeont`), jokes (`boivez`) and children's regularisations
  (`fontsaient`, glossed as such). All filtered; `rare` deliberately kept, since
  `gésir` is rare and correct.
- `\p{L}` let in `aboutißẽt`, and ß uppercases to SS, so it would have entered
  the dictionary as ABOUTISSET: real-looking, traceable, non-existent.

Then the same class of mistake twice over: the audit and the definitions builder
both built the dictionary from the bare npm package, ignoring `extra-words.txt`.
The definitions build therefore left every added word without a bundled
definition, so the words added because they were missing became the only ones
needing a network call. Hence `scripts/game-dictionary.mjs`, one helper for all
three scripts.

And the first pass silently skipped every pronominal verb in French, `enfuira`
included, because Wiktionary files those under `s’enfuir` and the apostrophe
failed the lookup without failing anything else. Nothing reported it; it was
found by probing a verb that ought to have been fixed and was not.

---

## ~~The modern words that were not there~~ (done)

Reported as `orc`, which is French. One word again, and one of a class again:
the base list has no `blog`, no `tofu`, no `selfie`; of 185 everyday modern
words probed, 93 were missing. The root cause is not a hole, it is a date. The
Letterpress list was archived in May 2019 and nothing maintains it, so patching
it word by word is patching a frozen list.

The first attempt did exactly that, 87 lemmas picked by hand, and measuring is
what killed it. Four automatic rules were tried over Wiktionary, each judged on
what it admits **first**: attested in Lexique (5,306 words, and the corpus
closed in 2001, so it has never met `orc` at all, and its `ortho` column carries
proper nouns and subtitle English that the verb pass never saw because it
filtered on `cgram == 'VER'`); five or more Wiktionary translations (7,445, and
the sample is `yttrotantalite`, `métazeunérite`, `décicandela`, translation
tables measuring editor activity and bots having been busy in mineralogy);
borrowed from English, aimed straight at the blind spot (3,445, and it admits
`fistball`, `nightcore`, `hyperscaler`); any translation or example at all
(88,704, worse of the same). Taking Wiktionary whole was measured on grids
rather than on lists: **128 words per 4x4 grid became 246**, the additions being
`kdo`, `tjs`, `orser`, `neocorat`.

The answer was not a better filter, it was a dictionary somebody maintains.
**Grammalecte**, MPL 2.0, the one Firefox and LibreOffice spell with, expanded
from its Hunspell affixes: 100,034 words the base list lacks, `orc` and `blog`
and `procrastiner` among them, and the same grid measurement gives **128 to
145**, the additions being `rosti`, `recap`, `crosne`, `durite`, `strudel`. The
ADR used to claim the base list *was* Dicollecte, a claim checked and found
wrong once; it is true now, by having been made true.

Four things fell out of it.

- **One flag family had to go.** `U.` is the SI unit prefix table: nineteen
  prefixes on every unit symbol, turning `sr` into `zsr` and `cal` into `dcal`.
  Generated rather than written, and the only real noise in 440,000 forms.
- **The conjugations had to move last.** Grammalecte has `hacker` as a noun and
  no verb; the old order would have accepted `hacker` and refused `hacke`,
  which is `gradera` again wearing a hat. The block that completes verbs now
  runs against the finished dictionary, whatever source each verb came from.
- **Two licences do not share a file.** MPL 2.0 is copyleft per file, CC BY-SA
  4.0 per work, and one file holding both asks a question with no good answer.
  `grammalecte-words.txt` and `extra-words.txt`, one source each, and the
  release publishes two assets.
- **The hand block prunes itself**, 175 words down to 33. A word stays only
  until a source covers it, so what is left is a record of what the
  dictionaries actually lack: `visio`, `ramen`, `wrap`, `covid`, `padel`.

`--write` was not idempotent either. It computed the generated blocks against a
dictionary that already contained its own output, so a second run found nothing
missing and swept all 34,725 generated words into the hand block. Every block is
now computed against the base list plus the blocks before it, and the files come
out byte-identical on a re-run.

Then the list turned out to be auditable in the other direction, which is what
a maintained reference buys. 1,139 base-list words are unknown to Grammalecte
*and* to the French Wiktionary in every language it describes, and they are not
rare vocabulary: `stratigraphiqu`, `tuberculinisatio`, `nourrirrai`,
`photoconductteur`, `préembalé`. 606 are struck, in the two shapes that cannot
be anything but an error: a conjugation of a verb nothing conjugates
(`blêmaient` is `blêmer`, which does not exist, not `blêmir`, which gives
`blêmissaient`), and a plural in `-aus` for `-aux`. Agreement is left alone on
purpose, since `frigorifiante` is correct French that no dictionary lists and
striking it would be `gradera` from the other side. Five invented infinitives
survive their own conjugations for the same reason, and the script names them
rather than guessing.

The bill came in at 15,000 words the Wiktionary does not define, which would
have taken the bundled definitions from 99.2% to 96.5%. Grammalecte knows the
lemma it built each form from, so a third pass in the definitions build places
10,394 of them: 2,793 borrow the lemma's definition, 7,601 say "Forme de …".
Coverage ends at 99.1%, better than it started. The 4,157 nothing can define go
into `words-without-definition.txt`, published with the release, on the grounds
that a gap you can read beats a percentage you cannot.

---

## ~~Version and release the generated dictionary~~ (done)

`definitions.tsv.gz` was 17.5 MB of a 17.9 MB repository: 7 MB of gzip, which
never delta-compresses, so every rebuild left a whole new copy in the history
for ever.

The two artefacts wanted opposite homes, so they got them. `extra-words.txt`
stays in git, being 425 KB of text that diffs and *is* the lexicon; it carries
its own version, date, word count and a SHA-256 of its contents.
`definitions.tsv.gz` becomes a release asset, built by
`.github/workflows/release.yml` on a tag, behind the rules tests and
`test:dict`. Only the newest is kept: the workflow strips the asset from older
releases, since it is reproducible and nothing reads an old one.

The trap was where to download it. Not the Dockerfile: `docker-compose.yml`
mounts `./server/data` over the image read-only, so a file baked into the image
is shadowed at runtime by the very directory it was meant to fill. It goes in
`deploy.sh`, before the build, which also puts it in the build context so the
Dockerfile's own fallback finds it already there.

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
everyone who cleared it, which meant a fast room produced nothing but Lièvres,
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
covered every player who had found anything: two rules that carried no
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
