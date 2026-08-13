# Plan : définition d'un mot au clic

État : **à valider**. La page des solutions est en place et marque déjà les mots
trouvés / non trouvés ; il ne manque que la définition au clic. Ce document
explique pourquoi cette dernière partie mérite un accord préalable, et ce que je
propose de faire.

## Pourquoi ce n'est pas une simple requête HTTP

Trois obstacles, tous mesurés plutôt que supposés.

**1. Il n'y a pas d'API de définition utilisable telle quelle.**
L'endpoint REST propre (`/api/rest_v1/page/definition/{mot}`), celui qu'utilisent
les applications Wikipédia, répond **501 Internal error** sur `fr.wiktionary.org`.
Il n'est déployé que sur le Wiktionnaire anglais. Il reste l'API historique
(`action=query&prop=extracts&explaintext=1`), qui renvoie la page entière en texte
brut avec ses sections, donc un travail d'extraction par expressions régulières.

**2. Notre dictionnaire a perdu les accents.**
Les règles imposent d'ignorer les accents : nous stockons `ETE`, pas `été`. Or le
Wiktionnaire indexe les formes accentuées. Il faut donc un index inverse
normalisé → graphies réelles. Mesuré sur notre lexique :

| | |
| --- | --- |
| formes accentuées | 135 019 |
| clés de l'index | 130 830 |
| clés à plusieurs graphies | 4 123 |
| coût mémoire | **15,9 Mo** |

Le coût mémoire est acceptable. L'ambiguïté l'est moins : `COTE` donne
`coté`, `côte`, `côté`, trois mots différents. Il faudra présenter les trois.

**3. Les formes fléchies n'ont pas de définition propre.**
C'est le point décisif : la majorité des solutions d'une grille sont des pluriels
et des conjugaisons. Test sur dix mots réels :

| mot | résultat |
| --- | --- |
| `chien`, `été`, `côté`, `râtelier`, `déci`, `zut` | définition correcte du premier coup |
| `boudâtes`, `dédoublait`, `uropodes`, `labourés` | **pas de définition** |

Les pages des formes fléchies existent, mais leur contenu est un renvoi
(« Première personne du pluriel du passé simple de *bouder* »), pas une
définition. Il faut donc un **second appel** vers le lemme.

## Ce que je propose

**Serveur.** Un point d'entrée `GET /api/definition/:mot` qui encapsule tout :

1. index inverse (construit au chargement du dictionnaire) → graphies candidates ;
2. pour chaque graphie, appel à l'API `extracts` ;
3. extraction de la section `== Français ==`, puis de la première section
   grammaticale (`Nom commun`, `Verbe`, `Adjectif`, `Interjection`…) ;
4. si la section trouvée est une **forme fléchie**, lecture du lemme cité et
   second appel pour récupérer sa définition ;
5. réponse `{ entries: [{ graphie, nature, definition, lemme? }] }`, ou
   `{ entries: [] }` si rien n'a été trouvé, et **jamais une erreur HTTP**, pour que
   l'interface se dégrade proprement.

**Cache.** Indispensable : une grille de 229 mots, c'est potentiellement 229
requêtes sortantes. Cache mémoire clé→réponse, plafonné (~5 000 entrées, TTL 24 h),
et **une seule requête en vol par mot** (déduplication des appels concurrents).
Le cache seul rend le coût négligeable en usage réel : les mots courants
reviennent d'une grille à l'autre.

**Politesse réseau.** `User-Agent` identifiant le projet (exigé par Wikimedia),
plafond de concurrence sortante (3 à 4), et limitation par IP côté serveur pour
qu'un client ne puisse pas nous transformer en robot d'aspiration.

**Client.** Au clic sur un mot de la page des solutions, la définition s'ouvre
**en ligne sous le mot** (pas de fenêtre modale : c'est plus confortable au doigt),
avec trois états : chargement, définition(s), et « définition indisponible » avec
un lien vers le Wiktionnaire. Le clic conserve son effet actuel (tracé sur la grille).

## Ce que ça coûte, ce que ça risque

- **Effort** : une demi-journée environ, l'extraction et le renvoi vers le lemme
  étant le gros du travail.
- **Dépendance externe** : le jeu se met à dépendre d'un service tiers. Contenue,
  puisque l'échec est silencieux et n'affecte que l'affichage d'une définition.
- **Fragilité de l'extraction** : nous analysons du texte destiné à des humains.
  Un changement de mise en forme côté Wiktionnaire casserait l'extraction. À
  couvrir par des tests sur un échantillon de pages figées.
- **Couverture partielle** : même avec le renvoi vers le lemme, certains mots
  n'auront pas de définition. C'est acceptable : boggle.fr a la même limite.

## Trois options, à trancher

| | effort | couverture | dépendance |
| --- | --- | --- | --- |
| **A. Lien sortant seul**, le clic ouvre la page du Wiktionnaire | ~1 h | totale | aucune |
| **B. Plan ci-dessus**, définition intégrée, avec renvoi au lemme | ~1/2 j | bonne | Wiktionnaire à l'exécution |
| **C. Jeu de définitions embarqué**, extrait du dump Wiktionnaire | ~1 j + build | bonne, figée | aucune à l'exécution |

**Ma recommandation : B**, qui correspond à ce que fait boggle.fr et à ce qui a
été demandé. L'option A est un repli honnête si l'on veut zéro dépendance ; elle
peut d'ailleurs être livrée en premier, puisque le client aurait de toute façon
besoin du lien de secours prévu en B.

L'option C mérite un mot : le dump du Wiktionnaire français pèse plusieurs Go, et
en extraire un fichier de définitions exploitable est un travail de traitement de
données à part entière. Elle n'a d'intérêt que si l'on tient à un jeu totalement
autonome, sans appel sortant.
