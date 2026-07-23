import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

// macOS 系统内置涵盖完整中文字符集的 Arial Unicode TTF 字体路径
const CHINESE_FONT_PATH = '/System/Library/Fonts/Supplemental/Arial Unicode.ttf';

/**
 * 语文学科典雅美学 PDF 生成引擎 (支持 16:9 2K 宽屏海报多图嵌入、智能授课内容切拆与排版)
 * @param {Object} params
 * @param {string} params.studentName 学生姓名
 * @param {string} params.studentGrade 学生学段 (如 高一 / 初三(中考))
 * @param {string} params.pdfBrandTitle 教师/机构署名 (如 彭老师语文名师工作室)
 * @param {string} params.pdfHeaderTitle 自定义页眉标语 (默认 尘埃落定 · 始见星辰)
 * @param {string} params.feedbackText 反馈 Markdown 文本
 * @param {Buffer|string|Array} params.imageBuffer 知识点图片 Buffer 或 Base64 (支持多图数组)
 * @returns {Promise<Buffer>}
 */
export function generateFeedbackPDF({
  studentName,
  studentGrade,
  pdfBrandTitle,
  pdfHeaderTitle,
  feedbackText,
  imageBuffer,
  imagesBase64
}) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 46, bottom: 50, left: 35, right: 35 },
        bufferPages: true
      });

      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err) => reject(err));

      if (fs.existsSync(CHINESE_FONT_PATH)) {
        doc.font(CHINESE_FONT_PATH);
      }

      const pageWidth = 525;
      const startX = 35;
      const PAGE_MAX_Y = 705; // 预留底部空间避免触发跨页溢出

      const checkPageOverflow = (needHeight) => {
        if (doc.y + needHeight > PAGE_MAX_Y) {
          doc.addPage();
          doc.y = 46;
        }
      };

      // -------------------------------------------------------------
      // 1. 顶部 Header 优雅头卡
      // -------------------------------------------------------------
      const topTitleY = 46;
      const topTitleHeight = 64;
      
      doc.roundedRect(startX, topTitleY, pageWidth, topTitleHeight, 8).fill('#faf7f2');
      doc.roundedRect(startX, topTitleY, pageWidth, topTitleHeight, 8).strokeColor('#e5dfd3').lineWidth(1).stroke();

      const mainHeading = pdfBrandTitle && pdfBrandTitle.trim() ? pdfBrandTitle.trim() : '语文课后学习反馈';
      doc.fontSize(16).fillColor('#1e293b').text(mainHeading, startX + 16, topTitleY + 12);
      
      const dateStr = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
      const gradeStr = studentGrade ? ` (${studentGrade})` : '';
      const nameText = `学员：${studentName || '未指定'}${gradeStr}`;

      const badgeWidth = Math.min(240, nameText.length * 11 + 20);
      doc.roundedRect(startX + 16, topTitleY + 36, badgeWidth, 18, 9).fill('#edf4ef');
      doc.roundedRect(startX + 16, topTitleY + 36, badgeWidth, 18, 9).strokeColor('#c2d6c6').lineWidth(0.8).stroke();
      doc.fontSize(9).fillColor('#2d4a34').text(nameText, startX + 24, topTitleY + 40);

      doc.fontSize(9).fillColor('#64748b').text(`生成时间：${dateStr}`, startX + 370, topTitleY + 40, { align: 'right' });

      doc.y = topTitleY + topTitleHeight + 14;

      // -------------------------------------------------------------
      // 2. 文本解析与模块划分
      // -------------------------------------------------------------
      const cleanedRawLines = sanitizeAndFilterLines(feedbackText);
      
      const recordLines = [];
      const remainingLines = [];
      let foundReview = false;

      for (const line of cleanedRawLines) {
        if (line.includes('课堂回顾：') || line.includes('课堂回顾') || foundReview) {
          foundReview = true;
          remainingLines.push(line);
        } else {
          recordLines.push(line);
        }
      }

      // -------------------------------------------------------------
      // 3. 渲染“课堂记录”卡片
      // -------------------------------------------------------------
      const recordText = recordLines.join('\n').trim();
      if (recordText) {
        checkPageOverflow(48);
        const cardY = doc.y;
        
        doc.roundedRect(startX, cardY, pageWidth, 44, 6).fill('#f4f7f4');
        doc.roundedRect(startX, cardY, 4, 44, 2).fill('#275940');

        renderParagraphWithColonBold(doc, recordText, startX + 14, cardY + 11, pageWidth - 28, 9.5, '#334155', false);
        doc.y = cardY + 54;
      }

      // -------------------------------------------------------------
      // 4. 渲染 16:9 2K 宽屏知识海报
      // -------------------------------------------------------------
      const imgBuffersToRender = parseImageBuffersList(imageBuffer, imagesBase64);

      if (imgBuffersToRender.length > 0) {
        for (let i = 0; i < imgBuffersToRender.length; i++) {
          const imgBuf = imgBuffersToRender[i];
          if (!imgBuf) continue;

          try {
            const imgWidth = 460;
            const imgHeight = 258; // 16:9 比例 (460 / 16 * 9 = 258)
            checkPageOverflow(imgHeight + 36);

            const badgeY = doc.y;
            doc.roundedRect(startX, badgeY, 220, 20, 10).fill('#275940');
            const label = imgBuffersToRender.length > 1 
              ? `❖ 本课核心知识海报 (模块 ${i + 1})` 
              : '❖ 本课核心中文知识图谱海报';
            doc.fontSize(9).fillColor('#ffffff').text(label, startX + 12, badgeY + 5);
            doc.y = badgeY + 26;

            const imgY = doc.y;
            const imgX = startX + (pageWidth - imgWidth) / 2;

            doc.roundedRect(imgX - 4, imgY - 4, imgWidth + 8, imgHeight + 8, 6).fill('#faf7f2');
            doc.roundedRect(imgX - 4, imgY - 4, imgWidth + 8, imgHeight + 8, 6).strokeColor('#e5dfd3').lineWidth(1).stroke();

            doc.image(imgBuf, imgX, imgY, { width: imgWidth, height: imgHeight });
            
            doc.y = imgY + imgHeight + 18;
          } catch (imgErr) {
            console.warn('[PDF] 嵌入 16:9 海报告警:', imgErr.message);
          }
        }
      }

      // -------------------------------------------------------------
      // 5. AST 结构化块解析与智能分拆卡片
      // -------------------------------------------------------------
      const sections = parseSectionsAST(remainingLines);

      for (const sec of sections) {
        renderLiteratiCardAST(doc, startX, pageWidth, sec, checkPageOverflow);
      }

      // -------------------------------------------------------------
      // 6. 统一绘制页眉 (Header) 与 页脚页码 (Footer)
      //    在 bufferedPageRange 阶段遍历所有页面，彻底避免产生多余空白页！
      // -------------------------------------------------------------
      const headerSlogan = pdfHeaderTitle && pdfHeaderTitle.trim() ? pdfHeaderTitle.trim() : '尘埃落定 · 始见星辰';
      const pages = doc.bufferedPageRange();
      const totalPageCount = pages.count;

      for (let i = 0; i < totalPageCount; i++) {
        doc.switchToPage(i);

        // A. 页眉：顶部线 + 标语
        doc.fontSize(9).fillColor('#64748b').text(headerSlogan, startX, 22, {
          width: pageWidth,
          align: 'center'
        });
        doc.strokeColor('#cbd5e1').lineWidth(0.5).moveTo(startX, 34).lineTo(startX + pageWidth, 34).stroke();

        // B. 页脚：页脚线 + 品牌 Slogan + 动态页码
        const footerY = 812;
        doc.strokeColor('#cbd5e1').lineWidth(0.5).moveTo(startX, footerY - 10).lineTo(startX + pageWidth, footerY - 10).stroke();

        // 左下角/中央品牌 Slogan
        doc.fontSize(8.5).fillColor('#94a3b8').text('尘埃落定 · 始见星辰', startX, footerY, {
          width: pageWidth / 2,
          align: 'left'
        });

        // 右下角精准动态页码：— 第 X 页 / 共 Y 页 —
        const pageNumText = `— 第 ${i + 1} 页 / 共 ${totalPageCount} 页 —`;
        doc.fontSize(8.5).fillColor('#64748b').text(pageNumText, startX + pageWidth / 2, footerY, {
          width: pageWidth / 2,
          align: 'right'
        });
      }

      doc.end();

    } catch (err) {
      console.error('[PDF Generator] 抛出异常:', err);
      reject(err);
    }
  });
}

/**
 * 解析图片 Buffer / Base64 / 数组
 */
function parseImageBuffersList(imageBuffer, imagesBase64) {
  const result = [];
  const rawList = [];

  if (Array.isArray(imagesBase64) && imagesBase64.length > 0) {
    rawList.push(...imagesBase64);
  } else if (imageBuffer) {
    if (Array.isArray(imageBuffer)) {
      rawList.push(...imageBuffer);
    } else {
      rawList.push(imageBuffer);
    }
  }

  for (const item of rawList) {
    if (!item) continue;
    try {
      if (Buffer.isBuffer(item) && item.length > 0) {
        result.push(item);
      } else if (typeof item === 'string' && item.trim().length > 0) {
        const pureBase64 = item.replace(/^data:image\/\w+;base64,/, '');
        const buf = Buffer.from(pureBase64, 'base64');
        if (buf.length > 0) {
          result.push(buf);
        }
      }
    } catch (e) {}
  }

  return result;
}

/**
 * 清洗 Markdown 残留符号
 */
function cleanMarkdownSymbols(text) {
  if (!text) return '';
  return text
    .replace(/^---+\s*$/gm, '')
    .replace(/^\*\*\*+\s*$/gm, '')
    .replace(/^___+\s*$/gm, '')
    .replace(/\*{1,3}/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/\[\d+\]/g, '')
    .trim();
}

/**
 * 彻底过滤无后文的孤立冒号行
 */
function sanitizeAndFilterLines(text) {
  if (!text) return [];
  const rawLines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const result = [];

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const cleaned = cleanMarkdownSymbols(line);

    if (cleaned === '---' || cleaned === '***' || cleaned === '___') {
      continue;
    }

    const isColonOnlyTitle = (cleaned.endsWith('：') || cleaned.endsWith(':')) && cleaned.length < 16;
    
    if (isColonOnlyTitle) {
      const hasNextContent = (i + 1 < rawLines.length) && 
                             !rawLines[i+1].startsWith('#') && 
                             !rawLines[i+1].includes('：') &&
                             cleanMarkdownSymbols(rawLines[i+1]).length > 0;
      
      if (!hasNextContent) {
        continue;
      }
    }
    result.push(line);
  }

  return result;
}

/**
 * AST 文档块结构化解析器
 */
function parseSectionsAST(lines) {
  const sections = [];
  let currentTopSec = null;

  for (const rawLine of lines) {
    const line = cleanMarkdownSymbols(rawLine.trim());
    if (!line || line === '---' || line === '***') continue;

    const isTopModule = line.startsWith('课堂回顾') || 
                        line.startsWith('授课内容') ||
                        line.startsWith('典型例题') ||
                        line.startsWith('考点拆解') ||
                        line.startsWith('学员掌握情况') ||
                        line.startsWith('掌握情况') ||
                        line.startsWith('课后作业') ||
                        line.startsWith('作业') ||
                        line.startsWith('核心金句') ||
                        line.startsWith('名言');

    if (isTopModule) {
      if (currentTopSec && currentTopSec.lines.length > 0) {
        sections.push(currentTopSec);
      }
      currentTopSec = {
        title: line.replace(/：$/, ''),
        lines: []
      };
    } else {
      if (!currentTopSec) {
        currentTopSec = { title: '授课详情', lines: [] };
      }
      currentTopSec.lines.push(line);
    }
  }

  if (currentTopSec && currentTopSec.lines.length > 0) {
    sections.push(currentTopSec);
  }

  return sections.filter(sec => sec.lines.length > 0);
}

/**
 * 渲染宣纸 AST 顶级主卡片
 */
function renderLiteratiCardAST(doc, startX, pageWidth, sec, checkPageOverflow) {
  const title = sec.title || '';
  const lines = sec.lines || [];

  if (lines.length === 0) return;

  const lineGroups = groupLinesForCleanLayout(lines);

  lineGroups.forEach((group, idx) => {
    const cardTitle = idx === 0 ? title : (title ? `${title} (续)` : '');
    renderSingleSubCard(doc, startX, pageWidth, cardTitle, group, checkPageOverflow);
  });
}

function groupLinesForCleanLayout(lines) {
  const groups = [];
  let currentGroup = [];

  for (const line of lines) {
    currentGroup.push(line);
    if (currentGroup.length >= 7 || (isSubHeaderLine(line) && currentGroup.length >= 4)) {
      groups.push(currentGroup);
      currentGroup = [];
    }
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups;
}

function renderSingleSubCard(doc, startX, pageWidth, title, lines, checkPageOverflow) {
  doc.fontSize(9.8);
  let contentHeight = 0;
  for (const l of lines) {
    if (l.startsWith('>')) {
      contentHeight += 28;
    } else if (isSubHeaderLine(l)) {
      contentHeight += 20;
    } else {
      contentHeight += doc.heightOfString(cleanMarkdownSymbols(l), { width: pageWidth - 32, lineGap: 4 }) + 4;
    }
  }

  const cardPaddingTop = title ? 26 : 12;
  const cardHeight = Math.max(40, contentHeight + cardPaddingTop + 12);

  checkPageOverflow(cardHeight);

  const cardY = doc.y;
  const cardBg = '#faf8f3';
  const borderColor = '#e7e0d3';

  doc.roundedRect(startX, cardY, pageWidth, cardHeight, 8).fill(cardBg);
  doc.roundedRect(startX, cardY, pageWidth, cardHeight, 8).strokeColor(borderColor).lineWidth(0.9).stroke();

  let currentY = cardY + 12;
  if (title) {
    doc.fontSize(13.5).fillColor('#1e293b').text(`❖  ${title}`, startX + 16, currentY);
    currentY += 24;
  }

  for (const l of lines) {
    if (l.startsWith('>')) {
      const quoteText = cleanMarkdownSymbols(l.replace(/^>\s*/, ''));
      doc.roundedRect(startX + 14, currentY, pageWidth - 28, 24, 4).fill('#f2f7f3');
      doc.roundedRect(startX + 14, currentY, 3, 24, 1).fill('#275940');
      doc.fontSize(9.5).fillColor('#1e3a2b').text(`“ ${quoteText} ”`, startX + 24, currentY + 5);
      currentY += 28;
    } else if (isSubHeaderLine(l)) {
      const subTitleText = cleanMarkdownSymbols(l);
      doc.fontSize(11).fillAndStroke('#8c2d19', '#8c2d19').lineWidth(0.35).text(subTitleText, startX + 16, currentY);
      doc.lineWidth(1).fillColor('#334155');
      currentY += 20;
    } else {
      renderParagraphWithColonBold(doc, l, startX + 16, currentY, pageWidth - 32, 9.5, '#334155', true);
      const textH = doc.heightOfString(cleanMarkdownSymbols(l), { width: pageWidth - 32, lineGap: 4 });
      currentY += textH + 4;
    }
  }

  doc.y = Math.min(695, cardY + cardHeight + 12);
}

function isSubHeaderLine(line) {
  const clean = cleanMarkdownSymbols(line);
  return /^考点[一二三四五六七八九十\d]+/.test(clean) || 
         /^[一二三四五六七八九十]+[\.\、\s]/.test(clean) || 
         (/^\d+[\.\、\s]/.test(clean) && clean.length < 28) ||
         clean.startsWith('思维优势') ||
         clean.startsWith('优势闪光点') ||
         clean.startsWith('薄弱环节');
}

function renderParagraphWithColonBold(doc, text, x, y, width, fontSize = 9.5, defaultColor = '#334155', needIndent = true) {
  const cleanText = cleanMarkdownSymbols(text);
  doc.fontSize(fontSize);

  const isListItem = cleanText.startsWith('-') || /^[一二三四五六七八九十\d]+[\.\、\s]/.test(cleanText) || /^考点[一二三四五六七八九十\d]+/.test(cleanText);
  const drawX = (needIndent && !isListItem) ? x + 16 : x;
  const drawWidth = (needIndent && !isListItem) ? width - 16 : width;

  const colonIdx = cleanText.indexOf('：') !== -1 ? cleanText.indexOf('：') : cleanText.indexOf(':');

  if (colonIdx > 0 && colonIdx < 35) {
    const colonPrefix = cleanText.slice(0, colonIdx + 1);
    const colonSuffix = cleanText.slice(colonIdx + 1);

    doc.text('', drawX, y, { continued: true });
    doc.fontSize(10).fillAndStroke('#0f172a', '#0f172a').lineWidth(0.35).text(colonPrefix, { continued: true });
    doc.lineWidth(1);
    doc.fontSize(fontSize).fillColor(defaultColor).text(colonSuffix, {
      width: drawWidth,
      lineGap: 4
    });
  } else {
    doc.fillColor(defaultColor).text(cleanText, drawX, y, {
      width: drawWidth,
      lineGap: 4
    });
  }
}
