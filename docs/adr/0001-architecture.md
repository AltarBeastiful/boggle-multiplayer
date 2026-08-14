# ADR 0001 : architecture du Boggle multijoueur

- **Statut** : accepté, en production
- **Date** : 14 août 2026
- **Portée** : moteur de règles, serveur temps réel, client, déploiement, définitions

---

## Contexte

Rejouer au Boggle à plusieurs, à distance, sans compte ni installation. Les
règles font autorité : celles de [boggle.fr/regles.php](https://www.boggle.fr/regles.php)
et les variantes de [boggle.fr/variantes.php](https://www.boggle.fr/variantes.php).

Échelle visée : quelques joueurs par salle, quelques salles à la fois. Un serveur
personnel. Ce cadrage justifie la plupart des décisions ci-dessous. Il ne
justifierait pas les mêmes à l'échelle d'un service public.

---

## Décision 1 : un monorepo TypeScript avec un moteur de règles partagé

`packages/shared` contient la grille, l'adjacence, la recherche de chemin, les
barèmes, le solveur et le dictionnaire. Aucune entrée-sortie, aucune dépendance
au réseau. `server` et `client` en dépendent tous les deux.

**Pourquoi.** Les règles sont la partie subtile (variante Q=QU, accents,
doublons) et la seule qu'on veut tester sérieusement. Isolée, elle se teste sans
serveur ni navigateur : 26 tests unitaires couvrent les deux barèmes, les
chemins, la normalisation et le tirage.

**Conséquences.** Le client et le serveur ne peuvent pas diverger sur une règle.
En contrepartie, `shared` doit être compilé avant les deux autres, d'où le
`predev` à la racine et le `tsc --watch` en développement.

**Écarté.** Deux langages (Go côté serveur, TS côté client) : il aurait fallu
écrire deux fois le moteur, ou accepter qu'ils divergent.

---

## Décision 2 : le serveur fait autorité, le client n'affiche rien qu'il n'ait confirmé

Le serveur tire la grille, tient le chronomètre et valide chaque mot. Le client
soumet et attend l'accusé de réception.

**Pourquoi.** Sans cela, la grille et le dictionnaire sont dans le navigateur :
n'importe qui lit les solutions dans la console. Le jeu n'a plus d'intérêt.

**Conséquence agréable.** En début de manche le serveur résout la grille entière
(1 à 2 ms, mesuré) et garde le résultat. Valider un mot devient une consultation
de `Map` : c'est ce qui permet de distinguer *absent du dictionnaire* de *pas
traçable sur la grille*, et de lister les solutions en fin de manche sans travail
supplémentaire.

**Conséquence gênante.** Chaque mot coûte un aller-retour. Compensé par une
tolérance de 700 ms après le buzzer, pour qu'un mot parti à temps compte.

---

## Décision 3 : l'état vit en mémoire, sans base de données

Une `Map` de salles dans le processus. Les salles vides sont balayées après
30 minutes.

**Pourquoi.** Une partie est éphémère et ne survit pas à un redémarrage, donc
rien à conserver. Ajouter une base aurait signifié un conteneur de plus, des
migrations et des sauvegardes, pour des données qui ne valent rien une heure plus
tard.

**Conséquences.** Un redémarrage interrompt les parties en cours. Assumé : le
déploiement prend quelques secondes et les parties durent quelques minutes.
Le passage à plusieurs instances demanderait un adaptateur Redis pour Socket.IO
et un stockage partagé des salles, voir « Limites connues ».

**Identité des joueurs.** Un identifiant tiré au hasard, gardé dans le
`localStorage`. Une coupure réseau, un écran verrouillé ou un rafraîchissement
rendent au joueur ses mots et son score. C'est ce qui permet de se passer de
comptes.

---

## Décision 4 : socket.IO plutôt que des WebSockets bruts

**Pourquoi.** Reconnexion automatique, salles, accusés de réception. Sur mobile,
l'écran se verrouille au milieu d'une manche de trois minutes : la reconnexion
n'est pas un cas limite, c'est le cas courant.

**Écarté.** `ws` brut : il aurait fallu réécrire la reconnexion et les accusés,
c'est-à-dire l'essentiel de ce qu'apporte Socket.IO.

---

## Décision 5 : un dictionnaire permissif, ajustable sans reconstruction

`an-array-of-french-words` (MIT, lexique Dicollecte/Grammalecte) : 336 000 formes
brutes, 318 800 après normalisation. Les entrées à trait d'union ou apostrophe
sont écartées : elles ne sont de toute façon pas traçables.

**Pourquoi permissif.** Demande explicite : `déci`, `zut`, `eus`, `ait`,
`mangeassions` sont acceptés. Un lexique de Scrabble (ODS) serait plus strict et
plus « correct » en tournoi, mais il est sous droits.

**Ajustement.** `server/data/extra-words.txt` et `excluded-words.txt` sont lus au
démarrage. Corriger un oubli ne demande ni reconstruction ni publication.

---

## Décision 6 : les grilles sont tirées sans remise dans un sachet de 96 faces

Hasbro ne publie pas les faces des dés de l'édition française et aucune source
fiable ne les donne. Plutôt que d'inventer un jeu de dés « officiel », la
composition du sachet suit la fréquence des lettres en français (14 `E`, 7 `A`,
un seul `Z`), et la grille est tirée sans remise.

**Pourquoi.** Le tirage sans remise reproduit la propriété qui compte : on ne peut
pas obtenir trois `Z`, et les voyelles restent proportionnées. Un tirage
indépendant lettre par lettre ne le garantit pas.

**Contrôle qualité.** Chaque grille est résolue avant d'être servie ; en dessous
de 40 mots (4x4) ou 120 (5x5), elle est retirée. En pratique une grille 4x4 en
contient une centaine.

**Honnêteté.** C'est une modélisation, pas les dés officiels. Le README le dit.

---

## Décision 7 : l'annulation des doublons par défaut

Les pages de boggle.fr ne disent rien du sort d'un mot trouvé par plusieurs
joueurs. Le mode par défaut applique la règle classique du Boggle : le mot ne
rapporte rien à personne. L'autre mode reste disponible.

**Conséquence sur l'interface.** Les scores ne peuvent pas être affichés pendant
la manche : un mot ne vaut ses points que si personne d'autre ne l'a trouvé. On
n'affiche donc que le nombre de mots de chaque joueur, et les points au décompte.

---

## Décision 8 : la saisie se fait au clavier

Pas de tracé au doigt sur la grille. Le champ est utilisable sur mobile
(`font-size: 16px` pour éviter le zoom de Safari, `enterKeyHint`,
`autocapitalize`).

**Pourquoi.** C'est nettement plus rapide, et c'est ce que fait boggle.fr.

---

## Décision 9 : le départ de la manche est daté par le serveur

La grille est envoyée floutée avec un `startsAt`. Les mots soumis avant sont
refusés.

**Pourquoi.** Sans cela, le joueur dont la grille arrive 200 ms plus tôt commence
200 ms plus tôt. Le décompte de trois secondes absorbe la latence : tout le monde
voit les lettres au même instant.

---

## Décision 10 : un thème clair/sombre par jetons sémantiques

Les composants nomment des rôles (`bg-panel`, `text-fg-muted`), jamais des
couleurs (`bg-slate-800`). Les jetons sont redéfinis par thème. Le thème est posé
sur `<html>` avant le premier rendu, par un script en ligne dans `index.html`.

**Pourquoi les jetons.** Deux thèmes cohérents sans doubler chaque classe.

**Pourquoi le script en ligne.** Sans lui, la page s'affiche en clair puis bascule
en sombre : un clignotement à chaque chargement.

**Vérification.** Un audit de contraste a révélé trois couples sous le seuil AA
(`--fg-faint` à 3,36:1 en clair, `--accent`, `--ok`). Corrigés ; tous les couples
texte/fond passent AA.

---

## Décision 11 : publication par Traefik, certificat Let's Encrypt, domaine sslip.io

La pile embarque son propre Traefik : redirection 80 → 443, certificat obtenu par
défi TLS-ALPN sur le 443. Aucun autre port n'a eu besoin d'être ouvert.

**Le domaine.** Il n'y en avait pas. `sslip.io` résout n'importe quelle adresse IP
sans inscription : `193-122-4-195.sslip.io`. C'est un vrai nom de domaine, ce qui
suffit à Let's Encrypt pour émettre un certificat reconnu.

**Autonomie.** La pile ne dépend d'aucun conteneur existant. L'installation
WordPress qui occupait la machine a été arrêtée sans suppression de données.

**Le jeu n'est publié que sur la boucle locale** (`127.0.0.1:3001`) ; tout l'accès
public passe par Traefik.

---

## Décision 12 : définitions embarquées, Wiktionnaire en secours (options C puis B)

`GET /api/definition/:mot` consulte d'abord un fichier livré avec l'image
(4,2 Mo compressés, 315 813 mots, 99,1 % du dictionnaire), et ne retombe sur
l'appel en direct que pour les mots absents, ou si le fichier n'est pas fourni,
auquel cas le jeu fonctionne exactement comme avant.

Le fichier est construit par `scripts/build-definitions.mjs` depuis l'extraction
wiktextract du Wiktionnaire ; voir
[le plan de l'option C](../plan-option-c-definitions-embarquees.md).
**Le contenu embarqué est sous CC BY-SA 4.0** : le publier est une
redistribution, là où la simple consultation n'engageait rien. Voir
`server/data/LICENCE-DEFINITIONS.md`.

Le chemin de secours reste celui décrit ci-dessous, et garde tout son intérêt :
il couvre les mots absents de l'artefact sans attendre une reconstruction.

### Le secours : la recherche en direct (option B)

Il interroge le Wiktionnaire francophone à la demande.
Trois obstacles, tous mesurés avant d'être traités :

1. **Pas d'API de définition.** L'endpoint REST répond `501` sur fr.wiktionary. On
   récupère la page en texte brut (`action=query&prop=extracts`) et on l'analyse.
2. **Le jeu efface les accents** (`ETE`) là où le Wiktionnaire les indexe (`été`).
   Un index inverse de 130 830 entrées (15,9 Mo, mesuré) rend les graphies
   réelles. `COTE` renvoie *cote*, *coté*, *côte* et *côté*.
3. **Les formes fléchies n'ont pas de définition** mais un renvoi. Le lemme est
   suivi automatiquement : `DEDOUBLAIT` affiche la définition de *dédoubler*.

**Pourquoi pas un jeu de définitions embarqué (option C).** Il fallait d'abord
savoir si l'option B tenait. Elle tient : 19 mots sur 20 d'un échantillon
représentatif. L'option C est décrite dans
[`plan-option-c-definitions-embarquees.md`](../plan-option-c-definitions-embarquees.md).

**Ménagements.** Cache de 24 h, appels concurrents mutualisés, 8 requêtes
sortantes au plus, limitation par IP, `User-Agent` identifiant le projet. Une
absence de définition n'est jamais une erreur : l'interface propose un lien.

**Performance mesurée.** 0,5 à 0,9 s à froid, 0,3 s en cache (soit l'aller-retour
réseau seul). Le préchargement au survol rend le clic généralement instantané.
Depuis l'embarquement du fichier, ce chemin ne sert plus qu'aux 0,9 % de mots
manquants : les autres répondent en 0,01 s.

**Ce que ça coûte.** Le jeu dépend d'un service tiers pour cette fonction, et
l'analyse porte sur du texte destiné à des humains : une refonte de mise en forme
côté Wiktionnaire la casserait. Deux pièges de ce genre ont déjà été trouvés : un
filtre qui supprimait la définition de **toutes les formes au pluriel**, et des
renvois écrits « Forme d'adjectif » là où on n'attendait que « Forme de ».

---

## Limites connues

- **Une seule instance.** Les salles vivent dans le processus. Passer à plusieurs
  demanderait l'adaptateur Redis de Socket.IO et un stockage partagé.
- **Un redémarrage interrompt les parties en cours.**
- **Les définitions embarquées sont figées** à la date de l'extraction ; les mots
  absents passent par le Wiktionnaire, qui redevient une dépendance à l'exécution
  pour ces cas-là.
- **Les grilles ne sont pas les dés officiels**, faute de source publiée.
- **Pas de modération** : les pseudos ne sont pas filtrés. Acceptable pour un
  serveur entre amis, pas pour un service ouvert.
