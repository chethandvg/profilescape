import type { CardDefinition, CardId } from '../core/types.ts';
import { card as languages } from './languages.ts';
import { card as landscape } from './landscape.ts';
import { card as grid } from './grid.ts';
import { card as hero } from './hero.ts';
import { card as repos } from './repos.ts';
import { card as socials } from './socials.ts';
import { card as stack } from './stack.ts';
import { card as stats } from './stats.ts';

export const CARDS: Record<CardId, CardDefinition> = {
  stats,
  languages,
  '3d': landscape,
  grid,
  repos,
  hero,
  stack,
  socials,
};
