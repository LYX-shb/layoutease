import { useEffect, useRef, useState } from 'react';
import { pushHistory, redoHistory, undoHistory } from './history.js';
import { previewUrlWithMobileEnvironment, readPreviewConfig, resolvePageViewport, resolvePreview, rotatesHuaweiPreview, saveViewportForPreview, selectPreviewPreset, shouldEmulateMobilePreview, validDimension, viewports } from './preview-presets';
import type { PreviewConfig, PreviewPreset, SaveViewport, Viewport } from './preview-presets';

type StyleKey = 'display' | 'fontSize' | 'color' | 'width' | 'height' | 'margin' | 'padding' | 'backgroundImage' | 'transform' | 'translate';
type ElementStyles = Record<StyleKey, string>;
const pageBackgroundEditId = '__page-background__';
const pageLayoutEditId = '__page-layout__';
type EditScope = { mode: 'original' | 'current' | 'selected' | 'all'; states: string[] };

const saveScopes: Record<SaveViewport, string> = {
  desktop: '默认样式；其他设备已有独立设置时，以对应设备设置为准',
  tablet: '网页宽度 901–1200px 时生效',
  mobilePortrait: '网页宽度不超过 500px 时生效',
  mobileLandscape: '网页宽度 501–900px 时生效',
  phone: '手机通用样式：横竖屏及不同微信视口共用；不再限于 500px',
};

const emptyStyles = (): ElementStyles => ({ display: '', fontSize: '', color: '', width: '', height: '', margin: '', padding: '', backgroundImage: '', transform: '', translate: '' });

type SelectedElement = {
  id: string;
  editKey?: string;
  stateScope?: string;
  baseStyleSelector?: string;
  editScope?: EditScope;
  positionGroup?: string;
  editScopes?: Record<'position' | 'size' | 'appearance', EditScope>;
  visibilityScope?: EditScope;
  sharingAsset?: { selector: string; sharedId: string; src: string; alt: string; transform: string; hostSelector: string; box: { x: number; y: number; width: number; height: number } } | null;
  sceneContext?: { ownerSelector: string; attribute: string; value: string; choices: Array<{ value: string; label: string }> } | null;
  auto?: boolean;
  tag: string;
  path?: string;
  tagIndex?: number;
  selector?: string;
  styleSelector?: string;
  sourceType?: 'html' | 'css' | 'dynamic';
  text: string;
  className?: string;
  outerHTML?: string;
  src?: string;
  resizeLockAspect?: boolean;
  naturalSize?: { width: number; height: number } | null;
  nestedImage?: { selector: string; src: string; index: number } | null;
  rect: { x: number; y: number; width: number; height: number };
  styles: ElementStyles;
};

type GroupSync = { id: string; scope: 'current' | 'selected' | 'all'; states: string[]; pages: string[];
  scene?: { ownerSelector: string; attribute: string; states: string[] } | null;
  visibility?: EditScope; visibilityScene?: { ownerSelector: string; attribute: string; states: string[] } | null;
  members: Array<{ tag: string; selector: string; path: string; id: string; src: string; text: string; classes: string[]; data: Record<string, string>; x: number; y: number; display?: string;
    reference?: 'visual' | 'subject'; positions?: Array<{ selector: string; translate: string; transform?: string }> }> };

type EditorChange = {
  id: string;
  editKey?: string;
  kind: 'style' | 'text' | 'resize' | 'background' | 'layout' | 'page-batch';
  property?: StyleKey;
  before: string;
  after: string;
  groupSync?: GroupSync;
  pageTransactionId?: string;
};

type Version = { id: string; pagePath: string; name?: string; reason?: string; files?: string; fileList?: string[]; createdAt: string };
type InteractionAction = 'none' | 'navigate' | 'back' | 'show' | 'hide' | 'toggle' | 'classToggle' | 'play' | 'pause';
type InteractionDraft = { sourceSelector: string; action: InteractionAction; targetSelector: string; targetPage: string; className: string };
type ImageReplacement = { kind: 'src' | 'nested' | 'background'; index: number; src: string; viewport: 'all' | 'desktop' | 'tablet' | 'phone' };
type AiSettingsDraft = { apiBaseUrl: string; apiFormat: 'chat-completions' | 'responses'; model: string; apiKeyConfigured: boolean };
type AiFileProposal = { path: string; content: string; originalContent: string };
type AiProposal = { summary: string; files: AiFileProposal[] };
type AiTurn = { id: number; request: string; summary?: string; error?: string };
type AiConversation = { draft: string; turns: AiTurn[]; proposal: AiProposal | null; message: string };
type AiOperation = 'settings' | 'connection' | 'generate' | 'preview' | 'apply' | 'close';
const newAiConversation = (): AiConversation => ({ draft: '', turns: [], proposal: null, message: '' });
const hasDesktopBridge = typeof window.editorBridge !== 'undefined';
const hasLayoutScopes = hasDesktopBridge && typeof window.editorBridge.saveLayoutEdits === 'function';
const editKeyOf = (element: { id: string; editKey?: string }) => element.editKey || element.id;

function imageSelectorsForSource(selector: string | undefined, previousSource: string, nextSource: string) {
  const previousFilter = `[src=${JSON.stringify(previousSource)}]`;
  const base = selector?.endsWith(previousFilter) ? selector.slice(0, -previousFilter.length) : selector || '';
  return { selector: base, styleSelector: base ? `${base}[src=${JSON.stringify(nextSource)}]` : undefined };
}

function displayColor(value: string) {
  const rgb = /^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/.exec(value);
  return rgb ? `#${rgb.slice(1).map((component) => Number(component).toString(16).padStart(2, '0')).join('').toUpperCase()}` : value;
}
type IconName = 'undo' | 'redo' | 'history' | 'monitor' | 'refresh' | 'settings' | 'plus' | 'page' | 'sparkle' | 'send' | 'help' | 'chevron';
function EditorIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, string> = {
    undo: 'M9 5 4 10l5 5M4 10h10a6 6 0 0 1 0 12',
    redo: 'm15 5 5 5-5 5M20 10H10a6 6 0 0 0 0 12',
    history: 'M3 7v5h5M3.5 12a9 9 0 1 0 2-6M12 7v5l3 2',
    monitor: 'M4 4h16v12H4zM12 16v4M8 20h8',
    refresh: 'M20 4v5h-5M4 20v-5h5M4.5 9a8 8 0 0 1 13-5M19.5 15a8 8 0 0 1-13 5',
    settings: 'm10 3 4 0 .6 3 2 .9 2.7-1 2 3.4-2.1 2.1v2.3l2.1 2.1-2 3.4-2.7-1-2 .9-.6 3h-4l-.6-3-2-.9-2.7 1-2-3.4L5 13.7v-2.3L2.9 9.3l2-3.4 2.7 1 2-.9zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    plus: 'M12 5v14M5 12h14',
    page: 'M6 3h8l4 4v14H6zM14 3v5h4',
    sparkle: 'm12 3 2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2z',
    send: 'M12 20V4M5 11l7-7 7 7',
    help: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4M12 17h.01',
    chevron: 'm15 6-6 6 6 6',
  };
  return <svg className="editor-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

type EditorProject = Extract<OpenProjectResult, { ok: true }>;
type EditorTheme = 'white' | 'black';
const emptyProject: EditorProject = { ok: true, id: '', name: '未选择项目', rootPath: '', entryUrl: '', pages: [] };
function localProjectLabel(rootPath: string, name: string) {
  const drive = /^([a-z]):[\\/]/i.exec(rootPath)?.[1];
  return drive ? `${drive.toUpperCase()}盘 · ${name}` : name;
}

function EditorView({ project, onClose, onOpen, catalog, scanning, catalogMessage, onSelectProject, onRefresh, theme, onThemeChange }: {
  project: EditorProject; onClose: () => void; onOpen: (kind: 'file' | 'project') => Promise<void>;
  catalog: LocalProject[]; scanning: boolean; catalogMessage: string; onSelectProject: (key: string) => Promise<void>; onRefresh: () => void;
  theme: EditorTheme; onThemeChange: (theme: EditorTheme) => void;
}) {
  const hasProject = Boolean(project.id);
  const initialViewport = project.settings?.mobileOrientation || 'desktop';
  const previewStorageKey = `theme-unit-preview:${project.rootPath || 'empty'}`;
  const [previewConfig, setPreviewConfig] = useState<PreviewConfig>(() => {
    try { return readPreviewConfig(project.settings?.previewConfig ? JSON.stringify(project.settings.previewConfig) : localStorage.getItem(previewStorageKey), initialViewport); }
    catch { return readPreviewConfig(null, initialViewport); }
  });
  const [customWidthDraft, setCustomWidthDraft] = useState(String(previewConfig.customWidth));
  const [customHeightDraft, setCustomHeightDraft] = useState(String(previewConfig.customHeight));
  const [viewportError, setViewportError] = useState('');
  const viewport = saveViewportForPreview(previewConfig);
  const [mode, setMode] = useState<'edit' | 'test'>('edit');
  const [freezePending, setFreezePending] = useState(false);
  const [capturedFrame, setCapturedFrame] = useState(false);
  const [currentPage, setCurrentPage] = useState(project.pages.find((page) => page.url === project.entryUrl) || project.pages[0] || { path: 'index.html', url: project.entryUrl });
  const [selected, setSelected] = useState<SelectedElement | null>(null);
  const [imageReplacementScope, setImageReplacementScope] = useState<'current' | 'all'>('current');
  const [selectionCount, setSelectionCount] = useState(0);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [selectedGroupSync, setSelectedGroupSync] = useState<'current' | 'selected' | 'all'>('current');
  const [selectedGroupStates, setSelectedGroupStates] = useState<string[]>([]);
  const [selectedGroupPages, setSelectedGroupPages] = useState<string[]>([]);
  const [selectedGroupVisibility, setSelectedGroupVisibility] = useState<EditScope>({ mode: 'original', states: [] });
  const pendingGroupSync = useRef(new Map<string, GroupSync>());
  const [marqueeMode, setMarqueeMode] = useState(false);
  const [backgroundScaleDraft, setBackgroundScaleDraft] = useState(100);
  const [undoStack, setUndoStack] = useState<EditorChange[]>([]);
  const [redoStack, setRedoStack] = useState<EditorChange[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingPromise = useRef<Promise<boolean> | null>(null);
  const [draftText, setDraftText] = useState('');
  const [draftStyles, setDraftStyles] = useState<ElementStyles>(emptyStyles());
  const [saveMessage, setSaveMessage] = useState('');
  const [zoomFactor, setZoomFactor] = useState(1);
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
  const [sidebarTab, setSidebarTab] = useState<'pages' | 'ai'>('pages');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<'style' | 'interaction'>('style');
  const [scopeGroup, setScopeGroup] = useState<'position' | 'size' | 'appearance'>('position');
  const [sharingPages, setSharingPages] = useState<string[]>([]);
  const [sharingGroups, setSharingGroups] = useState<string[]>([]);
  const [sharingAddMissing, setSharingAddMissing] = useState(false);
  const [sharingPlan, setSharingPlan] = useState<{ planId: string; items: Array<{ page: string; action: 'add' | 'update' | 'skip' }> } | null>(null);
  const [sharingBusy, setSharingBusy] = useState(false);
  const historyBusy = useRef(false);
  const sharingFingerprint = JSON.stringify([selected?.sharingAsset, selected?.visibilityScope, selected?.sceneContext?.value]);
  useEffect(() => { setSharingPlan(null); }, [sharingFingerprint, sharingPages, sharingGroups, sharingAddMissing, viewport]);
  useEffect(() => { setSharingPages([]); setSharingGroups([]); setSharingAddMissing(false); setSharingPlan(null); }, [selected?.id, currentPage.path]);
  useEffect(() => { setImageReplacementScope('current'); }, [selected?.id, currentPage.path]);
  const [aiDiffOpen, setAiDiffOpen] = useState(false);
  const [aiActivated, setAiActivated] = useState(false);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [aiContextOpen, setAiContextOpen] = useState(false);
  const [aiContextPage, setAiContextPage] = useState('');
  const [aiContextRefresh, setAiContextRefresh] = useState(0);
  const [aiSettings, setAiSettings] = useState<AiSettingsDraft>({ apiBaseUrl: 'https://api.openai.com/v1', apiFormat: 'chat-completions', model: '', apiKeyConfigured: false });
  const [aiKeyDraft, setAiKeyDraft] = useState('');
  const [aiContextFiles, setAiContextFiles] = useState<string[]>([]);
  const [aiSelectedFiles, setAiSelectedFiles] = useState<string[]>([]);
  const [aiConversations, setAiConversations] = useState<Record<string, AiConversation>>({});
  const aiConversation = aiConversations[currentPage.path] || newAiConversation();
  const { draft: aiRequest, turns: aiTurns, proposal: aiProposal, message: aiMessage } = aiConversation;
  function updateAiConversation(update: Partial<AiConversation>) {
    const pagePath = currentPage.path;
    setAiConversations((current) => ({ ...current, [pagePath]: { ...(current[pagePath] || newAiConversation()), ...update } }));
  }
  const setAiRequest = (draft: string) => updateAiConversation({ draft });
  const setAiProposal = (proposal: AiProposal | null) => updateAiConversation({ proposal });
  const setAiMessage = (message: string) => updateAiConversation({ message });
  const [aiStage, setAiStage] = useState<{ stageId: string; previewUrl: string } | null>(null);
  const [aiOperation, setAiOperation] = useState<AiOperation | null>(null);
  const [aiConnectionVerified, setAiConnectionVerified] = useState(false);
  const aiBusy = aiOperation !== null;
  const aiOperationRef = useRef(false);
  const aiTurnSequence = useRef(0);
  const aiSettingsLoaded = useRef(false);
  const aiContextCache = useRef(new Map<string, { files: string[]; selected: string[] }>());
  const aiChatRef = useRef<HTMLDivElement>(null);
  const aiFollowOutput = useRef(true);
  const toolbarRef = useRef<HTMLElement>(null);
  const deleteSelectedRef = useRef<() => void>(() => {});
  const [previewLoading, setPreviewLoading] = useState(hasProject);
  const [previewNonce, setPreviewNonce] = useState(0);
  const [addingImage, setAddingImage] = useState(false);
  const lastAssetImport = useRef(0);
  const [sourceUpdate, setSourceUpdate] = useState<{ files: string[]; changedAt: number } | null>(null);
  const lastOwnSave = useRef(0);
  const sourceBusy = useRef(false);
  sourceBusy.current = saving || Boolean(savingPromise.current);
  const [switchAction, setSwitchAction] = useState<((discarded?: boolean) => void) | null>(null);
  const [switchBusy, setSwitchBusy] = useState(false);
  const elementRecords = useRef(new Map<string, SelectedElement>());
  const backgroundScaleRef = useRef(100);
  const pendingEdits = useRef(new Map<string, { styles: Record<string, string>; text?: string; attributes?: Record<string, string>; nestedImage?: { selector: string; src: string; index: number }; imageReplacement?: ImageReplacement }>());
  const pendingInteractions = useRef(new Map<string, InteractionDraft>());
  const interactionLoadVersion = useRef(0);
  const interactionDraftRef = useRef<InteractionDraft>({ sourceSelector: '', action: 'none', targetSelector: '', targetPage: '', className: '' });
  interactionDraftRef.current = { sourceSelector: selected?.selector || '', action: interactionAction, targetSelector: interactionTarget, targetPage: interactionPage, className: interactionClassName };
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const previewAreaRef = useRef<HTMLElement>(null);
  const previewControlsRef = useRef<HTMLDivElement>(null);
  const currentPageRef = useRef(currentPage);
  const selectedIdRef = useRef('');
  const currentViewport = resolvePreview(previewConfig);
  const pageViewport = resolvePageViewport(previewConfig);
  const rotatedHuaweiPreview = rotatesHuaweiPreview(previewConfig);
  const mobileEnvironmentEnabled = shouldEmulateMobilePreview(previewConfig);
  const [previewScale, setPreviewScale] = useState(1);
  const displayScale = previewScale * zoomFactor;

  useEffect(() => { currentPageRef.current = currentPage; }, [currentPage]);

  useEffect(() => {
    if (!hasProject || !window.editorBridge?.onProjectSourceChanged) return;
    return window.editorBridge.onProjectSourceChanged(change => {
      if (change.projectId !== project.id) return;
      // A successful editor save already updates this preview. External script,
      // stylesheet and asset changes always require a fresh page load.
      const ownPageSave = change.files.every(file => file === currentPageRef.current.path)
        && (sourceBusy.current || change.changedAt - lastOwnSave.current < 1500);
      const ownAssetImport = change.files.every(file => file.startsWith('assets/editor/')) && change.changedAt - lastAssetImport.current < 1500;
      if (!ownPageSave && !ownAssetImport) setSourceUpdate(change);
    });
  }, [hasProject, project.id]);

  useEffect(() => {
    if (!sourceUpdate || mode === 'test' || dirty || interactionDirty || saving || sharingBusy || aiStage || aiBusy || selected || marqueeMode || addingImage || freezePending || capturedFrame) return;
    clearPageState();
    setSourceUpdate(null);
    setPreviewNonce(value => value + 1);
    setSaveMessage('课件文件已更新，预览已重新读取磁盘中的最新内容。');
  }, [sourceUpdate, mode, dirty, interactionDirty, saving, sharingBusy, aiStage, aiBusy, selected, marqueeMode, addingImage, freezePending, capturedFrame]);

  useEffect(() => {
    const preventExit = (event: BeforeUnloadEvent) => {
      if (dirty || interactionDirty || saving || sharingBusy || addingImage) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', preventExit);
    return () => window.removeEventListener('beforeunload', preventExit);
  }, [dirty, interactionDirty, saving, sharingBusy, addingImage]);

  useEffect(() => {
    if (hasProject) {
      try { localStorage.setItem(previewStorageKey, JSON.stringify({ ...previewConfig, profileVersion: 6 })); } catch { /* Storage may be unavailable. */ }
    }
  }, [hasProject, previewStorageKey, previewConfig]);

  useEffect(() => {
    if (!aiActivated || !hasProject || !hasDesktopBridge) return;
    let cancelled = false;
    const pagePath = currentPage.path;
    const cached = aiContextCache.current.get(pagePath);
    if (cached) {
      setAiContextFiles(cached.files);
      setAiSelectedFiles(cached.selected);
      setAiContextPage(pagePath);
      return;
    }
    setAiContextPage('');
    setAiMessage('正在读取 API 配置和当前页面代码…');
    Promise.all([
      aiSettingsLoaded.current ? Promise.resolve(null) : window.editorBridge.getAiSettings(),
      window.editorBridge.listAiContext({ projectId: project.id, pagePath }),
    ]).then(([settingsResult, contextResult]) => {
      if (cancelled) return;
      if (settingsResult?.ok) {
        setAiSettings({ apiBaseUrl: settingsResult.apiBaseUrl, apiFormat: settingsResult.apiFormat, model: settingsResult.model, apiKeyConfigured: settingsResult.apiKeyConfigured });
        aiSettingsLoaded.current = true;
      }
      if (contextResult.ok) {
        aiContextCache.current.set(pagePath, { files: contextResult.files, selected: contextResult.recommended });
        setAiContextFiles(contextResult.files);
        setAiSelectedFiles(contextResult.recommended);
        const configured = settingsResult?.ok ? settingsResult.apiKeyConfigured : aiSettings.apiKeyConfigured;
        setAiMessage(configured ? '已准备当前页面及其引用文件。' : '填写自己的 API 地址、模型和密钥即可开始。');
      } else {
        setAiContextFiles([]);
        setAiSelectedFiles([]);
        setAiMessage(contextResult.error);
      }
      setAiContextPage(pagePath);
    }).catch(() => {
      if (!cancelled) setAiMessage('读取 AI 配置失败，请检查应用状态后重试。');
    });
    return () => { cancelled = true; };
  }, [aiActivated, hasProject, project.id, currentPage.path, aiContextRefresh]);

  useEffect(() => {
    const dismissMenus = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      toolbarRef.current?.querySelectorAll<HTMLDetailsElement>('.toolbar-menu[open]').forEach((menu) => {
        if (!menu.contains(target)) menu.open = false;
      });
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const openMenu = toolbarRef.current?.querySelector<HTMLDetailsElement>('.toolbar-menu[open]');
      if (!openMenu) return;
      openMenu.open = false;
      openMenu.querySelector<HTMLElement>('summary')?.focus();
      event.preventDefault();
    };
    document.addEventListener('pointerdown', dismissMenus);
    document.addEventListener('keydown', closeWithEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissMenus);
      document.removeEventListener('keydown', closeWithEscape);
    };
  }, []);

  useEffect(() => {
    if (sidebarTab === 'ai' && !sidebarCollapsed && aiFollowOutput.current && aiChatRef.current) aiChatRef.current.scrollTop = aiChatRef.current.scrollHeight;
  }, [aiTurns.length, aiMessage, aiProposal, sidebarTab, sidebarCollapsed]);

  useEffect(() => { setPreviewLoading(hasProject); }, [hasProject, currentPage.url, aiStage?.stageId, previewNonce]);

  useEffect(() => {
    const area = previewAreaRef.current;
    if (!area) return;
    let animationFrame = 0;
    const updateScale = () => {
      const spacing = getComputedStyle(area);
      const controls = previewControlsRef.current;
      const zoom = area.querySelector<HTMLElement>('.preview-zoom-controls');
      const availableWidth = Math.max(100, area.clientWidth - parseFloat(spacing.paddingLeft) - parseFloat(spacing.paddingRight));
      const occupiedHeight = parseFloat(spacing.paddingTop) + parseFloat(spacing.paddingBottom) + parseFloat(spacing.rowGap) * (hasProject ? 2 : 1) + (controls?.offsetHeight || 0) + (controls ? parseFloat(getComputedStyle(controls).marginBottom) : 0) + (zoom?.offsetHeight || 0);
      const availableHeight = Math.max(100, area.clientHeight - occupiedHeight);
      const nextScale = Math.min(2.5, availableWidth / currentViewport.width, availableHeight / currentViewport.height);
      setPreviewScale((current) => Math.abs(current - nextScale) < 0.0001 ? current : nextScale);
    };
    updateScale();
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(updateScale);
    });
    observer.observe(area);
    if (previewControlsRef.current) observer.observe(previewControlsRef.current);
    const zoom = area.querySelector<HTMLElement>('.preview-zoom-controls');
    if (zoom) observer.observe(zoom);
    return () => { observer.disconnect(); cancelAnimationFrame(animationFrame); };
  }, [currentViewport.width, currentViewport.height, hasProject]);

  useEffect(() => {
    if (!selected) {
      selectedIdRef.current = '';
      setInteractionAction('none');
      setInteractionTarget('');
      setInteractionPage('');
      setInteractionClassName('');
      return;
    }
    if (selectedIdRef.current !== selected.id) {
      selectedIdRef.current = selected.id;
      setInteractionAction('none');
      setInteractionTarget('');
      setInteractionPage('');
      setInteractionClassName('');
      setPickingInteractionTarget(false);
    }
    setDraftText(selected.text);
    setDraftStyles({ ...emptyStyles(), ...selected.styles, color: displayColor(selected.styles.color) });
  }, [selected]);

  useEffect(() => {
    const currentSelection = selected;
    if (!currentSelection?.selector) return;
    const version = ++interactionLoadVersion.current;
    const pending = pendingInteractions.current.get(currentSelection.id);
    if (pending) {
      setInteractionAction(pending.action); setInteractionTarget(pending.targetSelector);
      setInteractionPage(pending.targetPage); setInteractionClassName(pending.className);
      return;
    }
    let cancelled = false;
    window.editorBridge.getInteraction({ projectId: project.id, pagePath: currentPage.path, sourceSelector: currentSelection.selector }).then((result) => {
      if (cancelled || version !== interactionLoadVersion.current || !result.ok || selectedIdRef.current !== currentSelection.id || pendingInteractions.current.has(currentSelection.id)) return;
      const interaction = result.interaction;
      setInteractionAction(interaction?.action || 'none');
      setInteractionTarget(interaction?.targetSelector || '');
      setInteractionPage(interaction?.targetPage || '');
      setInteractionClassName(interaction?.className || '');
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [selected?.id, currentPage.path, project.id]);

  useEffect(() => {
    function handlePreviewMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow || !event.data || event.data.source !== 'theme-unit-editor') return;
      if (event.data.type === 'freeze-error') {
        setFreezePending(false); setCapturedFrame(false);
        setSaveMessage(String(event.data.message || '定格失败，请刷新预览后重试。'));
        return;
      }
      if (event.data.type === 'playback-state' && (event.data.frozen || event.data.captured)) {
        setFreezePending(false);
        setCapturedFrame(true);
        setMode('edit');
        setSaveMessage('当前画面已定格，可以选中素材编辑；切换“测试”继续运行。');
        return;
      }
      if (event.data.type === 'ready' && typeof event.data.pagePath === 'string') {
        const page = project.pages.find((item) => item.path === event.data.pagePath);
        if (page && page.path !== currentPageRef.current.path) {
          setCurrentPage(page);
          clearPageState();
          setSaveMessage(`已切换到 ${page.path}`);
        }
        const receivedScale = Number(event.data.backgroundScale);
        const scale = Number.isFinite(receivedScale) && receivedScale >= 70 && receivedScale <= 150 ? Math.round(receivedScale) : 100;
        backgroundScaleRef.current = scale;
        setBackgroundScaleDraft(scale);
        return;
      }
      if (event.data.type === 'delete-request') {
        deleteSelectedRef.current();
        return;
      }
      if (event.data.type === 'scope-error') { setSaveMessage(String(event.data.message || '修改范围应用失败')); return; }
      if (event.data.type === 'image-inserted') { setAddingImage(false); return; }
      if (event.data.type === 'image-insert-error') { setAddingImage(false); setSaveMessage(String(event.data.message || '添加图片失败')); return; }
      if (event.data.type === 'layout-changed') {
        if (event.data.before === event.data.after) return;
        const sync = event.data.groupSync as GroupSync | null;
        if (sync?.id && sync.pages?.length) pendingGroupSync.current.set(sync.id, sync);
        else if (event.data.groupId) pendingGroupSync.current.delete(String(event.data.groupId));
        const change: EditorChange = { id: pageLayoutEditId, kind: 'layout', before: event.data.before, after: event.data.after, groupSync: sync || undefined };
        recordPending(change, change.after);
        setUndoStack(current => pushHistory({ undo: current, redo: [] }, change).undo);
        setRedoStack([]);
        setDirty(true);
        setSaveMessage(String(event.data.summary || '布局已调整') + '；点击“保存”写入页面。');
        return;
      }
      if (event.data.type === 'deselected') { setSelected(null); setSelectionCount(0); setSelectedGroupId(''); }
      if (event.data.type === 'selection-set') {
        setSelectionCount(Number(event.data.count) || 0);
        setSelectedGroupId(String(event.data.groupId || ''));
        setSelectedGroupSync(['current', 'selected', 'all'].includes(event.data.groupSync) ? event.data.groupSync : 'current');
        setSelectedGroupStates(Array.isArray(event.data.groupStates) ? event.data.groupStates : []);
        setSelectedGroupPages(Array.isArray(event.data.groupPages) ? event.data.groupPages : []);
        setSelectedGroupVisibility(event.data.groupVisibility && ['original', 'current', 'selected', 'all'].includes(event.data.groupVisibility.mode)
          ? event.data.groupVisibility : { mode: 'original', states: [] });
      }
      if (event.data.type === 'marquee-mode') setMarqueeMode(Boolean(event.data.enabled));
      if (event.data.type === 'marquee-result') setSaveMessage(Number(event.data.count) ? `已框选 ${event.data.count} 个素材；可在右侧设置整组位置范围。` : '框内没有足够覆盖的素材；请把素材的大部分圈进框内，框选保持开启，可直接重试。');
      if (event.data.type === 'selected') {
        elementRecords.current.set(editKeyOf(event.data), event.data as SelectedElement);
        setSelected({ ...event.data, styles: { ...emptyStyles(), ...event.data.styles } } as SelectedElement);
      }
      if (event.data.type === 'target-selected') {
        updateInteraction({ targetSelector: String(event.data.selector || '') });
        setPickingInteractionTarget(false);
        setInteractionDirty(true);
        setSaveMessage('已选择交互目标');
      }
      if (event.data.type === 'changed' || event.data.type === 'resized') {
        const change: EditorChange = { id: event.data.id, editKey: event.data.editKey, kind: event.data.type === 'resized' ? 'resize' : 'style', property: event.data.property, before: event.data.before, after: event.data.after };
        recordPending(change, change.after);
        setUndoStack((current) => pushHistory({ undo: current, redo: [] }, change).undo);
        setRedoStack([]);
        setDirty(true);
        setSelected((current) => current && editKeyOf(current) === editKeyOf(change) ? { ...current, styles: { ...current.styles, ...(change.kind === 'resize' ? JSON.parse(change.after) : { [event.data.property]: event.data.after }) } } : current);
      }
    }
    window.addEventListener('message', handlePreviewMessage);
    return () => window.removeEventListener('message', handlePreviewMessage);
  }, []);

  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage({ source: 'theme-unit-editor', type: 'set-mode', mode: aiStage ? 'test' : mode, viewport }, '*');
  }, [mode, currentPage, previewNonce, viewport, aiStage]);

  function sendToPreview(message: Record<string, string>) {
    const key = message.editKey || (selected && selected.id === message.id ? editKeyOf(selected) : message.id);
    const element = key ? elementRecords.current.get(key) : undefined;
    iframeRef.current?.contentWindow?.postMessage({ source: 'theme-unit-editor',
      stateScope: element?.stateScope, styleSelector: element?.styleSelector, baseStyleSelector: element?.baseStyleSelector,
      ...message }, '*');
  }

  function previewBackgroundScale(value: number) {
    const scale = Math.max(70, Math.min(150, Math.round(value)));
    setBackgroundScaleDraft(scale);
    sendToPreview({ type: 'apply-background-scale', value: String(scale) });
  }

  function commitBackgroundScale(value: number) {
    const scale = Math.max(70, Math.min(150, Math.round(value)));
    const before = backgroundScaleRef.current;
    setBackgroundScaleDraft(scale);
    setSaveMessage('');
    if (before === scale) {
      sendToPreview({ type: 'apply-background-scale', value: String(scale) });
      return;
    }
    backgroundScaleRef.current = scale;
    addChange({ id: pageBackgroundEditId, kind: 'background', before: String(before), after: String(scale) });
    sendToPreview({ type: 'apply-background-scale', value: String(scale) });
  }

  function recordPending(change: EditorChange, value: string) {
    const key = editKeyOf(change);
    const previous = pendingEdits.current.get(key);
    const pending = { ...previous, styles: { ...previous?.styles } };
    if (change.kind === 'text') pending.text = value;
    else if (change.kind === 'resize') Object.assign(pending.styles, JSON.parse(value));
    else if (change.kind === 'background') pending.styles.backgroundScale = value;
    else if (change.kind === 'layout') pending.styles.layoutConfig = value;
    else pending.styles[change.property || 'transform'] = value;
    pendingEdits.current.set(key, pending);
  }

  function addChange(change: EditorChange) {
    if (change.before === change.after) return;
    if (selected?.id === change.id) change = { ...change, editKey: editKeyOf(selected) };
    recordPending(change, change.after);
    const nextHistory = pushHistory({ undo: undoStack, redo: redoStack }, change);
    setUndoStack(nextHistory.undo);
    setRedoStack(nextHistory.redo);
    setDirty(true);
  }

  function deleteSelected() {
    const element = selected;
    if (!element || mode !== 'edit' || aiStage || saving || element.styles.display === 'none') return;
    if (window.editorBridge?.supportsSelectionDeletion) {
      sendToPreview({ type: 'delete-selection', id: element.id });
      return;
    }
    if (hasLayoutScopes && !element.sceneContext && element.editScopes?.appearance?.mode !== 'all') { setSaveMessage('尚未识别当前画面，已阻止删除，避免影响其他画面。'); return; }
    if (hasLayoutScopes) sendToPreview({ type: 'edit-styles', id: element.id, styles: JSON.stringify({ display: 'none' }) });
    else {
      addChange({ id: element.id, kind: 'style', property: 'display', before: element.styles.display, after: 'none' });
      sendToPreview({ type: 'apply-style', id: element.id, editKey: editKeyOf(element), property: 'display', value: 'none' });
    }
    sendToPreview({ type: 'deselect', id: element.id });
    setSelected(null); setSelectionCount(0); setSelectedGroupId(''); setMarqueeMode(false);
    setSaveMessage('元素已删除，可撤销恢复；点击“保存”后写入当前页面。');
  }

  deleteSelectedRef.current = deleteSelected;

  useEffect(() => {
    function handleDeleteShortcut(event: KeyboardEvent) {
      if (!selected || mode !== 'edit' || aiStage || saving || event.isComposing || (event.key !== 'Delete' && event.key !== 'Backspace') || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [contenteditable="true"]'))) return;
      event.preventDefault();
      deleteSelectedRef.current();
    }
    document.addEventListener('keydown', handleDeleteShortcut, true);
    return () => document.removeEventListener('keydown', handleDeleteShortcut, true);
  }, [selected, mode, aiStage, saving]);

  function applyChange(change: EditorChange, value: string) {
    recordPending(change, value);
    if (change.kind === 'layout') {
      sendToPreview({ type: 'apply-layout-snapshot', id: pageLayoutEditId, value });
      return;
    }
    if (change.kind === 'background') {
      const scale = Math.max(70, Math.min(150, Math.round(Number(value) || 100)));
      backgroundScaleRef.current = scale;
      setBackgroundScaleDraft(scale);
      sendToPreview({ type: 'apply-background-scale', value: String(scale) });
      return;
    }
    if (change.kind === 'resize') {
      const styles = JSON.parse(value) as Record<string, string>;
      for (const [property, nextValue] of Object.entries(styles)) sendToPreview({ type: 'apply-style', id: change.id, editKey: editKeyOf(change), property, value: nextValue });
      return;
    }
    if (change.kind === 'text') {
      setDraftText(value);
      setSelected((current) => current && current.id === change.id ? { ...current, text: value } : current);
      sendToPreview({ type: 'apply-text', id: change.id, value });
    } else {
      const property = change.property || 'transform';
      setDraftStyles((current) => ({ ...current, [property]: value }));
      setSelected((current) => current && editKeyOf(current) === editKeyOf(change) ? { ...current, styles: { ...current.styles, [property]: value } } : current);
      sendToPreview({ type: 'apply-style', id: change.id, editKey: editKeyOf(change), property, value });
    }
  }

  async function undo() {
    if (historyBusy.current || sharingBusy || saving) return;
    const transition = undoHistory({ undo: undoStack, redo: redoStack });
    const change = transition.change;
    if (!change) return;
    if (change.kind === 'page-batch') {
      historyBusy.current = true;
      setSharingBusy(true);
      try {
        const result = await window.editorBridge.restorePageSharing({ projectId: project.id, transactionId: change.id, side: 'before' });
        if (!result.ok) { setSaveMessage(result.error); return; }
        setUndoStack(transition.history.undo); setRedoStack(transition.history.redo);
        setSaveMessage('已撤销跨网页应用，目标文件已恢复');
      } catch { setSaveMessage('跨网页撤销失败，请检查文件状态'); }
      finally { historyBusy.current = false; setSharingBusy(false); }
      return;
    }
    if (change.pageTransactionId) {
      historyBusy.current = true; setSharingBusy(true);
      try {
        const result = await window.editorBridge.restorePageSharing({ projectId: project.id, transactionId: change.pageTransactionId, side: 'before' });
        if (!result.ok) { setSaveMessage(result.error); return; }
        if (change.groupSync) pendingGroupSync.current.delete(change.groupSync.id);
        applyChange(change, change.before);
        setUndoStack(transition.history.undo); setRedoStack(transition.history.redo); setDirty(true);
        setSaveMessage('已撤销组合在当前及匹配网页的位置；点击保存写入当前网页');
      } catch { setSaveMessage('组合撤销失败，请检查目标网页状态'); }
      finally { historyBusy.current = false; setSharingBusy(false); }
      return;
    }
    if (change.groupSync) pendingGroupSync.current.delete(change.groupSync.id);
    applyChange(change, change.before);
    setUndoStack(transition.history.undo);
    setRedoStack(transition.history.redo);
    setDirty(true);
  }

  async function redo() {
    if (historyBusy.current || sharingBusy || saving) return;
    const transition = redoHistory({ undo: undoStack, redo: redoStack });
    const change = transition.change;
    if (!change) return;
    if (change.kind === 'page-batch') {
      historyBusy.current = true;
      setSharingBusy(true);
      try {
        const result = await window.editorBridge.restorePageSharing({ projectId: project.id, transactionId: change.id, side: 'after' });
        if (!result.ok) { setSaveMessage(result.error); return; }
        setUndoStack(transition.history.undo); setRedoStack(transition.history.redo);
        setSaveMessage('已重新应用到目标网页');
      } catch { setSaveMessage('跨网页重做失败，请检查文件状态'); }
      finally { historyBusy.current = false; setSharingBusy(false); }
      return;
    }
    if (change.pageTransactionId) {
      historyBusy.current = true; setSharingBusy(true);
      try {
        const result = await window.editorBridge.restorePageSharing({ projectId: project.id, transactionId: change.pageTransactionId, side: 'after' });
        if (!result.ok) { setSaveMessage(result.error); return; }
        applyChange(change, change.after);
        setUndoStack(transition.history.undo); setRedoStack(transition.history.redo); setDirty(true);
        setSaveMessage('已重做组合在当前及匹配网页的位置；点击保存写入当前网页');
      } catch { setSaveMessage('组合重做失败，请检查目标网页状态'); }
      finally { historyBusy.current = false; setSharingBusy(false); }
      return;
    }
    if (change.groupSync) pendingGroupSync.current.set(change.groupSync.id, change.groupSync);
    applyChange(change, change.after);
    setRedoStack(transition.history.redo);
    setUndoStack(transition.history.undo);
    setDirty(true);
  }

  function handleTextChange(value: string) {
    if (!selected) return;
    addChange({ id: selected.id, kind: 'text', before: draftText, after: value });
    setDraftText(value);
    setSaveMessage('');
    sendToPreview({ type: 'apply-text', id: selected.id, value });
  }

  function handleStyleChange(property: StyleKey, value: string) {
    if (!selected) return;
    const trimmed = value.trim();
    if (trimmed && property !== 'color' && property !== 'backgroundImage' && property !== 'transform' && property !== 'display') {
      value = /^-?\d+(\.\d+)?$/.test(trimmed) ? `${trimmed}px` : trimmed;
    }
    const cssProperty = property.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase());
    if (value && !CSS.supports(cssProperty, value)) { setSaveMessage('无效的属性值，请输入数字或合法 CSS 值'); return; }
    if (property === 'color' && displayColor(value).toLowerCase() === displayColor(selected.styles.color).toLowerCase()) return;
    if (hasLayoutScopes) {
      const styles: Partial<ElementStyles> = { [property]: value };
      if (selected.tag === 'img' && (property === 'width' || property === 'height') && value) {
        const other = property === 'width' ? 'height' : 'width';
        styles[other] = selected.styles[other];
      }
      setDraftStyles(current => ({ ...current, ...styles }));
      sendToPreview({ type: 'edit-styles', id: selected.id, styles: JSON.stringify(styles) });
      return;
    }
    if (selected.tag === 'img' && (property === 'width' || property === 'height') && value) {
        const styles = { width: property === 'width' ? value : selected.styles.width, height: property === 'height' ? value : selected.styles.height };
        addChange({ id: selected.id, kind: 'resize', before: JSON.stringify({ width: selected.styles.width, height: selected.styles.height }), after: JSON.stringify(styles) });
        for (const [key, nextValue] of Object.entries(styles)) sendToPreview({ type: 'apply-style', id: selected.id, property: key, value: nextValue });
        setSelected((current) => current ? { ...current, styles: { ...current.styles, ...styles } } : current);
        setDraftStyles((current) => ({ ...current, ...styles }));
        setSaveMessage(''); return;
    }
    addChange({ id: selected.id, kind: 'style', property, before: selected.styles[property], after: value });
    setDraftStyles((current) => ({ ...current, [property]: value }));
    setSelected((current) => current ? { ...current, styles: { ...current.styles, [property]: value } } : current);
    setSaveMessage('');
    sendToPreview({ type: 'apply-style', id: selected.id, property, value });
  }

  async function saveElement(): Promise<boolean> {
    if (!pendingEdits.current.size) return true;
    // Keep edits for every selected element until an explicit save succeeds.
    for (const [id, pending] of Array.from(pendingEdits.current)) {
      if (id === pageLayoutEditId) {
        if (!hasLayoutScopes) { setSaveMessage('请重启编辑器后保存布局范围'); return false; }
        const result = await window.editorBridge.saveLayoutEdits({ projectId: project.id, pagePath: currentPage.path, config: JSON.parse(pending.styles.layoutConfig) });
        if (!result.ok) { setSaveMessage(result.error); return false; }
        if (pendingEdits.current.get(id) === pending) pendingEdits.current.delete(id);
        continue;
      }
      if (id === pageBackgroundEditId) {
        const result = await window.editorBridge.savePageBackgroundScale({
          projectId: project.id, pagePath: currentPage.path, scale: Number(pending.styles.backgroundScale),
        });
        if (!result.ok) { setSaveMessage(result.error); return false; }
        if (pendingEdits.current.get(id) === pending) pendingEdits.current.delete(id);
        continue;
      }
      const element = selected && id === editKeyOf(selected) ? selected : elementRecords.current.get(id);
      if (!element) { setSaveMessage('找不到待保存元素'); return false; }
      const result = await window.editorBridge.saveElement({
        projectId: project.id, pagePath: currentPage.path, id: element.id, viewport,
        stateScope: element.stateScope, baseStyleSelector: element.baseStyleSelector,
        auto: element.auto || element.sourceType === 'dynamic', sourceType: element.sourceType,
        text: pending.text, tag: element.tag, path: element.path, tagIndex: element.tagIndex,
        selector: element.selector, styleSelector: element.styleSelector, className: element.className, outerHTML: element.outerHTML,
        styles: pending.styles, attributes: pending.attributes || {},
        nestedImage: pending.nestedImage,
        imageReplacement: pending.imageReplacement,
      });
      if (!result.ok) { setSaveMessage(result.error); return false; }
      if (pendingEdits.current.get(id) === pending) pendingEdits.current.delete(id);
    }
    setDirty(pendingEdits.current.size > 0);
    if (pendingEdits.current.size) { setSaveMessage('保存期间有新的修改，请再次保存'); return false; }
    setSelected((current) => current ? { ...current, auto: false } : current);
    setSaveMessage(`已保存到 ${project.rootPath}/${currentPage.path} · ${saveScopes[viewport]}`);
    return true;
  }

  function updateInteraction(patch: Partial<InteractionDraft>) {
    const id = selectedIdRef.current;
    if (!id) return;
    interactionLoadVersion.current++;
    const next = { ...interactionDraftRef.current, ...patch };
    interactionDraftRef.current = next;
    pendingInteractions.current.set(id, next);
    setInteractionAction(next.action); setInteractionTarget(next.targetSelector);
    setInteractionPage(next.targetPage); setInteractionClassName(next.className);
    setInteractionDirty(true);
    setSaveMessage('');
  }

  function changeEditScope(mode: EditScope['mode'], states?: string[]) {
    if (!selected || !hasLayoutScopes) return;
    const current = selected.sceneContext?.value;
    const values = mode === 'all' ? [] : states || (current ? [current] : []);
    sendToPreview({ type: 'set-edit-scope', id: selected.id, mode, states: JSON.stringify(values), group: scopeGroup });
  }

  function changeVisibilityScope(mode: EditScope['mode'], states?: string[]) {
    if (!selected) return;
    const values = ['all', 'original'].includes(mode) ? [] : states || (selected.sceneContext ? [selected.sceneContext.value] : []);
    sendToPreview({ type: 'set-visibility-scope', id: selected.id, mode, states: JSON.stringify(values) });
  }

  async function previewSharing(preset?: { pages: string[]; groups: string[]; addMissing: boolean }) {
    if (!selected?.sharingAsset || sharingBusy) return;
    setSharingBusy(true);
    try {
      if (!(await saveAll())) return;
      const result = await window.editorBridge.previewPageSharing({ projectId: project.id, pagePath: currentPage.path, asset: selected.sharingAsset, pages: preset?.pages || sharingPages, groups: preset?.groups || sharingGroups, addMissing: preset?.addMissing ?? sharingAddMissing, viewport,
        visibility: { scope: selected.visibilityScope, ownerSelector: selected.sceneContext?.ownerSelector, attribute: selected.sceneContext?.attribute } });
      if (!result.ok) { setSaveMessage(result.error); return; }
      setSharingPlan(result);
    } catch { setSaveMessage('应用预览失败，请检查目标网页和图片文件'); }
    finally { setSharingBusy(false); }
  }

  async function previewPositionOnAllPages() {
    const pages = project.pages.filter(page => page.path !== currentPage.path).map(page => page.path);
    if (!pages.length) { setSaveMessage('当前项目没有其他网页'); return; }
    setSharingPages(pages);
    setSharingGroups(['position']);
    setSharingAddMissing(false);
    setSharingBusy(true);
    try {
      if (!(await saveAll())) return;
      const plan = await window.editorBridge.previewPageSharing({ projectId: project.id, pagePath: currentPage.path, asset: selected?.sharingAsset, pages, groups: ['position'], addMissing: false, viewport,
        visibility: { scope: selected?.visibilityScope, ownerSelector: selected?.sceneContext?.ownerSelector, attribute: selected?.sceneContext?.attribute } });
      if (!plan.ok) { setSaveMessage(plan.error); return; }
      const eligible = plan.items.filter(item => item.action !== 'skip').length;
      if (!eligible) { setSaveMessage('没有找到其他网页中唯一对应的同一素材；未修改其他网页。'); return; }
      const applied = await window.editorBridge.applyPageSharing({ projectId: project.id, planId: plan.planId });
      if (!applied.ok) { setSaveMessage(applied.error); return; }
      setUndoStack(current => pushHistory({ undo: current, redo: [] }, { id: applied.transactionId, kind: 'page-batch' as const, before: 'before', after: 'after' }).undo);
      setRedoStack([]);
      setSharingPlan(null);
      const skipped = plan.items.length - eligible;
      setSaveMessage(`位置已同步到 ${applied.count} 个网页${skipped ? `；${skipped} 个网页因素材不唯一而跳过` : ''}，可撤销；已创建项目备份。`);
    } catch { setSaveMessage('跨网页位置同步失败，未完成的文件已尝试恢复'); }
    finally { setSharingBusy(false); }
  }

  async function applySharing() {
    if (!sharingPlan || sharingBusy) return;
    setSharingBusy(true);
    try {
      const result = await window.editorBridge.applyPageSharing({ projectId: project.id, planId: sharingPlan.planId });
      if (!result.ok) { setSaveMessage(result.error); return; }
      setUndoStack(current => pushHistory({ undo: current, redo: [] }, { id: result.transactionId, kind: 'page-batch' as const, before: 'before', after: 'after' }).undo);
      setRedoStack([]); setSharingPlan(null);
      setSaveMessage(`已应用到 ${result.count} 个网页，可点击撤销；已创建项目备份。`);
    } catch { setSaveMessage('跨网页应用失败，已尝试恢复原文件'); }
    finally { setSharingBusy(false); }
  }

  function changeInteractionAction(value: InteractionAction) { updateInteraction({ action: value }); }

  function pickInteractionTarget() {
    if (!selected) return;
    setPickingInteractionTarget(true);
    setInteractionDirty(true);
    setSaveMessage('请点击预览中的目标元素');
    sendToPreview({ type: 'set-interaction-target', enabled: 'true' });
  }

  async function saveInteraction(): Promise<boolean> {
    const entries = Array.from(pendingInteractions.current);
    for (const [id, draft] of entries) {
      const needsTarget = ['show', 'hide', 'toggle', 'classToggle', 'play', 'pause'].includes(draft.action);
      if (!draft.sourceSelector || (needsTarget && !draft.targetSelector) || (draft.action === 'navigate' && !draft.targetPage) || (draft.action === 'classToggle' && !draft.className.trim())) {
        setSaveMessage(`元素 ${id} 的交互尚未配置完整，请选中它补全目标或样式类名`); return false;
      }
    }
    for (const [id, draft] of entries) {
      const result = await window.editorBridge.saveInteraction({ projectId: project.id, pagePath: currentPage.path, ...draft, className: draft.className.trim() });
      if (!result.ok) { setSaveMessage(result.error); return false; }
      if (pendingInteractions.current.get(id) === draft) pendingInteractions.current.delete(id);
    }
    setInteractionDirty(pendingInteractions.current.size > 0);
    if (pendingInteractions.current.size) { setSaveMessage('保存期间有新的交互修改，请再次保存'); return false; }
    if (entries.length) setSaveMessage(`交互已保存到 ${currentPage.path}`);
    return true;
  }

  async function syncPendingGroups(): Promise<boolean> {
    if (!pendingGroupSync.current.size) return true;
    let updated = 0, skipped = 0;
    for (const [id, group] of Array.from(pendingGroupSync.current)) {
      try {
        const pages = group.pages.filter(path => path !== currentPage.path && project.pages.some(page => page.path === path));
        if (!pages.length) { pendingGroupSync.current.delete(id); continue; }
        const plan = await window.editorBridge.previewGroupSharing({ projectId: project.id, pagePath: currentPage.path, group, pages, viewport });
        if (!plan.ok) { setSaveMessage(plan.error); setDirty(true); return false; }
        const eligible = plan.items.filter(item => item.action === 'update').length;
        skipped += plan.items.length - eligible;
        if (eligible) {
          const applied = await window.editorBridge.applyPageSharing({ projectId: project.id, planId: plan.planId });
          if (!applied.ok) { setSaveMessage(applied.error); setDirty(true); return false; }
          updated += applied.count;
          setUndoStack(current => {
            let index = current.length - 1;
            while (index >= 0 && !(current[index].kind === 'layout' && current[index].groupSync?.id === id && !current[index].pageTransactionId)) index--;
            if (index >= 0) return current.map((change, at) => at === index ? { ...change, pageTransactionId: applied.transactionId } : change);
            return pushHistory({ undo: current, redo: [] }, { id: applied.transactionId, kind: 'page-batch', before: 'before', after: 'after' }).undo;
          });
          setRedoStack([]);
        }
        pendingGroupSync.current.delete(id);
      } catch { setSaveMessage('组合跨网页同步失败；当前网页已保存，可再次点击保存重试'); setDirty(true); return false; }
    }
    setDirty(false);
    setSaveMessage(updated ? `组合位置已同步到选中的 ${updated} 个网页${skipped ? `；${skipped} 个网页没有唯一对应的全部成员或画面，已跳过` : ''}。已创建备份，可撤销。` : '组合已保存到当前网页；所选其他网页没有可唯一匹配的完整组合或画面，未修改。');
    return true;
  }

  function saveAll(): Promise<boolean> {
    if (savingPromise.current) return savingPromise.current;
    setSaving(true);
    const operation = (async () => {
      try {
        if (!(await saveElement()) || !(await saveInteraction())) return false;
        if (pendingEdits.current.size || pendingInteractions.current.size) { setSaveMessage('保存期间有新的修改，请再次保存'); return false; }
        if (!(await syncPendingGroups())) return false;
        return true;
      }
      catch { setSaveMessage('保存失败，已保留当前修改'); return false; }
    })();
    savingPromise.current = operation;
    void operation.finally(() => { lastOwnSave.current = Date.now(); savingPromise.current = null; setSaving(false); });
    return operation;
  }

  async function insertImage() {
    if (!window.editorBridge?.supportsImageInsertion) { setSaveMessage('请重新打开新版编辑器后添加图片。'); return; }
    if (!hasProject || addingImage || saving || aiStage || previewLoading) return;
    setAddingImage(true);
    let waitingForPreview = false;
    try {
      if (mode !== 'edit') setMode('edit');
      const sourcePath = await window.editorBridge.chooseAsset('insert');
      if (!sourcePath) return;
      const result = await window.editorBridge.copyAsset({ projectId: project.id, pagePath: currentPage.path, sourcePath });
      if (!result.ok) { setSaveMessage(result.error); return; }
      lastAssetImport.current = Date.now();
      sendToPreview({ type: 'insert-image', src: result.relativePath, alt: sourcePath.split(/[\\/]/).pop() || '新增图片' });
      waitingForPreview = true;
      setSaveMessage('正在将图片放入画布…');
    } catch { setSaveMessage('图片导入失败，请重新选择文件。'); }
    finally { if (!waitingForPreview) setAddingImage(false); }
  }

  async function replaceImage() {
    const isImage = selected?.tag === 'img';
    const nestedImage = selected?.nestedImage || null;
    const hasBackground = Boolean(selected?.styles.backgroundImage && selected.styles.backgroundImage !== 'none');
    if (!selected || (!isImage && !nestedImage && !hasBackground)) return;
    if (!selected.selector) { setSaveMessage('当前素材没有可保存的定位信息'); return; }
    const sourcePath = await window.editorBridge.chooseAsset();
    if (!sourcePath) return;
    const result = await window.editorBridge.copyAsset({ projectId: project.id, pagePath: currentPage.path, sourcePath });
    if (!result.ok) { setSaveMessage(result.error); return; }
    const kind = isImage ? 'src' : nestedImage ? 'nested' : 'background';
    const index = nestedImage?.index || 0;
    const replacementViewport = imageReplacementScope === 'all' ? 'all'
      : viewport === 'phone' || viewport === 'mobilePortrait' || viewport === 'mobileLandscape' ? 'phone'
      : viewport === 'tablet' ? 'tablet' : 'desktop';
    const imageReplacement: ImageReplacement = { kind, index, src: result.relativePath, viewport: replacementViewport };
    sendToPreview({ type: 'preview-replacement', selector: selected.selector, kind, index: String(index), src: result.relativePath });
    if (isImage) {
      sendToPreview({ type: 'apply-attribute', id: selected.id, name: 'src', value: result.relativePath });
      const selectors = imageSelectorsForSource(selected.selector || selected.styleSelector, selected.src || '', result.relativePath);
      const baseStyleSelector = selectors.styleSelector;
      const nextSelected = { ...selected, ...selectors, baseStyleSelector,
        styleSelector: selected.stateScope ? `:is(${baseStyleSelector})${selected.stateScope}` : baseStyleSelector, src: result.relativePath };
      elementRecords.current.set(editKeyOf(selected), nextSelected);
      setSelected(nextSelected);
    } else if (nestedImage) {
      sendToPreview({ type: 'apply-nested-attribute', id: selected.id, selector: nestedImage.selector, name: 'src', value: result.relativePath });
      const nextSelected = { ...selected, nestedImage: { ...nestedImage, src: result.relativePath } };
      elementRecords.current.set(editKeyOf(selected), nextSelected);
      setSelected(nextSelected);
    } else {
      const backgroundImage = `url("${result.relativePath}")`;
      sendToPreview({ type: 'apply-style', id: selected.id, property: 'backgroundImage', value: backgroundImage });
      setDraftStyles((current) => ({ ...current, backgroundImage }));
      setSelected({ ...selected, styles: { ...selected.styles, backgroundImage } });
    }
    const previous = pendingEdits.current.get(editKeyOf(selected));
    const pending = { ...previous, styles: { ...previous?.styles } };
    if (isImage) pending.attributes = { ...previous?.attributes, src: result.relativePath };
    else if (nestedImage) pending.nestedImage = { selector: nestedImage.selector, src: result.relativePath, index: nestedImage.index };
    else pending.styles.backgroundImage = `url("${result.relativePath}")`;
    pending.imageReplacement = imageReplacement;
    pendingEdits.current.set(editKeyOf(selected), pending);
    setDirty(true);
    setSaveMessage('素材已替换到预览，点击保存写回页面');
  }

  function changePreview(next: PreviewConfig) {
    if (!hasProject || JSON.stringify(next) === JSON.stringify(previewConfig)) return;
    requestSwitch(() => {
      setPreviewConfig(next); setPreviewNonce((current) => current + 1); clearPageState();
      setCustomWidthDraft(String(next.customWidth)); setCustomHeightDraft(String(next.customHeight)); setViewportError('');
      {
        const size = resolvePageViewport(next);
        const mobileOrientation = size.width > size.height ? 'mobileLandscape' : 'mobilePortrait';
        void window.editorBridge.saveSettings({ projectId: project.id, previewConfig: next,
          ...(next.preset !== 'desktop' && next.preset !== 'tablet' ? { mobileOrientation } : {}) }).then((result) => {
          if (!result.ok) setSaveMessage(result.error);
        });
      }
    });
  }

  function chooseViewport(preset: PreviewPreset) {
    changePreview(selectPreviewPreset(previewConfig, preset));
  }

  function applyCustomViewport(swap = false) {
    const width = Number(customWidthDraft);
    const height = Number(customHeightDraft);
    if (!validDimension(width) || !validDimension(height)) {
      setViewportError('宽高请输入 100–4096 之间的整数（CSS 像素）'); return;
    }
    setViewportError('');
    changePreview({ ...previewConfig, preset: 'custom', customWidth: swap ? height : width, customHeight: swap ? width : height });
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
    clearPageState();
    setVersionMessage('已恢复版本，正在重新加载页面');
    setDirty(false);
    setSelected(null); setSelectionCount(0); setSelectedGroupId(''); setMarqueeMode(false);
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
    setSidebarTab('ai');
    setSidebarCollapsed(false);
    setAiActivated(true);
  }

  async function runAiOperation(operation: AiOperation, message: string, action: () => Promise<void>) {
    if (aiOperationRef.current) return;
    if (!hasDesktopBridge) { setAiMessage('这是界面预览，请在桌面版中连接 API。'); return; }
    aiOperationRef.current = true;
    setAiOperation(operation);
    setAiMessage(message);
    try { await action(); }
    catch { setAiMessage('操作失败，请检查连接后重试。你的草稿和方案已保留。'); }
    finally { aiOperationRef.current = false; setAiOperation(null); }
  }

  function toggleAiContextFile(file: string, checked: boolean) {
    setAiSelectedFiles((current) => {
      const next = checked ? [...new Set([...current, file])] : current.filter((item) => item !== file);
      const cached = aiContextCache.current.get(currentPage.path);
      if (cached) cached.selected = next;
      return next;
    });
  }

  async function saveAiSettings() {
    await runAiOperation('settings', '正在保存 API 配置…', async () => {
      const result = await window.editorBridge.saveAiSettings({ ...aiSettings, apiKey: aiKeyDraft });
      if (!result.ok) { setAiMessage(result.error); return; }
      setAiSettings((current) => ({ ...current, apiKeyConfigured: result.apiKeyConfigured }));
      aiSettingsLoaded.current = true;
      setAiConnectionVerified(false);
      setAiKeyDraft('');
      setAiMessage('配置已加密保存在本机。');
    });
  }

  async function testAiConnection() {
    await runAiOperation('connection', '正在测试 API 连接…', async () => {
      const result = await window.editorBridge.testAiConnection({ ...aiSettings, apiKey: aiKeyDraft });
      setAiConnectionVerified(result.ok);
      setAiMessage(result.ok ? result.message : result.error);
    });
  }

  async function generateAiProposal() {
    if (!hasProject) { setAiMessage('选择一个本地项目后即可发送修改请求。'); return; }
    if (aiContextPage !== currentPage.path || !aiSettings.apiKeyConfigured) { setAiMessage('请先完成 API 配置和当前页面上下文读取。'); return; }
    if (dirty || interactionDirty || saving) { setAiMessage('请先保存当前页面的修改，再发送给 AI。'); return; }
    if (aiOperationRef.current || aiStage) return;
    if (!aiSelectedFiles.length) { setAiMessage('至少选择一个代码文件作为上下文。'); return; }
    if (!aiRequest.trim()) { setAiMessage('请描述你希望 AI 编写的复杂交互逻辑。'); return; }
    const request = aiRequest.trim();
    setAiDiffOpen(false);
    const turnId = ++aiTurnSequence.current;
    const pagePath = currentPage.path;
    aiFollowOutput.current = true;
    updateAiConversation({ turns: [...aiTurns, { id: turnId, request }], draft: '', proposal: null });
    const selectedContext = selected ? `当前选中元素：${selected.selector || selected.id}（${selected.tag}），文字：${selected.text.slice(0, 180)}。` : '';
    const history = aiTurns.slice(-3).map((turn) => `用户：${turn.request.slice(0, 240)}\n方案：${(turn.summary || turn.error || '').slice(0, 360)}`).join('\n');
    const context = `\n\n页面：${pagePath}\n${selectedContext}\n历史对话参考（方案可能尚未应用，请以当前代码为准）：\n${history}`;
    const contextualRequest = request + context.slice(0, Math.max(0, 6000 - request.length));
    await runAiOperation('generate', 'AI 正在生成修改方案…', async () => {
      const result = await window.editorBridge.generateAiProposal({ projectId: project.id, pagePath, request: contextualRequest, contextFiles: aiSelectedFiles }).catch(() => ({ ok: false as const, error: '生成失败，请检查连接后重试。草稿已恢复。' }));
      setAiConversations((current) => {
        const conversation = current[pagePath] || newAiConversation();
        return { ...current, [pagePath]: { ...conversation, turns: conversation.turns.map((turn) => turn.id === turnId ? { ...turn, ...(result.ok ? { summary: result.proposal.summary } : { error: result.error }) } : turn), ...(result.ok ? { proposal: result.proposal } : { draft: conversation.draft || request }) } };
      });
      setAiMessage(result.ok ? '方案已生成，可以查看差异并预览效果。' : result.error);
    });
  }

  async function createAiIsolatedPreview() {
    if (!aiProposal) return;
    if (dirty || interactionDirty || saving) { setAiMessage('请先保存当前修改，再预览 AI 方案。'); return; }
    await runAiOperation('preview', '正在创建隔离预览…', async () => {
      const result = await window.editorBridge.createAiPreview({
      projectId: project.id,
      pagePath: currentPage.path,
      summary: aiProposal.summary,
      files: aiProposal.files.map(({ path, content }) => ({ path, content })),
    });
      if (!result.ok) { setAiMessage(result.error); return; }
      setAiStage({ stageId: result.stageId, previewUrl: result.previewUrl });
      setAiMessage('可以在副本中点击验证效果，确认后再应用到原项目。');
    });
  }

  async function applyAiProposal() {
    if (!aiStage) return;
    await runAiOperation('apply', '正在保存快照并应用方案…', async () => {
      const result = await window.editorBridge.applyAiProposal({ projectId: project.id, stageId: aiStage.stageId });
      if (!result.ok) { setAiMessage(result.error); return; }
      setAiMessage(`已应用并保存：${result.files.join('、')}`);
      setAiStage(null);
      setAiProposal(null);
      clearPageState();
      setPreviewNonce((current) => current + 1);
    });
  }

  async function discardAiIsolatedPreview() {
    if (!aiStage) return;
    await runAiOperation('close', '正在返回原页面…', async () => {
      const result = await window.editorBridge.closeAiPreview({ projectId: project.id, stageId: aiStage.stageId });
      if (result.ok) setAiStage(null);
      setAiMessage(result.ok ? '已返回原页面，项目文件未修改。' : result.error);
    });
  }

  function clearPageState() {
    setFreezePending(false); setCapturedFrame(false);
    pendingGroupSync.current.clear();
    setSelected(null); setSelectionCount(0); setSelectedGroupId(''); setSelectedGroupStates([]); setSelectedGroupPages([]); setSelectedGroupVisibility({ mode: 'original', states: [] }); setMarqueeMode(false); setUndoStack([]); setRedoStack([]); setDirty(false);
    backgroundScaleRef.current = 100; setBackgroundScaleDraft(100);
    setInteractionDirty(false); setPickingInteractionTarget(false);
    pendingEdits.current.clear(); elementRecords.current.clear();
    pendingInteractions.current.clear();
    setSaveMessage(''); setVersionOpen(false);
  }

  function requestSwitch(action: (discarded?: boolean) => void) {
    if (addingImage) { setSaveMessage('正在添加图片，请稍候。'); return; }
    if (aiOperationRef.current || aiStage) { setSaveMessage('请先完成 AI 操作或退出隔离预览，再切换页面。'); return; }
    if (savingPromise.current) { setSaveMessage('正在保存，请稍后再切换'); return; }
    if (dirty || interactionDirty) setSwitchAction(() => action);
    else action();
  }

  async function resolveSwitch(save: boolean) {
    if (!switchAction || switchBusy) return;
    setSwitchBusy(true);
    try {
      if (save && !(await saveAll())) return;
      const action = switchAction;
      setSwitchAction(null);
      action(!save);
    } catch { setSaveMessage('保存失败，已保留当前修改'); }
    finally { setSwitchBusy(false); }
  }

  function changePage(page: { path: string; url: string }) {
    if (page.path === currentPage.path) return;
    requestSwitch(() => { clearPageState(); setCurrentPage(page); });
  }

  function closeProject() { requestSwitch(onClose); }

  function chooseMode(next: 'edit' | 'test') {
    if (next === mode) return;
    if (next === 'edit') { freezeNow(); return; }
    requestSwitch(discarded => {
      if (discarded) { clearPageState(); setPreviewNonce((value) => value + 1); }
      setFreezePending(false); setCapturedFrame(false);
      setMode(next);
    });
  }

  function freezeNow() {
    sendToPreview({ type: 'freeze-now' });
    setFreezePending(true);
    setMode('edit');
    setSaveMessage('正在定格当前画面…');
  }

  function reloadPreview() {
    if (addingImage) { setSaveMessage('正在添加图片，请稍候再刷新。'); return; }
    if (savingPromise.current) { setSaveMessage('正在保存，请稍后再刷新'); return; }
    if ((dirty || interactionDirty) && !window.confirm('当前有未保存修改，刷新会丢弃预览修改，是否继续？')) return;
    clearPageState();
    setSourceUpdate(null);
    setPreviewNonce((current) => current + 1);
  }

  const saveHasError = /失败|找不到|无效|失效|暂时/.test(saveMessage);
  const hasUnsavedChanges = dirty || interactionDirty;
  const selectedLabel = !selected ? '元素' : /^h[1-6]$/.test(selected.tag) ? '标题' : selected.tag === 'img' ? '图片' : selected.tag === 'button' ? '按钮' : ['p', 'span', 'label'].includes(selected.tag) ? '文本' : '元素';
  function styleFields(fields: Array<[StyleKey, string]>) {
    return fields.map(([property, label]) => <label className="property-row" key={property}><span>{label}</span><div className={property === 'color' ? 'property-input color-input' : 'property-input'}>{property === 'color' && <span className="color-swatch" style={{ backgroundColor: draftStyles.color || '#20242b' }} />}<input value={draftStyles[property]} onChange={(event) => setDraftStyles((current) => ({ ...current, [property]: event.target.value }))} onBlur={(event) => handleStyleChange(property, event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} placeholder={property === 'color' ? '#20242b' : '数字默认 px'} /></div></label>);
  }

  return (
    <main className="editor-shell">
      <header ref={toolbarRef} className="editor-toolbar">
        <div className="toolbar-project-controls">
        <div className="project-picker">
          <span className="toolbar-mark" aria-label="LayoutEase" title="LayoutEase">L</span>
          <div className="project-select-wrap"><span className="project-current-name" aria-hidden="true">{hasProject ? localProjectLabel(project.rootPath, project.name) : scanning ? '正在发现本地项目…' : '请选择本地项目'}</span><EditorIcon name="chevron" />
          <select id="current-project" aria-label="当前项目" value={project.catalogKey || ''} disabled={Boolean(aiStage)} onChange={(event) => { const key = event.target.value; if (key) requestSwitch(() => { void onSelectProject(key); }); }}>
            <option value="" disabled>{scanning ? '正在发现本地项目…' : '请选择本地项目'}</option>
            {project.catalogKey && !catalog.some((item) => item.key === project.catalogKey) && <option value={project.catalogKey}>{localProjectLabel(project.rootPath, project.name)}</option>}
            {catalog.map((item) => <option key={item.key} value={item.key}>{localProjectLabel(item.rootPath, item.name)}</option>)}
          </select>
          </div>
        </div>
        <button className="toolbar-button browse-folder-button" type="button" disabled={Boolean(aiStage) || !hasDesktopBridge || aiBusy} onClick={() => requestSwitch(() => { void onOpen('project'); })}>浏览文件夹</button>
        <details className="toolbar-menu toolbar-file-menu">
          <summary aria-label="文件菜单">文件<EditorIcon name="chevron" /></summary>
          <div className="toolbar-popover">
            <strong>项目文件</strong>
            <button type="button" disabled={Boolean(aiStage) || !hasDesktopBridge || aiBusy} onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); requestSwitch(() => { void onOpen('file'); }); }}>导入 HTML…</button>
            <button type="button" disabled={scanning || !hasDesktopBridge} onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); onRefresh(); }}>{scanning ? '扫描中…' : '重新扫描项目'}</button>
            <button type="button" disabled={!hasProject || Boolean(aiStage)} onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); reloadPreview(); }}>刷新预览</button>
          </div>
        </details>
        </div>
        <div className="toolbar-undo-controls">
          <button className="toolbar-button icon-toolbar-button" type="button" aria-label="撤销" title="撤销" disabled={undoStack.length === 0 || Boolean(aiStage)} onClick={undo}><EditorIcon name="undo" /></button>
          <button className="toolbar-button icon-toolbar-button" type="button" aria-label="重做" title="重做" disabled={redoStack.length === 0 || Boolean(aiStage)} onClick={redo}><EditorIcon name="redo" /></button>
        </div>
        <div className="toolbar-actions">
          <span className={hasUnsavedChanges ? 'save-state dirty' : 'save-state'}><i />{!hasProject ? '未打开项目' : saving ? '保存中…' : hasUnsavedChanges ? '有未保存修改' : '已保存'}</span>
          <button className="toolbar-button version-toolbar-button" type="button" disabled={!hasProject || Boolean(aiStage) || aiBusy} onClick={() => void openVersions()}><EditorIcon name="history" /><span>版本</span></button>
          <button className="toolbar-button primary-toolbar-button" type="button" disabled={saving || addingImage || !hasProject || Boolean(aiStage)} onClick={() => { if (hasUnsavedChanges) void saveAll(); else setSaveMessage('当前页面已保存。'); }}>{saving ? '保存中…' : '保存'}</button>
          <details className="toolbar-menu">
            <summary aria-label="更多操作" title="更多操作">•••</summary>
            <div className="toolbar-popover">
              <strong>更多操作</strong>
              <button type="button" disabled={!hasProject || Boolean(aiStage)} onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); closeProject(); }}>关闭项目</button>
              <span className="toolbar-popover-divider" />
              <strong>外观</strong>
              <div className="theme-switcher" aria-label="编辑器颜色">
                <button className={theme === 'white' ? 'toolbar-button active' : 'toolbar-button'} aria-pressed={theme === 'white'} onClick={() => onThemeChange('white')}>白色</button>
                <button className={theme === 'black' ? 'toolbar-button active' : 'toolbar-button'} aria-pressed={theme === 'black'} onClick={() => onThemeChange('black')}>黑色</button>
              </div>
            </div>
          </details>
        </div>
      </header>
      <section className="editor-body">
        <aside className={`page-panel ${sidebarTab === 'ai' ? 'ai-panel-open' : 'pages-panel-open'}${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
          <div className="sidebar-tabs" role="tablist" aria-label="左侧面板">
            <button className={sidebarTab === 'pages' ? 'sidebar-tab active' : 'sidebar-tab'} type="button" role="tab" aria-selected={sidebarTab === 'pages'} onClick={() => { setSidebarTab('pages'); setSidebarCollapsed(false); }}>页面</button>
            <button className={sidebarTab === 'ai' ? 'sidebar-tab active' : 'sidebar-tab'} type="button" role="tab" aria-selected={sidebarTab === 'ai'} onClick={() => void openAiAssistant()}>AI 助手</button>
            <button className="sidebar-collapse-button" type="button" aria-label={sidebarCollapsed ? '展开左侧面板' : '折叠左侧面板'} title={sidebarCollapsed ? '展开左侧面板' : '折叠左侧面板'} aria-expanded={!sidebarCollapsed} onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}><EditorIcon name="chevron" /></button>
            {aiStage && <span className="sidebar-stage-indicator">隔离预览中</span>}
          </div>
          <div className="page-sidebar-content" hidden={sidebarTab !== 'pages' || sidebarCollapsed}>
            <div className="sidebar-section-heading"><p className="panel-label">项目页面</p><span>{project.pages.length}</span></div>
            {project.pages.map((page) => <button className={page.path === currentPage.path ? 'page-item active' : 'page-item'} key={page.path} type="button" disabled={Boolean(aiStage)} onClick={() => changePage(page)}><span className="page-item-file">▧</span><span><strong>{page.path}</strong><small>{page.path === currentPage.path ? '当前页面' : '网页文件'}</small></span></button>)}
            <p className="catalog-status" role="status">{catalogMessage}</p>
            <p className="panel-path">{project.rootPath || '尚未打开项目'}</p>
          </div>
          <section className="ai-sidebar" aria-label="AI 对话" hidden={sidebarTab !== 'ai' || sidebarCollapsed}>
            <header className="ai-sidebar-heading">
              <div><strong>当前对话</strong><p>帮你调整页面和交互</p></div>
              <button className="toolbar-button icon-toolbar-button" type="button" aria-label="开始新对话" title="开始新对话" disabled={Boolean(aiStage) || aiBusy} onClick={() => { updateAiConversation(newAiConversation()); aiFollowOutput.current = true; }}><EditorIcon name="plus" /></button>
              <button className={aiSettingsOpen ? 'toolbar-button icon-toolbar-button active' : 'toolbar-button icon-toolbar-button'} type="button" aria-label="AI 连接设置" title="AI 连接设置" onClick={() => setAiSettingsOpen((open) => !open)}><EditorIcon name="settings" /></button>
            </header>
            {aiSettingsOpen && <section className="ai-settings-card" aria-label="AI 连接设置">
              <label>API 地址<input value={aiSettings.apiBaseUrl} onChange={(event) => setAiSettings((current) => ({ ...current, apiBaseUrl: event.target.value }))} placeholder="https://api.openai.com/v1" /></label>
              <label>接口格式<select value={aiSettings.apiFormat} onChange={(event) => setAiSettings((current) => ({ ...current, apiFormat: event.target.value as AiSettingsDraft['apiFormat'] }))}><option value="chat-completions">Chat Completions</option><option value="responses">Responses</option></select></label>
              <label>模型名称<input value={aiSettings.model} onChange={(event) => setAiSettings((current) => ({ ...current, model: event.target.value }))} placeholder="填写服务商提供的模型名" /></label>
              <label>API 密钥<input type="password" value={aiKeyDraft} onChange={(event) => setAiKeyDraft(event.target.value)} placeholder={aiSettings.apiKeyConfigured ? '已配置；留空表示继续使用已保存密钥' : '粘贴你的 API 密钥'} autoComplete="new-password" /></label>
              <div className="ai-settings-actions"><span>{aiSettings.apiKeyConfigured ? '密钥已加密保存在本机' : '尚未配置密钥'}</span><div><button className="toolbar-button" type="button" disabled={aiBusy || !hasDesktopBridge} onClick={() => void testAiConnection()}>{aiOperation === 'connection' ? '测试中…' : '测试连接'}</button><button className="toolbar-button" type="button" disabled={aiBusy || !hasDesktopBridge} onClick={() => void saveAiSettings()}>{aiOperation === 'settings' ? '保存中…' : '保存配置'}</button></div></div>
              {aiMessage && <p className="ai-settings-feedback" role="status">{aiMessage}</p>}
            </section>}
            {aiStage ? <div className="ai-stage-card">
              <span className="ai-stage-badge"><i />隔离测试预览</span>
              <strong>正在预览 AI 修改</strong>
              <p>当前显示项目副本。确认效果后应用，原项目文件才会更新。</p>
              {aiMessage && <small role="status">{aiMessage}</small>}
              <div className="ai-stage-actions"><button className="toolbar-button" type="button" disabled={aiBusy} onClick={() => void discardAiIsolatedPreview()}>返回原页面</button><button className="toolbar-button primary-toolbar-button" type="button" disabled={aiBusy} onClick={() => void applyAiProposal()}>{aiBusy ? '应用中…' : '确认应用'}</button></div>
            </div> : <>
              <div ref={aiChatRef} className="ai-chat-messages" onScroll={(event) => { const area = event.currentTarget; aiFollowOutput.current = area.scrollHeight - area.clientHeight - area.scrollTop < 48; }}>
                <div className="ai-context-pills"><span><EditorIcon name="page" />{hasProject ? currentPage.path : '尚未选择项目'}</span>{selected && <span title={selected.id}>已选中：{selectedLabel}</span>}</div>
                <div className="ai-welcome-message"><span className="ai-sparkle" aria-hidden="true"><EditorIcon name="sparkle" /></span><p>{hasProject ? '想调整哪里？选中元素后，直接告诉我。' : hasDesktopBridge ? '选择一个项目后，就可以在这里调整页面和交互。你也可以先配置 API。' : '这里是 AI 对话界面预览。使用桌面版打开项目后，即可发送修改请求。'}</p></div>
                {aiTurns.map((turn) => <div className="ai-chat-turn" key={turn.id}><div className="ai-user-message">{turn.request}</div>{(turn.summary || turn.error) && <div className="ai-assistant-message"><span className="ai-sparkle" aria-hidden="true"><EditorIcon name="sparkle" /></span><div className="ai-assistant-content">{turn.summary && <strong>修改方案已准备好：</strong>}<p className={turn.error ? 'ai-result-summary error-text' : 'ai-result-summary'}>{turn.summary || turn.error}</p></div></div>}</div>)}
                {aiProposal && <div className="ai-proposal-actions"><small>先预览效果，再应用到页面。</small><div className="ai-proposal-buttons"><button className="toolbar-button primary-toolbar-button" type="button" disabled={aiBusy || hasUnsavedChanges} onClick={() => void createAiIsolatedPreview()}>{aiOperation === 'preview' ? '准备预览中…' : '预览修改'}</button><button className="toolbar-button outlined-button" type="button" aria-expanded={aiDiffOpen} onClick={() => setAiDiffOpen((open) => !open)}>查看差异</button></div><div className="ai-diff-files" hidden={!aiDiffOpen}>{aiProposal.files.map((file) => <details className="ai-file-diff" key={file.path} open><summary>{file.path} · 查看代码差异</summary><div className="ai-diff-columns"><div><strong>修改前</strong><pre>{file.originalContent}</pre></div><div><strong>修改后</strong><pre>{file.content}</pre></div></div></details>)}</div></div>}
                {aiMessage && (!aiProposal || aiBusy) && <p className={/失败|无效|请先|至少|请选择|没有/.test(aiMessage) ? 'ai-chat-status error-text' : 'ai-chat-status'} role="status">{aiBusy && <span className="busy-spinner" aria-hidden="true" />}{aiMessage}</p>}
              </div>
              <div className="ai-chat-composer">
                <details className="ai-context-picker" open={aiContextOpen} onToggle={(event) => setAiContextOpen(event.currentTarget.open)}>
                  <summary>上下文 · {aiSelectedFiles.length} 个文件 <span>⌄</span></summary>
                  <div className="ai-context-list">{!hasProject ? <span>打开桌面项目后选择代码文件。</span> : aiContextPage !== currentPage.path ? <span>正在读取当前页面…</span> : aiContextFiles.length ? aiContextFiles.map((file) => <label key={file}><input type="checkbox" disabled={aiBusy} checked={aiSelectedFiles.includes(file)} onChange={(event) => toggleAiContextFile(file, event.target.checked)} />{file}</label>) : <span>当前页面没有可用的代码文件</span>}</div>
                  <button className="toolbar-button context-refresh-button" type="button" disabled={!hasProject || aiBusy} onClick={() => { aiContextCache.current.delete(currentPage.path); setAiContextRefresh((version) => version + 1); }}>刷新上下文</button>
                  <p className="ai-privacy-note">只会发送勾选文件的源代码到你配置的 API 服务商。</p>
                </details>
                {hasUnsavedChanges && <p className="ai-draft-notice">可以继续输入草稿，保存页面后再发送。</p>}
                <form className="ai-composer-box" onSubmit={(event) => { event.preventDefault(); void generateAiProposal(); }}>
                  <textarea aria-label="描述希望 AI 修改的内容" value={aiRequest} onChange={(event) => setAiRequest(event.target.value)} placeholder="描述你想修改的内容…" maxLength={6000} onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
                  <div><button className="context-add-button" type="button" aria-label="选择代码文件作为上下文" title="选择代码文件作为上下文" onClick={() => setAiContextOpen((open) => !open)}><EditorIcon name="plus" /></button><button type="submit" aria-label="发送给 AI" title="生成修改方案" disabled={aiBusy || !aiSettings.apiKeyConfigured || hasUnsavedChanges || !aiSelectedFiles.length || !aiRequest.trim() || aiContextPage !== currentPage.path}>{aiBusy ? <span className="busy-spinner" /> : <EditorIcon name="send" />}</button></div>
                </form>
                <div className="ai-connection-status"><span className={aiConnectionVerified ? 'connection-dot connected' : 'connection-dot'} />{!hasDesktopBridge ? '界面预览' : aiConnectionVerified ? '连接可用' : aiSettings.apiKeyConfigured ? '已配置 API' : '未配置 API'}<button type="button" onClick={() => setAiSettingsOpen((open) => !open)}>{aiSettings.apiKeyConfigured ? '连接设置' : '配置 API'}</button></div>
              </div>
            </>}
          </section>
        </aside>
        <section ref={previewAreaRef} className="preview-area" aria-label="网页预览">
          <div ref={previewControlsRef} className="preview-controls">
          <div className="preview-device-toolbar">
            <strong>{currentPage.path}</strong>
            <label className="preview-device-choice"><EditorIcon name="monitor" /><span className="sr-only">预览设备</span><select aria-label="预览设备" value={previewConfig.preset} disabled={!hasProject || Boolean(aiStage)} onChange={(event) => chooseViewport(event.target.value as PreviewPreset)}>
              {(Object.keys(viewports) as Viewport[]).map((key) => <option key={key} value={key}>{viewports[key].label}</option>)}
              <option value="huaweiP70ProPlus">华为 Pura 70 Pro+（尺寸模拟）</option><option value="custom">自定义尺寸</option>
            </select></label>
            <span className="preview-caption" title={`${currentViewport.width} × ${currentViewport.height} CSS px${rotatedHuaweiPreview ? `，网页视口 ${pageViewport.width} × ${pageViewport.height}` : ''}，${aiStage ? '隔离测试' : mode === 'edit' ? '编辑模式' : '测试模式'}`}>{currentViewport.width} × {currentViewport.height}</span>
            <div className="preview-action-controls">
              <button className="toolbar-button" type="button" title={window.editorBridge?.supportsImageInsertion ? '添加本地图片，可自由设置宽度和高度' : '请重新打开新版编辑器后添加图片'} disabled={!hasProject || !window.editorBridge?.supportsImageInsertion || addingImage || previewLoading || saving || sharingBusy || Boolean(aiStage)} onClick={() => void insertImage()}><EditorIcon name="plus" />{addingImage ? '添加中…' : '添加图片'}</button>
              <div className="mode-switcher preview-mode-switcher" aria-label="编辑模式">
                <button className={mode === 'edit' ? 'toolbar-button active' : 'toolbar-button'} type="button" title="暂停当前画面并编辑" disabled={Boolean(aiStage)} onClick={() => chooseMode('edit')}>编辑</button>
                <button className={mode === 'test' ? 'toolbar-button active' : 'toolbar-button'} type="button" disabled={!hasProject || Boolean(aiStage)} onClick={() => chooseMode('test')}>测试</button>
              </div>
              <button className={capturedFrame && mode === 'edit' ? 'toolbar-button freeze-capture-button active' : 'toolbar-button freeze-capture-button'} type="button" title="按下立即暂停当前画面并编辑；切换测试继续运行" aria-pressed={capturedFrame && mode === 'edit'} disabled={!hasProject || previewLoading || saving || sharingBusy || addingImage || freezePending || Boolean(aiStage)} onPointerDown={event => { if (event.button === 0) { event.preventDefault(); freezeNow(); } }} onClick={event => { if (event.detail === 0) freezeNow(); }}>{freezePending ? '定格中…' : capturedFrame && mode === 'edit' ? '已定格' : '立即定格'}</button>
              <button className={marqueeMode ? 'toolbar-button active' : 'toolbar-button'} type="button" disabled={!hasProject || previewLoading || mode !== 'edit' || Boolean(aiStage)} aria-pressed={marqueeMode} onClick={() => { setMarqueeMode(!marqueeMode); sendToPreview({ type: 'set-marquee-mode', enabled: String(!marqueeMode) }); setSaveMessage(!marqueeMode ? '在画布上拖出框，覆盖素材的大部分即可多选。' : '已退出框选。'); }}>框选多项</button>
              <button className="toolbar-button icon-toolbar-button" type="button" aria-label="刷新预览" title="刷新预览" disabled={!hasProject || Boolean(aiStage)} onClick={reloadPreview}><EditorIcon name="refresh" /></button>
            </div>
          </div>
          {aiStage && <div className="preview-stage-banner"><span><i />AI 隔离预览 · 在副本中测试，原项目尚未修改</span><button className="toolbar-button" type="button" onClick={() => setSidebarTab('ai')}>查看 AI 对话</button></div>}
          {sourceUpdate && <div className="preview-stage-banner" role="status"><span>课件文件已更新：{sourceUpdate.files.slice(0, 3).join('、')}。为保留当前进度，暂未刷新。</span><button className="toolbar-button" type="button" disabled={saving || Boolean(aiStage)} onClick={reloadPreview}>读取最新文件</button></div>}
          {hasProject && previewConfig.preset === 'huaweiP70ProPlus' && <div className="device-preview-options">
            <div className="preview-size-controls" aria-label="华为手机方向">
              <button className={previewConfig.huaweiOrientation === 'rotatedPortrait' ? 'toolbar-button active' : 'toolbar-button'} type="button" onClick={() => changePreview({ ...previewConfig, huaweiOrientation: 'rotatedPortrait' })}>横屏显示 · 网页 378 × 763</button>
              <button className={previewConfig.huaweiOrientation === 'nativeLandscape' ? 'toolbar-button active' : 'toolbar-button'} type="button" onClick={() => changePreview({ ...previewConfig, huaweiOrientation: 'nativeLandscape' })}>网页原生横屏 · 763 × 378</button>
              <button className="toolbar-button" type="button" onClick={() => changePreview({ ...previewConfig, preset: 'custom', customWidth: pageViewport.width, customHeight: pageViewport.height })}>用网页尺寸自定义</button>
            </div>
            <p className="phone-preview-note">尺寸模拟，使用电脑浏览器内核；保存为手机通用样式，支持横竖屏。微信实际视口与内核可能不同。</p>
            <details><summary>设备视口说明</summary><p>“横屏显示”会让网页按 378 × 763 的网页视口运行，再将整页旋转摆正到横向画布。这个尺寸根据截图估算，不是连接真机的结果。保存的手机通用样式通过实际设备信息及视口判断生效，不再只依赖 500px 宽度线。</p></details>
          </div>}
          {hasProject && previewConfig.preset === 'custom' && <div className="device-preview-options">
            <form className="preview-size-controls" onSubmit={(event) => { event.preventDefault(); applyCustomViewport(); }}>
              <label>宽<input aria-label="自定义预览宽度" type="number" min="100" max="4096" step="1" required value={customWidthDraft} onChange={(event) => setCustomWidthDraft(event.target.value)} /></label>
              <span>×</span>
              <label>高<input aria-label="自定义预览高度" type="number" min="100" max="4096" step="1" required value={customHeightDraft} onChange={(event) => setCustomHeightDraft(event.target.value)} /></label>
              <span>CSS px</span>
              <button className="toolbar-button primary-toolbar-button" type="submit">应用尺寸</button>
              <button className="toolbar-button" type="button" onClick={() => applyCustomViewport(true)}>横竖互换</button>
            </form>
            <details><summary>自定义预览说明</summary><p>填写手机网页实际可视区域宽高；短边不超过 500px 时自动模拟手机 UA 和触控特征。</p></details>
            {viewportError && <p className="error-text" role="alert">{viewportError}</p>}
          </div>}
          </div>
          {!hasProject ? <div className="empty-workspace"><div className="empty-workspace-icon" aria-hidden="true">▤</div><h1>{hasDesktopBridge ? '选择一个页面，开始编辑' : '编辑器界面预览'}</h1><p>{!hasDesktopBridge ? '你可以体验菜单、AI 面板和界面切换。打开本地项目、保存和 AI 请求请使用桌面版。' : scanning ? '正在查找电脑中的 HTML 项目，找到后可从左上方选择。' : '从左上方“当前项目”列表选择本地项目。没有找到？可以浏览文件夹或导入 HTML 文件。'}</p><div>{hasDesktopBridge ? <><button className="toolbar-button primary-toolbar-button" onClick={() => void onOpen('project')}>浏览文件夹</button><button className="toolbar-button" onClick={() => void onOpen('file')}>导入 HTML</button></> : <button className="toolbar-button primary-toolbar-button" onClick={() => void openAiAssistant()}>查看 AI 对话面板</button>}</div><small>{hasDesktopBridge ? '自动发现常用目录与本地磁盘的浅层项目；不会上传页面到网络。' : '浏览器预览不具备桌面文件接口。'}</small></div> : <div className="preview-stage" aria-busy={previewLoading} style={{ width: currentViewport.width * displayScale, height: currentViewport.height * displayScale }}>
            <div className="preview-frame" style={{ width: currentViewport.width, height: currentViewport.height, transform: `scale(${displayScale})` }}>
              <div className={rotatedHuaweiPreview ? 'preview-page rotated' : 'preview-page'} style={rotatedHuaweiPreview ? {
                width: pageViewport.width, height: pageViewport.height, left: '50%', top: '50%',
              } : { width: currentViewport.width, height: currentViewport.height, left: 0, top: 0 }}>
                <iframe key={`${currentPage.path}-${aiStage?.stageId || 'original'}-${previewNonce}`} ref={iframeRef} title={aiStage ? 'AI 修改隔离预览' : '主题单元预览'} style={{
                  width: pageViewport.width,
                  height: pageViewport.height,
                }} src={aiStage?.previewUrl || previewUrlWithMobileEnvironment(currentPage.url, mobileEnvironmentEnabled)} onLoad={() => { setPreviewLoading(false); iframeRef.current?.contentWindow?.postMessage({ source: 'theme-unit-editor', type: 'set-mode', mode: aiStage ? 'test' : mode, viewport }, '*'); }} sandbox="allow-scripts allow-same-origin allow-forms allow-modals" />
              </div>
            </div>
            {previewLoading && <div className="preview-loading" role="status"><span className="busy-spinner" aria-hidden="true" />正在加载页面…</div>}
          </div>}
          {hasProject && <div className="preview-zoom-controls" aria-label="画布缩放">
            <button className="toolbar-button" type="button" aria-label="缩小预览" disabled={zoomFactor <= 0.5} onClick={() => setZoomFactor((value) => Math.max(0.5, Math.round((value - 0.1) * 10) / 10))}>−</button>
            <details className="zoom-popover"><summary aria-label="调整缩放比例">{Math.round(displayScale * 100)}%</summary><div><input type="range" aria-label="预览缩放比例" min="0.5" max="2" step="0.1" value={zoomFactor} onChange={(event) => setZoomFactor(Number(event.target.value))} /></div></details>
            <button className="toolbar-button" type="button" aria-label="放大预览" disabled={zoomFactor >= 2} onClick={() => setZoomFactor((value) => Math.min(2, Math.round((value + 0.1) * 10) / 10))}>＋</button>
            <button className="toolbar-button" type="button" onClick={() => setZoomFactor(1)}>适合窗口</button>
          </div>}
        </section>
        <aside className="inspector-panel">
          <div className="inspector-tabs" role="tablist" aria-label="属性面板">
            <button className={inspectorTab === 'style' ? 'sidebar-tab active' : 'sidebar-tab'} type="button" role="tab" aria-selected={inspectorTab === 'style'} onClick={() => setInspectorTab('style')}>样式</button>
            <button className={inspectorTab === 'interaction' ? 'sidebar-tab active' : 'sidebar-tab'} type="button" role="tab" aria-selected={inspectorTab === 'interaction'} onClick={() => setInspectorTab('interaction')}>交互</button>
          </div>
          <div className="inspector-content">
          {selected && <div className="selection-heading">
            <div className="selection-heading-row">
              <div className="selected-title" data-element-id={selected.id}>{selectionCount > 1 ? `${selectedGroupId ? '组合' : '多选'} · ${selectionCount} 个素材` : selectedLabel}</div>
              <button className="selection-delete-button" type="button" aria-label="删除所选元素" title="删除所选元素（Delete / Backspace）" disabled={mode !== 'edit' || saving || Boolean(aiStage) || (selectionCount > 1 && !window.editorBridge?.supportsSelectionDeletion)} onClick={deleteSelected}>删除</button>
            </div>
            <div className="selected-tag">{selectionCount > 1 ? '按住选框内任意位置或上方拖动条整体移动；双击成员可单独编辑' : `${selected.tag} · ${selected.id}`}</div>
            {selectionCount > 1 && <>
              <label className="property-row"><span>整组画面范围</span><select aria-label="整组画面范围" value={selectedGroupId ? selectedGroupSync : 'temporary'} disabled={mode !== 'edit' || saving || Boolean(aiStage)} onChange={event => {
                const value = event.target.value;
                if (!selectedGroupId) sendToPreview({ type: value === 'all' ? 'group-selection-all' : value === 'selected' ? 'group-selection-selected' : 'group-selection' });
                else { setSelectedGroupSync(value as 'current' | 'selected' | 'all'); sendToPreview({ type: 'set-group-scope', mode: value, states: JSON.stringify(value === 'selected' ? selectedGroupStates.length ? selectedGroupStates : [selected.sceneContext?.value].filter(Boolean) : []) }); }
              }}>
                {!selectedGroupId && <option value="temporary">临时多选（尚未固定）</option>}
                <option value="current" disabled={!selected.sceneContext}>仅当前画面</option>
                <option value="selected" disabled={!selected.sceneContext}>指定多个画面</option>
                <option value="all">本网页全部画面</option>
              </select></label>
              {selectedGroupId && selectedGroupSync === 'selected' && selected.sceneContext && <div className="scope-scene-list" aria-label="组合目标画面">
                {selected.sceneContext.choices.map(scene => <label key={scene.value}><input type="checkbox" checked={selectedGroupStates.includes(scene.value)} disabled={mode !== 'edit' || saving || Boolean(aiStage) || scene.value === selected.sceneContext?.value} onChange={event => {
                  const states = event.target.checked ? [...selectedGroupStates, scene.value] : selectedGroupStates.filter(value => value !== scene.value);
                  setSelectedGroupStates(states);
                  sendToPreview({ type: 'set-group-scope', mode: 'selected', states: JSON.stringify(states) });
                }} />{scene.label}{scene.value === selected.sceneContext?.value ? '（当前）' : ''}</label>)}
              </div>}
              {selectedGroupId && <section className="edit-scope-panel" aria-label="整组出现范围">
                <div className="edit-scope-heading"><strong>整组出现范围</strong><span>默认跟随原课件</span></div>
                <select aria-label="整组出现范围" value={selectedGroupVisibility.mode} disabled={mode !== 'edit' || saving || Boolean(aiStage)} onChange={event => {
                  const nextMode = event.target.value as EditScope['mode'];
                  const states = nextMode === 'selected' ? selectedGroupVisibility.states.length ? selectedGroupVisibility.states : [selected.sceneContext?.value].filter(Boolean) as string[] : [];
                  setSelectedGroupVisibility({ mode: nextMode, states });
                  sendToPreview({ type: 'set-group-visibility', mode: nextMode, states: JSON.stringify(states) });
                }}>
                  <option value="original">保持原状态</option>
                  <option value="current" disabled={!selected.sceneContext}>仅当前画面显示</option>
                  <option value="selected" disabled={!selected.sceneContext}>指定画面显示</option>
                  <option value="all">本网页全部画面显示</option>
                </select>
                {selectedGroupVisibility.mode === 'selected' && selected.sceneContext && <div className="scope-scene-list" aria-label="组合显示画面">
                  {selected.sceneContext.choices.map(scene => <label key={scene.value}><input type="checkbox" checked={selectedGroupVisibility.states.includes(scene.value)} disabled={mode !== 'edit' || saving || Boolean(aiStage) || scene.value === selected.sceneContext?.value} onChange={event => {
                    const states = event.target.checked ? [...selectedGroupVisibility.states, scene.value] : selectedGroupVisibility.states.filter(value => value !== scene.value);
                    setSelectedGroupVisibility({ mode: 'selected', states });
                    sendToPreview({ type: 'set-group-visibility', mode: 'selected', states: JSON.stringify(states) });
                  }} />{scene.label}{scene.value === selected.sceneContext?.value ? '（当前）' : ''}</label>)}
                </div>}
              </section>}
              {selectedGroupId && <section className="edit-scope-panel" aria-label="组合目标网页">
                <div className="edit-scope-heading"><strong>目标网页</strong><span>当前网页始终包含</span></div>
                <div className="scope-scene-list"><label><input type="checkbox" checked disabled />{currentPage.path}（当前）</label>
                  {project.pages.filter(page => page.path !== currentPage.path).map(page => <label key={page.path}><input type="checkbox" checked={selectedGroupPages.includes(page.path)} disabled={mode !== 'edit' || saving || Boolean(aiStage)} onChange={event => {
                    const pages = event.target.checked ? [...selectedGroupPages, page.path] : selectedGroupPages.filter(path => path !== page.path);
                    setSelectedGroupPages(pages);
                    sendToPreview({ type: 'set-group-pages', pages: JSON.stringify(pages) });
                  }} />{page.path}</label>)}
                </div>
              </section>}
              <p className="scope-note">整组拖动后点击保存。选中的画面按整个页面坐标固定；只有勾选的其他网页会同步，且必须找到完整对应素材。检查其他画面时，保存后点上方“测试”操作课件，进入目标画面再点“编辑”。</p>
              <div className="version-actions">
                <button className="toolbar-button" type="button" disabled={Boolean(aiStage) || mode !== 'edit' || saving || Boolean(selectedGroupId)} onClick={() => sendToPreview({ type: 'group-selection' })}>组合 · Ctrl+G</button>
                <button className="toolbar-button" type="button" disabled={Boolean(aiStage) || mode !== 'edit' || saving || !selectedGroupId} onClick={() => sendToPreview({ type: 'ungroup-selection' })}>取消组合 · Ctrl+Shift+G</button>
              </div>
            </>}
          </div>}
          {selectionCount > 1 && <p className="scope-note">整组位置和出现范围可在上方设置；尺寸及其他样式仍可单独编辑成员。</p>}
          <fieldset className="inspector-fields" hidden={selectionCount > 1} disabled={Boolean(aiStage) || mode !== 'edit' || saving || sharingBusy}>
          <div hidden={inspectorTab !== 'style'}>
            {selected ? <>
              <section className="edit-scope-panel" aria-label="素材出现范围">
                <div className="edit-scope-heading"><strong>出现范围</strong><span>默认保持原状态</span></div>
                <select aria-label="素材出现范围" value={selected.visibilityScope?.mode || 'original'} disabled={selected.visibilityScope === undefined} onChange={event => changeVisibilityScope(event.target.value as EditScope['mode'])}>
                  <option value="original">保持原状态（跟随原课件）</option><option value="current" disabled={!selected.sceneContext}>{selected.sceneContext ? '只在当前画面显示' : '当前画面（尚未识别）'}</option><option value="selected" disabled={!selected.sceneContext}>在指定画面显示</option><option value="all">本网页全部画面显示</option>
                </select>
                {selected.visibilityScope?.mode === 'selected' && selected.sceneContext && <div className="scope-scene-list">{selected.sceneContext.choices.map(scene => <label key={scene.value}><input type="checkbox" checked={selected.visibilityScope?.states.includes(scene.value) || false} disabled={scene.value === selected.sceneContext?.value} onChange={event => { const states = selected.visibilityScope?.states || []; changeVisibilityScope('selected', event.target.checked ? [...states, scene.value] : states.filter(value => value !== scene.value)); }} />{scene.label}</label>)}</div>}
                <p className="scope-note">{!selected.visibilityScope || selected.visibilityScope.mode === 'original' ? '沿用课件原有的显示和隐藏规则，切换画面不会被编辑器强制显示。' : !selected.sceneContext ? '当前网页没有可识别的画面状态；此设置按整个网页生效，只保存到当前网页文件。' : '仅在所选画面显示；保存后按此规则保留，不再被答题脚本意外隐藏。'}</p>
              </section>
              <section className="edit-scope-panel" aria-label="修改应用范围">
                <div className="edit-scope-heading"><strong>修改同步范围</strong><span>{selected.sceneContext?.choices.find(scene => scene.value === selected.sceneContext?.value)?.label || '当前网页'}</span></div>
                {!hasLayoutScopes ? <p className="scope-note">重启编辑器后可使用画面范围设置。</p> : <>
                  <div className="scope-property-tabs" role="group" aria-label="设置哪类属性的范围">{([['position', '位置'], ['size', '尺寸'], ['appearance', '其他样式']] as const).map(([group, label]) => <button key={group} type="button" aria-pressed={scopeGroup === group} className={scopeGroup === group ? 'active' : ''} onClick={() => setScopeGroup(group)}>{label}</button>)}</div>
                  {scopeGroup === 'position' && selected.positionGroup && <p className="scope-note">此素材属于位置组合，组合生效的画面会固定内部相对位置。单独调整时，明确选择“仅当前画面”或“指定画面”；其他成员和画面继续跟随组合。</p>}
                  <label className="scope-select"><span className="sr-only">修改应用范围</span><select aria-label="修改应用范围" value={selected.editScopes?.[scopeGroup]?.mode || 'original'} onChange={event => changeEditScope(event.target.value as EditScope['mode'])}><option value="original">{scopeGroup === 'position' && selected.positionGroup ? '保持原状态（跟随组合位置）' : selected.sceneContext ? '保持原状态（默认只改当前画面）' : '保持原状态（未识别画面，暂停修改）'}</option><option value="current" disabled={!selected.sceneContext}>{selected.sceneContext ? '仅当前画面' : '仅当前画面（尚未识别）'}</option><option value="selected" disabled={!selected.sceneContext}>指定画面</option><option value="all">{selected.sceneContext ? '全部画面（当前网页内）' : '整个网页（包含所有画面）'}</option></select></label>
                  {selected.editScopes?.[scopeGroup]?.mode === 'selected' && selected.sceneContext && <div className="scope-scene-list">
                    {selected.sceneContext.choices.map(scene => <label key={scene.value}><input type="checkbox" checked={selected.editScopes?.[scopeGroup]?.states.includes(scene.value) || false} disabled={scene.value === selected.sceneContext?.value} onChange={event => { const states = selected.editScopes?.[scopeGroup]?.states || []; changeEditScope('selected', event.target.checked ? [...states, scene.value] : states.filter(value => value !== scene.value)); }} /><span>{scene.label}{scene.value === selected.sceneContext?.value ? '（当前）' : ''}</span></label>)}
                    {['hint', 'wrong', 'correct'].includes(selected.sceneContext.value) && ['hint', 'wrong', 'correct'].every(value => selected.sceneContext?.choices.some(scene => scene.value === value)) && <button type="button" className="scope-preset" onClick={() => changeEditScope('selected', ['hint', 'wrong', 'correct'])}>关联全部作答画面</button>}
                  </div>}
                  {selected.tag === 'g' && selected.sceneContext && scopeGroup !== 'appearance' && ['all', 'selected'].includes(selected.editScopes?.[scopeGroup]?.mode || '') && <button type="button" className="scope-preset" onClick={() => changeEditScope(selected.editScopes![scopeGroup].mode, selected.editScopes![scopeGroup].states)}>将当前{scopeGroup === 'size' ? '尺寸' : '位置'}固定到所选画面</button>}
                  <p className="scope-note">{selected.tag === 'g' && selected.sceneContext && scopeGroup !== 'appearance' && ['all', 'selected'].includes(selected.editScopes?.[scopeGroup]?.mode || '') ? `以当前${scopeGroup === 'size' ? '宽高' : '位置'}为准，固定各画面中唯一对应的组件；不会添加缺失的组件。设置后点击“保存”。` : !selected.sceneContext ? selected.editScopes?.[scopeGroup]?.mode === 'all' ? '已明确选择整个网页：同一素材在所有画面中的这类属性都会改变。' : '尚未识别课件画面状态，已暂停位置和尺寸修改，防止误改其他画面。需要为课件接入阶段标记。' : selected.editScopes?.[scopeGroup]?.mode === 'all' ? '同步本网页各画面的这一类属性；不改变素材是否显示，也不会添加到其他网页。' : selected.editScopes?.[scopeGroup]?.mode === 'selected' ? `已关联 ${selected.editScopes[scopeGroup].states.length} 个画面；其他画面保持独立。` : '只调整当前画面，未修改的属性保留原值；组合同步不会覆盖此设置。'}</p>
                  <p className="scope-device">设备：{currentViewport.label}<span title={saveScopes[viewport]}>沿用当前设备保存范围</span></p>
                  <small className="scope-note">切换范围会同步这类属性的已有调整；保存后重新打开仍然有效。</small>
                </>}
              </section>
              {selected.tag === 'img' && <details className="page-sharing-panel"><summary>跨网页应用</summary>
                <p className="scope-note">默认不修改其他网页。按公共素材编号或项目内唯一的同源图片匹配；同一网页有多个同图素材时会跳过，避免一起移动。</p>
                {typeof window.editorBridge?.previewPageSharing !== 'function' || !selected.sharingAsset ? <p className="scope-note">重开新版编辑器后可使用。</p> : <>
                  <strong>目标网页</strong>
                  <div className="scope-scene-list">{project.pages.filter(page => page.path !== currentPage.path).map(page => <label key={page.path}><input type="checkbox" checked={sharingPages.includes(page.path)} onChange={event => setSharingPages(current => event.target.checked ? [...current, page.path] : current.filter(value => value !== page.path))} />{page.path}</label>)}</div>
                  {project.pages.length < 2 ? <p className="scope-note">当前项目只有一个 HTML；本网页的答题状态请使用上面的画面范围。</p> : <button type="button" className="scope-preset" onClick={() => setSharingPages(project.pages.filter(page => page.path !== currentPage.path).map(page => page.path))}>选择本项目全部其他网页</button>}
                  {project.pages.length > 1 && <button type="button" className="scope-preset" disabled={!selected.sharingAsset || sharingBusy} onClick={previewPositionOnAllPages}>同步位置到全部网页</button>}
                  <strong>同步内容</strong><div className="scope-scene-list">{[['position', '位置'], ['size', '尺寸'], ['image', '图片内容'], ['visibility', '出现范围']].map(([group, label]) => <label key={group}><input type="checkbox" checked={sharingGroups.includes(group)} onChange={event => setSharingGroups(current => event.target.checked ? [...current, group] : current.filter(value => value !== group))} />{label}</label>)}</div>
                  <label className="sharing-add"><input type="checkbox" checked={sharingAddMissing} onChange={event => setSharingAddMissing(event.target.checked)} />缺少对应公共素材时，自动添加</label>
                  <p className="scope-note">位置以网页主画布为基准，按画布比例同步到各网页；同一素材在不同网页保持相同的整页相对位置。设备范围沿用当前设备。</p>
                  <button type="button" className="toolbar-button" disabled={!sharingPages.length || !sharingGroups.length} onClick={() => void previewSharing()}>保存当前修改并预览应用</button>
                  {sharingPlan && <div className="sharing-plan" role="status"><strong>应用清单</strong>{sharingPlan.items.map(item => <div key={item.page}>{item.page} · {{ add: '新增公共素材', update: '更新对应素材位置', skip: '跳过：没有唯一对应素材' }[item.action]}</div>)}<button type="button" className="toolbar-button primary-toolbar-button" disabled={!sharingPlan.items.some(item => item.action !== 'skip')} onClick={() => void applySharing()}>应用到 {sharingPlan.items.filter(item => item.action !== 'skip').length} 个网页</button></div>}
                </>}
              </details>}
              <section className="inspector-section"><strong>文字内容</strong><label className="property-row"><span className="sr-only">文字内容</span><textarea value={draftText} onChange={(event) => handleTextChange(event.target.value)} /></label></section>
              <section className="inspector-section"><strong>文字样式</strong><div className="property-grid">{styleFields([['fontSize', '字号'], ['color', '颜色']])}</div></section>
              <section className="inspector-section"><strong>尺寸与间距</strong>
                <div className="resize-options">
                  <label className="resize-lock"><input type="checkbox" checked={selected.resizeLockAspect ?? selected.tag === 'img'} disabled={selected.resizeLockAspect === undefined} onChange={event => { const locked = event.target.checked; setSelected(current => current ? { ...current, resizeLockAspect: locked } : current); sendToPreview({ type: 'set-resize-lock', id: selected.id, value: String(locked) }); }} />角点等比缩放</label>
                  {selected.tag === 'img' && <button type="button" className="toolbar-button" disabled={!selected.naturalSize?.width || !selected.naturalSize.height} onClick={() => sendToPreview({ type: 'restore-image-ratio', id: selected.id })}>恢复原图比例</button>}
                </div>
                <p className="resize-note">边缘控制点和输入框始终单独调整宽或高。{selected.resizeLockAspect === undefined ? '重开编辑器后可设置角点缩放。' : selected.resizeLockAspect ? '角点保持当前比例；按住 Alt 再拖角点可自由拉伸。' : '角点自由调整宽高。'}{selected.tag === 'img' ? '自由拉伸会改变图片中文字和边框的比例。' : ''}</p>
                {selected.naturalSize && selected.naturalSize.width > 0 && <small className="resize-note">原图：{selected.naturalSize.width} × {selected.naturalSize.height}；恢复比例时保持当前宽度。</small>}
                <div className="property-grid">{styleFields([['width', '宽度'], ['height', '高度'], ['margin', '外边距'], ['padding', '内边距']])}</div>
              </section>
              {((selected.tag === 'img') || selected.nestedImage || (selected.styles.backgroundImage && selected.styles.backgroundImage !== 'none')) && <>
                <label className="property-row"><span>图片生效设备</span><select aria-label="图片生效设备" value={imageReplacementScope} onChange={event => setImageReplacementScope(event.target.value as 'current' | 'all')}>
                  <option value="current">仅当前设备（{viewport === 'phone' || viewport === 'mobilePortrait' || viewport === 'mobileLandscape' ? '手机' : viewport === 'tablet' ? '平板' : '电脑'}）</option>
                  <option value="all">电脑、平板和手机</option>
                </select></label>
                <button className="asset-button" type="button" onClick={() => void replaceImage()}>{selected.tag === 'img' ? '替换图片' : selected.nestedImage ? '替换按钮图片' : '替换背景图'}</button>
                <p className="scope-note">替换只写入当前网页；脚本重新设置图片时也会保持新素材。需要其他网页使用同一图片，请单独选择跨网页同步。</p>
              </>}
            </> : <p className="empty-inspector">{mode === 'edit' ? '点击预览中的元素进行编辑。' : '测试模式下可以直接操作网页。'}</p>}
            {hasProject && <details className="page-background-panel" aria-label="页面背景缩放">
              <summary>页面背景</summary><div className="page-background-heading"><span>风景缩放</span><output>{backgroundScaleDraft}%</output></div>
              <label className="page-background-control"><span className="sr-only">风景缩放</span><input type="range" aria-label="风景背景缩放" min="70" max="150" step="1" value={backgroundScaleDraft} onChange={(event) => previewBackgroundScale(Number(event.target.value))} onPointerUp={(event) => commitBackgroundScale(Number(event.currentTarget.value))} onPointerCancel={(event) => commitBackgroundScale(Number(event.currentTarget.value))} onKeyUp={(event) => commitBackgroundScale(Number(event.currentTarget.value))} onBlur={(event) => commitBackgroundScale(Number(event.currentTarget.value))} /></label>
              <div className="page-background-actions"><small>只缩放风景背景，不改变画布和前景素材。</small><button className="toolbar-button" type="button" disabled={backgroundScaleDraft === 100} onClick={() => commitBackgroundScale(100)}>恢复原始</button></div>
            </details>}
          </div>
          <div hidden={inspectorTab !== 'interaction'}>
            {selected ? <section className="interaction-panel" aria-label="基础交互">
              <div className="interaction-title">基础交互</div>
              <label className="property-row"><span>点击后动作</span><select value={interactionAction} onChange={(event) => changeInteractionAction(event.target.value as InteractionAction)}><option value="none">不配置</option><option value="navigate">跳转页面</option><option value="back">返回上一页</option><option value="show">显示目标</option><option value="hide">隐藏目标</option><option value="toggle">切换显示</option><option value="classToggle">切换样式</option><option value="play">播放媒体</option><option value="pause">暂停媒体</option></select></label>
              {interactionAction === 'navigate' && <label className="property-row"><span>目标页面</span><select value={interactionPage} onChange={(event) => updateInteraction({ targetPage: event.target.value })}><option value="">请选择页面</option>{project.pages.map((page) => <option key={page.path} value={page.path}>{page.path}</option>)}</select></label>}
              {interactionAction === 'classToggle' && <label className="property-row"><span>样式类名</span><input value={interactionClassName} onChange={(event) => updateInteraction({ className: event.target.value })} placeholder="例如 is-active" /></label>}
              {interactionAction !== 'none' && interactionAction !== 'navigate' && interactionAction !== 'back' && <div className="interaction-target-row"><div className="interaction-target-value" title={interactionTarget}>{interactionTarget || '尚未选择目标'}</div><button className="toolbar-button" type="button" onClick={pickInteractionTarget}>{pickingInteractionTarget ? '请点击目标' : '选择目标'}</button></div>}
              {interactionAction !== 'none' && <p className="interaction-help">先选择动作；需要目标时点击“选择目标”，再点击预览中的元素，最后点击顶部“保存”。</p>}
            </section> : <p className="empty-inspector">选中元素后，设置点击动作和目标。</p>}
          </div>
          </fieldset>
          <details className="inspector-help"><summary><EditorIcon name="help" />编辑帮助</summary><div className="selection-help">点击选择素材，按住 Shift 再点击或使用“框选多项”可多选；多选后按住选框或上方拖动条即可整体移动。Ctrl+G 保存为组合，Ctrl+Shift+G 取消组合；组合可选择“全部匹配网页与画面”，保存一次完成同步；双击组合成员可单独编辑。Alt + 单击可切换重叠图片。选中后可直接拖动，选框会保护当前选择；双击进入内部素材，Alt + 单击切换重叠图片，按住 Shift 拖动可吸附对齐。拖动边缘或角点调整大小，按住 Alt 再拖控制点可临时自由拉伸。需要纠正已变形的图片时，点击“恢复原图比例”。字号与框大小分别调整；数值按 Enter 或离开输入框应用。带图标或多段文字时，仅编辑首段文字，保留其他内容。</div>{selected && <p className="selection-help">元素来源：{selected.sourceType === 'dynamic' || selected.auto ? 'JavaScript 动态生成' : selected.sourceType === 'css' ? 'CSS 样式' : 'HTML'}。</p>}{selected?.auto && <div className="selection-warning">保存时编辑器会自动找到这个网页元素并建立标识，不需要手动改 HTML。</div>}</details>
          </div>
        </aside>
      </section>
      <footer className="editor-statusbar"><span><i />{hasDesktopBridge ? `当前样式：${currentViewport.label}` : '界面预览 · 本地文件和 API 操作请使用桌面版'}{hasProject && <span className="save-scope-note" role="note" title={`保存范围：${saveScopes[viewport]}`}><EditorIcon name="help" /></span>}</span><span className={saveHasError ? 'status-feedback error-text' : 'status-feedback'} role="status" title={saveMessage}>{saveMessage || (aiStage ? 'AI 隔离预览：原项目尚未修改' : hasProject ? '点击元素开始编辑' : '尚未打开项目')}</span></footer>
      {switchAction && <div className="modal-backdrop"><section className="version-modal" role="dialog" aria-modal="true" aria-label="未保存修改"><strong>当前有未保存修改</strong><p>请选择如何处理，再继续操作。</p>{saveMessage && <p role="alert">{saveMessage}</p>}<div className="version-actions"><button className="toolbar-button primary-toolbar-button" disabled={switchBusy} onClick={() => void resolveSwitch(true)}>保存并切换</button><button className="toolbar-button" disabled={switchBusy} onClick={() => void resolveSwitch(false)}>放弃修改并切换</button><button className="toolbar-button" disabled={switchBusy} onClick={() => setSwitchAction(null)}>取消</button></div></section></div>}
      {versionOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setVersionOpen(false)}><section className="version-modal" role="dialog" aria-modal="true" aria-labelledby="version-title" onMouseDown={(event) => event.stopPropagation()}><div className="version-header"><strong id="version-title">项目完整版本</strong><button className="close-button" type="button" onClick={() => setVersionOpen(false)}>×</button></div><div className="version-create-row"><input value={versionNameDraft} onChange={(event) => setVersionNameDraft(event.target.value)} placeholder={hasUnsavedChanges ? '请先保存修改，再创建版本' : '输入版本名称，例如：第一题完成'} disabled={hasUnsavedChanges} /><button className="toolbar-button" type="button" onClick={() => void createNamedVersion()} disabled={hasUnsavedChanges}>创建版本</button></div>{versionMessage && <p className="version-empty">{versionMessage}</p>}{versions.map((version) => <div className="version-row" key={version.id}><span><strong>{version.name || version.reason || '保存版本'}</strong><small>{new Date(version.createdAt).toLocaleString()} · {version.reason || '保存版本'} · {version.files || '当前页面'} · 来源页面：{version.pagePath}</small>{Boolean(version.fileList?.length) && <details><summary>查看快照文件</summary><small>{version.fileList?.join('、')}</small></details>}</span><div className="version-actions"><button className="toolbar-button" type="button" onClick={() => void restoreVersion(version)}>恢复</button><button className="toolbar-button danger-toolbar-button" type="button" onClick={() => void deleteVersion(version)}>删除</button></div></div>)}</section></div>}
    </main>
  );
}

function App() {
  const [project, setProject] = useState<EditorProject | null>(null);
  const [catalog, setCatalog] = useState<LocalProject[]>([]);
  const [scanning, setScanning] = useState(true);
  const [catalogMessage, setCatalogMessage] = useState('正在发现本地项目…');
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<EditorTheme>(() => {
    try { return localStorage.getItem('editor-theme') === 'black' ? 'black' : 'white'; } catch { return 'white'; }
  });
  const requestVersion = useRef(0);
  const startupScanStarted = useRef(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('editor-theme', theme); } catch {}
  }, [theme]);

  function applyOpened(result: OpenProjectResult) {
    if (!result.ok) { if (result.error !== '尚未选择项目') setError(result.error); return; }
    setError(null); setProject(result);
    setCatalogMessage('本地项目已加入列表，可随时切换。');
    const entry = result.pages.find((page) => page.url === result.entryUrl)?.path || 'index.html';
    if (result.catalogKey) setCatalog((current) => [{ key: result.catalogKey!, name: result.name, rootPath: result.rootPath, entryPath: entry, recent: true }, ...current.filter((item) => item.rootPath !== result.rootPath)]);
  }

  async function refreshCatalog(restore = false) {
    if (!hasDesktopBridge) { setScanning(false); setCatalogMessage('在桌面版中选择本地项目。'); return; }
    const version = requestVersion.current;
    setScanning(true);
    try {
      const result = await window.editorBridge.listProjects();
      setCatalog(result.items);
      setCatalogMessage(`找到 ${result.items.length} 个本地项目${result.limited ? '（扫描已达上限，未显示的可手动导入）' : ''}`);
      if (restore && result.lastKey && requestVersion.current === version) {
        const opened = await window.editorBridge.openKnownProject(result.lastKey);
        if (requestVersion.current === version) applyOpened(opened);
      }
    } catch { setCatalogMessage('自动发现暂不可用，可以浏览文件夹或导入 HTML。'); }
    finally { setScanning(false); }
  }

  useEffect(() => { if (!startupScanStarted.current) { startupScanStarted.current = true; void refreshCatalog(true); } }, []);

  async function openProject(kind: 'file' | 'project' = 'project') {
    if (!hasDesktopBridge) { setError('请在桌面版中打开本地项目。'); return; }
    const version = ++requestVersion.current;
    try {
      const result = await window.editorBridge.openProject(kind, project?.id);
      if (version === requestVersion.current) applyOpened(result);
    } catch { setError('打开失败，请检查文件及目录权限'); }
  }

  async function selectProject(key: string) {
    const version = ++requestVersion.current;
    try { const result = await window.editorBridge.openKnownProject(key); if (version === requestVersion.current) applyOpened(result); }
    catch { setError('打开失败，请重新扫描或手动导入'); }
  }

  return <><EditorView key={project?.id || 'empty'} project={project || emptyProject} onClose={() => { requestVersion.current += 1; setProject(null); }} onOpen={openProject}
    catalog={catalog} scanning={scanning} catalogMessage={catalogMessage} onSelectProject={selectProject} onRefresh={() => void refreshCatalog()}
    theme={theme} onThemeChange={setTheme} />{error && <div className="error-toast" role="alert">{error}</div>}</>;
}

export default App;
