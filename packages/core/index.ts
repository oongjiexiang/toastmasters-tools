import { createInterface } from "readline";
import { main as fetch } from "./services/fetch";
import { main as membership } from "./services/membership";
import { logger } from "./logger";

const choices = [
  {
    label: "Fetch      — Download Basecamp progress data and snapshot to SQLite",
    main: fetch,
  },
  {
    label: "Membership — Download TI membership CSV from toastmasters.org",
    main: membership,
  },
];

console.log("\nToastmasters User Retriever\n");
choices.forEach((c, i) => console.log(`  ${i + 1}. ${c.label}`));
console.log();

const rl = createInterface({ input: process.stdin, output: process.stdout });

async function runSelection(answer: string): Promise<void> {
  rl.close();

  const tokens = answer
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
  const indices = tokens.map((t) => parseInt(t, 10) - 1);

  const invalid = indices.filter((i) => isNaN(i) || i < 0 || i >= choices.length);
  if (tokens.length === 0 || invalid.length > 0) {
    logger.error("Invalid selection. Enter one or more numbers between 1 and 2.");
    process.exit(1);
  }

  const seen = new Set<number>();
  const selected = indices.filter((i) => !seen.has(i) && seen.add(i));

  for (const idx of selected) {
    const choice = choices[idx];
    if (!choice) continue; // indices were already validated above; defensive only

    const name = choice.label.split("—")[0]?.trim() ?? choice.label;
    console.log(`\n--- Running: ${name} ---\n`);
    try {
      await choice.main();
    } catch (err) {
      logger.error(`"${name}" failed. Stopping.`, {
        error: err instanceof Error ? err.message : String(err),
      });
      process.exit(1);
    }
  }
}

rl.question("Select programs to run (e.g. 1  or  1 2): ", (answer) => {
  void runSelection(answer);
});
