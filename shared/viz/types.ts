export type VizDocumentKind =
  | 'function-graph'
  | 'conic'
  | 'function-3d'
  | 'solid-geometry'
  | 'molecule'
  | 'terrain'
  | 'biology'
  | 'physics'
  | 'diagram';

export type VizDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface VizDiagnostic {
  code: string;
  severity: VizDiagnosticSeverity;
  message: string;
  hint?: string;
  path?: string;
}

export interface FunctionDefinitionV2 {
  name: string;
  params: string[];
  body: string;
  display: string;
  piecewise?: { when: string; then: string }[];
  domain?: [number, number];
}

export interface CurveRef {
  def: string;
  role: 'primary' | 'secondary' | 'reference';
  visible: boolean;
}

export interface Parameter {
  name: string;
  min: number;
  max: number;
  step: number;
  value: number;
}

export interface ViewSpec {
  x: [number, number];
  y?: [number, number];
  mode: 'auto' | 'fixed';
}

export type FeatureSpec =
  | { kind: 'roots'; of: string[]; expected?: number; limit?: number }
  | { kind: 'intersections'; of: [string, string]; limit?: number }
  | { kind: 'extrema'; of: string[]; limit?: number }
  | { kind: 'endpoints'; of: string[] };

export type Boundary =
  | { kind: 'constant'; value: number }
  | { kind: 'function'; def: string };

export type RegionSpec =
  | { kind: 'between'; lower: Boundary; upper: Boundary; role: 'solution' }
  | { kind: 'condition'; condition: string; axis: 'x' | 'y'; role: 'solution' };

export interface FunctionGraphScene {
  definitions: FunctionDefinitionV2[];
  curves: CurveRef[];
  parameters: Parameter[];
  view: ViewSpec;
  features: FeatureSpec[];
  regions: RegionSpec[];
}

export interface ConicScene {
  expression: string;
  label: string;
  view: ViewSpec;
}

export interface Point3D {
  id: string;
  coord: [number, number, number];
}

export interface AuxiliarySpec {
  kind: 'plane' | 'line' | 'perpendicular' | 'mark';
  points: string[];
  style?: { color?: string; opacity?: number; dash?: boolean };
  reason?: string;
}

export interface SolidGeometryScene {
  points: Point3D[];
  edges: [string, string][];
  faces: string[][];
  auxiliary: AuxiliarySpec[];
  labels: boolean;
}

export interface MoleculeScene {
  format: 'xyz' | 'sdf' | 'mol';
  style: 'stick' | 'sphere' | 'line';
  data: string;
}

export interface SurfaceScene {
  expression?: string;
  grid?: number[][];
  range: [number, number];
}

export interface BiologyPart {
  id: string;
  label: string;
  coord: [number, number, number];
  radius: number;
  color: string;
}

export interface BiologyScene {
  parts: BiologyPart[];
}

export type DiagramElement =
  | { kind: 'line'; from: [number, number]; to: [number, number]; label?: string; color?: string }
  | { kind: 'arrow'; from: [number, number]; to: [number, number]; label?: string; color?: string }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; label?: string; rotate?: number; color?: string }
  | { kind: 'circle'; x: number; y: number; r: number; label?: string; color?: string }
  | { kind: 'text'; x: number; y: number; text: string; color?: string };

export interface DiagramScene {
  elements: DiagramElement[];
}

export interface VizDocumentV2 {
  schema: 'edupi.viz/v2';
  kind: VizDocumentKind;
  title: string;
  input: {
    text: string;
    subject?: string;
    /** 旧记录没有原题文本时，用标题回填并标记，避免伪装成原题。 */
    recovered?: boolean;
  };
  provenance: {
    generator: 'modeler' | 'manual' | 'preset';
    version: string;
    questionHash?: string;
  };
  scene:
    | FunctionGraphScene
    | ConicScene
    | SolidGeometryScene
    | MoleculeScene
    | SurfaceScene
    | BiologyScene
    | DiagramScene;
  diagnostics: VizDiagnostic[];
}

export interface RenderPoint {
  x: number;
  y: number;
  label?: string;
  kind: 'root' | 'intersection' | 'extremum' | 'endpoint';
}

export interface RenderCurve {
  id: string;
  label: string;
  role: CurveRef['role'];
  segments: { x: number; y: number }[][];
}

export interface RenderRegion {
  polygon: { x: number; y: number }[];
  role: 'solution';
}

export interface ConicSegment {
  from: { x: number; y: number };
  to: { x: number; y: number };
}

export interface CartesianRenderModel {
  view: { x: [number, number]; y: [number, number] };
  curves: RenderCurve[];
  points: RenderPoint[];
  regions: RenderRegion[];
  conicSegments: ConicSegment[];
  diagnostics: VizDiagnostic[];
}

export class VizPlanError extends Error {
  code: string;
  diagnostics: VizDiagnostic[];

  constructor(code: string, message: string, diagnostics: VizDiagnostic[] = []) {
    super(message);
    this.name = 'VizPlanError';
    this.code = code;
    this.diagnostics = diagnostics;
  }
}
