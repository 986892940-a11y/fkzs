import React, { useState, useEffect, useRef } from 'react';
import './App.css';

const API_BASE = 'http://127.0.0.1:5001/api';

const DEFAULT_QUICK_THEMES = [
  '疯狂动物城',
  '宋代山水画意境',
  '敦煌壁画风格',
  '3D玻璃科技脑图',
  '黑神话悟空',
  '水彩清爽插画'
];

export default function App() {
  // 学生与业务输入
  const [studentName, setStudentName] = useState('');
  const [studentGrade, setStudentGrade] = useState(() => localStorage.getItem('default_student_grade') || '高一');
  const [customThemePrompt, setCustomThemePrompt] = useState('宋代山水画意境');
  const [transcriptText, setTranscriptText] = useState('');

  // 1. 设置偏好与选项卡
  const [activeSettingsTab, setActiveSettingsTab] = useState('visual');
  const [themeMode, setThemeMode] = useState(() => localStorage.getItem('app_theme') || 'light');
  const [feedbackTone, setFeedbackTone] = useState(() => localStorage.getItem('feedback_tone') || '严谨鼓励');
  const [pdfBrandTitle, setPdfBrandTitle] = useState(() => localStorage.getItem('pdf_brand_title') || '');
  const [pdfHeaderTitle, setPdfHeaderTitle] = useState(() => localStorage.getItem('pdf_header_title') || '尘埃落定 · 始见星辰');
  const [posterMode, setPosterMode] = useState(() => localStorage.getItem('poster_mode') || 'single'); // single, multi, none
  const [audioInsertMode, setAudioInsertMode] = useState(() => localStorage.getItem('audio_insert_mode') || 'replace'); // replace, append
  const [autoFetchMemos, setAutoFetchMemos] = useState(() => localStorage.getItem('auto_fetch_memos') !== 'false');
  const [customApiKey, setCustomApiKey] = useState(() => localStorage.getItem('gemini_api_key') || '');
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  // 常用主题词库 (支持点选、添加、删除、排序)
  const [quickThemes, setQuickThemes] = useState(() => {
    try {
      const saved = localStorage.getItem('custom_quick_themes');
      return saved ? JSON.parse(saved) : DEFAULT_QUICK_THEMES;
    } catch (e) {
      return DEFAULT_QUICK_THEMES;
    }
  });
  const [newThemeInput, setNewThemeInput] = useState('');

  // 拖拽文件 overlay 状态
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  // 语音备忘录及本地音频
  const [voiceMemos, setVoiceMemos] = useState([]);
  const [selectedMemo, setSelectedMemo] = useState(null);
  const [recordingStatusNotice, setRecordingStatusNotice] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const fileInputRef = useRef(null);
  
  // 输出与 UI 状态
  const [loading, setLoading] = useState(false);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [generatedFeedback, setGeneratedFeedback] = useState('');
  const [knowledgeImageBase64, setKnowledgeImageBase64] = useState('');
  const [knowledgeImagesBase64, setKnowledgeImagesBase64] = useState([]);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  // 应用主题模式
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', themeMode);
    localStorage.setItem('app_theme', themeMode);
  }, [themeMode]);

  useEffect(() => {
    if (autoFetchMemos) {
      fetchVoiceMemos();
    }
  }, [autoFetchMemos]);

  const fetchVoiceMemos = async () => {
    try {
      const res = await fetch(`${API_BASE}/voice-memos`);
      const result = await res.json();
      if (result.success && Array.isArray(result.data)) {
        setVoiceMemos(result.data);
      }
    } catch (err) {
      console.warn('[App] 刷新备忘录列表提示:', err.message);
    }
  };

  // 保存设置中心配置
  const handleSaveSettings = (e) => {
    if (e) e.preventDefault();
    localStorage.setItem('app_theme', themeMode);
    localStorage.setItem('feedback_tone', feedbackTone);
    localStorage.setItem('pdf_brand_title', pdfBrandTitle.trim());
    localStorage.setItem('pdf_header_title', pdfHeaderTitle.trim() || '尘埃落定 · 始见星辰');
    localStorage.setItem('poster_mode', posterMode);
    localStorage.setItem('audio_insert_mode', audioInsertMode);
    localStorage.setItem('auto_fetch_memos', autoFetchMemos ? 'true' : 'false');
    localStorage.setItem('default_student_grade', studentGrade);
    localStorage.setItem('custom_quick_themes', JSON.stringify(quickThemes));

    if (customApiKey.trim()) {
      localStorage.setItem('gemini_api_key', customApiKey.trim());
    } else {
      localStorage.removeItem('gemini_api_key');
    }
    setShowSettingsModal(false);
  };

  // 重置恢复默认设置
  const handleResetSettings = () => {
    if (window.confirm('确认恢复所有偏好设置至初始默认状态？')) {
      setThemeMode('light');
      setFeedbackTone('严谨鼓励');
      setPdfBrandTitle('');
      setPdfHeaderTitle('尘埃落定 · 始见星辰');
      setPosterMode('single');
      setAudioInsertMode('replace');
      setAutoFetchMemos(true);
      setCustomApiKey('');
      setQuickThemes(DEFAULT_QUICK_THEMES);
      localStorage.clear();
      setShowSettingsModal(false);
    }
  };

  // 添加主题词到词库
  const handleAddThemeTag = (e) => {
    if (e) e.preventDefault();
    if (newThemeInput && newThemeInput.trim()) {
      const trimmed = newThemeInput.trim();
      if (!quickThemes.includes(trimmed)) {
        const updated = [...quickThemes, trimmed];
        setQuickThemes(updated);
        localStorage.setItem('custom_quick_themes', JSON.stringify(updated));
        setCustomThemePrompt(trimmed);
      }
      setNewThemeInput('');
    }
  };

  // 删除主题词
  const handleDeleteThemeTag = (tagToDelete) => {
    const updated = quickThemes.filter(tag => tag !== tagToDelete);
    setQuickThemes(updated);
    localStorage.setItem('custom_quick_themes', JSON.stringify(updated));
    if (customThemePrompt === tagToDelete) {
      setCustomThemePrompt(updated[0] || '');
    }
  };

  // 1. 唤起录音应用
  const handleLaunchVoiceMemos = async () => {
    setError('');
    setRecordingStatusNotice('正在唤起 macOS 原生语音备忘录...');
    try {
      const res = await fetch(`${API_BASE}/launch-voice-memos`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setRecordingStatusNotice('✨ 已调起语音备忘录！录音完成后可点“📂 打开语音备忘录文件夹”直接拖选。');
      } else {
        setRecordingStatusNotice('可以手动打开 macOS 语音备忘录或直接拖拽/导入录音文件。');
      }
    } catch (err) {
      setRecordingStatusNotice('请确认后台服务正在正常运行。');
    }
  };

  // 1.5 一键在 macOS 访达 (Finder) 中打开语音备忘录存储目录
  const handleOpenVoiceMemosDir = async () => {
    setError('');
    setRecordingStatusNotice('正在 macOS 访达中定位并打开语音备忘录专属文件夹...');
    try {
      const res = await fetch(`${API_BASE}/open-voice-memos-dir`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setRecordingStatusNotice('✨ 已在 macOS 访达中打开语音备忘录存储目录！可直接将其中的录音文件拖入软件窗口。');
      } else {
        setError('打开目录失败: ' + data.message);
      }
    } catch (err) {
      setError('无法打开目录，请确认后台服务正在正常运行。');
    }
  };

  // 辅助函数：根据填入策略合并逐字稿
  const applyTranscriptInsertion = (newTranscriptText) => {
    if (audioInsertMode === 'append' && transcriptText.trim()) {
      return `${transcriptText.trim()}\n\n--- (追加的录音转写文本) ---\n${newTranscriptText.trim()}`;
    }
    return newTranscriptText.trim();
  };

  // 2. 抓取选中的音频并自动转文字
  const handleTranscribeSelectedMemo = async () => {
    setIsTranscribing(true);
    setError('');
    const targetName = selectedMemo ? selectedMemo.name : '最新扫描到的音频';
    setRecordingStatusNotice(`正在解析“${targetName}”并转为文本...`);

    try {
      const res = await fetch(`${API_BASE}/transcribe-memo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: customApiKey.trim() || undefined,
          studentName: studentName.trim(),
          memoPath: selectedMemo ? selectedMemo.path : null
        })
      });

      const data = await res.json();
      if (data.success && data.transcript) {
        const finalContent = applyTranscriptInsertion(data.transcript);
        setTranscriptText(finalContent);
        setRecordingStatusNotice(`🎉 成功抓取“${data.filename || '音频文件'}”，已填入文本框！`);
      } else {
        setError(data.message || '受限于 macOS 权限未能读取文件，请使用【拖拽文件】或【选择本地音频】');
        setRecordingStatusNotice('');
      }
    } catch (err) {
      setError('转文字失败: ' + err.message);
      setRecordingStatusNotice('');
    } finally {
      setIsTranscribing(false);
    }
  };

  // 3. 处理本地音频文件上传 (支持点击选择与文件拖拽 Drop)
  const processAudioFile = async (file) => {
    if (!file) return;

    setIsTranscribing(true);
    setError('');
    setRecordingStatusNotice(`正在解析上传“${file.name}”并转写为文字...`);

    const formData = new FormData();
    if (customApiKey.trim()) {
      formData.append('apiKey', customApiKey.trim());
    }
    formData.append('studentName', studentName.trim());
    formData.append('audioFile', file);

    try {
      const res = await fetch(`${API_BASE}/transcribe-uploaded-audio`, {
        method: 'POST',
        body: formData
      });

      const data = await res.json();
      if (data.success && data.transcript) {
        const finalContent = applyTranscriptInsertion(data.transcript);
        setTranscriptText(finalContent);
        setRecordingStatusNotice(`🎉 导入“${file.name}”成功！已填入逐字稿文本框。`);
      } else {
        setError(data.message || '音频转文字失败，请检查音频格式');
      }
    } catch (err) {
      setError('上传转写失败: ' + err.message);
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file) processAudioFile(file);
  };

  // 全屏 Drag & Drop 文件拖拽监听
  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDraggingFile) setIsDraggingFile(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.clientX === 0 && e.clientY === 0) {
      setIsDraggingFile(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);

    // 1. 优先检查文件对象 (包括直接从 macOS 语音备忘录拖拽的 File)
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      // 从语音备忘录直接拖出的文件 type 经常为空，或者名称不带后缀。直接全盘接收任何有效文件！
      processAudioFile(file);
      return;
    }

    // 2. 检查是否有 file:// 的 uri-list (针对某些版本的 Voice Memos 拖拽路径)
    const uriList = e.dataTransfer ? e.dataTransfer.getData('text/uri-list') : '';
    if (uriList && uriList.startsWith('file://')) {
      try {
        const decodedPath = decodeURIComponent(uriList.replace(/^file:\/\//, ''));
        setIsTranscribing(true);
        setError('');
        setRecordingStatusNotice(`正在解析从语音备忘录拖入的文件...`);

        fetch(`${API_BASE}/transcribe-memo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiKey: customApiKey.trim() || undefined,
            studentName: studentName.trim(),
            memoPath: decodedPath
          })
        })
        .then(res => res.json())
        .then(data => {
          if (data.success && data.transcript) {
            const finalContent = applyTranscriptInsertion(data.transcript);
            setTranscriptText(finalContent);
            setRecordingStatusNotice(`🎉 从语音备忘录导入成功！已填入文本框。`);
          } else {
            setError(data.message || '从语音备忘录提取转写失败');
          }
        })
        .catch(err => setError('拖拽解析失败: ' + err.message))
        .finally(() => setIsTranscribing(false));

      } catch (err) {
        setError('拖拽路径解析失败');
      }
    }
  };

  const handleGenerate = async () => {
    if (!transcriptText || !transcriptText.trim()) {
      setError('逐字稿内容不能为空。请拖入/选择音频转文字，或在此直接粘贴文本');
      return;
    }

    setLoading(true);
    setError('');
    setGeneratedFeedback('');
    setKnowledgeImageBase64('');
    setKnowledgeImagesBase64([]);

    const formData = new FormData();
    formData.append('type', 'text');
    if (customApiKey.trim()) {
      formData.append('apiKey', customApiKey.trim());
    }
    formData.append('studentName', studentName.trim());
    formData.append('studentGrade', studentGrade);
    formData.append('feedbackTone', feedbackTone);
    formData.append('imageStyle', customThemePrompt.trim() || '宋代山水画意境');
    formData.append('posterMode', posterMode);
    formData.append('transcript', transcriptText.trim());

    try {
      const response = await fetch(`${API_BASE}/generate-feedback`, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      if (data.success) {
        setGeneratedFeedback(data.feedback);
        if (data.imagesBase64 && Array.isArray(data.imagesBase64) && data.imagesBase64.length > 0) {
          setKnowledgeImagesBase64(data.imagesBase64);
          setKnowledgeImageBase64(data.imagesBase64[0]);
        } else if (data.imageBase64) {
          setKnowledgeImagesBase64([data.imageBase64]);
          setKnowledgeImageBase64(data.imageBase64);
        }
      } else {
        setError(data.message || '生成课后反馈失败，请重试');
      }
    } catch (err) {
      setError('无法连接本地后端服务。请确认后台服务正在正常运行。');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!generatedFeedback) return;
    const cleanText = generatedFeedback.replace(/\*\*/g, '').replace(/^#+\s*/gm, '');
    navigator.clipboard.writeText(cleanText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // 5. 导出纯文本 (.txt)
  const handleExportFullText = () => {
    if (!generatedFeedback) return;

    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `课后学习反馈纯文本_${studentName.trim() || '学员'}_${studentGrade}_${dateStr}.txt`;

    let fullTextContent = `========================================================\n`;
    fullTextContent += `        ${pdfBrandTitle.trim() || '课后学习反馈档案'}\n`;
    fullTextContent += `========================================================\n`;
    fullTextContent += `【学员姓名】：${studentName.trim() || '未指定'}\n`;
    fullTextContent += `【学员学段】：${studentGrade}\n`;
    fullTextContent += `【反馈语气】：${feedbackTone}\n`;
    fullTextContent += `【生成时间】：${dateStr}\n`;
    fullTextContent += `========================================================\n\n`;

    fullTextContent += `--------------------------------------------------------\n`;
    fullTextContent += `一、 AI 整理·课后学习反馈全文\n`;
    fullTextContent += `--------------------------------------------------------\n`;
    fullTextContent += `${generatedFeedback.replace(/\*\*/g, '').replace(/^#+\s*/gm, '')}\n\n`;

    if (transcriptText) {
      fullTextContent += `--------------------------------------------------------\n`;
      fullTextContent += `二、 原始课堂录音/逐字稿全文\n`;
      fullTextContent += `--------------------------------------------------------\n`;
      fullTextContent += `${transcriptText.trim()}\n\n`;
    }

    fullTextContent += `========================================================\n`;
    fullTextContent += `${pdfHeaderTitle.trim() || '尘埃落定 · 始见星辰'}\n`;
    fullTextContent += `========================================================\n`;

    const blob = new Blob([fullTextContent], { type: 'text/plain;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  };

  // 6. 导出 PDF
  const handleExportPDF = async () => {
    if (!generatedFeedback) return;
    setPdfExporting(true);
    setError('');

    try {
      const res = await fetch(`${API_BASE}/generate-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentName: studentName.trim(),
          studentGrade: studentGrade,
          pdfBrandTitle: pdfBrandTitle.trim() || undefined,
          pdfHeaderTitle: pdfHeaderTitle.trim() || undefined,
          feedbackText: generatedFeedback,
          imageBase64: knowledgeImageBase64,
          imagesBase64: knowledgeImagesBase64
        })
      });

      if (!res.ok) {
        throw new Error('服务器生成 PDF 失败');
      }

      const blob = await res.blob();
      const defaultFilename = `课后反馈_${studentName.trim() || '学员'}_${studentGrade}_${new Date().toISOString().slice(0, 10)}.pdf`;

      if (window.electronAPI && typeof window.electronAPI.savePdf === 'function') {
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = async () => {
          const base64Data = reader.result.split(',')[1];
          const saveResult = await window.electronAPI.savePdf(base64Data, defaultFilename);
          if (saveResult.success) {
            alert(`PDF 已成功保存至：\n${saveResult.filePath}`);
          } else if (saveResult.error !== 'User cancelled') {
            setError('PDF 保存失败: ' + saveResult.error);
          }
          setPdfExporting(false);
        };
      } else {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = defaultFilename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        setPdfExporting(false);
      }
    } catch (err) {
      setError('导出 PDF 失败: ' + err.message);
      setPdfExporting(false);
    }
  };

  const renderFormattedMarkdownLine = (text) => {
    if (!text) return null;
    let cleanText = text.replace(/[\*#]/g, '');
    
    if (cleanText.includes('：') && !cleanText.startsWith('课堂') && cleanText.indexOf('：') < 14) {
      const colonIndex = cleanText.indexOf('：');
      const prefix = cleanText.slice(0, colonIndex + 1);
      const suffix = cleanText.slice(colonIndex + 1);
      return (
        <span>
          <strong style={{ color: 'var(--primary)', fontWeight: '700' }}>{prefix}</strong>
          {suffix}
        </span>
      );
    }
    return cleanText;
  };

  const renderTextWithImageInBetween = () => {
    if (!generatedFeedback) return null;

    const lines = generatedFeedback.split('\n').map(l => l.trim()).filter(Boolean);
    const recordLines = [];
    const restLines = [];
    let foundReview = false;

    for (const line of lines) {
      if (line.includes('课堂回顾：') || line.includes('课堂回顾') || foundReview) {
        foundReview = true;
        restLines.push(line);
      } else {
        recordLines.push(line);
      }
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.4rem' }}>
        {recordLines.length > 0 && (
          <div style={{ whiteSpace: 'pre-wrap', background: 'rgba(79, 70, 229, 0.04)', padding: '1.2rem', borderRadius: 'var(--radius-md)', borderLeft: '4px solid var(--primary)' }}>
            {recordLines.map((l, idx) => <div key={idx}>{renderFormattedMarkdownLine(l)}</div>)}
          </div>
        )}

        {knowledgeImagesBase64.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
            {knowledgeImagesBase64.map((imgBase64, imgIdx) => (
              <div key={imgIdx} className="knowledge-image-card" style={{ padding: '1rem', textAlign: 'center' }}>
                <div style={{ fontSize: '0.88rem', color: 'var(--primary)', fontWeight: '600', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                  2K AI 知识高精海报 {knowledgeImagesBase64.length > 1 ? `(模块 ${imgIdx + 1})` : ''} · 主题: {customThemePrompt || '宋代山水画意境'}
                </div>
                <img
                  src={`data:image/jpeg;base64,${imgBase64}`}
                  alt={`知识海报 ${imgIdx + 1}`}
                  style={{ width: '100%', borderRadius: 'var(--radius-sm)', objectFit: 'contain' }}
                />
              </div>
            ))}
          </div>
        )}

        {restLines.length > 0 && (
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.85', fontSize: '0.96rem' }}>
            {restLines.map((l, idx) => (
              <div key={idx} style={{ margin: '0.4rem 0', textIndent: (l.startsWith('#') || l.endsWith('：')) ? '0' : '1.5em' }}>
                {renderFormattedMarkdownLine(l)}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="app-container"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 顶部 Header */}
      <header className="header-bar">
        <div className="brand-title">
          <div className="brand-logo-badge">🌿</div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <h1 style={{ margin: 0, fontSize: '1.6rem' }}>反馈助手</h1>
              <span className="version-pill">v2.0 Pro</span>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.84rem', marginTop: '0.1rem' }}>
              智绘课后 · 素雅高质感教学反馈
            </p>
          </div>
        </div>

        {/* 顶部设置按钮 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <button
            onClick={() => setShowSettingsModal(true)}
            className="btn-secondary"
            style={{ fontWeight: '600' }}
          >
            ⚙️ 设置偏好
          </button>
        </div>
      </header>

      {/* 核心设置中心 Modal (多选项卡控制) */}
      {showSettingsModal && (
        <div className="modal-overlay" onClick={() => setShowSettingsModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
              <h3 style={{ fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                ⚙️ 教学偏好设置中心
              </h3>
              <button onClick={() => setShowSettingsModal(false)} style={{ background: 'transparent', fontSize: '1.2rem', color: 'var(--text-muted)' }}>
                ✕
              </button>
            </div>

            {/* 设置 Tabs 栏 */}
            <div className="settings-tabs">
              <button
                type="button"
                onClick={() => setActiveSettingsTab('visual')}
                className={`settings-tab-btn ${activeSettingsTab === 'visual' ? 'active' : ''}`}
              >
                🎨 外观与主题
              </button>
              <button
                type="button"
                onClick={() => setActiveSettingsTab('ai')}
                className={`settings-tab-btn ${activeSettingsTab === 'ai' ? 'active' : ''}`}
              >
                🤖 AI & 海报模式
              </button>
              <button
                type="button"
                onClick={() => setActiveSettingsTab('audio')}
                className={`settings-tab-btn ${activeSettingsTab === 'audio' ? 'active' : ''}`}
              >
                🎙️ 音频通道
              </button>
              <button
                type="button"
                onClick={() => setActiveSettingsTab('export')}
                className={`settings-tab-btn ${activeSettingsTab === 'export' ? 'active' : ''}`}
              >
                📄 PDF & 署名
              </button>
            </div>

            {/* 选项卡内容 */}
            <div className="settings-tab-content">
              {activeSettingsTab === 'visual' && (
                <div className="settings-group">
                  {/* 外观切换 */}
                  <div className="settings-item">
                    <div>
                      <div className="settings-label">🎨 界面外观模式</div>
                      <div className="settings-desc">选择视觉配色界面模式</div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        type="button"
                        onClick={() => setThemeMode('light')}
                        className={`theme-toggle-btn ${themeMode === 'light' ? 'active' : ''}`}
                      >
                        🍃 素雅暖光
                      </button>
                      <button
                        type="button"
                        onClick={() => setThemeMode('dark')}
                        className={`theme-toggle-btn ${themeMode === 'dark' ? 'active' : ''}`}
                      >
                        🌙 深邃夜间
                      </button>
                    </div>
                  </div>

                  {/* 可视化常用主题词库管理器 */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                    <div>
                      <div className="settings-label">🎨 可视化常用主题词库管理</div>
                      <div className="settings-desc">自由添加、编辑或删除个人常用风格库</div>
                    </div>

                    <div className="tag-manager-box">
                      <div className="tag-manage-chip-grid">
                        {quickThemes.map((tag) => (
                          <div key={tag} className="tag-manage-chip">
                            <span>{tag}</span>
                            <span
                              onClick={() => handleDeleteThemeTag(tag)}
                              className="tag-delete-icon"
                              title="删除此主题标签"
                            >
                              ✕
                            </span>
                          </div>
                        ))}
                      </div>

                      <form onSubmit={handleAddThemeTag} style={{ display: 'flex', gap: '0.5rem', marginTop: '0.4rem' }}>
                        <input
                          type="text"
                          placeholder="新增主题风格（如：水墨中国风、赛博朋克...）"
                          value={newThemeInput}
                          onChange={(e) => setNewThemeInput(e.target.value)}
                          className="form-input"
                          style={{ fontSize: '0.85rem', padding: '0.45rem 0.8rem' }}
                        />
                        <button type="submit" className="btn-secondary" style={{ padding: '0.45rem 0.9rem', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
                          + 添加主题
                        </button>
                      </form>
                    </div>
                  </div>
                </div>
              )}

              {activeSettingsTab === 'ai' && (
                <div className="settings-group">
                  {/* 海报生成模式 */}
                  <div className="settings-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.6rem' }}>
                    <div>
                      <div className="settings-label">🖼️ 知识图谱海报生成模式</div>
                      <div className="settings-desc">选择生成反馈报告时 AI 海报的绘制张数与速度</div>
                    </div>
                    <select
                      value={posterMode}
                      onChange={(e) => setPosterMode(e.target.value)}
                      className="form-select"
                      style={{ width: '100%' }}
                    >
                      <option value="single">自动单张 (标准 16:9 2K 知识海报) - 推荐</option>
                      <option value="multi">双模块多图 (针对复杂知识点绘制 2 张海报)</option>
                      <option value="none">纯文字极速模式 (不生成图片，极速输出省流量)</option>
                    </select>
                  </div>

                  {/* 评语语气风格 */}
                  <div className="settings-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.6rem' }}>
                    <div>
                      <div className="settings-label">📝 评语语气风格</div>
                      <div className="settings-desc">AI 生成课后总结时的语气倾向</div>
                    </div>
                    <select
                      value={feedbackTone}
                      onChange={(e) => setFeedbackTone(e.target.value)}
                      className="form-select"
                      style={{ width: '100%' }}
                    >
                      <option value="严谨鼓励">严谨鼓励（专业严谨，富有正向关怀）</option>
                      <option value="温和亲切">温和亲切（平易近人，便于家长沟通）</option>
                      <option value="考纲提分">考纲提分（聚焦中高考考点与解题技巧）</option>
                    </select>
                  </div>

                  {/* Gemini API Key 覆盖 */}
                  <div className="settings-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.6rem' }}>
                    <div>
                      <div className="settings-label">🔑 Gemini API Key (可选覆盖)</div>
                      <div className="settings-desc">默认使用系统后台 .env 配置，如需临时使用自己的 Key 可填入</div>
                    </div>
                    <input
                      type="password"
                      placeholder="默认使用后台环境配置 (留空即可)"
                      value={customApiKey}
                      onChange={(e) => setCustomApiKey(e.target.value)}
                      className="form-input"
                    />
                  </div>
                </div>
              )}

              {activeSettingsTab === 'audio' && (
                <div className="settings-group">
                  {/* 音频自动抓取与刷新 */}
                  <div className="settings-item">
                    <div>
                      <div className="settings-label">🎙️ 启动时自动扫描语音备忘录</div>
                      <div className="settings-desc">打开软件时自动感知 macOS 语音备忘录最新的音频</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={autoFetchMemos}
                      onChange={(e) => setAutoFetchMemos(e.target.checked)}
                      style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                    />
                  </div>

                  {/* 逐字稿填入策略 */}
                  <div className="settings-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.6rem' }}>
                    <div>
                      <div className="settings-label">📝 录音转写填入策略</div>
                      <div className="settings-desc">音频转为文字后填入文本框的叠加逻辑</div>
                    </div>
                    <select
                      value={audioInsertMode}
                      onChange={(e) => setAudioInsertMode(e.target.value)}
                      className="form-select"
                      style={{ width: '100%' }}
                    >
                      <option value="replace">覆盖当前逐字稿 (默认，清空旧文本并写入新文字)</option>
                      <option value="append">追加到当前逐字稿末尾 (保留已有文本，方便多段音频合并)</option>
                    </select>
                  </div>
                </div>
              )}

              {activeSettingsTab === 'export' && (
                <div className="settings-group">
                  {/* PDF 机构/教师署名 */}
                  <div className="settings-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.6rem' }}>
                    <div>
                      <div className="settings-label">📄 PDF 导出抬头/署名</div>
                      <div className="settings-desc">生成的 PDF 报告顶部显示的个人或工作室名称</div>
                    </div>
                    <input
                      type="text"
                      placeholder="如：彭老师语文名师工作室"
                      value={pdfBrandTitle}
                      onChange={(e) => setPdfBrandTitle(e.target.value)}
                      className="form-input"
                    />
                  </div>

                  {/* 自定义页眉标语 */}
                  <div className="settings-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.6rem' }}>
                    <div>
                      <div className="settings-label">🔖 PDF 页眉标语 (Slogan)</div>
                      <div className="settings-desc">导出的 PDF 顶部横线上方显示的标语（默认为品牌 Slogan）</div>
                    </div>
                    <input
                      type="text"
                      placeholder="尘埃落定 · 始见星辰"
                      value={pdfHeaderTitle}
                      onChange={(e) => setPdfHeaderTitle(e.target.value)}
                      className="form-input"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* 底部按钮栏 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.2rem', paddingTop: '0.8rem', borderTop: '1px solid var(--panel-border)' }}>
              <button type="button" onClick={handleResetSettings} className="btn-secondary" style={{ color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.3)' }}>
                ↺ 恢复默认设置
              </button>
              <div style={{ display: 'flex', gap: '0.6rem' }}>
                <button type="button" onClick={() => setShowSettingsModal(false)} className="btn-secondary">
                  取消
                </button>
                <button type="button" onClick={handleSaveSettings} className="btn-cta" style={{ width: 'auto', padding: '0.55rem 1.4rem', fontSize: '0.9rem' }}>
                  保存设置
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 核心工作区 */}
      <main className="grid-cols-2">
        {/* 左侧控制区 */}
        <section className="glass-panel form-section">
          
          {/* 1. 学生姓名与学段 */}
          <div>
            <div className="section-title">
              <span className="icon">👤</span> 学生基本信息
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: '0.75rem', marginTop: '0.5rem' }}>
              <div>
                <label className="form-label">学生姓名</label>
                <input
                  type="text"
                  placeholder="如：彭梓辰"
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  className="form-input"
                />
              </div>

              <div>
                <label className="form-label">学段</label>
                <select
                  value={studentGrade}
                  onChange={(e) => setStudentGrade(e.target.value)}
                  className="form-select"
                  style={{ width: '100%' }}
                >
                  <option value="初一">初一</option>
                  <option value="初一(自招)">初一 (自招)</option>
                  <option value="初二">初二</option>
                  <option value="初二(自招)">初二 (自招)</option>
                  <option value="初三(中考)">初三 (中考)</option>
                  <option value="初三(自招)">初三 (自招)</option>
                  <option value="高一">高一</option>
                  <option value="高二">高二</option>
                  <option value="高三(高考)">高三 (高考)</option>
                  <option value="高三(春考)">高三 (春考)</option>
                </select>
              </div>
            </div>
          </div>

          {/* 2. 知识点总结图艺术主题 */}
          <div>
            <div className="section-title">
              <span className="icon">🎨</span> 知识点图谱主题/视觉风格
            </div>
            <input
              type="text"
              placeholder="输入相关主题（如：疯狂动物城、宋代山水画、黑神话悟空...）"
              value={customThemePrompt}
              onChange={(e) => setCustomThemePrompt(e.target.value)}
              className="form-input"
              style={{ marginTop: '0.5rem' }}
            />
            {/* 快捷点选 Chips */}
            <div className="quick-themes-grid">
              {quickThemes.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setCustomThemePrompt(tag)}
                  className={`theme-chip ${customThemePrompt === tag ? 'active' : ''}`}
                >
                  {customThemePrompt === tag && '✓ '}
                  {tag}
                </button>
              ))}
            </div>
          </div>

          {/* 3. 音频转写通道 (支持全屏/区域拖拽放置) */}
          <div>
            <div className="section-title" style={{ justifyContent: 'space-between' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="icon">🎙️</span> 课堂音频通道 (支持拖拽录音文件)
              </span>
              {isTranscribing && (
                <div className="waveform-container">
                  <div className="waveform-bar"></div>
                  <div className="waveform-bar"></div>
                  <div className="waveform-bar"></div>
                  <div className="waveform-bar"></div>
                  <div className="waveform-bar"></div>
                </div>
              )}
            </div>

            <div className="audio-hub-box" style={{ marginTop: '0.5rem', position: 'relative' }}>
              {/* 局域拖拽高亮覆盖层 (精确定位限制在课堂音频通道卡片内) */}
              {isDraggingFile && (
                <div className="audio-drop-overlay">
                  <div style={{ fontSize: '1.6rem', marginBottom: '0.2rem' }}>📥</div>
                  <div style={{ fontSize: '0.9rem', fontWeight: '700' }}>松开鼠标，直接导入音频</div>
                  <div style={{ fontSize: '0.75rem', opacity: 0.85, marginTop: '0.2rem' }}>
                    支持拖入 .m4a / .mp3 / .wav 录音文件
                  </div>
                </div>
              )}

              <div className="audio-actions-row" style={{ gridTemplateColumns: '1fr 1.1fr 1fr' }}>
                <button onClick={handleLaunchVoiceMemos} className="audio-btn" title="调起 macOS 原生语音备忘录">
                  🎙️ 唤起备忘录
                </button>
                <button onClick={handleOpenVoiceMemosDir} className="audio-btn" style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }} title="直接在 macOS 访达中打开保存有所有录音原文件的专属文件夹">
                  📂 打开录音文件夹
                </button>
                <button onClick={() => fileInputRef.current && fileInputRef.current.click()} className="audio-btn" title="选择本地硬盘里的任意音频文件">
                  📁 选择本地音频
                </button>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept="audio/*,.m4a,.mp3,.wav"
                  style={{ display: 'none' }}
                />
              </div>

              {/* 录音列表展示 */}
              <div style={{ maxHeight: '120px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                {voiceMemos.length > 0 ? (
                  voiceMemos.map((memo) => (
                    <div
                      key={memo.id}
                      onClick={() => setSelectedMemo(memo)}
                      className={`list-item-card ${selectedMemo?.id === memo.id ? 'selected' : ''}`}
                      style={{ padding: '0.5rem 0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                    >
                      <div style={{ fontSize: '0.85rem', fontWeight: '500', color: selectedMemo?.id === memo.id ? 'var(--primary)' : 'var(--text-primary)' }}>
                        🎵 {memo.name}
                      </div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {(memo.size / 1024 / 1024).toFixed(1)}M
                      </span>
                    </div>
                  ))
                ) : (
                  <div style={{ padding: '0.8rem 0.6rem', textAlign: 'center', background: 'rgba(0,0,0,0.02)', borderRadius: 'var(--radius-md)', border: '1px dashed var(--panel-border)' }}>
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
                      因 macOS 隐私保护机制未自动扫描到已有录音
                    </div>
                    <button
                      onClick={handleOpenVoiceMemosDir}
                      className="btn-secondary"
                      style={{ padding: '0.35rem 0.8rem', fontSize: '0.8rem', color: 'var(--primary)', borderColor: 'var(--primary)' }}
                    >
                      📂 点击直接打开 Mac 语音备忘录文件夹 (内含所有 .m4a 录音)
                    </button>
                  </div>
                )}
              </div>

              <button
                onClick={handleTranscribeSelectedMemo}
                disabled={isTranscribing}
                className="btn-secondary"
                style={{ width: '100%', justifyContent: 'center', padding: '0.65rem', color: 'var(--primary)' }}
              >
                {isTranscribing ? '正在提取转写中...' : selectedMemo ? `⚡ 一键转写【${selectedMemo.name}】` : '⚡ 抓取或转写选中音频'}
              </button>

              {recordingStatusNotice && (
                <div className="audio-notice-bar">
                  <span>{recordingStatusNotice}</span>
                </div>
              )}
            </div>
          </div>

          {/* 4. 逐字稿文本框 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label className="form-label" style={{ margin: 0 }}>
                📝 课堂逐字稿文本
              </label>
              <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  字数: {transcriptText.length}
                </span>
                {transcriptText && (
                  <button onClick={() => setTranscriptText('')} style={{ fontSize: '0.75rem', color: 'var(--text-muted)', background: 'transparent' }}>
                    清空
                  </button>
                )}
              </div>
            </div>
            <textarea
              placeholder="直接把音频文件拖入软件，或转写文字后将自动填入此处。亦可直接粘贴逐字稿..."
              value={transcriptText}
              onChange={(e) => setTranscriptText(e.target.value)}
              className="form-input"
              style={{ height: '140px', resize: 'none', lineHeight: '1.6', fontSize: '0.9rem' }}
            />
          </div>

          {/* 核心主生成按钮 */}
          <button
            onClick={handleGenerate}
            disabled={loading || !transcriptText || !transcriptText.trim()}
            className="btn-cta"
          >
            {loading ? '⚡ AI 双引擎生成中...' : '✨ 生成图文课后反馈 (AI 物理引擎)'}
          </button>
        </section>

        {/* 右侧反馈展示区 */}
        <section className="glass-panel result-arena">
          <div className="result-header">
            <h3>📊 课后学习反馈报告</h3>
            
            {generatedFeedback && (
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button onClick={handleExportFullText} className="btn-secondary">
                  📝 纯文本
                </button>
                <button onClick={handleCopy} className="btn-secondary">
                  {copied ? '✓ 已复制' : '📋 复制'}
                </button>
                <button onClick={handleExportPDF} disabled={pdfExporting} className="btn-cta" style={{ width: 'auto', padding: '0.45rem 1.1rem', fontSize: '0.85rem' }}>
                  {pdfExporting ? '导出中...' : '📄 导出 PDF'}
                </button>
              </div>
            )}
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
            {loading && (
              <div style={{ position: 'absolute', inset: 0, background: 'var(--panel-bg)', backdropFilter: 'blur(16px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-md)', zIndex: 10 }}>
                <div className="empty-icon-glow" style={{ marginBottom: '1.2rem' }}>
                  ⚡
                </div>
                <div style={{ fontWeight: '700', color: 'var(--text-primary)', fontSize: '1.2rem', marginBottom: '0.5rem' }}>
                  正在生成反馈中...
                </div>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                  AI 正在分析课堂文本并绘制 2K 风格脑图海报
                </p>
              </div>
            )}

            {error && (
              <div style={{ padding: '1rem', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: 'var(--radius-md)', color: 'var(--danger)', fontSize: '0.9rem', marginBottom: '1rem' }}>
                <strong>提示：</strong> {error}
              </div>
            )}

            {generatedFeedback ? (
              <div className="result-content-container" style={{ flex: 1, overflowY: 'auto' }}>
                {renderTextWithImageInBetween()}
              </div>
            ) : (
              <div className="empty-state-box">
                <div className="empty-icon-glow">
                  🍃
                </div>
                <div>
                  <h4 style={{ fontSize: '1.1rem', marginBottom: '0.3rem' }}>尚未生成反馈报告</h4>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>
                    通过左侧面板填入学员信息，直接拖拽录音文件或贴入逐字稿，点击“生成图文课后反馈”。
                  </p>
                </div>

                <div className="steps-guide">
                  <div className="step-card">
                    <div className="step-number">1</div>
                    <div className="step-title">填学员 & 风格</div>
                    <div className="step-desc">选学生姓名与主题样式</div>
                  </div>
                  <div className="step-card">
                    <div className="step-number">2</div>
                    <div className="step-title">拖拽/转写录音</div>
                    <div className="step-desc">录音拖入软件一键提取</div>
                  </div>
                  <div className="step-card">
                    <div className="step-number">3</div>
                    <div className="step-title">生成图文 PDF</div>
                    <div className="step-desc">双引擎一键输出海报报告</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>

      {/* 底部 Footer */}
      <footer style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', padding: '0.5rem 0', marginTop: 'auto', letterSpacing: '2px', fontWeight: '500' }}>
        尘埃落定 · 始见星辰 | 反馈助手 v2.0 Pro Edition
      </footer>
    </div>
  );
}
