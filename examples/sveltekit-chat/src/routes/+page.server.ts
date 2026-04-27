import { env } from "$env/dynamic/public";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url }) => {
  return {
    agentHost: env.PUBLIC_AGENT_HOST || url.host,
    threadId: crypto.randomUUID(),
  };
};
