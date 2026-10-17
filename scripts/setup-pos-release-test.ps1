param(
  [ValidateSet("Verify", "PreflightAuth", "Provision", "RefreshSessions")]
  [string]$Mode = "Verify"
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Fixed disposable target coordinates only. This script never reads .env.local.
$TargetRef = "rtfowunsyrdygyvubnvs"
$DbHost = "aws-0-ap-southeast-2.pooler.supabase.com"
$DbPort = "5432"
$DbName = "postgres"
$DbUser = "postgres.rtfowunsyrdygyvubnvs"
$SupabaseUrl = "https://rtfowunsyrdygyvubnvs.supabase.co"
$AppUrl = "http://127.0.0.1:3000"
$Marker = "disposable-pos-atomic-sales"
$PsqlDir = "C:\Program Files\PostgreSQL\18\bin"
$PsqlPath = Join-Path $PsqlDir "psql.exe"
$PrivateDir = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "TradeOS\pos-release-test"
$PgPassPath = Join-Path $PrivateDir "target.pgpass"
$StatePath = Join-Path $PrivateDir "fixture-state.json"
$EnvPath = Join-Path $PrivateDir "pos-release.test.env.ps1"
$DatabaseUrl = "postgresql://" + $DbUser + "@" + $DbHost + ":" + $DbPort + "/" + $DbName + "?sslmode=require"

function Protect-PrivatePath {
  param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][bool]$IsDirectory)
  $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  if ($IsDirectory) {
    $grant = "*" + $sid + ":(OI)(CI)F"
  } else {
    $grant = "*" + $sid + ":F"
  }
  # icacls updates only the DACL; it does not read or write audit/SACL data.
  $icaclsPath = Join-Path $env:SystemRoot "System32\icacls.exe"
  $result = & $icaclsPath $Path "/inheritance:r" "/grant:r" $grant 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Could not restrict the private path DACL (icacls exit $LASTEXITCODE)."
  }
}

function Write-PrivateText {
  param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$Text)
  [System.IO.File]::WriteAllText($Path, $Text, [System.Text.UTF8Encoding]::new($false))
  Protect-PrivatePath -Path $Path -IsDirectory $false
}

function ConvertFrom-SecureStringLocal {
  param([Parameter(Mandatory = $true)][SecureString]$Value)
  $pointer = [IntPtr]::Zero
  try {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    if ($pointer -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
  }
}

function Initialize-PrivateDirectory {
  New-Item -ItemType Directory -Path $PrivateDir -Force | Out-Null
  Protect-PrivatePath -Path $PrivateDir -IsDirectory $true
  foreach ($privateFile in @($PgPassPath, $StatePath, $EnvPath)) {
    if (Test-Path -LiteralPath $privateFile -PathType Leaf) {
      Protect-PrivatePath -Path $privateFile -IsDirectory $false
    }
  }
}

function Read-TestDatabasePassword {
  $securePassword = Read-Host "Enter the NEW disposable test project's database password" -AsSecureString
  if ($securePassword.Length -eq 0) { throw "A database password is required." }
  $password = ConvertFrom-SecureStringLocal -Value $securePassword
  try {
    $escaped = $password.Replace("\", "\\").Replace(":", "\:")
    $line = "{0}:{1}:{2}:{3}:{4}" -f $DbHost, $DbPort, $DbName, $DbUser, $escaped
    Write-PrivateText -Path $PgPassPath -Text $line
  } finally {
    $password = $null
    $escaped = $null
    $line = $null
    $securePassword.Dispose()
  }
  $env:PGPASSFILE = $PgPassPath
  $env:PATH = "$PsqlDir;$env:PATH"
}

function Invoke-TestPsql {
  param([string]$Query, [string]$File, [switch]$PromptForPassword, [switch]$IncludeConnectionInfo)
  $connection = "host=$DbHost port=$DbPort dbname=$DbName user=$DbUser sslmode=require connect_timeout=10"
  if ($File) {
    $psqlArguments = @("--no-psqlrc", "--quiet", "--set=ON_ERROR_STOP=1", "--dbname", $connection, "--file", $File)
  } else {
    $psqlArguments = @("--no-psqlrc", "--quiet", "--tuples-only", "--no-align", "--field-separator", "|", "--set=ON_ERROR_STOP=1", "--dbname", $connection, "--command", $Query)
    if ($IncludeConnectionInfo) {
      $psqlArguments += @("--command", "\conninfo")
    }
  }
  if ($PromptForPassword) {
    $psqlArguments = @("--password") + $psqlArguments
    # Leave stderr attached to the terminal so libpq's password prompt stays interactive and hidden.
    $output = & $PsqlPath @psqlArguments
  } else {
    $output = & $PsqlPath @psqlArguments 2>&1
  }
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    $safeOutput = if ($PromptForPassword) { "See the psql diagnostic displayed above." } else { ($output | ForEach-Object { "$_" }) -join " " }
    throw "Target PostgreSQL command failed with exit code $exitCode. $safeOutput"
  }
  return $output
}

function Verify-TestDatabase {
  param([switch]$UseStoredPassword)
  if (
    $TargetRef -ne "rtfowunsyrdygyvubnvs" -or
    $DbHost -ne "aws-0-ap-southeast-2.pooler.supabase.com" -or
    $DbPort -ne "5432" -or
    $DbName -ne "postgres" -or
    $DbUser -ne "postgres.$TargetRef" -or
    $SupabaseUrl -ne "https://$TargetRef.supabase.co"
  ) {
    throw "The fixed database username or Auth API URL does not match the disposable target ref."
  }
  if (-not (Test-Path -LiteralPath $PsqlPath -PathType Leaf)) {
    throw "The configured PostgreSQL client was not found at $PsqlPath."
  }
  $env:PATH = "$PsqlDir;$env:PATH"
  $query = "begin read only; select current_database(), current_user, current_setting('transaction_read_only'), current_setting('server_version'), current_setting('server_version_num'); commit;"
  if ($UseStoredPassword) {
    $env:PGPASSFILE = $PgPassPath
    $rows = Invoke-TestPsql -Query $query -IncludeConnectionInfo
  } else {
    $previousPassfile = $env:PGPASSFILE
    $previousPassword = $env:PGPASSWORD
    do {
      $promptOnlyPassfile = Join-Path $env:TEMP ("pos-release-no-passfile-" + [guid]::NewGuid().ToString("N"))
    } while (Test-Path -LiteralPath $promptOnlyPassfile)
    $env:PGPASSFILE = $promptOnlyPassfile
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    try {
      $rows = Invoke-TestPsql -Query $query -PromptForPassword -IncludeConnectionInfo
    } finally {
      if ($previousPassfile) { $env:PGPASSFILE = $previousPassfile }
      else { Remove-Item Env:PGPASSFILE -ErrorAction SilentlyContinue }
      if ($previousPassword) { $env:PGPASSWORD = $previousPassword }
      else { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
    }
  }
  $outputLines = @($rows | ForEach-Object { "$_".Trim() } | Where-Object { $_ })
  $databasePrefix = "^" + [regex]::Escape($DbName) + "\|"
  $row = @($outputLines | Where-Object { $_ -match $databasePrefix }) | Select-Object -First 1
  if (-not $row) { throw "The read-only identity query returned no database row." }
  $parts = $row.Split("|")
  if ($parts.Count -ne 5) { throw "The read-only identity query returned an unexpected shape." }
  if ($parts[0] -ne $DbName) { throw "Connected database name did not match the configured target." }
  if ($parts[2] -ne "on") { throw "The verification transaction was not read-only." }
  $serverVersionNum = 0
  if (-not [int]::TryParse($parts[4], [ref]$serverVersionNum)) { throw "The target returned an invalid server_version_num." }
  $serverMajor = [math]::Floor($serverVersionNum / 10000)
  if ($serverMajor -ne 17) { throw "The target server major version is $serverMajor; expected PostgreSQL 17." }
  $tlsLine = @($outputLines | Where-Object { $_ -match '^SSL Connection\|true$' -or $_ -match '^SSL connection \(protocol:\s*TLS' }) | Select-Object -First 1
  if (-not $tlsLine) { throw "psql client connection information did not confirm TLS." }
  $tlsProtocol = @($outputLines | Where-Object { $_ -match '^SSL Protocol\|' } | ForEach-Object { ($_ -split '\|', 2)[1] }) | Select-Object -First 1
  if (-not $tlsProtocol -and $tlsLine -match '^SSL connection \(protocol:\s*([^,\)]+)') { $tlsProtocol = $Matches[1] }
  if (-not $tlsProtocol) { $tlsProtocol = "TLS" }
  Write-Output "Verified target ref: $TargetRef (fixed pooler endpoint and project-scoped username)"
  Write-Output "Verified database: $($parts[0]); database role: $($parts[1]); PostgreSQL: $($parts[3]) (server_version_num $serverVersionNum); TLS: $tlsProtocol (confirmed by psql client connection info); verification transaction: read-only"
}

function Assert-TargetIdentity {
  if (
    $TargetRef -ne "rtfowunsyrdygyvubnvs" -or
    $DbHost -ne "aws-0-ap-southeast-2.pooler.supabase.com" -or
    $DbPort -ne "5432" -or
    $DbName -ne "postgres" -or
    $DbUser -ne "postgres.$TargetRef" -or
    $SupabaseUrl -ne "https://$TargetRef.supabase.co"
  ) {
    throw "The fixed database username, pooler endpoint, or Auth API URL does not match the disposable target ref."
  }
}

function Get-ApiKeyJwtClaims {
  param([Parameter(Mandatory = $true)][string]$ApiKey)
  $segments = $ApiKey.Split('.')
  if ($segments.Count -ne 3) { return $null }
  $payload = $segments[1].Replace('-', '+').Replace('_', '/')
  switch ($payload.Length % 4) {
    2 { $payload += '==' }
    3 { $payload += '=' }
    1 { return $null }
  }
  try {
    $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload))
    return ($json | ConvertFrom-Json -ErrorAction Stop)
  } catch {
    return $null
  }
}

function Invoke-AuthStatusProbe {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$ApiKey,
    [switch]$LegacyServiceRoleBearer
  )
  $headers = @{ apikey = $ApiKey }
  if ($LegacyServiceRoleBearer) { $headers.Authorization = "Bearer $ApiKey" }
  $uri = "$SupabaseUrl/auth/v1/$Path"
  try {
    $response = Invoke-WebRequest -Method GET -Uri $uri -Headers $headers -TimeoutSec 20 -MaximumRedirection 0 -UseBasicParsing -ErrorAction Stop
    return [int]$response.StatusCode
  } catch {
    $response = $_.Exception.Response
    if ($response -and $response.StatusCode) { return [int]$response.StatusCode }
    throw "Auth preflight could not obtain an HTTP status from the fixed target API."
  }
}

function Test-AuthCredentialPreflight {
  param(
    [Parameter(Mandatory = $true)][string]$AnonKey,
    [Parameter(Mandatory = $true)][string]$AdminKey
  )
  Assert-TargetIdentity

  $anonClaims = Get-ApiKeyJwtClaims -ApiKey $AnonKey
  if ($anonClaims) {
    $anonRef = [string]$anonClaims.ref
    if ($anonRef -ne $TargetRef -or [string]$anonClaims.role -ne "anon") {
      Write-Output "Auth public-key preflight: HTTP not sent; project $anonRef"
      throw "The supplied legacy public key is not an anon key for the disposable target."
    }
  } elseif (-not $AnonKey.StartsWith("sb_publishable_", [StringComparison]::Ordinal)) {
    throw "The public Auth key must be the target project's publishable key or legacy anon JWT."
  }

  $settingsStatus = Invoke-AuthStatusProbe -Path "settings" -ApiKey $AnonKey
  Write-Output "Auth public-key preflight: HTTP $settingsStatus; project $TargetRef"
  if ($settingsStatus -ne 200) { throw "The public key was not accepted by the disposable target Auth API (HTTP $settingsStatus)." }

  $adminClaims = Get-ApiKeyJwtClaims -ApiKey $AdminKey
  $useLegacyBearer = $false
  if ($adminClaims) {
    $adminRef = [string]$adminClaims.ref
    if ($adminRef -ne $TargetRef -or [string]$adminClaims.role -ne "service_role") {
      Write-Output "Auth Admin preflight: HTTP not sent; project $adminRef"
      throw "The Auth Admin JWT must be the disposable target's legacy service_role key."
    }
    $useLegacyBearer = $true
  } elseif (-not $AdminKey.StartsWith("sb_secret_", [StringComparison]::Ordinal)) {
    throw "The Auth Admin key must be a target service_role JWT or target server-side secret key."
  }

  # New sb_secret keys are opaque API keys, not JWTs. Send one only in apikey;
  # never put it in Authorization: Bearer for this Auth Admin endpoint.
  $adminStatus = Invoke-AuthStatusProbe -Path "admin/users/00000000-0000-0000-0000-000000000000" -ApiKey $AdminKey -LegacyServiceRoleBearer:$useLegacyBearer
  Write-Output "Auth Admin preflight: HTTP $adminStatus; project $TargetRef"
  if ($adminStatus -ne 404) {
    if ($adminStatus -eq 401 -and -not $useLegacyBearer) {
      throw "The Auth Admin endpoint rejected the secret API key (HTTP 401); use the target project's legacy service_role JWT for this endpoint."
    }
    throw "The Auth Admin credential was not confirmed by the no-write endpoint probe (HTTP $adminStatus)."
  }
}

function Invoke-TargetAuth {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$ApiKey,
    [ValidateSet("GET", "POST", "PUT")][string]$Method = "GET",
    [object]$Body,
    [switch]$Admin
  )
  $headers = @{ apikey = $ApiKey }
  if ($Admin) {
    if ($ApiKey.StartsWith("sb_secret_", [StringComparison]::Ordinal)) {
      # Secret API keys are opaque; they are valid only in apikey and must
      # have passed the no-write Auth Admin preflight before provisioning.
    } else {
      $claims = Get-ApiKeyJwtClaims -ApiKey $ApiKey
      if (-not $claims -or [string]$claims.ref -ne $TargetRef -or [string]$claims.role -ne "service_role") {
        throw "Auth Admin requires a disposable-target service_role JWT or a secret key accepted by the local preflight."
      }
      $headers.Authorization = "Bearer $ApiKey"
    }
  }
  $uri = "$SupabaseUrl/auth/v1/$Path"
  try {
    if ($null -eq $Body) {
      return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers -TimeoutSec 30
    }
    $json = ConvertTo-Json -InputObject $Body -Depth 10 -Compress
    return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers -ContentType "application/json" -Body $json -TimeoutSec 30
  } catch {
    $status = "unknown"
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      $status = [int]$_.Exception.Response.StatusCode
    }
    throw "The target Auth API request failed (HTTP $status). Response bodies and credentials were suppressed."
  }
}

function New-FixturePassword {
  return ([Guid]::NewGuid().ToString("N") + "aA9!")
}

function Save-FixtureState {
  param([object]$State)
  $json = ConvertTo-Json -InputObject $State -Depth 10
  Write-PrivateText -Path $StatePath -Text $json
}

function Get-OrCreateAuthUser {
  param([string]$AdminKey, [object]$State, [string]$Kind, [string]$Email, [string]$FullName, [string]$OrganizationId)
  $password = New-FixturePassword
  $userId = [string]$State.users.$Kind
  $user = $null
  if ($userId) {
    try {
      $user = Invoke-TargetAuth -Path "admin/users/$userId" -ApiKey $AdminKey -Method GET -Admin
    } catch {
      if ($_.Exception.Message -notmatch "HTTP 404") { throw }
      $user = $null
    }
  if ($user) {
      if ($user.email -ne $Email -or $user.app_metadata.pos_release_fixture -ne "$Marker-v1") {
        throw "Stored Auth user identity for $Kind does not match this synthetic fixture; refusing to modify it."
      }
      $user = Invoke-TargetAuth -Path "admin/users/$userId" -ApiKey $AdminKey -Method PUT -Admin -Body @{
        password = $password
        email_confirm = $true
        user_metadata = @{ full_name = $FullName }
        app_metadata = @{ pos_release_fixture = "$Marker-v1"; organization_id = $OrganizationId }
      }
      if ($user.user) { $user = $user.user }
    }
  }
  if (-not $user) {
    $user = Invoke-TargetAuth -Path "admin/users" -ApiKey $AdminKey -Method POST -Admin -Body @{
      email = $Email
      password = $password
      email_confirm = $true
      user_metadata = @{ full_name = $FullName }
      app_metadata = @{ pos_release_fixture = "$Marker-v1"; organization_id = $OrganizationId }
    }
    if ($user.user) { $user = $user.user }
    $userId = [string]$user.id
    if ($userId -notmatch "^[0-9a-fA-F-]{36}$") { throw "Auth did not return a valid synthetic user ID for $Kind." }
    $State.users | Add-Member -NotePropertyName $Kind -NotePropertyValue $userId -Force
    Save-FixtureState -State $State
  }
  return @{ id = $userId; email = $Email; password = $password }
}

function ConvertTo-PsLiteral {
  param([string]$Value)
  return "'" + $Value.Replace("'", "''") + "'"
}

function Get-TestFixtureProfiles {
  param([Parameter(Mandatory = $true)][object]$State)
  if ($State.target_ref -ne $TargetRef -or $State.marker -ne $Marker) {
    throw "Private fixture state belongs to another target or marker; refusing to modify Auth users."
  }
  foreach ($name in @("organization_id", "other_org_id")) {
    try { [void][Guid]::Parse([string]$State.$name) } catch { throw "Private fixture state has an invalid $name; refusing to modify Auth users." }
  }

  $specs = @(
    @{ kind = "owner"; organization_id = [string]$State.organization_id; role = "owner"; active = $true },
    @{ kind = "employee"; organization_id = [string]$State.organization_id; role = "staff"; active = $true },
    @{ kind = "inactive"; organization_id = [string]$State.organization_id; role = "owner"; active = $false },
    @{ kind = "other_owner"; organization_id = [string]$State.other_org_id; role = "owner"; active = $true }
  )
  $profileIds = @()
  foreach ($spec in $specs) {
    $id = [string]$State.users.($spec.kind)
    try { [void][Guid]::Parse($id) } catch { throw "Private fixture state has no valid synthetic Auth user ID for $($spec.kind)." }
    $spec.profile_id = $id
    $profileIds += "'$id'::uuid"
  }
  if (@($profileIds | Sort-Object -Unique).Count -ne $specs.Count) {
    throw "Synthetic fixture state reuses an Auth user ID; refusing to modify Auth users."
  }

  $query = @"
begin read only;
select json_build_object(
  'marker', exists(select 1 from public.pos_release_test_marker where marker='$Marker'),
  'profiles', coalesce((select json_agg(json_build_object('id',p.id,'auth_user_id',p.auth_user_id,'organization_id',p.organization_id,'role',p.role,'is_active',p.is_active,'email',p.email) order by p.id) from public.profiles p where p.id=any(array[$($profileIds -join ',')])), '[]'::json)
)::text;
commit;
"@
  $rows = Invoke-TestPsql -Query $query
  $json = @($rows | ForEach-Object { "$_".Trim() } | Where-Object { $_ } | Select-Object -First 1)
  if (-not $json) { throw "Read-only synthetic profile verification returned no result." }
  $snapshot = $json[0] | ConvertFrom-Json
  if (-not $snapshot.marker) { throw "The disposable target marker is missing; refusing to modify Auth users." }

  foreach ($spec in $specs) {
    $profile = @($snapshot.profiles | Where-Object { [string]$_.id -eq $spec.profile_id }) | Select-Object -First 1
    $expectedEmail = "pos-release-$($spec.kind)-$TargetRef@example.com"
    if (-not $profile -or [string]$profile.auth_user_id -ne $spec.profile_id -or
      [string]$profile.organization_id -ne $spec.organization_id -or
      [string]$profile.role -ne $spec.role -or
      [bool]$profile.is_active -ne [bool]$spec.active -or
      [string]$profile.email -ne $expectedEmail) {
      throw "Disposable database profile identity for $($spec.kind) does not match the stored synthetic fixture; refusing Auth changes."
    }
    $spec.email = $expectedEmail
  }
  return $specs
}

function Test-RefreshedUserToken {
  param([string]$AnonKey, [string]$AccessToken, [string]$UserId, [string]$OrganizationId, [string]$Kind)
  $claims = Get-ApiKeyJwtClaims -ApiKey $AccessToken
  if (-not $claims -or [string]$claims.sub -ne $UserId -or [string]$claims.role -ne "authenticated" -or
    [string]$claims.session_id -notmatch "^[0-9a-fA-F-]{36}$" -or
    [long]$claims.exp -le [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() -or
    [string]$claims.app_metadata.organization_id -ne $OrganizationId) {
    throw "New $Kind access token is missing its expected subject, active session, or organization claim."
  }
  try {
    $response = Invoke-WebRequest -Method GET -Uri "$SupabaseUrl/auth/v1/user" -Headers @{ apikey = $AnonKey; Authorization = "Bearer $AccessToken" } -TimeoutSec 20 -MaximumRedirection 0 -UseBasicParsing -ErrorAction Stop
    if ([int]$response.StatusCode -ne 200) { throw "HTTP $([int]$response.StatusCode)" }
    $authUser = $response.Content | ConvertFrom-Json
    if ([string]$authUser.id -ne $UserId) { throw "Auth API subject mismatch" }
  } catch {
    throw "New $Kind user session was not accepted by the disposable Auth API."
  }
}

function Refresh-SyntheticAuthSessions {
  param([Parameter(Mandatory = $true)][string]$AnonKey, [Parameter(Mandatory = $true)][string]$AdminKey)
  Assert-TargetIdentity
  Test-AuthCredentialPreflight -AnonKey $AnonKey -AdminKey $AdminKey
  $state = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
  $specs = Get-TestFixtureProfiles -State $state

  $authUsers = @{}
  foreach ($spec in $specs) {
    $userId = [string]$spec.profile_id
    $user = Invoke-TargetAuth -Path "admin/users/$userId" -ApiKey $AdminKey -Method GET -Admin
    if ([string]$user.id -ne $userId -or [string]$user.email -ne [string]$spec.email -or
      [string]$user.app_metadata.pos_release_fixture -ne "$Marker-v1") {
      throw "Auth identity for synthetic $($spec.kind) does not match its verified test profile; refusing to update any Auth user."
    }
    $authUsers[$spec.kind] = $user
  }

  $newTokens = [ordered]@{}
  foreach ($spec in $specs) {
    $userId = [string]$spec.profile_id
    $user = $authUsers[$spec.kind]

    $appMetadata = @{}
    if ($user.app_metadata) {
      foreach ($property in $user.app_metadata.PSObject.Properties) { $appMetadata[$property.Name] = $property.Value }
    }
    $appMetadata.pos_release_fixture = "$Marker-v1"
    $appMetadata.organization_id = [string]$spec.organization_id
    $password = New-FixturePassword
    try {
      [void](Invoke-TargetAuth -Path "admin/users/$userId" -ApiKey $AdminKey -Method PUT -Admin -Body @{
        password = $password
        email_confirm = $true
        app_metadata = $appMetadata
      })
      $session = Invoke-TargetAuth -Path "token?grant_type=password" -ApiKey $AnonKey -Method POST -Body @{
        email = [string]$spec.email
        password = $password
      }
      if (-not $session.access_token) { throw "Auth returned no access token for synthetic $($spec.kind)." }
      Test-RefreshedUserToken -AnonKey $AnonKey -AccessToken ([string]$session.access_token) -UserId $userId -OrganizationId ([string]$spec.organization_id) -Kind ([string]$spec.kind)
      $variable = switch ($spec.kind) {
        owner { "POS_RELEASE_OWNER_ACCESS_TOKEN" }
        employee { "POS_RELEASE_EMPLOYEE_ACCESS_TOKEN" }
        inactive { "POS_RELEASE_INACTIVE_ACCESS_TOKEN" }
        other_owner { "POS_RELEASE_OTHER_ORG_OWNER_ACCESS_TOKEN" }
      }
      $refreshVariable = $variable.Replace("_ACCESS_TOKEN", "_REFRESH_TOKEN")
      if (-not $session.refresh_token) { throw "Auth returned no refresh token for synthetic $($spec.kind)." }
      $newTokens[$variable] = [string]$session.access_token
      $newTokens[$refreshVariable] = [string]$session.refresh_token
    } finally {
      $password = $null
      $session = $null
      $appMetadata = $null
      [GC]::Collect()
    }
  }

  $settingsText = [IO.File]::ReadAllText($EnvPath)
  foreach ($entry in $newTokens.GetEnumerator()) {
    $pattern = '(?m)^\$env:' + [regex]::Escape($entry.Key) + '\s*=.*$'
    $matches = [regex]::Matches($settingsText, $pattern)
    $replacement = '$env:' + $entry.Key + ' = ' + (ConvertTo-PsLiteral -Value ([string]$entry.Value))
    if ($matches.Count -eq 0 -and $entry.Key -like '*_REFRESH_TOKEN') {
      $settingsText = $settingsText.TrimEnd() + [Environment]::NewLine + $replacement + [Environment]::NewLine
    } elseif ($matches.Count -eq 1) {
      $settingsText = $settingsText.Replace($matches[0].Value, $replacement)
    } else {
      throw "Protected settings must contain a single $($entry.Key) assignment before session refresh."
    }
  }
  Write-PrivateText -Path $EnvPath -Text $settingsText
  foreach ($entry in $newTokens.GetEnumerator()) { Set-Item -Path "Env:$($entry.Key)" -Value ([string]$entry.Value) }
  $settingsText = $null
  Write-Output "PASS refreshed four synthetic user sessions with trusted organization claims for $TargetRef."
  Write-Output "Only the four identified synthetic Auth users and their private test access-token settings were updated; no business fixtures or database rows were changed."
}

function Read-TargetAuthCredentials {
  $secureAnon = Read-Host "Enter the disposable test project's publishable or legacy anon API key" -AsSecureString
  try { $anonKey = ConvertFrom-SecureStringLocal -Value $secureAnon } finally { $secureAnon.Dispose() }
  $secureAdmin = Read-Host "Enter the test project's legacy service_role JWT (preferred); sb_secret is accepted only if Auth Admin preflight confirms it" -AsSecureString
  try { $adminKey = ConvertFrom-SecureStringLocal -Value $secureAdmin } finally { $secureAdmin.Dispose() }
  return @{ AnonKey = $anonKey; AdminKey = $adminKey }
}

function Provision-TestFixtures {
  param([Parameter(Mandatory = $true)][string]$AnonKey, [Parameter(Mandatory = $true)][string]$AdminKey)
  try {
    if (-not $AnonKey -or -not $AdminKey) { throw "Both test-project API keys are required." }
    Test-AuthCredentialPreflight -AnonKey $AnonKey -AdminKey $AdminKey

    $state = if (Test-Path -LiteralPath $StatePath) {
      Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
    } else {
      [pscustomobject]@{
        target_ref = $TargetRef
        marker = $Marker
        organization_id = [Guid]::NewGuid().ToString()
        other_org_id = [Guid]::NewGuid().ToString()
        cash_customer_id = [Guid]::NewGuid().ToString()
        credit_customer_id = [Guid]::NewGuid().ToString()
        stock_product_id = [Guid]::NewGuid().ToString()
        credit_product_id = [Guid]::NewGuid().ToString()
        auth_product_id = [Guid]::NewGuid().ToString()
        users = [pscustomobject]@{}
      }
    }
    if ($state.target_ref -ne $TargetRef -or $state.marker -ne $Marker) {
      throw "Private fixture state belongs to another target or marker; refusing to provision."
    }
    foreach ($id in @($state.organization_id,$state.other_org_id,$state.cash_customer_id,$state.credit_customer_id,$state.stock_product_id,$state.credit_product_id,$state.auth_product_id)) {
      try { [void][Guid]::Parse([string]$id) } catch { throw "Private fixture state contains a non-UUID ID; refusing to use it in SQL." }
    }

    $suffix = $TargetRef
    $userSpecs = @(
      @{ kind = "owner"; active = $true; name = "POS Release Owner" },
      @{ kind = "employee"; active = $true; name = "POS Release Restricted Employee" },
      @{ kind = "inactive"; active = $false; name = "POS Release Inactive Owner" },
      @{ kind = "other_owner"; active = $true; name = "POS Release Other Organization Owner" }
    )
    $users = @{}
    foreach ($spec in $userSpecs) {
      $email = "pos-release-$($spec.kind)-$suffix@example.com"
    $userOrganizationId = if ($spec.kind -eq "other_owner") { [string]$state.other_org_id } else { [string]$state.organization_id }
    $users[$spec.kind] = Get-OrCreateAuthUser -AdminKey $adminKey -State $state -Kind $spec.kind -Email $email -FullName $spec.name -OrganizationId $userOrganizationId
    }

    $orgId = [string]$state.organization_id
    $otherOrgId = [string]$state.other_org_id
    $ids = @{
      cash_customer = [string]$state.cash_customer_id
      credit_customer = [string]$state.credit_customer_id
      stock_product = [string]$state.stock_product_id
      credit_product = [string]$state.credit_product_id
      auth_product = [string]$state.auth_product_id
    }
    $sql = @'
begin;
create table if not exists public.pos_release_test_marker (
  marker text primary key check (marker = 'disposable-pos-atomic-sales')
);
insert into public.pos_release_test_marker(marker)
values ('disposable-pos-atomic-sales')
on conflict (marker) do nothing;
insert into public.organizations(id,name,overselling_policy)
values ('__ORG__','POS Release Synthetic Organization','block')
on conflict (id) do update set name=excluded.name,overselling_policy='block';
insert into public.organizations(id,name,overselling_policy)
values ('__OTHER_ORG__','POS Release Synthetic Other Organization','block')
on conflict (id) do update set name=excluded.name,overselling_policy='block';
insert into public.profiles(id,auth_user_id,organization_id,full_name,role_name,role,is_active,email,login_id)
values
('__OWNER__','__OWNER__','__ORG__','POS Release Owner','owner','owner',true,'__OWNER_EMAIL__','pos-release:owner'),
('__EMPLOYEE__','__EMPLOYEE__','__ORG__','POS Release Restricted Employee','staff','staff',true,'__EMPLOYEE_EMAIL__','pos-release:employee'),
('__INACTIVE__','__INACTIVE__','__ORG__','POS Release Inactive Owner','owner','owner',false,'__INACTIVE_EMAIL__','pos-release:inactive'),
('__OTHER_OWNER__','__OTHER_OWNER__','__OTHER_ORG__','POS Release Other Organization Owner','owner','owner',true,'__OTHER_OWNER_EMAIL__','pos-release:other-owner')
on conflict (id) do update set organization_id=excluded.organization_id,full_name=excluded.full_name,role_name=excluded.role_name,role=excluded.role,is_active=excluded.is_active,email=excluded.email,login_id=excluded.login_id,auth_user_id=excluded.auth_user_id;
insert into public.staff_permissions(organization_id,profile_id,can_create_sales,can_manage_inventory,granted_sections)
values ('__ORG__','__EMPLOYEE__',false,false,'{}'::text[])
on conflict (organization_id,profile_id) do update set can_create_sales=false,can_manage_inventory=false,granted_sections='{}'::text[];
insert into public.customers(id,organization_id,customer_name,credit_policy,credit_limit,credit_days,is_active,allow_over_limit,allow_overdue_sales,visit_frequency,priority)
values
('__CASH_CUSTOMER__','__ORG__','POS Release Cash Customer','cash_only',0,0,true,false,false,'none','medium'),
('__CREDIT_CUSTOMER__','__ORG__','POS Release Credit Customer','limit_only',10,0,true,false,false,'none','medium')
on conflict (id) do update set organization_id=excluded.organization_id,customer_name=excluded.customer_name,credit_policy=excluded.credit_policy,credit_limit=excluded.credit_limit,credit_days=excluded.credit_days,is_active=excluded.is_active,allow_over_limit=false,allow_overdue_sales=false,visit_frequency='none',priority='medium';
insert into public.products(id,organization_id,name,unit_type,units_per_pack,subunit_type,current_stock,default_selling_price,default_purchase_price,is_active,overselling_policy)
values
('__STOCK_PRODUCT__','__ORG__','POS Release Last Stock Product','piece',1,null,25,1,1,true,'block'),
('__CREDIT_PRODUCT__','__ORG__','POS Release Credit Product','piece',1,null,100,10,5,true,'block'),
('__AUTH_PRODUCT__','__ORG__','POS Release Fractional Pack Product','pack',12,'piece',100,80.60,40,true,'block')
on conflict (id) do update set organization_id=excluded.organization_id,name=excluded.name,unit_type=excluded.unit_type,units_per_pack=excluded.units_per_pack,subunit_type=excluded.subunit_type,current_stock=excluded.current_stock,default_selling_price=excluded.default_selling_price,default_purchase_price=excluded.default_purchase_price,is_active=true,overselling_policy='block';
commit;
'@
    $replacements = @{
      "__ORG__" = $orgId; "__OTHER_ORG__" = $otherOrgId
      "__OWNER__" = $users.owner.id; "__EMPLOYEE__" = $users.employee.id
      "__INACTIVE__" = $users.inactive.id; "__OTHER_OWNER__" = $users.other_owner.id
      "__OWNER_EMAIL__" = $users.owner.email; "__EMPLOYEE_EMAIL__" = $users.employee.email
      "__INACTIVE_EMAIL__" = $users.inactive.email; "__OTHER_OWNER_EMAIL__" = $users.other_owner.email
      "__CASH_CUSTOMER__" = $ids.cash_customer; "__CREDIT_CUSTOMER__" = $ids.credit_customer
      "__STOCK_PRODUCT__" = $ids.stock_product; "__CREDIT_PRODUCT__" = $ids.credit_product
      "__AUTH_PRODUCT__" = $ids.auth_product
    }
    foreach ($key in $replacements.Keys) { $sql = $sql.Replace($key, [string]$replacements[$key]) }
    $fixtureSqlPath = Join-Path $PrivateDir "provision-fixtures.sql"
    Write-PrivateText -Path $fixtureSqlPath -Text $sql
    Invoke-TestPsql -Query "" -File $fixtureSqlPath | Out-Null
    Remove-Item -LiteralPath $fixtureSqlPath -Force

    $envValues = [ordered]@{
      POS_RELEASE_TEST_TARGET = $Marker
      POS_RELEASE_TEST_DATABASE_URL = $DatabaseUrl
      POS_RELEASE_SUPABASE_URL = $SupabaseUrl
      POS_RELEASE_APP_URL = $AppUrl
      POS_RELEASE_SUPABASE_ANON_KEY = $anonKey
      POS_RELEASE_ORGANIZATION_ID = $orgId
      POS_RELEASE_OWNER_PROFILE_ID = $users.owner.id
      POS_RELEASE_EMPLOYEE_PROFILE_ID = $users.employee.id
      POS_RELEASE_INACTIVE_PROFILE_ID = $users.inactive.id
      POS_RELEASE_OTHER_ORG_ID = $otherOrgId
      POS_RELEASE_OTHER_ORG_OWNER_PROFILE_ID = $users.other_owner.id
      POS_RELEASE_CASH_CUSTOMER_ID = $ids.cash_customer
      POS_RELEASE_CREDIT_CUSTOMER_ID = $ids.credit_customer
      POS_RELEASE_STOCK_PRODUCT_ID = $ids.stock_product
      POS_RELEASE_CREDIT_PRODUCT_ID = $ids.credit_product
      POS_RELEASE_AUTH_PRODUCT_ID = $ids.auth_product
      POS_RELEASE_OWNER_ACCESS_TOKEN = ""
      POS_RELEASE_OWNER_REFRESH_TOKEN = ""
      POS_RELEASE_EMPLOYEE_ACCESS_TOKEN = ""
      POS_RELEASE_EMPLOYEE_REFRESH_TOKEN = ""
      POS_RELEASE_INACTIVE_ACCESS_TOKEN = ""
      POS_RELEASE_INACTIVE_REFRESH_TOKEN = ""
      POS_RELEASE_OTHER_ORG_OWNER_ACCESS_TOKEN = ""
      POS_RELEASE_OTHER_ORG_OWNER_REFRESH_TOKEN = ""
      PGPASSFILE = $PgPassPath
      SUPABASE_URL = $SupabaseUrl
      NEXT_PUBLIC_SUPABASE_URL = $SupabaseUrl
      SUPABASE_ANON_KEY = $anonKey
      NEXT_PUBLIC_SUPABASE_ANON_KEY = $anonKey
    }
    foreach ($kind in @("owner","employee","inactive","other_owner")) {
      $session = Invoke-TargetAuth -Path "token?grant_type=password" -ApiKey $anonKey -Method POST -Body @{
        email = $users[$kind].email
        password = $users[$kind].password
      }
      if (-not $session.access_token) { throw "Auth did not return an access token for $kind." }
      $targetVar = switch ($kind) {
        owner { "POS_RELEASE_OWNER_ACCESS_TOKEN" }
        employee { "POS_RELEASE_EMPLOYEE_ACCESS_TOKEN" }
        inactive { "POS_RELEASE_INACTIVE_ACCESS_TOKEN" }
        other_owner { "POS_RELEASE_OTHER_ORG_OWNER_ACCESS_TOKEN" }
      }
      $refreshVar = $targetVar.Replace("_ACCESS_TOKEN", "_REFRESH_TOKEN")
      if (-not $session.refresh_token) { throw "Auth did not return a refresh token for $kind." }
      $envValues[$targetVar] = [string]$session.access_token
      $envValues[$refreshVar] = [string]$session.refresh_token
    }
    $pathValue = "$PsqlDir;$env:PATH"
    $envText = @()
    foreach ($entry in $envValues.GetEnumerator()) {
      $envText += '$env:' + $entry.Key + ' = ' + (ConvertTo-PsLiteral -Value ([string]$entry.Value))
    }
    $envText += '$env:PATH = ' + (ConvertTo-PsLiteral -Value $pathValue)
    Write-PrivateText -Path $EnvPath -Text ($envText -join [Environment]::NewLine)
    Save-FixtureState -State $state
    $env:SUPABASE_SERVICE_ROLE_KEY = $adminKey
    Write-Output "Synthetic fixtures and ordinary-user sessions are ready for target $TargetRef."
    Write-Output "Private test settings: $EnvPath"
    Write-Output "The Auth Admin key was not written to disk. It is held only in this PowerShell process for a local server started from this same window."
  } finally {
    $AnonKey = $null
    $AdminKey = $null
    [GC]::Collect()
  }
}

try {
  if ($Mode -eq "Provision") {
    Initialize-PrivateDirectory
    if (-not (Test-Path -LiteralPath $PgPassPath -PathType Leaf)) { Read-TestDatabasePassword }
    Verify-TestDatabase -UseStoredPassword
    $credentials = Read-TargetAuthCredentials
    try { Provision-TestFixtures -AnonKey $credentials.AnonKey -AdminKey $credentials.AdminKey }
    finally { $credentials.AnonKey = $null; $credentials.AdminKey = $null; $credentials = $null; [GC]::Collect() }
  } elseif ($Mode -eq "PreflightAuth") {
    $credentials = Read-TargetAuthCredentials
    try {
      Test-AuthCredentialPreflight -AnonKey $credentials.AnonKey -AdminKey $credentials.AdminKey
      Write-Output "No Auth or database writes were performed."
    } finally { $credentials.AnonKey = $null; $credentials.AdminKey = $null; $credentials = $null; [GC]::Collect() }
  } elseif ($Mode -eq "RefreshSessions") {
    Initialize-PrivateDirectory
    if (-not (Test-Path -LiteralPath $EnvPath -PathType Leaf)) { throw "Protected fixture settings are missing; refusing to refresh sessions." }
    . $EnvPath
    if ($env:POS_RELEASE_TEST_TARGET -ne $Marker -or $env:POS_RELEASE_SUPABASE_URL -ne $SupabaseUrl) {
      throw "Protected settings do not identify the fixed disposable target; refusing to refresh sessions."
    }
    if (-not $env:POS_RELEASE_SUPABASE_ANON_KEY) { throw "Protected settings lack the disposable target's public Auth API key." }
    Verify-TestDatabase -UseStoredPassword
    $adminKey = [string]$env:SUPABASE_SERVICE_ROLE_KEY
    if (-not $adminKey) {
      $secureAdmin = Read-Host "Enter the disposable test project's service_role JWT or supported server-side key (hidden input)" -AsSecureString
      try { $adminKey = ConvertFrom-SecureStringLocal -Value $secureAdmin } finally { $secureAdmin.Dispose() }
    }
    try {
      Refresh-SyntheticAuthSessions -AnonKey ([string]$env:POS_RELEASE_SUPABASE_ANON_KEY) -AdminKey $adminKey
    } finally {
      $adminKey = $null
      $secureAdmin = $null
      [GC]::Collect()
    }
  } else {
    if (Test-Path -LiteralPath $PgPassPath -PathType Leaf) { Verify-TestDatabase -UseStoredPassword }
    else { Verify-TestDatabase }
    Write-Output "No database or Auth writes were performed. Provisioning is a separate explicit mode."
  }
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
