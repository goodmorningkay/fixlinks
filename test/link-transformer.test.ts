import assert from 'node:assert/strict';
import test from 'node:test';
import {
  rewriteSocialLink,
  type LinkRewriteOptions,
  type LinkService
} from '../src/link-transformer.js';

type LinkCase = {
  name: string;
  input: string;
  expected: string;
};

type OptionOverrides = {
  removeMetadata?: boolean;
  services?: Partial<Record<LinkService, boolean>>;
};

const allServices: Record<LinkService, boolean> = {
  instagram: true,
  twitter: true,
  tiktok: true
};

function makeOptions(overrides: OptionOverrides = {}): LinkRewriteOptions {
  return {
    removeMetadata: overrides.removeMetadata ?? false,
    services: {
      ...allServices,
      ...overrides.services
    }
  };
}

const instagramCases: LinkCase[] = [
  {
    name: 'Instagram post',
    input: 'https://instagram.com/p/ABC_123',
    expected: 'https://kkinstagram.com/p/ABC_123'
  },
  {
    name: 'Instagram reel',
    input: 'https://www.instagram.com/reel/CODE-456/',
    expected: 'https://kkinstagram.com/reel/CODE-456/'
  },
  {
    name: 'Instagram TV',
    input: 'https://instagram.com/tv/TV789',
    expected: 'https://kkinstagram.com/tv/TV789'
  }
];

const xCases: LinkCase[] = [
  {
    name: 'x.com handle status',
    input: 'https://x.com/example/status/1234567890',
    expected: 'https://fixupx.com/example/status/1234567890'
  },
  {
    name: 'www.x.com photo suffix',
    input: 'https://www.x.com/example/status/1234567890/photo/1/',
    expected: 'https://fixupx.com/example/status/1234567890/photo/1/'
  },
  {
    name: 'mobile.x.com video suffix',
    input: 'https://mobile.x.com/example/status/1234567890/video/2',
    expected: 'https://fixupx.com/example/status/1234567890/video/2'
  },
  {
    name: 'x.com i status',
    input: 'https://x.com/i/status/1234567890',
    expected: 'https://fixupx.com/i/status/1234567890'
  },
  {
    name: 'www.x.com i web status',
    input: 'https://www.x.com/i/web/status/1234567890',
    expected: 'https://fixupx.com/i/web/status/1234567890'
  },
  {
    name: 'mobile.x.com i web status',
    input: 'https://mobile.x.com/i/web/status/1234567890/photo/3',
    expected: 'https://fixupx.com/i/web/status/1234567890/photo/3'
  },
  {
    name: 'twitter.com handle status',
    input: 'https://twitter.com/example/status/1234567890/',
    expected: 'https://fixupx.com/example/status/1234567890/'
  },
  {
    name: 'www.twitter.com photo suffix',
    input: 'https://www.twitter.com/example/status/1234567890/photo/4',
    expected: 'https://fixupx.com/example/status/1234567890/photo/4'
  },
  {
    name: 'mobile.twitter.com video suffix',
    input: 'https://mobile.twitter.com/example/status/1234567890/video/5/',
    expected: 'https://fixupx.com/example/status/1234567890/video/5/'
  }
];

const tiktokCases: LinkCase[] = [
  {
    name: 'TikTok video',
    input: 'https://tiktok.com/@creator/video/1234567890123456789',
    expected: 'https://tnktok.com/@creator/video/1234567890123456789'
  },
  {
    name: 'www TikTok photo',
    input: 'https://www.tiktok.com/@creator/photo/1234567890123456789/',
    expected: 'https://tnktok.com/@creator/photo/1234567890123456789/'
  },
  {
    name: 'mobile TikTok video',
    input: 'https://m.tiktok.com/@creator/video/1234567890123456789/',
    expected: 'https://tnktok.com/@creator/video/1234567890123456789/'
  },
  {
    name: 'mobile TikTok photo',
    input: 'https://m.tiktok.com/@creator/photo/1234567890123456789',
    expected: 'https://tnktok.com/@creator/photo/1234567890123456789'
  }
];

const formattingCases: LinkCase[] = [
  {
    name: 'host case, outer whitespace, query, and fragment',
    input: '\t HTTPS://WWW.INSTAGRAM.COM/reel/CODE_123/?igsh=abc#fragment \n',
    expected: '\t https://kkinstagram.com/reel/CODE_123/?igsh=abc#fragment \n'
  },
  {
    name: 'query and fragment on X',
    input: 'https://x.com/example/status/1234567890?ref_src=test#post',
    expected: 'https://fixupx.com/example/status/1234567890?ref_src=test#post'
  }
];

for (const linkCase of [
  ...instagramCases,
  ...xCases,
  ...tiktokCases,
  ...formattingCases
]) {
  test(`rewrites ${linkCase.name}`, () => {
    assert.equal(rewriteSocialLink(linkCase.input), linkCase.expected);
  });
}

const metadataRemovalCases: LinkCase[] = [
  {
    name: 'Instagram query and fragment',
    input: '\t https://www.instagram.com/reel/CODE_123/?igsh=abc#fragment \n',
    expected: '\t https://kkinstagram.com/reel/CODE_123/ \n'
  },
  {
    name: 'X query and fragment',
    input: 'https://x.com/example/status/1234567890?ref_src=test#post',
    expected: 'https://fixupx.com/example/status/1234567890'
  },
  {
    name: 'TikTok query and fragment',
    input: 'https://www.tiktok.com/@creator/video/1234567890123456789?share=1#post',
    expected: 'https://tnktok.com/@creator/video/1234567890123456789'
  }
];

for (const linkCase of metadataRemovalCases) {
  test(`removes metadata from ${linkCase.name}`, () => {
    assert.equal(
      rewriteSocialLink(
        linkCase.input,
        makeOptions({ removeMetadata: true })
      ),
      linkCase.expected
    );
  });
}

const disabledServiceCases: Array<{
  name: string;
  input: string;
  options: LinkRewriteOptions;
}> = [
  {
    name: 'Instagram',
    input: 'https://instagram.com/p/CODE_123',
    options: makeOptions({ services: { instagram: false } })
  },
  {
    name: 'X/Twitter',
    input: 'https://x.com/example/status/1234567890',
    options: makeOptions({ services: { twitter: false } })
  },
  {
    name: 'TikTok',
    input: 'https://tiktok.com/@creator/video/1234567890123456789',
    options: makeOptions({ services: { tiktok: false } })
  }
];

for (const linkCase of disabledServiceCases) {
  test(`does not rewrite disabled ${linkCase.name}`, () => {
    assert.equal(rewriteSocialLink(linkCase.input, linkCase.options), null);
  });
}

test('can keep Instagram and X/Twitter enabled while disabling TikTok', () => {
  const options = makeOptions({ services: { tiktok: false } });

  assert.equal(
    rewriteSocialLink('https://instagram.com/p/CODE_123', options),
    'https://kkinstagram.com/p/CODE_123'
  );
  assert.equal(
    rewriteSocialLink('https://x.com/example/status/1234567890', options),
    'https://fixupx.com/example/status/1234567890'
  );
  assert.equal(
    rewriteSocialLink(
      'https://tiktok.com/@creator/video/1234567890123456789',
      options
    ),
    null
  );
});

const rejectedInputs = [
  'https://instagram.com/example',
  'https://instagram.com/accounts/login',
  'https://x.com/example',
  'https://x.com/example/status/not-numeric',
  'https://tiktok.com/@creator',
  'https://tiktok.com/t/SHORT',
  'https://vm.tiktok.com/SHORT/',
  'https://vt.tiktok.com/SHORT/',
  'https://t.co/SHORT',
  'https://instagram.com/p/',
  'https://instagram.com/p/CODE/extra',
  'https://instagram.com/p/CODE?caption=hello world',
  'not a URL',
  'https://instagram.com/p/CODE https://x.com/example/status/1',
  'https://instagram.com/p/CODE?next=https://x.com/example/status/1',
  'https://instagram.com/p/%ZZ',
  'http://instagram.com/p/CODE',
  'ftp://instagram.com/p/CODE',
  'https://user:password@instagram.com/p/CODE',
  'https://@instagram.com/p/CODE',
  'https://instagram.com:443/p/CODE',
  'https://instagram.com:8443/p/CODE',
  'https://kkinstagram.com/p/CODE',
  'https://fixupx.com/example/status/1',
  'https://tnktok.com/@creator/video/1',
  'https://instagram.com.example.org/p/CODE',
  'https://notinstagram.com/p/CODE',
  'https://www.tiktok.com/@creator/video/not-numeric',
  'https://www.tiktok.com/@creator/video/1/extra',
  'https://www.twitter.com/i/status/1234567890/other/1'
];

for (const input of rejectedInputs) {
  test(`rejects ${input}`, () => {
    assert.equal(rewriteSocialLink(input), null);
  });
}
