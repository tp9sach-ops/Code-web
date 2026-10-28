import { modelOf, sizeOf } from '../public/js/v8-3d.js';
const t = (g, n, kind) => ({ kind, text: g + ' ' + n, name: n });
const cases = [
  ['BÁNH NGÀN LỚP TRUYỀN THỐNG', 'Vàng 12cm', 'truyenthong', 'vang', 1], ['BÁNH NGÀN LỚP TRUYỀN THỐNG', 'Vàng 16cm', 'truyenthong', 'vang', 1.16],
  ['BÁNH NGÀN LỚP TRUYỀN THỐNG', 'Xanh 16cm', 'truyenthong', 'ladua', 1.16], ['BÁNH NGÀN LỚP TRUYỀN THỐNG', 'Than tre 12cm', 'truyenthong', 'thantre', 1],
  ['BÁNH PHÚ SĨ', 'Lá dứa 12cm', 'phusi', 'phusi_ladua', 1], ['BÁNH PHÚ SĨ', 'Choco hạnh nhân 12cm', 'phusi', 'choco', 1],
  ['BÁNH 3 VỊ', 'Set 4 Cái', '3vi', '3vi', 1.12], ['KHÁC', 'Panna cotta dâu', 'other', 'panna', 1], ['BÁNH CREPE', 'Xoài', 'crepe', null, 1],
];
let bad = 0; for (const [g, n, k, m, s] of cases) { const d = t(g, n, k), mm = modelOf(d), ss = sizeOf(d); const ok = mm === m && Math.abs(ss - s) < 0.001; if (!ok) bad++; console.log((ok ? '  ok - ' : '  LỖI - ') + g + ' / ' + n + ' → ' + mm + ' x' + ss.toFixed(2)); }
console.log(bad ? 'CÓ ' + bad + ' LỖI' : 'TẤT CẢ ĐẠT'); process.exit(bad ? 1 : 0);
