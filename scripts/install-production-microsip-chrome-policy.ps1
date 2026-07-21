#Requires -RunAsAdministrator

[CmdletBinding()]
param(
    [switch]$Remove
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$policyPath = 'HKLM:\SOFTWARE\Policies\Google\Chrome'
$policyName = 'AutoLaunchProtocolsFromOrigins'
$targetProtocol = 'callto'
$targetOrigins = @(
    'http://192.168.15.87:3000',
    'http://192.168.15.87:3100',
    'http://192.168.62.21:3000',
    'https://portal.rbandrc.com',
    'https://rx.camperos.net:10443'
)

function Get-ProtocolPolicyEntries {
    if (-not (Test-Path -LiteralPath $policyPath)) {
        return @()
    }

    $raw = Get-ItemPropertyValue -LiteralPath $policyPath -Name $policyName -ErrorAction SilentlyContinue
    if ([string]::IsNullOrWhiteSpace([string]$raw)) {
        return @()
    }

    try {
        return @($raw | ConvertFrom-Json)
    } catch {
        throw "Existing Chrome $policyName policy is not valid JSON. It was not changed. Value: $raw"
    }
}

$existingEntries = @(Get-ProtocolPolicyEntries)
$preservedEntries = @($existingEntries | Where-Object {
    -not ([string]$_.protocol -ieq $targetProtocol)
})
$existingCalltoOrigins = @($existingEntries |
    Where-Object { [string]$_.protocol -ieq $targetProtocol } |
    ForEach-Object { @($_.allowed_origins) } |
    Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })

if ($Remove) {
    $calltoOrigins = @($existingCalltoOrigins | Where-Object {
        $targetOrigins -notcontains [string]$_
    } | Sort-Object -Unique)
} else {
    $calltoOrigins = @($existingCalltoOrigins + $targetOrigins | Sort-Object -Unique)
}

$updatedEntries = @($preservedEntries)
if ($calltoOrigins.Count -gt 0) {
    $updatedEntries += [ordered]@{
        allowed_origins = $calltoOrigins
        protocol = $targetProtocol
    }
}

if ($updatedEntries.Count -eq 0) {
    if (Test-Path -LiteralPath $policyPath) {
        Remove-ItemProperty -LiteralPath $policyPath -Name $policyName -ErrorAction SilentlyContinue
    }
} else {
    New-Item -Path $policyPath -Force | Out-Null
    $json = ConvertTo-Json -InputObject @($updatedEntries) -Depth 8 -Compress
    New-ItemProperty -LiteralPath $policyPath -Name $policyName -PropertyType String -Value $json -Force | Out-Null
}

if ($Remove) {
    Write-Host "Removed prompt-free MicroSIP launch permission for: $($targetOrigins -join ', ')." -ForegroundColor Yellow
} else {
    Write-Host "Enabled prompt-free MicroSIP launch for: $($targetOrigins -join ', ')." -ForegroundColor Green
}

Write-Host 'Restart Chrome, open chrome://policy, and click Reload policies.'
Write-Host "Verify that $policyName has Status OK."
