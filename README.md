# Boggle multijoueur

Le jeu de Boggle en temps réel, hébergé sur un serveur central. On crée une
salle, on partage un lien, on joue à plusieurs, sans compte ni installation.

Les règles suivent [boggle.fr/regles.php](https://www.boggle.fr/regles.php) et
les variantes [boggle.fr/variantes.php](https://www.boggle.fr/variantes.php).

## Démarrer

```bash
npm install
npm run dev            # serveur sur :3001, client sur :5173
```

Ouvrez http://localhost:5173, créez une partie, partagez le lien `/r/CODE`.

En production, un seul processus sert l'API, les WebSockets et le client :

```bash
npm run build
npm start              # http://localhost:3001
```

Ou avec Docker :

```bash
docker build -t boggle .
docker run -p 3001:3001 boggle
```

Les tests du moteur de règles :

```bash
npm test
```

## La grille du jour

Sur la page d'accueil, une **grille par jour, la même pour tout le monde**, qui
se joue seul, sans salle ni code. Le chronomètre **compte mais n'arrête rien** :
on cherche aussi longtemps qu'on veut, et on décide quand voir les solutions.
Une fois terminée, la grille affiche les solutions manquées et le **classement
du jour**, où les ex æquo sont départagés par le temps mis.

La grille n'est stockée nulle part : elle se **déduit de la date**, donc
n'importe quel serveur reconstruit la même. Le jour change à **minuit à Paris**,
pas à minuit UTC, qui tombe à une ou deux heures du matin ici.

## Les règles implémentées

- Manche de **3 minutes** (réglable).
- On enchaîne les lettres **adjacentes**, horizontalement, verticalement ou en
  diagonale ; une case ne sert **pas deux fois** dans le même mot.
- Mots de **3 lettres ou plus**.
- Les **accents ne comptent pas** : `E` vaut É, È, Ê ; `cœur` s'écrit `COEUR`.
- Décompte : **3-4 → 1, 5 → 2, 6 → 3, 7 → 5, 8+ → 11**.
- Les points **s'additionnent d'une manche à l'autre**. La partie s'arrête au
  nombre de manches ou au score fixé par l'hôte.

Chaque manche démarre par un **décompte de 2 secondes** (« Prêt ? », « Partez ! »),
grille floutée : le
serveur donne l'instant du départ, donc tout le monde voit les lettres au même
moment, même si sa grille est arrivée quelques dizaines de millisecondes plus tôt.

**Le coup de sifflet ne retire pas la grille.** La manche est comptée, mais les
lettres restent devant vous : à la place du champ de saisie apparaît un bouton
**« Voir les solutions »**, et chacun le presse quand il veut. Un joueur lit les
réponses pendant qu'un autre cherche encore ce qu'il a manqué.

En **durée « sans limite »**, il n'y a pas de sifflet : l'hôte arrête la manche
avec ce même bouton, pour tout le monde à la fois.

À la fin de la manche, la **page des solutions** liste les mots de la grille
groupés par longueur, en marquant ceux que vous avez trouvés, ceux qu'un autre
joueur a trouvés et ceux que personne n'a vus. Un clic trace le mot sur la grille
**et affiche sa définition**, tirée du Wiktionnaire francophone.

Le mot ouvert garde une **teinte un peu plus soutenue** que ses voisins : la
couleur dit toujours qui l'a trouvé, la nuance dit lequel on lit. Sur téléphone,
la définition est ramenée dans l'écran si le mot touché la laissait hors champ.

La saisie se fait au clavier, ou **sur la grille** : on tape les lettres une à
une, ou on glisse le doigt d'une lettre à l'autre. Les deux gestes obéissent à
la même règle, un appui n'étant qu'un glissé d'une seule case. Retoucher la
dernière lettre l'enlève. Le mot composé se dépose dans le champ, reste
modifiable au clavier, et part avec le bouton d'envoi.

```bash
npm run test:trace     # vraies entrées tactiles et souris, via Playwright
npm run test:round     # les deux façons de terminer une manche, à deux joueurs
npm run test:daily     # la grille du jour, de l'accueil au classement
```

Quand un mot est accepté, son chemin est tracé une fraction de seconde sur la
grille puis s'efface : rien ne reste affiché entre deux mots. Pour supprimer
complètement ce tracé, compilez avec `VITE_WORD_TRACE=off` (variable reprise par
`docker compose` comme argument de build).

L'interface suit le **thème clair ou sombre** du système, avec un bouton pour
forcer l'un ou l'autre. Les contrastes des deux thèmes vérifient le niveau AA.

```bash
npm run audit:mobile   # parcourt une partie en 412x915, mesure et photographie
```

Le script relève les cibles tactiles sous 44 px, les textes sous 12 px, les
débordements horizontaux et ce qui reste lisible sans faire défiler. Mesures
utiles : un dé fait 89 px de côté, la grille et le champ tiennent ensemble dans
453 px, donc un clavier virtuel peut en prendre 460 sans rien couper.

### Variantes disponibles (réglées par l'hôte, avant la partie)

| Variante | Effet |
| --- | --- |
| **QU à la place de Q** | Une case `Q` vaut indifféremment `Q` ou `QU` |
| **4 lettres minimum** | Les mots de 3 lettres sont refusés |
| **Décompte simplifié** | 1 point par lettre au-delà de la 3<sup>e</sup> (8 lettres → 5 points) |
| **Grille 5x5** | Big Boggle, 25 dés |
| **Durée** | 1, 2, 3, 5 minutes, ou **sans limite** : l'hôte arrête la manche |
| **Doublons** | *annulés* (règle classique : un mot trouvé par plusieurs joueurs ne rapporte rien) ou *comptés pour tous* |
| **Fin de partie** | 1, 3, 5 manches, 100 points, ou sans fin |
| **Indice** | Affiche « X mots sur N » pendant la manche, **masqué par défaut** |

Les pages de boggle.fr ne disent rien du sort des mots trouvés par plusieurs
joueurs : le mode par défaut applique la règle classique du Boggle (annulation),
et l'autre mode reste disponible.

## Décisions d'architecture

- [ADR 0001 : architecture](docs/adr/0001-architecture.md) : moteur partagé,
  serveur faisant autorité, état en mémoire, tirage des grilles, thème,
  publication HTTPS, définitions en direct.
- [Option C : définitions embarquées](docs/plan-option-c-embedded-definitions.md) :
  plan détaillé, chiffré, pour supprimer l'appel au Wiktionnaire à l'exécution.

## Comment ça marche

```
packages/shared/   Moteur de règles pur TypeScript, partagé client/serveur
  board.ts           adjacence, recherche de chemin (avec la variante Q=QU)
  dice.ts            sachet de 96 faces, tirage d'une grille jouable
  scoring.ts         les deux barèmes
  solver.ts          énumère tous les mots d'une grille
  dictionary.ts      recherche exacte + par préfixe
server/            Fastify + Socket.IO, salles en mémoire, aucune base de données
  rooms.ts           cycle de vie d'une salle, manche, décompte, reconnexion
client/            React + Vite + Tailwind, interface en français, pensée mobile
```

**Le serveur fait autorité.** Il tire la grille, tient le chronomètre et valide
chaque mot ; le client n'affiche que ce que le serveur confirme. En début de
manche le serveur résout la grille entière (1 à 2 ms), ce qui rend la validation
d'un mot immédiate et permet d'afficher les mots manqués à la fin.

**Identité et reconnexion.** Chaque joueur garde un identifiant dans son
`localStorage`. Une coupure réseau, un écran verrouillé ou un rafraîchissement
de page rendent au joueur ses mots et son score cumulé.

**Salles.** Code à 4 caractères sans lettres ambiguës (ni `O`/`0`, ni `I`/`1`),
lien direct `/r/CODE`. L'hôte règle les variantes ; s'il se déconnecte, le rôle
passe automatiquement à un autre joueur. Les salles vides sont nettoyées.

## Le dictionnaire

Environ **318 800 mots** issus du lexique Dicollecte/Grammalecte (paquet npm
`an-array-of-french-words`, MIT) : formes fléchies, conjugaisons et pluriels
compris. Volontairement permissif : `déci`, `zut`, `eus`, `ait` et
`mangeassions` sont acceptés. Les entrées à trait d'union ou apostrophe sont
écartées : elles ne sont pas traçables sur une grille.

Pour l'ajuster sans reconstruire : voir [`server/data/README.md`](server/data/README.md).

### Les définitions

`GET /api/definition/:mot` répond depuis un fichier embarqué de
**315 813 mots, 688 722 sens, 99,1 % du dictionnaire, 7 Mo compressés**, servi
en 0,01 s. Un mot polysémique montre ses trois principaux sens, et les
homographes sont classés par fréquence d'usage réelle : `COTE` donne *côté*,
*côte*, *cote*, *coté* dans cet ordre.
Il est construit par :

```bash
node scripts/build-definitions.mjs      # ~10 min, 715 Mo téléchargés en flux
```

Le fichier est **facultatif** : sans lui, le serveur interroge le Wiktionnaire en
direct, comme avant. C'est aussi ce qui arrive pour les mots qu'il ne couvre pas.
Le contenu embarqué est sous CC BY-SA 4.0 :
voir [`server/data/LICENCE-DEFINITIONS.md`](server/data/LICENCE-DEFINITIONS.md).

Le chemin de secours doit traiter trois obstacles, dans `server/src/definitions.ts` :

- il n'existe pas d'API de définition exploitable (l'endpoint REST répond 501 sur
  fr.wiktionary), donc la page est récupérée en texte brut puis analysée ;
- le jeu ignore les accents (`ETE`) alors que le Wiktionnaire les indexe (`été`) :
  un index inverse (~16 Mo, 130 830 entrées) redonne les graphies réelles, et
  `COTE` renvoie bien *cote*, *coté*, *côte* et *côté* ;
- les formes fléchies ne portent pas de définition mais un renvoi : le lemme est
  suivi automatiquement, donc `DEDOUBLAIT` affiche la définition de *dédoubler*.

Les réponses sont mises en cache (24 h), les appels concurrents pour un même mot
sont mutualisés, les requêtes sortantes plafonnées à 4 et limitées par IP. Une
absence de définition n'est jamais une erreur : l'interface propose alors un lien
vers le Wiktionnaire.

## Les grilles

Hasbro ne publie pas les faces des dés de l'édition française. Plutôt que
d'inventer un jeu de dés « officiel », le tirage se fait **sans remise** dans un
sachet de 96 faces dont la composition suit la fréquence des lettres en français
(14 `E`, 7 `A`, un seul `Z`…). Une grille ne peut donc pas contenir trois `Z`, et
les voyelles restent proportionnées.

Chaque grille est ensuite vérifiée avant d'être servie : proportion de voyelles
correcte et nombre de mots suffisant (40 en 4x4, 120 en 5x5), sinon elle est
retirée. En pratique une grille 4x4 contient une centaine de mots.

## Déploiement

Un seul processus Node, aucune base de données, l'état vit en mémoire.

```bash
cp .env.example .env      # choisir le port
docker compose up -d --build
```

La pile est **autonome** : elle ne touche à aucun conteneur existant. Le port
publié se règle avec `BOGGLE_PORT` dans `.env`.

### Mise à jour par git

```bash
./scripts/deploy.sh       # ssh + git pull + rebuild + healthcheck
```

Le script clone le dépôt au premier passage, puis se contente d'un
`git merge --ff-only` et d'un `docker compose up -d --build`. Il ne copie rien
depuis le poste local : **poussez avant de déployer**. Variables utiles :
`BOGGLE_SSH_HOST` (défaut `wordpress`), `BOGGLE_REMOTE_DIR`, `BOGGLE_BRANCH`.

Sur le serveur, la mise à jour manuelle tient en deux lignes :

```bash
cd ~/boggle-multiplayer && git pull
sudo docker compose up -d --build
```

### Derrière Traefik

`docker-compose.yml` contient un bloc `labels` prêt à l'emploi, commenté : il
suit l'entrypoint `websecure` et le resolver `myresolver` déjà configurés. Il
faut aussi décommenter le bloc `networks` (Traefik ne route que vers les
conteneurs de son propre réseau) et faire pointer `BOGGLE_HOST` vers le serveur.
Socket.IO passe sans réglage particulier, Traefik relaie l'upgrade WebSocket.

### Monter en charge

Pour plusieurs instances il faudrait un adaptateur Redis pour Socket.IO et un
stockage partagé des salles. Inutile à l'échelle d'un serveur entre amis : un
processus tient largement la charge.
