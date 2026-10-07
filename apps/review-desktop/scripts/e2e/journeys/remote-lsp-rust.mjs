/** The rust group on an SSH host with its toolchain; see remote-lsp-languages.mjs. Its container image is large, so it runs only when named. */
import {
  remoteLspOptions,
  runRemoteLspJourney,
} from "../remote-lsp-languages.mjs";

export const name = "remote-lsp-rust";

export const phase = 2;

export const manual = true;

export const options = remoteLspOptions();

export const run = (ctx) => runRemoteLspJourney(ctx, "rust");
