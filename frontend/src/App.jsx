import React, { useState, useEffect, useRef } from 'react';

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
  const [studentName, setStudentName] = useState('');
  const [studentGrade, setStudentGrade] = useState('高一');
  const [customThemePrompt, setCustomThemePrompt] = useState('宋代山水画意境');
  const [transcriptText, setTranscriptText] = useState('');
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('gemini_api_key') || '');
  const [showApiKeyInput, setShowApiKeyInput] = useState(!localStorage.getItem('gemini_api_key'));
  
  // 常用主题列表 (支持用户点击 + 自定义添加)
  const [quickThemes, setQuickThemes] = useState(() => {
    try {
      const saved = localStorage.getItem('custom_quick_themes');
      return saved ? JSON.parse(saved) : DEFAULT_QUICK_THEMES;
    } catch (e) {
      return DEFAULT_QUICK_THEMES;
    }
  });

  // 语音备忘录及本地音频
  const [voiceMemos, setVoiceMemos] = useState([]);
  const [selectedMemo, setSelectedMemo] = useState(null);
  const [recordingStatusNotice, setRecordingStatusNotice] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const fileInputRef = useRef(null);
  
  // 输出与 UI 状态
  const [loading, setLoading] = useState(false);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [generatedFeedback, setGeneratedFeedback] = useState('');
  const [knowledgeImageBase64, setKnowledgeImageBase64] = useState('');
  const [knowledgeImagesBase64, setKnowledgeImagesBase64] = useState([]);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchVoiceMemos();
  }, []);

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

  const handleSaveApiKey = (e) => {
    e.preventDefault();
    localStorage.setItem('gemini_api_key', apiKey.trim());
    setShowApiKeyInput(false);
  };

  const handleClearApiKey = () => {
    localStorage.removeItem('gemini_api_key');
    setApiKey('');
    setShowApiKeyInput(true);
  };

  // 添加用户常用主题快捷标签
  const handleAddCustomQuickTheme = () => {
    const themeName = window.prompt('请输入您常用的主题名称（例如：大鱼海棠、赛博朋克...）：');
    if (themeName && themeName.trim()) {
      const trimmed = themeName.trim();
      if (!quickThemes.includes(trimmed)) {
        const updated = [...quickThemes, trimmed];
        setQuickThemes(updated);
        localStorage.setItem('custom_quick_themes', JSON.stringify(updated));
        setCustomThemePrompt(trimmed);
      }
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
        setRecordingStatusNotice('✨ 已调起语音备忘录！录音完成后点上方“选择本地音频文件”或从列表抓取。');
      } else {
        setRecordingStatusNotice('可以手动打开 macOS 语音备忘录或直接点击右侧“导入录音文件”。');
      }
    } catch (err) {
      setRecordingStatusNotice('请确认后台服务正在正常运行。');
    }
  };

  // 2. 抓取选中的音频并自动转文字
  const handleTranscribeSelectedMemo = async () => {
    if (!apiKey) {
      setError('请先在右上角配置并保存您的 Gemini API Key');
      setShowApiKeyInput(true);
      return;
    }

    setIsTranscribing(true);
    setError('');
    const targetName = selectedMemo ? selectedMemo.name : '扫描到的最新音频';
    setRecordingStatusNotice(`正在解析“${targetName}”并转为逐字稿...`);

    try {
      const res = await fetch(`${API_BASE}/transcribe-memo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          studentName: studentName.trim(),
          memoPath: selectedMemo ? selectedMemo.path : null
        })
      });

      const data = await res.json();
      if (data.success && data.transcript) {
        setTranscriptText(data.transcript);
        setRecordingStatusNotice(`🎉 成功抓取“${data.filename || '音频文件'}”，已自动填入文本框！`);
      } else {
        setError(data.message || '系统受限于 macOS 权限未读到文件，请使用右侧【手动选择音频文件】');
        setRecordingStatusNotice('');
      }
    } catch (err) {
      setError('转文字失败: ' + err.message);
      setRecordingStatusNotice('');
    } finally {
      setIsTranscribing(false);
    }
  };

  // 3. 上传本地音频文件
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!apiKey) {
      setError('请先在右上角配置并保存您的 Gemini API Key');
      setShowApiKeyInput(true);
      return;
    }

    setIsTranscribing(true);
    setError('');
    setRecordingStatusNotice(`正在上传“${file.name}”并转写为文字...`);

    const formData = new FormData();
    formData.append('apiKey', apiKey.trim());
    formData.append('studentName', studentName.trim());
    formData.append('audioFile', file);

    try {
      const res = await fetch(`${API_BASE}/transcribe-uploaded-audio`, {
        method: 'POST',
        body: formData
      });

      const data = await res.json();
      if (data.success && data.transcript) {
        setTranscriptText(data.transcript);
        setRecordingStatusNotice(`🎉 导入“${file.name}”成功！已自动转写为文字填入文本框。`);
      } else {
        setError(data.message || '音频转文字失败，请检查音频格式');
      }
    } catch (err) {
      setError('上传转写失败: ' + err.message);
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleGenerate = async () => {
    if (!transcriptText || !transcriptText.trim()) {
      setError('逐字稿内容不能为空。请选择音频转文字，或在此直接粘贴文本');
      return;
    }

    setLoading(true);
    setError('');
    setGeneratedFeedback('');
    setKnowledgeImageBase64('');
    setKnowledgeImagesBase64([]);
    setLoadingStatus('正在生成反馈');

    const formData = new FormData();
    formData.append('type', 'text');
    formData.append('studentName', studentName.trim());
    formData.append('studentGrade', studentGrade);
    formData.append('imageStyle', customThemePrompt.trim() || '宋代山水画意境');
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
      setLoadingStatus('');
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
    const filename = `语文课后反馈纯文本档案_${studentName.trim() || '学员'}_${studentGrade}_${dateStr}.txt`;

    let fullTextContent = `========================================================\n`;
    fullTextContent += `        语文课后学习反馈档案 (纯文本档案版)\n`;
    fullTextContent += `========================================================\n`;
    fullTextContent += `【学员姓名】：${studentName.trim() || '未指定'}\n`;
    fullTextContent += `【学员学段】：${studentGrade}\n`;
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
    fullTextContent += `归档说明：尘埃落定·始见星辰\n`;
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
          feedbackText: generatedFeedback,
          imageBase64: knowledgeImageBase64,
          imagesBase64: knowledgeImagesBase64
        })
      });

      if (!res.ok) {
        throw new Error('服务器生成 PDF 失败');
      }

      const blob = await res.blob();
      const defaultFilename = `语文课后反馈_${studentName.trim() || '学员'}_${studentGrade}_${new Date().toISOString().slice(0, 10)}.pdf`;

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
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {recordLines.length > 0 && (
          <div style={{ whiteSpace: 'pre-wrap', background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: 'var(--radius-md)', borderLeft: '4px solid var(--accent)' }}>
            {recordLines.map((l, idx) => <div key={idx}>{renderFormattedMarkdownLine(l)}</div>)}
          </div>
        )}

        {knowledgeImagesBase64.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {knowledgeImagesBase64.map((imgBase64, imgIdx) => (
              <div key={imgIdx} style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--panel-border-hover)', borderRadius: 'var(--radius-md)', padding: '1rem', textAlign: 'center' }}>
                <div style={{ fontSize: '0.9rem', color: 'var(--accent)', fontWeight: '600', marginBottom: '0.6rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                  16:9 2K 知识海报 {knowledgeImagesBase64.length > 1 ? `(模块 ${imgIdx + 1})` : ''} · 主题: {customThemePrompt || '宋代山水画意境'}
                </div>
                <img
                  src={`data:image/jpeg;base64,${imgBase64}`}
                  alt={`知识海报 ${imgIdx + 1}`}
                  style={{ width: '100%', borderRadius: 'var(--radius-sm)', objectFit: 'contain', boxShadow: '0 10px 25px rgba(0,0,0,0.6)', cursor: 'pointer' }}
                />
              </div>
            ))}
          </div>
        )}

        {restLines.length > 0 && (
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.8' }}>
            {restLines.map((l, idx) => (
              <div key={idx} style={{ margin: '0.3rem 0', textIndent: (l.startsWith('#') || l.endsWith('：')) ? '0' : '2em' }}>
                {renderFormattedMarkdownLine(l)}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="app-container">
      {/* 顶部 Header */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1>反馈助手</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem', fontSize: '0.95rem' }}>
            更懂你，更懂学生
          </p>
        </div>
      </header>

      {/* 核心工作区 */}
      <main className="grid-cols-2">
        {/* 左侧：学生信息、自由主题与音频入框 */}
        <section className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
          
          {/* 1. 学生姓名与学段 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '0.75rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: '600' }}>
                学生姓名：
              </label>
              <input
                type="text"
                placeholder="请输入学生姓名（如：彭梓辰）"
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                className="form-input"
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: '600' }}>
                学生学段：
              </label>
              <select
                value={studentGrade}
                onChange={(e) => setStudentGrade(e.target.value)}
                className="form-input"
                style={{ background: 'rgba(21, 16, 42, 0.9)', cursor: 'pointer' }}
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

          {/* 2. 自由视觉主题输入框 + 可扩展快捷标签 (+号添加自定义主题) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <label style={{ fontSize: '0.88rem', color: 'var(--accent)', fontWeight: '600' }}>
              知识点总结图艺术主题/风格 (自由输入)：
            </label>
            <input
              type="text"
              placeholder="输入相关主题（如：疯狂动物城、宋代山水画、黑神话悟空、水彩插画...）"
              value={customThemePrompt}
              onChange={(e) => setCustomThemePrompt(e.target.value)}
              className="form-input"
              style={{ fontSize: '0.9rem' }}
            />
            {/* 快捷点选标签 + (+)号新增常用主题 */}
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.2rem' }}>
              {quickThemes.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setCustomThemePrompt(tag)}
                  style={{
                    fontSize: '0.75rem',
                    padding: '0.15rem 0.5rem',
                    background: customThemePrompt === tag ? 'rgba(6, 182, 212, 0.25)' : 'rgba(255,255,255,0.06)',
                    border: customThemePrompt === tag ? '1px solid var(--accent)' : '1px solid var(--panel-border)',
                    borderRadius: '12px',
                    color: customThemePrompt === tag ? 'var(--accent)' : 'var(--text-secondary)',
                    cursor: 'pointer'
                  }}
                >
                  {tag}
                </button>
              ))}
              <button
                type="button"
                onClick={handleAddCustomQuickTheme}
                style={{
                  fontSize: '0.75rem',
                  padding: '0.15rem 0.5rem',
                  background: 'rgba(16, 185, 129, 0.15)',
                  border: '1px stroke var(--success)',
                  borderRadius: '12px',
                  color: 'var(--success)',
                  cursor: 'pointer',
                  fontWeight: '600'
                }}
                title="点击添加您常用的自定义主题"
              >
                + 添加常用主题
              </button>
            </div>
          </div>

          {/* 3. 音频录制与上传通道 */}
          <div style={{ background: 'rgba(6, 182, 212, 0.05)', border: '1px solid rgba(6, 182, 212, 0.2)', borderRadius: 'var(--radius-md)', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--accent)' }}>
                🎙️ 录音转写通道
              </span>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <button onClick={handleLaunchVoiceMemos} className="btn-secondary" style={{ padding: '0.15rem 0.5rem', fontSize: '0.75rem', borderColor: 'var(--accent)', color: 'var(--accent)' }}>
                  唤起语音备忘录
                </button>
                <button onClick={() => fileInputRef.current && fileInputRef.current.click()} className="btn-secondary" style={{ padding: '0.15rem 0.5rem', fontSize: '0.75rem' }}>
                  📁 选本地音频
                </button>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept="audio/*,.m4a,.mp3,.wav"
                  style={{ display: 'none' }}
                />
              </div>
            </div>

            <div style={{ maxHeight: '100px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.4rem', background: 'rgba(0,0,0,0.2)', padding: '0.4rem', borderRadius: 'var(--radius-sm)' }}>
              {voiceMemos.length > 0 ? (
                voiceMemos.map((memo) => (
                  <div
                    key={memo.id}
                    onClick={() => setSelectedMemo(memo)}
                    style={{
                      display: 'flex',
                      justify: 'space-between',
                      alignItems: 'center',
                      padding: '0.4rem 0.6rem',
                      background: selectedMemo?.id === memo.id ? 'rgba(6, 182, 212, 0.15)' : 'rgba(255,255,255,0.03)',
                      border: selectedMemo?.id === memo.id ? '1px solid var(--accent)' : '1px solid transparent',
                      borderRadius: '4px',
                      cursor: 'pointer'
                    }}
                  >
                    <div style={{ fontWeight: '500', fontSize: '0.85rem', color: selectedMemo?.id === memo.id ? 'var(--accent)' : 'var(--text-primary)' }}>
                      {memo.name}
                    </div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      {(memo.size / 1024 / 1024).toFixed(1)}M
                    </span>
                  </div>
                ))
              ) : (
                <div style={{ padding: '0.8rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                  提示：可点击“唤起语音备忘录”录音，或点“📁 选本地音频”直接选录音文件。
                </div>
              )}
            </div>

            <button
              onClick={handleTranscribeSelectedMemo}
              disabled={isTranscribing}
              className="btn-primary"
              style={{ padding: '0.65rem', fontSize: '0.9rem', background: 'linear-gradient(135deg, var(--accent) 0%, var(--primary) 100%)' }}
            >
              {isTranscribing ? '正在转化文字...' : selectedMemo ? `⚡ 抓取【${selectedMemo.name}】转写` : '⚡ 抓取或转写选中音频'}
            </button>

            {recordingStatusNotice && (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', background: 'rgba(0,0,0,0.25)', padding: '0.4rem 0.6rem', borderRadius: '4px' }}>
                {recordingStatusNotice}
              </div>
            )}
          </div>

          {/* 4. 逐字稿文本框 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: '600' }}>
                课堂录音逐字稿文本框：
              </label>
              {transcriptText && (
                <button onClick={() => setTranscriptText('')} style={{ fontSize: '0.75rem', color: 'var(--text-muted)', background: 'transparent' }}>
                  清空文本
                </button>
              )}
            </div>
            <textarea
              placeholder="录音转换文字后将自动填入此处，亦可在此直接粘贴或修改逐字稿..."
              value={transcriptText}
              onChange={(e) => setTranscriptText(e.target.value)}
              className="form-input"
              style={{ height: '150px', resize: 'none', lineHeight: '1.6', fontSize: '0.9rem' }}
            />
          </div>

          <button
            onClick={handleGenerate}
            disabled={loading || !transcriptText || !transcriptText.trim()}
            className="btn-primary"
            style={{ width: '100%', padding: '0.85rem', fontSize: '1.05rem', marginTop: 'auto', background: 'linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%)' }}
          >
            {loading ? '正在分析并生成图文...' : '生成图文课后反馈'}
          </button>
        </section>

        {/* 右侧：生成与输出区域 */}
        <section className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', minHeight: '520px', position: 'relative' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1.15rem' }}>课后学习反馈</h3>
            
            {generatedFeedback && (
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <button onClick={handleExportFullText} className="btn-secondary" style={{ padding: '0.4rem 0.7rem', fontSize: '0.82rem', borderColor: 'var(--accent)', color: 'var(--accent)' }}>
                  导出纯文本 (.txt)
                </button>
                <button onClick={handleCopy} className="btn-secondary" style={{ padding: '0.4rem 0.7rem', fontSize: '0.82rem' }}>
                  {copied ? '已复制!' : '复制反馈'}
                </button>
                <button onClick={handleExportPDF} disabled={pdfExporting} className="btn-primary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.82rem' }}>
                  {pdfExporting ? '导出中...' : '保存/导出PDF'}
                </button>
              </div>
            )}
          </div>

          {/* 渲染区域 (修改规则 1: 加载中央直接写“正在生成反馈”) */}
          <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column' }}>
            {loading && (
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(15, 12, 27, 0.92)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-md)', zIndex: 10 }}>
                <svg className="animate-spin" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="3" style={{ marginBottom: '0.75rem' }}>
                  <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.49 8.49l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.49-8.49l2.83-2.83"/>
                </svg>
                <div style={{ fontWeight: '700', color: 'var(--text-primary)', fontSize: '1.15rem' }}>
                  正在生成反馈
                </div>
              </div>
            )}

            {error && (
              <div style={{ padding: '1rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: 'var(--radius-md)', color: 'var(--danger)', fontSize: '0.9rem', marginBottom: '1rem' }}>
                <strong>提示/报错：</strong> {error}
              </div>
            )}

            {generatedFeedback ? (
              <div style={{ flex: 1, background: 'rgba(0, 0, 0, 0.25)', border: '1px solid var(--panel-border)', borderRadius: 'var(--radius-md)', padding: '1.25rem', overflowY: 'auto', textAlign: 'left' }}>
                {renderTextWithImageInBetween()}
              </div>
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', border: '1px dashed var(--panel-border)', borderRadius: 'var(--radius-md)' }}>
                等待生成反馈。可在左侧选择音频或填入逐字稿，点击“生成图文课后反馈”。
              </div>
            )}
          </div>
        </section>
      </main>

      {/* 底部 Footer (修改规则 2: 下面部分直接写“尘埃落定·始见星辰”) */}
      <footer style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', padding: '0.5rem 0', marginTop: 'auto', letterSpacing: '2px', fontWeight: '500' }}>
        尘埃落定 · 始见星辰
      </footer>
    </div>
  );
}
