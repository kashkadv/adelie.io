import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { WorkspaceRole } from '@adelie/db';
import { PrismaService } from '../prisma.service.js';

export const WORKSPACE_ROLES_KEY = 'workspaceRoles';

/** Restricts a workspace route to the given roles. Without it any member is allowed. */
export const WorkspaceRoles = (...roles: WorkspaceRole[]) =>
  SetMetadata(WORKSPACE_ROLES_KEY, roles);

export interface WorkspaceRequestContext {
  workspaceId: string;
  memberId: string;
  role: WorkspaceRole;
}

/**
 * Tenant isolation: verifies on the server that the authenticated user is a member
 * of the workspace in `:workspaceId`. Never trust a client-supplied workspaceId.
 * Responds 404 (not 403) for non-members so workspace existence is not leaked.
 */
@Injectable()
export class WorkspaceAccessGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId: string | undefined = request.session?.user?.id;
    const workspaceId: string | undefined = request.params?.workspaceId;

    if (!userId || !workspaceId) throw new NotFoundException();

    const member = await this.prisma.client.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { id: true, role: true },
    });
    if (!member) throw new NotFoundException();

    const allowed = this.reflector.getAllAndOverride<WorkspaceRole[] | undefined>(
      WORKSPACE_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (allowed && !allowed.includes(member.role)) throw new ForbiddenException();

    request.workspace = {
      workspaceId,
      memberId: member.id,
      role: member.role,
    } satisfies WorkspaceRequestContext;
    return true;
  }
}
