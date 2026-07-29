const express = require('express');
const httpModule = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = httpModule.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 3e9
});

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
    },
    roles: {
        'Admin': { permissions: ['kick', 'ban', 'delete_messages', 'mark_messages', 'create_channel', 'manage_roles'] },
        'Mod': { permissions: ['kick', 'ban', 'delete_messages', 'mark_messages', 'create_channel'] },
        'Agent': { permissions: [] }
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
        if (!db.roles) {
            db.roles = {
                'Admin': { permissions: ['kick', 'ban', 'delete_messages', 'mark_messages', 'create_channel', 'manage_roles'] },
                'Mod': { permissions: ['kick', 'ban', 'delete_messages', 'mark_messages', 'create_channel'] },
                'Agent': { permissions: [] }
            };
        }
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
        chatMessages = chatMessages.map((m, idx) => ({
            id: m.id || `msg_${Date.now()}_${idx}`,
            channel: m.channel || 'allgemein',
            user: m.user || 'Unbekannt',
            text: m.text || '',
            avatar: m.avatar || '/default-avatar.png',
            timestamp: m.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
            marked: !!m.marked
        }));
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

// Hilfsfunktion zum Abrufen aller aktuell verbundenen Online-Nutzer für die rechte Sidebar
function getOnlineUsersList() {
    const usersMap = new Map();
    for (let [id, s] of io.sockets.sockets) {
        if (s.username) {
            usersMap.set(s.username, {
                username: s.username,
                rank: db.profiles[s.username]?.rank || 'Agent',
                avatar: db.profiles[s.username]?.avatar || '/default-avatar.png',
                bio: db.profiles[s.username]?.bio || ''
            });
        }
    }
    return Array.from(usersMap.values());
}

io.on('connection', (socket) => {
    socket.emit('init state', {
        channels: db.channels,
        messages: chatMessages,
        users: getOnlineUsersList()
    });
    socket.emit('load_history', chatMessages);

    // Sende aktualisierte Online-Liste an alle Clients
    io.emit('update_online_users', getOnlineUsersList());

    // --- Socket.io Registrierung ---
    socket.on('register', (data, callback) => {
        const { username, password, adminSecret } = data;

        if (!username || !password) {
            if (typeof callback === 'function') callback({ success: false, message: 'Bitte Benutzername und Passwort eingeben.' });
            return;
        }

        if (db.profiles[username] && db.profiles[username].password) {
            if (typeof callback === 'function') callback({ success: false, message: 'Benutzer existiert bereits.' });
            return;
        }

        let assignedRole = 'Agent';
        if (adminSecret && adminSecret === 'OuterHeaven2026!') {
            assignedRole = 'Admin';
        }

        db.profiles[username] = {
            username: username,
            password: password,
            rank: assignedRole,
            bio: 'Keine Bio angegeben.',
            avatar: '/default-avatar.png',
            audioInputId: '',
            audioOutputId: ''
        };

        saveDatabase();
        if (typeof callback === 'function') {
            callback({ 
                success: true, 
                message: 'Registrierung erfolgreich!', 
                user: { username, role: assignedRole, avatar: '/default-avatar.png', bio: 'Keine Bio angegeben.' } 
            });
        }
    });

    // --- Socket.io Login ---
    socket.on('login', (data, callback) => {
        const { username, password } = data;

        if (!username || !password) {
            if (typeof callback === 'function') callback({ success: false, message: 'Bitte Benutzername und Passwort eingeben.' });
            return;
        }

        const user = db.profiles[username];
        if (!user || user.password !== password) {
            if (typeof callback === 'function') callback({ success: false, message: 'Ungültiger Benutzername oder falsches Passwort.' });
            return;
        }

        socket.username = user.username;
        io.emit('update_online_users', getOnlineUsersList());

        if (typeof callback === 'function') {
            callback({ 
                success: true, 
                user: { 
                    username: user.username, 
                    role: user.rank, 
                    avatar: user.avatar, 
                    bio: user.bio,
                    audioInputId: user.audioInputId || '',
                    audioOutputId: user.audioOutputId || ''
                } 
            });
        }
    });

    socket.on('set_user_info', (data) => {
        if (!data || !data.username) return;
        socket.username = data.username;
        db.profiles[data.username] = {
            ...(db.profiles[data.username] || {}),
            ...data
        };
        saveDatabase();
        io.emit('update_online_users', getOnlineUsersList());
    });

    socket.on('get_channels', (callback) => {
        if (typeof callback === 'function') callback(db.channels);
    });

    // Event für die rechte Nutzerliste / Admin-Abfragen
    socket.on('get_online_users', (callback) => {
        const users = getOnlineUsersList();
        if (typeof callback === 'function') callback(users);
        socket.emit('update_online_users', users);
    });

    socket.on('get_all_profiles', (callback) => {
        if (typeof callback === 'function') {
            callback({ success: true, profiles: db.profiles });
        }
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

        io.emit('init state', { channels: db.channels, messages: chatMessages, users: getOnlineUsersList() });
        if (typeof callback === 'function') callback({ success: true });
    });

    socket.on('get_roles_data', (callback) => {
        if (typeof callback === 'function') {
            callback({ success: true, roles: db.roles });
        }
    });

    socket.on('create_role', (data, callback) => {
        const { roleName, permissions } = data;
        if (!roleName) return;
        db.roles[roleName] = { permissions: permissions || [] };
        saveDatabase();
        if (typeof callback === 'function') callback({ success: true });
    });

    socket.on('assign_role', (data, callback) => {
        const { targetUser, newRole } = data;
        if (db.profiles[targetUser]) {
            db.profiles[targetUser].rank = newRole;
            saveDatabase();
            for (let [id, s] of io.sockets.sockets) {
                if (s.username === targetUser) {
                    s.emit('role_updated', { role: newRole });
                    break;
                }
            }
            io.emit('update_online_users', getOnlineUsersList());
        }
        if (typeof callback === 'function') callback({ success: true });
    });

    socket.on('admin_kick', (data, callback) => {
        const { targetUser } = data;
        for (let [id, s] of io.sockets.sockets) {
            if (s.username === targetUser) {
                s.emit('kicked_notification', { message: 'Du wurdest von einem Admin getrennt.' });
                s.disconnect(true);
                break;
            }
        }
        if (typeof callback === 'function') callback({ success: true, message: `${targetUser} wurde gekickt.` });
    });

    socket.on('admin_ban', (data, callback) => {
        const { targetUser, reason } = data;
        if (!db.bannedUsers) db.bannedUsers = [];
        if (!db.bannedUsers.includes(targetUser)) {
            db.bannedUsers.push(targetUser);
            saveDatabase();
        }
        for (let [id, s] of io.sockets.sockets) {
            if (s.username === targetUser) {
                s.emit('banned_notification', { reason: reason || 'Kein Grund angegeben' });
                s.disconnect(true);
                break;
            }
        }
        if (typeof callback === 'function') callback({ success: true, message: `${targetUser} wurde gebannt.` });
    });

    socket.on('delete_message', (data, callback) => {
        const { messageId } = data;
        const index = chatMessages.findIndex(m => m.id === messageId);
        if (index !== -1) {
            chatMessages.splice(index, 1);
            saveMessages();
            io.emit('message_deleted', { messageId });
            if (typeof callback === 'function') callback({ success: true });
        } else {
            if (typeof callback === 'function') callback({ success: false, message: 'Nachricht nicht gefunden.' });
        }
    });

    socket.on('mark_message', (data, callback) => {
        const { messageId, marked } = data;
        const msg = chatMessages.find(m => m.id === messageId);
        if (msg) {
            msg.marked = marked;
            saveMessages();
            io.emit('message_marked', { messageId, marked });
            if (typeof callback === 'function') callback({ success: true });
        } else {
            if (typeof callback === 'function') callback({ success: false, message: 'Nachricht nicht gefunden.' });
        }
    });

    socket.on('private_message', (data) => {
        const { recipient, text } = data;
        const sender = socket.username;
        if (!sender || !recipient || !text) return;

        const pm = {
            id: `pm_${Date.now()}_${Math.random()}`,
            sender: sender,
            recipient: recipient,
            text: text,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
        };

        for (let [id, s] of io.sockets.sockets) {
            if (s.username === recipient || s.username === sender) {
                s.emit('private_message', pm);
            }
        }
    });

    socket.on('join_voice_channel', (data) => {
        const channelName = data?.channelName;
        if (!channelName) return;

        if (socket.rooms) {
            socket.rooms.forEach(room => {
                if (room !== socket.id && room !== channelName) {
                    socket.leave(room);
                    io.to(room).emit('update_voice_channel_users', {
                        channelName: room,
                        users: getVoiceChannelUsers(room)
                    });
                }
            });
        }

        socket.join(channelName);
        io.to(channelName).emit('update_voice_channel_users', {
            channelName: channelName,
            users: getVoiceChannelUsers(channelName)
        });
    });

    socket.on('leave_voice_channel', () => {
        if (socket.rooms) {
            socket.rooms.forEach(room => {
                if (room !== socket.id) {
                    socket.leave(room);
                    io.to(room).emit('update_voice_channel_users', {
                        channelName: room,
                        users: getVoiceChannelUsers(room)
                    });
                }
            });
        }
    });

    socket.on('voice data', (data) => {
        const channel = data?.channel;
        if (!channel) return;
        socket.to(channel).emit('voice data', {
            senderId: socket.id,
            audioBuffer: data.audioBuffer
        });
    });

    socket.on('start_direct_call', (data) => {
        const { targetUsername, room } = data;
        socket.join(room);

        for (let [id, s] of io.sockets.sockets) {
            if (s.username === targetUsername) {
                s.join(room);
                s.emit('incoming_direct_call', { callerName: socket.username });
                break;
            }
        }
    });

    socket.on('direct_voice_data', (data) => {
        const { targetUser, audioBuffer } = data;
        for (let [id, s] of io.sockets.sockets) {
            if (s.username === targetUser) {
                s.emit('direct_voice_data', { audioBuffer });
                break;
            }
        }
    });

    socket.on('end_direct_call', (data) => {
        const { targetUser } = data;
        if (!socket.username || !targetUser) return;
        const room = [socket.username, targetUser].sort().join('_call_');
        socket.leave(room);

        for (let [id, s] of io.sockets.sockets) {
            if (s.username === targetUser) {
                s.leave(room);
                s.emit('direct_call_ended', { by: socket.username });
                break;
            }
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
        io.emit('update_online_users', getOnlineUsersList());
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

    socket.on('chat message', handleIncomingMessage);
    socket.on('chat_message', handleIncomingMessage);

    function handleIncomingMessage(data) {
        const username = socket.username || data.user || data.username || 'Unbekannt';
        let text = data.text || data.message || '';
        const channel = data.channel || 'allgemein';

        const urlRegex = /(https?:\/\/[^\s]+)/g;
        text = text.replace(urlRegex, (url) => {
            let hostname = '';
            try {
                hostname = new URL(url).hostname;
            } catch (e) {
                hostname = url;
            }
            return `
                <div style="margin-top: 6px; margin-bottom: 6px;">
                    <a href="${url}" target="_blank" style="color: #00b0f4; text-decoration: none; word-break: break-all;">${url}</a>
                    <div style="background: #2f3136; border-left: 4px solid #7289da; padding: 10px; border-radius: 4px; margin-top: 4px; max-width: 400px;">
                        <div style="font-size: 12px; font-weight: bold; color: #ffffff;">Webseiten-Vorschau</div>
                        <div style="font-size: 11px; color: #b9bbbe; margin-top: 2px;">Inhalt für: ${hostname}</div>
                    </div>
                </div>`;
        });

        const chatMsg = {
            id: `msg_${Date.now()}_${Math.random()}`,
            channel: channel,
            user: username,
            text: text,
            avatar: db.profiles[username]?.avatar || '/default-avatar.png',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
            marked: false
        };

        chatMessages.push(chatMsg);
        if (chatMessages.length > 500) chatMessages.shift();
        saveMessages();

        io.emit('chat message', chatMsg);
        io.emit('chat_message', chatMsg);
    }

    socket.on('chat_media', (data) => {
        const { username, type, fileData, fileName: originalFileName, channel: targetChannel } = data;
        if (!fileData) return;
        const channel = targetChannel || 'allgemein';

        try {
            let matches, fileExtension;

            if (type === 'image') {
                matches = fileData.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
                fileExtension = matches ? (matches[1] === 'jpeg' ? 'jpg' : matches[1]) : 'png';
            } else if (type === 'audio' || type === 'audiofile') {
                matches = fileData.match(/^data:audio\/([A-Za-z-+\/]+);base64,(.+)$/);
                fileExtension = matches ? matches[1].replace('x-', '').replace('webm', 'webm') : 'webm';
            } else if (type === 'video') {
                matches = fileData.match(/^data:video\/([A-Za-z-+\/]+);base64,(.+)$/);
                fileExtension = matches ? matches[1] : 'mp4';
            } else {
                return;
            }

            if (!matches || matches.length != 3) return;

            const base64Data = matches[2];
            const fileName = `${type}_${username}_${Date.now()}.${fileExtension}`;
            const filePath = path.join(uploadsDir, fileName);

            fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
            const fileUrl = `/uploads/${fileName}`;

            let messageHTML = '';
            if (type === 'image') {
                messageHTML = `<img src="${fileUrl}" style="max-width: 350px; max-height: 350px; border-radius: 8px; margin-top: 6px; display: block; box-shadow: 0 2px 10px rgba(0,0,0,0.3);">`;
            } else if (type === 'audio' || type === 'audiofile') {
                const displayName = originalFileName || 'Sprachnachricht / Audio';
                messageHTML = `
                    <div style="background: #2f3136; padding: 10px; border-radius: 8px; margin-top: 6px; max-width: 320px; border: 1px solid #202225;">
                        <div style="font-size: 12px; color: #dcddde; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
                            <span>🎵</span> <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${displayName}</span>
                        </div>
                        <audio controls preload="metadata" src="${fileUrl}" style="width: 100%; height: 32px;"></audio>
                    </div>`;
            } else if (type === 'video') {
                messageHTML = `
                    <div style="margin-top: 6px;">
                        <video controls src="${fileUrl}" style="max-width: 350px; max-height: 350px; border-radius: 8px; display: block;"></video>
                    </div>`;
            }

            const chatMsg = {
                id: `msg_${Date.now()}_${Math.random()}`,
                channel: channel,
                user: username,
                text: messageHTML,
                avatar: db.profiles[username]?.avatar || '/default-avatar.png',
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
                marked: false
            };

            chatMessages.push(chatMsg);
            if (chatMessages.length > 500) chatMessages.shift();
            saveMessages();

            io.emit('chat message', chatMsg);
            io.emit('chat_message', chatMsg);
        } catch (err) {
            console.error('Fehler beim Speichern der Mediendatei:', err);
        }
    });

    socket.on('get_user_profile', (username, callback) => {
        const profile = db.profiles[username] || { username, bio: 'Keine Bio angegeben.', rank: 'Agent', audioInputId: '', audioOutputId: '' };
        if (typeof callback === 'function') callback(profile);
    });

    socket.on('get_friends', (username, callback) => {
        if (typeof callback === 'function') callback(db.friends[username] || []);
    });

    socket.on('get_friend_requests', (username, callback) => {
        if (typeof callback === 'function') callback(db.requests[username] || []);
    });

    socket.on('check_friendship_status', (data, callback) => {
        const { username, targetUser } = data;
        const isFriend = db.friends[username]?.includes(targetUser);
        const requestSent = db.requests[targetUser]?.includes(username);
        const requestReceived = db.requests[username]?.includes(targetUser);
        if (typeof callback === 'function') callback({ isFriend, requestSent, requestReceived });
    });

    socket.on('send_friend_request', (data, callback) => {
        const { username, targetName } = data;

        if (!targetName || targetName.trim() === '') {
            return callback({ success: false, message: 'Ungültiger Benutzer.' });
        }
        if (username === targetName) {
            return callback({ success: false, message: 'Du kannst dir selbst keine Anfrage senden.' });
        }
        if (db.friends[username]?.includes(targetName)) {
            return callback({ success: false, message: 'Ihr seid bereits befreundet.' });
        }

        if (!db.requests[targetName]) db.requests[targetName] = [];
        if (db.requests[targetName].includes(username)) {
            return callback({ success: false, message: 'Es wurde bereits eine Anfrage gesendet.' });
        }

        if (db.requests[username]?.includes(targetName)) {
            db.requests[username] = db.requests[username].filter(u => u !== targetName);

            if (!db.friends[username]) db.friends[username] = [];
            if (!db.friends[targetName]) db.friends[targetName] = [];

            if (!db.friends[username].includes(targetName)) db.friends[username].push(targetName);
            if (!db.friends[targetName].includes(username)) db.friends[targetName].push(username);

            saveDatabase();
            return callback({ success: true, message: 'Ihr seid nun befreundet!' });
        }

        db.requests[targetName].push(username);
        saveDatabase();
        if (typeof callback === 'function') callback({ success: true, message: `Freundschaftsanfrage an ${targetName} gesendet!` });
    });

    socket.on('respond_friend_request', (data, callback) => {
        const { username, senderName, accept } = data;

        if (db.requests[username]) {
            db.requests[username] = db.requests[username].filter(u => u !== senderName);
        }

        if (accept) {
            if (!db.friends[username]) db.friends[username] = [];
            if (!db.friends[senderName]) db.friends[senderName] = [];

            if (!db.friends[username].includes(senderName)) db.friends[username].push(senderName);
            if (!db.friends[senderName].includes(username)) db.friends[senderName].push(username);
        }

        saveDatabase();
        if (typeof callback === 'function') callback({ success: true });
    });

    socket.on('remove_friend', (data, callback) => {
        const { username, friendName } = data;

        if (db.friends[username]) {
            db.friends[username] = db.friends[username].filter(f => f !== friendName);
        }
        if (db.friends[friendName]) {
            db.friends[friendName] = db.friends[friendName].filter(f => f !== username);
        }

        saveDatabase();
        if (typeof callback === 'function') callback({ success: true, friends: db.friends[username] || [] });
    });
});

app.get('/api/view-db', (req, res) => {
    if (fs.existsSync(dbFile)) {
        const data = fs.readFileSync(dbFile, 'utf8');
        res.setHeader('Content-Type', 'application/json');
        res.send(data);
    } else {
        res.status(404).json({ success: false, message: 'Keine database.json gefunden.' });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`HTTP Server läuft auf Port ${PORT}`);
});
