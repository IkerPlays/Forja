'use strict'
// Acciones de energía del PC pedidas desde Forja (bloquear, suspender, reiniciar, apagar). Solo si el usuario lo permite.
const { execFile } = require('node:child_process')

const ACTIONS = ['lock', 'sleep', 'restart', 'shutdown']

function powerCommand(platform, action) {
  if (!ACTIONS.includes(action)) throw new Error('Acción no válida')
  if (platform === 'win32') {
    return {
      lock: ['rundll32.exe', ['user32.dll,LockWorkStation']],
      sleep: ['rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0']],
      restart: ['shutdown', ['/r', '/t', '10']],
      shutdown: ['shutdown', ['/s', '/t', '10']],
    }[action]
  }
  if (platform === 'darwin') {
    return {
      lock: ['pmset', ['displaysleepnow']],
      sleep: ['pmset', ['sleepnow']],
      restart: ['osascript', ['-e', 'tell application "System Events" to restart']],
      shutdown: ['osascript', ['-e', 'tell application "System Events" to shut down']],
    }[action]
  }
  return {
    lock: ['loginctl', ['lock-session']],
    sleep: ['systemctl', ['suspend']],
    restart: ['systemctl', ['reboot']],
    shutdown: ['systemctl', ['poweroff']],
  }[action]
}

function runPower(action, platform = process.platform) {
  const [cmd, args] = powerCommand(platform, action)
  return new Promise((resolve, reject) => execFile(cmd, args, { windowsHide: true }, err => (err ? reject(new Error('No se pudo ejecutar: ' + err.message)) : resolve())))
}

module.exports = { powerCommand, runPower, ACTIONS }
