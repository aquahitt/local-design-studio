export interface BenchmarkCase {
  count: number;
  status: "supported" | "rejected";
  rejection?: string;
  metrics: Record<string, number>;
}
export interface BudgetConfig {
  cases: Record<string, Record<string, number>>;
  expectedRejections: Record<string, string[]>;
}

/** Missing measurements fail as well as exceeded ceilings; unsupported workloads stay explicit. */
export function budgetFailures(
  results: BenchmarkCase[],
  limits: BudgetConfig,
): string[] {
  const failures: string[] = [];
  const found = new Set<number>();
  for (const result of results) {
    found.add(result.count);
    const expected = limits.expectedRejections[String(result.count)];
    if (expected) {
      if (result.status !== "rejected")
        failures.push(`${result.count}: expected limit rejection`);
      else if (!result.rejection || !expected.includes(result.rejection))
        failures.push(
          `${result.count}: unexpected rejection ${result.rejection}`,
        );
    } else if (result.status !== "supported")
      failures.push(
        `${result.count}: unexpected rejection ${result.rejection}`,
      );
    for (const [name, limit] of Object.entries(
      limits.cases[String(result.count)] ?? {},
    )) {
      const value = result.metrics[name];
      if (!Number.isFinite(value))
        failures.push(`${result.count}.${name}: missing or non-finite metric`);
      else if (value > limit)
        failures.push(`${result.count}.${name}: ${value} > ${limit}`);
    }
  }
  for (const count of Object.keys(limits.cases))
    if (!found.has(Number(count)))
      failures.push(`${count}: missing benchmark case`);
  return failures;
}
