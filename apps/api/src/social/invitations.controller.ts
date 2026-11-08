import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AllowAnonymous, Session, type UserSession } from '@thallesp/nestjs-better-auth';
import { config } from '../config.js';
import { missingFeatures } from '@adelie/platforms';
import { PrismaService } from '../prisma.service.js';
import { visibleProjectsWhere } from '../workspaces/project-visibility.js';
import {
  WorkspaceAccessGuard,
  WorkspaceRoles,
  type WorkspaceRequestContext,
} from '../workspaces/workspace-access.guard.js';
import { CONNECT_ROLES, ConnectService, PLATFORM_SLUGS, parseAccess } from './connect.service.js';
import {
  INVITATION_TTL_MS,
  generateInvitationToken,
  hashInvitationToken,
  invitationAad,
  invitationStatus,
  isInvitationToken,
} from './invitation-token.js';
import { createState, pkceFor } from './oauth-state.js';

/**
 * Connect invitations (ADR-0012): a link that lets someone connect their platform account to a
 * project without an Adelie account — a client of the agency, or the user in another browser.
 */
@Controller()
export class InvitationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly connector: ConnectService,
  ) {}

  private link(token: string): string {
    return `${config.webUrl}/connect/${token}`;
  }

  private async visibleProject(ctx: WorkspaceRequestContext, projectId: string) {
    const project = await this.prisma.client.project.findFirst({
      where: { id: projectId, ...visibleProjectsWhere(ctx) },
      select: { id: true },
    });
    if (!project) throw new NotFoundException();
  }

  // ---------- Members (signed in) ----------

  /** Creates an invitation and returns its link (valid 7 days, single use). */
  @Post('workspaces/:workspaceId/projects/:projectId/invitations')
  @UseGuards(WorkspaceAccessGuard)
  @WorkspaceRoles(...CONNECT_ROLES)
  async create(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: { platform?: string; access?: unknown; accountId?: unknown },
    @Req() request: { workspace: WorkspaceRequestContext },
    @Session() session: UserSession,
  ) {
    const { platform, adapter } = this.connector.adapterFor(body?.platform ?? '');
    const access = parseAccess(adapter, body?.access);
    await this.visibleProject(request.workspace, projectId);
    // Updating access of a connected account (ADR-0020): it must be this project's, same platform.
    let accountId: string | null = null;
    if (body?.accountId !== undefined) {
      const account =
        typeof body.accountId === 'string'
          ? await this.prisma.client.socialAccount.findFirst({
              where: {
                id: body.accountId,
                projectId,
                workspaceId: request.workspace.workspaceId,
                platform,
              },
              select: { id: true },
            })
          : null;
      if (!account) throw new NotFoundException();
      accountId = account.id;
    }
    const token = generateInvitationToken();
    const tokenHash = hashInvitationToken(token);
    const invitation = await this.prisma.client.connectInvitation.create({
      data: {
        workspaceId: request.workspace.workspaceId,
        projectId,
        platform,
        tokenHash,
        tokenEncrypted: this.connector.cipher.encrypt(token, invitationAad(tokenHash)),
        createdByUserId: session.user.id,
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
        access,
        accountId,
      },
      select: { id: true, platform: true, access: true, expiresAt: true, createdAt: true },
    });
    return { ...invitation, url: this.link(token) };
  }

  /** Pending (valid) invitations of a project, with their links to copy again. */
  @Get('workspaces/:workspaceId/projects/:projectId/invitations')
  @UseGuards(WorkspaceAccessGuard)
  @WorkspaceRoles(...CONNECT_ROLES)
  async list(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    await this.visibleProject(request.workspace, projectId);
    const invitations = await this.prisma.client.connectInvitation.findMany({
      where: {
        projectId,
        workspaceId: request.workspace.workspaceId,
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        platform: true,
        access: true,
        account: { select: { username: true, displayName: true } },
        tokenHash: true,
        tokenEncrypted: true,
        expiresAt: true,
        createdAt: true,
        createdBy: { select: { name: true, email: true } },
      },
    });
    return invitations.map(({ tokenHash, tokenEncrypted, createdBy, ...inv }) => ({
      ...inv,
      createdBy: createdBy?.name || createdBy?.email || null,
      url: this.link(this.connector.cipher.decrypt(tokenEncrypted, invitationAad(tokenHash))),
    }));
  }

  /** Revokes an invitation: its link stops working immediately. */
  @Delete('workspaces/:workspaceId/projects/:projectId/invitations/:invitationId')
  @UseGuards(WorkspaceAccessGuard)
  @WorkspaceRoles(...CONNECT_ROLES)
  async revoke(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    await this.visibleProject(request.workspace, projectId);
    const { count } = await this.prisma.client.connectInvitation.updateMany({
      where: {
        id: invitationId,
        projectId,
        workspaceId: request.workspace.workspaceId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw new NotFoundException();
    return { ok: true };
  }

  // ---------- Public (no Adelie account) ----------

  private async byToken(token: string) {
    if (!isInvitationToken(token)) throw new NotFoundException();
    const invitation = await this.prisma.client.connectInvitation.findUnique({
      where: { tokenHash: hashInvitationToken(token) },
      include: {
        project: { select: { name: true, workspace: { select: { name: true } } } },
        createdBy: { select: { name: true } },
        account: {
          select: {
            username: true,
            displayName: true,
            platform: true,
            connection: { select: { scopes: true } },
          },
        },
      },
    });
    if (!invitation) throw new NotFoundException();
    return invitation;
  }

  /** What the invitation is for — shown on the public page before anything happens. */
  @Get('invitations/:token')
  @AllowAnonymous()
  async show(@Param('token') token: string) {
    const inv = await this.byToken(token);
    return {
      status: invitationStatus(inv),
      platform: PLATFORM_SLUGS[inv.platform],
      access: inv.access,
      // Updating access of a connected account: who, and which features it gains.
      account: inv.account
        ? {
            name: inv.account.username ?? inv.account.displayName,
            features: missingFeatures(inv.account.platform, inv.account.connection.scopes),
          }
        : null,
      workspace: inv.project.workspace.name,
      project: inv.project.name,
      invitedBy: inv.createdBy?.name ?? null,
      expiresAt: inv.expiresAt,
    };
  }

  /** Starts OAuth for an invitation: returns the platform consent URL. */
  @Post('invitations/:token/start')
  @AllowAnonymous()
  async start(@Param('token') token: string) {
    const inv = await this.byToken(token);
    if (invitationStatus(inv) !== 'valid') throw new NotFoundException();
    const slug = PLATFORM_SLUGS[inv.platform];
    const { adapter } = this.connector.adapterFor(slug);
    const state = createState(
      {
        invitationId: inv.id,
        workspaceId: inv.workspaceId,
        projectId: inv.projectId,
        platform: slug,
      },
      config.auth.secret,
    );
    return {
      url: adapter.authorizeUrl(state, this.connector.redirectUri(slug), {
        pkce: pkceFor(state, config.auth.secret),
        access: inv.access === 'write' ? 'write' : 'read',
      }),
    };
  }
}
