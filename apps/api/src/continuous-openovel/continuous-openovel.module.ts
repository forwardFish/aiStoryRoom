import { Global, Module } from "@nestjs/common";
import { OpenNovelRoleNarrativeAdapter } from "./openovel-role-runtime.adapter";

@Global()
@Module({
  providers: [OpenNovelRoleNarrativeAdapter],
  exports: [OpenNovelRoleNarrativeAdapter]
})
export class ContinuousOpenNovelModule {}
