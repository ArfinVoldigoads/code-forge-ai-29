# agentkit → all-in-one agent

Tujuan: agent tidak lagi "planning lalu satu kali jalan sandbox", tapi berjalan seperti Lovable/v0 — menjelaskan, bekerja, menjelaskan lagi, bekerja lagi, sampai selesai dan terverifikasi.

## 1. Alur berselang-seling (interleaved)

Sekarang UI menaruh semua tool di satu blok, jadi urutan cerita hilang. Perubahan:

- Chat menyimpan **timeline berurutan**: teks → tool → teks → tool → teks.
- Setiap langkah agent (step) yang menghasilkan teks langsung ditampilkan sebagai paragraf penjelasan, lalu kartu tool di bawahnya, lalu penjelasan berikutnya.
- Prompt sistem diubah: agent wajib menjelaskan singkat sebelum dan sesudah tiap aksi, dan terus lanjut sampai tugas benar-benar jadi.
- Riwayat pesan lama tetap bisa dibaca (fallback ke tampilan sekarang).

## 2. Kemampuan baru agent

**Eksplorasi kode**
- `search_files` (grep isi file), `glob_files` (cari path), `read_file` dengan rentang baris, `apply_patch` (edit sebagian, tidak menimpa seluruh file), `delete_file` / `move_file`.
- `project_tree` untuk ringkasan struktur project.

**Skills**
- Tool `list_skills` + `read_skill` supaya agent bisa membuka instruksi skill sesuai kebutuhan, bukan semua di-inject ke prompt. Skill tetap dikelola di Settings → Skills.

**Deep search (riset web)**
- Tool `web_search` + `fetch_url` (ambil halaman, dibersihkan jadi teks).
- Halaman baru **Settings → Search** untuk menaruh API key search (Tavily / Brave / Serper). Kalau kosong, tool memberi tahu agent bahwa riset web belum aktif — bukan mengarang hasil.
- Mode "deep": agent boleh melakukan beberapa putaran search + fetch lalu merangkum sumbernya (dengan link).

**Preview & screenshot sendiri**
- Tool `start_dev_server` (jalan di background, port 5173, host 0.0.0.0) dan `get_preview_url`.
- Tool `screenshot` — menjalankan Chromium headless (Playwright, di-install sekali per sandbox lalu di-cache) di dalam sandbox, memotret URL preview, mengambil console error, lalu mengunggah PNG ke storage.
- Gambar tampil langsung di chat sebagai bukti hasil test, seperti di Lovable/v0.
- Tool `check_preview` mengembalikan status HTTP + error runtime supaya agent bisa memperbaiki sendiri sebelum bilang selesai.

## 3. Secrets / env dari user (popup)

- Tool `request_secret(keys[], reason)`: agent memintanya saat butuh API key.
- Di chat muncul **kartu/dialog isian**: nama variabel, penjelasan kenapa dibutuhkan, input bertipe password. User isi → simpan ke tabel `project_secrets` (per chat) — nilai tidak pernah dikirim balik ke UI, hanya nama + mask.
- Nilai di-inject ke sandbox sebagai `.env` dan sebagai environment variable saat menjalankan perintah.
- User juga bisa mengisi/menghapus manual lewat tab **Secrets** di panel sandbox.
- Agent hanya menerima daftar nama key yang tersedia, tidak pernah nilainya; run tetap bisa memakainya karena env di-set di shell.

## 4. Detail teknis

- `src/lib/agent-tools.server.ts`: tambah tool baru; semua lewat helper `run()` yang sudah ada agar tetap tercatat di `tool_executions` dan tampil live.
- `src/lib/types.ts`: tambah event `step-text`, `image` (screenshot), `secret-request`; timeline disimpan di kolom `events` pesan.
- `src/routes/api/chat.ts`: pakai `fullStream` untuk memisahkan teks per step (`stopWhen: stepCountIs(50)` tetap), kirim `step-text` di batas step, dan pause/lanjut saat ada `secret-request`.
- `src/components/workspace/chat-view.tsx` + `message-item.tsx`: renderer timeline berurutan, kartu gambar, kartu form secret.
- `src/lib/e2b.server.ts`: helper env-injection, install Playwright idempoten, upload screenshot ke bucket storage `screenshots`.
- Migrasi: tabel `project_secrets` (chat_id, key, value terenkripsi, created_at) + bucket storage privat untuk screenshot, lengkap dengan GRANT dan RLS (akses hanya lewat server function di balik gate).

## 5. Urutan pengerjaan

1. Timeline berselang-seling + prompt baru (perubahan paling terasa).
2. Tool eksplorasi file + apply_patch + skills.
3. Secrets popup + injeksi env.
4. Preview check + screenshot.
5. Deep search + halaman Settings → Search.
