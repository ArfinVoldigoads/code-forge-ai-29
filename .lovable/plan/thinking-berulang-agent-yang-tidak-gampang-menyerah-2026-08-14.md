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

Tambahan ini prompt dari v0

&nbsp;

Perbaiki sistem AI agent agar planning, thinking, execution, dan verification berjalan otomatis dalam satu siklus kerja tanpa menunggu aba-aba tambahan dari user.

&nbsp;

Tujuannya adalah membuat workflow seperti v0: setelah user mengirim permintaan, AI langsung menganalisis, membuat plan, menjalankan tools, memeriksa hasil, memperbaiki error, dan melanjutkan pekerjaan sampai selesai atau membutuhkan keputusan penting dari user.

&nbsp;

## Autonomous execution loop

&nbsp;

Implementasikan agent loop berikut:

&nbsp;

1. User mengirim prompt.

2. AI langsung membuat internal task breakdown.

3. AI menjalankan project discovery:

   - Inspect folder.

   - List files.

   - Read file yang relevan.

   - Inspect package.json.

   - Inspect database schema.

   - Inspect existing routes/components.

4. AI membuat implementation plan.

5. AI mulai menjalankan plan secara otomatis.

6. AI menggunakan tools tanpa menunggu user:

   - Read files.

   - Search files.

   - Write files.

   - Edit files.

   - Create directories.

   - Install dependencies jika diperlukan.

   - Run commands.

   - Run tests.

   - Run browser verification.

7. Setelah setiap tool selesai, AI mengevaluasi hasilnya.

8. Jika ada error:

   - Baca error.

   - Cari root cause.

   - Buat rencana perbaikan kecil.

   - Edit kode.

   - Jalankan ulang command/test.

9. Setelah fitur selesai, AI melakukan verification loop:

   - Typecheck.

   - Lint.

   - Build.

   - Browser test.

   - Mobile test.

   - Test primary user flow.

10. Jika semua berhasil, AI memberikan ringkasan perubahan.

11. Jika masih gagal, AI terus memperbaiki sendiri sampai berhasil atau mencapai batas retry.

12. AI hanya meminta input user jika keputusan tersebut benar-benar tidak bisa ditentukan secara aman.

&nbsp;

## Jangan menunggu user

&nbsp;

AI tidak boleh berhenti setelah:

&nbsp;

- Menampilkan planning.

- Menampilkan thinking.

- Menampilkan daftar file.

- Menemukan error.

- Menjalankan satu command.

- Menyelesaikan satu langkah kecil.

- Menunggu persetujuan setelah plan.

&nbsp;

Setelah planning selesai, AI harus otomatis melanjutkan ke execution.

&nbsp;

Jangan tampilkan pesan seperti:

&nbsp;

- “Apakah saya boleh lanjut?”

- “Menunggu instruksi berikutnya.”

- “Silakan approve plan.”

- “Saya siap melanjutkan.”

- “Beritahu saya jika ingin saya lanjutkan.”

&nbsp;

Kecuali tindakan tersebut destructive, irreversible, membutuhkan credential baru, melakukan deployment production, menghapus banyak data, atau mengubah resource eksternal secara permanen.

&nbsp;

## Planning behavior

&nbsp;

Planning harus dilakukan otomatis oleh AI di awal setiap task.

&nbsp;

Planning harus mencakup:

&nbsp;

- Pemahaman request.

- Asumsi.

- File/component yang perlu diperiksa.

- Risiko.

- Pendekatan yang dipilih.

- Langkah implementasi.

- Cara verifikasi.

&nbsp;

Planning tidak boleh menghalangi eksekusi. Setelah plan dibuat, agent langsung menjalankan langkah pertama.

&nbsp;

Jika saat eksekusi ditemukan informasi baru, AI boleh memperbarui plan secara internal dan melanjutkan pekerjaan tanpa meminta approval.

&nbsp;

## Thinking behavior

&nbsp;

Implementasikan thinking sebagai process state yang live, bukan response statis.

&nbsp;

Tampilkan status seperti:

&nbsp;

- Understanding request

- Inspecting project

- Checking existing patterns

- Planning implementation

- Comparing approaches

- Selecting implementation strategy

- Editing files

- Running command

- Reading command output

- Fixing error

- Running tests

- Verifying browser behavior

- Reviewing final changes

&nbsp;

Thinking harus diperbarui setiap kali agent berpindah fase.

&nbsp;

Thinking tidak boleh hanya muncul setelah final response.

&nbsp;

Thinking tidak boleh berupa spinner tanpa informasi.

&nbsp;

Gunakan structured events:

&nbsp;

```ts

type AgentEvent =

  | {

      type: "phase_started"

      phase:

        | "understanding"

        | "discovery"

        | "planning"

        | "execution"

        | "debugging"

        | "testing"

        | "verification"

        | "completed"

      message: string

    }

  | {

      type: "thinking"

      message: string

    }

  | {

      type: "plan_created"

      steps: Array<{

        id: string

        title: string

        status: "pending" | "running" | "completed" | "failed"

      }>

    }

  | {

      type: "tool_started"

      toolName: string

      inputSummary: string

    }

  | {

      type: "tool_progress"

      toolName: string

      message: string

    }

  | {

      type: "tool_finished"

      toolName: string

      success: boolean

      outputSummary: string

    }

  | {

      type: "error_detected"

      message: string

      recoverable: boolean

    }

  | {

      type: "retry_started"

      attempt: number

      reason: string

    }

  | {

      type: "assistant_delta"

      text: string

    }

  | {

      type: "completed"

      summary: string

    }

  | {

      type: "awaiting_user_decision"

      reason: string

      options: string[]

    }

Understanding request

✓ Project discovered

✓ Implementation plan created

Running step 1 of 5

Reading relevant files

Editing component

Running typecheck

Error detected

Fixing type error

Retry 1 of 5

Running typecheck again

✓ Typecheck passed

Running browser verification

✓ Desktop verified

✓ Android verified

Task completed

Perbaiki agent loop agar AI tidak hanya melakukan thinking satu kali di awal.

&nbsp;

AI harus melakukan decision cycle berulang setiap kali akan mengambil keputusan baru:

&nbsp;

1. Observe

   - Baca hasil tool terakhir.

   - Periksa file/output/error terbaru.

   - Identifikasi perubahan state.

&nbsp;

2. Decide

   - Tentukan langkah berikutnya.

   - Pilih tool yang paling sesuai.

   - Tentukan apakah perlu lanjut, memperbaiki error, mengubah plan, atau melakukan verifikasi.

&nbsp;

3. Act

   - Jalankan tool atau perubahan yang dipilih.

&nbsp;

4. Verify

   - Periksa hasil tool.

   - Tentukan apakah langkah berhasil.

&nbsp;

5. Repeat

   - Kembali ke Observe sampai task selesai.

&nbsp;

Jangan membuat satu planning statis lalu menjalankan semua langkah tanpa evaluasi. Setelah setiap tool call, command, file edit, test, atau error, AI wajib melakukan decision cycle baru.

&nbsp;

Gunakan loop seperti ini:

&nbsp;

```ts

while (!state.completed && state.iteration < MAX_ITERATIONS) {

  state.iteration += 1

&nbsp;

  emit({

    type: "decision_started",

    iteration: state.iteration,

  })

&nbsp;

  const observation = await observeCurrentState(state)

&nbsp;

  emit({

    type: "observation",

    summary: observation.summary,

  })

&nbsp;

  const decision = await decideNextAction({

    task: state.task,

    plan: state.plan,

    observation,

    previousResults: state.results,

    errors: state.errors,

  })

&nbsp;

  emit({

    type: "decision",

    summary: decision.publicSummary,

    nextAction: decision.action,

    reason: decision.reason,

  })

&nbsp;

  if (decision.action === "ask_user") {

    state.waitingForUser = true

    emit({

      type: "awaiting_user_decision",

      reason: decision.publicReason,

      options: decision.options,

    })

    break

  }

&nbsp;

  emit({

    type: "tool_started",

    toolName: decision.toolName,

    inputSummary: decision.inputSummary,

  })

&nbsp;

  const result = await executeTool(decision)

&nbsp;

  emit({

    type: "tool_finished",

    toolName: decision.toolName,

    success: result.success,

    outputSummary: result.outputSummary,

  })

&nbsp;

  state.results.push(result)

&nbsp;

  const verification = await verifyAction(result, state)

&nbsp;

  if (!verification.success) {

    emit({

      type: "error_detected",

      message: verification.publicMessage,

      recoverable: verification.recoverable,

    })

&nbsp;

    if (verification.recoverable) {

      emit({

        type: "recovery_started",

        reason: verification.publicMessage,

      })

&nbsp;

      await createRecoveryDecision(state, verification)

      continue

    }

&nbsp;

    break

  }

&nbsp;

  updatePlanProgress(state, decision, verification)

&nbsp;

  if (await isTaskComplete(state)) {

    state.completed = true

  }

}

Contoh Ui Yang di harapkan :

Planning implementation

✓ Project inspected

Decision 1: Read the authentication files

✓ Read auth files

&nbsp;

Decision 2: Existing auth uses session cookies, so reuse that pattern

✓ Updated login form

&nbsp;

Decision 3: Run typecheck to verify changes

Running typecheck...

✗ Type error found

&nbsp;

Decision 4: Fix the type mismatch in auth response

✓ Updated type definition

&nbsp;

Decision 5: Run typecheck again

✓ Typecheck passed

&nbsp;

Decision 6: Verify login flow in browser

✓ Desktop verified

✓ Android verified

&nbsp;

Task completed