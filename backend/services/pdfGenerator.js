import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

// macOS 系统内置中文字体路径
const CHINESE_FONT_PATH = '/System/Library/Fonts/Supplemental/Arial Unicode.ttf';

/**
 * 优雅美学 PDF 生成引擎（支持圆角色块卡片、高亮 Badge 标签与大图排版）
 * @param {Object} params
 * @param {string} params.studentName 学生姓名
 * @param {string} params.feedbackText 反馈纯文本
 * @param {Buffer|string} params.imageBuffer 知识点图片 Buffer 或 Base64
 * @returns {Promise<Buffer>}
 */
export function generateFeedbackPDF({ studentName, feedbackText, imageBuffer }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 35, bottom: 40, left: 40, right: 40 }
      });

      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err) => reject(err));

      // 加载系统标准中文字体
      if (fs.existsSync(CHINESE_FONT_PATH)) {
        doc.font(CHINESE_FONT_PATH);
      } else {
        console.warn('[PDF] 未找到 Arial Unicode.ttf');
      }

      const pageWidth = 515; // 595.28 - 80 边距
      const startX = 40;

      // -------------------------------------------------------------
      // 1. 顶部 Header 优雅深色卡片
      // -------------------------------------------------------------
      const headerY = 35;
      const headerHeight = 75;
      
      // 绘制顶部靛紫渐变感实心卡片框
      doc.roundedRect(startX, headerY, pageWidth, headerHeight, 10).fill('#312e81');

      // 主标题
      doc.fontSize(20).fillColor('#ffffff').text('语文课后学习反馈', startX + 20, headerY + 16);
      
      // 日期与学生姓名高亮 Badge 标签
      const dateStr = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
      
      // 绘制学生姓名白底圆角 Badge
      const nameText = `学员：${studentName || '未指定'}`;
      doc.roundedRect(startX + 20, headerY + 44, 110, 20, 4).fill('#ffffff');
      doc.fontSize(10).fillColor('#312e81').text(nameText, startX + 30, headerY + 49);

      // 日期文案
      doc.fontSize(10).fillColor('#c7d2fe').text(`生成日期：${dateStr}`, startX + 380, headerY + 49, { align: 'right' });

      doc.y = headerY + headerHeight + 20;

      // -------------------------------------------------------------
      // 2. 解析文本与模块划分
      // -------------------------------------------------------------
      const lines = feedbackText.split('\n');
      const recordLines = [];
      const remainingLines = [];
      let foundReview = false;

      for (const line of lines) {
        if (line.includes('课堂回顾：') || foundReview) {
          foundReview = true;
          remainingLines.push(line);
        } else {
          recordLines.push(line);
        }
      }

      // -------------------------------------------------------------
      // 3. 渲染“课堂记录”独立色块卡片
      // -------------------------------------------------------------
      const recordText = recordLines.join('\n').trim();
      if (recordText) {
        checkPageOverflow(doc, 60);
        const cardY = doc.y;
        
        // 绘制浅灰蓝卡片背景框
        doc.roundedRect(startX, cardY, pageWidth, 52, 6).fill('#f1f5f9');
        // 绘制 4px 深紫高亮左边框
        doc.roundedRect(startX, cardY, 5, 52, 2).fill('#4338ca');

        doc.fontSize(10).fillColor('#475569').text(recordText, startX + 18, cardY + 12, { width: pageWidth - 36, lineGap: 3 });
        doc.y = cardY + 68;
      }

      // -------------------------------------------------------------
      // 4. 插入“知识点总结大图” (位于课堂记录之后，课堂回顾之前)
      // -------------------------------------------------------------
      if (imageBuffer) {
        try {
          let cleanBuffer = imageBuffer;
          if (typeof imageBuffer === 'string') {
            const pureBase64 = imageBuffer.replace(/^data:image\/\w+;base64,/, '');
            cleanBuffer = Buffer.from(pureBase64, 'base64');
          }

          if (Buffer.isBuffer(cleanBuffer) && cleanBuffer.length > 0) {
            checkPageOverflow(doc, 460);

            // 模块高亮 Badge 标题
            const badgeY = doc.y;
            doc.roundedRect(startX, badgeY, 190, 24, 5).fill('#4338ca');
            doc.fontSize(11).fillColor('#ffffff').text('★ 本课核心知识总结卡', startX + 12, badgeY + 6);
            doc.y = badgeY + 34;

            // 图片卡片外框
            const imgY = doc.y;
            const imgWidth = 430;
            const imgHeight = 430;
            const imgX = startX + (pageWidth - imgWidth) / 2;

            // 绘制卡片衬底与浅阴影边框
            doc.roundedRect(imgX - 8, imgY - 8, imgWidth + 16, imgHeight + 16, 12).fill('#fafafa');
            doc.roundedRect(imgX - 8, imgY - 8, imgWidth + 16, imgHeight + 16, 12).strokeColor('#e2e8f0').lineWidth(1).stroke();

            // 绘制高清大图
            doc.image(cleanBuffer, imgX, imgY, { width: imgWidth, height: imgHeight });
            
            doc.y = imgY + imgHeight + 30;
          }
        } catch (imgErr) {
          console.warn('[PDF] 嵌入图片跳过:', imgErr.message);
        }
      }

      // -------------------------------------------------------------
      // 5. 渲染“课堂回顾与授课模块”（色块卡片与多维高亮）
      // -------------------------------------------------------------
      let currentSectionText = [];
      let currentSectionTitle = '';

      for (let i = 0; i < remainingLines.length; i++) {
        const line = remainingLines[i].trim();
        if (!line) continue;

        // 判断是否为新模块的标题 (如：课堂回顾：、1. 散文/小说模块、日积月累：、作业：等)
        const isHeader = line.endsWith('：') || 
                         line.startsWith('1.') || 
                         line.startsWith('2.') || 
                         line.startsWith('3.') || 
                         line.startsWith('4.') ||
                         line.startsWith('课堂回顾') ||
                         line.startsWith('授课内容') ||
                         line.startsWith('日积月累') ||
                         line.startsWith('作业') ||
                         line.startsWith('考试情况');

        if (isHeader) {
          // 先渲染前一个搜集到的模块卡片
          if (currentSectionTitle || currentSectionText.length > 0) {
            renderModuleCard(doc, startX, pageWidth, currentSectionTitle, currentSectionText);
            currentSectionText = [];
          }
          currentSectionTitle = line;
        } else {
          currentSectionText.push(line);
        }
      }

      // 渲染最后一个模块
      if (currentSectionTitle || currentSectionText.length > 0) {
        renderModuleCard(doc, startX, pageWidth, currentSectionTitle, currentSectionText);
      }

      doc.end();

    } catch (err) {
      console.error('[PDF Generator] 抛出异常:', err);
      reject(err);
    }
  });
}

/**
 * 辅助函数：绘制一个优雅的模块色块卡片框
 */
function renderModuleCard(doc, startX, pageWidth, title, textLines) {
  const textContent = textLines.join('\n').trim();
  const estimatedHeight = Math.max(65, textLines.length * 18 + 45);

  checkPageOverflow(doc, estimatedHeight + 20);

  const cardY = doc.y;

  // 区分不同模块的卡片背景与主题配色
  let cardBg = '#f8fafc';
  let badgeBg = '#4f46e5';
  let borderColor = '#e2e8f0';

  if (title.includes('作业')) {
    cardBg = '#eff6ff';
    badgeBg = '#2563eb';
    borderColor = '#bfdbfe';
  } else if (title.includes('日积月累')) {
    cardBg = '#f0fdf4';
    badgeBg = '#16a34a';
    borderColor = '#bbf7d0';
  } else if (title.includes('课堂回顾')) {
    cardBg = '#faf5ff';
    badgeBg = '#7c3aed';
    borderColor = '#e9d5ff';
  }

  // 1. 绘制整体卡片圆角背景框
  doc.roundedRect(startX, cardY, pageWidth, estimatedHeight, 10).fill(cardBg);
  doc.roundedRect(startX, cardY, pageWidth, estimatedHeight, 10).strokeColor(borderColor).lineWidth(1).stroke();

  // 2. 绘制模块标题高亮实心圆角 Badge 标签
  if (title) {
    const titleWidth = Math.min(pageWidth - 40, title.length * 13 + 24);
    doc.roundedRect(startX + 12, cardY + 10, titleWidth, 24, 5).fill(badgeBg);
    doc.fontSize(10.5).fillColor('#ffffff').text(title, startX + 22, cardY + 16);
  }

  // 3. 渲染正文内容
  if (textContent) {
    doc.fontSize(10).fillColor('#334155').text(textContent, startX + 18, cardY + 42, {
      width: pageWidth - 36,
      lineGap: 4
    });
  }

  // 更新 Y 轴偏移
  doc.y = cardY + estimatedHeight + 15;
}

/**
 * 辅助函数：检测页面剩余高度，如不够则换页
 */
function checkPageOverflow(doc, needHeight) {
  if (doc.y + needHeight > 780) {
    doc.addPage();
    doc.y = 40;
  }
}
