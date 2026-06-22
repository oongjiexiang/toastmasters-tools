import { printMembershipDiff, printProgressDiff } from "../helpers/db";

export function main(): void {
  printProgressDiff();
  printMembershipDiff();
}
