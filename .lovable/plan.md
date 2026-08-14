# Deep search yang lebih kuat + koneksi GitHub, Vercel, Cloudflare

Tujuan: agent bisa meneliti web secara mendalam, lalu benar-benar push ke GitHub, deploy ke Vercel, dan menjalankan/membuat Worker di Cloudflare — tanpa bertanya akun mana, karena kredensial sudah tersimpan di Settings.

## 1. Deep search diperkuat

Sekarang `web_search` hanya satu query sekali jalan. Perubahan:

- Tool baru `deep_research(question, depth)`: agent memberi satu pertanyaan, tool sendiri yang
  - memecah jadi 3–6 sub-query,
  - menjalankan search paralel,
  - membuka 4–8 halaman teratas (fetch + bersihkan jadi teks, dedupe per domain),
  - mengembalikan kutipan berlabel `[1] judul — url` beserta potongan teks relevan.
- `web_search` tetap ada untuk lookup cepat; hasil dari kedua tool selalu memuat URL sumber.
- Fallback tanpa API key diperkuat: DuckDuckGo dicoba, lalu Bing HTML, lalu r.jina.ai sebagai pembaca halaman, sehingga riset tidak pernah mati total kalau key kosong.
- Cache hasil fetch per chat (in-memory, TTL pendek) supaya tidak mengambil URL yang sama berulang.
- Prompt: sebelum menjawab pertanyaan teknis yang tidak pasti (API pihak ketiga, error asing), agent wajib `deep_research` dulu dan menyebutkan sumbernya.

## 2. Settings → Integrations (GitHub, Vercel, Cloudflare)

Tab baru **Integrations** di Settings, tiga kartu:

- **GitHub** — Personal Access Token (scope `repo`, `workflow`). Setelah simpan, tombol Test menampilkan username, dan agent selalu tahu akun mana yang dipakai.
- **Vercel** — Access Token (+ Team/Scope ID opsional). Test menampilkan nama akun/team.
- **Cloudflare** — API Token + Account ID. Test memanggil endpoint verifikasi token dan menampilkan nama akun.

Setiap kartu menampilkan status (connected / error / untested), mask token, tombol Test dan Disconnect. Token disimpan server-side saja; UI hanya menerima mask.

## 3. Kemampuan agent yang baru

Tool yang dijalankan di sandbox atau lewat API resmi, semuanya memakai kredensial tersimpan:

**GitHub**
- `github_whoami` — akun aktif.
- `github_create_repo(name, private)` — bikin repo baru bila belum ada.
- `github_push(repo, branch, message)` — init git bila perlu, set remote dengan token (token tidak pernah ikut tercetak di log), commit, push. Kalau remote sudah ada, force-set URL yang benar.

**Vercel**
- `vercel_whoami`, `vercel_list_projects`.
- `vercel_deploy(projectName, prod)` — pakai Vercel CLI di sandbox dengan token; kalau repo sudah di GitHub, boleh pilih link project + deploy. Mengembalikan URL deployment.
- `vercel_deployment_status(id)` — polling status, ambil build log kalau gagal supaya agent bisa memperbaiki dan deploy ulang.

**Cloudflare**
- `cloudflare_whoami`, `cloudflare_list_workers`.
- `cloudflare_deploy_worker(name, entry)` — pastikan ada `wrangler.toml` (dibuat kalau belum), lalu `wrangler deploy` dengan `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` sebagai env. Mengembalikan URL `*.workers.dev`.
- `cloudflare_tail(name)` — ambil log terakhir untuk debugging.

Kalau kredensial belum ada, tool tidak gagal diam-diam: ia mengembalikan pesan "GitHub belum terhubung — buka Settings → Integrations", dan agent memberi tahu user.

## 4. Perilaku loop (sesuai permintaan)

Untuk permintaan seperti "push ke GitHub lalu deploy ke Vercel" atau "jalankan di Cloudflare Worker":

1. `think` — baca kredensial yang tersedia, tentukan target repo/project/worker.
2. `set_phase` — deployment.
3. Jalankan langkah (build → push → deploy), jelaskan singkat di antara tiap langkah.
4. Kalau gagal: baca log asli, `think` lagi, perbaiki (dependency, konfigurasi build, nama project bentrok, `wrangler.toml` salah), coba lagi. Minimal 3 percobaan yang berbeda sebelum menyerah.
5. Verifikasi akhir: `check_preview`/HTTP fetch ke URL hasil deploy, lalu screenshot sebagai bukti, baru merangkum ke user dengan link.

## Detail teknis

- Migrasi: tidak ada tabel baru — kredensial disimpan di `app_settings` dengan key `github`, `vercel`, `cloudflare` (nilai server-only, sudah RLS-locked dan hanya diakses lewat service role).
- `src/lib/integrations.server.ts` — read/write kredensial + fungsi `test*` untuk tiap provider.
- `src/lib/integrations.functions.ts` — server functions `getIntegrations`, `saveIntegration`, `testIntegration`, `deleteIntegration` (semua di balik `requireUnlocked`).
- `src/routes/settings.integrations.tsx` + entri tab baru di `src/routes/settings.tsx`.
- `src/lib/research.server.ts` — orkestrasi deep research (sub-query, fetch paralel, dedupe, sitasi) + fallback pencarian bertingkat di `search.server.ts`.
- `src/lib/agent-tools.server.ts` — tool baru untuk research, GitHub, Vercel, Cloudflare; semua lewat helper `run()` yang sudah ada agar tercatat di `tool_executions` dan tampil live di timeline.
- Token di-inject ke sandbox sebagai environment variable saat eksekusi perintah, tidak pernah ditulis ke file yang bisa terbaca di log.
- `src/routes/api/chat.ts` — tambahan aturan prompt untuk deep research dan alur deploy berulang.
