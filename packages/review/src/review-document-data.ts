import type { z } from "zod";

import type {
  ReviewDocumentComponentName,
  reviewComponentDataSchemas,
} from "./authoring";

export type {
  AnchorRef as DocumentAnchor,
  PeekableAnchorRef as DocumentPeekableAnchor,
} from "./authoring";

export type ReviewComponentProps<Name extends ReviewDocumentComponentName> =
  z.infer<(typeof reviewComponentDataSchemas)[Name]>;
