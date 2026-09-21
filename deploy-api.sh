#!/usr/bin/env bash
# Met a jour l'API de voidbelt.com sur le VPS.
#
# Le serveur arbitre les parties RL2 en ligne : il fait tourner le meme
# moteur que le navigateur. Tant qu'il n'a pas ce binaire, `/api/rl2/*`
# repond 404 et le multijoueur reste injoignable.
#
# A lancer SUR le VPS, depuis n'importe ou :
#   bash deploy-api.sh [chemin/du/depot]
set -euo pipefail

repo="${1:-$(cd "$(dirname "$0")" && pwd)}"
cd "$repo"

echo "== depot : $repo"
git pull --ff-only
cargo build --release
cargo test --manifest-path voidbelt-rl2/Cargo.toml --release

# Le service peut s'appeler autrement : on prend le premier qui existe.
unit=""
for candidat in voidbelt voidbelt-server voidbelt-api; do
  if systemctl list-unit-files --no-legend 2>/dev/null | grep -q "^${candidat}\.service"; then
    unit="$candidat"
    break
  fi
done

if [ -n "$unit" ]; then
  echo "== redemarrage de $unit"
  sudo systemctl restart "$unit"
  sleep 2
  systemctl --no-pager --lines=5 status "$unit" || true
else
  echo "!! aucun service systemd reconnu (voidbelt, voidbelt-server, voidbelt-api)."
  echo "   Redemarre le serveur a la main, puis relance la verification."
fi

echo "== verification"
for route in /api/health /api/rl2/rooms; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:8080$route" || echo 000)
  printf '   %-20s %s\n' "$route" "$code"
done
echo "== fini. /api/rl2/rooms doit repondre 200."
