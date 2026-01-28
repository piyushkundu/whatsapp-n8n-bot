Write-Host "Starting Pure n8n System (Headless Bridge)..." -ForegroundColor Cyan

# Start n8n in background
$n8nProcess = Start-Process -FilePath "cmd" -ArgumentList "/c n8n start" -Passthru -NoNewWindow
Write-Host "n8n Started on Port 5678" -ForegroundColor Green

# Start Bridge API in foreground (needs terminal for QR)
Write-Host "Starting WhatsApp Bridge on Port 3000..." -ForegroundColor Green
node wa_api.js
