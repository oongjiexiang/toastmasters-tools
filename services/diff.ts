import { fileURLToPath } from "url";
import { printMembershipDiff, printProgressDiff } from "../helpers/db";

export function main(): void {
  printProgressDiff();
  printMembershipDiff();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
