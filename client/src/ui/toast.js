/** 화면 위쪽에 잠깐 떠오르는 알림 */
export function toast(message, { error = false, ms = 3500 } = {}) {
  const root = document.getElementById('toasts');
  if (!root) return;
  const el = document.createElement('div');
  el.className = error ? 'toast toast-error' : 'toast';
  el.setAttribute('role', error ? 'alert' : 'status');
  el.textContent = message;
  root.append(el);
  setTimeout(() => el.remove(), ms);
}
