/**
 * Budget.gs — batas pengeluaran bulanan per kategori + peringatan otomatis.
 * Sheet "Budget": [kategori, batas]. Saat mencatat pengeluaran, bot memeriksa
 * total bulan berjalan kategori itu; memperingatkan ketika MELEWATI 80% lalu 100%
 * (hanya saat baru melampaui ambang, agar tidak berisik).
 *
 * Perintah:
 *   /budget                      → daftar budget + pemakaian bulan ini
 *   /budget <kategori> <nominal> → set/ubah budget (mis. /budget makan 1000000)
 *   /budget <kategori> 0         → hapus budget kategori itu
 */

/** Ambil/buat sheet Budget (header bila baru). */
function budgetSheet() {
  var book = ss();
  var s = book.getSheetByName('Budget');
  if (!s) { s = book.insertSheet('Budget'); s.appendRow(['kategori', 'batas']); s.setFrozenRows(1); }
  return s;
}

/** Batas budget kategori (angka) atau 0 bila tak diatur. */
function budgetFor(kategori) {
  var target = String(kategori || '').toLowerCase().trim();
  if (!target) return 0;
  var rows = budgetSheet().getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).toLowerCase().trim() === target) return Number(rows[i][1]) || 0;
  }
  return 0;
}

/** Total pengeluaran kategori pada bulan b={y,m}. */
function totalKategoriBulan(kategori, b) {
  var target = String(kategori || '').toLowerCase().trim();
  var rows = readAll('Keuangan'), total = 0;
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][1]).toLowerCase() !== 'keluar') continue;
    if (String(rows[i][3] || '').toLowerCase().trim() !== target) continue;
    if (!inBulan(rows[i][0], b)) continue;
    total += Number(rows[i][2]) || 0;
  }
  return total;
}

/**
 * Periksa budget setelah satu pengeluaran tersimpan; kirim peringatan bila baru
 * melampaui 80% atau 100%. nominalBaru = nominal transaksi yang baru saja dicatat.
 */
function cekBudget(kategori, nominalBaru, chatId) {
  try {
    var batas = budgetFor(kategori);
    if (!batas || batas <= 0) return;
    var now = new Date();
    var b = { y: now.getFullYear(), m: now.getMonth() + 1 };
    var total = totalKategoriBulan(kategori, b);      // sudah termasuk transaksi baru
    var prev = total - (Number(nominalBaru) || 0);    // total sebelum transaksi ini
    var soft = batas * 0.8;
    var pct = Math.round(total / batas * 100);
    if (prev < batas && total >= batas) {
      sendMessage(chatId, '🚨 Budget <b>' + htmlEsc(kategori) + '</b> TERLAMPAUI!\n' +
        'Terpakai <b>Rp' + formatRupiah(total) + '</b> / Rp' + formatRupiah(batas) + ' bulan ini (' + pct + '%).', { html: true });
    } else if (prev < soft && total >= soft) {
      sendMessage(chatId, '⚠️ Budget <b>' + htmlEsc(kategori) + '</b> hampir habis.\n' +
        'Terpakai <b>Rp' + formatRupiah(total) + '</b> / Rp' + formatRupiah(batas) + ' (' + pct + '%).', { html: true });
    }
  } catch (e) {
    logEvent('ERROR', 'cek_budget_failed', String(e));
  }
}

/** /budget [kategori] [nominal] */
function cmdBudget(args, chatId) {
  var kategori = String(args[0] || '').toLowerCase().trim();
  var nominalRaw = args[1];

  // Tanpa argumen → daftar budget + pemakaian bulan ini.
  if (!kategori) {
    var rows = budgetSheet().getDataRange().getValues();
    var now = new Date(), b = { y: now.getFullYear(), m: now.getMonth() + 1 };
    if (rows.length <= 1) {
      sendMessage(chatId, '🎯 <b>Budget</b>\nBelum ada budget. Set dengan:\n/budget &lt;kategori&gt; &lt;nominal&gt;\nmis. /budget makan 1000000', { html: true });
      return;
    }
    var out = ['🎯 <b>Budget Bulan Ini</b>', '━━━━━━━━━━━━━━'];
    for (var i = 1; i < rows.length; i++) {
      var kat = String(rows[i][0]).toLowerCase(), batas = Number(rows[i][1]) || 0;
      if (!kat || batas <= 0) continue;
      var pakai = totalKategoriBulan(kat, b), pct = Math.round(pakai / batas * 100);
      var ikon = pct >= 100 ? '🚨' : (pct >= 80 ? '⚠️' : '✅');
      out.push(ikon + ' <b>' + htmlEsc(kat) + '</b>: Rp' + formatRupiah(pakai) + ' / Rp' + formatRupiah(batas) + ' (' + pct + '%)');
    }
    out.push('━━━━━━━━━━━━━━', '<i>Ubah: /budget &lt;kategori&gt; &lt;nominal&gt; · hapus: /budget &lt;kategori&gt; 0</i>');
    sendMessage(chatId, out.join('\n'), { html: true });
    return;
  }

  // Set/ubah/hapus budget.
  if (nominalRaw === undefined) {
    sendMessage(chatId, 'Format: /budget <kategori> <nominal>\nmis. /budget makan 1000000 · hapus: /budget makan 0');
    return;
  }
  if (!isKategoriValid(kategori, 'keluar')) {
    sendMessage(chatId, '❌ Kategori "' + htmlEsc(kategori) + '" tidak dikenal. Ketik /kategori untuk daftar.', { html: true });
    return;
  }
  var nominal = parseNominal(nominalRaw);
  var hapus = String(nominalRaw).trim() === '0';
  if (nominal === null && !hapus) {
    sendMessage(chatId, '❌ Nominal "' + nominalRaw + '" tidak valid. Mis. /budget makan 1000000.');
    return;
  }

  var s = budgetSheet();
  var rows2 = s.getDataRange().getValues();
  var found = -1;
  for (var j = 1; j < rows2.length; j++) {
    if (String(rows2[j][0]).toLowerCase().trim() === kategori) { found = j + 1; break; }
  }
  if (hapus) {
    if (found > 0) { s.deleteRow(found); sendMessage(chatId, '🗑️ Budget "' + htmlEsc(kategori) + '" dihapus.', { html: true }); }
    else sendMessage(chatId, 'Kategori "' + htmlEsc(kategori) + '" belum punya budget.', { html: true });
    return;
  }
  if (found > 0) s.getRange(found, 2).setValue(nominal);
  else s.appendRow([kategori, nominal]);
  sendMessage(chatId, '🎯 Budget <b>' + htmlEsc(kategori) + '</b> diset Rp' + formatRupiah(nominal) + '/bulan.', { html: true });
}
