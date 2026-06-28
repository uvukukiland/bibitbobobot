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

/**
 * Kirim pesan teks. opts opsional:
 *   { html:true } → parse_mode HTML (escape teks dinamis dgn htmlEsc!),
 *   { keyboard:[[...]] } → tombol inline,
 *   { preview:false } → matikan pratinjau tautan.
 * Tetap kompatibel dengan pemanggilan lama sendMessage(chatId, text).
 */
function sendMessage(chatId, text, opts) {
  var p = { chat_id: chatId, text: text };
  if (opts && opts.html) p.parse_mode = 'HTML';
  if (opts && opts.keyboard) p.reply_markup = { inline_keyboard: opts.keyboard };
  if (opts && opts.preview === false) p.disable_web_page_preview = true;
  return tgCall('sendMessage', p);
}

/** Kirim pesan dengan tombol inline. inlineKeyboard = array baris tombol. html opsional. */
function sendButtons(chatId, text, inlineKeyboard, html) {
  return sendMessage(chatId, text, { keyboard: inlineKeyboard, html: !!html });
}

/** Tampilkan indikator "sedang mengetik…" (dipanggil sebelum proses yang agak lama). */
function sendTyping(chatId) {
  try { tgCall('sendChatAction', { chat_id: chatId, action: 'typing' }); } catch (e) {}
}

/** Escape karakter yang bertabrakan dengan parse_mode HTML (&, <, >). */
function htmlEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

/**
 * Pasang IDENTITAS bot: menu perintah (tombol Menu biru + autocomplete saat ketik '/'),
 * deskripsi profil, dan teks sambutan layar kosong. Jalankan SEKALI dari editor
 * (ini setelan tingkat-bot via API, BUKAN webhook — tak perlu Deploy).
 */
function setupBotProfile() {
  var cmds = [
    { command: 'keluar',  description: '💸 Catat pengeluaran' },
    { command: 'masuk',   description: '💰 Catat pemasukan' },
    { command: 'saldo',   description: '👛 Lihat saldo' },
    { command: 'rekap',   description: '📊 Rekap bulan/tahun' },
    { command: 'daftar',  description: '📋 Daftar tugas' },
    { command: 'tugas',   description: '➕ Tambah tugas' },
    { command: 'acara',   description: '📅 Tambah acara/agenda' },
    { command: 'catat',   description: '📝 Tambah catatan' },
    { command: 'catatan', description: '🗒️ Lihat catatan' },
    { command: 'agenda',  description: '🗓️ Acara mendatang' },
    { command: 'kategori', description: '🏷️ Daftar kategori' },
    { command: 'cari',    description: '🔎 Cari berkas Drive' },
    { command: 'dropbox', description: '📦 Cari berkas Dropbox' },
    { command: 'status',  description: '⚙️ Status bot' },
    { command: 'help',    description: '❓ Bantuan & contoh' }
  ];
  tgCall('setMyCommands', { commands: cmds });
  tgCall('setMyShortDescription', {
    short_description: 'Asisten pribadi: catat keuangan, tugas & agenda lewat chat biasa atau foto struk.'
  });
  tgCall('setMyDescription', {
    description: 'Halo! Saya asisten pribadi Anda. 🤖\n\n' +
      'Catat keuangan, tugas, dan agenda cukup dengan mengetik biasa — atau kirim foto struk/transfer, saya baca otomatis.\n\n' +
      'Tekan Mulai lalu ketik /help untuk contoh.'
  });
  Logger.log('Profil bot terpasang: menu perintah + deskripsi.');
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
