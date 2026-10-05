import { shell } from '../core/svg.ts';
import type { CardDefinition } from '../core/types.ts';

// Placeholder: replaced by the real implementation.
export const card: CardDefinition = {
  id: 'stack',
  title: 'Tech stack',
  description: 'TODO',
  options: [],
  render: (ctx) => [
    {
      name: 'stack',
      alt: 'Tech stack',
      svg: shell({ width: 400, height: 120, palette: ctx.palette, title: 'Tech stack', body: '', animate: ctx.animate }),
    },
  ],
};
