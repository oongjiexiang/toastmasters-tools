import { resolve, basename } from "path";
import { readFileSync } from "fs";
import { findLatestMembershipFile } from "@/helpers/files";
import { RESULTS_DIR } from "@/config";

export async function GET(): Promise<Response> {
  try {
    const dir = resolve(process.cwd(), RESULTS_DIR);

    let filePath: string;
    try {
      filePath = findLatestMembershipFile(dir);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json(
        { error: { code: "NOT_FOUND", message } },
        { status: 404 },
      );
    }

    const content = readFileSync(filePath);
    const filename = basename(filePath);

    return new Response(content, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: { code: "SERVER_ERROR", message } },
      { status: 500 },
    );
  }
}
