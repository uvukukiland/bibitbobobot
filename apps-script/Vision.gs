/**
 * Vision.gs — baca data dari FOTO via Gemini (multimodal).
 * Struk → pengeluaran, bukti transfer → masuk/keluar, tulisan tangan → catatan.
 * Foto juga diarsipkan ke Drive sebagai bukti. Tetap minta konfirmasi /ya sebelum simpan.
 */

/**
 * Skema keluaran terstruktur untuk pembacaan gambar.
 * SEMUA field wajib: gemini-3.5-flash-lite terbukti melewatkan field opsional (jalur teks: kategori 0/6).
 * Field yang tak relevan diisi kosong ("" / 0) — lihat deskripsi.
 */
var PHOTO_SCHEMA = {
  type: 'object',
  properties: {
    jenis: { type: 'string', enum: ['struk', 'transfer', 'resi', 'catatan', 'unknown'],
      description: 'struk = struk kasir / nota / bon / kwitansi / faktur / invoice (cetak MAUPUN tulisan tangan); transfer = bukti transfer/e-wallet/QRIS; resi = resi kurir; catatan = tulisan/memo tanpa transaksi.' },
    intent: { type: 'string', enum: ['keluar', 'masuk', 'catat', 'unknown'] },
    nominal: { type: 'integer', description: 'TOTAL rupiah bulat yang dibayar/diterima (mis. "240.000" -> 240000). 0 bila bukan transaksi.' },
    kategori: { type: 'string', description: 'Kategori PERSIS dari daftar yang paling cocok (hindari "lainnya"). Isi "lainnya" bila bukan transaksi.' },
    keterangan: { type: 'string', description: 'Nama toko/merchant/penerima atau barang utama. "" bila tak ada.' },
    teks: { type: 'string', description: 'Transkripsi isi tulisan bila jenis catatan; "" untuk jenis lain.' },
    tanggal: { type: 'string', description: 'YYYY-MM-DD bila tertera di gambar; "" bila tidak ada.' }
  },
  required: ['jenis', 'intent', 'nominal', 'kategori', 'keterangan', 'teks', 'tanggal']
};

/** PHOTO_SCHEMA dengan kategori dibatasi (enum) ke sheet Kategori — sama seperti jalur teks. */
function photoSchemaDinamis() {
  var s = JSON.parse(JSON.stringify(PHOTO_SCHEMA));
  try {
    var nama = Object.keys(kategoriSheetMap());
    if (nama.length) {
      if (nama.indexOf('lainnya') < 0) nama.push('lainnya'); // deskripsi menyuruh "lainnya" utk non-transaksi
      s.properties.kategori.enum = nama;
    }
  } catch (e) { logEvent('WARN', 'schema_foto_kategori_gagal', String(e).slice(0, 120)); }
  return s;
}

/** Ambil file_id foto/gambar dari sebuah pesan Telegram (atau null). */
function photoFileId(msg) {
  if (msg.photo && msg.photo.length) return msg.photo[msg.photo.length - 1].file_id; // resolusi terbesar
  if (msg.document && /^image\//.test(String(msg.document.mime_type || ''))) return msg.document.file_id;
  return null;
}

/** Alur utama: unduh foto → baca Gemini → arsip Drive → konfirmasi. */
function handlePhoto(msg, fileId, chatId) {
  sendTyping(chatId);
  sendMessage(chatId, '🧾 Membaca foto…');

  var blob;
  try {
    blob = tgGetFileBlob(fileId);
  } catch (e) {
    logEvent('ERROR', 'photo_download_failed', String(e));
    sendMessage(chatId, '❌ Gagal mengunduh foto dari Telegram.');
    return;
  }

  var a = null, galat = '';
  GEMINI_ERR_TERAKHIR = '';
  try { a = geminiVision(blob, msg.caption || ''); } catch (e) { galat = String(e); logEvent('ERROR', 'vision_failed', galat); }
  rapikanJenisFoto(a);

  if (!a || a.jenis === 'unknown' || a.intent === 'unknown' || !a.intent) {
    var sebab = galat ? 'error: ' + sensorAman(galat).slice(0, 120)
      : (!a ? (GEMINI_ERR_TERAKHIR ? 'AI tidak membalas (' + GEMINI_ERR_TERAKHIR + ')' : 'AI tidak memberi hasil')
        : 'AI tidak menemukan struk/nota/transfer/catatan di gambar');
    var aiGagal = galat || !a;
    sendMessage(chatId,
      '🤔 Belum bisa mengenali isi foto.\n' +
      '🔎 Sebab: ' + sebab + '\n\n' +
      (aiGagal && /HTTP (429|5\d\d)|jaringan|timeout/i.test(sebab)
        ? 'Layanan AI sedang sibuk/limit — coba kirim ulang foto beberapa menit lagi.\n\n'
        : 'Tips agar terbaca:\n' +
          '• Lebih terang (hindari bayangan/gelap)\n' +
          '• Foto tegak dari atas; isi kertas memenuhi layar\n' +
          '• Pastikan angka TOTAL/JUMLAH ikut terfoto\n' +
          '• Tambahkan keterangan pada foto, mis. "nota beli ayam"\n\n') +
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
  askConfirm(chatId, label + ' <b>terbaca</b>:\n' + confirmText(a) +
    (url ? '\n🗂️ <a href="' + htmlEsc(url) + '">Arsip foto</a>' : ''));
}

/** Model untuk membaca gambar (bisa beda dari model teks via GEMINI_VISION_MODEL, mis. gemini-3.8-flash). */
function geminiVisionModel() {
  return cfgOptional('GEMINI_VISION_MODEL', cfgOptional('GEMINI_MODEL', GEMINI_MODEL_DEFAULT));
}

/**
 * Baca gambar via Gemini — dua lapis agar andal:
 *  Pass 1: ekstraksi terstruktur ketat (suhu 0).
 *  Pass 2 "salvage": bila pass 1 gagal, ulang dengan instruksi lebih teliti (MODE TELITI).
 *  (Tanpa temperature: parameter itu usang di Gemini 3.x — diabaikan kini, kelak ditolak HTTP 400.)
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

/**
 * Model kadang memberi jenis "unknown" padahal arah & total terbaca (mis. nota tulisan tangan).
 * Transaksi dgn nominal > 0 cukup untuk diproses → anggap "struk". Mengubah objek di tempat.
 */
function rapikanJenisFoto(a) {
  if (a && (!a.jenis || a.jenis === 'unknown') && (a.intent === 'keluar' || a.intent === 'masuk') && Number(a.nominal) > 0) {
    a.jenis = 'struk';
  }
  return a;
}

/** Apakah hasil vision layak dipakai (jenis/intent jelas + nominal ada untuk transaksi). */
function visionUsable(a) {
  rapikanJenisFoto(a);
  if (!a || !a.jenis || a.jenis === 'unknown' || !a.intent || a.intent === 'unknown') return false;
  if (a.intent === 'keluar' || a.intent === 'masuk') {
    if (a.jenis === 'resi') return true;          // ongkir boleh 0 (tak tertera) — ditangani di handlePhoto
    return Number(a.nominal) > 0;
  }
  if (a.intent === 'catat') return String(a.teks || '').trim().length > 0;
  return true;
}

/** Satu panggilan Gemini Vision. salvage=true → prompt lebih teliti (MODE TELITI). */
function geminiVisionCall(b64, mime, hint, salvage) {
  var apiKey = cfg('GEMINI_API_KEY');
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + geminiVisionModel() + ':generateContent?key=' + apiKey;
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  var sys = [
    'Kamu membaca GAMBAR untuk asisten keuangan & catatan pribadi berbahasa Indonesia.',
    'Tentukan jenis gambar, lalu ubah jadi SATU aksi terstruktur sesuai skema.',
    'jenis "struk" (struk kasir, nota, bon, kwitansi, faktur, invoice — CETAK MAUPUN TULISAN TANGAN, termasuk nota toko dgn kolom Banyaknya/Nama Barang/Harga/Jumlah): intent "keluar" (kecuali konteks pengguna menyebut ia yang MENJUAL/menerima uang → "masuk"); nominal = TOTAL akhir yang DIBAYAR. Cari label "TOTAL", "GRAND TOTAL", "JUMLAH", "JUMLAH Rp", "Total Rp", "BAYARAN", "BAYAR", "TUNAI", "CASH", "DEBIT", "T-MDR", "TOTAL BAYAR", "TOTAL BELANJA", "TOTAL HARGA" — biasanya angka TERBESAR & PALING BAWAH. JANGAN ambil subtotal per baris, kembalian/"KEMBALI", diskon, poin, atau PPN terpisah. keterangan = nama toko/merchant, atau barang utama bila nama toko tak terbaca (mis. "nota ayam"). tanggal dari struk bila ada.',
    'jenis "transfer" (bukti transfer / mutasi m-banking / e-wallet / QRIS — BCA, Mandiri/Livin, BRI/BRImo, BNI, blu, Jago, GoPay, OVO, DANA, ShopeePay, LinkAja): jika uang DITERIMA pengguna -> intent "masuk"; jika uang KELUAR/dibayar/ditransfer -> intent "keluar"; nominal = jumlah transaksi ("Nominal"/"Total"/"Jumlah"/"Amount"); keterangan = nama penerima/tujuan atau sumber bila terbaca.',
    'jenis "resi" (resi/struk pengiriman paket kurir: JNE, J&T, SiCepat, AnterAja, Pos, Ninja, Lion Parcel, dll): intent "keluar"; kategori "transport"; nominal = BIAYA KIRIM / ONGKIR yang dibayar (cari label "Ongkir", "Biaya Kirim", "Total Bayar", "Cost"); JIKA ongkir tidak tertera angkanya, set nominal 0. keterangan = "Ongkir <nama kurir> <nomor resi>" (nomor resi = kode pelacakan alfanumerik panjang; salin sepersis mungkin, sertakan walau ragu).',
    'jenis "catatan" (tulisan tangan / memo / daftar): intent "catat"; teks = transkripsi isi tulisan selengkapnya.',
    'kategori: WAJIB pilih yang PALING cocok dari daftar. HINDARI "lainnya" (lihat PEMETAAN di bawah); pakai hanya bila benar-benar tak ada yang cocok. JANGAN dikosongkan. Daftar — ' + kategoriListText() + '.',
    kategoriHintText(),
    'nominal = angka bulat tanpa titik/koma/Rp (mis. "248.200" -> 248200; "Rp 87.500" -> 87500). tanggal = YYYY-MM-DD (hari ini = ' + today + ').',
    'PENTING: JANGAN mudah menyerah. Gambar boleh gelap/miring/buram/terpotong, TERPUTAR 90° atau TERBALIK (baca dengan memutar dalam pikiranmu), atau berlatar benda lain (meja, layar) — selama ADA satu angka total/jumlah yang bisa kamu baca, TETAP ekstrak. Tebak nama toko dari teks yang terbaca walau tidak sempurna.',
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
      responseSchema: photoSchemaDinamis(),
      maxOutputTokens: 4096 // longgar: token "berpikir" ikut dihitung (bila memakai model yg berpikir)
    }
  };

  var body = geminiFetchRetry(url, payload); // helper retry bersama (lihat AI.gs)
  if (!body) return null;                    // sebab sudah di GEMINI_ERR_TERAKHIR
  var cand = body.candidates && body.candidates[0];
  if (!cand) {
    GEMINI_ERR_TERAKHIR = (body.promptFeedback && body.promptFeedback.blockReason)
      ? 'diblokir filter (' + body.promptFeedback.blockReason + ')' : 'balasan tanpa isi';
    return null;
  }
  try { return JSON.parse(cand.content.parts[0].text); }
  catch (e) {
    GEMINI_ERR_TERAKHIR = 'jawaban AI terpotong/bukan JSON' + (cand.finishReason ? ' (' + cand.finishReason + ')' : '');
    logEvent('ERROR', 'gemini_vision_parse_failed', String(e));
    return null;
  }
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
