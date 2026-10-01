#!/usr/bin/env bash
# FinDeck 数据环境引导脚本（Linux / macOS / Git-Bash）
# 幂等：可重复运行。用法：bash finance/python/setup-env.sh
# 默认使用清华镜像（国内快），镜像失败自动回退官方 PyPI；设 FD_PIP_INDEX 可覆盖
# （改名前的 AD_PIP_INDEX 仍作兼容别名）。
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
venv="$here/.venv"
mirror="${FD_PIP_INDEX:-${AD_PIP_INDEX:-https://pypi.tuna.tsinghua.edu.cn/simple}}"

# 1. 创建 venv（已存在则跳过）
# Windows 建的 venv 在 Scripts/，Linux/macOS 在 bin/——Git-Bash 下两种都要认。
if [ -x "$venv/Scripts/python.exe" ]; then
  py="$venv/Scripts/python.exe"
elif [ -x "$venv/bin/python" ]; then
  py="$venv/bin/python"
else
  echo "[findeck] creating venv at $venv"
  python -m venv "$venv"
  if [ -x "$venv/Scripts/python.exe" ]; then
    py="$venv/Scripts/python.exe"
  else
    py="$venv/bin/python"
  fi
fi

# 2. 升级 pip：镜像优先，失败回退官方源
"$py" -m pip install --upgrade pip -i "$mirror" || {
  echo "[findeck] mirror failed, retrying with the default index"
  "$py" -m pip install --upgrade pip
}

# 3. 装依赖：镜像优先，失败回退官方源
"$py" -m pip install -r "$here/requirements-data.txt" -i "$mirror" || {
  echo "[findeck] mirror failed, retrying with the default index"
  "$py" -m pip install -r "$here/requirements-data.txt"
}

# 4. 注册 findeck 工具包（quickmodels/charts）进 venv 的 site-packages
# 用 sysconfig 解析路径：Windows 是 Lib/site-packages，Linux/macOS 是 lib/pythonX.Y/site-packages。
sp="$("$py" -c 'import sysconfig; print(sysconfig.get_paths()["purelib"])')"
mkdir -p "$sp" && printf '%s\n' "$here" > "$sp/findeck.pth"
echo "[findeck] done. interpreter: $py"
