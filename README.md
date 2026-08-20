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

Ouvrez http://localhost:5173, créez une partie, partagez le lien `/r/CODE`. En
production, un seul processus sert l'API, les WebSockets et le client :

```bash
npm run build && npm start                          # http://localhost:3001
docker build -t boggle . && docker run -p 3001:3001 boggle
```

## Jouer

- Manche de **3 minutes**, réglable, ou sans limite.
- Lettres **adjacentes**, diagonales comprises ; une case ne sert pas deux fois.
- Mots de **3 lettres ou plus**, **accents ignorés** : `cœur` s'écrit `COEUR`.
- Décompte **3-4 → 1, 5 → 2, 6 → 3, 7 → 5, 8+ → 11**, cumulé de manche en manche.

La saisie se fait au clavier ou **sur la grille**, au doigt comme à la souris. Le
coup de sifflet ne retire pas la grille : chacun choisit, pour lui seul, de voir
les solutions ou de continuer à chercher hors chrono. La page des solutions
groupe les mots par longueur, marque qui les a trouvés et affiche leur
définition.

Les dés sont montrés **tels qu'ils sont tombés**, tournés d'un quart ou d'un
demi-tour, comme au sortir du gobelet. Le `M` renversé étant un `W` et le `N`
couché un `Z`, ces lettres sont soulignées. Réglage `Orientation des dés` pour
qui préfère les lettres droites.

### La grille du jour

Sur la page d'accueil, une **grille par jour, la même pour tout le monde**, qui
se joue seul. Le chronomètre compte mais n'arrête rien ; une fois la grille
terminée viennent les solutions manquées et le **classement du jour**, où les ex
æquo sont départagés par le temps mis. Elle se déduit de la date, n'est donc
stockée nulle part, et change à **minuit à Paris**.

### Variantes (réglées par l'hôte, avant la partie)

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
| **Orientation des dés** | *dans tous les sens* (par défaut) ou *toutes droites* |

Les pages de boggle.fr ne disent rien du sort des mots trouvés par plusieurs
joueurs : le mode par défaut applique la règle classique du Boggle (annulation),
et l'autre mode reste disponible.

## Comment ça marche

```
packages/shared/   Moteur de règles pur TypeScript, partagé client/serveur
server/            Fastify + Socket.IO, salles en mémoire, aucune base de données
client/            React + Vite + Tailwind, interface en français, pensée mobile
```

**Le serveur fait autorité** : il tire la grille, tient le chronomètre et valide
chaque mot, le client n'affichant que ce qu'il confirme. En début de manche le
serveur résout la grille entière en 1 à 2 ms, ce qui rend la validation d'un mot
immédiate et donne les mots manqués à la fin. Chaque joueur garde un identifiant
dans son `localStorage` : une coupure réseau ou un rafraîchissement lui rendent
ses mots et son score.

Les grilles sont tirées **sans remise** dans un sachet de 96 faces suivant la
fréquence des lettres en français, faute de source publiée pour les dés de
l'édition française. Chacune est vérifiée avant d'être servie : voyelles en
proportion correcte, et 40 mots au minimum en 4x4, 120 en 5x5.

```bash
npm test               # moteur de règles
npm run test:trace     # entrées tactiles et souris, via Playwright
npm run test:round     # les deux façons de terminer une manche, à deux joueurs
npm run test:daily     # la grille du jour, de l'accueil au classement
npm run test:dict      # conjugaisons acceptées, orthographes fantômes refusées
npm run test:restart   # tue le serveur en pleine manche et vérifie la reprise
```

## Le dictionnaire

**437 164 mots**, assemblés de trois sources :

- `an-array-of-french-words` (MIT), tiré des
  [listes de Letterpress](https://github.com/lorenbrichter/Words) (CC0) : la
  base, figée en 2019, d'où `orc` et `blog` absents ;
- [**Grammalecte**](https://grammalecte.net/) (MPL 2.0), le dictionnaire
  orthographique de Firefox et LibreOffice, à jour et tenu à la main : 100 034
  mots de plus ;
- le **Wiktionnaire** pour les conjugaisons, calculées en dernier pour que tout
  verbe accepté ait ses temps, et pour les verbes qui manquaient encore,
  retenus s'ils sont attestés par un corpus (Lexique 3.83).

Volontairement permissif : `déci`, `zut`, `eus` et `mangeassions` passent. Les
entrées à trait d'union ou apostrophe sont écartées, n'étant pas traçables sur
une grille. À l'inverse, **606 mots sont retirés** : la liste de base a vieilli
et contient des formes qu'aucun dictionnaire n'a jamais eues, `blêmaient` (le
verbe est `blêmir`) ou `bihoreaus` (le pluriel est `bihoreaux`). Les accords
réguliers, eux, restent : `frigorifiante` est correct même si aucun
dictionnaire ne le liste. Tout cela s'ajuste un mot par ligne, relu au
démarrage du serveur : voir
[`server/data/README.md`](server/data/README.md).

Les définitions viennent du Wiktionnaire : **433 018 mots, 859 874 sens**, soit
99,1 % du dictionnaire, servis en 0,01 s. Un mot polysémique montre ses trois
principaux sens et les homographes sont classés par fréquence d'usage, donc
`COTE` donne *côté*, *côte*, *cote*, *coté* dans cet ordre. Le Wiktionnaire
ignore beaucoup de mots venus de Grammalecte, mais Grammalecte sait de quel
lemme il a formé chacun : ces mots reprennent la définition du lemme, ou à
défaut annoncent « Forme de … ». Les 4 157 restants sont listés dans
`words-without-definition.txt`, publié avec la release. Sans le fichier, le
serveur interroge le Wiktionnaire en direct, ce qu'il fait de toute façon pour
les mots qu'il ne couvre pas.

### Le construire et le publier

Les deux fichiers de mots (1,5 Mo de texte) sont dans git, un par licence.
`definitions.tsv.gz` (9 Mo de gzip) n'y est pas : c'est un **asset de release**,
que [`scripts/deploy.sh`](scripts/deploy.sh) récupère en vérifiant son SHA-256.

```bash
npm run lexicon -- --write          # régénère le lexique
node scripts/build-definitions.mjs  # ~5 min, 715 Mo lus en flux
npm run test:dict                   # vérifie, hors ligne, en une seconde

git commit -am "…" && git push
git tag v1.0.1 && git push origin v1.0.1
```

Le tag suffit : la CI ([`release.yml`](.github/workflows/release.yml)) rejoue
les tests, reconstruit le dictionnaire et publie le lexique, les définitions, le
jeu empaqueté et leurs `SHA256SUMS`. Seule la dernière version des définitions
est conservée. Grammalecte reste sous MPL 2.0 et le reste sous CC BY-SA 4.0,
d'où deux fichiers séparés : voir
[`server/data/LICENCE-DEFINITIONS.md`](server/data/LICENCE-DEFINITIONS.md).

## Déploiement

Un seul processus Node, aucune base de données. L'état vit en mémoire et se
recopie dans des fichiers JSON, donc **un redémarrage ne coupe pas une manche en
cours** : les salles reviennent avec les mots et les scores de chacun.

```bash
cp .env.example .env      # choisir le port
docker compose up -d --build
./scripts/deploy.sh       # ssh + git pull + définitions + rebuild + healthcheck
```

`deploy.sh` clone le dépôt au premier passage, puis met à jour et reconstruit. Il
ne copie rien depuis le poste local, donc **poussez avant de déployer**.
Variables utiles : `BOGGLE_SSH_HOST` (défaut `wordpress`), `BOGGLE_REMOTE_DIR`,
`BOGGLE_BRANCH`, `BOGGLE_PORT`.

La pile embarque son propre **Traefik** : HTTPS par Let's Encrypt, domaine dans
`BOGGLE_HOST`, et Socket.IO passe sans réglage. Elle ne touche à aucun conteneur
existant. Pour plusieurs instances il faudrait un adaptateur Redis pour
Socket.IO et un stockage partagé des salles, inutile à l'échelle d'un serveur
entre amis.
