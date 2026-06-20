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
  var now = new Date();
  var nowMin = now.getHours() * 60 + now.getMinutes();
  var today = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][now.getDay()];
  var s = sheet('Jadwal');
  var rows = s.getDataRange().getValues(); // id, label, waktu, hari, aktif, terkirim_pada
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (String(r[4]).toLowerCase() !== 'y') continue;            // aktif?
    if (r[5]) continue;                                          // sudah terkirim hari ini
    var hari = String(r[3]).toLowerCase();
    if (hari !== 'daily' && hari.indexOf(today) === -1) continue;
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
  var s = sheet('Tugas');
  var rows = s.getDataRange().getValues(); // id, teks, jatuh_tempo, status, terkirim_pada
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (String(r[3]).toLowerCase() !== 'open') continue;         // hanya tugas open
    var due = toDateStr(r[2], tz);
    if (!due || due > todayStr) continue;                        // tanpa tenggat / belum jatuh tempo
    if (toDateStr(r[4], tz) === todayStr) continue;              // sudah diingatkan hari ini
    var prefix = (due === todayStr) ? '⏰ Tenggat HARI INI' : '🔴 LEWAT tenggat (' + due + ')';
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
  logEvent('INFO', 'jadwal_reset', '');
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
