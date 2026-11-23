import { Global, Module } from '@nestjs/common';
import { MockPrismaClient } from '@msh/mock-db';
import { PrismaService } from './prisma.service';
import { Clock } from '../common/clock';
import { ActorsService } from '../common/actors.service';
import { loadEnv } from '../config/env';

/**
 * MOCK_DATABASE=1 usa archivos JSON (carpeta mock-database); MOCK_DATABASE=0 usa SQL Server mediante Prisma.
 * Ambos exponen la misma API, por lo que los servicios no distinguen el origen.
 */
@Global()
@Module({
  providers: [
    {
      provide: PrismaService,
      useFactory: (): PrismaService =>
        loadEnv().MOCK_DATABASE ? (new MockPrismaClient() as unknown as PrismaService) : new PrismaService(),
    },
    Clock,
    ActorsService,
  ],
  exports: [PrismaService, Clock, ActorsService],
})
export class PrismaModule {}
