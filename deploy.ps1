# 1. Executa o build
Write-Host "Iniciando dotnet build..." -ForegroundColor Cyan
dotnet build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Erro no build. Abortando." -ForegroundColor Red
    exit $LASTEXITCODE
}

# Definição de caminhos
$targetDir = "C:\Users\GuguTab\AppData\Local\YARC\YARG Installs\0eb8f386-1d56-406c-8367-76a5f84426a5\installation\BepInEx\plugins"
$exePath = "C:\Users\GuguTab\AppData\Local\YARC\YARG Installs\0eb8f386-1d56-406c-8367-76a5f84426a5\installation\YARG.exe"

# 2. Finaliza o processo do YARG se estiver rodando
Write-Host "Verificando se o YARG está rodando..." -ForegroundColor Cyan
$yargProc = Get-Process -Name "YARG" -ErrorAction SilentlyContinue
if ($yargProc) {
    Write-Host "Finalizando processo YARG atual..." -ForegroundColor Yellow
    Stop-Process -Name "YARG" -Force
    # Pequena pausa para garantir que os arquivos sejam liberados
    Start-Sleep -Seconds 2
}

# 3. Move/Copia os arquivos
Write-Host "Copiando arquivos para: $targetDir" -ForegroundColor Cyan
if (!(Test-Path $targetDir)) {
    New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
}
Copy-Item ".\index.html" -Destination "$targetDir\index.html" -Force
Copy-Item ".\bin\Debug\netstandard2.1\YARG_remote.dll" -Destination "$targetDir\YARG_remote.dll" -Force

# 4. Inicia o YARG.exe
Write-Host "Iniciando YARG..." -ForegroundColor Green
Start-Process $exePath
