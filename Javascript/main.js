const { app, BrowserWindow, Menu, session } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1366, height: 820, minWidth: 1100, minHeight: 680,
    title: 'ResQCoord', backgroundColor: '#0b1f33',
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  win.loadFile(path.join(__dirname, '..', 'Html', 'admin-dashboard.html'));
    win.loadFile(path.join(__dirname, '..', 'Html', 'user-dashboard.html'));
  win.loadFile(path.join(__dirname, '..', 'Html', 'index.html'));
}

app.whenReady().then(() => {
  // allow GPS (geolocation) requests
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(permission === 'geolocation'));

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'ResQCoord', submenu: [
      { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: createWindow },
      { role: 'reload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'quit' }
    ]}
  ]));
  createWindow();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });