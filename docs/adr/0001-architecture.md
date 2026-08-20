# ADR 0001: architecture of the multiplayer Boggle

- **Status**: accepted, in production
- **Date**: 14 August 2026
- **Scope**: rules engine, real-time server, client, deployment, definitions

---

## Context

Playing Boggle together, remotely, with no account and nothing to install. The
rules are authoritative: those of
[boggle.fr/regles.php](https://www.boggle.fr/regles.php) and the variants of
[boggle.fr/variantes.php](https://www.boggle.fr/variantes.php).

Target scale: a few players per room, a few rooms at a time, on a personal
server. That framing justifies most of the decisions below. It would not justify
the same ones at the scale of a public service.

---

## Decision 1: a TypeScript monorepo with a shared rules engine

`packages/shared` holds the grid, adjacency, path finding, the scoring tables,
the solver and the dictionary. No input or output, no dependency on the network.
Both `server` and `client` depend on it.

**Why.** The rules are the subtle part (the Q=QU variant, accents, duplicates)
and the only part worth testing seriously. Isolated, they can be tested without
a server or a browser: 26 unit tests cover both scoring tables, path finding,
normalisation and grid drawing.

**Consequences.** Client and server cannot drift apart on a rule. In exchange,
`shared` must be compiled before the other two, hence the `predev` script at the
root and the `tsc --watch` in development.

**Rejected.** Two languages, Go on the server and TypeScript on the client: the
engine would have had to be written twice, or allowed to diverge.

---

## Decision 2: the server is authoritative, the client shows nothing it has not confirmed

The server draws the grid, holds the clock and validates every word. The client
submits and waits for the acknowledgement.

**Why.** Otherwise the grid and the dictionary live in the browser, and anyone
can read the solutions from the console. The game loses its point.

**A welcome consequence.** At the start of a round the server solves the whole
grid, in 1 to 2 ms as measured, and keeps the result. Validating a word becomes
a `Map` lookup, which is what allows telling *not in the dictionary* from *not
traceable on the grid*, and listing the solutions at the end of a round with no
extra work.

**An awkward consequence.** Every word costs a round trip. Offset by a 700 ms
tolerance after the buzzer, so a word sent in time still counts.

---

## Decision 3: state lives in memory, saved to plain files, with no database

A `Map` of rooms inside the process. Empty rooms are swept after 30 minutes.

**Why no database.** It would have meant one more container, migrations and
backups, for a few kilobytes that stop mattering an hour later. JSON files
written atomically cover what is actually needed.

**Amended.** "A restart interrupts games in progress" was accepted here on the
grounds that deploying takes seconds and games last minutes. That reasoning held
until somebody was actually playing during a deploy, at which point it was
plainly wrong. Rooms are now written to disk on every change, through the same
store as the grille du jour (decision 11), and picked up again at startup.

The room stays in memory and stays the authority; the file is a copy, holding
only what cannot be recomputed. Each player's words are saved as words: the
grid's solution is solved again on the way back in, and points and paths come
from that, so a restored room cannot carry a score its own grid no longer
supports.

The clock was the delicate part. A round saved with three seconds left and
restored a minute later ends at once rather than resuming, so the restore
compares `endsAt` with the present before arming anything. A room nobody comes
back to still expires, and its half hour counts the time the server was down.

Running several instances would still need the Redis adapter for Socket.IO and
shared room storage, see "Known limits".

**Player identity.** A random identifier kept in `localStorage`. A network drop,
a locked screen or a page refresh give the player back their words and their
score. That is what makes accounts unnecessary.

---

## Decision 4: Socket.IO rather than raw WebSockets

**Why.** Automatic reconnection, rooms, acknowledgements. On a phone the screen
locks in the middle of a three-minute round, so reconnection is not an edge
case, it is the common case.

**Rejected.** Raw `ws`: reconnection and acknowledgements would have had to be
rewritten, which is most of what Socket.IO brings.

---

## Decision 5: a permissive dictionary, adjustable without rebuilding

`an-array-of-french-words` (MIT): 336,000 raw forms, 318,800 after
normalisation, 437,770 once Grammalecte and the missing conjugations are merged
in, and 437,164 once the 606 words the list made up are struck off (below).
Hyphenated and apostrophised entries are dropped, as they cannot be traced
anyway.

**Where it really comes from.** This ADR said "the Dicollecte/Grammalecte
lexicon" until the claim was checked and found to be wrong. The package's own
README says it is derived from the [Letterpress word
lists](https://github.com/lorenbrichter/Words) (CC0), whose author describes
them as "loosely based on a collection of other word lists with refinements from
real-world feedback". That repository was archived in May 2019.

So this is **a word list for a game, not a lexicon**, and there is no editorial
authority behind it to appeal to. The distinction matters when a player asks why
a word was refused.

**What it costs, measured.** `scripts/audit-dictionary.mjs` compares it with
Lexique 3.83, weighted by real usage, and with the French Wiktionary. Of the 655
most frequent French forms, **none** is missing; of the next band, 0.4%. The
gaps are abbreviations (`labo`, `appart`, `psy`), anglicisms (`deal`, `fans`),
a few interjections, and the long tail of rare words (13.6%). Everyday play is
unaffected, which is why the list stays.

**Why permissive.** An explicit request: `déci`, `zut`, `eus`, `ait` and
`mangeassions` are all accepted. A Scrabble lexicon (ODS) would be stricter and
more "correct" in tournament play, but it is under copyright.

**Adjustment.** `server/data/extra-words.txt` and `excluded-words.txt` are read
at startup. Fixing an omission needs neither a rebuild nor a release, which is
the answer to the gaps above: fill them as they are met.

**The conjugations, filled in.** The most damaging form of "word list, not
lexicon" was the verbs: `grader` accepted and `gradera` refused, `nourrir`
accepted and none of its future. A player who knows their conjugation was
punished for knowing it. `scripts/build-lexicon.mjs` measures the gap against
Wiktionary and writes the missing forms out: 9,623 of them across 8,706 verbs,
taking coverage from 97.1% to 100%.

That pass runs **last**, after every other source has had its say, because it
is the one rule that has to see the finished dictionary. A verb arriving from
Grammalecte or from the hand block would otherwise land without its tenses,
which is `gradera` again under a new name.

Three things make it safe to run unattended:

- **Only verbs already accepted are completed.** No vocabulary is added, no
  view is taken on what belongs in a family game, and a verb deliberately left
  out cannot come back in through its own conjugation.
- **Wiktionary describes French, it does not prescribe it.** It also records
  pre-1835 spelling (`avoit`), regional forms (`mangeont`), contractions
  (`tsé`), forms coined as jokes (`boivez`) and children's regularisations.
  `fontsaient` is glossed "régularisation de *faisaient* à partir du présent
  *font*". All are filtered out by tag, label and gloss. `rare` is deliberately
  kept: `gésir` is rare and correct.
- **Only the modern French alphabet.** `\p{L}` was too generous: Wiktionary
  carries `aboutißẽt` under the French heading, and the eszett uppercases to
  SS, so normalising it yields ABOUTISSET: a word that looks real, is entirely
  traceable on a grid, and does not exist. One of those makes the dictionary
  worse than the hole it was filling.

Lexique cannot see this gap at all: it knows `grader` only as a noun. And the
first pass silently skipped every pronominal verb in French, `enfuira` included,
because Wiktionary files those under `s’enfuir` and the apostrophe failed the
lookup without failing anything else.

**The verbs that were missing outright.** Completing known verbs left the ones
the list had never had. Wiktionary conjugates 24,281 of those, and taking them
all would have added **772,000 words**, nearly tripling the dictionary with
`encyclopédier`, `plager`, `idéer`, `concupiscer`: real Wiktionary entries, and
nonce coinages all the same. Every grid would have filled with words no player
could be expected to know, which is a worse failure than the one being fixed.

The test used instead is **attestation in a corpus**: has the verb actually
been met in French films and books, per Lexique 3.83? That is what "does it make
sense in French" means once it has to be decided by a program rather than
argued, and it cuts 24,281 candidates to 746: `zapper`, `télécharger`,
`réécrire`, `menotter`, `rembobiner`, `crasher`, `cibler`.

Two further conditions, and they take **opposite quantifiers**, which is the
part that was got wrong first. Tags sit on senses, not on words: `cibler` is
`dated` in its military sense and current in its ordinary one. So **any** live
sense keeps a verb (one live reading is enough, and aggregating the tags threw
out `zapper`, `cibler` and `zoomer`), while **no** sense may be `vulgar` or
`offensive` (a word with one coarse meaning is a coarse word, and reading it as
"any clean sense" put `enculer` at the top of the list). Refusing the coarse
ones is a decision about the source list rather than about the language: it has
no `encule`, no `niquer`, no `pede`, so somebody already made that call, and
re-adding them would quietly overrule it in a game meant for a family. Register
is not a reason to refuse: `zyeuter` and `chourer` are familiar and slang and
entirely French.

**A known limit of the corpus test.** Lexique 3.83 is a fixed corpus, so a verb
that became common after it was compiled is refused: `procrastiner` is missing
for that reason alone. The alternative was an opinion, and an opinion does not
scale to 24,281 candidates.

**A second dictionary, because the base list is frozen.** The same gap was
reported from the other side: `orc` refused, and a player saying it looks
French. It is, and it is one of a class, since the base list has no `blog`, no
`tofu`, no `selfie` and no `covoiturage` either. Of 185 everyday modern words
probed, 93 were missing. The Letterpress list was archived in May 2019 and
nothing has maintained it since; no amount of patching a frozen list fixes a
frozen list.

The first attempt was to pick the missing words by hand, and measuring showed
why that could not be the answer. Four automatic rules were tried over
Wiktionary and each was judged on what it admits **first**, not on how many
words it admits:

| Rule | Admits | What the sample looks like |
| --- | --- | --- |
| Attested in Lexique | 5,306 | `poquette`, `pastophore`, plus proper nouns (`Ève`) and subtitle English (`team`, `clean`) |
| 5 or more translations | 7,445 | `yttrotantalite`, `métazeunérite`, `décicandela`, `nanonewton` |
| Borrowed from English | 3,445 | `fistball`, `nightcore`, `foodpairing`, `hyperscaler` |
| Any translation or example | 88,704 | the same, and more of it |

Wiktionary's translation tables measure editor activity, not currency, and bots
have filled in mineralogy and metrology. Lexique's `ortho` column carries proper
nouns and untranslated subtitle English, which the verb pass never saw because
it filtered on `cgram == 'VER'`. Every ranking puts `attoweber` thousands of
places above `orc`. Taking Wiktionary whole was measured too, on grids rather
than on lists: **128 words per 4x4 grid became 246**, and the additions were
`kdo`, `tjs`, `orser`, `neocorat`.

So the answer is not a filter over Wiktionary, it is **a dictionary that is
maintained**: [Grammalecte](https://grammalecte.net/), the orthographic
dictionary Firefox and LibreOffice spell with, MPL 2.0, "classique" v7.5,
shipped in the `dictionary-fr` package. Its Hunspell affixes are expanded to
every inflected form and the 100,034 the base list lacks are kept. It has `orc`,
`blog`, `tofu`, `selfie`, `covoiturage`, `procrastiner`. The same grid
measurement: **128 words per grid become 145**, and the additions are `rosti`,
`recap`, `crosne`, `taco`, `durite`, `strudel`, `aitre`, `gaite`.

Note the earlier claim in this decision, that the base list *was* Dicollecte,
which was checked and found wrong. It is now true, by having been made true.

One flag family is dropped in the expansion: `U.`, the SI unit prefixes, which
apply nineteen prefixes to every unit symbol and turn `sr` into `zsr`, `dsr`,
and `cal` into `dcal`. Generated by rule rather than written by anybody, and the
only real noise in 440,000 forms. The elision flags go too, their apostrophes
being untraceable on a grid.

Grammalecte does not replace the Wiktionary work: it covers only 44% of the
conjugations block 3 supplies and half of the verbs, because the two disagree
on the 1990 reform spellings and both are right. It is a source alongside, not
instead.

**Two files, because two licences.** Grammalecte is MPL 2.0, copyleft per
*file*; Wiktionary and Lexique are CC BY-SA 4.0, copyleft per *work*. Merging
both word lists into one file asks which licence the result carries, and there
is no comfortable answer. `grammalecte-words.txt` and `extra-words.txt` keep one
source each, and the release publishes two assets rather than one. It also
happens to document where every word came from.

**What it costs, and what pays it back.** The Wiktionary has no entry for 15,000
of the words Grammalecte contributes, mostly conjugations of rare verbs, which
would have taken the bundled definitions from 99.2% of the dictionary down to
96.5%. Grammalecte knows the lemma it built each form from, though, having built
it, so `scripts/grammalecte.mjs` hands that map to the definitions build and a
third pass places 10,394 of them: 2,793 borrow their lemma's definition, and
7,601 say "Forme de …", which is the shape Wiktionary's own form-of entries take
anyway. Coverage ends at **99.1%**, better than before the change.

The 4,157 left are written to `words-without-definition.txt` and published with
the release, so what is missing is a list somebody can read rather than a
percentage in a build log.

The hand block, which was 175 words, is now 33: the script drops a hand-picked
word once a source covers it, so what remains is a record of what the
dictionaries genuinely lack.

**And the list can now be audited, which is what found the 606.** Having a
maintained dictionary to compare against turns "this word has no definition"
into a usable signal. 1,139 base-list words are unknown to Grammalecte *and* to
the French Wiktionary in every one of the languages it describes: not rare
vocabulary, but `stratigraphiqu`, `tuberculinisatio`, `nourrirrai`,
`photoconductteur`. The Letterpress list has decayed and nothing has maintained
it since 2019.

Only 606 are struck, and only two shapes, because only two cannot be anything
but an error: a conjugation of a verb nothing conjugates (`blêmaient` belongs to
`blêmer`, which does not exist; `blêmir` gives `blêmissaient`), and a plural in
`-aus` where French writes `-aux`. **Agreement is deliberately left alone.**
`frigorifiante` is the regular feminine of a participle used as an adjective,
correct French that no dictionary bothers to list, and refusing it would be
`gradera` over again from the other side. The 533 that are neither shape need
reading, not a rule.

Five infinitives are left behind by that restraint (`caséfier`, `conpresser`,
`désingulariser`, `dessuiter`, `étaliser`): invented verbs whose conjugations
are struck while the infinitive stays, since an infinitive matches neither
shape. The script reports them by name rather than acting on them, because the
rule that is safe to run unattended is the rule that only strikes what it can
prove.

`scripts/game-dictionary.mjs` exists because of the same class of mistake: the
audit and the definitions builder each built the dictionary from the bare npm
package, ignoring the adjustment files. The definitions build therefore left
every added word without a bundled definition, so the words added precisely
because they were missing became the only ones needing a live Wiktionary call.
One helper, used by all three scripts and mirroring `server/src/dictionary.ts`.

`npm run test:dict` checks the result offline in a second, so a lost or
mis-generated file is caught without a browser or a network.

---

## Decision 6: grids are drawn without replacement from a bag of 96 faces

Hasbro does not publish the dice faces of the French edition and no reliable
source gives them. Rather than invent an "official" set, the bag follows French
letter frequencies (14 `E`, 7 `A`, a single `Z`), and the grid is drawn from it
without replacement.

**Why.** Drawing without replacement reproduces the property that matters: three
`Z` tiles are impossible, and vowels stay in proportion. Drawing each letter
independently guarantees neither.

**Quality check.** Every grid is solved before being served; below 40 words on
4x4, or 120 on 5x5, it is drawn again. In practice a 4x4 grid holds about a
hundred.

**Honesty.** This is a model, not the official dice. The README says so.

---

## Decision 7: duplicate cancellation by default

The boggle.fr pages say nothing about a word found by several players. The
default mode applies the classic Boggle rule: the word scores for nobody. The
other mode stays available.

**Consequence for the interface.** Scores cannot be shown during the round,
since a word is only worth its points if nobody else found it. Only each
player's word count is displayed, with the points at the reveal.

---

## Decision 8: typing is the primary input

Words are typed rather than drawn with a finger. The field is usable on a phone:
`font-size: 16px` to avoid Safari's zoom, `enterKeyHint`, `autocapitalize`.

**Why.** It is markedly faster, and it is what boggle.fr does. Building a word on
the grid by tapping or dragging came later, as a complement rather than a
replacement.

---

## Decision 9: the server stamps the start of the round

The grid is sent blurred along with a `startsAt`. Words submitted earlier are
refused.

**Why.** Without it, the player whose grid arrives 200 ms sooner starts 200 ms
sooner. The two-second countdown absorbs the latency: everyone sees the letters
at the same instant.

---

## Decision 10: the round ends for everyone, the solutions open one player at a time

The buzzer scores the round for the whole room at once, and has to: duplicate
cancellation compares what every player found, so it cannot be settled player by
player. But the buzzer no longer takes the grid away. The letters stay, and a
"Voir les solutions" button replaces the input field.

**Why.** The moment you most want to look at the grid is the moment you stop
being able to play it. Dropping straight into the answers takes that away.

**Two ways on, neither of them the default.** Reading the answers ends the
grid; "continuer à chercher" keeps it, off the clock, which is how a grid that
beat you gets finished. Words tried then are judged against the same grid, with
the same distinction between one that is not in the dictionary and one that is
not traceable, and they **count for nothing**: the round is scored and the
standings are settled, so re-opening either afterwards would make them a moving
target. They are listed apart for the same reason. The server records none of
it, practice being nobody's business but the player's.

**Where the state lives.** The room keeps a single `phase`, decided by the
server. Which screen a player is on, and whether they are still searching, is
client state. That distinction is the whole design: scoring is shared, reading
and practising are private, and the game carries on around them: the host can
start the next round while somebody is still on the old grid.

**An untimed round** (`roundSeconds: null`) has no buzzer at all, so the host
closes it with the same button, for everyone. Null rather than a very large
number, so "there is no clock" cannot be read as "the clock is long", and the
type checker points at every place that has to handle it.

---

## Decision 11: the grille du jour is derived from the date, and only its scores are stored

One grid a day, the same for everyone, played alone. The grid is **not stored**:
`dailySeed(day)` seeds the generator, so any server rebuilds the same grid for
the same day, and a restart or a second instance costs nothing.

**The day turns over at midnight in Paris.** Midnight UTC falls at one or two in
the morning where the players are, which would change the grid in the middle of
an evening.

**Its rules are fixed** (4x4, three letters, classic scoring), not the host's to
choose: a leaderboard across players only means something if they played the
same game.

**What is written down is the words found, not the score.** Points and paths are
recomputed from the grid at load time, so a saved day cannot preserve a score
that the rules no longer support. Only finished attempts are ranked; ranking one
still in progress would let a player sit at the top of the day with a score they
had not stopped improving. Ties break on time, which is what gives the
informative clock a purpose.

**Storage, against decision 3.** Rooms stay in memory: a game is worth nothing
an hour later. A daily leaderboard is the opposite, being the one thing here
meant to be read tomorrow, so `server/src/store.ts` writes one JSON file per
day, atomically and coalesced. A few kilobytes a day did not justify a database.
In production the directory is a mounted volume, since the container is rebuilt
on every deploy.

**Known limit.** The player identifier comes from `localStorage`, exactly as it
does for a room, and is not proof of anything: a determined player can enter the
leaderboard twice under two names. What the server does not trust is the words,
every one being checked against the day's grid, so a score cannot be invented,
only misattributed. That is the right trade at the scale of a server among
friends, and the wrong one for a public ranking.

---

## Decision 12: light and dark themes through semantic tokens

Components name roles (`bg-panel`, `text-fg-muted`), never colours
(`bg-slate-800`). The tokens are redefined per theme. The theme is set on
`<html>` before the first paint, by an inline script in `index.html`.

**Why tokens.** Two consistent themes without doubling every class.

**Why the inline script.** Without it the page paints light then switches to
dark: a flash on every load.

**Verification.** A contrast audit revealed three pairs below the AA threshold
(`--fg-faint` at 3.36:1 in light, `--accent`, `--ok`). Fixed; every text and
background pair now passes AA.

---

## Decision 13: published by Traefik, Let's Encrypt certificate, sslip.io domain

The stack carries its own Traefik: 80 redirects to 443, certificate obtained by
the TLS-ALPN challenge on 443. No other port needed opening.

**The domain.** There was none. `sslip.io` resolves any IP address with no
registration: `boggle-multiplayer.158-101-170-36.sslip.io`. It is a real domain
name, which is all Let's Encrypt needs to issue a trusted certificate, and it
follows the address, so moving servers is one line of `.env`.

**Self-contained.** The stack depends on no existing container, which is what
made the move cheap. The first machine, whose WordPress installation had been
stopped without deleting any data, stopped answering at all; the game now runs
on the server that carries the music library, on the two ports nothing there was
listening on.

**The game is published on the loopback only** (`127.0.0.1:3001`); all public
access goes through Traefik.

---

## Decision 14: bundled definitions, Wiktionary as fallback (options C then B)

`GET /api/definition/:word` first consults a file shipped with the image
(7 MB compressed, 349,200 words, 99.2% of the dictionary), and only falls back
to the live lookup for missing words, or if the file is absent, in which case
the game behaves exactly as before.

The file is built by `scripts/build-definitions.mjs` from the wiktextract
extraction of Wiktionary; see
[the option C plan](../plan-option-c-embedded-definitions.md).
**The bundled content is CC BY-SA 4.0**: publishing it is redistribution, where
merely querying committed us to nothing. See `server/data/LICENCE-DEFINITIONS.md`.

The fallback path is the one described below, and keeps its point: it covers
words missing from the artefact without waiting for a rebuild.

### Searched where it lies, rather than loaded

Reading the file meant turning 81 MB of TSV into a Map of 433,018 words, and
that Map holds 383 MB of JavaScript heap. It fits on a laptop and not on the
682 MB server the game later moved to: V8 sizes its heap from the machine, gave
itself 338 MB, and the process died on the first lookup, which the healthcheck
makes within the minute. No setting saves it, since the objects are real.

The lines are sorted by normalised form and those forms are ASCII, so the
gunzipped bytes are kept as a `Buffer` and binary-searched instead: about twenty
probes, 6.7 µs a word, and only the handful of matching lines is ever turned
into strings. It costs 83 MB that V8 does not count against its heap, and 4 MB
of heap, and the whole server holds in 165 MB. It is also faster than the Map it
replaces, and ready five times sooner, 0.3 s against 1.4 s on a laptop, 10 s on
the two slow cores of the server, which is spent gunzipping. That happens on the
first lookup, which is the healthcheck's, so the first probe times out and the
second, thirty seconds later, finds it done.

An off-by-one line here shows a player another word's definition, which no
crash would announce, so `scripts/test-definitions.mjs` checks the search
against a plain reading of the same file: every hundredth word, both ends, the
words that begin another word (`ABACA` and `ABACAS`), and the words the file
does not hold.

### The fallback: live lookup (option B)

It queries the French Wiktionary on demand. Three obstacles, all measured before
being addressed:

1. **No definition API.** The REST endpoint answers `501` on fr.wiktionary. The
   page is fetched as plain text (`action=query&prop=extracts`) and parsed.
2. **The game strips accents** (`ETE`) where Wiktionary indexes them (`été`). A
   reverse index of 130,830 entries (15.9 MB, measured) gives the real spellings
   back. `COTE` returns *cote*, *coté*, *côte* and *côté*.
3. **Inflected forms carry no definition** but a pointer. The lemma is followed
   automatically, so `DEDOUBLAIT` shows the definition of *dédoubler*.

**Restraint.** A 24-hour cache, deduplicated concurrent calls, at most 8 outbound
requests, a per-IP limit, and a `User-Agent` naming the project. A missing
definition is never an error: the interface offers a link instead.

**Measured performance.** 0.5 to 0.9 s cold, 0.3 s cached, which is the network
round trip alone. Prefetching on hover makes the click usually instant. Since
the file was bundled this path only serves the 0.9% of missing words; the rest
answer in 0.01 s.

**What it costs.** The game depends on a third party for this feature, and the
parsing works on text written for humans: a reformatting on the Wiktionary side
would break it. Two traps of that kind have already been found, a filter that
removed the definition of every plural form, and pointers written "Forme
d'adjectif" where only "Forme de" was expected.

---

## Decision 15: the dice are shown as they fell, and the throw is derived rather than sent

A shaken die does not land upright, and a cube in a square cell can settle four
ways, so grids are drawn with each die turned a quarter, a half or three
quarters. It changes nothing about the game (a turned tile spells the same
letter, and the solver never sees the angle) and everything about reading it,
which is the
point. `rotatedDice` turns it off for whoever wants the letters standing to
attention.

**Derived from the letters, not sent over the wire.** `dieOrientations(cells,
salt)` seeds a generator with a hash of the grid, so every screen showing that
grid shows the same throw. The alternative was an `orientations: number[]`
threaded through `RoundState`, `RoundResults`, the stored room and the daily
record: five places to keep in step, for something no rule depends on. Deriving
it also means a reconnecting player finds the dice exactly as they left them,
without that being a feature anyone had to write. The `salt` is the round
number, or the day, so two rounds that happen to draw the same letters are still
two throws.

**Two letters are underlined.** A turned `M` is a `W`, and a turned `N` is a
`Z`. The underline says which way is down, and it is shown on *every* M, N, W
and Z rather than only the ones lying down: otherwise an unmarked M would itself
mean "this one is upright", and reading the grid would become a chain of
deductions instead of a glance. The mark is placed by hand in `em` just below
the baseline rather than as a CSS border on the letter's box, which lands
wherever the font's descender happens to be and, on a turned die, reads as a
stray tick beside the letter instead of the ground under it.

---

## Decision 16: end-of-game awards, from counters rather than from a log

Once the last round is in, the standings say who won and the awards say how
everyone played: the longest word of the game, a heap of three-letter words,
eight inventions the dictionary had never heard of.

**Counters, not events.** About twenty numbers per player, bumped on submission
and folded in at the end of each round, where a list of timestamped attempts
would have been the obvious way to be able to answer any future question. Two
numbers, `waitMs` and `waits`, say "a word every eleven seconds" as well as
three hundred timestamps would, and they survive being written to disk with the
room without thought. Nothing is kept that a rule does not already ask for.

**Each award goes to one player.** The first draft handed every threshold to
everyone who cleared it, so a room of four fast players produced four Lièvres,
a word that then told nobody apart, since being fast is only interesting next to
someone slower. Every rule is now "whoever did this most, among those who did it
enough at all": the threshold keeps the fastest of three slow players from
becoming a hare, and the comparison keeps a fast room from being all hares. Only
an exact tie shares, there being no tie-break here that would mean anything.

**The cap passes awards down rather than dropping them.** Three each, and an
award whose leader is already full goes to the next qualifier. Otherwise the two
rules pull against each other: a dominant player wins eight, keeps three, and
the five the rest of the room had earned are never said out loud, which is the
"everyone is a hare" problem again, wearing the opposite coat. Nobody is ever
shown a figure that is not theirs, since the threshold is checked against
whoever ends up holding it.

**They are not a second scoreboard.** The player who came last can walk away
with three and the winner with one, and nobody leaves empty-handed: an empty
line under a name reads as a verdict, which is the opposite of the intent.

**Thresholds have to be hard enough to mean something.** The first draft gave
"found what nobody else did" at four words in ten and "thought like everybody
else" at six in ten, which between them covered every player who had found
anything: two rules carrying no information. A unit test written around an
ordinary player caught it (they came out a Fantôme) and the bands were pulled
apart to leave ordinary play ordinary.

**Ordered by a fixed list, not by a score.** Which of a player's awards comes
first is a judgement about the game, not something a formula should be deriving:
"found the longest word of the evening" outranks "was accurate" because it does.

**Where it lives.** `packages/shared/src/awards.ts`, pure and unit-tested, like
the rest of the rules engine. The server keeps the counters and calls
`computeAwards` when `gameOver` turns true; the result rides along in
`RoundResults`, so it survives a restart with the room and needs no event of
its own.

---

## Decision 17: generated artefacts leave git, and a release builds them

`definitions.tsv.gz` is 7 MB of gzip, and gzip does not delta-compress: every
rebuild left a whole new 7 MB blob in the history, permanently. Three editions
of it had taken the repository to 17.9 MB, of which **17.5 MB was that one
file**. It was the repository.

The two artefacts pull in opposite directions, so they are stored differently:

- **`extra-words.txt` stays in git.** 425 KB of plain text, it diffs, it delta-
  compresses, and it *is* the lexicon: the thing worth reviewing, versioning
  and being able to blame line by line. It carries its own version, date, word
  count and a SHA-256 of its contents.
- **`definitions.tsv.gz` becomes a release asset.** Derived, binary, and
  rebuildable from the lexicon at any time. `.github/workflows/release.yml`
  builds it on a tag, after running the rules tests and `test:dict`, and
  publishes it with the lexicon and the packaged game.

**Only the newest dictionary is kept.** The workflow strips the asset from
older releases: it is 7 MB an edition, it is reproducible, and nothing reads an
old one, since the deploy always asks for `releases/latest`.

**The download happens on the host, not in the Dockerfile**, and that is not a
preference. `docker-compose.yml` mounts `./server/data` over the image
read-only, so a file baked into the image is shadowed at runtime by the very
directory it was meant to fill. `scripts/deploy.sh` fetches it before the build
and verifies the SHA-256; because `server/data` is in the build context, the
Dockerfile's own best-effort download then finds the file already there and
does nothing. Both paths work, and one download happens.

**What it costs.** Deploying now touches the network for something it used to
have locally. That is affordable only because the file is optional by design:
without it `/api/definition` falls back to Wiktionary live, which is the path
decision 14 already describes and already tests. A failed download degrades the
game; it does not stop it. The tension with decision 13's self-contained stack
is real, and this is the boundary of it: the game runs offline, the
definitions want a network, and they always did.

---

## Known limits

- **A single instance.** Rooms live in the process. Running several would need
  the Socket.IO Redis adapter and shared storage.
- **A restart costs the seconds it takes.** Rooms come back, but the clock kept
  running while the server was down, so a round loses that much of itself.
- **Bundled definitions are frozen** at the extraction date; missing words go
  through Wiktionary, which becomes a runtime dependency again for those cases.
- **Grids are not the official dice**, for lack of a published source.
- **No moderation**: nicknames are not filtered. Acceptable for a server among
  friends, not for an open service.
- **The daily leaderboard trusts the player identifier**, which comes from
  `localStorage`. Words are verified, names are not.
- **A player who joins mid-game is judged on a partial game.** Their counters
  start where they came in, and an award earned over one round sits beside one
  earned over three.
- **Awards need a game that ends.** In "sans fin" the last round never comes, so
  they are never handed out.
