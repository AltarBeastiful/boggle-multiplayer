# Plan détaillé de l'option C : définitions embarquées

- **Statut** : à valider, non implémenté
- **Remplace** : l'appel au Wiktionnaire à l'exécution ([ADR 0001](adr/0001-architecture.md), décision 12)
- **Contexte chiffré** : toutes les tailles ci-dessous ont été mesurées, pas estimées

## Ce que ça change

Aujourd'hui, cliquer un mot déclenche un appel au Wiktionnaire : 0,5 à 0,9 s à
froid, 0,3 s ensuite. Avec l'option C, la définition est servie depuis un fichier
livré avec l'image : **quelques microsecondes, sans appel sortant**.

Trois bénéfices, dans l'ordre d'importance réelle :

1. **Plus de dépendance à l'exécution.** Le Wiktionnaire peut tomber, changer sa
   mise en forme ou nous limiter : le jeu s'en moque.
2. **Plus d'analyse fragile.** On ne lit plus du texte destiné aux humains. Deux
   bogues de ce type ont déjà été trouvés en production (les formes au pluriel,
   les « Forme d'adjectif ») ; il y en a probablement d'autres.
3. **Latence nulle**, ce qui autorise des usages impossibles aujourd'hui,
   comme afficher la définition au survol.

## Les tailles, mesurées

| | |
| --- | --- |
| `fr-extract.jsonl.gz` (Kaikki, déjà analysé) | **682 Mo** |
| Ratio de décompression constaté | **x 5,7** |
| Décompressé | **~3,9 Go** |
| Taille moyenne d'une entrée | 4 890 octets |
| Définitions par entrée | 2,0 |
| Dump XML brut de Wikimedia (alternative) | 836 Mo |
| Longueur moyenne d'une définition (mesurée sur la production) | 91 caractères |

**Artefact final** : on ne garde que `mot`, `nature`, `lemme`, `définition`, soit
~120 octets contre 4 890, une réduction de **40 fois**.

| | |
| --- | --- |
| 318 800 formes, une définition chacune | **~38 Mo** |
| Idem, définitions dédupliquées par lemme | ~15 à 20 Mo |
| Compressé (ce qui transite et se stocke) | **~10 Mo** |
| Pic disque à la construction, **en flux** | ~700 Mo |
| Pic disque si l'on décompresse le fichier | ~3,9 Go |

Sur une machine avec 23 Go libres, même le pire cas passe quatre fois. Mais la
construction n'a pas sa place sur le serveur, voir « Où ça tourne ».

## La source : Kaikki plutôt que le dump XML

**Choix : `kaikki.org/dictionary/downloads/fr/fr-extract.jsonl.gz`**, l'extraction
du Wiktionnaire par [wiktextract](https://github.com/tatuylonen/wiktextract).

Le dump XML de Wikimedia contient le wikitexte brut : l'exploiter demanderait
d'écrire un analyseur de modèles MediaWiki, c'est-à-dire exactement le travail
fragile qu'on cherche à supprimer. Kaikki livre du JSONL déjà structuré, une
entrée par ligne, avec les champs qui nous intéressent :

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

Le lien `form_of` est explicite : le renvoi vers le lemme, qu'on devine
aujourd'hui en prenant le dernier mot d'une phrase française, devient une simple
lecture de champ. C'est le gain le plus important du changement.

## La construction

Un script `scripts/build-definitions.mjs`, hors du chemin d'exécution du serveur.

### Étape 0 : récupérer le fichier

Téléchargement unique vers un dossier de travail ignoré par git (682 Mo). On ne
le décompresse **jamais** entièrement : `zlib.createGunzip()` en flux, ligne à
ligne. Pic disque : le fichier téléchargé, rien de plus.

### Étape 1 : première passe : les définitions des lemmes

On parcourt le fichier et on retient, pour chaque entrée française portant une
vraie définition (un `gloss` sans `form_of`), la première : `mot -> {nature, définition}`.

Coût mémoire : ~200 000 lemmes x ~120 octets ≈ **25 Mo**. Tient sans difficulté.

### Étape 2 : seconde passe : rattacher les formes

On reparcourt le même fichier local (pas de second téléchargement) :

- entrée avec définition propre → on la garde telle quelle ;
- entrée `form_of` → on récupère la définition du lemme trouvée en étape 1, et on
  note le lemme pour l'afficher (« de *dédoubler* ») ;
- on ne conserve que les mots dont la forme normalisée existe dans notre
  dictionnaire (318 800), ce qui borne la sortie.

### Étape 3 : écrire l'artefact

Format retenu : **TSV, une ligne par forme normalisée**, trié.

```
DEDOUBLAIT	verbe	dédoublait	dédoubler	Ramener à l'unité ce qui était double.
COTE	nom	côte	                	(Anatomie) Chacun des os qui forment la cage thoracique.
```

Colonnes : `forme normalisée`, `nature`, `graphie réelle`, `lemme` (vide si
aucun), `définition`.

Pourquoi pas du JSON : un objet de 38 Mo passé à `JSON.parse` est un pic mémoire
inutile et illisible en diff. Le TSV se lit ligne à ligne, se `grep`, et se
corrige à la main comme les fichiers `server/data/` actuels.

Plusieurs graphies pour une même forme normalisée (`COTE`) donnent plusieurs
lignes ; le chargement les regroupe.

### Étape 4 : contrôle

Le script échoue si la couverture régresse : on rejoue le même échantillon de
20 mots qui sert aujourd'hui de référence (19/20 attendus au minimum), et on
compare le nombre total d'entrées à la construction précédente. Une chute de plus
de 5 % est une erreur, pas un avertissement.

## L'exécution

`server/src/definitions.ts` gagne un fournisseur local, chargé au démarrage :

- lecture en flux du TSV, construction d'une `Map<string, DefinitionEntry[]>` ;
- coût mesurable attendu : **~1 s au démarrage**, ~80 Mo de tas. Le serveur en
  utilise déjà ~70 Mo (dictionnaire + index des graphies) et la machine dispose
  de 10 Go : c'est sans conséquence.

**Recommandation : garder le Wiktionnaire en secours.** Si un mot manque à
l'artefact, on retombe sur l'appel en direct, avec le cache actuel. On garde le
meilleur des deux : instantané dans l'immense majorité des cas, jamais bloqué par
un trou dans les données. L'index inverse des graphies (15,9 Mo) reste nécessaire
pour ce chemin de secours.

Si l'on choisit au contraire de supprimer complètement l'appel sortant, l'index
inverse et tout `definitions.ts` réseau disparaissent, mais un mot absent le
reste définitivement, jusqu'à la reconstruction suivante.

## Où ça tourne, et comment l'artefact arrive

**Pas sur le serveur.** Trois possibilités, par ordre de préférence :

1. **Publication en GitHub Release.** Le script tourne sur votre poste ou en CI ;
   l'artefact compressé (~10 Mo) est joint à une release. Le `Dockerfile` le
   télécharge à la construction. Le dépôt reste léger, la version est explicite.
2. **Git LFS.** Simple, mais ajoute une dépendance au clone.
3. **Dans le dépôt tel quel.** 10 Mo compressés, c'est acceptable une fois ; ça ne
   l'est plus après quelques mises à jour, chaque version restant dans
   l'historique à perpétuité.

L'image Docker passerait de 196 Mo à environ **210 Mo**.

## Licence, à ne pas négliger

Le contenu du Wiktionnaire est sous **CC BY-SA 4.0**. Aujourd'hui nous ne faisons
que consulter et créditer la source par un lien ; embarquer les définitions est
une **redistribution**, ce qui impose :

- de citer le Wiktionnaire et wiktextract dans l'artefact et dans l'interface
  (le lien « Source : Wiktionnaire » existe déjà, il faudra l'étoffer) ;
- de placer l'artefact dérivé sous la même licence, et de le dire ;
- de mentionner la date de l'extraction.

Ce n'est pas bloquant, mais ça se décide en connaissance de cause : la licence du
dépôt et celle des données ne sont plus les mêmes.

## Rafraîchissement

Les dumps sont mensuels. Une cible `npm run build:definitions` et une note dans le
README suffisent ; un travail programmé serait disproportionné. En pratique le
vocabulaire d'un jeu de lettres ne bouge pas d'un mois à l'autre : une
reconstruction annuelle serait déjà généreuse.

## Risques

| Risque | Portée | Traitement |
| --- | --- | --- |
| Données figées à la date d'extraction | faible | Wiktionnaire en secours ; reconstruction annuelle |
| Format Kaikki modifié entre deux versions | moyen | Le contrôle de l'étape 4 échoue bruyamment |
| Licence CC BY-SA mal honorée | **juridique** | Attribution explicite, décision consciente |
| Artefact alourdissant le dépôt | faible | Publication en release plutôt que dans git |
| Couverture inférieure à l'existant | moyen | Comparaison chiffrée avant bascule |

## Effort

Environ **une journée**, dont l'essentiel en construction et vérification :

| | |
| --- | --- |
| Script d'extraction (2 passes, flux, TSV) | ~4 h |
| Fournisseur local + secours dans `definitions.ts` | ~2 h |
| Contrôles, comparaison de couverture, tests | ~2 h |
| Distribution (release, Dockerfile) et documentation | ~1 h |

Livrable par étapes : le script et l'artefact d'abord, mesure de la couverture
réelle ensuite, bascule seulement si elle égale ou dépasse les 19/20 actuels.

## À trancher avant de commencer

1. **Secours en ligne conservé, ou coupure totale du réseau sortant ?**
   (recommandation : conservé)
2. **Distribution : release GitHub, LFS, ou dans le dépôt ?**
   (recommandation : release)
3. **La licence CC BY-SA sur les données dérivées est-elle acceptée ?**
4. **La latence actuelle justifie-t-elle ce travail ?** Avec le préchargement au
   survol, le clic est déjà généralement instantané. Le vrai argument de
   l'option C n'est pas la vitesse, c'est **la suppression d'une dépendance
   externe et d'une analyse fragile**.
