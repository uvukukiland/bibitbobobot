/**
 * Polish.gs — rapikan tampilan SEMUA sheet data agar profesional & konsisten.
 * Jalankan SEKALI dari editor: polishSheets(). Aman diulang (idempoten):
 * header gelap+beku, lebar kolom pas, format Rp & tanggal, baris belang (banding),
 * warna tab. Baris baru dari bot otomatis mewarisi format kolom.
 *
 * Catatan: format diterapkan ke seluruh kolom, jadi transaksi baru ikut rapi
 * tanpa perlu menjalankan ulang. Jalankan lagi hanya bila ada sheet Arsip baru.
 */

var POLISH_HEADER_BG = '#0F172A';
var POLISH_HEADER_FG = '#FFFFFF';

/** Konfigurasi per sheet: lebar kolom, kolom uang (Rp), kolom tanggal, warna tab. */
var POLISH_CFG = {
  Keuangan: { widths: [150, 90, 120, 130, 280, 110, 90], money: [3], dates: [1], color: '#16A34A' },
  Tugas:    { widths: [80, 340, 130, 100, 150],        money: [],  dates: [],  color: '#2563EB' },
  Catatan:  { widths: [150, 460, 90],                   money: [],  dates: [1], color: '#7C3AED' },
  Jadwal:   { widths: [80, 280, 90, 120, 80, 150],      money: [],  dates: [],  color: '#D97706' },
  Kategori: { widths: [190, 110],                       money: [],  dates: [],  color: '#0891B2' },
  Budget:   { widths: [190, 130],                       money: [2], dates: [],  color: '#DB2777' },
  Kamus:    { widths: [280, 160],                       money: [],  dates: [],  color: '#0EA5E9' },
  Log:      { widths: [150, 80, 210, 380],              money: [],  dates: [1], color: '#64748B' }
};

/** Rapikan semua sheet data + sheet Arsip <tahun>. */
function polishSheets() {
  var book = ss();
  Object.keys(POLISH_CFG).forEach(function (name) {
    var s = book.getSheetByName(name);
    if (s) styleSheet(s, POLISH_CFG[name]);
  });
  // Sheet arsip per tahun (kolom: bulan, waktu, tipe, nominal, kategori, keterangan, sumber).
  book.getSheets().forEach(function (s) {
    if (/^Arsip \d{4}$/.test(s.getName())) {
      styleSheet(s, { widths: [90, 150, 90, 130, 130, 260, 110], money: [4], dates: [2], color: '#475569' });
    }
  });
  applyConditionalFormats();
  applyDataValidation();
  reorderSheets(book);
  var log = book.getSheetByName('Log');
  if (log) log.hideSheet();              // Log = diagnostik internal, sembunyikan agar bersih
  SpreadsheetApp.flush();
  Logger.log('✅ Polish selesai untuk semua sheet data.');
}

/** Rapikan urutan tab: Dashboard → data → Arsip (tahun terbaru dulu); buka di Dashboard. */
function reorderSheets(book) {
  var pos = 1;
  ['Dashboard', 'Keuangan', 'Tugas', 'Catatan', 'Jadwal', 'Kategori', 'Budget', 'Kamus'].forEach(function (name) {
    var s = book.getSheetByName(name);
    if (s) { book.setActiveSheet(s); book.moveActiveSheet(pos++); }
  });
  book.getSheets()
    .filter(function (s) { return /^Arsip \d{4}$/.test(s.getName()); })
    .sort(function (a, b) { return b.getName().localeCompare(a.getName()); })
    .forEach(function (s) { book.setActiveSheet(s); book.moveActiveSheet(pos++); });
  var dash = book.getSheetByName('Dashboard');
  if (dash) book.setActiveSheet(dash);   // default terbuka di Dashboard
}

/**
 * Pewarnaan otomatis (conditional formatting) yang anti-locale (pakai kondisi bawaan,
 * BUKAN rumus dgn pemisah argumen — hindari jebakan ; vs , di id_ID).
 * - Keuangan: tipe keluar=merah / masuk=hijau; nominal ≥ 1 juta dicetak tebal.
 * - Tugas: status done=abu / open=biru.
 * - Arsip <tahun>: tipe keluar=merah / masuk=hijau.
 * setConditionalFormatRules MENGGANTI semua aturan → idempoten.
 */
function applyConditionalFormats() {
  var book = ss();

  var keu = book.getSheetByName('Keuangan');
  if (keu && keu.getMaxRows() > 1) {
    var n = keu.getMaxRows() - 1;
    var tipe = keu.getRange(2, 2, n, 1);     // kolom tipe
    var nom = keu.getRange(2, 3, n, 1);      // kolom nominal
    keu.setConditionalFormatRules([
      // Tebal saja (bukan merah): pemasukan besar seperti gaji tak boleh tampak seperti peringatan.
      SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThanOrEqualTo(1000000)
        .setBold(true).setFontColor('#0F172A').setRanges([nom]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('keluar')
        .setBackground('#FEE2E2').setFontColor('#B91C1C').setRanges([tipe]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('masuk')
        .setBackground('#DCFCE7').setFontColor('#15803D').setRanges([tipe]).build()
    ]);
  }

  var tug = book.getSheetByName('Tugas');
  if (tug && tug.getMaxRows() > 1) {
    var st = tug.getRange(2, 4, tug.getMaxRows() - 1, 1); // kolom status
    tug.setConditionalFormatRules([
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('done')
        .setBackground('#F1F5F9').setFontColor('#94A3B8').setRanges([st]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('open')
        .setBackground('#DBEAFE').setFontColor('#1D4ED8').setRanges([st]).build()
    ]);
  }

  book.getSheets().forEach(function (s) {
    if (!/^Arsip \d{4}$/.test(s.getName()) || s.getMaxRows() < 2) return;
    var t = s.getRange(2, 3, s.getMaxRows() - 1, 1); // kolom tipe di arsip
    s.setConditionalFormatRules([
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('keluar')
        .setBackground('#FEE2E2').setFontColor('#B91C1C').setRanges([t]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('masuk')
        .setBackground('#DCFCE7').setFontColor('#15803D').setRanges([t]).build()
    ]);
  });
}

/**
 * Dropdown pilihan (data validation) agar edit MANUAL di sheet tak salah ketik.
 * Anti-locale: daftar nilai & rentang sel, BUKAN rumus. setAllowInvalid(true) = hanya peringatan
 * (bot tetap bisa menulis; sel tak valid ditandai segitiga merah). Kategori diambil langsung dari
 * sheet Kategori, jadi kategori baru otomatis ikut muncul di dropdown.
 */
function applyDataValidation() {
  var book = ss();
  var kat = book.getSheetByName('Kategori');
  var rentangKat = (kat && kat.getMaxRows() > 1) ? kat.getRange(2, 1, kat.getMaxRows() - 1, 1) : null;
  var daftar = function (nilai, bantuan) {
    return SpreadsheetApp.newDataValidation().requireValueInList(nilai, true).setAllowInvalid(true).setHelpText(bantuan).build();
  };
  var dariKategori = function (bantuan) {
    return SpreadsheetApp.newDataValidation().requireValueInRange(rentangKat, true).setAllowInvalid(true).setHelpText(bantuan).build();
  };
  var pasang = function (nama, kolom, aturan) {
    var s = book.getSheetByName(nama);
    if (!s || !aturan || s.getMaxRows() < 2) return;
    s.getRange(2, kolom, s.getMaxRows() - 1, 1).setDataValidation(aturan);
  };
  pasang('Keuangan', 2, daftar(['keluar', 'masuk'], 'Pilih: keluar atau masuk'));
  pasang('Tugas', 4, daftar(['open', 'done'], 'open = belum selesai, done = selesai'));
  pasang('Jadwal', 5, daftar(['y', 'n'], 'y = aktif, n = nonaktif'));
  pasang('Kategori', 2, daftar(['keluar', 'masuk', 'both'], 'Tipe kategori: keluar / masuk / both'));
  if (rentangKat) {
    pasang('Keuangan', 4, dariKategori('Pilih kategori yang terdaftar di sheet Kategori'));
    pasang('Budget', 1, dariKategori('Kategori pengeluaran yang diberi batas'));
    pasang('Kamus', 2, dariKategori('Kategori tujuan kata ini'));
  }
}

/** Terapkan gaya konsisten pada satu sheet. */
function styleSheet(s, c) {
  var lastCol = s.getLastColumn();
  if (lastCol < 1) return;
  var maxRows = s.getMaxRows();

  // Header: gelap, teks putih tebal, beku.
  s.getRange(1, 1, 1, lastCol)
    .setBackground(POLISH_HEADER_BG).setFontColor(POLISH_HEADER_FG).setFontWeight('bold')
    .setVerticalAlignment('middle').setHorizontalAlignment('left').setFontSize(10);
  s.setRowHeight(1, 30);
  s.setFrozenRows(1);
  s.setFrozenColumns(1);                 // kolom pertama tetap terlihat saat scroll kanan
  try { s.setTabColor(c.color); } catch (e) {}
  s.setHiddenGridlines(true);

  // Lebar kolom.
  if (c.widths) c.widths.forEach(function (w, i) { if (i < lastCol) s.setColumnWidth(i + 1, w); });

  // Baris belang (banding) — buang yang lama dulu agar tak menumpuk.
  s.getBandings().forEach(function (b) { b.remove(); });
  if (maxRows > 1) {
    s.getRange(2, 1, maxRows - 1, lastCol)
      .applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);
  }

  // Format angka & tanggal pada seluruh kolom (agar baris baru ikut rapi).
  if (maxRows > 1) {
    (c.money || []).forEach(function (col) {
      if (col <= lastCol) s.getRange(2, col, maxRows - 1, 1).setNumberFormat('"Rp"#,##0').setHorizontalAlignment('right');
    });
    (c.dates || []).forEach(function (col) {
      if (col <= lastCol) s.getRange(2, col, maxRows - 1, 1).setNumberFormat('dd/MM/yyyy HH:mm');
    });
  }
}
