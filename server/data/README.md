# Adjusting the dictionary

The base dictionary comes from the npm package `an-array-of-french-words`
(MIT), itself derived from the [Letterpress word
lists](https://github.com/lorenbrichter/Words) (CC0), which their author
describes as "loosely based on a collection of other word lists with refinements
from real-world feedback". That repository was archived in May 2019, so the list
is frozen there. Around 336,000 inflected forms, conjugations and plurals
included; after normalisation, meaning uppercase, accents stripped and
hyphenated or apostrophised entries dropped, about 318,800 playable words
remain, 452,620 with the two files below, and 451,965 once the 606 words the
list made up and the 29 struck by hand are taken out.

It is a word list for a game, not a lexicon, and players find the seams: it
accepted `grader` and refused `gradera`, it accepted `orque` and refused `orc`.
Everyday French is covered; conjugations, abbreviations and anything coined
since are what is missing. The second of those reports turned out the other way,
`orc` being the English spelling of `orque`, and is now the one word struck by
hand, but the class behind it was real: `blog`, `tofu`, `selfie` and
`covoiturage` were all missing too.

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

writes them, 137,404 words in all, and produces a byte-identical result when
run twice. `npm run test:dict` checks it in a second, offline, including a
section of words that are hard to build in and the class each one stands for.

**`grammalecte-words.txt`** holds the 102,057 words the [Grammalecte
dictionary](https://grammalecte.net/) has and the base list does not: the
dictionary Firefox and LibreOffice spell with, human-curated and still
maintained, which is what the base list stopped being in 2019. The build reads
the "classique" archive that grammalecte.net publishes, currently v7.7, rather
than a package repeating an older one. It is where
`blog`, `tofu`, `selfie` and `covoiturage` come from. Its own licence, MPL 2.0, is
why it is a file of its own: see
[`LICENCE-DEFINITIONS.md`](LICENCE-DEFINITIONS.md).

**`extra-words.txt`** holds the 35,347 that Wiktionary adds on top, in four
blocks:

1. verbs no source has, kept only if Lexique 3.83 has met them. Only Lexique,
   because an infinitive brings about fifty playable forms with it and the
   other corpora lemmatise their verbs by machine;
2. the rest of the vocabulary no source has: nouns, adjectives, adverbs and
   interjections, kept when **any** of four French corpora has met the word.
   `ribot` comes from here, and so does `mique`;
3. **words added by hand**, which is where to put one somebody reports as
   missing;
4. inflections completing every word in the dictionary, computed last so it
   sees the finished thing. That is what stops `covoiturage` from repeating
   `gradera`: a word arriving from any source gets its conjugations, its plurals
   and its feminines.

The hand block prunes itself. A word stays there only until a source covers it,
so it records what the dictionaries do not have yet rather than growing for
ever.

## Four corpora decide, not one

Block 2 used to ask Lexique 3.83 and nothing else, and a word that one corpus of
film subtitles and books had never met was refused with no appeal. `mique`, the
Périgord dumpling the Wiktionary quotes from Mauriac and from three other
published books, is not in Lexique, so the game refused it to the player who
traced it. So were `panisse`, `déchèterie`, `webmail` and `phishing`.

Attestation is a panel now, and any one member vouching is enough: Lexique 3.83,
then Frantext 20e, ten years of *Le Monde* and the FrWaC web crawl, the last
three read from [GLÀFF 1.2.2](http://redac.univ-tlse2.fr/lexiques/glaff_en.html).
They differ in size by a factor of forty, so the test is a rate and not a count:
0.03 occurrences per million words, which is one occurrence in the smallest of
them. `scripts/corpora.mjs` holds the whole of it, including the two places the
line is drawn tighter and what each costs measured in words per grid: verbs,
which Lexique alone vouches for because an infinitive brings fifty forms with
it, and words under five letters, which need a second witness because a
frequency computed by machine for a short string may belong to another word.
Short words are not refused for being short. Three and four letters are most of
a grid, so the second witness is Wiktionary quoting the word from a published
work, which is how `led`, `asso`, `péno`, `kiff` and `zine` come in while `tré`
and `tion` stay out.

**`excluded-words.txt`** goes the other way, in two blocks like the file above.

Block 1 is computed: 606 words the base list has that neither Grammalecte nor
the Wiktionary, in any of the languages it describes, has ever had. Only two
shapes are struck, because only two cannot be anything but an error:

- a conjugation of a verb nothing conjugates. `blêmaient` is not a form of
  `blêmir`, which gives `blêmissaient`; it is a form of `blêmer`, which does
  not exist. Likewise `caséfier`, `conpresser`, `amotir`, `dessuiter`.
- a plural in `-aus` where French writes `-aux`: `bihoreaus`, `nobliaus`.

Agreement is deliberately left alone. `frigorifiante` is the regular feminine of
a participle used as an adjective, correct French that no dictionary lists, and
refusing it would be the bug all of this exists to fix. The 533 words that are
neither shape are left in too, pending someone reading them.

**Block 2 is written by hand**, and is where a word reported as *wrongly
accepted* goes. A word the sources *lack* has had somewhere to go since `orc`
was reported; a word they wrongly supply had nowhere, because this file was
computed from end to end and a line added to it lasted until the next build.

It holds 29 words. Two are `orc` and `orcs`, which is the first report coming
back the other way: Grammalecte has `orc/S.` and block 1 takes Grammalecte
whole, so the word the player asked for arrived with the dictionary that was
adopted to supply it. The Officiel du Scrabble refuses it, French writes
`orque`, which the game accepts, and Tolkien asked his translators to translate
the word. Both forms need a line here, the plural coming from Grammalecte's own
flag rather than from the block that completes paradigms, so striking the
singular does not take it.

The other 27 are clipped forms, checked against ODS 9 in one pass rather than
argued one at a time: `carbu`, `soluce`, `aéro`, `astro`, `pédago`, `ravito`,
`zique`, `pronos`, `régul`, `nap`, `histo`, `mili`, `publi`, `autor`, `reum`,
`gogue`, `macchab`, `maccab`, `aprème`, `bénouze`, `bénoche`, `calfouette`,
`pistoche`, `perquise`, `pitaine`, `turellement`, `gnac`. The 51 the ODS does
list stay, `aprèm`, `certif`, `restau`, `impec`, `calcif`, `scénar`, `péno`,
`asso` and the rest, so this is not a rule about clipping. Their plurals needed
no line: the paradigm block completes only what the dictionary still accepts.
`gogues` did stay, ODS having that one and French using it in the plural only. Deleting a line from block 1 did not last
either, the computation simply producing the word again. Adding and removing are
the same question asked twice, so they now work the same way:

```
# --- 2. struck by hand ---------------------------------------------------

carbu
```

The plural usually needs no line: block 4 of `extra-words.txt` completes only
what the dictionary still accepts, so striking `carbu` takes `carbus` with it.
Write one when a source supplies the plural itself, as Grammalecte does for
`orcs`. The block prunes itself the way the hand block of `extra-words.txt`
does, running the other way: a word stays struck only while a source still
supplies it.

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
from. 2,859 of them borrow their lemma's definition and 7,681 at least say
"Forme de …", which is what Wiktionary's own form-of entries say.

## `words-without-definition.txt` is the rest

The 4,216 the third pass could not place either, written out by the same build
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
