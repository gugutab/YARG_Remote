# 1. Run build
Write-Host "Starting dotnet build..." -ForegroundColor Cyan
dotnet build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build error. Aborting." -ForegroundColor Red
    exit $LASTEXITCODE
}

# Path definitions
$targetDir = "C:\Users\GuguTab\AppData\Local\YARC\YARG Installs\a7a5552a-a374-4cda-a648-22af1d24ec09\installation\BepInEx\plugins"
$exePath = "C:\Users\GuguTab\AppData\Local\YARC\YARG Installs\a7a5552a-a374-4cda-a648-22af1d24ec09\installation\YARG.exe"

# 2. Kill YARG process if running
Write-Host "Checking if YARG is running..." -ForegroundColor Cyan
$yargProc = Get-Process -Name "YARG" -ErrorAction SilentlyContinue
if ($yargProc) {
    Write-Host "Killing current YARG process..." -ForegroundColor Yellow
    Stop-Process -Name "YARG" -Force
    # Short pause to ensure files are released
    Start-Sleep -Seconds 2
}

# 3. Move/Copy files
Write-Host "Copying files to: $targetDir" -ForegroundColor Cyan
if (!(Test-Path $targetDir)) {
    New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
}
Copy-Item ".\index.html" -Destination "$targetDir\index.html" -Force
Copy-Item ".\bin\Debug\netstandard2.1\YARG_remote.dll" -Destination "$targetDir\YARG_remote.dll" -Force

# 4. Start YARG.exe
Write-Host "Starting YARG..." -ForegroundColor Green
Start-Process $exePath
