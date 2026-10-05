export {};

declare global {
  type OpenProjectResult =
    | { ok: true; id: string; name: string; rootPath: string; entryUrl: string; settings?: { mobileOrientation?: 'mobilePortrait' | 'mobileLandscape' }; pages: Array<{ path: string; url: string }> }
    | { ok: false; error: string };

  interface Window {
    editorBridge: {
      openProject: () => Promise<OpenProjectResult>;
      saveElement: (payload: { projectId: string; pagePath: string; id: string; viewport?: 'desktop' | 'tablet' | 'mobilePortrait' | 'mobileLandscape'; auto?: boolean; tag?: string; path?: string; tagIndex?: number; selector?: string; sourceType?: 'html' | 'dynamic'; className?: string; text?: string; outerHTML?: string; styles?: Record<string, string>; attributes?: Record<string, string>; nestedImage?: { selector: string; src: string; index: number } | null }) => Promise<{ ok: true } | { ok: false; error: string }>;
      saveInteraction: (payload: { projectId: string; pagePath: string; sourceSelector: string; action: 'navigate' | 'back' | 'show' | 'hide' | 'toggle' | 'classToggle' | 'play' | 'pause'; targetSelector?: string; targetPage?: string; className?: string }) => Promise<{ ok: true } | { ok: false; error: string }>;
      markElement: (payload: { projectId: string; pagePath: string; id: string; tag: string; text: string; outerHTML?: string; styles?: Record<string, string>; attributes?: Record<string, string> }) => Promise<{ ok: true } | { ok: false; error: string }>;
      chooseAsset: () => Promise<string | null>;
      copyAsset: (payload: { projectId: string; pagePath: string; sourcePath: string }) => Promise<{ ok: true; relativePath: string } | { ok: false; error: string }>;
      listVersions: (payload: { projectId: string; pagePath?: string }) => Promise<{ ok: true; versions: Array<{ id: string; pagePath: string; reason?: string; files?: string; createdAt: string }> } | { ok: false; error: string }>;
      restoreVersion: (payload: { projectId: string; pagePath: string; versionId: string }) => Promise<{ ok: true } | { ok: false; error: string }>;
      deleteVersion: (payload: { projectId: string; versionId: string }) => Promise<{ ok: true } | { ok: false; error: string }>;
      saveSettings: (payload: { projectId: string; mobileOrientation: 'mobilePortrait' | 'mobileLandscape' }) => Promise<{ ok: true } | { ok: false; error: string }>;
    };
  }
}
