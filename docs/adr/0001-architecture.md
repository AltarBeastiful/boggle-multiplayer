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
normalisation. Hyphenated and apostrophised entries are dropped, as they cannot
be traced anyway.

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
and practising are private, and the game carries on around them — the host can
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
registration: `boggle-multiplayer.193-122-4-195.sslip.io`. It is a real domain
name, which is all Let's Encrypt needs to issue a trusted certificate.

**Self-contained.** The stack depends on no existing container. The WordPress
installation that occupied the machine was stopped without deleting any data.

**The game is published on the loopback only** (`127.0.0.1:3001`); all public
access goes through Traefik.

---

## Decision 14: bundled definitions, Wiktionary as fallback (options C then B)

`GET /api/definition/:word` first consults a file shipped with the image
(7 MB compressed, 315,813 words, 99.1% of the dictionary), and only falls back
to the live lookup for missing words, or if the file is absent, in which case
the game behaves exactly as before.

The file is built by `scripts/build-definitions.mjs` from the wiktextract
extraction of Wiktionary; see
[the option C plan](../plan-option-c-embedded-definitions.md).
**The bundled content is CC BY-SA 4.0**: publishing it is redistribution, where
merely querying committed us to nothing. See `server/data/LICENCE-DEFINITIONS.md`.

The fallback path is the one described below, and keeps its point: it covers
words missing from the artefact without waiting for a rebuild.

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
quarters. It changes nothing about the game — a turned tile spells the same
letter, the solver never sees the angle — only about reading it, which is the
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
everyone who cleared it, so a room of four fast players produced four Lièvres —
a word that then told nobody apart, since being fast is only interesting next to
someone slower. Every rule is now "whoever did this most, among those who did it
enough at all": the threshold keeps the fastest of three slow players from
becoming a hare, and the comparison keeps a fast room from being all hares. Only
an exact tie shares, there being no tie-break here that would mean anything.

**The cap passes awards down rather than dropping them.** Three each, and an
award whose leader is already full goes to the next qualifier. Otherwise the two
rules pull against each other: a dominant player wins eight, keeps three, and
the five the rest of the room had earned are never said out loud — which is the
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
ordinary player caught it — they came out a Fantôme — and the bands were pulled
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
