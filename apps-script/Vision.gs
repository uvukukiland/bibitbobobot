/**
 * Vision.gs — baca data dari FOTO via Gemini (multimodal).
 * Struk → pengeluaran, bukti transfer → masuk/keluar, tulisan tangan → catatan.
 * Foto juga diarsipkan ke Drive sebagai bukti. Tetap minta konfirmasi /ya sebelum simpan.
 */

/** Skema keluaran terstruktur untuk pembacaan gambar. */
var PHOTO_SCHEMA = {
  type: 'object',
  properties: {
    jenis: { type: 'string', enum: ['struk', 'transfer', 'catatan', 'unknown'] },
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
    sendMessage(chatId, '🤔 Belum bisa mengenali isi foto. Coba foto lebih jelas & terang, atau ketik manual.');
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
      sendMessage(chatId, '🤔 Nominal tidak terbaca jelas dari foto. Coba foto ulang atau ketik manual.');
      return;
    }
    var kat = String(a.kategori || '').toLowerCase();
    if (!isKategoriValid(kat, a.intent)) kat = 'lainnya';
    a.kategori = kat;
  }
  if (a.intent === 'catat' && !String(a.teks || '').trim()) {
    sendMessage(chatId, '🤔 Tulisan tidak terbaca. Coba foto lebih jelas.');
    return;
  }

  setPending(chatId, a);
  var label = { struk: '🧾 Struk', transfer: '🏦 Transfer', catatan: '📝 Catatan' }[a.jenis] || '📸 Foto';
  sendMessage(chatId, label + ' terbaca:\n' + confirmText(a) +
    (url ? '\n🗂️ Arsip: ' + url : '') + '\n\n/ya untuk simpan · /tidak untuk batal');
}

/** Kirim gambar ke Gemini, kembalikan objek aksi {jenis,intent,...} atau null. */
function geminiVision(blob, hint) {
  var apiKey = cfg('GEMINI_API_KEY');
  var model = cfgOptional('GEMINI_MODEL', 'gemini-2.5-flash');
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey;
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  var sys = [
    'Kamu membaca GAMBAR untuk asisten keuangan & catatan pribadi berbahasa Indonesia.',
    'Tentukan jenis gambar, lalu ubah jadi SATU aksi terstruktur sesuai skema.',
    'jenis "struk" (struk/nota belanja): intent "keluar"; nominal = TOTAL akhir yang DIBAYAR (bukan subtotal, bukan kembalian, bukan pajak terpisah); keterangan = nama toko; tanggal dari struk bila ada.',
    'jenis "transfer" (bukti transfer / mutasi m-banking / e-wallet): jika uang DITERIMA pengguna -> intent "masuk"; jika uang KELUAR/dibayar -> intent "keluar"; nominal = jumlah transaksi; keterangan = tujuan/sumber bila terbaca.',
    'jenis "catatan" (tulisan tangan / memo): intent "catat"; teks = transkripsi isi tulisan.',
    'kategori: WAJIB pilih yang PALING cocok dari daftar; bila tak ada yang pas isi "lainnya". JANGAN dikosongkan. Daftar — ' + kategoriListText() + '.',
    'nominal = angka bulat tanpa titik/koma (mis. 87500). tanggal = YYYY-MM-DD (hari ini = ' + today + ').',
    'Bila gambar buram / bukan ketiga jenis itu -> jenis "unknown", intent "unknown".'
  ].join('\n');

  var parts = [
    { inline_data: { mime_type: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) } },
    { text: 'Baca gambar ini.' + (hint ? ' Konteks dari pengguna: ' + hint : '') }
  ];

  var payload = {
    systemInstruction: { parts: [{ text: sys }] },
    contents: [{ parts: parts }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: PHOTO_SCHEMA, temperature: 0 }
  };

  var res = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  var body;
  try { body = JSON.parse(res.getContentText()); } catch (e) { body = null; }
  if (!body || !body.candidates || !body.candidates[0]) {
    logEvent('ERROR', 'gemini_vision_failed', String(res.getResponseCode()) + ' ' + res.getContentText().slice(0, 300));
    return null;
  }
  try { return JSON.parse(body.candidates[0].content.parts[0].text); }
  catch (e) { logEvent('ERROR', 'gemini_vision_parse_failed', String(e)); return null; }
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
