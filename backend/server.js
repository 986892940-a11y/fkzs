import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getVoiceMemosList, ensureDirectories } from './services/voiceMemos.js';
import { generateFeedbackFromText, generateFeedbackFromAudio } from './services/gemini.js';
import { composeKnowledgeCardImage } from './services/imageCardComposer.js';
import { generateFeedbackPDF } from './services/pdfGenerator.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5001;

// 跨域配置
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
}));

// 解析 JSON 格式主体与 URL 编码主体 (调大限制以便接收大图片 Base64)
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// 初始化临时上传文件夹
const tempUploadDir = path.join(__dirname, 'temp_uploads');
if (!fs.existsSync(tempUploadDir)) {
  fs.mkdirSync(tempUploadDir, { recursive: true });
}

// 配置 Multer 接收上传的音频文件
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, tempUploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}_temp${ext}`);
  }
});
const upload = multer({ storage });

// 启动时确保必要文件夹存在
ensureDirectories();

/**
 * 路由：获取录音备忘录列表
 */
app.get('/api/voice-memos', async (req, res) => {
  try {
    const list = await getVoiceMemosList();
    res.json({ success: true, data: list });
  } catch (err) {
    console.error('获取语音备忘录失败:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * 路由：根据音频或文本生成家长课后反馈和知识点卡片图片
 */
app.post('/api/generate-feedback', upload.single('audioFile'), async (req, res) => {
  const { type, memoPath, transcript, apiKey, studentName, imageStyle } = req.body;
  let tempFilePath = null;

  try {
    let feedback = '';

    if (type === 'text') {
      if (!transcript || !transcript.trim()) {
        return res.status(400).json({ success: false, message: '课堂文字稿内容不能为空' });
      }
      console.log('[Server] 正在为逐字稿生成反馈，字数:', transcript.length);
      feedback = await generateFeedbackFromText(transcript, studentName, apiKey);
      
    } else if (type === 'audio') {
      let targetAudioPath = null;
      let mimeType = 'audio/m4a';

      if (memoPath) {
        targetAudioPath = memoPath;
        mimeType = memoPath.endsWith('.mp3') ? 'audio/mp3' : 'audio/m4a';
      } else if (req.file) {
        targetAudioPath = req.file.path;
        tempFilePath = req.file.path; 
        mimeType = req.file.mimetype;
      }

      if (!targetAudioPath) {
        return res.status(400).json({ success: false, message: '请选择或上传需要处理的音频文件' });
      }

      console.log('[Server] 正在为音频文件生成反馈:', targetAudioPath);
      feedback = await generateFeedbackFromAudio(targetAudioPath, mimeType, studentName, apiKey);
    } else {
      return res.status(400).json({ success: false, message: '不支持的请求类型' });
    }

    // 文字生成完成后，生成中文总结图片
    let imageBase64 = '';
    try {
      console.log(`[Server] 正在生成核心知识点卡片图 (风格: ${imageStyle || 'chinese_ink'})...`);
      imageBase64 = await composeKnowledgeCardImage(feedback, imageStyle || 'chinese_ink', apiKey);
    } catch (imageErr) {
      console.error('[Server] 知识点总结图片生成告警:', imageErr.message);
    }

    return res.json({
      success: true,
      feedback,
      imageBase64 // 返回给前端直接渲染的 base64 图像
    });

  } catch (err) {
    console.error('生成反馈失败:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    // 异步清理上传的临时文件
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      fs.unlink(tempFilePath, (err) => {
        if (err) console.error('清理临时文件失败:', err);
      });
    }
  }
});

/**
 * 路由：根据反馈文本与图片 Base64 生成并下载 PDF
 */
app.post('/api/generate-pdf', async (req, res) => {
  const { studentName, feedbackText, imageBase64 } = req.body;

  if (!feedbackText) {
    return res.status(400).json({ success: false, message: '反馈文本内容不能为空' });
  }

  try {
    console.log(`[Server] 正在为学生 ${studentName || '未指定'} 构建图文 PDF...`);
    
    let imageBuffer = null;
    if (imageBase64) {
      imageBuffer = Buffer.from(imageBase64, 'base64');
    }

    const pdfBuffer = await generateFeedbackPDF({
      studentName,
      feedbackText,
      imageBuffer
    });

    res.contentType('application/pdf');
    res.send(pdfBuffer);
    console.log('[Server] PDF 生成完成并已发送。');
  } catch (err) {
    console.error('[Server] PDF 生成失败:', err);
    res.status(500).json({ success: false, message: 'PDF 导出失败: ' + err.message });
  }
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`=========================================`);
  console.log(`  反馈助手本地后端已成功启动!`);
  console.log(`  工作地址: http://127.0.0.1:${PORT}`);
  console.log(`=========================================`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`[Server Warning] 端口 ${PORT} 已被已有服务占用，服务仍可平滑复用。`);
  } else {
    console.error('[Server Error] 监听失败:', err);
  }
});
