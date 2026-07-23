import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import util from 'util';

const execAsync = util.promisify(exec);

// 各种可能的 macOS 语音备忘录及本地音视频目录
const CANDIDATE_DIRS = [
  path.join(os.homedir(), 'Library/Containers/com.apple.VoiceMemos/Data/Documents'),
  path.join(os.homedir(), 'Library/Group Containers/group.com.apple.voicememos/Recordings'),
  path.join(os.homedir(), 'Library/Application Support/com.apple.voicememos/Recordings'),
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
