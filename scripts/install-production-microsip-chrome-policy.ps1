#Requires -RunAsAdministrator

[CmdletBinding()]
param(
    [switch]$Remove
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$policyPath = 'HKLM:\SOFTWARE\Policies\Google\Chrome'
$policyName = 'AutoLaunchProtocolsFromOrigins'
$localNetworkPolicyNames = @(
    'LocalNetworkAccessAllowedForUrls',
    'LocalNetworkAllowedForUrls',
    'LoopbackNetworkAllowedForUrls'
)
$targetProtocol = 'callto'
$targetOrigins = @(
    'http://192.168.60.21:3000',
    'https://rx.rbandrc.com',
    'https://rx.camperos.net:10443'
)
$legacyOriginsToRemove = @(
    'http://192.168.62.21:3000',
    'http://192.168.15.87:3000',
    'http://192.168.15.87:3100',
    'https://portal.rbandrc.com'
)
$managedOrigins = @($targetOrigins + $legacyOriginsToRemove)

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

function Get-ListPolicyEntries {
    param([Parameter(Mandatory)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return @()
    }

    return @(Get-ItemProperty -LiteralPath $Path).PSObject.Properties |
        Where-Object { $_.Name -match '^\d+$' } |
        Sort-Object { [int]$_.Name } |
        ForEach-Object { [string]$_.Value } |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
}

function Set-ListPolicyEntries {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][AllowEmptyCollection()][string[]]$Values
    )

    if (Test-Path -LiteralPath $Path) {
        @(Get-ItemProperty -LiteralPath $Path).PSObject.Properties |
            Where-Object { $_.Name -match '^\d+$' } |
            ForEach-Object { Remove-ItemProperty -LiteralPath $Path -Name $_.Name }
    }

    if ($Values.Count -eq 0) {
        return
    }

    New-Item -Path $Path -Force | Out-Null
    for ($index = 0; $index -lt $Values.Count; $index += 1) {
        New-ItemProperty -LiteralPath $Path -Name ([string]($index + 1)) -PropertyType String -Value $Values[$index] -Force | Out-Null
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
        $managedOrigins -notcontains [string]$_
    } | Sort-Object -Unique)
} else {
    $calltoOrigins = @(
        $existingCalltoOrigins |
            Where-Object { $legacyOriginsToRemove -notcontains [string]$_ }
    )
    $calltoOrigins = @($calltoOrigins + $targetOrigins | Sort-Object -Unique)
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

foreach ($localNetworkPolicyName in $localNetworkPolicyNames) {
    $localNetworkPolicyPath = Join-Path $policyPath $localNetworkPolicyName
    $existingLocalNetworkOrigins = @(Get-ListPolicyEntries -Path $localNetworkPolicyPath)
    if ($Remove) {
        $localNetworkOrigins = @($existingLocalNetworkOrigins | Where-Object {
            $managedOrigins -notcontains [string]$_
        } | Sort-Object -Unique)
    } else {
        $localNetworkOrigins = @(
            $existingLocalNetworkOrigins |
                Where-Object { $legacyOriginsToRemove -notcontains [string]$_ }
        )
        $localNetworkOrigins = @($localNetworkOrigins + $targetOrigins | Sort-Object -Unique)
    }
    Set-ListPolicyEntries -Path $localNetworkPolicyPath -Values $localNetworkOrigins
}

if ($Remove) {
    Write-Host "Removed prompt-free MicroSIP launch permission for: $($targetOrigins -join ', ')." -ForegroundColor Yellow
    Write-Host "Removed RX Softphone local-network permission for the same origins." -ForegroundColor Yellow
} else {
    Write-Host "Enabled prompt-free MicroSIP launch for: $($targetOrigins -join ', ')." -ForegroundColor Green
    Write-Host "Enabled RX Softphone local-network permission for the same origins." -ForegroundColor Green
    Write-Host "Removed legacy development, staging, and Kasm-only origins: $($legacyOriginsToRemove -join ', ')." -ForegroundColor Yellow
}

Write-Host 'Restart Chrome, open chrome://policy, and click Reload policies.'
Write-Host "Verify that $policyName has Status OK."
foreach ($localNetworkPolicyName in $localNetworkPolicyNames) {
    Write-Host "Verify that $localNetworkPolicyName has Status OK."
}
