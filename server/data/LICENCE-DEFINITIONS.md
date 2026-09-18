# Licence of the generated dictionary files

Three files here are not written by this project but derived from dictionaries
that are, and they remain subject to those dictionaries' licences:

- `definitions.tsv.gz`, the bundled definitions, served by `/api/definition`.
  Not in git; built by `scripts/build-definitions.mjs` and published as a
  release asset. **From the French Wiktionary: CC BY-SA 4.0.**
- `extra-words.txt`, the conjugations the base word list was missing and the
  vocabulary a French corpus attests. In git, written by
  `scripts/build-lexicon.mjs`. **From the French Wiktionary and Lexique 3.83
  (CC BY-SA 4.0) and GLÀFF 1.2.2 (CC BY-SA 3.0).**
- `grammalecte-words.txt`, the Grammalecte dictionary flattened to one word per
  line. In git, written by the same script. **From the Dictionnaire
  orthographique français: MPL 2.0.**

Two more go out with the release and carry no content from either source, only
words already published above: `excluded-words.txt`, the spellings the base word
list made up and no dictionary anywhere has, and `words-without-definition.txt`,
the words the game accepts that nothing defines. Both exist so that what was
taken out and what is still missing can be read rather than assumed.

**Why the last one is a separate file.** MPL 2.0 is copyleft per file and
CC BY-SA 4.0 is copyleft per work, and neither is written to give way to the
other. Merging both word lists into one file would ask which licence the result
carries, a question with no comfortable answer. Keeping one source per file
avoids it entirely: each file states where its words came from and keeps that
source's licence, and the release publishes them as two assets rather than one.

All are published as release assets, so all are **distributed**, which is what
makes attribution a duty here rather than a courtesy.

## Origin

- **Source**: the [French Wiktionary](https://fr.wiktionary.org), the free
  dictionary.
- **Extraction**: [wiktextract](https://github.com/tatuylonen/wiktextract) by
  Tatu Ylönen, distributed on [kaikki.org](https://kaikki.org/dictionary/French/),
  file `fr-extract.jsonl.gz`.
- **Ranking**: [Lexique 3.83](http://www.lexique.org) (CC BY-SA 4.0) supplies the
  usage frequencies that order homographs, putting "côté" ahead of "coté". No
  frequency is copied into the file; only the ordering follows from them.
- **Transformation**: `scripts/build-definitions.mjs` keeps only the playable
  words of the game dictionary and the first definitions of each spelling, and
  attaches inflected forms to their lemma. No content is rewritten.
- **Extraction date**: see the header of the build log, or the date of the
  commit that introduced the file.

## Grammalecte, `grammalecte-words.txt`

- **Source**: [Dictionnaire orthographique français](https://grammalecte.net/)
  "classique" v7.7, by Olivier R., the dictionary Firefox and LibreOffice spell
  with. Obtained through the npm package `dictionary-fr`, which packages it
  unchanged.
- **Transformation**: `scripts/build-lexicon.mjs` expands the Hunspell affixes
  to every inflected form and keeps those the base word list lacks. Two flag
  families are dropped: the SI unit prefixes, which multiply each unit symbol
  by nineteen and yield `zsr` and `dcal`, and the elisions, whose apostrophes
  cannot be traced on a grid. No word is rewritten and nothing is added.
- **Licence**: **MPL 2.0**, [Mozilla Public License
  2.0](https://www.mozilla.org/MPL/2.0/), which this file keeps. Concretely:
  the file may be redistributed and used freely, including here, and any
  modified version of it stays under MPL 2.0. The licence attaches to this file
  alone and says nothing about the rest of the project.

## The lexicon, `extra-words.txt`

Same sources as the definitions, different use. Wiktionary supplies which words
and which conjugated forms exist and which lemma they belong to; the corpora
supply whether a French corpus has ever met the word, which is the test for
admitting one. No definition, no gloss and no frequency is copied: what is kept
is a list of words, one per line.

**The corpora.** Lexique 3.83 answers for every word and alone for the verbs.
For the rest it is joined by [GLÀFF
1.2.2](http://redac.univ-tlse2.fr/lexiques/glaff_en.html), by Franck Sajous,
Nabil Hathout and Basilio Calderone (CLLE-ERSS, CC BY-SA 3.0), which counts each
word in Frantext 20e, in ten years of *Le Monde* and in the 1.25-billion-word
FrWaC web corpus. Only those counts are read, and none of them is copied into
the file: what GLÀFF decides is whether a word Wiktionary already described may
be kept. `scripts/corpora.mjs` says why one corpus was not enough. CC BY-SA 3.0
material may be redistributed under CC BY-SA 4.0, which is the licence this file
carries.

Some of those conjugations complete a verb Grammalecte brought in. The forms
themselves are Wiktionary's, which is why they are filed here; what Grammalecte
contributed is the infinitive, and that word is in its own file.

A bare word list is thin material for copyright, and in places would fall under
a database right rather than under copyright at all. Rather than argue the
point, it is released under the same **CC BY-SA 4.0** as its sources, with the
same attribution. The file carries its version, its date, its word count and a
SHA-256 of its own contents in a header, so a copy found anywhere can say what
it is.

## Licence of the Wiktionary files

**CC BY-SA 4.0**, that is [Creative Commons Attribution-ShareAlike 4.0
International](https://creativecommons.org/licenses/by-sa/4.0/). It covers
`definitions.tsv.gz` and `extra-words.txt`; `grammalecte-words.txt` is under
MPL 2.0, as above.

What follows from it, concretely:

- **Attribution.** The Wiktionary must be credited wherever these definitions
  are shown. The interface displays "Source : Wiktionnaire" under every
  definition, with a link to the page for the word.
- **Share alike.** This derived file is itself under CC BY-SA 4.0. Any
  redistribution, modified or not, must keep that licence, including if the file
  is extracted from this repository or from the Docker image.
- The licence covers **the definitions**, not the code of the game, which keeps
  its own.

## Note

As long as we merely queried the Wiktionary on demand, none of these obligations
applied: we were consulting a source, not republishing it. Bundling the file is
redistribution. That change of nature, rather than the disk space it takes, is
what deserved a deliberate decision.
