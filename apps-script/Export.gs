/**
 * Export.gs — /export : kirim seluruh spreadsheet sebagai file Excel (.xlsx)
 * langsung ke Telegram sebagai backup. Memakai OAuth token skrip + endpoint
 * export Google Sheets (butuh scope Drive — sudah dipakai modul Drive).
 */

function cmdExport(chatId) {
  sendTyping(chatId);
  sendMessage(chatId, '📤 Menyiapkan file backup…');
  try {
    var id = cfgOptional('SPREADSHEET_ID', '') || ss().getId();
    var token = ScriptApp.getOAuthToken();
    var url = 'https://docs.google.com/spreadsheets/d/' + id + '/export?format=xlsx';
    var res = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) {
      logEvent('ERROR', 'export_http', String(res.getResponseCode()));
      sendMessage(chatId, '❌ Gagal mengekspor (HTTP ' + res.getResponseCode() + '). Pastikan izin Drive sudah diberikan (jalankan testCari sekali).');
      return;
    }
    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmm');
    var blob = res.getBlob().setName('AI-Assisten-' + stamp + '.xlsx');
    var r = sendDocument(chatId, blob, '🗂️ Backup data ' + stamp + '\nSimpan baik-baik sebagai cadangan.');
    if (!r || !r.ok) sendMessage(chatId, '❌ Berkas siap, tapi gagal dikirim ke Telegram. Coba lagi.');
  } catch (e) {
    logEvent('ERROR', 'export_failed', String(e));
    sendMessage(chatId, '❌ Gagal membuat backup: ' + String(e).slice(0, 150));
  }
}
