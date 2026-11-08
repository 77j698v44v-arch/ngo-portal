// Reduce Kenyan phone formats (0712 345 678, +254712345678, 254712345678, 712345678) to 0712345678
function canonPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('254')) return '0' + d.slice(3);
  if (d.length === 9) return '0' + d;
  return d;
}

const isKenyanPhone = (p) => /^0\d{9}$/.test(canonPhone(p));

module.exports = { canonPhone, isKenyanPhone };
