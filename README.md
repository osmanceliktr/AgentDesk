# AI CLI Agent

Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) üzerinden komut verebileceğiniz, saf JavaScript ile yazılmış (TypeScript/React yok) bir Electron masaüstü uygulaması. Windows'ta `.exe` olarak paketlenebilir.

`query()` fonksiyonu **main process** içinde (Node.js) çalışır; renderer'dan gelen komutu alır, agent'ı çalıştırır ve gelen mesajları IPC üzerinden **adım adım (streaming)** arayüze gönderir.

## Özellikler

- Komut girişi + akan mesaj listesi (metin / araç kullanımı / araç sonucu / sonuç ayrı renklerde).
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` + preload köprüsü.
- API anahtarı Electron **`safeStorage`** ile şifrelenip kullanıcı profilinde saklanır — koda gömülü değildir ve renderer'a asla dönmez.
- `dialog.showOpenDialog` ile çalışma dizini seçimi; agent **yalnızca seçilen dizinde** çalışır (`cwd`).
- İzin modeli varsayılan **`plan`** (agent sadece plan üretir, dosya değiştirmez). `default`/`acceptEdits` modunda her araç kullanımı için **onay penceresi** çıkar (`canUseTool` köprüsü).
- Ayarlanabilir: `permissionMode`, `maxTurns`, `model`, `allowedTools`.

## Gereksinimler

- Node.js 18+ (geliştirme için; test edildi: Node 24)
- Bir Anthropic API anahtarı (`ANTHROPIC_API_KEY`)

## Kurulum

```bash
npm install
```

## Geliştirme modu

```bash
npm run dev
```

İlk açılışta:

1. ⚙️ **Ayarlar**'dan API anahtarınızı girin ve kaydedin.
2. 📁 **Dizin Seç** ile agent'ın çalışacağı proje klasörünü seçin.
3. Komutunuzu yazıp **Gönder** (veya `Ctrl+Enter`).

## `.exe` üretme (paketleme)

```bash
npm run build
```

Çıktılar `dist/` klasöründe oluşur:

- **NSIS installer** (`AI CLI Agent Setup <sürüm>.exe`) — kurulum sihirbazı.
- **Portable** (`AI CLI Agent-<sürüm>-portable.exe`) — kurulum gerektirmeyen tek dosya.

Yalnızca birini üretmek için:

```bash
npm run build:nsis      # sadece installer
npm run build:portable  # sadece portable
```

> **İkon:** Kendi ikonunuzu eklemek için `build/icon.ico` dosyasını oluşturun ve `package.json > build.win.icon` alanını ekleyin. Belirtilmezse electron-builder varsayılan Electron ikonunu kullanır.

## Yapılandırma

Ayarlar arayüzden yönetilir ve kullanıcı profilinde saklanır. Örnek bir varsayılan yapı için [`config.example.json`](config.example.json) dosyasına bakın (API anahtarı **bu dosyada tutulmaz**).

| Ayar | Açıklama | Varsayılan |
| --- | --- | --- |
| `permissionMode` | `plan` \| `default` \| `acceptEdits` \| `bypassPermissions` | `plan` |
| `maxTurns` | Agent'ın maksimum tur sayısı | `10` |
| `model` | Kullanılacak Claude modeli | `claude-opus-4-5` |
| `allowedTools` | İzin verilen araçlar | `["Read","Grep","Glob"]` |

## Proje yapısı

```
src/
├── main/        # Electron main process (Node.js)
│   ├── main.js      # pencere + IPC
│   ├── agent.js     # query() sarmalayıcı (streaming + canUseTool köprüsü)
│   ├── store.js     # safeStorage + electron-store (anahtar & ayarlar)
│   └── dialogs.js   # dizin seçimi
├── preload/     # güvenli contextBridge API
│   └── preload.js
└── renderer/    # saf HTML/CSS/JS arayüz
    ├── index.html
    ├── renderer.js
    └── style.css
```

## Güvenlik notları

- API anahtarınızı kimseyle paylaşmayın; uygulama anahtarı OS düzeyinde (`safeStorage`) şifreleyerek saklar.
- Agent yalnızca seçtiğiniz dizinde çalışır. `plan` modu dışında bir modda çalıştırırken açılan onay pencerelerini dikkatle inceleyin.
- `bypassPermissions` modu tüm onayları atlar; yalnızca güvendiğiniz komutlar için kullanın.
