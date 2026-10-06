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
  sourceType?: 'html' | 'css' | 'dynamic';
  text: string;
  className?: string;
  outerHTML?: string;
  src?: string;
  nestedImage?: { selector: string; src: string; index: number } | null;
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

type Version = { id: string; pagePath: string; name?: string; reason?: string; files?: string; fileList?: string[]; createdAt: string };
type InteractionAction = 'none' | 'navigate' | 'back' | 'show' | 'hide' | 'toggle' | 'classToggle' | 'play' | 'pause';
type AiSettingsDraft = { apiBaseUrl: string; apiFormat: 'chat-completions' | 'responses'; model: string; apiKeyConfigured: boolean };
type AiFileProposal = { path: string; content: string; originalContent: string };
type AiProposal = { summary: string; files: AiFileProposal[] };

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
  const [versionNameDraft, setVersionNameDraft] = useState('');
  const [interactionAction, setInteractionAction] = useState<InteractionAction>('none');
  const [interactionTarget, setInteractionTarget] = useState('');
  const [interactionPage, setInteractionPage] = useState('');
  const [interactionClassName, setInteractionClassName] = useState('');
  const [interactionDirty, setInteractionDirty] = useState(false);
  const [pickingInteractionTarget, setPickingInteractionTarget] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiSettings, setAiSettings] = useState<AiSettingsDraft>({ apiBaseUrl: 'https://api.openai.com/v1', apiFormat: 'chat-completions', model: '', apiKeyConfigured: false });
  const [aiKeyDraft, setAiKeyDraft] = useState('');
  const [aiContextFiles, setAiContextFiles] = useState<string[]>([]);
  const [aiSelectedFiles, setAiSelectedFiles] = useState<string[]>([]);
  const [aiRequest, setAiRequest] = useState('');
  const [aiProposal, setAiProposal] = useState<AiProposal | null>(null);
  const [aiStage, setAiStage] = useState<{ stageId: string; previewUrl: string } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMessage, setAiMessage] = useState('');
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
      setInteractionAction('none');
      setInteractionTarget('');
      setInteractionPage('');
      setInteractionClassName('');
      setInteractionDirty(false);
      return;
    }
    if (selectedIdRef.current !== selected.id) {
      selectedIdRef.current = selected.id;
      changedStyleKeysRef.current.clear();
      textChangedRef.current = false;
      setInteractionAction('none');
      setInteractionTarget('');
      setInteractionPage('');
      setInteractionClassName('');
      setInteractionDirty(false);
      setPickingInteractionTarget(false);
    }
    setDraftText(selected.text);
    setDraftStyles({ ...emptyStyles(), ...selected.styles });
  }, [selected]);

  useEffect(() => {
    const currentSelection = selected;
    if (!currentSelection?.selector) return;
    let cancelled = false;
    window.editorBridge.getInteraction({ projectId: project.id, pagePath: currentPage.path, sourceSelector: currentSelection.selector }).then((result) => {
      if (cancelled || !result.ok || selectedIdRef.current !== currentSelection.id) return;
      const interaction = result.interaction;
      setInteractionAction(interaction?.action || 'none');
      setInteractionTarget(interaction?.targetSelector || '');
      setInteractionPage(interaction?.targetPage || '');
      setInteractionClassName(interaction?.className || '');
      setInteractionDirty(false);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [selected?.id, currentPage.path, project.id]);

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
      if (event.data.type === 'target-selected') {
        setInteractionTarget(String(event.data.selector || ''));
        setPickingInteractionTarget(false);
        setInteractionDirty(true);
        setSaveMessage('已选择交互目标');
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

  async function saveElement(): Promise<boolean> {
    if (!selected) return false;
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
      nestedImage: selected.nestedImage || undefined,
    });
    if (!result.ok) { setSaveMessage(result.error); return false; }
    setDirty(false);
    setSelected((current) => current ? { ...current, auto: false } : current);
    setSaveMessage(`已保存到 ${currentPage.path}`);
    return true;
  }

  function changeInteractionAction(value: InteractionAction) {
    setInteractionAction(value);
    setInteractionDirty(true);
    setSaveMessage('');
  }

  function pickInteractionTarget() {
    if (!selected) return;
    setPickingInteractionTarget(true);
    setInteractionDirty(true);
    setSaveMessage('请点击预览中的目标元素');
    sendToPreview({ type: 'set-interaction-target', enabled: 'true' });
  }

  async function saveInteraction(): Promise<boolean> {
    if (!selected || !selected.selector) return false;
    const needsTarget = ['show', 'hide', 'toggle', 'classToggle', 'play', 'pause'].includes(interactionAction);
    if (needsTarget && !interactionTarget) { setSaveMessage('请先选择交互目标'); return false; }
    if (interactionAction === 'navigate' && !interactionPage) { setSaveMessage('请选择目标页面'); return false; }
    if (interactionAction === 'classToggle' && !interactionClassName.trim()) { setSaveMessage('请输入要切换的样式类名'); return false; }
    const result = await window.editorBridge.saveInteraction({
      projectId: project.id,
      pagePath: currentPage.path,
      sourceSelector: selected.selector,
      action: interactionAction,
      targetSelector: needsTarget ? interactionTarget : undefined,
      targetPage: interactionAction === 'navigate' ? interactionPage : undefined,
      className: interactionAction === 'classToggle' ? interactionClassName.trim() : undefined,
    });
    if (!result.ok) { setSaveMessage(result.error); return false; }
    setInteractionDirty(false);
    setSaveMessage(`交互已保存到 ${currentPage.path}`);
    return true;
  }

  async function saveAll() {
    if (dirty && !(await saveElement())) return;
    if (interactionDirty) await saveInteraction();
  }

  async function replaceImage() {
    const isImage = selected?.tag === 'img';
    const nestedImage = selected?.nestedImage || null;
    const hasBackground = Boolean(selected?.styles.backgroundImage && selected.styles.backgroundImage !== 'none');
    if (!selected || (!isImage && !nestedImage && !hasBackground)) return;
    const sourcePath = await window.editorBridge.chooseAsset();
    if (!sourcePath) return;
    const result = await window.editorBridge.copyAsset({ projectId: project.id, pagePath: currentPage.path, sourcePath });
    if (!result.ok) { setSaveMessage(result.error); return; }
    if (isImage) {
      sendToPreview({ type: 'apply-attribute', id: selected.id, name: 'src', value: result.relativePath });
      setSelected({ ...selected, src: result.relativePath });
    } else if (nestedImage) {
      sendToPreview({ type: 'apply-nested-attribute', id: selected.id, selector: nestedImage.selector, name: 'src', value: result.relativePath });
      setSelected({ ...selected, nestedImage: { ...nestedImage, src: result.relativePath } });
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
    setVersionNameDraft('');
    const result = await window.editorBridge.listVersions({ projectId: project.id });
    if (!result.ok) { setVersionMessage(result.error); return; }
    setVersions(result.versions);
    setVersionMessage(result.versions.length ? '' : '当前页面还没有保存版本');
    setVersionOpen(true);
  }

  async function createNamedVersion() {
    const name = versionNameDraft.trim();
    if (!name) { setVersionMessage('请输入版本名称'); return; }
    const result = await window.editorBridge.createVersion({ projectId: project.id, pagePath: currentPage.path, name });
    if (!result.ok) { setVersionMessage(result.error); return; }
    setVersionNameDraft('');
    setVersionMessage('项目版本已创建');
    await openVersions();
    setVersionMessage('项目版本已创建');
  }

  async function restoreVersion(version: Version) {
    if ((dirty || interactionDirty) && !window.confirm('当前还有未保存修改，恢复版本会丢弃这些修改，是否继续？')) return;
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

  async function deleteVersion(version: Version) {
    if (!window.confirm(`确定删除 ${new Date(version.createdAt).toLocaleString()} 的版本吗？删除后不能恢复。`)) return;
    const result = await window.editorBridge.deleteVersion({ projectId: project.id, versionId: version.id });
    if (!result.ok) { setVersionMessage(result.error); return; }
    setVersions((current) => current.filter((item) => item.id !== version.id));
    setVersionMessage('版本已删除');
  }

  async function openAiAssistant() {
    setAiOpen(true);
    setAiMessage('正在读取 API 配置和当前页面代码…');
    setAiProposal(null);
    setAiStage(null);
    const [settingsResult, contextResult] = await Promise.all([
      window.editorBridge.getAiSettings(),
      window.editorBridge.listAiContext({ projectId: project.id, pagePath: currentPage.path }),
    ]);
    if (settingsResult.ok) {
      setAiSettings({ apiBaseUrl: settingsResult.apiBaseUrl, apiFormat: settingsResult.apiFormat, model: settingsResult.model, apiKeyConfigured: settingsResult.apiKeyConfigured });
    }
    if (contextResult.ok) {
      setAiContextFiles(contextResult.files);
      setAiSelectedFiles(contextResult.recommended);
      setAiMessage(settingsResult.apiKeyConfigured ? '默认勾选当前页面及其引用的 CSS、JavaScript。' : '先填写自己的 API 地址、模型和密钥。');
    } else {
      setAiContextFiles([]);
      setAiSelectedFiles([]);
      setAiMessage(contextResult.error);
    }
  }

  async function saveAiSettings() {
    setAiBusy(true);
    setAiMessage('正在安全保存 API 配置…');
    const result = await window.editorBridge.saveAiSettings({ ...aiSettings, apiKey: aiKeyDraft });
    setAiBusy(false);
    if (!result.ok) { setAiMessage(result.error); return; }
    setAiSettings((current) => ({ ...current, apiKeyConfigured: result.apiKeyConfigured }));
    setAiKeyDraft('');
    setAiMessage('配置已加密保存在本机。');
  }

  async function testAiConnection() {
    setAiBusy(true);
    setAiMessage('正在测试 API 连接…');
    const result = await window.editorBridge.testAiConnection({ ...aiSettings, apiKey: aiKeyDraft });
    setAiBusy(false);
    setAiMessage(result.ok ? result.message : result.error);
  }

  async function generateAiProposal() {
    if (!aiSelectedFiles.length) { setAiMessage('至少选择一个代码文件作为上下文。'); return; }
    if (!aiRequest.trim()) { setAiMessage('请描述你希望 AI 编写的复杂交互逻辑。'); return; }
    setAiBusy(true);
    setAiMessage('AI 正在读取所选代码并生成修改方案…');
    setAiProposal(null);
    const result = await window.editorBridge.generateAiProposal({ projectId: project.id, pagePath: currentPage.path, request: aiRequest, contextFiles: aiSelectedFiles });
    setAiBusy(false);
    if (!result.ok) { setAiMessage(result.error); return; }
    setAiProposal(result.proposal);
    setAiMessage('方案已生成，查看文件差异后创建隔离预览。原项目尚未修改。');
  }

  async function createAiIsolatedPreview() {
    if (!aiProposal) return;
    setAiBusy(true);
    setAiMessage('正在复制项目并创建隔离预览…');
    const result = await window.editorBridge.createAiPreview({
      projectId: project.id,
      pagePath: currentPage.path,
      summary: aiProposal.summary,
      files: aiProposal.files.map(({ path, content }) => ({ path, content })),
    });
    setAiBusy(false);
    if (!result.ok) { setAiMessage(result.error); return; }
    setAiStage({ stageId: result.stageId, previewUrl: result.previewUrl });
    setAiMessage('这是隔离副本。可以在里面点击课件验证逻辑，原项目仍未修改。');
  }

  async function applyAiProposal() {
    if (!aiStage) return;
    setAiBusy(true);
    setAiMessage('正在创建修改前快照并应用方案…');
    const result = await window.editorBridge.applyAiProposal({ projectId: project.id, stageId: aiStage.stageId });
    setAiBusy(false);
    if (!result.ok) { setAiMessage(result.error); return; }
    setAiMessage(`已应用并保存到项目：${result.files.join('、')}`);
    setAiStage(null);
    setAiProposal(null);
    setAiOpen(false);
    setSelected(null);
    setDirty(false);
    setInteractionDirty(false);
    setPreviewNonce((current) => current + 1);
  }

  async function discardAiIsolatedPreview() {
    if (!aiStage) return;
    setAiBusy(true);
    const result = await window.editorBridge.closeAiPreview({ projectId: project.id, stageId: aiStage.stageId });
    setAiBusy(false);
    setAiStage(null);
    setAiMessage(result.ok ? '隔离预览已关闭，项目文件未修改。' : result.error);
  }

  async function closeAiAssistant() {
    if (aiStage) await window.editorBridge.closeAiPreview({ projectId: project.id, stageId: aiStage.stageId });
    setAiStage(null);
    setAiOpen(false);
  }

  function changePage(page: { path: string; url: string }) {
    if ((dirty || interactionDirty) && !window.confirm('当前页面有未保存修改，切换页面会丢弃这些修改，是否继续？')) return;
    setCurrentPage(page);
    setSelected(null);
    setUndoStack([]);
    setRedoStack([]);
    setDirty(false);
    setSaveMessage('');
    setVersionOpen(false);
  }

  function closeProject() {
    if ((dirty || interactionDirty) && !window.confirm('当前有未保存修改，关闭后会丢失，是否继续？')) return;
    onClose();
  }

  function reloadPreview() {
    if ((dirty || interactionDirty) && !window.confirm('当前有未保存修改，刷新会丢弃预览修改，是否继续？')) return;
    setSelected(null);
    setDirty(false);
    setUndoStack([]);
    setRedoStack([]);
    setPreviewNonce((current) => current + 1);
  }

  const saveHasError = /失败|找不到|无效|失效|暂时/.test(saveMessage);
  const hasUnsavedChanges = dirty || interactionDirty;

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
          <span className={hasUnsavedChanges ? 'save-state dirty' : 'save-state'}>{hasUnsavedChanges ? '有未保存修改' : '已保存'}</span>
          {saveMessage && <span className={saveHasError ? 'toolbar-save-message error' : 'toolbar-save-message'}>{saveMessage}</span>}
          <button className="toolbar-button" type="button" onClick={reloadPreview}>刷新</button>
          <button className="toolbar-button" type="button" disabled={undoStack.length === 0} onClick={undo}>撤销</button>
          <button className="toolbar-button" type="button" disabled={redoStack.length === 0} onClick={redo}>重做</button>
          <button className="toolbar-button" type="button" onClick={() => void openVersions()}>版本</button>
          <button className="toolbar-button" type="button" disabled={hasUnsavedChanges} title={hasUnsavedChanges ? '请先保存当前手动修改' : '让 AI 编写复杂交互逻辑'} onClick={() => void openAiAssistant()}>AI 代码</button>
          <button className="toolbar-button primary-toolbar-button" type="button" disabled={!hasUnsavedChanges || !selected} onClick={() => void saveAll()}>保存</button>
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
            <div className="selected-tag">{selected.tag}{selected.sourceType === 'dynamic' || selected.auto ? ' · JavaScript 动态生成' : selected.sourceType === 'css' ? ' · CSS 样式' : ' · HTML'}</div>
            <label className="property-row"><span>文字内容</span><textarea value={draftText} onChange={(event) => handleTextChange(event.target.value)} /></label>
            <div className="property-grid">
              {([['fontSize', '字号'], ['width', '宽度'], ['height', '高度'], ['margin', '外边距'], ['padding', '内边距'], ['color', '颜色']] as Array<[StyleKey, string]>).map(([property, label]) => <label className="property-row" key={property}><span>{label}</span><input value={draftStyles[property]} onChange={(event) => handleStyleChange(property, event.target.value)} placeholder="保持原值" /></label>)}
            </div>
            {((selected.tag === 'img') || selected.nestedImage || (selected.styles.backgroundImage && selected.styles.backgroundImage !== 'none')) && <button className="asset-button" type="button" onClick={() => void replaceImage()}>{selected.tag === 'img' ? '替换图片' : selected.nestedImage ? '替换按钮图片' : '替换背景图'}</button>}
            <section className="interaction-panel" aria-label="基础交互">
              <div className="interaction-title">基础交互</div>
              <label className="property-row"><span>点击后动作</span><select value={interactionAction} onChange={(event) => changeInteractionAction(event.target.value as InteractionAction)}><option value="none">不配置</option><option value="navigate">跳转页面</option><option value="back">返回上一页</option><option value="show">显示目标</option><option value="hide">隐藏目标</option><option value="toggle">切换显示</option><option value="classToggle">切换样式</option><option value="play">播放媒体</option><option value="pause">暂停媒体</option></select></label>
              {interactionAction === 'navigate' && <label className="property-row"><span>目标页面</span><select value={interactionPage} onChange={(event) => { setInteractionPage(event.target.value); setInteractionDirty(true); }}><option value="">请选择页面</option>{project.pages.map((page) => <option key={page.path} value={page.path}>{page.path}</option>)}</select></label>}
              {interactionAction === 'classToggle' && <label className="property-row"><span>样式类名</span><input value={interactionClassName} onChange={(event) => { setInteractionClassName(event.target.value); setInteractionDirty(true); }} placeholder="例如 is-active" /></label>}
              {interactionAction !== 'none' && interactionAction !== 'navigate' && interactionAction !== 'back' && <div className="interaction-target-row"><div className="interaction-target-value" title={interactionTarget}>{interactionTarget || '尚未选择目标'}</div><button className="toolbar-button" type="button" onClick={pickInteractionTarget}>{pickingInteractionTarget ? '请点击目标' : '选择目标'}</button></div>}
              {interactionAction !== 'none' && <p className="interaction-help">先选择动作；需要目标时点击“选择目标”，再点击预览中的元素，最后点击顶部“保存”。</p>}
            </section>
            <div className="selection-help">编辑模式：点击选中，按住拖动移动。测试模式：直接操作网页。</div>
            {selected.auto && <div className="selection-warning">这是普通网页元素，保存时编辑器会自动找到它并建立标识，不需要手动改 HTML。</div>}
            {saveMessage && <div className={saveHasError ? 'save-message error-text' : 'save-message'}>{saveMessage}</div>}
          </> : <p className="empty-inspector">{mode === 'edit' ? '点击预览中的元素进行编辑。' : '测试模式下可以直接操作网页。'}</p>}
        </aside>
      </section>
      {versionOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setVersionOpen(false)}><section className="version-modal" role="dialog" aria-modal="true" aria-labelledby="version-title" onMouseDown={(event) => event.stopPropagation()}><div className="version-header"><strong id="version-title">项目完整版本</strong><button className="close-button" type="button" onClick={() => setVersionOpen(false)}>×</button></div><div className="version-create-row"><input value={versionNameDraft} onChange={(event) => setVersionNameDraft(event.target.value)} placeholder={hasUnsavedChanges ? '请先保存修改，再创建版本' : '输入版本名称，例如：第一题完成'} disabled={hasUnsavedChanges} /><button className="toolbar-button" type="button" onClick={() => void createNamedVersion()} disabled={hasUnsavedChanges}>创建版本</button></div>{versionMessage && <p className="version-empty">{versionMessage}</p>}{versions.map((version) => <div className="version-row" key={version.id}><span><strong>{version.name || version.reason || '保存版本'}</strong><small>{new Date(version.createdAt).toLocaleString()} · {version.reason || '保存版本'} · {version.files || '当前页面'} · 来源页面：{version.pagePath}</small>{Boolean(version.fileList?.length) && <details><summary>查看快照文件</summary><small>{version.fileList?.join('、')}</small></details>}</span><div className="version-actions"><button className="toolbar-button" type="button" onClick={() => void restoreVersion(version)}>恢复</button><button className="toolbar-button danger-toolbar-button" type="button" onClick={() => void deleteVersion(version)}>删除</button></div></div>)}</section></div>}
      {aiOpen && <div className="modal-backdrop ai-backdrop" role="presentation" onMouseDown={() => void closeAiAssistant()}><section className={aiStage ? 'ai-modal ai-modal-preview' : 'ai-modal'} role="dialog" aria-modal="true" aria-labelledby="ai-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="ai-header"><div><strong id="ai-title">AI 交互逻辑助手</strong><p>让 AI 编写逻辑，先看差异，再在隔离副本测试。</p></div><button className="close-button" type="button" aria-label="关闭" onClick={() => void closeAiAssistant()}>×</button></div>
        {!aiStage ? <div className="ai-body">
          <section className="ai-section"><div className="ai-section-title">API 配置</div><div className="ai-config-grid">
            <label>API 地址<input value={aiSettings.apiBaseUrl} onChange={(event) => setAiSettings((current) => ({ ...current, apiBaseUrl: event.target.value }))} placeholder="https://api.openai.com/v1" /></label>
            <label>接口格式<select value={aiSettings.apiFormat} onChange={(event) => setAiSettings((current) => ({ ...current, apiFormat: event.target.value as AiSettingsDraft['apiFormat'] }))}><option value="chat-completions">Chat Completions</option><option value="responses">Responses</option></select></label>
            <label>模型名称<input value={aiSettings.model} onChange={(event) => setAiSettings((current) => ({ ...current, model: event.target.value }))} placeholder="填写服务商提供的模型名" /></label>
            <label>API 密钥<input type="password" value={aiKeyDraft} onChange={(event) => setAiKeyDraft(event.target.value)} placeholder={aiSettings.apiKeyConfigured ? '已配置；留空表示继续使用已保存密钥' : '粘贴你的 API 密钥'} autoComplete="new-password" /></label>
          </div><div className="ai-inline-actions"><span>{aiSettings.apiKeyConfigured ? '密钥已加密保存在本机' : '尚未配置密钥'}</span><button className="toolbar-button" type="button" disabled={aiBusy} onClick={() => void testAiConnection()}>测试连接</button><button className="toolbar-button" type="button" disabled={aiBusy} onClick={() => void saveAiSettings()}>保存配置</button></div></section>
          <section className="ai-section"><div className="ai-section-title">发送给 AI 的代码 <small>只发送勾选文件，默认选择当前页面及其引用文件</small></div><div className="ai-context-list">{aiContextFiles.length ? aiContextFiles.map((file) => <label key={file}><input type="checkbox" checked={aiSelectedFiles.includes(file)} onChange={(event) => setAiSelectedFiles((current) => event.target.checked ? [...current, file] : current.filter((item) => item !== file))} />{file}</label>) : <span>没有可用的 HTML、CSS、JavaScript 文件</span>}</div><p className="ai-privacy-note">点击生成后，勾选的源代码会发送到上方填写的 API 服务商。</p></section>
          <section className="ai-section"><label className="ai-request-label">描述要实现的交互<textarea value={aiRequest} onChange={(event) => setAiRequest(event.target.value)} placeholder="例如：点击三个选项之一后高亮选中项，点击下一题时判断是否选择并显示不同反馈；保留现有页面布局和其他交互。" maxLength={6000} /></label><div className="ai-inline-actions ai-generate-row"><span>{aiMessage}</span><button className="primary-toolbar-button" type="button" disabled={aiBusy || !aiSettings.apiKeyConfigured} onClick={() => void generateAiProposal()}>{aiBusy ? '处理中…' : '生成修改方案'}</button></div></section>
          {aiProposal && <section className="ai-proposal"><div className="ai-section-title">修改说明</div><p>{aiProposal.summary}</p>{aiProposal.files.map((file) => <details className="ai-file-diff" key={file.path} open><summary>{file.path} · 修改前后对照</summary><div className="ai-diff-columns"><div><strong>修改前</strong><pre>{file.originalContent}</pre></div><div><strong>AI 修改后</strong><pre>{file.content}</pre></div></div></details>)}<div className="ai-inline-actions"><span>原项目尚未修改</span><button className="primary-toolbar-button" type="button" disabled={aiBusy} onClick={() => void createAiIsolatedPreview()}>创建隔离预览</button></div></section>}
        </div> : <div className="ai-preview-body"><div className="ai-preview-note"><strong>隔离测试预览</strong><span>这是项目副本，可以实际点击验证；此时原项目文件还没有修改。</span></div><iframe className="ai-preview-frame" title="AI 方案隔离预览" src={aiStage.previewUrl} onLoad={(event) => event.currentTarget.contentWindow?.postMessage({ source: 'theme-unit-editor', type: 'set-mode', mode: 'test' }, '*')} sandbox="allow-scripts allow-same-origin allow-forms allow-modals" /><div className="ai-inline-actions"><span>{aiMessage}</span><button className="toolbar-button" type="button" disabled={aiBusy} onClick={() => void discardAiIsolatedPreview()}>返回差异</button><button className="primary-toolbar-button" type="button" disabled={aiBusy} onClick={() => void applyAiProposal()}>确认应用到项目</button></div></div>}
        {!aiStage && <div className={/失败|无效|请先|至少|请选择|没有/.test(aiMessage) ? 'ai-footer error-text' : 'ai-footer'} role="status">{aiMessage}</div>}
      </section></div>}
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


