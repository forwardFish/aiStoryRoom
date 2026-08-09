import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import { catchError, from, mergeMap, of, throwError, type Observable } from "rxjs";
import type { AuthenticatedUser } from "../auth/current-user.decorator";
import { stripPrivateSoloEndingEvidence } from "./solo-ending-result";
import { SoloEndingResultService } from "./solo-ending-result.service";

@Injectable()
export class SoloEndingResultInterceptor implements NestInterceptor {
  constructor(private readonly results: SoloEndingResultService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{
      method?: string;
      originalUrl?: string;
      url?: string;
      params?: { roomId?: string; runId?: string };
      user?: AuthenticatedUser;
    }>();
    const path = String(request.originalUrl || request.url || "");
    const roomResultRunId = String(request.params?.roomId || "").trim();
    const directRunId = String(request.params?.runId || "").trim();
    const resultTarget = request.method === "GET"
      && Boolean(roomResultRunId)
      && /\/v4\/rooms\/[^/?]+\/result(?:\?|$)/.test(path);
    const directProjectionTarget = /\/v4\/openovel\/runs(?:\/[^/?]+)?(?:\?|$)/.test(path)
      && !/\/actions(?:\?|$)/.test(path)
      && (request.method === "GET" || request.method === "POST")
      && (Boolean(directRunId) || /\/v4\/openovel\/runs(?:\?|$)/.test(path));

    if (directProjectionTarget) {
      return next.handle().pipe(
        mergeMap((payload) => of(stripPrivateSoloEndingEvidence(payload))),
      );
    }
    if (!resultTarget || !request.user) return next.handle();

    return next.handle().pipe(
      mergeMap((payload) => from(this.results.present(
        request.user!,
        roomResultRunId,
        payload,
      ))),
      catchError((error) => from(
        this.results.recoverCompletedLegacy(request.user!, roomResultRunId, error),
      ).pipe(
        mergeMap((recovered) => recovered === null
          ? throwError(() => error)
          : of(recovered)),
      )),
    );
  }
}
