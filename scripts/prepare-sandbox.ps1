param([Parameter(Mandatory)][string]$Destination)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$target = [IO.Path]::GetFullPath($Destination)
$workspace = Split-Path -Parent $repoRoot
if ((Split-Path -Parent $target) -ne $workspace -or (Test-Path -LiteralPath $target)) {
    throw 'Choose a new sibling folder next to Codex_Main inside the local workspace.'
}

$files = @(
    '.dockerignore', '.env.example', '.gitignore', 'AGENTS.md', 'README.md',
    'Dockerfile', 'Dockerfile.backend', 'compose.yaml', 'pyproject.toml', 'uv.lock',
    'alembic.ini', 'rust-toolchain.toml', 'requirements-ci.txt', 'public/index.html',
    'frontend/index.html', 'frontend/package.json', 'frontend/package-lock.json', 'frontend/tsconfig.json',
    'scripts/setup-local.ps1', 'scripts/prepare-sandbox.ps1'
)
$sourceDirectories = @('app', 'migrations', 'frontend/src', 'tests', '.github')
foreach ($folder in $sourceDirectories) {
    $source = Join-Path $repoRoot $folder
    if ((Get-Item -LiteralPath $source -Force).LinkType) {
        throw "Linked sandbox source directory: $folder"
    }
    $files += Get-ChildItem -LiteralPath $source -File -Recurse |
        Where-Object { $_.Extension -in '.py', '.ts', '.tsx', '.css', '.yml' } |
        ForEach-Object { $_.FullName.Substring($repoRoot.Length + 1) }
}
foreach ($file in $files) {
    $source = Join-Path $repoRoot $file
    if (!(Test-Path -LiteralPath $source -PathType Leaf) -or (Get-Item -LiteralPath $source -Force).LinkType) {
        throw "Missing or linked sandbox source: $file"
    }
}

New-Item -ItemType Directory -Path $target | Out-Null
foreach ($file in $files) {
    $copy = Join-Path $target $file
    $parent = Split-Path -Parent $copy
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    Copy-Item -LiteralPath (Join-Path $repoRoot $file) -Destination $copy
}
git init -b sandbox -- $target
if ($LASTEXITCODE -ne 0) { throw 'Sandbox Git initialization failed.' }
git -C $target add --all
if ($LASTEXITCODE -ne 0) { throw 'Sandbox snapshot staging failed.' }
git -C $target -c user.name='Codex Sandbox' -c user.email='codex-sandbox@localhost' commit -m 'Snapshot reviewed sandbox source'
if ($LASTEXITCODE -ne 0) { throw 'Sandbox snapshot commit failed.' }
Write-Host "Sandbox source: $target"
