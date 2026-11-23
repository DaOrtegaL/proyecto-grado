/**
 * Control de acceso basado en roles (RBAC, RNF02).
 * Los códigos están en inglés; las etiquetas visibles se resuelven mediante i18n (claves `roles.*`).
 */
export const PERMISSIONS = [
  'dashboard:read',
  'geo:read',
  'certificates:read',
  'certificates:export',
  'inventory:run',
  'inventory:read',
  'alerts:read',
  'alerts:manage',
  'owners:read',
  'owners:manage',
  'audit:read',
  'audit:verify',
  'evidence:export',
  'simulator:manage',
  'users:manage',
  'admin:read',
  'security:read',
  'security:manage',
  'agents:manage',
  'renewals:read',
  'renewals:create',
  'renewals:issue',
  'approvals:read',
  'approvals:decide',
  'deployments:read',
  'deployments:schedule',
  'deployments:execute',
  'deployments:rollback',
  'maintenance:manage',
  'metrics:read',
  'metrics:manage',
  'research:read',
  'research:manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = [
  'ADMIN',
  'PKI_ADMIN',
  'ISSUER_OWNER',
  'RETAIL_IT',
  'PAYMENT_INTEGRATION',
  'STORE_SUPPORT',
  'AUDITOR',
  'VIEWER',
] as const;

export type RoleCode = (typeof ROLES)[number];

const READ_ONLY: Permission[] = [
  'dashboard:read',
  'geo:read',
  'certificates:read',
  'inventory:read',
  'alerts:read',
  'owners:read',
  'security:read',
  'renewals:read',
  'approvals:read',
  'deployments:read',
  'metrics:read',
];

/**
 * Mínimo privilegio y separación de funciones: quien solicita (Retail IT, PKI) no aprueba por
 * política; quien aprueba (responsable del emisor, Payment Integration, PKI) no ejecuta la
 * instalación; quien ejecuta (soporte de tiendas, Retail IT) no tiene permiso de aprobar.
 */
export const ROLE_PERMISSIONS: Record<RoleCode, Permission[]> = {
  ADMIN: [...PERMISSIONS],
  PKI_ADMIN: [
    ...READ_ONLY,
    'certificates:export',
    'inventory:run',
    'alerts:manage',
    'owners:manage',
    'evidence:export',
    'simulator:manage',
    'security:manage',
    'agents:manage',
    'renewals:create',
    'renewals:issue',
    'approvals:decide',
    'maintenance:manage',
    'admin:read',
    'research:read',
    'metrics:manage',
  ],
  ISSUER_OWNER: [...READ_ONLY, 'alerts:manage', 'certificates:export', 'approvals:decide'],
  RETAIL_IT: [
    ...READ_ONLY,
    'inventory:run',
    'alerts:manage',
    'certificates:export',
    'renewals:create',
    'deployments:schedule',
    'deployments:execute',
    'deployments:rollback',
  ],
  PAYMENT_INTEGRATION: [...READ_ONLY, 'alerts:manage', 'approvals:decide'],
  STORE_SUPPORT: [...READ_ONLY, 'inventory:run', 'deployments:execute', 'deployments:rollback'],
  AUDITOR: [
    ...READ_ONLY,
    'audit:read',
    'audit:verify',
    'evidence:export',
    'certificates:export',
    'research:read',
    'admin:read',
  ],
  VIEWER: [...READ_ONLY],
};
