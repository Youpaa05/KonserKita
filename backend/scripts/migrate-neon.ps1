$ErrorActionPreference = "Stop"

$secureUrl = $null
$pointer = [IntPtr]::Zero
$runnerExitCode = 1
$previousTarget = [Environment]::GetEnvironmentVariable("NEON_MIGRATION_TARGET", "Process")
$previousUrl = [Environment]::GetEnvironmentVariable("NEON_MIGRATION_DATABASE_URL", "Process")

try {
    $secureUrl = Read-Host "Direct staging connection URL (hidden input)" -AsSecureString
    if ($secureUrl.Length -eq 0) {
        throw "A staging connection URL is required."
    }

    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureUrl)
    $env:NEON_MIGRATION_TARGET = "staging"
    $env:NEON_MIGRATION_DATABASE_URL = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)

    Push-Location (Split-Path -Parent $PSScriptRoot)
    try {
        & npm.cmd run db:migrate:neon
        $runnerExitCode = $LASTEXITCODE
    } finally {
        Pop-Location
    }
} finally {
    [Environment]::SetEnvironmentVariable("NEON_MIGRATION_DATABASE_URL", $previousUrl, "Process")
    [Environment]::SetEnvironmentVariable("NEON_MIGRATION_TARGET", $previousTarget, "Process")

    if ($pointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
    if ($null -ne $secureUrl) {
        $secureUrl.Dispose()
    }
}

exit $runnerExitCode
