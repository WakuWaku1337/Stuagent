import type { VisualizationType } from '../visualize.ts';
import type { VizDocumentKind, VizDocumentV2 } from '../../../../shared/viz/types.ts';

const KIND_BY_TYPE: Record<VisualizationType, VizDocumentKind> = {
  geometry3d: 'solid-geometry',
  function2d: 'function-graph',
  function3d: 'function-3d',
  conic: 'conic',
  molecule: 'molecule',
  terrain: 'terrain',
  biology: 'biology',
  physics: 'physics',
  diagram: 'diagram',
};

export function vizKindForType(type: VisualizationType): VizDocumentKind {
  return KIND_BY_TYPE[type];
}

export function documentFromLegacySpec(input: {
  type: VisualizationType;
  title: string;
  spec: Record<string, unknown>;
  inputText?: string;
  subject?: string;
  generator?: 'modeler' | 'manual' | 'preset';
  version?: string;
  inputRecovered?: boolean;
}): VizDocumentV2 {
  return {
    schema: 'edupi.viz/v2',
    kind: KIND_BY_TYPE[input.type],
    title: input.title,
    input: {
      text: input.inputText?.trim() || input.title,
      ...(input.subject ? { subject: input.subject } : {}),
      ...(input.inputRecovered ? { recovered: true } : {}),
    },
    provenance: {
      generator: input.generator ?? 'modeler',
      version: input.version ?? 'modeler@2.0.0',
    },
    scene: input.spec as unknown as VizDocumentV2['scene'],
    diagnostics: [],
  };
}
