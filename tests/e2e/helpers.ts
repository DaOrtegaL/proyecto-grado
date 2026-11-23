import { expect, type Page } from '@playwright/test';

export const PASSWORD = process.env.SEED_LAB_PASSWORD ?? 'Laboratorio_2026_Lab';

export async function login(page: Page, who: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill(`${who}@msh.lab`);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
}

export async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page.getByRole('button', { name: 'Ingresar' })).toBeVisible();
}

/** Cambia de usuario cerrando la sesión actual (cada función del flujo la ejerce un usuario distinto). */
export async function switchTo(page: Page, who: string): Promise<void> {
  await logout(page);
  await login(page, who);
}

export async function goto(page: Page, linkName: string): Promise<void> {
  await page.getByRole('navigation', { name: 'Navegación principal' }).getByRole('link', { name: linkName }).click();
}

/** Ejecuta el inventario de una terminal desde la pantalla de tiendas y terminales. */
export async function runInventory(page: Page, hostname: string): Promise<void> {
  await goto(page, 'Tiendas y terminales');
  const row = page.getByRole('row').filter({ hasText: hostname });
  await row.getByRole('button', { name: /Ejecutar inventario/ }).click();
  await expect(page.getByRole('heading', { name: new RegExp(`Resultado del inventario — ${hostname}`) })).toBeVisible();
}

/** Crea la solicitud de renovación desde el detalle del certificado de cliente de la terminal. */
export async function requestRenewal(page: Page, hostname: string): Promise<void> {
  await goto(page, 'Inventario de certificados');
  await page.getByPlaceholder('Buscar por sujeto o huella SHA-256').fill(hostname);
  await page.getByRole('button', { name: 'Buscar' }).click();
  await page.getByRole('link', { name: new RegExp(hostname) }).first().click();
  await page.getByLabel(hostname).check();
  await page.getByLabel('Motivo').fill('Renovación preventiva E2E');
  await page.getByRole('button', { name: 'Crear solicitud' }).click();
  await expect(page.getByRole('heading', { name: 'Gestión de renovaciones' })).toBeVisible();
}

export async function openRenewal(page: Page, hostname: string): Promise<void> {
  await goto(page, 'Gestión de renovaciones');
  await page.getByRole('row').filter({ hasText: hostname }).getByRole('button', { name: 'Ver detalle' }).click();
}

export async function createWindow(page: Page, name: string): Promise<void> {
  await goto(page, 'Instalaciones');
  await page.getByLabel('Nombre').fill(name);
  await page.getByRole('button', { name: 'Nueva ventana' }).click();
  await expect(page.getByText(name).first()).toBeVisible();
}

/** Retailit inventaría y solicita; PKI emite y crea la ventana. Deja iniciada la sesión de PKI. */
export async function renewUntilIssued(page: Page, hostname: string, windowName: string): Promise<void> {
  await login(page, 'retailit');
  await runInventory(page, hostname);
  await requestRenewal(page, hostname);
  await openRenewal(page, hostname);
  await page.getByRole('button', { name: 'Solicitar emisión' }).click();
  await expect(page.getByText('Pendiente de emisión').first()).toBeVisible();

  await switchTo(page, 'pki');
  await openRenewal(page, hostname);
  await page.getByRole('button', { name: /Emitir/ }).click();
  await expect(page.getByText('Evidencia de emisión')).toBeVisible();
  await createWindow(page, windowName);
}

/** Solicitante (retailit) pide la aprobación indicando ventana y justificación. */
export async function requestApproval(page: Page, hostname: string, windowName: string): Promise<void> {
  await openRenewal(page, hostname);
  const select = page.getByLabel('Ventana de mantenimiento');
  const value = await page.locator('option', { hasText: windowName }).first().getAttribute('value');
  await select.selectOption(value!);
  await page.getByLabel('Justificación').fill('Renovación preventiva en ventana autorizada');
  await page.getByRole('button', { name: 'Solicitar aprobación' }).click();
  await expect(page.getByText('Pendiente de aprobación').first()).toBeVisible();
}

export async function decide(page: Page, hostname: string, decision: 'Aprobar' | 'Rechazar'): Promise<void> {
  await goto(page, 'Centro de aprobaciones');
  const card = page.locator('section').filter({ hasText: hostname }).first();
  await card.getByRole('button', { name: decision }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('Decisión registrada durante la prueba E2E');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar' }).click();
}

export async function scheduleDeployment(page: Page, hostname: string, failureLabel?: string): Promise<void> {
  await goto(page, 'Instalaciones');
  const form = page.locator('section').filter({ hasText: 'Programar instalación' }).first();
  const value = await form.locator('option', { hasText: hostname }).first().getAttribute('value');
  await form.getByLabel('Aprobación vigente').selectOption(value!);
  if (failureLabel) await form.getByLabel(/Inyección de fallas/).selectOption({ label: failureLabel });
  await form.getByRole('button', { name: 'Programar instalación' }).click();
  await expect(page.locator('section').filter({ hasText: hostname }).filter({ hasText: 'Programada' }).first()).toBeVisible();
}

export async function executeDeployment(page: Page, hostname: string): Promise<void> {
  await goto(page, 'Instalaciones');
  const job = page.locator('section').filter({ hasText: hostname }).filter({ hasText: 'Programada' }).first();
  await job.getByRole('button', { name: 'Ejecutar' }).click();
}