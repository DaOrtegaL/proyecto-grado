<#
.SYNOPSIS
    Verifica que un script esté firmado por un firmante autorizado antes de ejecutarlo (MSH-CLM, RNF04).

.DESCRIPTION
    Rechaza scripts sin firma, modificados después de firmar o firmados por un certificado que no figura en la
    lista de huellas autorizadas. Los certificados de laboratorio autofirmados producen el estado UnknownError
    (raíz no confiable); solo se aceptan cuando su huella está explícitamente autorizada.
    Código de salida: 0 = confiable; 3 = rechazado.

.EXAMPLE
    .\Test-ScriptTrust.ps1 -Path .\Get-CertificateInventory.ps1 -TrustedThumbprints ABCD...
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string[]]$TrustedThumbprints
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Write-Result([bool]$trusted, [string]$reason, [string]$status, [string]$signer) {
    $result = [ordered]@{ path = $Path; trusted = $trusted; reason = $reason; status = $status; signerThumbprint = $signer }
    Write-Output (ConvertTo-Json -InputObject $result -Depth 3)
    if ($trusted) { exit 0 } else { exit 3 }
}

if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { Write-Result $false 'SCRIPT_NOT_FOUND' 'NotFound' '' }

$sig = Get-AuthenticodeSignature -FilePath $Path
$status = $sig.Status.ToString()
$signer = if ($null -ne $sig.SignerCertificate) { $sig.SignerCertificate.Thumbprint.ToUpperInvariant() } else { '' }

if ($status -eq 'NotSigned') { Write-Result $false 'SCRIPT_NOT_SIGNED' $status $signer }
if ($status -eq 'HashMismatch') { Write-Result $false 'SCRIPT_MODIFIED' $status $signer }
$allowed = @($TrustedThumbprints | ForEach-Object { $_.ToUpperInvariant() })
if ($signer -eq '' -or $allowed -notcontains $signer) { Write-Result $false 'SIGNER_NOT_TRUSTED' $status $signer }
if ($status -ne 'Valid' -and $status -ne 'UnknownError') { Write-Result $false 'SIGNATURE_INVALID' $status $signer }
Write-Result $true 'TRUSTED' $status $signer
