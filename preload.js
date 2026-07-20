const { contextBridge, ipcRenderer } = require('electron');

// 桥接 API，使前端能够安全地调用 Electron 主进程的 native 功能
contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * 保存 PDF 文件
   * @param {string} pdfBase64 Base64 格式的 PDF 字节流
   * @param {string} defaultName 默认文件名
   */
  savePdf: (pdfBase64, defaultName) => ipcRenderer.invoke('save-pdf', { pdfBase64, defaultName })
});
