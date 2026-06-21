/**
 * Dropbox.gs — pencarian berkas di Dropbox (REST API v2), balas tautan klik.
 * Auth: refresh token (akses offline). Script Properties yang dibutuhkan:
 *   DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN
 * Lihat README bagian "Integrasi Dropbox" untuk cara membuat ketiganya.
 *
 * Host: RPC = api.dropboxapi.com (BUKAN api.dropbox.com).
 */

/** Parse respons Dropbox dengan aman; munculkan pesan asli bila bukan JSON / bukan 200. */
function dbxJson(res, where) {
  var code = res.getResponseCode();
  var text = res.getContentText();
  if (code !== 200) throw new Error('Dropbox ' + where + ' (HTTP ' + code + '): ' + text.slice(0, 250));
  try { return JSON.parse(text); }
  catch (e) { throw new Error('Dropbox ' + where + ' respons bukan JSON: ' + text.slice(0, 250)); }
}

/** Access token Dropbox (ditukar dari refresh token; di-cache ~3 jam). */
function dropboxAccessToken() {
  var cache = CacheService.getScriptCache();
  var tok = cache.get('dbx_access');
  if (tok) return tok;
  var res = UrlFetchApp.fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'post',
    payload: { grant_type: 'refresh_token', refresh_token: cfg('DROPBOX_REFRESH_TOKEN') },
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(cfg('DROPBOX_APP_KEY') + ':' + cfg('DROPBOX_APP_SECRET')) },
    muteHttpExceptions: true
  });
  var body = dbxJson(res, 'oauth/token');
  if (!body.access_token) throw new Error('Dropbox auth gagal: ' + res.getContentText().slice(0, 200));
  cache.put('dbx_access', body.access_token, 10800); // token Dropbox berlaku ~4 jam
  return body.access_token;
}

/** Cari berkas Dropbox berdasarkan nama. Return [{name, path, id}], maks `max`. */
function dropboxSearch(query, max) {
  var token = dropboxAccessToken();
  var res = UrlFetchApp.fetch('https://api.dropboxapi.com/2/files/search_v2', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ query: query, options: { max_results: Math.min(max || 8, 20), file_status: 'active' } }),
    muteHttpExceptions: true
  });
  var body = dbxJson(res, 'search_v2');
  if (!body.matches) return [];
  var out = [];
  for (var i = 0; i < body.matches.length && out.length < (max || 8); i++) {
    var md = body.matches[i].metadata && body.matches[i].metadata.metadata;
    if (!md || md['.tag'] !== 'file') continue;
    out.push({ name: md.name, path: md.path_lower, id: md.id });
  }
  return out;
}

/** Tautan sementara (langsung buka/unduh) untuk satu berkas Dropbox. */
function dropboxLink(path) {
  var token = dropboxAccessToken();
  var res = UrlFetchApp.fetch('https://api.dropboxapi.com/2/files/get_temporary_link', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ path: path }),
    muteHttpExceptions: true
  });
  var body = dbxJson(res, 'get_temporary_link');
  return body.link || '';
}

/** /dropbox <kata> → cari berkas di Dropbox, balas daftar + tautan. */
function cmdCariDropbox(args, chatId) {
  var query = (args && args.join ? args.join(' ') : String(args || '')).trim();
  if (!query) { sendMessage(chatId, 'Format: /dropbox <kata>\nContoh: /dropbox laporan'); return; }

  var files;
  try {
    files = dropboxSearch(query, 8);
  } catch (e) {
    logEvent('ERROR', 'dropbox_failed', String(e));
    sendMessage(chatId, '❌ Gagal mengakses Dropbox.\n' + String(e).slice(0, 200) +
      '\n\nCek DROPBOX_APP_KEY / DROPBOX_APP_SECRET / DROPBOX_REFRESH_TOKEN & scope app.');
    return;
  }
  if (!files.length) { sendMessage(chatId, 'Tidak ada berkas Dropbox yang namanya memuat "' + query + '".'); return; }

  var lines = files.map(function (f, i) {
    var url = '';
    try { url = dropboxLink(f.path); } catch (e) {}
    return (i + 1) + '. ' + f.name + (url ? '\n' + url : '\n(' + f.path + ')');
  });
  sendMessage(chatId, '📦 Dropbox "' + query + '":\n\n' + lines.join('\n\n'));
}

/**
 * SETUP sekali-jalan: tukar 'code' otorisasi -> refresh token (tanpa curl).
 * 1) Isi DROPBOX_APP_KEY & DROPBOX_APP_SECRET di Script Properties.
 * 2) Buka URL otorisasi (lihat README), Allow, salin 'code'-nya.
 * 3) Isi Script Property DROPBOX_AUTH_CODE = code itu, lalu Run fungsi ini.
 * 4) Salin refresh token dari Log ke DROPBOX_REFRESH_TOKEN; hapus DROPBOX_AUTH_CODE.
 */
function dropboxExchangeCode() {
  var res = UrlFetchApp.fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'post',
    payload: { code: cfg('DROPBOX_AUTH_CODE'), grant_type: 'authorization_code' },
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(cfg('DROPBOX_APP_KEY') + ':' + cfg('DROPBOX_APP_SECRET')) },
    muteHttpExceptions: true
  });
  var text = res.getContentText();
  var body; try { body = JSON.parse(text); } catch (e) { body = {}; }
  if (body.refresh_token) {
    var props = PropertiesService.getScriptProperties();
    props.setProperty('DROPBOX_REFRESH_TOKEN', body.refresh_token); // isi otomatis (anti salah salin)
    props.deleteProperty('DROPBOX_AUTH_CODE');                      // sudah sekali pakai
    CacheService.getScriptCache().remove('dbx_access');             // buang token akses lama
    Logger.log('✅ Berhasil! DROPBOX_REFRESH_TOKEN sudah diisi otomatis & DROPBOX_AUTH_CODE dihapus.\nSekarang Run testDropbox.');
  } else {
    Logger.log('❌ Gagal menukar code (kedaluwarsa/sudah dipakai). Ambil code BARU dari URL otorisasi, isi ulang DROPBOX_AUTH_CODE, lalu Run lagi:\n' + text);
  }
}

/** Bila perlu paksa ambil token baru (mis. setelah ubah scope). */
function dropboxClearCache() {
  CacheService.getScriptCache().remove('dbx_access');
  Logger.log('Cache token Dropbox dibersihkan. Token baru akan diambil saat panggilan berikutnya.');
}

/** Jalankan SEKALI dari editor untuk uji koneksi Dropbox (memicu izin UrlFetch). */
function testDropbox() {
  var files = dropboxSearch('a', 5);
  Logger.log('Dropbox OK — ' + files.length + ' berkas (nama memuat "a"):');
  files.forEach(function (f) { Logger.log('- ' + f.name + ' :: ' + f.path); });
}
