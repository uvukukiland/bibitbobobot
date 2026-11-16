/**
 * Config.gs — baca konstanta dari Script Properties.
 * Tidak ada token/ID di kode. Set via Setup.setupProperties() (sekali jalan).
 * Acuan: DESAIN-DAN-TASK.md §B.
 */

/**
 * Ambil properti wajib; lempar error bila belum diset.
 * Nama property di proyek ini SELALU berpola HURUF_BESAR (GEMINI_API_KEY, TELEGRAM_BOT_TOKEN, …).
 * Bila yang ditulis di kode bukan pola itu, hampir pasti NILAI rahasia (API key/token) tertempel
 * di tempat nama — pesan error TIDAK mencetaknya (agar tak bocor ke log/screenshot) & beri cara membetulkan.
 */
function cfg(key) {
  var val = PropertiesService.getScriptProperties().getProperty(key);
  if (val === null || val === '') {
    var k = String(key);
    if (!/^[A-Z][A-Z0-9_]*$/.test(k)) {
      throw new Error('Config: di KODE tertulis cfg(\'' + k.slice(0, 4) + '…\') — itu tampak seperti NILAI rahasia ' +
        '(API key/token), bukan NAMA property. Ganti jadi nama property, mis. cfg(\'GEMINI_API_KEY\'), ' +
        'lalu simpan nilainya HANYA di Script Properties.');
    }
    throw new Error('Config "' + k + '" belum diset di Script Properties.');
  }
  return val;
}

/** Ambil properti opsional dengan nilai default. */
function cfgOptional(key, fallback) {
  var val = PropertiesService.getScriptProperties().getProperty(key);
  return (val === null || val === '') ? fallback : val;
}
