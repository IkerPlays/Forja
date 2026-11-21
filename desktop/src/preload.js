'use strict'
const { contextBridge, ipcRenderer } = require('electron')
const inv = (n, ...a) => ipcRenderer.invoke('forja:' + n, ...a)

contextBridge.exposeInMainWorld('forjaDesktop', {
  isDesktop: true,
  info: () => inv('info'),
  getSettings: () => inv('settings:get'),
  setSettings: patch => inv('settings:set', patch),
  pickRoot: () => inv('roots:pick'),
  removeRoot: p => inv('roots:remove', p),
  fs: {
    list: p => inv('fs:list', p),
    size: p => inv('fs:size', p),
    read: (p, offset, length) => inv('fs:read', p, offset, length),
    write: (p, data, append) => inv('fs:write', p, data, append),
    mkdir: p => inv('fs:mkdir', p),
    rename: (a, b) => inv('fs:rename', a, b),
    remove: p => inv('fs:remove', p),
  },
  relayStatus: () => inv('relay:status'),
  inputMouse: m => ipcRenderer.send('forja:input:mouse', m),
  inputKey: m => ipcRenderer.send('forja:input:key', m),
  padSend: (ip, port, state) => ipcRenderer.send('forja:pad', ip, port, state),
})
