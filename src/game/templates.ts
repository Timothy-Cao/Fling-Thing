import { PlacedBlock } from './types';

export interface Template {
  id: string;
  name: string;
  blurb: string;
  blocks: PlacedBlock[];
}

// Examples removed — better ones are coming.
export const TEMPLATES: Template[] = [];
