import { shell } from '../core/svg.ts';
import type { CardDefinition } from '../core/types.ts';

// Placeholder: replaced by the real implementation.
export const card: CardDefinition = {
  id: 'languages',
  title: 'Languages',
  description: 'TODO',
  options: [],
  render: (ctx) => [
    {
      name: 'languages',
      alt: 'Languages',
      svg: shell({ width: 400, height: 120, palette: ctx.palette, title: 'Languages', body: '', animate: ctx.animate }),
    },
  ],
};
