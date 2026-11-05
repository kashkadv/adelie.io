import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  NotFoundException,
  Param,
  Patch,
  Put,
  Res,
} from '@nestjs/common';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import type { Response } from 'express';
import { PrismaService } from '../prisma.service.js';
import { parseAvatarDataUrl } from './avatar.js';
import { fullName, parseProfileUpdate, splitName } from './profile-input.js';

const PROFILE_FIELDS = {
  firstName: true,
  lastName: true,
  jobTitle: true,
  contactEmail: true,
  phone: true,
  telegram: true,
  whatsapp: true,
  viber: true,
  linkedin: true,
  timezone: true,
  workDays: true,
  workStart: true,
  workEnd: true,
  avatarUpdatedAt: true,
} as const;

/**
 * Personal settings of the signed-in user (ADR-0010). The sign-in email is read-only here;
 * the contact email is a separate, optional field.
 */
@Controller()
export class ProfileController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me/profile')
  async get(@Session() session: UserSession) {
    const user = await this.prisma.client.user.findUniqueOrThrow({
      where: { id: session.user.id },
      select: { id: true, email: true, name: true, profile: { select: PROFILE_FIELDS } },
    });
    const profile = user.profile ?? { ...splitName(user.name), workDays: [1, 2, 3, 4, 5] };
    return { id: user.id, email: user.email, name: user.name, profile };
  }

  @Patch('me/profile')
  async update(@Session() session: UserSession, @Body() body: unknown) {
    const parsed = parseProfileUpdate(body);
    if (!parsed.ok) throw new BadRequestException({ errors: parsed.errors });
    const userId = session.user.id;

    await this.prisma.client.$transaction(async (tx) => {
      const current = await tx.userProfile.findUnique({ where: { userId } });
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const initial = current ?? splitName(user.name);
      const profile = await tx.userProfile.upsert({
        where: { userId },
        create: { userId, ...initial, ...parsed.data },
        update: parsed.data,
      });
      // Keep Better Auth's display name in sync; never blank it.
      const name = fullName(profile.firstName, profile.lastName);
      if (name && name !== user.name) {
        await tx.user.update({ where: { id: userId }, data: { name } });
      }
    });
    return this.get(session);
  }

  @Put('me/avatar')
  async setAvatar(@Session() session: UserSession, @Body() body: { dataUrl?: unknown }) {
    const avatar = parseAvatarDataUrl(body?.dataUrl);
    if (!avatar.ok) throw new BadRequestException({ errors: { avatar: avatar.error } });
    const userId = session.user.id;
    const user = await this.prisma.client.user.findUniqueOrThrow({ where: { id: userId } });
    // Prisma's Bytes wants a Uint8Array over a plain ArrayBuffer (a Buffer may share a pool).
    const data = {
      avatar: new Uint8Array(avatar.data),
      avatarMime: avatar.mime,
      avatarUpdatedAt: new Date(),
    };
    await this.prisma.client.userProfile.upsert({
      where: { userId },
      create: { userId, ...splitName(user.name), ...data },
      update: data,
    });
    return { avatarUpdatedAt: data.avatarUpdatedAt };
  }

  @Delete('me/avatar')
  async removeAvatar(@Session() session: UserSession) {
    await this.prisma.client.userProfile.updateMany({
      where: { userId: session.user.id },
      data: { avatar: null, avatarMime: null, avatarUpdatedAt: null },
    });
    return { avatarUpdatedAt: null };
  }

  /**
   * Avatar image. Visible to the user and to members of workspaces they share (ADR-0010);
   * anyone else gets 404, as for a user without a photo.
   */
  @Get('users/:userId/avatar')
  @Header('Cache-Control', 'private, max-age=300')
  async avatar(
    @Session() session: UserSession,
    @Param('userId') userId: string,
    @Res() res: Response,
  ) {
    const viewer = session.user.id;
    if (viewer !== userId) {
      const shared = await this.prisma.client.workspaceMember.findFirst({
        where: { userId, workspace: { members: { some: { userId: viewer } } } },
        select: { id: true },
      });
      if (!shared) throw new NotFoundException();
    }
    const profile = await this.prisma.client.userProfile.findUnique({
      where: { userId },
      select: { avatar: true, avatarMime: true },
    });
    if (!profile?.avatar || !profile.avatarMime) throw new NotFoundException();
    res.type(profile.avatarMime).send(Buffer.from(profile.avatar));
  }
}
