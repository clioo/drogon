/* MIT Copyright (c) 2026 Lovecast Inc. Ported verbatim from Orca
   src/renderer/src/lib/palette-match/evidence-composer.ts at pinned source c9790628
   (clioo/drogon-orca). Only this header and module-relative import
   paths were adapted for the Drogon kanban feature. */
import type {
  PaletteFieldProfile,
  PaletteIdentifierOptions,
} from "./indexed-field";
import type {
  PaletteDocumentInput,
  PaletteEvidenceFieldSource,
} from "./palette-document";

export const PALETTE_EVIDENCE_SEPARATOR = " · ";

export type PaletteEvidencePart = {
  key: string;
  text: string;
  profile: PaletteFieldProfile;
  identifier?: PaletteIdentifierOptions;
};

export type PaletteComposedEvidence = PaletteDocumentInput["evidence"][number];

/**
 * Joins the parts of one evidence unit into the text the row renders and records
 * each part's offset, so match ranges land on the rendered string.
 */
export function composePaletteEvidence(args: {
  id: string;
  kind: string;
  accessibilityLabel: string;
  parts: readonly (PaletteEvidencePart | null | undefined)[];
}): PaletteComposedEvidence | null {
  // Trimmed here because field indexing trims too; untrimmed text would shift offsets.
  const parts = args.parts
    .filter((part): part is PaletteEvidencePart => Boolean(part?.text.trim()))
    .map((part) => ({ ...part, text: part.text.trim() }));
  if (!parts.length) {
    return null;
  }

  const fields: PaletteEvidenceFieldSource[] = [];
  let text = "";
  for (const part of parts) {
    if (text) {
      text += PALETTE_EVIDENCE_SEPARATOR;
    }
    fields.push({
      id: `${args.id}#${part.key}`,
      profile: part.profile,
      text: part.text,
      evidenceId: args.id,
      renderOffset: text.length,
      identifier: part.identifier,
    });
    text += part.text;
  }

  return {
    unit: {
      id: args.id,
      kind: args.kind,
      text,
      accessibilityLabel: args.accessibilityLabel,
    },
    fields,
  };
}
