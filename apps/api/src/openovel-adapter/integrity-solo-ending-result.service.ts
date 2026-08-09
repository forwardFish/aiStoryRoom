import { Inject, Injectable } from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/current-user.decorator";
import { PrismaService } from "../prisma.service";
import { OpenNovelRuntimeClient } from "./openovel-runtime.client";
import { withOpenNovelResultIntegrity } from "./openovel-result-integrity";
import { SoloEndingResultService } from "./solo-ending-result.service";

@Injectable()
export class IntegritySoloEndingResultService extends SoloEndingResultService {
  constructor(
    @Inject(PrismaService) prisma: PrismaService,
    @Inject(OpenNovelRuntimeClient) runtime: OpenNovelRuntimeClient,
  ) {
    super(prisma, runtime);
  }

  override async present(
    user: AuthenticatedUser,
    runId: string,
    payload: unknown,
  ) {
    return withOpenNovelResultIntegrity(await super.present(user, runId, payload));
  }

  override async recoverCompletedLegacy(
    user: AuthenticatedUser,
    runId: string,
    error: unknown,
  ) {
    const recovered = await super.recoverCompletedLegacy(user, runId, error);
    return recovered === null ? null : withOpenNovelResultIntegrity(recovered);
  }
}
