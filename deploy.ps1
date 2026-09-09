$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$PluginId = "mod-browser-carousel"
$DeployDir = Join-Path $env:APPDATA "Vortex\plugins\$PluginId"
$PluginsRoot = Join-Path $env:APPDATA "Vortex\plugins"
$DisabledRoot = Join-Path (Split-Path $PluginsRoot -Parent) "plugins-disabled"
$LegacyDisabledRoot = Join-Path $PluginsRoot "_disabled"
$DistDir = Join-Path $ProjectRoot "dist"

function Archive-LegacyBrowsePlugin {
    param([string]$SourcePath)

    if (-not (Test-Path $SourcePath)) {
        return
    }

    New-Item -ItemType Directory -Force -Path $DisabledRoot | Out-Null
    $name = Split-Path $SourcePath -Leaf
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $dest = Join-Path $DisabledRoot ($name + "-" + $stamp)

    Write-Host "Archiving legacy Browse plugin:"
    Write-Host "  $SourcePath"
    Write-Host "  -> $dest"
    Move-Item -Path $SourcePath -Destination $dest -Force
}

function Archive-LegacyBrowsePlugins {
    if (-not (Test-Path $PluginsRoot)) {
        return
    }

    Get-ChildItem -Path $PluginsRoot -Directory | ForEach-Object {
        $name = $_.Name
        if ($name -eq $PluginId) {
            return
        }
        if ($name -like "Builtin Mod Browser*" -or
            $name -like "builtin-mod-browser*" -or
            $name -eq "strikeborn-mod-browser") {
            Archive-LegacyBrowsePlugin -SourcePath $_.FullName
        }
    }
}

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

function Remove-ArchivedBrowsePlugins {
    if (-not (Test-Path $DisabledRoot)) {
        return
    }

    Get-ChildItem -Path $DisabledRoot -Directory | ForEach-Object {
        $name = $_.Name
        if ($name -like "Builtin Mod Browser*" -or
            $name -like "builtin-mod-browser*" -or
            $name -like "strikeborn-mod-browser*") {
            Write-Host "Removing archived Browse plugin:"
            Write-Host "  $($_.FullName)"
            Remove-Item -Path $_.FullName -Recurse -Force
        }
    }
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

    Archive-LegacyBrowsePlugins
    Migrate-LegacyDisabledFolder
    Remove-ArchivedBrowsePlugins

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
    Write-Host "  2. Settings -> Extensions: keep only Nexus Vortex Mod Browser Carousel w/ 1 click install enabled for Browse"
    Write-Host "  3. Open Browse and confirm Nexus loads normally"
}
finally {
    Pop-Location
}
