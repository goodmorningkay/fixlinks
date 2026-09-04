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

export type LinkService = 'instagram' | 'twitter' | 'tiktok';

export interface LinkRewriteOptions {
  readonly removeMetadata: boolean;
  readonly services: Readonly<Record<LinkService, boolean>>;
}

export const DEFAULT_LINK_REWRITE_OPTIONS: LinkRewriteOptions = {
  removeMetadata: false,
  services: {
    instagram: true,
    twitter: true,
    tiktok: true
  }
};

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
    targetHost = 'kkinstagram.com';
  } else if (
    X_HOSTS[hostname] === true &&
    options.services.twitter &&
    X_POST_PATH.test(url.pathname)
  ) {
    targetHost = 'fixupx.com';
  } else if (
    TIKTOK_HOSTS[hostname] === true &&
    options.services.tiktok &&
    TIKTOK_POST_PATH.test(url.pathname)
  ) {
    targetHost = 'tnktok.com';
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
