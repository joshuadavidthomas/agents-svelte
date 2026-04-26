/**
 * Cloudflare Realtime SFU integration for VoiceAgent.
 *
 * This is example-local infrastructure copied from Cloudflare's upstream
 * voice-agent example. It is intentionally kept here while the Svelte package
 * learns what a reusable WebRTC/SFU voice API should look like.
 */

import {
  addSFUTracks,
  createSFUSession,
  createSFUWebSocketAdapter,
  downsample48kStereoTo16kMono,
  encodePayloadToProtobuf,
  extractPayloadFromProtobuf,
  renegotiateSFUSession,
  upsample16kMonoTo48kStereo,
  type SFUConfig,
} from "@cloudflare/voice";

export interface SFUHandlerOptions {
  appId: string;
  apiToken: string;
  agentNamespace: DurableObjectNamespace;
  agentInstance?: string;
}

export async function handleSFURequest(
  request: Request,
  options: SFUHandlerOptions,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const config: SFUConfig = {
    appId: options.appId,
    apiToken: options.apiToken,
  };

  if (path === "/sfu/session" && request.method === "POST") {
    try {
      const result = await createSFUSession(config);
      return Response.json(result);
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "SFU error" },
        { status: 500 },
      );
    }
  }

  if (path === "/sfu/tracks" && request.method === "POST") {
    try {
      const body = (await request.json()) as {
        sessionId: string;
        tracks: unknown;
      };
      const result = await addSFUTracks(config, body.sessionId, body.tracks);
      return Response.json(result);
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "SFU error" },
        { status: 500 },
      );
    }
  }

  if (path === "/sfu/renegotiate" && request.method === "PUT") {
    try {
      const body = (await request.json()) as {
        sessionId: string;
        sdp: string;
      };
      const result = await renegotiateSFUSession(
        config,
        body.sessionId,
        body.sdp,
      );
      return Response.json(result);
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "SFU error" },
        { status: 500 },
      );
    }
  }

  if (path === "/sfu/adapter" && request.method === "POST") {
    try {
      const body = (await request.json()) as { tracks: unknown[] };
      const result = await createSFUWebSocketAdapter(config, body.tracks);
      return Response.json(result);
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "SFU error" },
        { status: 500 },
      );
    }
  }

  if (path === "/sfu/audio-in") {
    const upgradeHeader = request.headers.get("Upgrade");
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const { 0: clientSocket, 1: serverSocket } = new WebSocketPair();
    serverSocket.accept();

    const instanceName = options.agentInstance ?? "sfu-session";
    const id = options.agentNamespace.idFromName(instanceName);
    const stub = options.agentNamespace.get(id);

    const agentUrl = new URL(request.url);
    agentUrl.pathname = `/agents/MyVoiceAgent/${instanceName}`;
    agentUrl.protocol = agentUrl.protocol.replace("http", "ws");

    const agentResp = await stub.fetch(
      new Request(agentUrl.toString(), {
        headers: { Upgrade: "websocket" },
      }),
    );

    const agentWs = agentResp.webSocket;
    if (!agentWs) {
      return new Response("Failed to connect to agent", { status: 500 });
    }
    agentWs.accept();
    agentWs.send(JSON.stringify({ type: "start_call" }));

    agentWs.addEventListener("message", (event) => {
      if (serverSocket.readyState !== WebSocket.OPEN) return;
      serverSocket.send(event.data);
    });

    serverSocket.addEventListener("message", (event) => {
      if (event.data instanceof ArrayBuffer) {
        const payload = extractPayloadFromProtobuf(event.data);
        if (!payload || payload.length === 0) return;
        const pcm16k = downsample48kStereoTo16kMono(payload);
        if (agentWs.readyState === WebSocket.OPEN) {
          agentWs.send(pcm16k);
        }
      }

      if (typeof event.data === "string" && agentWs.readyState === WebSocket.OPEN) {
        agentWs.send(event.data);
      }
    });

    serverSocket.addEventListener("close", () => {
      if (agentWs.readyState === WebSocket.OPEN) {
        agentWs.send(JSON.stringify({ type: "end_call" }));
        agentWs.close();
      }
    });

    agentWs.addEventListener("close", () => {
      if (serverSocket.readyState === WebSocket.OPEN) {
        serverSocket.close();
      }
    });

    return new Response(null, { status: 101, webSocket: clientSocket });
  }

  if (path === "/sfu/audio-out") {
    const upgradeHeader = request.headers.get("Upgrade");
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const { 0: clientSocket, 1: serverSocket } = new WebSocketPair();
    serverSocket.accept();

    serverSocket.addEventListener("message", (event) => {
      if (event.data instanceof ArrayBuffer) {
        const stereo48k = upsample16kMonoTo48kStereo(event.data);
        const protobuf = encodePayloadToProtobuf(stereo48k);
        if (serverSocket.readyState === WebSocket.OPEN) {
          serverSocket.send(protobuf);
        }
      }
    });

    return new Response(null, { status: 101, webSocket: clientSocket });
  }

  return null;
}
