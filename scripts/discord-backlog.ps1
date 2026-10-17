param(
    [switch]$Configure,
    [switch]$ConfigureFromClipboard,
    [string]$File,
    [switch]$Publish
)

$ErrorActionPreference = 'Stop'
$directory = Join-Path $env:LOCALAPPDATA 'IntrepidRaidDesk\Discord'
$credentialPath = Join-Path $directory 'webhook.xml'

if ($Configure -or $ConfigureFromClipboard) {
    if ($File -or $Publish) { throw 'Use -Configure by itself.' }
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

if (-not $File) { throw 'Specify -File with a posts JSON file. Add -Publish only when posting is approved.' }
$arguments = @((Join-Path $PSScriptRoot 'discord-backlog.ts'), '--file', $File)
if ($Publish) {
    if (-not (Test-Path -LiteralPath $credentialPath)) { throw 'Run this script with -Configure first.' }
    if ($env:INTREPID_DISCORD_WEBHOOK) { throw 'An existing webhook environment variable must be cleared first.' }
    $credential = Import-Clixml -LiteralPath $credentialPath
    $env:INTREPID_DISCORD_WEBHOOK = $credential.GetNetworkCredential().Password
    $arguments += @('--publish', '--state-dir', $directory)
}
try {
    & node @arguments
    $result = $LASTEXITCODE
} finally {
    if ($Publish) {
        Remove-Item Env:\INTREPID_DISCORD_WEBHOOK
        $credential = $null
    }
}
exit $result
