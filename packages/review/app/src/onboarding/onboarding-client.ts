import { reviewFetchUrl } from "@canvas/host/review-client";
import {
  type ReviewCliInstallTarget,
  type ReviewConnectAgent,
  ReviewConnectAgentsResponseSchema,
  type ReviewConnectResult,
  ReviewConnectResultSchema,
  type ReviewOnboardingProject,
  ReviewOnboardingProjectSchema,
  type ReviewOnboardingRunRequestSchema,
  type ReviewOnboardingTargetsResponse,
  ReviewOnboardingTargetsResponseSchema,
} from "@dev.fast/review-protocol";
import { askAgentIds } from "@review/ask/thread-state";
import type { UiTelemetryEventName } from "@review/ui-telemetry-events";
import { z } from "zod";

export interface OnboardingConnection {
  serverUrl: string;
  token: string;
}

/** An agent Whiteboard can run in the app, and whether it is installed. */
export interface OnboardingRunAgent {
  id: (typeof askAgentIds)[number];
  name: string;
  available: boolean;
  /** Whether it decides for itself what is safe to run. */
  auto: boolean;
}

const runAgentsSchema = z.object({
  agents: z.array(
    z.object({
      id: z.enum(askAgentIds),
      name: z.string(),
      available: z.boolean(),
      /** Whether it decides for itself what is safe to run. */
      auto: z.boolean().default(false),
    }),
  ),
});

const errorSchema = z.object({ error: z.string() });

/** First run's calls to the desktop server: connecting agents, and the run
 * that draws the first whiteboard. */
export class OnboardingClient {
  constructor(private readonly connection: OnboardingConnection) {}

  private async request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);

    if (init.body) headers.set("content-type", "application/json");

    const response = await reviewFetchUrl(
      this.connection,
      `${this.connection.serverUrl.replace(/\/$/, "")}${path}`,
      { ...init, headers },
    );

    if (!response.ok) {
      const body = errorSchema.safeParse(
        await response.json().catch(() => ({})),
      );

      throw new Error(
        body.success
          ? body.data.error
          : `Whiteboard answered ${response.status}.`,
      );
    }

    return response;
  }

  private async json<T>(
    schema: z.ZodType<T>,
    path: string,
    init?: RequestInit,
  ): Promise<T> {
    return schema.parse(await (await this.request(path, init)).json());
  }

  capture(
    name: UiTelemetryEventName,
    properties: Record<string, string | boolean>,
  ) {
    void this.request("/telemetry/event", {
      method: "POST",
      body: JSON.stringify({ name, properties }),
      keepalive: true,
    }).catch(() => undefined);
  }

  async agents(): Promise<ReviewConnectAgent[]> {
    return (
      await this.json(ReviewConnectAgentsResponseSchema, "/install/agents")
    ).agents;
  }

  connect(target: ReviewCliInstallTarget): Promise<ReviewConnectResult> {
    return this.json(ReviewConnectResultSchema, "/install/connect", {
      method: "POST",
      body: JSON.stringify({ target }),
    });
  }

  async runAgents(): Promise<OnboardingRunAgent[]> {
    return (await this.json(runAgentsSchema, "/reviews-api/onboarding/agents"))
      .agents;
  }

  async projects(): Promise<ReviewOnboardingProject[]> {
    return (
      await this.json(
        z.object({ projects: z.array(ReviewOnboardingProjectSchema) }),
        "/reviews-api/onboarding/projects",
      )
    ).projects;
  }

  targets(path: string): Promise<ReviewOnboardingTargetsResponse> {
    return this.json(
      ReviewOnboardingTargetsResponseSchema,
      `/reviews-api/onboarding/targets?path=${encodeURIComponent(path)}`,
    );
  }

  /** Makes the whiteboard, opens it, and starts the agent drawing it in its
   * Ask panel; resolves with its id. */
  async startRun(
    input: z.input<typeof ReviewOnboardingRunRequestSchema>,
  ): Promise<string> {
    return (
      await this.json(
        z.object({ reviewId: z.string() }),
        "/reviews-api/onboarding/runs",
        { method: "POST", body: JSON.stringify(input) },
      )
    ).reviewId;
  }
}
