# Licence du fichier de définitions

`definitions.tsv.gz` n'est pas écrit par ce projet : il est **dérivé du
Wiktionnaire francophone**, et reste donc soumis à la licence de celui-ci.

## Origine

- **Source** : [Wiktionnaire francophone](https://fr.wiktionary.org), le
  dictionnaire libre.
- **Extraction** : [wiktextract](https://github.com/tatuylonen/wiktextract) de
  Tatu Ylönen, distribuée sur [kaikki.org](https://kaikki.org/dictionary/French/),
  fichier `fr-extract.jsonl.gz`.
- **Transformation** : `scripts/build-definitions.mjs` ne retient que les mots
  jouables du dictionnaire du jeu, la première définition de chaque graphie, et
  rattache les formes fléchies à leur lemme. Aucun contenu n'est réécrit.
- **Date d'extraction** : voir l'en-tête du journal de construction, ou la date
  du commit qui a introduit le fichier.

## Licence

**CC BY-SA 4.0**, soit [Creative Commons Attribution - Partage dans les mêmes
conditions 4.0 International](https://creativecommons.org/licenses/by-sa/4.0/deed.fr).

Ce qui en découle, concrètement :

- **Attribution.** Le Wiktionnaire doit être crédité partout où ces définitions
  sont montrées. L'interface affiche « Source : Wiktionnaire » sous chaque
  définition, avec un lien vers la page du mot.
- **Partage dans les mêmes conditions.** Ce fichier dérivé est lui-même sous
  CC BY-SA 4.0. Toute redistribution, modifiée ou non, doit conserver cette
  licence, y compris si le fichier est extrait de ce dépôt ou de l'image Docker.
- La licence porte sur **les définitions**, pas sur le code du jeu, qui garde la
  sienne.

## Note

Tant qu'on se contentait d'interroger le Wiktionnaire à la demande, aucune de ces
obligations ne s'appliquait : on consultait une source, on ne la republiait pas.
Embarquer le fichier est une redistribution. C'est ce changement de nature, plus
que la place occupée sur le disque, qui méritait d'être décidé sciemment.
