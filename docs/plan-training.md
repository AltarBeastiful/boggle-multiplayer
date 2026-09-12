# Plan: a training mode

Status: **proposed**, nothing implemented. This document records the
measurements first, because they change what should be built: the obvious
training mode (more grids, more solutions) is not the one the numbers ask for.

Every figure below comes from the game's own engine, run over seeded 4x4 grids
drawn the way `generateBoard` draws them, solved against the 445,422-word
dictionary the server loads. The scripts are throwaway; the method is
`generateBoard` then `solveBoard`, 200 to 8,000 grids per measurement.

## What a grid actually holds

| | mean | median | min | max |
| --- | --- | --- | --- | --- |
| words per 4x4 grid | 131 | 116 | 41 | 413 |
| points per 4x4 grid | 254 | 198 | 49 | 1161 |

A player finding 20 words has 15% of the words. What that is worth in points
depends entirely on which 20, and the spread is the first surprise:

| the 20 words are | points |
| --- | --- |
| the shortest available | 20 |
| the 20 most frequent across grids | 20 |
| 20 drawn at random | 35 |
| the longest available | 84 |
| the whole grid | 254 |

So twenty short words is **8% of the points on the board**. The same twenty
answers, chosen at the other end of the length scale, is 33%.

Length is where the points are, and the classic table makes that sharp:

| length | share of words | points each | share of points |
| --- | --- | --- | --- |
| 3 | 24.4% | 1 | 12.5% |
| 4 | 29.5% | 1 | 15.2% |
| 5 | 25.0% | 2 | 25.7% |
| 6 | 13.8% | 3 | 21.3% |
| 7 | 5.4% | 5 | 13.9% |
| 8+ | 2.1% | 11 | 11.4% |

The thirty longest words of a grid hold **49% of its points**; the fifty
longest hold 67%. One 8-letter word is worth eleven 3-letter words.

## The miss profile, which is the actual finding

Simulate a 20-word player as someone who rakes the bottom: the twenty shortest
words of each grid. Then look at what they left, and where it was.

| | per grid |
| --- | --- |
| missed words traceable **entirely on tiles already used** | 83% |
| tiles never walked at all | 2.2 of 16 |
| missed 3-letter words | 14 |
| missed words that are a found word plus a common suffix | 14 |
| points in the five best misses alone | 33 |

This kills the intuitive diagnosis. A player at twenty words is **not failing to
scan the board**: they walk 14 of the 16 tiles, and 83% of what they miss is
spelled out on tiles their finger already crossed. The bottleneck is not
coverage. It is recognition: seeing a word in letters you are already looking
at.

It also sizes the nearest win. Fourteen 3-letter misses plus fourteen suffix
extensions is twenty-eight words that need **no new search behaviour and no new
vocabulary beyond a finite list**. Twenty becomes forty-eight without learning a
single long word.

## Three levers, in the order they pay

### 1. The short list is finite and small

| length | words in the whole dictionary | present in an average grid |
| --- | --- | --- |
| 3 | **638** | 32.5 |
| 4 | 2,525 | 39.8 |
| 5 | 7,823 | 32.7 |

Six hundred and thirty-eight. That is the entire three-letter vocabulary of a
445,000-word dictionary, and a third of it is on every grid. Learning the 300
most productive covers 27 of the 32.5 available; learning all 638 covers all of
them.

The productive ones are mostly not everyday French, which is why they are
missed. The top forty by grid frequency, excluding the obvious:

```
TEE NES SEN TES SET ETA SUE EUS NEO REU USE RIE ARE AIE IRE REA REE ERS
NIE EUE EON URE LEI IEL TUE EUT ERE ELU TAN MES OLE LEU LUE OTE TEL LET
SUA DIE DEI AIS
```

Each appears in 13% to 24% of grids. This is a memorisation task with a hard
ceiling and no judgement in it, which makes it the cheapest thing to automate.

Four-letter words follow the same shape with a longer tail: the 500 most
productive cover 22 of the 39.8 on a grid.

### 2. Extension is mechanical and worth half the board

| | |
| --- | --- |
| grid words that are another grid word plus a common suffix | **37.7%** |
| points those carry | **133 of 254 per grid** |
| grid words whose 3+ letter prefix is also a grid word | 49.0% |
| grid words having an anagram in the same grid | 37.1% |

Every found word is a handle. From one grid, one stem:

```
MUR -> MUR, MURE, MURA, MURAI, MURS
DUR -> DUR, DURE, DURA, DURAI, DURS
RUS -> RUS, RUSE, RUSA, RUSAI
```

French inflects at the end, so the harvest suffixes are a short list: `S E ES R
ER A AI AS AIS AIT ONS ENT ANT EE EES IE IES EUR T NT`. Testing them on every
accepted word is a habit, not knowledge, and habits are what drills install.

### 3. Length, once the first two are automatic

An average grid holds 26.4 words of six letters or more and 9.1 of seven or
more. This is the lever that moves score rather than word count, it is the
hardest to train, and it should come third: chasing long words before the short
list is automatic costs more time than it returns.

## Why the grille du jour cannot do this

It is a test, and it is being used as practice. Four properties make it
unsuitable, none of them fixable without changing what it is:

- **One trial a day.** Deliberate practice needs many repetitions per sitting,
  at the edge of ability. One grid is one repetition.
- **Feedback is a wall.** Finishing shows 111 missed words grouped by length.
  That is a correct answer key and close to zero information: nothing separates
  the word that was three tiles from your finger from the word you will never
  know.
- **Nothing repeats.** A new grid every day means nothing learned yesterday is
  visibly tested today, so there is no signal that anything improved.
- **Sub-skills are never isolated.** The daily measures vocabulary, search and
  input speed as one number, so a plateau cannot be attributed.

The daily should stay exactly as it is. It is the benchmark. What is missing is
the practice that feeds it.

## The drills

Nine, each aimed at one lever, ordered by return over effort.

| # | drill | trains | why it works |
| --- | --- | --- | --- |
| D1 | **Bilan** — replace the wall of solutions with a diagnosis | all | 83% / 14 / 14 / 33 as a per-grid report, plus the five best misses |
| D2 | **Rejouer** — the same grid at J+0, J+1, J+3, J+7 | search, recall | the classic Boggle drill; the score curve *is* the feedback |
| D3 | **Chasse aux courts** — 60 s, 3-letter words only | lever 1 | trains the 638 in context, where retrieval is cued by the grid |
| D4 | **Récolte** — a found word is shown, find its family | lever 2 | installs the suffix habit as a reflex |
| D5 | **Révision des ratés** — your own misses, resurfaced by spacing | levers 1, 2 | the only drill that adapts to you; needs the history store |
| D6 | **Les longs d'abord** — 90 s, 6+ letters only | lever 3 | scores by points, forces suffix-first reading of the grid |
| D7 | **Trace ce mot** — the word is given, find its path | recognition | isolates "I know it but cannot see it", the 83% failure |
| D8 | **Mot ou pas** — rapid yes/no on this dictionary | precision | distractors come free from `excluded-words.txt`, 606 real ghost spellings |
| D9 | **Fantôme** — your past best, second by second, on the same grid | pace | turns a solo drill into a race against a real opponent |

D1 is the highest value per line of code and it is not a mode at all: it is a
different end screen, and it belongs in the grille du jour as much as in
training.

D5 is the spine. Nothing in the codebase records what a player missed, so
nothing can resurface it. Everything adaptive depends on building that first.

## Architecture

### The grid and its solution go to the client whole

Measured, per 4x4 grid:

| | raw | gzip |
| --- | --- | --- |
| grid + every word + every path | 2.4 KB | **0.7 KB** |
| grid + every word, paths recomputed by `findPath` | 0.9 KB | 0.3 KB |

Generation and solving cost 1.6 ms per grid, so a batch of twenty is 32 ms of
server time and 14 KB on the wire. The client then validates every word
locally, instantly, offline, for a whole session.

This is the opposite of Decision 2 in ADR 0001, and deliberately so. The server
is authoritative because a score must be trustworthy; a training score is worth
nothing to anybody and there is no leaderboard to protect. Paying a round trip
per word to defend a number nobody reads would make the fast drills impossible,
and the fast drills are the point. The daily and the rooms keep the current
posture unchanged.

The alternative, shipping a dictionary to the browser, was measured and
rejected: the full one is 0.73 MB brotli and would cost tens of megabytes of
heap on a phone. A sampled "reachable" subset is smaller (57,201 words, 86 KB
brotli after 8,000 grids) but had not stopped growing, and a training mode that
tells you `RIBOT` is not a word because the sample missed it teaches the wrong
thing.

### Storage: the piece that does not exist

There is no per-player history anywhere. `localStorage` holds three keys
(`boggle.playerId`, `boggle.nickname`, `boggle.theme`) and the server stores one
JSON record per day and per room. A training history is per player, grows
without bound and is worthless to anyone else, which points at the client:

- **`localStorage`, one record per player**, holding the miss deck (word, times
  missed, last seen), the drill results and the replay schedule. No server
  change, no privacy question, survives restarts and deploys, and lost with the
  browser profile, which is an acceptable loss for practice data.
- The server side stays stateless: it generates and solves, it does not
  remember. One new endpoint, no new record prefix in `store.ts`.

If the history is ever wanted across devices, the `daily-` records show the
shape to copy, and the decision can be deferred without rework.

### Prerequisite: three duplications become three primitives

`Daily.tsx` and `Playing.tsx` already hold the same code twice. A training
screen would make it three times, so the extraction comes first and pays for
itself immediately:

- **`<WordInput>`** — the entry form, duplicated at `Daily.tsx:265` and
  `Playing.tsx:318`, down to the `autoCapitalize` and the clear-path-on-typing
  rule.
- **`useTrace()`** — `highlight` / `faintTrace` / `traceTimer` and its cleanup,
  duplicated at `Daily.tsx:99` and `Playing.tsx:62`.
- **`useFlash()`** — the rejection toast and the `animate-reject` ring,
  duplicated at `Daily.tsx:28` and `Playing.tsx:27`.

`BoardGrid` needs nothing: it already takes an external `highlight` path and
already yields `onPathChange`, which is exactly D7.

`SolutionPanel` needs nothing: it already has a `solo` mode, and `Daily.tsx:15`
is the adapter template.

Routing needs one small thing. `App.tsx` decides between home, room and daily
with two booleans over `location.pathname`; a third address wants a
`pathFromUrl()` helper used by both the initial state and the `popstate`
listener. The SPA fallback at `server/src/index.ts:176` already serves any
non-`/api` path, so `/entrainement` works on refresh with no server route.

## Phases

Each phase ships something usable on its own.

**Phase 0 — the extraction.** `WordInput`, `useTrace`, `useFlash`, and the
route helper. No user-visible change; `Daily` and `Playing` come out shorter.
About a day.

**Phase 1 — D1, the bilan.** After any finished grid, classify every miss
against what was found: on tiles already used or not, three letters, an
extension of a found word, and the five costliest. Pure function over data both
the daily and the rooms already have, so it lands in `packages/shared` with unit
tests and is wired into `Daily` first. Half a day for the function, half for the
screen. **Do this one even if nothing else is built.**

**Phase 2 — the training route and D2, D3, D6.** `GET /api/training/boards?n=20`
returns seeded grids with their solutions. `/entrainement` offers three timed
drills over them, scored locally. The miss deck starts being written to
`localStorage` here, even before anything reads it. Two to three days.

**Phase 3 — D5 and D9.** The deck acquires spacing (J+1, J+3, J+7, J+21) and a
drill that draws grids *containing* the words you owe. The ghost replays your
own best run on a repeated grid. One to two days, and this is where the mode
stops being a set of minigames and starts being training.

**Phase 4 — D4, D7, D8.** The remaining three drills, each small once the
scaffolding exists. A day each.

**Phase 5 — progress.** One screen: words per grid over time, split by word
length, against the 131-word ceiling. Without it there is no way to know whether
any of this worked, which is the complaint that started it.

## The awkward parts, named in advance

- **Seeded grids must stay reproducible.** `generateBoard` redraws until a grid
  clears its word threshold, so the dictionary is part of the derivation, not
  just the seed. `server/src/daily.ts:71` learned this the hard way and now
  stores the cells. A replayed training grid must store its cells too, or a
  dictionary update silently changes a grid mid-schedule.
- **A drill that only rewards short words teaches short words.** D3 and D6 must
  alternate, or the training installs exactly the bottom-raking habit the
  measurement diagnoses.
- **The bilan must not become a second wall.** Five misses, four numbers. The
  temptation will be to show everything.
- **Local validation and server validation must agree.** They will diverge the
  day the dictionary changes and a cached batch of grids does not. Batches
  should carry the dictionary size they were solved against and be discarded
  when it moves.
- **`computeAwards` already works for one player**: seven of the twelve rules
  have absolute thresholds, and `awards.ts:439` skips the rest when there are no
  rivals. Training results can reuse it as-is, which is a cheaper reward loop
  than inventing a second one.
