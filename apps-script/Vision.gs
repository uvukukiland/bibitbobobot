/**
 * Vision.gs — baca data dari FOTO via Gemini (multimodal).
 * Struk → pengeluaran, bukti transfer → masuk/keluar, tulisan tangan → catatan.
 * Foto juga diarsipkan ke Drive sebagai bukti. Tetap minta konfirmasi /ya sebelum simpan.
 */

/** Skema keluaran terstruktur untuk pembacaan gambar. */
var PHOTO_SCHEMA = {
  type: 'object',
  properties: {
    jenis: { type: 'string', enum: ['struk', 'transfer', 'resi', 'catatan', 'unknown'] },
    intent: { type: 'string', enum: ['keluar', 'masuk', 'catat', 'unknown'] },
    nominal: { type: 'integer' },
    kategori: { type: 'string' },
    keterangan: { type: 'string' },
    teks: { type: 'string' },
    tanggal: { type: 'string' }
  },
  required: ['jenis', 'intent']
};

/** Ambil file_id foto/gambar dari sebuah pesan Telegram (atau null). */
function photoFileId(msg) {
  if (msg.photo && msg.photo.length) return msg.photo[msg.photo.length - 1].file_id; // resolusi terbesar
  if (msg.document && /^image\//.test(String(msg.document.mime_type || ''))) return msg.document.file_id;
  return null;
}

/** Alur utama: unduh foto → baca Gemini → arsip Drive → konfirmasi. */
function handlePhoto(msg, fileId, chatId) {
  sendMessage(chatId, '🧾 Membaca foto…');

  var blob;
  try {
    blob = tgGetFileBlob(fileId);
  } catch (e) {
    logEvent('ERROR', 'photo_download_failed', String(e));
    sendMessage(chatId, '❌ Gagal mengunduh foto dari Telegram.');
    return;
  }

  var a = null;
  try { a = geminiVision(blob, msg.caption || ''); } catch (e) { logEvent('ERROR', 'vision_failed', String(e)); }

  if (!a || a.jenis === 'unknown' || a.intent === 'unknown' || !a.intent) {
    sendMessage(chatId,
      '🤔 Belum bisa mengenali isi foto. Tips agar terbaca:\n' +
      '• Lebih terang (hindari bayangan/gelap)\n' +
      '• Tegak lurus dari atas, jangan miring\n' +
      '• Pastikan bagian TOTAL (bawah struk) ikut terfoto\n\n' +
      'Atau ketik manual, mis. "belanja 248200 di Toko A".');
    return;
  }

  // Arsipkan foto ke Drive (opsional — jangan gagalkan alur bila Drive bermasalah).
  var url = '';
  try { url = arsipFoto(blob, 'bot-' + a.jenis); } catch (e) { logEvent('WARN', 'photo_archive_failed', String(e)); }
  a.arsip = url;
  a.sumber = 'bot-foto';

  // Lengkapi & validasi agar tidak tampil "undefined".
  if (a.intent === 'keluar' || a.intent === 'masuk') {
    if (!a.nominal || a.nominal <= 0) {
      var pesanNominal = (a.jenis === 'resi')
        ? '🤔 Ongkir tidak tertera/terbaca di resi. Ketik manual, mis. "ongkir 12rb transport' + (a.keterangan ? ' ' + a.keterangan : '') + '".'
        : '🤔 Nominal tidak terbaca jelas dari foto. Coba foto ulang atau ketik manual.';
      sendMessage(chatId, pesanNominal);
      return;
    }
    a.kategori = normalisasiKategori(a.kategori, a.intent, (a.keterangan || '') + ' ' + (msg.caption || ''));
  }
  if (a.intent === 'catat' && !String(a.teks || '').trim()) {
    sendMessage(chatId, '🤔 Tulisan tidak terbaca. Coba foto lebih jelas.');
    return;
  }

  setPending(chatId, a);
  var label = { struk: '🧾 Struk', transfer: '🏦 Transfer', resi: '📦 Resi', catatan: '📝 Catatan' }[a.jenis] || '📸 Foto';
  askConfirm(chatId, label + ' terbaca:\n' + confirmText(a) + (url ? '\n🗂️ Arsip: ' + url : ''));
}

/** Model untuk membaca gambar (bisa beda dari model teks via GEMINI_VISION_MODEL, mis. gemini-2.5-pro). */
function geminiVisionModel() {
  return cfgOptional('GEMINI_VISION_MODEL', cfgOptional('GEMINI_MODEL', 'gemini-2.5-flash'));
}

/**
 * Baca gambar via Gemini — dua lapis agar andal:
 *  Pass 1: ekstraksi terstruktur ketat (suhu 0).
 *  Pass 2 "salvage": bila pass 1 gagal, ulang dengan instruksi lebih agresif & suhu sedikit naik.
 * Mengembalikan objek aksi {jenis,intent,...} atau null.
 */
function geminiVision(blob, hint) {
  var b64 = Utilities.base64Encode(blob.getBytes());
  var mime = blob.getContentType();

  var a = geminiVisionCall(b64, mime, hint, false);
  if (visionUsable(a)) return a;

  logEvent('INFO', 'vision_salvage', 'pass-1 gagal; mencoba pembacaan teliti');
  var b = geminiVisionCall(b64, mime, hint, true);
  if (visionUsable(b)) return b;

  return a || b; // mungkin "unknown" — biar pesan ke pengguna menyesuaikan
}

/** Apakah hasil vision layak dipakai (jenis/intent jelas + nominal ada untuk transaksi). */
function visionUsable(a) {
  if (!a || !a.jenis || a.jenis === 'unknown' || !a.intent || a.intent === 'unknown') return false;
  if (a.intent === 'keluar' || a.intent === 'masuk') {
    if (a.jenis === 'resi') return true;          // ongkir boleh 0 (tak tertera) — ditangani di handlePhoto
    return Number(a.nominal) > 0;
  }
  if (a.intent === 'catat') return String(a.teks || '').trim().length > 0;
  return true;
}

/** Satu panggilan Gemini Vision. salvage=true → prompt lebih agresif + suhu naik. */
function geminiVisionCall(b64, mime, hint, salvage) {
  var apiKey = cfg('GEMINI_API_KEY');
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + geminiVisionModel() + ':generateContent?key=' + apiKey;
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  var sys = [
    'Kamu membaca GAMBAR untuk asisten keuangan & catatan pribadi berbahasa Indonesia.',
    'Tentukan jenis gambar, lalu ubah jadi SATU aksi terstruktur sesuai skema.',
    'jenis "struk" (struk/nota belanja/kasir): intent "keluar"; nominal = TOTAL akhir yang DIBAYAR. Cari label "TOTAL", "GRAND TOTAL", "BAYARAN", "BAYAR", "TUNAI", "CASH", "DEBIT", "T-MDR", "TOTAL BAYAR", "TOTAL BELANJA", "TOTAL HARGA" — biasanya angka TERBESAR & PALING BAWAH. JANGAN ambil subtotal, kembalian/"KEMBALI", diskon, poin, atau PPN terpisah. keterangan = nama toko/merchant. tanggal dari struk bila ada.',
    'jenis "transfer" (bukti transfer / mutasi m-banking / e-wallet / QRIS — BCA, Mandiri/Livin, BRI/BRImo, BNI, blu, Jago, GoPay, OVO, DANA, ShopeePay, LinkAja): jika uang DITERIMA pengguna -> intent "masuk"; jika uang KELUAR/dibayar/ditransfer -> intent "keluar"; nominal = jumlah transaksi ("Nominal"/"Total"/"Jumlah"/"Amount"); keterangan = nama penerima/tujuan atau sumber bila terbaca.',
    'jenis "resi" (resi/struk pengiriman paket kurir: JNE, J&T, SiCepat, AnterAja, Pos, Ninja, Lion Parcel, dll): intent "keluar"; kategori "transport"; nominal = BIAYA KIRIM / ONGKIR yang dibayar (cari label "Ongkir", "Biaya Kirim", "Total Bayar", "Cost"); JIKA ongkir tidak tertera angkanya, set nominal 0. keterangan = "Ongkir <nama kurir> <nomor resi>" (nomor resi = kode pelacakan alfanumerik panjang; salin sepersis mungkin, sertakan walau ragu).',
    'jenis "catatan" (tulisan tangan / memo / daftar): intent "catat"; teks = transkripsi isi tulisan selengkapnya.',
    'kategori: WAJIB pilih yang PALING cocok dari daftar. HINDARI "lainnya" (lihat PEMETAAN di bawah); pakai hanya bila benar-benar tak ada yang cocok. JANGAN dikosongkan. Daftar — ' + kategoriListText() + '.',
    kategoriHintText(),
    'nominal = angka bulat tanpa titik/koma/Rp (mis. "248.200" -> 248200; "Rp 87.500" -> 87500). tanggal = YYYY-MM-DD (hari ini = ' + today + ').',
    'PENTING: JANGAN mudah menyerah. Gambar boleh gelap/miring/buram/terpotong — selama ADA satu angka total/jumlah yang bisa kamu baca, TETAP ekstrak. Tebak nama toko dari teks yang terbaca walau tidak sempurna.',
    'Pakai "unknown" HANYA bila benar-benar TIDAK ADA angka nominal terbaca sama sekali, atau gambar jelas bukan struk/transfer/resi/catatan (mis. foto pemandangan/orang/produk tanpa harga).'
  ];
  if (salvage) {
    sys.push('MODE TELITI: pembacaan pertama gagal. Periksa ULANG gambar baris demi baris, fokus ke area angka & bagian bawah struk. Pilih kemungkinan TERBAIK; lebih baik menebak total yang masuk akal daripada menyerah. "unknown" adalah pilihan TERAKHIR.');
  }

  var parts = [
    { inline_data: { mime_type: mime, data: b64 } },
    { text: 'Baca gambar ini.' + (hint ? ' Konteks dari pengguna: ' + hint : '') }
  ];

  var payload = {
    systemInstruction: { parts: [{ text: sys.join('\n') }] },
    contents: [{ parts: parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: PHOTO_SCHEMA,
      temperature: salvage ? 0.25 : 0,
      maxOutputTokens: 1024
    }
  };

  var body = geminiVisionFetch(url, payload);
  if (!body || !body.candidates || !body.candidates[0]) return null;
  try { return JSON.parse(body.candidates[0].content.parts[0].text); }
  catch (e) { logEvent('ERROR', 'gemini_vision_parse_failed', String(e)); return null; }
}

/** POST ke Gemini dengan retry pada error sementara (429/500/503 — server sibuk). */
function geminiVisionFetch(url, payload) {
  var opt = { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true };
  var delay = 800;
  for (var attempt = 1; attempt <= 3; attempt++) {
    var res = UrlFetchApp.fetch(url, opt);
    var code = res.getResponseCode();
    if (code === 200) {
      try { return JSON.parse(res.getContentText()); } catch (e) { return null; }
    }
    if ((code === 429 || code === 500 || code === 503) && attempt < 3) {
      logEvent('WARN', 'gemini_vision_retry', 'HTTP ' + code + ' percobaan ' + attempt);
      Utilities.sleep(delay); delay *= 2; continue;
    }
    logEvent('ERROR', 'gemini_vision_http', 'HTTP ' + code + ' ' + res.getContentText().slice(0, 300));
    return null;
  }
  return null;
}

// ---------- Arsip foto ke Drive ----------

/** Folder "Arsip Bot" di dalam root Drive (dibuat bila belum ada). */
function arsipFolder() {
  var root = driveSearchRoot();
  var it = root.getFoldersByName('Arsip Bot');
  return it.hasNext() ? it.next() : root.createFolder('Arsip Bot');
}

/** Simpan blob foto ke folder arsip; kembalikan URL file. */
function arsipFoto(blob, label) {
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
  var ext = (String(blob.getContentType()) === 'image/png') ? 'png' : 'jpg';
  var file = arsipFolder().createFile(blob.copyBlob().setName(label + '-' + stamp + '.' + ext));
  return file.getUrl();
}

/** Jalankan SEKALI dari editor untuk memicu izin tulis Drive (buat folder arsip). */
function testFotoSetup() {
  Logger.log('Folder arsip siap: ' + arsipFolder().getUrl());
}
