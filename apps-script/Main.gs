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

    var msg = update.message || update.edited_message;
    if (!msg || !msg.text) return ok();

    var chatId = msg.chat.id;

    // Gerbang keamanan (§6 PRD): hanya chat ID yang diizinkan, sisanya ditolak diam-diam.
    if (String(chatId) !== String(cfg('ALLOWED_CHAT_ID'))) {
      logEvent('WARN', 'unauthorized', 'chatId=' + chatId);
      return ok();
    }

    route(msg.text.trim(), chatId);
  } catch (err) {
    logEvent('ERROR', 'doPost_error', String(err));
  }
  return ok();
}

/** Telegram cukup butuh balasan HTTP 200. */
function ok() {
  return ContentService.createTextOutput('ok');
}

// route() ada di Router.gs (Fase 1+).
