import {
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import { CodeView } from "./code-view";
import { FrameControls } from "./frame-controls";
import { FullscreenIcon, useFit, useFullscreen } from "./fullscreen";
import type {
  AnimationBlockData,
  Claim,
  SelectedItem,
  StageMessage,
  StageState,
} from "./model";
import { stageEvent } from "./model";
import { Player } from "./player";
import { ScenarioPicker } from "./scenario-picker";
import { stageDocument } from "./stage";
import { type CodeCheck, type Repo, checkCode, claimState } from "./verify";

/** The block as a reader sees it: a titled frame around the stage, an
 * opaque-origin iframe that runs the model's script. Several scenarios add
 * a picker row under the header; several frames add step controls under
 * the stage. The stage stays loaded across both: the script hears each
 * change through `wb.onScenario` and `wb.onFrame`. */
/** What the page around a block can ask of its stage. */
export interface AnimationBlockHandle {
  /** Takes one item out of the selection. */
  deselect(id: string): void;
  /** Empties the selection. */
  clear(): void;
}

// A stable default, so a block without files does not re-check its code,
// and re-post it to the stage, on every render.
const NO_FILES: Repo = {};

export function AnimationBlock({
  data,
  selecting = false,
  onSelection,
  onSelectExit,
  repo = NO_FILES,
  ref,
}: {
  data: AnimationBlockData;
  /** The files the block's code anchors point into. */
  repo?: Repo;
  /** Whether the reader is picking things on the stage for the model. */
  selecting?: boolean;
  /** Everything picked on the stage, after every change. */
  onSelection?(items: SelectedItem[]): void;
  /** The reader pressed Escape in the stage with nothing selected. */
  onSelectExit?(): void;
  ref?: Ref<AnimationBlockHandle>;
}) {
  const scenarios = data.scenarios ?? [];
  const [chosenId, setChosenId] = useState(scenarios[0]?.id);
  const [stepIndex, setStep] = useState(0);

  const scenario =
    scenarios.find((item) => item.id === chosenId) ?? scenarios[0] ?? null;

  const frames = scenario?.frames ?? data.frames ?? [];

  const frameIndex = frames.length
    ? Math.min(stepIndex, frames.length - 1)
    : -1;

  // Verification: every code name is checked against the repository; the
  // stage badges its claims while verify is on. The code view shows what
  // the reader clicked, or follows the steps.
  const [verifying, setVerifying] = useState(false);
  const [claims, setClaims] = useState<Claim[]>([]);

  const [shown, setShown] = useState<
    | { follow: true }
    | { follow: false; label: string; names: string[]; focus: boolean }
    | null
  >(null);

  const checks = useMemo(
    () =>
      new Map(
        Object.entries(data.code ?? {}).map(([name, code]) => [
          name,
          checkCode(name, code, repo),
        ]),
      ),
    [data.code, repo],
  );

  const status = useMemo(
    () =>
      Object.fromEntries(
        [...checks].map(([name, check]) => [name, check.state]),
      ),
    [checks],
  );

  const stepCode = frames[frameIndex]?.code;
  const focusNames = useMemo(() => stepCode ?? [], [stepCode]);

  const counts = { checked: 0, changed: 0, unlinked: 0 };

  for (const claim of claims) counts[claimState(claim.names, checks)]++;

  const lookup = (names: string[]): CodeCheck[] =>
    names.map((name) => checks.get(name) ?? checkCode(name, undefined, repo));

  // Stepping while the code view is open makes it follow the steps.
  const step = (index: number) => {
    setStep(index);

    if (shown) setShown({ follow: true });
  };

  const state = useMemo<StageState>(
    () => ({ scenario, frame: frames[frameIndex] ?? null, frameIndex }),
    [scenario, frames, frameIndex],
  );

  const stage = useRef<HTMLIFrameElement>(null);
  const figure = useRef<HTMLElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const { full, toggle } = useFullscreen(figure);

  // A script that lays itself out reports the size it needs, which wins
  // over the size the block was written with.
  const [measured, setMeasured] = useState<{
    width: number;
    height: number;
  } | null>(null);

  // The stage frame is the drawing plus its inset on every side.
  const inset = data.stage.inset ?? 24;
  const drawing = measured ?? data.stage;

  const size = {
    width: drawing.width + 2 * inset,
    height: drawing.height + 2 * inset,
  };

  // Fullscreen scales the stage to the room left after the controls.
  const scale = useFit(area, size.width, size.height, full);

  const post = useCallback((message: StageMessage) => {
    stage.current?.contentWindow?.postMessage(message, "*");
  }, []);

  useEffect(
    () => post({ type: "wb:select-mode", on: selecting }),
    [post, selecting],
  );

  // A script cannot fill the model's context unless the reader is picking.
  const selectingNow = useRef(selecting);
  selectingNow.current = selecting;

  // Only this block's stage reports here, and only in the shapes it may.
  useEffect(() => {
    const listen = (event: MessageEvent) => {
      if (event.source !== stage.current?.contentWindow) return;

      const parsed = stageEvent.safeParse(event.data);

      if (!parsed.success) return;
      const message = parsed.data;

      switch (message.type) {
        case "wb:selection":
          if (selectingNow.current || !message.items.length)
            onSelection?.(message.items);
          break;
        case "wb:select-exit":
          onSelectExit?.();
          break;
        case "wb:claims":
          setClaims(message.claims);
          break;
        case "wb:size":
          setMeasured({
            width: Math.ceil(message.width),
            height: Math.ceil(message.height),
          });
          break;
        case "wb:reveal":
          setShown({
            follow: false,
            label: message.label,
            names: message.names,
            focus: true,
          });
          break;
      }
    };

    addEventListener("message", listen);

    return () => removeEventListener("message", listen);
  }, [onSelection, onSelectExit]);

  useImperativeHandle(
    ref,
    () => ({
      deselect: (id) => post({ type: "wb:select-remove", id }),
      clear: () => post({ type: "wb:select-clear" }),
    }),
    [post],
  );
  const time = useRef(0);

  // The player calls this on every tick and scrub.
  const onTime = useCallback((next: number) => {
    time.current = next;
    stage.current?.contentWindow?.postMessage(
      { type: "wb:time", time: next },
      "*",
    );
  }, []);

  // The stage starts on the first scenario and frame, and reloads only when
  // the block's data changes, never when the reader picks or steps.
  const html = useMemo(() => {
    const first = data.scenarios?.[0] ?? null;
    const firstFrames = first?.frames ?? data.frames ?? [];

    return stageDocument(
      data.script,
      {
        scenario: first,
        frame: firstFrames[0] ?? null,
        frameIndex: firstFrames.length ? 0 : -1,
      },
      data.timeline ?? null,
      inset,
    );
  }, [data.script, data.scenarios, data.frames, data.timeline, inset]);

  // A new script starts over: what the old one measured, claimed or had
  // selected no longer applies.
  const [loadedHtml, setLoadedHtml] = useState(html);

  if (loadedHtml !== html) {
    setLoadedHtml(html);
    setMeasured(null);
    setClaims([]);
  }

  useEffect(() => tell(stage.current, state), [state]);

  const verify = useCallback(
    () => post({ type: "wb:verify", on: verifying, status, focus: focusNames }),
    [post, verifying, status, focusNames],
  );

  useEffect(verify, [verify]);

  return (
    <figure
      ref={figure}
      className="block"
      aria-label={data.title}
      data-full={full || undefined}
    >
      <header className="block-header">
        <span className="block-kind">ANIMATION</span>
        <span className="block-title">{data.title}</span>
        {data.code && (
          <div className="verify">
            {verifying && (
              <span className="verify-summary" aria-live="polite">
                <span data-state="checked">{counts.checked} match</span>
                {counts.changed > 0 && (
                  <span data-state="changed">{counts.changed} changed</span>
                )}
                {counts.unlinked > 0 && (
                  <span data-state="unlinked">{counts.unlinked} unlinked</span>
                )}
              </span>
            )}
            <button
              type="button"
              className="verify-toggle"
              aria-pressed={verifying}
              title="Mark every node and wire with whether its code still matches"
              onClick={() => setVerifying(!verifying)}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                aria-hidden="true"
              >
                <path
                  d="M3 7.2l2.6 2.6L11 4.4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Verify
            </button>
          </div>
        )}
        <button
          type="button"
          className="block-action"
          aria-label={full ? "Exit full screen" : "Full screen"}
          title={full ? "Exit full screen (Esc)" : "Full screen"}
          onClick={toggle}
        >
          <FullscreenIcon full={full} />
        </button>
      </header>
      {scenario && scenarios.length > 1 && (
        <ScenarioPicker
          scenarios={scenarios}
          chosen={scenario}
          onChoose={(item) => {
            setChosenId(item.id);
            // Each scenario's steps start from the first.
            step(0);
          }}
        />
      )}
      {data.description && (
        <p className="block-description">{data.description}</p>
      )}
      <div ref={area} className="stage-scroll">
        <div
          className="stage-fit"
          style={
            full
              ? {
                  width: size.width * scale,
                  height: size.height * scale,
                }
              : undefined
          }
        >
          <iframe
            ref={stage}
            className="stage"
            title={data.title}
            sandbox="allow-scripts"
            srcDoc={html}
            // A reload starts at the beginning; catch it up to the reader.
            onLoad={() => {
              onSelection?.([]);
              post({ type: "wb:select-mode", on: selecting });
              tell(stage.current, state);
              verify();
              onTime(time.current);
            }}
            style={{
              width: size.width,
              height: size.height,
              transform: full ? `scale(${scale})` : undefined,
            }}
          />
        </div>
      </div>
      {data.timeline ? (
        <Player timeline={data.timeline} width={size.width} onTime={onTime} />
      ) : (
        frames.length > 1 && (
          <FrameControls
            frames={frames}
            index={frameIndex}
            onStep={step}
            onShowCode={
              stepCode?.length ? () => setShown({ follow: true }) : undefined
            }
            // A step that carries data plays something; the reader replays it.
            onReplayStep={
              frames[frameIndex]?.data === undefined
                ? undefined
                : () => post({ type: "wb:replay" })
            }
            width={size.width}
          />
        )
      )}
      {shown && (
        <CodeView
          title={
            shown.follow
              ? (frames[frameIndex]?.label ?? `Step ${frameIndex + 1}`)
              : shown.label
          }
          subtitle={
            shown.follow
              ? `Step ${frameIndex + 1} of ${frames.length}`
              : undefined
          }
          checks={lookup(shown.follow ? focusNames : shown.names)}
          repo={repo}
          focusOnOpen={!shown.follow && shown.focus}
          returnFocus={stage}
          onClose={() => setShown(null)}
        />
      )}
    </figure>
  );
}

/** The stage has an opaque origin, so the message cannot name one. */
function tell(frame: HTMLIFrameElement | null, state: StageState) {
  frame?.contentWindow?.postMessage({ type: "wb:state", state }, "*");
}
