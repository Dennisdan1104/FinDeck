# FinDeck 数据环境引导脚本（Windows PowerShell）
# 幂等：可重复运行。用法：powershell -ExecutionPolicy Bypass -File finance/python/setup-env.ps1
# 默认使用清华镜像（国内快），镜像失败自动回退官方 PyPI；设 $env:FD_PIP_INDEX 可覆盖
# （改名前的 $env:AD_PIP_INDEX 仍作兼容别名）。
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$venv = Join-Path $here ".venv"
$mirror = if ($env:FD_PIP_INDEX) { $env:FD_PIP_INDEX } elseif ($env:AD_PIP_INDEX) { $env:AD_PIP_INDEX } else { "https://pypi.tuna.tsinghua.edu.cn/simple" }

# 1. 创建 venv（已存在则跳过）
if (-Not (Test-Path (Join-Path $venv "Scripts\python.exe"))) {
  Write-Host "[findeck] creating venv at $venv"
  python -m venv $venv
}
$py = Join-Path $venv "Scripts\python.exe"

# 2. 升级 pip：镜像优先，失败回退官方源
& $py -m pip install --upgrade pip -i $mirror
if ($LASTEXITCODE -ne 0) {
  Write-Host "[findeck] mirror failed, retrying with the default index"
  & $py -m pip install --upgrade pip
}

# 3. 装依赖：镜像优先，失败回退官方源
& $py -m pip install -r (Join-Path $here "requirements-data.txt") -i $mirror
if ($LASTEXITCODE -ne 0) {
  Write-Host "[findeck] mirror failed, retrying with the default index"
  & $py -m pip install -r (Join-Path $here "requirements-data.txt")
}

# 4. 注册 findeck 工具包（quickmodels/charts）进 venv 的 site-packages
$sp = Join-Path $venv "Lib\site-packages"
New-Item -ItemType Directory -Force -Path $sp | Out-Null
Set-Content -Path (Join-Path $sp "findeck.pth") -Value "$here"
Write-Host "[findeck] done. interpreter: $py"
