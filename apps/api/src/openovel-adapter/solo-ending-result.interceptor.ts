import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import { catchError, from, mergeMap, of, throwError, type Observable } from "rxjs";
import type { AuthenticatedUser } from "../auth/current-user.decorator";
import { SoloEndingResultService } from "./solo-ending-result.service";

@Injectable()
export class SoloEndingResultInterceptor implements NestInterceptor {
  constructor(private readonly results: SoloEndingResultService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{
      method?: string;
      originalUrl?: string;
      url?: string;
      params?: { roomId?: string };
      user?: AuthenticatedUser;
    }>();
    const runId = String(request.params?.roomId || "").trim();
    const path = String(request.originalUrl || request.url || "");
    const target = request.method === "GET"
      && Boolean(runId)
      && /\/v4\/rooms\/[^/?]+\/result(?:\?|$)/.test(path);
    if (!target || !request.user) return next.handle();

    return next.handle().pipe(
      mergeMap((payload) => from(this.results.present(request.user!, runId, payload))),
      catchError((error) => from(
        this.results.recoverCompletedLegacy(request.user!, runId, error),
      ).pipe(
        mergeMap((recovered) => recovered === null
          ? throwError(() => error)
          : of(recovered)),
      )),
    );
  }
}
