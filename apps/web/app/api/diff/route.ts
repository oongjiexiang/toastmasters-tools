import { getProgressDiff, getMembershipDiff } from "@toastmasters/core/db";

export async function GET(): Promise<Response> {
  try {
    const progress = getProgressDiff();
    const membership = getMembershipDiff();

    if (progress === null || membership === null) {
      return Response.json(
        {
          error: {
            code: "SNAPSHOT_MISSING",
            message: "Run npm run fetch and npm run membership first.",
          },
        },
        { status: 503 },
      );
    }

    return Response.json({ data: { progress, membership } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: { code: "SERVER_ERROR", message } },
      { status: 500 },
    );
  }
}
