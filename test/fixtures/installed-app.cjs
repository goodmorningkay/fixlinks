'use strict';

// This bootstrap is included only in the isolated installed-update test builds.
const {
  app,
  autoUpdater,
  BrowserWindow,
  clipboard,
  dialog,
  Menu,
  Tray
} = require('electron');
const { appendFileSync } = require('node:fs');
const { createServer } = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const config = require('./installed-test.json');

app.setPath('userData', config.profile);
let menu;
let controlServer;
let clipboardText = '';
let dialogResponse = 0;
const messages = [];
const history = [];
const log = (event, data = {}) =>
  appendFileSync(
    config.log,
    `${JSON.stringify({ time: new Date().toISOString(), version: app.getVersion(), pid: process.pid, event, ...data })}\n`
  );
process.on('uncaughtException', (error) => {
  log('uncaughtException', { error: error.stack });
  app.exit(1);
});
process.on('unhandledRejection', (error) => {
  log('unhandledRejection', { error: String(error) });
  app.exit(1);
});

// Keep user clipboard contents outside this test. The production monitor still runs.
clipboard.readText = () => clipboardText;
clipboard.writeText = (text) => {
  clipboardText = text;
};
const buildMenu = Menu.buildFromTemplate.bind(Menu);
Menu.buildFromTemplate = (template) => {
  const result = buildMenu(template);
  // Electron also builds application submenus. Capture only the production tray.
  if (!template.some((item) => item.label === 'Fix services...')) {
    return result;
  }
  menu = result;
  const labels = menu.items.map(({ label, enabled, checked }) => ({
    label,
    enabled,
    checked
  }));
  history.push(labels);
  log('menu', { labels });
  // A second app instance must reach the production single-instance lock first.
  if (controlServer && !controlServer.listening) {
    controlServer.listen(config.controlPort, '127.0.0.1');
  }
  return menu;
};
const setFeed = autoUpdater.setFeedURL.bind(autoUpdater);
autoUpdater.setFeedURL = (options) => {
  const expected = `https://update.electronjs.org/goodmorningkay/fixlinks/win32-x64/${app.getVersion()}`;
  if (options.url !== expected) {
    throw new Error(`Unexpected production feed: ${options.url}`);
  }
  log('feed', { productionURL: options.url });
  setFeed({ url: `${config.feed}/feed/${app.getVersion()}` });
};
for (const event of [
  'checking-for-update',
  'update-available',
  'update-not-available',
  'update-downloaded',
  'error'
]) {
  autoUpdater.on(event, (...args) =>
    log(event, { error: event === 'error' ? String(args[0]) : undefined })
  );
}
dialog.showMessageBox = async (...args) => {
  const options = args.at(-1);
  messages.push(options);
  log('dialog', { options });
  return { response: dialogResponse, checkboxChecked: false };
};
const balloon = Tray.prototype.displayBalloon;
Tray.prototype.displayBalloon = function (options) {
  log('balloon', { options });
  return balloon.call(this, options);
};

function status() {
  return {
    version: app.getVersion(),
    pid: process.pid,
    execPath: process.execPath,
    isPackaged: app.isPackaged,
    clipboardText,
    messages,
    history,
    menu: menu?.items.map(({ label, enabled, checked }) => ({
      label,
      enabled,
      checked
    })),
    windows: BrowserWindow.getAllWindows().map((window) => ({
      title: window.getTitle(),
      visible: window.isVisible()
    })),
    login: app.getLoginItemSettings({
      path: path.resolve(
        path.dirname(process.execPath),
        '..',
        path.basename(process.execPath)
      ),
      args: ['--started-at-login']
    })
  };
}

const lifecycle = process.argv.some((arg) =>
  /^--squirrel-(install|updated|uninstall|obsolete)$/.test(arg)
);
if (!lifecycle) {
  controlServer = createServer(async (req, res) => {
    try {
      if (req.headers['x-test-token'] !== config.token) {
        res.writeHead(403).end();
        return;
      }
      let body = '';
      for await (const chunk of req) {
        body += chunk;
      }
      const input = body ? JSON.parse(body) : {};
      if (req.url === '/click') {
        const item = menu?.items.find((item) => item.label === input.label);
        if (!item?.enabled) {
          throw new Error(`Menu command is unavailable: ${input.label}`);
        }
        item.click(item);
      } else if (req.url === '/clipboard') {
        clipboardText = input.text;
      } else if (req.url === '/dialog') {
        dialogResponse = input.response;
      } else if (req.url === '/save-settings') {
        const window = BrowserWindow.getAllWindows()[0];
        if (!window) {
          throw new Error('The settings window is not open.');
        }
        const result = await window.webContents.executeJavaScript(
          `window.fixSettings.saveHosts(${JSON.stringify(input.hosts)})`
        );
        if (!result.ok) {
          throw new Error(JSON.stringify(result));
        }
        window.close();
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(status()));
    } catch (error) {
      res.writeHead(500).end(JSON.stringify({ error: String(error) }));
    }
  });
  app.on('before-quit', () => {
    log('before-quit');
    controlServer.close();
  });
  log('launch', { args: process.argv, execPath: process.execPath });
}
void import(pathToFileURL(path.join(__dirname, 'dist', 'main.js')).href);
