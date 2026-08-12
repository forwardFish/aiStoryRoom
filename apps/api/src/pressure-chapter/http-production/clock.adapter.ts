import type { PressureChapterHttpClockPort } from "../http/contracts";

export class SystemPressureChapterHttpClockV1
implements PressureChapterHttpClockPort {
  nowMs(): number {
    return Date.now();
  }
}
