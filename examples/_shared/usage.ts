export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  estimated: boolean;
};

export type TokenUsagePricing = {
  inputCostPerMillion: number;
  outputCostPerMillion: number;
};

type UsageMetadata = {
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
};

type UsageMessage = {
  role?: string;
  metadata?: unknown;
  parts?: readonly unknown[];
};

export const emptyUsage: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cost: 0,
  estimated: true,
};

export function calculateTokenUsage(
  messages: readonly UsageMessage[] | undefined,
  pricing: TokenUsagePricing,
): TokenUsage {
  if (!messages?.length) return { ...emptyUsage };

  let reportedInputTokens = 0;
  let reportedOutputTokens = 0;
  let estimatedInputTokens = 0;
  let estimatedOutputTokens = 0;

  for (const message of messages) {
    const metadata = message.metadata as UsageMetadata | undefined;
    reportedInputTokens += metadata?.usage?.inputTokens ?? 0;
    reportedOutputTokens += metadata?.usage?.outputTokens ?? 0;

    const estimatedTokens = estimateTokens(
      (message.parts ?? [])
        .map((part) => partText(part))
        .filter(Boolean)
        .join("\n"),
    );

    if (message.role === "user") {
      estimatedInputTokens += estimatedTokens;
    } else if (message.role === "assistant") {
      estimatedOutputTokens += estimatedTokens;
    }
  }

  const hasReportedUsage = reportedInputTokens > 0 || reportedOutputTokens > 0;
  const inputTokens = hasReportedUsage ? reportedInputTokens : estimatedInputTokens;
  const outputTokens = hasReportedUsage ? reportedOutputTokens : estimatedOutputTokens;
  const cost =
    (inputTokens / 1_000_000) * pricing.inputCostPerMillion +
    (outputTokens / 1_000_000) * pricing.outputCostPerMillion;

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cost,
    estimated: !hasReportedUsage,
  };
}

function estimateTokens(text: string): number {
  if (!text.trim()) return 0;
  return Math.ceil(text.length / 4);
}

function partText(part: unknown): string {
  if (typeof part !== "object" || part === null) return "";
  if ("text" in part && typeof part.text === "string") return part.text;
  return "";
}
