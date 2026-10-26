export {};

declare global {
  type LocalProject = { key: string; name: string; rootPath: string; entryPath: string; recent: boolean };
  type OpenProjectResult =
    | { ok: true; id: string; catalogKey?: string; name: string; rootPath: string; entryUrl: string; settings?: { mobileOrientation?: 'mobilePortrait' | 'mobileLandscape'; previewConfig?: import('./preview-presets').PreviewConfig }; pages: Array<{ path: string; url: string }> }
    | { ok: false; error: string };

  interface Window {
    editorBridge: {
      supportsImageInsertion?: boolean;
      supportsSelectionDeletion?: boolean;
      listProjects: () => Promise<{ ok: true; items: LocalProject[]; limited: boolean; lastKey: string }>;
      openKnownProject: (key: string) => Promise<OpenProjectResult>;
      openProject: (kind?: 'file' | 'project', projectId?: string) => Promise<OpenProjectResult>;
      saveLayoutEdits: (payload: { projectId: string; pagePath: string; config: unknown }) => Promise<{ ok: true } | { ok: false; error: string }>;
      previewPageSharing: (payload: { projectId: string; pagePath: string; asset: unknown; pages: string[]; groups: string[]; addMissing: boolean; viewport: string; visibility: unknown }) => Promise<{ ok: true; planId: string; items: Array<{ page: string; action: 'add' | 'update' | 'skip' }> } | { ok: false; error: string }>;
      previewGroupSharing: (payload: { projectId: string; pagePath: string; group: unknown; pages: string[]; viewport: string }) => Promise<{ ok: true; planId: string; items: Array<{ page: string; action: 'update' | 'skip' }> } | { ok: false; error: string }>;
      applyPageSharing: (payload: { projectId: string; planId: string }) => Promise<{ ok: true; transactionId: string; count: number } | { ok: false; error: string }>;
      restorePageSharing: (payload: { projectId: string; transactionId: string; side: 'before' | 'after' }) => Promise<{ ok: true } | { ok: false; error: string }>;
      saveElement: (payload: { projectId: string; pagePath: string; id: string; viewport?: 'desktop' | 'tablet' | 'mobilePortrait' | 'mobileLandscape' | 'phone'; auto?: boolean; tag?: string; path?: string; tagIndex?: number; selector?: string; styleSelector?: string; stateScope?: string; baseStyleSelector?: string; sourceType?: 'html' | 'css' | 'dynamic'; className?: string; text?: string; outerHTML?: string; styles?: Record<string, string>; attributes?: Record<string, string>; nestedImage?: { selector: string; src: string; index: number } | null; imageReplacement?: { kind: 'src' | 'nested' | 'background'; index: number; src: string; viewport: 'all' | 'desktop' | 'tablet' | 'phone' } }) => Promise<{ ok: true } | { ok: false; error: string }>;
      savePageBackgroundScale: (payload: { projectId: string; pagePath: string; scale: number }) => Promise<{ ok: true } | { ok: false; error: string }>;
      saveInteraction: (payload: { projectId: string; pagePath: string; sourceSelector: string; action: 'none' | 'navigate' | 'back' | 'show' | 'hide' | 'toggle' | 'classToggle' | 'play' | 'pause'; targetSelector?: string; targetPage?: string; className?: string }) => Promise<{ ok: true } | { ok: false; error: string }>;
      getInteraction: (payload: { projectId: string; pagePath: string; sourceSelector: string }) => Promise<{ ok: true; interaction: { action: 'none' | 'navigate' | 'back' | 'show' | 'hide' | 'toggle' | 'classToggle' | 'play' | 'pause'; targetSelector: string; targetPage: string; className: string } | null } | { ok: false; error: string }>;
      markElement: (payload: { projectId: string; pagePath: string; id: string; tag: string; text: string; outerHTML?: string; styles?: Record<string, string>; attributes?: Record<string, string> }) => Promise<{ ok: true } | { ok: false; error: string }>;
      chooseAsset: (purpose?: 'insert' | 'replace') => Promise<string | null>;
      copyAsset: (payload: { projectId: string; pagePath: string; sourcePath: string }) => Promise<{ ok: true; relativePath: string } | { ok: false; error: string }>;
      listVersions: (payload: { projectId: string; pagePath?: string }) => Promise<{ ok: true; versions: Array<{ id: string; pagePath: string; name?: string; reason?: string; files?: string; fileList?: string[]; createdAt: string }> } | { ok: false; error: string }>;
      createVersion: (payload: { projectId: string; pagePath: string; name: string }) => Promise<{ ok: true } | { ok: false; error: string }>;
      restoreVersion: (payload: { projectId: string; pagePath: string; versionId: string }) => Promise<{ ok: true } | { ok: false; error: string }>;
      deleteVersion: (payload: { projectId: string; versionId: string }) => Promise<{ ok: true } | { ok: false; error: string }>;
      saveSettings: (payload: { projectId: string; mobileOrientation?: 'mobilePortrait' | 'mobileLandscape'; previewConfig?: import('./preview-presets').PreviewConfig }) => Promise<{ ok: true } | { ok: false; error: string }>;
      onProjectSourceChanged?: (callback: (change: { projectId: string; files: string[]; changedAt: number }) => void) => () => void;
      getAiSettings: () => Promise<{ ok: true; apiBaseUrl: string; apiFormat: 'chat-completions' | 'responses'; model: string; apiKeyConfigured: boolean }>;
      saveAiSettings: (payload: { apiBaseUrl: string; apiFormat: 'chat-completions' | 'responses'; model: string; apiKey?: string }) => Promise<{ ok: true; apiKeyConfigured: boolean } | { ok: false; error: string }>;
      testAiConnection: (payload: { apiBaseUrl?: string; apiFormat?: 'chat-completions' | 'responses'; model?: string; apiKey?: string }) => Promise<{ ok: true; message: string } | { ok: false; error: string }>;
      listAiContext: (payload: { projectId: string; pagePath: string }) => Promise<{ ok: true; files: string[]; recommended: string[] } | { ok: false; error: string }>;
      generateAiProposal: (payload: { projectId: string; pagePath: string; request: string; contextFiles: string[] }) => Promise<{ ok: true; proposal: { summary: string; files: Array<{ path: string; content: string; originalContent: string }> } } | { ok: false; error: string }>;
      createAiPreview: (payload: { projectId: string; pagePath: string; summary: string; files: Array<{ path: string; content: string }> }) => Promise<{ ok: true; stageId: string; previewUrl: string } | { ok: false; error: string }>;
      applyAiProposal: (payload: { projectId: string; stageId: string }) => Promise<{ ok: true; files: string[] } | { ok: false; error: string }>;
      closeAiPreview: (payload: { projectId: string; stageId: string }) => Promise<{ ok: true } | { ok: false; error: string }>;
    };
  }
}
