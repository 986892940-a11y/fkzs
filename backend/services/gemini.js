import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { HttpsProxyAgent } from 'https-proxy-agent';
import nodeFetch from 'node-fetch';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 挂载安全代理 (确保在 macOS 代理环境下连通 Google API)
function configureProxy() {
  const envProxy = process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.https_proxy;
  const proxyUrl = envProxy || 'http://127.0.0.1:10808';

  try {
    const agent = new HttpsProxyAgent(proxyUrl);
    globalThis.fetch = (url, init) => {
      return nodeFetch(url, { ...init, agent });
    };
    console.log(`[Gemini Network] 代理 Agent 挂载成功: ${proxyUrl}`);
  } catch (err) {
    console.warn(`[Gemini Network] 代理 Agent 挂载警告: ${err.message}`);
  }
}

configureProxy();

// 读取项目的系统提示词 (docs/prompt.md)，使用绝对路径兼容开发与打包环境
const PROMPT_FILE_PATH = path.resolve(__dirname, '../../docs/prompt.md');

function getSystemPrompt() {
  try {
    if (fs.existsSync(PROMPT_FILE_PATH)) {
      return fs.readFileSync(PROMPT_FILE_PATH, 'utf-8');
    } else {
      console.warn(`[Gemini] 系统提示词文件未找到: ${PROMPT_FILE_PATH}`);
    }
  } catch (err) {
    console.error('读取系统提示词失败，将使用默认兜底提示词:', err);
  }
  return '你是一个温和细致的课堂整理助手。根据提供的课堂录音或逐字稿，提取授课信息，为家长写一份清爽、不含Markdown标记、不含角标引用的纯文本课后学习反馈。';
}

function getGeminiClient(customApiKey) {
  const apiKey = customApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
    throw new Error('未配置有效的 Gemini API Key。请在右上角“配置 API Key”或在 backend/.env 文件中填入您的密钥。');
  }
  return new GoogleGenAI({ apiKey });
}

/**
 * 依据逐字稿文本和学生姓名生成家长反馈
 */
export async function generateFeedbackFromText(transcript, studentName, customApiKey) {
  const ai = getGeminiClient(customApiKey);
  const systemInstruction = getSystemPrompt();
  
  const primaryModel = process.env.FEEDBACK_MODEL || 'gemini-3.5-flash';

  const currentDateStr = new Date().toISOString().slice(0, 10).replace(/-/g, ''); // 格式如 20260720
  let promptText = `以下是课堂录音的逐字稿内容：\n\n${transcript}\n\n`;
  promptText += `【重要时间与姓名约束】：\n`;
  promptText += `1. 今日实时年月日为：“${currentDateStr}”。最终输出的第一行“课堂记录：”中的八位日期，必须严格使用实时日期“${currentDateStr}”或音频文件的真实修改日期，绝对严禁凭空捏造过去的虚假年份！\n`;
  if (studentName && studentName.trim()) {
    promptText += `2. 本堂课的学生姓名是：“${studentName.trim()}”。请在撰写课后反馈的所有段落中，凡是需要提到孩子、同学、学生或用代词称呼的地方，务必统一替换为使用名字“${studentName.trim()}”进行撰写。\n\n`;
  }
  promptText += `请严格遵循系统提示词中的排版、格式以及教研原则，生成对应的家长课后反馈文本。`;

  console.log(`[Gemini] 开始生成文本反馈。使用模型: ${primaryModel}, 学生姓名: ${studentName || '未指定'}`);

  const candidateModels = [primaryModel, 'gemini-3-flash-preview', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];
  let responseText = null;

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
    }
  }

  if (!responseText) {
    throw new Error('反馈生成失败：API 请求无法完成。请检查网络代理连通性与 API Key 是否有效。');
  }

  return cleanMarkdown(responseText);
}

/**
 * 依据录音音频和学生姓名直接生成家长反馈
 */
export async function generateFeedbackFromAudio(audioPath, mimeType, studentName, customApiKey) {
  const ai = getGeminiClient(customApiKey);
  const systemInstruction = getSystemPrompt();
  
  const primaryModel = process.env.FEEDBACK_MODEL || 'gemini-3.5-flash';

  console.log(`[Gemini] 开始上传音频文件: ${audioPath}, MimeType: ${mimeType}`);
  
  const fileUpload = await ai.files.upload({
    file: audioPath,
    mimeType: mimeType || 'audio/m4a'
  });

  console.log(`[Gemini] 音频上传成功，文件 URI: ${fileUpload.uri}`);

  try {
    const currentDateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    let promptText = '这是今天的语文课堂实录音频。请听录音内容，提取授课要点。\n';
    promptText += `【重要时间与姓名约束】：\n1. 今日实时年月日为：“${currentDateStr}”。“课堂记录：”中的八位日期必须严格使用“${currentDateStr}”或音频文件的真正创建/修改日期，绝对严禁捏造虚假的过去年份！\n`;
    if (studentName && studentName.trim()) {
      promptText += `2. 本堂课的学生姓名是：“${studentName.trim()}”。请在撰写课后反馈时，所有提及孩子、学生、同学之处，均统一替换为使用名字“${studentName.trim()}”。\n`;
    }
    promptText += '请严格根据系统提示词中的排版格式、教研原则，生成对应的家长课后学习反馈。';

    const candidateModels = [primaryModel, 'gemini-3-flash-preview', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];
    let responseText = null;

    for (const modelName of candidateModels) {
      try {
        console.log(`[Gemini] 正在调用模型 ${modelName} 分析音频...`);
        const response = await ai.models.generateContent({
          model: modelName,
          contents: [
            fileUpload,
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
      console.log(`[Gemini] 清理云端临时文件: ${fileUpload.name}`);
      await ai.files.delete({ name: fileUpload.name });
    } catch (cleanupErr) {
      console.warn(`[Gemini] 清理云端文件警告: ${cleanupErr.message}`);
    }
  }
}

/**
 * 辅助清洗任何遗漏的 Markdown 标记及角标
 */
function cleanMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/\*{1,3}(.*?)\*{1,3}/g, '$1') 
    .replace(/^#+\s+/gm, '')               
    .replace(/\[\d+\]/g, '')               
    .replace(/^-\s+/gm, '')                
    .trim();
}
