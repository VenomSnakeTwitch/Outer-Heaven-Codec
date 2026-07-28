const express = require('express');
const httpModule = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = httpModule.createServer(app);

// Socket.io Puffer auf 3 GB erhöht
const io = new Server(server, {
    maxHttpBufferSize: 3e9
});

// Express Body-Parser Limits auf 3 GB konfiguriert
app.use(express.json({ limit: '3gb' }));
app.use(express.urlencoded({ limit: '3gb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// --- Datenbank-Dateisystem (database.json) ---
const dbFile = path.join(__dirname, 'database.json');

let db = {
    profiles: {},
    friends: {},
    requests: {},
    channels: {
        text: ['allgemein', 'gta-online'],
        voice: ['Lobby']
    }
};

if (fs.existsSync(dbFile)) {
    try {
        const fileData = fs.readFileSync(dbFile, 'utf8');
        db = JSON.parse(fileData);
        if (!db.profiles) db.profiles = {};
        if (!db.friends) db.friends = {};
        if (!db.requests) db.requests = {};
        if (!db.channels) db.channels = { text: ['allgemein', 'gta-online'], voice: ['Lobby'] };
    } catch (err) {
        console.error('Fehler beim Laden der database.json:', err);
    }
}

function saveDatabase() {
    try {
        fs.writeFileSync(dbFile, JSON.stringify(db, null, 2), 'utf8');
    } catch (err) {
        console.error('Fehler beim Speichern der database.json:', err);
    }
}

// --- Separate Nachrichten-Datenbank (messages.json) ---
const messagesFile = path.join(__dirname, 'messages.json');
let chatMessages = [];

if (fs.existsSync(messagesFile)) {
    try {
        const msgData = fs.readFileSync(messagesFile, 'utf8');
        chatMessages = JSON.parse(msgData);
        if (!Array.isArray(chatMessages)) chatMessages = [];
    } catch (err) {
        console.error('Fehler beim Laden der messages.json:', err);
    }
}

function saveMessages() {
    try {
        fs.writeFileSync(messagesFile, JSON.stringify(chatMessages, null, 2), 'utf8');
    } catch (err) {
        console.error('Fehler beim Speichern der messages.json:', err);
    }
}

// Geheimer Admin-Schlüssel für die Registrierung
const ADMIN_SECRET_KEY = "admin123";

// Hilfsfunktion zur Ermittlung aller aktuell online eingeloggten User
function getOnlineUsersList() {
    const onlineUsers = [];
    for (let [id, socket] of io.sockets.sockets) {
        if (socket.username) {
            const profile = db.profiles[socket.username] || {};
            onlineUsers.push({
                username: socket.username,
                role: profile.rank || 'Agent',
                avatar: profile.avatar || '/default-avatar.png'
            });
        }
    }
    return onlineUsers;
}

function broadcastOnlineUsers() {
    io.emit('update_online_users', getOnlineUsersList());
}

// --- HTTP-Registrierungs-Endpunkt ---
app.post('/api/register', (req, res) => {
    const { username, password, adminSecret } = req.body;

    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Bitte Benutzername und Passwort eingeben.' });
    }

    if (db.profiles[username] && db.profiles[username].password) {
        return res.status(400).json({ success: false, message: 'Benutzer existiert bereits.' });
    }

    let assignedRank = 'Agent';
    if (adminSecret && adminSecret === ADMIN_SECRET_KEY) {
        assignedRank = 'Admin';
    }

    db.profiles[username] = {
        username: username,
        password: password,
        rank: assignedRank,
        bio: 'Keine Bio angegeben.',
        avatar: '/default-avatar.png',
        audioInputId: '',
        audioOutputId: ''
    };

    saveDatabase();
    res.json({ success: true, message: `Registrierung als '${assignedRank}' erfolgreich!` });
});

// --- HTTP-Login-Endpunkt ---
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Bitte Benutzername und Passwort eingeben.' });
    }

    const user = db.profiles[username];
    if (!user || user.password !== password) {
        return res.status(400).json({ success: false, message: 'Ungültiger Benutzername oder falsches Passwort.' });
    }

    res.json({ 
        success: true, 
        username: user.username, 
        role: user.rank, 
        avatar: user.avatar, 
        bio: user.bio,
        audioInputId: user.audioInputId || '',
        audioOutputId: user.audioOutputId || ''
    });
});

// Avatar-Upload Endpunkt
app.post('/api/upload-avatar', (req, res) => {
    const { username, imageBase64 } = req.body;
    if (!username || !imageBase64) {
        return res.status(400).json({ success: false, message: 'Fehlende Daten.' });
    }

    try {
        const matches = imageBase64.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
        if (!matches || matches.length != 3) {
            return res.status(400).json({ success: false, message: 'Ungültiges Bildformat.' });
        }

        const imageType = matches[1];
        const base64Data = matches[2];
        const fileName = `${username}_${Date.now()}.${imageType === 'jpeg' ? 'jpg' : imageType}`;
        const filePath = path.join(uploadsDir, fileName);

        fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
        const avatarUrl = `/uploads/${fileName}`;

        if (!db.profiles[username]) db.profiles[username] = {};
        db.profiles[username].avatar = avatarUrl;
        saveDatabase();

        res.json({ success: true, avatarUrl });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Fehler beim Speichern.' });
    }
});

function getVoiceChannelUsers(channelName) {
    const room = io.sockets.adapter.rooms.get(channelName);
    if (!room) return [];
    const users = [];
    for (const socketId of room) {
        const s = io.sockets.sockets.get(socketId);
        if (s && s.username) {
            users.push({
                socketId: s.id,
                username: s.username,
                avatar: db.profiles[s.username]?.avatar || '/default-avatar.png'
            });
        }
    }
    return users;
}

io.on('connection', (socket) => {
    socket.emit('init state', {
        channels: db.channels,
        messages: chatMessages
    });
    socket.emit('load_history', chatMessages);

    socket.on('set_user_info', (data) => {
        if (!data || !data.username) return;
        socket.username = data.username;
        db.profiles[data.username] = {
            ...(db.profiles[data.username] || {}),
            ...data
        };
        saveDatabase();
        broadcastOnlineUsers();
    });

    socket.on('get_online_users', (callback) => {
        if (typeof callback === 'function') callback(getOnlineUsersList());
    });

    socket.on('get_channels', (callback) => {
        if (typeof callback === 'function') callback(db.channels);
    });

    socket.on('create_channel', (data, callback) => {
        const { type, name } = data;
        if (!type || !name) {
            if (typeof callback === 'function') callback({ success: false, message: 'Ungültige Daten.' });
            return;
        }

        if (!db.channels[type]) db.channels[type] = [];
        if (db.channels[type].includes(name)) {
            if (typeof callback === 'function') callback({ success: false, message: 'Kanal existiert bereits.' });
            return;
        }

        db.channels[type].push(name);
        saveDatabase();

        io.emit('init state', { channels: db.channels, messages: chatMessages });
        if (typeof callback === 'function') callback({ success: true });
    });

    // --- Admin-Berechtigungen & Benutzerverwaltung ---
    socket.on('admin_update_user_role', (data, callback) => {
        const { targetUser, newRole } = data;
        const senderProfile = db.profiles[socket.username];
        if (!senderProfile || senderProfile.rank !== 'Admin') {
            if (typeof callback === 'function') callback({ success: false, message: 'Nur Admins können Ränge anpassen.' });
            return;
        }

        if (!db.profiles[targetUser]) {
            if (typeof callback === 'function') callback({ success: false, message: 'Benutzer nicht gefunden.' });
            return;
        }

        db.profiles[targetUser].rank = newRole;
        saveDatabase();
        broadcastOnlineUsers();

        // Benachrichtige den betroffenen Benutzer live
        for (let [id, s] of io.sockets.sockets) {
            if (s.username === targetUser) {
                s.emit('role_updated', { newRole });
                break;
            }
        }

        if (typeof callback === 'function') callback({ success: true, message: `Rang für ${targetUser} auf ${newRole} geändert.` });
    });

    socket.on('admin_kick', (data, callback) => {
        const { targetUser } = data;
        const senderProfile = db.profiles[socket.username];
        if (!senderProfile || (senderProfile.rank !== 'Admin' && senderProfile.rank !== 'Mod')) {
            if (typeof callback === 'function') callback({ success: false, message: 'Keine Berechtigung.' });
            return;
        }

        for (let [id, s] of io.sockets.sockets) {
            if (s.username === targetUser) {
                s.emit('direct_call_ended');
                s.disconnect(true);
                break;
            }
        }
        if (typeof callback === 'function') callback({ success: true, message: `${targetUser} wurde aus dem Kanal gekickt.` });
    });

    socket.on('admin_ban', (data, callback) => {
        const { targetUser } = data;
        const senderProfile = db.profiles[socket.username];
        if (!senderProfile || senderProfile.rank !== 'Admin') {
            if (typeof callback === 'function') callback({ success: false, message: 'Nur Admins können bannen.' });
            return;
        }

        delete db.profiles[targetUser];
        saveDatabase();

        for (let [id, s] of io.sockets.sockets) {
            if (s.username === targetUser) {
                s.disconnect(true);
                break;
            }
        }
        broadcastOnlineUsers();
        if (typeof callback === 'function') callback({ success: true, message: `${targetUser} wurde dauerhaft gebannt.` });
    });

    // --- Nachrichten verwalten (Löschen & Markieren) ---
    socket.on('delete_message', (data) => {
        const { messageId } = data;
        const senderProfile = db.profiles[socket.username];
        if (!senderProfile || (senderProfile.rank !== 'Admin' && senderProfile.rank !== 'Mod')) return;

        chatMessages = chatMessages.filter(m => m.id !== messageId);
        saveMessages();
        io.emit('message_deleted', { messageId });
    });

    socket.on('toggle_mark_message', (data) => {
        const { messageId } = data;
        const senderProfile = db.profiles[socket.username];
        if (!senderProfile || (senderProfile.rank !== 'Admin' && senderProfile.rank !== 'Mod')) return;

        const msg = chatMessages.find(m => m.id === messageId);
        if (msg) {
            msg.marked = !msg.marked;
            saveMessages();
            io.emit('message_marked', { messageId, marked: msg.marked });
        }
    });

    socket.on('disconnect', () => {
        if (socket.rooms) {
            socket.rooms.forEach(room => {
                if (room !== socket.id) {
                    io.to(room).emit('update_voice_channel_users', {
                        channelName: room,
                        users: getVoiceChannelUsers(room)
                    });
                }
            });
        }
        broadcastOnlineUsers();
    });

    socket.on('set_audio_settings', (data, callback) => {
        const { username, audioInputId, audioOutputId } = data;
        if (!username || !db.profiles[username]) {
            if (typeof callback === 'function') callback({ success: false });
            return;
        }

        db.profiles[username].audioInputId = audioInputId || '';
        db.profiles[username].audioOutputId = audioOutputId || '';
        saveDatabase();

        if (typeof callback === 'function') callback({ success: true });
    });

    // Standard-Events weiterleiten
    socket.on('chat message', handleIncomingMessage);
    socket.on('chat_message', handleIncomingMessage);

    function handleIncomingMessage(data) {
        const username = socket.username || data.user || data.username || 'Unbekannt';
        let text = data.text || data.message || '';
        const channel = data.channel || 'allgemein';

        const chatMsg = {
            id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            channel: channel,
            user: username,
            message: text,
            text: text,
            marked: false,
            avatar: db.profiles[username]?.avatar || '/default-avatar.png',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        chatMessages.push(chatMsg);
        if (chatMessages.length > 500) chatMessages.shift();
        saveMessages();

        io.emit('chat message', chatMsg);
        io.emit('chat_message', chatMsg);
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`HTTP Server läuft auf Port ${PORT}`);
});
