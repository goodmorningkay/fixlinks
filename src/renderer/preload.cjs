'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fixSettings', {
  getHosts: () => ipcRenderer.invoke('settings:get'),
  saveHosts: (hosts) => ipcRenderer.invoke('settings:save', hosts)
});