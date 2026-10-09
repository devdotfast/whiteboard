import { request } from "./socket";

export interface PaneInfo {
  pane_id: string;
  terminal_id: string;
  agent?: string | null;
  agent_status: string;
}
type GetPane = (id: string) => Promise<PaneInfo>;
export type DraftTarget = Pick<PaneInfo, "pane_id" | "terminal_id" | "agent">;

export async function bindTarget(id: string | undefined, self: string | undefined, get: GetPane): Promise<DraftTarget> {
  if (!id || id === self) throw new Error("Open Diffr from the agent pane you want to review with.");
  const pane = await get(id);
  if (!pane.agent) throw new Error("The target pane is not a detected agent. Draft transfer is unavailable.");
  return { pane_id: pane.pane_id, terminal_id: pane.terminal_id, agent: pane.agent };
}

export async function addToDraft(target: DraftTarget, text: string, get: GetPane,
  send: (params: { pane_id: string; text: string; keys: string[] }) => Promise<unknown>) {
  const pane = await get(target.pane_id);
  if (pane.terminal_id !== target.terminal_id || !pane.agent || pane.agent !== target.agent)
    throw new Error("The original agent has left this pane. Reopen Diffr from the intended agent.");
  if (pane.agent_status !== "idle" && pane.agent_status !== "done")
    throw new Error("The agent must be idle at its prompt before adding to its draft.");
  if (/[\x00-\x08\x0b-\x1f\x7f]/.test(text))
    throw new Error("The selection contains terminal control characters and cannot be pasted safely.");
  // send_input honors bracketed paste; an empty key list never appends Enter.
  await send({ pane_id: target.pane_id, text, keys: [] });
}

export function herdr(socket: string) {
  return {
    get: async (pane_id: string) => (await request<{ pane: PaneInfo }>(socket, "pane.get", { pane_id })).pane,
    send: (params: { pane_id: string; text: string; keys: string[] }) => request(socket, "pane.send_input", params),
    focus: (pane_id: string) => request(socket, "pane.focus", { pane_id }),
    zoom: (pane_id: string, mode: "toggle" | "off") => request(socket, "pane.zoom", { pane_id, mode }),
  };
}
