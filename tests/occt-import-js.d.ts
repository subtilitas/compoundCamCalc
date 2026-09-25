/**
 * Types of the parts of occt-import-js 0.0.23 the tests and
 * scripts/validate-step.js use.
 */
declare module 'occt-import-js' {
  interface OcctMesh {
    name: string;
    attributes: { position: { array: number[] }; normal?: { array: number[] } };
    index: { array: number[] };
    brep_faces: { first: number; last: number; color: number[] | null }[];
  }
  interface OcctResult {
    success: boolean;
    root: { name: string; meshes: number[]; children: unknown[] };
    meshes: OcctMesh[];
  }
  interface OcctParams {
    linearUnit?: 'millimeter' | 'centimeter' | 'meter' | 'inch' | 'foot';
    linearDeflectionType?: 'bounding_box_ratio' | 'absolute_value';
    linearDeflection?: number;
    angularDeflection?: number;
  }
  interface Occt {
    ReadStepFile(content: Uint8Array, params: OcctParams | null): OcctResult;
  }
  export default function occtimportjs(): Promise<Occt>;
}
