param(
  [ValidateSet('menu','status','uptime','start','stop','restart','install-service','remove-service','migrate-service','setup','production-repair','db-test','migrate','dependency-test','dependency-install','port','logs','health','check-update','update','rollback','version','doctor','help')]
  [string]$Action='menu', [string]$Value=''
)
$ErrorActionPreference='Stop'
$Root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$M=Get-Content -Raw (Join-Path $Root 'project-control.json')|ConvertFrom-Json
$State=Join-Path $Root 'runtime\project-control\state.json'
function Fail($m){Write-Host "ERROR: $m" -ForegroundColor Red;exit 1}
function Admin{$i=[Security.Principal.WindowsIdentity]::GetCurrent();$p=New-Object Security.Principal.WindowsPrincipal($i);$p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)}
function NeedAdmin{if(-not(Admin)){Fail 'Run Project Control from an Administrator terminal.'}}
function Service{
  $service=Get-Service -Name $M.serviceId -ErrorAction SilentlyContinue
  if($service){return $service}
  foreach($legacyId in @($M.legacyServiceIds)){
    if(-not$legacyId){continue}
    $service=Get-Service -Name ([string]$legacyId) -ErrorAction SilentlyContinue
    if($service){return $service}
  }
  return $null
}
function Port{$p=[int]$M.defaultPort;$e=Join-Path $Root '.env';if(Test-Path $e){$l=Get-Content $e|?{$_ -match '^\s*PORT\s*=\s*(\d+)'}|select -Last 1;if($l -match '(\d+)'){$p=[int]$Matches[1]}};$p}
function Health{try{Invoke-RestMethod "http://127.0.0.1:$(Port)$($M.healthPath)" -TimeoutSec 8}catch{$null}}
function Listener{$p=Port;Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue|select -First 1}
function Status{$s=Service;$h=Health;$l=Listener;Write-Host "Project          : $($M.project)";Write-Host "Installed version: $((Get-Content -Raw (Join-Path $Root 'package.json')|ConvertFrom-Json).version)";Write-Host "Service          : $($M.serviceName)";Write-Host "Service ID       : $(if($s){$s.Name}else{$M.serviceId})";Write-Host "Service state    : $(if($s){$s.Status}else{'not installed'})";Write-Host "Health           : $(if($h){'ok'}else{'unreachable'})";if($h){Write-Host "PID              : $($h.pid)";Write-Host "Uptime           : $([TimeSpan]::FromMilliseconds($h.uptimeMs))"};Write-Host "HTTP port        : $(Port)";Write-Host "Listener         : $(if($l){"LISTENING (PID $($l.OwningProcess))"}else{'not listening'})"}
function StopRuntime{$s=Service;if($s){NeedAdmin};if($s -and $s.Status-ne'Stopped'){Stop-Service -Name $s.Name -Force};Start-Sleep 2;$h=Health;if($h){$l=Listener;if(-not$l -or [int]$l.OwningProcess-ne[int]$h.pid){Fail 'Health PID does not own the configured port.'};Stop-Process -Id ([int]$h.pid) -Force;Start-Sleep 2};if(Health){Fail 'RX Tracker still answers after stop.'};Status}
function StartRuntime{NeedAdmin;$s=Service;if(-not$s){Fail "$($M.serviceId) is not installed."};if($s.Status-ne'Running'){Start-Service -Name $s.Name};$d=(Get-Date).AddSeconds(30);do{Start-Sleep 1;$h=Health}while(-not$h-and(Get-Date)-lt$d);if(-not$h){Fail 'RX Tracker did not become healthy.'};Status}
function RestartRuntime{StopRuntime;StartRuntime}
function Install{NeedAdmin;if(Service){Write-Host "$($M.serviceName) is already installed.";return};$compiledInstaller=Join-Path $Root 'install-service.ps1';if((Test-Path (Join-Path $Root 'server.exe'))-and(Test-Path $compiledInstaller)){& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $compiledInstaller;exit $LASTEXITCODE};& node (Join-Path $Root 'scripts\windows-service.js') install;if($LASTEXITCODE){exit $LASTEXITCODE};return}
function Remove{NeedAdmin;StopRuntime;$compiledUninstaller=Join-Path $Root 'uninstall-service.ps1';if((Test-Path (Join-Path $Root 'server.exe'))-and(Test-Path $compiledUninstaller)){& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $compiledUninstaller;exit $LASTEXITCODE};& node (Join-Path $Root 'scripts\windows-service.js') uninstall;if($LASTEXITCODE){exit $LASTEXITCODE};return}
function SetPort{if(-not$Value){Write-Host "RX Tracker HTTP port: $(Port)";return};$n=0;if(-not[int]::TryParse($Value,[ref]$n)-or$n-lt1-or$n-gt65535){Fail 'Port must be 1-65535.'};$e=Join-Path $Root '.env';if(-not(Test-Path $e)){Fail '.env does not exist.'};Copy-Item $e "$e.project-control-backup" -Force;$lines=@(Get-Content $e);$found=$false;$lines=@($lines|%{if($_-match'^\s*PORT\s*='){$found=$true;"PORT=$n"}else{$_}});if(-not$found){$lines+="PORT=$n"};Set-Content $e $lines -Encoding UTF8;Write-Host "Port set to $n; restart to apply."}
function IsCompiled{(Test-Path (Join-Path $Root 'server.exe') -PathType Leaf)-and(Test-Path (Join-Path $Root 'rx-db.exe') -PathType Leaf)}
function InvokeReleaseUpdater([string]$ReleaseAction,[string]$ReleaseValue=''){$updater=Join-Path $Root 'scripts\Invoke-ReleaseUpdate.ps1';if(-not(Test-Path $updater)){Fail 'Compiled release updater is missing. Install the current Project Control package first.'};$args=@('-NoProfile','-ExecutionPolicy','Bypass','-File',$updater,'-Action',$ReleaseAction,'-AppRoot',$Root,'-ServiceName',$M.serviceId);if($ReleaseAction-eq'Update'-and$ReleaseValue){$args+=@('-PackagePath',$ReleaseValue)};if($ReleaseAction-eq'Rollback'){$args+=@('-Confirm',$ReleaseValue)};& powershell.exe @args;exit $LASTEXITCODE}
function CheckUpdate{if(IsCompiled){InvokeReleaseUpdater Check}; & git -C $Root fetch --tags --prune origin;if($LASTEXITCODE){Fail 'Git fetch failed.'};$t=& git -C $Root tag --list $M.releaseTagPattern --merged origin/main --sort=-version:refname|select -First 1;$c=& git -C $Root describe --tags --exact-match HEAD 2>$null;Write-Host "Current: $(if($c){$c}else{& git -C $Root rev-parse --short HEAD})";Write-Host "Latest : $t"}
function Clean{if(@(& git -C $Root status --porcelain).Count){Fail 'Checkout has uncommitted changes.'}}
function Update{if(IsCompiled){NeedAdmin;InvokeReleaseUpdater Update $Value};Clean;CheckUpdate;$tag=& git -C $Root tag --list $M.releaseTagPattern --merged origin/main --sort=-version:refname|select -First 1;if(-not$tag){Fail 'No release tag found.'};New-Item -ItemType Directory (Split-Path $State) -Force|Out-Null;@{previous=(& git -C $Root rev-parse HEAD);target=$tag}|ConvertTo-Json|Set-Content $State;& git -C $Root checkout --detach $tag;if($LASTEXITCODE){exit $LASTEXITCODE};& npm ci;if($LASTEXITCODE){exit $LASTEXITCODE};& npm run db:migrate;if($LASTEXITCODE){exit $LASTEXITCODE};& npm run db:test;if($LASTEXITCODE){exit $LASTEXITCODE};if(Service){RestartRuntime}else{Write-Host 'Release installed; install the service to run it.' -ForegroundColor Yellow}}
function Rollback{if(IsCompiled){NeedAdmin;InvokeReleaseUpdater Rollback $Value};Clean;if(-not(Test-Path $State)){Fail 'No rollback state.'};$x=Get-Content -Raw $State|ConvertFrom-Json;& git -C $Root checkout --detach $x.previous;if($LASTEXITCODE){exit $LASTEXITCODE};& npm ci;if(Service){RestartRuntime}}
function Doctor{if(IsCompiled){foreach($c in 'powershell.exe'){if(Get-Command $c -ErrorAction SilentlyContinue){Write-Host "[OK] $c" -ForegroundColor Green}else{Fail "$c missing"}};& (Join-Path $Root 'server.exe') --v;if($LASTEXITCODE){exit $LASTEXITCODE};& (Join-Path $Root 'rx-db.exe') verify;exit $LASTEXITCODE};foreach($c in 'git','node','npm','powershell.exe'){if(Get-Command $c -ErrorAction SilentlyContinue){Write-Host "[OK] $c" -ForegroundColor Green}else{Fail "$c missing"}};& npm run db:test;if($LASTEXITCODE){exit $LASTEXITCODE}}
function Setup{if(-not(Test-Path '.env')){Copy-Item '.env.example' '.env';Write-Host 'Created .env; configure it before starting.'};& npm ci;if($LASTEXITCODE){exit $LASTEXITCODE}}
function ProductionRepair{Setup;& npm run db:migrate;if($LASTEXITCODE){exit $LASTEXITCODE};Doctor;if(Service){RestartRuntime}}
function DbTest{if(IsCompiled){& (Join-Path $Root 'rx-db.exe') verify;exit $LASTEXITCODE};& npm run db:test;exit $LASTEXITCODE}
function DependencyTest{if(IsCompiled){Fail 'Dependency maintenance is performed when the official compiled release is built.'};& npm audit --omit=dev;exit $LASTEXITCODE}
function MigrateService{NeedAdmin;$pm2=Get-Command pm2 -ErrorAction SilentlyContinue;if($pm2){& pm2 delete patient-rx-system 2>$null|Out-Null;& pm2 save 2>$null|Out-Null};if(Service){Write-Host '0-RX-TRACKER is already installed; repairing wrapper registration.';StopRuntime;& node 'scripts/windows-service.js' uninstall;Start-Sleep 2;& node 'scripts/windows-service.js' install;StartRuntime;return};$h=Health;if($h){StopRuntime};Install;StartRuntime}
function Logs{$d=Join-Path $Root $M.logDirectory;$f=Get-ChildItem $d -File -ErrorAction SilentlyContinue|sort LastWriteTime -Descending|select -First 1;if(-not$f){Fail 'No logs found.'};Get-Content $f.FullName -Tail 100}
function InstalledVersion{[string]((Get-Content -Raw (Join-Path $Root 'package.json')|ConvertFrom-Json).version)}
function ControlVersion{$v=[string]$M.projectControlVersion;if($v.Trim()){$v}else{'unversioned'}}
function Confirm($q){
  Write-Host "`n$q" -ForegroundColor Yellow
  $a=(Read-Host '[Y] Yes  [N/Enter/any other key] Cancel').Trim()
  if($a -match '^(?i:y|yes)$'){return $true}
  Write-Host 'Cancelled. Returning to the menu.' -ForegroundColor DarkYellow
  $script:MenuCancelled=$true
  return $false
}
function WaitForMenu{
  Write-Host "`nPress any key to return to the menu..." -ForegroundColor DarkGray
  [void][Console]::ReadKey($true)
}
function Run($a,$v=''){
  $args=@('-NoProfile','-ExecutionPolicy','Bypass','-File',$PSCommandPath,'-Action',$a)
  if($v){$args+=@('-Value',$v)}
  & powershell.exe @args
  $code=$LASTEXITCODE
  if($code-eq0){
    Write-Host "`nCommand completed successfully." -ForegroundColor Green
  }else{
    Write-Host "`nCommand failed with exit code $code." -ForegroundColor Red
  }
}
function Menu {
  while($true){
    Clear-Host
    Write-Host '============================================================' -ForegroundColor Cyan
    Write-Host '              RX TRACKER PROJECT CONTROL' -ForegroundColor Cyan
    Write-Host " RX Tracker $(InstalledVersion) | Project Control $(ControlVersion)" -ForegroundColor DarkCyan
    Write-Host '============================================================' -ForegroundColor Cyan
    Write-Host '------------------------------------------------------------' -ForegroundColor DarkGray
    Write-Host ' INFORMATION' -ForegroundColor Cyan
    Write-Host '   1. Status                  2. Uptime'
    Write-Host '   3. Health details          4. Version information'
    Write-Host '   5. View logs               6. Run doctor/validation'
    Write-Host '   7. Show configured port    8. Check official release'
    Write-Host ''
    Write-Host ' SERVICE CONTROL' -ForegroundColor Green
    Write-Host '   9. Start RX Tracker       10. Stop RX Tracker'
    Write-Host '  11. Restart RX Tracker     12. Install PatientRXSystem service'
    Write-Host '  13. Remove service'
    Write-Host ''
    Write-Host ' CONFIGURATION AND RELEASES' -ForegroundColor Yellow
    Write-Host '  14. Change HTTP port       15. Install official release ZIP'
    Write-Host '  16. Emergency release rollback (app + DB)  17. Command help'
    Write-Host '  18. Migrate or repair legacy manager'
    Write-Host ''
    if(-not(IsCompiled)){
      Write-Host ' SETUP AND DEPENDENCIES' -ForegroundColor Magenta
      Write-Host '  19. Project setup          20. Production setup/repair'
      Write-Host '  21. Test PostgreSQL        22. Run database migrations'
      Write-Host '  23. Test dependencies      24. Install/repair dependencies'
      Write-Host ''
    }else{
      Write-Host ' DATABASE VALIDATION' -ForegroundColor Magenta
      Write-Host '  21. Verify PostgreSQL schema and migration ledger'
      Write-Host ''
    }
    Write-Host '   0. Exit'
    Write-Host '============================================================' -ForegroundColor Cyan
    $c=(Read-Host 'Select a menu number').Trim()
    switch($c){
      '0'{return}
      '1'{Run status}
      '2'{Run uptime}
      '3'{Run health}
      '4'{Run version}
      '5'{Run logs}
      '6'{Run doctor}
      '7'{Run port}
      '8'{Run check-update}
      '9'{Run start}
      '10'{if(Confirm 'Stop the verified RX Tracker runtime?'){Run stop}}
      '11'{if(Confirm 'Restart RX Tracker and verify its health?'){Run restart}}
      '12'{if(Confirm 'Install the PatientRXSystem Windows service?'){Run install-service}}
      '13'{if(Confirm 'Stop and remove the PatientRXSystem Windows service?'){Run remove-service}}
      '14'{$p=(Read-Host 'Enter the new RX Tracker HTTP port (1-65535)').Trim();if($p){Run port $p}else{$script:MenuCancelled=$true}}
      '15'{$zip=(Read-Host 'Official release ZIP path, or press Enter to download the latest').Trim();if(Confirm 'Back up the database and install this verified official release?'){Run update $zip}}
      '16'{Write-Host "`nWARNING: rollback restores the pre-update database and removes newer records from the active database." -ForegroundColor Red;$phrase=(Read-Host 'Type ROLLBACK to continue').Trim();if($phrase-eq'ROLLBACK'){Run rollback $phrase}else{$script:MenuCancelled=$true}}
      '17'{Run help}
      '18'{if(Confirm 'Migrate or repair the RX Tracker service manager?'){Run migrate-service}}
      '19'{if(IsCompiled){Write-Host 'This source-only option is unavailable in a compiled installation.' -ForegroundColor Yellow}else{if(Confirm 'Run RX Tracker dependency and configuration setup?'){Run setup}}}
      '20'{if(IsCompiled){Write-Host 'Use Install official release ZIP for compiled production repair.' -ForegroundColor Yellow}else{if(Confirm 'Run the full production setup and repair workflow?'){Run production-repair}}}
      '21'{Run db-test}
      '22'{if(IsCompiled){Write-Host 'Standalone compiled migrations are disabled; the release updater owns this step.' -ForegroundColor Yellow}else{if(Confirm 'Apply pending RX Tracker database migrations?'){Run migrate}}}
      '23'{Run dependency-test}
      '24'{if(Confirm 'Install the exact locked RX Tracker dependencies?'){Run dependency-install}}
      default{Write-Host "`nInvalid selection. Choose a number from 0 through 24." -ForegroundColor Yellow}
    }
    if($script:MenuCancelled){$script:MenuCancelled=$false;continue}
    WaitForMenu
  }
}
Set-Location $Root
switch($Action){menu{Menu};status{Status};uptime{$h=Health;if(-not$h){Fail 'Unreachable'};[TimeSpan]::FromMilliseconds($h.uptimeMs)};start{StartRuntime};stop{StopRuntime};restart{RestartRuntime};'install-service'{Install};'remove-service'{Remove};'migrate-service'{MigrateService};setup{Setup};'production-repair'{ProductionRepair};'db-test'{DbTest};migrate{if(IsCompiled){Fail 'Standalone compiled migrations are disabled; use update.'};& npm run db:migrate;exit $LASTEXITCODE};'dependency-test'{DependencyTest};'dependency-install'{if(IsCompiled){Fail 'Dependencies are embedded in the official compiled release.'};& npm ci;exit $LASTEXITCODE};port{SetPort};logs{Logs};health{$h=Health;if(-not$h){Fail 'Unreachable'};$h|ConvertTo-Json -Depth 6};'check-update'{CheckUpdate};update{Update};rollback{Rollback};version{Write-Host "RX Tracker installed: $(InstalledVersion)";$h=Health;Write-Host "RX Tracker running  : $(if($h){$h.version}else{'unreachable'})";Write-Host "Project Control     : $(ControlVersion)"};doctor{Doctor};help{Write-Host 'Compiled commands: status uptime health version logs doctor port check-update start stop restart install-service remove-service update rollback help db-test'}}
