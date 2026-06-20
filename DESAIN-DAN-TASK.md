# Desain Implementasi & Daftar Task — Asisten Pribadi

**Versi:** 1.0
**Tanggal:** 19 Juni 2026
**Acuan:** [PRD-SDD-Asisten-Pribadi.md](PRD-SDD-Asisten-Pribadi.md) v0.2
**Jalur build:** Apps Script + Telegram (keputusan final §2/§9 PRD)

> Dokumen ini menurunkan PRD jadi struktur konkret yang siap dikoding: skema sheet pasti, konstanta config, peta modul skrip, tabel routing perintah, setup trigger, dan task per fase dengan kriteria selesai.

---

## A. Desain Data — Struktur 6 Sheet

Satu Spreadsheet sebagai DB utama. Baris pertama tiap sheet = header (persis seperti di bawah).

### 1. `Keuangan`
| Kolom | Tipe | Catatan |
|---|---|---|
| timestamp | datetime | diisi otomatis saat input |
| tipe | masuk \| keluar | diisi oleh perintah (`/keluar`→keluar, `/masuk`→masuk) |
| nominal | angka positif | validasi: harus > 0 |
| kategori | teks | harus ada di sheet `Kategori`, kalau tidak → ditolak |
| keterangan | teks | opsional |
| sumber | teks | selalu `bot` di v1 |

### 2. `Tugas`
| Kolom | Tipe | Catatan |
|---|---|---|
| id | teks | dibuat otomatis (mis. `T-0001`) |
| teks | teks | isi tugas |
| jatuh_tempo | tanggal | opsional; dari `#tanggal` |
| status | open \| done | default `open` |
| terkirim_pada | datetime | idempotensi reminder; kosong = belum dikirim |

### 3. `Catatan`
| Kolom | Tipe |
|---|---|
| timestamp | datetime |
| teks | teks |

### 4. `Jadwal`
| Kolom | Tipe | Catatan |
|---|---|---|
| id | teks | `J-0001` |
| label | teks | isi pengingat |
| waktu | HH:MM | 24 jam |
| hari | daily \| mon..sun | satu atau daftar dipisah koma |
| aktif | y \| n | |
| terkirim_pada | datetime | idempotensi; di-reset tiap hari |

### 5. `Log`
| Kolom | Tipe | Catatan |
|---|---|---|
| timestamp | datetime | |
| level | INFO \| WARN \| ERROR | |
| event | teks | mis. `reminder_sent`, `send_failed` |
| detail | teks | payload/error |

### 6. `Kategori` (referensi validasi)
| Kolom | Tipe | Catatan |
|---|---|---|
| kategori | teks | daftar tetap kategori keuangan |
| tipe | masuk \| keluar \| both | membatasi kategori boleh dipakai untuk apa |

---

## B. Konstanta Konfigurasi (Script Properties — bukan hardcode)

| Kunci | Isi | Dipakai |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | token dari BotFather | semua kirim/terima |
| `ALLOWED_CHAT_ID` | chat ID milikmu | whitelist (§6 PRD) |
| `SPREADSHEET_ID` | ID spreadsheet DB | storage |
| `DRIVE_ROOT_FOLDER_ID` | folder Drive untuk `/cari`,`/ambil` | §7B PRD |
| `HEARTBEAT_HOUR` | mis. `7` | trigger heartbeat |
| `REPORT_HOUR` | mis. `21` | trigger laporan harian |

> Disimpan via `PropertiesService.getScriptProperties()` — tidak ada token/ID di kode.

---

## C. Peta Modul Skrip (Apps Script `.gs`)

| File | Tanggung jawab | Fungsi utama |
|---|---|---|
| `Config.gs` | baca Script Properties | `cfg(key)` |
| `Main.gs` | entry webhook Telegram | `doPost(e)` |
| `Router.gs` | parse perintah → dispatch | `route(text, chatId)` |
| `Commands.gs` | handler tiap perintah | `cmdKeluar`, `cmdMasuk`, `cmdTugas`, `cmdCatat`, `cmdRingkas`, `cmdCari`, `cmdAmbil`, `cmdLihat`, `cmdEkspor` |
| `Sheets.gs` | tulis/baca sheet | `append(sheet,row)`, `readAll(sheet)`, `nextId(prefix)` |
| `Telegram.gs` | API Telegram | `sendMessage`, `sendDocument`, `setWebhook` |
| `Drive.gs` | akses Drive | `searchFiles(q)`, `getBlob(id)`, `previewText(id)` |
| `Scheduler.gs` | trigger terjadwal | `reminderTick`, `sendHeartbeat`, `sendDailyReport`, `resetJadwalHarian` |
| `Validate.gs` | validasi input | `parseNominal`, `isKategoriValid` |

---

## D. Tabel Routing Perintah

| Perintah | Handler | Tulis ke | Validasi |
|---|---|---|---|
| `/keluar <nominal> <kategori> [ket]` | `cmdKeluar` | Keuangan | nominal > 0; kategori valid |
| `/masuk <nominal> <kategori> [ket]` | `cmdMasuk` | Keuangan | sama |
| `/tugas <teks> [#tgl]` | `cmdTugas` | Tugas | tgl format benar bila ada |
| `/catat <teks>` | `cmdCatat` | Catatan | teks tidak kosong |
| `/ringkas minggu` | `cmdRingkas` | (baca) Keuangan | — |
| `/ringkas tugas` | `cmdRingkas` | (baca) Tugas | — |
| `/cari <kata>` | `cmdCari` | (baca) Drive | folder root |
| `/ambil <nomor>` | `cmdAmbil` | (baca) Drive | ukuran ≤ 50MB else link |
| `/lihat <nomor>` | `cmdLihat` | (baca) Drive | hanya teks |
| `/ekspor <sheet> [periode]` | `cmdEkspor` | (baca) sheet | sheet dikenal |

**Gerbang keamanan (sebelum routing):** `if (chatId != ALLOWED_CHAT_ID) return;` — tolak diam-diam.

---

## E. Penjadwal (Triggers)

| Trigger | Tipe | Frekuensi | Fungsi |
|---|---|---|---|
| Reminder | time-driven | tiap 1 menit | `reminderTick` — cek `Jadwal` & `Tugas` jatuh tempo; kirim bila `terkirim_pada` kosong; isi `terkirim_pada` |
| Heartbeat | time-driven harian | `HEARTBEAT_HOUR` | `sendHeartbeat` — kirim `✅ alive` |
| Laporan harian | time-driven harian | `REPORT_HOUR` | `sendDailyReport` — Fase 3 |
| Reset jadwal | time-driven harian | 00:0x | `resetJadwalHarian` — kosongkan `terkirim_pada` di `Jadwal` |

---

## F. Daftar Task per Fase

### Fase 0 — Fondasi
- [ ] T0.1 Buat bot Telegram via BotFather; simpan token.
- [ ] T0.2 Ambil chat ID milikmu (mis. via `@userinfobot`).
- [ ] T0.3 Buat Spreadsheet + 6 sheet (`Keuangan`,`Tugas`,`Catatan`,`Jadwal`,`Log`,`Kategori`) dengan header sesuai §A.
- [ ] T0.4 Isi daftar **Kategori** awal (lihat keputusan terbuka §10 PRD).
- [ ] T0.5 Buat proyek Apps Script terikat ke spreadsheet; isi Script Properties (§B).
- [ ] T0.6 Implement `Config.gs`, `Sheets.gs`, `Telegram.gs` (kerangka).
- [ ] T0.7 Deploy sebagai Web App; jalankan `setWebhook` sekali.
- **Selesai jika:** kirim `/ping` ke bot → balas `pong` (hanya untuk chat ID-mu).

### Fase 1 — Capture  *(kode selesai — tinggal deploy & uji, lihat apps-script/README.md §Fase 1)*
- [x] T1.1 `Validate.gs`: `parseNominal`, `isKategoriValid`, `isValidDate`, `formatRupiah`.
- [x] T1.2 `cmdUang('keluar'/'masuk')` → tulis ke `Keuangan`.
- [x] T1.3 `cmdTugas` (+ parsing `#YYYY-MM-DD`) → tulis ke `Tugas`.
- [x] T1.4 `cmdCatat` → tulis ke `Catatan`.
- [x] T1.5 Pesan error jelas saat validasi gagal (nominal/kategori/tanggal).
- [x] T1.6 `sendHeartbeat` + `installHeartbeatTrigger` + `logEvent` dasar.
- [x] (tambahan) `seedKategori` untuk isi kategori awal; `Router.gs` + `/help`.
- **Selesai jika:** keempat perintah tersimpan benar; input salah ditolak dengan pesan; heartbeat masuk tiap pagi. *(verifikasi manual oleh kamu setelah deploy)*
- **GATE 2 MINGGU (§11 PRD):** lanjut ke Fase 2 hanya jika capture dipakai konsisten.

### Fase 2 — Pengingat  *(kode selesai — tinggal pasang trigger & uji)*
- [x] T2.1 `reminderTick` → `sendJadwalReminders` (cek waktu/hari/aktif).
- [x] T2.2 Idempotensi via `terkirim_pada` + `resetJadwalHarian` (trigger tengah malam).
- [x] T2.3 Pengingat tugas berdasarkan `jatuh_tempo` (jam ≥ `TASK_HOUR`, default 8).
- [x] T2.4 Follow-up harian tugas lewat tenggat sampai `status=done`; perintah `/selesai <id>`.
- [x] T2.5 `trySend` retry 2× + catat `send_failed` ke `Log`.
- [x] (tambahan) `installReminderTriggers` (tick 5 menit + reset harian).
- **Selesai jika:** pengingat terkirim tepat waktu (±5 mnt), tidak ganda, kegagalan tercatat. *(verifikasi manual setelah deploy)*

### Fase 3 — Ringkasan, Laporan & Data/File
- [ ] T3.1 `cmdRingkas minggu` (total per kategori) & `cmdRingkas tugas`.
- [ ] T3.2 `sendDailyReport` (§7a) pada `REPORT_HOUR`.
- [x] T3.3 `Drive.gs` `searchDriveFiles` dibatasi `DRIVE_ROOT_FOLDER_ID` (anak langsung).
- [x] T3.4 `cmdCari` → balas daftar + **tautan klik** (buka/edit di app Drive). *Cache nomor→fileId menyusul bersama `/ambil`.*
- [ ] T3.5 `cmdAmbil` (cek ≤ 50MB else kirim link).
- [ ] T3.6 `cmdLihat` (preview teks, potong ~3.000 char; tolak non-teks).
- [ ] T3.7 `cmdEkspor` (CSV/XLSX dari sheet).
- **Selesai jika:** bisa cari, lihat, unduh file dari folder root; ekspor sheet jadi file; laporan harian terkirim.

### Fase 4 — Ditunda (validasi ulang dulu)
- Google Docs catatan panjang; auto-arsip Drive (tulis); WhatsApp; Dropbox. Lihat §4/§7B PRD.

---

## G. Urutan Kerja yang Disarankan

1. **T0.1 → T0.7** (fondasi) — wajib lebih dulu, semua bergantung ini.
2. **T1.x** (capture) — lalu **berhenti dan pakai 2 minggu**.
3. Evaluasi gate → **T2.x** (pengingat) → **T3.x** (ringkasan + data/file).

> Prinsip dari PRD: jangan bangun Fase 2+ sebelum capture terbukti dipakai. Kalau tidak dipakai, masalahnya bukan tooling — hentikan/perkecil, jangan tambah fitur.
