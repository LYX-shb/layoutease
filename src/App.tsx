import { useEffect, useRef, useState } from 'react';

type Viewport = 'desktop' | 'tablet' | 'mobilePortrait' | 'mobileLandscape';
type StyleKey = 'fontSize' | 'color' | 'width' | 'height' | 'margin' | 'padding' | 'backgroundImage' | 'transform';
type ElementStyles = Record<StyleKey, string>;

const viewports: Record<Viewport, { label: string; width: number; height: number }> = {
  desktop: { label: '电脑', width: 1440, height: 900 },
  tablet: { label: '平板', width: 1024, height: 768 },
  mobilePortrait: { label: '手机竖屏', width: 390, height: 844 },
  mobileLandscape: { label: '手机横屏', width: 844, height: 390 },
};

const emptyStyles = (): ElementStyles => ({ fontSize: '', color: '', width: '', height: '', margin: '', padding: '', backgroundImage: '', transform: '' });

type SelectedElement = {
  id: string;
  auto?: boolean;
  tag: string;
  path?: string;
  tagIndex?: number;
  selector?: string;
  sourceType?: 'html' | 'dynamic';
  text: string;
  className?: string;
  outerHTML?: string;
  src?: string;
  rect: { x: number; y: number; width: number; height: number };
  styles: ElementStyles;
};

type EditorChange = {
  id: string;
  kind: 'style' | 'text';
  property?: StyleKey;
  before: string;
  after: string;
};

type Version = { id: string; pagePath: string; createdAt: string };

function StartView({ onOpen }: { onOpen: () => Promise<void> }) {
  const [message, setMessage] = useState('请选择一个主题单元项目开始');

  async function handleOpen() {
    setMessage('正在等待选择项目…');
    await onOpen();
  }

  return (
    <main className="app-shell">
      <section className="welcome-card" aria-labelledby="app-title">
        <div className="brand-mark" aria-hidden="true">单</div>
        <p className="eyebrow">INTERACTIVE LEARNING EDITOR</p>
        <h1 id="app-title">主题单元编辑器</h1>
        <p className="intro">在真实网页中调整界面，并保留原有交互逻辑。</p>
        <button className="primary-button" type="button" onClick={handleOpen}>打开主题单元</button>
        <p className="status" role="status">{message}</p>
        <div className="next-step"><span className="step-number">01</span><span>选择一个包含 HTML、CSS、JS 的项目文件夹</span></div>
      </section>
    </main>
  );
}

function EditorView({ project, onClose }: { project: Extract<OpenProjectResult, { ok: true }>; onClose: () => void }) {
  const initialViewport = project.settings?.mobileOrientation || 'desktop';
  const [viewport, setViewport] = useState<Viewport>(initialViewport);
  const [mode, setMode] = useState<'edit' | 'test'>('edit');
  const [currentPage, setCurrentPage] = useState(project.pages.find((page) => page.path === 'index.html') || project.pages[0] || { path: 'index.html', url: project.entryUrl });
  const [selected, setSelected] = useState<SelectedElement | null>(null);
  const [undoStack, setUndoStack] = useState<EditorChange[]>([]);
  const [redoStack, setRedoStack] = useState<EditorChange[]>([]);
  const [dirty, setDirty] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [draftStyles, setDraftStyles] = useState<ElementStyles>(emptyStyles());
  const [saveMessage, setSaveMessage] = useState('');
  const [versionOpen, setVersionOpen] = useState(false);
  const [versions, setVersions] = useState<Version[]>([]);
  const [versionMessage, setVersionMessage] = useState('');
  const [previewNonce, setPreviewNonce] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const previewAreaRef = useRef<HTMLElement>(null);
  const currentPageRef = useRef(currentPage);
  const selectedIdRef = useRef('');
  const changedStyleKeysRef = useRef<Set<StyleKey>>(new Set());
  const textChangedRef = useRef(false);
  const currentViewport = viewports[viewport];
  const [previewScale, setPreviewScale] = useState(1);

  useEffect(() => { currentPageRef.current = currentPage; }, [currentPage]);

  useEffect(() => {
    const area = previewAreaRef.current;
    if (!area) return;
    const updateScale = () => {
      const availableWidth = Math.max(240, area.clientWidth - 48);
      const availableHeight = Math.max(240, area.clientHeight - 84);
      setPreviewScale(Math.min(1, availableWidth / currentViewport.width, availableHeight / currentViewport.height));
    };
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(area);
    return () => observer.disconnect();
  }, [currentViewport.width, currentViewport.height]);

  useEffect(() => {
    if (!selected) {
      selectedIdRef.current = '';
      changedStyleKeysRef.current.clear();
      textChangedRef.current = false;
      return;
    }
    if (selectedIdRef.current !== selected.id) {
      selectedIdRef.current = selected.id;
      changedStyleKeysRef.current.clear();
      textChangedRef.current = false;
    }
    setDraftText(selected.text);
    setDraftStyles({ ...emptyStyles(), ...selected.styles });
  }, [selected]);

  useEffect(() => {
    function handlePreviewMessage(event: MessageEvent) {
      if (!event.data || event.data.source !== 'theme-unit-editor') return;
      if (event.data.type === 'ready' && typeof event.data.pagePath === 'string') {
        const page = project.pages.find((item) => item.path === event.data.pagePath);
        if (page && page.path !== currentPageRef.current.path) {
          setCurrentPage(page);
          setSelected(null);
          setUndoStack([]);
          setRedoStack([]);
          setDirty(false);
          setSaveMessage(`已切换到 ${page.path}`);
        }
        return;
      }
      if (event.data.type === 'selected') {
        setSelected({ ...event.data, styles: { ...emptyStyles(), ...event.data.styles } } as SelectedElement);
      }
      if (event.data.type === 'changed') {
        const change: EditorChange = { id: event.data.id, kind: 'style', property: event.data.property, before: event.data.before, after: event.data.after };
        setUndoStack((current) => [...current.slice(-99), change]);
        setRedoStack([]);
        setDirty(true);
        changedStyleKeysRef.current.add(event.data.property as StyleKey);
        setSelected((current) => current && current.id === event.data.id ? { ...current, styles: { ...current.styles, [event.data.property]: event.data.after } } : current);
      }
    }
    window.addEventListener('message', handlePreviewMessage);
    return () => window.removeEventListener('message', handlePreviewMessage);
  }, []);

  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage({ source: 'theme-unit-editor', type: 'set-mode', mode }, '*');
  }, [mode, currentPage, previewNonce]);

  function sendToPreview(message: Record<string, string>) {
    iframeRef.current?.contentWindow?.postMessage({ source: 'theme-unit-editor', ...message }, '*');
  }

  function addChange(change: EditorChange) {
    if (change.before === change.after) return;
    setUndoStack((current) => [...current.slice(-99), change]);
    setRedoStack([]);
    setDirty(true);
  }

  function applyChange(change: EditorChange, value: string) {
    if (change.kind === 'text') {
      setDraftText(value);
      setSelected((current) => current && current.id === change.id ? { ...current, text: value } : current);
      sendToPreview({ type: 'apply-text', id: change.id, value });
    } else {
      const property = change.property || 'transform';
      setDraftStyles((current) => ({ ...current, [property]: value }));
      setSelected((current) => current && current.id === change.id ? { ...current, styles: { ...current.styles, [property]: value } } : current);
      sendToPreview({ type: 'apply-style', id: change.id, property, value });
    }
  }

  function undo() {
    const change = undoStack[undoStack.length - 1];
    if (!change) return;
    applyChange(change, change.before);
    setUndoStack((current) => current.slice(0, -1));
    setRedoStack((current) => [...current.slice(-99), change]);
    setDirty(true);
  }

  function redo() {
    const change = redoStack[redoStack.length - 1];
    if (!change) return;
    applyChange(change, change.after);
    setRedoStack((current) => current.slice(0, -1));
    setUndoStack((current) => [...current.slice(-99), change]);
    setDirty(true);
  }

  function handleTextChange(value: string) {
    if (!selected) return;
    addChange({ id: selected.id, kind: 'text', before: draftText, after: value });
    textChangedRef.current = true;
    setDraftText(value);
    setSaveMessage('');
    sendToPreview({ type: 'apply-text', id: selected.id, value });
  }

  function handleStyleChange(property: StyleKey, value: string) {
    if (!selected) return;
    addChange({ id: selected.id, kind: 'style', property, before: draftStyles[property], after: value });
    changedStyleKeysRef.current.add(property);
    setDraftStyles((current) => ({ ...current, [property]: value }));
    setSelected((current) => current ? { ...current, styles: { ...current.styles, [property]: value } } : current);
    setSaveMessage('');
    sendToPreview({ type: 'apply-style', id: selected.id, property, value });
  }

  async function saveElement() {
    if (!selected) return;
    const stylesToSave = Object.fromEntries(Array.from(changedStyleKeysRef.current).map((property) => [property, draftStyles[property]]));
    const result = await window.editorBridge.saveElement({
      projectId: project.id,
      pagePath: currentPage.path,
      id: selected.id,
      viewport,
      auto: selected.auto || selected.sourceType === 'dynamic',
      sourceType: selected.sourceType,
      text: textChangedRef.current ? draftText : undefined,
      tag: selected.tag,
      path: selected.path,
      tagIndex: selected.tagIndex,
      selector: selected.selector,
      className: selected.className,
      outerHTML: selected.outerHTML,
      styles: stylesToSave,
      attributes: selected.src ? { src: selected.src } : {},
    });
    if (!result.ok) { setSaveMessage(result.error); return; }
    setDirty(false);
    setSelected((current) => current ? { ...current, auto: false } : current);
    setSaveMessage(`已保存到 ${currentPage.path}`);
  }

  async function replaceImage() {
    const isImage = selected?.tag === 'img';
    const hasBackground = Boolean(selected?.styles.backgroundImage && selected.styles.backgroundImage !== 'none');
    if (!selected || (!isImage && !hasBackground)) return;
    const sourcePath = await window.editorBridge.chooseAsset();
    if (!sourcePath) return;
    const result = await window.editorBridge.copyAsset({ projectId: project.id, pagePath: currentPage.path, sourcePath });
    if (!result.ok) { setSaveMessage(result.error); return; }
    if (isImage) {
      sendToPreview({ type: 'apply-attribute', id: selected.id, name: 'src', value: result.relativePath });
      setSelected({ ...selected, src: result.relativePath });
    } else {
      const backgroundImage = `url("${result.relativePath}")`;
      changedStyleKeysRef.current.add('backgroundImage');
      sendToPreview({ type: 'apply-style', id: selected.id, property: 'backgroundImage', value: backgroundImage });
      setDraftStyles((current) => ({ ...current, backgroundImage }));
      setSelected({ ...selected, styles: { ...selected.styles, backgroundImage } });
    }
    setDirty(true);
    setSaveMessage('素材已替换到预览，点击保存写回页面');
  }

  async function chooseViewport(next: Viewport) {
    setViewport(next);
    if (next === 'mobilePortrait' || next === 'mobileLandscape') {
      const result = await window.editorBridge.saveSettings({ projectId: project.id, mobileOrientation: next });
      if (!result.ok) setSaveMessage(result.error);
    }
  }

  async function openVersions() {
    const result = await window.editorBridge.listVersions({ projectId: project.id, pagePath: currentPage.path });
    if (!result.ok) { setVersionMessage(result.error); return; }
    setVersions(result.versions);
    setVersionMessage(result.versions.length ? '' : '当前页面还没有保存版本');
    setVersionOpen(true);
  }

  async function restoreVersion(version: Version) {
    if (dirty && !window.confirm('当前还有未保存修改，恢复版本会丢弃这些修改，是否继续？')) return;
    const result = await window.editorBridge.restoreVersion({ projectId: project.id, pagePath: currentPage.path, versionId: version.id });
    if (!result.ok) { setVersionMessage(result.error); return; }
    setVersionOpen(false);
    setVersionMessage('已恢复版本，正在重新加载页面');
    setDirty(false);
    setSelected(null);
    setUndoStack([]);
    setRedoStack([]);
    setPreviewNonce((current) => current + 1);
  }

  function changePage(page: { path: string; url: string }) {
    if (dirty && !window.confirm('当前页面有未保存修改，切换页面会丢弃这些修改，是否继续？')) return;
    setCurrentPage(page);
    setSelected(null);
    setUndoStack([]);
    setRedoStack([]);
    setDirty(false);
    setSaveMessage('');
    setVersionOpen(false);
  }

  function closeProject() {
    if (dirty && !window.confirm('当前有未保存修改，关闭后会丢失，是否继续？')) return;
    onClose();
  }

  function reloadPreview() {
    if (dirty && !window.confirm('当前有未保存修改，刷新会丢弃预览修改，是否继续？')) return;
    setSelected(null);
    setDirty(false);
    setUndoStack([]);
    setRedoStack([]);
    setPreviewNonce((current) => current + 1);
  }

  const saveHasError = /失败|找不到|无效|失效|暂时/.test(saveMessage);

  return (
    <main className="editor-shell">
      <header className="editor-toolbar">
        <div className="toolbar-brand"><span className="toolbar-mark">单</span><strong>{project.name}</strong></div>
        <div className="viewport-switcher" aria-label="预览尺寸">
          {(Object.keys(viewports) as Viewport[]).map((key) => <button className={viewport === key ? 'toolbar-button active' : 'toolbar-button'} key={key} type="button" onClick={() => void chooseViewport(key)}>{viewports[key].label}</button>)}
        </div>
        <div className="mode-switcher" aria-label="编辑模式">
          <button className={mode === 'edit' ? 'toolbar-button active' : 'toolbar-button'} type="button" onClick={() => setMode('edit')}>编辑</button>
          <button className={mode === 'test' ? 'toolbar-button active' : 'toolbar-button'} type="button" onClick={() => setMode('test')}>测试</button>
        </div>
        <div className="toolbar-actions">
          <span className={dirty ? 'save-state dirty' : 'save-state'}>{dirty ? '有未保存修改' : '已保存'}</span>
          {saveMessage && <span className={saveHasError ? 'toolbar-save-message error' : 'toolbar-save-message'}>{saveMessage}</span>}
          <button className="toolbar-button" type="button" onClick={reloadPreview}>刷新</button>
          <button className="toolbar-button" type="button" disabled={undoStack.length === 0} onClick={undo}>撤销</button>
          <button className="toolbar-button" type="button" disabled={redoStack.length === 0} onClick={redo}>重做</button>
          <button className="toolbar-button" type="button" onClick={() => void openVersions()}>版本</button>
          <button className="toolbar-button primary-toolbar-button" type="button" disabled={!dirty || !selected} onClick={() => void saveElement()}>保存</button>
          <button className="toolbar-button" type="button" onClick={closeProject}>关闭项目</button>
        </div>
      </header>
      <section className="editor-body">
        <aside className="page-panel">
          <p className="panel-label">项目页面</p>
          {project.pages.map((page) => <button className={page.path === currentPage.path ? 'page-item active' : 'page-item'} key={page.path} type="button" onClick={() => changePage(page)}>{page.path}</button>)}
          <p className="panel-path">{project.rootPath}</p>
        </aside>
        <section ref={previewAreaRef} className="preview-area" aria-label="网页预览">
          <div className="preview-caption">{currentViewport.label} · {currentViewport.width} × {currentViewport.height} · {mode === 'edit' ? '编辑模式' : '测试模式'}</div>
          <div className="preview-stage" style={{ width: currentViewport.width * previewScale, height: currentViewport.height * previewScale }}>
            <div className="preview-frame" style={{ width: currentViewport.width, height: currentViewport.height, transform: `scale(${previewScale})` }}>
              <iframe key={`${currentPage.path}-${previewNonce}`} ref={iframeRef} title="主题单元预览" src={currentPage.url} onLoad={() => iframeRef.current?.contentWindow?.postMessage({ source: 'theme-unit-editor', type: 'set-mode', mode }, '*')} sandbox="allow-scripts allow-same-origin allow-forms allow-modals" />
            </div>
          </div>
        </section>
        <aside className="inspector-panel">
          <p className="panel-label">元素属性</p>
          {selected ? <>
            <div className="selected-title">{selected.id}</div>
            <div className="selected-tag">{selected.tag}{selected.sourceType === 'dynamic' || selected.auto ? ' · 动态生成' : ' · HTML'}</div>
            <label className="property-row"><span>文字内容</span><textarea value={draftText} onChange={(event) => handleTextChange(event.target.value)} /></label>
            <div className="property-grid">
              {([['fontSize', '字号'], ['width', '宽度'], ['height', '高度'], ['margin', '外边距'], ['padding', '内边距'], ['color', '颜色']] as Array<[StyleKey, string]>).map(([property, label]) => <label className="property-row" key={property}><span>{label}</span><input value={draftStyles[property]} onChange={(event) => handleStyleChange(property, event.target.value)} placeholder="保持原值" /></label>)}
            </div>
            {((selected.tag === 'img') || (selected.styles.backgroundImage && selected.styles.backgroundImage !== 'none')) && <button className="asset-button" type="button" onClick={() => void replaceImage()}>{selected.tag === 'img' ? '替换图片' : '替换背景图'}</button>}
            <div className="selection-help">编辑模式：点击选中，按住拖动移动。测试模式：直接操作网页。</div>
            {selected.auto && <div className="selection-warning">这是普通网页元素，保存时编辑器会自动找到它并建立标识，不需要手动改 HTML。</div>}
            {saveMessage && <div className={saveHasError ? 'save-message error-text' : 'save-message'}>{saveMessage}</div>}
          </> : <p className="empty-inspector">{mode === 'edit' ? '点击预览中的元素进行编辑。' : '测试模式下可以直接操作网页。'}</p>}
        </aside>
      </section>
      {versionOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setVersionOpen(false)}><section className="version-modal" role="dialog" aria-modal="true" aria-labelledby="version-title" onMouseDown={(event) => event.stopPropagation()}><div className="version-header"><strong id="version-title">{currentPage.path} 的保存版本</strong><button className="close-button" type="button" onClick={() => setVersionOpen(false)}>×</button></div>{versionMessage && <p className="version-empty">{versionMessage}</p>}{versions.map((version) => <div className="version-row" key={version.id}><span>{new Date(version.createdAt).toLocaleString()}</span><button className="toolbar-button" type="button" onClick={() => void restoreVersion(version)}>恢复</button></div>)}</section></div>}
    </main>
  );
}

function App() {
  const [project, setProject] = useState<Extract<OpenProjectResult, { ok: true }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function openProject() {
    const result = await window.editorBridge.openProject();
    if (!result.ok) { setError(result.error); return; }
    setError(null);
    setProject(result);
  }

  if (project) return <EditorView project={project} onClose={() => setProject(null)} />;
  return <><StartView onOpen={openProject} />{error && <div className="error-toast" role="alert">{error}</div>}</>;
}

export default App;


