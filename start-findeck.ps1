# FinDeck one-click launcher.
#
# Why this script exists: the fork ships its own default home, `~/.findeck`
# (see packages/util/home-paths/src/index.ts), so FinDeck and the stock
# DeepSeek Harness checkout keep separate session histories. A `DSH_HOME`
# exported by some outer shell/profile overrides that default and collapses the
# fork onto `~/.dsh`, which is what mixed the two histories: the fork writes
# session format v2, the stock checkout writes v3, and neither build can read
# the other's logs -- so each one silently hides the sessions the other wrote,
# and the shared workspace registry then prunes memberships it cannot index.
# The stock build also exports `DSH_HOME=~/.dsh` into every shell it starts, so
# a FinDeck server started from a stock-DSH terminal (or by an agent running
# in one) inherits exactly that value; `start-findeck.ps1` sets
# `FINDECK_HOME` too, which the fork resolves ahead of `DSH_HOME`, and the
# fork's own resolver refuses an inherited stock home outright.
#
# Pinning the home here keeps the separation no matter what the ambient
# environment says. Use this launcher instead of a bare `pnpm run dev`.
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File start-findeck.ps1 [-NoBrowser] [-Port 3081]

param(
  [switch]$NoBrowser,
  [int]$Port = 3081
)

$ErrorActionPreference = 'Stop'

# The launcher sits at the repository root, so the repository is wherever this
# script lives; nothing here depends on a fixed checkout location.
$repo = $PSScriptRoot
$homeDir = Join-Path $env:USERPROFILE '.findeck'
$logDir = Join-Path $homeDir 'logs'
$logOut = Join-Path $logDir 'web-server.out.log'
$logErr = Join-Path $logDir 'web-server.err.log'

# Pin the home for this process AND for everything it spawns, before anything
# else reads the environment. `FINDECK_HOME` is the fork-owned name and wins
# over the `DSH_HOME` a stock harness shell may have exported; both are set so a
# child that only knows `DSH_HOME` still lands on the FinDeck root.
$env:FINDECK_HOME = $homeDir
$env:DSH_HOME = $homeDir

# The repository requires Node ^22.19 || >=24; take whatever PATH provides and
# fall back to the standard installation locations when it provides nothing.
$nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodeExe) {
  foreach ($candidate in @(
    (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
  )) {
    if ($candidate -and (Test-Path $candidate)) { $nodeExe = $candidate; break }
  }
}
if (-not $nodeExe) {
  throw 'node.exe not found on PATH or in the usual install locations'
}

if (-not (Test-Path (Join-Path $repo 'apps\cli\lib\bin.js'))) {
  throw "missing $repo\apps\cli\lib\bin.js - run 'npm run build' in $repo first"
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# The Web UI is served behind a per-boot token, so the bare
# `http://127.0.0.1:<port>/` answers "dsh web authentication required" and the
# authenticated URL `dsh web` prints (`...?token=...`) is the only one a
# browser may open. That URL is read back from the server's own startup line
# rather than assembled here, because only the server knows the token.
function Read-AuthenticatedUrl([string]$logPath, [int]$port) {
  if (-not (Test-Path $logPath)) { return $null }
  $pattern = "http://127\.0\.0\.1:$port/\?token=[A-Za-z0-9_\-]+"
  $hits = Select-String -Path $logPath -Pattern $pattern -AllMatches -ErrorAction SilentlyContinue
  if (-not $hits) { return $null }
  $all = @($hits | ForEach-Object { $_.Matches } | ForEach-Object { $_.Value })
  if ($all.Count -eq 0) { return $null }
  return $all[$all.Count - 1]
}

# A token URL is valid only for the server process that printed it: GET
# /?token=... answers 303 (token -> cookie exchange) when the token matches
# this boot and 401 otherwise. curl.exe because Windows PowerShell 5.1 turns
# 3xx responses into terminating errors under Invoke-WebRequest.
function Test-TokenUrl([string]$url, [string]$probeExe) {
  try {
    $code = & $probeExe -s -o NUL --max-time 5 --max-redirs 0 -w '%{http_code}' $url 2>$null
    return ("$code" -eq '303')
  } catch { return $false }
}

$curlExe = (Get-Command curl.exe -ErrorAction SilentlyContinue).Source
if (-not $curlExe) { $curlExe = Join-Path $env:SystemRoot 'System32\curl.exe' }
if (-not (Test-Path $curlExe)) { $curlExe = $null }

# The launch token exists only inside the server process (printed once to
# stdout, never persisted). When a server this launcher did not start already
# holds the port, its token is unrecoverable and the shortcut would open a URL
# the server rejects (the stale-token failure: browser shows "dsh web
# authentication required"). Port 3081 therefore belongs to this launcher:
# reuse a server only when its pid is the one recorded in `web-server.pid` and
# that server's log token still verifies. Anything else -- most importantly a
# fork started from a stock-DSH shell, which carries `DSH_HOME=~/.dsh` and so
# writes FinDeck's sessions and roundtable archives into the other product's
# home -- is stopped and replaced with a boot that has the home pinned here.
# Only node processes are stopped; anything else squatting on the port is left
# alone and the start below fails loudly.
$pidFile = Join-Path $logDir 'web-server.pid'
$listening = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
if ($listening) {
  $ownerIds = @($listening | Select-Object -ExpandProperty OwningProcess -Unique)
  $recordedPid = 0
  if (Test-Path $pidFile) { [void][int]::TryParse((Get-Content $pidFile -Raw).Trim(), [ref]$recordedPid) }
  $url = Read-AuthenticatedUrl $logOut $Port
  $verified = $false
  if ($url -and $curlExe -and $recordedPid -gt 0 -and ($ownerIds -contains $recordedPid)) {
    $verified = Test-TokenUrl $url $curlExe
  }
  if ($verified) {
    Write-Host "FinDeck already listening on port $Port (pid $recordedPid); this launcher started it and its log token verifies"
    Write-Host "  FINDECK_HOME=$homeDir"
  } else {
    foreach ($ownerId in $ownerIds) {
      $owner = Get-Process -Id $ownerId -ErrorAction SilentlyContinue
      if ($owner -and $owner.ProcessName -eq 'node') {
        Write-Host "stopping server pid $ownerId on port $Port (not this launcher's own process, or its token is stale)"
        Stop-Process -Id $ownerId -Force
      }
    }
    for ($i = 0; $i -lt 15; $i++) {
      Start-Sleep -Seconds 1
      if (-not (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)) { break }
    }
    $listening = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
    if ($listening) { throw "port $Port is still held by a non-node process; refusing to start FinDeck" }
  }
}

if (-not $listening) {
  $env:DSH_WEB_PORT = "$Port"
  Write-Host "starting FinDeck from $repo"
  Write-Host "  FINDECK_HOME=$homeDir  (sessions, settings, and roundtable archives stayed separate from ~/.dsh)"
  $proc = Start-Process -FilePath $nodeExe `
    -ArgumentList 'apps/cli/lib/bin.js', 'web', '--no-open', '--port', "$Port" `
    -WorkingDirectory $repo -WindowStyle Hidden `
    -RedirectStandardOutput $logOut -RedirectStandardError $logErr -PassThru
  Set-Content -Path $pidFile -Value "$($proc.Id)" -Encoding ascii

  $ready = $false
  for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Seconds 1
    if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) { $ready = $true; break }
    if ($proc.HasExited) { break }
  }
  if (-not $ready) {
    Write-Host "FinDeck did not come up; see $logErr"
    if (Test-Path $logErr) { Get-Content $logErr -Tail 20 }
    exit 1
  }
  Write-Host "FinDeck ready (pid $($proc.Id))"
}

$url = Read-AuthenticatedUrl $logOut $Port
if (-not $url) {
  # The port can accept connections a beat before the startup line is flushed;
  # re-read for a few seconds before falling back to the bare (unauthorized) URL.
  for ($i = 0; $i -lt 20 -and -not $url; $i++) {
    Start-Sleep -Milliseconds 250
    $url = Read-AuthenticatedUrl $logOut $Port
  }
}
if (-not $url) {
  $url = "http://127.0.0.1:$Port/"
  Write-Host "  warning: no authenticated URL in $logOut yet; opening $url (the page will ask you to reopen the URL dsh web printed)"
}
Write-Host "  $url"
if (-not $NoBrowser) { Start-Process $url }
