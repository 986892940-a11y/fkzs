import PDFDocument from 'pdfkit';
import fs from 'fs';

// macOS 系统内置中文字体（涵盖完整中文字符集）
const CHINESE_FONT_PATH = '/System/Library/Fonts/Supplemental/Arial Unicode.ttf';

/**
 * 见辰境 · 2.0 重构版 PDF 生成引擎 (雅致新中式学术 UI 2.0)
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
      const PAGE_MAX_Y = 720; // 优化后的安全溢出线

      // 分页校验器
      const checkPageOverflow = (needHeight) => {
        if (doc.y + needHeight > PAGE_MAX_Y) {
          doc.addPage();
          doc.y = 46;
        }
      };

      // -------------------------------------------------------------
      // 1. 渲染顶部 Header 品牌标头 (卡片 2.0)
      // -------------------------------------------------------------
      const topTitleY = 46;
      const topTitleHeight = 62;
      
      // 双重质感边框卡片
      doc.roundedRect(startX, topTitleY, pageWidth, topTitleHeight, 6).fill('#FAF8F3');
      doc.roundedRect(startX, topTitleY, pageWidth, topTitleHeight, 6).strokeColor('#E7E0D3').lineWidth(1).stroke();
      doc.roundedRect(startX + 3, topTitleY + 3, pageWidth - 6, topTitleHeight - 6, 4).strokeColor('#F0EAE0').lineWidth(0.5).stroke();

      // 品牌标题
      const mainHeading = pdfBrandTitle && pdfBrandTitle.trim() ? pdfBrandTitle.trim() : '语文课后学习反馈';
      doc.fontSize(15).fillColor('#1B4931').text(mainHeading, startX + 16, topTitleY + 12);
      
      // 学员信息徽章与生成时间
      const dateStr = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
      const gradeStr = studentGrade ? ` (${studentGrade})` : '';
      const nameText = `学员：${studentName || '未指定'}${gradeStr}`;

      const badgeWidth = Math.min(220, nameText.length * 10 + 20);
      doc.roundedRect(startX + 16, topTitleY + 34, badgeWidth, 18, 4).fill('#EDF4EF');
      doc.roundedRect(startX + 16, topTitleY + 34, badgeWidth, 18, 4).strokeColor('#C2D6C6').lineWidth(0.8).stroke();
      doc.fontSize(8.5).fillColor('#1B4931').text(nameText, startX + 22, topTitleY + 38);
      
      doc.fontSize(8.5).fillColor('#64748B').text(`生成时间：${dateStr}`, startX + 350, topTitleY + 38, { align: 'right', width: 160 });

      doc.y = topTitleY + topTitleHeight + 12;

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

      // 3. 渲染“课堂记录”极简提示卡
      const recordText = recordLines.join('\n').trim();
      if (recordText) {
        checkPageOverflow(46);
        const cardY = doc.y;
        doc.roundedRect(startX, cardY, pageWidth, 42, 5).fill('#F0F4F1');
        doc.roundedRect(startX, cardY, 4, 42, 2).fill('#1B4931'); // 左侧深绿竖条
        renderParagraphWithColonBold(doc, recordText, startX + 14, cardY + 10, pageWidth - 28, 9, '#334155', false);
        doc.y = cardY + 50;
      }

      // -------------------------------------------------------------
      // 4. 渲染知识海报 (自适应比例画框)
      // -------------------------------------------------------------
      const imgBuffersToRender = parseImageBuffersList(imageBuffer, imagesBase64);
      if (imgBuffersToRender.length > 0) {
        for (let i = 0; i < imgBuffersToRender.length; i++) {
          const imgBuf = imgBuffersToRender[i];
          if (!imgBuf) continue;
          try {
            const imgWidth = 450;
            const imgHeight = 220; // 优化后的适应性高度
            checkPageOverflow(imgHeight + 32);

            const badgeY = doc.y;
            // 墨绿印章风格小徽章
            doc.roundedRect(startX, badgeY, 180, 18, 4).fill('#1B4931');
            const label = imgBuffersToRender.length > 1 ? `❖ 本节课知识图谱 (${i + 1})` : '❖ 本节课知识图谱';
            doc.fontSize(8.5).fillColor('#FFFFFF').text(label, startX + 10, badgeY + 4);
            doc.y = badgeY + 24;

            const imgY = doc.y;
            const imgX = startX + (pageWidth - imgWidth) / 2;
            
            // 装裱质感外框
            doc.roundedRect(imgX - 5, imgY - 5, imgWidth + 10, imgHeight + 10, 6).fill('#FAF8F3');
            doc.roundedRect(imgX - 5, imgY - 5, imgWidth + 10, imgHeight + 10, 6).strokeColor('#E7E0D3').lineWidth(1).stroke();
            doc.image(imgBuf, imgX, imgY, { width: imgWidth, height: imgHeight });
            
            doc.y = imgY + imgHeight + 16;
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
        // 判断是否为学员掌握情况，若是则采用【左右双列并排卡片】渲染
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
        doc.page.margins.bottom = 0; // 避免绝对定位触发隐式分页

        // 页眉 Slogan
        doc.fontSize(8).fillColor('#64748B').text(headerSlogan, startX, 22, {
          width: pageWidth,
          align: 'center',
          lineBreak: false
        });
        doc.strokeColor('#E2E8F0').lineWidth(0.5).moveTo(startX, 32).lineTo(startX + pageWidth, 32).stroke();

        // 页脚页码
        const pageText = `第 ${i + 1} 页 / 共 ${pages.count} 页`;
        doc.fontSize(8).fillColor('#94A3B8').text(pageText, startX, 812, {
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
 * 渲染标准宣纸风主卡片组件
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

  // 1. 预计算内容真实高度
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

  // 2. 绘制卡片背景与边框
  const cardY = doc.y;
  doc.roundedRect(startX, cardY, pageWidth, cardHeight, 6).fill('#FAF8F3');
  doc.roundedRect(startX, cardY, pageWidth, cardHeight, 6).strokeColor('#E7E0D3').lineWidth(0.8).stroke();

  let currentY = cardY + 10;
  if (title) {
    doc.fontSize(12).fillColor('#1E293B');
    const titleText = `❖  ${title}`;
    const tH = doc.heightOfString(titleText, { width: pageWidth - 32, lineGap: 4 });
    doc.text(titleText, startX + 16, currentY, { width: pageWidth - 32, lineGap: 4 });
    currentY += tH + 6;
  }

  // 3. 逐行填充渲染内容
  for (const l of lines) {
    const clean = cleanMarkdownSymbols(l);
    if (!clean) continue;

    if (l.startsWith('>')) {
      // 引用金句竹简框
      const quoteText = clean.replace(/^>\s*/, '');
      doc.fontSize(9);
      const textInQuoteH = doc.heightOfString(`“ ${quoteText} ”`, { width: pageWidth - 48, lineGap: 3 });
      const quoteBoxH = Math.max(24, textInQuoteH + 8);

      doc.roundedRect(startX + 14, currentY, pageWidth - 28, quoteBoxH, 4).fill('#F0F4F1');
      doc.roundedRect(startX + 14, currentY, 3, quoteBoxH, 1).fill('#1B4931');
      doc.fillColor('#1B4931').text(`“ ${quoteText} ”`, startX + 24, currentY + 4, { width: pageWidth - 48, lineGap: 3 });
      currentY += quoteBoxH + 6;
    } else if (isSubHeaderLine(l)) {
      // 赭石色子标题
      doc.fontSize(10.5);
      const subH = doc.heightOfString(clean, { width: pageWidth - 32, lineGap: 3 });
      doc.fillColor('#8C2D19').text(clean, startX + 16, currentY, { width: pageWidth - 32, lineGap: 3 });
      doc.fillColor('#334155');
      currentY += subH + 5;
    } else {
      // 正文/列表行
      const isListItem = clean.startsWith('-') || /^[一二三四五六七八九十\d]+[\.\、\s]/.test(clean);
      const drawWidth = (!isListItem) ? pageWidth - 46 : pageWidth - 32;
      const textH = doc.heightOfString(clean, { width: drawWidth, lineGap: 3 });
      renderParagraphWithColonBold(doc, l, startX + 16, currentY, pageWidth - 32, 9, '#334155', true);
      currentY += textH + 5;
    }
  }

  doc.y = cardY + cardHeight + 10;
}

/**
 * 智能双列分栏渲染器（专门用于“学员掌握情况与建议”）
 */
function renderDualColumnMasteryCard(doc, startX, pageWidth, sec, checkPageOverflow) {
  const { title, lines } = sec;
  const colWidth = (pageWidth - 12) / 2; // 双列宽度

  // 1. 将文本行拆分为“优点表现”与“薄弱提升”两组
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

  // 2. 预估双列高度
  doc.fontSize(8.5);
  const getLinesHeight = (arr) => {
    let h = 0;
    for (const line of arr) {
      const clean = cleanMarkdownSymbols(line);
      if (clean) h += doc.heightOfString(clean, { width: colWidth - 20, lineGap: 3 }) + 5;
    }
    return h;
  };

  const leftH = getLinesHeight(leftLines);
  const rightH = getLinesHeight(rightLines);
  const bodyH = Math.max(leftH, rightH, 42);
  const cardHeight = bodyH + 34;

  checkPageOverflow(cardHeight);

  const cardY = doc.y;

  // 渲染大模块标题
  if (title) {
    doc.fontSize(12).fillColor('#1E293B');
    doc.text(`❖  ${title}`, startX, cardY);
  }

  const columnsY = title ? cardY + 20 : cardY;

  // 3. 绘制左列（课堂表现与优势 - 墨绿顶边）
  doc.roundedRect(startX, columnsY, colWidth, bodyH + 12, 5).fill('#FAF8F3');
  doc.roundedRect(startX, columnsY, colWidth, bodyH + 12, 5).strokeColor('#E7E0D3').lineWidth(0.8).stroke();
  doc.roundedRect(startX, columnsY, colWidth, 3, 1).fill('#1B4931'); // 绿顶条

  doc.fontSize(9.5).fillColor('#1B4931').text('🟢 课堂优势与反应', startX + 10, columnsY + 8);
  let curLeftY = columnsY + 24;
  for (const l of leftLines) {
    const clean = cleanMarkdownSymbols(l);
    if (!clean) continue;
    const h = doc.heightOfString(clean, { width: colWidth - 20, lineGap: 3 });
    renderParagraphWithColonBold(doc, l, startX + 10, curLeftY, colWidth - 20, 8.5, '#334155', false);
    curLeftY += h + 5;
  }

  // 4. 绘制右列（课后巩固与建议 - 赭红顶边）
  const rightX = startX + colWidth + 12;
  doc.roundedRect(rightX, columnsY, colWidth, bodyH + 12, 5).fill('#FAF8F3');
  doc.roundedRect(rightX, columnsY, colWidth, bodyH + 12, 5).strokeColor('#E7E0D3').lineWidth(0.8).stroke();
  doc.roundedRect(rightX, columnsY, colWidth, 3, 1).fill('#8C2D19'); // 赭红顶条

  doc.fontSize(9.5).fillColor('#8C2D19').text('🎯 课后巩固与建议', rightX + 10, columnsY + 8);
  let curRightY = columnsY + 24;
  for (const l of rightLines) {
    const clean = cleanMarkdownSymbols(l);
    if (!clean) continue;
    const h = doc.heightOfString(clean, { width: colWidth - 20, lineGap: 3 });
    renderParagraphWithColonBold(doc, l, rightX + 10, curRightY, colWidth - 20, 8.5, '#334155', false);
    curRightY += h + 5;
  }

  doc.y = columnsY + bodyH + 24;
}

/**
 * 冒号前缀加粗段落渲染器
 */
function renderParagraphWithColonBold(doc, text, x, y, width, fontSize = 9, defaultColor = '#334155', needIndent = true) {
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
