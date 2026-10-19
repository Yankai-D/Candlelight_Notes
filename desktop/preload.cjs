const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pangzhuDesktop', {
  chooseLibraryDirectory(current) { return ipcRenderer.invoke('pangzhu:choose-library-directory', current); },
  onCloseRequest(handler) {
    const listener = async (_event, { id, phase }) => {
      try { ipcRenderer.send('pangzhu:close-result', { id, ok: true, result: await handler(phase) }); }
      catch (error) { ipcRenderer.send('pangzhu:close-result', { id, ok: false, error: String(error?.message || '保存失败') }); }
    };
    ipcRenderer.on('pangzhu:close-request', listener);
    return () => ipcRenderer.removeListener('pangzhu:close-request', listener);
  },
});
ipcRenderer.on('pangzhu:import', () => window.dispatchEvent(new Event('pangzhu:import')));
ipcRenderer.on('pangzhu:help', () => window.dispatchEvent(new Event('pangzhu:help')));
