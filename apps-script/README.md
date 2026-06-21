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

## Integrasi Dropbox (`/dropbox <kata>`)

Cari berkas di Dropbox dari Telegram, balas tautan yang bisa diklik. Gratis, jalan di Apps Script.

### D.1 — Buat app Dropbox
1. Buka **dropbox.com/developers/apps → Create app**.
2. Pilih **Scoped access** → **Full Dropbox** (atau App folder bila ingin terbatas) → beri nama → **Create app**.
3. Tab **Permissions**: centang `files.metadata.read` dan `files.content.read` → **Submit**.
4. Tab **Settings**: catat **App key** dan **App secret**.

### D.2 — Dapatkan refresh token (tanpa curl)
1. Isi Script Properties: **`DROPBOX_APP_KEY`**, **`DROPBOX_APP_SECRET`**.
2. Buka URL ini di browser (ganti `<APP_KEY>`), **Allow**, lalu **salin `code`** yang muncul:
   ```
   https://www.dropbox.com/oauth2/authorize?client_id=<APP_KEY>&token_access_type=offline&response_type=code
   ```
3. Isi Script Property **`DROPBOX_AUTH_CODE`** = code itu (code cepat kedaluwarsa, segera lanjut).
4. Editor → Run **`dropboxExchangeCode`** → buka **Execution log** → salin **refresh token**-nya.
5. Isi **`DROPBOX_REFRESH_TOKEN`** = token itu. **Hapus** `DROPBOX_AUTH_CODE` (tak dipakai lagi).

### D.3 — Uji & pakai
1. Run **`testDropbox`** sekali (memicu izin UrlFetch + verifikasi). Log harus menampilkan beberapa berkas.
2. **Deploy → New version.**
3. Di Telegram: `/dropbox laporan`, atau ketik *"cari laporan di dropbox"*.

> `/cari` = Google Drive · `/dropbox` = Dropbox. Token akses Dropbox di-cache ~3 jam & diperbarui otomatis dari refresh token.

---

## Setelah deploy ulang kode
Setiap kali mengubah kode dan ingin perubahan aktif di webhook: **Deploy → Manage deployments → Edit → Version: New version**. (URL Web App tetap sama, jadi webhook tak perlu didaftar ulang.)

## ⚠️ Webhook & Relay — WAJIB baca kalau bot "balas sekali lalu diam"

**Gejala khas:** bot membalas **1 pesan saja** lalu diam; pesan berikutnya (bahkan `/ping`) tak dibalas. Run `setupWebhook` → jalan 1× lagi → diam lagi.

**Penyebab:** Apps Script SELALU menjawab POST dengan **redirect `302`** (ke `script.googleusercontent.com`). Telegram kadang **menolak** redirect ini → menganggap pengiriman gagal → mengulang 1 pesan dengan jeda makin lebar (backoff) → pesan berikutnya tertahan. Di `getWebhookInfo`: `last_error_message: "Wrong response from the webhook: 302 Moved Temporarily"` + `pending_update_count` menumpuk. Di **Executions**, `doPost` tetap **"Selesai"** (kode sehat) tapi jeda antar-eksekusi melebar → bukti backoff.

**Penting:** ini BUKAN kode/fitur berat. `doPost` sukses ~0,6 detik. Redeploy berapa kali pun tak menyembuhkan, karena 302 itu sifat bawaan Apps Script.

**Solusi permanen — pasang RELAY tipis (gratis)** yang membalas `200` bersih ke Telegram lalu meneruskan ke Apps Script. Telegram tak pernah lagi melihat 302.

**val.town** (paling cepat, tanpa CLI): New → **HTTP val** → tempel (ganti URL `/exec` Anda):
```js
export default async function (req) {
  const APPS_SCRIPT_URL = "<URL_/exec_ANDA>";
  if (req.method !== "POST") return new Response("relay aktif");
  const body = await req.text();
  fetch(APPS_SCRIPT_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body }).catch(() => {});
  return new Response("ok");
}
```
Lalu arahkan webhook ke **URL val** (BUKAN ke `/exec`), di browser:
```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=<URL_VAL>&drop_pending_updates=true
```

### Beralih dari val.town ke Cloudflare Worker
Cloudflare lebih tahan beban (cocok kalau bot makin ramai). Konsepnya sama; yang berubah cuma **URL relay** di webhook.

1. **cloudflare.com** → daftar gratis → **Workers & Pages → Create → Workers → Create Worker** → nama mis. `bot-relay` → **Deploy**.
2. **Edit code** → hapus isi bawaan → tempel (ganti URL `/exec` Anda):
```js
export default {
  async fetch(request, env, ctx) {
    const APPS_SCRIPT_URL = '<URL_/exec_ANDA>';
    if (request.method !== 'POST') return new Response('relay aktif', { status: 200 });
    const body = await request.text();
    ctx.waitUntil(
      fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
      }).catch(() => {})
    );
    return new Response('ok', { status: 200 });
  },
};
```
3. **Deploy** → salin URL worker (`https://bot-relay.<sub>.workers.dev`).
4. **Pindahkan webhook** dari val ke worker — cukup set ulang ke URL baru:
   ```
   https://api.telegram.org/bot<TOKEN>/setWebhook?url=<URL_WORKER>&drop_pending_updates=true
   ```
5. Tes `/ping`. Setelah yakin jalan, val.town lama boleh dibiarkan/dihapus (sudah tak dipakai).

> Mau balik ke val? Tinggal `setWebhook` lagi ke URL val. Webhook hanya menunjuk **satu** URL pada satu waktu — yang terakhir di-set itulah yang aktif. URL `/exec` Apps Script **tidak berubah**, jadi tak perlu sentuh deployment.

**Setelah pakai relay:**
- **JANGAN** Run `setupWebhook` lagi — itu menimpa webhook balik ke `/exec` yang 302.
- Reset/flush bila perlu: ulangi `setWebhook?url=<URL_VAL>&drop_pending_updates=true` (ke URL relay).
- Biarkan val/worker tetap hidup — itu pintu masuk bot sekarang.

---

## 🔧 Troubleshooting lengkap

| Gejala | Penyebab | Solusi |
|---|---|---|
| Bot balas **1× lalu diam**; `getWebhookInfo` → 302 + pending menumpuk | Telegram menolak redirect 302 Apps Script | Pasang **relay** (lihat bagian Webhook & Relay di atas) |
| **Tak ada balasan sama sekali** (termasuk `/ping`) | Akses deployment salah / skrip error / webhook salah | `getWebhookInfo` cek `last_error_message`; pastikan akses **Anyone**; Run fungsi apa saja di editor untuk cek SyntaxError; cek **Executions** |
| `last_error: "302 Moved Temporarily"` ke **halaman login** | Akses deployment **"Anyone with Google account"** | Manage deployments → Edit → Who has access = **Anyone** → New version |
| `last_error: "401 Unauthorized"` | Webhook pakai URL **`/dev`** | Pakai URL **`/exec`**; isi `WEB_APP_URL` benar |
| **Balasan ganda** (pong 2×) | Telegram retry | Sudah ditangani dedup `update_id` di `doPost` — pastikan kode terbaru ter-deploy |
| **"route is not defined"** / `... is not defined` di Log | File `.gs` belum tersalin lengkap | Salin SEMUA file, lalu **Deploy → New version** |
| Ganti kode tapi perilaku **tetap lama** | Belum deploy versi baru | **Deploy → Manage deployments → Edit → Version: New version** |
| `Config "..." belum diset` | Script Property kosong | Run `setupProperties`, atau isi di Project Settings → Script Properties |
| `Sheet "..." tidak ada` | Sheet belum dibuat | Run `setupSheets` |
| **Dashboard `#ERROR!`** di semua sel | Locale id_ID (rumus pakai `;`, bukan `,`) | Sudah diatasi: Dashboard dihitung di JS. Run `buildDashboard` ulang |
| AI balas **"belum paham"** terus | Gemini limit / kalimat terlalu ambigu | Tunggu sebentar, atau pakai perintah `/`; cek `GEMINI_API_KEY`; ganti `GEMINI_MODEL` bila 404 |
| AI kategori **"undefined"** | Model tak mengisi field | Sudah dinormalkan otomatis ke `lainnya` |
| **Foto tak terbaca** | Foto buram / belum ada izin tulis Drive | Foto lebih terang & rata; Run `testFotoSetup` sekali (memicu izin Drive) |
| Nilai property tiba-tiba hilang/null | Salah menaruh **value** menggantikan **label** di kode | Di kode, `cfg('NAMA_LABEL')` memakai NAMA huruf-besar; nilai asli HANYA di Script Properties — jangan diganti |
| `setupWebhook` error "Web App belum ter-deploy" | Belum deploy Web App | Selesaikan deploy dulu, baru Run |

**Perintah cek cepat (browser, ganti `<TOKEN>`):**
- Status webhook: `https://api.telegram.org/bot<TOKEN>/getWebhookInfo` → lihat `url`, `last_error_message`, `pending_update_count`
- Flush + set ke relay: `https://api.telegram.org/bot<TOKEN>/setWebhook?url=<URL_RELAY>&drop_pending_updates=true`
- Lepas webhook: `https://api.telegram.org/bot<TOKEN>/deleteWebhook?drop_pending_updates=true`

**Tempat melihat error:** sheet **`Log`** (baris terakhir) + Apps Script **Executions** (ikon ☰ di sidebar kiri). `doPost` "Selesai" = kode sehat; kalau "Gagal/Error", klik untuk lihat detail.

**Aturan emas saat bot bermasalah:**
1. Cek `getWebhookInfo` dulu — `last_error_message` memberi tahu 90% penyebabnya.
2. `/ping` mati juga? → masalah webhook/deployment, BUKAN AI.
3. Hanya pesan AI yang mati? → cek `GEMINI_API_KEY` / limit Gemini.
4. Setelah ubah kode webhook: **selalu Deploy New version**.
