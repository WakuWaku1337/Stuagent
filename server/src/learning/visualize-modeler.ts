import { normalizeText, type ModeledVisualization } from './viz/modeler/core.ts';
import { modelFunction } from './viz/modeler/function-model.ts';
import { modelConic } from './viz/modeler/conic-model.ts';
import { modelGeometry } from './viz/modeler/geometry-model.ts';
import { modelMolecule } from './viz/modeler/molecule-model.ts';
import {
  modelCircuit,
  modelHorizontalForces,
  modelIncline,
  modelLens,
  modelPaperFeed,
  modelPlaneGeometry,
} from './viz/modeler/physics-model.ts';
import { modelBiology } from './viz/modeler/biology-model.ts';

export type { ModeledVisualization } from './viz/modeler/core.ts';

export function modelVisualization(question: string, subject?: string): ModeledVisualization | null {
  const text = normalizeText(question);
  const models = [
    () => modelMolecule(text),
    () => modelPaperFeed(text),
    () => modelCircuit(text),
    () => modelIncline(text),
    () => modelLens(text),
    () => modelConic(text),
    () => modelFunction(text, subject),
    () => modelGeometry(text),
    () => modelPlaneGeometry(text),
    () => modelHorizontalForces(text),
    () => modelBiology(text),
  ];
  for (const build of models) {
    try {
      const result = build();
      if (result) return result;
    } catch {
      // 单个建模器失败不影响后续匹配
    }
  }
  return null;
}
