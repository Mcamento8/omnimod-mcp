<#
.SYNOPSIS
  OmniMod MCP — one-command installer for Windows. | تثبيت الام سي بي بأمر واحد
.DESCRIPTION
  Downloads (or updates) the MCP into the correct per-user path, installs
  dependencies, builds, verifies, and registers a GLOBAL `omnimod-mcp`
  command that works from ANY folder in ANY terminal.

  Run this single command in cmd or PowerShell (normal user, NO admin needed).
  Paste it as ONE line:

    powershell -NoProfile -ExecutionPolicy Bypass -c "$f=$env:TEMP+'\omnimod-install.ps1'; irm https://raw.githubusercontent.com/Mcamento8/omnimod-mcp/main/scripts/install-windows.ps1 -OutFile $f; & $f"

  Re-running it later safely UPDATES the installation (git pull + rebuild).

.PARAMETER InstallDir
  Override the install path. Default: %LOCALAPPDATA%\OmniModMCP\omnimod-mcp
  (also honored via the OMNIMOD_MCP_DIR environment variable, mainly for tests).
.PARAMETER SkipTests
  Skip the selfcheck battery (faster; NOT recommended).
#>
param(
  [string]$InstallDir = "",
  [switch]$SkipTests
)

# NOTE: deliberately "Continue", NOT "Stop". Native tools (git/npm) write
# progress to stderr; if a caller redirects our stderr (2>&1, Tee-Object,
# remote sessions) every such line would otherwise TERMINATE the install
# mid-way. Correctness comes from the explicit $LASTEXITCODE / Test-Path
# checks after every critical step below — never from the preference.
$ErrorActionPreference = "Continue"
$RepoUrl = "https://github.com/Mcamento8/omnimod-mcp.git"
$Branch = "main"

if (-not $InstallDir) { $InstallDir = $env:OMNIMOD_MCP_DIR }
if (-not $InstallDir) { $InstallDir = Join-Path $env:LOCALAPPDATA "OmniModMCP\omnimod-mcp" }

function Step($n, $msg) { Write-Host ""; Write-Host "[$n] $msg" -ForegroundColor Cyan }
function Ok($msg) { Write-Host "  OK: $msg" -ForegroundColor Green }
function Fail($msg) { Write-Host "  ERROR: $msg" -ForegroundColor Red; exit 1 }

Write-Host "================================================================"
Write-Host "  OmniMod MCP installer — تثبيت الام سي بي"
Write-Host "  Target: $InstallDir"
Write-Host "================================================================"

# --- [1] Node.js 18+ -------------------------------------------------------
Step 1 "Checking Node.js (18+) ..."
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "  Node.js not found — trying winget ..." -ForegroundColor Yellow
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget) {
    winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements --silent
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
    $node = Get-Command node -ErrorAction SilentlyContinue
  }
  if (-not $node) { Fail "Install Node.js 18+ from https://nodejs.org then re-run this command." }
}
$major = (& node -p "process.versions.node.split('.')[0]")
if ([int]$major -lt 18) { Fail "Node.js $((& node --version)) is too old — install Node.js 18+ from https://nodejs.org" }
Ok "node $((& node --version))"

# --- [2] git ---------------------------------------------------------------
Step 2 "Checking git ..."
$git = Get-Command git -ErrorAction SilentlyContinue
foreach ($p in @("C:\Program Files\Git\bin\git.exe", "C:\Program Files\Git\cmd\git.exe")) {
  if ((-not $git) -and (Test-Path -LiteralPath $p)) { $git = @{ Source = $p } }
}
if (-not $git) {
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget) {
    Write-Host "  git not found — trying winget ..." -ForegroundColor Yellow
    winget install --id Git.Git --accept-source-agreements --accept-package-agreements --silent
    foreach ($p in @("C:\Program Files\Git\bin", "C:\Program Files\Git\cmd")) {
      if (Test-Path -LiteralPath $p) { $env:Path = "$p;" + $env:Path }
    }
    $git = Get-Command git -ErrorAction SilentlyContinue
  }
  if (-not $git) { Fail "Install git from https://git-scm.com then re-run this command." }
}
$gitExe = if ($git.Source) { $git.Source } else { "git" }
Ok "git $((& $gitExe --version))"

# --- [3] Download / update --------------------------------------------------
Step 3 "Downloading OmniMod MCP ..."
if ((Test-Path -LiteralPath (Join-Path $InstallDir ".git"))) {
  Write-Host "  Existing install found — updating (git pull) ..."
  & $gitExe -C $InstallDir fetch origin $Branch
  if ($LASTEXITCODE -ne 0) { Fail "git fetch failed — check your internet connection and re-run." }
  & $gitExe -C $InstallDir reset --hard "origin/$Branch"
  if ($LASTEXITCODE -ne 0) { Fail "git reset failed — delete $InstallDir and re-run." }
} else {
  if (Test-Path -LiteralPath $InstallDir) { Remove-Item -LiteralPath $InstallDir -Recurse -Force }
  New-Item -ItemType Directory -Path (Split-Path $InstallDir) -Force | Out-Null
  & $gitExe clone --branch $Branch --depth 1 $RepoUrl $InstallDir
  if ($LASTEXITCODE -ne 0) { Fail "git clone failed — check your internet connection and re-run." }
}
if (-not (Test-Path -LiteralPath (Join-Path $InstallDir "package.json"))) {
  Fail "Download incomplete (package.json missing) — delete $InstallDir and re-run."
}
Ok "sources ready at $InstallDir"

# --- [4] Dependencies + build ------------------------------------------------
Step 4 "Installing dependencies (npm install) ..."
Push-Location $InstallDir
try {
  & npm install
  if ($LASTEXITCODE -ne 0) { Fail "npm install failed — check your internet connection and re-run." }
  Ok "dependencies installed"

  Step 5 "Building (npm run build) ..."
  & npm run build
  if (($LASTEXITCODE -ne 0) -or (-not (Test-Path -LiteralPath (Join-Path $InstallDir "dist\index.js")))) {
    Fail "build failed — please report this at https://github.com/Mcamento8/omnimod-mcp/issues"
  }
  Ok "build clean"

  if (-not $SkipTests) {
    Step 6 "Verifying (npm run selfcheck) ..."
    & npm run selfcheck
    if ($LASTEXITCODE -ne 0) { Fail "selfcheck failed — please report this at https://github.com/Mcamento8/omnimod-mcp/issues" }
    Ok "selfcheck PASS"
  }
} finally {
  Pop-Location
}

# --- [7] Global command ------------------------------------------------------
Step 7 "Registering the global `omnimod-mcp` command (works from ANY folder) ..."
$npmBin = Join-Path $env:APPDATA "npm"
# A previous install leaves our explicit .cmd shim behind, and `npm link`
# aborts with EEXIST instead of overwriting it — remove npm's old shims
# first (link recreates all three right after).
foreach ($s in @("omnimod-mcp", "omnimod-mcp.cmd", "omnimod-mcp.ps1")) {
  $p = Join-Path $npmBin $s
  if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force }
}
Push-Location $InstallDir
try {
  & npm link
  if ($LASTEXITCODE -ne 0) { Fail "npm link failed — run PowerShell as normal user (not admin) and retry." }
} finally {
  Pop-Location
}
# npm's own .cmd shim calls dist\index.js directly (no node.exe) and breaks
# on machines without a .js file association — overwrite it with an explicit
# node invocation (quoting matters: the path usually contains spaces).
$shim = Join-Path $npmBin "omnimod-mcp.cmd"
$entry = Join-Path $InstallDir "dist\index.js"
if (Test-Path -LiteralPath $npmBin) {
  Set-Content -LiteralPath $shim -Value "@ECHO off`r`nnode `"$entry`" %*`r`n" -Encoding Ascii
}
$cmd = Get-Command omnimod-mcp -ErrorAction SilentlyContinue
if (-not $cmd) {
  Fail "Global command not found after install. Close and reopen the terminal, then run: omnimod-mcp setup"
}
Ok "global command: $($cmd.Source)"

Write-Host ""
Write-Host "================================================================"
Write-Host "  SUCCESS — تم التثبيت بنجاح!"
Write-Host "  From ANY terminal, in ANY folder, run:   omnimod-mcp"
Write-Host "  It prints your personal connect guide (Kilo / Cline / Cursor / Claude)."
Write-Host "================================================================"
Write-Host ""
& node (Join-Path $InstallDir "dist\index.js") setup
