import { ForbiddenException, NotFoundException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WorkspaceAccessGuard } from './workspace-access.guard.js';

type Member = { id: string; role: 'OWNER' | 'ADMIN' | 'ANALYST' | 'VIEWER' };

// In-memory membership table: user -> workspace -> member.
const memberships: Record<string, Record<string, Member>> = {
  'user-a': { 'ws-a': { id: 'm-a', role: 'OWNER' } },
  'user-b': { 'ws-b': { id: 'm-b', role: 'VIEWER' } },
};

const prismaMock = {
  client: {
    workspaceMember: {
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: { workspaceId_userId: { workspaceId: string; userId: string } };
        }) =>
          memberships[where.workspaceId_userId.userId]?.[where.workspaceId_userId.workspaceId] ??
          null,
      ),
    },
  },
};

function context(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function request(userId: string | undefined, workspaceId: string | undefined) {
  return {
    session: userId ? { user: { id: userId } } : undefined,
    params: { workspaceId },
  } as Record<string, unknown>;
}

describe('WorkspaceAccessGuard (tenant isolation)', () => {
  const reflector = new Reflector();
  const guard = new WorkspaceAccessGuard(prismaMock as never, reflector);

  afterEach(() => vi.restoreAllMocks());

  it('allows a member and attaches workspace context', async () => {
    const req = request('user-a', 'ws-a');
    await expect(guard.canActivate(context(req))).resolves.toBe(true);
    expect(req['workspace']).toEqual({ workspaceId: 'ws-a', memberId: 'm-a', role: 'OWNER' });
  });

  it("denies access to another tenant's workspace with 404", async () => {
    await expect(guard.canActivate(context(request('user-a', 'ws-b')))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('denies unauthenticated requests', async () => {
    await expect(guard.canActivate(context(request(undefined, 'ws-a')))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('enforces required roles', async () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['OWNER', 'ADMIN']);
    await expect(guard.canActivate(context(request('user-b', 'ws-b')))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
