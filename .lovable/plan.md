# Plan: Perbaiki deteksi OOM palsu & atur resource E2B

## Masalah
- AI di AgentKit mengeluarkan pesan seperti `⚠️ OOM crash (RAM 478MB tidak cukup)`. Tidak ada tool yang mengukur RAM, jadi ini adalah diagnosis yang dibuat-buat (hallucination).
- Saat ini sandbox dibuat dengan template E2B `base` secara hard-coded. Tidak ada setting RAM/template di UI.
- E2B SDK versi ini tidak menerima parameter `memoryMB` saat `Sandbox.create`; resource ditentukan oleh template, bukan argumen runtime.

## Tujuan
1. Beri AI data resource nyata sebelum ia menyimpulkan OOM.
2. Izinkan user memilih template E2B yang lebih besar RAM-nya dari Settings.
3. Update instruksi agar AI tidak mengarang angka RAM atau diagnosis resource.

## Langkah implementasi

### 1. Tool `system_info` untuk AI
- Tambahkan tool baru di `src/lib/agent-tools.server.ts`:
  - Jalankan `free -m`, `df -h /home/user/project`, `nproc`, `cat /proc/loadavg`, `cat /proc/meminfo | head -10`.
  - Kembalikan JSON terstruktur: `memory`, `disk`, `cpus`, `load`.
- Tool ini wajib dipanggil AI sebelum menyimpulkan masalah resource.

### 2. Konfigurasi template E2B di Settings
- Perluas value `app_settings.key = "e2b"` dengan field `templateId` (default `"base"`).
- Di `src/lib/settings.functions.ts`:
  - Tambahkan `getE2BTemplates` yang fetch `https://api.e2b.dev/templates` pakai API key user.
  - Update `saveE2BKey` / `getE2BSettings` untuk membaca/menyimpan `templateId`.
- Di `src/routes/settings.e2b.tsx`:
  - Tambahkan dropdown/select template hasil fetch E2B.
  - Tampilkan template yang sedang aktif dan status koneksi.

### 3. Gunakan template yang dipilih saat membuat sandbox
- Di `src/lib/e2b.server.ts`, ubah `getSandboxForChat` agar membaca `templateId` dari `app_settings.e2b` dan menggunakannya di `Sandbox.create(templateId, ...)`.
- Jika template yang dipilih tidak valid / tidak ditemukan, fallback ke `"base"` dan log warning.

### 4. Update system prompt
- Tambahkan aturan di `src/routes/api/chat.ts`:
  - "Never claim OOM, memory exhaustion, or resource limits unless `system_info` or a tool result explicitly reports it."
  - "Do not invent RAM numbers like '478MB'. If you need resource data, call `system_info`."
  - "When a command fails, report the actual exit code and stderr; do not assume it is OOM."

### 5. Indikator resource di UI (opsional tapi direkomendasikan)
- Di panel Sandbox, tambahkan tombol "Check resources" yang memanggil tool `system_info` dan menampilkan hasilnya.
- Atau tampilkan template yang sedang aktif di header Sandbox Panel.

## Hasil akhir yang diharapkan
- AI berhenti mengeluarkan pesan `RAM 478MB tidak cukup` palsu.
- User bisa memilih template E2B dengan RAM lebih besar dari Settings → E2B.
- AI punya data resource nyata untuk didasari saat debugging error sandbox.

## Catatan teknis
- E2B SDK saat ini tidak menerima argumen `memoryMB` di `Sandbox.create`. Resource diatur lewat template, makanya solusinya adalah pilihan template, bukan slider RAM.
- Custom template dengan RAM lebih besar membutuhkan setup di dashboard E2B user (E2B Teams / custom template), tapi aplikasi cukup menyimpan dan menggunakan `templateId` yang dipilih.
