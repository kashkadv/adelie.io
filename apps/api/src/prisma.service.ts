import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { prisma, type Prisma } from './db.js';

@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly client: Prisma = prisma;

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
