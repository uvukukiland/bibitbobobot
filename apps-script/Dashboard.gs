/**
 * Dashboard.gs — sheet "Dashboard" yang menarik & informatif dari data Keuangan.
 * Semua angka DIHITUNG di Apps Script lalu ditulis sebagai nilai (bukan rumus) agar anti-locale
 * (locale id_ID memakai ';' sehingga rumus buatan skrip sering #ERROR!).
 *
 *   buildDashboard()          : bangun tata letak + grafik + isi data (jalankan dari editor; aman diulang).
 *   refreshDashboard()        : perbarui angka saja (dipanggil bot tiap transaksi & trigger tiap jam).
 *                               Bila tata letak lama/belum versi ini -> otomatis dibangun ulang.
 *   installDashboardTrigger() : pasang refresh otomatis tiap jam.
 *
 * Tata letak (kolom A–H, data bantu grafik di kolom J–L yang disembunyikan):
 *   1–2   judul + waktu pembaruan
 *   4–6   4 kartu KPI: pemasukan · pengeluaran · saldo bulan · saldo total
 *   8–22  📈 tren 6 bulan (kolom)  |  🍩 komposisi pengeluaran (donat)
 *   24–33 🎯 budget bulan ini       |  🏆 pengeluaran teratas
 *   35–46 🧾 transaksi terakhir (10, dengan ID)
 *   48–52 💡 insight otomatis
 */

var MONTH_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
var BULAN_PENDEK = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

var DASH_VERSI = 'DASH_V4';         // penanda tata letak (sel J30, tersembunyi) — naikkan bila tata letak/grafik berubah
                                    // V4: chartArea eksplisit (label sumbu & legenda donat tak terpotong)
var DASH_BARIS = 53;
var DASH = {
  bg: '#F1F5F9', card: '#FFFFFF', ink: '#0F172A', muted: '#64748B', line: '#E2E8F0',
  hijau: '#16A34A', merah: '#DC2626', biru: '#2563EB', ungu: '#7C3AED', kuning: '#D97706',
  hijauTeks: '#15803D', kuningTeks: '#B45309',   // versi lebih gelap utk TEKS KECIL (kontras di layar HP)
  judul: 'Poppins', isi: 'Roboto'
};
// Sel berisi TEKS bebas -> format teks '@' agar Sheets tak mengubah "Nov 26" jadi tanggal
// atau teks berawalan "=" jadi rumus (#ERROR!).
var DASH_SEL_TEKS = ['J2:J7', 'J11:J19', 'A26:A33', 'E26:F33', 'B37:C46', 'E37:F46'];
var DASH_WARNA_DONAT = ['#6366F1', '#EC4899', '#F59E0B', '#10B981', '#3B82F6', '#EF4444', '#8B5CF6', '#14B8A6', '#94A3B8'];
var MEDALI = ['🥇', '🥈', '🥉', '4', '5', '6', '7', '8'];

// ======================================================================
// Bangun tata letak
// ======================================================================

function buildDashboard() {
  var book = ss();
  var old = book.getSheetByName('Dashboard');
  if (old) {
    if (book.getActiveSheet().getName() === 'Dashboard') {
      var lain = book.getSheetByName('Keuangan') || book.getSheets().filter(function (s) { return s.getName() !== 'Dashboard'; })[0];
      if (lain) book.setActiveSheet(lain);
    }
    book.deleteSheet(old);
  }
  var sh = book.insertSheet('Dashboard', 0);
  sh.setTabColor(DASH.ink);
  sh.setHiddenGridlines(true);
  if (sh.getMaxRows() < DASH_BARIS) sh.insertRowsAfter(sh.getMaxRows(), DASH_BARIS - sh.getMaxRows());
  for (var c = 1; c <= 8; c++) sh.setColumnWidth(c, 118);
  sh.setColumnWidth(9, 18);

  // Latar halaman + font dasar.
  sh.getRange(1, 1, DASH_BARIS, 9).setBackground(DASH.bg).setFontFamily(DASH.isi)
    .setFontColor(DASH.ink).setVerticalAlignment('middle');

  // --- Judul ---
  sh.getRange('A1:H1').merge().setValue('💰  Dashboard Keuangan')
    .setBackground(DASH.ink).setFontColor('#FFFFFF').setFontFamily(DASH.judul)
    .setFontSize(20).setFontWeight('bold').setHorizontalAlignment('left');
  sh.getRange('A2:H2').merge().setBackground(DASH.ink).setFontColor('#94A3B8')
    .setFontSize(10).setHorizontalAlignment('left');
  sh.getRange('I1:I2').setBackground(DASH.ink);
  sh.setRowHeight(1, 56); sh.setRowHeight(2, 26); sh.setRowHeight(3, 14);

  // --- 4 kartu KPI (garis atas tebal berwarna = aksen kartu) ---
  [['A', 'B', '📥  PEMASUKAN', DASH.hijau], ['C', 'D', '📤  PENGELUARAN', DASH.merah],
   ['E', 'F', '💼  SALDO BULAN INI', DASH.biru], ['G', 'H', '🏦  SALDO TOTAL', DASH.ungu]].forEach(function (k) {
    var a = k[0], b = k[1];
    sh.getRange(a + '4:' + b + '4').merge().setValue(k[2]).setBackground(DASH.card).setFontColor(DASH.muted)
      .setFontSize(9).setFontWeight('bold').setHorizontalAlignment('center');
    sh.getRange(a + '5:' + b + '5').merge().setBackground(DASH.card).setFontColor(k[3]).setFontFamily(DASH.judul)
      .setFontSize(18).setFontWeight('bold').setHorizontalAlignment('center').setNumberFormat('"Rp"#,##0;-"Rp"#,##0');
    sh.getRange(a + '6:' + b + '6').merge().setBackground(DASH.card).setFontColor(DASH.muted)
      .setFontSize(9).setHorizontalAlignment('center');
    sh.getRange(a + '4:' + b + '6').setBorder(true, true, true, true, false, false, DASH.line, SpreadsheetApp.BorderStyle.SOLID);
    sh.getRange(a + '4:' + b + '4').setBorder(true, null, null, null, null, null, k[3], SpreadsheetApp.BorderStyle.SOLID_THICK);
  });
  sh.setRowHeight(4, 26); sh.setRowHeight(5, 44); sh.setRowHeight(6, 24); sh.setRowHeight(7, 14);

  // --- Panel grafik ---
  dashSeksi(sh, 'A8:D8', '📈  Tren 6 Bulan', '#4338CA', '#E0E7FF');
  dashSeksi(sh, 'E8:H8', '🍩  Komposisi Pengeluaran', '#BE185D', '#FCE7F3');
  sh.setRowHeight(8, 30);
  dashPanel(sh, 'A9:D22'); dashPanel(sh, 'E9:H22');
  sh.setRowHeight(23, 14);

  // --- Budget & teratas ---
  dashSeksi(sh, 'A24:D24', '🎯  Budget Bulan Ini', '#B45309', '#FEF3C7');
  dashSeksi(sh, 'E24:H24', '🏆  Pengeluaran Teratas', '#047857', '#D1FAE5');
  sh.setRowHeight(24, 30);
  dashKepalaTabel(sh, 'A25:D25', ['Kategori', 'Terpakai', 'Batas', 'Progres']);
  dashKepalaTabel(sh, 'E25:H25', ['#', 'Kategori', 'Total', 'Porsi']);
  // Judul kolom rata sama dgn isinya (teks kiri, Rp kanan).
  sh.getRange('A25:H25').setHorizontalAlignments([['left', 'right', 'right', 'left', 'center', 'left', 'right', 'left']]);
  dashPanel(sh, 'A25:D33'); dashPanel(sh, 'E25:H33');
  sh.getRange('B26:C33').setNumberFormat('"Rp"#,##0').setHorizontalAlignment('right');
  sh.getRange('D26:D33').setFontFamily('Roboto Mono').setFontSize(9);
  sh.getRange('E26:E33').setHorizontalAlignment('center');
  sh.getRange('G26:G33').setNumberFormat('"Rp"#,##0').setHorizontalAlignment('right');
  sh.getRange('H26:H33').setFontFamily('Roboto Mono').setFontSize(9).setFontColor('#4F46E5'); // indigo, kontras 6:1
  sh.setRowHeight(34, 14);

  // --- Transaksi terakhir ---
  dashSeksi(sh, 'A35:H35', '🧾  Transaksi Terakhir', '#334155', '#E2E8F0');
  sh.setRowHeight(35, 30);
  for (var r = 36; r <= 46; r++) sh.getRange('F' + r + ':H' + r).merge();
  dashKepalaTabel(sh, 'A36:F36', ['Waktu', 'ID', 'Tipe', 'Nominal', 'Kategori', 'Keterangan']);
  sh.getRange('A36:F36').setHorizontalAlignments([['center', 'center', 'center', 'right', 'left', 'left']]);
  dashPanel(sh, 'A36:H46');
  sh.getRange('A37:A46').setNumberFormat('dd/MM HH:mm').setHorizontalAlignment('center');
  sh.getRange('B37:C46').setHorizontalAlignment('center');
  sh.getRange('D37:D46').setNumberFormat('"Rp"#,##0').setHorizontalAlignment('right');
  sh.getRange('B37:B46').setFontColor(DASH.muted).setFontSize(9);
  sh.setRowHeight(47, 14);

  // --- Insight ---
  dashSeksi(sh, 'A48:H48', '💡  Insight Bulan Ini', '#6D28D9', '#EDE9FE');
  sh.setRowHeight(48, 30);
  for (var q = 49; q <= 52; q++) { sh.getRange('A' + q + ':H' + q).merge(); sh.setRowHeight(q, 24); }
  dashPanel(sh, 'A49:H52');
  sh.getRange('A49:A52').setFontSize(10).setHorizontalAlignment('left');

  // --- Data bantu grafik (kolom J–L, disembunyikan) ---
  sh.getRange('J1:L1').setValues([['Bulan', 'Pemasukan', 'Pengeluaran']]);
  sh.getRange('J10:K10').setValues([['Kategori', 'Total']]);
  sh.getRangeList(DASH_SEL_TEKS).setNumberFormat('@');

  // Rapikan kanvas: buang kolom & baris kosong di luar dashboard agar tepinya tak "bocor" putih.
  if (sh.getMaxColumns() > 12) sh.deleteColumns(13, sh.getMaxColumns() - 12);
  if (sh.getMaxRows() > DASH_BARIS) sh.deleteRows(DASH_BARIS + 1, sh.getMaxRows() - DASH_BARIS);

  writeDashboardData(sh);

  var opsi = dashOpsiGrafik();
  var pasangOpsi = function (b, o) { Object.keys(o).forEach(function (k) { b.setOption(k, o[k]); }); return b; };

  sh.insertChart(pasangOpsi(sh.newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(sh.getRange('J1:L7'))
    .setNumHeaders(1)
    .setHiddenDimensionStrategy(Charts.ChartHiddenDimensionStrategy.SHOW_BOTH)
    .setPosition(9, 1, 6, 6), opsi.tren).build());

  sh.insertChart(pasangOpsi(sh.newChart()
    .setChartType(Charts.ChartType.PIE)
    .addRange(sh.getRange('J10:K19'))
    .setNumHeaders(1)
    .setHiddenDimensionStrategy(Charts.ChartHiddenDimensionStrategy.SHOW_BOTH)
    .setPosition(9, 5, 6, 6), opsi.donat).build());

  // Penanda versi ditulis PALING AKHIR: bila pembangunan terputus (timeout dsb.), refresh berikutnya
  // melihat penanda lama lalu membangun ulang — bukan terjebak tanpa grafik.
  sh.getRange('J30').setValue(DASH_VERSI);
  sh.hideColumns(10, 3);   // J–L: data bantu (grafik tetap tampil berkat SHOW_BOTH)
  sh.setFrozenRows(2);
  SpreadsheetApp.flush();
  Logger.log('Dashboard (' + DASH_VERSI + ') selesai dibangun.');
}

/**
 * Opsi kedua grafik (dipakai buildDashboard). chartArea left/top WAJIB eksplisit: grafik di Sheets
 * menganggap left/top kosong = 0 (bukan 'auto' seperti Google Charts) → label sumbu-Y terpotong &
 * legenda donat terjepit jadi huruf per baris (terukur dari screenshot, Nov 2026).
 * Ukuran 460×284 px pas di panel 4 kolom × 118 px, baris 9–22.
 */
function dashOpsiGrafik() {
  return {
    tren: {
      colors: [DASH.hijau, DASH.merah],
      legend: { position: 'bottom', textStyle: { fontSize: 10, color: DASH.muted } },
      vAxis: { format: 'short', minValue: 0, textStyle: { fontSize: 10, color: DASH.muted }, gridlines: { color: DASH.line } },
      hAxis: { textStyle: { fontSize: 10, color: DASH.ink } },
      backgroundColor: '#FFFFFF',
      chartArea: { left: '15%', top: '6%', width: '81%', height: '68%' },   // kiri 69 px utk label Rp
      width: 460, height: 284
    },
    donat: {
      pieHole: 0.55,
      pieSliceText: 'percentage',
      legend: { position: 'right', alignment: 'center', textStyle: { fontSize: 11, color: DASH.ink } },
      colors: DASH_WARNA_DONAT,
      backgroundColor: '#FFFFFF',
      // diameter = min(lebar, tinggi) → area persegi ±256 px; sisa ±188 px utk legenda.
      chartArea: { left: '3%', top: '5%', width: '56%', height: '90%' },
      width: 460, height: 284
    }
  };
}

// ======================================================================
// Isi angka (dipanggil tiap transaksi) — sesedikit mungkin panggilan API
// ======================================================================

function writeDashboardData(sh) {
  var d = dataDashboard();
  var tz = Session.getScriptTimeZone();

  sh.getRange('A2').setValue('   Ringkasan ' + MONTH_ID[d.b.m - 1] + ' ' + d.b.y +
    '   ·   🕒 diperbarui ' + Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy HH:mm'));

  // Kartu KPI
  var saldoBulan = d.masuk - d.keluar;
  sh.getRange('A5').setValue(d.masuk);
  sh.getRange('C5').setValue(d.keluar);
  sh.getRange('E5').setValue(saldoBulan).setFontColor(saldoBulan < 0 ? DASH.merah : DASH.biru);
  sh.getRange('G5').setValue(d.saldoTotal).setFontColor(d.saldoTotal < 0 ? DASH.merah : DASH.ungu);
  sh.getRange('A6').setValue(d.nMasuk ? d.nMasuk + ' transaksi masuk bulan ini' : 'belum ada pemasukan bulan ini');
  var kpi = kpiPengeluaranText(d);
  sh.getRange('C6').setValue(kpi.teks).setFontColor(kpi.warna);
  var e6;
  if (d.masuk > 0) {
    e6 = saldoBulan >= 0 ? '🐷 sisa ' + Math.round(saldoBulan / d.masuk * 100) + '% dari pemasukan'
      : '⚠️ defisit Rp' + formatRupiah(d.keluar - d.masuk);
  } else {
    e6 = d.keluar > 0 ? d.nTx + ' transaksi · belum ada pemasukan' : d.nTx + ' transaksi bulan ini';
  }
  sh.getRange('E6').setValue(e6);
  sh.getRange('G6').setValue(d.adaArsip ? 'semua tahun · termasuk arsip' : 'akumulasi semua transaksi');

  // Grafik tren (J2:L7) & donat (J11:K19). Label bulan dipaksa teks (pulihkan sendiri bila format hilang).
  sh.getRange('J2:J7').setNumberFormat('@');
  sh.getRange(2, 10, 6, 3).setValues(d.tren);
  sh.getRange('J11:K19').clearContent();
  var donat = d.donat.length ? d.donat : [['Belum ada pengeluaran', 0]];
  sh.getRange(11, 10, donat.length, 2).setValues(donat);

  // Budget (A26:D33)
  sh.getRange('A26:D33').clearContent();
  if (d.budget.length) {
    sh.getRange(26, 1, d.budget.length, 4).setValues(d.budget.map(function (x) { return [x.kat, x.pakai, x.batas, x.bar]; }));
    sh.getRange(26, 4, d.budget.length, 1).setFontColors(d.budget.map(function (x) {
      return [x.pct >= 100 ? DASH.merah : (x.pct >= 80 ? DASH.kuningTeks : DASH.hijauTeks)];
    }));
  } else {
    sh.getRange('A26').setValue('Belum ada budget — set lewat bot: /budget makan 1000000');
  }

  // Pengeluaran teratas (E26:H33)
  sh.getRange('E26:H33').clearContent();
  if (d.top.length) sh.getRange(26, 5, d.top.length, 4).setValues(d.top);
  else sh.getRange('F26').setValue('Belum ada pengeluaran bulan ini');

  // Transaksi terakhir (A37:F46; F = sel kiri-atas gabungan F:H)
  sh.getRange('A37:H46').clearContent();
  if (d.recent.length) {
    sh.getRange(37, 1, d.recent.length, 6).setValues(d.recent);
    sh.getRange(37, 3, d.recent.length, 1).setFontColors(d.recent.map(function (x) {
      return [/^💰/.test(x[2]) ? DASH.hijauTeks : (/^💸/.test(x[2]) ? DASH.merah : DASH.kuningTeks)];
    }));
  } else {
    sh.getRange('A37').setValue('Belum ada transaksi');
  }

  // Insight (A49:A52)
  sh.getRange(49, 1, 4, 1).setValues(d.insight.map(function (s) { return ['   ' + s]; }));
}

/** Satu kali pindai Keuangan (+ arsip bila perlu) -> semua angka dashboard. */
function dataDashboard() {
  var now = new Date();
  var b = { y: now.getFullYear(), m: now.getMonth() + 1 };
  var prev = (b.m === 1) ? { y: b.y - 1, m: 12 } : { y: b.y, m: b.m - 1 };
  var kunci = function (y, m) { return y * 100 + m; };

  // Jendela tren: 5 bulan lalu .. bulan ini
  var bulan6 = [], tren = {};
  for (var i = 5; i >= 0; i--) {
    var t = new Date(b.y, b.m - 1 - i, 1);
    var x = { y: t.getFullYear(), m: t.getMonth() + 1 };
    bulan6.push(x); tren[kunci(x.y, x.m)] = [0, 0];
  }

  // Pembanding ADIL: pengeluaran bulan lalu pada PERIODE YANG SAMA (tgl 1..hari ini), bukan sebulan penuh.
  // Bila hari ini >= panjang bulan lalu (mis. 31 Mar vs Feb), pakai bulan lalu seluruhnya.
  var hariIni = now.getDate(), lenPrev = new Date(prev.y, prev.m, 0).getDate();
  var prevPenuh = hariIni >= lenPrev;

  var masuk = 0, keluar = 0, keluarPrev = 0, keluarPrevSd = 0, nTx = 0, nMasuk = 0, net = 0;
  var perKat = {}, terbesar = null, recent = [];

  function catatTren(dt, tipe, nom) {
    var k = kunci(dt.getFullYear(), dt.getMonth() + 1);
    if (tren[k]) { if (tipe === 'masuk') tren[k][0] += nom; else if (tipe === 'keluar') tren[k][1] += nom; }
    if (dt.getFullYear() === prev.y && dt.getMonth() + 1 === prev.m && tipe === 'keluar') {
      keluarPrev += nom;
      if (prevPenuh || dt.getDate() <= hariIni) keluarPrevSd += nom;
    }
  }

  var rows = readAll('Keuangan');
  for (var r = 1; r < rows.length; r++) {
    var raw = rows[r][0];
    var tipe = String(rows[r][1] || '').toLowerCase().trim();
    var nom = Number(rows[r][2]) || 0;
    if (tipe === 'masuk') net += nom; else if (tipe === 'keluar') net -= nom;
    var dt = (raw instanceof Date) ? raw : new Date(raw);
    if (!raw || isNaN(dt.getTime())) continue;
    catatTren(dt, tipe, nom);
    var ket = String(rows[r][4] || '').split(' | ')[0];
    var kat = String(rows[r][3] || 'lainnya').toLowerCase().trim() || 'lainnya';
    if (dt.getFullYear() === b.y && dt.getMonth() + 1 === b.m) {
      nTx++;
      if (tipe === 'masuk') { masuk += nom; nMasuk++; }
      else if (tipe === 'keluar') {
        keluar += nom;
        perKat[kat] = (perKat[kat] || 0) + nom;
        if (!terbesar || nom > terbesar.nom) terbesar = { nom: nom, kat: kat, ket: ket, dt: dt };
      }
    }
    // Tipe tak sah (diketik manual) ditandai ⚠️ — baris itu memang tak ikut dihitung di total.
    var labelTipe = tipe === 'masuk' ? '💰 masuk' : (tipe === 'keluar' ? '💸 keluar' : '⚠️ ' + (tipe || 'tipe kosong'));
    recent.push([dt, String(rows[r][6] || ''), labelTipe, nom, kat, ket]);
  }

  // Bulan dari tahun lalu yang sudah diarsipkan ikut masuk tren & pembanding.
  var tahunArsip = {};
  bulan6.concat([prev]).forEach(function (x) { if (x.y < b.y) tahunArsip[x.y] = true; });
  Object.keys(tahunArsip).forEach(function (y) {
    var a = ss().getSheetByName('Arsip ' + y);
    if (!a || a.getLastRow() < 2) return;
    a.getRange(2, 1, a.getLastRow() - 1, 4).getValues().forEach(function (row) { // bulan, waktu, tipe, nominal
      var w = (row[1] instanceof Date) ? row[1] : new Date(row[1]);
      if (!isNaN(w.getTime())) catatTren(w, String(row[2]).toLowerCase().trim(), Number(row[3]) || 0);
    });
  });

  recent.sort(function (p, q) { return q[0].getTime() - p[0].getTime(); });

  var urutKat = Object.keys(perKat).map(function (k) { return [k, perKat[k]]; })
    .sort(function (p, q) { return q[1] - p[1]; });
  var donat = urutKat.slice(0, 8).map(function (p) { return [p[0], p[1]]; });
  if (urutKat.length > 8) {
    donat.push(['lain-lain', urutKat.slice(8).reduce(function (s, p) { return s + p[1]; }, 0)]);
  }
  var top = urutKat.slice(0, 8).map(function (p, idx) {
    var pct = keluar ? Math.round(p[1] / keluar * 100) : 0;
    return [MEDALI[idx], p[0], p[1], dashBar(pct, 8) + ' ' + pct + '%'];
  });

  // Budget (sheet Budget: kategori, batas) — dibaca saja, tak dibuat.
  var budget = [];
  var bs = ss().getSheetByName('Budget');
  if (bs && bs.getLastRow() > 1) {
    bs.getRange(2, 1, bs.getLastRow() - 1, 2).getValues().forEach(function (row) {
      var k = String(row[0] || '').toLowerCase().trim(), batas = Number(row[1]) || 0;
      if (!k || batas <= 0) return;
      // floor (kali dulu agar bebas galat pecahan): merah 100% hanya bila BENAR-BENAR terlampaui,
      // sama dgn ambang peringatan bot (cekBudget).
      var pakai = perKat[k] || 0, pct = Math.floor(pakai * 100 / batas);
      budget.push({ kat: k, pakai: pakai, batas: batas, pct: pct, bar: dashBar(pct, 10) + ' ' + pct + '%' });
    });
    budget.sort(function (p, q) { return q.pct - p.pct; });
    budget = budget.slice(0, 8);
  }

  return {
    b: b, masuk: masuk, keluar: keluar, keluarPrev: keluarPrev, keluarPrevSd: keluarPrevSd, nTx: nTx, nMasuk: nMasuk,
    labelPrev: prevPenuh ? BULAN_PENDEK[prev.m - 1] : (hariIni === 1 ? '1 ' : '1–' + hariIni + ' ') + BULAN_PENDEK[prev.m - 1],
    saldoTotal: net + saldoArsip(), adaArsip: saldoArsip() !== 0,
    tren: bulan6.map(function (x) { var v = tren[kunci(x.y, x.m)]; return [BULAN_PENDEK[x.m - 1] + ' ' + String(x.y).slice(2), v[0], v[1]]; }),
    donat: donat, top: top, budget: budget, recent: recent.slice(0, 10),
    insight: dashInsight(b, now, masuk, keluar, urutKat, terbesar)
  };
}

/**
 * Subjudul kartu PENGELUARAN: bandingkan dgn bulan lalu pada periode yang sama (d.labelPrev,
 * mis. "1–16 Okt"). Kembalikan { teks, warna }. Teks tak pernah diawali "=" (dibaca rumus oleh Sheets).
 */
function kpiPengeluaranText(d) {
  if (!d.keluar) return { teks: '— belum ada pengeluaran bulan ini', warna: DASH.muted };
  if (d.keluarPrevSd) {
    var t = deltaText(d.keluar, d.keluarPrevSd);
    return { teks: t + ' vs ' + d.labelPrev, warna: /▲/.test(t) ? DASH.merah : (/▼/.test(t) ? DASH.hijauTeks : DASH.muted) };
  }
  if (d.keluarPrev) return { teks: 'pembanding ' + d.labelPrev + ': Rp0', warna: DASH.muted };
  return { teks: 'bulan lalu belum ada data', warna: DASH.muted };
}

/** 4 baris insight otomatis yang mudah dicerna. */
function dashInsight(b, now, masuk, keluar, urutKat, terbesar) {
  if (!keluar && !masuk) {
    return ['📝 Belum ada transaksi bulan ini — mulai catat lewat bot, mis. "kopi 25rb" atau kirim foto struk.',
      '📊 Dashboard ini otomatis diperbarui setiap kali Anda mencatat.', '🎯 Atur batas belanja: /budget makan 1000000', '💡 Lihat ringkasan cepat kapan saja: /saldo atau /rekap'];
  }
  var tz = Session.getScriptTimeZone();
  var hariIni = now.getDate(), jmlHari = new Date(b.y, b.m, 0).getDate();
  var rata = keluar / Math.max(1, hariIni);
  var out = [];
  var baris1 = '📅 Rata-rata pengeluaran harian Rp' + formatRupiah(Math.round(rata));
  // Proyeksi hanya bila datanya cukup (>= 7 hari) & bulan belum habis. Satu transaksi dominan
  // (mis. sewa/cicilan > 40% total) tidak dikalikan ke sisa bulan — dihitung sekali saja.
  if (keluar > 0 && hariIni >= 7 && hariIni < jmlHari) {
    var satuKali = (terbesar && terbesar.nom > keluar * 0.4) ? terbesar.nom : 0;
    var proyeksi = keluar + (keluar - satuKali) / hariIni * (jmlHari - hariIni);
    baris1 += ' · proyeksi akhir bulan ±Rp' + formatRupiah(Math.round(proyeksi / 1000) * 1000) + ' (bila laju sama)';
  }
  out.push(baris1);
  if (urutKat.length) {
    out.push('🏷️ Kategori terbesar: ' + urutKat[0][0] + ' — ' + Math.round(urutKat[0][1] / keluar * 100) +
      '% dari pengeluaran (Rp' + formatRupiah(urutKat[0][1]) + ')');
  } else {
    out.push('🏷️ Belum ada pengeluaran bulan ini.');
  }
  if (terbesar) {
    out.push('💥 Transaksi terbesar: Rp' + formatRupiah(terbesar.nom) + ' · ' + terbesar.kat +
      (terbesar.ket ? ' · ' + String(terbesar.ket).slice(0, 40) : '') + ' (' + Utilities.formatDate(terbesar.dt, tz, 'dd/MM') + ')');
  } else {
    out.push('💰 Pemasukan bulan ini Rp' + formatRupiah(masuk) + ' — belum ada pengeluaran tercatat.');
  }
  if (masuk > 0) {
    var sisa = Math.round((masuk - keluar) / masuk * 100);
    out.push(keluar <= masuk   // tanda PERSIS (bukan persen bulat: defisit 0,4% jadi "-0")
      ? '🐷 Sisa pemasukan bulan ini ' + sisa + '%' + (sisa >= 20 ? ' — mantap, pertahankan!' : ' — coba sisihkan minimal 20%.')
      : '⚠️ Pengeluaran ' + Math.round(keluar / masuk * 100) + '% dari pemasukan — defisit Rp' + formatRupiah(keluar - masuk) + '.');
  } else {
    out.push('🐷 Belum ada pemasukan tercatat bulan ini.');
  }
  return out;
}

/** Bar teks: dashBar(62, 10) -> "██████░░░░". */
function dashBar(pct, n) {
  var f = Math.max(0, Math.min(n, Math.round(pct / 100 * n)));
  return new Array(f + 1).join('█') + new Array(n - f + 1).join('░');
}

/**
 * Pindai Keuangan untuk bulan b & pembanding prev. DIPAKAI JUGA oleh /saldo & ringkasan harian
 * (Rekap.gs, Scheduler.gs) — bentuk keluaran jangan diubah.
 */
function scanKeuangan(b, prev) {
  var rows = readAll('Keuangan');
  var masuk = 0, keluar = 0, keluarPrev = 0, nTx = 0, saldoTotal = 0, perKat = {};
  var all = [];
  for (var i = 1; i < rows.length; i++) {
    var raw = rows[i][0];
    var tipe = String(rows[i][1] || '').toLowerCase().trim();
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
    saldoTotal: saldoTotal + saldoArsip(), perKat: perKatSorted, recent: all.slice(0, 8)
  };
}

/** Teks perbandingan pengeluaran vs bulan lalu. */
function deltaText(cur, prev) {
  if (!prev) return cur > 0 ? '▲ baru bulan ini' : '— belum ada pembanding';
  var pct = Math.round((cur - prev) / prev * 100);
  if (pct > 0) return '▲ ' + pct + '% lebih banyak';
  if (pct < 0) return '▼ ' + Math.abs(pct) + '% lebih hemat';
  return '≈ sama dengan bulan lalu'; // JANGAN diawali "=" — Sheets akan membacanya sebagai rumus (#ERROR!)
}

/**
 * Refresh aman dipanggil dari bot: no-op bila Dashboard belum ada; tak melempar.
 * Bila tata letak masih versi lama -> bangun ulang (agar angka tak ditulis ke sel yang salah).
 */
function refreshDashboard() {
  try {
    var sh = ss().getSheetByName('Dashboard');
    if (!sh) return;
    if (String(sh.getRange('J30').getValue()) !== DASH_VERSI) { buildDashboard(); return; }
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

// ---------- helper gaya ----------

function dashSeksi(sh, a1, teks, warna, latar) {
  sh.getRange(a1).merge().setValue('  ' + teks).setBackground(latar).setFontColor(warna)
    .setFontWeight('bold').setFontSize(11).setHorizontalAlignment('left');
}

function dashPanel(sh, a1) {
  sh.getRange(a1).setBackground(DASH.card)
    .setBorder(true, true, true, true, null, null, DASH.line, SpreadsheetApp.BorderStyle.SOLID);
}

function dashKepalaTabel(sh, a1, judul) {
  sh.getRange(a1).setValues([judul]).setFontWeight('bold').setFontColor(DASH.muted).setFontSize(9)
    .setHorizontalAlignment('center').setBackground(DASH.card)
    .setBorder(null, null, true, null, null, null, DASH.line, SpreadsheetApp.BorderStyle.SOLID);
}
