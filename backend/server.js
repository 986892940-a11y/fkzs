import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getVoiceMemosList, launchVoiceMemosApp, openVoiceMemosFolder, getLatestRecordingFile } from './services/voiceMemos.js';
import { generateFeedbackFromText, generateFeedbackFromAudio } from './services/gemini.js';
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

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const upload = multer({ dest: path.join(__dirname, 'uploads/') });

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

// 上传任意音频进行 AI 转文字
app.post('/api/transcribe-uploaded-audio', upload.single('audioFile'), async (req, res) => {
  const { apiKey, studentName } = req.body;
  if (!req.file) {
    return res.status(400).json({ success: false, message: '请上传音频文件' });
  }

  try {
    console.log(`[Server] 处理上传音频转文字: ${req.file.path}`);
    const transcript = await generateFeedbackFromAudio(req.file.path, req.file.mimetype || 'audio/m4a', studentName, apiKey);
    res.json({ success: true, transcript, filename: req.file.originalname });
  } catch (err) {
    console.error('[Server] 音频转文字失败:', err);
    res.status(500).json({ success: false, message: err.message || '音频转文字失败' });
  } finally {
    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
    }
  }
});

// 抓取指定或最新音频文件，自动转化为文本逐字稿
app.post('/api/transcribe-memo', async (req, res) => {
  const { apiKey, studentName, memoPath } = req.body;
  try {
    let targetPath = memoPath;
    let filename = '选中的音频';

    if (!targetPath) {
      const latestFile = getLatestRecordingFile();
      if (!latestFile) {
        return res.status(404).json({ success: false, message: '未能在系统中扫描到默认音频。请在界面上点击选择或手动导入音频。' });
      }
      targetPath = latestFile.path;
      filename = latestFile.name;
    } else {
      filename = path.basename(targetPath);
    }

    if (!fs.existsSync(targetPath)) {
      return res.status(404).json({ success: false, message: `音频文件不存在或路径受限制: ${targetPath}` });
    }

    console.log(`[Server] 开始转写音频文件 [${filename}]:`, targetPath);
    const mimeType = targetPath.endsWith('.mp3') ? 'audio/mp3' : 'audio/m4a';
    const feedbackText = await generateFeedbackFromAudio(targetPath, mimeType, studentName, apiKey);

    res.json({
      success: true,
      filename,
      transcript: feedbackText
    });
  } catch (err) {
    console.error('[Server] 转写音频文本异常:', err);
    res.status(500).json({ success: false, message: err.message || '转写音频失败' });
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
      let targetAudioPath = memoPath;
      let mimeType = 'audio/m4a';

      if (req.file) {
        targetAudioPath = req.file.path;
        tempFilePath = req.file.path;
        mimeType = req.file.mimetype;
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
    console.error('[Server] 生成反馈失败:', err);
    res.status(500).json({ success: false, message: err.message || '生成反馈失败' });
  } finally {
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try { fs.unlinkSync(tempFilePath); } catch (e) {}
    }
  }
});

// 导出 PDF
app.post('/api/generate-pdf', async (req, res) => {
  const { studentName, studentGrade, pdfBrandTitle, pdfHeaderTitle, feedbackText, imageBase64, imagesBase64 } = req.body;

  if (!feedbackText) {
    return res.status(400).json({ success: false, message: '反馈文本内容不能为空' });
  }

  try {
    const pdfBuffer = await generateFeedbackPDF({
      studentName,
      studentGrade,
      pdfBrandTitle,
      pdfHeaderTitle,
      feedbackText,
      imageBuffer: imageBase64,
      imagesBase64: imagesBase64 || (imageBase64 ? [imageBase64] : [])
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=feedback.pdf`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('[Server] 导出 PDF 失败:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 [Backend API] 反馈助手后端服务已成功启动，监听端口: http://127.0.0.1:${PORT}`);
});
