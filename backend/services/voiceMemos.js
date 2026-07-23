import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import util from 'util';

const execAsync = util.promisify(exec);

// 涵盖所有 macOS 系统的语音备忘录原生存储目录
const CANDIDATE_DIRS = [
  path.join(os.homedir(), 'Library/Group Containers/group.com.apple.VoiceMemos.shared/Recordings'),
  path.join(os.homedir(), 'Library/Containers/com.apple.VoiceMemos/Data/Documents'),
  path.join(os.homedir(), 'Library/Application Support/com.apple.VoiceMemos/Recordings'),
  path.join(os.homedir(), 'Library/Group Containers/group.com.apple.VoiceMemos.shared'),
  path.join(os.homedir(), 'Downloads'),
  path.join(os.homedir(), 'Desktop'),
  path.join(os.homedir(), '.feedback_assistant', 'recordings')
];

/**
 * 唤起 macOS 原生语音备忘录应用 (VoiceMemos)
 */
export async function launchVoiceMemosApp() {
  try {
    await execAsync('open -a "Voice Memos" || open -a "语音备忘录" || open -a "VoiceMemos"');
    console.log('[VoiceMemos] 成功唤起 macOS 语音备忘录');
    return { success: true };
  } catch (err) {
    console.warn('[VoiceMemos] 唤起语音备忘录警告:', err.message);
    return { success: false, message: '唤起失败: ' + err.message };
  }
}

/**
 * 在 macOS 访达 (Finder) 中直接打开语音备忘录原生存储目录
 */
export async function openVoiceMemosFolder() {
  const targetDir = path.join(os.homedir(), 'Library/Group Containers/group.com.apple.VoiceMemos.shared/Recordings');
  try {
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    await execAsync(`open "${targetDir}"`);
    return { success: true, path: targetDir };
  } catch (err) {
    console.warn('[VoiceMemos] 打开文件夹失败:', err.message);
    return { success: false, message: err.message };
  }
}

/**
 * 获取 macOS 语音备忘录及本地音频列表
 */
export function getVoiceMemosList() {
  const memoFiles = [];

  for (const dirPath of CANDIDATE_DIRS) {
    if (fs.existsSync(dirPath)) {
      try {
        const files = fs.readdirSync(dirPath);
        for (const file of files) {
          if (file.endsWith('.m4a') || file.endsWith('.mp3') || file.endsWith('.wav') || file.endsWith('.aac')) {
            const filePath = path.join(dirPath, file);
            try {
              const stat = fs.statSync(filePath);
              memoFiles.push({
                id: filePath,
                name: file.replace(/\.\w+$/, ''),
                path: filePath,
                size: stat.size,
                createdAt: stat.mtime
              });
            } catch (e) {}
          }
        }
      } catch (e) {
        // macOS EPERM 权限限制时捕获不崩溃
      }
    }
  }

  // 去重 & 按时间倒序排序
  const uniqueMemosMap = new Map();
  memoFiles.forEach(m => uniqueMemosMap.set(m.path, m));
  const uniqueList = Array.from(uniqueMemosMap.values());

  uniqueList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return uniqueList;
}

export const getVoiceMemos = getVoiceMemosList;

/**
 * 获取最新的录音文件
 */
export function getLatestRecordingFile() {
  const memos = getVoiceMemosList();
  if (!memos || memos.length === 0) return null;
  return memos[0];
}
