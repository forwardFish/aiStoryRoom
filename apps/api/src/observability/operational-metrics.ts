type MetricKind = "counter" | "gauge";
type Labels = Record<string, string | number | boolean | null | undefined>;

type MetricDefinition = {
  help: string;
  kind: MetricKind;
  labelNames: readonly string[];
};

const definitions = {
  credit_charge_total: {
    help: "World Credits business charge state transitions.",
    kind: "counter",
    labelNames: ["type", "class", "status", "policy"]
  },
  credit_charge_amount_total: {
    help: "World Credits amount represented by charge state and funding source.",
    kind: "counter",
    labelNames: ["type", "class", "status", "source"]
  },
  credit_charge_release_total: {
    help: "World Credits charge releases by terminal reason.",
    kind: "counter",
    labelNames: ["reason"]
  },
  credit_insufficient_total: {
    help: "Rejected billable actions that had insufficient available World Credits.",
    kind: "counter",
    labelNames: ["engine", "action_class"]
  },
  credit_reclaim_total: {
    help: "Character reclaim attempts after AI control.",
    kind: "counter",
    labelNames: ["result"]
  },
  sponsorship_request_total: {
    help: "Run-scoped sponsorship request state transitions.",
    kind: "counter",
    labelNames: ["origin", "status"]
  },
  sponsorship_allowance_amount: {
    help: "Latest observed Run allowance amount by status.",
    kind: "gauge",
    labelNames: ["status"]
  },
  ai_batch_size: {
    help: "Latest observed AI decision batch size by engine.",
    kind: "gauge",
    labelNames: ["engine"]
  },
  ai_provider_attempt_total: {
    help: "Actual AI provider HTTP attempts, separate from user business charges.",
    kind: "counter",
    labelNames: ["engine", "batch_type", "result"]
  },
  ai_provider_tokens_total: {
    help: "Actual AI provider tokens, separate from user business charges.",
    kind: "counter",
    labelNames: ["engine", "batch_type", "token_type"]
  },
  credit_charge_stuck_count: {
    help: "Latest observed stale RESERVED World Credits charges after reconciliation.",
    kind: "gauge",
    labelNames: []
  }
} as const satisfies Record<string, MetricDefinition>;

type MetricName = keyof typeof definitions;

class OperationalMetrics {
  private readonly values = new Map<string, number>();

  increment(name: MetricName, labels: Labels = {}, amount = 1) {
    if (!Number.isFinite(amount) || amount < 0) return;
    const key = this.key(name, labels);
    this.values.set(key, (this.values.get(key) || 0) + amount);
  }

  set(name: MetricName, labels: Labels = {}, value: number) {
    if (!Number.isFinite(value)) return;
    this.values.set(this.key(name, labels), value);
  }

  charge(input: {
    type: string;
    actionClass: string;
    status: string;
    policy?: string | null;
    allowanceAmount?: number;
    walletAmount?: number;
  }) {
    this.increment("credit_charge_total", {
      type: input.type,
      class: input.actionClass,
      status: input.status,
      policy: input.policy || "active_action_v1"
    });
    if (Number(input.allowanceAmount || 0) > 0) {
      this.increment("credit_charge_amount_total", {
        type: input.type,
        class: input.actionClass,
        status: input.status,
        source: "RUN_ALLOWANCE"
      }, Number(input.allowanceAmount));
    }
    if (Number(input.walletAmount || 0) > 0) {
      this.increment("credit_charge_amount_total", {
        type: input.type,
        class: input.actionClass,
        status: input.status,
        source: "PERSONAL_WALLET"
      }, Number(input.walletAmount));
    }
  }

  insufficient(engine: string, actionClass: string) {
    this.increment("credit_insufficient_total", { engine, action_class: actionClass });
  }

  providerAttempt(input: { engine: string; batchType: string; result: string; inputTokens?: number; outputTokens?: number }) {
    this.increment("ai_provider_attempt_total", {
      engine: input.engine,
      batch_type: input.batchType,
      result: input.result
    });
    if (Number(input.inputTokens || 0) > 0) {
      this.increment("ai_provider_tokens_total", {
        engine: input.engine,
        batch_type: input.batchType,
        token_type: "input"
      }, Number(input.inputTokens));
    }
    if (Number(input.outputTokens || 0) > 0) {
      this.increment("ai_provider_tokens_total", {
        engine: input.engine,
        batch_type: input.batchType,
        token_type: "output"
      }, Number(input.outputTokens));
    }
  }

  renderPrometheus() {
    const lines: string[] = [];
    for (const [name, definition] of Object.entries(definitions) as Array<[MetricName, MetricDefinition]>) {
      lines.push(`# HELP ${name} ${definition.help}`);
      lines.push(`# TYPE ${name} ${definition.kind}`);
      const prefix = `${name}|`;
      const samples = [...this.values.entries()].filter(([key]) => key.startsWith(prefix)).sort(([left], [right]) => left.localeCompare(right));
      for (const [key, value] of samples) {
        const encoded = key.slice(prefix.length);
        const labelValues = encoded ? JSON.parse(encoded) as string[] : [];
        const renderedLabels = definition.labelNames.length
          ? `{${definition.labelNames.map((label, index) => `${label}="${escapeLabel(labelValues[index] || "unknown")}"`).join(",")}}`
          : "";
        lines.push(`${name}${renderedLabels} ${value}`);
      }
    }
    return `${lines.join("\n")}\n`;
  }

  resetForTests() {
    this.values.clear();
  }

  private key(name: MetricName, labels: Labels) {
    const definition = definitions[name];
    const values = definition.labelNames.map((label) => normalizeLabel(labels[label]));
    return `${name}|${values.length ? JSON.stringify(values) : ""}`;
  }
}

function normalizeLabel(value: Labels[string]) {
  const normalized = String(value ?? "unknown").trim();
  return normalized.slice(0, 120) || "unknown";
}

function escapeLabel(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll('"', '\\"');
}

export const operationalMetrics = new OperationalMetrics();

