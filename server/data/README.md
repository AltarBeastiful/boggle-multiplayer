# Adjusting the dictionary

The base dictionary comes from the npm package `an-array-of-french-words`
(Dicollecte/Grammalecte lexicon, MIT): around 336,000 inflected forms,
conjugations and plurals included. After normalisation, meaning uppercase,
accents stripped and hyphenated or apostrophised entries dropped, about 318,800
playable words remain.

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
