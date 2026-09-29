import { CodePeekGroup } from "@canvas/CodePeek";
import {
  type ReviewNodeTint,
  type ReviewTheme,
  useReviewDebugSettings,
} from "@canvas/debug-settings";
import { diagramStyles } from "@canvas/diagram-styles";
import { hasTextSelectionWithin } from "@canvas/diagram-text-selection";
import { useReviewSession } from "@canvas/host/review-session";
import { CloseIcon, RefreshIcon } from "@canvas/icons";
import { mapFrameMarker } from "@canvas/markers.stylex";
import { useReviewContainer } from "@canvas/review-root-context";
import { shellStyles } from "@canvas/shell-styles";
import { useRightPanelResize } from "@canvas/side-panel-resizer";
import { withClass } from "@canvas/stylex-props";
import { themeStyles } from "@canvas/theme-styles";
import { tokens } from "@canvas/tokens.stylex";
import { captureUiEvent } from "@canvas/ui-telemetry";
import { codePeekSource } from "@review/source";
import * as stylex from "@stylexjs/stylex";
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Edge as ReactFlowEdge,
  type EdgeProps as ReactFlowEdgeProps,
  type ReactFlowInstance,
  type NodeProps as ReactFlowNodeProps,
} from "@xyflow/react";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import {
  c4EdgeLabelPoint,
  c4EdgePointsFromSections,
} from "./c4-edge-label-geometry";
import {
  C4_FIT_VIEW_PADDING,
  C4_FLOW_MAX_ZOOM,
  C4_FLOW_MIN_ZOOM,
  type SoftwareMapDataStoreOutlineKind,
  c4DataStoreSchemaSignature,
  c4EdgeEndpointBubbles,
  c4LayoutSignature,
  c4PreviousInlineLayoutForRelationships,
  createC4MapFlowFromLayout,
  fitC4MapView,
  focusC4MapNodeAndKeyboard,
  revealC4MapNode,
  runInlineC4Layout,
  runSerializedC4Layout,
  softwareMapDataStoreOutlineKind,
} from "./c4-layout-geometry";
import type {
  C4ElkPoint,
  C4LayoutResult,
  C4MapAnyFlowNode,
  C4MapEdgeData,
  C4MapFlowGroupNode,
  C4MapFlowNode,
  C4MapInteractionMode,
  C4NodeDimensions,
  InlineC4LayoutResult,
} from "./c4-map-flow-types";
import { scheduleC4NodeMeasurements } from "./c4-node-measurement";
import { collapseInlineC4Node, projectInlineC4 } from "./c4-projection";
import { SoftwareMapHotkeysTab } from "./hotkeys-tab";
import type {
  NormalizedSoftwareModel,
  SoftwareChangeStatus,
  SoftwareDataStoreKind,
} from "./model";
import {
  SoftwareMapUnavailable,
  softwareMapCssLength,
} from "./software-map-absence";
import {
  C4_MAP_HOTKEY_GROUPS,
  type SoftwareMapViewportFocusRequest,
  c4MapReactFlowInteractionProps,
  c4SpatialDirectionForKey,
  c4SpatialPositions,
  findSpatialC4Node,
  focusSoftwareMapKeyboardTarget,
  isSoftwareMapEditableTarget,
  parentSoftwareMapNodeId,
  selectedSoftwareMapNodeIdForNodes,
  shouldAutoFocusC4MapKeyboardTarget,
  shouldShowSoftwareMapFloatingActions,
  softwareMapChildNodeIdForDrill,
  softwareMapEventTargetNodeId,
  softwareMapNodeForKeyboardExpansion,
  softwareMapNodeIdForDrill,
  softwareMapOverlayClassName,
  softwareMapViewportFocusNodeId,
  softwareMapViewportFocusTargetReady,
  toggledSoftwareMapExpandedNodeIds,
  toggledSoftwareMapViewportFocusRequest,
} from "./software-map-keyboard-navigation";
import {
  hasStoredSoftwareMapNavigationState,
  initialSoftwareMapExpandedNodeIds,
  rememberSoftwareMapNavigationState,
  restoreSoftwareMapNavigationState,
  seedSoftwareMapDefaultExpandedNodeIds,
  softwareMapAncestorPaths,
  softwareMapNavigationKey,
} from "./software-map-navigation-state";
import {
  shouldApplySoftwareMapModifiedOnly,
  softwareMapModelKey,
  softwareMapResolvedDataInputForModel,
} from "./software-map-resolved-data";
import {
  type SoftwareMapDataStoreSchemaSectionSnapshot,
  type SoftwareMapElementType,
  type SoftwareMapNodeDiffPeek,
  type SoftwareMapNodeSnapshot,
  type SoftwareMapRelationshipSnapshot,
  type SoftwareMapResolvedDataPayload,
  type SoftwareMapResolvedSnapshot,
  type SoftwareMapViewType,
  buildSoftwareMapChangeSummaries,
  c4DisplayedSnapshotForCurrentState,
  softwareMapNodeDiffPeeks,
  softwareMapSnapshotFromInlineC4Projection,
  visibleSoftwareMapChangeCount,
} from "./software-map-snapshot";
import { softwareMapRootProps } from "./software-map-styles";

export type {
  SoftwareMapDataStoreSchemaRowSnapshot,
  SoftwareMapNodeSnapshot,
  SoftwareMapRelationshipSnapshot,
  SoftwareMapResolvedSnapshot,
} from "./software-map-snapshot";

const DEFAULT_CODE_INSPECTOR_WIDTH = 420;

const MIN_CODE_INSPECTOR_WIDTH = 340;

const MAX_CODE_INSPECTOR_WIDTH = 760;

const MIN_SOFTWARE_MAP_CANVAS_WIDTH = 420;

export type PinnedSoftwareMapData = SoftwareMapResolvedDataPayload & {
  side: "base" | "head";
  diagramId?: string;
};

interface SoftwareMapProps {
  diagramId?: string;
  model?: NormalizedSoftwareModel;
  pinnedData?: PinnedSoftwareMapData;
  title?: string;
  view?: string;
  focusRequest?: { requestId: number; elementPath: string } | null;
  height?: number | string;
  snapshot?: SoftwareMapResolvedSnapshot | null;
  resolvedSnapshot?: SoftwareMapResolvedSnapshot | null;
  status?: string | null;
  error?: string | null;
  className?: string;
  placeholderLabel?: string;
  showChrome?: boolean;
  showFloatingActions?: boolean;
  /** "view" fills the map view's canvas shell. */
  variant?: "view";
}

interface SoftwareMapFrameProps {
  diagramId?: string;
  snapshot: SoftwareMapResolvedSnapshot;
  hasResolvedSnapshot: boolean;
  title: string;
  height?: number | string;
  status?: string | null;
  error?: string | null;
  refreshing?: boolean;
  expanded: boolean;
  showChrome: boolean;
  showFloatingActions: boolean;
  /** "view" fills the map view; "lens" sits in a database lens canvas. */
  variant?: "view" | "lens";
  interactionMode: C4MapInteractionMode;
  onRefresh?: () => void;
  onExpand?: () => void;
  onClose?: () => void;
  inspectedNode?: SoftwareMapNodeSnapshot | null;
  inspectedNodeDiffPeeks?: readonly SoftwareMapNodeDiffPeek[];
  onCloseCodeInspector?: () => void;
  onSelectNode?: (node: SoftwareMapNodeSnapshot) => void;
  onExpandNode?: (node: SoftwareMapNodeSnapshot) => void;
  onCollapseNode?: (node: SoftwareMapNodeSnapshot) => void;
  onToggleNodeExpansion?: (node: SoftwareMapNodeSnapshot) => void;
  onFocusNode?: (node: SoftwareMapNodeSnapshot) => void;
  relationshipStateById?: ReadonlyMap<string, "active" | "inactive">;
  onOpenRelationship?: (relationshipId: string) => void;
  selectChildNodeIdForDrill?: (
    parentId: string,
    nodes: readonly Pick<SoftwareMapNodeSnapshot, "id" | "parentId">[],
  ) => string | null;
  viewportFocusNodeId?: string | null;
  viewportFocusRequiresExpanded?: boolean;
  onViewportFocusComplete?: (nodeId: string) => void;
}

interface C4DisplayedLayoutState {
  signature: string;
  snapshot: SoftwareMapResolvedSnapshot;
  layout: C4LayoutResult;
}

const ELEMENT_TYPE_LABELS: Record<SoftwareMapElementType, string> = {
  person: "Person",
  softwareSystem: "System",
  container: "Container",
  dataStore: "Data Store",
  dataStoreCollection: "Table",
  component: "Component",
  codeElement: "Code",
};

const DATA_STORE_KIND_LABELS: Record<SoftwareDataStoreKind, string> = {
  database: "Database",
  objectStore: "Object Store",
  bucket: "Bucket",
  artifactStore: "Artifact Store",
  fileStore: "File Store",
};

const VIEW_TYPE_LABELS: Record<SoftwareMapViewType, string> = {
  inlineC4: "Inline map",
};

function softwareMapNodeTypeLabel(
  node: Pick<
    SoftwareMapNodeSnapshot,
    "type" | "dataStoreKind" | "dataStoreSchemaSections"
  >,
) {
  if (node.type === "dataStore") {
    return DATA_STORE_KIND_LABELS[node.dataStoreKind ?? "database"];
  }

  if (node.type === "dataStoreCollection") {
    const sectionKind = node.dataStoreSchemaSections?.[0]?.kind;

    return sectionKind === "document" ? "Document" : "Table";
  }

  return ELEMENT_TYPE_LABELS[node.type];
}

const softwareMapC4NodeTypes = {
  softwareMapC4: SoftwareMapC4Node,
  softwareMapC4Group: SoftwareMapC4GroupNode,
};

const softwareMapC4EdgeTypes = {
  softwareMapC4Edge: SoftwareMapC4Edge,
};

const c4NodeTypes = softwareMapC4NodeTypes;

const c4EdgeTypes = softwareMapC4EdgeTypes;

const C4HoveredNodeContext = createContext<string | null>(null);

export function SoftwareMap(props: SoftwareMapProps) {
  if (!props.model && !props.snapshot && !props.resolvedSnapshot) {
    return (
      <SoftwareMapUnavailable
        title={props.title}
        height={props.height ?? 520}
        className={props.className}
        variant={props.variant}
      />
    );
  }

  return <SoftwareMapWithModel {...props} />;
}

function SoftwareMapWithModel({
  model,
  pinnedData,
  diagramId = pinnedData?.diagramId,
  title,
  view,
  focusRequest,
  height = 520,
  snapshot,
  resolvedSnapshot,
  status,
  error,
  className,
  placeholderLabel = "Software map",
  showChrome = true,
  showFloatingActions = true,
  variant,
}: SoftwareMapProps) {
  const session = useReviewSession();
  const portalTarget = useReviewContainer();
  const debugSettings = useReviewDebugSettings();
  const { showRemovedNodes } = debugSettings;

  // A pinned map with no mapped changes is still useful as an architecture view.
  const showModifiedOnly =
    debugSettings.showModifiedOnly &&
    (!pinnedData ||
      pinnedData.counts.size > 0 ||
      pinnedData.unmappedByElementPath.size > 0);

  const modelKey = useMemo(
    () =>
      softwareMapModelKey({
        model,
        view,
        showModifiedOnly,
        showRemovedNodes,
      }),
    [model, showModifiedOnly, showRemovedNodes, view],
  );

  const navigationKey = softwareMapNavigationKey({
    title: diagramId ?? title,
    view,
    placeholderLabel,
  });

  const initialNavigation = restoreSoftwareMapNavigationState(
    session,
    navigationKey,
    modelKey,
  );

  const hasInitialNavigation = hasStoredSoftwareMapNavigationState(
    session,
    navigationKey,
    modelKey,
  );

  const initialExpandedNodeIds = hasInitialNavigation
    ? new Set(initialNavigation.expandedNodeIds)
    : initialSoftwareMapExpandedNodeIds(model);

  const [expanded, setExpanded] = useState(initialNavigation.expanded);

  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(
    () => initialExpandedNodeIds,
  );

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    initialNavigation.selectedNodeId,
  );

  const [inspectedNode, setInspectedNode] =
    useState<SoftwareMapNodeSnapshot | null>(null);

  useEffect(() => setInspectedNode(null), [modelKey, navigationKey]);

  const softwareMapResolvedDataInput = useMemo(
    () =>
      model
        ? softwareMapResolvedDataInputForModel(model, {
            expandedElementPaths: expandedNodeIds,
          })
        : null,
    [expandedNodeIds, model],
  );

  const [viewportFocusRequest, setViewportFocusRequest] =
    useState<SoftwareMapViewportFocusRequest | null>(null);

  const resolvedDataState = pinnedData ?? {
    counts: new Map(),
    unmappedByElementPath: new Map(),
  };

  const mapRootRef = useRef<HTMLElement | null>(null);
  const previousBaseView = useRef(view);
  const defaultExpansionActiveRef = useRef(!hasInitialNavigation);
  const rememberedChildNodeIdsRef = useRef(new Map<string, string>());

  useEffect(() => {
    if (previousBaseView.current === view) {
      return;
    }

    previousBaseView.current = view;
    setSelectedNodeId(null);
    setExpandedNodeIds(new Set());
  }, [view]);

  useEffect(() => {
    if (!focusRequest) return;
    const targetPath = focusRequest.elementPath;
    setExpandedNodeIds((current) => {
      const next = new Set(current);

      for (const ancestorPath of softwareMapAncestorPaths(targetPath)) {
        next.add(ancestorPath);
      }

      return next;
    });
    setSelectedNodeId(targetPath);
    setViewportFocusRequest({
      nodeId: targetPath,
      requireExpanded: false,
    });
  }, [focusRequest]);

  useEffect(() => {
    rememberSoftwareMapNavigationState(session, navigationKey, {
      modelKey,
      expandedNodeIds: [...expandedNodeIds],
      selectedNodeId,
      expanded,
    });
  }, [
    expanded,
    expandedNodeIds,
    modelKey,
    navigationKey,
    selectedNodeId,
    session,
  ]);

  const resolvedDataReady = Boolean(pinnedData);

  const projectionModel = useMemo(
    () => (model && resolvedDataReady ? model : null),
    [model, resolvedDataReady],
  );

  useEffect(() => {
    if (!projectionModel || !defaultExpansionActiveRef.current) return;
    setExpandedNodeIds((current) => {
      const next = seedSoftwareMapDefaultExpandedNodeIds({
        expandedNodeIds: current,
        model: projectionModel,
        defaultExpansionActive: defaultExpansionActiveRef.current,
      });

      if (
        next.size === current.size &&
        [...current].every((nodeId) => next.has(nodeId))
      ) {
        return current;
      }

      return next;
    });
  }, [projectionModel]);

  const changeSummaries = useMemo(
    () =>
      projectionModel
        ? buildSoftwareMapChangeSummaries(
            projectionModel,
            resolvedDataReady ? resolvedDataState.counts : new Map(),
            resolvedDataReady
              ? resolvedDataState.unmappedByElementPath
              : new Map(),
          )
        : new Map(),
    [projectionModel, resolvedDataReady, resolvedDataState],
  );

  const modifiedOnlyNodeIds = useMemo(
    () =>
      new Set(
        changeSummaries
          .entries()
          .filter(([, summary]) => summary.changeStatus !== "unchanged")
          .map(([path]) => path),
      ),
    [changeSummaries],
  );

  const shouldApplyModifiedOnly = shouldApplySoftwareMapModifiedOnly({
    showModifiedOnly,
    resolvedDataReady,
    resolvedDataInput: softwareMapResolvedDataInput,
  });

  const modelSnapshotState = useMemo(() => {
    if (!projectionModel) {
      return {
        snapshot: null,
        error: null,
      };
    }

    try {
      return {
        snapshot: softwareMapSnapshotFromInlineC4Projection({
          projection: projectInlineC4({
            model: projectionModel,
            expandedNodeIds,
            selectedNodeId: selectedNodeId ?? undefined,
            modifiedOnly: shouldApplyModifiedOnly,
            showRemovedNodes,
            changedNodeIds: modifiedOnlyNodeIds,
          }),
          changeSummaries,
        }),
        error: null,
      };
    } catch (caught) {
      return {
        snapshot: null,
        error: caught instanceof Error ? caught.message : String(caught),
      };
    }
  }, [
    changeSummaries,
    expandedNodeIds,
    modifiedOnlyNodeIds,
    selectedNodeId,
    shouldApplyModifiedOnly,
    showRemovedNodes,
    projectionModel,
  ]);

  const activeModelSnapshot = modelSnapshotState.snapshot;

  const providedSnapshot =
    snapshot ?? resolvedSnapshot ?? activeModelSnapshot ?? null;

  const hasResolvedSnapshot = Boolean(providedSnapshot);

  const mapSnapshot = useMemo(() => {
    const base =
      providedSnapshot ?? createPlaceholderSnapshot(placeholderLabel, view);

    const selectedForView = selectedSoftwareMapNodeIdForNodes({
      nodes: base.nodes ?? [],
      selectedNodeId,
    });

    return selectedForView
      ? { ...base, selectedNodeId: selectedForView }
      : base;
  }, [view, placeholderLabel, providedSnapshot, selectedNodeId]);

  const inspectedNodeDiffPeeks = useMemo(() => {
    if (!inspectedNode) return [];

    if (projectionModel && inspectedNode.path) {
      return softwareMapNodeDiffPeeks({
        model: projectionModel,
        elementPath: inspectedNode.path,
        changeSummaries,
        sourceSide: pinnedData?.side,
      });
    }

    if (!inspectedNode.file || !inspectedNode.line) return [];
    const graph = inspectedNode.changeStatus === "removed" ? "base" : "head";

    return [
      {
        file: inspectedNode.file,
        fromLine: inspectedNode.line,
        toLine: inspectedNode.line,
        graph,
      } satisfies SoftwareMapNodeDiffPeek,
    ];
  }, [changeSummaries, inspectedNode, projectionModel, pinnedData?.side]);

  useEffect(() => {
    const nextSelectedNodeId = selectedSoftwareMapNodeIdForNodes({
      nodes: mapSnapshot.nodes ?? [],
      selectedNodeId,
    });

    if (nextSelectedNodeId !== selectedNodeId) {
      setSelectedNodeId(nextSelectedNodeId);
    }
  }, [mapSnapshot.nodes, selectedNodeId]);

  const frameTitle = title ?? mapSnapshot.title ?? placeholderLabel;

  const statusMessage =
    status ?? mapSnapshot.status ?? modelSnapshotState.error ?? null;

  const errorMessage = error;

  const rememberChildNodeFocus = useCallback(
    (node: Pick<SoftwareMapNodeSnapshot, "id" | "parentId">) => {
      if (node.parentId) {
        rememberedChildNodeIdsRef.current.set(node.parentId, node.id);
      }
    },
    [],
  );

  const selectChildNodeIdForDrill = useCallback(
    (
      parentId: string,
      nodes: readonly Pick<SoftwareMapNodeSnapshot, "id" | "parentId">[],
    ) =>
      softwareMapChildNodeIdForDrill({
        nodes,
        parentId,
        rememberedChildNodeId:
          rememberedChildNodeIdsRef.current.get(parentId) ?? null,
      }),
    [],
  );

  const handleSelectNode = (node: SoftwareMapNodeSnapshot) => {
    rememberChildNodeFocus(node);
    setViewportFocusRequest(null);
    setSelectedNodeId(node.id);
    setInspectedNode(node);
  };

  const handleFocusNode = (node: SoftwareMapNodeSnapshot) => {
    setViewportFocusRequest({
      nodeId: node.id,
      requireExpanded: false,
    });
  };

  const handleExpandNode = (node: SoftwareMapNodeSnapshot) => {
    if (!node.path || !node.expandable) return;
    defaultExpansionActiveRef.current = false;
    setInspectedNode(node);

    if (!projectionModel) {
      setSelectedNodeId(node.id);

      return;
    }

    const nextExpandedNodeIds = new Set(expandedNodeIds);
    nextExpandedNodeIds.add(node.path);

    const nextProjection = projectInlineC4({
      model: projectionModel,
      expandedNodeIds: nextExpandedNodeIds,
      selectedNodeId: node.id,
      modifiedOnly: shouldApplyModifiedOnly,
      showRemovedNodes,
      changedNodeIds: modifiedOnlyNodeIds,
    });

    const nextNodes = nextProjection.nodes.map((element) => ({
      id: element.id,
      parentId: element.parentPath ?? null,
    }));

    const childNodeId =
      selectChildNodeIdForDrill(node.id, nextNodes) ?? node.id;

    if (childNodeId !== node.id) {
      rememberChildNodeFocus({
        id: childNodeId,
        parentId: node.id,
      });
    }

    setSelectedNodeId(childNodeId);
    setViewportFocusRequest({
      nodeId: node.id,
      requireExpanded: true,
    });
    setExpandedNodeIds(nextExpandedNodeIds);
  };

  const handleCollapseNode = (node: SoftwareMapNodeSnapshot) => {
    if (!node.path) return;
    defaultExpansionActiveRef.current = false;
    setViewportFocusRequest({
      nodeId: node.id,
      requireExpanded: false,
    });
    setSelectedNodeId(node.id);
    setExpandedNodeIds((current) => collapseInlineC4Node(current, node.path!));
  };

  const handleToggleNodeExpansion = (node: SoftwareMapNodeSnapshot) => {
    if (!node.path || !node.expandable) return;
    defaultExpansionActiveRef.current = false;
    setSelectedNodeId(node.id);
    setViewportFocusRequest(toggledSoftwareMapViewportFocusRequest(node));
    setExpandedNodeIds((current) =>
      toggledSoftwareMapExpandedNodeIds({
        expandedNodeIds: current,
        node,
      }),
    );
  };

  const handleCloseCodeInspector = () => setInspectedNode(null);

  useEffect(() => {
    if (!expanded) return;

    // Lock the canvas scroller (not document.body: the canvas composes into
    // the host DOM, so the element that actually scrolls the review is the
    // view region).
    const scroller = document.querySelector<HTMLElement>(
      ".review-view-region--review",
    );

    const originalOverflow = scroller?.style.overflow ?? "";

    if (scroller) scroller.style.overflow = "hidden";

    return () => {
      if (scroller) scroller.style.overflow = originalOverflow;
    };
  }, [expanded]);

  const frame = (
    <SoftwareMapFrame
      diagramId={diagramId}
      snapshot={mapSnapshot}
      hasResolvedSnapshot={hasResolvedSnapshot}
      title={frameTitle}
      height={height}
      status={statusMessage}
      error={errorMessage}
      expanded={false}
      showChrome={showChrome}
      showFloatingActions={showFloatingActions}
      variant={variant}
      interactionMode={showChrome ? "inline" : "standalone"}
      onExpand={() => setExpanded(true)}
      onCloseCodeInspector={handleCloseCodeInspector}
      inspectedNode={inspectedNode}
      inspectedNodeDiffPeeks={inspectedNodeDiffPeeks}
      onSelectNode={handleSelectNode}
      onExpandNode={handleExpandNode}
      onCollapseNode={handleCollapseNode}
      onToggleNodeExpansion={handleToggleNodeExpansion}
      onFocusNode={handleFocusNode}
      selectChildNodeIdForDrill={selectChildNodeIdForDrill}
      viewportFocusNodeId={viewportFocusRequest?.nodeId ?? null}
      viewportFocusRequiresExpanded={viewportFocusRequest?.requireExpanded}
      onViewportFocusComplete={(nodeId) => {
        setViewportFocusRequest((current) =>
          current?.nodeId === nodeId ? null : current,
        );
      }}
    />
  );

  return (
    <section
      ref={mapRootRef}
      {...softwareMapRootProps(className, variant)}
      aria-label={frameTitle}
    >
      {frame}
      {/* The desktop build wraps every canvas rule in
          @scope (.review-canvas-root), so the overlay must portal INSIDE the
          canvas root or it renders unstyled. */}
      {expanded && portalTarget
        ? createPortal(
            <div
              {...softwareMapOverlayProps(debugSettings)}
              role="dialog"
              aria-modal="true"
              aria-label={`${frameTitle} expanded`}
            >
              <SoftwareMapFrame
                diagramId={diagramId}
                snapshot={mapSnapshot}
                hasResolvedSnapshot={hasResolvedSnapshot}
                title={frameTitle}
                status={statusMessage}
                error={errorMessage}
                expanded
                showChrome
                showFloatingActions={showFloatingActions}
                interactionMode="standalone"
                onClose={() => setExpanded(false)}
                onCloseCodeInspector={handleCloseCodeInspector}
                inspectedNode={inspectedNode}
                inspectedNodeDiffPeeks={inspectedNodeDiffPeeks}
                onSelectNode={handleSelectNode}
                onExpandNode={handleExpandNode}
                onCollapseNode={handleCollapseNode}
                onToggleNodeExpansion={handleToggleNodeExpansion}
                onFocusNode={handleFocusNode}
                selectChildNodeIdForDrill={selectChildNodeIdForDrill}
                viewportFocusNodeId={viewportFocusRequest?.nodeId ?? null}
                viewportFocusRequiresExpanded={
                  viewportFocusRequest?.requireExpanded
                }
                onViewportFocusComplete={(nodeId) => {
                  setViewportFocusRequest((current) =>
                    current?.nodeId === nodeId ? null : current,
                  );
                }}
              />
            </div>,
            portalTarget,
          )
        : null}
    </section>
  );
}

export function SoftwareMapFrame({
  snapshot,
  diagramId,
  hasResolvedSnapshot,
  title,
  height,
  status,
  error,
  refreshing,
  expanded,
  showChrome,
  showFloatingActions,
  variant,
  interactionMode,
  onRefresh,
  onExpand,
  onClose,
  inspectedNode,
  inspectedNodeDiffPeeks = [],
  onCloseCodeInspector,
  onSelectNode,
  onExpandNode,
  onCollapseNode,
  onToggleNodeExpansion,
  onFocusNode,
  relationshipStateById,
  onOpenRelationship,
  selectChildNodeIdForDrill,
  viewportFocusNodeId,
  viewportFocusRequiresExpanded,
  onViewportFocusComplete,
}: SoftwareMapFrameProps) {
  const session = useReviewSession();
  const frameRef = useRef<HTMLElement | null>(null);

  const codeInspectorResize = useRightPanelResize({
    // The expanded overlay is far wider than the inline frame, so it keeps its
    // own width instead of having a wide drag clamped down over the inline one.
    stateKey: expanded
      ? "code-inspector-width-expanded"
      : "code-inspector-width",
    defaultWidth: DEFAULT_CODE_INSPECTOR_WIDTH,
    minWidth: MIN_CODE_INSPECTOR_WIDTH,
    maxWidth: MAX_CODE_INSPECTOR_WIDTH,
    minMainWidth: MIN_SOFTWARE_MAP_CANVAS_WIDTH,
    separatorWidth: 10,
    label: "Resize code inspector",
    containerRef: frameRef,
  });

  const viewType = snapshot.viewType ?? "inlineC4";

  // SAFETY: React passes "--*" keys through to style.setProperty; CSSProperties
  // only lacks an index signature for custom properties.
  const style =
    height && !expanded
      ? ({
          "--software-map-height": softwareMapCssLength(height),
        } as CSSProperties)
      : undefined;

  // SAFETY: React passes "--*" keys through to style.setProperty; CSSProperties
  // only lacks an index signature for custom properties.
  const bodyStyle = inspectedNode
    ? ({
        "--software-map-inspector-width": `${codeInspectorResize.width}px`,
      } as CSSProperties)
    : undefined;

  const showMapFloatingActions = shouldShowSoftwareMapFloatingActions({
    showChrome,
    showFloatingActions,
    hasCodeInspector: inspectedNode !== null,
    hasRefreshAction: Boolean(onRefresh),
  });

  const captureNodeExpansion = (node: SoftwareMapNodeSnapshot) => {
    if (!node.expandable || node.expanded) return;
    captureUiEvent(session, "map_expanded", {
      level: mapExpansionLevelForNode(node),
    });
  };

  const selectNodeWithTelemetry = (node: SoftwareMapNodeSnapshot) => {
    captureUiEvent(session, "peek_opened", { via: "map" });
    onSelectNode?.(node);
  };

  const expandNodeWithTelemetry = (node: SoftwareMapNodeSnapshot) => {
    captureNodeExpansion(node);
    captureUiEvent(session, "peek_opened", { via: "map" });
    onExpandNode?.(node);
  };

  const toggleNodeExpansionWithTelemetry = (node: SoftwareMapNodeSnapshot) => {
    captureNodeExpansion(node);
    onToggleNodeExpansion?.(node);
  };

  return (
    <figure
      ref={frameRef}
      {...softwareMapFrameProps({ expanded, showChrome, variant })}
      style={style}
    >
      {showChrome && (
        <header {...stylex.props(styles.header)}>
          <div {...stylex.props(diagramStyles.headerMain, styles.titleBlock)}>
            <span {...stylex.props(diagramStyles.kindBadge, styles.kindBadge)}>
              {VIEW_TYPE_LABELS[viewType]}
            </span>
            <figcaption
              {...stylex.props(diagramStyles.title, styles.title)}
              data-review-copy-prose
            >
              {title}
            </figcaption>
          </div>
          <div {...stylex.props(styles.actions)}>
            {onRefresh ? (
              <button
                type="button"
                {...stylex.props(
                  styles.iconButton,
                  refreshing && styles.refreshing,
                )}
                onClick={onRefresh}
                aria-label="Refresh software map"
                title="Refresh software map"
              >
                <RefreshIcon />
              </button>
            ) : null}
            {expanded ? (
              <button
                type="button"
                {...stylex.props(styles.iconButton)}
                onClick={onClose}
                aria-label="Close expanded software map"
              >
                <CloseIcon />
              </button>
            ) : (
              <button
                type="button"
                {...stylex.props(styles.iconButton, styles.expandButton)}
                onClick={onExpand}
                aria-label="Expand software map"
              >
                <span {...stylex.props(styles.expandIcon)} aria-hidden="true" />
              </button>
            )}
          </div>
        </header>
      )}
      {showMapFloatingActions && onRefresh ? (
        <div {...stylex.props(styles.floatingActions)}>
          <button
            type="button"
            {...stylex.props(
              styles.iconButton,
              refreshing && styles.refreshing,
            )}
            onClick={onRefresh}
            aria-label="Refresh software map"
            title="Refresh software map"
          >
            <RefreshIcon />
          </button>
        </div>
      ) : null}

      <div
        {...stylex.props(
          styles.body,
          inspectedNode && styles.bodyWithInspector,
          codeInspectorResize.isResizing && styles.bodyResizing,
        )}
        style={bodyStyle}
      >
        {/* The class is the block tests' hook for a drawn map. */}
        <div {...withClass("software-map-canvas", styles.canvas)}>
          {(status || error || !hasResolvedSnapshot) && (
            <div
              {...stylex.props(
                styles.status,
                Boolean(error) && styles.statusError,
              )}
            >
              {error ?? status ?? "Loading software map..."}
            </div>
          )}

          <C4MapCanvas
            snapshot={snapshot}
            expanded={expanded}
            lens={variant === "lens"}
            interactionMode={interactionMode}
            onSelectNode={selectNodeWithTelemetry}
            onExpandNode={expandNodeWithTelemetry}
            onCollapseNode={onCollapseNode}
            onToggleNodeExpansion={toggleNodeExpansionWithTelemetry}
            onFocusNode={onFocusNode}
            relationshipStateById={relationshipStateById}
            onOpenRelationship={onOpenRelationship}
            selectChildNodeIdForDrill={selectChildNodeIdForDrill}
            viewportFocusNodeId={viewportFocusNodeId}
            viewportFocusRequiresExpanded={viewportFocusRequiresExpanded}
            onViewportFocusComplete={onViewportFocusComplete}
          />
        </div>
        {inspectedNode ? (
          <>
            <button
              type="button"
              {...stylex.props(styles.inspectorBackdrop)}
              aria-label="Close code inspector"
              onClick={onCloseCodeInspector}
            />
            <div
              {...stylex.props(shellStyles.resizer, styles.inspectorResizer)}
              {...codeInspectorResize.separatorProps}
            />
            <SoftwareMapCodeInspector
              node={inspectedNode}
              diffPeeks={inspectedNodeDiffPeeks}
              onClose={onCloseCodeInspector}
            />
          </>
        ) : null}
      </div>
    </figure>
  );
}

function SoftwareMapCodeInspector({
  node,
  diffPeeks,
  onClose,
}: {
  node: SoftwareMapNodeSnapshot;
  diffPeeks: readonly SoftwareMapNodeDiffPeek[];
  onClose?: () => void;
}) {
  const [diffsCollapsed, setDiffsCollapsed] = useState(false);

  const diffPeekSources = useMemo(
    () => diffPeeks.map(codePeekSource),
    [diffPeeks],
  );

  const collapseActionLabel = diffsCollapsed
    ? "Expand all diffs"
    : "Collapse all diffs";

  return (
    // The class is the hook code peeks restyle themselves by in the inspector.
    <aside
      {...withClass("software-map-code-inspector", styles.inspector)}
      aria-label={`${node.label} diff`}
    >
      <header {...stylex.props(styles.inspectorHeader)}>
        <div {...stylex.props(styles.inspectorTitle)}>
          <span {...stylex.props(styles.inspectorKind)}>
            {softwareMapNodeTypeLabel(node)}
          </span>
          <strong {...stylex.props(styles.inspectorLabel)} title={node.label}>
            {node.label}
          </strong>
        </div>
        <div {...stylex.props(styles.inspectorActions)}>
          {diffPeeks.length > 0 ? (
            <button
              type="button"
              {...stylex.props(styles.iconButton)}
              onClick={() => setDiffsCollapsed((current) => !current)}
              aria-expanded={!diffsCollapsed}
              aria-label={collapseActionLabel}
              title={collapseActionLabel}
            >
              <span
                {...withClass(
                  `codicon ${diffsCollapsed ? "codicon-unfold" : "codicon-fold"}`,
                  styles.codicon,
                )}
                aria-hidden="true"
              />
            </button>
          ) : null}
          <SoftwareMapChangeBadge
            additions={node.additions}
            deletions={node.deletions}
          />
          <button
            type="button"
            {...stylex.props(styles.iconButton)}
            onClick={onClose}
            aria-label="Close code inspector"
          >
            <CloseIcon />
          </button>
        </div>
      </header>
      <div {...stylex.props(styles.inspectorDiffs)}>
        {diffPeeks.length > 0 ? (
          <CodePeekGroup peeks={diffPeekSources} collapsed={diffsCollapsed} />
        ) : (
          <div {...stylex.props(styles.inspectorEmpty)}>
            No changed code is mapped to this node.
          </div>
        )}
      </div>
    </aside>
  );
}

/** The expanded map's layer, which carries the review theme with it. */
export function softwareMapOverlayProps(settings: {
  theme: ReviewTheme;
  nodeTint: ReviewNodeTint;
}) {
  return withClass(
    softwareMapOverlayClassName(settings),
    themeStyles.app,
    settings.theme === "light" && themeStyles.light,
    styles.overlay,
  );
}

/** A map frame's style props. */
export function softwareMapFrameProps({
  expanded,
  showChrome,
  variant,
}: Pick<SoftwareMapFrameProps, "expanded" | "showChrome" | "variant">) {
  return stylex.props(
    mapFrameMarker,
    styles.frame,
    expanded && styles.frameExpanded,
    !showChrome && styles.frameChromeHidden,
    variant === "view" && styles.frameView,
    variant === "lens" && styles.frameLens,
  );
}

function mapExpansionLevelForNode(
  node: Pick<SoftwareMapNodeSnapshot, "type">,
): "system" | "container" | "component" | "code" {
  switch (node.type) {
    case "person":
      return "system";
    case "softwareSystem":
      return "container";
    case "container":
    case "dataStore":
      return "component";
    case "component":
    case "dataStoreCollection":
    case "codeElement":
      return "code";
  }
}

function C4MapCanvas({
  snapshot,
  expanded,
  lens,
  interactionMode,
  onSelectNode,
  onExpandNode,
  onCollapseNode,
  onToggleNodeExpansion,
  onFocusNode,
  relationshipStateById,
  onOpenRelationship,
  selectChildNodeIdForDrill,
  viewportFocusNodeId,
  viewportFocusRequiresExpanded,
  onViewportFocusComplete,
}: {
  snapshot: SoftwareMapResolvedSnapshot;
  expanded: boolean;
  lens?: boolean;
  interactionMode: C4MapInteractionMode;
  onSelectNode?: (node: SoftwareMapNodeSnapshot) => void;
  onExpandNode?: (node: SoftwareMapNodeSnapshot) => void;
  onCollapseNode?: (node: SoftwareMapNodeSnapshot) => void;
  onToggleNodeExpansion?: (node: SoftwareMapNodeSnapshot) => void;
  onFocusNode?: (node: SoftwareMapNodeSnapshot) => void;
  relationshipStateById?: ReadonlyMap<string, "active" | "inactive">;
  onOpenRelationship?: (relationshipId: string) => void;
  selectChildNodeIdForDrill?: (
    parentId: string,
    nodes: readonly Pick<SoftwareMapNodeSnapshot, "id" | "parentId">[],
  ) => string | null;
  viewportFocusNodeId?: string | null;
  viewportFocusRequiresExpanded?: boolean;
  onViewportFocusComplete?: (nodeId: string) => void;
}) {
  const session = useReviewSession();

  const [layoutState, setLayoutState] = useState<C4DisplayedLayoutState | null>(
    null,
  );

  const [layoutError, setLayoutError] = useState<string | null>(null);
  const keyboardTargetRef = useRef<HTMLDivElement | null>(null);

  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<
    C4MapAnyFlowNode,
    ReactFlowEdge
  > | null>(null);

  const [hotkeysOpen, setHotkeysOpen] = useState(true);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  const flowRef = useRef<ReactFlowInstance<
    C4MapAnyFlowNode,
    ReactFlowEdge
  > | null>(null);

  const previousInlineLayoutRef = useRef<{
    layout: InlineC4LayoutResult;
    relationships: readonly SoftwareMapRelationshipSnapshot[];
  } | null>(null);

  const appliedLayoutSignatureRef = useRef<string | null>(null);

  const [nodeMeasurement, setNodeMeasurement] = useState<{
    key: string;
    dimensions: ReadonlyMap<string, C4NodeDimensions>;
  } | null>(null);

  const measuredNodes = snapshot.nodes ?? [];
  const measuredRelationships = snapshot.relationships ?? [];

  const displayedSnapshot = useMemo(
    () =>
      layoutState
        ? c4DisplayedSnapshotForCurrentState(layoutState.snapshot, snapshot)
        : snapshot,
    [layoutState, snapshot],
  );

  const layout = layoutState?.layout ?? null;
  const nodes = displayedSnapshot.nodes ?? [];
  const { theme } = useReviewDebugSettings();

  const reactFlowInteractionProps =
    c4MapReactFlowInteractionProps(interactionMode);

  const measurementKey = useMemo(
    () => c4MeasurementKey(measuredNodes),
    [measuredNodes],
  );

  const nodeDimensions =
    nodeMeasurement?.key === measurementKey ? nodeMeasurement.dimensions : null;

  const hasMeasuredNodes =
    measuredNodes.length === 0 ||
    (nodeDimensions !== null &&
      measuredNodes.every((node) => nodeDimensions.has(node.id)));

  const handleMeasuredNodes = useCallback(
    (nextDimensions: ReadonlyMap<string, C4NodeDimensions>) => {
      setNodeMeasurement((currentMeasurement) =>
        currentMeasurement?.key === measurementKey &&
        c4DimensionsEqual(currentMeasurement.dimensions, nextDimensions)
          ? currentMeasurement
          : { key: measurementKey, dimensions: nextDimensions },
      );
    },
    [measurementKey],
  );

  const layoutSignature = useMemo(
    () =>
      hasMeasuredNodes
        ? c4LayoutSignature(
            measuredNodes,
            measuredRelationships,
            nodeDimensions,
          )
        : "",
    [hasMeasuredNodes, measuredNodes, measuredRelationships, nodeDimensions],
  );

  const layoutInputRef = useRef({
    snapshot,
    nodes: measuredNodes,
    relationships: measuredRelationships,
    nodeDimensions,
  });

  layoutInputRef.current = {
    snapshot,
    nodes: measuredNodes,
    relationships: measuredRelationships,
    nodeDimensions,
  };

  const wasmUrl = session.wasmUrl();

  useEffect(() => {
    if (!hasMeasuredNodes || !layoutSignature) return;

    if (appliedLayoutSignatureRef.current === layoutSignature) return;
    let cancelled = false;
    setLayoutError(null);

    const {
      nodes: layoutNodes,
      relationships: layoutRelationships,
      nodeDimensions: layoutNodeDimensions,
      snapshot: layoutSnapshot,
    } = layoutInputRef.current;

    const previousInlineLayout = c4PreviousInlineLayoutForRelationships({
      previousLayout: previousInlineLayoutRef.current?.layout,
      previousRelationships: previousInlineLayoutRef.current?.relationships,
      currentRelationships: layoutRelationships,
    });

    void runSerializedC4Layout(() =>
      cancelled
        ? Promise.resolve(null)
        : runInlineC4Layout(
            layoutNodes,
            layoutRelationships,
            layoutNodeDimensions ?? undefined,
            // A newly resolved edge changes the graph that determines node
            // placement. Reusing a no-edge layout keeps the graph in its old
            // stack, even though the edge itself is present.
            previousInlineLayout,
            wasmUrl,
          ),
    )
      .then((nextLayout) => {
        if (cancelled || !nextLayout) return;
        appliedLayoutSignatureRef.current = layoutSignature;
        previousInlineLayoutRef.current = {
          layout: nextLayout.inlineLayout,
          relationships: layoutRelationships,
        };
        setLayoutState({
          signature: layoutSignature,
          snapshot: layoutSnapshot,
          layout: nextLayout.layout,
        });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setLayoutError(cause instanceof Error ? cause.message : String(cause));
      });

    return () => {
      cancelled = true;
    };
  }, [hasMeasuredNodes, layoutSignature, wasmUrl]);

  const layoutRefreshing = Boolean(
    layoutState && layoutSignature && layoutState.signature !== layoutSignature,
  );

  const drillNode = useCallback(
    (node: SoftwareMapNodeSnapshot) => {
      const drillNodeId = softwareMapNodeIdForDrill({
        node,
        nodes,
        preferredChildNodeId: selectChildNodeIdForDrill?.(node.id, nodes),
      });

      if (drillNodeId !== node.id) {
        const childNode = nodes.find(
          (candidate) => candidate.id === drillNodeId,
        );

        if (childNode) onSelectNode?.(childNode);

        return;
      }

      onExpandNode?.(node);
    },
    [nodes, onExpandNode, onSelectNode, selectChildNodeIdForDrill],
  );

  const flow = useMemo(
    () =>
      layout
        ? createC4MapFlowFromLayout(displayedSnapshot, layout, {
            onSelectNode,
            onExpandNode,
            onCollapseNode,
            onDrillNode: drillNode,
            nodeDimensions: nodeDimensions ?? undefined,
            relationshipStateById,
            onOpenRelationship,
            nodeClassName: FLOW_NODE_CLASS_NAME,
            edgeClassName: FLOW_EDGE_CLASS_NAME,
          })
        : null,
    [
      drillNode,
      layout,
      nodeDimensions,
      onCollapseNode,
      onExpandNode,
      onSelectNode,
      onOpenRelationship,
      relationshipStateById,
      displayedSnapshot,
    ],
  );

  useEffect(() => {
    if (!flowInstance || !layout) return;
    const canvas = keyboardTargetRef.current;
    let frame = 0;

    const scheduleFit = () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        fitC4MapView(flowRef.current);
      });
    };

    scheduleFit();

    if (!canvas || !hasResizeObserver()) {
      return () => {
        if (frame !== 0) cancelAnimationFrame(frame);
      };
    }

    const resizeObserver = new ResizeObserver(scheduleFit);
    resizeObserver.observe(canvas);

    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
    };
  }, [flowInstance, layout]);

  useEffect(() => {
    const focusNodeId = softwareMapViewportFocusNodeId({
      nodes: flow?.nodes ?? [],
      viewportFocusNodeId,
    });

    const focused = focusNodeId
      ? flow?.nodes.find((node) => node.id === focusNodeId)
      : null;

    if (!focused) return;

    if (
      !softwareMapViewportFocusTargetReady({
        node: focused.data.node,
        viewportFocusNodeId,
        requireExpanded: viewportFocusRequiresExpanded,
      })
    ) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      if (
        !focusC4MapNodeAndKeyboard(
          flowRef.current,
          focused,
          keyboardTargetRef.current,
        )
      ) {
        return;
      }

      if (viewportFocusNodeId === focused.id) {
        onViewportFocusComplete?.(focused.id);
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [
    flowInstance,
    flow?.nodes,
    onViewportFocusComplete,
    viewportFocusNodeId,
    viewportFocusRequiresExpanded,
  ]);

  useLayoutEffect(() => {
    if (!displayedSnapshot.selectedNodeId) return;
    focusSoftwareMapKeyboardTarget(keyboardTargetRef.current);
  }, [displayedSnapshot.selectedNodeId, displayedSnapshot.view]);

  useLayoutEffect(() => {
    if (!shouldAutoFocusC4MapKeyboardTarget(interactionMode)) return;
    focusSoftwareMapKeyboardTarget(keyboardTargetRef.current);
  }, [flow, interactionMode]);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.defaultPrevented) return;

      if (
        isSoftwareMapEditableTarget(event.target) ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return;
      }

      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        event.stopPropagation();
        fitC4MapView(flowRef.current);

        return;
      }

      const direction = c4SpatialDirectionForKey(event.key);

      if (direction) {
        event.preventDefault();
        event.stopPropagation();

        const nextId = findSpatialC4Node(
          displayedSnapshot.selectedNodeId,
          c4SpatialPositions(layout),
          direction,
        );

        const nextNode = nextId
          ? nodes.find((candidate) => candidate.id === nextId)
          : null;

        if (nextNode) {
          onSelectNode?.(nextNode);
          const flowNode = flow?.nodes.find((node) => node.id === nextNode.id);

          if (flowNode) {
            revealC4MapNode(
              flowRef.current,
              keyboardTargetRef.current,
              flowNode,
            );
          }
        }

        return;
      }

      if (event.key === "Enter") {
        const selected = displayedSnapshot.selectedNodeId
          ? nodes.find((node) => node.id === displayedSnapshot.selectedNodeId)
          : null;

        if (selected) {
          event.preventDefault();
          event.stopPropagation();
          drillNode(selected);
        }

        return;
      }

      if (event.key === "Tab") {
        const selected = softwareMapNodeForKeyboardExpansion({
          nodes,
          selectedNodeId: displayedSnapshot.selectedNodeId,
          focusedNodeId: softwareMapEventTargetNodeId(
            event.target,
            event.currentTarget,
          ),
        });

        if (selected) {
          event.preventDefault();
          event.stopPropagation();
          onToggleNodeExpansion?.(selected);
        }

        return;
      }

      if (event.key === "Escape") {
        const parentId = parentSoftwareMapNodeId({
          nodes,
          nodeId: displayedSnapshot.selectedNodeId,
        });

        const parent = parentId
          ? nodes.find((node) => node.id === parentId)
          : null;

        if (parent) {
          event.preventDefault();
          event.stopPropagation();
          onSelectNode?.(parent);
          onFocusNode?.(parent);
        }
      }
    },
    [
      layout,
      flow?.nodes,
      drillNode,
      nodes,
      onFocusNode,
      onSelectNode,
      onToggleNodeExpansion,
      displayedSnapshot.selectedNodeId,
    ],
  );

  const handleKeyDownCapture = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Tab") {
        handleKeyDown(event);
      }
    },
    [handleKeyDown],
  );

  // The class is the block tests' hook for a map still laying out.
  const codeStatusProps = withClass(
    "software-map-code-status",
    styles.codeStatus,
  );

  return (
    // The class scopes the React Flow internals in global.css.
    <div
      ref={keyboardTargetRef}
      {...withClass(
        "software-map-c4-canvas",
        styles.c4Canvas,
        lens && styles.c4CanvasLens,
      )}
      tabIndex={0}
      onKeyDownCapture={handleKeyDownCapture}
      onKeyDown={handleKeyDown}
    >
      <C4NodeMeasurementLayer
        nodes={measuredNodes}
        measurementKey={measurementKey}
        onMeasure={handleMeasuredNodes}
      />
      {layoutError ? (
        <div {...codeStatusProps}>Layout failed: {layoutError}</div>
      ) : (
        <>
          {layoutRefreshing ? (
            <div {...codeStatusProps}>Refreshing layout...</div>
          ) : null}
          {flow ? (
            <>
              <C4HoveredNodeContext.Provider value={hoveredNodeId}>
                <ReactFlow
                  {...stylex.props(styles.flow)}
                  colorMode={theme}
                  proOptions={{ hideAttribution: true }}
                  nodes={flow.nodes}
                  edges={flow.edges}
                  nodeTypes={c4NodeTypes}
                  edgeTypes={c4EdgeTypes}
                  nodesDraggable={false}
                  nodesConnectable={false}
                  elevateNodesOnSelect={false}
                  elementsSelectable
                  panActivationKeyCode={null}
                  fitView
                  fitViewOptions={{ padding: C4_FIT_VIEW_PADDING }}
                  minZoom={C4_FLOW_MIN_ZOOM}
                  maxZoom={C4_FLOW_MAX_ZOOM}
                  panOnScroll={reactFlowInteractionProps.panOnScroll}
                  preventScrolling={reactFlowInteractionProps.preventScrolling}
                  zoomOnScroll={reactFlowInteractionProps.zoomOnScroll}
                  zoomOnPinch={reactFlowInteractionProps.zoomOnPinch}
                  zoomOnDoubleClick={false}
                  onInit={(instance) => {
                    flowRef.current = instance;
                    setFlowInstance(instance);
                  }}
                  onNodeClick={(_, node) => onSelectNode?.(node.data.node)}
                  onNodeMouseEnter={(_, node) => setHoveredNodeId(node.id)}
                  onNodeMouseLeave={(_, node) =>
                    setHoveredNodeId((currentNodeId) =>
                      currentNodeId === node.id ? null : currentNodeId,
                    )
                  }
                >
                  <Background
                    {...stylex.props(styles.background)}
                    gap={24}
                    color="var(--canvas-grid)"
                  />
                  {expanded && (
                    <MiniMap
                      pannable
                      zoomable
                      position="top-right"
                      maskColor="var(--minimap-mask)"
                      maskStrokeColor="var(--rule-soft)"
                      maskStrokeWidth={1}
                      nodeColor={(node) =>
                        node.id === displayedSnapshot.selectedNodeId
                          ? "var(--minimap-node-selected)"
                          : "var(--minimap-node)"
                      }
                      nodeStrokeColor={(node) =>
                        node.id === displayedSnapshot.selectedNodeId
                          ? "var(--selection)"
                          : "var(--rule-soft)"
                      }
                      nodeBorderRadius={4}
                      style={{
                        backgroundColor: "var(--surface)",
                        border: "1px solid var(--rule)",
                        borderRadius: 8,
                      }}
                    />
                  )}
                  <Controls showInteractive={false} />
                </ReactFlow>
              </C4HoveredNodeContext.Provider>
            </>
          ) : (
            <div {...codeStatusProps}>Laying out software map...</div>
          )}
        </>
      )}
      <SoftwareMapHotkeysTab
        groups={C4_MAP_HOTKEY_GROUPS}
        activeGroupId="c4-navigation"
        open={hotkeysOpen}
        ariaLabel="Software map keyboard shortcuts"
        onOpenChange={setHotkeysOpen}
      />
    </div>
  );
}

function hasResizeObserver(): boolean {
  return typeof ResizeObserver !== "undefined";
}

function c4MeasurementKey(nodes: SoftwareMapNodeSnapshot[]) {
  return nodes
    .map((node) =>
      [
        node.id,
        node.label,
        node.type,
        node.dataStoreKind ?? "",
        node.changeStatus ?? "",
        node.description ?? "",
        node.file ?? "",
        node.line ?? "",
        node.boundary ? "boundary" : "",
        node.childCount ?? "",
        c4DataStoreSchemaSignature(node),
      ].join("\u001f"),
    )
    .join("\u001e");
}

function c4DimensionsEqual(
  left: ReadonlyMap<string, C4NodeDimensions> | null,
  right: ReadonlyMap<string, C4NodeDimensions>,
) {
  if (!left || left.size !== right.size) return false;

  for (const [id, rightDimensions] of right) {
    const leftDimensions = left.get(id);

    if (
      !leftDimensions ||
      leftDimensions.width !== rightDimensions.width ||
      leftDimensions.height !== rightDimensions.height
    ) {
      return false;
    }
  }

  return true;
}

function C4NodeMeasurementLayer({
  nodes,
  measurementKey,
  onMeasure,
}: {
  nodes: SoftwareMapNodeSnapshot[];
  measurementKey: string;
  onMeasure: (dimensions: ReadonlyMap<string, C4NodeDimensions>) => void;
}) {
  const refs = useRef(new Map<string, HTMLDivElement>());
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  useLayoutEffect(() => {
    const measuredNodes = nodesRef.current;

    if (measuredNodes.length === 0) {
      onMeasure(new Map());

      return;
    }

    const measure = () => {
      const dimensions = new Map<string, C4NodeDimensions>();

      for (const node of measuredNodes) {
        const element = refs.current.get(node.id);

        if (!element) return;
        const rect = element.getBoundingClientRect();
        dimensions.set(node.id, {
          width: Math.ceil(rect.width),
          height: Math.ceil(rect.height),
        });
      }

      onMeasure(dimensions);
    };

    return scheduleC4NodeMeasurements(measure);
  }, [measurementKey, onMeasure]);

  return (
    <div {...stylex.props(styles.measureLayer)} aria-hidden="true">
      {nodes.map((node) => (
        <div
          key={node.id}
          ref={(element) => {
            if (element) {
              refs.current.set(node.id, element);
            } else {
              refs.current.delete(node.id);
            }
          }}
          {...stylex.props(
            styles.measureNode,
            node.type === "dataStore" && styles.measureNodeStore,
            node.type === "codeElement" && styles.measureNodeCode,
          )}
        >
          <SoftwareMapNodeCard node={node} selected={false} measured />
        </div>
      ))}
    </div>
  );
}

function SoftwareMapC4Edge(
  props: ReactFlowEdgeProps<ReactFlowEdge<C4MapEdgeData>>,
) {
  const hoveredNodeId = useContext(C4HoveredNodeContext);
  const data = props.data;

  const label = data?.relationship.hideLabel
    ? undefined
    : (data?.label ?? data?.semanticKind);

  const points = c4EdgePointsFromSections(data?.sections);

  if (points.length < 2) return null;
  const path = c4PolylinePath(points);

  const endpointBubbles = c4EdgeEndpointBubbles(
    points,
    data?.relationship ?? { from: props.source },
    hoveredNodeId,
  );

  const labelPoint =
    data?.labelPoint ??
    c4EdgeLabelPoint(data?.labelPosition, data?.labelDimensions, points);

  const relationshipId = data?.relationshipId ?? props.id;

  const openRelationship = (
    event: ReactMouseEvent<Element> | ReactKeyboardEvent<Element>,
  ) => {
    if (!data?.onOpenRelationship) return;

    if (hasTextSelectionWithin(event.currentTarget)) {
      event.stopPropagation();

      return;
    }

    event.preventDefault();
    event.stopPropagation();
    data.onOpenRelationship(relationshipId);
  };

  return (
    <>
      {data?.operationState && data.operationState !== "inactive" ? (
        <path
          d={path}
          {...stylex.props(
            styles.edgeHighlight,
            data.operationState === "active" && styles.edgeHighlightActive,
          )}
        />
      ) : null}
      <BaseEdge
        path={path}
        markerStart={props.markerStart}
        markerEnd={props.markerEnd}
        style={props.style}
        interactionWidth={props.interactionWidth}
      />
      <path
        d={path}
        {...stylex.props(styles.edgeHitArea)}
        onClick={openRelationship}
      />
      <EdgeLabelRenderer>
        {endpointBubbles.map((bubble) => (
          <span
            key={bubble.endpoint}
            aria-hidden="true"
            {...stylex.props(
              styles.edgeEndpoint,
              bubble.hovered && styles.edgeEndpointHovered,
            )}
            data-endpoint={bubble.endpoint}
            style={{
              transform: `translate(-50%, -50%) translate(${bubble.x}px, ${bubble.y}px)`,
            }}
          />
        ))}
        <div
          {...withClass("nodrag nopan", styles.edgeLabelAnchor)}
          style={{
            transform: `translate(-50%, -50%) translate(${labelPoint.x}px, ${labelPoint.y}px)`,
          }}
        >
          {label ? (
            data?.onOpenRelationship ? (
              <span
                role="button"
                tabIndex={0}
                {...stylex.props(
                  styles.edgeLabel,
                  styles.edgeLabelButton,
                  data.selectedNodeAttached && styles.edgeLabelSelectedNode,
                )}
                data-review-anchor-id={relationshipId}
                onClick={openRelationship}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  openRelationship(event);
                }}
              >
                {label}
              </span>
            ) : (
              <span
                {...stylex.props(
                  styles.edgeLabel,
                  data?.selectedNodeAttached && styles.edgeLabelSelectedNode,
                )}
              >
                {label}
              </span>
            )
          ) : null}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

function c4PolylinePath(points: C4ElkPoint[]): string {
  const [first, ...rest] = points;

  if (!first) return "";

  return [
    `M ${first.x} ${first.y}`,
    ...rest.map((point) => `L ${point.x} ${point.y}`),
  ].join(" ");
}

function SoftwareMapC4GroupNode({
  data,
}: ReactFlowNodeProps<C4MapFlowGroupNode>) {
  return (
    <div
      {...stylex.props(
        styles.groupShell,
        data.node.changeStatus === "added" && styles.groupAdded,
        data.node.changeStatus === "removed" && styles.groupRemoved,
        data.node.changeStatus === "modified" && styles.groupModified,
        data.selected && styles.groupSelected,
      )}
      onClick={(event) => {
        if (hasTextSelectionWithin(event.currentTarget)) {
          event.stopPropagation();

          return;
        }

        event.preventDefault();
        event.stopPropagation();
        data.onSelect?.(data.node);
      }}
      onDoubleClickCapture={(event) => {
        if (hasTextSelectionWithin(event.currentTarget)) {
          event.stopPropagation();
        }
      }}
    >
      <Handle
        id="target-left"
        type="target"
        position={Position.Left}
        {...stylex.props(styles.handle)}
      />
      <Handle
        id="source-left"
        type="source"
        position={Position.Left}
        {...stylex.props(styles.handle)}
      />
      <Handle
        id="target-top"
        type="target"
        position={Position.Top}
        {...stylex.props(styles.handle)}
      />
      <Handle
        id="source-top"
        type="source"
        position={Position.Top}
        {...stylex.props(styles.handle)}
      />
      <div
        {...stylex.props(
          styles.groupTitle,
          data.node.type === "softwareSystem" && styles.groupTitleSystem,
        )}
      >
        <span {...stylex.props(styles.groupKind)}>
          {softwareMapNodeTypeLabel(data.node)}
        </span>
        <strong
          {...stylex.props(
            styles.groupLabel,
            data.node.type === "softwareSystem" && styles.groupLabelSystem,
            data.node.changeStatus === "removed" && styles.struck,
          )}
        >
          {data.node.label}
        </strong>
        <SoftwareMapChangeBadge
          status={data.node.changeStatus}
          additions={data.node.additions}
          deletions={data.node.deletions}
          inGroupTitle
        />
      </div>
      <Handle
        id="source-right"
        type="source"
        position={Position.Right}
        {...stylex.props(styles.handle)}
      />
      <Handle
        id="target-right"
        type="target"
        position={Position.Right}
        {...stylex.props(styles.handle)}
      />
      <Handle
        id="source-bottom"
        type="source"
        position={Position.Bottom}
        {...stylex.props(styles.handle)}
      />
      <Handle
        id="target-bottom"
        type="target"
        position={Position.Bottom}
        {...stylex.props(styles.handle)}
      />
    </div>
  );
}

function SoftwareMapC4Node({ data }: ReactFlowNodeProps<C4MapFlowNode>) {
  return (
    <div
      {...withClass("nodrag nopan", styles.nodeShell)}
      onDoubleClickCapture={(event) => {
        if (hasTextSelectionWithin(event.currentTarget)) {
          event.stopPropagation();

          return;
        }

        event.preventDefault();
        event.stopPropagation();

        if (data.node.expanded) {
          data.onCollapseNode?.(data.node);
        } else {
          data.onExpandNode?.(data.node);
        }
      }}
    >
      <Handle
        id="target-left"
        type="target"
        position={Position.Left}
        {...stylex.props(styles.handle)}
      />
      <Handle
        id="source-left"
        type="source"
        position={Position.Left}
        {...stylex.props(styles.handle)}
      />
      <Handle
        id="target-top"
        type="target"
        position={Position.Top}
        {...stylex.props(styles.handle)}
      />
      <Handle
        id="source-top"
        type="source"
        position={Position.Top}
        {...stylex.props(styles.handle)}
      />
      <SoftwareMapNodeCard
        node={data.node}
        selected={data.selected}
        onSelect={data.onSelect}
        onExpandNode={data.onExpandNode}
      />
      <Handle
        id="source-right"
        type="source"
        position={Position.Right}
        {...stylex.props(styles.handle)}
      />
      <Handle
        id="target-right"
        type="target"
        position={Position.Right}
        {...stylex.props(styles.handle)}
      />
      <Handle
        id="source-bottom"
        type="source"
        position={Position.Bottom}
        {...stylex.props(styles.handle)}
      />
      <Handle
        id="target-bottom"
        type="target"
        position={Position.Bottom}
        {...stylex.props(styles.handle)}
      />
    </div>
  );
}

// The outline and folder shapes stay hidden; the card draws the store.
function SoftwareMapDataStoreOutline({
  outline,
  selected,
  removed,
}: {
  outline: SoftwareMapDataStoreOutlineKind;
  selected: boolean;
  removed: boolean;
}) {
  if (outline === "folder") {
    return (
      <span aria-hidden="true" {...stylex.props(styles.storageFolder)}>
        <span
          {...stylex.props(
            styles.storageFolderBody,
            removed && styles.storageDashed,
            selected && styles.storageGlow,
          )}
        />
        <svg
          {...stylex.props(
            styles.storageFolderTab,
            selected && styles.storageGlow,
          )}
          focusable="false"
          preserveAspectRatio="none"
          viewBox="0 0 190 48"
        >
          <path
            {...stylex.props(styles.storageFill)}
            d="M2 46 V14 Q2 2 14 2 H148 L188 46 Z"
            vectorEffect="non-scaling-stroke"
          />
          <path
            {...stylex.props(
              styles.storageBorder,
              removed && styles.storageDashed,
            )}
            d="M2 46 V14 Q2 2 14 2 H148 L188 46"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </span>
    );
  }

  const geometry = softwareMapDataStoreOutlineGeometry(outline);

  return (
    <svg
      aria-hidden="true"
      {...stylex.props(styles.storageOutline)}
      focusable="false"
      preserveAspectRatio="none"
      viewBox="0 0 280 140"
    >
      <path
        {...stylex.props(styles.storageFill)}
        d={geometry.fillPath}
        vectorEffect="non-scaling-stroke"
      />
      {geometry.fillDetailPath ? (
        <path
          {...stylex.props(styles.storageFillDetail)}
          d={geometry.fillDetailPath}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      <path
        {...stylex.props(
          styles.storageSelection,
          selected && styles.storageSelectionSelected,
        )}
        d={geometry.outlinePath}
        vectorEffect="non-scaling-stroke"
      />
      <path
        {...stylex.props(styles.storageBorder, removed && styles.storageDashed)}
        d={geometry.outlinePath}
        vectorEffect="non-scaling-stroke"
      />
      {geometry.detailPaths.map((path) => (
        <path
          {...stylex.props(styles.storageDetail)}
          d={path}
          key={path}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

function softwareMapDataStoreOutlineGeometry(
  outline: SoftwareMapDataStoreOutlineKind,
) {
  if (outline === "bucket") {
    return {
      fillPath: "M18 24 C18 12 262 12 262 24 L238 118 C236 130 44 130 42 118 Z",
      fillDetailPath: "M18 24 C18 12 262 12 262 24 C262 36 18 36 18 24 Z",
      outlinePath:
        "M18 24 C18 12 262 12 262 24 L238 118 C236 130 44 130 42 118 Z",
      detailPaths: [
        "M18 24 C18 36 262 36 262 24",
        "M42 118 C42 130 238 130 238 118",
      ],
    };
  }

  return {
    fillPath: "M8 22 C8 34 272 34 272 22 L272 116 C272 128 8 128 8 116 Z",
    fillDetailPath: "M8 22 C8 10 272 10 272 22 C272 34 8 34 8 22 Z",
    outlinePath:
      "M8 22 C8 10 272 10 272 22 L272 116 C272 128 8 128 8 116 L8 22",
    detailPaths: ["M8 22 C8 34 272 34 272 22", "M8 116 C8 128 272 128 272 116"],
  };
}

function SoftwareMapNodeFrame({
  node,
  selected,
  measured = false,
  as: Element = "div",
  children,
  onSelect,
  onExpandNode,
}: {
  node: SoftwareMapNodeSnapshot;
  selected: boolean;
  /** Rendered off screen to measure, rather than on the canvas. */
  measured?: boolean;
  as?: "button" | "div";
  children?: ReactNode;
  onSelect?: (node: SoftwareMapNodeSnapshot) => void;
  onExpandNode?: (node: SoftwareMapNodeSnapshot) => void;
}) {
  const isCodeElement = node.type === "codeElement";
  const isDataStore = node.type === "dataStore";
  const isCollection = node.type === "dataStoreCollection";

  const dataStoreOutline = isDataStore
    ? softwareMapDataStoreOutlineKind(node.dataStoreKind)
    : undefined;

  const hasExpandedDataStoreSchema =
    (isDataStore || isCollection) &&
    Boolean(node.dataStoreSchemaSections?.length);

  const status =
    node.changeStatus && node.changeStatus !== "unchanged"
      ? node.changeStatus
      : undefined;

  // A data store's children stack above its storage shape.
  const layer = isDataStore && styles.storeLayer;

  const codeRing = selected ? "selected" : status;

  const props = {
    ...withClass(
      "nodrag nopan",
      styles.node,
      isCollection && styles.nodeTight,
      isCodeElement && styles.nodeCode,
      isDataStore && styles.nodeStore,
      isDataStore && measured && !status && styles.nodeStoreHoverable,
      measured && styles.nodeMeasured,
      measured && isDataStore && styles.nodeMeasuredStore,
      measured && isCodeElement && styles.nodeMeasuredCode,
      status && nodeStatusStyles[status],
      selected && styles.nodeSelected,
      // On the canvas a changed or selected store drops its card for the
      // storage shape's colors.
      isDataStore &&
        !measured &&
        (status || selected) &&
        styles.nodeStoreMarked,
      isDataStore && selected && storeSelectedStyles[status ?? "unchanged"],
      isCodeElement && codeRing && codeRingStyles[codeRing],
    ),
    onClick: (event: ReactMouseEvent<HTMLElement>) => {
      if (hasTextSelectionWithin(event.currentTarget)) {
        event.stopPropagation();

        return;
      }

      event.preventDefault();
      event.stopPropagation();
      onSelect?.(node);
    },
    onDoubleClick: (event: ReactMouseEvent<HTMLElement>) => {
      if (hasTextSelectionWithin(event.currentTarget)) {
        event.stopPropagation();

        return;
      }

      event.preventDefault();
      event.stopPropagation();
      onExpandNode?.(node);
    },
  };

  return (
    <Element
      {...props}
      {...(Element === "button"
        ? {
            type: "button",
            "aria-label": `${softwareMapNodeTypeLabel(node)}: ${node.label}`,
          }
        : {
            role: "group",
            "aria-label": `${softwareMapNodeTypeLabel(node)}: ${node.label}`,
          })}
    >
      {dataStoreOutline ? (
        <SoftwareMapDataStoreOutline
          outline={dataStoreOutline}
          selected={selected}
          removed={status === "removed"}
        />
      ) : null}
      {isCodeElement ? (
        <div {...stylex.props(styles.codeHead)}>
          <code
            {...stylex.props(
              styles.codeLabel,
              status === "removed" && styles.struck,
            )}
          >
            {node.label}
          </code>
          <SoftwareMapChangeBadge
            status={node.changeStatus}
            additions={node.additions}
            deletions={node.deletions}
          />
        </div>
      ) : (
        <>
          <div
            {...stylex.props(
              styles.kicker,
              layer,
              isCollection && styles.hidden,
            )}
          >
            <div {...stylex.props(styles.nodeType)}>
              {softwareMapNodeTypeLabel(node)}
            </div>
            <SoftwareMapChangeBadge
              status={node.changeStatus}
              additions={node.additions}
              deletions={node.deletions}
            />
          </div>
          <h4
            {...stylex.props(
              styles.label,
              hasExpandedDataStoreSchema && styles.labelWithSchema,
              status === "removed" && styles.struck,
              layer,
              isCollection && styles.hidden,
            )}
          >
            {node.label}
          </h4>
        </>
      )}
      {!isCodeElement && node.description && (
        <p
          {...stylex.props(
            styles.description,
            layer,
            (isCollection || hasExpandedDataStoreSchema) && styles.hidden,
          )}
        >
          {node.description}
        </p>
      )}
      {!isCodeElement && (
        <div
          {...stylex.props(
            styles.meta,
            layer,
            (isCollection || hasExpandedDataStoreSchema) && styles.hidden,
          )}
        >
          {node.file && (
            <span {...stylex.props(styles.metaItem)}>
              {node.file}
              {node.line === undefined ? "" : `:L${node.line}`}
            </span>
          )}
          {node.childCount !== undefined && node.childCount > 0 && (
            <span {...stylex.props(styles.metaItem)}>
              {node.childCount} children
            </span>
          )}
          {node.boundary && (
            <span {...stylex.props(styles.metaItem)}>boundary</span>
          )}
        </div>
      )}
      {children}
      {hasExpandedDataStoreSchema && (
        <SoftwareMapDataStoreSchema
          sections={node.dataStoreSchemaSections ?? []}
          collection={isCollection}
          selected={selected}
        />
      )}
    </Element>
  );
}

function SoftwareMapDataStoreSchema({
  sections,
  collection,
  selected,
}: {
  sections: SoftwareMapDataStoreSchemaSectionSnapshot[];
  collection: boolean;
  selected: boolean;
}) {
  return (
    <div {...stylex.props(styles.schema, collection && styles.schemaFlush)}>
      {sections.map((section) => (
        <section
          key={section.id}
          {...stylex.props(
            styles.schemaSection,
            collection && selected && styles.schemaSectionSelected,
          )}
        >
          <header {...stylex.props(styles.schemaHeader)}>
            <span {...stylex.props(styles.schemaKind)}>{section.kind}</span>
            <strong {...stylex.props(styles.schemaLabel)}>
              {section.label}
            </strong>
          </header>
          {section.key && (
            <div {...stylex.props(styles.schemaKey)}>{section.key}</div>
          )}
          <div>
            {section.rows.map((row) => (
              <div
                key={row.id}
                {...stylex.props(
                  styles.schemaRow,
                  row.primaryKey && styles.schemaRowPrimary,
                  row.state === "active" && styles.schemaRowActive,
                )}
                style={
                  // SAFETY: React passes "--*" keys through to
                  // style.setProperty; CSSProperties only lacks an index
                  // signature for custom properties.
                  {
                    "--software-map-schema-row-depth": row.depth ?? 0,
                  } as CSSProperties
                }
              >
                <span {...stylex.props(styles.schemaRowName)}>
                  {row.primaryKey && (
                    <strong {...stylex.props(styles.schemaKeyFlag)}>PK</strong>
                  )}
                  {row.foreignKey && (
                    <strong
                      {...stylex.props(
                        styles.schemaKeyFlag,
                        styles.schemaKeyFlagForeign,
                      )}
                    >
                      FK
                    </strong>
                  )}
                  {row.label}
                </span>
                <span {...stylex.props(styles.schemaRowType)}>
                  {row.type ?? row.example ?? "object"}
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function SoftwareMapNodeCard({
  node,
  selected,
  measured,
  onSelect,
  onExpandNode,
}: {
  node: SoftwareMapNodeSnapshot;
  selected: boolean;
  measured?: boolean;
  onSelect?: (node: SoftwareMapNodeSnapshot) => void;
  onExpandNode?: (node: SoftwareMapNodeSnapshot) => void;
}) {
  return (
    <SoftwareMapNodeFrame
      node={node}
      selected={selected}
      measured={measured}
      onSelect={onSelect}
      onExpandNode={onExpandNode}
    />
  );
}

function SoftwareMapChangeBadge({
  status,
  additions,
  deletions,
  inGroupTitle = false,
}: {
  status?: SoftwareChangeStatus;
  additions?: number;
  deletions?: number;
  /** A group's title sets its counts as quiet capitals, pushed right. */
  inGroupTitle?: boolean;
}) {
  const visibleAdditions = visibleSoftwareMapChangeCount(additions);
  const visibleDeletions = visibleSoftwareMapChangeCount(deletions);
  const hasCounts = Boolean(visibleAdditions || visibleDeletions);
  const hasChangeStatus = Boolean(status && status !== "unchanged");

  if (!hasCounts && !hasChangeStatus) return null;

  if (!hasCounts) {
    return (
      <span
        {...stylex.props(
          styles.badge,
          inGroupTitle && styles.badgeInGroup,
          styles.badgeEmpty,
        )}
        aria-hidden="true"
      />
    );
  }

  return (
    <span {...stylex.props(styles.badge, inGroupTitle && styles.badgeInGroup)}>
      {visibleAdditions ? (
        <span
          {...stylex.props(
            styles.count,
            styles.countAdded,
            inGroupTitle && styles.countInGroup,
          )}
        >
          +{visibleAdditions}
        </span>
      ) : null}
      {visibleDeletions ? (
        <span
          {...stylex.props(
            styles.count,
            styles.countRemoved,
            inGroupTitle && styles.countInGroup,
          )}
        >
          -{visibleDeletions}
        </span>
      ) : null}
    </span>
  );
}

function createPlaceholderSnapshot(
  title: string,
  view?: string,
): SoftwareMapResolvedSnapshot {
  return {
    title,
    view: view ?? "unresolved",
    viewType: "inlineC4",
    selectedNodeId: "placeholder-component",
    nodes: [
      {
        id: "placeholder-system",
        label: "Authored model",
        type: "softwareSystem",
        description:
          "MDX defines systems, containers, components, and relationships.",
      },
      {
        id: "placeholder-component",
        label: "Resolved snapshot",
        type: "component",
        parentId: "placeholder-system",
        description: "The Vite resolver will provide normalized map nodes.",
      },
      {
        id: "placeholder-code",
        label: "Code element",
        type: "codeElement",
        parentId: "placeholder-component",
        description: "Code cards will reuse the source-card renderer later.",
        childCount: 0,
      },
      {
        id: "placeholder-boundary",
        label: "Boundary node",
        type: "component",
        description:
          "Outside-scope relationships can render as boundary nodes.",
        boundary: true,
      },
    ],
    relationships: [
      {
        from: "placeholder-component",
        to: "placeholder-code",
        label: "contains",
        kind: "semantic",
      },
      {
        from: "placeholder-code",
        to: "placeholder-boundary",
        label: "calls",
        kind: "call",
      },
    ],
  };
}

const inDocument = ":is(.review-document *)";

const peekOpen = ":is(.review-app--peek-open *)";

const stacked = "@media (max-width: 900px)";

const narrow = "@media (max-width: 720px)";

const geistMono = '"Geist Mono", ui-monospace, monospace';

const settle = "cubic-bezier(0.2, 0.8, 0.2, 1)";

const groupBloom = stylex.keyframes({
  from: { opacity: 0.72, transform: "scale(0.88)" },
  to: { opacity: 1, transform: "scale(1)" },
});

const cardBloom = stylex.keyframes({
  from: { opacity: 0, transform: "scale(0.86)" },
  to: { opacity: 1, transform: "scale(1)" },
});

const noBorder = {
  borderWidth: 0,
  borderStyle: "none",
  borderColor: "currentcolor",
} as const;

const styles = stylex.create({
  // The expanded map: a fixed layer over the canvas. The layer variable lives
  // on .review-app, outside this portal, so the fallback keeps it above the
  // sticky topbar.
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: "var(--review-debug-layer, 2147483000)",
    display: "grid",
    boxSizing: "border-box",
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
    padding: 0,
    backgroundColor: tokens.bg,
  },
  frame: {
    position: "relative",
    display: "grid",
    gridTemplateRows: "auto minmax(0, 1fr)",
    height: "var(--software-map-height, 520px)",
    minHeight: "340px",
    margin: 0,
    overflow: "hidden",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.rule,
    borderRadius: "6px",
    backgroundColor: tokens.surface,
    boxShadow: "none",
    fontFamily: tokens.fontMono,
  },
  frameExpanded: {
    ...noBorder,
    boxSizing: "border-box",
    width: "100%",
    height: "100%",
    minWidth: 0,
    minHeight: 0,
  },
  frameChromeHidden: {
    ...noBorder,
    gridTemplateRows: "minmax(0, 1fr)",
    borderRadius: 0,
  },
  frameView: {
    height: "100%",
    backgroundColor: tokens.bg,
  },
  frameLens: {
    height: "100%",
    minHeight: 0,
    backgroundColor: tokens.transparent,
  },
  header: {
    ...noBorder,
    display: "flex",
    justifyContent: "space-between",
    gap: "16px",
    minWidth: 0,
    alignItems: "center",
    minHeight: "36px",
    padding: "0 12px",
    backgroundColor: tokens.transparent,
    boxShadow: "none",
    fontFamily: tokens.fontMono,
  },
  titleBlock: {
    position: "relative",
  },
  kindBadge: {
    minWidth: 0,
  },
  title: {
    margin: 0,
    fontSize: "13px",
    fontWeight: 650,
  },
  actions: {
    display: "flex",
    flex: "0 0 auto",
    alignItems: "center",
    minWidth: 0,
    gap: "4px",
  },
  floatingActions: {
    position: "absolute",
    top: "10px",
    right: "10px",
    zIndex: 20,
    display: { default: "flex", [peekOpen]: "none" },
    gap: "8px",
    padding: "2px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.rule,
    borderRadius: "6px",
    backgroundColor: tokens.surface,
    boxShadow: `0 4px 18px ${tokens.shadowColor}`,
  },
  iconButton: {
    ...noBorder,
    position: "relative",
    display: "grid",
    placeItems: "center",
    width: "26px",
    height: "26px",
    padding: 0,
    borderRadius: "3px",
    backgroundColor: tokens.transparent,
    color: {
      default: tokens.inkFaint,
      ":hover": tokens.inkMuted,
      ":focus-visible": tokens.inkMuted,
    },
    outline: {
      default: null,
      ":focus-visible": `1px solid ${tokens.ruleSoft}`,
    },
    outlineOffset: { default: null, ":focus-visible": "2px" },
  },
  refreshing: {
    color: {
      default: tokens.accent,
      ":hover": tokens.inkMuted,
      ":focus-visible": tokens.inkMuted,
    },
  },
  // Shows while the pointer is over the map.
  expandButton: {
    opacity: {
      default: 0,
      ":focus-visible": 1,
      [stylex.when.ancestor(":hover", mapFrameMarker)]: 1,
    },
    transition: "opacity 120ms ease, color 120ms ease",
  },
  // Two corner brackets.
  expandIcon: {
    position: "relative",
    display: "block",
    width: "14px",
    height: "14px",
    "::before": {
      position: "absolute",
      top: 0,
      right: 0,
      width: "7px",
      height: "7px",
      borderTopWidth: "2px",
      borderTopStyle: "solid",
      borderTopColor: "currentColor",
      borderRightWidth: "2px",
      borderRightStyle: "solid",
      borderRightColor: "currentColor",
      content: "''",
    },
    "::after": {
      position: "absolute",
      bottom: 0,
      left: 0,
      width: "7px",
      height: "7px",
      borderBottomWidth: "2px",
      borderBottomStyle: "solid",
      borderBottomColor: "currentColor",
      borderLeftWidth: "2px",
      borderLeftStyle: "solid",
      borderLeftColor: "currentColor",
      content: "''",
    },
  },
  body: {
    display: "grid",
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
  },
  // Narrow layouts stack the inspector under the map, then float it over.
  bodyWithInspector: {
    position: { default: null, [narrow]: "relative" },
    gridTemplateRows: {
      default: null,
      [stacked]: "minmax(0, 1fr) minmax(220px, 42%)",
      [narrow]: "minmax(0, 1fr)",
    },
    gridTemplateColumns: {
      default: "minmax(0, 1fr) 10px var(--software-map-inspector-width, 420px)",
      [stacked]: "minmax(0, 1fr)",
      [narrow]: "minmax(0, 1fr)",
    },
  },
  bodyResizing: {
    cursor: "col-resize",
    userSelect: "none",
  },
  canvas: {
    position: "relative",
    display: "grid",
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
    padding: 0,
    backgroundColor: tokens.bg,
    fontFamily: tokens.fontMono,
  },
  status: {
    ...noBorder,
    position: "absolute",
    top: "14px",
    left: "14px",
    zIndex: 8,
    width: "max-content",
    maxWidth: "min(420px, calc(100% - 28px))",
    margin: 0,
    padding: "8px 10px",
    borderRadius: "6px",
    backgroundColor: tokens.transparent,
    boxShadow: "none",
    color: tokens.inkMuted,
    fontSize: "12px",
    lineHeight: "17px",
  },
  statusError: {
    borderColor: tokens.diffRemoved,
    backgroundColor: tokens.diffRemovedBg,
    color: tokens.diffRemoved,
  },
  inspectorResizer: {
    zIndex: 8,
    minHeight: 0,
    // Also hidden with the shell's divider when the side peek is open on a
    // narrow canvas.
    display: {
      default: null,
      [stacked]: "none",
      [peekOpen]: {
        default: null,
        "@container review-canvas (max-width: 929px)": "none",
        [narrow]: "none",
      },
    },
  },
  inspectorBackdrop: {
    display: { default: "none", [narrow]: "block" },
    position: { default: null, [narrow]: "absolute" },
    inset: { default: null, [narrow]: 0 },
    zIndex: { default: null, [narrow]: 48 },
    padding: { default: null, [narrow]: 0 },
    borderWidth: { default: null, [narrow]: 0 },
    borderStyle: { default: null, [narrow]: "none" },
    borderColor: { default: null, [narrow]: "currentcolor" },
    backgroundColor: { default: null, [narrow]: tokens.backdrop },
  },
  inspector: {
    ...noBorder,
    position: { default: null, [narrow]: "absolute" },
    right: { default: null, [narrow]: "8px" },
    bottom: { default: null, [narrow]: "8px" },
    left: { default: null, [narrow]: "8px" },
    zIndex: { default: null, [narrow]: 49 },
    display: "grid",
    gridTemplateRows: "auto minmax(0, 1fr)",
    minWidth: 0,
    height: { default: null, [narrow]: "min(72%, 560px)" },
    minHeight: { default: 0, [narrow]: "240px" },
    overflow: "hidden",
    borderRadius: { default: null, [narrow]: "12px" },
    backgroundColor: tokens.bg,
    boxShadow: "none",
  },
  inspectorHeader: {
    position: { default: null, [narrow]: "sticky" },
    top: { default: null, [narrow]: 0 },
    zIndex: { default: null, [narrow]: 2 },
    display: "flex",
    gap: "10px",
    alignItems: "center",
    justifyContent: "space-between",
    minWidth: 0,
    padding: { default: "7px 8px 3px", [narrow]: "8px" },
    borderBottomWidth: { default: null, [narrow]: "1px" },
    borderBottomStyle: { default: null, [narrow]: "solid" },
    borderBottomColor: { default: null, [narrow]: tokens.rule },
    backgroundColor: tokens.bg,
  },
  inspectorTitle: {
    display: "flex",
    gap: "8px",
    alignItems: "baseline",
    minWidth: 0,
    paddingLeft: "4px",
    whiteSpace: "nowrap",
  },
  inspectorKind: {
    flex: "none",
    color: tokens.inkFaint,
    fontSize: "10px",
    fontWeight: 500,
    letterSpacing: "0.08em",
    lineHeight: "14px",
    textTransform: "uppercase",
  },
  inspectorLabel: {
    minWidth: 0,
    overflow: "hidden",
    color: tokens.ink,
    fontSize: "13px",
    fontWeight: 600,
    lineHeight: "18px",
    textOverflow: "ellipsis",
  },
  inspectorActions: {
    display: "flex",
    flex: "none",
    gap: "4px",
    alignItems: "center",
  },
  codicon: {
    fontSize: "16px",
  },
  inspectorDiffs: {
    minHeight: 0,
    overflow: "auto",
    backgroundColor: tokens.bg,
    scrollbarColor: `${tokens.ruleSoft} ${tokens.surface}`,
  },
  inspectorEmpty: {
    padding: "16px",
    color: tokens.inkMuted,
    fontSize: "12px",
    lineHeight: "18px",
  },
  c4Canvas: {
    ...noBorder,
    position: "relative",
    width: "100%",
    height: "100%",
    minHeight: 0,
    overflow: "hidden",
    borderRadius: 0,
    backgroundColor: tokens.bg,
    fontFamily: tokens.fontMono,
  },
  c4CanvasLens: {
    minWidth: 0,
  },
  flow: {
    backgroundColor: tokens.bg,
    fontFamily: tokens.fontMono,
  },
  background: {
    opacity: 0.45,
  },
  // React Flow's node wrapper. Its text reads like the prose around it.
  flowNode: {
    ...noBorder,
    backgroundColor: tokens.transparent,
    boxShadow: "none",
    transition: `transform 220ms ${settle}, width 220ms ${settle}, height 220ms ${settle}, opacity 160ms ease`,
    userSelect: "text",
  },
  flowEdge: {
    zIndex: 1,
  },
  codeStatus: {
    ...noBorder,
    position: "absolute",
    right: "14px",
    bottom: "14px",
    zIndex: 8,
    maxWidth: "min(380px, calc(100% - 28px))",
    padding: "8px 10px",
    borderRadius: "6px",
    backgroundColor: tokens.transparent,
    boxShadow: "none",
    color: tokens.inkMuted,
    fontSize: "12px",
    lineHeight: "17px",
  },
  edgeHighlight: {
    fill: "none",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    pointerEvents: "none",
  },
  edgeHighlightActive: {
    stroke: tokens.selectionShadow,
    strokeWidth: "10px",
  },
  edgeHitArea: {
    fill: "none",
    stroke: tokens.transparent,
    strokeWidth: "18px",
    pointerEvents: "stroke",
  },
  edgeEndpoint: {
    position: "absolute",
    zIndex: 39,
    boxSizing: "border-box",
    width: "11px",
    height: "11px",
    borderWidth: "1.5px",
    borderStyle: "solid",
    borderColor: tokens.inkFaint,
    borderRadius: "999px",
    backgroundColor: tokens.surface,
    opacity: 1,
    pointerEvents: "none",
  },
  edgeEndpointHovered: {
    borderWidth: "2px",
    borderColor: tokens.surface,
    backgroundColor: tokens.accent,
  },
  edgeLabelAnchor: {
    position: "absolute",
    zIndex: 40,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: "20px",
    minHeight: "20px",
    pointerEvents: "all",
  },
  edgeLabel: {
    boxSizing: "border-box",
    maxWidth: "132px",
    padding: "4px 10px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.rule,
    borderRadius: "7px",
    backgroundColor: tokens.surface,
    color: tokens.inkMuted,
    fontFamily: tokens.fontMono,
    fontSize: "11px",
    fontWeight: 500,
    letterSpacing: 0,
    lineHeight: "15px",
    textAlign: "center",
    whiteSpace: "normal",
    overflowWrap: "anywhere",
  },
  edgeLabelButton: {
    cursor: "pointer",
  },
  edgeLabelSelectedNode: {
    borderColor: tokens.accent,
  },
  // Off screen, so the layout can size each card before placing it.
  measureLayer: {
    position: "absolute",
    top: 0,
    left: "-10000px",
    zIndex: -1,
    width: "280px",
    visibility: "hidden",
    pointerEvents: "none",
  },
  measureNode: {
    width: "max-content",
    minWidth: "188px",
    maxWidth: "340px",
    marginBottom: "16px",
  },
  measureNodeStore: {
    width: "280px",
    maxWidth: "280px",
  },
  measureNodeCode: {
    width: "max-content",
    minWidth: 0,
    maxWidth: "none",
  },
  nodeShell: {
    position: "relative",
    width: "100%",
    height: "100%",
    animationName: cardBloom,
    animationDuration: "180ms",
    animationTimingFunction: settle,
  },
  groupShell: {
    position: "relative",
    boxSizing: "border-box",
    width: "100%",
    height: "100%",
    padding: "14px 16px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: {
      default: tokens.rule,
      ":hover": tokens.ruleSoft,
      ":focus-visible": tokens.ruleSoft,
    },
    borderRadius: "8px",
    backgroundColor: {
      default: tokens.surface,
      ":hover": tokens.markerTint,
      ":focus-visible": tokens.markerTint,
    },
    boxShadow: "none",
    outline: { default: null, ":hover": "none", ":focus-visible": "none" },
    cursor: "pointer",
    fontFamily: tokens.fontMono,
    animationName: groupBloom,
    animationDuration: "220ms",
    animationTimingFunction: settle,
  },
  // Hover outranks a change's border; selection outranks hover.
  groupAdded: {
    borderColor: {
      default: tokens.changeAdded,
      ":hover": tokens.ruleSoft,
      ":focus-visible": tokens.ruleSoft,
    },
  },
  groupRemoved: {
    borderStyle: {
      default: "dashed",
      ":hover": "solid",
      ":focus-visible": "solid",
    },
    borderColor: {
      default: tokens.changeRemoved,
      ":hover": tokens.ruleSoft,
      ":focus-visible": tokens.ruleSoft,
    },
    opacity: 0.75,
  },
  groupModified: {
    borderColor: {
      default: tokens.changeModified,
      ":hover": tokens.ruleSoft,
      ":focus-visible": tokens.ruleSoft,
    },
  },
  groupSelected: {
    borderStyle: "solid",
    borderColor: tokens.accent,
    backgroundColor: tokens.markerTint,
    boxShadow: `0 0 0 3px ${tokens.markerGlow}`,
  },
  groupTitle: {
    position: "absolute",
    top: "14px",
    right: "16px",
    left: "16px",
    display: "flex",
    gap: "8px",
    alignItems: "baseline",
    minWidth: 0,
    color: tokens.inkMuted,
    letterSpacing: 0,
    pointerEvents: "auto",
    userSelect: "text",
  },
  groupTitleSystem: {
    top: "18px",
    right: "22px",
    left: "22px",
  },
  groupKind: {
    flex: "0 0 auto",
    color: tokens.inkFaint,
    fontSize: "10px",
    fontWeight: 500,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  groupLabel: {
    minWidth: 0,
    overflow: "hidden",
    color: tokens.ink,
    fontSize: "13px",
    fontWeight: 600,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  groupLabelSystem: {
    fontSize: "14px",
  },
  struck: {
    textDecorationLine: "line-through",
  },
  hidden: {
    display: "none",
  },
  handle: {
    ...noBorder,
    width: "1px",
    height: "1px",
    backgroundColor: tokens.transparent,
    opacity: 0,
    pointerEvents: "none",
  },
  node: {
    position: "relative",
    boxSizing: "border-box",
    display: "grid",
    gap: "7px",
    width: "100%",
    maxWidth: "none",
    minHeight: "104px",
    padding: "12px 14px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.ruleSoft,
    borderRadius: "10px",
    backgroundColor: {
      default: tokens.surface,
      ":hover": tokens.markerTint,
      ":focus-visible": tokens.markerTint,
    },
    boxShadow: "none",
    outline: { default: null, ":hover": "none", ":focus-visible": "none" },
    transform: {
      default: null,
      ":hover": "translateY(-1px)",
      ":focus-visible": "translateY(-1px)",
    },
    appearance: "none",
    color: tokens.ink,
    cursor: "pointer",
    font: "inherit",
    fontFamily: tokens.fontMono,
    textAlign: "left",
    transition:
      "border-color 120ms ease, background 120ms ease, box-shadow 120ms ease, transform 120ms ease",
  },
  nodeTight: {
    gap: 0,
  },
  // A code card draws its ring inset, above its content.
  nodeCode: {
    gap: 0,
    "::before": {
      position: "absolute",
      inset: 0,
      zIndex: 2,
      display: "none",
      borderRadius: "inherit",
      boxShadow: `inset 0 0 0 0.75px ${tokens.rule}`,
      content: "''",
      pointerEvents: "none",
    },
  },
  nodeStore: {
    isolation: "isolate",
    "--software-map-storage-fill": tokens.surface,
    "--software-map-storage-border": tokens.ruleSoft,
    "--software-map-storage-detail": tokens.rule,
    "--software-map-storage-fill-detail": tokens.transparent,
  },
  nodeStoreHoverable: {
    "--software-map-storage-border": {
      default: tokens.ruleSoft,
      ":hover": tokens.mapStorageBorder,
      ":focus-visible": tokens.mapStorageBorder,
    },
  },
  nodeMeasured: {
    width: "max-content",
    minWidth: "188px",
    maxWidth: "340px",
    minHeight: 0,
  },
  nodeMeasuredStore: {
    width: "100%",
    maxWidth: "none",
    minHeight: "104px",
  },
  nodeMeasuredCode: {
    width: "max-content",
    minWidth: 0,
  },
  nodeSelected: {
    borderStyle: "solid",
    borderColor: tokens.accent,
    backgroundColor: tokens.markerTint,
    boxShadow: `0 0 0 3px ${tokens.markerGlow}`,
  },
  nodeStoreMarked: {
    borderWidth: 0,
    borderColor: tokens.transparent,
    backgroundColor: {
      default: tokens.transparent,
      ":hover": tokens.markerTint,
      ":focus-visible": tokens.markerTint,
    },
    boxShadow: "none",
  },
  storeLayer: {
    position: "relative",
    zIndex: 1,
  },
  kicker: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    justifyContent: "space-between",
    minWidth: 0,
  },
  nodeType: {
    minWidth: 0,
    overflow: "hidden",
    color: tokens.inkFaint,
    fontSize: "10px",
    fontWeight: 500,
    letterSpacing: "0.08em",
    lineHeight: "14px",
    textOverflow: "ellipsis",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  },
  label: {
    margin: 0,
    color: tokens.ink,
    fontSize: "15px",
    fontWeight: 600,
    lineHeight: "19px",
  },
  labelWithSchema: {
    lineHeight: "16px",
  },
  // In a document the description reads as a document paragraph.
  description: {
    margin: { default: 0, [inDocument]: "14px 0" },
    color: tokens.inkMuted,
    fontFamily: { default: null, [inDocument]: tokens.fontSerif },
    fontSize: "12px",
    fontWeight: 400,
    lineHeight: "17px",
  },
  meta: {
    display: "flex",
    flexWrap: "wrap",
    gap: "5px",
    alignItems: "center",
    minWidth: 0,
  },
  metaItem: {
    ...noBorder,
    maxWidth: "100%",
    overflow: "hidden",
    padding: 0,
    borderRadius: 0,
    backgroundColor: tokens.transparent,
    color: tokens.inkFaint,
    fontFamily: geistMono,
    fontSize: "11px",
    fontWeight: 400,
    lineHeight: "15px",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  codeHead: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    width: "max-content",
    maxWidth: "100%",
    minWidth: 0,
  },
  // A document's code chip keeps its own padding and wash here.
  codeLabel: {
    display: "block",
    flex: "0 1 auto",
    minWidth: 0,
    overflow: "hidden",
    padding: { default: null, [inDocument]: "2px 5px" },
    borderRadius: { default: null, [inDocument]: "3px" },
    backgroundColor: { default: null, [inDocument]: tokens.well },
    color: tokens.ink,
    fontFamily: { default: geistMono, [inDocument]: tokens.fontMono },
    fontSize: "15px",
    fontWeight: 600,
    lineHeight: "18px",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  // Counts sit in the title row as plain text: the one +n −n pair, no pill.
  badge: {
    ...noBorder,
    display: "inline-flex",
    flex: "0 0 auto",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: "6px",
    width: "auto",
    maxWidth: "140px",
    minHeight: 0,
    overflow: "hidden",
    padding: 0,
    backgroundColor: tokens.transparent,
    fontFamily: geistMono,
    fontSize: "11px",
    fontWeight: 500,
    lineHeight: "15px",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  badgeEmpty: {
    visibility: "hidden",
  },
  badgeInGroup: {
    marginLeft: "auto",
    color: tokens.inkFaint,
    fontSize: "10px",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  count: {
    minWidth: 0,
    overflow: "hidden",
    fontWeight: 500,
    textOverflow: "ellipsis",
  },
  countAdded: {
    color: tokens.diffAdded,
  },
  countRemoved: {
    color: tokens.diffRemoved,
  },
  countInGroup: {
    flex: "0 0 auto",
    color: tokens.inkFaint,
    fontSize: "10px",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  storageOutline: {
    position: "absolute",
    inset: 0,
    zIndex: 0,
    display: "none",
    width: "100%",
    height: "100%",
    overflow: "visible",
    pointerEvents: "none",
  },
  storageFill: {
    fill: tokens.softwareMapStorageFill,
    stroke: "none",
  },
  storageFillDetail: {
    fill: tokens.softwareMapStorageFillDetail,
    stroke: "none",
  },
  storageSelection: {
    fill: "none",
    stroke: tokens.transparent,
    strokeLinejoin: "round",
    strokeWidth: "7px",
  },
  storageSelectionSelected: {
    stroke: tokens.selection,
  },
  storageBorder: {
    fill: "none",
    stroke: tokens.softwareMapStorageBorder,
    strokeLinejoin: "round",
    strokeWidth: "2px",
  },
  storageDetail: {
    fill: "none",
    stroke: tokens.softwareMapStorageDetail,
    strokeLinejoin: "round",
    strokeWidth: "1.25px",
  },
  storageDashed: {
    strokeDasharray: "7 5",
  },
  storageGlow: {
    filter: `drop-shadow(0 0 0 ${tokens.selection}) drop-shadow(0 0 3px ${tokens.selection})`,
  },
  storageFolder: {
    position: "absolute",
    inset: 0,
    zIndex: 0,
    display: "none",
    pointerEvents: "none",
    "::after": {
      position: "absolute",
      top: "46px",
      right: "10px",
      left: "min(190px, 68%)",
      borderTopWidth: "2px",
      borderTopStyle: "solid",
      borderTopColor: tokens.softwareMapStorageBorder,
      content: "''",
    },
  },
  storageFolderBody: {
    position: "absolute",
    top: "46px",
    right: 0,
    bottom: 0,
    left: 0,
    borderWidth: "0 2px 2px",
    borderStyle: "none solid solid",
    borderColor: `currentcolor ${tokens.softwareMapStorageBorder} ${tokens.softwareMapStorageBorder}`,
    borderRadius: "0 10px 10px 10px",
    backgroundColor: tokens.softwareMapStorageFill,
  },
  storageFolderTab: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "min(190px, 68%)",
    height: "48px",
    overflow: "visible",
  },
  schema: {
    position: "relative",
    zIndex: 1,
    display: "grid",
    gap: "8px",
    margin: "12px -2px 0",
  },
  schemaFlush: {
    margin: 0,
  },
  schemaSection: {
    overflow: "hidden",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.rule,
    borderRadius: "3px",
    backgroundColor: tokens.surface,
  },
  schemaSectionSelected: {
    borderColor: tokens.selection,
    boxShadow: "none",
  },
  schemaHeader: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    alignItems: "center",
    gap: "8px",
    padding: "7px 10px",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.rule,
    backgroundColor: tokens.tray,
    textAlign: "left",
  },
  schemaKind: {
    color: tokens.inkFaint,
    fontFamily: tokens.fontMono,
    fontSize: "10px",
    fontWeight: 700,
    lineHeight: "12px",
    textTransform: "uppercase",
  },
  schemaLabel: {
    minWidth: 0,
    overflow: "hidden",
    color: tokens.ink,
    fontFamily: tokens.fontMono,
    fontSize: "12px",
    lineHeight: "15px",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  schemaKey: {
    overflow: "hidden",
    padding: "7px 10px",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.rule,
    backgroundColor: tokens.tray,
    color: tokens.inkMuted,
    fontFamily: tokens.fontMono,
    fontSize: "11px",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  schemaRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(68px, auto)",
    alignItems: "center",
    gap: "10px",
    height: "30px",
    padding:
      "0 10px 0 calc(12px + var(--software-map-schema-row-depth, 0) * 18px)",
    borderBottomWidth: { default: "1px", ":last-child": 0 },
    borderBottomStyle: { default: "solid", ":last-child": "none" },
    borderBottomColor: { default: tokens.rule, ":last-child": "currentcolor" },
    backgroundColor: tokens.surface,
    textAlign: "left",
  },
  schemaRowActive: {
    outline: `2px solid ${tokens.selection}`,
    outlineOffset: "-2px",
    backgroundColor: tokens.rpcWash,
  },
  schemaRowPrimary: {
    backgroundImage: `repeating-linear-gradient(135deg, ${tokens.accentStripe} 0, ${tokens.accentStripe} 7px, ${tokens.transparent} 7px, ${tokens.transparent} 14px)`,
  },
  schemaRowName: {
    minWidth: 0,
    overflow: "hidden",
    color: tokens.ink,
    fontFamily: tokens.fontMono,
    fontSize: "12px",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  schemaKeyFlag: {
    marginRight: "6px",
    padding: "1px 4px",
    borderRadius: "4px",
    backgroundColor: tokens.diffModifiedBg,
    color: tokens.diffModified,
    fontSize: "10px",
  },
  schemaKeyFlagForeign: {
    backgroundColor: tokens.rpcWash,
    color: tokens.rpc,
  },
  schemaRowType: {
    minWidth: 0,
    overflow: "hidden",
    color: tokens.inkMuted,
    fontFamily: tokens.fontMono,
    fontSize: "11px",
    textAlign: "right",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});

// A change's border replaces the card's hairline.
const nodeStatusStyles = stylex.create({
  added: { borderColor: tokens.changeAdded },
  removed: {
    borderStyle: "dashed",
    borderColor: tokens.changeRemoved,
    opacity: 0.75,
  },
  modified: { borderColor: tokens.changeModified },
});

// A selected store's shape takes the change color, or the selection's.
const storeSelectedStyles = stylex.create({
  unchanged: { "--software-map-storage-border": tokens.selection },
  added: { "--software-map-storage-border": tokens.changeAdded },
  removed: { "--software-map-storage-border": tokens.changeRemoved },
  modified: { "--software-map-storage-border": tokens.changeModified },
});

const codeRingStyles = stylex.create({
  selected: {
    "::before": { boxShadow: `inset 0 0 0 1.5px ${tokens.selection}` },
  },
  added: {
    "::before": { boxShadow: `inset 0 0 0 1.5px ${tokens.changeAdded}` },
  },
  removed: {
    "::before": { boxShadow: `inset 0 0 0 1.5px ${tokens.changeRemoved}` },
  },
  modified: {
    "::before": { boxShadow: `inset 0 0 0 1.5px ${tokens.changeModified}` },
  },
});

// React Flow takes node and edge classes as strings.
const FLOW_NODE_CLASS_NAME = stylex.props(styles.flowNode).className;

const FLOW_EDGE_CLASS_NAME = stylex.props(styles.flowEdge).className;
