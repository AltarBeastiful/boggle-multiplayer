# Detailed plan for option C: bundled definitions

- **Status**: **implemented** on 14 August 2026, with Wiktionary kept as fallback
- **Replaces**: the runtime call to Wiktionary ([ADR 0001](adr/0001-architecture.md), decision 13)
- **Figures**: every size below was measured, not estimated

## Actual result

| | planned | measured |
| --- | --- | --- |
| Compressed artefact | ~10 MB | **7.0 MB** |
| Raw artefact | ~38 MB | 65.2 MB |
| Dictionary coverage | not costed | **99.1%** (315,813 of 318,800) |
| Spellings / senses | not costed | 350,169 / **688,722** (1.97 per spelling) |
| Sample of reference | at least 19/20 | **20/20** |
| Latency | ~0 | **0.00 to 0.01 s**, against 0.5 to 0.9 s cold |
| Load at startup | ~1 s | 1.05 s |
| Server resident memory | not costed | 338 MB |

7,452,108 entries streamed, 519,323 lemma definitions kept, 350,169 spellings
retained.

### Three traps the plan had not foreseen

All three come from the same fact: Wiktionary does not only describe common
words, and several of its entries normalise onto the same key.

1. **Affixes and phrases.** `-eté` normalises to `ETE`, `-ane` to `ANE`, `de-ci`
   to `DECI`, overriding *été*, *âne* and *déci*. Fixed by accepting only purely
   alphabetic entries, the rule the game dictionary already applies.
2. **Acronyms and proper nouns.** Once affixes were dropped, `ETE` returned an
   accounting term and `ANE` a Dutch hamlet, both ahead of the common word.
   Spellings are now ranked: an initial capital, a "proper noun" part of speech
   or a definition starting with "Abréviation" all move behind.
3. **Only one sense per spelling.** The first version lost a great deal, since
   entries average 2.55 senses and 55% have at least two. Three are kept now.

Without the first two fixes coverage was identical, 20/20, yet three words in
twenty showed the wrong definition. **The number of answers says nothing about
whether they are right**: only the word-by-word check revealed it.

### Homographs are ranked by measured usage

Within a spelling, senses follow Wiktionary's own order, which is editorial, main
sense first, and not a measure of usage. Across spellings usage can be measured:
**Lexique 3.83** gives each spelling's frequency in occurrences per million, from
film subtitles and books. `COTE` therefore returns *côté*, *côte*, *cote*, *coté*
in that order, which no rule about word shape could have worked out. 31,240 forms
have several spellings and benefit from this ranking.

Cost: 4.2 to 7.0 MB compressed, for twice the content.

## What it changes

Before, clicking a word triggered a call to Wiktionary: 0.5 to 0.9 s cold, 0.3 s
afterwards. With option C the definition is served from a file shipped with the
image, in microseconds, with no outbound call.

Three benefits, in order of real importance:

1. **No runtime dependency.** Wiktionary can go down, change its formatting or
   rate-limit us: the game does not care.
2. **No fragile parsing.** We no longer read text meant for humans. Two bugs of
   that kind had already reached production.
3. **Zero latency**, which allows uses that were impossible before, such as
   showing the definition on hover.

## The measured sizes

| | |
| --- | --- |
| `fr-extract.jsonl.gz` (Kaikki, already parsed) | **682 MB** |
| Observed decompression ratio | **x 5.7** |
| Decompressed | **~3.9 GB** |
| Average size of an entry | 4,890 bytes |
| Definitions per entry | 2.0 |
| Raw Wikimedia XML dump (alternative) | 836 MB |
| Average definition length, measured in production | 91 characters |

**Final artefact**: only `word`, `part of speech`, `lemma` and `definition` are
kept, about 120 bytes against 4,890, a **fortyfold** reduction.

| | |
| --- | --- |
| Peak disk during the build, **streamed** | ~700 MB |
| Peak disk if the file is decompressed | ~3.9 GB |

On a machine with 23 GB free, even the worst case fits four times over. But the
build has no business running on the server, see "Where it runs".

## The source: Kaikki rather than the XML dump

**Chosen: `kaikki.org/dictionary/downloads/fr/fr-extract.jsonl.gz`**, the
Wiktionary extraction by [wiktextract](https://github.com/tatuylonen/wiktextract).

The Wikimedia XML dump holds raw wikitext: using it would mean writing a
MediaWiki template parser, which is exactly the fragile work we are trying to
remove. Kaikki ships structured JSONL, one entry per line, with the fields that
matter:

```jsonc
{
  "word": "dédoublait",
  "lang_code": "fr",
  "pos": "verb",
  "senses": [
    { "form_of": [{ "word": "dédoubler" }], "tags": ["form-of"], "glosses": ["..."] }
  ]
}
```

The `form_of` link is explicit: the pointer to the lemma, which the live lookup
had to guess from a sentence's last word, becomes a simple field read. That is
the most important gain of the change.

## The build

A script, `scripts/build-definitions.mjs`, outside the server's runtime path.

### Step 0: fetch the files

A single download to a work directory ignored by git (682 MB), plus Lexique 3.83
(26 MB). Neither is ever fully decompressed: `zlib.createGunzip()` streams them
line by line. Peak disk is the downloaded files, nothing more.

### Step 1: first pass, the lemma senses

The file is read through and, for every French entry carrying real definitions (a
gloss without `form_of`), the first three are kept: `word -> {partOfSpeech, definitions}`.

Memory cost: around 519,000 lemmas, which holds without difficulty.

### Step 2: second pass, attaching the forms

The same local file is read again, with no second download:

- an entry with its own definition is kept as is;
- an entry with `form_of` takes the lemma's definitions found in step 1, and
  notes the lemma so it can be shown ("de *dédoubler*");
- only words whose normalised form exists in our dictionary (318,800) are kept,
  which bounds the output.

### Step 3: write the artefact

Format: **TSV, one line per sense**, sorted.

```
DEDOUBLAIT	Verbe	dédoublait	dédoubler	Ramener à l'unité ce qui était double.
```

Columns: `normalised form`, `part of speech`, `real spelling`, `lemma` (empty
when none), `definition`.

Why not JSON: a 65 MB object passed to `JSON.parse` is a pointless memory spike
and unreadable in a diff. TSV reads line by line, greps, and can be corrected by
hand like the existing `server/data/` files.

Several spellings of one normalised form give several lines, grouped at load
time and ranked by usage frequency.

### Step 4: check

The script fails if coverage regresses: the same twenty-word sample used as a
reference is replayed, and the total entry count is compared with the previous
build. A drop of more than half is an error, not a warning.

## Runtime

`server/src/definitions.ts` gained a local provider, loaded at startup:

- the TSV is read as a stream into a `Map<string, DefinitionEntry[]>`;
- measured: **1.05 s at startup**, and 338 MB resident for the whole server. The
  machine has 10 GB, so this is of no consequence.

**Wiktionary is kept as a fallback.** If a word is missing from the artefact, the
live call takes over, with the existing cache. That keeps the best of both:
instant in the overwhelming majority of cases, never blocked by a hole in the
data. The reverse spelling index (15.9 MB) is still needed for that fallback
path.

## Where it runs, and how the artefact arrives

**Not on the server.** Three possibilities, in order of preference:

1. **A GitHub release.** The script runs on your machine or in CI; the
   compressed artefact (7 MB) is attached to a release, and the `Dockerfile`
   downloads it at build time. The repository stays light and the version is
   explicit.
2. **Git LFS.** Simple, but adds a dependency to cloning.
3. **In the repository as is.** 7 MB compressed is acceptable once; it stops
   being so after a few updates, every version staying in history forever.

The Docker image goes from 196 MB to about 210 MB.

## Licence, not to be brushed aside

Wiktionary content is under **CC BY-SA 4.0**. Today we only consult it and credit
the source with a link; bundling the definitions is **redistribution**, which
requires:

- crediting the Wiktionary and wiktextract in the artefact and in the interface
  (the "Source : Wiktionnaire" link already exists and needs expanding);
- placing the derived artefact under the same licence, and saying so;
- recording the extraction date.

This is not a blocker, but it is decided knowingly: the licence of the repository
and that of the data are no longer the same.

## Refreshing

Dumps are monthly. A `npm run build:definitions` target and a note in the README
are enough; a scheduled job would be out of proportion. In practice the
vocabulary of a word game does not move from one month to the next, and a yearly
rebuild would already be generous.

## Risks

| Risk | Scope | Handling |
| --- | --- | --- |
| Data frozen at the extraction date | low | Wiktionary fallback, yearly rebuild |
| Kaikki format changed between versions | medium | The step 4 check fails loudly |
| CC BY-SA licence not honoured | **legal** | Explicit attribution, conscious decision |
| Artefact weighing the repository down | low | Publish as a release rather than in git |
| Coverage below the existing lookup | medium | Compare figures before switching |

## Effort

About **one day**, most of it in building and checking:

| | |
| --- | --- |
| Extraction script (2 passes, streamed, TSV) | ~4 h |
| Local provider and fallback in `definitions.ts` | ~2 h |
| Checks, coverage comparison, tests | ~2 h |
| Distribution (release, Dockerfile) and documentation | ~1 h |

Delivered in stages: the script and the artefact first, then a measurement of
real coverage, and a switch only if it matches or beats the current 19/20.
