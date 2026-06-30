/**
 * Rekap.gs — ringkasan keuangan (/rekap) & hapus entri (/hapus).
 * Keuangan: A=waktu B=tipe C=nominal D=kategori E=keterangan F=sumber.
 * MONTH_ID dipakai bersama dari Dashboard.gs.
 */

/** Urai spec bulan. '' / undefined -> bulan berjalan. 'YYYY-MM' -> bulan itu. null bila salah. */
function parseBulan(spec) {
  var now = new Date();
  if (!spec) return { y: now.getFullYear(), m: now.getMonth() + 1 };
  var s = String(spec).trim();
  var mt = s.match(/^(\d{4})-(\d{2})$/);
  if (!mt) return null;
  var y = parseInt(mt[1], 10), m = parseInt(mt[2], 10);
  if (m < 1 || m > 12) return null;
  return { y: y, m: m };
}

/** Label "Juni 2026" dari {y,m}. */
function labelBulan(b) { return MONTH_ID[b.m - 1] + ' ' + b.y; }

/** Apakah tanggal d berada di bulan b. d boleh Date atau string. */
function inBulan(d, b) {
  var dt = (d instanceof Date) ? d : new Date(d);
  if (isNaN(dt.getTime())) return false;
  return dt.getFullYear() === b.y && (dt.getMonth() + 1) === b.m;
}

// ---------- Arsip per tahun ----------

var ARSIP_PREFIX = 'Arsip ';

/** Net saldo dari semua transaksi yang sudah diarsipkan (disimpan di Script Property). */
function saldoArsip() {
  return Number(cfgOptional('ARSIP_SALDO', '0')) || 0;
}

/** Net (masuk-keluar) dari sheet Keuangan aktif. */
function netKeuangan() {
  var k = readAll('Keuangan'), net = 0;
  for (var i = 1; i < k.length; i++) {
    var t = String(k[i][1]).toLowerCase(), n = Number(k[i][2]) || 0;
    if (t === 'masuk') net += n; else if (t === 'keluar') net -= n;
  }
  return net;
}

/** Saldo total semua waktu = arsip + Keuangan aktif. */
function saldoSemua() { return saldoArsip() + netKeuangan(); }

/** Baris [waktu,tipe,nominal,kategori,ket,sumber] tahun tsb, dari Keuangan + Arsip-tahun. */
function rowsKeuanganTahun(year) {
  var out = [];
  var k = readAll('Keuangan');
  for (var i = 1; i < k.length; i++) {
    var dt = (k[i][0] instanceof Date) ? k[i][0] : new Date(k[i][0]);
    if (!isNaN(dt.getTime()) && dt.getFullYear() === year) out.push(k[i]);
  }
  var a = ss().getSheetByName(ARSIP_PREFIX + year);
  if (a && a.getLastRow() > 1) {
    var ar = a.getRange(2, 1, a.getLastRow() - 1, 7).getValues(); // bulan,waktu,tipe,nominal,kategori,ket,sumber
    for (var j = 0; j < ar.length; j++) out.push([ar[j][1], ar[j][2], ar[j][3], ar[j][4], ar[j][5], ar[j][6]]);
  }
  return out;
}

/**
 * Pindahkan transaksi TAHUN LAMPAU (year < tahun ini) dari Keuangan ke sheet "Arsip <tahun>".
 * Jalankan dari editor (atau lewat trigger tahunan). Aman diulang. Saldo total tetap akurat.
 */
function arsipKeuangan() {
  var book = ss();
  var sh = sheet('Keuangan');
  var data = sh.getDataRange().getValues();
  var nowYear = (new Date()).getFullYear();
  var tz = Session.getScriptTimeZone();

  var perTahun = {}, hapusIdx = [], netDiarsip = 0;
  for (var i = 1; i < data.length; i++) {
    var dt = (data[i][0] instanceof Date) ? data[i][0] : new Date(data[i][0]);
    if (isNaN(dt.getTime())) continue;
    var y = dt.getFullYear();
    if (y >= nowYear) continue; // hanya tahun yang sudah lewat
    var t = String(data[i][1]).toLowerCase(), n = Number(data[i][2]) || 0;
    if (t === 'masuk') netDiarsip += n; else if (t === 'keluar') netDiarsip -= n;
    (perTahun[y] = perTahun[y] || []).push([Utilities.formatDate(dt, tz, 'yyyy-MM'),
      data[i][0], data[i][1], data[i][2], data[i][3], data[i][4], data[i][5]]);
    hapusIdx.push(i + 1);
  }

  var tahun = Object.keys(perTahun);
  if (!tahun.length) { Logger.log('Tidak ada transaksi tahun lampau untuk diarsipkan.'); return; }

  tahun.forEach(function (y) {
    var a = book.getSheetByName(ARSIP_PREFIX + y) || book.insertSheet(ARSIP_PREFIX + y);
    if (a.getLastRow() === 0) {
      a.appendRow(['bulan', 'waktu', 'tipe', 'nominal', 'kategori', 'keterangan', 'sumber']);
      a.setFrozenRows(1);
    }
    a.getRange(a.getLastRow() + 1, 1, perTahun[y].length, 7).setValues(perTahun[y]);
    a.getRange(2, 2, a.getLastRow() - 1, 1).setNumberFormat('dd/MM/yyyy HH:mm');
    a.getRange(2, 4, a.getLastRow() - 1, 1).setNumberFormat('"Rp"#,##0');
  });

  for (var j = hapusIdx.length - 1; j >= 0; j--) sh.deleteRow(hapusIdx[j]);
  PropertiesService.getScriptProperties().setProperty('ARSIP_SALDO', String(saldoArsip() + netDiarsip));

  logEvent('INFO', 'arsip_done', tahun.join(',') + ' (' + hapusIdx.length + ' baris)');
  Logger.log('Arsip selesai: ' + hapusIdx.length + ' transaksi -> ' +
    tahun.map(function (y) { return ARSIP_PREFIX + y; }).join(', ') + '.');
  try { refreshDashboard(); } catch (e) {}
}

/** Pasang trigger arsip otomatis tiap tahun (5 Januari). Jalankan sekali dari editor. */
function installArsipTrigger() {
  removeTriggers(['arsipKeuangan']);
  ScriptApp.newTrigger('arsipKeuangan').timeBased().onMonthDay(5).atHour(1).create();
  Logger.log('Trigger arsip terpasang (tiap tgl 5, mengarsip tahun lampau bila ada).');
}

// ---------- Rekap ----------

/**
 * /rekap            → bulan berjalan
 * /rekap YYYY-MM    → bulan tertentu (otomatis baca arsip bila tahunnya sudah diarsip)
 * /rekap YYYY       → ringkasan satu tahun (per bulan)
 */
function cmdRekap(args, chatId) {
  var spec = String(args[0] || '').trim();
  if (/^\d{4}$/.test(spec)) { cmdRekapTahun(parseInt(spec, 10), chatId); return; }

  var b = parseBulan(spec);
  if (!b) { sendMessage(chatId, '❌ Format salah. Pakai /rekap, /rekap YYYY-MM (mis. 2026-06), atau /rekap YYYY (mis. 2025).'); return; }

  var rows = rowsKeuanganTahun(b.y);
  var masuk = 0, keluar = 0, nTx = 0, perKat = {};
  for (var i = 0; i < rows.length; i++) {
    if (!inBulan(rows[i][0], b)) continue;
    var tipe = String(rows[i][1]).toLowerCase(), nom = Number(rows[i][2]) || 0;
    nTx++;
    if (tipe === 'masuk') masuk += nom;
    else if (tipe === 'keluar') {
      keluar += nom;
      var kat = String(rows[i][3] || 'lainnya').toLowerCase();
      perKat[kat] = (perKat[kat] || 0) + nom;
    }
  }

  if (nTx === 0) { sendMessage(chatId, '📊 <b>Rekap ' + htmlEsc(labelBulan(b)) + '</b>\nBelum ada transaksi di bulan ini.', { html: true }); return; }

  var top = Object.keys(perKat).map(function (k) { return [k, perKat[k]]; })
    .sort(function (a, c) { return c[1] - a[1]; }).slice(0, 5);
  var lines = [
    '📊 <b>Rekap ' + htmlEsc(labelBulan(b)) + '</b>',
    '━━━━━━━━━━━━━━',
    '💰 Pemasukan  : <b>Rp' + formatRupiah(masuk) + '</b>',
    '💸 Pengeluaran: <b>Rp' + formatRupiah(keluar) + '</b>',
    '🟦 Saldo bulan: <b>Rp' + formatRupiah(masuk - keluar) + '</b>',
    '<i>' + nTx + ' transaksi</i>'
  ];
  if (top.length) {
    lines.push('', '<b>🏆 Pengeluaran teratas</b>');
    top.forEach(function (t, i) { lines.push((i + 1) + '. ' + htmlEsc(t[0]) + ' — <b>Rp' + formatRupiah(t[1]) + '</b>'); });
  }
  lines.push('━━━━━━━━━━━━━━', '💼 Saldo total: <b>Rp' + formatRupiah(saldoSemua()) + '</b>');
  sendMessage(chatId, lines.join('\n'), { html: true });
}

/** Ringkasan satu tahun: per bulan + total. Baca Keuangan + Arsip-tahun. */
function cmdRekapTahun(year, chatId) {
  var rows = rowsKeuanganTahun(year);
  var perBulan = {}, totMasuk = 0, totKeluar = 0, nTx = 0;
  for (var i = 0; i < rows.length; i++) {
    var dt = (rows[i][0] instanceof Date) ? rows[i][0] : new Date(rows[i][0]);
    if (isNaN(dt.getTime()) || dt.getFullYear() !== year) continue;
    var m = dt.getMonth() + 1, tipe = String(rows[i][1]).toLowerCase(), nom = Number(rows[i][2]) || 0;
    if (!perBulan[m]) perBulan[m] = [0, 0];
    nTx++;
    if (tipe === 'masuk') { perBulan[m][0] += nom; totMasuk += nom; }
    else if (tipe === 'keluar') { perBulan[m][1] += nom; totKeluar += nom; }
  }
  if (nTx === 0) { sendMessage(chatId, '📅 <b>Rekap ' + year + '</b>\nBelum ada transaksi di tahun itu.', { html: true }); return; }

  var lines = ['📅 <b>Rekap Tahun ' + year + '</b>', '<i>' + nTx + ' transaksi</i>', '━━━━━━━━━━━━━━'];
  for (var mo = 1; mo <= 12; mo++) {
    if (!perBulan[mo]) continue;
    lines.push('<b>' + MONTH_ID[mo - 1] + '</b>  💰+Rp' + formatRupiah(perBulan[mo][0]) + '  💸-Rp' + formatRupiah(perBulan[mo][1]));
  }
  lines.push('━━━━━━━━━━━━━━',
    '💰 Total masuk : <b>Rp' + formatRupiah(totMasuk) + '</b>',
    '💸 Total keluar: <b>Rp' + formatRupiah(totKeluar) + '</b>',
    '🟦 Selisih     : <b>Rp' + formatRupiah(totMasuk - totKeluar) + '</b>');
  sendMessage(chatId, lines.join('\n'), { html: true });
}

/** /saldo → saldo total semua waktu + saldo bulan berjalan. */
function cmdSaldo(chatId) {
  var now = new Date();
  var b = { y: now.getFullYear(), m: now.getMonth() + 1 };
  var prev = (b.m === 1) ? { y: b.y - 1, m: 12 } : { y: b.y, m: b.m - 1 };
  var d = scanKeuangan(b, prev);
  sendMessage(chatId,
    '👛 <b>Saldo</b>\n' +
    '━━━━━━━━━━━━━━\n' +
    '💼 Total: <b>Rp' + formatRupiah(d.saldoTotal) + '</b>\n' +
    '🟦 Bulan ini: <b>Rp' + formatRupiah(d.masuk - d.keluar) + '</b>\n' +
    '   💰 +Rp' + formatRupiah(d.masuk) + '  ·  💸 -Rp' + formatRupiah(d.keluar),
    { html: true });
}

/** /catatan [kata] → 5 catatan terakhir, atau yang memuat kata kunci. */
function cmdCatatan(args, chatId) {
  var q = args.join(' ').toLowerCase().trim();
  var tz = Session.getScriptTimeZone();
  var rows = readAll('Catatan'); // timestamp, teks
  var items = [];
  for (var i = 1; i < rows.length; i++) {
    var teks = String(rows[i][1]);
    if (q && teks.toLowerCase().indexOf(q) === -1) continue;
    items.push({ t: rows[i][0], teks: teks });
  }
  if (!items.length) { sendMessage(chatId, q ? 'Tidak ada catatan memuat "' + htmlEsc(q) + '".' : 'Belum ada catatan.', { html: true }); return; }
  var last = items.slice(-5).reverse();
  var out = [q ? '🔎 <b>Catatan memuat "' + htmlEsc(q) + '"</b>' : '🗒️ <b>Catatan terakhir</b>', '━━━━━━━━━━━━━━'];
  last.forEach(function (c) {
    var tgl = (c.t instanceof Date) ? Utilities.formatDate(c.t, tz, 'dd/MM HH:mm') : String(c.t);
    out.push('• <i>' + htmlEsc(tgl) + '</i>  ' + htmlEsc(c.teks));
  });
  if (!q && items.length > 5) out.push('', '<i>5 terbaru dari ' + items.length + ' catatan</i>');
  sendMessage(chatId, out.join('\n'), { html: true });
}

/** /agenda → acara mendatang (tanggal ≥ hari ini) + jadwal rutin. */
function cmdAgenda(chatId) {
  var tz = Session.getScriptTimeZone();
  var todayStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var rows = readAll('Jadwal'); // id, label, waktu, hari, aktif, terkirim_pada
  var acara = [], rutin = [];
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][4]).toLowerCase() !== 'y') continue;
    var jam = jamStr(rows[i][2], tz);
    var hd = toDateStr(rows[i][3], tz);
    if (hd) { if (hd >= todayStr) acara.push({ tgl: hd, jam: jam, label: rows[i][1], id: rows[i][0] }); }
    else rutin.push({ hari: String(rows[i][3]), jam: jam, label: rows[i][1] });
  }
  acara.sort(function (a, b) { return (a.tgl + a.jam) < (b.tgl + b.jam) ? -1 : 1; });
  var out = ['🗓️ <b>Agenda</b>'];
  if (acara.length) { out.push('━━━━━━━━━━━━━━', '<b>Acara mendatang</b>'); acara.forEach(function (a) { out.push('• <b>' + htmlEsc(a.tgl) + '</b> ' + htmlEsc(a.jam) + ' — ' + htmlEsc(a.label) + ' <i>(' + htmlEsc(a.id) + ')</i>'); }); }
  if (rutin.length) { out.push('━━━━━━━━━━━━━━', '<b>Rutin</b>'); rutin.forEach(function (r) { out.push('• ' + htmlEsc(r.hari) + ' ' + htmlEsc(r.jam) + ' — ' + htmlEsc(r.label)); }); }
  if (!acara.length && !rutin.length) out.push('', '<i>Belum ada jadwal/acara aktif.</i>');
  sendMessage(chatId, out.join('\n'), { html: true });
}

/** /status → cek kesehatan: properti, trigger, webhook. */
function cmdStatus(chatId) {
  var out = ['🩺 <b>Status Sistem</b>', '━━━━━━━━━━━━━━', '<b>Konfigurasi</b>'];
  ['TELEGRAM_BOT_TOKEN', 'ALLOWED_CHAT_ID', 'SPREADSHEET_ID', 'GEMINI_API_KEY'].forEach(function (k) {
    out.push((cfgOptional(k, '') ? '✅' : '❌') + ' ' + k);
  });
  out.push('', '<b>Trigger</b>');
  var trigs = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  ['reminderTick', 'resetJadwalHarian', 'sendRingkasanHarian', 'sendRingkasanMingguan', 'refreshDashboard', 'arsipKeuangan'].forEach(function (fn) {
    out.push((trigs.indexOf(fn) >= 0 ? '✅' : '⬜') + ' ' + fn);
  });
  try {
    var info = tgCall('getWebhookInfo', {});
    if (info && info.result) {
      out.push('', '<b>Webhook</b>');
      out.push('🔗 ' + htmlEsc(info.result.url || '(kosong)'));
      out.push('📥 pending: ' + (info.result.pending_update_count || 0));
      if (info.result.last_error_message) out.push('⚠️ ' + htmlEsc(info.result.last_error_message));
    }
  } catch (e) { out.push('', '⚠️ gagal cek webhook'); }
  sendMessage(chatId, out.join('\n'), { html: true, preview: false });
}

/**
 * /daftar [semua] → tampilkan tugas yang masih open (default) + ID-nya.
 * 'semua' = ikut tampilkan yang sudah done.
 */
function cmdDaftar(args, chatId) {
  var ikutSelesai = String(args[0] || '').toLowerCase() === 'semua';
  var rows = readAll('Tugas');
  var tz = Session.getScriptTimeZone();
  var open = [], done = [];

  for (var i = 1; i < rows.length; i++) {
    var id = rows[i][0], teks = rows[i][1], due = rows[i][2], status = String(rows[i][3]).toLowerCase();
    var dueStr = '';
    if (due) {
      dueStr = (due instanceof Date) ? Utilities.formatDate(due, tz, 'dd/MM/yyyy') : String(due);
    }
    var line = '<b>' + htmlEsc(id) + '</b> — ' + htmlEsc(teks) + (dueStr ? ' <i>(tenggat ' + htmlEsc(dueStr) + ')</i>' : '');
    if (status === 'done') done.push('✔️ ' + line);
    else open.push('• ' + line);
  }

  if (open.length === 0 && (!ikutSelesai || done.length === 0)) {
    sendMessage(chatId, '🎉 Tidak ada tugas yang belum selesai.');
    return;
  }

  var out = ['📋 <b>Tugas belum selesai (' + open.length + ')</b>', '━━━━━━━━━━━━━━'].concat(open.length ? open : ['<i>(kosong)</i>']);
  if (ikutSelesai && done.length) out = out.concat(['', '<b>Sudah selesai (' + done.length + ')</b>']).concat(done);
  else if (!ikutSelesai) out.push('', '<i>Ketik /daftar semua untuk lihat yang sudah selesai.</i>');
  sendMessage(chatId, out.join('\n'), { html: true });
}

/** Normalkan nama field agar fleksibel (sinonim → kanonik). */
function normField(raw) {
  var x = String(raw || '').toLowerCase().trim();
  if (['nominal', 'jumlah', 'nilai', 'harga'].indexOf(x) >= 0) return 'nominal';
  if (['kategori', 'kat'].indexOf(x) >= 0) return 'kategori';
  if (['keterangan', 'ket', 'note', 'catatan'].indexOf(x) >= 0) return 'keterangan';
  if (['tipe', 'jenis'].indexOf(x) >= 0) return 'tipe';
  if (['tanggal', 'tgl', 'waktu'].indexOf(x) >= 0) return 'tanggal';
  if (['teks', 'isi', 'judul'].indexOf(x) >= 0) return 'teks';
  if (['tenggat', 'due', 'deadline', 'jatuhtempo', 'jatuh_tempo'].indexOf(x) >= 0) return 'tenggat';
  if (['status'].indexOf(x) >= 0) return 'status';
  return x;
}

/**
 * /edit … → perbaiki entri yang salah input. Tiga bentuk:
 *   /edit terakhir <field> <nilai>     — transaksi keuangan terakhir
 *       field: nominal | kategori | keterangan | tipe | tanggal
 *   /edit tugas <id> <field> <nilai>   — field: teks | tenggat | status
 *   /edit catatan <teks baru>          — ganti isi catatan terakhir
 */
function cmdEdit(args, chatId) {
  var sub = String(args[0] || '').toLowerCase();
  if (sub === 'terakhir') { editKeuanganTerakhir(normField(args[1]), args.slice(2).join(' '), chatId); return; }
  if (sub === 'tugas')    { editTugas(args[1], normField(args[2]), args.slice(3).join(' '), chatId); return; }
  if (sub === 'catatan')  { editCatatanTerakhir(args.slice(1).join(' '), chatId); return; }

  sendMessage(chatId, [
    'Cara edit:',
    '/edit terakhir <field> <nilai>',
    '   field: nominal | kategori | keterangan | tipe | tanggal',
    '   mis. /edit terakhir nominal 30000',
    '/edit tugas <id> <field> <nilai>',
    '   field: teks | tenggat | status',
    '   mis. /edit tugas T-0001 tenggat 2026-06-30',
    '/edit catatan <teks baru>'
  ].join('\n'));
}

/** Edit transaksi keuangan paling akhir. */
function editKeuanganTerakhir(field, nilai, chatId) {
  var s = sheet('Keuangan');
  var last = s.getLastRow();
  if (last <= 1) { sendMessage(chatId, 'Belum ada transaksi untuk diedit.'); return; }
  if (!String(nilai).trim()) { sendMessage(chatId, '❌ Nilai baru kosong.'); return; }
  var row = s.getRange(last, 1, 1, 6).getValues()[0]; // [waktu,tipe,nominal,kategori,ket,sumber]

  switch (field) {
    case 'nominal':
      var n = parseNominal(nilai);
      if (n === null) { sendMessage(chatId, '❌ Nominal "' + nilai + '" tidak valid.'); return; }
      s.getRange(last, 3).setValue(n); row[2] = n; break;
    case 'kategori':
      var kat = String(nilai).toLowerCase().trim();
      if (!isKategoriValid(kat, String(row[1]).toLowerCase())) {
        sendMessage(chatId, '❌ Kategori "' + kat + '" tidak dikenal untuk ' + row[1] + '. ' + KATEGORI_HINT); return;
      }
      s.getRange(last, 4).setValue(kat); row[3] = kat; break;
    case 'keterangan':
      s.getRange(last, 5).setValue(nilai); row[4] = nilai; break;
    case 'tipe':
      var t = String(nilai).toLowerCase().trim();
      if (t !== 'masuk' && t !== 'keluar') { sendMessage(chatId, '❌ Tipe harus "masuk" atau "keluar".'); return; }
      s.getRange(last, 2).setValue(t); row[1] = t;
      if (!isKategoriValid(String(row[3]).toLowerCase(), t)) {
        sendMessage(chatId, '⚠️ Tipe diubah ke ' + t + ', tapi kategori "' + row[3] + '" tidak cocok. Ubah juga: /edit terakhir kategori <...>');
      }
      break;
    case 'tanggal':
      var d = resolveTanggal(nilai);
      if (!d) { sendMessage(chatId, '❌ Tanggal "' + nilai + '" tidak dikenali. Pakai kemarin / 2harilalu / YYYY-MM-DD.'); return; }
      s.getRange(last, 1).setValue(d); row[0] = d; break;
    default:
      sendMessage(chatId, 'Field bisa: nominal, kategori, keterangan, tipe, tanggal.'); return;
  }
  logEvent('INFO', 'keuangan_edited', field);
  sendMessage(chatId, '✏️ Diperbarui: ' + String(row[1]).toLowerCase() + ' Rp' + formatRupiah(Number(row[2]) || 0) +
    ' · ' + (row[3] || '-') + (row[4] ? ' · ' + row[4] : '') + tanggalSuffix(row[0]));
  refreshDashboard();
}

/** Edit satu tugas berdasarkan ID. */
function editTugas(idRaw, field, nilai, chatId) {
  if (!idRaw) { sendMessage(chatId, 'Format: /edit tugas <id> <field> <nilai>'); return; }
  var id = String(idRaw).toUpperCase();
  var s = sheet('Tugas');
  var rows = s.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).toUpperCase() !== id) continue;
    var r = i + 1;
    switch (field) {
      case 'teks':
        if (!String(nilai).trim()) { sendMessage(chatId, '❌ Teks kosong.'); return; }
        s.getRange(r, 2).setValue(nilai); break;
      case 'tenggat':
        var v = String(nilai).trim();
        if (v && !isValidDate(v)) { sendMessage(chatId, '❌ Tenggat harus YYYY-MM-DD (atau kosong untuk hapus tenggat).'); return; }
        s.getRange(r, 3).setValue(v); break;
      case 'status':
        var st = String(nilai).toLowerCase().trim();
        if (st !== 'open' && st !== 'done') { sendMessage(chatId, '❌ Status harus "open" atau "done".'); return; }
        s.getRange(r, 4).setValue(st); break;
      default:
        sendMessage(chatId, 'Field tugas bisa: teks, tenggat, status.'); return;
    }
    logEvent('INFO', 'tugas_edited', id + ' ' + field);
    sendMessage(chatId, '✏️ Tugas ' + id + ' diperbarui (' + field + ').');
    return;
  }
  sendMessage(chatId, '❌ Tugas ' + id + ' tidak ditemukan.');
}

/** Ganti isi catatan terakhir. */
function editCatatanTerakhir(teks, chatId) {
  if (!String(teks).trim()) { sendMessage(chatId, 'Format: /edit catatan <teks baru>'); return; }
  var s = sheet('Catatan');
  var last = s.getLastRow();
  if (last <= 1) { sendMessage(chatId, 'Belum ada catatan untuk diedit.'); return; }
  s.getRange(last, 2).setValue(teks);
  logEvent('INFO', 'catatan_edited', '');
  sendMessage(chatId, '✏️ Catatan terakhir diperbarui: ' + teks);
}

/**
 * /hapus … → hapus entri. Tiga bentuk:
 *   /hapus terakhir          — hapus transaksi keuangan terakhir
 *   /hapus tugas T-0001      — hapus satu tugas
 *   /hapus bulan YYYY-MM      — hapus SEMUA keuangan di bulan itu (perlu KONFIRM)
 */
function cmdHapus(args, chatId) {
  var sub = String(args[0] || '').toLowerCase();

  if (sub === 'terakhir') { hapusKeuanganTerakhir(chatId); return; }
  if (sub === 'tugas')    { hapusTugas(args[1], chatId); return; }
  if (sub === 'bulan')    { hapusKeuanganBulan(args[1], args[2], chatId); return; }

  sendMessage(chatId, [
    'Cara hapus:',
    '/hapus terakhir — transaksi keuangan terakhir',
    '/hapus tugas <id> — mis. /hapus tugas T-0001',
    '/hapus bulan YYYY-MM — semua keuangan 1 bulan (perlu konfirmasi)'
  ].join('\n'));
}

/** Hapus baris keuangan terakhir; tampilkan apa yang dihapus agar mudah diulang. */
function hapusKeuanganTerakhir(chatId) {
  var s = sheet('Keuangan');
  var last = s.getLastRow();
  if (last <= 1) { sendMessage(chatId, 'Belum ada transaksi untuk dihapus.'); return; }
  var r = s.getRange(last, 1, 1, 6).getValues()[0];
  s.deleteRow(last);
  logEvent('INFO', 'keuangan_deleted', 'baris ' + last);
  sendMessage(chatId, '🗑️ Dihapus: ' + String(r[1]).toLowerCase() + ' Rp' + formatRupiah(Number(r[2]) || 0) +
    ' · ' + (r[3] || '-') + (r[4] ? ' · ' + r[4] : ''));
  refreshDashboard();
}

/** Hapus satu tugas berdasarkan ID. */
function hapusTugas(idRaw, chatId) {
  if (!idRaw) { sendMessage(chatId, 'Format: /hapus tugas <id>, mis. /hapus tugas T-0001'); return; }
  var id = String(idRaw).toUpperCase();
  var s = sheet('Tugas');
  var rows = s.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).toUpperCase() === id) {
      var teks = rows[i][1];
      s.deleteRow(i + 1);
      logEvent('INFO', 'tugas_deleted', id);
      sendMessage(chatId, '🗑️ Tugas ' + id + ' dihapus: ' + teks);
      return;
    }
  }
  sendMessage(chatId, '❌ Tugas ' + id + ' tidak ditemukan.');
}

/** Hapus semua keuangan di satu bulan. Tahap 1: tampilkan ringkasan + minta KONFIRM. */
function hapusKeuanganBulan(specBulan, konfirm, chatId) {
  var b = parseBulan(specBulan);
  if (!b || !specBulan) { sendMessage(chatId, '❌ Format: /hapus bulan YYYY-MM, mis. /hapus bulan 2026-05.'); return; }

  var s = sheet('Keuangan');
  var rows = s.getDataRange().getValues();
  var targetRows = [];   // nomor baris (1-based) yang cocok
  var total = 0;
  for (var i = 1; i < rows.length; i++) {
    if (inBulan(rows[i][0], b)) {
      targetRows.push(i + 1);
      total += Number(rows[i][2]) || 0;
    }
  }

  if (targetRows.length === 0) {
    sendMessage(chatId, 'Tidak ada transaksi di ' + labelBulan(b) + '. Tidak ada yang dihapus.');
    return;
  }

  if (String(konfirm).toUpperCase() !== 'KONFIRM') {
    sendMessage(chatId, '⚠️ Akan menghapus ' + targetRows.length + ' transaksi di ' + labelBulan(b) +
      ' (total nilai Rp' + formatRupiah(total) + ').\n\nIni TIDAK bisa dibatalkan. Untuk lanjut, balas:\n' +
      '/hapus bulan ' + b.y + '-' + ('0' + b.m).slice(-2) + ' KONFIRM');
    return;
  }

  // Hapus dari bawah ke atas agar indeks baris tidak bergeser.
  for (var j = targetRows.length - 1; j >= 0; j--) s.deleteRow(targetRows[j]);
  logEvent('WARN', 'keuangan_deleted_bulk', labelBulan(b) + ' (' + targetRows.length + ' baris)');
  sendMessage(chatId, '🗑️ ' + targetRows.length + ' transaksi di ' + labelBulan(b) + ' dihapus.');
  refreshDashboard();
}

// ---------- Resolusi tugas (deterministik, tidak bergantung AI) ----------

var TUGAS_STOPWORDS = ['hapus', 'hapusin', 'apus', 'apusin', 'ilangin', 'hilangkan', 'hilangin',
  'buang', 'buangin', 'delete', 'del', 'remove', 'selesai', 'selesaikan', 'selesaiin', 'beres',
  'beresin', 'kelar', 'kelarin', 'rampung', 'tuntas', 'done', 'udahan', 'complete', 'ceklis',
  'checklist', 'tugas', 'tugasan', 'todo', 'task', 'kerjaan', 'sudah', 'udah', 'tandai', 'tandain',
  'yang', 'id', 'untuk', 'itu', 'dong', 'tolong', 'liat', 'lihat'];

/** Tangkap ID tugas dari teks: "T-0001", "T0001", "t 1", "id T-0001" -> "T-0001". null bila tak ada. */
function extractTugasId(text) {
  var m = String(text || '').match(/\bt[\s\-]?0*(\d{1,4})\b/i);
  return m ? 'T-' + ('0000' + m[1]).slice(-4) : null;
}

/** Ubah token tanggal (dd-mm-yyyy / dd/mm/yyyy / yyyy-mm-dd) jadi yyyy-mm-dd. null bila tak ada. */
function normalizeDateToken(q) {
  var m = String(q).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = String(q).match(/(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return null;
}

/** Buang kata perintah & token ID dari teks, sisakan kata kunci judul. */
function cleanTugasQuery(text) {
  var s = ' ' + String(text || '').toLowerCase() + ' ';
  TUGAS_STOPWORDS.forEach(function (w) { s = s.replace(new RegExp('\\b' + w + '\\b', 'g'), ' '); });
  s = s.replace(/\bt[\s\-]?0*\d{1,4}\b/gi, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

/** Cari ID tugas OPEN dari kata kunci judul atau tanggal tenggat. Return id bila TEPAT satu cocok. */
function findTugasIdByText(query) {
  var q = String(query || '').toLowerCase().trim();
  if (!q) return null;
  var wantDate = normalizeDateToken(q);
  var tokens = q.replace(/[-\/]/g, ' ').split(/\s+/).filter(function (t) { return t.length >= 3 && !/^\d+$/.test(t); });
  var tz = Session.getScriptTimeZone();
  var rows = readAll('Tugas');
  var hits = [];
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][3]).toLowerCase() === 'done') continue;
    var teks = String(rows[i][1]).toLowerCase();
    var due = rows[i][2];
    var dueStr = (due instanceof Date) ? Utilities.formatDate(due, tz, 'yyyy-MM-dd') : String(due);
    var textMatch = tokens.length > 0 && tokens.every(function (t) { return teks.indexOf(t) >= 0; });
    var dateMatch = wantDate && dueStr === wantDate;
    if (textMatch || dateMatch) hits.push(String(rows[i][0]));
  }
  hits = hits.filter(function (v, i) { return hits.indexOf(v) === i; });
  return hits.length === 1 ? hits[0] : null;
}

/** Resolusi satu ID tugas dari teks bebas: coba ID eksplisit, lalu kata kunci/tanggal. */
function resolveTugasId(text) {
  if (!text) return null;
  return extractTugasId(text) || findTugasIdByText(cleanTugasQuery(text));
}
