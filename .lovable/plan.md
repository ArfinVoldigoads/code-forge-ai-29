# Thinking berulang + agent yang tidak gampang menyerah

Dua masalah yang diperbaiki:

1. Planning sekarang hanya sekali di awal, isinya seperti draft jawaban — bukan proses berpikir.
2. Agent berhenti terlalu cepat saat error, tanpa memikirkan ulang pendekatan lain.

## Perubahan yang dibuat

### 1. Thinking jadi blok berulang di dalam timeline

Fase "Planning" satu kali di awal dihapus. Sebagai gantinya, agent berpikir berkali-kali sepanjang satu turn, dan setiap sesi berpikir muncul sebagai blok sendiri di urutan timeline:

```text
Thought for 6s   (collapsible, isi deliberasi bahasa Inggris)
teks singkat "aku cek file X dulu"
[tool: read_file]
Thought for 4s   ("hasilnya kosong, berarti ... coba pendekatan B")
[tool: run_command]
balasan ke user (bahasa user)
```

Isi thinking bukan ringkasan jawaban, melainkan deliberasi nyata: apa yang belum diketahui, hipotesis, file mana yang perlu dibaca, kenapa pendekatan A dipilih, apa yang dicoba kalau gagal.

### 2. Thinking wajib bahasa Inggris, balasan mengikuti bahasa user

Blok thinking selalu bahasa Inggris (gaya first-person seperti contoh yang kamu kirim). Teks yang terlihat sebagai jawaban tetap memakai bahasa yang dipakai user.

### 3. Kapan agent wajib berpikir ulang

Agent diwajibkan membuka blok thinking baru pada titik-titik ini:
- sebelum aksi pertama di setiap turn,
- setiap kali sebuah tool gagal / hasilnya tidak sesuai harapan,
- sebelum berganti strategi,
- sebelum menyatakan selesai atau buntu.

Jadi kalau thinking ke-1 tidak berhasil, agent berpikir lagi, mencoba lagi, dan baru berhenti setelah benar-benar buntu — dengan daftar percobaan nyata.

## Detail teknis

- `src/lib/types.ts`: tambah stream event `thought-start` / `thought-delta` / `thought-end` (dengan `id` + `durationMs`) dan `TimelineBlock` baru `{ kind: "thought", text, durationMs, done }`.
- `src/lib/agent-tools.server.ts`: tambah tool `think({ thought })` — tidak menyentuh sandbox, hanya mengeluarkan event thought ke timeline dan disimpan ke `events`. Ini yang membuat thinking berulang bekerja pada provider OpenAI-compatible yang tidak mengirim `reasoning-delta`.
- `src/routes/api/chat.ts`:
  - hapus blok `PLANNING_PROMPT` dan pass planning-nya; kolom `planning` di DB diisi ringkasan thought pertama supaya riwayat lama tetap terbaca.
  - `reasoning-delta` native tidak lagi masuk panel atas, tapi dipetakan ke blok thought inline yang sama, jadi model reasoning (GPT-5/Gemini) dan model biasa tampil identik.
  - system prompt ditambah bagian "Thinking protocol" (kapan wajib `think`, bahasa Inggris, isi deliberasi bukan jawaban) dan penguatan aturan tidak-menyerah: setelah setiap kegagalan wajib `think` yang menyebut minimal satu pendekatan baru yang belum dicoba, dan dilarang mengakhiri turn dengan status gagal sebelum ada 3 percobaan berbeda yang tercatat di timeline.
- `src/lib/timeline.ts`: fold event thought jadi blok terurut (delta digabung ke blok thought terakhir yang masih terbuka).
- `src/components/workspace/timeline.tsx`: render blok thought sebagai panel collapsible "Thought for Ns" (saat berjalan: "Thinking…"), teks monospace redup, tertutup secara default.
- `src/components/workspace/message-item.tsx`: hapus panel "Planning" dan panel "Thinking" global — keduanya sekarang inline di timeline. Pesan lama yang hanya punya `planning`/`thinking` tetap ditampilkan sebagai fallback.
- `src/hooks/use-chat-stream.ts`: fase live jadi `thinking` saat blok thought terbuka; state planning dilepas dari UI live.
