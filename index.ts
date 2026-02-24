/**
 * Toastmasters User Retriever — Interactive Launcher
 *
 * Presents a numbered menu and runs the selected service scripts in order.
 *
 * Usage:
 *   npm start
 */

import { createInterface } from "readline";
import { main as fetch } from "./services/fetch";
import { main as membership } from "./services/membership";
import { main as analyze } from "./services/analyze";

const choices = [
  {
    label: "Fetch      — Download Basecamp progress data (progress.csv + details.csv)",
    main: fetch,
  },
  {
    label: "Membership — Download TI membership CSV from toastmasters.org",
    main: membership,
  },
  {
    label: "Analyze    — Generate summary report (summary.csv)",
    main: analyze,
  },
];

console.log("\nToastmasters User Retriever\n");
choices.forEach((c, i) => console.log(`  ${i + 1}. ${c.label}`));
console.log();

const rl = createInterface({ input: process.stdin, output: process.stdout });

rl.question("Select programs to run (e.g. 1  or  1 3  or  1 2 3): ", async (answer) => {
  rl.close();

  // Accept numbers separated by spaces, commas, or both
  const tokens = answer.trim().split(/[\s,]+/).filter(Boolean);
  const indices = tokens.map((t) => parseInt(t, 10) - 1);

  const invalid = indices.filter((i) => isNaN(i) || i < 0 || i >= choices.length);
  if (tokens.length === 0 || invalid.length > 0) {
    console.error("Invalid selection. Enter one or more numbers between 1 and 3.");
    process.exit(1);
  }

  // Deduplicate while preserving order
  const seen = new Set<number>();
  const selected = indices.filter((i) => !seen.has(i) && seen.add(i));

  for (const idx of selected) {
    const name = choices[idx].label.split("—")[0].trim();
    console.log(`\n--- Running: ${name} ---\n`);
    try {
      await choices[idx].main();
    } catch (err) {
      console.error(`\nError: ${err instanceof Error ? err.message : err}`);
      console.error(`\n"${name}" failed. Stopping.`);
      process.exit(1);
    }
  }
});
