$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$PluginId = "mod-browser-carousel"
$DeployDir = Join-Path $env:APPDATA "Vortex\plugins\$PluginId"
$PluginsRoot = Join-Path $env:APPDATA "Vortex\plugins"
$DisabledRoot = Join-Path (Split-Path $PluginsRoot -Parent) "plugins-disabled"
$LegacyDisabledRoot = Join-Path $PluginsRoot "_disabled"
$DistDir = Join-Path $ProjectRoot "dist"

$LegacyBrowseFolders = @(
    "strikeborn-mod-browser",
    "builtin-mod-browser-enhanced",
    "Builtin Mod Browser-88-1-0-4-1647308005"
)

function Migrate-LegacyDisabledFolder {
    if (-not (Test-Path $LegacyDisabledRoot)) {
        return
    }
    New-Item -ItemType Directory -Force -Path $DisabledRoot | Out-Null
    Get-ChildItem -Path $LegacyDisabledRoot -Directory | ForEach-Object {
        $dest = Join-Path $DisabledRoot $_.Name
        if (Test-Path $dest) {
            $dest = Join-Path $DisabledRoot ($_.Name + "-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
        }
        Write-Host "Migrating archived plugin:"
        Write-Host "  $($_.FullName)"
        Write-Host "  -> $dest"
        Move-Item -Path $_.FullName -Destination $dest -Force
    }
    if (-not (Get-ChildItem -Path $LegacyDisabledRoot -Force | Where-Object { $_.Name -ne '.' -and $_.Name -ne '..' })) {
        Remove-Item -Path $LegacyDisabledRoot -Force -Recurse -ErrorAction SilentlyContinue
    }
}

function Disable-LegacyBrowsePlugin {
    param([string]$FolderName)

    $source = Join-Path $PluginsRoot $FolderName
    if (-not (Test-Path $source)) {
        return
    }

    New-Item -ItemType Directory -Force -Path $DisabledRoot | Out-Null
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $dest = Join-Path $DisabledRoot ($FolderName + "-" + $stamp)

    Write-Host "Archiving legacy Browse plugin:"
    Write-Host "  $source"
    Write-Host "  -> $dest"
    Move-Item -Path $source -Destination $dest -Force
}

Push-Location $ProjectRoot
try {
    Write-Host "Building Mod Browser Carousel extension..."
    npm run build
    if ($LASTEXITCODE -ne 0) {
        throw "Build failed with exit code $LASTEXITCODE"
    }

    if (-not (Test-Path (Join-Path $DistDir "index.js"))) {
        throw "Build output missing: dist\index.js"
    }
    if (-not (Test-Path (Join-Path $DistDir "info.json"))) {
        throw "Build output missing: dist\info.json"
    }

    foreach ($folder in $LegacyBrowseFolders) {
        Disable-LegacyBrowsePlugin -FolderName $folder
    }

    Migrate-LegacyDisabledFolder

    Write-Host "Deploying to: $DeployDir"
    New-Item -ItemType Directory -Force -Path $DeployDir | Out-Null

    Copy-Item -Path (Join-Path $DistDir "index.js") -Destination $DeployDir -Force
    Copy-Item -Path (Join-Path $DistDir "info.json") -Destination $DeployDir -Force

    Write-Host ""
    Write-Host "Deployment complete."
    Write-Host "  index.js  -> $DeployDir\index.js"
    Write-Host "  info.json -> $DeployDir\info.json"
    Write-Host ""
    Write-Host "Next steps:"
    Write-Host "  1. Fully restart Vortex (close completely, then reopen)"
    Write-Host "  2. Settings -> Extensions: disable Builtin Mod Browser and any old Browse plugins"
    Write-Host "  3. Enable only: Nexus Vortex Mod Browser Carousel w/ 1 click install"
    Write-Host "  4. Open Browse and confirm Nexus loads normally"
}
finally {
    Pop-Location
}
