import { GoogleGenAI } from '@google/genai';
import { Resvg } from '@resvg/resvg-js';
import dotenv from 'dotenv';
import { HttpsProxyAgent } from 'https-proxy-agent';
import nodeFetch from 'node-fetch';

dotenv.config();

// 挂载网络代理 Agent
function configureProxy() {
  const envProxy = process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.https_proxy;
  const proxyUrl = envProxy || 'http://127.0.0.1:10808';
  try {
    const agent = new HttpsProxyAgent(proxyUrl);
    globalThis.fetch = (url, init) => nodeFetch(url, { ...init, agent });
  } catch (err) {
    console.warn(`[ImageComposer Network] 代理挂载警告: ${err.message}`);
  }
}
configureProxy();

function getGeminiClient(customApiKey) {
  const apiKey = customApiKey || process.env.GEMINI_API_KEY;
  return new GoogleGenAI({ apiKey });
}

/**
 * 第一步：调用 Gemini 3.5 Flash 提取结构化的中文知识点 JSON
 */
async function extractStructuredKnowledge(feedbackText, customApiKey) {
  const ai = getGeminiClient(customApiKey);
  const modelName = process.env.FEEDBACK_MODEL || 'gemini-3.5-flash';

  const prompt = `
    你是一个语文教研专家。请阅读以下语文课后反馈，精确提取出本节课最核心的 2-3 个知识要点。
    以严格的 JSON 格式输出，不得包含任何 Markdown 标记或解释说明。

    JSON 结构示例：
    {
      "title": "语文课后核心知识要点图谱",
      "subtitle": "精读梳理 · 课后复习卡",
      "points": [
        {
          "topic": "知识点/模块名称（6字以内，如：古今异义词）",
          "detail": "通俗易懂的1-2句核心总结与例子（25字以内）"
        },
        {
          "topic": "知识点/模块名称（6字以内，如：通假字积累）",
          "detail": "通俗易懂的1-2句核心总结与例子（25字以内）"
        }
      ]
    }

    【参考课后反馈内容】：
    ${feedbackText.slice(0, 1000)}
  `;

  try {
    const res = await ai.models.generateContent({
      model: modelName,
      contents: [{ text: prompt }],
      config: { temperature: 0.2 }
    });

    if (res && res.text) {
      // 清洗 JSON 字符
      const cleanJson = res.text.replace(/```json/g, '').replace(/```/g, '').trim();
      const data = JSON.parse(cleanJson);
      if (data && data.points && data.points.length > 0) {
        return data;
      }
    }
  } catch (err) {
    console.warn('[ImageComposer] JSON 提取告警，使用兜底结构:', err.message);
  }

  // 兜底提取数据
  return {
    title: "本课核心知识要点总结",
    subtitle: "课后复习 · 知识卡",
    points: [
      { topic: "核心知识点", detail: "总结课上讲解的核心知识与考点规律。" },
      { topic: "掌握情况", detail: "针对性巩固薄弱环节，做好课后复习。" }
    ]
  };
}

/**
 * 第二步：尝试生成无文字艺术背景图片
 */
async function generateCleanBackgroundBase64(styleType, customApiKey) {
  const ai = getGeminiClient(customApiKey);
  const imageModels = ['imagen-3.0-generate-002', 'imagen-4.0-generate-001'];

  const stylePrompts = {
    chinese_ink: 'A beautiful high-resolution minimalist traditional Chinese rice paper texture background, subtle ink landscape wash wash painting at bottom corners, elegant red seal watermark, soft warm cream beige color, completely blank center, NO text, NO words, NO letters, high quality background.',
    tech_3d: 'A futuristic dark navy blue gradient background, glowing blue geometric lines, 3D floating glassmorphism panels background, subtle cyan neon glow, completely blank center, NO text, NO words, NO letters, high resolution background.',
    minimalist: 'A clean modern minimalist background, soft pastel morandi gradient background, subtle elegant geometric lines, completely blank center, NO text, NO words, NO letters, ultra high resolution.',
    hand_drawn: 'A cute warm hand-drawn notebook paper texture background, soft pastel color borders, gentle doodle elements, completely blank center, NO text, NO words, NO letters, high quality background.'
  };

  const prompt = stylePrompts[styleType] || stylePrompts['chinese_ink'];

  for (const model of imageModels) {
    try {
      console.log(`[ImageComposer] 正在生成背景艺术图，模型: ${model}...`);
      const res = await ai.models.generateImages({
        model: model,
        prompt: prompt,
        config: {
          numberOfImages: 1,
          outputMimeType: 'image/jpeg',
          aspectRatio: '1:1'
        }
      });
      if (res && res.generatedImages && res.generatedImages.length > 0) {
        return res.generatedImages[0].image.imageBytes;
      }
    } catch (err) {
      console.warn(`[ImageComposer] 背景图生成警告 (${model}):`, err.message);
    }
  }

  return null;
}

/**
 * 第三步：SVG 高高清矢量中文排版合成
 */
export async function composeKnowledgeCardImage(feedbackText, styleType = 'chinese_ink', customApiKey) {
  console.log('[ImageComposer] 开始合成高清中文知识要点卡片...');
  
  // 1. 提取结构化数据
  const data = await extractStructuredKnowledge(feedbackText, customApiKey);
  
  // 2. 获取背景图 (纯艺术图，无文字干扰)
  const bgBase64 = await generateCleanBackgroundBase64(styleType, customApiKey);

  // 3. 各种风格的配色与渲染参数 (1000 x 1000 像素高清尺寸)
  const themeStyles = {
    chinese_ink: {
      bgColor: '#fdfbf7',
      cardBg: 'rgba(255, 253, 249, 0.92)',
      borderColor: '#d4a373',
      titleColor: '#1e1b4b',
      subtitleColor: '#8c2d19',
      topicBg: '#8c2d19',
      topicColor: '#ffffff',
      detailColor: '#334155',
      shadowColor: 'rgba(140, 45, 25, 0.08)'
    },
    tech_3d: {
      bgColor: '#0b0f19',
      cardBg: 'rgba(17, 24, 39, 0.88)',
      borderColor: '#6366f1',
      titleColor: '#f8fafc',
      subtitleColor: '#38bdf8',
      topicBg: '#4f46e5',
      topicColor: '#ffffff',
      detailColor: '#cbd5e1',
      shadowColor: 'rgba(99, 102, 241, 0.25)'
    },
    minimalist: {
      bgColor: '#f8fafc',
      cardBg: 'rgba(255, 255, 255, 0.95)',
      borderColor: '#e2e8f0',
      titleColor: '#0f172a',
      subtitleColor: '#6366f1',
      topicBg: '#0f172a',
      topicColor: '#ffffff',
      detailColor: '#475569',
      shadowColor: 'rgba(0, 0, 0, 0.06)'
    },
    hand_drawn: {
      bgColor: '#fffbeb',
      cardBg: 'rgba(255, 255, 255, 0.96)',
      borderColor: '#f59e0b',
      titleColor: '#78350f',
      subtitleColor: '#d97706',
      topicBg: '#f59e0b',
      topicColor: '#ffffff',
      detailColor: '#451a03',
      shadowColor: 'rgba(245, 158, 11, 0.15)'
    }
  };

  const theme = themeStyles[styleType] || themeStyles['chinese_ink'];

  // 构建卡片节点
  const points = data.points.slice(0, 3); // 最多展示 3 个核心节点
  const cardHeight = 150;
  const startY = 260;
  const gap = 30;

  const pointsSvgArr = points.map((p, index) => {
    const y = startY + index * (cardHeight + gap);
    
    // 换行清洗 detail 文本
    let detailLines = [];
    if (p.detail.length > 20) {
      detailLines.push(p.detail.slice(0, 20));
      detailLines.push(p.detail.slice(20, 40));
    } else {
      detailLines.push(p.detail);
    }

    const detailTextSvg = detailLines.map((line, i) => 
      `<text x="140" y="${y + 85 + i * 26}" font-family="PingFang SC, STHeiti, sans-serif" font-size="19" fill="${theme.detailColor}">${escapeXml(line)}</text>`
    ).join('');

    return `
      <!-- 知识点卡片容器 -->
      <g>
        <rect x="80" y="${y}" width="840" height="${cardHeight}" rx="16" fill="${theme.cardBg}" stroke="${theme.borderColor}" stroke-width="2" filter="drop-shadow(0 8px 16px ${theme.shadowColor})" />
        
        <!-- 序号和主题标贴 -->
        <rect x="110" y="${y + 25}" width="160" height="38" rx="8" fill="${theme.topicBg}" />
        <text x="190" y="${y + 50}" font-family="PingFang SC, STHeiti, sans-serif" font-size="18" font-weight="bold" fill="${theme.topicColor}" text-anchor="middle">
          ${index + 1}. ${escapeXml(p.topic)}
        </text>
        
        <!-- 详情文字排版 -->
        ${detailTextSvg}
      </g>
    `;
  });

  // 背景图片嵌入 SVG
  const bgImageSvg = bgBase64 
    ? `<image href="data:image/jpeg;base64,${bgBase64}" x="0" y="0" width="1000" height="1000" preserveAspectRatio="xMidYMid slice" />`
    : `<rect width="1000" height="1000" fill="${theme.bgColor}" />`;

  const fullSvg = `
    <svg width="1000" height="1000" viewBox="0 0 1000 1000" xmlns="http://www.w3.org/2000/svg">
      <!-- 艺术底图 -->
      ${bgImageSvg}
      
      <!-- 柔和遮罩背景蒙板 -->
      <rect width="1000" height="1000" fill="rgba(255,255,255,0.15)" />

      <!-- 主标题与副标题 -->
      <text x="500" y="110" font-family="PingFang SC, STHeiti, sans-serif" font-size="38" font-weight="bold" fill="${theme.titleColor}" text-anchor="middle" letter-spacing="2">
        ${escapeXml(data.title)}
      </text>
      
      <text x="500" y="165" font-family="PingFang SC, STHeiti, sans-serif" font-size="20" font-weight="600" fill="${theme.subtitleColor}" text-anchor="middle" letter-spacing="1">
        ✦ ${escapeXml(data.subtitle)} ✦
      </text>

      <line x1="350" y1="195" x2="650" y2="195" stroke="${theme.borderColor}" stroke-width="2" stroke-dasharray="6,4" />

      <!-- 知识卡片分支 -->
      ${pointsSvgArr.join('')}

      <!-- 页脚标语 -->
      <text x="500" y="930" font-family="PingFang SC, STHeiti, sans-serif" font-size="16" fill="${theme.detailColor}" text-anchor="middle" opacity="0.8">
        语文课后学习反馈 · 核心考点与复习指引
      </text>
    </svg>
  `;

  try {
    // 使用 Resvg 驱动渲染 1000x1000 高高清 PNG
    const resvg = new Resvg(fullSvg, {
      font: {
        loadSystemFonts: true,
      }
    });

    const pngData = resvg.render();
    const pngBuffer = pngData.asPng();
    const base64Result = pngBuffer.toString('base64');

    console.log(`[ImageComposer] 中文知识点图合成成功！生成大小: ${(pngBuffer.length / 1024).toFixed(1)} KB`);
    return base64Result;
  } catch (err) {
    console.error('[ImageComposer] Resvg 渲染失败:', err);
    return null;
  }
}

function escapeXml(unsafe) {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
