import { Module } from '@nestjs/common';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import { auth } from './auth/auth.js';
import { ContentController } from './content/content.controller.js';
import { HealthController } from './health.controller.js';
import { OverviewController } from './overview/overview.controller.js';
import { PrismaService } from './prisma.service.js';
import { ProfileController } from './profile/profile.controller.js';
import { ConnectService } from './social/connect.service.js';
import { InvitationsController } from './social/invitations.controller.js';
import { SocialController } from './social/social.controller.js';
import { WorkspaceAccessGuard } from './workspaces/workspace-access.guard.js';
import { WorkspacesController } from './workspaces/workspaces.controller.js';

@Module({
  // AuthModule registers a global guard: every route requires a session
  // unless marked with @AllowAnonymous().
  imports: [AuthModule.forRoot({ auth })],
  controllers: [
    ContentController,
    HealthController,
    InvitationsController,
    OverviewController,
    ProfileController,
    SocialController,
    WorkspacesController,
  ],
  providers: [ConnectService, PrismaService, WorkspaceAccessGuard],
})
export class AppModule {}
