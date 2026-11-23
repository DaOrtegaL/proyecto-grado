/**
 * RNF04 / sección 20 — "Firma de script inválida": el verificador rechaza scripts sin firma, alterados o de firmantes no autorizados.
 * Crea un certificado de firma de código temporal en CurrentUser\My y lo elimina al finalizar. Solo Windows.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const isWindows = process.platform === 'win32';
const verifier = resolve(__dirname, '../../powershell/Test-ScriptTrust.ps1');
const ps = (command: string) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], { encoding: 'utf8' });
const verify = (file: string, thumbprint: string) =>
  spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', verifier, '-Path', file, '-TrustedThumbprints', thumbprint], { encoding: 'utf8' });

(isWindows ? describe : describe.skip)('Verificación de scripts firmados (RNF04)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'msh-sign-'));
  const signed = join(dir, 'firmado.ps1');
  let thumbprint = '';

  beforeAll(() => {
    writeFileSync(signed, "Write-Output 'script de prueba'\r\n", 'utf8');
    thumbprint = ps(`$c = New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=msh-clm-signing-test-${randomUUID()}' -CertStoreLocation Cert:\\CurrentUser\\My; $null = Set-AuthenticodeSignature -FilePath '${signed}' -Certificate $c; $c.Thumbprint`).trim().toUpperCase();
  });

  afterAll(() => {
    if (thumbprint) ps(`Remove-Item -Path Cert:\\CurrentUser\\My\\${thumbprint} -DeleteKey -ErrorAction SilentlyContinue`);
    rmSync(dir, { recursive: true, force: true });
  });

  it('acepta un script firmado por un firmante autorizado', () => {
    const r = verify(signed, thumbprint);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ trusted: true, reason: 'TRUSTED' });
  });

  it('rechaza un script modificado después de firmarse', () => {
    const tampered = join(dir, 'alterado.ps1');
    copyFileSync(signed, tampered);
    // La alteración se hace antes del bloque de firma para que el hash ya no coincida.
    writeFileSync(tampered, readFileSync(tampered, 'utf8').replace('script de prueba', 'script alterado'), 'utf8');
    const r = verify(tampered, thumbprint);
    expect(r.status).toBe(3);
    expect(JSON.parse(r.stdout).reason).toBe('SCRIPT_MODIFIED');
  });

  it('rechaza un script sin firma', () => {
    const unsigned = join(dir, 'sin-firma.ps1');
    writeFileSync(unsigned, "Write-Output 'sin firma'\r\n", 'utf8');
    const r = verify(unsigned, thumbprint);
    expect(r.status).toBe(3);
    expect(JSON.parse(r.stdout).reason).toBe('SCRIPT_NOT_SIGNED');
  });

  it('rechaza un firmante que no está en la lista autorizada', () => {
    const r = verify(signed, 'A'.repeat(40));
    expect(r.status).toBe(3);
    expect(JSON.parse(r.stdout).reason).toBe('SIGNER_NOT_TRUSTED');
  });

  it('el script de inventario del repositorio es de solo lectura incluso sin firma (no se ejecuta en terminales reales sin firma válida)', () => {
    const r = verify(resolve(__dirname, '../../powershell/inventory/Get-CertificateInventory.ps1'), thumbprint);
    expect(r.status).toBe(3);
    expect(JSON.parse(r.stdout).reason).toBe('SCRIPT_NOT_SIGNED');
  });
});
