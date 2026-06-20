/**
 * Drive.gs — akses Google Drive (§7B).
 * Fase 3 (parsial): pencarian berkas di folder root + subfolder, balas tautan klik.
 * Tetap terbatas pada 1 pohon folder root (sesuai PRD §7B), dengan batas aman.
 */

/**
 * Folder awal pencarian. Jika DRIVE_ROOT_FOLDER_ID kosong atau "root",
 * pakai root Drive Saya (cari seluruh Drive). Selain itu, pakai folder ber-ID itu.
 */
function driveSearchRoot() {
  var id = cfgOptional('DRIVE_ROOT_FOLDER_ID', '');
  return (!id || id.toLowerCase() === 'root') ? DriveApp.getRootFolder() : DriveApp.getFolderById(id);
}

/**
 * Cari berkas yang namanya mengandung query, di folder DRIVE_ROOT_FOLDER_ID
 * dan SEMUA subfolder di dalamnya (rekursif). Return array {name, url, updated}, maksimal `max`.
 */
function searchDriveFiles(query, max) {
  var root = driveSearchRoot();
  var safe = String(query).replace(/(['\\])/g, '\\$1'); // escape ' dan \
  var titleQuery = "title contains '" + safe + "'";
  var out = [];
  var stack = [root];
  var foldersScanned = 0;
  var MAX_FOLDERS = 200; // batas aman agar tidak timeout pada pohon folder besar

  while (stack.length > 0 && out.length < max && foldersScanned < MAX_FOLDERS) {
    var folder = stack.pop();
    foldersScanned++;

    var it = folder.searchFiles(titleQuery);
    while (it.hasNext() && out.length < max) {
      var f = it.next();
      out.push({ name: f.getName(), url: f.getUrl(), updated: f.getLastUpdated() });
    }

    var subs = folder.getFolders();
    while (subs.hasNext()) stack.push(subs.next());
  }
  return out;
}

/**
 * Jalankan SEKALI dari editor: memicu izin akses Drive + menguji pencarian.
 * Saat pertama, Google minta otorisasi scope Drive — setujui (Advanced > Allow).
 */
function testCari() {
  var files = searchDriveFiles('a', 5);
  Logger.log('Ditemukan ' + files.length + ' berkas (nama mengandung "a") di folder root:');
  files.forEach(function (f) { Logger.log('- ' + f.name + ' :: ' + f.url); });
}
