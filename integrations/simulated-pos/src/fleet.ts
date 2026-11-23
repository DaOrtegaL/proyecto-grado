import {
  createRng,
  createSyntheticCa,
  createSyntheticLeaf,
  randomSerialHex,
  KeyKind,
  SyntheticCa,
} from './x509-factory';
import type { FailureMode, SimulatedSlot } from './simulated-pos.adapter';

export interface FleetOptions {
  seed: number;
  now: Date;
  storesPerCountry: number;
  terminalsPerStore: number;
}

export interface SyntheticCountry {
  code: string;
  name: string;
  timezone: string;
  locale: string;
}

export interface SyntheticTerminal {
  hostname: string;
  storeCode: string;
  vendor: 'NCR' | 'HP';
  model: string;
  osVersion: string;
  failureMode: FailureMode;
  slots: SimulatedSlot[];
  /** Descripción del escenario sintético asignado, útil para trazabilidad de pruebas. */
  scenario: string;
}

export interface SyntheticFleet {
  issuers: { name: string; kind: 'INTERNAL' | 'EXTERNAL'; subjectDn: string }[];
  countries: SyntheticCountry[];
  stores: { code: string; name: string; countryCode: string }[];
  terminals: SyntheticTerminal[];
}

export const COUNTRIES: SyntheticCountry[] = [
  { code: 'AR', name: 'Argentina', timezone: 'America/Argentina/Buenos_Aires', locale: 'es-AR' },
  { code: 'BR', name: 'Brasil', timezone: 'America/Sao_Paulo', locale: 'pt-BR' },
  { code: 'CL', name: 'Chile', timezone: 'America/Santiago', locale: 'es-CL' },
  { code: 'CO', name: 'Colombia', timezone: 'America/Bogota', locale: 'es-CO' },
  { code: 'MX', name: 'México', timezone: 'America/Mexico_City', locale: 'es-MX' },
  { code: 'PE', name: 'Perú', timezone: 'America/Lima', locale: 'es-PE' },
];

interface CertPlan {
  label: string;
  days: () => number;
  keyKind?: KeyKind;
  external?: boolean;
  failureMode?: FailureMode;
  noCert?: boolean;
}

/**
 * Plan cíclico de escenarios por terminal. El generador pseudoaleatorio con semilla decide
 * únicamente los valores dentro de cada banda, de modo que el reparto sea reproducible.
 */
function buildPlans(rng: () => number): CertPlan[] {
  const between = (a: number, b: number) => () => Math.round(a + rng() * (b - a));
  return [
    { label: 'Vigente', days: between(120, 700) },
    { label: 'Vigente (proveedor externo)', days: between(120, 700), keyKind: 'RSA_2048', external: true },
    { label: 'Próximo a vencer (60 días)', days: between(31, 59) },
    { label: 'Vigente', days: between(120, 700) },
    { label: 'Próximo a vencer (30 días)', days: between(16, 29) },
    { label: 'Vigente', days: between(120, 700) },
    { label: 'Crítico (7 días)', days: between(1, 6) },
    { label: 'Vigente (proveedor externo)', days: between(120, 700), keyKind: 'RSA_2048', external: true },
    { label: 'Vencido', days: between(-30, -1) },
    { label: 'Algoritmo débil (RSA 1024 / SHA-1)', days: between(120, 700), keyKind: 'RSA_1024_SHA1' },
    { label: 'Sin certificado de cliente', days: () => 0, noCert: true },
    { label: 'Inventario parcial', days: between(120, 700), failureMode: 'PARTIAL' },
    { label: 'Terminal desconectada', days: between(120, 700), failureMode: 'UNREACHABLE' },
  ];
}

export async function generateSyntheticFleet(options: FleetOptions): Promise<SyntheticFleet> {
  const rng = createRng(options.seed);
  const internalCa = await createSyntheticCa('MSH Lab Internal CA', 'MSH Laboratorio', options.now, rng);
  const externalCa = await createSyntheticCa('Proveedor Externo Lab CA', 'Proveedor Sintético', options.now, rng);
  const cas: Record<'INTERNAL' | 'EXTERNAL', SyntheticCa> = {
    INTERNAL: internalCa,
    EXTERNAL: externalCa,
  };

  const plans = buildPlans(rng);
  const fleet: SyntheticFleet = {
    issuers: [
      { name: internalCa.name, kind: 'INTERNAL', subjectDn: internalCa.subjectDn },
      { name: externalCa.name, kind: 'EXTERNAL', subjectDn: externalCa.subjectDn },
    ],
    countries: COUNTRIES,
    stores: [],
    terminals: [],
  };

  let counter = 0;
  for (const country of COUNTRIES) {
    for (let s = 1; s <= options.storesPerCountry; s++) {
      const storeCode = `${country.code}-${String(s).padStart(3, '0')}`;
      fleet.stores.push({ code: storeCode, name: `Tienda sintética ${storeCode}`, countryCode: country.code });

      for (let t = 1; t <= options.terminalsPerStore; t++) {
        const plan = plans[counter % plans.length];
        counter++;
        const vendor = t % 2 === 0 ? 'HP' : 'NCR';
        const hostname = `POS-${storeCode}-${String(t).padStart(2, '0')}`;
        const slots: SimulatedSlot[] = [
          { pem: internalCa.pem, storeLocation: 'LocalMachine', storeName: 'Root', hasPrivateKey: false },
        ];

        if (!plan.noCert) {
          const ca = cas[plan.external ? 'EXTERNAL' : 'INTERNAL'];
          const pem = await createSyntheticLeaf({
            commonName: `${hostname}.pos.msh.lab`,
            now: options.now,
            daysUntilExpiry: plan.days(),
            validityDays: 730,
            keyKind: plan.keyKind ?? 'EC_P256',
            ca,
            serialHex: randomSerialHex(rng),
          });
          slots.push({ pem, storeLocation: 'LocalMachine', storeName: 'My', hasPrivateKey: true });
        }

        fleet.terminals.push({
          hostname,
          storeCode,
          vendor,
          model: vendor === 'NCR' ? 'NCR POS 7616' : 'HP Engage One 143',
          osVersion: 'Windows 10 IoT Enterprise LTSC 2019',
          failureMode: plan.failureMode ?? 'NONE',
          slots,
          scenario: plan.label,
        });
      }
    }
  }
  return fleet;
}
