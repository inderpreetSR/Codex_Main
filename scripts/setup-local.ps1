$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $repoRoot '.env'
if (Test-Path -LiteralPath $configPath) {
    Write-Host 'Using the existing .env.'
    return
}

function New-DatabasePassword {
    $bytes = New-Object byte[] 32
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
    return [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
}

$config = Get-Content -LiteralPath (Join-Path $repoRoot '.env.example') -Raw
$config = $config.Replace("CODEX_DB_ADMIN_PASSWORD=", "CODEX_DB_ADMIN_PASSWORD=$(New-DatabasePassword)")
$config = $config.Replace("CODEX_DB_PASSWORD=", "CODEX_DB_PASSWORD=$(New-DatabasePassword)")
[IO.File]::WriteAllText($configPath, $config, [Text.UTF8Encoding]::new($false))
Write-Host 'Created .env with local database passwords. Fill in the Auth0 and OpenRouter settings to enable sign-in and AI.'
