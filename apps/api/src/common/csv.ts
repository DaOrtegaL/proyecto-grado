/** Neutraliza inyección de fórmulas en hojas de cálculo (OWASP CSV Injection) y escapa comillas. */
function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(escapeCell).join(','), ...rows.map((r) => r.map(escapeCell).join(','))];
  // BOM para que Excel interprete correctamente UTF-8 con tildes.
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
