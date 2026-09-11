import type { TenantBrand } from '../../db/schema/index.js';

/** Escapes text for HTML attribute and element content. */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Raster logos render inline in mail clients; SVG data URIs mostly do not, so the name is used. */
function logoMarkup(brand: TenantBrand): string {
  const { logo } = brand;
  if (logo.mime && logo.mime !== 'image/svg+xml' && logo.content) {
    return `<img src="data:${esc(logo.mime)};base64,${logo.content}" alt="${esc(brand.name)}" height="32" style="height:32px;max-width:200px;display:block" />`;
  }
  return `<span style="font-size:18px;font-weight:700;color:#ffffff">${esc(brand.name)}</span>`;
}

/**
 * Branded email frame: the tenant's colours and name, table layout for mail clients, no external
 * assets (fonts fall back to the system stack, images are inline).
 */
export function emailLayout(brand: TenantBrand, title: string, body: string): string {
  const font = `${esc(brand.fontFamily || 'Inter')}, Segoe UI, Roboto, Helvetica, Arial, sans-serif`;
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:${font};color:#1f2937">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f5f7;padding:24px 0">
<tr><td align="center">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden">
<tr><td style="background:${esc(brand.primaryColor)};padding:16px 24px">${logoMarkup(brand)}</td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 16px;font-size:20px;color:${esc(brand.primaryColor)}">${esc(title)}</h1>
${body}
</td></tr>
<tr><td style="padding:12px 24px;background:#f9fafb;font-size:12px;color:#6b7280">${esc(brand.name)} · Facilities platform</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

export function statTable(rows: { label: string; value: string }[], accent: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;margin:0 0 16px">
<tr>${rows
    .map(
      (r) =>
        `<td style="padding:12px;background:#f9fafb;border-radius:6px;vertical-align:top"><div style="font-size:12px;color:#6b7280">${esc(r.label)}</div><div style="font-size:20px;font-weight:700;color:${esc(accent)}">${esc(r.value)}</div></td>`,
    )
    .join('<td style="width:8px"></td>')}</tr></table>`;
}
