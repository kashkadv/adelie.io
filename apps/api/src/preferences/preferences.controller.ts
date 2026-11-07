import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Put,
} from '@nestjs/common';
import type { Prisma } from '@adelie/db';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import { PrismaService } from '../prisma.service.js';
import { isPreferenceKey, parsePreference } from './preferences.js';

/**
 * Interface settings of the signed-in user, the same on every device and in every project (e.g.
 * which Content columns to show, in what order). Absent key = the product's default.
 */
@Controller('me/preferences')
export class PreferencesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Session() session: UserSession) {
    const rows = await this.prisma.client.userPreference.findMany({
      where: { userId: session.user.id },
      select: { key: true, value: true },
    });
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  @Put(':key')
  async set(@Session() session: UserSession, @Param('key') key: string, @Body() body: unknown) {
    if (!isPreferenceKey(key)) throw new NotFoundException();
    const parsed = parsePreference(key, body);
    if (!parsed.ok) throw new BadRequestException(parsed.error);
    const value = parsed.value as Prisma.InputJsonValue;
    const userId = session.user.id;
    await this.prisma.client.userPreference.upsert({
      where: { userId_key: { userId, key } },
      create: { userId, key, value },
      update: { value },
    });
    return value;
  }

  /** Back to the default. */
  @Delete(':key')
  async reset(@Session() session: UserSession, @Param('key') key: string) {
    if (!isPreferenceKey(key)) throw new NotFoundException();
    await this.prisma.client.userPreference.deleteMany({
      where: { userId: session.user.id, key },
    });
    return { ok: true };
  }
}
