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

## Decision 3: state lives in memory, with no database

A `Map` of rooms inside the process. Empty rooms are swept after 30 minutes.

**Why.** A game is ephemeral and does not survive a restart, so there is nothing
to keep. Adding a database would have meant one more container, migrations and
backups, for data worth nothing an hour later.

**Consequences.** A restart interrupts games in progress. Accepted: deploying
takes seconds and games last minutes. Running several instances would need the
Redis adapter for Socket.IO and shared room storage, see "Known limits".

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

`an-array-of-french-words` (MIT, the Dicollecte/Grammalecte lexicon): 336,000
raw forms, 318,800 after normalisation. Hyphenated and apostrophised entries are
dropped, as they cannot be traced anyway.

**Why permissive.** An explicit request: `déci`, `zut`, `eus`, `ait` and
`mangeassions` are all accepted. A Scrabble lexicon (ODS) would be stricter and
more "correct" in tournament play, but it is under copyright.

**Adjustment.** `server/data/extra-words.txt` and `excluded-words.txt` are read
at startup. Fixing an omission needs neither a rebuild nor a release.

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

## Decision 10: light and dark themes through semantic tokens

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

## Decision 11: published by Traefik, Let's Encrypt certificate, sslip.io domain

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

## Decision 12: bundled definitions, Wiktionary as fallback (options C then B)

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

## Known limits

- **A single instance.** Rooms live in the process. Running several would need
  the Socket.IO Redis adapter and shared storage.
- **A restart interrupts games in progress.**
- **Bundled definitions are frozen** at the extraction date; missing words go
  through Wiktionary, which becomes a runtime dependency again for those cases.
- **Grids are not the official dice**, for lack of a published source.
- **No moderation**: nicknames are not filtered. Acceptable for a server among
  friends, not for an open service.
