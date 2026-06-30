/**
 * Scheduler.gs — trigger terjadwal (§E).
 * Fase 1: heartbeat. Fase 2: pengingat jadwal + tugas (jatuh tempo & follow-up).
 */

// ---------- Heartbeat (Fase 1) ----------

/** Kirim tanda "alive" harian ke pemilik. Mati = tidak ada pesan -> kamu sadar (§8 #3). */
function sendHeartbeat() {
  try {
    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
    sendMessage(cfg('ALLOWED_CHAT_ID'), '✅ alive — ' + stamp);
    logEvent('INFO', 'heartbeat_sent', stamp);
  } catch (e) {
    logEvent('ERROR', 'heartbeat_failed', String(e));
  }
}

// ---------- Pengingat (Fase 2) ----------

/** Tick utama: dipanggil trigger tiap beberapa menit. */
function reminderTick() {
  try { sendJadwalReminders(); } catch (e) { logEvent('ERROR', 'jadwal_tick_failed', String(e)); }
  try { sendTugasReminders(); } catch (e) { logEvent('ERROR', 'tugas_tick_failed', String(e)); }
}

/** Pengingat harian dari sheet Jadwal. Fire sekali per hari saat tick pertama >= waktu jadwal. */
function sendJadwalReminders() {
  var tz = Session.getScriptTimeZone();
  var now = new Date();
  var nowMin = now.getHours() * 60 + now.getMinutes();
  var today = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][now.getDay()];
  var todayDate = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  var s = sheet('Jadwal');
  var rows = s.getDataRange().getValues(); // id, label, waktu, hari, aktif, terkirim_pada
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (String(r[4]).toLowerCase() !== 'y') continue;            // aktif?
    if (r[5]) continue;                                          // sudah terkirim hari ini
    // hari = 'daily' / 'mon,tue,...' ATAU tanggal spesifik 'YYYY-MM-DD' (acara sekali).
    var hariDate = toDateStr(r[3], tz);
    var hari = String(r[3]).toLowerCase();
    var cocok = hariDate ? (hariDate === todayDate) : (hari === 'daily' || hari.indexOf(today) !== -1);
    if (!cocok) continue;
    var schedMin = parseHHMM(r[2]);
    if (schedMin === null || nowMin < schedMin) continue;        // belum waktunya
    if (trySend(cfg('ALLOWED_CHAT_ID'), '⏰ ' + r[1])) {
      s.getRange(i + 1, 6).setValue(now);                        // tandai terkirim_pada
      logEvent('INFO', 'jadwal_sent', r[0]);
    }
  }
}

/** Pengingat tugas jatuh tempo + follow-up harian untuk yang lewat tenggat. */
function sendTugasReminders() {
  var tz = Session.getScriptTimeZone();
  var now = new Date();
  if (now.getHours() < parseInt(cfgOptional('TASK_HOUR', '8'), 10)) return; // jam pengingat tugas
  var todayStr = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  var tomorrowStr = Utilities.formatDate(new Date(now.getTime() + 86400000), tz, 'yyyy-MM-dd');
  var s = sheet('Tugas');
  var rows = s.getDataRange().getValues(); // id, teks, jatuh_tempo, status, terkirim_pada
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (String(r[3]).toLowerCase() !== 'open') continue;         // hanya tugas open
    var due = toDateStr(r[2], tz);
    if (!due || due > tomorrowStr) continue;                     // tanpa tenggat / belum H-1
    if (toDateStr(r[4], tz) === todayStr) continue;              // sudah diingatkan hari ini
    var prefix = (due === todayStr) ? '⏰ Tenggat HARI INI'
      : (due === tomorrowStr) ? '📅 Tenggat BESOK'
      : '🔴 LEWAT tenggat (' + due + ')';
    if (trySend(cfg('ALLOWED_CHAT_ID'), prefix + ': ' + r[1] + '\nTandai selesai: /selesai ' + r[0])) {
      s.getRange(i + 1, 5).setValue(todayStr);                   // terkirim_pada = tanggal hari ini
      logEvent('INFO', 'tugas_reminder_sent', r[0]);
    }
  }
}

/** Reset penanda terkirim_pada di Jadwal tiap tengah malam (idempotensi harian). */
function resetJadwalHarian() {
  var s = sheet('Jadwal');
  var last = s.getLastRow();
  if (last > 1) s.getRange(2, 6, last - 1, 1).clearContent();
  nonaktifkanAcaraLewat();
  logEvent('INFO', 'jadwal_reset', '');
}

/** Nonaktifkan acara sekali (one-off) yang tanggalnya sudah lewat agar Jadwal tetap ramping. */
function nonaktifkanAcaraLewat() {
  try {
    var tz = Session.getScriptTimeZone();
    var todayStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    var s = sheet('Jadwal');
    var rows = s.getDataRange().getValues(); // id,label,waktu,hari,aktif,terkirim
    for (var i = 1; i < rows.length; i++) {
      var hd = toDateStr(rows[i][3], tz);                 // hanya acara one-off (kolom hari = tanggal)
      if (hd && hd < todayStr && String(rows[i][4]).toLowerCase() === 'y') s.getRange(i + 1, 5).setValue('n');
    }
  } catch (e) {
    logEvent('ERROR', 'nonaktif_acara_failed', String(e));
  }
}

// ---------- Util ----------

/** "07:00" atau Date -> menit sejak tengah malam. null bila tak valid. */
function parseHHMM(v) {
  if (v instanceof Date) return v.getHours() * 60 + v.getMinutes();
  var m = String(v).match(/^(\d{1,2}):(\d{2})$/);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

/** Date atau "YYYY-MM-DD" -> "YYYY-MM-DD". '' bila kosong/tak valid. */
function toDateStr(v, tz) {
  if (!v) return '';
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  var s = String(v).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

/** Kirim dengan 2x percobaan; catat ke Log bila tetap gagal (T2.5). */
function trySend(chatId, text) {
  for (var attempt = 1; attempt <= 2; attempt++) {
    var res = sendMessage(chatId, text);
    if (res && res.ok) return true;
    Utilities.sleep(1000);
  }
  logEvent('ERROR', 'send_failed', text);
  return false;
}

// ---------- Pemasang trigger ----------

function removeTriggers(names) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (names.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
}

/** Pasang trigger heartbeat harian (Fase 1). */
function installHeartbeatTrigger() {
  removeTriggers(['sendHeartbeat']);
  var hour = parseInt(cfgOptional('HEARTBEAT_HOUR', '7'), 10);
  ScriptApp.newTrigger('sendHeartbeat').timeBased().everyDays(1).atHour(hour).create();
  Logger.log('Trigger heartbeat dipasang setiap hari jam ' + hour + ':00.');
}

/** Pasang trigger pengingat (Fase 2): tick tiap 5 menit + reset jadwal tengah malam. */
function installReminderTriggers() {
  removeTriggers(['reminderTick', 'resetJadwalHarian']);
  ScriptApp.newTrigger('reminderTick').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('resetJadwalHarian').timeBased().everyDays(1).atHour(0).create();
  Logger.log('Trigger pengingat (tiap 5 menit) + reset jadwal (00:xx) terpasang.');
}

// ---------- Ringkasan harian ----------

var HARI_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

/** Kirim satu pesan rangkuman pagi: agenda hari ini + tugas + saldo. */
function sendRingkasanHarian() {
  try {
    var tz = Session.getScriptTimeZone();
    var now = new Date();
    var todayStr = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
    var dow = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][now.getDay()];
    var out = ['🌅 Ringkasan ' + HARI_ID[now.getDay()] + ', ' + Utilities.formatDate(now, tz, 'dd/MM/yyyy'), ''];

    // Agenda hari ini (Jadwal aktif: daily / hari ini / tanggal hari ini)
    var jr = readAll('Jadwal'), agenda = [];
    for (var i = 1; i < jr.length; i++) {
      if (String(jr[i][4]).toLowerCase() !== 'y') continue;
      var hd = toDateStr(jr[i][3], tz);
      var hari = String(jr[i][3]).toLowerCase();
      var ok = hd ? (hd === todayStr) : (hari === 'daily' || hari.indexOf(dow) !== -1);
      if (ok) agenda.push({ jam: jamStr(jr[i][2], tz), label: jr[i][1] });
    }
    agenda.sort(function (a, b) { return a.jam < b.jam ? -1 : 1; });
    if (agenda.length) { out.push('📅 Agenda hari ini:'); agenda.forEach(function (a) { out.push('• ' + (a.jam ? a.jam + ' ' : '') + a.label); }); }
    else out.push('📅 Tidak ada agenda hari ini.');
    out.push('');

    // Tugas: lewat tenggat & jatuh tempo hari ini
    var tr = readAll('Tugas'), lewat = [], iniHari = [];
    for (var j = 1; j < tr.length; j++) {
      if (String(tr[j][3]).toLowerCase() !== 'open') continue;
      var due = toDateStr(tr[j][2], tz);
      if (!due) continue;
      if (due < todayStr) lewat.push('• ' + tr[j][0] + ' ' + tr[j][1] + ' (tenggat ' + due + ')');
      else if (due === todayStr) iniHari.push('• ' + tr[j][0] + ' ' + tr[j][1]);
    }
    if (lewat.length) { out.push('🔴 Tugas lewat tenggat:'); out = out.concat(lewat); }
    if (iniHari.length) { out.push('⏰ Tugas tenggat hari ini:'); out = out.concat(iniHari); }
    if (!lewat.length && !iniHari.length) out.push('✅ Tak ada tugas jatuh tempo hari ini.');
    out.push('');

    // Keuangan (pakai hitung JS dari Dashboard.gs)
    var b = { y: now.getFullYear(), m: now.getMonth() + 1 };
    var prev = (b.m === 1) ? { y: b.y - 1, m: 12 } : { y: b.y, m: b.m - 1 };
    var d = scanKeuangan(b, prev);
    out.push('💼 Saldo total: Rp' + formatRupiah(d.saldoTotal));
    out.push('📊 Bulan ini: +Rp' + formatRupiah(d.masuk) + ' / -Rp' + formatRupiah(d.keluar));

    sendMessage(cfg('ALLOWED_CHAT_ID'), out.join('\n'));
    logEvent('INFO', 'ringkasan_sent', todayStr);
  } catch (e) {
    logEvent('ERROR', 'ringkasan_failed', String(e));
  }
}

/** waktu jadwal -> "HH:MM" untuk tampilan. */
function jamStr(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'HH:mm');
  var m = String(v).match(/^(\d{1,2}):(\d{2})$/);
  return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : '';
}

/** Pasang trigger ringkasan harian (menggantikan heartbeat polos). */
function installRingkasanTrigger() {
  removeTriggers(['sendRingkasanHarian', 'sendHeartbeat']);
  var hour = parseInt(cfgOptional('RINGKAS_HOUR', cfgOptional('HEARTBEAT_HOUR', '7')), 10);
  ScriptApp.newTrigger('sendRingkasanHarian').timeBased().everyDays(1).atHour(hour).create();
  Logger.log('Trigger ringkasan harian jam ' + hour + ':00 (menggantikan heartbeat).');
}

// ---------- Ringkasan mingguan ----------

/** Rangkuman 7 hari terakhir: total masuk/keluar + kategori teratas. */
function sendRingkasanMingguan() {
  try {
    var tz = Session.getScriptTimeZone();
    var now = new Date();
    var sejak = new Date(now.getTime() - 7 * 86400000);
    var rows = readAll('Keuangan');
    var masuk = 0, keluar = 0, nTx = 0, perKat = {};
    for (var i = 1; i < rows.length; i++) {
      var dt = (rows[i][0] instanceof Date) ? rows[i][0] : new Date(rows[i][0]);
      if (isNaN(dt.getTime()) || dt < sejak) continue;
      var t = String(rows[i][1]).toLowerCase(), n = Number(rows[i][2]) || 0;
      nTx++;
      if (t === 'masuk') masuk += n;
      else if (t === 'keluar') { keluar += n; var k = String(rows[i][3] || 'lainnya').toLowerCase(); perKat[k] = (perKat[k] || 0) + n; }
    }
    var top = Object.keys(perKat).map(function (k) { return [k, perKat[k]]; })
      .sort(function (a, b) { return b[1] - a[1]; }).slice(0, 5);
    var out = ['📈 <b>Ringkasan Pekan Ini</b>',
      '<i>' + Utilities.formatDate(sejak, tz, 'dd/MM') + ' – ' + Utilities.formatDate(now, tz, 'dd/MM') + '</i>',
      '━━━━━━━━━━━━━━',
      '💰 Masuk  : <b>Rp' + formatRupiah(masuk) + '</b>',
      '💸 Keluar : <b>Rp' + formatRupiah(keluar) + '</b>',
      '🟦 Selisih: <b>Rp' + formatRupiah(masuk - keluar) + '</b>',
      '<i>' + nTx + ' transaksi</i>'];
    if (top.length) { out.push('', '<b>🏆 Pengeluaran teratas</b>'); top.forEach(function (t, i) { out.push((i + 1) + '. ' + htmlEsc(t[0]) + ' — <b>Rp' + formatRupiah(t[1]) + '</b>'); }); }
    else out.push('', '<i>Belum ada pengeluaran pekan ini.</i>');
    sendMessage(cfg('ALLOWED_CHAT_ID'), out.join('\n'), { html: true });
    logEvent('INFO', 'ringkasan_mingguan_sent', '');
  } catch (e) {
    logEvent('ERROR', 'ringkasan_mingguan_failed', String(e));
  }
}

/** Pasang trigger ringkasan mingguan (Minggu malam). Jalankan sekali dari editor. */
function installRingkasanMingguanTrigger() {
  removeTriggers(['sendRingkasanMingguan']);
  var hour = parseInt(cfgOptional('RINGKAS_MINGGU_HOUR', '19'), 10);
  ScriptApp.newTrigger('sendRingkasanMingguan').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(hour).create();
  Logger.log('Trigger ringkasan mingguan (Minggu jam ' + hour + ':00) terpasang.');
}

// ---------- Acara satu kali (one-off) ----------

/** Tambah acara tanggal spesifik ke sheet Jadwal (kolom hari = tanggal). */
function tambahAcara(label, tanggal, jam, chatId) {
  if (!label || !tanggal || !isValidDate(tanggal)) {
    sendMessage(chatId, 'Format: /acara <label> #YYYY-MM-DD [HH:MM]\nmis. /acara rapat tim #2026-06-30 14:00');
    return;
  }
  var j = '08:00';
  var mm = String(jam || '').match(/^(\d{1,2})[:.](\d{2})$/);
  if (mm) j = ('0' + mm[1]).slice(-2) + ':' + mm[2];
  var id = nextId('Jadwal', 'J-');
  append('Jadwal', [id, label, j, tanggal, 'y', '']);
  logEvent('INFO', 'acara_added', id);
  sendMessage(chatId, '✅ Acara ' + id + ' dicatat: ' + label + ' — ' + tanggal + ' ' + j +
    '\nAnda akan diingatkan pada hari itu.');
}

/** /acara <label> #YYYY-MM-DD [HH:MM] */
function cmdAcara(args, chatId) {
  var tanggal = '', jam = '', labelTokens = [];
  args.forEach(function (t) {
    if (t.charAt(0) === '#') { var dt = t.slice(1); if (isValidDate(dt)) tanggal = dt; }
    else if (/^\d{1,2}[:.]\d{2}$/.test(t)) jam = t;
    else labelTokens.push(t);
  });
  tambahAcara(labelTokens.join(' ').trim(), tanggal, jam, chatId);
}
