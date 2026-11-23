/**
 * RF01 / RNF01 — Prueba de descubrimiento con el script PowerShell real.
 * Crea un certificado autofirmado temporal en CurrentUser\My, ejecuta el inventario y lo elimina.
 * Solo se ejecuta en Windows; en otros sistemas se omite explícitamente.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { inventoryReportSchema } from '@msh/validation';

const isWindows = process.platform === 'win32';
const script = resolve(__dirname, '../../powershell/inventory/Get-CertificateInventory.ps1');
const run = (command: string) =>
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    encoding: 'utf8',
  });

(isWindows ? describe : describe.skip)('Inventario PowerShell (RF01)', () => {
  const marker = `msh-clm-test-${randomUUID()}`;
  let thumbprint = '';

  beforeAll(() => {
    thumbprint = run(
      `$c = New-SelfSignedCertificate -Subject 'CN=${marker}' -CertStoreLocation Cert:\\CurrentUser\\My -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -NotAfter (Get-Date).AddDays(20) -KeyExportPolicy NonExportable; $c.Thumbprint`,
    ).trim();
  });

  afterAll(() => {
    if (thumbprint) run(`Remove-Item -Path Cert:\\CurrentUser\\My\\${thumbprint} -DeleteKey -ErrorAction SilentlyContinue`);
  });

  it('genera un reporte válido con metadatos públicos y sin material de clave privada', () => {
    const stdout = run(`& '${script}' -StoreLocations CurrentUser -StoreNames My`);
    const report = JSON.parse(stdout);
    expect(inventoryReportSchema.safeParse(report).success).toBe(true);
    expect(report.source).toBe('POWERSHELL_AGENT');

    const cert = report.certificates.find((c: { subject: string }) => c.subject.includes(marker));
    expect(cert).toBeDefined();
    expect(cert.hasPrivateKey).toBe(true);
    expect(cert.publicKeyAlgorithm).toBe('RSA');
    expect(cert.keySizeBits).toBe(2048);
    expect(cert.signatureAlgorithm).toBe('RSASSA-PKCS1-v1_5-SHA256');
    expect(cert.thumbprintSha256).toMatch(/^[A-F0-9]{64}$/);
    expect(stdout).not.toMatch(/PRIVATE KEY|\bPFX\b|"d"\s*:/i);
  });

  it('rechaza almacenes no autorizados', () => {
    expect(() => run(`& '${script}' -StoreNames Disallowed`)).toThrow();
  });
});
