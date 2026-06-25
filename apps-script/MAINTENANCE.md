# 🛠️ Panduan Perawatan Bot

Checklist ringan supaya bot tetap hidup bertahun-tahun. Untuk **1 pengguna**, perawatannya sangat sedikit — sebagian besar cuma "pastikan masih jalan".

> Inti: Apps Script & spreadsheet **tidak expire**. Yang bisa bermasalah adalah **layanan/token pihak ketiga** (relay val.town, Dropbox, Gemini, token Telegram). Fokus perawatan ada di situ.

---

## ⏱️ Rutin — sekali sebulan (2 menit)

- [ ] Kirim `/ping` ke bot → harus balas `pong`.
- [ ] Kirim `/status` → cek angka & saldo masih masuk akal.
- [ ] Kirim 1 transaksi uji (mis. "jajan kopi 10rb") lalu `/hapus terakhir` → pastikan catat & hapus jalan.
- [ ] Buka spreadsheet **AI Assisten** sebentar (sekaligus menjaga akun tetap aktif).

Kalau semua oke → tidak ada yang perlu disentuh.

---

## 📅 Rutin — sekali setahun (10 menit)

- [ ] **Login Google** minimal sekali (pasti sudah, tapi penting): mencegah akun dianggap tidak aktif (>2 tahun bisa kena hapus otomatis).
- [ ] Cek **Trigger** masih terpasang: editor Apps Script → menu **Triggers (jam ⏰)** di kiri. Harus ada:
  - `reminderTick` / `sendRingkasanHarian` (pengingat & ringkasan harian)
  - `refreshDashboard` (tiap jam)
  - `arsipKeuangan` (kalau dipasang — tiap 5 Januari)
- [ ] Pertimbangkan **arsip tahun lalu**: jalankan `arsipKeuangan` dari editor (memindah data tahun lewat ke sheet `Arsip <tahun>`). Opsional, hanya kalau data sudah banyak.
- [ ] Cek kuota tidak mepet: editor → **Executions** → pastikan tidak ada error merah berulang.

---

## 🔑 Token & layanan eksternal (cek kalau ada yang error)

| Layanan | Tanda bermasalah | Yang dilakukan |
|---|---|---|
| **Telegram token** | Bot diam total | Jangan revoke token. Kalau terlanjur: buat token baru di @BotFather → update Script Property `BOT_TOKEN` → jalankan `setWebhook`. |
| **Relay (val.town)** | Bot balas sekali lalu mati / webhook error | Titik paling rapuh. Cek val.town masih hidup. Solusi tahan lama: pindah ke **Cloudflare Worker** (panduan di `README.md`). |
| **Gemini (foto)** | Baca foto gagal, sisanya normal | Cek `GEMINI_API_KEY` masih valid di Google AI Studio. |
| **Dropbox** | `/dropbox` error / "missing_scope" | Refresh token **tidak expire**. Kalau bermasalah, jalankan ulang `dropboxExchangeCode` (lihat `README.md` bagian Dropbox). |

> **Refresh token Dropbox tidak kadaluarsa** selama app Dropbox tidak dihapus. Token Telegram & Gemini juga permanen sampai Anda cabut sendiri.

---

## 🚨 Kalau bot tiba-tiba diam (urutan diagnosa)

1. `/ping` → tidak balas?
2. Cek **getWebhookInfo** (lihat `last_error_message`):
   ```
   https://api.telegram.org/bot<TOKEN>/getWebhookInfo
   ```
   - `302 Moved Temporarily` → masalah relay (val.town mati / webhook lari ke `/exec` langsung). Set ulang webhook ke URL **relay**.
   - `pending_update_count` naik terus → webhook nyangkut → `deleteWebhook` lalu `setWebhook` lagi.
3. Editor → **Executions** → lihat error merah pada `doPost`.
4. Detail langkah ada di **`README.md` → Troubleshooting**.

---

## 💾 Cadangan data (opsional, disarankan sekali setahun)

- [ ] Spreadsheet **AI Assisten** → **File → Download → Excel (.xlsx)** untuk arsip lokal.
- [ ] Kode sudah aman di GitHub (`bibitbobobot`) — cukup pastikan masih ter-push.

---

## ✅ Ringkasan

| Frekuensi | Aksi |
|---|---|
| Bulanan | `/ping`, `/status`, tes catat+hapus |
| Tahunan | Login Google, cek Trigger & Executions, (opsional) arsip + backup |
| Saat error | Cek `getWebhookInfo` → relay → Executions → README |

Untuk 1 orang, **perawatan nyata hampir nol**. Yang penting cuma: akun Google aktif + relay sehat.
