import { getDiff } from "@toastmasters/core/queries";
import { respond, serverError } from "@/lib/http";

export async function GET(): Promise<Response> {
  try {
    return respond(getDiff());
  } catch (err) {
    return serverError(err);
  }
}
