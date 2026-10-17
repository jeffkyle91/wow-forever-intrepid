param(
    [switch]$Configure,
    [switch]$ConfigureFromClipboard,
    [ValidateSet('backlog', 'patch-notes')]
    [string]$Destination = 'backlog',
    [string]$File,
    [switch]$Backlog,
    [string]$Release,
    [switch]$Publish
)

$ErrorActionPreference = 'Stop'
$directory = Join-Path $env:LOCALAPPDATA 'IntrepidRaidDesk\Discord'
$credentialPath = Join-Path $directory $(if ($Destination -eq 'backlog') { 'webhook.xml' } else { 'webhook-patch-notes.xml' })

if ($Configure -or $ConfigureFromClipboard) {
    if ($File -or $Backlog -or $Release -or $Publish) { throw 'Use configuration switches without publishing options.' }
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    if ($ConfigureFromClipboard) {
        $url = ([string](Get-Clipboard -Raw)).Trim()
    } else {
        $secret = Read-Host 'Paste the Discord webhook URL (hidden; do not paste it in chat)' -AsSecureString
        $credential = New-Object System.Management.Automation.PSCredential('discord-webhook', $secret)
        $url = $credential.GetNetworkCredential().Password.Trim()
    }
    if (-not $url) { throw 'No text was received at the hidden prompt. Nothing saved.' }
    if ($url -cnotmatch '^https://discord(?:app)?\.com/api(?:/v10)?/webhooks/[0-9]+/[A-Za-z0-9_.-]+$') {
        $reason = if ($url -notmatch '^https://discord(?:app)?\.com/') {
            'The input did not start with a supported Discord HTTPS address.'
        } elseif ($url -notmatch '^https://discord(?:app)?\.com/api(?:/v10)?/webhooks/[0-9]+/') {
            'The input did not have the expected webhook path and numeric ID.'
        } else {
            'The token was empty or contained unsupported characters, extra path segments or query parameters.'
        }
        throw "$reason Nothing saved. The URL has not been printed."
    }
    $normalized = ConvertTo-SecureString -String $url -AsPlainText -Force
    $credential = New-Object System.Management.Automation.PSCredential('discord-webhook', $normalized)
    $credential | Export-Clixml -LiteralPath $credentialPath
    if ($ConfigureFromClipboard) { Set-Clipboard -Value 'Webhook configuration saved.' }
    $url = $null
    $credential = $null
    Write-Output 'Webhook saved using Windows user encryption outside the repository. Nothing posted.'
    exit 0
}

$modes = @($File, $Backlog.IsPresent, $Release) | Where-Object { $_ }
if ($modes.Count -ne 1) { throw 'Select exactly one of -File, -Backlog or -Release. Add -Publish only when approved.' }
if (($Backlog -or $Release) -and $Destination -ne 'backlog') { throw '-Destination is for manual files and configuration only; generated modes choose their destinations.' }
$arguments = @((Join-Path $PSScriptRoot 'discord-backlog.ts'))
if ($File) { $arguments += @('--file', $File, '--destination', $Destination) }
if ($Backlog) { $arguments += '--backlog' }
if ($Release) { $arguments += @('--release', $Release) }
$loaded = @()
try {
    if ($Publish) {
        $destinations = if ($Release) { @('backlog', 'patch-notes') } else { @($Destination) }
        foreach ($name in $destinations) {
            $variable = if ($name -eq 'backlog') { 'INTREPID_DISCORD_WEBHOOK' } else { 'INTREPID_DISCORD_PATCH_NOTES_WEBHOOK' }
            $path = Join-Path $directory $(if ($name -eq 'backlog') { 'webhook.xml' } else { 'webhook-patch-notes.xml' })
            if (-not (Test-Path -LiteralPath $path)) { throw "Configure the $name destination first. Nothing posted." }
            if (Test-Path "Env:\$variable") { throw 'An existing webhook environment variable must be cleared first.' }
            $credential = Import-Clixml -LiteralPath $path
            Set-Item -Path "Env:\$variable" -Value $credential.GetNetworkCredential().Password
            $loaded += $variable
        }
        $arguments += @('--publish', '--state-dir', $directory)
    }
    & node @arguments
    $result = $LASTEXITCODE
} finally {
    foreach ($variable in $loaded) { Remove-Item -Path "Env:\$variable" }
    $credential = $null
}
exit $result
