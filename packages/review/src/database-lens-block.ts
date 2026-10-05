import type {
  DatabaseActor,
  DatabaseLensBlock,
  DatabaseStore,
} from "./review-api/document";

export interface DatabaseLensBlockProps {
  id: string;
  title?: string;
  height?: number;
  actors: Record<string, DatabaseActor>;
  stores: Record<string, DatabaseStore>;
  useCases: DatabaseLensBlock["useCases"];
  pins?: DatabaseLensBlock["pins"];
}
