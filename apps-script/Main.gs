/**
 * Main.gs — entry webhook Telegram + router minimal Fase 0.
 * Router lengkap (perintah Fase 1+) menyusul di Router.gs.
 * Acuan: DESAIN-DAN-TASK.md §C, §D.
 */

/** Endpoint webhook: Telegram POST update ke sini. */
function doPost(e) {
  try {
    var update = JSON.parse(e.postData.contents);

    // Dedupe: cegah pemrosesan ganda saat Telegram mengirim ulang update yang sama
    // (penyebab "pong" beruntun). Tiap update_id diproses sekali saja.
    var cache = CacheService.getScriptCache();
    var dedupeKey = 'u_' + update.update_id;
    if (cache.get(dedupeKey)) return ok();
    cache.put(dedupeKey, '1', 600); // ingat 10 menit

    // Tap tombol inline (konfirmasi ✅/❌).
    if (update.callback_query) {
      var cq = update.callback_query;
      var cqChat = (cq.message && cq.message.chat) ? cq.message.chat.id : (cq.from ? cq.from.id : null);
      if (String(cqChat) === String(cfg('ALLOWED_CHAT_ID'))) {
        try { handleCallback(cq, cqChat); } catch (errCb) {
          try { logEvent('ERROR', 'callback_error', sensorAman(String(errCb))); } catch (e1) {}
          try { sendMessage(cqChat, pesanKendala(errCb), { html: true }); } catch (e2) {}
        }
      } else answerCallback(cq.id);
      return ok();
    }

    var msg = update.message || update.edited_message;
    if (!msg) return ok();

    var chatId = msg.chat.id;

    // Gerbang keamanan (§6 PRD): hanya chat ID yang diizinkan, sisanya ditolak diam-diam.
    if (String(chatId) !== String(cfg('ALLOWED_CHAT_ID'))) {
      logEvent('WARN', 'unauthorized', 'chatId=' + chatId);
      return ok();
    }

    // Foto/gambar → jalur pembacaan gambar (Vision). Selain itu, teks → router.
    // Jaring pengaman: kalau handler error tak terduga, bot TETAP membalas (bukan diam).
    try {
      var fileId = photoFileId(msg);
      if (fileId) { handlePhoto(msg, fileId, chatId); return ok(); }
      if (msg.text) { route(msg.text.trim(), chatId); return ok(); }
    } catch (err) {
      try { logEvent('ERROR', 'handler_error', sensorAman(String(err) + (err && err.stack ? ' | ' + String(err.stack).slice(0, 300) : ''))); } catch (e1) {}
      try { sendMessage(chatId, pesanKendala(err), { html: true }); } catch (e2) {}
    }
    return ok();
  } catch (err) {
    logEvent('ERROR', 'doPost_error', String(err));
  }
  return ok();
}

/** Telegram cukup butuh balasan HTTP 200. */
function ok() {
  return ContentService.createTextOutput('ok');
}

/**
 * Penanda berkas: [berkas, simbol TERBARU di berkas itu]. Bila simbolnya tak ada, berkas itu
 * belum ditambahkan ke project Apps Script ATAU masih versi lama (penyebab umum error
 * "xxx is not defined" setelah menyalin sebagian berkas saja).
 * Ganti simbolnya ke yang terbaru bila sebuah berkas mendapat fitur besar baru.
 */
var PENANDA_BERKAS = [
  ['Main.gs', 'pesanKendala'], ['Config.gs', 'cfgOptional'], ['Sheets.gs', 'bersihkanLog'], ['Telegram.gs', 'sendDocument'],
  ['Router.gs', 'welcomeText'], ['Setup.gs', 'migrateAddIds'], ['Commands.gs', 'cmdHapusLog'],
  ['Validate.gs', 'resolveTanggal'], ['Scheduler.gs', 'sendRingkasanMingguan'], ['Drive.gs', 'searchDriveFiles'],
  ['Dropbox.gs', 'cmdCariDropbox'], ['Rekap.gs', 'cmdRiwayat'], ['AI.gs', 'geminiErrTerakhir'],
  ['AIProviders.gs', 'penjelasanGagal'], ['Vision.gs', 'photoSchemaDinamis'], ['Kamus.gs', 'cmdLainnya'],
  ['KamusData.gs', 'KATA_LEMAH'], ['Budget.gs', 'cmdBudget'], ['Export.gs', 'cmdExport'],
  ['Dashboard.gs', 'dashOpsiGrafik'], ['Polish.gs', 'applyDataValidation'], ['Audit.gs', 'auditDataPerbaiki']
];

/**
 * Sensor rahasia yang tetap bekerja walau AIProviders.gs (pemilik sensor()) belum ada,
 * plus pengaman terakhir: token bot yang tersimpan di Script Properties tak pernah lolos.
 * Error UrlFetchApp ("Address unavailable: https://api.telegram.org/bot<token>/...") memuat URL lengkap.
 */
function sensorAman(s) {
  var t = (typeof sensor === 'function') ? sensor(s) : String(s)
    .replace(/([?&]key=)[^&\s"']+/g, '$1••••')
    .replace(/(\/(?:file\/)?bot)[^\/\s"']+/g, '$1••••')
    .replace(/\d{6,}:[A-Za-z0-9_-]{20,}/g, '••••');
  try {
    var tok = cfgOptional('TELEGRAM_BOT_TOKEN', '');
    if (tok && tok.length > 10) t = t.split(tok).join('••••');
  } catch (e) {}
  return t;
}

/** Escape HTML Telegram (mandiri — tak bergantung Telegram.gs). */
function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/**
 * Nama berkas dibungkus <code>: tanpa itu Telegram menjadikan "Sheets.gs" TAUTAN ke situs luar
 * (".gs" adalah akhiran domain internet).
 */
function daftarBerkasHtml(arr) {
  return arr.map(function (n) { return '<code>' + escHtml(n) + '</code>'; }).join(', ');
}

/** Berkas .gs yang belum ada / masih versi lama di project (daftar nama berkas). */
function berkasKurang() {
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;
  return PENANDA_BERKAS.filter(function (p) { return typeof g[p[1]] === 'undefined'; })
    .map(function (p) { return p[0]; });
}

/**
 * Pesan untuk pengguna saat handler gagal: sebut detail error (rahasia disensor) + petunjuk
 * bila penyebabnya berkas .gs yang belum lengkap. Format HTML — kirim dgn { html: true }.
 */
function pesanKendala(err) {
  var m = String((err && err.message) || err || 'tanpa keterangan');
  var out = '⚠️ Maaf, ada kendala saat memproses pesan Anda.\n🔎 Detail: ' + escHtml(sensorAman(m).slice(0, 200));
  var kurang = [];
  try { kurang = berkasKurang(); } catch (e) {}
  if (kurang.length) {
    out += '\n\n🔧 Berkas di project Apps Script belum ada / masih versi lama: ' + daftarBerkasHtml(kurang) + '.\n' +
      'Salin dari GitHub (bila belum ada: klik + → Skrip, beri nama persis sama), simpan, lalu Deploy → New version.';
  } else if (/is not defined|is not a function/.test(m)) {
    out += '\n\n🔧 Ada fungsi yang tidak ditemukan — kemungkinan salah satu berkas .gs belum diperbarui. ' +
      'Salin ulang berkas dari GitHub, simpan, lalu Deploy → New version.';
  } else {
    out += '\nCoba lagi ya. Bila berulang, kirim screenshot pesan ini.';
  }
  return out;
}

// route() ada di Router.gs (Fase 1+).
