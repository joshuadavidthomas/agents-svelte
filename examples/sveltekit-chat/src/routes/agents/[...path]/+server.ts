import type { Env } from "../../../agent";
import type { RequestHandler } from "./$types";

async function handleAgentRequest(request: Request, platform: App.Platform | undefined) {
  if (!platform?.env) {
    return new Response("Cloudflare platform environment is not available", { status: 500 });
  }

  const { routeAgentRequest } = await import("agents");

  return (
    (await routeAgentRequest(request, platform.env as Env)) ??
    new Response("Agent route not found", { status: 404 })
  );
}

export const GET: RequestHandler = ({ request, platform }) => handleAgentRequest(request, platform);
export const POST: RequestHandler = ({ request, platform }) =>
  handleAgentRequest(request, platform);
