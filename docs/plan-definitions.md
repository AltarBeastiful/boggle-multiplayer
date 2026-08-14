# Plan: definition of a word on click

Status: **option B implemented** (approved 14 August 2026). This document keeps
the record of the measurements that led to that choice; the implementation lives
in `server/src/definitions.ts`.

Two traps found along the way, invisible at analysis time:

- the filter skipping inflection-table lines also removed "Pluriel de uropode.",
  that is the definition of **every plural form**, a good half of a grid's
  solutions;
- pointer sections are called "Forme de verbe" but also "Forme d'adjectif":
  filtering on "Forme de " alone lost the adjectives.

Coverage measured after the fixes: **19 words out of 20** on a representative
sample of lemmas, plurals, conjugations and rare words.

## Why this is not one simple HTTP request

Three obstacles, all measured rather than assumed.

**1. There is no usable definition API.**
The clean REST endpoint (`/api/rest_v1/page/definition/{word}`), the one the
Wikipedia apps use, answers **501 Internal error** on `fr.wiktionary.org`. It is
only deployed on the English Wiktionary. That leaves the historic API
(`action=query&prop=extracts&explaintext=1`), which returns the whole page as
plain text with its sections, so extraction by regular expressions.

**2. Our dictionary has lost its accents.**
The rules require ignoring accents: we store `ETE`, not `été`. Wiktionary indexes
the accented forms. A reverse index, normalised form to real spellings, is
therefore needed. Measured on our lexicon:

| | |
| --- | --- |
| accented forms | 135,019 |
| index keys | 130,830 |
| keys with several spellings | 4,123 |
| memory cost | **15.9 MB** |

The memory cost is acceptable. The ambiguity less so: `COTE` yields `coté`,
`côte`, `côté`, three different words. All three have to be shown.

**3. Inflected forms have no definition of their own.**
This is the decisive point: most of a grid's solutions are plurals and
conjugations. Tested on ten real words:

| word | result |
| --- | --- |
| `chien`, `été`, `côté`, `râtelier`, `déci`, `zut` | correct definition first try |
| `boudâtes`, `dédoublait`, `uropodes`, `labourés` | **no definition** |

The pages for inflected forms exist, but their content is a pointer ("Première
personne du pluriel du passé simple de *bouder*"), not a definition. A **second
call** to the lemma is therefore needed.

## What is proposed

**Server.** One entry point, `GET /api/definition/:word`, wrapping everything:

1. reverse index, built when the dictionary loads, gives candidate spellings;
2. for each spelling, a call to the `extracts` API;
3. extraction of the `== Français ==` section, then of the first grammatical
   section (`Nom commun`, `Verbe`, `Adjectif`, `Interjection` and so on);
4. if the section found is an **inflected form**, read the lemma it names and
   make a second call to fetch its definition;
5. answer `{ entries: [{ spelling, partOfSpeech, definition, lemma? }] }`, or
   `{ entries: [] }` when nothing was found, and **never an HTTP error**, so the
   interface degrades cleanly.

**Cache.** Essential: a grid of 229 words means potentially 229 outbound
requests. An in-memory key to response cache, capped at around 5,000 entries
with a 24-hour lifetime, and **a single request in flight per word**, so
concurrent calls are shared. The cache alone makes the cost negligible in real
use, since common words come back from one grid to the next.

**Network courtesy.** A `User-Agent` naming the project, as Wikimedia requires, a
cap on outbound concurrency, and a per-IP limit on our side so a client cannot
turn us into a scraper.

**Client.** Clicking a word on the solutions page opens the definition **inline
under the word**, rather than in a modal, which is more comfortable under a
thumb. Three states: loading, definition, and "definition unavailable" with a
link to the Wiktionary. The click keeps its current effect of tracing the word on
the grid.

## What it costs, what it risks

- **Effort**: about half a day, the extraction and the lemma lookup being most
  of the work.
- **External dependency**: the game starts depending on a third-party service.
  Contained, since failure is silent and only affects showing a definition.
- **Fragile parsing**: we analyse text meant for humans. A reformatting on the
  Wiktionary side would break the extraction. To be covered by tests on a sample
  of frozen pages.
- **Partial coverage**: even with the lemma lookup, some words will have no
  definition. Acceptable, as boggle.fr has the same limit.

## Three options, to choose between

| | effort | coverage | dependency |
| --- | --- | --- | --- |
| **A. Outbound link only**, the click opens the Wiktionary page | ~1 h | total | none |
| **B. The plan above**, definition inline, with lemma lookup | ~½ day | good | Wiktionary at runtime |
| **C. Bundled definitions set**, extracted from the Wiktionary dump | ~1 day + build | good, frozen | none at runtime |

**Recommendation: B**, which matches what boggle.fr does and what was asked for.
Option A is an honest fallback if zero dependency is wanted; it could even ship
first, since the client needs the link as a fallback under B anyway.

Option C has since been costed in detail:
[`plan-option-c-embedded-definitions.md`](plan-option-c-embedded-definitions.md).
The French Wiktionary dump weighs several gigabytes, and extracting a usable
definitions file from it is a data-processing job in its own right. It only makes
sense if a fully self-contained game, with no outbound call, is wanted.
