# Redesain UI + Lampiran File + Pertanyaan Interaktif + Progress

## 1. Tampilan baru: clean, ramah, mobile-first

Tetap tema gelap teknis (token OKLCH + IBM Plex), tapi lebih lapang dan ramah:

- **Chat**: bubble pesan user rapi di kanan dengan sudut lembut, jawaban agent full-width tanpa kotak berat, spasi lebih longgar, tipografi lebih besar di mobile (16px agar iOS tidak zoom).
- **Timeline agent**: blok thought/tool jadi kartu ringkas satu baris dengan ikon + label manusiawi ("Membaca file", "Menjalankan perintah"), detail dibuka lewat tap. Log panjang di-collapse otomatis.
- **Composer**: satu kartu mengambang membulat berisi textarea auto-grow, tombol lampiran, pemilih model ringkas (ikon + nama pendek), tombol kirim bulat. Aman dari safe-area iPhone.
- **Sidebar & header mobile**: header tipis sticky dengan judul chat aktif + tombol panel; daftar chat dengan target sentuh 44px.
- **Sandbox panel**: di mobile jadi sheet full-height dengan tab bar bawah yang bisa di-scroll (Console / Files / Preview / Desktop / Secrets).
- **Empty state** yang ramah: judul singkat + 3 kartu contoh prompt yang bisa diklik.
- Semua warna lewat token di `src/styles.css` (tambah token surface/elevasi + radius baru), tidak ada warna hardcoded.

## 2. Kirim file (foto, dokumen, dll)

- Bucket privat baru `attachments` di storage + kebijakan akses; tabel `message_attachments` sudah ada dan dipakai apa adanya.
- Tombol klip di composer: pilih file, drag & drop, dan paste gambar. Maks 10 file, 20 MB per file. Chip pratinjau (thumbnail untuk gambar) sebelum kirim, bisa dihapus.
- Upload dulu → simpan baris `message_attachments` → dikaitkan ke pesan saat dikirim.
- Pesan user menampilkan gambar sebagai thumbnail yang bisa dibuka, file lain sebagai kartu nama+ukuran (signed URL).
- Agent menerimanya: gambar & PDF dikirim ke model sebagai konten multimodal; dokumen lain diekstrak teksnya ke `extracted_text`. Semua file juga otomatis disalin ke sandbox di `project/uploads/` supaya agent bisa memakainya saat coding.

## 3. Pertanyaan interaktif tanpa menghentikan chat

Tool baru `ask_user` untuk agent: kirim 1+ pertanyaan dengan pilihan.

- Muncul sebagai kartu di timeline: judul pertanyaan, opsi pilihan (dengan keterangan kecil), plus kolom isian bebas bila diizinkan.
- Tombol: **Skip** dan **Kirim**; jika pertanyaan lebih dari satu, tombol kanan jadi **Selanjutnya** sampai pertanyaan terakhir.
- Run tidak dimatikan: jawaban tersimpan, lalu run dilanjutkan otomatis (mekanisme sama seperti form secret yang sudah ada) sehingga agent langsung memakai jawabannya.
- Jika di-Skip, agent diinstruksikan memilih default paling masuk akal dan lanjut, tidak bertanya ulang.
- Aturan di system prompt: bertanya hanya saat ambigu betulan, maksimal sekali di awal tugas, pertanyaan singkat dengan opsi konkret.

## 4. Progress langkah

Tool `set_progress`: agent mendeklarasikan daftar langkah lalu menandai yang selesai.

- Kartu progress sticky di atas timeline: "3/6" + bar, daftar langkah dengan status (selesai / berjalan / menunggu), langkah berjalan diberi spinner.
- Isi langkah sepenuhnya ditentukan agent (mis. "Membuat backend", "Memeriksa sistem", "Testing").
- Tersimpan di events pesan sehingga tetap terlihat saat chat dibuka ulang.

## Catatan teknis

- Komponen baru: `attachment-picker.tsx`, `attachment-list.tsx`, `ask-user-card.tsx`, `progress-card.tsx`; refaktor `composer.tsx`, `message-item.tsx`, `timeline.tsx`, `shell.tsx`, `sandbox-panel.tsx`.
- Tipe baru di `src/lib/types.ts`: event `ask-user`, `progress`, dan blok timeline padanannya di `src/lib/timeline.ts`.
- Server: `attachments.functions.ts` (signed upload/URL), tabel jawaban `ask_user_answers` + migrasi bucket dan grant/RLS, tool `ask_user`/`set_progress` di `agent-tools.server.ts`, prompt di `src/routes/api/chat.ts`.
- Tidak mengubah engine sandbox Daytona maupun logika agent lain.
