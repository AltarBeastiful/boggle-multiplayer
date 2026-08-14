#!/usr/bin/env bash
#
# Déploiement par git : le serveur récupère la branche et reconstruit l'image.
#
#   ./scripts/deploy.sh                 déploie sur l'hôte ssh « wordpress »
#   BOGGLE_SSH_HOST=autre ./scripts/deploy.sh
#
# Le serveur n'a besoin que de git et de Docker. Rien n'est copié depuis le
# poste local : la source vient de GitHub, donc poussez avant de déployer.

set -euo pipefail

SSH_HOST="${BOGGLE_SSH_HOST:-wordpress}"
REMOTE_DIR="${BOGGLE_REMOTE_DIR:-/home/ubuntu/boggle-multiplayer}"
REPO_URL="${BOGGLE_REPO_URL:-https://github.com/AltarBeastiful/boggle-multiplayer.git}"
BRANCH="${BOGGLE_BRANCH:-main}"

# `sudo` car l'utilisateur du serveur n'est pas dans le groupe docker.
# Pour vous en passer : sudo usermod -aG docker $USER (puis reconnexion).
DOCKER="${BOGGLE_DOCKER:-sudo docker}"

echo "→ Déploiement de $BRANCH sur $SSH_HOST:$REMOTE_DIR"

# Avertir si le dépôt local n'est pas poussé : le serveur clone depuis GitHub.
if git rev-parse --git-dir >/dev/null 2>&1; then
  if [ -n "$(git status --porcelain)" ]; then
    echo "  attention : modifications locales non committées, elles ne partiront pas"
  fi
  if [ -n "$(git log --oneline "origin/$BRANCH..$BRANCH" 2>/dev/null)" ]; then
    echo "  attention : des commits locaux ne sont pas poussés vers origin/$BRANCH"
  fi
fi

# ssh concatène ses arguments : sans échappement, DOCKER="sudo docker" se
# scinderait en deux mots côté serveur. printf %q produit du shell valable.
remote_env=$(printf 'REMOTE_DIR=%q REPO_URL=%q BRANCH=%q DOCKER=%q' \
  "$REMOTE_DIR" "$REPO_URL" "$BRANCH" "$DOCKER")

ssh "$SSH_HOST" "$remote_env bash -s" <<'REMOTE'
set -euo pipefail

if [ ! -d "$REMOTE_DIR/.git" ]; then
  echo "→ Premier déploiement : clonage dans $REMOTE_DIR"
  git clone "$REPO_URL" "$REMOTE_DIR"
fi

cd "$REMOTE_DIR"
git fetch --quiet origin "$BRANCH"
git checkout --quiet "$BRANCH"
git merge --ff-only "origin/$BRANCH"
echo "→ Version déployée : $(git log --oneline -1)"

# .env n'est pas dans le dépôt : on le crée au premier passage, et on y ajoute
# ensuite les nouvelles clés sans jamais écraser une valeur déjà renseignée.
if [ ! -f .env ]; then
  cp .env.example .env
  echo "→ .env créé depuis .env.example"
else
  while IFS= read -r line; do
    case "$line" in '' | \#*) continue ;; esac
    key=${line%%=*}
    if ! grep -q "^${key}=" .env; then
      printf '%s\n' "$line" >> .env
      echo "→ .env : clé ${key} ajoutée"
    fi
  done < .env.example
fi

echo "→ Construction et démarrage"
$DOCKER compose up -d --build

echo "→ Attente du healthcheck"
for _ in $(seq 1 60); do
  status=$($DOCKER inspect --format '{{.State.Health.Status}}' boggle 2>/dev/null || echo unknown)
  [ "$status" = "healthy" ] && break
  [ "$status" = "unhealthy" ] && { echo "conteneur unhealthy"; $DOCKER compose logs --tail 40 boggle; exit 1; }
  sleep 2
done

port=$(grep -E '^BOGGLE_PORT=' .env | cut -d= -f2)
port=${port:-3001}
host=$(grep -E '^BOGGLE_HOST=' .env | cut -d= -f2)
echo "→ État : $($DOCKER inspect --format '{{.State.Health.Status}}' boggle)"
curl -fsS "http://127.0.0.1:$port/api/health" && echo

# Le certificat peut mettre quelques secondes à être émis au premier démarrage.
if [ -n "$host" ]; then
  echo "→ Vérification HTTPS sur https://$host"
  for _ in $(seq 1 30); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "https://$host/api/health" || echo 000)
    [ "$code" = "200" ] && { echo "   certificat valide, le jeu répond en HTTPS"; break; }
    sleep 3
  done
  [ "$code" = "200" ] || {
    echo "   HTTPS pas encore prêt (code $code), journaux Traefik :"
    $DOCKER compose logs --tail 25 traefik
  }
fi
REMOTE

echo "✓ Déploiement terminé"
