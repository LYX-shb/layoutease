const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('editorBridge', {
  openProject: () => ipcRenderer.invoke('project:open'),
  saveElement: (payload) => ipcRenderer.invoke('project:save-element', payload),
  saveInteraction: (payload) => ipcRenderer.invoke('project:save-interaction', payload),
  markElement: (payload) => ipcRenderer.invoke('project:mark-element', payload),
  chooseAsset: () => ipcRenderer.invoke('asset:choose'),
  copyAsset: (payload) => ipcRenderer.invoke('asset:copy', payload),
  listVersions: (payload) => ipcRenderer.invoke('project:list-versions', payload),
  restoreVersion: (payload) => ipcRenderer.invoke('project:restore-version', payload),
  deleteVersion: (payload) => ipcRenderer.invoke('project:delete-version', payload),
  saveSettings: (payload) => ipcRenderer.invoke('project:save-settings', payload),
});
