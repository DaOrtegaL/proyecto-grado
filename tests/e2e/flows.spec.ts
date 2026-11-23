import { expect, test } from '@playwright/test';
import {
  PASSWORD, createWindow, decide, executeDeployment, goto, login, logout, renewUntilIssued, requestApproval, runInventory, scheduleDeployment, switchTo,
} from './helpers';

test.describe.configure({ mode: 'serial' });

test('E2E01 — Renovación exitosa: inventario, solicitud, emisión, aprobación, instalación, verificación y auditoría', async ({ page }) => {
  const host = 'POS-AR-001-01';
  await renewUntilIssued(page, host, 'Ventana E2E01');

  await switchTo(page, 'retailit');
  await requestApproval(page, host, 'Ventana E2E01');

  await switchTo(page, 'emisor');
  await decide(page, host, 'Aprobar');
  await expect(page.getByText('Aprobada').first()).toBeVisible();

  await switchTo(page, 'retailit');
  await scheduleDeployment(page, host);

  await switchTo(page, 'soporte');
  await executeDeployment(page, host);
  const job = page.locator('section').filter({ hasText: host }).filter({ hasText: 'Completada' }).first();
  await expect(job).toBeVisible();
  await expect(job.getByText('Correcta')).toBeVisible();

  await switchTo(page, 'auditor');
  await goto(page, 'Auditoría');
  await page.getByRole('button', { name: 'Verificar integridad' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Cadena íntegra' })).toBeVisible();
  await expect(page.getByText('Renovación completada').first()).toBeVisible();

  await switchTo(page, 'retailit');
  await goto(page, 'Gestión de renovaciones');
  await expect(page.getByRole('row').filter({ hasText: host }).getByText('Completado')).toBeVisible();
});

test('E2E02 — Rechazo: solicitud, revisión, rechazo y registro de auditoría', async ({ page }) => {
  const host = 'POS-AR-002-01';
  await renewUntilIssued(page, host, 'Ventana E2E02');
  await switchTo(page, 'retailit');
  await requestApproval(page, host, 'Ventana E2E02');

  await switchTo(page, 'emisor');
  await decide(page, host, 'Rechazar');
  await goto(page, 'Gestión de renovaciones');
  await expect(page.getByRole('row').filter({ hasText: host }).getByText('Rechazado')).toBeVisible();

  await switchTo(page, 'auditor');
  await goto(page, 'Auditoría');
  await expect(page.getByText('Decisión registrada').first()).toBeVisible();
});

test('E2E03 — Falla y reversión: instalación, falla de verificación, reversión y auditoría', async ({ page }) => {
  const host = 'POS-AR-002-03';
  await renewUntilIssued(page, host, 'Ventana E2E03');
  await switchTo(page, 'retailit');
  await requestApproval(page, host, 'Ventana E2E03');
  await switchTo(page, 'emisor');
  await decide(page, host, 'Aprobar');

  // Solo un usuario con permiso de simulación puede inyectar la falla (administrador).
  await switchTo(page, 'admin');
  await scheduleDeployment(page, host, 'Falla de verificación');
  await switchTo(page, 'soporte');
  await executeDeployment(page, host);
  const failed = page.locator('section').filter({ hasText: host }).filter({ hasText: 'Fallida' }).first();
  await expect(failed).toBeVisible();
  await expect(failed.getByText('Negativa')).toBeVisible();

  await failed.getByRole('button', { name: 'Revertir' }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('Verificación negativa durante la prueba E2E');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.locator('section').filter({ hasText: host }).filter({ hasText: 'Revertida' }).first()).toBeVisible();

  await switchTo(page, 'auditor');
  await goto(page, 'Auditoría');
  await expect(page.getByText('Reversión').first()).toBeVisible();
});

test('E2E04 — Intento no autorizado: usuario sin privilegios, bloqueo y evento de auditoría', async ({ page, request }) => {
  const res = await request.post('http://localhost:3100/api/v1/auth/login', { data: { email: 'consulta@msh.lab', password: PASSWORD } });
  const { accessToken } = await res.json();
  const blocked = await request.post('http://localhost:3100/api/v1/renewals', {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { certificateId: '11111111-1111-4111-8111-111111111111', terminalIds: ['22222222-2222-4222-8222-222222222222'] },
  });
  expect(blocked.status()).toBe(403);

  await login(page, 'consulta');
  // La interfaz no ofrece acciones de operación al rol de consulta.
  await goto(page, 'Instalaciones');
  await expect(page.getByRole('button', { name: 'Programar instalación' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ejecutar' })).toHaveCount(0);

  await switchTo(page, 'auditor');
  await goto(page, 'Auditoría');
  await expect(page.getByText('Acceso denegado').first()).toBeVisible();
});

test('E2E05 — Evaluación experimental: línea base, medición, comparación y exportación de evidencias', async ({ page }) => {
  await login(page, 'admin');
  await goto(page, 'Indicadores y análisis');

  const register = async (kind: 'Línea base' | 'Piloto', label: string) => {
    const form = page.locator('section').filter({ hasText: 'Línea base y piloto' }).first();
    await form.getByLabel('Tipo').selectOption({ label: kind });
    await form.getByLabel('Etiqueta').fill(label);
    await form.getByRole('button', { name: 'Guardar medición' }).click();
    await expect(form.getByText(label)).toBeVisible();
  };
  await register('Línea base', 'Línea base E2E');
  await register('Piloto', 'Piloto E2E');

  const compare = page.locator('section').filter({ hasText: 'Comparación' }).first();
  await compare.getByLabel('Línea base').selectOption({ label: 'Línea base E2E' });
  await compare.getByLabel('Piloto').selectOption({ label: 'Piloto E2E' });
  await expect(compare.getByText('Cobertura del inventario')).toBeVisible();
  await expect(compare.getByText(/no se atribuye causalidad/).first()).toBeVisible();
  await expect(compare.getByText(/no declara significancia/)).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent('download'), compare.getByRole('button', { name: 'Exportar observaciones pareadas' }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.csv$/);

  // Ejecuta un escenario del simulador y verifica la evidencia exportable.
  await goto(page, 'Simulador de laboratorio');
  await page.getByRole('row').filter({ hasText: 'S04' }).getByRole('button', { name: 'Ejecutar' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'S04' }).getByText('Aprobada')).toBeVisible();
  await goto(page, 'Evidencia y trazabilidad');
  await expect(page.getByText('El nivel TRL no se declara').first()).toBeVisible();
  const [runDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'MD' }).first().click()]);
  expect(runDownload.suggestedFilename()).toMatch(/\.md$/);
  await logout(page);
});
