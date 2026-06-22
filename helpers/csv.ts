import { stringify } from "csv-stringify/sync";
import { DetailResponse, MemberProgress } from "../types";

function collectLevelNames(data: MemberProgress[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  const knownOrder = [
    "Level 1",
    "Level 2",
    "Level 3",
    "Level 4",
    "Level 5",
    "Path Completion",
  ];

  for (const entry of data) {
    for (const key of Object.keys(entry.progression)) {
      if (!seen.has(key)) {
        seen.add(key);
        ordered.push(key);
      }
    }
  }

  // Return in known order first, then any extras
  const result: string[] = [];
  for (const name of knownOrder) {
    if (seen.has(name)) result.push(name);
  }
  for (const name of ordered) {
    if (!result.includes(name)) result.push(name);
  }
  return result;
}

export function buildCsv(data: MemberProgress[]): string {
  const levels = collectLevelNames(data);

  const columns: string[] = [
    "User ID",
    "First Name",
    "Last Name",
    "Email",
    "Path Name",
    "Course ID",
  ];
  for (const level of levels) {
    columns.push(`${level} Completed`, `${level} Total`);
    if (level !== "Path Completion") columns.push(`${level} Approved`);
  }

  const records = data.map((entry) => {
    const row: Record<string, string | number | boolean> = {
      "User ID": entry.user.id,
      "First Name": entry.user.first_name,
      "Last Name": entry.user.last_name,
      "Email": entry.user.email,
      "Path Name": entry.path_name,
      "Course ID": entry.course_id,
    };
    for (const level of levels) {
      const prog = entry.progression[level];
      row[`${level} Completed`] = prog?.completed ?? "";
      row[`${level} Total`] = prog?.total ?? "";
      if (level !== "Path Completion") {
        row[`${level} Approved`] = prog?.approved ? "true" : "";
      }
    }
    return row;
  });

  return stringify(records, { header: true, columns });
}

export function buildDetailCsv(
  entries: Array<{ member: MemberProgress; detail: DetailResponse }>
): string {
  const columns = [
    "User Name",
    "Path Name",
    "Level",
    "Lesson",
    "Complete",
    "Type",
    "Speech Title",
    "Speech Date",
  ];

  const records: Record<string, string>[] = [];

  for (const { member, detail } of entries) {
    const userName = `${member.user.first_name} ${member.user.last_name}`;
    const pathName = member.path_name;
    const speeches = detail.speeches ?? {};

    for (const chapter of detail.blocks.children) {
      const level = chapter.display_name;

      for (const lesson of chapter.children) {
        const speech = speeches[lesson.id];
        const speechDate = speech?.speech_date
          ? speech.speech_date.split("T")[0]
          : "";

        records.push({
          "User Name": userName,
          "Path Name": pathName,
          "Level": level,
          "Lesson": lesson.display_name,
          "Complete": lesson.complete ? "Yes" : "No",
          "Type": lesson.block_lib_type === "elective" ? "Elective" : "Core",
          "Speech Title": speech?.speech_title ?? "",
          "Speech Date": speechDate,
        });
      }
    }
  }

  return stringify(records, { header: true, columns });
}
