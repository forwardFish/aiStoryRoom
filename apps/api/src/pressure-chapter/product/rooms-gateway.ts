import type {
  PressureProductionBridgeV1,
  CreatePressureLobbyCommandV1,
  CreatePressureSoloShellCommandV1,
  GetPressureLobbyStatusQueryV1,
  JoinPressureLobbyCommandV1,
  LeavePressureLobbyCommandV1,
  SelectPressureSeatCommandV1,
  SetPressureReadyCommandV1,
  StartPressureRunCommandV1,
} from "../production";

/** Rooms-facing facade. It owns no state and never falls through to legacy. */
export class PressureChapterRoomsGatewayV1 implements PressureProductionBridgeV1 {
  constructor(private readonly production: PressureProductionBridgeV1) {}

  createLobby(command: Readonly<CreatePressureLobbyCommandV1>) {
    return this.production.createLobby(command);
  }

  createSoloShell(command: Readonly<CreatePressureSoloShellCommandV1>) {
    return this.production.createSoloShell(command);
  }

  join(command: Readonly<JoinPressureLobbyCommandV1>) {
    return this.production.join(command);
  }

  selectRole(command: Readonly<SelectPressureSeatCommandV1>) {
    return this.production.selectRole(command);
  }

  ready(command: Readonly<SetPressureReadyCommandV1>) {
    return this.production.ready(command);
  }

  leave(command: Readonly<LeavePressureLobbyCommandV1>) {
    return this.production.leave(command);
  }

  start(command: Readonly<StartPressureRunCommandV1>) {
    return this.production.start(command);
  }

  isPressure(runId: string) {
    return this.production.isPressure(runId);
  }

  getStatus(query: Readonly<GetPressureLobbyStatusQueryV1>) {
    return this.production.getStatus(query);
  }

  getStartStatus(runId: string) {
    return this.production.getStartStatus(runId);
  }

  getRoomProjectionStatus(query: Readonly<GetPressureLobbyStatusQueryV1>) {
    return this.production.getRoomProjectionStatus(query);
  }

  getRoomProjectionStatuses(runIds: readonly string[]) {
    return this.production.getRoomProjectionStatuses(runIds);
  }
}
