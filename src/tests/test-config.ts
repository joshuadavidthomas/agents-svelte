declare const __TEST_WORKER_URL__: string;

export function getTestWorkerUrl(): string {
  return __TEST_WORKER_URL__;
}

export function getTestWorkerHost(): {
  host: string;
  protocol: "ws" | "wss";
} {
  const url = new URL(getTestWorkerUrl());
  return {
    host: `${url.hostname}:${url.port}`,
    protocol: "ws",
  };
}
