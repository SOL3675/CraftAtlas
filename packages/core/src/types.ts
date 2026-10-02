export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface Evidence { id: string; kind: 'runtime' | 'viewer' | 'definition' | 'inference' | 'observation'; source: string; adapter: string; pointer: string }
export interface Resource { id: string; kind: string; name: string; evidence: string[]; components?: Json }
export interface Alternative { resource?: string; tag?: string; members?: string[]; predicate?: Json; components?: Json }
export interface Slot { alternatives: Alternative[]; amount: number; unit: string; consumption: 'consumed' | 'catalyst' | 'durability'; evidence: string[] }
export interface Output { resource: string; amount: number; unit: string; role: 'primary' | 'byproduct' | 'returned'; probability: number | null; evidence: string[]; components?: Json }
export interface Requirement { kind: 'equipment' | 'stage' | 'dimension' | 'context' | 'opaque'; id: string; evidence: string[]; predicate?: Json }
export interface Process {
  id: string; sourceId: string; type: string; inputs: Slot[]; outputs: Output[]; requirements: Requirement[];
  evidence: string[]; interpretation: 'supported' | 'opaque'; execution: 'executable' | 'display' | 'unconfirmed';
  unknown: string[]; enabled: boolean; costs: { kind: string; amount: number | null; unit: string; basis: string }[];
  raw: Json; fieldEvidence: Record<string, string[]>; conflicts: string[];
  viewerSources?: ViewerRecipe[];
  constraints?: Json;
  fieldHistory?: Record<string, { value: Json; evidence: string[] }[]>;
}
export interface Coverage { dataset: string; type: string; status: 'complete' | 'partial' | 'unsupported' | 'failed'; enumerated: number | null; interpreted: number | null; reasons: string[] }
export interface RawRecipe { id: string; type: string; data: Json | null; error?: string }
export interface WorldData {
  lootTables: RawRecipe[]; lootModifiers: RawRecipe[]; lootSources: RawRecipe[];
  biomes: RawRecipe[]; dimensions: RawRecipe[]; features: RawRecipe[];
  observations?: Json[]; limitations: string[];
}
export interface ViewerRecipe {
  id: string; recipeId: string | null; category: string; inputs: Slot[]; outputs: Output[];
  equipment: string[]; execution: 'display' | 'unconfirmed'; unknown: string[]; raw: Json;
}
export interface Snapshot {
  schemaVersion: 1; id: string; session: string; generation: number; mode: 'dedicated' | 'integrated';
  minecraft: string; loader: string; loaderVersion: string; collectorVersion: string;
  mods: { id: string; version: string }[]; environment: Json; resources: Resource[]; tags: Record<string, string[]>;
  recipes: RawRecipe[]; coverage: Coverage[]; completion: { status: 'complete' | 'partial' | 'failed'; errors: string[] };
  viewer?: { session: string; generation: number; context: Json; recipes: ViewerRecipe[]; coverage: Coverage[]; kind?: 'jei' | 'emi' | 'rei'; version?: string };
  world?: WorldData;
}
export interface Model { schemaVersion: 1; snapshotId: string; session: string; generation: number; normalizerVersion: string; environment: Json; mods: Snapshot['mods']; resources: Resource[]; tags: Record<string, string[]>; processes: Process[]; evidence: Evidence[]; coverage: Coverage[]; diagnostics: Diagnostic[]; contentHash: string }
export interface Diagnostic { id: string; rule: string; target: string; severity: 'info' | 'warning' | 'error'; status: 'confirmed' | 'unknown'; scenario: string | null; message: string; evidence: string[]; path: string[]; unknown: string[]; snapshotId: string }
export interface Scenario {
  schemaVersion: 1; id: string; inventory: Record<string, number>; equipment: string[]; stages: string[];
  dimensions: string[]; forbiddenProcesses: string[]; allowedTypes: string[] | null;
  supply: 'renewable' | 'finite'; closed: boolean; closedResources: string[]; gameRules: Json;
}
export interface Expectations { schemaVersion: 1; recipes: string[]; nonemptyTags: string[]; supportedTypes: string[]; reachable: string[]; unreachable: string[] }
export interface CostRequest {
  schemaVersion: 1; id: string; target: { resource: string; amount: number; unit: string };
  routes: Record<string, { process: string; output: number }>;
  selections: Record<string, Record<string, string>>;
  mode: 'deterministic' | 'expectation';
  probabilityModels: Record<string, { kind: 'iid-bernoulli'; independentOutputs: boolean }>;
  durability: Record<string, { remaining: number; lifetime: number }>;
  inventoryUnits?: Record<string, string>;
}
export interface DefinitionPack {
  schemaVersion: 1; id: string; version: string; priority: number;
  targets: { minecraft: string; loader: string; mods: { id: string; versions: string[] }[] };
  verified: string[];
  operations: { id: string; selector: { id?: string; type?: string }; action: 'append' | 'replace' | 'disable'; patch: Partial<Pick<Process, 'inputs' | 'outputs' | 'requirements' | 'costs' | 'unknown' | 'execution'>>; evidence: string; override: string[] }[];
  additions: Process[];
}
