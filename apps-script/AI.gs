/**
 * AI.gs — lapisan bahasa natural via Gemini (gratis).
 * Pola: teks bebas → Gemini usulkan aksi terstruktur → bot konfirmasi → simpan.
 * Menjaga data bersih (PRD §5): selalu validasi + konfirmasi sebelum tulis.
 */

/** Skema keluaran terstruktur yang dipaksakan ke Gemini. */
var ACTION_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: ['keluar', 'masuk', 'tugas', 'catat', 'cari', 'rekap', 'selesai', 'hapus', 'daftar', 'edit', 'unknown'] },
    nominal: { type: 'integer' },
    kategori: { type: 'string' },
    keterangan: { type: 'string' },
    teks: { type: 'string' },
    jatuh_tempo: { type: 'string' },
    query: { type: 'string' },
    bulan: { type: 'string' },
    id: { type: 'string' },
    target: { type: 'string', enum: ['terakhir', 'bulan', 'tugas', 'catatan'] },
    tanggal: { type: 'string' },
    field: { type: 'string' },
    nilai: { type: 'string' }
  },
  required: ['intent']
};

/** Bangun ringkasan daftar kategori untuk diberikan ke model. */
function kategoriListText() {
  var rows = readAll('Kategori');
  var keluar = [], masuk = [];
  for (var i = 1; i < rows.length; i++) {
    var k = rows[i][0], t = String(rows[i][1]).toLowerCase();
    if (t === 'keluar' || t === 'both') keluar.push(k);
    if (t === 'masuk' || t === 'both') masuk.push(k);
  }
  return 'kategori keluar: [' + keluar.join(', ') + '] ; kategori masuk: [' + masuk.join(', ') + ']';
}

/** Panggil Gemini, kembalikan objek aksi {intent,...} atau null bila gagal. */
function geminiParse(text) {
  var apiKey = cfg('GEMINI_API_KEY');
  var model = cfgOptional('GEMINI_MODEL', 'gemini-2.5-flash');
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey;
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  var sys = [
    'Kamu pengurai untuk asisten keuangan & tugas pribadi berbahasa Indonesia.',
    'Ubah pesan pengguna menjadi SATU aksi terstruktur sesuai skema.',
    'intent: "keluar"=pengeluaran uang, "masuk"=pemasukan uang, "tugas"=hal yang harus dilakukan, "catat"=catatan bebas, "cari"=mencari berkas/file di Drive, "rekap"=minta ringkasan/laporan keuangan, "selesai"=menandai tugas sudah selesai, "hapus"=menghapus data, "daftar"=minta lihat daftar tugas, "unknown"=tidak yakin.',
    'keluar/masuk: nominal = angka rupiah (ubah "25rb"->25000, "1,5jt"->1500000, "10k"->10000); kategori WAJIB diisi dengan salah satu dari daftar yang PALING cocok; bila benar-benar tak ada yang pas isi "lainnya". JANGAN pernah mengosongkan kategori. keterangan = ringkas. tanggal = YYYY-MM-DD HANYA bila pengguna menyebut waktu lampau ("kemarin", "2 hari lalu", tanggal tertentu); bila tidak disebut KOSONGKAN (artinya hari ini = ' + today + ').',
    'Daftar kategori — ' + kategoriListText() + '.',
    'cari: query = kata kunci nama berkas (mis. "cari file laporan" -> query "laporan").',
    'tugas: teks = isi tugas; jatuh_tempo = YYYY-MM-DD bila disebut (hari ini = ' + today + ').',
    'catat: teks = isi catatan.',
    'rekap: bulan = YYYY-MM bila pengguna menyebut bulan (hitung dari hari ini = ' + today + '; "bulan ini" = kosongkan; "bulan lalu" = bulan sebelumnya). Contoh "rekap keuangan", "laporan bulan ini", "berapa pengeluaranku" -> intent rekap.',
    'selesai: id = ID tugas berformat T-0001 bila disebut. Contoh "tugas T-0002 sudah beres" -> intent selesai, id "T-0002".',
    'daftar: tidak butuh field lain. Contoh "tugas apa saja", "lihat daftar tugas", "ada tugas apa hari ini" -> intent daftar.',
    'hapus: target = "terakhir" (transaksi keuangan terakhir), "bulan" (semua keuangan 1 bulan; isi bulan = YYYY-MM), atau "tugas" (isi id = T-0001). Contoh "hapus transaksi terakhir" -> target "terakhir"; "hapus keuangan bulan mei" -> target "bulan", bulan "' + today.slice(0, 4) + '-05".',
    'edit: untuk MEMPERBAIKI entri yang salah. target = "terakhir" (transaksi keuangan terakhir), "tugas" (isi id), atau "catatan" (catatan terakhir). field = yang diubah; nilai = nilai baru. Untuk keuangan field salah satu: nominal|kategori|keterangan|tipe|tanggal (jika nominal, nilai = angka rupiah dinormalkan, mis "30rb"->"30000"). Untuk tugas field: teks|tenggat|status. Untuk catatan: cukup nilai = teks baru. Contoh "ubah nominal terakhir jadi 30rb" -> intent edit, target "terakhir", field "nominal", nilai "30000"; "ganti kategori transaksi terakhir ke transport" -> field "kategori", nilai "transport".',
    'Pakai "unknown" hanya bila benar-benar tidak ada intent yang cocok.'
  ].join('\n');

  var payload = {
    systemInstruction: { parts: [{ text: sys }] },
    contents: [{ parts: [{ text: text }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: ACTION_SCHEMA,
      temperature: 0
    }
  };

  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var body;
  try { body = JSON.parse(res.getContentText()); } catch (e) { body = null; }
  if (!body || !body.candidates || !body.candidates[0]) {
    logEvent('ERROR', 'gemini_failed', String(res.getResponseCode()) + ' ' + res.getContentText().slice(0, 300));
    return null;
  }
  try {
    return JSON.parse(body.candidates[0].content.parts[0].text);
  } catch (e) {
    logEvent('ERROR', 'gemini_parse_failed', String(e));
    return null;
  }
}

// ---------- Penyimpanan aksi tertunda (menunggu konfirmasi) ----------

function pendingKey(chatId) { return 'pending_' + chatId; }
function setPending(chatId, action) { CacheService.getScriptCache().put(pendingKey(chatId), JSON.stringify(action), 600); }
function getPending(chatId) { var v = CacheService.getScriptCache().get(pendingKey(chatId)); return v ? JSON.parse(v) : null; }
function clearPending(chatId) { CacheService.getScriptCache().remove(pendingKey(chatId)); }

/** Teks ringkas untuk konfirmasi. */
function confirmText(a) {
  switch (a.intent) {
    case 'keluar': return '💸 Pengeluaran Rp' + formatRupiah(a.nominal) + ' · ' + a.kategori + (a.keterangan ? ' · ' + a.keterangan : '') + tglInfo(a);
    case 'masuk':  return '💰 Pemasukan Rp' + formatRupiah(a.nominal) + ' · ' + a.kategori + (a.keterangan ? ' · ' + a.keterangan : '') + tglInfo(a);
    case 'tugas':  return '📋 Tugas: ' + a.teks + (a.jatuh_tempo ? ' (tenggat ' + a.jatuh_tempo + ')' : '');
    case 'catat':  return '📝 Catatan: ' + a.teks;
    case 'hapus':
      if (a.target === 'tugas') return '🗑️ Hapus tugas ' + (a.id || '?') + '?';
      if (a.target === 'bulan') return '🗑️ Hapus SEMUA keuangan bulan ' + (a.bulan || '?') + '? (tidak bisa dibatalkan)';
      return '🗑️ Hapus transaksi keuangan TERAKHIR?';
    case 'edit':
      if (a.target === 'catatan') return '✏️ Ubah catatan terakhir jadi: ' + (a.nilai || '?');
      if (a.target === 'tugas') return '✏️ Ubah tugas ' + (a.id || '?') + ' — ' + (a.field || '?') + ' → ' + (a.nilai || '?');
      return '✏️ Ubah transaksi terakhir — ' + (a.field || '?') + ' → ' + (a.nilai || '?');
    default:       return '';
  }
}

/** " · tgl 2026-06-19" bila aksi keuangan menyebut tanggal lampau yang valid. */
function tglInfo(a) {
  return (a.tanggal && isValidDate(a.tanggal)) ? ' · tgl ' + a.tanggal : '';
}

// ---------- Alur natural language ----------

/** Dipanggil dari Router untuk pesan non-perintah (tanpa awalan '/'). */
function handleNatural(text, chatId) {
  var low = text.toLowerCase().trim();

  // Jika ada aksi tertunda, tafsirkan jawaban ya/tidak.
  if (getPending(chatId)) {
    if (/^(ya|iya|ok|oke|yes|betul|benar|y|simpan)$/.test(low)) { confirmPending(chatId); return; }
    if (/^(tidak|gak|ga|nggak|no|batal|n)$/.test(low)) { cancelPending(chatId); return; }
    // selain itu: anggap permintaan baru, timpa yang lama.
  }

  var a = geminiParse(text);
  if (!a || a.intent === 'unknown') {
    sendMessage(chatId, '🤔 Belum paham. Coba lebih spesifik, atau pakai perintah:\n/keluar 25000 makan\n/tugas bayar listrik #2026-06-25');
    return;
  }

  // Aksi read-only / aman: langsung jalankan tanpa konfirmasi.
  if (a.intent === 'cari') { cmdCari([a.query || ''], chatId); return; }
  if (a.intent === 'rekap') { cmdRekap([a.bulan || ''], chatId); return; }
  if (a.intent === 'daftar') { cmdDaftar([], chatId); return; }
  if (a.intent === 'selesai') {
    if (!a.id) { sendMessage(chatId, '🤔 Tugas yang mana? Sebutkan ID-nya, mis. "selesaikan T-0001".'); return; }
    cmdSelesai([a.id], chatId);
    return;
  }

  // Edit: mengubah data → selalu lewat konfirmasi.
  if (a.intent === 'edit') {
    var et = String(a.target || '').toLowerCase();
    if (et === 'catatan') {
      if (!String(a.nilai || '').trim()) { sendMessage(chatId, '🤔 Catatan baru isinya apa?'); return; }
    } else if (et === 'tugas') {
      if (!a.id || !a.field || !String(a.nilai || '').trim()) { sendMessage(chatId, '🤔 Sebutkan ID tugas, bagian yang diubah, dan nilainya. Mis. "ubah tenggat T-0001 ke 2026-06-30".'); return; }
    } else {
      a.target = 'terakhir';
      if (!a.field || !String(a.nilai || '').trim()) { sendMessage(chatId, '🤔 Mau ubah apa dan jadi apa? Mis. "ubah nominal terakhir jadi 30rb".'); return; }
    }
    setPending(chatId, a);
    sendMessage(chatId, confirmText(a) + '\n\n/ya untuk ubah · /tidak untuk batal');
    return;
  }

  // Hapus: destruktif → selalu lewat konfirmasi.
  if (a.intent === 'hapus') {
    var tgt = String(a.target || '').toLowerCase();
    if (tgt === 'tugas' && !a.id) { sendMessage(chatId, '🤔 Hapus tugas yang mana? Sebutkan ID, mis. "hapus tugas T-0001".'); return; }
    if (tgt === 'bulan' && !parseBulan(a.bulan)) { sendMessage(chatId, '🤔 Bulan mana? Sebutkan, mis. "hapus keuangan bulan 2026-05".'); return; }
    if (tgt !== 'tugas' && tgt !== 'bulan') a.target = 'terakhir';
    setPending(chatId, a);
    sendMessage(chatId, confirmText(a) + '\n\n/ya untuk hapus · /tidak untuk batal');
    return;
  }

  // Pastikan data lengkap untuk tiap jenis (cegah tampilan "undefined").
  if (a.intent === 'keluar' || a.intent === 'masuk') {
    if (!a.nominal || a.nominal <= 0) {
      sendMessage(chatId, '🤔 Nominalnya berapa? Sebutkan angkanya, mis. "kopi 25rb".');
      return;
    }
    var kat = String(a.kategori || '').toLowerCase();
    if (!isKategoriValid(kat, a.intent)) kat = 'lainnya'; // jangan pernah kosong
    a.kategori = kat;
  }
  if ((a.intent === 'tugas' || a.intent === 'catat') && !String(a.teks || '').trim()) {
    sendMessage(chatId, '🤔 Isinya apa? Coba tulis lebih lengkap.');
    return;
  }

  setPending(chatId, a);
  sendMessage(chatId, confirmText(a) + '\n\n/ya untuk simpan · /tidak untuk batal');
}

function confirmPending(chatId) {
  var a = getPending(chatId);
  if (!a) { sendMessage(chatId, 'Tidak ada yang menunggu konfirmasi.'); return; }
  clearPending(chatId);
  executeAction(a, chatId);
}

function cancelPending(chatId) {
  clearPending(chatId);
  sendMessage(chatId, '❌ Dibatalkan.');
}

/** Tulis aksi ke sheet setelah dikonfirmasi. Tetap validasi (jaga data bersih). */
function executeAction(a, chatId) {
  switch (a.intent) {
    case 'keluar':
    case 'masuk':
      if (!a.nominal || a.nominal <= 0) { sendMessage(chatId, '❌ Nominal tidak valid — batal.'); return; }
      var kat = String(a.kategori || '').toLowerCase();
      if (!isKategoriValid(kat, a.intent)) {
        sendMessage(chatId, '❌ Kategori "' + kat + '" tidak dikenal — batal. Tambah di sheet Kategori bila perlu.');
        return;
      }
      var when = (a.tanggal && isValidDate(a.tanggal)) ? new Date(a.tanggal + 'T12:00:00') : new Date();
      append('Keuangan', [when, a.intent, a.nominal, kat, a.keterangan || '', 'bot-ai']);
      logEvent('INFO', 'ai_keuangan_added', a.intent + ' ' + a.nominal + ' ' + kat);
      sendMessage(chatId, '✅ Tersimpan: ' + confirmText(a) + tanggalSuffix(when));
      refreshDashboard();
      break;

    case 'tugas':
      if (!a.teks) { sendMessage(chatId, '❌ Teks tugas kosong — batal.'); return; }
      var due = (a.jatuh_tempo && isValidDate(a.jatuh_tempo)) ? a.jatuh_tempo : '';
      var id = nextId('Tugas', 'T-');
      append('Tugas', [id, a.teks, due, 'open', '']);
      logEvent('INFO', 'ai_tugas_added', id);
      sendMessage(chatId, '✅ Tugas ' + id + ' tersimpan' + (due ? ' (tenggat ' + due + ')' : '') + ': ' + a.teks);
      break;

    case 'catat':
      if (!a.teks) { sendMessage(chatId, '❌ Catatan kosong — batal.'); return; }
      append('Catatan', [new Date(), a.teks]);
      logEvent('INFO', 'ai_catatan_added', '');
      sendMessage(chatId, '✅ Catatan tersimpan.');
      break;

    case 'hapus':
      // Sudah dikonfirmasi /ya; untuk hapus per bulan lewati pengaman KONFIRM tahap-2.
      if (a.target === 'tugas') hapusTugas(a.id, chatId);
      else if (a.target === 'bulan') hapusKeuanganBulan(a.bulan, 'KONFIRM', chatId);
      else hapusKeuanganTerakhir(chatId);
      break;

    case 'edit':
      if (a.target === 'catatan') editCatatanTerakhir(a.nilai, chatId);
      else if (a.target === 'tugas') editTugas(a.id, normField(a.field), a.nilai, chatId);
      else editKeuanganTerakhir(normField(a.field), a.nilai, chatId);
      break;

    default:
      sendMessage(chatId, 'Tidak bisa diproses.');
  }
}
