import type { Page } from "@playwright/test";

export type ProtocolFrame = Record<string, unknown>;

function parseProtocolFrame(payload: string | Buffer): ProtocolFrame | null {
  try {
    return JSON.parse(payload.toString()) as ProtocolFrame;
  } catch {
    return null;
  }
}

export function collectSentProtocolFrames(page: Page): ProtocolFrame[] {
  const frames: ProtocolFrame[] = [];

  page.on("websocket", (socket) => {
    socket.on("framesent", (frame) => {
      const parsed = parseProtocolFrame(frame.payload);
      if (parsed) frames.push(parsed);
    });
  });

  return frames;
}

export function collectReceivedProtocolFrames(page: Page): ProtocolFrame[] {
  const frames: ProtocolFrame[] = [];

  page.on("websocket", (socket) => {
    socket.on("framereceived", (frame) => {
      const parsed = parseProtocolFrame(frame.payload);
      if (parsed) frames.push(parsed);
    });
  });

  return frames;
}

export function findSentFrame(
  frames: readonly ProtocolFrame[],
  type: string,
): ProtocolFrame | undefined {
  return frames.find((frame) => frame.type === type);
}

export function parseFrameRequestBody(frame: ProtocolFrame | undefined): Record<string, unknown> {
  const body = (frame?.init as { body?: string } | undefined)?.body;
  if (!body) {
    throw new Error(`Expected protocol frame ${String(frame?.type)} to include init.body`);
  }

  return JSON.parse(body) as Record<string, unknown>;
}
