# Regenere le modele 3D du circuit apres une modification de src/trace.rs :
# les reperes viennent du moteur Rust, la geometrie du kit route.blend.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$blender = @(
  'C:\Program Files\Blender Foundation\Blender 5.0\blender.exe',
  'C:\Program Files\Blender Foundation\Blender 4.4\blender.exe'
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $blender) { throw 'Blender introuvable' }
Push-Location $PSScriptRoot
try {
  $json = Join-Path $PSScriptRoot 'target\piste.json'
  cargo run --release --bin piste -- $json
  $kit = Join-Path $root 'public\skidmania\assets\Circuit\route.blend'
  $glb = Join-Path $root 'public\skidmania\assets\Circuit\circuit.glb'
  & $blender -b $kit -P (Join-Path $PSScriptRoot 'blender\construire-circuit.py') -- $json $glb
  if ($LASTEXITCODE -ne 0) { throw 'Blender a echoue' }
  $mb = [math]::Round((Get-Item $glb).Length / 1MB, 1)
  Write-Host "circuit.glb mis a jour ($mb Mo)"
} finally {
  Pop-Location
}
