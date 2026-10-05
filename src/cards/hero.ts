import { shell } from '../core/svg.ts';
import type { CardDefinition } from '../core/types.ts';

// Placeholder: replaced by the real implementation.
export const card: CardDefinition = {
  id: 'hero',
  title: 'Hero banner',
  description: 'TODO',
  options: [],
  render: (ctx) => [
    {
      name: 'hero',
      alt: 'Hero banner',
      svg: shell({ width: 400, height: 120, palette: ctx.palette, title: 'Hero banner', body: '', animate: ctx.animate }),
    },
  ],
};
