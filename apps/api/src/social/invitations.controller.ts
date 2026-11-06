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
import { PrismaService } from '../prisma.service.js';
import { visibleProjectsWhere } from '../workspaces/project-visibility.js';
import {
  WorkspaceAccessGuard,
  WorkspaceRoles,
  type WorkspaceRequestContext,
} from '../workspaces/workspace-access.guard.js';
import { CONNECT_ROLES, ConnectService, PLATFORM_SLUGS } from './connect.service.js';
import {
  INVITATION_TTL_MS,
  generateInvitationToken,
  hashInvitationToken,
  invitationAad,
  invitationStatus,
  isInvitationToken,
} from './invitation-token.js';
import { createState } from './oauth-state.js';

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
    @Body() body: { platform?: string },
    @Req() request: { workspace: WorkspaceRequestContext },
    @Session() session: UserSession,
  ) {
    const { platform } = this.connector.adapterFor(body?.platform ?? '');
    await this.visibleProject(request.workspace, projectId);
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
      },
      select: { id: true, platform: true, expiresAt: true, createdAt: true },
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
    return { url: adapter.authorizeUrl(state, this.connector.redirectUri(slug)) };
  }
}
