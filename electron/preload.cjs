const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('editorBridge', {
  supportsImageInsertion: true,
  supportsSelectionDeletion: true,
  listProjects: () => ipcRenderer.invoke('project:catalog'),
  openKnownProject: (key) => ipcRenderer.invoke('project:open-known', key),
  openProject: (kind, projectId) => ipcRenderer.invoke('project:open', kind, projectId),
  saveElement: (payload) => ipcRenderer.invoke('project:save-element', payload),
  saveLayoutEdits: (payload) => ipcRenderer.invoke('project:save-layout-edits', payload),
  previewPageSharing: payload => ipcRenderer.invoke('project:preview-page-sharing', payload),
  previewGroupSharing: payload => ipcRenderer.invoke('project:preview-group-sharing', payload),
  applyPageSharing: payload => ipcRenderer.invoke('project:apply-page-sharing', payload),
  restorePageSharing: payload => ipcRenderer.invoke('project:restore-page-sharing', payload),
  savePageBackgroundScale: (payload) => ipcRenderer.invoke('project:save-background-scale', payload),
  saveInteraction: (payload) => ipcRenderer.invoke('project:save-interaction', payload),
  getInteraction: (payload) => ipcRenderer.invoke('project:get-interaction', payload),
  markElement: (payload) => ipcRenderer.invoke('project:mark-element', payload),
  chooseAsset: purpose => ipcRenderer.invoke('asset:choose', purpose),
  copyAsset: (payload) => ipcRenderer.invoke('asset:copy', payload),
  listVersions: (payload) => ipcRenderer.invoke('project:list-versions', payload),
  createVersion: (payload) => ipcRenderer.invoke('project:create-version', payload),
  restoreVersion: (payload) => ipcRenderer.invoke('project:restore-version', payload),
  deleteVersion: (payload) => ipcRenderer.invoke('project:delete-version', payload),
  saveSettings: (payload) => ipcRenderer.invoke('project:save-settings', payload),
  onProjectSourceChanged: (callback) => {
    const listener = (_event, change) => callback(change);
    ipcRenderer.on('project:source-changed', listener);
    return () => ipcRenderer.removeListener('project:source-changed', listener);
  },
  getAiSettings: () => ipcRenderer.invoke('ai:get-settings'),
  saveAiSettings: (payload) => ipcRenderer.invoke('ai:save-settings', payload),
  testAiConnection: (payload) => ipcRenderer.invoke('ai:test-connection', payload),
  listAiContext: (payload) => ipcRenderer.invoke('project:list-ai-context', payload),
  generateAiProposal: (payload) => ipcRenderer.invoke('ai:generate-proposal', payload),
  createAiPreview: (payload) => ipcRenderer.invoke('ai:create-isolated-preview', payload),
  applyAiProposal: (payload) => ipcRenderer.invoke('ai:apply-proposal', payload),
  closeAiPreview: (payload) => ipcRenderer.invoke('ai:close-isolated-preview', payload),
});
