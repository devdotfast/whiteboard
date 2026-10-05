import { selectSource } from "@review/lens-selection";
import type { DatabaseOperation } from "@review/review-api/document";
import { describe, expect, it } from "vitest";

import {
  type LensStores,
  type ResolvedOperation,
  databaseC4Snapshot,
  initialDatabaseC4ExpandedNodeIds,
  lensTarget,
  seedDatabaseC4DefaultExpandedNodeIds,
  selectDatabaseOperationHighlights,
} from "./database-lens";
import { c4LayoutSignature } from "./software-map/c4-layout-geometry";

const graphStores: LensStores = {
  graphDb: {
    label: "Graph database",
    storage: "relational",
    dataStoreKind: "database",
    softwareMapPath: "product.graphDb",
    collections: {
      nodes: {
        label: "nodes",
        fields: {
          id: { label: "id", dataType: "text", primaryKey: true },
          props_json: { label: "props_json", dataType: "json" },
        },
      },
      edges: {
        label: "edges",
        fields: {
          from_id: {
            label: "from_id",
            dataType: "text",
            references: { store: "graphDb", collection: "nodes", field: "id" },
          },
        },
      },
    },
  },
};

const source = {
  side: "head",
  file: "app.ts",
  fromLine: 1,
  toLine: 1,
} as const;

function operation(
  stores: LensStores,
  input: Pick<DatabaseOperation, "store" | "collection" | "field"> & {
    id: string;
    kind: "read" | "write";
    actor: string;
    label?: string;
  },
): ResolvedOperation {
  return {
    id: input.id,
    kind: input.kind,
    actor: { id: input.actor, label: input.actor },
    target: lensTarget(stores, input),
    label: input.label ?? input.id,
    source: selectSource(source),
  };
}

describe("software map backed database lenses", () => {
  it("connects a field to the referenced store, including a document collection", () => {
    const stores: LensStores = {
      orders: {
        storage: "relational",
        label: "Orders",
        collections: {
          users: {
            label: "users",
            fields: { id: { label: "id", dataType: "text" } },
          },
          orders: {
            label: "orders",
            fields: {
              owner: {
                label: "owner",
                dataType: "text",
                references: {
                  store: "identity",
                  collection: "users",
                  field: "id",
                },
              },
            },
          },
        },
      },
      identity: {
        storage: "document",
        label: "Identity",
        collections: {
          users: {
            label: "users",
            fields: { id: { label: "id", dataType: "text" } },
          },
        },
      },
    };

    const snapshot = databaseC4Snapshot({
      useCase: { id: "read", label: "Read" },
      stores,
      resolvedOperations: [
        operation(stores, {
          id: "readOwner",
          kind: "read",
          actor: "reader",
          store: "orders",
          collection: "orders",
          field: "owner",
        }),
        operation(stores, {
          id: "readUser",
          kind: "read",
          actor: "reader",
          store: "identity",
          collection: "users",
          field: "id",
        }),
      ],
      highlights: selectDatabaseOperationHighlights([], null),
      selectedNodeId: null,
      expandedNodeIds: new Set(["store:orders", "store:identity"]),
    });

    expect(
      snapshot.relationships?.filter(
        (edge) => edge.semanticKind === "foreign key",
      ),
    ).toMatchObject([
      {
        from: "store:orders.tables.orders",
        to: "store:identity.documents.users",
      },
    ]);

    const ordersOnly = databaseC4Snapshot({
      useCase: { id: "read", label: "Read" },
      stores,
      resolvedOperations: [
        operation(stores, {
          id: "readOwner",
          kind: "read",
          actor: "reader",
          store: "orders",
          collection: "orders",
          field: "owner",
        }),
      ],
      highlights: selectDatabaseOperationHighlights([], null),
      selectedNodeId: null,
      expandedNodeIds: new Set(["store:orders"]),
    });

    expect(
      ordersOnly.relationships?.filter(
        (edge) => edge.semanticKind === "foreign key",
      ),
    ).toEqual([]);
  });

  it("keeps collection metadata renderable when table fields collide with id and label", () => {
    const stores: LensStores = {
      graphDb: {
        ...graphStores.graphDb!,
        collections: {
          nodes: {
            label: "nodes",
            fields: {
              id: { label: "id", dataType: "text", primaryKey: true },
              label: { label: "label", dataType: "text" },
              props_json: { label: "props_json", dataType: "json" },
            },
          },
        },
      },
    };

    const snapshot = databaseC4Snapshot({
      useCase: { id: "inspect", label: "Inspect graph" },
      stores,
      resolvedOperations: [
        operation(stores, {
          id: "readLabels",
          kind: "read",
          actor: "reader",
          store: "graphDb",
          collection: "nodes",
          field: "label",
          label: "reads labels",
        }),
      ],
      highlights: selectDatabaseOperationHighlights([], null),
      selectedNodeId: null,
      expandedNodeIds: new Set(["store:graphDb"]),
    });

    const tableNode = snapshot.nodes?.find(
      (node) => node.id === "product.graphDb.tables.nodes",
    );

    expect(tableNode).toMatchObject({
      label: "nodes",
      description: "Table",
    });
    expect(
      tableNode?.dataStoreSchemaSections?.flatMap((section) =>
        section.rows.map((row) => row.label),
      ),
    ).toEqual(["id", "label", "props_json"]);
  });

  it("expands operation data stores by default so table rows are visible", () => {
    const stores = graphStores;

    const operations = [
      operation(stores, {
        id: "writeNodes",
        kind: "write",
        actor: "writer",
        store: "graphDb",
        collection: "nodes",
        field: "id",
        label: "writes node ids",
      }),
      operation(stores, {
        id: "writeEdges",
        kind: "write",
        actor: "writer",
        store: "graphDb",
        collection: "edges",
        field: "from_id",
        label: "writes edge endpoints",
      }),
    ];

    const snapshot = databaseC4Snapshot({
      useCase: { id: "publish", label: "Publish graph" },
      stores,
      resolvedOperations: operations,
      highlights: selectDatabaseOperationHighlights([], null),
      selectedNodeId: null,
      expandedNodeIds: initialDatabaseC4ExpandedNodeIds(operations),
    });

    expect(snapshot.nodes?.map((node) => node.id).sort()).toEqual([
      "actor:writer",
      "product.graphDb.tables.edges",
      "product.graphDb.tables.nodes",
      "store:graphDb",
    ]);
    expect(
      snapshot.nodes
        ?.find((node) => node.id === "product.graphDb.tables.nodes")
        ?.dataStoreSchemaSections?.flatMap((section) =>
          section.rows.map((row) => row.label),
        ),
    ).toEqual(["id", "props_json"]);
    expect(
      snapshot.relationships?.find(
        (relationship) => relationship.id === "writeNodes",
      ),
    ).toMatchObject({
      to: "product.graphDb.tables.nodes",
      toSchemaFieldPath: ["id"],
      toSchemaEndpointKind: "field",
    });
  });

  it("does not re-expand a default data store after the reader collapses it", () => {
    const seededDefaultNodeIds = new Set(["store:graphDb"]);

    const next = seedDatabaseC4DefaultExpandedNodeIds({
      expandedNodeIds: new Set(),
      seededDefaultNodeIds,
      defaultExpandedNodeIds: new Set(["store:graphDb"]),
    });

    expect([...next.expandedNodeIds]).toEqual([]);
    expect([...next.seededDefaultNodeIds]).toEqual(["store:graphDb"]);
  });

  it("still expands newly introduced default data stores", () => {
    const next = seedDatabaseC4DefaultExpandedNodeIds({
      expandedNodeIds: new Set(["store:graphDb"]),
      seededDefaultNodeIds: new Set(["store:graphDb"]),
      defaultExpandedNodeIds: new Set(["store:graphDb", "store:auditDb"]),
    });

    expect([...next.expandedNodeIds].sort()).toEqual([
      "store:auditDb",
      "store:graphDb",
    ]);
    expect([...next.seededDefaultNodeIds].sort()).toEqual([
      "store:auditDb",
      "store:graphDb",
    ]);
  });

  it("keeps DB lens layout stable when guided tour highlights move between operations", () => {
    const stores = graphStores;

    const operations = [
      operation(stores, {
        id: "readNodes",
        kind: "read",
        actor: "reader",
        store: "graphDb",
        collection: "nodes",
        field: "id",
        label: "reads node ids",
      }),
      operation(stores, {
        id: "readEdges",
        kind: "read",
        actor: "reader",
        store: "graphDb",
        collection: "edges",
        field: "from_id",
        label: "reads edge endpoints",
      }),
    ];

    const highlightInputs = [
      {
        anchorId: "readNodes",
        targetKey: "graphDb.tables.nodes.id",
      },
      {
        anchorId: "readEdges",
        targetKey: "graphDb.tables.edges.from_id",
      },
    ];

    const nodesSnapshot = databaseC4Snapshot({
      useCase: { id: "inspect", label: "Inspect graph" },
      stores,
      resolvedOperations: operations,
      highlights: selectDatabaseOperationHighlights(
        highlightInputs,
        "readNodes",
      ),
      selectedNodeId: null,
      expandedNodeIds: new Set(["store:graphDb"]),
    });

    const edgesSnapshot = databaseC4Snapshot({
      useCase: { id: "inspect", label: "Inspect graph" },
      stores,
      resolvedOperations: operations,
      highlights: selectDatabaseOperationHighlights(
        highlightInputs,
        "readEdges",
      ),
      selectedNodeId: null,
      expandedNodeIds: new Set(["store:graphDb"]),
    });

    expect(
      nodesSnapshot.nodes
        ?.flatMap((node) => node.dataStoreSchemaSections ?? [])
        .flatMap((section) => section.rows)
        .filter((row) => row.state === "active")
        .map((row) => row.id),
    ).not.toEqual(
      edgesSnapshot.nodes
        ?.flatMap((node) => node.dataStoreSchemaSections ?? [])
        .flatMap((section) => section.rows)
        .filter((row) => row.state === "active")
        .map((row) => row.id),
    );
    expect(
      c4LayoutSignature(
        nodesSnapshot.nodes ?? [],
        nodesSnapshot.relationships ?? [],
      ),
    ).toBe(
      c4LayoutSignature(
        edgesSnapshot.nodes ?? [],
        edgesSnapshot.relationships ?? [],
      ),
    );
  });
});

describe("database lens operation highlighting", () => {
  const operations = [
    {
      anchorId: "writeSettings",
      targetKey: "appDb:tables:repository_settings:value",
    },
    {
      anchorId: "writeAudit",
      targetKey: "appDb:tables:audit_log:value",
    },
    {
      anchorId: "refreshCache",
      targetKey: "cache:documents:repository_settings:value",
    },
  ];

  it("marks only the requested operation active", () => {
    const highlights = selectDatabaseOperationHighlights(
      operations,
      "writeAudit",
    );

    expect(highlights.activeAnchor).toBe("writeAudit");
    expect(Object.fromEntries(highlights.operationStates)).toEqual({
      writeSettings: "inactive",
      writeAudit: "active",
      refreshCache: "inactive",
    });
    expect([...highlights.activeTargetKeys]).toEqual([
      "appDb:tables:audit_log:value",
    ]);
  });

  it("falls back to the first operation when the active anchor is outside the lens", () => {
    const highlights = selectDatabaseOperationHighlights(
      operations,
      "unrelatedAnchor",
    );

    expect(highlights.activeAnchor).toBe("writeSettings");
    expect(Object.fromEntries(highlights.operationStates)).toEqual({
      writeSettings: "active",
      writeAudit: "inactive",
      refreshCache: "inactive",
    });
  });
});
