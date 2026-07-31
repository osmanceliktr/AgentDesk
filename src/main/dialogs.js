'use strict';

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

module.exports = { selectDirectory };
