import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { classifyValidity } from '@msh/domain';
import { PrismaService } from '../prisma/prisma.service';
import { Clock } from '../common/clock';
import { RequirePermissions } from '../common/decorators';

const DAY = 86_400_000;
const BUCKETS: { key: string; min: number; max: number }[] = [
  { key: 'expired', min: -Infinity, max: 0 },
  { key: 'd0_7', min: 0, max: 7 },
  { key: 'd8_15', min: 7, max: 15 },
  { key: 'd16_30', min: 15, max: 30 },
  { key: 'd31_60', min: 30, max: 60 },
  { key: 'd61_90', min: 60, max: 90 },
  { key: 'd90_plus', min: 90, max: Infinity },
];

@ApiTags('Panel de control')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  @Get()
  @RequirePermissions('dashboard:read')
  async summary() {
    const now = this.clock.now();
    const [countries, stores, terminals, syntheticTerminals, certificates, installations, alerts, issuers, scans, policies] =
      await Promise.all([
        this.prisma.country.count(),
        this.prisma.store.count(),
        this.prisma.terminal.count(),
        this.prisma.terminal.count({ where: { isSynthetic: true } }),
        this.prisma.certificate.findMany({ select: { id: true, notAfter: true, issuerId: true, ownerId: true, policyId: true } }),
        this.prisma.certificateInstallation.findMany({
          where: { status: 'PRESENT' },
          select: { certificateId: true, terminal: { select: { store: { select: { country: { select: { code: true, name: true } } } } } } },
        }),
        this.prisma.alert.findMany({ where: { status: { in: ['OPEN', 'ACKNOWLEDGED'] } }, select: { priority: true, status: true } }),
        this.prisma.certificateIssuer.findMany({ select: { id: true, name: true, ownerId: true } }),
        this.prisma.inventoryScan.findMany({ orderBy: { startedAt: 'desc' }, take: 8, include: { terminal: { select: { hostname: true } } } }),
        this.prisma.certificatePolicy.findMany({ select: { id: true, ownerId: true } }),
      ]);

    const counts = { VALID: 0, EXPIRING_SOON: 0, EXPIRED: 0, UNKNOWN: 0 };
    const bucketCounts = new Map(BUCKETS.map((b) => [b.key, 0]));
    for (const c of certificates) {
      const { status, daysRemaining } = classifyValidity(c.notAfter, now);
      counts[status]++;
      const days = (c.notAfter.getTime() - now.getTime()) / DAY;
      const bucket = BUCKETS.find((b) => (b.key === 'expired' ? days <= 0 : days > b.min && days <= b.max));
      if (bucket && daysRemaining !== null) bucketCounts.set(bucket.key, (bucketCounts.get(bucket.key) ?? 0) + 1);
    }

    const certsByCountry = new Map<string, { name: string; certs: Set<string> }>();
    for (const i of installations) {
      const c = i.terminal.store.country;
      if (!certsByCountry.has(c.code)) certsByCountry.set(c.code, { name: c.name, certs: new Set() });
      certsByCountry.get(c.code)!.certs.add(i.certificateId);
    }

    const issuerName = new Map(issuers.map((i) => [i.id, i.name]));
    const byIssuer = new Map<string, number>();
    for (const c of certificates) {
      const name = c.issuerId ? (issuerName.get(c.issuerId) ?? 'Desconocido') : 'Emisor no registrado';
      byIssuer.set(name, (byIssuer.get(name) ?? 0) + 1);
    }

    return {
      generatedAt: now,
      dataOrigin: terminals > 0 && syntheticTerminals === terminals ? 'SYNTHETIC' : syntheticTerminals > 0 ? 'MIXED' : 'AUTHORIZED',
      totals: {
        countries,
        stores,
        terminals,
        certificates: certificates.length,
        valid: counts.VALID,
        expiringSoon: counts.EXPIRING_SOON,
        expired: counts.EXPIRED,
        unknown: counts.UNKNOWN,
        withoutOwner: certificates.filter((c) => {
          const issuerOwner = issuers.find((i) => i.id === c.issuerId)?.ownerId;
          const policyOwner = policies.find((p) => p.id === c.policyId)?.ownerId;
          return !(c.ownerId ?? policyOwner ?? issuerOwner);
        }).length,
        activeAlerts: alerts.length,
      },
      alertsByPriority: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((p) => ({
        priority: p,
        count: alerts.filter((a) => a.priority === p).length,
      })),
      expiryBuckets: BUCKETS.map((b) => ({ bucket: b.key, count: bucketCounts.get(b.key) ?? 0 })),
      certificatesByCountry: [...certsByCountry.entries()].map(([code, v]) => ({ code, name: v.name, count: v.certs.size })),
      certificatesByIssuer: [...byIssuer.entries()].map(([name, count]) => ({ name, count })),
      recentScans: scans.map((s) => ({
        id: s.id,
        hostname: s.terminal.hostname,
        status: s.status,
        startedAt: s.startedAt,
        certificatesFound: s.certificatesFound,
        alertsCreated: s.alertsCreated,
      })),
    };
  }
}
