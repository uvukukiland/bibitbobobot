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

/** Kirim pesan dengan tombol inline. inlineKeyboard = array baris tombol. */
function sendButtons(chatId, text, inlineKeyboard) {
  return tgCall('sendMessage', { chat_id: chatId, text: text, reply_markup: { inline_keyboard: inlineKeyboard } });
}

/** Jawab callback (hilangkan ikon loading di tombol). */
function answerCallback(cbId, text) {
  return tgCall('answerCallbackQuery', { callback_query_id: cbId, text: text || '' });
}

/** Hapus tombol pada pesan (agar tak ditekan dua kali). */
function clearButtons(chatId, messageId) {
  return tgCall('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
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
  // drop_pending_updates: buang antrian tertahan agar tak nyangkut saat pulih.
  return tgCall('setWebhook', { url: url, drop_pending_updates: true });
}

/** Lepas webhook + buang antrian tertahan (untuk debugging/pemulihan). */
function deleteWebhook() {
  return tgCall('deleteWebhook', { drop_pending_updates: true });
}

/** Unduh file Telegram (mis. foto) sebagai Blob. Lempar bila gagal. */
function tgGetFileBlob(fileId) {
  var token = cfg('TELEGRAM_BOT_TOKEN');
  var info = tgCall('getFile', { file_id: fileId });
  if (!info.ok || !info.result || !info.result.file_path) {
    throw new Error('getFile gagal untuk ' + fileId);
  }
  var fileUrl = 'https://api.telegram.org/file/bot' + token + '/' + info.result.file_path;
  var res = UrlFetchApp.fetch(fileUrl, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('Unduh file gagal: ' + res.getResponseCode());
  return res.getBlob();
}
