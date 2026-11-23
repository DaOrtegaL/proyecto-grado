import { Controller, Get } from '@nestjs/common';
import { Public } from './common/decorators';
import { PrismaService } from './prisma/prisma.service';
import { loadEnv } from './config/env';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    const env = loadEnv();
    return { status: 'ok', database: env.MOCK_DATABASE ? 'MOCK_JSON' : 'SQLSERVER', executionMode: env.EXECUTION_MODE, labModeEnabled: env.LAB_MODE_ENABLED };
  }
}
