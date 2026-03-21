// Generic mock for all @tauri-apps/plugin-* packages
export default {};
export const open = async () => {};
export const save = async () => {};
export const readText = async () => '';
export const writeText = async () => {};
export const readFile = async () => new Uint8Array();
export const writeFile = async () => {};
export const exists = async () => false;
export const mkdir = async () => {};
export const readDir = async () => [];
export const sendNotification = async () => {};
export const exit = async () => {};
export const relaunch = async () => {};
export const startDrag = async () => {};
