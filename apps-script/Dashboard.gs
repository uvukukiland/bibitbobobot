/**
 * Dashboard.gs — sheet "Dashboard" bergaya modern dari data Keuangan.
 * Nilai DIHITUNG di Apps Script (bukan rumus) agar anti-locale (id_ID pakai ';').
 * - buildDashboard()      : bangun layout + chart + isi data (jalankan sekali dari editor).
 * - refreshDashboard()    : perbarui angka saja (dipakai trigger & dipanggil bot tiap transaksi).
 * - installDashboardTrigger(): pasang refresh otomatis tiap jam.
 */

var MONTH_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

function buildDashboard() {
  var book = ss();
  var old = book.getSheetByName('Dashboard');
  if (old) {
    if (book.getActiveSheet().getName() === 'Dashboard') book.setActiveSheet(book.getSheetByName('Keuangan'));
    book.deleteSheet(old);
  }
  var sh = book.insertSheet('Dashboard', 0);
  sh.setTabColor('#0F172A');
  sh.setHiddenGridlines(true);
  for (var c = 1; c <= 6; c++) sh.setColumnWidth(c, 135);

  // --- Judul ---
  sh.getRange('A1:F1').merge().setValue('   💰  Dashboard Keuangan')
    .setBackground('#0F172A').setFontColor('#FFFFFF').setFontSize(18)
    .setFontWeight('bold').setVerticalAlignment('middle');
  sh.setRowHeight(1, 48);
  sh.getRange('A2:F2').merge().setBackground('#0F172A').setFontColor('#94A3B8')
    .setFontSize(11).setVerticalAlignment('middle');
  sh.setRowHeight(2, 26);
  sh.setRowHeight(3, 10);

  // --- Kartu utama (bulan berjalan) ---
  dashLabel(sh, 'A4:B4', 'PEMASUKAN', false);
  dashLabel(sh, 'C4:D4', 'PENGELUARAN', false);
  dashLabel(sh, 'E4:F4', 'SALDO BULAN', false);
  dashValue(sh, 'A5:B5', '#16A34A', true);
  dashValue(sh, 'C5:D5', '#DC2626', true);
  dashValue(sh, 'E5:F5', '#2563EB', true);
  dashBox(sh, 'A4:B5'); dashBox(sh, 'C4:D5'); dashBox(sh, 'E4:F5');
  sh.setRowHeight(4, 22); sh.setRowHeight(5, 40); sh.setRowHeight(6, 12);

  // --- Statistik sekunder ---
  dashLabel(sh, 'A7:B7', 'SALDO TOTAL (SEMUA WAKTU)', true);
  dashLabel(sh, 'C7:D7', 'JUMLAH TRANSAKSI', true);
  dashLabel(sh, 'E7:F7', 'PENGELUARAN vs BULAN LALU', true);
  dashValue(sh, 'A8:B8', '#0F172A', false);
  dashValue(sh, 'C8:D8', '#0F172A', false);
  dashValue(sh, 'E8:F8', '#0F172A', false);
  dashBox(sh, 'A7:B8'); dashBox(sh, 'C7:D8'); dashBox(sh, 'E7:F8');
  sh.setRowHeight(7, 22); sh.setRowHeight(8, 34); sh.setRowHeight(9, 14);

  // --- Pengeluaran per kategori ---
  sh.getRange('A10:F10').merge().setValue('  Pengeluaran per Kategori')
    .setBackground('#F1F5F9').setFontColor('#0F172A').setFontWeight('bold')
    .setFontSize(11).setVerticalAlignment('middle');
  sh.setRowHeight(10, 28);
  sh.getRange('A11:C11').setValues([['Kategori', 'Total', '%']])
    .setFontWeight('bold').setBackground('#F8FAFC');
  sh.getRange('B12:B24').setNumberFormat('"Rp"#,##0');
  sh.getRange('C12:C24').setNumberFormat('0.0%');

  // --- Transaksi terakhir ---
  sh.getRange('A26:F26').merge().setValue('  Transaksi Terakhir')
    .setBackground('#F1F5F9').setFontColor('#0F172A').setFontWeight('bold')
    .setFontSize(11).setVerticalAlignment('middle');
  sh.setRowHeight(26, 28);
  sh.getRange('A27:E27').setValues([['Waktu', 'Tipe', 'Nominal', 'Kategori', 'Keterangan']])
    .setFontWeight('bold').setBackground('#F8FAFC');
  sh.getRange('A28:A35').setNumberFormat('dd/MM/yyyy HH:mm');
  sh.getRange('C28:C35').setNumberFormat('"Rp"#,##0');

  // Isi data sebelum membuat chart agar range grafik sudah berisi angka.
  writeDashboardData(sh);

  var chart = sh.newChart()
    .setChartType(Charts.ChartType.PIE)
    .addRange(sh.getRange('A11:B24'))
    .setNumHeaders(1)
    .setPosition(11, 5, 5, 0)
    .setOption('title', 'Komposisi Pengeluaran')
    .setOption('legend', { position: 'right' })
    .setOption('width', 380)
    .setOption('height', 240)
    .build();
  sh.insertChart(chart);

  SpreadsheetApp.flush();
  Logger.log('Dashboard selesai dibangun.');
}

/** Hitung ulang & tulis angka ke sheet Dashboard yang sudah ada. Tidak mengubah layout/chart. */
function writeDashboardData(sh) {
  var now = new Date();
  var b = { y: now.getFullYear(), m: now.getMonth() + 1 };
  var prev = (b.m === 1) ? { y: b.y - 1, m: 12 } : { y: b.y, m: b.m - 1 };
  var d = scanKeuangan(b, prev);

  sh.getRange('A2').setValue('   Ringkasan ' + MONTH_ID[b.m - 1] + ' ' + b.y);

  sh.getRange('A5').setValue(d.masuk);
  sh.getRange('C5').setValue(d.keluar);
  sh.getRange('E5').setValue(d.masuk - d.keluar);

  sh.getRange('A8').setValue(d.saldoTotal);
  sh.getRange('C8').setValue(d.nTx + ' transaksi');
  sh.getRange('E8').setValue(deltaText(d.keluar, d.keluarPrev));

  // Kategori (maks 13 baris) + persen.
  sh.getRange('A12:C24').clearContent();
  if (d.perKat.length === 0) {
    sh.getRange('A12').setValue('Belum ada pengeluaran');
  } else {
    var rows = d.perKat.slice(0, 13).map(function (t) {
      return [t[0], t[1], d.keluar ? t[1] / d.keluar : 0];
    });
    sh.getRange(12, 1, rows.length, 3).setValues(rows);
  }

  // Transaksi terakhir (8).
  sh.getRange('A28:E35').clearContent();
  if (d.recent.length === 0) {
    sh.getRange('A28').setValue('Belum ada transaksi');
  } else {
    sh.getRange(28, 1, d.recent.length, 5).setValues(d.recent);
  }
}

/** Pindai sheet Keuangan sekali; kembalikan agregat bulan b & pembanding bulan prev. */
function scanKeuangan(b, prev) {
  var rows = readAll('Keuangan');
  var masuk = 0, keluar = 0, keluarPrev = 0, nTx = 0, saldoTotal = 0, perKat = {};
  var all = [];
  for (var i = 1; i < rows.length; i++) {
    var raw = rows[i][0];
    var tipe = String(rows[i][1]).toLowerCase();
    var nom = Number(rows[i][2]) || 0;
    if (tipe === 'masuk') saldoTotal += nom;
    else if (tipe === 'keluar') saldoTotal -= nom;

    var dt = (raw instanceof Date) ? raw : new Date(raw);
    var ok = !isNaN(dt.getTime());
    if (ok && dt.getFullYear() === prev.y && (dt.getMonth() + 1) === prev.m && tipe === 'keluar') keluarPrev += nom;
    if (ok && dt.getFullYear() === b.y && (dt.getMonth() + 1) === b.m) {
      nTx++;
      if (tipe === 'masuk') masuk += nom;
      else if (tipe === 'keluar') {
        keluar += nom;
        var k = String(rows[i][3] || 'lainnya').toLowerCase();
        perKat[k] = (perKat[k] || 0) + nom;
      }
    }
    if (ok) all.push([dt, tipe, nom, rows[i][3] || '', rows[i][4] || '']);
  }
  all.sort(function (x, y) { return y[0].getTime() - x[0].getTime(); });
  var perKatSorted = Object.keys(perKat).map(function (k) { return [k, perKat[k]]; })
    .sort(function (x, y) { return y[1] - x[1]; });
  return {
    masuk: masuk, keluar: keluar, keluarPrev: keluarPrev, nTx: nTx,
    saldoTotal: saldoTotal, perKat: perKatSorted, recent: all.slice(0, 8)
  };
}

/** Teks perbandingan pengeluaran vs bulan lalu. */
function deltaText(cur, prev) {
  if (!prev) return prev === 0 && cur > 0 ? '▲ baru bulan ini' : '— belum ada pembanding';
  var pct = Math.round((cur - prev) / prev * 100);
  if (pct > 0) return '▲ ' + pct + '% lebih banyak';
  if (pct < 0) return '▼ ' + Math.abs(pct) + '% lebih hemat';
  return '= sama dengan bulan lalu';
}

/** Refresh aman dipanggil dari bot: no-op bila Dashboard belum dibangun; tak melempar. */
function refreshDashboard() {
  try {
    var sh = ss().getSheetByName('Dashboard');
    if (!sh) return;
    writeDashboardData(sh);
    SpreadsheetApp.flush();
  } catch (e) {
    logEvent('ERROR', 'dashboard_refresh_failed', String(e));
  }
}

/** Pasang trigger refresh otomatis tiap jam (jalankan sekali dari editor). */
function installDashboardTrigger() {
  removeTriggers(['refreshDashboard']);
  ScriptApp.newTrigger('refreshDashboard').timeBased().everyHours(1).create();
  Logger.log('Trigger refreshDashboard (tiap jam) terpasang.');
}

// ---------- helper gaya kartu ----------

function dashLabel(sh, a1, text, kecil) {
  sh.getRange(a1).merge().setValue(text)
    .setBackground('#F8FAFC').setFontColor('#64748B').setFontSize(kecil ? 8 : 10)
    .setFontWeight('bold').setVerticalAlignment('middle').setHorizontalAlignment('center');
}

function dashValue(sh, a1, accent, besar) {
  sh.getRange(a1).merge().setBackground('#F8FAFC').setFontColor(accent)
    .setFontSize(besar ? 17 : 12).setFontWeight('bold')
    .setNumberFormat('"Rp"#,##0').setVerticalAlignment('middle').setHorizontalAlignment('center');
}

function dashBox(sh, a1) {
  sh.getRange(a1).setBorder(true, true, true, true, false, false, '#E2E8F0', SpreadsheetApp.BorderStyle.SOLID);
}
