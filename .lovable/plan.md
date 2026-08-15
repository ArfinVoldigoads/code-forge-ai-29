# Ganti Sandbox Engine: E2B → Daytona

## Hasil pengecekan (fakta dari dokumentasi Daytona)

Yang jadi keluhan kamu memang bisa diatur di Daytona, dan tidak bisa (tanpa custom template) di E2B:

| Kebutuhan | E2B (sekarang) | Daytona |
| --- | --- | --- |
| Atur RAM/CPU/disk | Harus bikin template sendiri; template `base` kecil | `resources: { cpu, memory, disk }` saat create. Default 1 vCPU / 1 GiB / 3 GiB, limit organisasi sampai **4 vCPU / 8 GiB RAM / 10 GiB disk** |
| Sandbox cepat mati | Lease timeout, harus di-heartbeat terus | `autoStopInterval` bisa di-set `0` = **jalan terus tanpa auto-stop**, plus auto-archive / auto-delete terpisah |
| Setelah mati, kerjaan hilang | Sandbox baru = kosong | **Pause/resume + archive**: filesystem (dan memory untuk VM sandbox) tetap tersimpan, bisa dilanjut |
| Preview HTTPS publik | `getHost(port)` | `getPreviewLink(port)` → URL `https://{port}-{sandboxId}...`; kalau sandbox `public: true` **URL-nya publik tanpa token**, atau pakai signed URL |
| Ubah resource di tengah jalan | Tidak ada | `resize` sandbox (CPU/memory) |
| Ekstra | — | Snapshot/warm pool (start cepat), PTY terminal, log streaming, git ops, secrets |

Kesimpulan: untuk use case AgentKit ini Daytona memang lebih cocok. Rekomendasi: pindah ke Daytona sebagai engine default.

## Yang akan dibangun

### 1. Lapisan provider sandbox
Bikin satu antarmuka bersama (`SandboxDriver`) berisi operasi yang sudah dipakai agent: create/connect, jalankan shell, baca/tulis/list file, background process, preview URL, keep-alive, dan deteksi sandbox mati. Driver E2B yang ada dibungkus jadi implementasi pertama, lalu ditambah driver Daytona. Semua tool agent memanggil antarmuka ini, bukan SDK langsung — jadi tidak ada tool yang perlu ditulis ulang.

### 2. Driver Daytona
- Create sandbox dari image/snapshot dengan `resources: { cpu, memory, disk }` yang diambil dari Settings.
- `autoStopInterval: 0` supaya tidak mati sendiri; auto-archive dipakai sebagai pengaman biaya.
- Reconnect ke sandbox lama; kalau statusnya `stopped`/`archived` → `start()` (resume) dulu, baru kalau benar-benar hilang bikin baru. Ini beda penting dari sekarang: sekarang sandbox mati = mulai dari nol.
- Preview: `getPreviewLink(port)` untuk URL HTTPS; opsi "preview publik" di Settings mengatur `public: true`.
- Shell wrapper (PATH login shell, escaping argumen, hasil non-zero tanpa throw) dipertahankan seperti versi E2B yang sudah stabil.

### 3. Settings → Sandbox
Halaman `Settings → E2B` diganti jadi `Settings → Sandbox`:
- Pilih engine: Daytona (default) atau E2B.
- API key Daytona + tombol Test connection (mask token seperti halaman Integrations).
- Slider/field CPU, RAM, Disk (dibatasi 4 / 8 / 10 sesuai limit Daytona), target image/snapshot, dan toggle preview publik.
- Info status sandbox aktif: id, state, resource terpasang, tombol Restart / Delete.

### 4. Sesi & database
Tabel `sandbox_sessions` dapat kolom `provider` dan `resources` supaya sesi lama (E2B) tetap terbaca dan sesi baru tahu engine-nya. Sesi lama dibiarkan, tidak dihapus.

### 5. Recovery & heartbeat
Logika self-healing yang sudah ada (`withSandbox`, recreate saat lease putus, sync ulang `.env`) dipakai ulang lewat driver. Untuk Daytona urutannya jadi: resume dulu → baru recreate kalau gagal. Heartbeat 60 detik tetap ada tapi jadi jauh lebih ringan karena tidak ada lease pendek.

### 6. Prompt agent
Catatan RAM/disk aktual dimasukkan ke system prompt supaya agent tidak lagi menebak "OOM 478MB", dan preview HTTPS memakai URL Daytona.

## Yang kamu perlu siapkan
API key Daytona (dashboard Daytona → API Keys). Setelah plan ini disetujui, key-nya diisi lewat Settings → Sandbox, tidak ditaruh di kode.

## Catatan teknis
- Paket baru: `@daytonaio/sdk`. E2B tetap terpasang selama masih jadi opsi engine.
- File yang disentuh: `src/lib/e2b.server.ts` (jadi driver), file baru `src/lib/sandbox-driver.server.ts` + `src/lib/daytona.server.ts`, `src/lib/sandbox-ops.server.ts`, `src/lib/sandbox.functions.ts`, `src/lib/agent-tools.server.ts`, `src/lib/settings.functions.ts`, `src/routes/settings.e2b.tsx` → `settings.sandbox.tsx`, `src/routes/settings.tsx`, `src/routes/api/chat.ts`.
- Satu migrasi database untuk kolom `provider` + `resources` di `sandbox_sessions` dan penyimpanan kredensial Daytona di `app_settings`.
