let libavoid: Promise<typeof import("@mr_mint/elkjs-libavoid")> | undefined;

export function loadLibavoid() {
  libavoid ??= import("@mr_mint/elkjs-libavoid");

  return libavoid;
}
