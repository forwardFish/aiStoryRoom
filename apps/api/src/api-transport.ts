import { ArgumentsHost, Catch, CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";

const defaultCode: Record<number, string> = {
  400: "VALIDATION_ERROR",
  401: "AUTHENTICATION_REQUIRED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  422: "UNPROCESSABLE_ENTITY",
  429: "RATE_LIMITED",
  502: "UPSTREAM_FAILURE",
  503: "SERVICE_UNAVAILABLE"
};

@Catch()
export class ApiContractExceptionFilter {
  private readonly logger = new Logger(ApiContractExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    const request = host.switchToHttp().getRequest();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = exception instanceof HttpException ? exception.getResponse() : null;
    const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const message = typeof raw === "string"
      ? raw
      : typeof source.message === "string"
        ? source.message
        : defaultCode[status] || "INTERNAL_ERROR";
    const details = source.details ?? (typeof raw === "string" ? undefined : Object.keys(source).length ? source : undefined);
    const body: Record<string, unknown> = {
      code: typeof source.code === "string" ? source.code : defaultCode[status] || "INTERNAL_ERROR",
      message,
      details: details ?? null
    };
    if (typeof source.currentVersion === "number") body.currentVersion = source.currentVersion;
    if (typeof source.expectedVersion === "number") body.expectedVersion = source.expectedVersion;
    if (typeof source.retryAfterMs === "number") body.retryAfterMs = source.retryAfterMs;
    if (!(exception instanceof HttpException)) {
      const diagnostic = exception instanceof Error ? exception.stack || exception.message : String(exception);
      this.logger.error(`Unhandled API failure for ${request.method} ${request.url}: ${diagnostic}`);
    }
    response.status(status).json(body);
  }
}

@Injectable()
export class V4WriteRateLimitGuard implements CanActivate {
  private readonly requests = new Map<string, { startedAt: number; count: number }>();

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const path = String(request.path || request.url || "");
    if (request.method !== "POST" || !path.includes("/v4/")) return true;
    if (isPresenceHeartbeatRequest(request.method, path)) return true;
    const limit = Math.max(1, Math.floor(Number(process.env.API_WRITE_RATE_LIMIT_PER_MINUTE || 120)));
    const now = Date.now();
    const key = String(request.ip || request.socket?.remoteAddress || "unknown");
    const previous = this.requests.get(key);
    const bucket = previous && now - previous.startedAt < 60_000 ? previous : { startedAt: now, count: 0 };
    bucket.count += 1;
    this.requests.set(key, bucket);
    if (bucket.count <= limit) return true;
    throw new HttpException({
      code: "RATE_LIMITED",
      message: "too many write requests; retry later",
      details: { limit, windowSeconds: 60 }
    }, HttpStatus.TOO_MANY_REQUESTS);
  }
}

export function isPresenceHeartbeatRequest(method: unknown, path: unknown): boolean {
  return method === "POST" && /\/v4\/rooms\/[^/]+\/presence\/heartbeat(?:\?|$)/.test(String(path || ""));
}

@Injectable()
export class PresenceHeartbeatRateLimitGuard implements CanActivate {
  private readonly sessionRequests = new Map<string, { startedAt: number; count: number }>();
  private readonly userRequests = new Map<string, { startedAt: number; count: number }>();
  private readonly ipRequests = new Map<string, { startedAt: number; count: number }>();

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const userId = String(request.user?.id || "");
    const sessionInstanceId = String(request.body?.sessionInstanceId || "");
    if (!userId || !sessionInstanceId) return true;
    const now = Date.now();
    const sessionLimit = Math.max(90, Math.floor(Number(process.env.HEARTBEAT_SESSION_RATE_LIMIT_PER_MINUTE || 90)));
    const userLimit = Math.max(240, Math.floor(Number(process.env.HEARTBEAT_USER_RATE_LIMIT_PER_MINUTE || 240)));
    const ipLimit = Math.max(600, Math.floor(Number(process.env.HEARTBEAT_IP_RATE_LIMIT_PER_MINUTE || 600)));
    const ip = String(request.ip || request.socket?.remoteAddress || "unknown");
    const checks = [
      this.consume(this.sessionRequests, `${userId}:${sessionInstanceId}`, sessionLimit, now),
      this.consume(this.userRequests, userId, userLimit, now),
      this.consume(this.ipRequests, ip, ipLimit, now)
    ];
    const retryAfterMs = Math.max(0, ...checks);
    if (retryAfterMs === 0) return true;
    response?.setHeader?.("Retry-After", String(Math.max(1, Math.ceil(retryAfterMs / 1_000))));
    throw new HttpException({
      code: "HEARTBEAT_RATE_LIMITED",
      message: "presence heartbeat rate limit exceeded; retry later",
      retryAfterMs,
      details: { sessionLimit, userLimit, ipLimit, windowSeconds: 60 }
    }, HttpStatus.TOO_MANY_REQUESTS);
  }

  private consume(store: Map<string, { startedAt: number; count: number }>, key: string, limit: number, now: number) {
    const previous = store.get(key);
    const bucket = previous && now - previous.startedAt < 60_000 ? previous : { startedAt: now, count: 0 };
    bucket.count += 1;
    store.set(key, bucket);
    return bucket.count > limit ? Math.max(1, 60_000 - (now - bucket.startedAt)) : 0;
  }
}
export function configureApiTransport(app: INestApplication) {
  const allowedOrigins = new Set(String(process.env.CORS_ALLOWED_ORIGINS || "http://127.0.0.1:5177,http://localhost:5177,http://127.0.0.1:5178,http://localhost:5178,http://127.0.0.1:5200,http://localhost:5200,https://ourmanyworlds.com,https://www.ourmanyworlds.com")
    .split(",").map((item) => item.trim()).filter(Boolean));
  app.enableCors({
    origin(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) { callback(null, !origin || allowedOrigins.has(origin)); },
    credentials: true,
    methods: ["GET", "HEAD", "POST", "OPTIONS"],
    allowedHeaders: ["content-type", "authorization", "x-mock-openid", "x-requested-with"]
  });
  app.useGlobalFilters(new ApiContractExceptionFilter());
  app.useGlobalGuards(new V4WriteRateLimitGuard());
}
