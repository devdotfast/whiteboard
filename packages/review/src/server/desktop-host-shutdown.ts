import {
  type JsonValue,
  type ReviewGatewayHost,
  ReviewGatewayHostSchema,
  isJsonObject,
  jsonBoolean,
  jsonProperty,
  jsonString,
} from "@dev.fast/review-protocol";

interface DesktopHostMessagePort {
  on(event: "message", listener: (event: { data: JsonValue }) => void): void;
  off(event: "message", listener: (event: { data: JsonValue }) => void): void;
}

interface DesktopHostProcess {
  parentPort?: DesktopHostMessagePort;
  on(event: "message", listener: (message: JsonValue) => void): void;
  off(event: "message", listener: (message: JsonValue) => void): void;
}

export function listenForDesktopHostShutdown(
  hostProcess: DesktopHostProcess,
  onShutdown: () => void,
  onTelemetrySetting?: (enabled: boolean) => void,
  onStageRustAnalyzer?: (path: string) => void,
  onRemoteHosts?: (hosts: ReviewGatewayHost[]) => void,
): () => void {
  const handleMessage = (message: JsonValue) => {
    if (!isJsonObject(message)) return;
    const type = jsonProperty(message, "type");

    if (type === "shutdown") {
      onShutdown();

      return;
    }

    if (type === "telemetry-setting") {
      const enabled = jsonBoolean(jsonProperty(message, "enabled"));

      if (enabled !== undefined) onTelemetrySetting?.(enabled);

      return;
    }

    if (type === "stage-rust-analyzer") {
      const path = jsonString(jsonProperty(message, "path"));

      if (path) onStageRustAnalyzer?.(path);

      return;
    }

    if (type === "remote-hosts") {
      const hosts = ReviewGatewayHostSchema.array().safeParse(
        jsonProperty(message, "hosts"),
      );

      if (hosts.success) onRemoteHosts?.(hosts.data);
    }
  };

  if (hostProcess.parentPort) {
    const handleParentMessage = (event: { data: JsonValue }) => {
      handleMessage(event.data);
    };

    hostProcess.parentPort.on("message", handleParentMessage);

    return () => hostProcess.parentPort?.off("message", handleParentMessage);
  }

  hostProcess.on("message", handleMessage);

  return () => hostProcess.off("message", handleMessage);
}
