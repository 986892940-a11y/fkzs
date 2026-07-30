import PDFDocument from 'pdfkit';
import fs from 'fs';

// macOS 系统内置中文字体（涵盖完整中文字符集）
const CHINESE_FONT_PATH = '/System/Library/Fonts/Supplemental/Arial Unicode.ttf';

/**
 * 见辰境 · 方案 E 重构版 PDF 生成引擎 (茶墨双线典籍风 + 阳刻四方朱印 + 学员掌握情况双列分栏)
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
      // 1. 初始化 A4 PDF 文档
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 40, bottom: 46, left: 35, right: 35 },
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
      const PAGE_MAX_Y = 765; // 优化后的精准安全高度 (预留页脚 814pt 安全边距)

      // 动态绘制茶墨竹纸背景色函数
      const drawPaperBackground = () => {
        doc.save();
        doc.rect(0, 0, 595.28, 841.89).fill('#F6F2E9');
        doc.restore();
      };

      // 绘制第一页纸张背景
      drawPaperBackground();

      // 动态分页校验器
      const checkPageOverflow = (needHeight) => {
        if (doc.y + needHeight > PAGE_MAX_Y) {
          doc.addPage();
          drawPaperBackground(); // 新页面填充茶墨竹纸底色
          doc.y = 40;
        }
      };

      // -------------------------------------------------------------
      // 1. 顶部 Header 渲染 (方案 E：古籍双线 + 阳刻四方朱印)
      // -------------------------------------------------------------
      const topTitleY = 40;
      const topTitleHeight = 66;

      // 顶部双线条 (Double Line 装帧)
      doc.moveTo(startX, topTitleY).lineTo(startX + pageWidth, topTitleY).strokeColor('#3D3B37').lineWidth(2.5).stroke();
      doc.moveTo(startX, topTitleY + 3).lineTo(startX + pageWidth, topTitleY + 3).strokeColor('#3D3B37').lineWidth(0.8).stroke();
      
      // 底部单线条
      doc.moveTo(startX, topTitleY + topTitleHeight).lineTo(startX + pageWidth, topTitleY + topTitleHeight).strokeColor('#3D3B37').lineWidth(1).stroke();

      // 品牌主标题 (简体中文)
      const mainHeading = pdfBrandTitle && pdfBrandTitle.trim() ? pdfBrandTitle.trim() : '见辰境 · 语文精读学情反馈';
      doc.fontSize(15).fillColor('#3D3B37').text(mainHeading, startX, topTitleY + 10, {
        width: pageWidth - 60,
        align: 'center'
      });

      // Slogan 标语 (简体中文)
      const sloganText = '✦ 尘 埃 落 定 · 始 见 星 辰 ✦';
      doc.fontSize(9.5).fillColor('#8B5A42').text(sloganText, startX, topTitleY + 31, {
        width: pageWidth - 60,
        align: 'center'
      });

      // 元数据 (简体中文)
      const dateStr = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
      const gradeStr = studentGrade ? ` (${studentGrade})` : '';
      const metaText = `学员：${studentName || '未指定'}${gradeStr}  |  授课日期：${dateStr}`;
      doc.fontSize(8.5).fillColor('#6E6A63').text(metaText, startX, topTitleY + 47, {
        width: pageWidth - 60,
        align: 'center'
      });

      // ★ 右侧阳刻四方朱印 (白底红框红字：見辰境印，古法右起竖排)
      const sealSize = 42;
      const sealX = startX + pageWidth - sealSize - 2;
      const sealY = topTitleY + (topTitleHeight - sealSize) / 2;

      // 朱砂红外框与宣纸底色
      doc.roundedRect(sealX, sealY, sealSize, sealSize, 2).fillAndStroke('#F6F2E9', '#A6382B').lineWidth(1.8);

      // 2x2 阳刻四字 (繁体：右列 見辰，左列 境印)
      doc.fontSize(13.5).fillColor('#A6382B');
      doc.text('境', sealX + 4, sealY + 4, { lineBreak: false });
      doc.text('見', sealX + 22, sealY + 4, { lineBreak: false });
      doc.text('印', sealX + 4, sealY + 22, { lineBreak: false });
      doc.text('辰', sealX + 22, sealY + 22, { lineBreak: false });

      doc.y = topTitleY + topTitleHeight + 14;

      // -------------------------------------------------------------
      // 2. 文本清洗与“课堂记录”气泡提取
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

      // 3. 渲染“课堂记录”提示卡
      const recordText = recordLines.join('\n').trim();
      if (recordText) {
        checkPageOverflow(44);
        const cardY = doc.y;
        doc.roundedRect(startX, cardY, pageWidth, 40, 4).fill('#FAF7F2');
        doc.roundedRect(startX, cardY, pageWidth, 40, 4).strokeColor('#E2DACD').lineWidth(0.8).stroke();
        doc.roundedRect(startX, cardY, 3.5, 40, 1).fill('#3D3B37'); // 茶墨左指示条
        renderParagraphWithColonBold(doc, recordText, startX + 14, cardY + 10, pageWidth - 28, 9, '#3D3B37', false);
        doc.y = cardY + 48;
      }

      // -------------------------------------------------------------
      // 4. 渲染 16:9 知识海报 (画轴自适应容器)
      // -------------------------------------------------------------
      const imgBuffersToRender = parseImageBuffersList(imageBuffer, imagesBase64);
      if (imgBuffersToRender.length > 0) {
        for (let i = 0; i < imgBuffersToRender.length; i++) {
          const imgBuf = imgBuffersToRender[i];
          if (!imgBuf) continue;
          try {
            const imgWidth = 440;
            const imgHeight = 210; // 智能锁定高度
            checkPageOverflow(imgHeight + 30);

            const badgeY = doc.y;
            // 茶墨小徽章
            doc.roundedRect(startX, badgeY, 170, 18, 3).fill('#3D3B37');
            const label = imgBuffersToRender.length > 1 ? `❖ 本节课知识图谱 (${i + 1})` : '❖ 本节课知识图谱';
            doc.fontSize(8.5).fillColor('#F6F2E9').text(label, startX + 10, badgeY + 4);
            doc.y = badgeY + 22;

            const imgY = doc.y;
            const imgX = startX + (pageWidth - imgWidth) / 2;
            
            // 宣纸装裱边框外框
            doc.roundedRect(imgX - 4, imgY - 4, imgWidth + 8, imgHeight + 8, 4).fill('#FAF7F2');
            doc.roundedRect(imgX - 4, imgY - 4, imgWidth + 8, imgHeight + 8, 4).strokeColor('#E2DACD').lineWidth(1).stroke();
            doc.image(imgBuf, imgX, imgY, { width: imgWidth, height: imgHeight });
            
            doc.y = imgY + imgHeight + 14;
          } catch (imgErr) {
            console.error('海报渲染异常:', imgErr);
          }
        }
      }

      // -------------------------------------------------------------
      // 5. AST 切片拆解与宣纸卡片流式渲染
      // -------------------------------------------------------------
      const sections = parseSectionsAST(remainingLines);
      for (const sec of sections) {
        // 动态识别：特殊模块切分与高质感卡片渲染
        if (sec.title && (sec.title.includes('学生课堂综合打分') || sec.title.includes('综合打分') || sec.title.includes('综合评分'))) {
          renderScoreCardAST(doc, startX, pageWidth, sec, checkPageOverflow);
        } else if (sec.title && (sec.title.includes('下节课程预告') || sec.title.includes('课程预告'))) {
          renderPreviewCardAST(doc, startX, pageWidth, sec, checkPageOverflow);
        } else if (sec.title && sec.title.includes('学员掌握情况')) {
          renderDualColumnMasteryCard(doc, startX, pageWidth, sec, checkPageOverflow);
        } else {
          renderLiteratiCardAST(doc, startX, pageWidth, sec, checkPageOverflow);
        }
      }

      // -------------------------------------------------------------
      // 6. 页眉与页脚 Post-Processing 处理
      // -------------------------------------------------------------
      const headerSlogan = pdfHeaderTitle && pdfHeaderTitle.trim() ? pdfHeaderTitle.trim() : '尘埃落定 · 始见星辰';
      const pages = doc.bufferedPageRange();
      for (let i = 0; i < pages.count; i++) {
        doc.switchToPage(i);
        doc.page.margins.bottom = 0; // 防止绝对定位引发隐式跨页

        // 页眉极简 Slogan 线
        doc.fontSize(8).fillColor('#8C867B').text(headerSlogan, startX, 20, {
          width: pageWidth,
          align: 'center',
          lineBreak: false
        });
        doc.strokeColor('#D8CFC2').lineWidth(0.5).moveTo(startX, 30).lineTo(startX + pageWidth, 30).stroke();

        // 页脚页码
        const pageText = `第 ${i + 1} 页 / 共 ${pages.count} 页`;
        doc.fontSize(8).fillColor('#8C867B').text(pageText, startX, 814, {
          width: pageWidth,
          align: 'center',
          lineBreak: false
        });
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * 宣纸风主卡片渲染器
 */
function renderLiteratiCardAST(doc, startX, pageWidth, sec, checkPageOverflow) {
  const { title, lines } = sec;

  // 如果该模块包含多个子标题 (如考点拆解)，拆分为独立子卡片绘制
  const subBlocks = splitSectionIntoSubBlocks(lines);

  if (subBlocks.length > 1) {
    for (let i = 0; i < subBlocks.length; i++) {
      const block = subBlocks[i];
      const blockTitle = i === 0 ? title : '';
      renderSingleSubCard(doc, startX, pageWidth, blockTitle, block, checkPageOverflow);
    }
  } else {
    renderSingleSubCard(doc, startX, pageWidth, title, lines, checkPageOverflow);
  }
}

/**
 * 将长 Section 根据子标题划分成小 Block，避免生成巨型卡片超限
 */
function splitSectionIntoSubBlocks(lines) {
  const blocks = [];
  let currentBlock = [];

  for (const l of lines) {
    if (isSubHeaderLine(l) && currentBlock.length > 0) {
      blocks.push(currentBlock);
      currentBlock = [l];
    } else {
      currentBlock.push(l);
    }
  }
  if (currentBlock.length > 0) {
    blocks.push(currentBlock);
  }
  return blocks;
}

function extractQuoteText(line) {
  const clean = cleanMarkdownSymbols(line);
  if (!clean.startsWith('>')) return '';
  return clean
    .replace(/^>\s*/, '')
    .replace(/^[“"”'‘`\s]+|[“"”'‘`\s]+$/g, '')
    .trim();
}

function renderSingleSubCard(doc, startX, pageWidth, title, lines, checkPageOverflow) {
  doc.fontSize(9.5);
  let contentHeight = 0;

  // 1. 预测真实高度 (过滤空白引用)
  for (const l of lines) {
    const clean = cleanMarkdownSymbols(l);
    if (!clean) continue;

    if (l.startsWith('>')) {
      const quoteText = extractQuoteText(l);
      if (!quoteText || quoteText.length === 0) continue; // 关键防御：过滤多余空引号

      const h = doc.heightOfString(`“ ${quoteText} ”`, { width: pageWidth - 48, lineGap: 3 });
      contentHeight += Math.max(24, h + 8) + 6;
    } else if (isSubHeaderLine(l)) {
      doc.fontSize(10.5);
      const h = doc.heightOfString(clean, { width: pageWidth - 32, lineGap: 3 });
      contentHeight += h + 6;
      doc.fontSize(9.5);
    } else {
      const isListItem = clean.startsWith('-') || /^[一二三四五六七八九十\d]+[\.\、\s]/.test(clean);
      const drawWidth = (!isListItem) ? pageWidth - 46 : pageWidth - 32;
      const h = doc.heightOfString(clean, { width: drawWidth, lineGap: 3 });
      contentHeight += h + 5;
    }
  }

  let titleH = 0;
  if (title) {
    doc.fontSize(12);
    titleH = doc.heightOfString(`❖  ${title}`, { width: pageWidth - 32, lineGap: 4 }) + 6;
    doc.fontSize(9.5);
  }

  const cardPaddingTop = 12;
  const cardHeight = Math.max(34, contentHeight + titleH + cardPaddingTop + 8);

  checkPageOverflow(cardHeight);

  const cardY = doc.y;
  doc.roundedRect(startX, cardY, pageWidth, cardHeight, 4).fill('#FAF7F2');
  doc.roundedRect(startX, cardY, pageWidth, cardHeight, 4).strokeColor('#E2DACD').lineWidth(0.8).stroke();

  let currentY = cardY + 10;
  if (title) {
    doc.fontSize(12).fillColor('#3D3B37');
    const titleText = `❖  ${title}`;
    const tH = doc.heightOfString(titleText, { width: pageWidth - 32, lineGap: 4 });
    doc.text(titleText, startX + 16, currentY, { width: pageWidth - 32, lineGap: 4 });
    currentY += tH + 6;
  }

  for (const l of lines) {
    const clean = cleanMarkdownSymbols(l);
    if (!clean) continue;

    if (l.startsWith('>')) {
      // 引用金句竹简框 (防御空引号)
      const quoteText = extractQuoteText(l);
      if (!quoteText || quoteText.length === 0) continue;

      doc.fontSize(9);
      const textInQuoteH = doc.heightOfString(`“ ${quoteText} ”`, { width: pageWidth - 48, lineGap: 3 });
      const quoteBoxH = Math.max(24, textInQuoteH + 8);

      doc.roundedRect(startX + 14, currentY, pageWidth - 28, quoteBoxH, 3).fill('#EFE9DD');
      doc.roundedRect(startX + 14, currentY, 3.5, quoteBoxH, 1).fill('#A6382B'); // 朱砂红左侧立条
      doc.fillColor('#3D3B37').text(`“ ${quoteText} ”`, startX + 24, currentY + 4, { width: pageWidth - 48, lineGap: 3 });
      currentY += quoteBoxH + 6;
    } else if (isSubHeaderLine(l)) {
      // 朱砂色子标题
      doc.fontSize(10.5);
      const subH = doc.heightOfString(clean, { width: pageWidth - 32, lineGap: 3 });
      doc.fillColor('#A6382B').text(clean, startX + 16, currentY, { width: pageWidth - 32, lineGap: 3 });
      doc.fillColor('#3D3B37');
      currentY += subH + 5;
    } else {
      const isListItem = clean.startsWith('-') || /^[一二三四五六七八九十\d]+[\.\、\s]/.test(clean);
      const drawWidth = (!isListItem) ? pageWidth - 46 : pageWidth - 32;
      const textH = doc.heightOfString(clean, { width: drawWidth, lineGap: 3 });
      renderParagraphWithColonBold(doc, l, startX + 16, currentY, pageWidth - 32, 9, '#3D3B37', true);
      currentY += textH + 5;
    }
  }

  doc.y = cardY + cardHeight + 10;
}

/**
 * 双列分栏卡片渲染器 (针对掌握情况与建议)
 */
function renderDualColumnMasteryCard(doc, startX, pageWidth, sec, checkPageOverflow) {
  const { title, lines } = sec;
  const colWidth = (pageWidth - 10) / 2;

  const leftLines = [];
  const rightLines = [];

  // 1. 精准寻找右侧“建议/巩固/薄弱/改进”独立子标题行的索引
  let splitIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const clean = cleanMarkdownSymbols(l).trim();
    if (!clean) continue;

    const trimmedRaw = l.trim();
    const isBulletItem = trimmedRaw.startsWith('-') || trimmedRaw.startsWith('*') || /^\d+\./.test(trimmedRaw);

    // 检查是否为右侧“建议/巩固/薄弱/改进”的独立子标题行（而非带有“提升”等动词的列表内容）
    const isRightHeader = !isBulletItem && clean.length <= 25 && (
      clean.startsWith('课后') ||
      clean.startsWith('建议') ||
      clean.startsWith('薄弱') ||
      clean.startsWith('改进') ||
      clean.includes('巩固与建议') ||
      clean.includes('薄弱与建议') ||
      clean.includes('课后建议') ||
      clean.includes('改进与反思')
    );

    if (isRightHeader) {
      splitIndex = i;
      break;
    }
  }

  // 2. 切分左右两列
  if (splitIndex !== -1) {
    leftLines.push(...lines.slice(0, splitIndex));
    rightLines.push(...lines.slice(splitIndex));
  } else {
    // 降级分栏方案：仅在独立子标题行切换，避免误匹配正文中包含的“提升”、“建议”等动词
    let currentGroup = leftLines;
    for (const l of lines) {
      const clean = cleanMarkdownSymbols(l).trim();
      if (!clean) continue;
      const trimmedRaw = l.trim();
      const isBulletItem = trimmedRaw.startsWith('-') || trimmedRaw.startsWith('*') || /^\d+\./.test(trimmedRaw);
      
      if (!isBulletItem && clean.length <= 25 && (clean.includes('建议') || clean.includes('巩固') || clean.includes('薄弱') || clean.includes('改进'))) {
        currentGroup = rightLines;
      }
      currentGroup.push(l);
    }
  }

  // 3. 兜底处理：避免出现单列完全空缺
  if (leftLines.length === 0 && rightLines.length > 0) {
    leftLines.push(...rightLines.splice(0, Math.ceil(rightLines.length / 2)));
  } else if (rightLines.length === 0 && leftLines.length >= 2) {
    rightLines.push(...leftLines.splice(Math.ceil(leftLines.length / 2)));
  }

  doc.fontSize(9);
  const getLinesHeight = (arr) => {
    let h = 0;
    for (const line of arr) {
      const clean = cleanMarkdownSymbols(line);
      if (clean) h += doc.heightOfString(clean, { width: colWidth - 20, lineGap: 3 }) + 4;
    }
    return h;
  };

  const leftH = getLinesHeight(leftLines);
  const rightH = getLinesHeight(rightLines);
  const bodyH = Math.max(leftH, rightH, 38);
  const cardHeight = bodyH + 32;

  checkPageOverflow(cardHeight);

  const cardY = doc.y;

  if (title) {
    doc.fontSize(12).fillColor('#3D3B37');
    doc.text(`❖  ${title}`, startX, cardY);
  }

  const columnsY = title ? cardY + 18 : cardY;

  // 左列（课堂优势 - 茶墨顶条）
  doc.roundedRect(startX, columnsY, colWidth, bodyH + 10, 4).fill('#FAF7F2');
  doc.roundedRect(startX, columnsY, colWidth, bodyH + 10, 4).strokeColor('#E2DACD').lineWidth(0.8).stroke();
  doc.roundedRect(startX, columnsY, colWidth, 2.5, 1).fill('#3D3B37');

  doc.fontSize(9.5).fillColor('#3D3B37').text('🟢 课堂优势与反应', startX + 10, columnsY + 8);
  let curLeftY = columnsY + 23;
  for (const l of leftLines) {
    const clean = cleanMarkdownSymbols(l);
    if (!clean) continue;
    const h = doc.heightOfString(clean, { width: colWidth - 20, lineGap: 3 });
    renderParagraphWithColonBold(doc, l, startX + 10, curLeftY, colWidth - 20, 8.5, '#3D3B37', false);
    curLeftY += h + 4;
  }

  // 右列（薄弱建议 - 朱砂顶条）
  const rightX = startX + colWidth + 10;
  doc.roundedRect(rightX, columnsY, colWidth, bodyH + 10, 4).fill('#FAF7F2');
  doc.roundedRect(rightX, columnsY, colWidth, bodyH + 10, 4).strokeColor('#E2DACD').lineWidth(0.8).stroke();
  doc.roundedRect(rightX, columnsY, colWidth, 2.5, 1).fill('#A6382B');

  doc.fontSize(9.5).fillColor('#A6382B').text('🎯 课后巩固与建议', rightX + 10, columnsY + 8);
  let curRightY = columnsY + 23;
  for (const l of rightLines) {
    const clean = cleanMarkdownSymbols(l);
    if (!clean) continue;
    const h = doc.heightOfString(clean, { width: colWidth - 20, lineGap: 3 });
    renderParagraphWithColonBold(doc, l, rightX + 10, curRightY, colWidth - 20, 8.5, '#3D3B37', false);
    curRightY += h + 4;
  }

  doc.y = columnsY + bodyH + 20;
}

/**
 * 冒号前缀加粗段落渲染器
 */
function renderParagraphWithColonBold(doc, text, x, y, width, fontSize = 9, defaultColor = '#3D3B37', needIndent = true) {
  const cleanText = cleanMarkdownSymbols(text);
  doc.fontSize(fontSize);

  const isListItem = cleanText.startsWith('-') || /^[一二三四五六七八九十\d]+[\.\、\s]/.test(cleanText);
  const drawX = (needIndent && !isListItem) ? x + 10 : x;
  const drawWidth = (needIndent && !isListItem) ? width - 10 : width;

  const colonIndex = cleanText.indexOf('：') !== -1 ? cleanText.indexOf('：') : cleanText.indexOf(':');

  if (colonIndex > 0 && colonIndex < 12) {
    const prefix = cleanText.substring(0, colonIndex + 1);
    const body = cleanText.substring(colonIndex + 1);

    doc.fillColor('#3D3B37').text(prefix, drawX, y, {
      width: drawWidth,
      lineGap: 3,
      continued: true
    });
    doc.fillColor(defaultColor).text(body, {
      width: drawWidth,
      lineGap: 3
    });
  } else {
    doc.fillColor(defaultColor).text(cleanText, drawX, y, {
      width: drawWidth,
      lineGap: 3
    });
  }
}

// -------------------------------------------------------------
// 内部 AST 辅助解析函数库
// -------------------------------------------------------------

function sanitizeAndFilterLines(rawText) {
  if (!rawText) return [];
  return rawText
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);
}

function cleanMarkdownSymbols(str) {
  if (!str) return '';
  return str
    .replace(/^---+\s*$/gm, '')
    .replace(/^\*\*\*+\s*$/gm, '')
    .replace(/^___+\s*$/gm, '')
    .replace(/\*{1,3}/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/\[\d+\]/g, '')
    .trim();
}

function isSubHeaderLine(line) {
  const clean = cleanMarkdownSymbols(line);
  // 子标题仅匹配大模块子章节名称（如：1. 理论考点拆解；【考点精讲】；考点一），不将普通数字序号作业/列表当作独立切片卡片
  return /^【.*?】/.test(clean) ||
         /^考点[一二三四五六七八九十\d]+/.test(clean) ||
         /^[一二三四五六七八九十]+[\.\、\s]/.test(clean) ||
         (/^\d+\.\s+[\u4e00-\u9fa5]{2,10}(研读|拆解|讲解|分析|梳理|突破|解析|构架|应用|训练|语法|词汇|表达)/.test(clean));
}

function parseSectionsAST(lines) {
  const sections = [];
  let currentTopSec = null;

  for (const rawLine of lines) {
    const line = cleanMarkdownSymbols(rawLine.trim());
    if (!line || line === '---' || line === '***') continue;

    const isTopModule = (line.length < 25) && (
      rawLine.startsWith('## ') ||
      line.startsWith('课堂回顾') ||
      line.startsWith('学生课堂综合打分') ||
      line.startsWith('综合打分') ||
      line.startsWith('授课内容') ||
      line.startsWith('典型例题') ||
      line.startsWith('考点拆解') ||
      line.startsWith('学员掌握情况') ||
      line.startsWith('掌握情况') ||
      line.startsWith('核心金句') ||
      line.startsWith('名言积累') ||
      line.startsWith('课后作业') ||
      line.startsWith('作业') ||
      line.startsWith('下节课程预告') ||
      line.startsWith('课程预告')
    );

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

function parseImageBuffersList(imageBuffer, imagesBase64) {
  const list = [];
  const addBase64 = (str) => {
    if (typeof str === 'string' && str.trim()) {
      const cleanB64 = str.replace(/^data:image\/[a-zA-Z]+;base64,/i, '').replace(/\s+/g, '');
      if (cleanB64) {
        try {
          list.push(Buffer.from(cleanB64, 'base64'));
        } catch (e) {}
      }
    }
  };

  if (imageBuffer) {
    if (Buffer.isBuffer(imageBuffer)) {
      list.push(imageBuffer);
    } else {
      addBase64(imageBuffer);
    }
  }

  if (Array.isArray(imagesBase64)) {
    for (const b64 of imagesBase64) {
      addBase64(b64);
    }
  }

  const uniqueBuffers = [];
  const seenKeys = new Set();
  for (const buf of list) {
    const key = buf.length + '_' + buf.subarray(0, 50).toString('hex');
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      uniqueBuffers.push(buf);
    }
  }
  return uniqueBuffers;
}

/**
 * 学生课堂综合打分卡片渲染器 (茶墨风矢量环形饼图 Literati Donut Chart)
 */
function renderScoreCardAST(doc, startX, pageWidth, sec, checkPageOverflow) {
  const { title, lines } = sec;
  const cleanLines = lines.filter(l => cleanMarkdownSymbols(l).length > 0);

  // 1. 解析分数与三个维度得分
  let totalScore = 95;
  let score1 = 28, score2 = 38, score3 = 28;
  let max1 = 30, max2 = 40, max3 = 30;

  for (const l of cleanLines) {
    const clean = cleanMarkdownSymbols(l);
    if (clean.includes('综合得分') || clean.includes('总分')) {
      const match = clean.match(/(\d{2,3})\s*[\/分]/);
      if (match) totalScore = parseInt(match[1], 10);
    } else if (clean.includes('听课专注') || clean.includes('专注与互动')) {
      const match = clean.match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
      if (match) { score1 = parseInt(match[1], 10); max1 = parseInt(match[2], 10); }
    } else if (clean.includes('考点理解') || clean.includes('理解力')) {
      const match = clean.match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
      if (match) { score2 = parseInt(match[1], 10); max2 = parseInt(match[2], 10); }
    } else if (clean.includes('当堂练习') || clean.includes('完成度')) {
      const match = clean.match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
      if (match) { score3 = parseInt(match[1], 10); max3 = parseInt(match[2], 10); }
    }
  }

  // 计算整体卡片预测高度 (饼图区 75pt + 文字明细)
  doc.fontSize(9);
  let textH = 0;
  for (const l of cleanLines) {
    const clean = cleanMarkdownSymbols(l);
    if (clean.includes('综合得分') || clean.includes('总分')) continue;
    const h = doc.heightOfString(clean, { width: pageWidth - 32, lineGap: 3 });
    textH += h + 5;
  }

  const chartAreaH = 82;
  const cardBodyH = chartAreaH + textH + 16;
  const cardHeight = cardBodyH + 34;
  checkPageOverflow(cardHeight);

  const cardY = doc.y;
  doc.fontSize(12).fillColor('#3D3B37');
  doc.text(`❖  ${title || '学生课堂综合打分'}`, startX, cardY);

  const bodyY = cardY + 18;
  // 宣纸质感底框
  doc.roundedRect(startX, bodyY, pageWidth, cardBodyH, 4).fill('#FAF7F2');
  doc.roundedRect(startX, bodyY, pageWidth, cardBodyH, 4).strokeColor('#E2DACD').lineWidth(0.8).stroke();
  doc.roundedRect(startX, bodyY, 3.5, cardBodyH, 1).fill('#8B5A42'); // 典雅茶墨左指示条

  // -------------------------------------------------------------
  // 2. 绘制 PDFKit 矢量茶墨风环形饼图 (Donut Chart)
  // -------------------------------------------------------------
  const donutCX = startX + 56;
  const donutCY = bodyY + 42;
  const outerR = 30;
  const innerR = 19;

  const p1 = Math.min(1, score1 / max1);
  const p2 = Math.min(1, score2 / max2);
  const p3 = Math.min(1, score3 / max3);

  const angle1 = (max1 / 100) * 360 * p1;
  const angle2 = (max2 / 100) * 360 * p2;
  const angle3 = (max3 / 100) * 360 * p3;

  const startA1 = -90;
  const endA1 = startA1 + Math.max(2, angle1 - 2);
  const startA2 = startA1 + (max1 / 100) * 360;
  const endA2 = startA2 + Math.max(2, angle2 - 2);
  const startA3 = startA2 + (max2 / 100) * 360;
  const endA3 = startA3 + Math.max(2, angle3 - 2);

  // 辅助画扇区函数
  const drawPieSector = (cx, cy, r, sDeg, eDeg, color) => {
    const sRad = (sDeg * Math.PI) / 180;
    const eRad = (eDeg * Math.PI) / 180;
    const x1 = cx + r * Math.cos(sRad);
    const y1 = cy + r * Math.sin(sRad);
    doc.save();
    doc.fillColor(color);
    doc.moveTo(cx, cy);
    doc.lineTo(x1, y1);
    doc.arc(cx, cy, r, sDeg, eDeg);
    doc.lineTo(cx, cy);
    doc.fill();
    doc.restore();
  };

  // 绘制 3 个维度的古风扇区 (熟褐 / 朱砂 / 黛绿)
  drawPieSector(donutCX, donutCY, outerR, startA1, endA1, '#8B5A42');
  drawPieSector(donutCX, donutCY, outerR, startA2, endA2, '#A6382B');
  drawPieSector(donutCX, donutCY, outerR, startA3, endA3, '#4F6F52');

  // 绘制中心遮罩圆，形成 Donut 环形
  doc.save();
  doc.circle(donutCX, donutCY, innerR).fill('#FAF7F2');
  doc.restore();

  // 中心综合得分数字
  doc.fontSize(12).fillColor('#3D3B37').text(`${totalScore}`, donutCX - 15, donutCY - 9, { width: 30, align: 'center' });
  doc.fontSize(6.5).fillColor('#8B5A42').text('综合得分', donutCX - 18, donutCY + 4, { width: 36, align: 'center' });

  // -------------------------------------------------------------
  // 3. 饼图右侧维度图例明细
  // -------------------------------------------------------------
  const legendX = startX + 104;
  let legendY = bodyY + 14;

  const drawLegendItem = (color, label, scoreVal, maxVal, yPos) => {
    doc.save();
    doc.circle(legendX + 4, yPos + 4, 3.5).fill(color);
    doc.restore();
    doc.fontSize(9).fillColor('#3D3B37').text(label, legendX + 13, yPos, { lineBreak: false });
    doc.fontSize(9.5).fillColor(color).text(`${scoreVal} / ${maxVal}`, legendX + 260, yPos, { width: 60, align: 'right' });
  };

  drawLegendItem('#8B5A42', '听课专注与互动 (30分)', score1, max1, legendY);
  drawLegendItem('#A6382B', '核心考点理解力 (40分)', score2, max2, legendY + 20);
  drawLegendItem('#4F6F52', '当堂练习与完成度 (30分)', score3, max3, legendY + 40);

  // 分隔虚线
  doc.strokeColor('#EAE4D7').lineWidth(0.6).dash(3, { space: 3 }).moveTo(startX + 14, bodyY + chartAreaH).lineTo(startX + pageWidth - 14, bodyY + chartAreaH).stroke();
  doc.undash();

  // -------------------------------------------------------------
  // 4. 详细评语明细
  // -------------------------------------------------------------
  let curY = bodyY + chartAreaH + 10;
  for (const l of cleanLines) {
    const clean = cleanMarkdownSymbols(l);
    if (clean.includes('综合得分') || clean.includes('总分')) continue;
    renderParagraphWithColonBold(doc, l, startX + 14, curY, pageWidth - 28, 8.8, '#3D3B37', false);
    const h = doc.heightOfString(clean, { width: pageWidth - 28, lineGap: 3 });
    curY += h + 5;
  }

  doc.y = bodyY + cardBodyH + 18;
}

/**
 * 下节课程预告卡片渲染器
 */
function renderPreviewCardAST(doc, startX, pageWidth, sec, checkPageOverflow) {
  const { title, lines } = sec;
  const cleanLines = lines.filter(l => cleanMarkdownSymbols(l).length > 0);

  doc.fontSize(9);
  let bodyH = 0;
  for (const l of cleanLines) {
    const clean = cleanMarkdownSymbols(l);
    const h = doc.heightOfString(clean, { width: pageWidth - 32, lineGap: 3 });
    bodyH += h + 6;
  }
  const cardHeight = Math.max(45, bodyH + 34);
  checkPageOverflow(cardHeight);

  const cardY = doc.y;
  doc.fontSize(12).fillColor('#3D3B37');
  doc.text(`❖  ${title || '下节课程预告'}`, startX, cardY);

  const bodyY = cardY + 18;
  doc.roundedRect(startX, bodyY, pageWidth, bodyH + 16, 4).fill('#FAF7F2');
  doc.roundedRect(startX, bodyY, pageWidth, bodyH + 16, 4).strokeColor('#E2DACD').lineWidth(0.8).stroke();
  doc.roundedRect(startX, bodyY, 3.5, bodyH + 16, 1).fill('#3D3B37');

  let curY = bodyY + 10;
  for (const l of cleanLines) {
    const clean = cleanMarkdownSymbols(l);
    renderParagraphWithColonBold(doc, l, startX + 14, curY, pageWidth - 28, 9, '#3D3B37', false);
    const h = doc.heightOfString(clean, { width: pageWidth - 28, lineGap: 3 });
    curY += h + 6;
  }

  doc.y = bodyY + bodyH + 26;
}
