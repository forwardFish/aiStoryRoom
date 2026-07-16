import { Module } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { PublicResultSharingController, ResultSharingController } from "./result-sharing.controller";
import { ResultSharingService } from "./result-sharing.service";

@Module({
  controllers: [ResultSharingController, PublicResultSharingController],
  providers: [ResultSharingService, AuthGuard]
})
export class ResultSharingModule {}
