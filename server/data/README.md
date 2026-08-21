# Adjusting the dictionary

The base dictionary comes from the npm package `an-array-of-french-words`
(MIT), itself derived from the [Letterpress word
lists](https://github.com/lorenbrichter/Words) (CC0), which their author
describes as "loosely based on a collection of other word lists with refinements
from real-world feedback". That repository was archived in May 2019, so the list
is frozen there. Around 336,000 inflected forms, conjugations and plurals
included; after normalisation, meaning uppercase, accents stripped and
hyphenated or apostrophised entries dropped, about 318,800 playable words
remain, 446,028 with the two files below, and 445,422 once the 606 words the
list made up are struck off.

It is a word list for a game, not a lexicon, and players find the seams: it
accepted `grader` and refused `gradera`, it accepted `orque` and refused `orc`.
Everyday French is covered; conjugations, abbreviations and anything coined
since are what is missing.

Three optional files, read when the server starts, adjust it without rebuilding
anything. One word per line; blank lines and lines starting with `#` are
ignored. Accents and case do not matter. All three are generated.

- `grammalecte-words.txt` : the Grammalecte dictionary, flattened
- `extra-words.txt` : what Wiktionary adds on top
- `excluded-words.txt` : what the base list made up

## Both word files are generated

```bash
npm run lexicon -- --write
```

writes them, 130,725 words in all, and produces a byte-identical result when
run twice. `npm run test:dict` checks it in a second, offline.

**`grammalecte-words.txt`** holds the 102,057 words the [Grammalecte
dictionary](https://grammalecte.net/) has and the base list does not: the
dictionary Firefox and LibreOffice spell with, human-curated and still
maintained, which is what the base list stopped being in 2019. The build reads
the "classique" archive that grammalecte.net publishes, currently v7.7, rather
than a package repeating an older one. It is where
`orc`, `blog`, `tofu` and `covoiturage` come from. Its own licence, MPL 2.0, is
why it is a file of its own: see
[`LICENCE-DEFINITIONS.md`](LICENCE-DEFINITIONS.md).

**`extra-words.txt`** holds the 28,668 that Wiktionary adds on top, in four
blocks:

1. verbs no source has, kept only if a French corpus has met them;
2. the rest of the vocabulary no source has, on the same test: nouns,
   adjectives, adverbs and interjections. `ribot` comes from here;
3. **words added by hand**, which is where to put one somebody reports as
   missing;
4. inflections completing every word in the dictionary, computed last so it
   sees the finished thing. That is what stops `orc` from repeating `gradera`:
   a word arriving from any source gets its conjugations, its plurals and its
   feminines.

The hand block prunes itself. A word stays there only until a source covers it,
so it records what the dictionaries do not have yet rather than growing for
ever.

**`excluded-words.txt`** goes the other way: 606 words the base list has that
neither Grammalecte nor the Wiktionary, in any of the languages it describes,
has ever had. Only two shapes are struck, because only two cannot be anything
but an error:

- a conjugation of a verb nothing conjugates. `blêmaient` is not a form of
  `blêmir`, which gives `blêmissaient`; it is a form of `blêmer`, which does
  not exist. Likewise `caséfier`, `conpresser`, `amotir`, `dessuiter`.
- a plural in `-aus` where French writes `-aux`: `bihoreaus`, `nobliaus`.

Agreement is deliberately left alone. `frigorifiante` is the regular feminine of
a participle used as an adjective, correct French that no dictionary lists, and
refusing it would be the bug all of this exists to fix. The 533 words that are
neither shape are left in too, pending someone reading them. To put a word back,
delete its line.

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

It covers **99.1%** of the dictionary. Getting there took a third pass: the
Wiktionary has no entry for many of the words Grammalecte contributes, mostly
conjugations of rare verbs, but Grammalecte knows which lemma it built each form
from. 2,793 of them borrow their lemma's definition and 7,601 at least say
"Forme de …", which is what Wiktionary's own form-of entries say.

## `words-without-definition.txt` is the rest

The 4,213 the third pass could not place either, written out by the same build
so the gap is a list somebody can read rather than a percentage. Not in git,
published with the release. The server still answers for them by asking the
Wiktionary live, which for most of these will not know either.

To add a word, put it under the hand block marker in `extra-words.txt`, with
its plural:

```
# --- 3. added by hand -----------------------------------------------------

kombucha
kombuchas
```

The plural is worth writing out: block 4 completes what Wiktionary knows, and
it will not know a word nobody has entered there yet.

Restart the server to apply the changes.
