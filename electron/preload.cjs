const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('editorBridge', {
  openProject: () => ipcRenderer.invoke('project:open'),
  saveElement: (payload) => ipcRenderer.invoke('project:save-element', payload),
  saveInteraction: (payload) => ipcRenderer.invoke('project:save-interaction', payload),
  getInteraction: (payload) => ipcRenderer.invoke('project:get-interaction', payload),
  markElement: (payload) => ipcRenderer.invoke('project:mark-element', payload),
  chooseAsset: () => ipcRenderer.invoke('asset:choose'),
  copyAsset: (payload) => ipcRenderer.invoke('asset:copy', payload),
  listVersions: (payload) => ipcRenderer.invoke('project:list-versions', payload),
  createVersion: (payload) => ipcRenderer.invoke('project:create-version', payload),
  restoreVersion: (payload) => ipcRenderer.invoke('project:restore-version', payload),
  deleteVersion: (payload) => ipcRenderer.invoke('project:delete-version', payload),
  saveSettings: (payload) => ipcRenderer.invoke('project:save-settings', payload),
  getAiSettings: () => ipcRenderer.invoke('ai:get-settings'),
  saveAiSettings: (payload) => ipcRenderer.invoke('ai:save-settings', payload),
  testAiConnection: (payload) => ipcRenderer.invoke('ai:test-connection', payload),
  listAiContext: (payload) => ipcRenderer.invoke('project:list-ai-context', payload),
  generateAiProposal: (payload) => ipcRenderer.invoke('ai:generate-proposal', payload),
  createAiPreview: (payload) => ipcRenderer.invoke('ai:create-isolated-preview', payload),
  applyAiProposal: (payload) => ipcRenderer.invoke('ai:apply-proposal', payload),
  closeAiPreview: (payload) => ipcRenderer.invoke('ai:close-isolated-preview', payload),
});
