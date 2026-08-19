# Adjusting the dictionary

The base dictionary comes from the npm package `an-array-of-french-words`
(MIT), itself derived from the [Letterpress word
lists](https://github.com/lorenbrichter/Words) (CC0), which their author
describes as "loosely based on a collection of other word lists with refinements
from real-world feedback". That repository was archived in May 2019, so the list
is frozen there. Around 336,000 inflected forms, conjugations and plurals
included; after normalisation, meaning uppercase, accents stripped and
hyphenated or apostrophised entries dropped, about 318,800 playable words
remain, and 437,770 with the two files below.

It is a word list for a game, not a lexicon, and players find the seams: it
accepted `grader` and refused `gradera`, it accepted `orque` and refused `orc`.
Everyday French is covered; conjugations, abbreviations and anything coined
since are what is missing.

Three optional files, read when the server starts, adjust it without rebuilding
anything. One word per line; blank lines and lines starting with `#` are
ignored. Accents and case do not matter.

- `grammalecte-words.txt` : the Grammalecte dictionary, flattened
- `extra-words.txt` : what Wiktionary adds on top
- `excluded-words.txt` : words to drop

## Both word files are generated

```bash
npm run lexicon -- --write
```

writes them, 122,342 words in all, and produces a byte-identical result when
run twice. `npm run test:dict` checks it in a second, offline.

**`grammalecte-words.txt`** holds the 100,034 words the [Grammalecte
dictionary](https://grammalecte.net/) has and the base list does not: the
dictionary Firefox and LibreOffice spell with, human-curated and still
maintained, which is what the base list stopped being in 2019. It is where
`orc`, `blog`, `tofu` and `covoiturage` come from. Its own licence, MPL 2.0, is
why it is a file of its own: see
[`LICENCE-DEFINITIONS.md`](LICENCE-DEFINITIONS.md).

**`extra-words.txt`** holds the 22,308 that Wiktionary adds on top, in three
blocks:

1. verbs no source has, kept only if a French corpus has met them;
2. **words added by hand**, which is where to put one somebody reports as
   missing;
3. conjugations completing every verb in the dictionary, computed last so it
   sees the finished thing. That is what stops `orc` from repeating `gradera`:
   a verb arriving from any source gets its tenses.

The hand block prunes itself. A word stays there only until a source covers it,
so it records what the dictionaries do not have yet rather than growing for
ever.

Two things need doing after editing any of them:

1. restart the server, which rereads them at startup;
2. rebuild the definitions if words were added, or they will be the only ones
   in the game with no bundled definition, falling through to a live Wiktionary
   call. Locally that is `node scripts/build-definitions.mjs`; in production it
   happens by tagging a release.

## `definitions.tsv.gz` is not in git

It is 9 MB of gzip, and gzip never delta-compresses, so every rebuild left
another permanent copy in the history. Three editions had taken the repository
to 17.9 MB, of which 17.5 MB was this one file.

It is published as a release asset instead. `scripts/deploy.sh` fetches the
newest one and checks its SHA-256 before the container starts; the download has
to happen there rather than in the Dockerfile, because `docker-compose.yml`
mounts this directory over the image read-only, so a copy baked into the image
would be shadowed at runtime by this very directory.

Nothing breaks without it: `/api/definition` falls back to looking words up on
Wiktionary live, which is what it did before the file existed. To build one
locally, run `node scripts/build-definitions.mjs`, which needs the 715 MB
Wiktionary extract and downloads it into `.work/` once.

To add a word, put it under the hand block marker in `extra-words.txt`, with
its plural:

```
# --- 2. added by hand -----------------------------------------------------

kombucha
kombuchas
```

Restart the server to apply the changes.
