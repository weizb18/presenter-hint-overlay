'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('overlay', {
  repositionDone: () => ipcRenderer.send('reposition-done'),
  resizeStart: () => ipcRenderer.send('resize-start'),
  resizeTo: (dx, dy) => ipcRenderer.send('resize-to', dx, dy),
  resizeEnd: () => ipcRenderer.send('resize-end'),
  onSize: (cb) => ipcRenderer.on('size', (_e, s) => cb(s))
})
