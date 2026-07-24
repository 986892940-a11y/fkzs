import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { HttpsProxyAgent } from 'https-proxy-agent';
import nodeFetch from 'node-fetch';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 强效跨路径 .env 配置文件自动搜索器
const possibleEnvPaths = [
  path.resolve(__dirname, '../.env'),
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '.env'),
  '/Users/ziwelz/工作/AI/反馈助手/backend/.env',
  '/Users/ziwelz/工作/AI/反馈助手/.env',
  path.resolve(process.cwd(), 'backend/.env'),
  path.resolve(process.cwd(), '.env')
];

for (const envPath of possibleEnvPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    if (process.env.GEMINI_API_KEY) {
      console.log(`[Gemini] 成功在 ${envPath} 中加载 GEMINI_API_KEY！`);
      break;
    }
  }
}

import { setGlobalDispatcher, ProxyAgent } from 'undici';

// 挂载代理 (自动适配本地 10808 等代理端口)
function configureProxy() {
  const commonPorts = [process.env.HTTPS_PROXY, process.env.HTTP_PROXY, 'http://127.0.0.1:10808', 'http://127.0.0.1:7890', 'http://127.0.0.1:7897', 'http://127.0.0.1:1087'];
  for (const p of commonPorts) {
    if (p) {
      try {
        setGlobalDispatcher(new ProxyAgent(p));
        break;
      } catch (e) {}
    }
  }
}

configureProxy();

// 读取项目的系统提示词 (docs/prompt.md)，使用绝对路径兼容开发与打包环境
const PROMPT_FILE_PATH = path.resolve(__dirname, '../../docs/prompt.md');

function getSystemPrompt() {
  try {
    if (fs.existsSync(PROMPT_FILE_PATH)) {
      return fs.readFileSync(PROMPT_FILE_PATH, 'utf-8');
    }
  } catch (err) {
    console.error('读取系统提示词失败，将使用默认兜底提示词:', err);
  }
  return '你是一个温和细致的课堂整理助手。根据提供的课堂录音或逐字稿，提取授课信息，为家长写一份清爽、不含Markdown标记、不含角标引用的纯文本课后学习反馈。';
}

function getGeminiClient(customApiKey) {
  const apiKey = customApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
    throw new Error('未配置有效的 Gemini API Key。请在 backend/.env 文件中填入您的 GEMINI_API_KEY。');
  }
  return new GoogleGenAI({ apiKey });
}

/**
 * 依据逐字稿文本和学生姓名生成家长反馈
 */
export async function generateFeedbackFromText(transcript, studentName, studentGrade, customApiKey, feedbackTone = '严谨鼓励') {
  const ai = getGeminiClient(customApiKey);
  const systemInstruction = getSystemPrompt();
  
  const primaryModel = process.env.FEEDBACK_MODEL || 'gemini-3.5-flash';

  let tonePromptInstruction = '';
  if (feedbackTone === '温和亲切') {
    tonePromptInstruction = '【语气与撰写风格要求 - 温和亲切】：请采用极其温暖、亲切、平易近人的语气撰写此份反馈，多表达人文关怀与耐心鼓励，语言亲和自然，如同与家长面对面温暖交流一般。\n';
  } else if (feedbackTone === '考纲提分') {
    tonePromptInstruction = '【语气与撰写风格要求 - 考纲提分】：请采用高度目标导向、直击考纲提分的硬核教研语气撰写！重点突出中高考核心考点、题型避坑指南与解题思维突破口，语言干练精准，突显提分成效。\n';
  } else {
    tonePromptInstruction = '【语气与撰写风格要求 - 严谨鼓励】：请采用专业严谨、逻辑清晰且富有正向鼓励的语气撰写，既要展现严谨的语文教学分析，又要给予孩子正向关怀与成长信心。\n';
  }

  const currentDateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  let promptText = `以下是课堂录音的逐字稿内容：\n\n${transcript}\n\n`;
  promptText += `【重要时间、学段与姓名约束】：\n`;
  promptText += `1. 今日实时年月日为：“${currentDateStr}”。“课堂记录：”第一行中的八位日期必须严格使用“${currentDateStr}”或音频真实修改日期！\n`;
  if (studentGrade) {
    promptText += `2. 当前学员“${studentName || '学员'}”的准确学段是：“${studentGrade}”。请在撰写课后反馈时，切记严格匹配“${studentGrade}”的语文教研标准与考向！【绝对严禁将高中生误写为初中/中考，或将初中生误写为高考！】\n`;
  }
  if (studentName && studentName.trim()) {
    promptText += `3. 本堂课的学生姓名是：“${studentName.trim()}”。请在全篇反馈中，所有提及孩子、同学、学生之处，均统一替换为使用名字“${studentName.trim()}”。\n\n`;
  }
  promptText += tonePromptInstruction;
  promptText += `请严格遵循系统提示词中的 Markdown 格式与教研原则，生成对应的家长课后反馈文本。`;

  console.log(`[Gemini] 开始生成文本反馈。使用模型: ${primaryModel}, 语气风格: ${feedbackTone}, 学生姓名: ${studentName || '未指定'}`);

  const candidateModels = [primaryModel, 'gemini-3-flash-preview', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];
  let responseText = null;
  let lastErrorMessage = '';

  for (const modelName of candidateModels) {
    try {
      console.log(`[Gemini] 正在调用模型 ${modelName}...`);
      const response = await ai.models.generateContent({
        model: modelName,
        contents: [{ text: promptText }],
        config: {
          systemInstruction: systemInstruction,
          temperature: 0.3,
        }
      });
      if (response && response.text) {
        responseText = response.text;
        console.log(`[Gemini] 模型 ${modelName} 成功响应！`);
        break;
      }
    } catch (err) {
      console.warn(`[Gemini] 模型 ${modelName} 尝试失败: ${err.message}`);
      lastErrorMessage = err.message;
      // 如果检测到 Key 泄露或 PERMISSION_DENIED，终止盲目重试，抛出精准提示
      if (err.message.includes('leaked') || err.message.includes('PERMISSION_DENIED') || err.message.includes('API key not valid')) {
        throw new Error('当前 backend/.env 中的 GEMINI_API_KEY 已失效或被 Google 安全注销。请在 backend/.env 文件中更新有效 API Key。');
      }
    }
  }

  if (!responseText) {
    throw new Error(lastErrorMessage || '反馈生成失败：API 请求无法完成。请检查网络代理与 API Key。');
  }

  return cleanMarkdown(responseText);
}

/**
 * 依据录音音频和学生姓名直接生成家长反馈
 */
export async function generateFeedbackFromAudio(audioPath, mimeType, studentName, customApiKey, feedbackTone = '严谨鼓励') {
  const ai = getGeminiClient(customApiKey);
  const systemInstruction = getSystemPrompt();
  
  const primaryModel = process.env.FEEDBACK_MODEL || 'gemini-3.5-flash';

  const safeMimeType = (mimeType && mimeType.includes('/')) 
    ? mimeType 
    : (audioPath.match(/\.mp3$/i) ? 'audio/mp3' : 'audio/m4a');

  console.log(`[Gemini] 开始上传音频文件: ${audioPath}, MimeType: ${safeMimeType}`);
  
  let fileUpload;
  try {
    fileUpload = await ai.files.upload({
      file: audioPath,
      config: {
        mimeType: safeMimeType
      }
    });
  } catch (uploadErr) {
    if (uploadErr.message.includes('leaked') || uploadErr.message.includes('PERMISSION_DENIED') || uploadErr.message.includes('API key not valid')) {
      throw new Error('当前 Gemini API Key 已失效或被 Google 注销（提示: API key was reported as leaked）。请在右上角点击“修改”配置新的 API Key。');
    }
    throw uploadErr;
  }

  const finalMimeType = fileUpload.mimeType || safeMimeType || 'audio/m4a';
  console.log(`[Gemini] 音频上传成功，文件 URI: ${fileUpload.uri}, 确定 MimeType: ${finalMimeType}`);

  try {
    let tonePromptInstruction = '';
    if (feedbackTone === '温和亲切') {
      tonePromptInstruction = '【语气与撰写风格要求 - 温和亲切】：请采用极其温暖、亲切、平易近人的语气撰写此份反馈，多表达人文关怀与耐心鼓励，语言亲和自然。\n';
    } else if (feedbackTone === '考纲提分') {
      tonePromptInstruction = '【语气与撰写风格要求 - 考纲提分】：请采用高度目标导向、直击考纲提分的硬核教研语气撰写！重点突出核心考点、题型避坑指南与解题思维突破口，语言干练精准。\n';
    } else {
      tonePromptInstruction = '【语气与撰写风格要求 - 严谨鼓励】：请采用专业严谨、逻辑清晰且富有正向鼓励的语气撰写，既有严谨的分析，又有正向成长关怀。\n';
    }

    const currentDateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    let promptText = '这是今天的语文课堂实录音频。请听录音内容，提取授课要点。\n';
    promptText += `【重要时间与姓名约束】：\n1. 今日实时年月日为：“${currentDateStr}”。“课堂记录：”中的八位日期必须严格使用“${currentDateStr}”或音频文件的真正创建/修改日期，绝对严禁捏造虚假的过去年份！\n`;
    if (studentName && studentName.trim()) {
      promptText += `2. 本堂课的学生姓名是：“${studentName.trim()}”。请在撰写课后反馈时，所有提及孩子、学生、同学之处，均统一替换为使用名字“${studentName.trim()}”。\n`;
    }
    promptText += tonePromptInstruction;
    promptText += '请严格根据系统提示词中的排版格式、教研原则，生成对应的家长课后学习反馈。';

    const candidateModels = [primaryModel, 'gemini-3-flash-preview', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];
    let responseText = null;

    const audioContentPart = {
      fileData: {
        fileUri: fileUpload.uri,
        mimeType: finalMimeType
      }
    };

    for (const modelName of candidateModels) {
      try {
        console.log(`[Gemini] 正在调用模型 ${modelName} 分析音频...`);
        const response = await ai.models.generateContent({
          model: modelName,
          contents: [
            audioContentPart,
            { text: promptText }
          ],
          config: {
            systemInstruction: systemInstruction,
            temperature: 0.3,
          }
        });

        if (response && response.text) {
          responseText = response.text;
          break;
        }
      } catch (err) {
        console.warn(`[Gemini] 模型 ${modelName} 音频生成尝试失败: ${err.message}`);
      }
    }

    if (!responseText) {
      throw new Error('音频反馈生成失败：API 返回内容为空。');
    }

    return cleanMarkdown(responseText);
  } finally {
    try {
      if (fileUpload && fileUpload.name) {
        console.log(`[Gemini] 清理云端临时文件: ${fileUpload.name}`);
        await ai.files.delete({ name: fileUpload.name });
      }
    } catch (cleanupErr) {
      console.warn(`[Gemini] 清理云端文件警告: ${cleanupErr.message}`);
    }
  }
}

/**
 * 仅将录音音频转化为口语逐字稿纯文本 (不进行 AI 反馈总结排版)
 */
export async function transcribeAudioToText(audioPath, mimeType, customApiKey) {
  const ai = getGeminiClient(customApiKey);
  const primaryModel = process.env.FEEDBACK_MODEL || 'gemini-3.5-flash';

  const safeMimeType = (mimeType && mimeType.includes('/')) 
    ? mimeType 
    : (audioPath.match(/\.mp3$/i) ? 'audio/mp3' : 'audio/m4a');

  console.log(`[Gemini] 开始上传音频进行【纯口语逐字稿转写】: ${audioPath}, MimeType: ${safeMimeType}`);
  
  let fileUpload;
  try {
    fileUpload = await ai.files.upload({
      file: audioPath,
      config: {
        mimeType: safeMimeType
      }
    });
  } catch (uploadErr) {
    if (uploadErr.message.includes('leaked') || uploadErr.message.includes('PERMISSION_DENIED') || uploadErr.message.includes('API key not valid')) {
      throw new Error('当前 Gemini API Key 已失效或被 Google 注销。请在设置中配置有效 API Key。');
    }
    throw uploadErr;
  }

  const finalMimeType = fileUpload.mimeType || safeMimeType || 'audio/m4a';

  try {
    const sttSystemInstruction = "你是一个专业高效的语音识别与课堂口语速记员。你的唯一任务是听取音频，并将音频中听到的口语对话、讲课内容、问答与细节原汁原味地转写为纯文本格式的口语逐字稿。绝对严禁生成‘课堂记录’、‘课堂回顾’、‘授课内容’、‘考点拆解’等任何反馈报告格式或教研分析结构！";

    const promptText = "请听这段课堂实录音频，将其中的所有口语讲话、老师讲解与师生交流内容，原汁原味地转写为纯文本逐字稿。请直接输出文字内容本身，绝对不要包含‘课堂记录：’、‘课堂回顾：’或任何总结报告标题。";

    const candidateModels = [primaryModel, 'gemini-3-flash-preview', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];
    let responseText = null;

    const audioContentPart = {
      fileData: {
        fileUri: fileUpload.uri,
        mimeType: finalMimeType
      }
    };

    for (const modelName of candidateModels) {
      try {
        console.log(`[Gemini] 正在调用模型 ${modelName} 提取纯口语逐字稿...`);
        const response = await ai.models.generateContent({
          model: modelName,
          contents: [
            audioContentPart,
            { text: promptText }
          ],
          config: {
            systemInstruction: sttSystemInstruction,
            temperature: 0.2,
          }
        });

        if (response && response.text) {
          responseText = response.text;
          break;
        }
      } catch (err) {
        console.warn(`[Gemini] 模型 ${modelName} 纯口语逐字稿提取尝试失败: ${err.message}`);
      }
    }

    if (!responseText) {
      throw new Error('音频转写失败：未能从录音中提取出文字内容。');
    }

    return responseText.trim();
  } finally {
    try {
      if (fileUpload && fileUpload.name) {
        await ai.files.delete({ name: fileUpload.name });
      }
    } catch (e) {}
  }
}

/**
 * 辅助清洗 Markdown 标记
 */
function cleanMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/\*{1,3}(.*?)\*{1,3}/g, '$1') 
    .replace(/^#+\s+/gm, '')               
    .replace(/\[\d+\]/g, '')               
    .replace(/^-\s+/gm, '')
    .replace(/\s*[（\(]续[）\)]/g, '')              
    .trim();
}
