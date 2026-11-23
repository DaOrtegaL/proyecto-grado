import { generateSyntheticFleet } from './fleet';
import { SimulatedPosAdapter } from './simulated-pos.adapter';
import { TerminalUnreachableError, decideAlert } from '@msh/domain';

const NOW = new Date('2026-06-01T00:00:00Z');

describe('simulador POS', () => {
  let fleet: Awaited<ReturnType<typeof generateSyntheticFleet>>;

  beforeAll(async () => {
    fleet = await generateSyntheticFleet({
      seed: 42,
      now: NOW,
      storesPerCountry: 1,
      terminalsPerStore: 13,
    });
  });

  it('genera seis países con tiendas y terminales NCR y HP', () => {
    expect(fleet.countries).toHaveLength(6);
    expect(fleet.stores).toHaveLength(6);
    expect(new Set(fleet.terminals.map((t) => t.vendor))).toEqual(new Set(['NCR', 'HP']));
  });

  it('produce metadatos X.509 reales y nunca claves privadas', async () => {
    const terminal = fleet.terminals.find((t) => t.scenario === 'Vigente')!;
    const adapter = new SimulatedPosAdapter(
      { read: async () => ({ failureMode: terminal.failureMode, slots: terminal.slots }) },
      () => NOW,
    );
    const report = await adapter.collect({ id: 'x', hostname: terminal.hostname });
    const leaf = report.certificates.find((c) => c.storeName === 'My')!;
    expect(leaf.thumbprintSha256).toMatch(/^[A-F0-9]{64}$/);
    expect(leaf.extendedKeyUsage).toContain('clientAuth');
    expect(leaf.keySizeBits).toBe(256);
    expect(JSON.stringify(report)).not.toMatch(/PRIVATE KEY/);
  });

  it('refleja el vencimiento sintético en la decisión de alerta', async () => {
    const expiring = fleet.terminals.find((t) => t.scenario.startsWith('Próximo a vencer (30'))!;
    const adapter = new SimulatedPosAdapter(
      { read: async () => ({ failureMode: 'NONE', slots: expiring.slots }) },
      () => NOW,
    );
    const report = await adapter.collect({ id: 'x', hostname: expiring.hostname });
    const leaf = report.certificates.find((c) => c.storeName === 'My')!;
    expect(decideAlert(new Date(leaf.notAfter), NOW)?.thresholdDays).toBe(30);
  });

  it('simula terminal desconectada e inventario parcial', async () => {
    const off = fleet.terminals.find((t) => t.failureMode === 'UNREACHABLE')!;
    const adapterOff = new SimulatedPosAdapter({
      read: async () => ({ failureMode: 'UNREACHABLE', slots: off.slots }),
    });
    await expect(adapterOff.collect({ id: 'x', hostname: off.hostname })).rejects.toBeInstanceOf(
      TerminalUnreachableError,
    );

    const partial = fleet.terminals.find((t) => t.failureMode === 'PARTIAL')!;
    const adapterPartial = new SimulatedPosAdapter({
      read: async () => ({ failureMode: 'PARTIAL', slots: partial.slots }),
    });
    const report = await adapterPartial.collect({ id: 'x', hostname: partial.hostname });
    expect(report.errors.length).toBeGreaterThan(0);
    expect(report.certificates.every((c) => c.storeName === 'My')).toBe(true);
  });
});
