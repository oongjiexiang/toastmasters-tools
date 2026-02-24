import { DetailResponse, DetailRow, MemberProgress } from "../types";

export function parseCSV(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < content.length) {
    const ch = content[i];

    if (inQuotes) {
      if (ch === '"' && content[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === "\r" && content[i + 1] === "\n") {
        row.push(field);
        field = "";
        rows.push(row);
        row = [];
        i += 2;
        continue;
      } else if (ch === "\n") {
        row.push(field);
        field = "";
        rows.push(row);
        row = [];
        i++;
        continue;
      } else {
        field += ch;
      }
    }
    i++;
  }

  // Flush last field/row
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

export function csvToObjects(rows: string[][]): Record<string, string>[] {
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows
    .slice(1)
    .filter((r) => r.some((f) => f.trim() !== ""))
    .map((row) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => {
        obj[h] = (row[i] ?? "").trim();
      });
      return obj;
    });
}

export function escapeCsvField(
  value: string | number | boolean | undefined
): string {
  const str = value === undefined || value === null ? "" : String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

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

  const headerCols = [
    "User ID",
    "First Name",
    "Last Name",
    "Email",
    "Path Name",
    "Course ID",
  ];

  for (const level of levels) {
    headerCols.push(`${level} Completed`);
    headerCols.push(`${level} Total`);
    if (level !== "Path Completion") {
      headerCols.push(`${level} Approved`);
    }
  }

  const rows: string[] = [headerCols.join(",")];

  for (const entry of data) {
    const cols = [
      escapeCsvField(entry.user.id),
      escapeCsvField(entry.user.first_name),
      escapeCsvField(entry.user.last_name),
      escapeCsvField(entry.user.email),
      escapeCsvField(entry.path_name),
      escapeCsvField(entry.course_id),
    ];

    for (const level of levels) {
      const prog = entry.progression[level];
      cols.push(escapeCsvField(prog?.completed ?? ""));
      cols.push(escapeCsvField(prog?.total ?? ""));
      if (level !== "Path Completion") {
        cols.push(escapeCsvField(prog?.approved ?? ""));
      }
    }

    rows.push(cols.join(","));
  }

  return rows.join("\n");
}

export function buildDetailCsv(
  entries: Array<{ member: MemberProgress; detail: DetailResponse }>
): string {
  const header = [
    "User Name",
    "Path Name",
    "Level",
    "Lesson",
    "Complete",
    "Type",
    "Speech Title",
    "Speech Date",
  ].join(",");

  const rows: string[] = [header];

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

        const row: DetailRow = {
          userName,
          pathName,
          level,
          lesson: lesson.display_name,
          complete: lesson.complete ? "Yes" : "No",
          type: lesson.block_lib_type === "elective" ? "Elective" : "Core",
          speechTitle: speech?.speech_title ?? "",
          speechDate,
        };

        rows.push(
          [
            escapeCsvField(row.userName),
            escapeCsvField(row.pathName),
            escapeCsvField(row.level),
            escapeCsvField(row.lesson),
            escapeCsvField(row.complete),
            escapeCsvField(row.type),
            escapeCsvField(row.speechTitle),
            escapeCsvField(row.speechDate),
          ].join(",")
        );
      }
    }
  }

  return rows.join("\n");
}
