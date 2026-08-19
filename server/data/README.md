# Adjusting the dictionary

The base dictionary comes from the npm package `an-array-of-french-words`
(MIT), itself derived from the [Letterpress word
lists](https://github.com/lorenbrichter/Words) (CC0), which their author
describes as "loosely based on a collection of other word lists with refinements
from real-world feedback". That repository was archived in May 2019, so the list
is frozen there. Around 336,000 inflected forms, conjugations and plurals
included; after normalisation, meaning uppercase, accents stripped and
hyphenated or apostrophised entries dropped, about 318,800 playable words
remain, and 352,400 with the conjugations, verbs and modern words added
below.

It is a word list for a game, not a lexicon, and it shows: see
`scripts/audit-dictionary.mjs`, which measures what is missing against Lexique
3.83 and the French Wiktionary. Everyday French is covered, abbreviations and
anglicisms less so. That is what the two files below are for.

Two optional files, read when the server starts, adjust it without rebuilding
anything. One word per line; blank lines and lines starting with `#` are
ignored. Accents and case do not matter.

- `extra-words.txt` : words to add
- `excluded-words.txt` : words to drop

## `extra-words.txt` is generated, except its last block

It currently holds **34,938 words** the base list was missing, in three blocks:

```bash
npm run audit:conj -- --write --verbs
```

writes the first two. Block 1 completes verbs the dictionary already accepts,
so nothing new gets in by that route; block 2 adds verbs it lacked outright,
kept only if a corpus has met them.

Block 3 is written by hand, and is where to add a word somebody reports as
missing. These are the modern words no rule finds: `orc`, `blog`, `tofu`,
`covoiturage`. Rerunning the command **keeps every line of it**, and produces a
byte-identical file otherwise. `npm run test:dict` checks the result in a
second, offline.

Adding a noun that is also a verb infinitive has a consequence worth knowing:
the next run completes its conjugation. `hacker` brought 38 forms with it, which
is correct, and the test says so on purpose.

Two things need doing after editing either file:

1. restart the server, which rereads them at startup;
2. rebuild the definitions if words were added, or they will be the only ones
   in the game with no bundled definition, falling through to a live Wiktionary
   call. Locally that is `node scripts/build-definitions.mjs`; in production it
   happens by tagging a release.

## `definitions.tsv.gz` is not in git

It is 7 MB of gzip, and gzip never delta-compresses, so every rebuild left
another permanent 7 MB in the history. Three editions had taken the repository
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

To add a word, put it under the block 3 marker with its plural:

```
# --- 3. modern words, added by hand ---------------------------------------

kombucha
kombuchas
```

Restart the server to apply the changes.
