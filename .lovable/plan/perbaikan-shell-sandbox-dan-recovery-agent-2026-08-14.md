# Perbaikan Shell Sandbox dan Recovery Agent

## Tujuan
Membuat semua command sandbox kembali berjalan stabil dan memastikan agent tidak berhenti setelah menjelaskan error yang sebenarnya bisa dipulihkan sendiri.

## Perubahan
1. **Perbaiki quoting wrapper shell**
   - Ganti pembentukan `bash -lc` yang sekarang memakai string double-quote berlapis.
   - Gunakan escaping single-quote yang aman agar `$HOME`, `$PATH`, dan variabel loop seperti `$d` baru dievaluasi di dalam sandbox.
   - Pertahankan PATH tambahan untuk Node, Bun, npm, dan Python tanpa merusak command user yang memiliki quote atau multiline script.

2. **Tambahkan health check saat sandbox dibuat/dihubungkan**
   - Jalankan probe shell ringan setelah connect/create.
   - Jika sesi lama rusak atau tidak merespons, tandai sesi tersebut stopped lalu buat sandbox baru satu kali.
   - Pastikan chat tetap memakai satu sesi sehat dan tidak membuat sandbox berulang tanpa batas.

3. **Recovery otomatis pada kegagalan inisialisasi shell**
   - Kenali error infrastruktur seperti syntax error dari wrapper, sandbox mati, atau koneksi sesi stale.
   - Untuk error tersebut, lakukan satu kali reconnect/recreate lalu ulangi command yang sama.
   - Jangan retry otomatis untuk error normal dari command proyek seperti test gagal atau dependency belum ada.

4. **Ubah perilaku agent ketika tool gagal**
   - Instruksikan agent untuk mencoba recovery yang tersedia dan melanjutkan task.
   - Agent hanya menjelaskan kegagalan kepada user setelah recovery satu kali benar-benar gagal, disertai output aktual.
   - Hilangkan saran generik “laporkan ke platform/buat manual” untuk masalah wrapper yang dapat ditangani aplikasi sendiri.

5. **Samakan seluruh jalur eksekusi**
   - Terapkan wrapper dan recovery yang sama pada command agent, console user, start dev server, preview check, dan screenshot setup.
   - Pastikan semua eksekusi tetap tercatat pada shared console feed dengan source, output, exit code, dan percobaan recovery.

6. **Verifikasi**
   - Uji ekspansi `$d`, `$HOME`, `$PATH`, command multiline, serta command dengan single/double quote.
   - Uji command dasar (`node`, `npm`, `python3`) dan command yang sengaja gagal untuk memastikan exit code asli tetap tampil.
   - Jalankan task sederhana hingga agent membuat file, menjalankan preview, dan melanjutkan setelah simulasi sesi stale.

## Detail teknis
Penyebab yang terkonfirmasi berada di `shellCommand`: hasil `JSON.stringify(script)` ditempatkan sebagai argumen double-quoted ke shell luar. Akibatnya variabel shell di script init dapat diekspansi terlalu awal; `$d` menjadi kosong sebelum `bash -lc` mengeksekusi loop. Perbaikan akan memakai encoder argumen shell yang tidak memungkinkan ekspansi oleh shell luar, ditambah klasifikasi error recoverable dan batas retry satu kali.