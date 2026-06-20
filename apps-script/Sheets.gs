/**
 * Sheets.gs — adapter penyimpanan ke Google Spreadsheet.
 * Acuan: DESAIN-DAN-TASK.md §A, §C.
 */

/** Spreadsheet DB. Pakai SPREADSHEET_ID bila ada; jika skrip terikat, pakai yang aktif. */
function ss() {
  var id = cfgOptional('SPREADSHEET_ID', '');
  if (id) return SpreadsheetApp.openById(id);
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  throw new Error('SPREADSHEET_ID belum diset di Script Properties (Project Settings > Script Properties).');
}

/** Ambil sheet bernama; lempar error bila tidak ada. */
function sheet(name) {
  var s = ss().getSheetByName(name);
  if (!s) throw new Error('Sheet "' + name + '" tidak ada. Jalankan Setup.setupSheets().');
  return s;
}

/** Tambah satu baris ke sheet. */
function append(name, row) {
  sheet(name).appendRow(row);
}

/** Baca seluruh nilai (termasuk header di baris 0). */
function readAll(name) {
  return sheet(name).getDataRange().getValues();
}

/** ID berurutan, mis. nextId('Tugas','T-') -> 'T-0001'. */
function nextId(name, prefix) {
  var seq = sheet(name).getLastRow(); // header dihitung 1 -> data pertama jadi 0001
  return prefix + ('0000' + seq).slice(-4);
}

/** Catat kejadian ke sheet Log. Tidak melempar agar tak menggagalkan handler. */
function logEvent(level, event, detail) {
  try {
    sheet('Log').appendRow([new Date(), level, event, detail || '']);
  } catch (e) {
    Logger.log('Gagal tulis Log: ' + e);
  }
}
