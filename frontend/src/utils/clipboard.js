// navigator.clipboard needs a secure context. The fallback matters on a plain
// http:// dev host, where share/copy buttons would otherwise do nothing.
export async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'absolute';
  field.style.left = '-9999px';
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(field);
  if (!copied) throw new Error('copy-failed');
}
