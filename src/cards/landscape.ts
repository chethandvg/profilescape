import { shell } from '../core/svg.ts';
import type { CardDefinition } from '../core/types.ts';

// Placeholder: replaced by the real implementation.
export const card: CardDefinition = {
  id: '3d',
  title: '3D contributions',
  description: 'TODO',
  options: [],
  render: (ctx) => [
    {
      name: '3d',
      alt: '3D contributions',
      svg: shell({ width: 400, height: 120, palette: ctx.palette, title: '3D contributions', body: '', animate: ctx.animate }),
    },
  ],
};
