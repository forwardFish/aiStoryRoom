import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { configureApiTransport } from "./api-transport";

// Supabase is the default shared test database whenever its connection is configured.
// This keeps ordinary local startup aligned with the configured test environment.
if (process.env.SUPABASE_DATABASE_URL) {
  const databaseUrl = new URL(process.env.SUPABASE_DATABASE_URL);
  // Keep the Supabase session-pool footprint small, while reserving one
  // connection for the leased story worker and one for an interactive request.
  // A single connection lets the 250ms worker poll starve resolve-async
  // transactions during a multi-player room.
  if (!databaseUrl.searchParams.has("connection_limit")) databaseUrl.searchParams.set("connection_limit", "2");
  process.env.DATABASE_URL = databaseUrl.toString();
}

async function bootstrap() {
  if (process.env.STORY_WORKER_ENABLED === undefined) process.env.STORY_WORKER_ENABLED = "true";
  const app = await NestFactory.create(AppModule, { rawBody: true });
  configureApiTransport(app);
  app.setGlobalPrefix("api");
  const port = Number(process.env.PORT || process.env.API_PORT || 3001);
  await app.listen(port, "0.0.0.0");
  console.log(`AI Story Room API listening on http://localhost:${port}/api`);
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
