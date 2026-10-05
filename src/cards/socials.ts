import { own, readOptions } from '../core/options.ts';
import { esc, fit, n, shell, textWidth } from '../core/svg.ts';
import type { CardDefinition, CardImage, Palette, RenderContext } from '../core/types.ts';
import { drawIcon, type Icon, legible, resolveIcon, slugify } from './icons.ts';

interface Platform {
  label: string;
  icon: string;
  /** Builds the profile URL from a bare handle (already stripped of a leading "@" unless keepAt). */
  url: (handle: string) => string;
  /** Hostnames used to recognise pasted URLs. */
  hosts: string[];
  keepAt?: boolean;
}

const strip = (h: string) => h.replace(/^@+/, '');

const PLATFORMS: Record<string, Platform> = {
  github: { label: 'GitHub', icon: 'github', url: (h) => `https://github.com/${h}`, hosts: ['github.com'] },
  linkedin: {
    label: 'LinkedIn',
    icon: 'linkedin',
    url: (h) => `https://www.linkedin.com/${/^(in|company|school|pub)\//.test(h) ? h : `in/${h}`}`,
    hosts: ['linkedin.com'],
  },
  x: { label: 'X', icon: 'x', url: (h) => `https://x.com/${h}`, hosts: ['x.com', 'twitter.com'] },
  website: { label: 'Website', icon: 'website', url: (h) => `https://${h}`, hosts: [] },
  email: { label: 'Email', icon: 'email', url: (h) => `mailto:${h}`, hosts: [] },
  mastodon: {
    label: 'Mastodon',
    icon: 'mastodon',
    keepAt: true,
    url: (h) => {
      const [user = '', server = ''] = strip(h).split('@');
      const host = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(server) ? server : 'mastodon.social';
      return `https://${host}/@${encodeURIComponent(user)}`;
    },
    hosts: ['mastodon.social'],
  },
  bluesky: { label: 'Bluesky', icon: 'bluesky', url: (h) => `https://bsky.app/profile/${h}`, hosts: ['bsky.app'] },
  youtube: {
    label: 'YouTube',
    icon: 'youtube',
    url: (h) => `https://www.youtube.com/${/^(channel|c|user)\//.test(h) ? h : `@${h}`}`,
    hosts: ['youtube.com', 'youtu.be'],
  },
  devto: { label: 'DEV', icon: 'devdotto', url: (h) => `https://dev.to/${h}`, hosts: ['dev.to'] },
  medium: { label: 'Medium', icon: 'medium', url: (h) => `https://medium.com/@${h}`, hosts: ['medium.com'] },
  stackoverflow: {
    label: 'Stack Overflow',
    icon: 'stackoverflow',
    url: (h) => `https://stackoverflow.com/users/${h}`,
    hosts: ['stackoverflow.com'],
  },
  discord: {
    label: 'Discord',
    icon: 'discord',
    url: (h) => `https://discord.gg/${h}`,
    hosts: ['discord.gg', 'discord.com'],
  },
  instagram: { label: 'Instagram', icon: 'instagram', url: (h) => `https://www.instagram.com/${h}`, hosts: ['instagram.com'] },
  threads: { label: 'Threads', icon: 'threads', url: (h) => `https://www.threads.net/@${h}`, hosts: ['threads.net', 'threads.com'] },
  reddit: { label: 'Reddit', icon: 'reddit', url: (h) => `https://www.reddit.com/user/${h}`, hosts: ['reddit.com'] },
  twitch: { label: 'Twitch', icon: 'twitch', url: (h) => `https://www.twitch.tv/${h}`, hosts: ['twitch.tv'] },
  telegram: { label: 'Telegram', icon: 'telegram', url: (h) => `https://t.me/${h}`, hosts: ['t.me', 'telegram.me'] },
  gitlab: { label: 'GitLab', icon: 'gitlab', url: (h) => `https://gitlab.com/${h}`, hosts: ['gitlab.com'] },
  codeberg: { label: 'Codeberg', icon: 'codeberg', url: (h) => `https://codeberg.org/${h}`, hosts: ['codeberg.org'] },
  hashnode: { label: 'Hashnode', icon: 'hashnode', url: (h) => `https://hashnode.com/@${h}`, hosts: ['hashnode.com', 'hashnode.dev'] },
  substack: { label: 'Substack', icon: 'substack', url: (h) => `https://${h}.substack.com`, hosts: ['substack.com'] },
  kofi: { label: 'Ko-fi', icon: 'kofi', url: (h) => `https://ko-fi.com/${h}`, hosts: ['ko-fi.com'] },
  buymeacoffee: {
    label: 'Buy Me a Coffee',
    icon: 'buymeacoffee',
    url: (h) => `https://www.buymeacoffee.com/${h}`,
    hosts: ['buymeacoffee.com'],
  },
  patreon: { label: 'Patreon', icon: 'patreon', url: (h) => `https://www.patreon.com/${h}`, hosts: ['patreon.com'] },
  sponsors: { label: 'Sponsor', icon: 'githubsponsors', url: (h) => `https://github.com/sponsors/${h}`, hosts: [] },
  leetcode: { label: 'LeetCode', icon: 'leetcode', url: (h) => `https://leetcode.com/u/${h}`, hosts: ['leetcode.com'] },
  kaggle: { label: 'Kaggle', icon: 'kaggle', url: (h) => `https://www.kaggle.com/${h}`, hosts: ['kaggle.com'] },
  huggingface: { label: 'Hugging Face', icon: 'huggingface', url: (h) => `https://huggingface.co/${h}`, hosts: ['huggingface.co'] },
  dribbble: { label: 'Dribbble', icon: 'dribbble', url: (h) => `https://dribbble.com/${h}`, hosts: ['dribbble.com'] },
  behance: { label: 'Behance', icon: 'behance', url: (h) => `https://www.behance.net/${h}`, hosts: ['behance.net'] },
  codepen: { label: 'CodePen', icon: 'codepen', url: (h) => `https://codepen.io/${h}`, hosts: ['codepen.io'] },
  orcid: { label: 'ORCID', icon: 'orcid', url: (h) => `https://orcid.org/${h}`, hosts: ['orcid.org'] },
  scholar: {
    label: 'Google Scholar',
    icon: 'googlescholar',
    url: (h) => `https://scholar.google.com/citations?user=${encodeURIComponent(h)}`,
    hosts: ['scholar.google.com'],
  },
  rss: { label: 'RSS', icon: 'rss', url: (h) => `https://${h}`, hosts: [] },
};

const KEY_ALIASES: Record<string, string> = {
  twitter: 'x', site: 'website', web: 'website', homepage: 'website', blog: 'website', url: 'website',
  mail: 'email', bsky: 'bluesky', devdotto: 'devto', dev: 'devto', so: 'stackoverflow', yt: 'youtube',
  ig: 'instagram', insta: 'instagram', githubsponsors: 'sponsors', bmc: 'buymeacoffee', googlescholar: 'scholar',
  li: 'linkedin', gh: 'github',
};

const ORDER_AUTO_FIRST = ['github'];
const ORDER_AUTO_LAST = ['x', 'website'];

export interface SocialLink {
  key: string;
  label: string;
  url: string;
  icon: Icon;
  handle?: string;
}

const platformKey = (key: string): string => {
  const slug = slugify(key);
  return own(KEY_ALIASES, slug) ?? slug;
};

/** Only http(s) and mailto links are ever emitted; bare domains get https://. */
function safeUrl(value: string): string | null {
  const v = value.trim();
  if (!v || /[\s<>"'`]/.test(v)) return null;
  if (/^https?:\/\/[^/?#]+/i.test(v)) return v;
  if (/^mailto:[^@]+@[^@]+\.[^@]+$/i.test(v)) return v;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(v) ? `https://${v}` : null;
}

/** A plain address: no spaces, slashes, quotes or angle brackets anywhere. */
const EMAIL = /^[^@\s/"'<>`]+@[^@\s/"'<>`]+\.[^@\s/"'<>`]+$/;

function hostOf(url: string): string {
  const m = /^https?:\/\/([^/?#:]+)/i.exec(url);
  return (m?.[1] ?? '').toLowerCase().replace(/^www\./, '');
}

function detect(url: string): string | null {
  const host = hostOf(url);
  if (!host) return null;
  if (host === 'github.com' && /^https?:\/\/[^/]+\/sponsors\//i.test(url)) return 'sponsors';
  for (const [key, p] of Object.entries(PLATFORMS)) {
    if (p.hosts.some((h) => host === h || host.endsWith(`.${h}`))) return key;
  }
  return null;
}

/** A readable handle from a profile URL: the last meaningful path segment. */
function handleFromUrl(url: string): string | undefined {
  const path = url.replace(/^https?:\/\/[^/]+/i, '').split(/[?#]/)[0] ?? '';
  const seg = path.split('/').filter(Boolean).pop();
  return seg ? decodeURIComponentSafe(seg) : undefined;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function buildLink(rawKey: string, rawValue: string): SocialLink | null {
  const key = platformKey(rawKey);
  const value = rawValue.trim();
  if (!value) return null;
  if (key === 'email') {
    const address = value.replace(/^mailto:/i, '');
    if (!EMAIL.test(address)) return null;
    return { key, label: 'Email', url: `mailto:${address}`, icon: resolveIcon('email'), handle: address };
  }
  if (key === 'website' || key === 'rss') {
    const url = safeUrl(value);
    if (!url) return null;
    const host = hostOf(url);
    const p = own(PLATFORMS, key) as Platform;
    return { key, label: key === 'website' ? host || p.label : p.label, url, icon: resolveIcon(p.icon), handle: host || undefined };
  }
  const platform = own(PLATFORMS, key);
  if (!platform) {
    // Unknown key: treat as a custom link labelled with the key.
    return customLink(rawKey, value);
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) || /^[^/\s@]+\.[a-z]{2,}\//i.test(value)) {
    const url = safeUrl(value);
    if (!url) return null;
    return { key, label: platform.label, url, icon: resolveIcon(platform.icon), handle: handleFromUrl(url) };
  }
  const handle = platform.keepAt ? value : strip(value);
  if (!handle || /[\s<>"']/.test(handle)) return null;
  const path = platform.keepAt ? handle : handle.split('/').map(encodeURIComponent).join('/');
  return {
    key,
    label: platform.label,
    url: platform.url(path),
    icon: resolveIcon(platform.icon),
    handle: key === 'x' || key === 'threads' || key === 'youtube' || key === 'medium' ? `@${strip(handle)}` : handle,
  };
}

function customLink(label: string, value: string, iconName?: string): SocialLink | null {
  const bare = value.trim().replace(/^mailto:/i, '');
  const url = safeUrl(EMAIL.test(bare) ? `mailto:${bare}` : value);
  if (!url) return null;
  const detected = url.startsWith('mailto:') ? 'email' : detect(url);
  const icon = iconName ? resolveIcon(iconName) : detected ? resolveIcon(own(PLATFORMS, detected)?.icon ?? detected) : resolveIcon('link');
  const text = label.trim() || (detected ? (own(PLATFORMS, detected)?.label ?? hostOf(url)) : hostOf(url)) || 'Link';
  return { key: slugify(text) || 'link', label: text, url, icon };
}

function fromObject(entry: Record<string, unknown>): SocialLink | null {
  const url = typeof entry.url === 'string' ? entry.url : typeof entry.href === 'string' ? entry.href : '';
  const label = typeof entry.label === 'string' ? entry.label : typeof entry.name === 'string' ? entry.name : '';
  const icon = typeof entry.icon === 'string' ? entry.icon : undefined;
  return url ? customLink(label, url, icon) : null;
}

/** A bare URL or "key:value" string. */
function fromString(entry: string): SocialLink | null {
  const s = entry.trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) {
    const key = detect(s);
    return key ? buildLink(key, s) : buildLink('website', s);
  }
  if (/^mailto:/i.test(s)) return buildLink('email', s);
  const i = s.indexOf(':');
  if (i <= 0) return EMAIL.test(s) ? buildLink('email', s) : null;
  return buildLink(s.slice(0, i), s.slice(i + 1));
}

const disabled = (v: unknown) => v === false || (typeof v === 'string' && /^(none|false|off|hide|-)?$/i.test(v.trim()));

/** Resolve the `links` option plus automatic GitHub / X / website links into an ordered list. */
export function resolveLinks(ctx: RenderContext): SocialLink[] {
  const o = readOptions(ctx.options);
  const raw = o.raw('links');
  const links: SocialLink[] = [];
  const mentioned = new Set<string>();
  const push = (link: SocialLink | null) => {
    if (link) links.push(link);
  };
  const handleEntry = (key: string, value: unknown) => {
    const k = platformKey(key);
    mentioned.add(k);
    if (disabled(value)) return;
    if (k === 'custom') {
      for (const item of Array.isArray(value) ? value : [value]) {
        if (item && typeof item === 'object') push(fromObject(item as Record<string, unknown>));
      }
      return;
    }
    if (typeof value === 'string' || typeof value === 'number') push(buildLink(key, String(value)));
    else if (value && typeof value === 'object' && !Array.isArray(value)) push(fromObject({ label: key, ...(value as object) }));
  };
  const handleItem = (item: unknown) => {
    if (typeof item === 'string') {
      const s = item.trim();
      const i = s.indexOf(':');
      if (i > 0 && !/^(https?|mailto):/i.test(s)) mentioned.add(platformKey(s.slice(0, i)));
      if (i > 0 && disabled(s.slice(i + 1))) return;
      const link = fromString(s);
      if (link) mentioned.add(link.key);
      push(link);
    } else if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      if ('url' in obj || 'href' in obj) push(fromObject(obj));
      else for (const [k, v] of Object.entries(obj)) handleEntry(k, v);
    }
  };
  if (Array.isArray(raw)) raw.forEach(handleItem);
  else if (typeof raw === 'string') raw.split(/[\n,]/).forEach(handleItem);
  else if (raw && typeof raw === 'object') for (const [k, v] of Object.entries(raw as Record<string, unknown>)) handleEntry(k, v);

  if (o.boolean('auto', true)) {
    const d = ctx.data;
    const auto: Record<string, string | null> = {
      github: d.login || null,
      x: d.twitter,
      website: d.websiteUrl,
    };
    const first: SocialLink[] = [];
    for (const key of ORDER_AUTO_FIRST) {
      const v = auto[key];
      if (!mentioned.has(key) && v) {
        const link = buildLink(key, v);
        if (link) first.push(link);
      }
    }
    links.unshift(...first);
    for (const key of ORDER_AUTO_LAST) {
      const v = auto[key];
      if (!mentioned.has(key) && v) push(buildLink(key, v));
    }
  }
  // Drop exact duplicates (same destination).
  const seen = new Set<string>();
  return links.filter((l) => (seen.has(l.url) ? false : (seen.add(l.url), true)));
}

const H = 36;

function pill(link: SocialLink, p: Palette, showHandle: boolean, ctx: RenderContext): { svg: string; alt: string } {
  const label = fit(link.label, 220, 13.5, { weight: 600 });
  const handle = showHandle && link.handle && link.handle !== link.label ? fit(link.handle, 220, 13, {}) : '';
  const textW = textWidth(label, 13.5, { weight: 600 }) + (handle ? 7 + textWidth(handle, 13, {}) : 0);
  const W = Math.ceil(14 + 18 + 9 + textW + 17);
  const color = legible(link.icon.hex || p.accentA, p.panel, p.text);
  const alt = handle ? `${link.label}: ${link.handle}` : link.label;
  const body =
    `<circle cx="23" cy="18" r="17" fill="url(#sg)"/>` +
    `<g class="fade">${drawIcon(link.icon, 14, 9, 18, { color, inks: [p.panel, p.text] })}` +
    `<text x="41" y="22.8" class="sans" font-size="13.5" font-weight="600" fill="${p.text}">${esc(label)}` +
    (handle ? `<tspan dx="7" font-size="13" font-weight="500" fill="${p.muted}">${esc(handle)}</tspan>` : '') +
    '</text></g>';
  const svg = shell({
    width: W,
    height: H,
    palette: p,
    title: alt,
    defs: glow(color, ctx),
    body,
    radius: H / 2,
    animate: ctx.animate,
  });
  return { svg, alt };
}

function iconBadge(link: SocialLink, p: Palette, ctx: RenderContext): { svg: string; alt: string } {
  const color = legible(link.icon.hex || p.accentA, p.panel, p.text);
  const alt = link.handle && link.handle !== link.label ? `${link.label}: ${link.handle}` : link.label;
  const body = `<circle cx="18" cy="18" r="17" fill="url(#sg)"/><g class="fade">${drawIcon(link.icon, 9, 9, 18, { color, inks: [p.panel, p.text] })}</g>`;
  return { svg: shell({ width: H, height: H, palette: p, title: alt, defs: glow(color, ctx), body, radius: H / 2, animate: ctx.animate }), alt };
}

function glow(color: string, ctx: RenderContext): string {
  const o = ctx.mode === 'dark' ? 0.22 : 0.14;
  return `<radialGradient id="sg"><stop offset="0" stop-color="${color}" stop-opacity="${n(o, 2)}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`;
}

export const card: CardDefinition = {
  id: 'socials',
  title: 'Social badges',
  description: 'One small, theme-aware badge per link (GitHub, LinkedIn, X, website, email and more), each linking to its destination.',
  options: [
    {
      key: 'links',
      type: 'object',
      default: 'GitHub, X and website from your profile',
      description:
        'Links as {"linkedin": "handle", "email": "me@x.dev", "custom": [{"label": "Blog", "url": "https://…"}]} or a list like ["linkedin:handle", "https://…"]. Set a key to false to hide it.',
    },
    { key: 'style', type: 'string', default: 'pill', description: '"pill" (icon + label) or "icon" (round icon only).' },
    { key: 'handles', type: 'boolean', default: false, description: 'Show the handle or address after the platform name (pill style).' },
    { key: 'auto', type: 'boolean', default: true, description: 'Add GitHub, X and website links from your profile automatically.' },
  ],
  render(ctx) {
    const p = ctx.palette;
    const o = readOptions(ctx.options);
    const style = o.oneOf('style', ['pill', 'icon'] as const, 'pill');
    const showHandles = o.boolean('handles', false);
    const links = resolveLinks(ctx);
    if (!links.length) {
      const placeholder: SocialLink = { key: 'none', label: 'No links yet', url: '', icon: resolveIcon('link') };
      const { svg } = pill(placeholder, p, false, ctx);
      return [{ name: 'socials', alt: 'No social links configured', svg, layout: 'inline' }];
    }
    const used = new Map<string, number>();
    return links.map((link): CardImage => {
      const base = `social-${link.key}`;
      const count = (used.get(base) ?? 0) + 1;
      used.set(base, count);
      const { svg, alt } = style === 'icon' ? iconBadge(link, p, ctx) : pill(link, p, showHandles, ctx);
      return { name: count > 1 ? `${base}-${count}` : base, alt, svg, link: link.url, layout: 'inline' };
    });
  },
};
