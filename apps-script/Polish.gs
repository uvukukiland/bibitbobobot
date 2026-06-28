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
  Keuangan: { widths: [150, 90, 120, 130, 280, 110], money: [3], dates: [1], color: '#16A34A' },
  Tugas:    { widths: [80, 340, 130, 100, 150],        money: [],  dates: [],  color: '#2563EB' },
  Catatan:  { widths: [150, 480],                       money: [],  dates: [1], color: '#7C3AED' },
  Jadwal:   { widths: [80, 280, 90, 120, 80, 150],      money: [],  dates: [],  color: '#D97706' },
  Kategori: { widths: [190, 110],                       money: [],  dates: [],  color: '#0891B2' },
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
  SpreadsheetApp.flush();
  Logger.log('✅ Polish selesai untuk semua sheet data.');
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
