// A clip's one timeline: the reader plays it, pauses it, and jumps between
// its markers. The stage owns the playhead and reports it; this follows.

import type { BlockProps } from "@canvas/blocks";
import { ProgressLine } from "@canvas/ui/progress-line";
import { type KeyboardEvent, useMemo, useRef, useState } from "react";

import {
  ControlButton,
  StopCaption,
  pauseIcon,
  playIcon,
} from "./stage-controls";
import type { PickedBy, StagePlayer, StageSend } from "./stage-player";
import type { PlacedMarker, StageMessage } from "./stage-protocol";

export function useClipPlayer(
  node: BlockProps<"clip">["node"],
  send: StageSend,
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

    // The tour reads a stop at rest; the controls keep playing if it was.
    if (by === "tour" && playing) {
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

  const jump = (event: KeyboardEvent) => {
    if (event.key === "ArrowRight") pick(activeIndex + 1, "controls");
    else if (event.key === "ArrowLeft") pick(activeIndex - 1, "controls");
    else return false;

    event.preventDefault();

    return true;
  };

  return {
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
        >
          {playing ? pauseIcon : playIcon}
        </ControlButton>
        <StopCaption stops={stops} activeIndex={activeIndex} />
      </>
    ),
  };
}
