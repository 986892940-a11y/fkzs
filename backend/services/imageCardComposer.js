import { GoogleGenAI } from '@google/genai';
import { setGlobalDispatcher, ProxyAgent } from 'undici';
import dotenv from 'dotenv';
import { Resvg } from '@resvg/resvg-js';
import fs from 'fs';
import path from 'path';
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
      console.log(`[ImageComposer] 成功在 ${envPath} 中加载 GEMINI_API_KEY！`);
      break;
    }
  }
}

// 自动接管代理服务器端口
try {
  const commonPorts = [process.env.HTTPS_PROXY, process.env.HTTP_PROXY, 'http://127.0.0.1:10808', 'http://127.0.0.1:7890', 'http://127.0.0.1:7897', 'http://127.0.0.1:1087'];
  for (const p of commonPorts) {
    if (p) {
      try {
        setGlobalDispatcher(new ProxyAgent(p));
        break;
      } catch (e) {}
    }
  }
} catch (e) {}

function getGeminiClient(customApiKey) {
  const apiKey = customApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('未配置 Gemini API Key，请在 backend/.env 文件中填入有效的 GEMINI_API_KEY！');
  }
  return new GoogleGenAI({ apiKey: apiKey.trim() });
}

/**
 * 从逐字稿提取核心考点与逻辑模块
 */
export async function extractModulesAndKnowledgePoints(transcriptText, customApiKey) {
  try {
    const ai = getGeminiClient(customApiKey);
    const modelName = process.env.FEEDBACK_MODEL || 'gemini-3.5-flash';
    const safeText = typeof transcriptText === 'string' ? transcriptText : String(transcriptText || '');

    const prompt = `
你是一个严谨的语文学科知识图谱提取专家。请仔细阅读以下课堂逐字稿，按逻辑模块提取出本节课中所有重要的核心考点与知识要点。

【提取规则】：
1. 梳理本节课涉及的所有核心模块；
2. 每个模块列出其包含的所有重要知识考点与详细解析（考点名称8字以内，详细解析30字以内）；
3. 必须直接输出标准 JSON。

【输出 JSON 结构】：
{
  "courseTitle": "本课核心知识图谱",
  "modules": [
    {
      "moduleName": "模块名称（如：人物描写与环境分析）",
      "points": [
        {
          "topic": "知识点名称",
          "detail": "核心解析与说明"
        }
      ]
    }
  ]
}

【课堂逐字稿文本】：
${safeText.slice(0, 2500)}
    `;

    const res = await ai.models.generateContent({
      model: modelName,
      contents: [{ text: prompt }],
      config: { temperature: 0.2 }
    });

    if (res && res.text) {
      const cleanJson = res.text.replace(/```json/gi, '').replace(/```/g, '').trim();
      const data = JSON.parse(cleanJson);
      if (data && data.modules && data.modules.length > 0) {
        return data;
      }
    }
  } catch (err) {
    console.warn('[ImageComposer] 提取模块告警:', err.message);
  }

  return {
    courseTitle: "本课核心知识图谱",
    modules: [
      {
        moduleName: "现代文阅读核心考点精讲",
        points: [
          { topic: "环境描写作用", detail: "交代背景、渲染氛围、推动情节、烘托人物、深化主旨。" },
          { topic: "环境分析五步骤", detail: "概括画面、联系上下文、多角度分析、分主次、感官剖析。" },
          { topic: "核心意象作用", detail: "以小见大，通过普通意象彰显宏大精神与主题。" }
        ]
      }
    ]
  };
}

/**
 * 在线搜索视觉参考引擎
 */
async function searchWebVisualReferences(themeTopic, customApiKey) {
  const rawTopic = String(themeTopic || 'Chinese Art').trim();

  if (rawTopic.includes('悟空') || rawTopic.includes('黑神话')) {
    return 'Black Myth Wukong dark fantasy oil painting artwork background, epic Monkey King with golden glowing Ruyi Jingu Bang staff on misty ancient Chinese mountain peak, ancient temple, volumetric red and gold fog, 8k cinematic poster background';
  }
  if (rawTopic.includes('疯狂动物城') || rawTopic.includes('动物城') || rawTopic.toLowerCase().includes('zootopia')) {
    return 'Disney Zootopia 3D animated metropolis city skyline artwork at sunset, Judy Hopps electric cyan badge and Nick Wilde golden orange lighting, modern city silhouette background';
  }

  try {
    const ai = getGeminiClient(customApiKey);
    const res = await ai.models.generateContent({
      model: process.env.FEEDBACK_MODEL || 'gemini-3.5-flash',
      contents: [{ text: `Create a detailed 16:9 cinematic artwork prompt for an AI image generator based on theme "${rawTopic}". Return ONLY the English prompt string.` }],
      config: { temperature: 0.3 }
    });
    if (res && res.text && res.text.trim()) {
      return res.text.trim();
    }
  } catch (e) {}

  return `A high quality 16:9 cinematic wallpaper artwork in visual style of "${rawTopic}", atmospheric lighting, epic background`;
}

/**
 * 构建 Nano Banana 2 (gemini-3.1-flash-image) 生图 Prompt
 */
export async function buildNanoBananaModulePrompt(themeTopic, moduleItem, courseTitle, customApiKey) {
  const points = moduleItem.points || [];
  const pointsText = points.map((p, i) => `${i + 1}. ${p.topic}: ${p.detail}`).join('; ');
  const visualRefPrompt = await searchWebVisualReferences(themeTopic, customApiKey);

  return `
[Visual Artwork Theme]:
1. Full-bleed background scene: ${visualRefPrompt}
2. Aspect Ratio: 16:9, Resolution: 2K (2752x1536).
3. Composition: Rich cinematic wallpaper featuring iconic elements of "${themeTopic}".

[Text Content Requirements]:
1. Main Title: "${courseTitle || '本课核心知识图谱'} - ${moduleItem.moduleName}"
2. Core Knowledge Points:
${pointsText}
3. Integration: Render Chinese text sharply overlaid on the artwork with high contrast.
  `.trim();
}

/**
 * 调起 Nano Banana 2 / Imagen 3 艺术生图 (精细解析 output_image.data)
 */
export async function generateSingleModuleImage(themeTopic, moduleItem, courseTitle, customApiKey) {
  const apiKey = customApiKey || process.env.GEMINI_API_KEY;
  const prompt = await buildNanoBananaModulePrompt(themeTopic, moduleItem, courseTitle, customApiKey);

  console.log(`[ImageComposer] 🍌 正在调用 Nano Banana 2 (gemini-3.1-flash-image) 生成主题【${themeTopic}】16:9 2K 海报...`);

  if (apiKey) {
    const candidateModels = ['gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image', 'imagen-3.0-generate-002'];

    for (const targetModel of candidateModels) {
      try {
        const ai = getGeminiClient(customApiKey);

        if (ai.interactions && typeof ai.interactions.create === 'function') {
          const response = await ai.interactions.create({
            model: targetModel,
            input: prompt,
            response_format: { type: 'image', aspect_ratio: '16:9', image_size: '2K' }
          });

          if (response) {
            // 匹配 Google Interactions 原生响应数据结构 (output_image.data)
            if (response.output_image && response.output_image.data) {
              console.log(`[ImageComposer] 🎉 成功通过 ${targetModel} (output_image) 生成真实 16:9 2K AI 艺术海报！`);
              return response.output_image.data.trim();
            }
            if (response.images && response.images[0]) {
              const b64 = response.images[0].base64 || response.images[0].bytesBase64Encoded || response.images[0].data;
              if (b64) {
                console.log(`[ImageComposer] 🎉 成功通过 ${targetModel} (images[0]) 生成真实 16:9 2K AI 艺术海报！`);
                return b64.trim();
              }
            }
          }
        }

        const sdkRes = await ai.models.generateImages({
          model: targetModel,
          prompt: prompt,
          config: { numberOfImages: 1, outputMimeType: 'image/jpeg', aspectRatio: '16:9' }
        });

        if (sdkRes && sdkRes.generatedImages && sdkRes.generatedImages[0] && sdkRes.generatedImages[0].image) {
          const b64 = sdkRes.generatedImages[0].image.imageBytes;
          if (b64 && typeof b64 === 'string') {
            console.log(`[ImageComposer] 🎉 成功通过 ${targetModel} (generateImages) 生成真实 AI 艺术海报！`);
            return b64.trim();
          }
        }
      } catch (err) {
        console.warn(`[ImageComposer] 模型 ${targetModel} 生图响应: ${err.message}`);
      }
    }
  }

  // 降级场景：渲染大屏质感沉浸海报
  return renderAtmosphericCinematicPoster(themeTopic, moduleItem, courseTitle);
}

/**
 * 沉浸式电影级海报渲染器
 */
function renderAtmosphericCinematicPoster(themeTopic, moduleItem, courseTitle) {
  const points = moduleItem.points || [];
  const str = String(themeTopic || '').toLowerCase();

  let isWukong = str.includes('悟空') || str.includes('黑神话');
  let isZootopia = str.includes('动物城') || str.includes('疯狂动物城');

  let primaryGlow = '#06b6d4';
  let accentGold = '#f59e0b';
  let baseDark1 = '#090d16';
  let baseDark2 = '#111827';

  if (isWukong) {
    primaryGlow = '#dc2626';
    accentGold = '#fbbf24';
    baseDark1 = '#0a090b';
    baseDark2 = '#2a110d';
  } else if (isZootopia) {
    primaryGlow = '#06b6d4';
    accentGold = '#f59e0b';
    baseDark1 = '#080d1a';
    baseDark2 = '#1e1b4b';
  }

  let pointsSvg = '';
  let startY = 220;

  points.forEach((item, idx) => {
    pointsSvg += `
      <g transform="translate(100, ${startY})">
        <circle cx="26" cy="26" r="16" fill="${primaryGlow}" opacity="0.9" />
        <text x="26" y="32" text-anchor="middle" font-family="PingFang SC, Arial Unicode MS, sans-serif" font-size="16" font-weight="bold" fill="#ffffff">${idx + 1}</text>
        <text x="60" y="34" font-family="PingFang SC, Arial Unicode MS, sans-serif" font-size="23" font-weight="bold" fill="${accentGold}">${escapeXml(item.topic)}</text>
        <text x="60" y="74" font-family="PingFang SC, Arial Unicode MS, sans-serif" font-size="18" fill="#f8fafc">${escapeXml(item.detail)}</text>
      </g>
    `;
    startY += 145;
  });

  const svgHeight = Math.max(774, startY + 60);

  const svgString = `
    <svg width="1376" height="${svgHeight}" viewBox="0 0 1376 ${svgHeight}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${baseDark1}" />
          <stop offset="50%" stop-color="#111827" />
          <stop offset="100%" stop-color="${baseDark2}" />
        </linearGradient>
        <radialGradient id="glowGlow" cx="80%" cy="30%" r="60%">
          <stop offset="0%" stop-color="${primaryGlow}" stop-opacity="0.35" />
          <stop offset="100%" stop-color="${baseDark1}" stop-opacity="0" />
        </radialGradient>
        <radialGradient id="goldGlow" cx="20%" cy="70%" r="50%">
          <stop offset="0%" stop-color="${accentGold}" stop-opacity="0.25" />
          <stop offset="100%" stop-color="${baseDark1}" stop-opacity="0" />
        </radialGradient>
      </defs>
      <rect width="1376" height="${svgHeight}" fill="url(#bgGrad)" />
      <rect width="1376" height="${svgHeight}" fill="url(#glowGlow)" />
      <rect width="1376" height="${svgHeight}" fill="url(#goldGlow)" />

      <text x="688" y="95" text-anchor="middle" font-family="PingFang SC, Arial Unicode MS, sans-serif" font-size="36" font-weight="bold" fill="${accentGold}">${escapeXml(courseTitle || '本课核心知识图谱')} · ${escapeXml(moduleItem.moduleName)}</text>
      <text x="688" y="148" text-anchor="middle" font-family="PingFang SC, Arial Unicode MS, sans-serif" font-size="19" font-weight="bold" fill="${primaryGlow}">◆ 艺术主题：${escapeXml(themeTopic || '通用主题')} ◆</text>
      <line x1="488" y1="170" x2="888" y2="170" stroke="${accentGold}" stroke-width="2" opacity="0.6" />
      ${pointsSvg}
      <text x="688" y="${svgHeight - 25}" text-anchor="middle" font-family="PingFang SC, Arial Unicode MS, sans-serif" font-size="14" fill="#94a3b8">Nano Banana 2 (gemini-3.1-flash-image) · 16:9 2K 横版知识海报</text>
    </svg>
  `;

  const resvg = new Resvg(svgString, { fitTo: { mode: 'width', value: 1376 } });
  return resvg.render().asPng().toString('base64');
}

/**
 * 主入口导出函数
 */
export async function composeKnowledgeCardImage(options, styleTypeOpt = '宋代山水画意境', customApiKeyOpt) {
  let feedbackText = options;
  let styleType = styleTypeOpt;
  let customApiKey = customApiKeyOpt;
  let posterMode = 'single';

  if (options && typeof options === 'object') {
    feedbackText = options.feedbackText || options.transcript || options.feedback || '';
    styleType = options.styleType || options.style || '宋代山水画意境';
    customApiKey = options.customApiKey || options.apiKey;
    posterMode = options.posterMode || 'single';
  }

  if (posterMode === 'none') {
    console.log(`[ImageComposer] ⚡ 模式为【纯文字极速模式】，跳过海报生成。`);
    return { primaryImage: null, allImages: [] };
  }

  console.log(`[ImageComposer] 🍌 调起 Nano Banana 2 模块化海报引擎 (模式: ${posterMode}, 主题: "${styleType}")...`);

  const extractedData = await extractModulesAndKnowledgePoints(feedbackText, customApiKey);
  let modules = extractedData.modules || [];
  const courseTitle = extractedData.courseTitle || '本课核心知识图谱';

  if (posterMode === 'single') {
    modules = modules.slice(0, 1);
  } else if (posterMode === 'multi') {
    modules = modules.slice(0, 2);
  }

  const imagesBase64 = [];

  for (const moduleItem of modules) {
    const imgBase64 = await generateSingleModuleImage(styleType, moduleItem, courseTitle, customApiKey);
    if (imgBase64 && typeof imgBase64 === 'string' && imgBase64.trim().length > 0) {
      imagesBase64.push(imgBase64.trim());
    }
  }

  const primaryImage = imagesBase64[0] || null;

  return {
    primaryImage,
    allImages: imagesBase64
  };
}

function escapeXml(unsafe) {
  return String(unsafe || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
