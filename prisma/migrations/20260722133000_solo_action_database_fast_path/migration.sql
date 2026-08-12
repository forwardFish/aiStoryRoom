-- Solo action credit reservation must cross the Supabase boundary once, not
-- once per wallet/grant/allocation row.  The function keeps the existing
-- credit ledger and allocation audit trail, but executes it inside Postgres.
CREATE OR REPLACE FUNCTION "reserveSoloActionCreditV1"(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_mode TEXT := COALESCE(payload->>'meteringMode', 'ACTIVE');
  v_run_id TEXT := payload->>'runId';
  v_user_id TEXT := payload->>'beneficiaryUserId';
  v_idempotency_key TEXT := payload->>'idempotencyKey';
  v_request_hash TEXT := payload->>'requestHash';
  v_action_class TEXT := payload->>'actionClass';
  v_amount INTEGER := (payload->>'amount')::INTEGER;
  v_charge_id TEXT := 'cc_' || substr(md5(random()::text || clock_timestamp()::text), 1, 28);
  v_ledger_id TEXT;
  v_remaining INTEGER;
  v_take INTEGER;
  v_allowance_available INTEGER := 0;
  v_personal_available INTEGER := 0;
  v_allowance_spent INTEGER := 0;
  v_bonus_spent INTEGER := 0;
  v_purchased_spent INTEGER := 0;
  v_existing "CreditCharge"%ROWTYPE;
  v_wallet "CreditWallet"%ROWTYPE;
  v_allowance "RunCreditAllowance"%ROWTYPE;
  v_grant "CreditGrant"%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM "CreditCharge"
  WHERE "idempotencyKey" = v_idempotency_key;

  IF FOUND THEN
    IF v_existing."requestHash" <> v_request_hash THEN
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED';
    END IF;
    RETURN jsonb_build_object(
      'kind', 'replay',
      'charge', to_jsonb(v_existing),
      'required', v_existing.amount,
      'availableBefore', v_existing.amount
    );
  END IF;

  IF v_mode = 'OFF' THEN
    RETURN jsonb_build_object('kind', 'off', 'required', v_amount, 'available', NULL, 'charge', NULL);
  END IF;

  IF v_mode = 'SHADOW' THEN
    INSERT INTO "CreditCharge" (
      id, "runId", "beneficiaryUserId", "chargeType", "actionClass", status,
      amount, "allowanceAmount", "walletAmount", "idempotencyKey", "requestHash",
      "metadataJson", "createdAt", "updatedAt"
    ) VALUES (
      v_charge_id, v_run_id, v_user_id, 'PLAYER_ACTION', v_action_class, 'SHADOW',
      v_amount, 0, 0, v_idempotency_key, v_request_hash,
      payload->'metadata', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    ) RETURNING * INTO v_existing;
    RETURN jsonb_build_object('kind', 'shadow', 'charge', to_jsonb(v_existing), 'required', v_amount, 'availableBefore', 0);
  END IF;

  SELECT COALESCE(SUM("remainingAmount"), 0)::INTEGER INTO v_allowance_available
  FROM "RunCreditAllowance"
  WHERE "runId" = v_run_id
    AND "beneficiaryUserId" = v_user_id
    AND status = 'ACTIVE'
    AND "remainingAmount" > 0
    AND ("expiresAt" IS NULL OR "expiresAt" > CURRENT_TIMESTAMP);

  SELECT COALESCE(SUM("remainingAmount"), 0)::INTEGER INTO v_personal_available
  FROM "CreditGrant"
  WHERE "userId" = v_user_id
    AND "remainingAmount" > 0
    AND (kind = 'PURCHASED' OR "expiresAt" IS NULL OR "expiresAt" > CURRENT_TIMESTAMP);

  IF v_allowance_available + v_personal_available < v_amount THEN
    RETURN jsonb_build_object(
      'kind', 'insufficient',
      'required', v_amount,
      'available', v_allowance_available + v_personal_available,
      'runAllowanceAvailable', v_allowance_available,
      'personalAvailable', v_personal_available
    );
  END IF;

  INSERT INTO "CreditCharge" (
    id, "runId", "beneficiaryUserId", "chargeType", "actionClass", status,
    amount, "allowanceAmount", "walletAmount", "idempotencyKey", "requestHash",
    "expiresAt", "metadataJson", "createdAt", "updatedAt"
  ) VALUES (
    v_charge_id, v_run_id, v_user_id, 'PLAYER_ACTION', v_action_class, 'RESERVED',
    v_amount, 0, 0, v_idempotency_key, v_request_hash,
    NULLIF(payload->>'expiresAt', '')::TIMESTAMP(3), payload->'metadata', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ) RETURNING * INTO v_existing;

  v_remaining := v_amount;
  FOR v_allowance IN
    SELECT * FROM "RunCreditAllowance"
    WHERE "runId" = v_run_id
      AND "beneficiaryUserId" = v_user_id
      AND status = 'ACTIVE'
      AND "remainingAmount" > 0
      AND ("expiresAt" IS NULL OR "expiresAt" > CURRENT_TIMESTAMP)
    ORDER BY "createdAt", id
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(v_remaining, v_allowance."remainingAmount");
    UPDATE "RunCreditAllowance"
    SET "remainingAmount" = "remainingAmount" - v_take,
        status = CASE WHEN "remainingAmount" = v_take THEN 'EXHAUSTED'::"RunCreditAllowanceStatus" ELSE status END,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE id = v_allowance.id;
    INSERT INTO "CreditChargeAllocation" (
      id, "allocationKey", "chargeId", source, "allowanceId", amount, status, "createdAt", "updatedAt"
    ) VALUES (
      'cca_' || substr(md5(random()::text || clock_timestamp()::text), 1, 27),
      v_charge_id || ':RUN_ALLOWANCE:' || v_allowance.id,
      v_charge_id, 'RUN_ALLOWANCE', v_allowance.id, v_take, 'RESERVED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    );
    v_allowance_spent := v_allowance_spent + v_take;
    v_remaining := v_remaining - v_take;
  END LOOP;

  IF v_remaining > 0 THEN
    v_ledger_id := 'cl_' || substr(md5(random()::text || clock_timestamp()::text), 1, 28);
    INSERT INTO "CreditLedger" (
      id, "userId", reason, "purchasedDelta", "bonusDelta", "debtDelta",
      "idempotencyKey", "externalRef", "metadataJson", "createdAt"
    ) VALUES (
      v_ledger_id, v_user_id, 'PLAYER_ACTION', 0, 0, 0,
      'charge-debit:' || v_idempotency_key, v_idempotency_key,
      payload->'metadata', CURRENT_TIMESTAMP
    );
    FOR v_grant IN
      SELECT * FROM "CreditGrant"
      WHERE "userId" = v_user_id
        AND "remainingAmount" > 0
        AND (kind = 'PURCHASED' OR "expiresAt" IS NULL OR "expiresAt" > CURRENT_TIMESTAMP)
      ORDER BY CASE WHEN kind = 'BONUS' THEN 0 ELSE 1 END, "expiresAt" NULLS LAST, "createdAt", id
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_take := LEAST(v_remaining, v_grant."remainingAmount");
      UPDATE "CreditGrant"
      SET "remainingAmount" = "remainingAmount" - v_take, "updatedAt" = CURRENT_TIMESTAMP
      WHERE id = v_grant.id;
      INSERT INTO "CreditSpendAllocation" (id, "ledgerId", "grantId", amount, "createdAt")
      VALUES (
        'csa_' || substr(md5(random()::text || clock_timestamp()::text), 1, 27),
        v_ledger_id, v_grant.id, v_take, CURRENT_TIMESTAMP
      );
      IF v_grant.kind = 'BONUS' THEN
        v_bonus_spent := v_bonus_spent + v_take;
      ELSE
        v_purchased_spent := v_purchased_spent + v_take;
      END IF;
      v_remaining := v_remaining - v_take;
    END LOOP;

    UPDATE "CreditLedger"
    SET "purchasedDelta" = -v_purchased_spent, "bonusDelta" = -v_bonus_spent
    WHERE id = v_ledger_id;

    SELECT * INTO v_wallet FROM "CreditWallet" WHERE "userId" = v_user_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CREDIT_WALLET_NOT_FOUND';
    END IF;
    UPDATE "CreditWallet"
    SET "purchasedBalance" = "purchasedBalance" - v_purchased_spent,
        "bonusBalance" = "bonusBalance" - v_bonus_spent,
        version = version + 1,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE id = v_wallet.id;
  END IF;

  UPDATE "CreditCharge"
  SET "allowanceAmount" = v_allowance_spent,
      "walletAmount" = v_bonus_spent + v_purchased_spent,
      "personalDebitLedgerId" = v_ledger_id,
      "updatedAt" = CURRENT_TIMESTAMP
  WHERE id = v_charge_id
  RETURNING * INTO v_existing;

  IF v_ledger_id IS NOT NULL THEN
    INSERT INTO "CreditChargeAllocation" (
      id, "allocationKey", "chargeId", source, "ledgerId", amount, status, "createdAt", "updatedAt"
    ) VALUES (
      'cca_' || substr(md5(random()::text || clock_timestamp()::text), 1, 27),
      v_charge_id || ':PERSONAL_WALLET:' || v_ledger_id,
      v_charge_id, 'PERSONAL_WALLET', v_ledger_id,
      v_bonus_spent + v_purchased_spent, 'RESERVED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    );
  END IF;

  RETURN jsonb_build_object(
    'kind', 'reserved',
    'charge', to_jsonb(v_existing),
    'required', v_amount,
    'availableBefore', v_allowance_available + v_personal_available
  );
END;
$$;
