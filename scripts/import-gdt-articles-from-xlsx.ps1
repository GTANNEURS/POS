[CmdletBinding()]
param(
  [string]$SourcePath = "C:\xampp\htdocs\order_app\gdt-suite\outputs\imports\listes-articles-gdt.csv",
  [string]$ApiBase = "http://localhost:4000/api",
  [string]$Email = "admin@gdt.local",
  [string]$Password = "Admin123!",
  [int]$ChunkSize = 100
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Parse-DecimalValue {
  param([object]$Value)
  if ($null -eq $Value) { return 0.0 }
  $text = ([string]$Value).Trim()
  if (-not $text) { return 0.0 }
  $text = $text -replace '\s+', ''
  $text = $text -replace ',', '.'
  $parsed = 0.0
  if ([double]::TryParse($text, [System.Globalization.NumberStyles]::Any, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$parsed)) {
    return [Math]::Round($parsed, 2)
  }
  return 0.0
}

function Parse-IntValue {
  param([object]$Value)
  return [int][Math]::Round((Parse-DecimalValue $Value), 0)
}

function Parse-BoolValue {
  param([object]$Value)
  if ($null -eq $Value) { return "false" }
  $text = ([string]$Value).Trim().ToLowerInvariant()
  if (-not $text) { return "false" }
  if (@("true", "1", "oui", "yes", "vrai").Contains($text)) { return "true" }
  return "false"
}

function Clean-Text {
  param([object]$Value)
  if ($null -eq $Value) { return "" }
  return ([string]$Value).Trim()
}

if (-not (Test-Path -LiteralPath $SourcePath)) {
  throw "Fichier source introuvable : $SourcePath"
}

$outputDir = Join-Path $PSScriptRoot "..\outputs\imports"
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$duplicateReportPath = Join-Path $outputDir "gdt-articles-duplicate-references-$timestamp.json"
$summaryPath = Join-Path $outputDir "gdt-articles-import-summary-$timestamp.json"

$csvRows = Import-Csv -LiteralPath $SourcePath -Delimiter ';'
$rawRows = New-Object System.Collections.Generic.List[object]
$referenceMap = @{}
$sourceRow = 2

foreach ($record in $csvRows) {
  $article = Clean-Text $record.'Article'
  $category = Clean-Text $record.'Categorie article'
  $type = Clean-Text $record.'Type article'
  $taxRate = Parse-DecimalValue $record.'TVA'
  $salePriceTtc = Parse-DecimalValue $record.'PRIX TTC'
  $stock = Parse-IntValue $record.'QTE'
  $barcode = Clean-Text $record.'CODE A BARRE'
  $weight = Clean-Text $record.'POIDS'
  $reference = Clean-Text $record.'REFERENCE'
  $detaxable = Parse-BoolValue $record.'DETAXABLE'
  $commission = Parse-BoolValue $record.'COMMISSION'

  if (-not $reference -or -not $article) {
    $sourceRow += 1
    continue
  }

  $salePriceHt = if ($taxRate -gt 0) { [Math]::Round($salePriceTtc / (1 + ($taxRate / 100)), 2) } else { [Math]::Round($salePriceTtc, 2) }

  $entry = [pscustomobject]@{
    sourceRow = $sourceRow
    reference = $reference
    article = $article
    category = $category
    type = $type
    tva = $taxRate
    prix = $salePriceTtc
    salepriceht = $salePriceHt
    purchasepriceht = 0
    purchasepricettc = 0
    stock = $stock
    barcode = $barcode
    weight = $weight
    detaxable = $detaxable
    commission = $commission
    warehouse = "Dépôt Central"
    status = "ACTIVE"
  }

  $rawRows.Add($entry) | Out-Null
  $referenceKey = $reference.ToUpperInvariant()
  if (-not $referenceMap.ContainsKey($referenceKey)) {
    $referenceMap[$referenceKey] = New-Object System.Collections.Generic.List[object]
  }
  $referenceMap[$referenceKey].Add($entry) | Out-Null
  $sourceRow += 1
}

$duplicateGroups = @(
  $referenceMap.GetEnumerator() |
    Where-Object { $_.Value.Count -gt 1 } |
    Sort-Object Name |
    ForEach-Object {
      [pscustomobject]@{
        reference = $_.Key
        rows = @($_.Value | ForEach-Object {
          [pscustomobject]@{
            sourceRow = $_.sourceRow
            article = $_.article
            category = $_.category
            type = $_.type
            barcode = $_.barcode
            prix = $_.prix
          }
        })
      }
    }
)

try {
  $duplicateGroups | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $duplicateReportPath -Encoding UTF8 -Force
} catch {
  $duplicateReportPath = ""
}
$duplicateKeys = @($duplicateGroups | ForEach-Object { $_.reference })

$rowsToImport = @(
  $rawRows |
    Where-Object { $duplicateKeys -notcontains $_.reference.ToUpperInvariant() } |
    ForEach-Object {
      @{
        reference = $_.reference
        article = $_.article
        category = $_.category
        type = $_.type
        tva = $_.tva
        prix = $_.prix
        salepriceht = $_.salepriceht
        purchasepriceht = $_.purchasepriceht
        purchasepricettc = $_.purchasepricettc
        stock = $_.stock
        barcode = $_.barcode
        weight = $_.weight
        detaxable = $_.detaxable
        commission = $_.commission
        warehouse = $_.warehouse
        status = $_.status
      }
    }
)

$sourceRowByReference = @{}
foreach ($entry in $rawRows) {
  $sourceRowByReference[$entry.reference.ToUpperInvariant()] = $entry.sourceRow
}

$loginBody = @{ email = $Email; password = $Password } | ConvertTo-Json
$login = Invoke-RestMethod -UseBasicParsing -Uri "$ApiBase/auth/login" -Method POST -ContentType "application/json" -Body $loginBody
$token = $login.data.accessToken
$headers = @{ Authorization = "Bearer $token" }

$created = 0
$updated = 0
$apiErrorCount = 0

for ($start = 0; $start -lt $rowsToImport.Count; $start += $ChunkSize) {
  $chunk = @($rowsToImport | Select-Object -Skip $start -First $ChunkSize)
  $body = @{ rows = $chunk } | ConvertTo-Json -Depth 8 -Compress
  $result = Invoke-RestMethod -UseBasicParsing -Uri "$ApiBase/products/import" -Method POST -ContentType "application/json" -Headers $headers -Body $body
  $created += [int]$result.data.created
  $updated += [int]$result.data.updated

  $apiErrorCount += @($result.data.errors).Count
}

$skippedRows = [int](($duplicateGroups | ForEach-Object { $_.rows.Count } | Measure-Object -Sum).Sum)

$summary = [pscustomobject]@{
  sourcePath = $SourcePath
  totalRowsRead = $rawRows.Count
  duplicateReferenceGroups = $duplicateGroups.Count
  skippedRowsBecauseDuplicateReference = $skippedRows
  rowsSentToImport = $rowsToImport.Count
  created = $created
  updated = $updated
  apiErrors = $apiErrorCount
  duplicateReportPath = $duplicateReportPath
}

$summaryJson = $summary | ConvertTo-Json -Depth 8
try {
  $summaryJson | Set-Content -LiteralPath $summaryPath -Encoding UTF8 -Force
} catch {
}
Write-Output $summaryJson
