import { ConflictException, HttpException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import {
  OPENOVEL_ROLE_RUNTIME_MODE,
  validateRoleImpactSyncV1,
  validateRoleNarrativeInputV1,
  validateRoleNarrativeOutputV1,
  validateRoleRuntimeStatusV1,
  type RoleImpactSyncV1,
  type RoleNarrativeInputV1,
  type RoleNarrativeOutputV1,
  type RoleRuntimeStatusV1
} from "@ai-story/shared";
import type { EnsureRoleWorkspaceInputV1, RoleNarrativeRuntime } from "../continuous-story-v2/role-narrative-runtime";
import { readContinuousOpenNovelConfig } from "./continuous-openovel.config";
import { ModelCallBudget } from "./model-call-budget";

@Injectable()
export class OpenNovelRoleNarrativeAdapter implements RoleNarrativeRuntime {
  async ensureRoleWorkspace(input: EnsureRoleWorkspaceInputV1): Promise<RoleRuntimeStatusV1> {
    return this.statusRequest(input.roomId, input.roleId, {
      method: "POST",
      body: JSON.stringify({
        runtimeMode: OPENOVEL_ROLE_RUNTIME_MODE,
        worldId: input.worldId,
        storyPackageVersion: input.storyPackageVersion
      })
    });
  }

  async generateOpening(input: RoleNarrativeInputV1) {
    if (input.turnKind !== "OPENING") throw new Error("OPENOVEL_OPENING_KIND_REQUIRED");
    if (input.modelCallBudget.kind !== "NORMAL") throw new Error("OPENOVEL_OPENING_BUDGET_INVALID");
    return this.turnRequest(input);
  }

  async generateResult(input: RoleNarrativeInputV1) {
    if (input.turnKind !== "RESULT") throw new Error("OPENOVEL_RESULT_KIND_REQUIRED");
    if (input.modelCallBudget.kind === "UNAFFECTED") throw new Error("OPENOVEL_UNAFFECTED_ROLE_CALL_FORBIDDEN");
    return this.turnRequest(input);
  }

  async syncImpacts(input: RoleImpactSyncV1): Promise<RoleRuntimeStatusV1> {
    const validated = validateRoleImpactSyncV1(input);
    if (!validated.ok) throw new Error(`ROLE_IMPACT_CONTRACT_INVALID:${validated.errors.join(";")}`);
    const status = await this.statusRequest(input.roomId, input.roleId, { method: "POST", body: JSON.stringify(input) }, "/impacts");
    if (status.appliedWorldSequence !== input.appliedWorldSequence) {
      throw new ConflictException({ code: "OPENOVEL_ROLE_SEQUENCE_MISMATCH", message: "Role runtime returned a stale impact sequence" });
    }
    return status;
  }

  async getRoleRun(roomId: string, roleId: string) {
    return this.statusRequest(roomId, roleId, { method: "GET" });
  }

  private async turnRequest(input: RoleNarrativeInputV1): Promise<RoleNarrativeOutputV1> {
    const validated = validateRoleNarrativeInputV1(input);
    if (!validated.ok) throw new Error(`ROLE_NARRATIVE_CONTRACT_INVALID:${validated.errors.join(";")}`);
    const raw = await this.request(input.roomId, input.roleId, "/turns", { method: "POST", body: JSON.stringify(input) });
    const output = validateRoleNarrativeOutputV1(raw);
    if (!output.ok) throw new ServiceUnavailableException({ code: "OPENOVEL_ROLE_OUTPUT_INVALID", message: output.errors.join(";") });
    if (output.value.roomId !== input.roomId || output.value.roleId !== input.roleId || output.value.actorTurnId !== input.actorTurnId) {
      throw new ConflictException({ code: "OPENOVEL_ROLE_IDENTITY_MISMATCH", message: "Role runtime returned a different room, role, or turn" });
    }
    if (output.value.appliedWorldSequence !== (input.appliedWorldSequence ?? input.baseWorldSequence)) {
      throw new ConflictException({ code: "OPENOVEL_ROLE_SEQUENCE_MISMATCH", message: "Role runtime returned a stale world sequence" });
    }
    const budget = new ModelCallBudget(input.modelCallBudget.kind);
    if (budget.snapshot().hardLimit !== input.modelCallBudget.hardLimit || input.modelCallBudget.consumed !== 0) throw new Error("OPENOVEL_MODEL_CALL_BUDGET_INVALID");
    budget.chargeUsage(output.value.usage);
    return output.value;
  }

  private async statusRequest(roomId: string, roleId: string, init: RequestInit, suffix = "") {
    const raw = await this.request(roomId, roleId, suffix, init);
    const status = validateRoleRuntimeStatusV1(raw);
    if (!status.ok) throw new ServiceUnavailableException({ code: "OPENOVEL_ROLE_STATUS_INVALID", message: status.errors.join(";") });
    if (status.value.roomId !== roomId || status.value.roleId !== roleId) {
      throw new ConflictException({ code: "OPENOVEL_ROLE_IDENTITY_MISMATCH", message: "Role runtime returned a different room or role" });
    }
    return status.value;
  }

  private async request(roomId: string, roleId: string, suffix: string, init: RequestInit) {
    const config = readContinuousOpenNovelConfig();
    if (!config.internalToken) throw new ServiceUnavailableException({ code: "OPENOVEL_INTERNAL_TOKEN_REQUIRED", message: "Role runtime token is not configured" });
    const signal = AbortSignal.timeout(config.roleRuntimeTimeoutMs);
    let response: Response;
    try {
      response = await fetch(`${config.runtimeUrl}/internal/openovel/rooms/${encodeURIComponent(roomId)}/roles/${encodeURIComponent(roleId)}${suffix}`, {
        ...init,
        signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${config.internalToken}` }
      });
    } catch (error) {
      if (signal.aborted || (error as Error)?.name === "TimeoutError" || (error as Error)?.name === "AbortError") {
        throw new ServiceUnavailableException({ code: "OPENOVEL_ROLE_RUNTIME_TIMEOUT", message: `Role runtime exceeded ${config.roleRuntimeTimeoutMs}ms` });
      }
      throw new ServiceUnavailableException({ code: "OPENOVEL_ROLE_RUNTIME_UNAVAILABLE", message: String((error as Error)?.message || error) });
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const payload = body && typeof body === "object" ? body as Record<string, unknown> : {};
      throw new HttpException({ code: String(payload.code || payload.error || "OPENOVEL_ROLE_RUNTIME_ERROR"), message: String(payload.message || `Role runtime HTTP ${response.status}`) }, response.status);
    }
    return body;
  }
}
