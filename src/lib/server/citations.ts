import { FieldCitation, NormalizedBlock } from "@/lib/types";

interface CitationInput {
  field_path: string;
  source_block_ids?: string[];
}

export function resolveFieldCitations(
  citationInputs: CitationInput[],
  blocksById: Map<string, NormalizedBlock>
): FieldCitation[] {
  const resolved: FieldCitation[] = [];

  for (const entry of citationInputs) {
    const blockIds = entry.source_block_ids ?? [];

    for (const blockId of blockIds) {
      const block = blocksById.get(blockId);
      if (!block) {
        continue;
      }

      resolved.push({
        fieldPath: entry.field_path,
        pageIndex: block.pageIndex,
        blockId: block.id,
        blockIndex: block.index,
        bbox2d: block.bbox2d,
        label: block.label,
      });
    }
  }

  return resolved;
}
