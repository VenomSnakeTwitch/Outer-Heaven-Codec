const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DB_FILE = path.join(__dirname, 'database.json');
const ADMIN_SECRET = "outerheaven2026"; // Geheimes Passwort für Admin-Registrierung

// Datenbank initialisieren oder einlesen
function readDB() {
    if (!fs.existsSync(DB_FILE)) {
        const initialData = { users: [], channels: [], directMessages: [] };
        fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2), 'utf8');
        return initialData;
    }
    try {
        const data = fs.readFileSync(DB_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error("Fehler beim Lesen der database.json:", error);
        return { users: [], channels: [], directMessages: [] };
    }
}

function writeDB(data) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
        console.error("Fehler beim Schreiben der database.json:", error);
    }
}

// API-Endpunkt: Registrierung
app.post('/api/register', (req, res) => {
    const { username, password, adminSecret } = req.body;
    
    if (!username || !password) {
        return res.json({ success: false, message: "Benutzername und Passwort sind erforderlich." });
    }

    const db = readDB();
    const existingUser = db.users.find(u => u.username.toLowerCase() === username.toLowerCase());
    
    if (existingUser) {
        return res.json({ success: false, message: "Dieser Benutzername ist bereits vergeben." });
    }

    let role = "User";
    if (adminSecret && adminSecret === ADMIN_SECRET) {
        role = "Admin";
    }

    const newUser = {
        id: "user_" + Date.now(),
        username: username.trim(),
        password: password,
        role: role,
        avatar: "default_avatar.png",
        bio: "Keine Biografie hinterlegt.",
        audioInputId: "",
        audioOutputId: ""
    };

    db.users.push(newUser);
    writeDB(db);

    res.json({ 
        success: true, 
        message: `Registrierung erfolgreich als ${role}! Du kannst dich jetzt einloggen.` 
    });
});

// API-Endpunkt: Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.json({ success: false, message: "Bitte Benutzername und Passwort eingeben." });
    }

    const db = readDB();
    const user = db.users.find(u => u.username.toLowerCase() === username.toLowerCase() && u.password === password);

    if (!user) {
        return res.json({ success: false, message: "Ungültiger Benutzername oder falsches Passwort." });
    }

    res.json({
        success: true,
        id: user.id,
        username: user.username,
        role: user.role,
        avatar: user.avatar,
        bio: user.bio,
        audioInputId: user.audioInputId,
        audioOutputId: user.audioOutputId
    });
});

// WebSocket-Verbindungsverwaltung
io.on('connection', (socket) => {
    console.log('Ein Client hat sich verbunden:', socket.id);

    socket.on('set_user_info', (userData) => {
        if (userData) {
            socket.username = userData.username;
            socket.role = userData.role;
            console.log(`Socket ${socket.id} registriert als ${userData.username} (${userData.role})`);
        }
    });

    socket.on('disconnect', () => {
        console.log('Client hat die Verbindung getrennt:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Outer Heaven Server läuft auf Port ${PORT}`);
});
