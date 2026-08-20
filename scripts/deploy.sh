#!/usr/bin/env bash
#
# Deployment over git: the server fetches the branch and rebuilds the image.
#
#   ./scripts/deploy.sh                 deploys to the ssh host "lms"
#   BOGGLE_SSH_HOST=other ./scripts/deploy.sh
#
# The server needs nothing but git and Docker. Nothing is copied from the local
# machine: the source comes from GitHub, so push before deploying.

set -euo pipefail

SSH_HOST="${BOGGLE_SSH_HOST:-lms}"
REMOTE_DIR="${BOGGLE_REMOTE_DIR:-/home/opc/boggle-multiplayer}"
REPO_URL="${BOGGLE_REPO_URL:-https://github.com/AltarBeastiful/boggle-multiplayer.git}"
BRANCH="${BOGGLE_BRANCH:-main}"

# `sudo` because the server user is not always in the docker group.
# To drop it: sudo usermod -aG docker $USER, then reconnect.
DOCKER="${BOGGLE_DOCKER:-sudo docker}"

echo "-> Deploying $BRANCH to $SSH_HOST:$REMOTE_DIR"

# Warn when the local repository is not pushed, since the server clones GitHub.
if git rev-parse --git-dir >/dev/null 2>&1; then
  if [ -n "$(git status --porcelain)" ]; then
    echo "  warning: uncommitted local changes will not be deployed"
  fi
  if [ -n "$(git log --oneline "origin/$BRANCH..$BRANCH" 2>/dev/null)" ]; then
    echo "  warning: local commits are not pushed to origin/$BRANCH"
  fi
fi

# ssh concatenates its arguments, so without escaping DOCKER="sudo docker"
# would split into two words on the server. printf %q emits valid shell.
remote_env=$(printf 'REMOTE_DIR=%q REPO_URL=%q BRANCH=%q DOCKER=%q' \
  "$REMOTE_DIR" "$REPO_URL" "$BRANCH" "$DOCKER")

ssh "$SSH_HOST" "$remote_env bash -s" <<'REMOTE'
set -euo pipefail

if [ ! -d "$REMOTE_DIR/.git" ]; then
  echo "-> First deployment: cloning into $REMOTE_DIR"
  git clone "$REPO_URL" "$REMOTE_DIR"
fi

cd "$REMOTE_DIR"
# The tracking ref is named on both sides of the refspec on purpose. Until git
# 1.8.4, `git fetch origin main` only wrote FETCH_HEAD and left origin/main at
# whatever the clone saw, so the reset below rebuilt that same old commit and
# the deploy reported success on code nobody had written that week. The server
# runs git 1.8.3.1, one release short of the fix.
git fetch --quiet origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
git checkout --quiet "$BRANCH"
# A deploy target mirrors the remote rather than merging into it. `merge
# --ff-only` refused to move after the history was rewritten, leaving the server
# stuck on commits that no longer exist upstream. Tracked files are reset;
# .env is ignored by git and therefore survives.
git reset --hard --quiet "origin/$BRANCH"

# What was fetched is what must be built. Whatever the reason a deploy ends up
# on another revision, saying so beats building the wrong one quietly, which is
# how the stale tracking ref above went unnoticed.
if [ "$(git rev-parse HEAD)" != "$(git rev-parse FETCH_HEAD)" ]; then
  echo "the working copy is at $(git rev-parse --short HEAD), not the $(git rev-parse --short FETCH_HEAD) just fetched"
  exit 1
fi
echo "-> Deployed revision: $(git log --oneline -1)"

# .env is not in the repository: create it on the first run, then add any new
# keys without ever overwriting a value already filled in.
if [ ! -f .env ]; then
  cp .env.example .env
  echo "-> .env created from .env.example"
else
  while IFS= read -r line; do
    case "$line" in '' | \#*) continue ;; esac
    key=${line%%=*}
    if ! grep -q "^${key}=" .env; then
      printf '%s\n' "$line" >> .env
      echo "-> .env: added key ${key}"
    fi
  done < .env.example
fi

# The bundled definitions are not in git: 7 MB of gzip, which never
# delta-compresses, so every rebuild left a permanent copy in the history. They
# come from the latest release instead.
#
# It has to happen here rather than in the Dockerfile, because compose mounts
# ./server/data over the image read-only: a file baked into the image would be
# shadowed at runtime by this very directory. Fetched only when missing or
# stale, and a failure is not fatal: without the file the game looks words up
# on Wiktionary live, which is what it did before the file existed.
defs=server/data/definitions.tsv.gz
base="https://github.com/AltarBeastiful/boggle-multiplayer/releases/latest/download"
if sums=$(curl -fsSL --max-time 60 "$base/SHA256SUMS" 2>/dev/null); then
  want=$(printf '%s\n' "$sums" | awk '$2 ~ /definitions\.tsv\.gz$/ { print $1 }')
  have=$(sha256sum "$defs" 2>/dev/null | cut -d' ' -f1 || true)
  if [ -z "$want" ]; then
    echo "-> The latest release has no definitions; Wiktionary will be used live"
  elif [ "$want" = "$have" ]; then
    echo "-> Definitions already up to date"
  else
    echo "-> Fetching the definitions from the latest release"
    if curl -fsSL --max-time 900 -o "$defs.tmp" "$base/definitions.tsv.gz" &&
      [ "$(sha256sum "$defs.tmp" | cut -d' ' -f1)" = "$want" ]; then
      mv "$defs.tmp" "$defs"
      echo "   verified, $(du -h "$defs" | cut -f1)"
    else
      rm -f "$defs.tmp"
      echo "   download failed or corrupt: keeping what is there, Wiktionary covers the rest"
    fi
  fi
else
  echo "-> No release to take the definitions from; Wiktionary will be used live"
fi

# The container runs as the "node" user, uid 1000. Docker creates a missing
# bind-mount directory as root, and the day's scores would then fail to save,
# quietly. Creating it here, owned by 1000, is the whole fix.
mkdir -p server/state
owner=$(stat -c '%u' server/state)
if [ "$owner" != "1000" ]; then
  sudo chown 1000:1000 server/state
  echo "-> server/state handed to uid 1000, so the container can write to it"
fi

echo "-> Building and starting"
$DOCKER compose up -d --build

echo "-> Waiting for the healthcheck"
for _ in $(seq 1 60); do
  status=$($DOCKER inspect --format '{{.State.Health.Status}}' boggle 2>/dev/null || echo unknown)
  [ "$status" = "healthy" ] && break
  [ "$status" = "unhealthy" ] && { echo "container unhealthy"; $DOCKER compose logs --tail 40 boggle; exit 1; }
  sleep 2
done

port=$(grep -E '^BOGGLE_PORT=' .env | cut -d= -f2)
port=${port:-3001}
host=$(grep -E '^BOGGLE_HOST=' .env | cut -d= -f2)
echo "-> Status: $($DOCKER inspect --format '{{.State.Health.Status}}' boggle)"
curl -fsS "http://127.0.0.1:$port/api/health" && echo

# The certificate can take a few seconds to be issued on the first start.
if [ -n "$host" ]; then
  echo "-> Checking HTTPS on https://$host"
  for _ in $(seq 1 30); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "https://$host/api/health" || echo 000)
    [ "$code" = "200" ] && { echo "   certificate valid, the game answers over HTTPS"; break; }
    sleep 3
  done
  [ "$code" = "200" ] || {
    echo "   HTTPS not ready yet (code $code), Traefik logs:"
    $DOCKER compose logs --tail 25 traefik
  }
fi
REMOTE

echo "Deployment complete"
