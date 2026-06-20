/**
 * Telegram.gs — pembungkus Telegram Bot API.
 * Acuan: DESAIN-DAN-TASK.md §C.
 */

var TG_API = 'https://api.telegram.org/bot';

/** Panggil method Bot API; catat ke Log bila gagal. */
function tgCall(method, payload) {
  var url = TG_API + cfg('TELEGRAM_BOT_TOKEN') + '/' + method;
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var body = JSON.parse(res.getContentText());
  if (!body.ok) {
    logEvent('ERROR', 'tg_' + method + '_failed', res.getContentText());
  }
  return body;
}

/** Kirim pesan teks. */
function sendMessage(chatId, text) {
  return tgCall('sendMessage', { chat_id: chatId, text: text });
}

/**
 * Daftarkan webhook ke URL Web App ini. Jalankan SETELAH deploy.
 * PENTING: harus URL /exec (URL deployment), bukan /dev. URL /dev butuh login
 * Google sehingga Telegram selalu 401. Isi WEB_APP_URL di Script Properties
 * dengan URL /exec dari Deploy > Manage deployments.
 */
function setWebhook() {
  var url = cfgOptional('WEB_APP_URL', '') || ScriptApp.getService().getUrl();
  if (!url) {
    throw new Error('Web App belum ter-deploy. Deploy dulu, salin URL /exec ke WEB_APP_URL.');
  }
  if (url.indexOf('/exec') === -1) {
    throw new Error('URL webhook berakhiran /dev (atau bukan /exec): ' + url +
      '\nSet WEB_APP_URL di Script Properties ke URL /exec dari Manage deployments.');
  }
  return tgCall('setWebhook', { url: url });
}

/** Lepas webhook (untuk debugging). */
function deleteWebhook() {
  return tgCall('deleteWebhook', {});
}
