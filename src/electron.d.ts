export {};

declare global {
  type OpenProjectResult =
    | { ok: true; id: string; name: string; rootPath: string; entryUrl: string; settings?: { mobileOrientation?: 'mobilePortrait' | 'mobileLandscape' }; pages: Array<{ path: string; url: string }> }
    | { ok: false; error: string };

  interface Window {
    editorBridge: {
      openProject: () => Promise<OpenProjectResult>;
      saveElement: (payload: { projectId: string; pagePath: string; id: string; viewport?: 'desktop' | 'tablet' | 'mobilePortrait' | 'mobileLandscape'; auto?: boolean; tag?: string; path?: string; tagIndex?: number; selector?: string; sourceType?: 'html' | 'css' | 'dynamic'; className?: string; text?: string; outerHTML?: string; styles?: Record<string, string>; attributes?: Record<string, string>; nestedImage?: { selector: string; src: string; index: number } | null }) => Promise<{ ok: true } | { ok: false; error: string }>;
      saveInteraction: (payload: { projectId: string; pagePath: string; sourceSelector: string; action: 'none' | 'navigate' | 'back' | 'show' | 'hide' | 'toggle' | 'classToggle' | 'play' | 'pause'; targetSelector?: string; targetPage?: string; className?: string }) => Promise<{ ok: true } | { ok: false; error: string }>;
      getInteraction: (payload: { projectId: string; pagePath: string; sourceSelector: string }) => Promise<{ ok: true; interaction: { action: 'none' | 'navigate' | 'back' | 'show' | 'hide' | 'toggle' | 'classToggle' | 'play' | 'pause'; targetSelector: string; targetPage: string; className: string } | null } | { ok: false; error: string }>;
      markElement: (payload: { projectId: string; pagePath: string; id: string; tag: string; text: string; outerHTML?: string; styles?: Record<string, string>; attributes?: Record<string, string> }) => Promise<{ ok: true } | { ok: false; error: string }>;
      chooseAsset: () => Promise<string | null>;
      copyAsset: (payload: { projectId: string; pagePath: string; sourcePath: string }) => Promise<{ ok: true; relativePath: string } | { ok: false; error: string }>;
      listVersions: (payload: { projectId: string; pagePath?: string }) => Promise<{ ok: true; versions: Array<{ id: string; pagePath: string; name?: string; reason?: string; files?: string; fileList?: string[]; createdAt: string }> } | { ok: false; error: string }>;
      createVersion: (payload: { projectId: string; pagePath: string; name: string }) => Promise<{ ok: true } | { ok: false; error: string }>;
      restoreVersion: (payload: { projectId: string; pagePath: string; versionId: string }) => Promise<{ ok: true } | { ok: false; error: string }>;
      deleteVersion: (payload: { projectId: string; versionId: string }) => Promise<{ ok: true } | { ok: false; error: string }>;
      saveSettings: (payload: { projectId: string; mobileOrientation: 'mobilePortrait' | 'mobileLandscape' }) => Promise<{ ok: true } | { ok: false; error: string }>;
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
