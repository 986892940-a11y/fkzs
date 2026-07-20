#!/bin/bash

# 获取脚本所在目录
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$SCRIPT_DIR"

echo "================================================="
echo "        🚀 启动 反馈助手 macOS 桌面独立应用 🚀"
echo "================================================="

# 1. 检查 Electron 环境
HAS_ELECTRON=false
if [ -f "$SCRIPT_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" ] || command -v electron &> /dev/null; then
    HAS_ELECTRON=true
fi

# 清理退出的钩子
cleanup() {
    echo ""
    echo "🛑 正在关闭所有反馈助手后台服务..."
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    exit
}
trap cleanup SIGINT SIGTERM

# 2. 启动 Express 本地后端 (端口 5001)
echo "👉 [1/3] 启动本地后端 API (gemini-3.5-flash & Nano Banana 2 Lite 服务)..."
cd "$SCRIPT_DIR/backend"
npm run start > /dev/null 2>&1 &
BACKEND_PID=$!

# 3. 启动 Vite 前端开发服务 (端口 5173)
echo "👉 [2/3] 启动前端 Web UI 界面..."
cd "$SCRIPT_DIR/frontend"
npm run dev > /dev/null 2>&1 &
FRONTEND_PID=$!

# 等待服务就绪
sleep 2.5

# 4. 根据 Electron 环境唤起桌面应用程序窗口
echo "👉 [3/3] 正在调起应用界面..."

if [ "$HAS_ELECTRON" = true ]; then
    echo "✨ 成功检测到 Electron！已唤起 macOS 桌面原生窗口应用..."
    cd "$SCRIPT_DIR"
    npx electron .
else
    echo "ℹ️  提示：正在浏览器中打开桌面应用程序界面 (http://localhost:5173)..."
    open "http://localhost:5173"
    # 保持脚本挂起
    wait $FRONTEND_PID
fi

cleanup
