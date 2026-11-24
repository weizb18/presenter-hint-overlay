'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('m0', {
  open: (url) => ipcRenderer.send('open-url', url),
  reload: () => ipcRenderer.send('reload'),
  devtools: () => ipcRenderer.send('devtools'),
  onStatus: (cb) => ipcRenderer.on('status', (_e, s) => cb(s))
})
