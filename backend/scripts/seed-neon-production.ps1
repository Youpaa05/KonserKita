$ErrorActionPreference = "Stop"

$secureUrl = $null
$pointer = [IntPtr]::Zero
$runnerExitCode = 1
$previousTarget = [Environment]::GetEnvironmentVariable("NEON_PRODUCTION_SEED_TARGET", "Process")
$previousUrl = [Environment]::GetEnvironmentVariable("NEON_PRODUCTION_SEED_DATABASE_URL", "Process")

try {
    $secureUrl = Read-Host "Direct Neon Production connection URL (hidden input)" -AsSecureString
    if ($secureUrl.Length -eq 0) {
        throw "A production connection URL is required."
    }

    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureUrl)
    $env:NEON_PRODUCTION_SEED_TARGET = "production"
    $env:NEON_PRODUCTION_SEED_DATABASE_URL = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)

    Push-Location (Split-Path -Parent $PSScriptRoot)
    try {
        & npm.cmd run db:seed:neon:production
        $runnerExitCode = $LASTEXITCODE
    } finally {
        Pop-Location
    }
} finally {
    [Environment]::SetEnvironmentVariable("NEON_PRODUCTION_SEED_DATABASE_URL", $previousUrl, "Process")
    [Environment]::SetEnvironmentVariable("NEON_PRODUCTION_SEED_TARGET", $previousTarget, "Process")

    if ($pointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
    if ($null -ne $secureUrl) {
        $secureUrl.Dispose()
    }
}

exit $runnerExitCode
