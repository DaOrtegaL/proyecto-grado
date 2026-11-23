import { Injectable, NotFoundException } from '@nestjs/common';
import { classifyValidity } from '@msh/domain';
import { ListCertificatesQuery } from '@msh/validation';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock';
import { toCsv } from '../common/csv';
import type { AuthUser } from '../common/request-context';

const DAY = 86_400_000;

@Injectable()
export class CertificatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  private buildWhere(q: Partial<ListCertificatesQuery>, now: Date): Prisma.CertificateWhereInput {
    const where: Prisma.CertificateWhereInput = {};
    const and: Prisma.CertificateWhereInput[] = [];
    if (q.search) {
      and.push({
        OR: [{ subject: { contains: q.search } }, { thumbprintSha256: { contains: q.search.toUpperCase() } }],
      });
    }
    if (q.status) {
      const soon = new Date(now.getTime() + 60 * DAY);
      if (q.status === 'EXPIRED') and.push({ notAfter: { lte: now } });
      if (q.status === 'EXPIRING_SOON') and.push({ notAfter: { gt: now, lte: soon } });
      if (q.status === 'VALID') and.push({ notAfter: { gt: soon } });
      if (q.status === 'UNKNOWN') and.push({ id: { equals: '00000000-0000-0000-0000-000000000000' } });
    }
    if (q.issuerId) and.push({ issuerId: q.issuerId });
    if (q.storeId) and.push({ installations: { some: { terminal: { storeId: q.storeId } } } });
    if (q.countryCode) {
      and.push({ installations: { some: { terminal: { store: { country: { code: q.countryCode } } } } } });
    }
    if (and.length) where.AND = and;
    return where;
  }

  async list(q: ListCertificatesQuery) {
    const now = this.clock.now();
    const where = this.buildWhere(q, now);
    const orderBy: Prisma.CertificateOrderByWithRelationInput = { [q.sortBy]: q.sortDir };
    const [total, rows] = await Promise.all([
      this.prisma.certificate.count({ where }),
      this.prisma.certificate.findMany({
        where,
        orderBy,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          issuer: { select: { id: true, name: true, kind: true } },
          owner: { select: { id: true, name: true } },
          policy: { select: { ownerId: true } },
          installations: {
            where: { status: 'PRESENT' },
            select: {
              terminal: { select: { id: true, hostname: true, store: { select: { code: true, country: { select: { code: true } } } } } },
            },
          },
        },
      }),
    ]);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((c) => {
        const { status, daysRemaining } = classifyValidity(c.notAfter, now);
        return {
          id: c.id,
          thumbprintSha256: c.thumbprintSha256,
          subject: c.subject,
          issuerDn: c.issuerDn,
          issuer: c.issuer,
          owner: c.owner,
          notAfter: c.notAfter,
          status,
          daysRemaining,
          publicKeyAlgorithm: c.publicKeyAlgorithm,
          keySizeBits: c.keySizeBits,
          isSynthetic: c.isSynthetic,
          installations: c.installations.map((i) => ({
            terminalId: i.terminal.id,
            hostname: i.terminal.hostname,
            storeCode: i.terminal.store.code,
            countryCode: i.terminal.store.country.code,
          })),
        };
      }),
    };
  }

  async detail(id: string) {
    const c = await this.prisma.certificate.findUnique({
      where: { id },
      include: {
        issuer: { include: { owner: { select: { id: true, name: true, email: true } } } },
        owner: { select: { id: true, name: true, email: true } },
        policy: { include: { owner: { select: { id: true, name: true, email: true } } } },
        installations: {
          include: {
            terminal: {
              select: {
                id: true,
                hostname: true,
                status: true,
                store: { select: { code: true, name: true, country: { select: { code: true, name: true } } } },
              },
            },
          },
        },
        history: { orderBy: { createdAt: 'desc' }, take: 50 },
        alerts: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    if (!c) throw new NotFoundException({ code: 'CERTIFICATE_NOT_FOUND', message: 'El certificado no existe.' });
    const { status, daysRemaining } = classifyValidity(c.notAfter, this.clock.now());
    const effectiveOwner = c.owner ?? c.policy?.owner ?? c.issuer?.owner ?? null;
    return {
      ...c,
      keyUsage: JSON.parse(c.keyUsage) as string[],
      extendedKeyUsage: JSON.parse(c.extendedKeyUsage) as string[],
      status,
      daysRemaining,
      effectiveOwner,
      ownerSource: c.owner ? 'CERTIFICATE' : c.policy?.owner ? 'POLICY' : c.issuer?.owner ? 'ISSUER' : null,
    };
  }

  /** Exporta CSV con los mismos filtros del listado y registra la exportación en auditoría. */
  async exportCsv(q: ListCertificatesQuery, actor: AuthUser, correlationId: string): Promise<string> {
    const now = this.clock.now();
    const rows = await this.prisma.certificate.findMany({
      where: this.buildWhere(q, now),
      orderBy: { notAfter: 'asc' },
      take: 10_000,
      include: {
        issuer: { select: { name: true } },
        owner: { select: { name: true } },
        installations: { where: { status: 'PRESENT' }, select: { terminal: { select: { hostname: true } } } },
      },
    });
    const csv = toCsv(
      [
        'Huella SHA-256', 'Sujeto', 'Emisor', 'Responsable', 'Vence (UTC)', 'Estado', 'Días restantes',
        'Algoritmo', 'Tamaño de clave', 'Terminales', 'Origen de datos',
      ],
      rows.map((c) => {
        const v = classifyValidity(c.notAfter, now);
        return [
          c.thumbprintSha256, c.subject, c.issuer?.name ?? c.issuerDn, c.owner?.name ?? '',
          c.notAfter, v.status, v.daysRemaining, c.publicKeyAlgorithm, c.keySizeBits,
          c.installations.map((i) => i.terminal.hostname).join(' | '),
          c.isSynthetic ? 'Sintético' : 'Autorizado',
        ];
      }),
    );
    await this.audit.recordSafely({
      actorId: actor.id,
      action: 'certificates.export',
      resourceType: 'Certificate',
      newState: { format: 'csv', rows: rows.length, filters: q },
      result: 'SUCCESS',
      correlationId,
    });
    return csv;
  }
}
