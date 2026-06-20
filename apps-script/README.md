# Fase 0 — Setup & Deploy

Kerangka Apps Script untuk fondasi asisten pribadi. Ikuti urutan ini. Target akhir: kirim `/ping` ke bot → balas `pong`.

Acuan: [../DESAIN-DAN-TASK.md](../DESAIN-DAN-TASK.md) §F (Fase 0).

## Berkas
| File | Isi |
|---|---|
| `appsscript.json` | manifest Web App (jalan sebagai kamu, akses anonim untuk webhook) |
| `Config.gs` | baca Script Properties |
| `Sheets.gs` | adapter spreadsheet + Log |
| `Telegram.gs` | Bot API (`sendMessage`, `setWebhook`) |
| `Main.gs` | `doPost` webhook (router dipindah ke `Router.gs`) |
| `Setup.gs` | skrip sekali-jalan: properties, sheet, kategori, webhook |
| `Router.gs` | parse perintah & dispatch (Fase 1) |
| `Commands.gs` | handler `/keluar`,`/masuk`,`/tugas`,`/catat` (Fase 1) |
| `Validate.gs` | validasi nominal/kategori/tanggal (Fase 1) |
| `Scheduler.gs` | heartbeat harian + pemasang trigger (Fase 1) |

---

## Langkah

### T0.1 — Buat bot Telegram
1. Chat ke **@BotFather** → `/newbot` → ikuti instruksi.
2. Simpan **token** (mis. `123456:ABC...`).

### T0.2 — Ambil chat ID-mu
1. Chat ke **@userinfobot** → catat angka **Id** kamu.

### T0.3 — Buat Spreadsheet
1. Buat Google Spreadsheet baru. Salin **ID**-nya dari URL: `docs.google.com/spreadsheets/d/<ID>/edit`.

### T0.4 — Buat folder Drive (untuk Fase 3, boleh nanti)
1. Buat satu folder Drive untuk file yang boleh diakses bot. Salin **ID folder** dari URL. Bisa dilewati dulu.

### T0.5 — Buat proyek Apps Script + isi kode
1. Buka [script.google.com](https://script.google.com) → **New project**. Beri nama (kiri atas), mis. "Asisten Pribadi".
2. **Tambahkan file kode.** Di panel kiri **Files**, klik tanda **+** → **Script** untuk tiap file, lalu beri nama: `Config`, `Sheets`, `Telegram`, `Main`, `Setup` (editor menambah `.gs` otomatis — jangan ketik `.gs`). Tempel isi tiap file `.gs` dari folder ini ke file dengan nama sama.
   - Proyek baru sudah punya file `Code.gs` berisi `myFunction`. **Hapus file `Code.gs`** itu (klik ⋮ di sebelahnya → Delete) supaya tidak bentrok — semua kode sudah ada di 5 file di atas.
3. **Aktifkan manifest:** ikon **⚙ Project Settings** (kiri) → centang **"Show 'appsscript.json' manifest file in editor"**. Kembali ke **Editor**, buka file `appsscript.json` yang kini muncul, **ganti seluruh isinya** dengan isi `appsscript.json` dari folder ini. Tekan **Ctrl+S**.
4. Buka `Setup.gs` → di fungsi `setupProperties()` isi placeholder: `TELEGRAM_BOT_TOKEN` (T0.1), `ALLOWED_CHAT_ID` (T0.2), `SPREADSHEET_ID` (T0.3, **wajib** di alur ini), `DRIVE_ROOT_FOLDER_ID` (T0.4, boleh dibiarkan placeholder dulu).
5. **Jalankan `setupProperties`:** di bar atas, pada dropdown fungsi (sebelah tombol **▷ Run**), pilih `setupProperties` → klik **Run**.
   - **Layar izin akan muncul** → "Review permissions" → pilih akun Google-mu → muncul **"Google hasn't verified this app"**. **Ini normal dan aman** (ini app pribadimu sendiri). Klik **Advanced → Go to <nama proyek> (unsafe) → Allow**.
   - Setelah sukses, **kosongkan kembali** nilai token/ID di `setupProperties()` lalu **Ctrl+S** (agar rahasia tak tertinggal di kode — nilainya sudah aman di Script Properties).
6. Pilih fungsi `setupSheets` → **Run**. Buka spreadsheet-mu: 6 sheet + header harus muncul.
7. Pilih `setupVerify` → **Run** → lihat hasilnya di panel **Execution log** (muncul otomatis di bawah) atau menu **Executions** (ikon ☰ kiri). Pastikan semua properti "terisi" dan sheet "ada".

> **Melihat Log / hasil Run:** panel **Execution log** terbuka otomatis di bawah editor setiap kali Run. Riwayat lengkap ada di **Executions** (ikon jam/daftar di sidebar kiri).

### T0.7 — Deploy & daftarkan webhook
1. Kanan atas: **Deploy → New deployment**.
2. Klik ikon **⚙ (Select type) → Web app**.
3. Isi: **Execute as → Me** · **Who has access → Anyone** → **Deploy**.
   - Jika diminta izin lagi, setujui seperti di T0.5 langkah 5.
   - *Catatan keamanan: "Anyone" perlu karena Telegram memanggil tanpa login. Skrip tetap aman: hanya merespons `ALLOWED_CHAT_ID` (lihat `Main.gs`), sisanya ditolak diam-diam.*
4. Salin **Web app URL** yang muncul — **harus berakhiran `/exec`**. Simpan ke Script Property `WEB_APP_URL` (⚙ Project Settings → Script Properties → Add, atau isi di `setupProperties`).
   - ⚠️ **Jangan pakai URL `/dev`.** URL `/dev` butuh login Google → Telegram selalu ditolak `401`. `setupWebhook` akan menolak URL non-`/exec`.
5. Kembali ke editor → pilih fungsi `setupWebhook` → **Run** → di Execution log harus muncul `"ok":true`.

### Selesai (Definition of Done)
- Kirim `/ping` ke bot dari akun kamu → balas **`pong`**.
- Kirim dari akun lain (atau minta teman) → **tidak ada balasan** (whitelist bekerja).
- Cek sheet `Log` bila ada yang gagal.

---

## Fase 1 — Capture (`/keluar`, `/masuk`, `/tugas`, `/catat`)

Lakukan setelah Fase 0 (`/ping`→`pong`) berhasil.

### F1.1 — Tambah 4 file kode baru
Di editor, **+ → Script** untuk tiap file, tempel isinya dari folder ini: `Router`, `Commands`, `Validate`, `Scheduler`.
Lalu buka `Main.gs` dan pastikan fungsi `route()` lama sudah **tidak ada** di situ (sudah dipindah ke `Router.gs`; jika kamu menyalin versi lama, hapus `route()` dari `Main`). **Ctrl+S.**

### F1.2 — Isi kategori
1. (Opsional) Edit array `KATEGORI_DEFAULT` di `Setup.gs` sesuai kebutuhanmu.
2. Pilih fungsi `seedKategori` → **Run**. Cek sheet `Kategori` terisi. *Bisa juga diisi manual langsung di sheet.*

### F1.3 — Pasang heartbeat
Pilih fungsi `installHeartbeatTrigger` → **Run**. (Trigger jam ada di `HEARTBEAT_HOUR`.) Cek menu **Triggers** (ikon jam di sidebar) → ada 1 trigger `sendHeartbeat`.
Untuk uji cepat tanpa menunggu pagi: pilih `sendHeartbeat` → **Run** → harus ada pesan `✅ alive` masuk.

### F1.4 — Deploy ulang
**Deploy → Manage deployments → Edit (pensil) → Version: New version → Deploy.** (Wajib, agar kode Fase 1 aktif di webhook.)

### Selesai (Definition of Done)
- `/keluar 25000 makan kopi` → balas `✅ Tercatat...`, baris masuk ke sheet `Keuangan`.
- `/masuk 5000000 gaji` → tercatat sebagai pemasukan.
- `/keluar 25000 ngasalkategori` → **ditolak** dengan pesan kategori tidak dikenal.
- `/keluar abc makan` → **ditolak** (nominal tidak valid).
- `/tugas bayar listrik #2026-06-25` → `Tugas` bertambah dengan id `T-xxxx`.
- `/catat ide untuk weekend` → `Catatan` bertambah.
- `/help` → daftar perintah.

> **GATE 2 MINGGU (§11 PRD):** pakai capture dulu ±2 minggu. Lanjut Fase 2 hanya jika benar-benar dipakai konsisten.

---

## Fase 2 — Pengingat (jadwal harian + tugas)

Lakukan setelah Fase 1 jalan.

### F2.1 — Perbarui kode
Tempel ulang isi terbaru: `Scheduler.gs`, `Commands.gs` (ada `cmdSelesai`), `Router.gs` (ada `/selesai`). **Ctrl+S.**

### F2.2 — Isi jadwal pengingat harian
Buka sheet **`Jadwal`**, tambah baris. Contoh:

| id | label | waktu | hari | aktif | terkirim_pada |
|----|-------|-------|------|-------|---------------|
| J-0001 | Minum air & olahraga | 07:00 | daily | y | *(kosongkan)* |
| J-0002 | Laporan mingguan | 09:00 | mon | y | *(kosongkan)* |

- `waktu` format `HH:MM` 24 jam. **Format kolom ini sebagai teks biasa** (Format → Angka → Teks biasa) agar tidak diubah jadi nilai waktu.
- `hari` = `daily` atau salah satu `mon,tue,wed,thu,fri,sat,sun` (boleh beberapa dipisah koma).
- `aktif` = `y`/`n`. `terkirim_pada` biarkan kosong (diisi otomatis, di-reset tiap tengah malam).

### F2.3 — Pasang trigger pengingat
Pilih fungsi **`installReminderTriggers`** → **Jalankan**. Cek menu **Triggers** (ikon jam): ada `reminderTick` (tiap 5 menit) + `resetJadwalHarian` (harian).

### F2.4 — Deploy versi baru
**Terapkan → Kelola deployment → Edit → Versi: New version → Terapkan.**

### Selesai (Definition of Done)
- Buat jadwal `J-00xx` dengan `waktu` 2–3 menit dari sekarang → pengingat `⏰ <label>` masuk dalam ≤5 menit, **sekali saja**.
- `/tugas tes tenggat #<hari-ini>` lalu tunggu jam ≥ `TASK_HOUR` → masuk pengingat `⏰ Tenggat HARI INI: ...`.
- `/selesai T-00xx` → tugas ditandai selesai, follow-up berhenti esok harinya.
- Heartbeat tetap masuk tiap pagi.

> Opsional: tambah Script Property `TASK_HOUR` (mis. `8`) untuk mengatur jam pengingat tugas.

---

## Fase 3 (parsial) — `/cari` berkas Drive

Cari berkas di folder Drive, balas tautan yang bisa diklik untuk dibuka & diedit di app Drive/Docs.

### F3.1 — Tambah/perbarui kode
Tambah file **`Drive.gs`**; perbarui `Commands.gs` (ada `cmdCari`) & `Router.gs` (ada `/cari`). **Ctrl+S.**

### F3.2 — Pastikan folder root terisi
- Properti **`DRIVE_ROOT_FOLDER_ID`** harus berisi ID folder Drive Anda (sudah diisi sejak T0.4).
- **Taruh berkas yang ingin dicari di folder itu atau subfoldernya.** Pencarian menelusuri folder root **+ semua subfolder** (rekursif, batas aman 200 folder).

### F3.3 — Beri izin Drive (sekali)
Pilih fungsi **`testCari`** → **Jalankan**. Google akan minta izin **akses Drive** (pertama kali) → **Advanced → Allow**. Setelah itu cek **Execution log**: muncul daftar berkas yang namanya mengandung "a".
> Akses Drive ini aman tanpa verifikasi Google karena skrip jalan sebagai akunmu sendiri (lihat PRD §7B).

### F3.4 — Deploy versi baru
**Terapkan → Kelola deployment → Edit → Versi: New version → Terapkan.**

### Selesai (Definition of Done)
- `/cari laporan` → daftar berkas + tautan; tap tautan → terbuka di Drive/Docs untuk dilihat & diedit.
- `/cari xyztidakada` → balas "Tidak ada berkas cocok".

---

## Lapisan AI — bahasa natural via Gemini (gratis)

Ketik bebas (mis. *"tadi jajan kopi 25rb"*) → bot pakai Gemini untuk menafsirkan → minta konfirmasi → simpan. Perintah `/` tetap jalan seperti biasa.

### FAI.1 — Buat API key Gemini (gratis)
[aistudio.google.com](https://aistudio.google.com) → **Get API key** → **Create API key** → salin.

### FAI.2 — Set Script Properties
Project Settings → Script Properties → tambah:

| Property | Value |
|---|---|
| `GEMINI_API_KEY` | (API key Gemini Anda) |
| `GEMINI_MODEL` | `gemini-2.5-flash` *(opsional; default ini)* |

### FAI.3 — Tambah/perbarui kode
Tambah file **`AI.gs`**; perbarui `Router.gs` (jalur natural + `/ya` `/tidak` + helpText). **Ctrl+S.**

### FAI.4 — Beri izin (sekali) & deploy
- Run **`setupVerify`** sekali bila perlu memicu izin akses internet eksternal (UrlFetch) — atau langsung lewat tes.
- **Deploy versi baru** (Edit deployment → New version).

### Selesai (Definition of Done)
- `tadi jajan kopi 25rb` → bot balas `💸 Pengeluaran Rp25.000 · makan · kopi` + minta `/ya`/`/tidak`.
- Balas `/ya` → tersimpan ke sheet `Keuangan` (kolom sumber = `bot-ai`).
- `ingatkan bayar listrik besok` → `📋 Tugas: ...` → `/ya`.
- Perintah `/keluar 25000 makan` (jalur cepat tanpa AI) tetap jalan.

> Catatan privasi: tier gratis Gemini dapat memakai prompt untuk peningkatan produk Google. Untuk data keuangan pribadi, ini trade-off yang perlu Anda sadari.
> Jika muncul error model (404): ganti `GEMINI_MODEL` ke `gemini-2.0-flash` atau `gemini-flash-latest`.

---

## Setelah deploy ulang kode
Setiap kali mengubah kode dan ingin perubahan aktif di webhook: **Deploy → Manage deployments → Edit → Version: New version**. (URL Web App tetap sama, jadi webhook tak perlu didaftar ulang.)

## Troubleshooting
- **Tidak ada balasan:** cek `setupWebhook` mengembalikan `ok:true`; cek `ALLOWED_CHAT_ID` benar (angka, tanpa spasi); cek sheet `Log`.
- **Error "Config ... belum diset":** jalankan `setupProperties` lagi (mungkin nilai tertinggal kosong).
- **Error "Sheet ... tidak ada":** jalankan `setupSheets`.
- **`setupWebhook` error "Web App belum ter-deploy":** selesaikan T0.7 langkah 1–3 dulu, baru Run `setupWebhook`.
- **Ganti kode tapi bot tetap perilaku lama:** kode di deployment belum diperbarui → lihat bagian "Setelah deploy ulang kode" di atas.
- **Reset webhook:** Run `deleteWebhook`, lalu `setupWebhook`.
- **Cek status webhook:** buka di browser `https://api.telegram.org/bot<TOKEN>/getWebhookInfo` — lihat `url` dan `last_error_message`.
- **`last_error_message: "Wrong response from the webhook: 401 Unauthorized"`** → webhook menunjuk URL `/dev` (bukan `/exec`), atau akses deployment bukan "Anyone". Perbaiki `WEB_APP_URL` ke URL `/exec`, set ulang webhook via browser: `https://api.telegram.org/bot<TOKEN>/setWebhook?url=<EXEC_URL>`.
