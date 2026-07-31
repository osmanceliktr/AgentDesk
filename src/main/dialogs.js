'use strict';

const fs = require('fs');
const { dialog, BrowserWindow } = require('electron');

// Agent'ın çalışacağı proje dizinini seçtirir.
// İptal edilirse null döner.
async function selectDirectory() {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    title: 'Agent için çalışma dizini seçin',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
}

// Metni kullanıcının seçtiği dosyaya yazar. İptal edilirse { canceled: true } döner.
async function saveTextFile({ title, defaultPath, content, filters }) {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showSaveDialog(win, {
    title: title || 'Kaydet',
    defaultPath,
    filters: filters || [{ name: 'Markdown', extensions: ['md'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  fs.writeFileSync(result.filePath, content, 'utf8');
  return { canceled: false, path: result.filePath };
}

module.exports = { selectDirectory, saveTextFile };
