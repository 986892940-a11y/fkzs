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

### 从 WPS 纯文本升级为 Markdown 语文学科典雅 PDF 美学 (已锁定规范) - 2026-07-22
- **排版规范文档**：已建立 [pdf_design_specifications.md](file:///Users/ziwelz/.gemini/antigravity/brain/c42b1a52-b8d7-4390-8ee0-386b32c652c2/pdf_design_specifications.md) 详细记录全套规则。
- **锁定要求**：格式相关代码已全部锁定，切勿擅自修改。
- **核心要点**：
  1. 考点标题（考点一、考点二...）全量稳定呈现为高雅深红加粗 (`#8c2d19`)。
  2. 冒号前面的短词采用重墨描边 (`fillAndStroke`) 展现显赫黑体加粗。
  3. 下级标题（`一、`、`二、`）左对齐不缩进；普通段落首行缩进 2 格。
  4. 彻底物理移除了底部的页脚代码，每页顶部保留居中页眉 `尘埃落定 · 始见星辰`。

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
