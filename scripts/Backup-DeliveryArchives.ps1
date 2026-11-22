[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][string]$AppRoot,
 [Parameter(Mandatory=$true)][string]$WritableRoot,
 [Parameter(Mandatory=$true)][string]$Destination,
 [Parameter(Mandatory=$true)][string]$ApplicationVersion,
 [ValidateRange(5,600)][int]$TimeoutSeconds=120
)
$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$timer=[Diagnostics.Stopwatch]::StartNew()
$dest=[IO.Path]::GetFullPath($Destination)
if([IO.Path]::GetExtension($dest) -ne '.zip'){throw 'Delivery recovery destination must be a ZIP.'}
if(Test-Path -LiteralPath $dest){throw 'Recovery destination already exists.'}
if(Test-Path -LiteralPath ($dest+'.sha256.json')){throw 'Recovery receipt already exists.'}
$dir=Split-Path $dest -Parent
New-Item -ItemType Directory -Path $dir -Force|Out-Null
$partial=$dest+'.'+[guid]::NewGuid().ToString('N')+'.partial'
$receiptPartial=$partial+'.receipt'
$delivery=Join-Path ([IO.Path]::GetFullPath($WritableRoot)) 'administration/delivery-log-archives'
function Deadline {if($timer.Elapsed.TotalSeconds -gt $TimeoutSeconds){throw 'Delivery recovery timeout; previous backups retained.'}}
function Regular($path){$f=Get-Item -LiteralPath $path -Force;if($f.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Recovery source/destination reparse point rejected.'};$f}
function Sources {
 if(Test-Path -LiteralPath $delivery){
  $stack=[Collections.Generic.Stack[string]]::new();$stack.Push($delivery)
  while($stack.Count){Deadline;$f=Regular ($stack.Pop());if($f.PSIsContainer){foreach($child in Get-ChildItem -LiteralPath $f.FullName -Force){$stack.Push($child.FullName)}}else{[pscustomobject]@{entry=('delivery/'+$f.FullName.Substring($delivery.Length+1).Replace('\','/'));path=$f.FullName;bytes=$f.Length;ticks=$f.LastWriteTimeUtc.Ticks}}}
 }
 foreach($name in @('server.exe','package.json')){$path=Join-Path ([IO.Path]::GetFullPath($AppRoot)) $name;if(Test-Path -LiteralPath $path){$f=Regular $path;if($f.PSIsContainer){throw 'Renderer recovery source is not a file'};[pscustomobject]@{entry=('renderer/'+$name);path=$f.FullName;bytes=$f.Length;ticks=$f.LastWriteTimeUtc.Ticks}}}
}
function Signature($files){($files|Sort-Object entry|ForEach-Object{$_.entry+'|'+$_.bytes+'|'+$_.ticks}) -join "`n"}
function Digest($stream){$h=[Security.Cryptography.SHA256]::Create();try{[BitConverter]::ToString($h.ComputeHash($stream)).Replace('-','')}finally{$h.Dispose()}}
$zip=$null;$published=$false
try{
 # Validate every existing ancestor, including custom backup/writable roots.
 $starts=@($dir,[IO.Path]::GetFullPath($AppRoot),[IO.Path]::GetFullPath($WritableRoot))
 if(Test-Path -LiteralPath $delivery){$starts+=$delivery}else{$parent=Split-Path $delivery -Parent;if(Test-Path -LiteralPath $parent){$starts+=$parent}}
 foreach($start in $starts){$p=$start;while($p){Regular $p|Out-Null;$p=Split-Path $p -Parent}}
 $files=@(Sources)
 if($files.Count -gt 50000 -or ($files|Measure-Object bytes -Sum).Sum -gt 2GB){throw 'Recovery source exceeds bounded archive limits.'}
 $manifestFiles=@(foreach($f in $files){Deadline;if($f.bytes -gt 256MB){throw 'Recovery source file exceeds bounded size.'};$h=(Get-FileHash -LiteralPath $f.path -Algorithm SHA256).Hash;[pscustomobject]@{entry=$f.entry;bytes=$f.bytes;sha256=$h}})
 $zip=[IO.Compression.ZipFile]::Open($partial,[IO.Compression.ZipArchiveMode]::Create)
 foreach($f in $files){Deadline;[IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$f.path,$f.entry,[IO.Compression.CompressionLevel]::Fastest)|Out-Null}
 $manifest=[pscustomobject]@{format='rx-delivery-recovery-v1';applicationVersion=$ApplicationVersion;createdUTC=[DateTime]::UtcNow.ToString('o');compiledRendererIncluded=[bool]@($files|Where-Object{$_.entry -eq 'renderer/server.exe'}).Count;files=$manifestFiles}
 $entry=$zip.CreateEntry('manifest.json');$writer=New-Object IO.StreamWriter($entry.Open(),(New-Object Text.UTF8Encoding($false)));try{$writer.Write(($manifest|ConvertTo-Json -Depth 8))}finally{$writer.Dispose()}
 $zip.Dispose();$zip=$null
 $zip=[IO.Compression.ZipFile]::OpenRead($partial)
 if($zip.Entries.Count -ne $manifestFiles.Count+1){throw 'Recovery ZIP entry count mismatch.'}
 foreach($f in $manifestFiles){Deadline;$entry=$zip.GetEntry($f.entry);if(-not $entry -or $entry.Length -ne $f.bytes){throw 'Recovery ZIP entry missing or wrong size.'};$stream=$entry.Open();try{if((Digest $stream) -ne $f.sha256){throw 'Recovery ZIP content checksum mismatch.'}}finally{$stream.Dispose()}}
 $zip.Dispose();$zip=$null
 if((Signature @(Sources)) -ne (Signature $files)){throw 'Recovery sources changed during snapshot; retry after activity settles.'}
 foreach($f in $files){Deadline;if((Get-FileHash -LiteralPath $f.path -Algorithm SHA256).Hash -ne ($manifestFiles|Where-Object{$_.entry -eq $f.entry}).sha256){throw 'Recovery source changed during verification.'}}
 $receipt=[pscustomobject]@{format='rx-delivery-recovery-receipt-v1';filename=(Split-Path $dest -Leaf);sha256=(Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash;bytes=(Get-Item -LiteralPath $partial).Length;fileCount=$manifestFiles.Count;applicationVersion=$ApplicationVersion;verifiedUTC=[DateTime]::UtcNow.ToString('o')}
 [IO.File]::WriteAllText($receiptPartial,($receipt|ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)))
 Move-Item -LiteralPath $partial -Destination $dest
 Move-Item -LiteralPath $receiptPartial -Destination ($dest+'.sha256.json')
 $published=$true
 $receipt|ConvertTo-Json -Compress
}finally{
 if($zip){$zip.Dispose()}
 foreach($p in @($partial,$receiptPartial)){if(Test-Path -LiteralPath $p){Remove-Item -LiteralPath $p -Force}}
 if(-not $published -and (Test-Path -LiteralPath $dest) -and -not(Test-Path -LiteralPath ($dest+'.sha256.json'))){Remove-Item -LiteralPath $dest -Force}
}
