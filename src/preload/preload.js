'use strict';

// Güvenli köprü: renderer yalnızca bu beyaz-listeli API'yi görür.
// ipcRenderer doğrudan expose EDİLMEZ.

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('agentAPI', {
  // --- Ayarlar ---
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (partial) => ipcRenderer.invoke('settings:set', partial),
  // Senkron: tema ilk boyamadan önce uygulanmalı (bkz. renderer/theme-boot.js).
  getThemeSync: () => ipcRenderer.sendSync('settings:theme-sync'),

  // --- API anahtarı ---
  hasApiKey: () => ipcRenderer.invoke('apiKey:has'),
  setApiKey: (key) => ipcRenderer.invoke('apiKey:set', key),
  clearApiKey: () => ipcRenderer.invoke('apiKey:clear'),

  // --- Dizin seçimi ---
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),

  // Seçili proje dizininde işletim sistemi terminalini açar.
  openTerminal: (cwd) => ipcRenderer.invoke('terminal:open', cwd),

  // Sürükle-bırak edilen dosyanın diskteki yolu (renderer'a Node API'si açılmaz).
  getDroppedFilePath: (file) => {
    try {
      return webUtils && typeof webUtils.getPathForFile === 'function' ? webUtils.getPathForFile(file) : '';
    } catch {
      return '';
    }
  },

  // --- Kullan?m limitleri / oturum durumu ---
  getUsageLimits: (options) => ipcRenderer.invoke('usage:get', options),

  // --- Model yetenekleri (efor seviyeleri) ---
  getModels: () => ipcRenderer.invoke('models:get'),

  // --- Proje bazlı token/maliyet istatistiği ---
  getUsageStats: () => ipcRenderer.invoke('stats:get'),

  // --- Konuşma geçmişi (sol menü) ---
  listConversations: () => ipcRenderer.invoke('conversation:list'),
  loadConversation: (id) => ipcRenderer.invoke('conversation:load', id),
  deleteConversation: (id) => ipcRenderer.invoke('conversation:delete', id),
  searchConversations: (query) => ipcRenderer.invoke('conversation:search', query),
  exportConversation: (id) => ipcRenderer.invoke('conversation:export', id),

  // --- Agent oturumu ---
  run: (payload) => ipcRenderer.send('agent:run', payload),
  cancel: () => ipcRenderer.send('agent:cancel'),

  // Olay dinleyicileri (temizleme fonksiyonu döner)
  onMessage: (cb) => {
    const listener = (_e, msg) => cb(msg);
    ipcRenderer.on('agent:message', listener);
    return () => ipcRenderer.removeListener('agent:message', listener);
  },
  onDone: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('agent:done', listener);
    return () => ipcRenderer.removeListener('agent:done', listener);
  },
  onError: (cb) => {
    const listener = (_e, err) => cb(err);
    ipcRenderer.on('agent:error', listener);
    return () => ipcRenderer.removeListener('agent:error', listener);
  },
  onPermissionRequest: (cb) => {
    const listener = (_e, req) => cb(req);
    ipcRenderer.on('agent:permission-request', listener);
    return () => ipcRenderer.removeListener('agent:permission-request', listener);
  },
  respondPermission: (res) => ipcRenderer.send('permission:response', res),

  // Konuşma oluşturulduğunda / güncellendiğinde (başlık, sessionId, updatedAt)
  onConversationCreated: (cb) => {
    const listener = (_e, conv) => cb(conv);
    ipcRenderer.on('conversation:created', listener);
    return () => ipcRenderer.removeListener('conversation:created', listener);
  },
  onConversationUpdated: (cb) => {
    const listener = (_e, conv) => cb(conv);
    ipcRenderer.on('conversation:updated', listener);
    return () => ipcRenderer.removeListener('conversation:updated', listener);
  },
});
