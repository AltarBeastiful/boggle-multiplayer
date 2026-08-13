# Ajuster le dictionnaire

Le dictionnaire de base vient du paquet npm `an-array-of-french-words` (lexique
Dicollecte/Grammalecte, MIT) : environ 336 000 formes fléchies, conjugaisons et
pluriels compris. Après normalisation (majuscules, accents supprimés, entrées à
trait d'union ou apostrophe écartées), il reste ~318 800 mots jouables.

Deux fichiers optionnels, lus au démarrage du serveur, permettent de l'ajuster
sans reconstruire quoi que ce soit. Un mot par ligne, les lignes vides et celles
commençant par `#` sont ignorées. Les accents et la casse n'ont pas d'importance.

- `extra-words.txt` : mots à ajouter
- `excluded-words.txt` : mots à retirer

Exemple d'`extra-words.txt` :

```
# noms communs manquants
kombucha
mocktail
```

Redémarrez le serveur pour appliquer les changements.
