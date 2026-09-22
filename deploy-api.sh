#!/usr/bin/env bash
# Met a jour l'API de voidbelt.com sur le VPS.
#
# Le serveur arbitre les parties RL2 et Jump'n Bump en ligne : il fait
# tourner le meme moteur que le navigateur. Tant qu'il n'a pas ce binaire,
# `/api/rl2/*` repond 404 et le multijoueur reste injoignable.
#
# A lancer DEPUIS UNE MACHINE DE DEVELOPPEMENT, pas sur le VPS :
#   bash deploy-api.sh
#
# Il envoie l'arbre exact du dernier commit, compile la-bas, sauvegarde la
# version en place, bascule, puis verifie. Rien n'est remplace tant que la
# compilation n'a pas abouti.
set -euo pipefail

hote="${VOIDBELT_HOST:-ubuntu@92.222.71.184}"
cle="${VOIDBELT_KEY:-$HOME/.ssh/id_rsa}"
ssh_opts=(-i "$cle" -o BatchMode=yes -o ConnectTimeout=20)

echo "== verifications locales"
git diff --quiet || { echo "!! des modifications ne sont pas commitees."; exit 1; }
git diff --cached --quiet || { echo "!! des modifications sont en attente de commit."; exit 1; }
commit=$(git rev-parse --short HEAD)
echo "   commit $commit"

archive=$(mktemp -t voidbelt-XXXX.tar.gz)
trap 'rm -f "$archive"' EXIT
git archive --format=tar.gz -o "$archive" HEAD
echo "   archive $(du -h "$archive" | cut -f1)"

echo "== envoi"
scp "${ssh_opts[@]}" "$archive" "$hote:/tmp/voidbelt-src.tar.gz"

echo "== compilation sur le serveur"
ssh "${ssh_opts[@]}" "$hote" 'set -e
  rm -rf /tmp/vb-stage && mkdir -p /tmp/vb-stage
  tar xzf /tmp/voidbelt-src.tar.gz -C /tmp/vb-stage

  # Les scores de Velocity vivent a cote du binaire : ils ne sont pas dans
  # le depot et ne doivent pas disparaitre a chaque mise a jour.
  cp -r /opt/voidbelt/data /tmp/vb-stage/data 2>/dev/null || true
  # Le cache de compilation fait gagner plusieurs minutes.
  cp -r /opt/voidbelt/target /tmp/vb-stage/target 2>/dev/null || true

  # `git archive` date les fichiers du commit, pas de maintenant. Poses a
  # cote d un cache plus recent, ils passent pour deja compiles et cargo ne
  # refait rien : on deploie alors l ancien moteur en croyant l avoir mis a
  # jour. Les redater est le seul garde-fou.
  find /tmp/vb-stage \( -name "*.rs" -o -name "Cargo.toml" -o -name "Cargo.lock" \) -print0 \
    | xargs -0 touch

  cd /tmp/vb-stage
  cargo build --release
  cargo test --manifest-path voidbelt-rl2/Cargo.toml --release 2>&1 | grep -E "^test result"
'

echo "== bascule"
ssh "${ssh_opts[@]}" "$hote" 'set -e
  h=$(date -u +%Y%m%dT%H%M%SZ)
  sudo systemctl stop voidbelt.service
  sudo mv /opt/voidbelt "/home/ubuntu/voidbelt-backup-$h"
  sudo mv /tmp/vb-stage /opt/voidbelt
  sudo chown -R ubuntu:ubuntu /opt/voidbelt "/home/ubuntu/voidbelt-backup-$h"
  sudo systemctl start voidbelt.service
  sleep 4
  echo "   service : $(systemctl is-active voidbelt.service)"
  echo "   sauvegarde : /home/ubuntu/voidbelt-backup-$h"
  # On ne garde que les trois dernieres : chacune traine son cache de
  # compilation, soit quelques centaines de megaoctets.
  ls -1dt /home/ubuntu/voidbelt-backup-* | tail -n +4 | xargs -r sudo rm -rf
'

echo "== verification, de l exterieur"
mauvais=0
for route in /api/health /api/rl2/rooms /api/jnb/rooms /api/velocity/leaderboard; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://api.voidbelt.com$route" || echo 000)
  printf '   %-30s %s\n' "$route" "$code"
  [ "$code" = "200" ] || mauvais=1
done
[ "$mauvais" = "0" ] || { echo "!! une route ne repond pas : la sauvegarde est sur le serveur."; exit 1; }
echo "== fini, commit $commit en ligne."
