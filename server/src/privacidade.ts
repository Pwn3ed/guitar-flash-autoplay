// /privacidade: a política de privacidade das lojas (store/PRIVACY.md), servida daqui para ter uma URL fixa.
// Conversor mínimo de Markdown, só o que o PRIVACY.md usa: #/##, listas com "-", **negrito**, "---" e parágrafos.
import md from '../../store/PRIVACY.md';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

export function markdown(texto: string): string {
  const out: string[] = [];
  let lista = false;
  for (const linha of texto.split('\n')) {
    const l = linha.trim();
    const item = /^- (.*)$/.exec(l);
    if (!item && lista) { out.push('</ul>'); lista = false; }
    if (!l) continue;
    if (item) { if (!lista) { out.push('<ul>'); lista = true; } out.push(`<li>${inline(item[1])}</li>`); continue; }
    const h = /^(#{1,3}) (.*)$/.exec(l);
    if (h) out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
    else if (l === '---') out.push('<hr>');
    else out.push(`<p>${inline(l)}</p>`);
  }
  if (lista) out.push('</ul>');
  return out.join('\n');
}

export function htmlPrivacidade(): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Guitar Flash Bot · Privacidade / Privacy</title>
<style>:root{color-scheme:light dark}body{margin:0 auto;max-width:760px;padding:24px 16px 48px;font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;background:Canvas;color:CanvasText}
h1{font-size:24px;line-height:1.3}h2{font-size:18px;margin-top:28px}hr{margin:40px 0;border:0;border-top:1px solid GrayText}li{margin:4px 0}</style>
</head><body>${markdown(md)}</body></html>`;
}
