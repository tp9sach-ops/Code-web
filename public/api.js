/* api.js — cầu nối giữa giao diện và Google Apps Script.
 * Giao diện cũ gọi:  google.script.run.withSuccessHandler(f).withFailureHandler(g).nvLogin(u, p)
 * File này dựng lại đúng cú pháp đó nhưng gửi bằng fetch tới URL Web App (POST JSON, text/plain
 * để tránh bước kiểm tra CORS preflight mà Apps Script không hỗ trợ).
 * Nhờ vậy toàn bộ code giao diện (hàm call(...)) chạy nguyên vẹn trên Vercel.
 * KHÔNG tự động gửi lại (retry) — giao diện đã tự xử lý mất mạng/xung đột phiên bản.
 */
(function (w) {
  'use strict';
  var CFG = w.NV_CONFIG || {};
  var URL_ = String(CFG.apiUrl || '');

  function configured() { return /^https:\/\/script\.google(usercontent)?\.com\//.test(URL_) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(URL_); }

  function humanError(err) {
    var m = err && err.message ? String(err.message) : '';
    if (err && err.name === 'AbortError') return 'Quá thời gian chờ máy chủ.';
    if (err && err.name === 'TypeError') return 'Không có mạng hoặc máy chủ không phản hồi.';
    return m || 'Lỗi không xác định.';
  }

  function post(fn, args) {
    if (!configured()) return Promise.reject(new Error('Chưa cấu hình địa chỉ máy chủ (public/js/config.js → apiUrl).'));
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var ms = fn === 'nvUploadAnh' ? (CFG.uploadTimeoutMs || 120000) : (CFG.timeoutMs || 60000);
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, ms) : 0;
    return fetch(URL_, {
      method: 'POST',
      redirect: 'follow',
      credentials: 'omit',
      cache: 'no-store',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fn: fn, args: args }),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      if (!res.ok) throw new Error('Máy chủ trả mã ' + res.status + '.');
      return res.text();
    }).then(function (txt) {
      clearTimeout(timer);
      try { return JSON.parse(txt); }
      catch (e) { throw new Error('Phản hồi máy chủ không đúng định dạng (kiểm tra quyền "Bất kỳ ai" của Web App).'); }
    }, function (err) { clearTimeout(timer); throw err; });
  }

  function makeRunner(onOk, onFail) {
    var base = {
      withSuccessHandler: function (f) { return makeRunner(f, onFail); },
      withFailureHandler: function (g) { return makeRunner(onOk, g); }
    };
    return new Proxy(base, {
      get: function (t, name) {
        if (name in t) return t[name];
        if (typeof name !== 'string' || name === 'then') return undefined;
        return function () {
          var args = Array.prototype.slice.call(arguments);
          post(name, args).then(
            function (r) { if (onOk) onOk(r); },
            function (err) { if (onFail) onFail({ message: humanError(err) }); }
          );
        };
      }
    });
  }

  w.google = w.google || {};
  w.google.script = w.google.script || {};
  w.google.script.run = makeRunner(null, null);

  /* Làm nóng Apps Script (khởi động nguội mất 1–3 giây) */
  if (CFG.warmUp !== false && configured()) {
    try { fetch(URL_ + (URL_.indexOf('?') < 0 ? '?' : '&') + 'fn=ping', { cache: 'no-store', credentials: 'omit' }).catch(function () {}); } catch (e) {}
  }

  w.NV_API = { post: post, configured: configured };
})(window);
