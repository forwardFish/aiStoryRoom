import {
  Body,
  Controller,
  Headers,
  Inject,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import {
  OpenNovelAdapterService,
  type OpenNovelMirrorEvent,
} from "./openovel-adapter.service";

@Controller("internal/openovel/mirror")
export class OpenNovelMirrorController {
  constructor(
    @Inject(OpenNovelAdapterService)
    private readonly adapter: OpenNovelAdapterService,
  ) {}

  @Post()
  apply(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: OpenNovelMirrorEvent,
  ) {
    assertMirrorToken(authorization);
    return this.adapter.applyMirrorEvent(body);
  }
}

function assertMirrorToken(authorization: string | undefined) {
  const expected = String(process.env.OPENOVEL_MIRROR_TOKEN || "").trim();
  const actual = String(authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!expected || !actual || !sameSecret(expected, actual)) {
    throw new UnauthorizedException({
      code: "OPENOVEL_MIRROR_UNAUTHORIZED",
      message: "The OpenNovel mirror token is missing or invalid.",
    });
  }
}

function sameSecret(expected: string, actual: string) {
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return expectedBytes.length === actualBytes.length
    && timingSafeEqual(expectedBytes, actualBytes);
}
