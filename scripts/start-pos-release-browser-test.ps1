param(
  [string]$SettingsPath = (Join-Path $env:LOCALAPPDATA 'TradeOS\pos-release-test\pos-release.test.env.ps1'),
  [switch]$SmokeTest
)

$ErrorActionPreference = 'Stop'
$expectedProject = 'rtfowunsyrdygyvubnvs'
$expectedCommit = 'aa977d5dcf5eef51d73c3cbd3bfc1534afe6bc00'
$port = 3001
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Get-JwtPayload([string]$Token) {
  $parts = $Token.Split('.')
  if ($parts.Length -ne 3) { throw 'The supplied key is not a legacy service_role JWT supported by this app.' }
  $payload = $parts[1].Replace('-', '+').Replace('_', '/')
  switch ($payload.Length % 4) {
    2 { $payload += '==' }
    3 { $payload += '=' }
    1 { throw 'The supplied key is not a valid JWT.' }
  }
  return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload)) | ConvertFrom-Json
}

function Get-HttpStatus($ErrorRecord) {
  try { return [int]$ErrorRecord.Exception.Response.StatusCode } catch { return 0 }
}

function Format-StartupDiagnostic([string[]]$Lines, [string[]]$Secrets) {
  $text = ($Lines | Where-Object { $_ } | Select-Object -Last 12) -join ' | '
  foreach ($secret in $Secrets) {
    if ($secret) { $text = $text.Replace($secret, '[REDACTED]') }
  }
  $text = $text -replace '(?i)Bearer\s+[^\s,;]+', 'Bearer [REDACTED]'
  $text = $text -replace '\beyJ[\w-]*\.[\w-]+\.[\w-]+\b', '[REDACTED_JWT]'
  $text = $text -replace '(?i)(apikey|service_role|access_token|refresh_token|password)([=: ]+)\S+', '$1$2[REDACTED]'
  $text = $text -replace '\s+', ' '
  if ($text.Length -gt 1800) { $text = $text.Substring(0, 1800) }
  return $text
}

if ((git -C $root rev-parse HEAD).Trim() -ne $expectedCommit) {
  throw 'Refusing to start: this worktree is not at the expected aa977d5 commit.'
}
if ((git -C $root status --porcelain -- src).Count -gt 0) {
  throw 'Refusing to start: application source files have local changes.'
}
if (-not (Test-Path -LiteralPath $SettingsPath -PathType Leaf)) {
  throw 'Protected disposable test settings file is unavailable.'
}

# Load only the existing private test settings; never print their contents.
. $SettingsPath *> $null
if ($env:POS_RELEASE_TEST_TARGET -ne 'disposable-pos-atomic-sales') {
  throw 'Protected settings do not carry the disposable-test opt-in marker.'
}
$testUrl = [string]$env:POS_RELEASE_SUPABASE_URL
$publicUrl = [string]$env:NEXT_PUBLIC_SUPABASE_URL
$anonKey = [string]$env:POS_RELEASE_SUPABASE_ANON_KEY
if (-not $testUrl -or -not $publicUrl -or -not $anonKey) {
  throw 'Protected test settings lack the disposable Supabase URL or public API key.'
}
foreach ($candidate in @($testUrl, $publicUrl)) {
  if (([uri]$candidate).Host -ne "$expectedProject.supabase.co") {
    throw 'Protected settings point outside the confirmed disposable project.'
  }
}

$portInUse = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
if ($portInUse.Count -gt 0) { throw 'Port 3001 is already in use; no process was started.' }

$keyPointer = [IntPtr]::Zero
$serviceKey = $null
$serverProcess = $null
$keepServer = $false
try {
  if ($SmokeTest) {
    # This sentinel overrides any same-named dotenv value without granting access.
    $serviceKey = 'smoke-test-no-service-credential'
  } else {
    $secureKey = Read-Host 'Enter the disposable project legacy service_role JWT (input is hidden)' -AsSecureString
    if (-not $secureKey -or $secureKey.Length -eq 0) { throw 'No service_role key was entered.' }
    $keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
    $serviceKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
    $claims = Get-JwtPayload $serviceKey
    if ($claims.role -ne 'service_role') {
      throw 'The supplied key is not a legacy service_role JWT; no server was started.'
    }

    # Validate the signing key against the disposable project's Auth Admin API.
    # The response body and all request headers are discarded.
    $adminUri = $testUrl.TrimEnd('/') + '/auth/v1/admin/users?per_page=1'
    try {
      $adminResponse = Invoke-WebRequest -Method Get -Uri $adminUri -Headers @{
        apikey = $serviceKey
        Authorization = "Bearer $serviceKey"
      } -UseBasicParsing -TimeoutSec 15
      $adminStatus = [int]$adminResponse.StatusCode
      $adminResponse = $null
    } catch {
      $adminStatus = Get-HttpStatus $_
    }
    if ($adminStatus -ne 200) {
      throw "The supplied service_role key was rejected by the disposable project's Auth Admin API (HTTP $adminStatus). No server was started."
    }
  }

  $nextServer = Join-Path $root 'scripts\start-pos-release-next-server.cjs'
  if (-not (Test-Path -LiteralPath $nextServer -PathType Leaf)) {
    throw 'The isolated Next.js server launcher is unavailable.'
  }
  $nodeCommand = Get-Command node.exe -ErrorAction Stop
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $nodeCommand.Source
  $startInfo.Arguments = '"' + $nextServer + '"'
  $startInfo.WorkingDirectory = $root
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardInput = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true

  # Start with a small non-secret OS environment. Test credentials/settings
  # are added explicitly below; unrelated parent or production variables do
  # not flow into the Next process.
  $childEnvironment = $startInfo.EnvironmentVariables
  $childEnvironment.Clear()
  foreach ($name in @('PATH','SystemRoot','WINDIR','TEMP','TMP','LOCALAPPDATA','APPDATA','USERPROFILE','HOMEDRIVE','HOMEPATH','COMSPEC','PATHEXT','ProgramFiles')) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if ($value) { $childEnvironment[$name] = $value }
  }
  $childEnvironment['NODE_ENV'] = 'development'
  $childEnvironment['NODE_OPTIONS'] = '--no-warnings'
  # This launcher uses the standard custom-server API, which does not run the
  # Next CLI bundler selector. Empty explicitly selects webpack instead of
  # inheriting a parent Turbopack setting or its out-of-root symlink restriction.
  $childEnvironment['TURBOPACK'] = ''
  $childEnvironment['NEXT_TELEMETRY_DISABLED'] = '1'
  $childEnvironment['PORT'] = [string]$port
  $childEnvironment['HOSTNAME'] = '127.0.0.1'
  $childEnvironment['POS_TEST_NEXT_PROJECT_ROOT'] = Join-Path (Join-Path $root '.next') ('pos-release-next-' + [guid]::NewGuid().ToString('N'))
  $childEnvironment['POS_RELEASE_TEST_TARGET'] = 'disposable-pos-atomic-sales'
  $childEnvironment['SUPABASE_URL'] = $testUrl
  $childEnvironment['NEXT_PUBLIC_SUPABASE_URL'] = $publicUrl
  $childEnvironment['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = $anonKey
  $childEnvironment['SUPABASE_SERVICE_ROLE_KEY'] = $serviceKey

  $serverProcess = New-Object System.Diagnostics.Process
  $serverProcess.StartInfo = $startInfo
  if (-not $serverProcess.Start()) { throw 'Next.js test server did not start.' }
  # Drain both pipes asynchronously so a startup error cannot deadlock the child.
  # The wrapper emits only sanitized startup diagnostics and suppresses normal logs.
  $stdoutTask = $serverProcess.StandardOutput.ReadToEndAsync()
  $stderrTask = $serverProcess.StandardError.ReadToEndAsync()
  [void]$childEnvironment.Remove('SUPABASE_SERVICE_ROLE_KEY')
  $serviceKeyForRedaction = $serviceKey
  $serviceKey = $null
  $claims = $null
  $deadline = [DateTime]::UtcNow.AddSeconds(90)
  $confirmedHosts = @()
  $lastPreflightResult = 'no HTTP response received'
  while ([DateTime]::UtcNow -lt $deadline) {
    if ($serverProcess.HasExited) {
      $serverProcess.WaitForExit()
      $stdoutText = $stdoutTask.GetAwaiter().GetResult()
      $stderrText = $stderrTask.GetAwaiter().GetResult()
      $diagnostic = Format-StartupDiagnostic @($stdoutText -split "`r?`n") @($serviceKeyForRedaction, $anonKey)
      $diagnostic += ' ' + (Format-StartupDiagnostic @($stderrText -split "`r?`n") @($serviceKeyForRedaction, $anonKey))
      $diagnostic = $diagnostic.Trim()
      if (-not $diagnostic) { $diagnostic = 'The child emitted no startup diagnostics.' }
      throw "Next.js test server exited before the target preflight succeeded (exit code $($serverProcess.ExitCode)). Sanitized startup output: $diagnostic"
    }
    try {
      $preflight = Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:3001/api/pos-release-environment' -TimeoutSec 4
      $confirmedHosts = @($preflight.supabaseUrls | ForEach-Object { ([uri]$_).Host })
      if ($confirmedHosts.Count -gt 0 -and @($confirmedHosts | Where-Object { $_ -ne "$expectedProject.supabase.co" }).Count -eq 0) {
        break
      }
      $lastPreflightResult = 'response did not identify the confirmed disposable project'
      $confirmedHosts = @()
    } catch {
      $status = Get-HttpStatus $_
      $lastPreflightResult = if ($status -gt 0) { "HTTP $status from /api/pos-release-environment" } else { 'request timed out or connection was refused' }
      if ($status -ge 500) { break }
      Start-Sleep -Seconds 1
    }
  }
  if ($confirmedHosts.Count -eq 0) {
    try { $serverProcess.StandardInput.WriteLine('DUMP_STARTUP_DIAGNOSTICS'); $serverProcess.StandardInput.Flush(); Start-Sleep -Milliseconds 150 } catch { }
    try { $serverProcess.Kill() } catch { }
    try { $serverProcess.WaitForExit() } catch { }
    try { $stdoutText = $stdoutTask.GetAwaiter().GetResult() } catch { $stdoutText = '' }
    try { $stderrText = $stderrTask.GetAwaiter().GetResult() } catch { $stderrText = '' }
    $diagnostic = Format-StartupDiagnostic @($stdoutText -split "`r?`n") @($serviceKeyForRedaction, $anonKey)
    $diagnostic += ' ' + (Format-StartupDiagnostic @($stderrText -split "`r?`n") @($serviceKeyForRedaction, $anonKey))
    if ($diagnostic.Trim()) { $diagnostic = "; sanitized child output: $($diagnostic.Trim())" } else { $diagnostic = '' }
    throw "Port 3001 failed the disposable-project target preflight; that test server was stopped. Last result: $lastPreflightResult$diagnostic"
  }

  $serverProcess.StandardInput.WriteLine('PREFLIGHT_SUCCESS')
  $serverProcess.StandardInput.Flush()

  if ($SmokeTest) {
    try { $serverProcess.Kill(); $serverProcess.WaitForExit() } catch { }
    Write-Output "Launcher smoke test PASS: isolated Next server started and /api/pos-release-environment confirmed $($confirmedHosts -join ', ')."
    Write-Output 'The smoke server was stopped; port 3000 was not touched and no service credential was used.'
  } else {
    $keepServer = $true
    Write-Output "Test service_role key accepted for project $expectedProject (Auth Admin HTTP 200)."
    Write-Output "Next.js test server started on http://127.0.0.1:3001 (PID $($serverProcess.Id))."
    Write-Output "Target preflight PASS: $($confirmedHosts -join ', ')."
    Write-Output 'The service_role key was supplied only in memory to the Next server process; it was not written to a file or emitted to logs.'
  }
} finally {
  if ($serverProcess -and -not $keepServer -and -not $serverProcess.HasExited) {
    try { $serverProcess.Kill(); $serverProcess.WaitForExit() } catch { }
  }
  if ($serverProcess -and -not $keepServer) {
    try { if ($stdoutTask) { $stdoutText = $stdoutTask.GetAwaiter().GetResult() } } catch { }
    try { if ($stderrTask) { $stderrText = $stderrTask.GetAwaiter().GetResult() } } catch { }
  }
  if ($keyPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
  }
  if ($secureKey) { $secureKey.Dispose() }
  $serviceKey = $null
  $serviceKeyForRedaction = $null
  $claims = $null
  $adminUri = $null
  $adminResponse = $null
  if ($serverProcess) { $serverProcess.Dispose() }
}
