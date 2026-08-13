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

## Les règles implémentées

- Manche de **3 minutes** (réglable).
- On enchaîne les lettres **adjacentes**, horizontalement, verticalement ou en
  diagonale ; une case ne sert **pas deux fois** dans le même mot.
- Mots de **3 lettres ou plus**.
- Les **accents ne comptent pas** : `E` vaut É, È, Ê ; `cœur` s'écrit `COEUR`.
- Décompte : **3-4 → 1, 5 → 2, 6 → 3, 7 → 5, 8+ → 11**.
- Les points **s'additionnent d'une manche à l'autre**. La partie s'arrête au
  nombre de manches ou au score fixé par l'hôte.

Chaque manche démarre par un **décompte de 3 secondes**, grille floutée : le
serveur donne l'instant du départ, donc tout le monde voit les lettres au même
moment, même si sa grille est arrivée quelques dizaines de millisecondes plus tôt.

À la fin de la manche, la **page des solutions** liste les mots de la grille
groupés par longueur, en marquant ceux que vous avez trouvés, ceux qu'un autre
joueur a trouvés et ceux que personne n'a vus. Un clic trace le mot sur la grille.

L'interface suit le **thème clair ou sombre** du système, avec un bouton pour
forcer l'un ou l'autre. Les contrastes des deux thèmes vérifient le niveau AA.

### Variantes disponibles (réglées par l'hôte, avant la partie)

| Variante | Effet |
| --- | --- |
| **QU à la place de Q** | Une case `Q` vaut indifféremment `Q` ou `QU` |
| **4 lettres minimum** | Les mots de 3 lettres sont refusés |
| **Décompte simplifié** | 1 point par lettre au-delà de la 3<sup>e</sup> (8 lettres → 5 points) |
| **Grille 5x5** | Big Boggle, 25 dés |
| **Durée** | 1, 2, 3 ou 5 minutes |
| **Doublons** | *annulés* (règle classique : un mot trouvé par plusieurs joueurs ne rapporte rien) ou *comptés pour tous* |
| **Fin de partie** | 1, 3, 5 manches, 100 points, ou sans fin |
| **Indice** | Affiche « X mots sur N » pendant la manche, **masqué par défaut** |

Les pages de boggle.fr ne disent rien du sort des mots trouvés par plusieurs
joueurs : le mode par défaut applique la règle classique du Boggle (annulation),
et l'autre mode reste disponible.

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
