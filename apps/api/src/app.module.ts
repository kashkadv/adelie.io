import { Module } from '@nestjs/common';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import { auth } from './auth/auth.js';
import { FlipperController } from './flipper/flipper.controller.js';
import { FlipperIngestController } from './flipper/flipper-ingest.controller.js';
import { CalendarController } from './calendar/calendar.controller.js';
import { ContentController } from './content/content.controller.js';
import { HealthController } from './health.controller.js';
import { GoClicksController } from './links/go-clicks.controller.js';
import { LinksController } from './links/links.controller.js';
import { OverviewController } from './overview/overview.controller.js';
import { PreferencesController } from './preferences/preferences.controller.js';
import { PrismaService } from './prisma.service.js';
import { SalesController } from './sales/sales.controller.js';
import { ProfileController } from './profile/profile.controller.js';
import { ConnectService } from './social/connect.service.js';
import { InvitationsController } from './social/invitations.controller.js';
import { SocialController } from './social/social.controller.js';
import { WorkspaceAccessGuard } from './workspaces/workspace-access.guard.js';
import { ProjectsController } from './projects/projects.controller.js';
import { WorkspacesController } from './workspaces/workspaces.controller.js';

@Module({
  // AuthModule registers a global guard: every route requires a session
  // unless marked with @AllowAnonymous().
  imports: [AuthModule.forRoot({ auth })],
  controllers: [
    CalendarController,
    ContentController,
    FlipperController,
    FlipperIngestController,
    GoClicksController,
    HealthController,
    InvitationsController,
    LinksController,
    OverviewController,
    PreferencesController,
    SalesController,
    ProfileController,
    SocialController,
    WorkspacesController,
    ProjectsController,
  ],
  providers: [ConnectService, PrismaService, WorkspaceAccessGuard],
})
export class AppModule {}
