const path = require('node:path');

const iconPath = path.join(__dirname, 'assets', 'fixlinks.ico');

module.exports = {
  packagerConfig: {
    asar: true,
    prune: true,
    executableName: 'FixLinks',
    icon: iconPath,
    ignore: [
      /^[\\/](?:src|test|scripts|dist-test|out)(?:[\\/]|$)/,
      /^[\\/]tsconfig(?:\.[^\\/]*)?$/,
      /^[\\/](?:biome\.json|\.prettier.*|\.editorconfig)$/
    ],
    win32metadata: {
      CompanyName: 'FixLinks contributors',
      FileDescription:
        'FixLinks converts copied social-post links into Discord-friendly embed links.',
      InternalName: 'FixLinks',
      ProductName: 'FixLinks'
    }
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'fixlinks',
        setupExe: 'FixLinksSetup.exe',
        setupIcon: iconPath
      }
    }
  ]
};
