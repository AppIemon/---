const PASS_KEY = "oiuweroiuweroiuweroiuwer";

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");

  const pass = req.query.pass || req.headers["x-pass"];
  if (pass !== PASS_KEY) {
    return res.status(401).send("Write-Host '비밀번호 불일치'");
  }

  const hostUrl = "https://" + (req.headers.host || "test-tau-one-90.vercel.app");

  const psScript = `
$ErrorActionPreference = "Continue"
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "결론: MC 26.3 BACAP 한국어 + PC방 전용(Iris/DH/Bliss) 자동 세팅 시작" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan

$profDir = "$env:APPDATA\\ModrinthApp\\profiles\\Default"
$mcDir = "$env:APPDATA\\.minecraft"
$tmpZip = "$env:TEMP\\PCBang_26_3_FullPack.zip"
$worldZip = "$env:TEMP\\BACAP_World_Latest.zip"

New-Item -ItemType Directory -Force -Path $profDir | Out-Null
New-Item -ItemType Directory -Force -Path "$mcDir\\saves" | Out-Null

Write-Host "[1/4] PC방 통합팩 (Default 모드 + Iris + Distant Horizons + Bliss 셰이더 + BACAP 한국어) 다운로드 중..."
Invoke-WebRequest -Uri "https://github.com/AppIemon/mc-hub/releases/download/v26.3-pcbang/PCBang_26_3_FullPack.zip" -OutFile $tmpZip
tar -xf $tmpZip -C $profDir

Write-Host "[2/4] 최신 클라우드 야생 월드 (BACAP_야생) 동기화 중..."
Invoke-WebRequest -Uri "https://github.com/AppIemon/mc-hub/releases/download/v26.3-pcbang/BACAP_World_Latest.zip" -OutFile $worldZip
New-Item -ItemType Directory -Force -Path "$profDir\\saves" | Out-Null
tar -xf $worldZip -C "$profDir\\saves"
Copy-Item -Path "$profDir\\saves\\BACAP_야생" -Destination "$mcDir\\saves\\BACAP_야생" -Recurse -Force

$modrinthExe = "$env:LOCALAPPDATA\\Programs\\Modrinth App\\Modrinth App.exe"
if (-not (Test-Path $modrinthExe)) {
  Write-Host "[3/4] 모드린스 런처 자동 설치 중..."
  winget install --id Modrinth.ModrinthApp -e --silent --accept-package-agreements --accept-source-agreements
}

if (Test-Path $modrinthExe) {
  Start-Process $modrinthExe
}

Write-Host "[4/4] 백그라운드 20분/침대 수면 감지 및 게임 종료 시 자동 클라우드 업로드 대기 중..." -ForegroundColor Green
Write-Host "이제 모드린스 런처에서 로그인만 진행하고 플레이하세요. 게임을 끄면 자동으로 클라우드에 백업됩니다." -ForegroundColor Yellow

$lastUpload = Get-Date
$wasRunning = $false

while ($true) {
  Start-Sleep -Seconds 12
  $javas = Get-Process -Name "javaw","java" -ErrorAction SilentlyContinue
  if ($javas) {
    $wasRunning = $true
    $now = Get-Date
    if (($now - $lastUpload).TotalMinutes -ge 20) {
      Write-Host "[20분 주기 백업] 클라우드로 월드 변경점 업로드 중..."
      $outZip = "$env:TEMP\\BACAP_Sync.zip"
      if (Test-Path $outZip) { Remove-Item $outZip -Force }
      tar -a -cf $outZip -C "$profDir\\saves" "BACAP_야생"
      $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($outZip))
      $body = @{ pass = "${PASS_KEY}"; action = "push_delta"; day = 0; trigger = "PCBANG_20M_AUTO"; changedFiles = @("BACAP_야생 (20m 주기)"); worldZipBase64 = $b64 } | ConvertTo-Json -Compress
      Invoke-RestMethod -Uri "${hostUrl}/api/hub?action=push_delta" -Method Post -ContentType "application/json" -Body $body | Out-Null
      $lastUpload = $now
      Write-Host "[20분 주기 백업] 완료" -ForegroundColor Green
    }
  } elseif ($wasRunning) {
    Write-Host "[게임 종료 감지] PC방 플레이 월드 변경점을 클라우드에 자동 업로드합니다..." -ForegroundColor Cyan
    $outZip = "$env:TEMP\\BACAP_Exit_Sync.zip"
    if (Test-Path $outZip) { Remove-Item $outZip -Force }
    tar -a -cf $outZip -C "$profDir\\saves" "BACAP_야생"
    $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($outZip))
    $body = @{ pass = "${PASS_KEY}"; action = "push_delta"; day = 0; trigger = "PCBANG_EXIT_AUTO"; changedFiles = @("BACAP_야생 (PC방 종료 자동 백업)"); worldZipBase64 = $b64 } | ConvertTo-Json -Compress
    Invoke-RestMethod -Uri "${hostUrl}/api/hub?action=push_delta" -Method Post -ContentType "application/json" -Body $body | Out-Null
    Write-Host "클라우드 자동 업로드 완료! 이제 PC방을 떠나셔도 됩니다." -ForegroundColor Green
    break
  }
}
`;

  return res.status(200).send(psScript.trim());
};
