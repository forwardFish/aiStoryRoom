import type {
  PressureWorkerSchedulerPortV1,
  PressureWorkerTimerHandleV1,
} from "./ports";

export class DefaultPressureWorkerSchedulerV1
implements PressureWorkerSchedulerPortV1 {
  schedule(
    delayMs: number,
    callback: () => void,
  ): PressureWorkerTimerHandleV1 {
    const timer = setTimeout(callback, delayMs);
    return {
      cancel: () => clearTimeout(timer),
      unref: () => timer.unref?.(),
    };
  }
}

