import { main } from "@/services/fetch";

export async function POST(): Promise<Response> {
  try {
    await main();
    return Response.json({ data: { ok: true } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: { message } }, { status: 500 });
  }
}
