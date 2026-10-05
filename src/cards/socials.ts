import { shell } from '../core/svg.ts';
import type { CardDefinition } from '../core/types.ts';

// Placeholder: replaced by the real implementation.
export const card: CardDefinition = {
  id: 'socials',
  title: 'Social badges',
  description: 'TODO',
  options: [],
  render: (ctx) => [
    {
      name: 'socials',
      alt: 'Social badges',
      svg: shell({ width: 400, height: 120, palette: ctx.palette, title: 'Social badges', body: '', animate: ctx.animate }),
    },
  ],
};
