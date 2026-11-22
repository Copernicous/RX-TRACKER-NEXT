$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$helper=Join-Path $PSScriptRoot 'Backup-DeliveryArchives.ps1'
if(-not(Test-Path -LiteralPath $helper)){throw 'Delivery recovery helper is missing.'}
$fixture=Join-Path ([IO.Path]::GetTempPath()) ('rx-delivery-recovery-'+[guid]::NewGuid().ToString('N'))
try{
 $app=Join-Path $fixture 'app';$data=Join-Path $app 'administration/delivery-log-archives';$out=Join-Path $fixture 'protected/recovery.zip'
 New-Item -ItemType Directory -Path $data,(Split-Path $out)|Out-Null
 [IO.File]::WriteAllText((Join-Path $data 'fixture.json'),'{"synthetic":true}')
 [IO.File]::WriteAllText((Join-Path $data '.pharmacy-sequences.ledger'),'{"fixture":12}')
 [IO.File]::WriteAllBytes((Join-Path $data 'fixture.json.gz'),[byte[]](1,2,3,4))
 [IO.File]::WriteAllText((Join-Path $data 'fixture.json.gz.sha256'),'synthetic-checksum')
 [IO.File]::WriteAllText((Join-Path $app 'server.exe'),'synthetic-renderer-not-executable')
 [IO.File]::WriteAllText((Join-Path $app 'package.json'),'{"version":"4.0.0-test"}')
 & $helper -AppRoot $app -WritableRoot $app -Destination $out -ApplicationVersion '4.0.0-test'
 $receiptBytes=[IO.File]::ReadAllBytes($out+'.sha256.json')
 if($receiptBytes.Length -ge 3 -and $receiptBytes[0] -eq 239 -and $receiptBytes[1] -eq 187 -and $receiptBytes[2] -eq 191){throw 'Receipt must be BOM-free for Node JSON.parse'}
 $receipt=Get-Content ($out+'.sha256.json') -Raw|ConvertFrom-Json
 if($receipt.sha256 -ne (Get-FileHash -LiteralPath $out -Algorithm SHA256).Hash){throw 'Archive checksum receipt mismatch'}
 $zip=[IO.Compression.ZipFile]::OpenRead($out)
 try{
  foreach($entry in @('delivery/fixture.json','delivery/.pharmacy-sequences.ledger','delivery/fixture.json.gz','delivery/fixture.json.gz.sha256','renderer/server.exe','renderer/package.json','manifest.json')){if(-not $zip.GetEntry($entry)){throw ('Missing recovery entry: '+$entry)}}
  $reader=New-Object IO.StreamReader($zip.GetEntry('manifest.json').Open());try{$manifest=$reader.ReadToEnd()|ConvertFrom-Json}finally{$reader.Dispose()}
  if($manifest.applicationVersion -ne '4.0.0-test' -or @($manifest.files).Count -ne 6){throw 'Recovery manifest incomplete'}
  foreach($f in $manifest.files){$stream=$zip.GetEntry($f.entry).Open();$sha=[Security.Cryptography.SHA256]::Create();try{$hash=[BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','');if($hash -ne $f.sha256){throw 'Recovery entry content does not match source'}}finally{$stream.Dispose();$sha.Dispose()}}
 }finally{$zip.Dispose()}
 $before=(Get-FileHash -LiteralPath $out -Algorithm SHA256).Hash
 $blocked=$false;try{& $helper -AppRoot $app -WritableRoot $app -Destination $out -ApplicationVersion '4.0.0-test'}catch{$blocked=$true}
 if(-not $blocked -or (Get-FileHash -LiteralPath $out -Algorithm SHA256).Hash -ne $before){throw 'Existing backup was overwritten'}
 $junction=Join-Path $data 'linked';New-Item -ItemType Junction -Path $junction -Target (Join-Path $fixture 'protected')|Out-Null
 $blocked=$false;try{& $helper -AppRoot $app -WritableRoot $app -Destination (Join-Path $fixture 'protected/rejected.zip') -ApplicationVersion '4.0.0-test'}catch{$blocked=$true}
 if(-not $blocked -or (Test-Path (Join-Path $fixture 'protected/rejected.zip'))){throw 'Linked recovery source accepted or partial output left'}
 [IO.Directory]::Delete($junction)
 $realAdmin=Join-Path $app 'actual-administration';Move-Item -LiteralPath (Join-Path $app 'administration') -Destination $realAdmin
 New-Item -ItemType Junction -Path (Join-Path $app 'administration') -Target $realAdmin|Out-Null
 $blocked=$false;try{& $helper -AppRoot $app -WritableRoot $app -Destination (Join-Path $fixture 'protected/ancestor-rejected.zip') -ApplicationVersion '4.0.0-test'}catch{$blocked=$true}
 [IO.Directory]::Delete((Join-Path $app 'administration'))
 if(-not $blocked -or (Test-Path (Join-Path $fixture 'protected/ancestor-rejected.zip'))){throw 'Intermediate administration junction accepted'}
 'PASS delivery recovery round-trip, hidden ledger, compressed originals, renderer, checksums, overwrite and link guards'
}finally{
 $full=[IO.Path]::GetFullPath($fixture)
 if($full.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()),[StringComparison]::OrdinalIgnoreCase) -and (Split-Path $full -Leaf) -like 'rx-delivery-recovery-*'){
  $link=Join-Path $full 'app/administration/delivery-log-archives/linked';if(Test-Path -LiteralPath $link){[IO.Directory]::Delete($link)}
  $admin=Join-Path $full 'app/administration';if((Test-Path -LiteralPath $admin) -and ((Get-Item -LiteralPath $admin -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){[IO.Directory]::Delete($admin)}
  if(Test-Path -LiteralPath $full){Remove-Item -LiteralPath $full -Recurse -Force}
 }
}
