import { shell } from '../core/svg.ts';
import type { CardDefinition } from '../core/types.ts';

// Placeholder: replaced by the real implementation.
export const card: CardDefinition = {
  id: 'stats',
  title: 'Stats',
  description: 'TODO',
  options: [],
  render: (ctx) => [
    {
      name: 'stats',
      alt: 'Stats',
      svg: shell({ width: 400, height: 120, palette: ctx.palette, title: 'Stats', body: '', animate: ctx.animate }),
    },
  ],
};
