# Cek Database & Tool Database untuk Agent

## Hasil pengecekan connection string

`postgresql://postgres:password@helium/heliumdb?sslmode=disable` tidak bisa dites dari lingkungan build:

```text
psql: could not translate host name "helium" to address: Name or service not known
```

Hostname `helium` bukan alamat publik — hanya bisa di-resolve dari dalam jaringan/container tempat database itu hidup (mis. sandbox agent). Jadi statusnya belum bisa dipastikan dari luar; pengecekan harus dijalankan dari dalam sandbox.

## Yang akan dibangun

Supaya kamu (dan AI-nya) bisa mengecek database seperti ini kapan saja:

1. **Tool baru untuk agent: `db_check`**
   Menerima connection string (atau nama secret yang menyimpannya), lalu dari dalam sandbox menjalankan probe: resolve host, tes TCP, `SELECT version()`, dan hitung tabel di schema `public`. Hasilnya: reachable / tidak, versi Postgres, latensi, dan pesan error mentah kalau gagal.

2. **Tool baru: `db_query`**
   Menjalankan query read-only (SELECT/EXPLAIN saja) terhadap connection string yang diberikan, output tabel teks yang dipotong aman (maks ~100 baris).

3. **Tab "Database" di Sandbox Panel**
   Kolom connection string (bisa ambil dari Secrets), tombol Test connection, tampilan status + daftar tabel, dan kotak query read-only. Semua eksekusi terjadi di dalam sandbox, jadi host internal seperti `helium` bisa dijangkau.

4. **Auto-install klien**
   Kalau `psql` belum ada di sandbox, probe akan memasangnya lebih dulu (`apt-get install -y postgresql-client`) satu kali dan menyimpan penanda supaya tidak diulang.

## Catatan teknis

- Tool ditambahkan di `src/lib/agent-tools.server.ts` mengikuti pola tool yang sudah ada (`tool({ description, inputSchema, execute })`), memakai `runShell` dari `src/lib/e2b.server.ts` plus jalur auto-recovery sandbox yang sudah ada.
- Server function `dbCheck` / `dbQuery` di `src/lib/sandbox.functions.ts` agar UI bisa memanggil hal yang sama seperti agent.
- Connection string tidak pernah dicetak utuh ke console feed — di-mask (`postgresql://postgres:***@host/db`) sebelum di-log ke `command_outputs`.
- Query dibatasi read-only lewat validasi prefix statement + `SET default_transaction_read_only = on`.
- Tab baru ditambahkan di `src/components/workspace/sandbox-panel.tsx` sejajar Console/Files/Preview/Secrets.
