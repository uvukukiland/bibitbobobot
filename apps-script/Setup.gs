/**
 * Setup.gs — skrip sekali-jalan untuk menyiapkan fondasi (T0).
 * Jalankan dari editor Apps Script, satu fungsi per langkah, sesuai urutan README.
 * Acuan: DESAIN-DAN-TASK.md §A, §B, §F (Fase 0).
 */

/**
 * LANGKAH 1 — isi Script Properties.
 * Ganti nilai placeholder di bawah, Run sekali, lalu KOSONGKAN lagi nilainya
 * (agar token tidak tertinggal di kode).
 */
function setupProperties() {
  PropertiesService.getScriptProperties().setProperties({
    TELEGRAM_BOT_TOKEN: 'ISI_TOKEN_BOTFATHER',
    ALLOWED_CHAT_ID: 'ISI_CHAT_ID',
    SPREADSHEET_ID: 'ISI_SPREADSHEET_ID',   // WAJIB di proyek standalone (alur README). Kosong hanya jika skrip terikat ke spreadsheet.
    DRIVE_ROOT_FOLDER_ID: 'ISI_FOLDER_ID',  // dipakai Fase 3; boleh dibiarkan placeholder dulu
    WEB_APP_URL: 'ISI_URL_EXEC',             // URL /exec dari Deploy > Manage deployments (WAJIB berakhiran /exec)
    HEARTBEAT_HOUR: '7',
    REPORT_HOUR: '21'
  }, false);
  Logger.log('Properties tersimpan. Sekarang kosongkan kembali nilai di fungsi ini.');
}

/** Skema 6 sheet sesuai §A desain. */
var SCHEMA = {
  Keuangan: ['timestamp', 'tipe', 'nominal', 'kategori', 'keterangan', 'sumber'],
  Tugas:    ['id', 'teks', 'jatuh_tempo', 'status', 'terkirim_pada'],
  Catatan:  ['timestamp', 'teks'],
  Jadwal:   ['id', 'label', 'waktu', 'hari', 'aktif', 'terkirim_pada'],
  Log:      ['timestamp', 'level', 'event', 'detail'],
  Kategori: ['kategori', 'tipe']
};

/**
 * LANGKAH 2 — buat semua sheet + header. Aman dijalankan berulang (idempoten):
 * sheet yang sudah ada tidak ditimpa.
 */
function setupSheets() {
  var book = ss();
  Object.keys(SCHEMA).forEach(function (name) {
    var s = book.getSheetByName(name) || book.insertSheet(name);
    if (s.getLastRow() === 0) {
      s.appendRow(SCHEMA[name]);
      s.setFrozenRows(1);
    }
  });
  var def = book.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0 && book.getSheets().length > 1) {
    book.deleteSheet(def);
  }
  Logger.log('Sheet siap: ' + Object.keys(SCHEMA).join(', '));
}

/** Kategori awal — EDIT sesuai kebutuhanmu, lalu jalankan seedKategori(). */
var KATEGORI_DEFAULT = [
  ['makan', 'keluar'],
  ['transport', 'keluar'],
  ['belanja', 'keluar'],
  ['tagihan', 'keluar'],
  ['pulsa', 'keluar'],       // pulsa/internet/paket data
  ['kesehatan', 'keluar'],
  ['pendidikan', 'keluar'],  // sekolah/kursus/buku
  ['rumah', 'keluar'],       // kebutuhan rumah, perabot, listrik air
  ['anak', 'keluar'],
  ['sedekah', 'keluar'],     // donasi/zakat/sedekah
  ['olahraga', 'keluar'],
  ['hiburan', 'keluar'],
  ['tabungan', 'keluar'],    // setoran tabungan — CATATAN: ini mengurangi saldo "uang bebas"
  ['gaji', 'masuk'],
  ['freelance', 'masuk'],
  ['bonus', 'masuk'],
  ['hadiah', 'masuk'],
  ['refund', 'masuk'],       // pengembalian dana
  ['investasi', 'masuk'],    // hasil/dividen investasi
  ['lainnya', 'both']
];

/**
 * LANGKAH 2b (Fase 1) — isi kategori ke sheet `Kategori`.
 * Idempoten & non-destruktif: HANYA menambah kategori yang belum ada,
 * tidak menimpa baris/editan yang sudah ada. Aman dijalankan berulang.
 */
function seedKategori() {
  var s = sheet('Kategori');
  var existing = {};
  if (s.getLastRow() > 1) {
    var rows = s.getRange(2, 1, s.getLastRow() - 1, 1).getValues();
    rows.forEach(function (r) { existing[String(r[0]).trim().toLowerCase()] = true; });
  }
  var tambah = KATEGORI_DEFAULT.filter(function (k) { return !existing[String(k[0]).toLowerCase()]; });
  if (tambah.length === 0) {
    Logger.log('Semua kategori default sudah ada — tidak ada yang ditambah.');
    return;
  }
  s.getRange(s.getLastRow() + 1, 1, tambah.length, 2).setValues(tambah);
  Logger.log('Menambah ' + tambah.length + ' kategori baru: ' + tambah.map(function (k) { return k[0]; }).join(', '));
}

/**
 * LANGKAH 3 — daftarkan webhook Telegram.
 * Jalankan SETELAH men-deploy proyek sebagai Web App.
 */
function setupWebhook() {
  Logger.log(JSON.stringify(setWebhook()));
}

/** Bantu cek konfigurasi: cetak status properti & sheet ke Log. */
function setupVerify() {
  var keys = ['TELEGRAM_BOT_TOKEN', 'ALLOWED_CHAT_ID', 'SPREADSHEET_ID', 'DRIVE_ROOT_FOLDER_ID', 'WEB_APP_URL'];
  keys.forEach(function (k) {
    var v = cfgOptional(k, '');
    Logger.log(k + ': ' + (v ? 'terisi' : 'KOSONG'));
  });
  Object.keys(SCHEMA).forEach(function (name) {
    Logger.log('Sheet ' + name + ': ' + (ss().getSheetByName(name) ? 'ada' : 'BELUM ADA'));
  });
}
