import { shell } from '../core/svg.ts';
import type { CardDefinition } from '../core/types.ts';

// Placeholder: replaced by the real implementation.
export const card: CardDefinition = {
  id: 'grid',
  title: 'Contribution grid',
  description: 'TODO',
  options: [],
  render: (ctx) => [
    {
      name: 'grid',
      alt: 'Contribution grid',
      svg: shell({ width: 400, height: 120, palette: ctx.palette, title: 'Contribution grid', body: '', animate: ctx.animate }),
    },
  ],
};
