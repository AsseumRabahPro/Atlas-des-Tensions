$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Resolve-NodeDir {
  if ($env:NODE_DIR -and (Test-Path (Join-Path $env:NODE_DIR "node.exe"))) {
    return $env:NODE_DIR
  }

  $known = "C:\Users\Asseu\AppData\Local\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v24.14.0-win-x64"
  if (Test-Path (Join-Path $known "node.exe")) {
    return $known
  }

  $found = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter node.exe -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName

  if ($found) {
    return Split-Path -Parent $found
  }

  throw "Node.js introuvable. Installe Node LTS ou definis NODE_DIR."
}

$nodeDir = Resolve-NodeDir
$npmCmd = Join-Path $nodeDir "npm.cmd"

if (-not (Test-Path $npmCmd)) {
  throw "npm.cmd introuvable dans $nodeDir"
}

Start-Process powershell -WorkingDirectory $repoRoot -ArgumentList @(
  "-NoExit",
  "-Command",
  "& '$npmCmd' --prefix apps/api run dev"
) | Out-Null

Start-Process powershell -WorkingDirectory $repoRoot -ArgumentList @(
  "-NoExit",
  "-Command",
  "& '$npmCmd' --prefix apps/web run dev"
) | Out-Null

Write-Host "API + Web lances dans 2 terminaux."
Write-Host "Web:  http://localhost:3000"
Write-Host "API:  http://localhost:4000/health"
