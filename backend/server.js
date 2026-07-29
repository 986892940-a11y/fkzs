import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { getVoiceMemosList, getVoiceMemoByPath, launchVoiceMemosApp, openVoiceMemosFolder, getLatestRecordingFile } from './services/voiceMemos.js';
import { generateFeedbackFromText, generateFeedbackFromAudio, transcribeAudioToText } from './services/gemini.js';
import { composeKnowledgeCardImage } from './services/imageCardComposer.js';
import { generateFeedbackPDF } from './services/pdfGenerator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 强效跨路径 .env 配置文件自动搜索器
const possibleEnvPaths = [
  path.resolve(__dirname, '.env'),
  path.resolve(__dirname, '../.env'),
  '/Users/ziwelz/工作/AI/反馈助手/backend/.env',
  '/Users/ziwelz/工作/AI/反馈助手/.env',
  path.resolve(process.cwd(), 'backend/.env'),
  path.resolve(process.cwd(), '.env')
];

for (const envPath of possibleEnvPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    if (process.env.GEMINI_API_KEY) {
      console.log(`[Server] 成功在 ${envPath} 中加载 GEMINI_API_KEY！`);
      break;
    }
  }
}

const app = express();
const PORT = process.env.PORT || 5001;
const HOST = '127.0.0.1';
const API_TOKEN = process.env.FEEDBACK_API_TOKEN || crypto.randomBytes(32).toString('hex');
const API_TOKEN_HEADER = 'x-feedback-token';
const ALLOWED_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173', 'null']);
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
const MAX_PDF_IMAGE_COUNT = 3;
const MAX_PDF_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_PDF_TOTAL_BYTES = 5 * 1024 * 1024;
const requestWindows = new Map();

function isAllowedOrigin(origin) {
  return !origin || ALLOWED_ORIGINS.has(origin);
}

function requireApiToken(req, res, next) {
  const token = req.get(API_TOKEN_HEADER);
  const expected = Buffer.from(API_TOKEN);
  const provided = Buffer.from(token || '');
  if (!token || provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return res.status(401).json({ success: false, message: '本地 API 身份验证失败' });
  }
  next();
}

function limitRequests(req, res, next) {
  const now = Date.now();
  const key = `${req.ip}:${req.path}`;
  const recent = (requestWindows.get(key) || []).filter((time) => now - time < 60_000);
  const maxRequests = ['/generate-feedback', '/regenerate-poster', '/transcribe-memo', '/transcribe-uploaded-audio'].includes(req.path) ? 12 : 30;
  if (recent.length >= maxRequests) {
    return res.status(429).json({ success: false, message: '请求过于频繁，请稍后再试' });
  }
  recent.push(now);
  requestWindows.set(key, recent);
  next();
}

function isAllowedAudioUpload(file) {
  const extension = path.extname(file.originalname || '').toLowerCase();
  const allowedExtensions = new Set(['.m4a', '.mp3', '.wav', '.aac']);
  return allowedExtensions.has(extension) && (file.mimetype || '').startsWith('audio/');
}

function validatePdfImages(imagesBase64) {
  if (!Array.isArray(imagesBase64)) return { valid: false, message: 'PDF 图片数据格式无效' };
  if (imagesBase64.length > MAX_PDF_IMAGE_COUNT) return { valid: false, message: `PDF 最多支持 ${MAX_PDF_IMAGE_COUNT} 张图片` };

  let totalBytes = 0;
  for (const image of imagesBase64) {
    if (typeof image !== 'string') return { valid: false, message: 'PDF 图片数据格式无效' };
    const base64 = image.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/i, '');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) return { valid: false, message: 'PDF 图片编码无效' };
    const byteLength = Math.floor((base64.length * 3) / 4);
    if (byteLength > MAX_PDF_IMAGE_BYTES) return { valid: false, message: '单张 PDF 图片过大' };
    totalBytes += byteLength;
    if (totalBytes > MAX_PDF_TOTAL_BYTES) return { valid: false, message: 'PDF 图片总大小超出限制' };
  }
  return { valid: true };
}

app.use(cors({
  origin(origin, callback) {
    callback(null, isAllowedOrigin(origin));
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', API_TOKEN_HEADER]
}));
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use('/api', limitRequests, requireApiToken);

const upload = multer({
  dest: path.join(__dirname, 'uploads/'),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 20, parts: 25 },
  fileFilter(req, file, callback) {
    callback(null, isAllowedAudioUpload(file));
  }
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: '反馈助手后端 API' });
});

// 获取 macOS 语音备忘录及本地音频列表
app.get('/api/voice-memos', (req, res) => {
  try {
    const memos = getVoiceMemosList();
    res.json({ success: true, data: memos });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 唤起 macOS 原生语音备忘录
app.post('/api/launch-voice-memos', async (req, res) => {
  try {
    const result = await launchVoiceMemosApp();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 在 macOS 访达中打开语音备忘录存储目录
app.post('/api/open-voice-memos-dir', async (req, res) => {
  try {
    const result = await openVoiceMemosFolder();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 上传任意音频进行 AI 纯文本逐字稿转写
app.post('/api/transcribe-uploaded-audio', upload.single('audioFile'), async (req, res) => {
  const { apiKey } = req.body;
  if (!req.file) {
    return res.status(400).json({ success: false, message: '请上传音频文件' });
  }

  try {
    console.log(`[Server] 处理上传音频提取纯逐字稿: ${req.file.path}`);
    const transcript = await transcribeAudioToText(req.file.path, req.file.mimetype || 'audio/m4a', apiKey);
    res.json({ success: true, transcript, filename: req.file.originalname });
  } catch (err) {
    console.error('[Server] 音频纯逐字稿转写失败:', err);
    res.status(500).json({ success: false, message: err.message || '音频逐字稿转写失败' });
  } finally {
    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
    }
  }
});

// 抓取指定或最新音频文件，自动转化为纯文本逐字稿
app.post('/api/transcribe-memo', async (req, res) => {
  const { apiKey, memoPath } = req.body;
  try {
    let targetMemo = null;
    let filename = '选中的音频';

    if (!memoPath) {
      targetMemo = getLatestRecordingFile();
      if (!targetMemo) {
        return res.status(404).json({ success: false, message: '未能在系统中扫描到默认音频。请在界面上点击选择或手动导入音频。' });
      }
      filename = targetMemo.name;
    } else {
      targetMemo = getVoiceMemoByPath(memoPath);
      if (!targetMemo) {
        return res.status(403).json({ success: false, message: '只能转写应用列出的本地音频，请使用“选择本地音频”导入其他文件' });
      }
      filename = targetMemo.name;
    }

    const targetPath = targetMemo.path;

    console.log(`[Server] 开始提取纯逐字稿 [${filename}]:`, targetPath);
    const mimeType = targetPath.endsWith('.mp3') ? 'audio/mp3' : 'audio/m4a';
    const transcriptText = await transcribeAudioToText(targetPath, mimeType, apiKey);

    res.json({
      success: true,
      filename,
      transcript: transcriptText
    });
  } catch (err) {
    console.error('[Server] 提取纯逐字稿异常:', err);
    res.status(500).json({ success: false, message: err.message || '音频纯逐字稿提取失败' });
  }
});

// 生成图文反馈
app.post('/api/generate-feedback', upload.single('audioFile'), async (req, res) => {
  const { type, memoPath, transcript, apiKey, studentName, studentGrade, feedbackTone, imageStyle, posterMode } = req.body;
  let tempFilePath = null;

  try {
    let feedback = '';

    if (type === 'text') {
      if (!transcript || !transcript.trim()) {
        return res.status(400).json({ success: false, message: '逐字稿文本不能为空' });
      }
      console.log(`[Server] 正在为【${studentGrade || '未指定'}】学员逐字稿生成反馈 (语气: ${feedbackTone || '严谨鼓励'})...`);
      feedback = await generateFeedbackFromText(transcript, studentName, studentGrade, apiKey, feedbackTone);
      
    } else if (type === 'audio') {
      let targetAudioPath = null;
      let mimeType = 'audio/m4a';

      if (req.file) {
        targetAudioPath = req.file.path;
        tempFilePath = req.file.path;
        mimeType = req.file.mimetype;
      }

      if (!req.file && memoPath) {
        const memo = getVoiceMemoByPath(memoPath);
        if (!memo) {
          return res.status(403).json({ success: false, message: '只能使用应用列出的本地音频，请上传其他文件' });
        }
        targetAudioPath = memo.path;
      }

      if (!targetAudioPath) {
        return res.status(400).json({ success: false, message: '请选择或上传录音文件' });
      }

      console.log(`[Server] 正在为【${studentGrade || '未指定'}】学员音频生成反馈 (语气: ${feedbackTone || '严谨鼓励'}):`, targetAudioPath);
      feedback = await generateFeedbackFromAudio(targetAudioPath, mimeType, studentName, apiKey, feedbackTone);
    }

    // 结合逐字稿与用户主题，调用 Nano Banana 2 生成海报 (依据 posterMode 控制)
    let imageBase64 = null;
    let imagesBase64 = [];
    try {
      if (posterMode !== 'none') {
        console.log(`[Server] 🍌 正在调用 Nano Banana 2 模型 (海报模式: ${posterMode || 'single'}, 主题: ${imageStyle || '宋代山水画意境'})...`);
        const imgRes = await composeKnowledgeCardImage({
          transcript: transcript || feedback,
          feedbackText: feedback,
          styleType: imageStyle || '宋代山水画意境',
          customApiKey: apiKey,
          posterMode: posterMode || 'single'
        });

        if (imgRes && typeof imgRes === 'object') {
          imageBase64 = imgRes.primaryImage || null;
          imagesBase64 = Array.isArray(imgRes.allImages) ? imgRes.allImages : (imageBase64 ? [imageBase64] : []);
        } else if (typeof imgRes === 'string') {
          imageBase64 = imgRes;
          imagesBase64 = [imgRes];
        }
      }
    } catch (imgErr) {
      console.warn('[Server] 合成知识图谱图片告警:', imgErr.message);
    }

    res.json({
      success: true,
      feedback,
      imageBase64,
      imagesBase64
    });

  } catch (err) {
    console.error('[Server] 生成反馈失败异常:', err);
    res.status(500).json({ success: false, message: err.message || '生成课后反馈失败' });
  } finally {
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try { fs.unlinkSync(tempFilePath); } catch (e) {}
    }
  }
});

// 根据修改后的最新文本重新生成知识海报
app.post('/api/regenerate-poster', async (req, res) => {
  const { feedbackText, imageStyle, posterMode, apiKey } = req.body;
  try {
    if (!feedbackText || !feedbackText.trim()) {
      return res.status(400).json({ success: false, message: '反馈文本不能为空' });
    }

    console.log(`[Server] 🔄 正在根据修正后的最新文本重新生成 2K 知识海报... (主题: ${imageStyle || '宋代山水画意境'})`);
    const imgRes = await composeKnowledgeCardImage({
      transcript: feedbackText,
      feedbackText: feedbackText,
      styleType: imageStyle || '宋代山水画意境',
      customApiKey: apiKey,
      posterMode: posterMode || 'single'
    });

    let imageBase64 = null;
    let imagesBase64 = [];

    if (imgRes && typeof imgRes === 'object') {
      imageBase64 = imgRes.primaryImage || null;
      imagesBase64 = Array.isArray(imgRes.allImages) ? imgRes.allImages : (imageBase64 ? [imageBase64] : []);
    } else if (typeof imgRes === 'string') {
      imageBase64 = imgRes;
      imagesBase64 = [imgRes];
    }

    res.json({
      success: true,
      imageBase64,
      imagesBase64
    });
  } catch (err) {
    console.error('[Server] 重新绘制海报异常:', err);
    res.status(500).json({ success: false, message: err.message || '重新绘制海报失败' });
  }
});

// 导出 PDF
app.post('/api/generate-pdf', async (req, res) => {
  const { studentName, studentGrade, pdfBrandTitle, pdfHeaderTitle, feedbackText, imageBase64, imagesBase64 } = req.body;

  if (!feedbackText) {
    return res.status(400).json({ success: false, message: '反馈文本内容不能为空' });
  }

  const pdfImages = imagesBase64 || (imageBase64 ? [imageBase64] : []);
  const pdfImagesValidation = validatePdfImages(pdfImages);
  if (!pdfImagesValidation.valid) {
    return res.status(413).json({ success: false, message: pdfImagesValidation.message });
  }

  try {
    const pdfBuffer = await generateFeedbackPDF({
      studentName,
      studentGrade,
      pdfBrandTitle,
      pdfHeaderTitle,
      feedbackText,
      imageBuffer: imageBase64,
      imagesBase64: pdfImages
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=feedback.pdf`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('[Server] 导出 PDF 失败:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(413).json({ success: false, message: '上传文件超出安全限制' });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ success: false, message: '请求内容超出安全限制' });
  }
  next(err);
});

app.listen(PORT, HOST, () => {
  console.log(`🚀 [Backend API] 反馈助手后端服务已成功启动，监听端口: http://${HOST}:${PORT}`);
});
