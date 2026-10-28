import { isIP } from 'node:net';
import { domainToUnicode } from 'node:url';

const INSTAGRAM_HOSTS: Record<string, true> = {
  'instagram.com': true,
  'www.instagram.com': true
};
const X_HOSTS: Record<string, true> = {
  'x.com': true,
  'www.x.com': true,
  'mobile.x.com': true,
  'twitter.com': true,
  'www.twitter.com': true,
  'mobile.twitter.com': true
};
const TIKTOK_HOSTS: Record<string, true> = {
  'tiktok.com': true,
  'www.tiktok.com': true,
  'm.tiktok.com': true
};

const SOURCE_HOSTNAMES: Record<string, true> = {
  ...INSTAGRAM_HOSTS,
  ...X_HOSTS,
  ...TIKTOK_HOSTS
};

export type LinkService = 'instagram' | 'twitter' | 'tiktok';

export const LINK_SERVICES: readonly LinkService[] = [
  'instagram',
  'twitter',
  'tiktok'
];

export const DEFAULT_TARGET_HOSTS: Readonly<Record<LinkService, string>> = {
  instagram: 'kkinstagram.com',
  twitter: 'fixupx.com',
  tiktok: 'tnktok.com'
};

export interface LinkRewriteOptions {
  readonly removeMetadata: boolean;
  readonly services: Readonly<Record<LinkService, boolean>>;
  readonly targetHosts: Readonly<Record<LinkService, string>>;
}

export const DEFAULT_LINK_REWRITE_OPTIONS: LinkRewriteOptions = {
  removeMetadata: false,
  services: {
    instagram: true,
    twitter: true,
    tiktok: true
  },
  targetHosts: DEFAULT_TARGET_HOSTS
};

const HOSTNAME_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

/**
 * Validates one destination hostname and returns its normalized form.
 * Returns null when the value is not a supported DNS hostname.
 */
export function validateTargetHostname(input: unknown): string | null {
  if (typeof input !== 'string') {
    return null;
  }
  const trimmed = input.trim();
  if (/[^\x00-\x7f]/u.test(trimmed)) {
    return null;
  }
  const candidate = trimmed.toLowerCase();
  if (
    candidate.length === 0 ||
    candidate.length > 253 ||
    candidate.endsWith('.')
  ) {
    return null;
  }
  const labels = candidate.split('.');
  if (labels.length < 2) {
    return null;
  }
  for (const label of labels) {
    if (
      label.length === 0 ||
      label.length > 63 ||
      !HOSTNAME_LABEL_PATTERN.test(label)
    ) {
      return null;
    }
    if (label.startsWith('xn--')) {
      // Some Node versions leave invalid punycode unchanged instead of rejecting it.
      const decodedLabel = domainToUnicode(label);
      if (
        decodedLabel.length === 0 ||
        decodedLabel === label ||
        /\p{Cc}/u.test(decodedLabel)
      ) {
        return null;
      }
    }
  }
  let hostname: string;
  try {
    hostname = new URL(`https://${candidate}`).hostname;
  } catch {
    return null;
  }
  if (
    hostname !== candidate ||
    isIP(hostname) !== 0 ||
    SOURCE_HOSTNAMES[hostname] === true
  ) {
    return null;
  }
  return candidate;
}

/**
 * Validates one complete destination map for a save request.
 * Rejects unknown platform keys and invalid values. Returns null when invalid.
 */
export function validateTargetHosts(
  input: unknown
): Readonly<Record<LinkService, string>> | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return null;
  }
  const record = input as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== LINK_SERVICES.length ||
    !LINK_SERVICES.every((service) => keys.includes(service))
  ) {
    return null;
  }
  const hosts: Record<LinkService, string> = { ...DEFAULT_TARGET_HOSTS };
  for (const service of LINK_SERVICES) {
    const host = validateTargetHostname(record[service]);
    if (host === null) {
      return null;
    }
    hosts[service] = host;
  }
  return hosts;
}

/**
 * Loads saved destination maps tolerantly.
 * Missing and invalid entries fall back to the platform defaults.
 * The returned flag is true when a saved entry was present but invalid.
 */
export function loadTargetHosts(input: unknown): {
  hosts: Readonly<Record<LinkService, string>>;
  invalid: boolean;
} {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { hosts: DEFAULT_TARGET_HOSTS, invalid: input !== undefined };
  }
  const record = input as Record<string, unknown>;
  const hosts: Record<LinkService, string> = { ...DEFAULT_TARGET_HOSTS };
  let hasInvalidEntry = false;
  for (const service of LINK_SERVICES) {
    const value = record[service];
    if (value === undefined) {
      continue;
    }
    const host = validateTargetHostname(value);
    if (host === null) {
      hosts[service] = DEFAULT_TARGET_HOSTS[service];
      hasInvalidEntry = true;
      continue;
    }
    hosts[service] = host;
  }
  return { hosts, invalid: hasInvalidEntry };
}

const INSTAGRAM_POST_PATH = /^\/(?:p|reel|tv)\/[^/]+\/?$/u;
const X_POST_PATH =
  /^\/(?:[^/]+|i\/web)\/status\/[0-9]+(?:\/(?:photo|video)\/[0-9]+)?\/?$/u;
const TIKTOK_POST_PATH = /^\/@[^/]+\/(?:video|photo)\/[0-9]+\/?$/u;

/**
 * Rewrites one supported direct social-post URL to an embed-friendly host.
 * Returns null when the clipboard text is not safe or not supported.
 */
export function rewriteSocialLink(
  input: string,
  options: LinkRewriteOptions = DEFAULT_LINK_REWRITE_OPTIONS
): string | null {
  const trimmed = input.trim();
  const hasOneUrl = (trimmed.match(/https?:\/\//giu) ?? []).length === 1;
  const authorityMatch = /^https:\/\/([^/?#]*)/iu.exec(trimmed);
  const authority = authorityMatch?.[1];
  const hasExplicitPort = authority?.includes(':') ?? false;
  const hasCredentials = authority?.includes('@') ?? false;
  if (
    trimmed.length === 0 ||
    /\s/u.test(trimmed) ||
    trimmed.includes('\\') ||
    /%(?![0-9a-f]{2})/iu.test(trimmed) ||
    !hasOneUrl ||
    hasExplicitPort ||
    hasCredentials
  ) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (
    url.protocol !== 'https:' ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.port.length > 0
  ) {
    return null;
  }

  const hostname = url.hostname;

  let targetHost: string | undefined;
  if (
    INSTAGRAM_HOSTS[hostname] === true &&
    options.services.instagram &&
    INSTAGRAM_POST_PATH.test(url.pathname)
  ) {
    targetHost = options.targetHosts.instagram;
  } else if (
    X_HOSTS[hostname] === true &&
    options.services.twitter &&
    X_POST_PATH.test(url.pathname)
  ) {
    targetHost = options.targetHosts.twitter;
  } else if (
    TIKTOK_HOSTS[hostname] === true &&
    options.services.tiktok &&
    TIKTOK_POST_PATH.test(url.pathname)
  ) {
    targetHost = options.targetHosts.tiktok;
  }

  if (targetHost === undefined) {
    return null;
  }

  url.hostname = targetHost;
  if (options.removeMetadata) {
    url.search = '';
    url.hash = '';
  }

  const leadingWhitespaceLength = input.length - input.trimStart().length;
  const trailingWhitespaceStart = input.trimEnd().length;
  return (
    input.slice(0, leadingWhitespaceLength) +
    url.toString() +
    input.slice(trailingWhitespaceStart)
  );
}
