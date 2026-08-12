-- Scope decision action ordinals to their run. The previous index omitted
-- runId and incorrectly treated equivalent decision slots in different runs
-- as duplicates.
DROP INDEX IF EXISTS "pc_action_point_seat_ordinal_key";

CREATE UNIQUE INDEX "pc_action_point_seat_ordinal_key"
ON "PressureDecisionAction"("runId", "decisionPointId", "seatId", "actionOrdinal");
