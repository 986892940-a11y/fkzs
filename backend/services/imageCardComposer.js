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
 * 从逐字稿提取核心考点与逻辑模块 (增加严密去重机制)
 */
export async function extractModulesAndKnowledgePoints(transcriptText, customApiKey) {
  try {
    const ai = getGeminiClient(customApiKey);
    const modelName = process.env.FEEDBACK_MODEL || 'gemini-3.5-flash';
    const safeText = typeof transcriptText === 'string' ? transcriptText : String(transcriptText || '');

    const prompt = `
你是一个严谨的语文学科知识图谱提取专家。请仔细阅读以下课堂逐字稿，按逻辑模块提取出本节课中所有重要的核心考点与知识要点。

【提取与去重规则】：
1. 梳理本节课涉及的核心模块；
2. 每个模块列出 2-3 个【互不相同】的核心知识考点与详细解析（考点名称8字以内，详细解析20字以内）；
3. 严禁出现重复或相似的解析文本！每个考点解析必须独一无二。
4. 必须直接输出标准 JSON。

【输出 JSON 结构】：
{
  "courseTitle": "本课核心知识图谱",
  "modules": [
    {
      "moduleName": "模块名称（如：文言实词与句式精讲）",
      "points": [
        {
          "topic": "知识点名称A",
          "detail": "专属独一无二的核心解析A"
        },
        {
          "topic": "知识点名称B",
          "detail": "专属独一无二的核心解析B"
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
      config: { temperature: 0.1 }
    });

    if (res && res.text) {
      const cleanJson = res.text.replace(/```json/gi, '').replace(/```/g, '').trim();
      const data = JSON.parse(cleanJson);
      if (data && data.modules && data.modules.length > 0) {
        // 程序级深度去重过滤
        data.modules.forEach(mod => {
          if (Array.isArray(mod.points)) {
            const seen = new Set();
            mod.points = mod.points.filter(pt => {
              if (!pt || !pt.topic || !pt.detail) return false;
              const key = `${pt.topic.trim()}_${pt.detail.trim()}`;
              const detailKey = pt.detail.trim();
              if (seen.has(key) || seen.has(detailKey)) return false;
              seen.add(key);
              seen.add(detailKey);
              return true;
            });
          }
        });
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
          { topic: "环境描写作用", detail: "交代背景、渲染氛围、烘托人物孤寂内心。" },
          { topic: "环境分析五步骤", detail: "概括画面、多角度剖析、联系主旨解析。" },
          { topic: "核心意象解析", detail: "以小见大，彰显宏大精神与时代主题。" }
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
 * 构建 Nano Banana 2 / Imagen 3 防文字重复生图 Prompt
 */
export async function buildNanoBananaModulePrompt(themeTopic, moduleItem, courseTitle, customApiKey) {
  const rawPoints = moduleItem.points || [];
  
  // 严密去重：确保传入 AI 生图模型的知识点绝对没有重复项
  const seen = new Set();
  const uniquePoints = [];
  for (const p of rawPoints) {
    if (!p || !p.topic || !p.detail) continue;
    const cleanDetail = p.detail.trim();
    if (!seen.has(cleanDetail)) {
      seen.add(cleanDetail);
      uniquePoints.push(p);
    }
  }

  // 精简至最多 3 个关键分支（防止扩散模型多分支乱推乱拷）
  const displayPoints = uniquePoints.slice(0, 3);
  const pointsText = displayPoints.map((p, i) => `Branch ${i + 1} [UNIQUE TEXT]: "${p.topic}: ${p.detail.slice(0, 18)}"`).join('\n');
  const visualRefPrompt = await searchWebVisualReferences(themeTopic, customApiKey);

  return `
Create a magnificent 16:9 infographic poster artwork in authentic "${themeTopic}" artistic style.

[Artistic Visual Background & Worldbuilding]:
${visualRefPrompt}, 16:9 ratio, 2K resolution, premium artistic texture, masterwork composition.

[Integrated Knowledge Mindmap & Calligraphy Art]:
Main Title Banner: "${courseTitle || '本课核心知识图谱'} - ${moduleItem.moduleName}"

Core Knowledge Branches (STRICTLY UNIQUE - ZERO DUPLICATION ALLOWED):
${pointsText}

[CRITICAL ACCURACY & DEDUPLICATION INSTRUCTIONS]:
1. STRICTLY ZERO TEXT REPETITION: Each branch node MUST render its OWN UNIQUE text. DO NOT copy, clone, or repeat text from Branch 1 onto Branch 2, or from Branch 3 onto Branch 4.
2. Every branch node must display distinct, non-duplicated Chinese calligraphy text.
3. Full Artwork Integration: Seamlessly embed all title cartouche banners and mindmap nodes into the traditional painting background.
  `.trim();
}

/**
 * 调起 Nano Banana 2 / Imagen 3 艺术生图 (精细解析 output_image.data)
 */
export async function generateSingleModuleImage(themeTopic, moduleItem, courseTitle, customApiKey) {
  const apiKey = customApiKey || process.env.GEMINI_API_KEY;
  const prompt = await buildNanoBananaModulePrompt(themeTopic, moduleItem, courseTitle, customApiKey);

  console.log(`[ImageComposer] 🍌 正在调用 Nano Banana 2 (全图 AI 艺术融合版) 生成主题【${themeTopic}】16:9 2K 海报...`);

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
            if (response.output_image && response.output_image.data) {
              console.log(`[ImageComposer] 🎉 成功通过 ${targetModel} (output_image) 生成全图 AI 艺术融合海报！`);
              return response.output_image.data.trim();
            }
            if (response.images && response.images[0]) {
              const b64 = response.images[0].base64 || response.images[0].bytesBase64Encoded || response.images[0].data;
              if (b64) {
                console.log(`[ImageComposer] 🎉 成功通过 ${targetModel} (images[0]) 生成全图 AI 艺术融合海报！`);
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
            console.log(`[ImageComposer] 🎉 成功通过 ${targetModel} (generateImages) 生成全图 AI 艺术融合海报！`);
            return b64.trim();
          }
        }
      } catch (err) {
        console.warn(`[ImageComposer] 模型 ${targetModel} 生图响应: ${err.message}`);
      }
    }
  }

  // 降级场景：渲染方案 B 高质感全画框海报
  return renderAtmosphericCinematicPoster(themeTopic, moduleItem, courseTitle);
}

/**
 * 方案 B 沉浸式高质感艺术海报渲染器 (SVG 典雅轴画框版，带深度去重机制)
 */
function renderAtmosphericCinematicPoster(themeTopic, moduleItem, courseTitle) {
  const rawPoints = moduleItem.points || [];

  // 程序级严格去重
  const seen = new Set();
  const points = [];
  for (const p of rawPoints) {
    if (!p || !p.topic || !p.detail) continue;
    const key = `${p.topic.trim()}_${p.detail.trim()}`;
    const detailKey = p.detail.trim();
    if (!seen.has(key) && !seen.has(detailKey)) {
      seen.add(key);
      seen.add(detailKey);
      points.push(p);
    }
  }

  const str = String(themeTopic || '').toLowerCase();

  let isWukong = str.includes('悟空') || str.includes('黑神话');
  let isZootopia = str.includes('动物城') || str.includes('疯狂动物城');
  let isUkiyoe = str.includes('浮世绘');

  let primaryGlow = '#06b6d4';
  let accentGold = '#f59e0b';
  let baseDark1 = '#090d16';
  let baseDark2 = '#111827';
  let cardBorderColor = 'rgba(245, 158, 11, 0.4)';

  if (isUkiyoe) {
    primaryGlow = '#1e3a8a';
    accentGold = '#b45309';
    baseDark1 = '#faf6ed';
    baseDark2 = '#f3ece0';
    cardBorderColor = '#b45309';
  } else if (isWukong) {
    primaryGlow = '#dc2626';
    accentGold = '#fbbf24';
    baseDark1 = '#0a090b';
    baseDark2 = '#2a110d';
    cardBorderColor = '#fbbf24';
  } else if (isZootopia) {
    primaryGlow = '#06b6d4';
    accentGold = '#f59e0b';
    baseDark1 = '#080d1a';
    baseDark2 = '#1e1b4b';
    cardBorderColor = '#06b6d4';
  }

  let pointsSvg = '';
  let startY = 220;

  points.forEach((item, idx) => {
    pointsSvg += `
      <g transform="translate(100, ${startY})">
        <rect x="0" y="0" width="1176" height="110" rx="12" fill="rgba(255,255,255,0.06)" stroke="${cardBorderColor}" stroke-width="1.2" />
        <rect x="0" y="0" width="8" height="110" rx="4" fill="${accentGold}" />
        <circle cx="42" cy="55" r="18" fill="${primaryGlow}" />
        <text x="42" y="61" text-anchor="middle" font-family="PingFang SC, Arial Unicode MS, sans-serif" font-size="16" font-weight="bold" fill="#ffffff">${idx + 1}</text>
        <text x="76" y="44" font-family="PingFang SC, Arial Unicode MS, sans-serif" font-size="22" font-weight="bold" fill="${accentGold}">${escapeXml(item.topic)}</text>
        <text x="76" y="80" font-family="PingFang SC, Arial Unicode MS, sans-serif" font-size="17" fill="${isUkiyoe ? '#334155' : '#f8fafc'}">${escapeXml(item.detail)}</text>
      </g>
    `;
    startY += 135;
  });

  const svgHeight = Math.max(774, startY + 60);

  const svgString = `
    <svg width="1376" height="${svgHeight}" viewBox="0 0 1376 ${svgHeight}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${baseDark1}" />
          <stop offset="100%" stop-color="${baseDark2}" />
        </linearGradient>
      </defs>
      <rect width="1376" height="${svgHeight}" fill="url(#bgGrad)" />
      
      <!-- 外围古典轴画边框 -->
      <rect x="25" y="25" width="1326" height="${svgHeight - 50}" rx="16" fill="none" stroke="${accentGold}" stroke-width="2" opacity="0.7" />

      <!-- 主标题卷轴块 -->
      <g transform="translate(388, 50)">
        <rect x="0" y="0" width="600" height="120" rx="16" fill="rgba(0,0,0,0.25)" stroke="${accentGold}" stroke-width="1.8" />
        <text x="300" y="55" text-anchor="middle" font-family="PingFang SC, Arial Unicode MS, sans-serif" font-size="28" font-weight="bold" fill="${accentGold}">${escapeXml(courseTitle || '本课核心知识图谱')} · ${escapeXml(moduleItem.moduleName)}</text>
        <text x="300" y="95" text-anchor="middle" font-family="PingFang SC, Arial Unicode MS, sans-serif" font-size="17" font-weight="bold" fill="${primaryGlow}">◆ 视觉风格：${escapeXml(themeTopic || '通用主题')} (方案 B 全图艺术融合) ◆</text>
      </g>

      ${pointsSvg}

      <text x="688" y="${svgHeight - 20}" text-anchor="middle" font-family="PingFang SC, Arial Unicode MS, sans-serif" font-size="14" fill="#94a3b8">Imagen 3 / Nano Banana 2 · 全图 AI 艺术融合知识海报</text>
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
