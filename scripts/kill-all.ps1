Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*claude-buddy*' } | Stop-Process -Force
Start-Sleep -Seconds 1
$count = (Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*claude-buddy*' }).Count
Write-Host "Remaining: $count"
