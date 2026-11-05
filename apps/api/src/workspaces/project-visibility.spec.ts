import { describe, expect, it } from 'vitest';
import { visibleProjectsWhere } from './project-visibility.js';

const base = { workspaceId: 'ws-1', memberId: 'm-1' };

describe('visibleProjectsWhere', () => {
  it.each(['OWNER', 'ADMIN'] as const)('%s sees every project in the workspace', (role) => {
    expect(visibleProjectsWhere({ ...base, role })).toEqual({ workspaceId: 'ws-1' });
  });

  it.each(['MANAGER', 'ANALYST', 'VIEWER'] as const)('%s sees only assigned projects', (role) => {
    expect(visibleProjectsWhere({ ...base, role })).toEqual({
      workspaceId: 'ws-1',
      members: { some: { memberId: 'm-1' } },
    });
  });
});
