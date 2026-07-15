import { listMembers } from "@toastmasters/core/queries";
import { respond, serverError } from "@/lib/http";

export async function GET(): Promise<Response> {
  try {
    return respond(listMembers());
  } catch (err) {
    return serverError(err);
  }
}
