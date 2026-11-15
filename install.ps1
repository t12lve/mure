#Requires -Version 5.1
<#
  install.ps1 - expose the Mure skill to the harnesses installed on this machine.

  Creates a directory junction (no admin rights needed) from each skills directory
  to this repository. Idempotent: an existing junction pointing here is left alone,
  an existing real directory is reported and skipped.

  Usage:
    .\install.ps1              link into every known skills directory that exists
    .\install.ps1 -Copy        copy instead of link
    .\install.ps1 -WhatIf      show what would happen
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [switch]$Copy,
  [string[]]$Targets
)

$ErrorActionPreference = 'Stop'
$source = $PSScriptRoot
$skill  = Join-Path $source 'SKILL.md'

if (-not (Test-Path $skill)) {
  throw "SKILL.md not found next to install.ps1 ($source)"
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Warning 'node was not found on PATH: the skill will install, but scripts/mure.mjs will not run.'
}

if (-not $Targets -or $Targets.Count -eq 0) {
  $home_ = $env:USERPROFILE
  $Targets = @(
    (Join-Path $home_ '.config\opencode\skills'),
    (Join-Path $home_ '.claude\skills'),
    (Join-Path $home_ '.agents\skills')
  )
}

$linked = 0
$skipped = 0

foreach ($dir in $Targets) {
  $parent = Split-Path $dir -Parent
  if (-not (Test-Path $parent)) {
    Write-Host "skip  $dir (no $parent)"
    $skipped++
    continue
  }
  if (-not (Test-Path $dir)) {
    if ($PSCmdlet.ShouldProcess($dir, 'create skills directory')) {
      New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
  }

  $dirFull = [IO.Path]::GetFullPath($dir)
  $srcFull = [IO.Path]::GetFullPath($source)
  if ($Copy -and $dirFull.StartsWith($srcFull + [IO.Path]::DirectorySeparatorChar)) {
    Write-Host "skip  $dir (inside the source repository; choose a directory outside it)"
    $skipped++
    continue
  }

  $dest = Join-Path $dir 'mure'
  if (Test-Path $dest) {
    $item = Get-Item $dest -Force
    $isLink = ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
    if ($isLink) {
      $current = $item.Target
      if ($current -and ((Resolve-Path $current -ErrorAction SilentlyContinue).Path -eq $source)) {
        Write-Host "ok    $dest (already linked)"
        $linked++
        continue
      }
      Write-Host "skip  $dest (links elsewhere: $current)"
      $skipped++
      continue
    }
    Write-Host "skip  $dest (exists; remove it to reinstall)"
    $skipped++
    continue
  }

  if ($PSCmdlet.ShouldProcess($dest, $(if ($Copy) { 'copy skill' } else { 'junction to ' + $source }))) {
    if ($Copy) {
      Copy-Item -Path $source -Destination $dest -Recurse
      if (Test-Path (Join-Path $dest '.git')) { Remove-Item (Join-Path $dest '.git') -Recurse -Force }
      Write-Host "copy  $dest"
    } else {
      New-Item -ItemType Junction -Path $dest -Target $source | Out-Null
      Write-Host "link  $dest -> $source"
    }
    $linked++
  }
}

Write-Host ''
Write-Host "linked/installed: $linked   skipped: $skipped"
Write-Host 'Restart your harness so it re-reads its skills directory.'
