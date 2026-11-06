import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { isAdapterError } from '@adelie/platforms';
import { OptionalAuth, Session, type UserSession } from '@thallesp/nestjs-better-auth';
import type { Response } from 'express';
import { config } from '../config.js';
import { PrismaService } from '../prisma.service.js';
import { visibleProjectsWhere } from '../workspaces/project-visibility.js';
import {
  WorkspaceAccessGuard,
  WorkspaceRoles,
  type WorkspaceRequestContext,
} from '../workspaces/workspace-access.guard.js';
import { CONNECT_ROLES, ConnectService, type ConnectResult } from './connect.service.js';
import { invitationStatus } from './invitation-token.js';
import { createState, verifyState, type OAuthState } from './oauth-state.js';

/**
 * Connecting social accounts to a project (ADR-0011): the signed-in flow and the shared OAuth
 * callback, which also completes connect invitations (ADR-0012).
 */
@Controller()
export class SocialController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly connector: ConnectService,
  ) {}

  private async visibleProject(ctx: WorkspaceRequestContext, projectId: string) {
    const project = await this.prisma.client.project.findFirst({
      where: { id: projectId, ...visibleProjectsWhere(ctx) },
      select: { id: true },
    });
    if (!project) throw new NotFoundException();
    return project;
  }

  /** Accounts connected to a project, with their connection status and latest sync. */
  @Get('workspaces/:workspaceId/projects/:projectId/accounts')
  @UseGuards(WorkspaceAccessGuard)
  async list(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Req() request: { workspace: WorkspaceRequestContext },
  ) {
    await this.visibleProject(request.workspace, projectId);
    const accounts = await this.prisma.client.socialAccount.findMany({
      where: { projectId, workspaceId: request.workspace.workspaceId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        platform: true,
        externalId: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        accountType: true,
        followersCount: true,
        postsCount: true,
        collectingSince: true,
        historyAvailableFrom: true,
        lastSuccessfulSyncAt: true,
        connection: { select: { status: true } },
        syncRuns: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { status: true, kind: true, errorCode: true, finishedAt: true },
        },
      },
    });
    return accounts.map(({ connection, syncRuns, ...a }) => ({
      ...a,
      status: connection.status,
      lastSync: syncRuns[0] ?? null,
    }));
  }

  /** Starts OAuth for the signed-in member: returns the platform consent URL. */
  @Post('workspaces/:workspaceId/projects/:projectId/connections/:platform')
  @UseGuards(WorkspaceAccessGuard)
  @WorkspaceRoles(...CONNECT_ROLES)
  async start(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('platform') slug: string,
    @Req() request: { workspace: WorkspaceRequestContext },
    @Session() session: UserSession,
  ) {
    const { adapter } = this.connector.adapterFor(slug);
    await this.visibleProject(request.workspace, projectId);
    const state = createState(
      {
        userId: session.user.id,
        workspaceId: request.workspace.workspaceId,
        projectId,
        platform: slug,
      },
      config.auth.secret,
    );
    return { url: adapter.authorizeUrl(state, this.connector.redirectUri(slug)) };
  }

  /**
   * OAuth redirect target (PRD §12: GET /social/:platform/callback). Signed-in flow → back to
   * /accounts; invitation flow (no Adelie session needed) → the public result page.
   */
  @Get('social/:platform/callback')
  @OptionalAuth()
  async callback(
    @Param('platform') slug: string,
    @Query() query: Record<string, string | undefined>,
    @Session() session: UserSession | null,
    @Res() res: Response,
  ) {
    const state = query['state'] ? verifyState(query['state'], config.auth.secret) : null;
    const viaInvitation = !!state?.invitationId;
    const back = (result: ConnectResult) =>
      res.redirect(
        viaInvitation
          ? `${config.webUrl}/connect/result?connect=${result}&platform=${encodeURIComponent(slug)}`
          : `${config.webUrl}/accounts?connect=${result}&platform=${encodeURIComponent(slug)}`,
      );

    if (!state || state.platform !== slug) return back('expired');
    if (!viaInvitation && (!session || state.userId !== session.user.id)) return back('expired');
    if (query['error'] || !query['code']) return back('denied');

    try {
      return back(
        viaInvitation
          ? await this.completeInvitation(slug, query['code'], state)
          : await this.completeSignedIn(slug, query['code'], state),
      );
    } catch (error) {
      // Never log tokens; adapter errors carry no secrets.
      console.error('Connect failed', slug, isAdapterError(error) ? error.kind : error);
      return back('error');
    }
  }

  private async completeSignedIn(
    slug: string,
    code: string,
    state: OAuthState,
  ): Promise<ConnectResult> {
    const { workspaceId, projectId, userId } = state;
    // Re-check access: membership or role may have changed since the flow started.
    const member = await this.prisma.client.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: userId! } },
      select: { id: true, role: true },
    });
    if (!member || !(CONNECT_ROLES as readonly string[]).includes(member.role)) return 'expired';
    await this.visibleProject({ workspaceId, memberId: member.id, role: member.role }, projectId);
    const { result } = await this.connector.connect({
      slug,
      code,
      workspaceId,
      projectId,
      connectedByUserId: userId!,
    });
    return result;
  }

  private async completeInvitation(
    slug: string,
    code: string,
    state: OAuthState,
  ): Promise<ConnectResult> {
    const invitation = await this.prisma.client.connectInvitation.findUnique({
      where: { id: state.invitationId! },
    });
    if (
      !invitation ||
      invitationStatus(invitation) !== 'valid' ||
      invitation.workspaceId !== state.workspaceId ||
      invitation.projectId !== state.projectId
    ) {
      return 'expired';
    }
    const { result, connectionId } = await this.connector.connect({
      slug,
      code,
      workspaceId: invitation.workspaceId,
      projectId: invitation.projectId,
      // Audit: the member who sent the invitation.
      connectedByUserId: invitation.createdByUserId,
    });
    if (result === 'connected') {
      // Single use. Conditional, so two parallel callbacks cannot both consume it.
      await this.prisma.client.connectInvitation.updateMany({
        where: { id: invitation.id, usedAt: null },
        data: { usedAt: new Date(), connectionId: connectionId ?? null },
      });
    }
    return result;
  }
}
