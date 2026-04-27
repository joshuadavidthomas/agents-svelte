declare global {
  namespace App {
    interface Platform {
      env: {
        AI: Ai;
        ChatAgent: DurableObjectNamespace;
      };
      ctx: ExecutionContext;
      caches: CacheStorage;
      cf?: IncomingRequestCfProperties;
    }
  }
}

export {};
