import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test, { after } from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import type { PrismaService } from "../prisma.service";
import { issueAccessToken } from "./auth.service";
import { AuthenticatedUserResolver } from "./authenticated-user-resolver";

const ORIGINAL_AUTH_TOKEN_SECRET = process.env.AUTH_TOKEN_SECRET;
const TEST_SECRET = "room-lobby-authenticated-user-resolver-test-secret";
process.env.AUTH_TOKEN_SECRET = TEST_SECRET;

after(() => {
  if (ORIGINAL_AUTH_TOKEN_SECRET === undefined) {
    delete process.env.AUTH_TOKEN_SECRET;
  } else {
    process.env.AUTH_TOKEN_SECRET = ORIGINAL_AUTH_TOKEN_SECRET;
  }
});

type UserRow = {
  id: string;
  openid: string;
  email: string | null;
  emailVerifiedAt: Date | null;
  nickname: string | null;
  status: string;
};

type IdentityRow = {
  id: string;
  userId: string;
  provider: string;
};

const ACTIVE_USER: UserRow = Object.freeze({
  id: "user-authenticated-resolver",
  openid: "openid-authenticated-resolver",
  email: "resolver@example.test",
  emailVerifiedAt: new Date("2026-08-15T00:00:00.000Z"),
  nickname: "Resolver",
  status: "active",
});

const GOOGLE_IDENTITY: IdentityRow = Object.freeze({
  id: "identity-authenticated-resolver",
  userId: ACTIVE_USER.id,
  provider: "GOOGLE",
});

test("resolves a valid password session without returning the raw token", async () => {
  const { resolver, observations } = harness();
  const token = issueAccessToken(ACTIVE_USER, { authMethod: "PASSWORD" });

  const resolved = await resolver.resolveAccessToken(token);

  assert.deepEqual(resolved.user, {
    id: ACTIVE_USER.id,
    openid: ACTIVE_USER.openid,
    email: ACTIVE_USER.email,
    emailVerifiedAt: ACTIVE_USER.emailVerifiedAt,
    nickname: ACTIVE_USER.nickname,
    authMethod: "PASSWORD",
    authIdentityId: null,
  });
  assert.deepEqual(resolved.claims, {
    sub: ACTIVE_USER.id,
    openid: ACTIVE_USER.openid,
    authMethod: "PASSWORD",
  });
  assert.deepEqual(observations.userIds, [ACTIVE_USER.id]);
  assert.deepEqual(observations.identityIds, []);
  assert.equal(JSON.stringify(resolved).includes(token), false);
  assert.equal(Object.isFrozen(resolved), true);
  assert.equal(Object.isFrozen(resolved.user), true);
  assert.equal(Object.isFrozen(resolved.claims), true);
});

test("rejects an absent session before reading user state", async () => {
  const state = harness();

  for (const token of [undefined, null, "", "   "]) {
    await expectUnauthorized(
      state.resolver.resolveAccessToken(token),
      "AUTHENTICATION_REQUIRED",
    );
  }

  assert.deepEqual(state.observations.userIds, []);
  assert.deepEqual(state.observations.identityIds, []);
});

test("rejects malformed, forged, and expired tokens without leaking credentials", async () => {
  const state = harness();
  const valid = issueAccessToken(ACTIVE_USER, { authMethod: "PASSWORD" });
  const forged = `${valid.slice(0, -1)}${valid.endsWith("a") ? "b" : "a"}`;
  const expired = signClaims({
    sub: ACTIVE_USER.id,
    openid: ACTIVE_USER.openid,
    aud: "many-worlds-v4",
    authMethod: "PASSWORD",
    exp: Math.floor(Date.now() / 1_000) - 1,
  });

  for (const token of ["not-a-token", forged, expired]) {
    await expectUnauthorized(
      state.resolver.resolveAccessToken(token),
      "INVALID_TOKEN",
      [token, TEST_SECRET],
    );
  }

  assert.deepEqual(state.observations.userIds, []);
});

test("rejects a missing, mismatched, or inactive user", async () => {
  const token = issueAccessToken(ACTIVE_USER, { authMethod: "PASSWORD" });
  const candidates: Array<UserRow | null> = [
    null,
    { ...ACTIVE_USER, openid: "different-openid" },
    { ...ACTIVE_USER, status: "disabled" },
  ];

  for (const user of candidates) {
    const state = harness({ user });
    await expectUnauthorized(
      state.resolver.resolveAccessToken(token),
      "INVALID_TOKEN",
      [token],
    );
    assert.deepEqual(state.observations.userIds, [ACTIVE_USER.id]);
  }
});

test("preserves the email-verification boundary for password sessions", async () => {
  const token = issueAccessToken(ACTIVE_USER, { authMethod: "PASSWORD" });
  const state = harness({
    user: { ...ACTIVE_USER, emailVerifiedAt: null },
  });

  await expectUnauthorized(
    state.resolver.resolveAccessToken(token),
    "EMAIL_VERIFICATION_REQUIRED",
    [token],
  );
  assert.deepEqual(state.observations.identityIds, []);
});

test("resolves a Google session only through its authoritative linked identity", async () => {
  const state = harness();
  const token = issueAccessToken(ACTIVE_USER, {
    authMethod: "GOOGLE",
    authIdentityId: GOOGLE_IDENTITY.id,
  });

  const resolved = await state.resolver.resolveAccessToken(token);

  assert.equal(resolved.user.authMethod, "GOOGLE");
  assert.equal(resolved.user.authIdentityId, GOOGLE_IDENTITY.id);
  assert.equal(resolved.claims.authIdentityId, GOOGLE_IDENTITY.id);
  assert.deepEqual(state.observations.identityIds, [GOOGLE_IDENTITY.id]);
  assert.equal(JSON.stringify(resolved).includes(token), false);
});

test("rejects absent, cross-user, and non-Google linked identities", async () => {
  const token = issueAccessToken(ACTIVE_USER, {
    authMethod: "GOOGLE",
    authIdentityId: GOOGLE_IDENTITY.id,
  });
  const identities: Array<IdentityRow | null> = [
    null,
    { ...GOOGLE_IDENTITY, userId: "different-user" },
    { ...GOOGLE_IDENTITY, provider: "PASSWORD" },
  ];

  for (const identity of identities) {
    const state = harness({ identity });
    await expectUnauthorized(
      state.resolver.resolveAccessToken(token),
      "INVALID_TOKEN",
      [token],
    );
    assert.deepEqual(state.observations.identityIds, [GOOGLE_IDENTITY.id]);
  }
});

function harness(
  options: {
    user?: UserRow | null;
    identity?: IdentityRow | null;
  } = {},
) {
  const user = options.user === undefined
    ? structuredClone(ACTIVE_USER)
    : options.user;
  const identity = options.identity === undefined
    ? structuredClone(GOOGLE_IDENTITY)
    : options.identity;
  const observations = {
    userIds: [] as string[],
    identityIds: [] as string[],
  };
  const prisma = {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        observations.userIds.push(where.id);
        return user && user.id === where.id ? structuredClone(user) : null;
      },
    },
    authIdentity: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        observations.identityIds.push(where.id);
        return identity && identity.id === where.id
          ? structuredClone(identity)
          : null;
      },
    },
  } as unknown as PrismaService;

  return {
    resolver: new AuthenticatedUserResolver(prisma),
    observations,
  };
}

function signClaims(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", TEST_SECRET)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

async function expectUnauthorized(
  operation: Promise<unknown>,
  code: string,
  forbiddenValues: readonly string[] = [],
): Promise<void> {
  await assert.rejects(
    operation,
    (error: unknown) => {
      assert.equal(error instanceof UnauthorizedException, true);
      const unauthorized = error as UnauthorizedException;
      const response = unauthorized.getResponse();
      assert.equal(typeof response, "object");
      assert.equal(response !== null, true);
      assert.equal(
        (response as Record<string, unknown>).code,
        code,
      );
      const outward = `${unauthorized.message}
${JSON.stringify(response)}`;
      for (const value of forbiddenValues) {
        assert.equal(outward.includes(value), false);
      }
      return true;
    },
  );
}
