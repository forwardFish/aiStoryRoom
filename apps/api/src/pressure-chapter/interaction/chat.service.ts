import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  sha256Canonical,
  validateRunRouteSnapshotV1,
  type SeatIdV1,
} from "@ai-story/shared";
import type {
  PressureChatMessageV1,
  PressureChatPort,
  PressureInteractionAccessPort,
  SubmitPressureChatCommandV1,
} from "./contracts";
import {
  INTERACTION_ERROR_CODES as ERROR,
  failInteraction,
} from "./errors";

export function computePressureChatRequestFingerprint(
  command: Omit<SubmitPressureChatCommandV1, "subjectId" | "requestFingerprint">,
): string {
  return sha256Canonical({
    commandType: "APPEND_PRESSURE_CHAT_V1",
    routeHash: command.routeSnapshot.routeHash,
    runId: command.routeSnapshot.runId,
    chapterRuntimeId: command.chapterRuntimeId,
    chapterId: command.chapterId,
    senderSeatId: command.senderSeatId,
    visibility: command.visibility,
    targetSeatIds: orderedSeats(command.targetSeatIds),
    text: command.text,
    idempotencyKey: command.idempotencyKey,
  });
}

export class PressureChapterChatService {
  constructor(
    private readonly accessPort: PressureInteractionAccessPort,
    private readonly chatPort: PressureChatPort,
  ) {}

  async submit(raw: SubmitPressureChatCommandV1): Promise<{
    status: "APPENDED" | "REPLAYED";
    message: PressureChatMessageV1;
  }> {
    const route = validateRunRouteSnapshotV1(raw.routeSnapshot);
    const command = {
      ...raw,
      routeSnapshot: route,
      text: raw.text.trim(),
      targetSeatIds: orderedSeats(raw.targetSeatIds),
    };
    validateChat(command);
    if (computePressureChatRequestFingerprint(command) !== command.requestFingerprint) {
      failInteraction(ERROR.INPUT_FINGERPRINT_MISMATCH, "chat");
    }
    const access = await this.accessPort.load({
      subjectId: command.subjectId,
      runId: route.runId,
      chapterRuntimeId: command.chapterRuntimeId,
    });
    if (
      access.routeHash !== route.routeHash
      || access.runId !== route.runId
      || access.chapterRuntimeId !== command.chapterRuntimeId
      || access.chapterId !== command.chapterId
    ) failInteraction(ERROR.CONTEXT_MISMATCH, "chat-access");
    if (!access.controlledSeatIds.includes(command.senderSeatId)) {
      failInteraction(ERROR.SEAT_NOT_CONTROLLED, command.senderSeatId);
    }
    for (const target of command.targetSeatIds) {
      if (target !== command.senderSeatId && !access.interactableSeatIds.includes(target)) {
        failInteraction(ERROR.TARGET_FORBIDDEN, target);
      }
    }
    const prior = await this.chatPort.findByIdempotencyKey({
      runId: route.runId,
      chapterRuntimeId: command.chapterRuntimeId,
      idempotencyKey: command.idempotencyKey,
    });
    if (prior) return assertChatReplay(prior, command.requestFingerprint);
    const audienceSeatIds = chatAudience(command.senderSeatId, command.visibility, command.targetSeatIds);
    const body = {
      schemaVersion: "pressure_chapter_chat_message_v1" as const,
      messageId: `chat_${command.requestFingerprint.slice(0, 24)}`,
      runId: route.runId,
      chapterRuntimeId: command.chapterRuntimeId,
      chapterId: command.chapterId,
      senderSeatId: command.senderSeatId,
      visibility: command.visibility,
      audienceSeatIds,
      text: command.text,
      idempotencyKey: command.idempotencyKey,
      requestFingerprint: command.requestFingerprint,
    };
    const message: PressureChatMessageV1 = {
      ...body,
      messageHash: sha256Canonical(body),
    };
    const appended = await this.chatPort.appendIfAbsent(message);
    if (appended.status === "APPENDED") return { status: "APPENDED", message: appended.message };
    return assertChatReplay(appended.message, command.requestFingerprint);
  }

  async listVisible(input: {
    subjectId: string;
    runId: string;
    chapterRuntimeId: string;
    viewerSeatId: SeatIdV1;
  }): Promise<PressureChatMessageV1[]> {
    const access = await this.accessPort.load(input);
    if (!access.controlledSeatIds.includes(input.viewerSeatId)) {
      failInteraction(ERROR.SEAT_NOT_CONTROLLED, input.viewerSeatId);
    }
    const messages = await this.chatPort.list(input);
    return messages
      .map(validateStoredChat)
      .filter((message) => message.audienceSeatIds.includes(input.viewerSeatId))
      .map((message) => structuredClone(message));
  }
}

function validateChat(command: SubmitPressureChatCommandV1): void {
  if (
    command.routeSnapshot.runId.length === 0
    || command.chapterRuntimeId.length === 0
    || command.idempotencyKey.length === 0
    || command.text.length === 0
    || command.text.length > 4_000
  ) failInteraction(ERROR.CHAT_INVALID);
  if (!["PUBLIC", "PARTICIPANTS", "PRIVATE"].includes(command.visibility)) {
    failInteraction(ERROR.CHAT_INVALID, "visibility");
  }
  if (command.visibility === "PARTICIPANTS" && !command.targetSeatIds.length) {
    failInteraction(ERROR.CHAT_INVALID, "participants-empty");
  }
}

function assertChatReplay(
  prior: PressureChatMessageV1,
  requestFingerprint: string,
): { status: "REPLAYED"; message: PressureChatMessageV1 } {
  validateStoredChat(prior);
  if (prior.requestFingerprint !== requestFingerprint) {
    failInteraction(ERROR.IDEMPOTENCY_MISMATCH, prior.idempotencyKey);
  }
  return { status: "REPLAYED", message: structuredClone(prior) };
}

function validateStoredChat(message: PressureChatMessageV1): PressureChatMessageV1 {
  const { messageHash, ...body } = message;
  if (sha256Canonical(body) !== messageHash) {
    failInteraction(ERROR.CHAT_INVALID, "stored-hash");
  }
  return message;
}

function chatAudience(
  senderSeatId: SeatIdV1,
  visibility: SubmitPressureChatCommandV1["visibility"],
  targetSeatIds: SeatIdV1[],
): SeatIdV1[] {
  if (visibility === "PUBLIC") return [...PRESSURE_CHAPTER_SEAT_IDS_V1];
  if (visibility === "PRIVATE") return [senderSeatId];
  return orderedSeats([senderSeatId, ...targetSeatIds]);
}

function orderedSeats(seats: readonly SeatIdV1[]): SeatIdV1[] {
  const values = new Set(seats);
  return PRESSURE_CHAPTER_SEAT_IDS_V1.filter((seatId) => values.has(seatId));
}
