# Run yang bisa ditinggal + perbaikan jaringan sandbox

Dua masalah dikerjakan sekaligus: (1) task panjang berhenti kalau tab ditutup, (2) sandbox sering kena TLS handshake / connection reset saat mengakses server luar.

## Bagian 1 — Run tahan ditinggal

Sekarang satu run hidup di dalam satu request stream. Kalau koneksi putus, eksekusi ikut mati.

Yang dibuat:
1. Tabel `runs` di database: `chat_id`, `status` (`queued|running|waiting_user|done|failed`), `round`, `progress`, `lease_until`, `last_heartbeat`, `last_error`.
2. Endpoint chat tidak lagi jadi pemilik eksekusi. Ia hanya membuat baris run `queued`, lalu stream membaca perkembangan dari database.
3. Worker tick di `src/routes/api/public/run-tick.ts`: mengambil run yang `queued` atau yang leasenya kedaluwarsa, mengunci lease, menjalankan satu putaran agent, menulis hasil ke database, lalu menjadwalkan putaran berikutnya. Dilindungi header rahasia.
4. Penjadwalan: setiap putaran memanggil tick berikutnya sendiri (self-chain) plus cron cadangan tiap menit untuk run yang leasenya mati (mis. worker dimatikan di tengah jalan).
5. UI membaca status dari state run, bukan dari koneksi: kartu progress tersemat tetap tampil dan lanjut walau halaman di-reload. Kalau run `waiting_user`, kartu menunggu jawaban seperti sekarang.
6. Heartbeat sandbox dilakukan worker, bukan browser, plus auto-resume kalau sandbox sempat auto-stop.

Hasil: kirim task → tutup HP → buka lagi, progress sudah lanjut atau selesai.

## Bagian 2 — Jalur keluar sandbox (TLS reset)

Yang sudah dicek di kode: sandbox dibuat tanpa pengaturan jaringan apa pun, dan pembukaan blokir baru terjadi belakangan lewat tool `sandbox_network_check` ketika agent kebetulan memanggilnya. Jadi banyak request keluar berjalan di sandbox yang masih memakai kebijakan jaringan bawaan. Penyebab pasti reset ke server target tertentu belum dikonfirmasi, jadi urutannya: samakan dulu kondisi jaringan, lalu diagnosa dengan bukti.

1. Set kebijakan jaringan saat sandbox dibuat (allow-all outbound), bukan menunggu tool dipanggil, dan ulangi setelah restart/resume.
2. Perkuat diagnosa: probe bertingkat — DNS, TCP 443, TLS handshake (`openssl s_client`), lalu HTTP — dan laporkan lapisan mana yang gagal beserta pesan mentahnya, bukan hanya "gagal".
3. Tambah tool `http_fetch` yang menjalankan request dari sisi server aplikasi (bukan dari dalam sandbox) untuk endpoint yang tetap menolak sandbox: hasil body/status dikembalikan ke agent, dengan batas ukuran, timeout, dan blokir alamat internal/private (SSRF guard).
4. Aturan prompt: kalau akses langsung gagal di lapisan TLS/koneksi, agent memakai `http_fetch` sebagai jalur alternatif dan melaporkan bahwa jalur sandbox yang diblokir — bukan berhenti bekerja.
5. Kalau target memang memblokir IP datacenter (banyak API drama/CDN begitu), agent menyampaikan itu terang-terangan sebagai temuan, bukan mengulang percobaan tanpa akhir.

## Detail teknis
- Kunci run pakai `lease_until` + update bersyarat agar tidak ada dua worker mengerjakan satu run.
- Batas putaran per run tetap ada (48) supaya tidak berputar selamanya; run gagal ditandai `failed` dengan `last_error`.
- Migrasi tabel `runs` menyertakan GRANT dan RLS sesuai pola tabel lain di proyek ini.
- `http_fetch` hanya mengizinkan skema http/https, menolak IP privat/loopback/metadata, maksimum ~2 MB respons.
