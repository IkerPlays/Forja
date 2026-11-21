export const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a)
export const warn = (...a) => console.warn(new Date().toLocaleTimeString(), '⚠', ...a)
export const MAX_FILE = 50 * 1024 * 1024
export const sleep = ms => new Promise(r => setTimeout(r, ms))
