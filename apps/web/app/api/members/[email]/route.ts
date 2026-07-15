import { getMemberDetail } from "@toastmasters/core/queries";
import { respond, serverError } from "@/lib/http";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ email: string }> },
): Promise<Response> {
  try {
    const { email: rawEmail } = await params;
    const email = decodeURIComponent(rawEmail);

    const pathway = new URL(request.url).searchParams.get("pathway");
    if (!pathway) {
      // Request validation is a transport concern, so it stays in the route.
      return serverError(new Error("pathway param required"), 400);
    }

    return respond(getMemberDetail(email, pathway));
  } catch (err) {
    return serverError(err);
  }
}
