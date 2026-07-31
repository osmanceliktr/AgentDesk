# Agent Desk

Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) üzerinden komut verebileceğiniz, saf JavaScript ile yazılmış (TypeScript/React yok) bir Electron masaüstü uygulaması. Windows'ta `.exe` olarak paketlenebilir.

`query()` fonksiyonu **main process** içinde (Node.js) çalışır; renderer'dan gelen komutu alır, agent'ı çalıştırır ve gelen mesajları IPC üzerinden **adım adım (streaming)** arayüze gönderir.

## Özellikler

- Komut girişi + akan mesaj listesi (metin / araç kullanımı / araç sonucu / sonuç ayrı renklerde).
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` + preload köprüsü.
- API anahtarı Electron **`safeStorage`** ile şifrelenip kullanıcı profilinde saklanır — koda gömülü değildir ve renderer'a asla dönmez.
- `dialog.showOpenDialog` ile çalışma dizini seçimi; agent **yalnızca seçilen dizinde** çalışır (`cwd`).
- İzin modeli varsayılan **`plan`** (agent sadece plan üretir, dosya değiştirmez). `default`/`acceptEdits` modunda her araç kullanımı için **onay penceresi** çıkar (`canUseTool` köprüsü). Onay penceresi dosya düzenlemelerini **diff** olarak gösterir ve "bu oturumda hep izin ver" seçeneği sunar (yalnızca uygulama açık kaldığı sürece geçerlidir, diske yazılmaz).
- **Efor (reasoning effort) seçici:** Claude tarafında `low/medium/high/xhigh/max`, Codex tarafında `minimal/low/medium/high/xhigh`. Seçili model efor desteklemiyorsa (ör. Haiku) seçici otomatik kapanır.
- **Canlı akış:** yanıt ve düşünme metni token token akar, tur bitince Markdown olarak yeniden basılır.
- **Kullanım limitleri:** Claude plan pencereleri (5 saatlik / haftalık) ve Codex kotası yüzde + sıfırlanma zamanıyla gösterilir; topbar'daki rozette kalan kota görünür.
- **Maliyet ekranı:** "Maliyet" düğmesi proje bazında token ve $ toplamlarını ayrı bir ekranda gösterir — sağlayıcı (Claude/Codex) ve model kırılımı, en maliyetli sohbetler ve genel toplam. Rakamlar tahmin değildir: Claude SDK'nın her tur için bildirdiği `total_cost_usd`/`modelUsage` değerleri toplanır, Codex maliyet bildirmediği için orada yalnız token gösterilir.
- **Proje ağacı:** sol menüde her sohbet kendi projesinin altında toplanır; proje başlığı açılır/kapanır, yanında sohbet sayısı görünür. Kaydedilmemiş yeni sohbet `taslak` etiketiyle aktif projenin altında bekler. Projesi kaldırılmış sohbetler "Projesiz sohbetler" grubunda kalır.
- Konuşma arama (başlık + içerik, **tüm projelerde**), Markdown olarak dışa aktarma, mesaj kopyalama, son istemi yeniden gönderme.
- **`>_` düğmesi:** seçili proje dizininde komut istemi açar. Windows Terminal kuruluysa her tıklama **aynı pencereye yeni sekme** ekler (`ai-cli-agent` adlı pencere; kullanıcının kendi terminal pencereleri rahatsız edilmez), sekme başlığı proje klasörünün adıdır. Windows Terminal yoksa klasik `cmd` penceresine düşer ve bunu bir kez bildirir. macOS'ta Terminal, Linux'ta `$TERMINAL` kullanılır. Renderer'ın verdiği yol doğrudan kullanılmaz; yalnızca kayıtlı proje/konuşma dizinlerinden biriyse çalışır.
- Klavye kısayolları: `Ctrl+Enter` gönder, `Ctrl+N` yeni konuşma, `Ctrl+K` arama, `Ctrl+,` ayarlar, `Esc` paneli kapat / çalışan turu iptal et. İsteğe bağlı "Enter ile gönder" ayarı.
- **8 tema:** Ayarlar → Tema bölümünden renk örnekli kartlarla seçilir. Tıklandığı anda arayüz değişir (canlı önizleme), **Kaydet** ile kalıcı olur; **Kapat**/`Esc` önizlemeyi geri alır. Seçim uygulama açılışında pencere zeminine de uygulanır, yani açılışta renk flaşı olmaz.

  | Tema | Ton | Karakter |
  | --- | --- | --- |
  | Gece _(varsayılan)_ | koyu | nötr indigo |
  | Gündüz | açık | nötr gri-beyaz |
  | Ceviz Krem | açık | sıcak krem zemin, bakır vurgu |
  | Buz Mavisi | açık | soğuk mavi zemin |
  | Gül Kurusu | açık | pembe-gül zemin |
  | Derin Deniz | koyu | lacivert zemin, camgöbeği vurgu |
  | Bordo Ateş | koyu | erik zemin, mercan vurgu |
  | Zümrüt Orman | koyu | orman yeşili zemin, zümrüt vurgu |

- Ayarlanabilir: `permissionMode`, `maxTurns`, `model`, `effort`, `codexModel`, `codexEffort`, `sendOnEnter`, `theme`, `allowedTools`.

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

- **NSIS installer** (`Agent Desk Setup <sürüm>.exe`) — kurulum sihirbazı.
- **Portable** (`Agent Desk-<sürüm>-portable.exe`) — kurulum gerektirmeyen tek dosya.

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
| `effort` | Claude akıl yürütme eforu: `low` \| `medium` \| `high` \| `xhigh` \| `max` | `high` |
| `codexModel` | Codex modeli (boş → Codex varsayılanı) | `""` |
| `codexEffort` | Codex akıl yürütme eforu: `minimal` \| `low` \| `medium` \| `high` \| `xhigh` (boş → CLI varsayılanı) | `""` |
| `sendOnEnter` | `Enter` gönderir, `Shift+Enter` satır atlar | `false` |
| `allowedTools` | İzin verilen araçlar (**bu araçlar onay penceresi açmadan çalışır**) | `["Read","Grep","Glob"]` |

## Proje yapısı

```
src/
├── main/        # Electron main process (Node.js)
│   ├── main.js            # pencere + IPC + oturum içi izin listesi + kota önbelleği
│   ├── agent.js           # query()/Codex sarmalayıcı (streaming + canUseTool köprüsü)
│   ├── claudeSession.js   # mesaj göndermeyen kısa ömürlü Claude oturumu (kota, model listesi)
│   ├── usageLimits.js     # Claude plan limitleri + Codex app-server kotası
│   ├── usageStats.js      # proje bazlı token/maliyet toplamları
│   ├── terminal.js        # seçili dizinde cmd/Terminal açma (dizin doğrulamalı)
│   ├── providerEnv.js     # alt süreç ortam değişkenleri
│   ├── conversations.js   # geçmiş, arama, Markdown dışa aktarma
│   ├── store.js           # safeStorage + electron-store (anahtar & ayarlar)
│   └── dialogs.js         # dizin seçimi + dosyaya kaydetme
├── preload/     # güvenli contextBridge API
│   └── preload.js
└── renderer/    # saf HTML/CSS/JS arayüz
    ├── index.html
    ├── theme-boot.js      # temayı ilk boyamadan önce uygular (flaş engelleyici)
    ├── renderer.js
    └── style.css          # tema token'ları + 8 [data-theme] paleti
```

> Yeni tema eklemek için dört yer güncellenir: `store.js` içindeki `THEMES` beyaz listesi,
> `main.js` içindeki `THEME_WINDOW_BG`, `style.css` içinde bir `[data-theme]` bloğu ve
> `renderer.js` içindeki `THEME_OPTIONS`. Stil kurallarında sabit renk yoktur; her renk
> `:root` token'larından gelir, yarısaydam zeminler `color-mix()` ile türetilir.

## Güvenlik notları

- API anahtarınızı kimseyle paylaşmayın; uygulama anahtarı OS düzeyinde (`safeStorage`) şifreleyerek saklar.
- Agent yalnızca seçtiğiniz dizinde çalışır. `plan` modu dışında bir modda çalıştırırken açılan onay pencerelerini dikkatle inceleyin.
- `bypassPermissions` modu tüm onayları atlar; yalnızca güvendiğiniz komutlar için kullanın.
- `allowedTools` listesindeki araçlar onay penceresi açmadan çalışır (SDK bunları `canUseTool` çağrılmadan onaylar). Her araç için onay istiyorsanız listeyi boşaltın.
- İzin penceresindeki "bu oturumda hep izin ver" seçimi diske yazılmaz: uygulama kapanınca ve izin modu değişince sıfırlanır.
