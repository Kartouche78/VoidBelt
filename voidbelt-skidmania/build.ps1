# Compile le moteur de Skid Mania en WebAssembly et le depose dans public/skidmania/.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $PSScriptRoot
try {
  rustup target add wasm32-unknown-unknown | Out-Null
  cargo test --release
  cargo build --lib --target wasm32-unknown-unknown --release
  $src = Join-Path $PSScriptRoot 'target\wasm32-unknown-unknown\release\voidbelt_skidmania.wasm'
  $dst = Join-Path $root 'public\skidmania\assets\skidmania.wasm'
  Copy-Item $src $dst -Force
  $kb = [math]::Round((Get-Item $dst).Length / 1KB)
  Write-Host "skidmania.wasm mis a jour ($kb Ko)"
} finally {
  Pop-Location
}
