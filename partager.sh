#!/usr/bin/env bash
# Ouvre le jeu local au reste du monde, le temps d'une session entre amis.
#
# Le serveur local a deja tout : le site ET les salons RL2. Il ne lui manque
# qu'une adresse publique. `cloudflared` en fabrique une a la volee, sans
# compte ni configuration. Rien n'est installe sur la machine.
#
#   npm start          # dans un terminal : lance le serveur
#   bash partager.sh   # dans un autre : ouvre le tunnel
set -euo pipefail

port="${PORT:-8080}"
bin="${TMPDIR:-/tmp}/cloudflared.exe"
[ "$(uname -s)" = "Linux" ] && bin="${TMPDIR:-/tmp}/cloudflared"

if [ ! -x "$bin" ]; then
  echo "== recuperation de cloudflared"
  base="https://github.com/cloudflare/cloudflared/releases/latest/download"
  file="cloudflared-windows-amd64.exe"
  [ "$(uname -s)" = "Linux" ] && file="cloudflared-linux-amd64"
  curl -fsSL -o "$bin" "$base/$file"
  chmod +x "$bin"
fi

if ! curl -fs -o /dev/null --max-time 5 "http://127.0.0.1:$port/api/rl2/rooms"; then
  echo "!! rien ne repond sur le port $port. Lance d'abord : npm start"
  exit 1
fi

echo "== ouverture du tunnel, patiente quelques secondes"
log="${TMPDIR:-/tmp}/tunnel-rl2.log"
"$bin" tunnel --url "http://localhost:$port" --no-autoupdate > "$log" 2>&1 &
pid=$!
trap 'kill "$pid" 2>/dev/null || true' EXIT

for _ in $(seq 1 25); do
  url=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" "$log" 2>/dev/null | head -1) || true
  if [ -n "${url:-}" ]; then
    echo
    echo "   A partager avec tes potes :  $url/rl2/"
    echo
    echo "   Laisse cette fenetre ouverte. Ctrl+C pour fermer le tunnel."
    wait "$pid"
    exit 0
  fi
  sleep 2
done
echo "!! le tunnel n'a pas demarre :"; tail -15 "$log"; exit 1
