'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('owlFocus', {
  snapshot: () => ipcRenderer.invoke('owl:snapshot'),
  activitySnapshot: () => ipcRenderer.invoke('owl:activity-snapshot'),
  activityCommand: value => ipcRenderer.invoke('owl:activity-command',value),
  subscribeActivity: callback => {const handler=(_event,state)=>callback(state);ipcRenderer.on('owl:activity-changed',handler);return ()=>ipcRenderer.removeListener('owl:activity-changed',handler);},
  command: value => ipcRenderer.invoke('owl:command', value),
  drag: value => ipcRenderer.invoke('owl:drag',value),
  onDragReset: callback => {const handler=()=>callback();ipcRenderer.on('owl:drag-reset',handler);return ()=>ipcRenderer.removeListener('owl:drag-reset',handler);},
  embedBounds: value => ipcRenderer.invoke('owl:embed-bounds',value),
  resizeWidget: () => ipcRenderer.invoke('owl:widget-size'),
  enterToolbox: () => ipcRenderer.invoke('owl:enter'),
  returnToolbox: () => ipcRenderer.invoke('owl:return'),
  collapseToolbox: () => ipcRenderer.invoke('owl:collapse'),
  openOtherView: () => ipcRenderer.invoke('owl:open-view'),
  defaults: value => ipcRenderer.invoke('owl:defaults', value),
  subscribe: callback => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('owl:changed', handler);
    return () => ipcRenderer.removeListener('owl:changed', handler);
  },
});
