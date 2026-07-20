import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;

// 1. 在 Electron 主进程中优雅同进程启动 Express 后端 API 服务
async function startBackendService() {
  try {
    console.log('[Electron Main] 正在启动内置 Express 后端服务...');
    const serverModulePath = path.join(__dirname, 'backend/server.js');
    console.log('[Electron Main] 正在引入 Server 模块:', serverModulePath);
    await import(`file://${serverModulePath}`);
    console.log('[Electron Main] Express 本地服务已成功启动！');
  } catch (err) {
    console.error('[Electron Main] 启动 Express 服务失败告警:', err);
    dialog.showErrorBox('后端 API 服务启动告警', `服务启动异常: ${err.message}\n${err.stack}`);
  }
}

// 2. 创建应用主窗口
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    title: '反馈助手',
    titleBarStyle: 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    }
  });

  // 判断开发与生产环境
  const isDev = process.env.NODE_ENV === 'development';
  
  if (isDev) {
    console.log('[Electron Main] 运行于开发调试模式...');
    mainWindow.loadURL('http://localhost:5173');
  } else {
    console.log('[Electron Main] 运行于 macOS 原生 .app 打包发行模式...');
    const htmlPath = path.resolve(__dirname, 'frontend/dist/index.html');
    console.log('[Electron Main] 正在加载 HTML 页面:', htmlPath);

    if (fs.existsSync(htmlPath)) {
      mainWindow.loadFile(htmlPath).catch(err => {
        console.error('[Electron Main] 加载本地 HTML 页面失败:', err);
      });
    } else {
      console.error('[Electron Main] HTML 页面不存在:', htmlPath);
    }
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 3. 原生 PDF 保存对话框 IPC
function setupIpcHandlers() {
  ipcMain.handle('save-pdf', async (event, { pdfBase64, defaultName }) => {
    if (!mainWindow) return { success: false, error: '窗口无效' };

    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      title: '选择课后反馈 PDF 保存位置',
      defaultPath: defaultName,
      filters: [
        { name: 'PDF Document', extensions: ['pdf'] }
      ]
    });

    if (!filePath) {
      return { success: false, error: 'User cancelled' };
    }

    try {
      const buffer = Buffer.from(pdfBase64, 'base64');
      fs.writeFileSync(filePath, buffer);
      console.log(`[Electron Main] PDF 保存成功: ${filePath}`);
      return { success: true, filePath };
    } catch (err) {
      console.error('[Electron Main] PDF 保存失败:', err);
      return { success: false, error: err.message };
    }
  });
}

// 应用生命周期
app.whenReady().then(async () => {
  await startBackendService();
  setupIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
