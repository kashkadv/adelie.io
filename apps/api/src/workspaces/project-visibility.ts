import type { Prisma, WorkspaceRole } from '@adelie/db';
import type { WorkspaceRequestContext } from './workspace-access.guard.js';

/** Roles that see every project in the workspace without an assignment (ADR-0007). */
export const ALL_PROJECTS_ROLES: readonly WorkspaceRole[] = ['OWNER', 'ADMIN'];

/** Prisma filter for the projects a workspace member may see. */
export function visibleProjectsWhere(ctx: WorkspaceRequestContext): Prisma.ProjectWhereInput {
  if (ALL_PROJECTS_ROLES.includes(ctx.role)) return { workspaceId: ctx.workspaceId };
  return { workspaceId: ctx.workspaceId, members: { some: { memberId: ctx.memberId } } };
}
