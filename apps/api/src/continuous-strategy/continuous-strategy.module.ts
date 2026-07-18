import { Global, Module } from "@nestjs/common";
import { CreditsModule } from "../credits/credits.module";
import { ActionCommandService } from "./action-command.service";
import { ActionWindowService } from "./action-window.service";
import { ContinuousStrategyContentService } from "./content.service";
import { ContinuousEventDeliveryService } from "./event-delivery.service";
import { MemberProjectionService } from "./member-projection.service";
import { RoleAgentTaskService } from "./role-agent-task.service";
import { WindowLifecycleService } from "./window-lifecycle.service";
import { WindowResolutionService } from "./window-resolution.service";

/** One process-wide continuous engine graph.  Keeping these services in a
 * shared module lets room commands, access unlocks and the independent worker
 * use the same provider contracts without creating module-local copies. */
@Global()
@Module({
  imports: [CreditsModule],
  providers: [
    ContinuousStrategyContentService,
    ContinuousEventDeliveryService,
    MemberProjectionService,
    RoleAgentTaskService,
    ActionWindowService,
    ActionCommandService,
    WindowLifecycleService,
    WindowResolutionService
  ],
  exports: [
    ContinuousStrategyContentService,
    ContinuousEventDeliveryService,
    MemberProjectionService,
    RoleAgentTaskService,
    ActionWindowService,
    ActionCommandService,
    WindowLifecycleService,
    WindowResolutionService
  ]
})
export class ContinuousStrategyModule {}
