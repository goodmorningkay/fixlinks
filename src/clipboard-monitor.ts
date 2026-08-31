import {
  DEFAULT_LINK_REWRITE_OPTIONS,
  rewriteSocialLink,
  type LinkRewriteOptions
} from './link-transformer.js';

export interface ClipboardTextPort {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
}

export async function processClipboardOnce(
  port: ClipboardTextPort,
  previousText: string | undefined,
  enabled: boolean,
  options: LinkRewriteOptions = DEFAULT_LINK_REWRITE_OPTIONS
): Promise<string | undefined> {
  let currentText: string;
  try {
    currentText = await port.readText();
  } catch {
    return previousText;
  }

  if (!enabled || currentText === previousText) {
    return currentText;
  }

  const rewrittenText = rewriteSocialLink(currentText, options);
  if (rewrittenText === null) {
    return currentText;
  }

  let latestText: string;
  try {
    latestText = await port.readText();
  } catch {
    return previousText;
  }

  if (latestText !== currentText) {
    return currentText;
  }

  try {
    await port.writeText(rewrittenText);
  } catch {
    return previousText;
  }

  return rewrittenText;
}
