/** RNF01 — Controles estáticos: el módulo central no debe poder almacenar ni exportar claves privadas. */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(__dirname, '../..');

function walk(dir: string, filter: (p: string) => boolean, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (['node_modules', 'dist', '.git', 'coverage'].includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, filter, out);
    else if (filter(full)) out.push(full);
  }
  return out;
}

describe('Protección de claves privadas (RNF01)', () => {
  it('el esquema de base de datos no define columnas de clave privada', () => {
    const schema = readFileSync(join(root, 'prisma/schema.prisma'), 'utf8');
    const columns = schema.split('\n').filter((l) => /^\s+\w+\s+\w+/.test(l) && !l.trim().startsWith('//'));
    const offenders = columns.filter((l) => /private.?key|pfx|pkcs12/i.test(l.trim().split(/\s+/)[0]) && !/hasPrivateKey/.test(l));
    expect(offenders).toEqual([]);
  });

  it('el script de inventario nunca accede a la clave privada ni exporta certificados', () => {
    const ps = readFileSync(join(root, 'powershell/inventory/Get-CertificateInventory.ps1'), 'utf8');
    const code = ps.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    expect(code).not.toMatch(/\.PrivateKey\b/);
    expect(code).not.toMatch(/Export-PfxCertificate|Export-Certificate|\.Export\(/);
    expect(code).not.toMatch(/GetRSAPrivateKey|GetECDsaPrivateKey/);
    expect(code).toMatch(/OpenFlags\]::ReadOnly/);
  });

  it('el código de la API no persiste ni registra PEM de claves privadas', () => {
    const files = walk(join(root, 'apps/api/src'), (p) => p.endsWith('.ts') && !p.endsWith('.spec.ts'));
    const offenders = files.filter((f) => /BEGIN (RSA |EC )?PRIVATE KEY|exportKey\(|(?<!has)PrivateKey\b/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('los datos sintéticos persistidos contienen únicamente certificados públicos', () => {
    const seed = readFileSync(join(root, 'prisma/seed/seed.ts'), 'utf8');
    expect(seed).not.toMatch(/PRIVATE KEY/);
  });
});
