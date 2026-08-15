# Adjusting the dictionary

The base dictionary comes from the npm package `an-array-of-french-words`
(MIT), itself derived from the [Letterpress word
lists](https://github.com/lorenbrichter/Words) (CC0), which their author
describes as "loosely based on a collection of other word lists with refinements
from real-world feedback". That repository was archived in May 2019, so the list
is frozen there. Around 336,000 inflected forms, conjugations and plurals
included; after normalisation, meaning uppercase, accents stripped and
hyphenated or apostrophised entries dropped, about 318,800 playable words
remain.

It is a word list for a game, not a lexicon, and it shows: see
`scripts/audit-dictionary.mjs`, which measures what is missing against Lexique
3.83 and the French Wiktionary. Everyday French is covered, abbreviations and
anglicisms less so. That is what the two files below are for.

Two optional files, read when the server starts, adjust it without rebuilding
anything. One word per line; blank lines and lines starting with `#` are
ignored. Accents and case do not matter.

- `extra-words.txt` : words to add
- `excluded-words.txt` : words to drop

Example `extra-words.txt`:

```
# missing common nouns
kombucha
mocktail
```

Restart the server to apply the changes.
