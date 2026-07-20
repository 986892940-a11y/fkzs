# 避坑与开发规则指南 (Pitfalls & Rules Guide)

此文件为本项目开发过程中的“避坑规则库”，旨在记录开发、测试、部署阶段遇到的问题与错误，并归纳为硬性规则，供后续任务执行时前置核对，防止重复发生同类错误。

> [!IMPORTANT]
> **维护规范**：
> 1. 每当在编码、测试、调试中遇到非预期报错、环境冲突、路径错误或逻辑缺陷时，必须立即在此记录。
> 2. 每次总控角色拆解任务、或任何角色开始编写代码前，必须阅读此文件以作防范。

---

## 🛑 通用避坑规则 (General Rules)

### macOS Sonoma/Ventura 语音备忘录群组共享目录变更 - 2026-07-20
- **现象描述**：在升级 macOS Sonoma/Ventura 后，读取原本的 Catalyst 容器 `~/Library/Containers/com.apple.VoiceMemos` 无法获取到最新的录音文件。
- **根本原因**：Apple 在新版 macOS 中将音频文件以及 SQLite 数据库迁移到了 Group Containers 共享组目录 (`~/Library/Group Containers/group.com.apple.VoiceMemos.shared/Recordings`)。
- **防范规则**：扫描服务必须依次尝试扫描 Group Containers 共享路径与 Catalyst 经典路径，并在前端保留支持直接拖拽音频文件的机制。

## 🎨 UI 与前端踩坑记录 (Frontend & UI Pitfalls)

### 纯 AI 文生图模型渲染复杂中文伪汉字乱码 - 2026-07-20
- **现象描述**：直接使用文生图模型（如 Imagen / Nano Banana）在像素层绘制包含长段中文的图表时，图片上的汉字会出现笔画随机拼接的“伪汉字/乱码”（AI 乱写错字）。
- **根本原因**：这是所有纯 Diffusion / Flow-matching 扩散文生图模型在文字渲染（Text Rendering）上的底层物理限制。模型无法在像素级别保证复杂汉字笔画的 100% 准确性。
- **解决方案与防范规则**：
  1. **禁止**在像素层直接靠 Prompt 强制文生图大模型画长段中文汉字。
  2. 采用**AI 智能意图提炼 + 动态矢量美学卡片合成技术（SVG Vector Overlay Architecture）**：
     - 先由 Gemini 3.5 Flash 从课后反馈中精确提炼结构化中文知识点 JSON。
     - 再由 Imagen 生成无文字的艺术背景图。
     - 最后通过 Node.js 矢量引擎 (`Resvg`) 将背景图与系统自带的**高清晰中文矢量字体（苹方 PingFang SC、黑体等）**动态合成 1000x1000 高高清 PNG 图。
  3. **效果**：汉字 100% 字字精准、绝无错字乱码，同时保留国风/科技等大师级艺术美感。

## ⚙️ 后端与 API 踩坑记录 (Backend & API Pitfalls)

### PDFKit 中文字体渲染乱码 - 2026-07-20
- **现象描述**：使用 PDFKit 默认字体生成 PDF 时，生成的中文内容表现为方块乱码或空白。
- **根本原因**：PDFKit 默认集成的 Helvetica/Times 标准字体不包含中文字形集。
- **防范规则**：在 macOS 环境下必须通过 `doc.font('/System/Library/Fonts/STHeiti Light.ttc')` 显示加载系统自带的中文字体，确保中文段落与排版完美渲染。

---

## 📝 记录模板
新踩坑点请按以下格式添加至对应分类下：
```markdown
### [问题简述] - 记录时间: YYYY-MM-DD
- **现象描述**：描述具体报错信息或异常表现行为。
- **根本原因**：分析导致此问题的底层逻辑或环境因素。
- **防范规则**：制定具体的编码/配置硬性规则，后续如何避免。
```
