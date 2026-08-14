# Licence of the definitions file

`definitions.tsv.gz` is not written by this project: it is **derived from the
French Wiktionary**, and therefore remains subject to its licence.

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

## Licence

**CC BY-SA 4.0**, that is [Creative Commons Attribution-ShareAlike 4.0
International](https://creativecommons.org/licenses/by-sa/4.0/).

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
