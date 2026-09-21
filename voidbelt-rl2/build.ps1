# Compile le moteur RL2 en WebAssembly et le depose dans public/rl2/.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $PSScriptRoot
try {
  rustup target add wasm32-unknown-unknown | Out-Null
  cargo test --release
  cargo build --target wasm32-unknown-unknown --release
  $src = Join-Path $PSScriptRoot 'target\wasm32-unknown-unknown\release\voidbelt_rl2.wasm'
  $dst = Join-Path $root 'public\rl2\rl2.wasm'
  Copy-Item $src $dst -Force
  $kb = [math]::Round((Get-Item $dst).Length / 1KB)
  Write-Host "rl2.wasm mis a jour ($kb Ko)"
} finally {
  Pop-Location
}
