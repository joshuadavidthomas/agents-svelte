import readmeHtml from "../../README.md?aside-html";

import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
  return {
    threadId: crypto.randomUUID(),
    readmeHtml,
  };
};
