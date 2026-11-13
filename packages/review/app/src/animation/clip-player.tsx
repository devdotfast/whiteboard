// A clip's one timeline: the reader plays it, pauses it, and jumps between
// its markers. The stage owns the playhead and reports it; this follows.

import type { BlockProps } from "@canvas/blocks";
import { PauseIcon, PlayIcon } from "@canvas/ui/icons";
import { ProgressLine } from "@canvas/ui/progress-line";
import { type KeyboardEvent, useMemo, useRef, useState } from "react";

import { ControlButton, StopCaption } from "./stage-controls";
import type { PickedBy, StagePlayer, StageSend } from "./stage-player";
import type { PlacedMarker, StageMessage } from "./stage-protocol";
import { TimelineControls, stepFrame } from "./timeline-controls";

/** A clip's one timeline, or a diagram's (`track`): the diagram's stage can
 * move its playhead to any time, so it gets a track the reader drags, with
 * its chapters along it, in place of the strip of markers. */
export function useClipPlayer(
  node: Pick<BlockProps<"clip">["node"], "markers" | "scenarios">,
  send: StageSend,
  { track = false }: { track?: boolean } = {},
): StagePlayer {
  const markers = node.markers;
  // What the stage last reported: its markers in time order, its length, the
  // playhead, and the marker the playhead last reached.
  const [placed, setPlaced] = useState<PlacedMarker[] | null>(null);
  const [duration, setDuration] = useState(0);
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [markerKey, setMarkerKey] = useState<string>();
  const [scenario, setScenario] = useState(node.scenarios?.[0]?.key);
  const scenarioRef = useRef(scenario);
  // A new stage (going fullscreen, say) picks up at the marker the last one
  // showed, playing if it was: until it lands there, what it reports from
  // time 0 is not news. Asks made before it booted went to the last one.
  const resumeRef = useRef<{ key: string; playing: boolean }>(undefined);

  // In time order once the stage has placed them, as declared until then.
  const stops = useMemo(() => {
    if (!placed) return markers;
    const byKey = new Map(markers.map((marker) => [marker.key, marker]));

    return placed.flatMap(({ key }) => byKey.get(key) ?? []);
  }, [markers, placed]);

  const activeIndex = Math.max(
    0,
    stops.findIndex((stop) => stop.key === markerKey),
  );

  const ended = !playing && duration > 0 && at >= duration;

  const pick = (position: number, by: PickedBy) => {
    const stop = stops[position];

    if (!stop) return;

    // The tour and a render read a stop at rest; the controls keep playing
    // if it was.
    if (by !== "controls" && playing) {
      send({ type: "pause" });
      setPlaying(false);
    }

    resumeRef.current = undefined;
    setMarkerKey(stop.key);
    send({ type: "seek", marker: stop.key });
  };

  const toggle = () => {
    if (playing) {
      send({ type: "pause" });
      setPlaying(false);
    } else {
      send({ type: "play" });
      setPlaying(true);
    }
  };

  const receive = (message: StageMessage) => {
    const resume = resumeRef.current;

    switch (message.type) {
      case "clip":
        setPlaced(message.markers);
        setDuration(message.duration);

        if (resume && message.markers.some(({ key }) => key === resume.key)) {
          send({ type: "seek", marker: resume.key });

          if (resume.playing) send({ type: "play" });
        } else {
          resumeRef.current = undefined;
          setMarkerKey(undefined);
          setPlaying(false);
        }

        break;
      case "time":
        if (resume) break;
        setAt(message.at);
        setPlaying(message.playing);
        break;
      case "marker":
        if (resume && message.key !== resume.key) break;
        resumeRef.current = undefined;
        setMarkerKey(message.key);
        break;
      case "ended":
        setPlaying(false);
        break;
    }
  };

  // A new stage starts on the scenario the reader had picked, or the first.
  const boot = () => {
    const kept =
      node.scenarios?.find((item) => item.key === scenarioRef.current) ??
      node.scenarios?.[0];

    scenarioRef.current = kept?.key;
    setScenario(kept?.key);
    resumeRef.current = markerKey ? { key: markerKey, playing } : undefined;

    return {
      mode: "clip" as const,
      frames: [],
      markers: markers.map(({ key, title, caption, code }) => ({
        key,
        title,
        caption,
        code,
      })),
      scenarios: node.scenarios?.map((item) => item.key) ?? [],
      frame: 0,
      ...(kept && { scenario: kept.key }),
    };
  };

  const scrub = (time: number) => {
    resumeRef.current = undefined;
    send({ type: "scrub", at: time });
  };

  const jump = (event: KeyboardEvent) => {
    if (track) {
      const starts = (placed ?? []).map((item) => item.at);

      const next = {
        ArrowLeft: stepFrame(starts, at, duration, -1),
        ArrowRight: stepFrame(starts, at, duration, 1),
        Home: 0,
        End: duration,
      }[event.key];

      if (next === undefined) return false;
      event.preventDefault();
      scrub(Math.min(Math.max(next, 0), duration));

      return true;
    }

    if (event.key === "ArrowRight") pick(activeIndex + 1, "controls");
    else if (event.key === "ArrowLeft") pick(activeIndex - 1, "controls");
    else return false;

    event.preventDefault();

    return true;
  };

  const player: StagePlayer = {
    stops,
    activeIndex,
    pick,
    boot,
    receive,
    scenario,
    selectScenario(key) {
      if (key === scenarioRef.current) return;
      scenarioRef.current = key;
      resumeRef.current = undefined;
      setScenario(key);
      setPlaying(false);
      send({ type: "scenario", key });
    },
    strip: {
      label: "Markers",
      items: stops.map((stop) => ({ key: stop.key, text: stop.title })),
    },
    afterStage: (
      <ProgressLine
        value={duration > 0 ? at / duration : 0}
        ticks={
          duration > 0 ? (placed ?? []).map((item) => item.at / duration) : []
        }
      />
    ),
    onKeyDown: jump,
    // Space plays or pauses when the figure itself has focus; a focused
    // button keeps Space for itself.
    onFigureKeyDown(event) {
      if (event.target !== event.currentTarget) return;

      if (event.key === " ") {
        event.preventDefault();
        toggle();
      } else jump(event);
    },
    controls: (
      <>
        <ControlButton
          label={playing ? "Pause" : ended ? "Replay" : "Play"}
          onClick={toggle}
          icon={playing ? PauseIcon : PlayIcon}
        />
        <StopCaption stops={stops} activeIndex={activeIndex} />
      </>
    ),
  };

  if (!track) return player;

  return {
    ...player,
    strip: null,
    afterStage: (
      <TimelineControls
        chapters={stops.map((stop) => ({
          ...stop,
          at: placed?.find(({ key }) => key === stop.key)?.at ?? 0,
        }))}
        duration={duration}
        at={at}
        playing={playing}
        activeIndex={activeIndex}
        onToggle={toggle}
        onScrub={scrub}
        onPick={(position) => pick(position, "controls")}
      />
    ),
    controls: null,
  };
}
