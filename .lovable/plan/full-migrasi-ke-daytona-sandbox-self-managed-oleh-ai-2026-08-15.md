# Full Migrasi ke Daytona + Sandbox Self-Managed oleh AI

Keputusan: E2B dibuang sepenuhnya. Daytona jadi satu-satunya engine sandbox. Preview selalu publik HTTPS. AI punya akses mengelola sandbox-nya sendiri di Daytona (perbesar RAM, restart, benerin jaringan), tapi dipagari supaya tidak bisa menyentuh sandbox milik project/chat lain.

## Kenapa Daytona (hasil cek dokumentasi)

- Resource diatur saat create: `resources: { cpu, memory, disk }`. Default 1 vCPU / 1 GiB / 3 GiB, batas organisasi 4 vCPU / 8 GiB RAM / 10 GiB disk.
- Bisa di-**resize** saat sandbox sudah jalan (CPU/memory naik tanpa kehilangan isi).
- `autoStopInterval: 0` = sandbox jalan terus, tidak mati sendiri seperti lease E2B.
- Pause/resume + archive: filesystem tetap tersimpan, kerjaan bisa dilanjut, bukan mulai dari nol.
- Preview: `getPreviewLink(port)` → `https://{port}-{sandboxId}...`. Kalau sandbox dibuat `public: true`, URL-nya bisa dibuka siapa saja tanpa token.
- Ekstra yang berguna: PTY terminal, log streaming, snapshot/warm pool (start cepat), git ops.

## Yang akan dibangun

### 1. Engine tunggal Daytona
`src/lib/e2b.server.ts` diganti `src/lib/daytona.server.ts` dengan API internal yang sama seperti sekarang (create/connect, runShell, file ops, background process, preview URL, deteksi sandbox mati), sehingga seluruh tool agent tidak perlu ditulis ulang — hanya di-repoint. Wrapper shell yang sudah stabil (login shell + PATH lengkap, escaping argumen, exit code non-throw) dipertahankan.

Sandbox dibuat dengan:
- resource default dari Settings (usulan awal: 2 vCPU / 4 GiB / 8 GiB),
- `autoStopInterval: 0`,
- `public: true`,
- auto-archive sebagai pengaman biaya kalau benar-benar idle lama.

### 2. Resume, bukan bikin ulang
Saat sandbox untuk sebuah chat tidak aktif, urutannya: connect → kalau `stopped`/`archived` maka `start()` (resume, isi project tetap ada) → baru bikin baru kalau sandbox-nya sudah tidak ada. Ini menghilangkan masalah "sandbox mati, kerjaan hilang".

### 3. Preview publik
`startPreview` memakai `getPreviewLink(port)`; URL publik ditampilkan di panel Preview dengan tombol salin dan "buka di tab baru", jadi bisa dibagikan langsung tanpa token.

### 4. AI bisa mengurus sandbox-nya sendiri
Tool baru untuk agent, semuanya terkunci ke sandbox milik chat yang sedang berjalan:

| Tool | Fungsi |
| --- | --- |
| `sandbox_info` | Lihat state, CPU/RAM/disk terpasang, pemakaian memory & disk aktual |
| `sandbox_resize` | Naikkan CPU/RAM/disk saat mepet (dibatasi plafon organisasi 4/8/10) |
| `sandbox_restart` | Stop lalu start ulang saat proses ngaco / port nyangkut |
| `sandbox_network_check` | Diagnosa jaringan: DNS, HTTPS keluar, proxy/registry npm — plus perbaikan otomatis (ganti resolver, set registry, retry) |
| `sandbox_recreate` | Pilihan terakhir: bikin sandbox bersih dan sinkron ulang `.env` |

Pagar keamanan (di server, bukan cuma di prompt): setiap tool memvalidasi `sandboxId` harus milik `chatId` yang sedang aktif di tabel `sandbox_sessions`. Tidak ada tool "list semua sandbox" dan tidak ada tool hapus sandbox milik chat lain — permintaan seperti itu ditolak server dengan pesan jelas.

Prompt agent ditambah aturan: kalau memory/disk mepet → `sandbox_info` lalu `sandbox_resize`, jangan menyerah; kalau internet gagal → `sandbox_network_check` lalu ulangi perintah; baru setelah beberapa cara berbeda gagal boleh lapor.

### 5. Desktop mode: AI bisa "melihat" dan memakai GUI (jawaban soal Windows)

Hasil cek: Daytona punya **Computer Use + VNC**. Itu desktop beneran (Xvfb + xfce4 + noVNC) di dalam sandbox, dengan API mouse, keyboard, screenshot, dan screen recording. Jadi AI bisa buka browser di dalam sandbox, klik-klik sendiri, dan kirim screenshot hasil testing — tidak perlu install Playwright/Chromium manual seperti sekarang.

Soal Windows: Daytona memang punya **VM sandbox Windows** (snapshot `windows-small` 1 vCPU/4 GiB, `windows-medium` 2/8, `windows-large` 4/16, disk 30–50 GiB) dan Computer Use juga jalan di Windows. Tapi untuk kerjaan AgentKit (Node/bun/web dev + preview) Windows lebih lambat, lebih mahal, dan resource-nya terkunci pada kelas snapshot. Rencananya:

- **Default: Linux container** + Desktop mode (VNC/Computer Use) — inilah yang dipakai untuk preview dan testing visual.
- **Windows VM: opsi per-chat** di Settings, dipakai hanya kalau memang butuh aplikasi/tooling Windows.

Yang dibangun untuk desktop mode:
- Tool agent `desktop_start` (nyalakan Xvfb/xfce4/VNC), `desktop_screenshot` (full screen atau region, dikirim ke chat seperti screenshot sekarang), `desktop_click` / `desktop_type` / `desktop_key` untuk berinteraksi, dan `desktop_open_url` untuk membuka preview di browser dalam sandbox.
- Tab **Desktop** baru di panel workspace: viewer noVNC embedded, jadi kamu bisa menonton langsung AI-nya mengetik dan mengklik saat testing.
- Tool `screenshot` yang lama dialihkan ke Computer Use, jadi masalah "Taking screenshot / stuck di ready" hilang.
- Catatan: VNC hanya jalan di image default Daytona; kalau nanti pakai custom image, paket desktopnya harus ikut diinstall.

### 6. Settings → Sandbox
Halaman `Settings → E2B` diganti `Settings → Sandbox` (Daytona):
- API key Daytona + Test connection (token dimask, tidak pernah dikirim balik ke UI).
- Runtime: Linux container (default) / Linux VM / Windows VM.
- Field CPU / RAM / Disk default (dibatasi 4 / 8 / 10 untuk container) dan image/snapshot dasar.
- Toggle preview publik (default aktif) dan toggle Desktop mode + resolusi VNC (`VNC_RESOLUTION`, hanya bisa diset saat sandbox dibuat).
- Status sandbox chat aktif: id, state, resource, tombol Restart / Recreate.


### 7. Database
Satu migrasi: kolom `provider`, `runtime`, `resources`, dan `preview_url` di `sandbox_sessions`; kredensial Daytona disimpan di `app_settings`. Sesi E2B lama ditandai `stopped` dan tidak dipakai lagi.

## Yang kamu siapkan
API key Daytona (dashboard Daytona → API Keys), diisi lewat Settings → Sandbox setelah plan disetujui. Tidak ada key di dalam kode.

## Catatan teknis
- Tambah paket `@daytonaio/sdk`; hapus paket `e2b` dan seluruh kode E2B (`e2b.server.ts`, route `settings.e2b.tsx`, key `e2b` di settings).
- File yang disentuh: `src/lib/daytona.server.ts` (baru), `src/lib/desktop.server.ts` (baru, Computer Use), `src/lib/sandbox-ops.server.ts`, `src/lib/sandbox.functions.ts`, `src/lib/agent-tools.server.ts`, `src/lib/settings.functions.ts`, `src/routes/settings.sandbox.tsx` (baru, menggantikan `settings.e2b.tsx`), `src/routes/settings.tsx`, `src/routes/api/chat.ts`, `src/components/workspace/sandbox-panel.tsx` (tab Desktop).
- Heartbeat tetap ada tapi jadi ringan (update `last_active_at`), karena tidak ada lease pendek yang harus dikejar.
