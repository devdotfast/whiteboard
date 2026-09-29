import {
  type Block,
  type BlockType,
  traceQuoteLink,
} from "@review/review-api/document";
import * as stylex from "@stylexjs/stylex";
import {
  Component,
  type ReactNode,
  createContext,
  useContext,
  useMemo,
} from "react";

import { MarkdownContent } from "./agent-markdown";
import type { ApiDocumentData } from "./api-document";
import { blockSectionSummary } from "./block-document-derivations";
import { DocumentCallTree } from "./call-tree-view";
import { RenderedCodeBlock } from "./code-block";
import { CodePeekCard } from "./CodePeek";
import { DatabaseLens } from "./database-lens";
import { SequenceDiagram } from "./diagrams";
import { documentStyles } from "./document-styles";
import { FlowDiagram } from "./flow-diagram";
import { AnchorLink, ReviewSection } from "./review-components";
import { ReviewDocumentTitle } from "./review-document-surface";
import { SoftwareMap } from "./software-map/SoftwareMap";
import { tokens } from "./tokens.stylex";
import { TraceQuote } from "./trace-quote";
import { TutorialAuthoringConversation } from "./tutorial-authoring-conversation";
import {
  TutorialFeature,
  TutorialViewButton,
} from "./tutorial-dynamic-content";
import { TutorialKeymapPicker } from "./tutorial-keymap-picker";

/** A block the store has written: ids are assigned before any write. */
export type StoredBlock = Block & { id: string };

const hasId = (block: Block): block is StoredBlock => block.id !== undefined;

/**
 * The one place a stored block's id is checked, instead of `!` at every use.
 * Returns the same object so memoized nodes keep their identity.
 */
export function stored(block: Block): StoredBlock {
  if (!hasId(block)) throw new Error(`Stored ${block.type} block has no id.`);

  return block;
}

type BlockByType = { [K in BlockType]: Extract<StoredBlock, { type: K }> };

export interface BlockProps<K extends BlockType> {
  node: BlockByType[K];
  data: ApiDocumentData;
  /** Renders nested blocks. */
  children(nodes: Block[]): ReactNode;
}

export type BlockComponent<K extends BlockType> = (
  props: BlockProps<K>,
) => ReactNode;

/** Saves a prose block's Markdown, where the shown document can be edited. */
export const SaveMarkdown = createContext<
  ((blockId: string, markdown: string) => void) | undefined
>(undefined);

function MarkdownBlock({ node, data }: BlockProps<"markdown">) {
  const save = useContext(SaveMarkdown);

  const onChange = useMemo(
    () => save && ((markdown: string) => save(node.id, markdown)),
    [save, node.id],
  );

  return (
    <MarkdownContent
      source={node.markdown}
      onChange={onChange}
      headingId={(index) => data.headings.get(node.id, index)}
      h1={ReviewDocumentTitle}
      renderLink={(href, children) => {
        const quote = traceQuoteLink(href);

        if (quote) {
          const trace = data.traces.get(quote.traceId);

          const event = trace?.events.findIndex(
            (item) => item.id === quote.eventId,
          );

          if (event === undefined || event < 0)
            return <q data-unavailable="trace">{children}</q>;

          return (
            <TraceQuote sessionId={quote.traceId} event={event}>
              {children}
            </TraceQuote>
          );
        }

        const anchor = data.anchors.get(`${node.id}:${href}`);

        return anchor ? (
          <AnchorLink anchor={anchor}>{children}</AnchorLink>
        ) : undefined;
      }}
      allowRemoteImages
    />
  );
}

function CodeBlock({ node }: BlockProps<"code">) {
  return (
    <RenderedCodeBlock
      code={node.text}
      language={node.language}
      caption={node.caption}
      lineNumbers
    />
  );
}

function DividerBlock() {
  return <hr />;
}

function SectionBlock({ node, data, children }: BlockProps<"section">) {
  return (
    <ReviewSection
      stateKey={`${data.snapshot.reviewId}:${node.id}`}
      title={node.title}
      id={data.headings.get(node.id)}
      defaultCollapsed={node.defaultCollapsed}
      summary={blockSectionSummary(node.children)}
    >
      {children(node.children)}
    </ReviewSection>
  );
}

function CalloutBlock({ node, children }: BlockProps<"callout">) {
  return (
    <blockquote
      data-tone={node.tone}
      {...stylex.props(
        documentStyles.serif,
        styles.callout,
        styles[node.tone],
        documentStyles.column,
      )}
    >
      {node.title && <strong data-review-copy-prose>{node.title}</strong>}
      {children(node.children)}
    </blockquote>
  );
}

function CodePeekBlock({ node }: BlockProps<"code_peek">) {
  return <CodePeekCard source={node.source} />;
}

function SequenceBlock({ node }: BlockProps<"sequence">) {
  return (
    <SequenceDiagram
      id={node.id}
      title={node.title}
      actors={node.actors}
      steps={node.steps}
    />
  );
}

function CallStackDiffBlock({ node }: BlockProps<"call_stack_diff">) {
  return <DocumentCallTree block={node} />;
}

function DatabaseLensBlock({ node }: BlockProps<"database_lens">) {
  return (
    <DatabaseLens
      id={node.id}
      title={node.title}
      actors={node.actors}
      stores={node.stores}
      useCases={node.useCases}
    />
  );
}

function ImageBlock({ node, data }: BlockProps<"image">) {
  return (
    <figure {...stylex.props(documentStyles.column)}>
      <img
        src={data.images.get(node.assetId)}
        alt={node.alt}
        {...stylex.props(documentStyles.image)}
      />
      {node.caption && <figcaption>{node.caption}</figcaption>}
    </figure>
  );
}

// The store checked the quote against its trace at write time; if the trace
// cannot be loaded now, the words still show instead of the canvas failing.
function TraceQuoteBlock({ node, data }: BlockProps<"trace_quote">) {
  const trace = data.traces.get(node.traceId);

  const event =
    trace?.events.findIndex((item) => item.id === node.eventId) ?? -1;

  if (!trace || event < 0)
    return (
      <blockquote
        data-unavailable="trace"
        {...stylex.props(documentStyles.serif, documentStyles.column)}
      >
        {node.text}
      </blockquote>
    );

  return (
    <TraceQuote sessionId={node.traceId} event={event}>
      {node.text}
    </TraceQuote>
  );
}

function SoftwareMapBlock({ node, data }: BlockProps<"software_map">) {
  return (
    <SoftwareMap
      diagramId={node.id}
      model={data.maps.get(node.mapVersionId)}
      pinnedData={data.maps.get(node.mapVersionId)?.pinnedData}
      view={node.focusElementId}
    />
  );
}

type Components = { [K in BlockType]: BlockComponent<K> };

/** Every block kind's component, keyed by type. A kind without a component is a compile error. */
function TutorialBlock({ node, children }: BlockProps<"tutorial">) {
  switch (node.kind) {
    case "keymap":
      return (
        <div {...stylex.props(documentStyles.column)}>
          <TutorialKeymapPicker />
        </div>
      );
    case "conversation":
      return (
        <div {...stylex.props(documentStyles.column)}>
          <TutorialAuthoringConversation conversation={node.conversation} />
        </div>
      );
    case "view":
      return (
        <div {...stylex.props(documentStyles.column)}>
          <TutorialViewButton view={node.view}>{node.label}</TutorialViewButton>
        </div>
      );
    case "feature":
      return (
        <TutorialFeature feature={node.feature}>
          {children(node.children)}
        </TutorialFeature>
      );
  }
}

export const blockComponents = {
  tutorial: TutorialBlock,
  markdown: MarkdownBlock,
  code: CodeBlock,
  divider: DividerBlock,
  code_peek: CodePeekBlock,
  sequence: SequenceBlock,
  call_stack_diff: CallStackDiffBlock,
  database_lens: DatabaseLensBlock,
  image: ImageBlock,
  trace_quote: TraceQuoteBlock,
  flow_diagram: ({ node, data }) => (
    <FlowDiagram node={node} snapshot={data.snapshot} />
  ),
  software_map: SoftwareMapBlock,
  section: SectionBlock,
  callout: CalloutBlock,
} satisfies Components;

/** Render one stored block through its kind's component. */
export function renderBlock<K extends BlockType>(
  type: K,
  node: BlockByType[K],
  data: ApiDocumentData,
  children: BlockProps<K>["children"],
): ReactNode {
  // SAFETY: blockComponents satisfies Components, so its entry for K is that kind's component.
  const Component = blockComponents[type] as BlockComponent<K>;

  return (
    <Component node={node} data={data}>
      {children}
    </Component>
  );
}

interface BlockErrorBoundaryProps {
  block: StoredBlock;
  onError(error: Error): void;
  children: ReactNode;
}

interface BlockErrorBoundaryState {
  block: StoredBlock;
  error: Error | null;
}

/**
 * One block that throws degrades to one alert; the rest of the document
 * stays readable and the error is still reported as a render diagnostic.
 */
export class BlockErrorBoundary extends Component<
  BlockErrorBoundaryProps,
  BlockErrorBoundaryState
> {
  override state: BlockErrorBoundaryState = {
    block: this.props.block,
    error: null,
  };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  static getDerivedStateFromProps(
    props: BlockErrorBoundaryProps,
    state: BlockErrorBoundaryState,
  ): BlockErrorBoundaryState | null {
    // An edit replaces the block object; the last failure was for the old one.
    return props.block === state.block
      ? null
      : { block: props.block, error: null };
  }

  override componentDidCatch(error: Error) {
    this.props.onError(error);
  }

  override render() {
    const { error } = this.state;
    const { type } = this.props.block;

    if (error)
      return (
        <div role="alert" data-block-error={type}>
          This {type.replaceAll("_", " ")} block could not be rendered:{" "}
          {error.message}
        </div>
      );

    return this.props.children;
  }
}

const inDocument = ":is(.review-document *)";

const styles = stylex.create({
  callout: {
    margin: { default: null, [inDocument]: "18px 0" },
    padding: { default: null, [inDocument]: "12px 16px" },
    borderLeftWidth: { default: null, [inDocument]: "2px" },
    borderLeftStyle: { default: null, [inDocument]: "solid" },
    borderLeftColor: { default: null, [inDocument]: tokens.inkFaint },
    borderRadius: { default: null, [inDocument]: "0 6px 6px 0" },
    backgroundColor: { default: null, [inDocument]: tokens.tray },
    fontSize: { default: null, [inDocument]: "15px" },
    lineHeight: { default: null, [inDocument]: "22px" },
  },
  info: {
    borderLeftColor: { default: null, [inDocument]: tokens.accent },
    backgroundColor: { default: null, [inDocument]: tokens.markerTint },
  },
  warning: {
    borderLeftColor: { default: null, [inDocument]: tokens.changeModified },
    backgroundColor: { default: null, [inDocument]: tokens.diffModifiedBg },
  },
  danger: {
    borderLeftColor: { default: null, [inDocument]: tokens.changeRemoved },
    backgroundColor: { default: null, [inDocument]: tokens.diffRemovedBg },
  },
  success: {
    borderLeftColor: { default: null, [inDocument]: tokens.changeAdded },
    backgroundColor: { default: null, [inDocument]: tokens.diffAddedBg },
  },
});
