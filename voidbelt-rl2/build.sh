#!/usr/bin/env bash
# Compile le moteur RL2 en WebAssembly et le depose dans public/rl2/.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(dirname "$here")"
cd "$here"
rustup target add wasm32-unknown-unknown >/dev/null
cargo test --release
cargo build --target wasm32-unknown-unknown --release
cp target/wasm32-unknown-unknown/release/voidbelt_rl2.wasm "$root/public/rl2/assets/rl2.wasm"
echo "rl2.wasm mis a jour ($(du -k "$root/public/rl2/assets/rl2.wasm" | cut -f1) Ko)"
