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
      const PAGE_MAX_Y = 720; // 优化后的安全溢出高度

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
          drawPaperBackground(); // 新页面同样填充茶墨竹纸底色
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
            const imgHeight = 210; // 智能锁定高度，防止死板超长
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
        // 动态识别：如果是“学员掌握情况”，自动切分为【左右并排双卡片】
        if (sec.title && sec.title.includes('学员掌握情况')) {
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

  // 如果该模块包含多个子标题 (如考点、题目、建议)，拆分为独立子卡片绘制
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

function renderSingleSubCard(doc, startX, pageWidth, title, lines, checkPageOverflow) {
  doc.fontSize(9.5);
  let contentHeight = 0;

  // 预测高度
  for (const l of lines) {
    const clean = cleanMarkdownSymbols(l);
    if (!clean) continue;

    if (l.startsWith('>')) {
      const quoteText = clean.replace(/^>\s*/, '');
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
      // 引用金句竹简框
      const quoteText = clean.replace(/^>\s*/, '');
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
  let currentGroup = leftLines;

  for (const l of lines) {
    const clean = cleanMarkdownSymbols(l);
    if (!clean) continue;

    if (clean.includes('建议') || clean.includes('薄弱') || clean.includes('巩固') || clean.includes('提升') || clean.includes('去口语化')) {
      currentGroup = rightLines;
    }
    currentGroup.push(l);
  }

  if (leftLines.length > 0 && rightLines.length === 0 && leftLines.length >= 2) {
    const mid = Math.ceil(leftLines.length / 2);
    rightLines.push(...leftLines.splice(mid));
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

  doc.fillColor(defaultColor).text(cleanText, drawX, y, {
    width: drawWidth,
    lineGap: 3
  });
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
  return /^\d+\.\s+/.test(clean) ||
         /^【.*?】/.test(clean) ||
         /^考点[一二三四五六七八九十\d]+/.test(clean) ||
         /^[一二三四五六七八九十]+[\.\、\s]/.test(clean);
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
      line.startsWith('授课内容') ||
      line.startsWith('典型例题') ||
      line.startsWith('考点拆解') ||
      line.startsWith('学员掌握情况') ||
      line.startsWith('掌握情况') ||
      line.startsWith('课后作业') ||
      line.startsWith('作业') ||
      line.startsWith('核心金句') ||
      line.startsWith('名言积累')
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
  if (imageBuffer && Buffer.isBuffer(imageBuffer)) {
    list.push(imageBuffer);
  }
  if (Array.isArray(imagesBase64)) {
    for (const b64 of imagesBase64) {
      if (b64) {
        const cleanB64 = b64.replace(/^data:image\/\w+;base64,/, '');
        list.push(Buffer.from(cleanB64, 'base64'));
      }
    }
  }
  return list;
}
