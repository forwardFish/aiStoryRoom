import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { configureApiTransport } from "./api-transport";
import { configurePressureSupabaseDatabaseV1, pressureDatabasePoolOptionsV1 } from "./pressure-chapter/production-config";
import { PRESSURE_CHAPTER_WORKER_OWNER_ENV_V1 } from "./pressure-chapter/product";
import { operationalMetrics } from "./observability/operational-metrics";
import { RoomLobbyWebSocketGateway } from "./room-lobby-realtime/room-lobby-websocket.gateway";

// Pressure is Supabase-only. Resolve and bind the selected project before
// Nest constructs Prisma or any production adapter; diagnostics never expose
// the selected URL, credentials, or project ref.
const pressureDatabasePoolOptions = pressureDatabasePoolOptionsV1(process.env, "api");
configurePressureSupabaseDatabaseV1(
  process.env,
  pressureDatabasePoolOptions,
);
operationalMetrics.set("prisma_pool_connection_limit", { process_role: "api" }, pressureDatabasePoolOptions.connectionLimit);
async function bootstrap() {
  if (process.env.STORY_WORKER_ENABLED === undefined) process.env.STORY_WORKER_ENABLED = "true";
  if (process.env[PRESSURE_CHAPTER_WORKER_OWNER_ENV_V1] === undefined) {
    process.env[PRESSURE_CHAPTER_WORKER_OWNER_ENV_V1] = "embedded_api";
  }

  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableShutdownHooks();
  configureApiTransport(app);
  app.setGlobalPrefix("api");
  app.get(RoomLobbyWebSocketGateway).attachToHttpServer(
    app.getHttpServer(),
  );
  const port = Number(process.env.PORT || process.env.API_PORT || 3001);
  await app.listen(port, "0.0.0.0");
  console.log(`AI Story Room API listening on http://localhost:${port}/api`);
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
