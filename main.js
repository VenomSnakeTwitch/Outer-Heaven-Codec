const path = require('path');
const https = require('https');

// Wichtig für lokale HTTPS-Zertifikate, damit Electron nicht wegen Selbstsignierung blockiert
app.commandLine.appendSwitch('ignore-certificate-errors');

// Server im Hintergrund starten
require('./server.js');

function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 1280,
        height: 720,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        },
        autoHideMenuBar: true
    });

    // Funktion, die prüft, ob der HTTPS-Server läuft, bevor die Seite geladen wird
    const checkServer = () => {
        // Ignoriert SSL-Fehler beim internen Prüfen des lokalen Servers
        const agent = new https.Agent({ rejectUnauthorized: false });

        https.get('https://localhost:3000', { agent }, (res) => {
            mainWindow.loadURL('https://localhost:3000');
        }).on('error', (err) => {
            // Wenn der Server noch nicht da ist, nach 200ms nochmal versuchen
            setTimeout(checkServer, 200);
        });
    };

    checkServer();
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
