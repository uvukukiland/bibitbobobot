/**
 * Validate.gs — validasi & parsing input (T1.1).
 * Prinsip §5 PRD: format ketat, error cepat ketahuan, jangan diam-diam simpan salah.
 */

/**
 * Ubah teks nominal jadi angka positif. Menerima pemisah ribuan titik/koma/spasi.
 * Menolak huruf/shorthand (mis. "25rb") agar tak ada tebakan. Return null bila tidak valid.
 */
function parseNominal(raw) {
  var cleaned = String(raw).replace(/[.,_\s]/g, '');
  if (!/^\d+$/.test(cleaned)) return null;
  var n = parseInt(cleaned, 10);
  return n > 0 ? n : null;
}

/**
 * Cek kategori ada di sheet `Kategori` dan boleh untuk `tipe` (masuk/keluar).
 * Kolom tipe 'both' (atau kosong) berlaku untuk keduanya.
 */
function isKategoriValid(kategori, tipe) {
  var target = String(kategori).trim().toLowerCase();
  var rows = readAll('Kategori');
  for (var i = 1; i < rows.length; i++) {
    var k = String(rows[i][0]).trim().toLowerCase();
    if (k === target) {
      var t = String(rows[i][1]).trim().toLowerCase();
      return t === 'both' || t === '' || t === tipe;
    }
  }
  return false;
}

/** Validasi tanggal ketat format YYYY-MM-DD. */
function isValidDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var d = new Date(s + 'T00:00:00');
  return !isNaN(d.getTime());
}

/** Format angka jadi "25.000" (pemisah ribuan titik). */
function formatRupiah(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Ubah spec tanggal (tanpa '#') jadi Date, untuk backfill. Return null bila tak dikenali.
 * Menerima: 'kemarin', 'lusakemarin'/'kemarinlusa' (2 hari lalu),
 * '<n>harilalu', 'hariini', dan 'YYYY-MM-DD'.
 * Relatif: kurangi dari waktu sekarang (jam ikut sekarang). Eksplisit: jam 12:00.
 */
function resolveTanggal(spec) {
  var s = String(spec || '').toLowerCase().replace(/\s+/g, '');
  if (!s || s === 'hariini' || s === 'sekarang') return new Date();
  if (s === 'kemarin') return geserHari(-1);
  if (s === 'kemarinlusa' || s === 'lusakemarin') return geserHari(-2);
  var m = s.match(/^(\d+)harilalu$/);
  if (m) return geserHari(-parseInt(m[1], 10));
  if (isValidDate(s)) return new Date(s + 'T12:00:00');
  return null;
}

/** Date hasil pergeseran n hari dari sekarang (mempertahankan jam saat ini). */
function geserHari(n) {
  var d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}
