import React, { useState, useEffect, useRef } from 'react';

// 本地后端 API 基础路径 (使用 127.0.0.1 避开 macOS localhost IPv6 解析问题)
const API_BASE = 'http://127.0.0.1:5001/api';

export default function App() {
  // 核心状态
  const [voiceMemos, setVoiceMemos] = useState([]);
  const [selectedMemo, setSelectedMemo] = useState(null);
  const [customAudioFile, setCustomAudioFile] = useState(null);
  const [transcriptText, setTranscriptText] = useState('');
  const [studentName, setStudentName] = useState(''); // 学生姓名
  const [imageStyle, setImageStyle] = useState('chinese_ink'); // 视觉风格选择
  const [inputType, setInputType] = useState('audio'); // 'audio' | 'text'
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('gemini_api_key') || '');
  const [showApiKeyInput, setShowApiKeyInput] = useState(!localStorage.getItem('gemini_api_key'));
  
  // 拖拽导入与识别状态
  const [dropNotice, setDropNotice] = useState('');
  
  // 生成与输出状态
  const [loading, setLoading] = useState(false);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [generatedFeedback, setGeneratedFeedback] = useState('');
  const [knowledgeImageBase64, setKnowledgeImageBase64] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const fileInputRef = useRef(null);

  // 初始化加载语音备忘录列表
  useEffect(() => {
    fetchVoiceMemos();
  }, []);

  const fetchVoiceMemos = async () => {
    try {
      const res = await fetch(`${API_BASE}/voice-memos`);
      const result = await res.json();
      if (result.success) {
        setVoiceMemos(result.data);
      }
    } catch (err) {
      console.warn('获取备忘录列表提示:', err.message);
    }
  };

  // 保存 API Key
  const handleSaveApiKey = (e) => {
    e.preventDefault();
    localStorage.setItem('gemini_api_key', apiKey.trim());
    setShowApiKeyInput(false);
  };

  // 清除 API Key
  const handleClearApiKey = () => {
    localStorage.removeItem('gemini_api_key');
    setApiKey('');
    setShowApiKeyInput(true);
  };

  // 拖拽音频文件/macOS语音备忘录卡片处理
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    setError('');
    setDropNotice('');

    // 1. 尝试从 e.dataTransfer.files 获取真正拖入的文件 (文件模式)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith('audio/') || file.name.endsWith('.m4a') || file.name.endsWith('.mp3') || file.name.endsWith('.wav')) {
        setCustomAudioFile(file);
        setSelectedMemo(null);
        setInputType('audio');
        setDropNotice(`已通过文件拖拽导入：${file.name}`);
        return;
      }
    }

    // 2. 尝试从 macOS 语音备忘录直接拖拽卡片（解析 text/plain 或 text/uri-list）
    const draggedText = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text/uri-list');
    if (draggedText && draggedText.trim()) {
      const cleanTitle = draggedText.trim().replace(/^file:\/\//, '').split('\n')[0];
      console.log('[DragDrop] 捕获到来自 macOS 语音备忘录卡片的内容:', cleanTitle);

      // 在从后端扫描到的 voiceMemos 列表中精准寻找名字相符的录音文件
      const matched = voiceMemos.find(m => 
        m.name === cleanTitle || 
        m.name.includes(cleanTitle) || 
        cleanTitle.includes(m.name) ||
        (m.path && m.path.includes(cleanTitle))
      );

      if (matched) {
        setSelectedMemo(matched);
        setCustomAudioFile(null);
        setInputType('audio');
        setDropNotice(`✨ 成功匹配并选取备忘录：“${matched.name}”`);
        return;
      } else {
        // 如果系统沙盒未扫描到该文件，提示教师直接使用文件或自动重新同步
        setDropNotice(`已捕获拖入卡片：“${cleanTitle}”。正在刷新系统录音库...`);
        await fetchVoiceMemos();
      }
    }
  };

  const handleFileSelect = (e) => {
    if (e.target.files && e.target.files[0]) {
      setCustomAudioFile(e.target.files[0]);
      setSelectedMemo(null);
      setError('');
      setDropNotice(`已选择音频文件：${e.target.files[0].name}`);
    }
  };

  // 核心生成逻辑
  const handleGenerate = async () => {
    if (!apiKey) {
      setError('请先在右上角配置并保存您的 Gemini API Key');
      setShowApiKeyInput(true);
      return;
    }

    setLoading(true);
    setError('');
    setGeneratedFeedback('');
    setKnowledgeImageBase64('');
    
    const formData = new FormData();
    formData.append('apiKey', apiKey.trim());
    formData.append('type', inputType);
    formData.append('studentName', studentName.trim());
    formData.append('imageStyle', imageStyle);

    if (inputType === 'text') {
      if (!transcriptText || !transcriptText.trim()) {
        setError('请输入或粘贴课堂文字稿/逐字稿内容');
        setLoading(false);
        return;
      }
      formData.append('transcript', transcriptText.trim());
      setLoadingStatus('正在使用 gemini-3.5-flash 解析逐字稿，并使用中文智能提炼生成知识点总结图...');
    } else {
      if (selectedMemo) {
        formData.append('memoPath', selectedMemo.path);
        setLoadingStatus(`正在读取语音备忘录“${selectedMemo.name}”，提取音频要点并生成图文反馈...`);
      } else if (customAudioFile) {
        formData.append('audioFile', customAudioFile);
        setLoadingStatus(`正在上传“${customAudioFile.name}”，进行音视频分析并生成知识图谱...`);
      } else {
        setError('请在左侧列表中选择语音备忘录，或直接从 macOS 语音备忘录窗口拖拽卡片到此处');
        setLoading(false);
        return;
      }
    }

    try {
      const response = await fetch(`${API_BASE}/generate-feedback`, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      if (data.success) {
        setGeneratedFeedback(data.feedback);
        if (data.imageBase64) {
          setKnowledgeImageBase64(data.imageBase64);
        }
      } else {
        setError(data.message || '生成课后反馈失败，请检查 API Key 或重试');
      }
    } catch (err) {
      setError('无法连接本地后端服务。请确认后台服务正在正常运行。');
    } finally {
      setLoading(false);
      setLoadingStatus('');
    }
  };

  // 复制纯文本到剪贴板
  const handleCopy = () => {
    if (!generatedFeedback) return;
    navigator.clipboard.writeText(generatedFeedback);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // 导出与选择路径保存 PDF
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
          feedbackText: generatedFeedback,
          imageBase64: knowledgeImageBase64
        })
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || '服务器生成 PDF 失败');
      }

      const blob = await res.blob();
      const defaultFilename = `语文课后反馈_${studentName.trim() || '学员'}_${new Date().toISOString().slice(0, 10)}.pdf`;

      // 判断是否运行在 Electron 桌面端环境
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
        // Web 浏览器降级模式
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

  // 渲染大尺寸知识点总结图卡片（位于课堂记录之后，课堂回顾之前）
  const renderTextWithImageInBetween = () => {
    if (!generatedFeedback) return null;

    const lines = generatedFeedback.split('\n');
    const recordLines = [];
    const restLines = [];
    let foundReview = false;

    for (const line of lines) {
      if (line.includes('课堂回顾：') || foundReview) {
        foundReview = true;
        restLines.push(line);
      } else {
        recordLines.push(line);
      }
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {/* 1. 课堂记录模块 */}
        {recordLines.length > 0 && (
          <div style={{ whiteSpace: 'pre-wrap', background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: 'var(--radius-md)', borderLeft: '4px solid var(--primary)' }}>
            {recordLines.join('\n').trim()}
          </div>
        )}

        {/* 2. 知识点总结图卡片（位于课堂记录之后，课堂回顾之前） */}
        {knowledgeImageBase64 && (
          <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--panel-border-hover)', borderRadius: 'var(--radius-md)', padding: '1.2rem', textAlign: 'center' }}>
            <div style={{ fontSize: '0.95rem', color: 'var(--accent)', fontWeight: '600', marginBottom: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              本课核心中文知识要点总结图 (100% 汉字矢量高清晰展示)
            </div>
            <img
              src={`data:image/jpeg;base64,${knowledgeImageBase64}`}
              alt="知识点总结图"
              style={{ maxWidth: '100%', maxHeight: '480px', borderRadius: 'var(--radius-sm)', objectFit: 'contain', boxShadow: '0 10px 25px rgba(0,0,0,0.6)', cursor: 'pointer' }}
              title="本图已按中文矢量提炼合成，字字清晰无乱码"
            />
          </div>
        )}

        {/* 3. 课堂回顾及后续所有模块 */}
        {restLines.length > 0 && (
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.8' }}>
            {restLines.join('\n').trim()}
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
            macOS 独立桌面端 | 模块色块 PDF 设计 · 语音备忘录直接拖拽导入 · 纯中文知识要点图
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          {apiKey ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)', padding: '0.4rem 0.8rem', borderRadius: 'var(--radius-sm)' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--success)' }}></span>
              <span style={{ fontSize: '0.85rem', color: 'var(--success)' }}>Gemini API 已就绪</span>
              <button onClick={handleClearApiKey} className="btn-secondary" style={{ padding: '0.15rem 0.4rem', fontSize: '0.75rem', borderRadius: '4px' }}>修改</button>
            </div>
          ) : (
            <button onClick={() => setShowApiKeyInput(true)} className="btn-secondary" style={{ borderColor: 'var(--warning)', color: 'var(--warning)', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
              配置 API Key
            </button>
          )}
        </div>
      </header>

      {/* API Key 设置模态面板 */}
      {showApiKeyInput && (
        <div className="glass-panel" style={{ padding: '1.5rem', borderLeft: '4px solid var(--primary)', animation: 'pulseGlow 2s infinite' }}>
          <form onSubmit={handleSaveApiKey} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <h3 style={{ fontSize: '1.1rem', marginBottom: '0.25rem' }}>配置 Gemini API 密钥</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                系统使用配置在 backend/.env 中的 gemini-3.5-flash 生成反馈。您可以在下方填入您的 Gemini API 密钥并保存。
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <input
                type="password"
                placeholder="请输入您的 Gemini API Key (例如 AIzaSy...)"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="form-input"
                required
              />
              <button type="submit" className="btn-primary">保存配置</button>
              {localStorage.getItem('gemini_api_key') && (
                <button type="button" onClick={() => setShowApiKeyInput(false)} className="btn-secondary">取消</button>
              )}
            </div>
          </form>
        </div>
      )}

      {/* 核心工作区 */}
      <main className="grid-cols-2">
        {/* 左侧：输入源与配置 */}
        <section className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* 学生姓名指定 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              学生姓名（反馈代词精准替换）：
            </label>
            <input
              type="text"
              placeholder="请输入学生姓名（例如：彭梓辰 / 张三），助手将全篇精准使用该姓名"
              value={studentName}
              onChange={(e) => setStudentName(e.target.value)}
              className="form-input"
              style={{ fontSize: '0.9rem' }}
            />
          </div>

          {/* 知识点总结图的视觉风格选择 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
              视觉知识点总结图生成风格：
            </label>
            <select
              value={imageStyle}
              onChange={(e) => setImageStyle(e.target.value)}
              className="form-input"
              style={{ fontSize: '0.9rem', background: 'rgba(21, 16, 42, 0.9)', color: 'var(--text-primary)', cursor: 'pointer' }}
            >
              <option value="chinese_ink">🎋 国风水墨配合（优雅中式宣纸与水墨意境）</option>
              <option value="tech_3d">💎 3D 科技智绘（磨砂玻璃与三维总结脑图）</option>
              <option value="minimalist">📐 现代极简流光（清爽矢量图形与极简布局）</option>
              <option value="hand_drawn">🎨 温馨童趣手抄报（生动活泼的手绘风格）</option>
            </select>
          </div>

          {/* 输入源切换 Tabs */}
          <div style={{ display: 'flex', background: 'rgba(0,0,0,0.15)', padding: '0.3rem', borderRadius: 'var(--radius-md)' }}>
            <button
              onClick={() => setInputType('audio')}
              className={inputType === 'audio' ? 'btn-primary' : 'btn-secondary'}
              style={{ flex: 1, padding: '0.6rem', borderRadius: 'var(--radius-sm)', background: inputType === 'audio' ? '' : 'transparent', border: 'none' }}
            >
              录音文件处理
            </button>
            <button
              onClick={() => setInputType('text')}
              className={inputType === 'text' ? 'btn-primary' : 'btn-secondary'}
              style={{ flex: 1, padding: '0.6rem', borderRadius: 'var(--radius-sm)', background: inputType === 'text' ? '' : 'transparent', border: 'none' }}
            >
              课堂文字稿分析
            </button>
          </div>

          {/* 渲染音频输入模块 */}
          {inputType === 'audio' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
              <div>
                <h4 style={{ fontSize: '0.95rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                  方式一：拖拽或选择录音文件（支持 .m4a、.mp3、.wav）
                </h4>
                <div
                  onDragEnter={handleDrag}
                  onDragOver={handleDrag}
                  onDragLeave={handleDrag}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: dragActive ? '2px dashed var(--accent)' : '2px dashed var(--panel-border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '1.5rem 1rem',
                    textAlign: 'center',
                    background: dragActive ? 'rgba(6, 182, 212, 0.08)' : 'rgba(0,0,0,0.1)',
                    cursor: 'pointer',
                    transition: 'var(--transition)',
                  }}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="audio/*,.m4a"
                    onChange={handleFileSelect}
                    style={{ display: 'none' }}
                  />
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="1.5" style={{ marginBottom: '0.3rem', color: dragActive ? 'var(--accent)' : '' }}>
                    <path d="M12 5v14M5 12h14" strokeLinecap="round"/>
                  </svg>
                  <p style={{ fontSize: '0.88rem', color: 'var(--text-primary)', fontWeight: '500' }}>
                    {selectedMemo ? `已选定备忘录：${selectedMemo.name}` : customAudioFile ? `已选择文件：${customAudioFile.name}` : '点击浏览 或 从 macOS 语音备忘录直接拖拽卡片到此处'}
                  </p>
                  <p style={{ fontSize: '0.75rem', color: 'var(--accent)', marginTop: '0.3rem' }}>
                    💡 小提示：您可以直接从 macOS 语音备忘录窗口中拖动条目（如“七华路 5”）至此区！
                  </p>
                  {(customAudioFile || selectedMemo) && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setCustomAudioFile(null);
                        setSelectedMemo(null);
                        setDropNotice('');
                      }}
                      className="btn-secondary"
                      style={{ padding: '0.15rem 0.5rem', fontSize: '0.75rem', marginTop: '0.5rem', borderRadius: '4px' }}
                    >
                      清除选择
                    </button>
                  )}
                </div>

                {/* 拖拽提示 Badge */}
                {dropNotice && (
                  <div style={{ marginTop: '0.5rem', padding: '0.5rem 0.75rem', background: 'rgba(6, 182, 212, 0.1)', border: '1px solid rgba(6, 182, 212, 0.25)', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem', color: 'var(--accent)' }}>
                    {dropNotice}
                  </div>
                )}
              </div>

              {/* macOS 备忘录管理 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h4 style={{ fontSize: '0.95rem', color: 'var(--text-secondary)' }}>
                    方式二：macOS 语音导入（快速导入）
                  </h4>
                  <button onClick={fetchVoiceMemos} style={{ background: 'transparent', padding: '0.2rem', color: 'var(--primary)' }} title="刷新备忘录列表">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l.73-.73"/>
                    </svg>
                  </button>
                </div>
                
                <div style={{ maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.4rem', background: 'rgba(0,0,0,0.15)', padding: '0.5rem', borderRadius: 'var(--radius-md)' }}>
                  {voiceMemos.length > 0 ? (
                    voiceMemos.map((memo) => (
                      <div
                        key={memo.id}
                        onClick={() => {
                          setSelectedMemo(memo);
                          setCustomAudioFile(null);
                          setDropNotice(`已选中：${memo.name}`);
                        }}
                        className={`list-item-card ${selectedMemo?.id === memo.id ? 'selected' : ''}`}
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0.75rem' }}
                      >
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: '1rem', textAlign: 'left' }}>
                          <div style={{ fontWeight: '500', fontSize: '0.85rem' }}>{memo.name}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                            {new Date(memo.createdAt).toLocaleString('zh-CN', { hour12: false })}
                          </div>
                        </div>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.04)', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>
                          {memo.duration || `${(memo.size / 1024 / 1024).toFixed(1)}M`}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div style={{ padding: '1.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                      支持直接从 macOS 语音备忘录窗口中拖拽卡片至上方放置区。
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 渲染文本输入模块 */}
          {inputType === 'text' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1 }}>
              <h4 style={{ fontSize: '0.95rem', color: 'var(--text-secondary)' }}>
                请输入或粘贴课堂文字稿 (逐字稿)：
              </h4>
              <textarea
                placeholder="在此粘贴教师授课记录、师生互动逐字稿... 后端将使用 gemini-3.5-flash 深度分析，并自动输出 WPS 纯文本反馈。"
                value={transcriptText}
                onChange={(e) => setTranscriptText(e.target.value)}
                className="form-input"
                style={{ height: '260px', resize: 'none', lineHeight: '1.6', fontSize: '0.9rem' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                <span>即使文字稿中未提及姓名，助手也会全篇精准使用设定的学生姓名</span>
                <span>字数: {transcriptText ? transcriptText.length : 0} 字</span>
              </div>
            </div>
          )}

          {/* 执行生成按钮 */}
          <button
            onClick={handleGenerate}
            disabled={loading || (inputType === 'audio' && !selectedMemo && !customAudioFile) || (inputType === 'text' && (!transcriptText || !transcriptText.trim()))}
            className="btn-primary"
            style={{ width: '100%', padding: '0.9rem', fontSize: '1.05rem', marginTop: 'auto', background: 'linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%)' }}
          >
            {loading ? (
              <>
                <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.49 8.49l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.49-8.49l2.83-2.83"/>
                </svg>
                <span>正在分析并绘制中文知识图...</span>
              </>
            ) : (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                  <line x1="12" y1="22.08" x2="12" y2="12"/>
                </svg>
                <span>生成图文课后反馈</span>
              </>
            )}
          </button>
        </section>

        {/* 右侧：生成与输出区域 */}
        <section className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', minHeight: '520px', position: 'relative' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: generatedFeedback ? 'var(--success)' : 'var(--text-muted)' }}></span>
              课后反馈与知识反馈
            </h3>
            
            {generatedFeedback && (
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  onClick={handleCopy}
                  className="btn-secondary"
                  style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
                >
                  {copied ? '已复制纯文本!' : '复制纯文本'}
                </button>
                <button
                  onClick={handleExportPDF}
                  disabled={pdfExporting}
                  className="btn-primary"
                  style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', background: 'linear-gradient(135deg, var(--secondary) 0%, var(--primary) 100%)' }}
                >
                  {pdfExporting ? '导出中...' : '保存/导出PDF'}
                </button>
              </div>
            )}
          </div>

          {/* 渲染区域 */}
          <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column' }}>
            {loading && (
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(15, 12, 27, 0.85)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-md)', zIndex: 10 }}>
                <svg className="animate-spin" width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="3" style={{ marginBottom: '1rem' }}>
                  <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.49 8.49l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.49-8.49l2.83-2.83"/>
                </svg>
                <div style={{ fontWeight: '600', color: 'var(--text-primary)', fontSize: '1rem', padding: '0 1.5rem', textAlign: 'center', lineHeight: '1.5' }}>
                  {loadingStatus}
                </div>
              </div>
            )}

            {error && (
              <div style={{ padding: '1rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: 'var(--radius-md)', color: 'var(--danger)', fontSize: '0.9rem', marginBottom: '1rem', textAlign: 'left' }}>
                <strong>提示/报错：</strong> {error}
              </div>
            )}

            {generatedFeedback ? (
              <div
                style={{
                  flex: 1,
                  background: 'rgba(0, 0, 0, 0.25)',
                  border: '1px solid var(--panel-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '1.25rem',
                  fontFamily: 'var(--font-sans)',
                  fontSize: '0.95rem',
                  lineHeight: '1.7',
                  color: 'var(--text-primary)',
                  overflowY: 'auto',
                  textAlign: 'left',
                  userSelect: 'text',
                }}
              >
                {renderTextWithImageInBetween()}
              </div>
            ) : (
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'column',
                  gap: '1rem',
                  border: '1px dashed var(--panel-border)',
                  borderRadius: 'var(--radius-md)',
                  background: 'rgba(0,0,0,0.1)',
                  color: 'var(--text-muted)',
                  padding: '2rem',
                }}
              >
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" style={{ strokeDasharray: '4 4' }}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                </svg>
                <div style={{ fontSize: '0.9rem', textAlign: 'center' }}>
                  等待生成反馈内容。请在界面指定学生姓名并选择输入源，点击“生成图文课后反馈”。
                </div>
              </div>
            )}
          </div>
        </section>
      </main>

      {/* 底部 Footer */}
      <footer style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem', padding: '0.5rem 0', marginTop: 'auto' }}>
        反馈助手 macOS 独立桌面端 © 2026. 支持多风格中文知识卡图绘制与高品质 PDF 导出
      </footer>
    </div>
  );
}
