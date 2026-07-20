import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execAsync = promisify(exec);

// macOS 默认语音备忘录录音目录定义
// 1. 新版 macOS (Sonoma/Ventura) 语音备忘录共享组目录
const MACOS_VOICE_MEMOS_SHARED_DIR = path.join(
  os.homedir(),
  'Library/Group Containers/group.com.apple.VoiceMemos.shared/Recordings'
);

// 2. 经典 macOS 语音备忘录 Catalyst 容器内部目录
const MACOS_VOICE_MEMOS_LEGACY_DIR = path.join(
  os.homedir(),
  'Library/Containers/com.apple.VoiceMemos/Data/Library/Application Support/com.apple.VoiceMemos/Recordings'
);

// 安全的本地录音缓存文件夹 (放在用户 Home 目录下的 .feedback_assistant 中，避免无权在根目录 mkdir 崩溃)
const LOCAL_RECORDINGS_DIR = path.join(os.homedir(), '.feedback_assistant', 'recordings');

/**
 * 确保本地录音文件夹存在 (防错包装)
 */
export function ensureDirectories() {
  try {
    if (!fs.existsSync(LOCAL_RECORDINGS_DIR)) {
      fs.mkdirSync(LOCAL_RECORDINGS_DIR, { recursive: true });
    }
  } catch (err) {
    console.warn('[Directory Warning] 创建本地备用录音目录提示:', err.message);
  }
}

/**
 * 安全地读取一个文件夹下的所有 .m4a/.mp3 录音文件
 * @param {string} dirPath 文件夹路径
 * @param {string} type 来源标记 ('macos' | 'local')
 */
async function scanDirectory(dirPath, type) {
  try {
    if (!fs.existsSync(dirPath)) {
      return [];
    }
    
    const files = await fs.promises.readdir(dirPath);
    const audioFiles = files.filter(f => f.endsWith('.m4a') || f.endsWith('.mp3') || f.endsWith('.wav'));
    
    const list = [];
    for (const file of audioFiles) {
      const filePath = path.join(dirPath, file);
      try {
        const stat = await fs.promises.stat(filePath);
        list.push({
          id: `${type}-${file}`,
          name: file,
          path: filePath,
          size: stat.size,
          createdAt: stat.mtime,
          type: type
        });
      } catch (e) {
        console.warn(`[文件读取失败] ${file}: ${e.message}`);
      }
    }
    return list;
  } catch (err) {
    console.warn(`[扫描目录失败] 路径: ${dirPath}, 错误: ${err.message}`);
    return [];
  }
}

/**
 * 读取本地 sqlite 数据库获取真实备忘录名称
 * @param {string} baseDir 备忘录录音所在的根目录
 */
async function fetchMacosMemosWithSqlite(baseDir) {
  const dbPath = path.join(baseDir, 'CloudRecordings.sqlite');
  const fallbackDbPath = path.join(baseDir, 'Recordings.sqlite');
  
  let targetDb = null;
  if (fs.existsSync(dbPath)) {
    targetDb = dbPath;
  } else if (fs.existsSync(fallbackDbPath)) {
    targetDb = fallbackDbPath;
  }
  
  if (!targetDb) {
    return null;
  }

  try {
    const query = `
      SELECT 
        datetime(ZCREATIONDATE + 978307200, 'unixepoch', 'localtime') as date,
        ZTITLE,
        ZPATH,
        ZDURATION
      FROM ZRECORDING
      WHERE ZPATH IS NOT NULL
      ORDER BY ZCREATIONDATE DESC;
    `;
    
    const { stdout } = await execAsync(`sqlite3 "${targetDb}" "${query.replace(/"/g, '\\"')}"`);
    if (!stdout.trim()) return null;

    const rows = stdout.trim().split('\n');
    const dbMemos = rows.map(row => {
      const parts = row.split('|');
      return {
        createdAtStr: parts[0],
        title: parts[1],
        fileName: parts[2],
        duration: parts[3] ? parseFloat(parts[3]) : 0
      };
    });

    return dbMemos;
  } catch (err) {
    console.warn(`[Sqlite3查询警告] 路径: ${targetDb}, 错误: ${err.message}`);
    return null;
  }
}

/**
 * 获取所有的录音文件列表
 */
export async function getVoiceMemosList() {
  ensureDirectories();
  
  // 1. 扫描本地文件夹
  const localMemos = await scanDirectory(LOCAL_RECORDINGS_DIR, 'local');
  
  // 2. 扫描 macOS 系统备忘录
  let macosMemos = [];
  let activeSystemDir = null;

  let sharedMemos = await scanDirectory(MACOS_VOICE_MEMOS_SHARED_DIR, 'macos');
  if (sharedMemos.length > 0) {
    macosMemos = sharedMemos;
    activeSystemDir = MACOS_VOICE_MEMOS_SHARED_DIR;
  } else {
    let legacyMemos = await scanDirectory(MACOS_VOICE_MEMOS_LEGACY_DIR, 'macos');
    if (legacyMemos.length > 0) {
      macosMemos = legacyMemos;
      activeSystemDir = MACOS_VOICE_MEMOS_LEGACY_DIR;
    }
  }
  
  // 3. 关联 SQLite 数据库进行音频重命名
  if (macosMemos.length > 0 && activeSystemDir) {
    const dbMemos = await fetchMacosMemosWithSqlite(activeSystemDir);
    if (dbMemos && dbMemos.length > 0) {
      macosMemos.forEach(memo => {
        const matchingDb = dbMemos.find(db => 
          memo.name === db.fileName ||
          memo.name.includes(db.fileName) || 
          db.fileName.includes(memo.name)
        );
        
        if (matchingDb && matchingDb.title) {
          memo.name = matchingDb.title;
          memo.duration = formatDuration(matchingDb.duration);
        }
      });
    }
  }

  const allMemos = [...localMemos, ...macosMemos];
  allMemos.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  return allMemos;
}

function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
