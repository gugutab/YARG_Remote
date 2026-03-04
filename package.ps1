# Script to package the mod for distribution
$version = "1.1.0"
$zipName = "YARGRemote_v$version.zip"
$distDir = "dist"
# Standard BepInEx structure: BepInEx/plugins/ModName
$pluginDir = "$distDir\BepInEx\plugins\YARGRemote"
# Game installation path to copy BepInEx from (Based on your deploy.ps1)
$gameDir = "C:\Users\GuguTab\AppData\Local\YARC\YARG Installs\a7a5552a-a374-4cda-a648-22af1d24ec09\installation"

# 1. Clean previous builds
Write-Host "Cleaning old files..." -ForegroundColor Yellow
if (Test-Path $distDir) { Remove-Item $distDir -Recurse -Force }
if (Test-Path $zipName) { Remove-Item $zipName -Force }

# 2. Build in Release (Optimized for distribution)
Write-Host "Compiling in Release..." -ForegroundColor Cyan
dotnet build -c Release
if ($LASTEXITCODE -ne 0) {
    Write-Host "Compilation error! Aborting." -ForegroundColor Red
    exit
}

# 3. Create folder structure
Write-Host "Creating folder structure..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $pluginDir | Out-Null

# 3.5 Copy BepInEx from game (For standalone installation)
Write-Host "Copying BepInEx..." -ForegroundColor Cyan
Copy-Item "$gameDir\winhttp.dll" -Destination "$distDir\winhttp.dll"
Copy-Item "$gameDir\doorstop_config.ini" -Destination "$distDir\doorstop_config.ini"
Copy-Item "$gameDir\BepInEx\core" -Destination "$distDir\BepInEx" -Recurse

# 4. Copy files (DLL and HTML)
Write-Host "Copying files..." -ForegroundColor Cyan
Copy-Item "bin\Release\netstandard2.1\YARG_remote.dll" -Destination "$pluginDir\YARG_remote.dll"
Copy-Item "index.html" -Destination "$pluginDir\index.html"

# 4.5 Generate README.txt with instructions
Write-Host "Generating README..." -ForegroundColor Cyan
$readmeText = @"
YARG Remote Server v$version
---------------------------

INSTALLATION:
1. Extract ALL contents of this ZIP file to the game's root folder (where YARG.exe is located).
   - This will install BepInEx and the Mod automatically.
   - If asked to replace files, click 'Yes'.

HOW TO USE:
1. Start the game.
2. Open the browser on any device on the same Wi-Fi network.
3. Access: http://localhost:8888
   (If on mobile, use your PC's IP, e.g., http://192.168.0.15:8888)

CONFIGURATION:
- If you need to change the port (default 8888), start the game once and then edit the file:
  BepInEx/config/com.gugutab.yarg.remote.cfg

SOURCE CODE:
https://github.com/gugutab/YARG_Remote
"@
Set-Content -Path "$distDir\README.txt" -Value $readmeText

# 5. Create Zip
Write-Host "Creating Zip file: $zipName" -ForegroundColor Green
Compress-Archive -Path "$distDir\*" -DestinationPath $zipName

Write-Host "SUCCESS! The file $zipName is ready to be distributed." -ForegroundColor Green