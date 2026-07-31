'use strict';

// Tema, ilk boyamadan ÖNCE uygulanmalı; aksi halde varsayılan (Gece) palet bir an
// görünüp seçili temaya atlar. Bu yüzden <head> içinde senkron çalışır ve
// preload'un senkron köprüsünü kullanır. Hata durumunda :root varsayılanı devrede kalır.
try {
  const theme = window.agentAPI && window.agentAPI.getThemeSync();
  if (theme) document.documentElement.dataset.theme = theme;
} catch (err) {
  console.warn('[theme] okunamadı:', err && err.message);
}
