import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { configureApiTransport } from "./api-transport";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  configureApiTransport(app);
  app.setGlobalPrefix("api");
  const port = Number(process.env.API_PORT || 3001);
  await app.listen(port, "0.0.0.0");
  console.log(`AI Story Room API listening on http://localhost:${port}/api`);
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
