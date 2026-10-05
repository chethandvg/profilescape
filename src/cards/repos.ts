import { shell } from '../core/svg.ts';
import type { CardDefinition } from '../core/types.ts';

// Placeholder: replaced by the real implementation.
export const card: CardDefinition = {
  id: 'repos',
  title: 'Repo cards',
  description: 'TODO',
  options: [],
  render: (ctx) => [
    {
      name: 'repos',
      alt: 'Repo cards',
      svg: shell({ width: 400, height: 120, palette: ctx.palette, title: 'Repo cards', body: '', animate: ctx.animate }),
    },
  ],
};
