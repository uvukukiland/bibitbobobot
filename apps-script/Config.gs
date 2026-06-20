/**
 * Config.gs — baca konstanta dari Script Properties.
 * Tidak ada token/ID di kode. Set via Setup.setupProperties() (sekali jalan).
 * Acuan: DESAIN-DAN-TASK.md §B.
 */

/** Ambil properti wajib; lempar error bila belum diset. */
function cfg(key) {
  var val = PropertiesService.getScriptProperties().getProperty(key);
  if (val === null || val === '') {
    throw new Error('Config "' + key + '" belum diset di Script Properties.');
  }
  return val;
}

/** Ambil properti opsional dengan nilai default. */
function cfgOptional(key, fallback) {
  var val = PropertiesService.getScriptProperties().getProperty(key);
  return (val === null || val === '') ? fallback : val;
}
