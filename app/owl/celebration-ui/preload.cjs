'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('owlCompletion', Object.freeze({
  onShow(callback) {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('owl:completion-show', handler);
    return () => ipcRenderer.removeListener('owl:completion-show', handler);
  },
  dismiss() {
    ipcRenderer.send('owl:completion-dismiss');
  },
  interactive(value) {
    ipcRenderer.send('owl:completion-interactive', value === true);
  },
}));
