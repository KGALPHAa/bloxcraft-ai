<#
.SYNOPSIS
  BloxCraft AI - PowerShell Bridge per Roblox Studio
#>

$PORT = 28888
$queue = [System.Collections.ArrayList]::new()

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "       BLOXCRAFT AI - ROBLOX STUDIO BRIDGE (PowerShell)" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$PORT/")
try {
    $listener.Start()
    Write-Host "[✓] Bridge Server attivo su: http://127.0.0.1:$PORT" -ForegroundColor Green
    Write-Host "[✓] In attesa di comandi da https://kgalphaa.github.io/bloxcraft-ai/" -ForegroundColor Green
    Write-Host "[✓] Lascia questa finestra aperta mentre sviluppi su Roblox Studio!" -ForegroundColor Yellow
    Write-Host "========================================================`n" -ForegroundColor Cyan
} catch {
    Write-Host "[X] Impossibile avviare il listener sulla porta $PORT. Verifica che non sia gia' in uso." -ForegroundColor Red
    exit 1
}

while ($listener.IsListening) {
    $context = $listener.GetContext()
    $req = $context.Request
    $res = $context.Response

    # CORS Headers
    $res.Headers.Add("Access-Control-Allow-Origin", "*")
    $res.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    $res.Headers.Add("Access-Control-Allow-Headers", "Content-Type, Authorization")
    $res.Headers.Add("Access-Control-Allow-Private-Network", "true")

    if ($req.HttpMethod -eq "OPTIONS") {
        $res.StatusCode = 204
        $res.Close()
        continue
    }

    $rawUrl = $req.RawUrl.Split('?')[0]

    if ($req.HttpMethod -eq "GET" -and ($rawUrl -eq "/status" -or $rawUrl -eq "/health" -or $rawUrl -eq "/")) {
        $studioRunning = (Get-Process -Name "RobloxStudioBeta" -ErrorAction SilentlyContinue) -ne $null
        $mcpRunning = (Get-Process -Name "StudioMCP" -ErrorAction SilentlyContinue) -ne $null
        $json = @{
            status = "ok"
            version = "1.0.0"
            bridge = $true
            studioRunning = $studioRunning
            mcpRunning = $mcpRunning
            queueLength = $queue.Count
        } | ConvertTo-Json -Compress
        $buffer = [System.Text.Encoding]::UTF8.GetBytes($json)
        $res.ContentType = "application/json"
        $res.ContentLength64 = $buffer.Length
        $res.OutputStream.Write($buffer, 0, $buffer.Length)
        $res.Close()
        continue
    }

    if ($req.HttpMethod -eq "POST" -and ($rawUrl -eq "/execute" -or $rawUrl -eq "/inject")) {
        $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
        $body = $reader.ReadToEnd()
        $data = $body | ConvertFrom-Json
        $code = $data.code
        $title = if ($data.title) { $data.title } else { "Iniezione BloxCraft" }

        Write-Host "[⚡ INIEZIONE RICEVUTA] $title ($($code.Length) caratteri)" -ForegroundColor Green

        # Salva in coda per il Plugin
        $null = $queue.Add(@{
            id = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
            title = $title
            code = $code
            time = (Get-Date).ToString("o")
        })

        # Salva file di sync in AppData
        $robloxDir = Join-Path $env:LOCALAPPDATA "Roblox"
        if (-not (Test-Path $robloxDir)) { New-Item -ItemType Directory -Path $robloxDir -Force | Out-Null }
        $syncFile = Join-Path $robloxDir "BloxCraft_Latest.luau"
        [System.IO.File]::WriteAllText($syncFile, $code, [System.Text.Encoding]::UTF8)

        # Copia negli appunti di sistema
        try {
            $code | Set-Clipboard
            Write-Host "[✓] Codice copiato negli appunti di Windows" -ForegroundColor Gray
        } catch {}

        $resp = @{
            success = $true
            message = "Codice iniettato e sincronizzato con successo!"
            queueLength = $queue.Count
        } | ConvertTo-Json -Compress
        $buffer = [System.Text.Encoding]::UTF8.GetBytes($resp)
        $res.ContentType = "application/json"
        $res.ContentLength64 = $buffer.Length
        $res.OutputStream.Write($buffer, 0, $buffer.Length)
        $res.Close()
        continue
    }

    if ($req.HttpMethod -eq "GET" -and $rawUrl -eq "/poll") {
        if ($queue.Count -gt 0) {
            $item = $queue[0]
            $queue.RemoveAt(0)
            Write-Host "[Roblox Studio] ⚡ Codice '$($item.title)' inviato a Studio!" -ForegroundColor Magenta
            $json = $item | ConvertTo-Json -Compress
        } else {
            $json = '{"empty":true}'
        }
        $buffer = [System.Text.Encoding]::UTF8.GetBytes($json)
        $res.ContentType = "application/json"
        $res.ContentLength64 = $buffer.Length
        $res.OutputStream.Write($buffer, 0, $buffer.Length)
        $res.Close()
        continue
    }

    $res.StatusCode = 404
    $res.Close()
}
