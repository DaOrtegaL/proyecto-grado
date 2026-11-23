<#
.SYNOPSIS
    Inventario de solo lectura de certificados X.509 en almacenes de Windows (MSH-CLM, RF01).

.DESCRIPTION
    Consulta únicamente almacenes autorizados y extrae metadatos públicos del certificado.
    NUNCA lee, exporta ni transmite claves privadas: solo se consulta la propiedad booleana HasPrivateKey.
    Produce un documento JSON con el contrato "InventoryReport" v1.0 (ver docs/agente-powershell.md).
    Compatible con Windows PowerShell 5.1 y PowerShell 7.

.PARAMETER StoreLocations
    Ubicaciones permitidas: LocalMachine, CurrentUser.

.PARAMETER StoreNames
    Almacenes permitidos: My, Root, CA, TrustedPeople.

.PARAMETER OutputPath
    Ruta opcional del archivo JSON. Si se omite, el resultado se escribe en la salida estándar.

.EXAMPLE
    .\Get-CertificateInventory.ps1 -StoreLocations LocalMachine -StoreNames My
#>
[CmdletBinding()]
param(
    [ValidateSet('LocalMachine', 'CurrentUser')]
    [string[]]$StoreLocations = @('LocalMachine'),

    [ValidateSet('My', 'Root', 'CA', 'TrustedPeople')]
    [string[]]$StoreNames = @('My'),

    [string]$Hostname = $env:COMPUTERNAME,

    [string]$OutputPath
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$utcFormat = "yyyy-MM-dd'T'HH:mm:ss.fff'Z'"
$invariant = [System.Globalization.CultureInfo]::InvariantCulture

function ConvertTo-IsoUtc([datetime]$value) {
    return $value.ToUniversalTime().ToString($utcFormat, $invariant)
}

function Get-Sha256Hex([byte[]]$bytes) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return ([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '') }
    finally { $sha.Dispose() }
}

function ConvertTo-NormalizedSignature([string]$friendlyName) {
    if ($friendlyName -match '^sha(\d+)RSA$') { return "RSASSA-PKCS1-v1_5-SHA$($Matches[1])" }
    if ($friendlyName -match '^sha(\d+)ECDSA$') { return "ECDSA-SHA$($Matches[1])" }
    return $friendlyName
}

function Get-PublicKeyInfo($cert) {
    $oid = $cert.PublicKey.Oid.Value
    $algorithm = switch ($oid) {
        '1.2.840.113549.1.1.1' { 'RSA' }
        '1.2.840.10045.2.1'    { 'ECDSA' }
        default                { $cert.PublicKey.Oid.FriendlyName }
    }
    $size = $null
    try {
        # Solo se usa la clave PÚBLICA para conocer su tamaño.
        if ($algorithm -eq 'RSA') {
            $size = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPublicKey($cert).KeySize
        } elseif ($algorithm -eq 'ECDSA') {
            $size = [System.Security.Cryptography.X509Certificates.ECDsaCertificateExtensions]::GetECDsaPublicKey($cert).KeySize
        }
    } catch { $size = $null }
    return @{ Algorithm = $algorithm; KeySize = $size }
}

function Get-KeyUsageNames($cert) {
    $names = @()
    foreach ($ext in $cert.Extensions) {
        if ($ext.Oid.Value -eq '2.5.29.15') {
            $flags = ([System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]$ext).KeyUsages.ToString()
            foreach ($f in ($flags -split ',\s*')) {
                if ($f -eq 'CrlSign') { $names += 'cRLSign' }
                elseif ($f.Length -gt 0) { $names += ($f.Substring(0, 1).ToLowerInvariant() + $f.Substring(1)) }
            }
        }
    }
    return [string[]]$names
}

function Get-ExtendedKeyUsageNames($cert) {
    $known = @{
        '1.3.6.1.5.5.7.3.1' = 'serverAuth'
        '1.3.6.1.5.5.7.3.2' = 'clientAuth'
        '1.3.6.1.5.5.7.3.3' = 'codeSigning'
        '1.3.6.1.5.5.7.3.4' = 'emailProtection'
    }
    $names = @()
    foreach ($ext in $cert.Extensions) {
        if ($ext.Oid.Value -eq '2.5.29.37') {
            foreach ($oid in ([System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]$ext).EnhancedKeyUsages) {
                if ($known.ContainsKey($oid.Value)) { $names += $known[$oid.Value] } else { $names += $oid.Value }
            }
        }
    }
    return [string[]]$names
}

$certificates = New-Object System.Collections.Generic.List[object]
$errors = New-Object System.Collections.Generic.List[object]

foreach ($location in $StoreLocations) {
    foreach ($storeName in $StoreNames) {
        $store = $null
        try {
            $store = New-Object System.Security.Cryptography.X509Certificates.X509Store($storeName, $location)
            # Apertura en modo SOLO LECTURA.
            $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly -bor [System.Security.Cryptography.X509Certificates.OpenFlags]::OpenExistingOnly)
            foreach ($cert in $store.Certificates) {
                try {
                    $key = Get-PublicKeyInfo $cert
                    $certificates.Add([ordered]@{
                        thumbprintSha256   = Get-Sha256Hex $cert.RawData
                        subject            = $cert.Subject
                        issuer             = $cert.Issuer
                        serialNumber       = $cert.SerialNumber
                        notBefore          = ConvertTo-IsoUtc $cert.NotBefore
                        notAfter           = ConvertTo-IsoUtc $cert.NotAfter
                        publicKeyAlgorithm = $key.Algorithm
                        keySizeBits        = $key.KeySize
                        signatureAlgorithm = ConvertTo-NormalizedSignature $cert.SignatureAlgorithm.FriendlyName
                        keyUsage           = [string[]]@(Get-KeyUsageNames $cert)
                        extendedKeyUsage   = [string[]]@(Get-ExtendedKeyUsageNames $cert)
                        storeLocation      = $location
                        storeName          = $storeName
                        hasPrivateKey      = [bool]$cert.HasPrivateKey
                    })
                } catch {
                    $errors.Add([ordered]@{ store = "$location\$storeName"; message = 'Certificado ilegible en el almacén' })
                }
            }
        } catch {
            # Un almacén inaccesible produce un resultado parcial, no un fallo total.
            $errors.Add([ordered]@{ store = "$location\$storeName"; message = 'No fue posible abrir el almacén de certificados' })
        } finally {
            if ($null -ne $store) { $store.Close() }
        }
    }
}

$report = [ordered]@{
    schemaVersion = '1.0'
    source        = 'POWERSHELL_AGENT'
    hostname      = $Hostname
    collectedAt   = ConvertTo-IsoUtc (Get-Date)
    certificates  = $certificates.ToArray()
    errors        = $errors.ToArray()
}

$json = ConvertTo-Json -InputObject $report -Depth 6
if ($OutputPath) {
    [System.IO.File]::WriteAllText($OutputPath, $json, (New-Object System.Text.UTF8Encoding($false)))
} else {
    Write-Output $json
}

# Código de salida distinto de cero solo si ningún almacén pudo leerse.
$totalStores = $StoreLocations.Count * $StoreNames.Count
if ($errors.Count -ge $totalStores -and $certificates.Count -eq 0) { exit 2 }
exit 0
