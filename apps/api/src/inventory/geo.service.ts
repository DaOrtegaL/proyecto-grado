import { Injectable, NotFoundException } from '@nestjs/common';
import { classifyValidity } from '@msh/domain';
import { PrismaService } from '../prisma/prisma.service';
import { Clock } from '../common/clock';

@Injectable()
export class GeoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async listTerminals(filter: { countryCode?: string; storeId?: string }) {
    const now = this.clock.now();
    const rows = await this.prisma.terminal.findMany({
      where: {
        ...(filter.storeId ? { storeId: filter.storeId } : {}),
        ...(filter.countryCode ? { store: { country: { code: filter.countryCode } } } : {}),
      },
      orderBy: [{ store: { code: 'asc' } }, { hostname: 'asc' }],
      include: {
        model: true,
        store: { include: { country: true } },
        installations: {
          where: { status: 'PRESENT' },
          select: { certificate: { select: { notAfter: true } } },
        },
      },
    });
    return rows.map((t) => {
      const statuses = t.installations.map((i) => classifyValidity(i.certificate.notAfter, now).status);
      return {
        id: t.id,
        hostname: t.hostname,
        status: t.status,
        source: t.source,
        isSynthetic: t.isSynthetic,
        osVersion: t.osVersion,
        lastInventoryAt: t.lastInventoryAt,
        model: { vendor: t.model.vendor, name: t.model.name },
        store: { id: t.store.id, code: t.store.code, name: t.store.name },
        country: { code: t.store.country.code, name: t.store.country.name, timezone: t.store.country.timezone },
        certificates: {
          total: statuses.length,
          expired: statuses.filter((s) => s === 'EXPIRED').length,
          expiringSoon: statuses.filter((s) => s === 'EXPIRING_SOON').length,
        },
      };
    });
  }

  async terminalDetail(id: string) {
    const t = await this.prisma.terminal.findUnique({
      where: { id },
      include: {
        model: true,
        store: { include: { country: true } },
        installations: { include: { certificate: true }, orderBy: { lastSeenAt: 'desc' } },
        scans: { orderBy: { startedAt: 'desc' }, take: 10 },
        simulatedState: { select: { scenario: true, failureMode: true } },
      },
    });
    if (!t) throw new NotFoundException({ code: 'TERMINAL_NOT_FOUND', message: 'La terminal no existe.' });
    const now = this.clock.now();
    return {
      ...t,
      installations: t.installations.map((i) => ({
        id: i.id,
        storeLocation: i.storeLocation,
        storeName: i.storeName,
        status: i.status,
        hasPrivateKey: i.hasPrivateKey,
        lastSeenAt: i.lastSeenAt,
        certificate: {
          id: i.certificate.id,
          subject: i.certificate.subject,
          thumbprintSha256: i.certificate.thumbprintSha256,
          notAfter: i.certificate.notAfter,
          ...classifyValidity(i.certificate.notAfter, now),
        },
      })),
      scans: t.scans.map(({ reportJson: _omit, ...scan }) => scan),
    };
  }

  async listIssuers() {
    return this.prisma.certificateIssuer.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, kind: true, owner: { select: { id: true, name: true } } },
    });
  }

  listCountries() {
    return this.prisma.country.findMany({ orderBy: { name: 'asc' } });
  }
}
