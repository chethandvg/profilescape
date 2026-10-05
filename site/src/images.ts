import { h } from './dom.ts';

/**
 * Cards are shown as <img> elements, exactly as GitHub shows them. That keeps
 * every SVG isolated (cards reuse ids such as "ps-clip", which would clash if
 * several were inlined into one document) and lets CSS animations run.
 */

/** Width and height from the root <svg> element. */
export function svgSize(svg: string): { width: number; height: number } {
  const head = svg.slice(0, 400);
  const w = /\swidth="([\d.]+)"/.exec(head);
  const hh = /\sheight="([\d.]+)"/.exec(head);
  return { width: w ? Math.round(Number(w[1])) : 1200, height: hh ? Math.round(Number(hh[1])) : 400 };
}

export function svgImage(svg: string, alt: string, className = ''): HTMLImageElement {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const { width, height } = svgSize(svg);
  const img = h('img', { src: url, alt, width, height, class: className, decoding: 'async', draggable: 'false' });
  // Once decoded the image keeps its pixels, so the object URL can go.
  const release = () => URL.revokeObjectURL(url);
  img.addEventListener('load', release, { once: true });
  img.addEventListener('error', release, { once: true });
  return img;
}

/** Point an existing <img> at new SVG markup (restarts its animations). */
export function setSvgSource(img: HTMLImageElement, svg: string): void {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const { width, height } = svgSize(svg);
  img.width = width;
  img.height = height;
  const release = () => URL.revokeObjectURL(url);
  img.addEventListener('load', release, { once: true });
  img.addEventListener('error', release, { once: true });
  img.src = url;
}
