/**
 * Carga datos sintéticos de laboratorio (no corresponden a infraestructura real).
 * Es idempotente: si ya existen terminales no vuelve a generar la flota.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { DEFAULT_METRIC_TARGETS, METRIC_DEFINITIONS, PERMISSIONS, ROLES, ROLE_PERMISSIONS, RoleCode } from '@msh/domain';
import { generateSyntheticFleet } from '@msh/simulated-pos';
import { MockPrismaClient } from '@msh/mock-db';

const envFile = resolve(__dirname, '../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

// Con --mock (o MOCK_DATABASE=1) los datos se escriben como archivos JSON en mock-database/.
const useMock = process.argv.includes('--mock') || process.env.MOCK_DATABASE === '1';
const reset = process.argv.includes('--reset');
const prisma: PrismaClient = useMock ? (new MockPrismaClient() as unknown as PrismaClient) : new PrismaClient();
if (useMock && reset) (prisma as unknown as MockPrismaClient).clearAll();

const ROLE_DESCRIPTIONS: Record<RoleCode, string> = {
  ADMIN: 'Administrador',
  PKI_ADMIN: 'Administrador PKI',
  ISSUER_OWNER: 'Responsable del emisor',
  RETAIL_IT: 'Retail IT',
  PAYMENT_INTEGRATION: 'Payment Integration',
  STORE_SUPPORT: 'Soporte de tiendas',
  AUDITOR: 'Auditor',
  VIEWER: 'Consulta',
};

const LAB_USERS: { email: string; name: string; role: RoleCode }[] = [
  { email: 'admin@msh.lab', name: 'Administrador de laboratorio', role: 'ADMIN' },
  { email: 'pki@msh.lab', name: 'Administrador PKI de laboratorio', role: 'PKI_ADMIN' },
  { email: 'emisor@msh.lab', name: 'Responsable de emisor de laboratorio', role: 'ISSUER_OWNER' },
  { email: 'retailit@msh.lab', name: 'Retail IT de laboratorio', role: 'RETAIL_IT' },
  { email: 'pagos@msh.lab', name: 'Payment Integration de laboratorio', role: 'PAYMENT_INTEGRATION' },
  { email: 'soporte@msh.lab', name: 'Soporte de tiendas de laboratorio', role: 'STORE_SUPPORT' },
  { email: 'auditor@msh.lab', name: 'Auditor de laboratorio', role: 'AUDITOR' },
  { email: 'consulta@msh.lab', name: 'Usuario de consulta de laboratorio', role: 'VIEWER' },
];

async function seedSecurity(): Promise<Record<string, string>> {
  for (const code of PERMISSIONS) {
    await prisma.permission.upsert({ where: { code }, update: {}, create: { code, description: code } });
  }
  for (const code of ROLES) {
    const role = await prisma.role.upsert({
      where: { code },
      update: { description: ROLE_DESCRIPTIONS[code] },
      create: { code, description: ROLE_DESCRIPTIONS[code] },
    });
    for (const permCode of ROLE_PERMISSIONS[code]) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { code: permCode } });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }

  const password = process.env.SEED_LAB_PASSWORD;
  if (!password || password.length < 12) {
    throw new Error('Defina SEED_LAB_PASSWORD (mínimo 12 caracteres) en el archivo .env.');
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const userIds: Record<string, string> = {};
  for (const u of LAB_USERS) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { email: u.email, displayName: u.name, passwordHash, isSynthetic: true },
    });
    userIds[u.email] = user.id;
    const role = await prisma.role.findUniqueOrThrow({ where: { code: u.role } });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: {},
      create: { userId: user.id, roleId: role.id },
    });
  }
  return userIds;
}

async function seedFleet(userIds: Record<string, string>): Promise<void> {
  if ((await prisma.terminal.count()) > 0) {
    console.log('Ya existen terminales; se omite la generación de la flota sintética.');
    return;
  }

  const seed = Number(process.env.SEED_RANDOM_SEED ?? 20260101);
  const now = process.env.FIXED_NOW ? new Date(process.env.FIXED_NOW) : new Date();
  console.log(`Generando flota sintética (semilla ${seed})...`);
  const fleet = await generateSyntheticFleet({
    seed,
    now,
    storesPerCountry: Number(process.env.SEED_STORES_PER_COUNTRY ?? 3),
    terminalsPerStore: Number(process.env.SEED_TERMINALS_PER_STORE ?? 3),
  });

  const pkiOwner = await prisma.certificateOwner.upsert({
    where: { email: 'equipo.pki@msh.lab' },
    update: {},
    create: { name: 'Equipo PKI interna (sintético)', email: 'equipo.pki@msh.lab', userId: userIds['pki@msh.lab'] },
  });
  const externalOwner = await prisma.certificateOwner.upsert({
    where: { email: 'proveedor.externo@msh.lab' },
    update: {},
    create: { name: 'Responsable proveedor externo (sintético)', email: 'proveedor.externo@msh.lab', userId: userIds['emisor@msh.lab'] },
  });
  for (const issuer of fleet.issuers) {
    await prisma.certificateIssuer.upsert({
      where: { subjectDn: issuer.subjectDn },
      update: {},
      create: { name: issuer.name, kind: issuer.kind, subjectDn: issuer.subjectDn, ownerId: issuer.kind === 'INTERNAL' ? pkiOwner.id : externalOwner.id },
    });
  }
  await prisma.certificatePolicy.upsert({
    where: { name: 'Autenticación de cliente POS (mTLS)' },
    update: {},
    create: { name: 'Autenticación de cliente POS (mTLS)' },
  });

  const countryIds = new Map<string, string>();
  for (const c of fleet.countries) {
    const row = await prisma.country.upsert({ where: { code: c.code }, update: {}, create: c });
    countryIds.set(c.code, row.id);
  }
  const storeIds = new Map<string, string>();
  for (const s of fleet.stores) {
    const row = await prisma.store.create({
      data: { code: s.code, name: s.name, countryId: countryIds.get(s.countryCode)!, isSynthetic: true },
    });
    storeIds.set(s.code, row.id);
  }
  const modelIds = new Map<string, string>();
  for (const t of fleet.terminals) {
    const vendor = t.vendor === 'NCR' ? 'NCR' : 'HP';
    if (!modelIds.has(t.model)) {
      const m = await prisma.terminalModel.upsert({
        where: { vendor_name: { vendor, name: t.model } },
        update: {},
        create: { vendor, name: t.model },
      });
      modelIds.set(t.model, m.id);
    }
    const terminal = await prisma.terminal.create({
      data: {
        hostname: t.hostname,
        storeId: storeIds.get(t.storeCode)!,
        modelId: modelIds.get(t.model)!,
        osVersion: t.osVersion,
        source: 'SIMULATED',
        isSynthetic: true,
      },
    });
    await prisma.simulatedTerminalState.create({
      data: { terminalId: terminal.id, failureMode: t.failureMode, scenario: t.scenario },
    });
    await prisma.simulatedCertificateSlot.createMany({
      data: t.slots.map((s) => ({ ...s, terminalId: terminal.id })),
    });
  }
  console.log(
    `Flota creada: ${fleet.countries.length} países, ${fleet.stores.length} tiendas, ${fleet.terminals.length} terminales (todas sintéticas).`,
  );
}

const TRACEABILITY: { code: string; objective: string; title: string; module: string; component: string; testCase: string | null; status: string }[] = [
  { code: 'RF01', objective: 'OE03', title: 'Inventario automatizado', module: 'Inventario', component: 'powershell/inventory/Get-CertificateInventory.ps1', testCase: 'tests/integration/powershell-inventory.spec.ts', status: 'TESTED' },
  { code: 'RF02', objective: 'OE03', title: 'Inventario regional centralizado', module: 'Inventario', component: 'InventoryController, TerminalsPage, CertificatesPage', testCase: 'apps/api/src/flow.mock.spec.ts', status: 'TESTED' },
  { code: 'RF03', objective: 'OE03', title: 'Asignación de responsables', module: 'Responsables', component: 'OwnersService, resolveOwnerId', testCase: 'apps/api/src/flow.full.spec.ts', status: 'TESTED' },
  { code: 'RF04', objective: 'OE03', title: 'Clasificación de vigencia', module: 'Dominio', component: 'packages/domain/certificate-status', testCase: 'packages/domain/src/domain.spec.ts', status: 'TESTED' },
  { code: 'RF05', objective: 'OE03', title: 'Alertas anticipadas', module: 'Alertas', component: 'AlertsService, MonitoringService', testCase: 'apps/api/src/flow.mock.spec.ts', status: 'TESTED' },
  { code: 'RF06', objective: 'OE03', title: 'Gestión de renovaciones', module: 'Renovaciones', component: 'RenewalsService, máquina de estados', testCase: 'apps/api/src/flow.full.spec.ts', status: 'TESTED' },
  { code: 'RF07', objective: 'OE03', title: 'Flujo de aprobación', module: 'Renovaciones', component: 'RenewalsService.decide, computeApprovalHash', testCase: 'apps/api/src/flow.full.spec.ts', status: 'TESTED' },
  { code: 'RF08', objective: 'OE03', title: 'Instalación controlada', module: 'Instalaciones', component: 'DeploymentsService (modo simulación)', testCase: 'apps/api/src/flow.full.spec.ts', status: 'TESTED' },
  { code: 'RF09', objective: 'OE03', title: 'Reversión', module: 'Instalaciones', component: 'DeploymentsService.rollback', testCase: 'apps/api/src/flow.full.spec.ts', status: 'TESTED' },
  { code: 'RF10', objective: 'OE02', title: 'Auditoría', module: 'Auditoría', component: 'AuditService, audit-chain', testCase: 'packages/domain/src/domain.spec.ts', status: 'TESTED' },
  { code: 'RF11', objective: 'OE03', title: 'Paneles y reportes', module: 'Panel de control', component: 'DashboardController, exportaciones', testCase: 'apps/api/src/flow.mock.spec.ts', status: 'IMPLEMENTED' },
  { code: 'RF12', objective: 'OE03', title: 'Detección de anomalías', module: 'Seguridad', component: 'AnomalyService, packages/domain/anomalies', testCase: 'packages/domain/src/domain2.spec.ts', status: 'TESTED' },
  { code: 'RNF01', objective: 'OE02', title: 'Protección de claves privadas', module: 'Seguridad', component: 'Esquema, script, pruebas estáticas', testCase: 'tests/security/private-key-controls.spec.ts', status: 'TESTED' },
  { code: 'RNF02', objective: 'OE02', title: 'Mínimo privilegio y RBAC', module: 'Seguridad', component: 'AuthGuard, rbac.ts', testCase: 'apps/api/src/app.wiring.spec.ts', status: 'TESTED' },
  { code: 'RNF03', objective: 'OE02', title: 'Comunicaciones cifradas y autenticación segura', module: 'Seguridad', component: 'Auth, gateway de agentes', testCase: 'apps/api/src/flow.full.spec.ts', status: 'IN_DEVELOPMENT' },
  { code: 'RNF04', objective: 'OE02', title: 'Scripts firmados y versionados', module: 'Agente', component: 'Pendiente de firma Authenticode', testCase: null, status: 'NOT_STARTED' },
  { code: 'RNF05', objective: 'OE02', title: 'Bajo consumo y ejecución controlada', module: 'Agente', component: 'Script de solo lectura', testCase: null, status: 'IN_DEVELOPMENT' },
  { code: 'RNF06', objective: 'OE02', title: 'Trazabilidad e integridad', module: 'Auditoría', component: 'Cadena de hash', testCase: 'packages/domain/src/domain.spec.ts', status: 'TESTED' },
  { code: 'RNF07', objective: 'OE02', title: 'Escalabilidad regional', module: 'API', component: 'Paginación y filtros en servidor', testCase: null, status: 'IN_DEVELOPMENT' },
  { code: 'RNF08', objective: 'OE05', title: 'Usabilidad evaluable mediante SUS', module: 'Indicadores', component: 'Cuestionario SUS', testCase: 'packages/domain/src/domain2.spec.ts', status: 'IMPLEMENTED' },
  { code: 'RNF09', objective: 'OE04', title: 'Compatibilidad NCR, HP Engage One y Windows 10 IoT', module: 'Agente', component: 'Modelos simulados; script probado en Windows con PowerShell 5.1', testCase: 'tests/integration/powershell-inventory.spec.ts', status: 'IN_DEVELOPMENT' },
  { code: 'RNF10', objective: 'OE04', title: 'Calidad ISO/IEC 25010', module: 'Transversal', component: 'TypeScript estricto, pruebas, CI', testCase: '.github/workflows/ci.yml', status: 'IN_DEVELOPMENT' },
];

/** Políticas, indicadores, metas, trazabilidad y datos de ejemplo de investigación (siempre marcados como sintéticos). */
async function seedResearchBase(): Promise<void> {
  const now = process.env.FIXED_NOW ? new Date(process.env.FIXED_NOW) : new Date();
  await prisma.user.upsert({
    where: { email: 'sistema@msh.lab' },
    update: {},
    create: {
      email: 'sistema@msh.lab',
      displayName: 'Sistema (tareas automáticas)',
      passwordHash: await bcrypt.hash(randomUUID() + randomUUID(), 12),
      isActive: false,
      isSynthetic: true,
    },
  });

  const policies = [
    { key: 'approval.separationOfDuties', value: 'true', description: 'El solicitante no puede aprobar su propia solicitud.' },
    { key: 'approval.validityHours', value: '48', description: 'Horas de vigencia de una aprobación.' },
  ];
  for (const p of policies) {
    await prisma.configurationPolicy.upsert({ where: { key: p.key }, update: {}, create: { ...p, updatedAt: now } });
  }
  for (const m of METRIC_DEFINITIONS) {
    await prisma.metricDefinition.upsert({ where: { code: m.code }, update: {}, create: m });
  }
  for (const t of DEFAULT_METRIC_TARGETS) {
    await prisma.metricTarget.upsert({
      where: { metricCode: t.metricCode },
      update: {},
      create: {
        ...t,
        justification: 'Meta preliminar de la propuesta de investigación; ajustable según el diagnóstico y las políticas autorizadas.',
        source: 'Propuesta de trabajo de grado (UNAD)',
        responsible: 'Autor del proyecto',
        setAt: now,
        approvalStatus: 'PROPOSED',
      },
    });
  }
  for (const r of TRACEABILITY) {
    await prisma.traceabilityItem.upsert({
      where: { requirementCode: r.code },
      update: {},
      create: { requirementCode: r.code, objectiveCode: r.objective, title: r.title, module: r.module, component: r.component, testCase: r.testCase, status: r.status, updatedAt: now },
    });
  }

  if ((await prisma.incident.count()) === 0) {
    const day = 86_400_000;
    const samples = [
      { severity: 'P1', title: 'Vencimiento de certificado de cliente interrumpió pagos en tienda sintética', ago: 200, countryCode: 'CO' },
      { severity: 'P2', title: 'Falla de mTLS por certificado vencido en terminal sintética', ago: 150, countryCode: 'MX' },
      { severity: 'P2', title: 'Instalación manual errónea de certificado en terminal sintética', ago: 120, countryCode: 'CL' },
    ];
    for (const s of samples) {
      const occurredAt = new Date(now.getTime() - s.ago * day);
      await prisma.incident.create({
        data: { severity: s.severity, title: s.title, occurredAt, resolvedAt: new Date(occurredAt.getTime() + 2 * 3_600_000), countryCode: s.countryCode, period: 'BASELINE', isSynthetic: true, createdAt: now },
      });
    }
  }
}

async function main(): Promise<void> {
  const userIds = await seedSecurity();
  await seedFleet(userIds);
  await seedResearchBase();
  await seedResearchBase();
  if (useMock) (prisma as unknown as MockPrismaClient).flush(true);
  console.log(
    `Datos de laboratorio cargados en ${useMock ? 'mock-database (JSON)' : 'SQL Server'}. Usuarios: *@msh.lab (contraseña definida en SEED_LAB_PASSWORD).`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
