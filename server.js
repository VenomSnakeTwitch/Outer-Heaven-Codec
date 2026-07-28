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
        'Admin': { permissions: ['all'] },
        'Mod': { permissions: ['kick', 'ban', 'delete_messages', 'mark_messages'] },
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
                'Admin': { permissions: ['all'] },
                'Mod': { permissions: ['kick', 'ban', 'delete_messages', 'mark_messages'] },
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

// Privatnachrichten-Datei und Persistenz
const privateMessagesFile = path.join(__dirname, 'privatemessage.json');
let privateMessages = [];

if (fs.existsSync(privateMessagesFile)) {
    try {
        const privData = fs.readFileSync(privateMessagesFile, 'utf8');
        privateMessages = JSON.parse(privData);
        if (!Array.isArray(privateMessages)) privateMessages = [];
    } catch (err) {
        console.error('Fehler beim Laden der privatemessage.json:', err);
    }
}

function savePrivateMessages() {
    try {
        fs.writeFileSync(privateMessagesFile, JSON.stringify(privateMessages, null, 2), 'utf8');
    } catch (err) {
        console.error('Fehler beim Speichern der privatemessage.json:', err);
    }
}

const ADMIN_SECRET_KEY = "admin123";

function hasPermission(username, permissionName) {
    const userProfile = db.profiles[username];
    if (!userProfile) return false;
    const roleName = userProfile.rank || 'Agent';
    const roleData = db.roles[roleName];
    if (!roleData) return false;
    if (roleData.permissions.includes('all')) return true;
    return roleData.permissions.includes(permissionName);
}

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

function broadcastOnlineUsers() {
    const onlineUsers = [];
    for (let [id, s] of io.sockets.sockets) {
        if (s.username) {
            onlineUsers.push({
                username: s.username,
                role: db.profiles[s.username]?.rank || 'Agent'
            });
        }
    }
    io.emit('update_online_users', onlineUsers);
}

io.on('connection', (socket) => {
    socket.emit('init state', {
        channels: db.channels,
        messages: chatMessages
    });
    socket.emit('load_history', chatMessages);
    
    // Privaten Nachrichtenverlauf beim Verbinden an den Client senden
    socket.emit('load_private_history', privateMessages);

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

    socket.on('get_channels', (callback) => {
        if (typeof callback === 'function') callback(db.channels);
    });

    socket.on('create_channel', (data, callback) => {
        const { type, name } = data;
        if (!type || !name) {
            if (typeof callback === 'function') callback({ success: false, message: 'Ungültige Daten.' });
            return;
        }

        if (!hasPermission(socket.username, 'create_channel') && db.profiles[socket.username]?.rank !== 'Admin') {
            if (typeof callback === 'function') callback({ success: false, message: 'Keine Berechtigung zum Erstellen von Kanälen.' });
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

    socket.on('get_roles_data', (callback) => {
        if (!hasPermission(socket.username, 'manage_roles') && db.profiles[socket.username]?.rank !== 'Admin') {
            if (typeof callback === 'function') callback({ success: false });
            return;
        }
        if (typeof callback === 'function') callback({ success: true, roles: db.roles, profiles: db.profiles });
    });

    socket.on('create_role', (data, callback) => {
        if (!hasPermission(socket.username, 'manage_roles') && db.profiles[socket.username]?.rank !== 'Admin') return;
        const { roleName, permissions } = data;
        if (!roleName) return;

        db.roles[roleName] = { permissions: permissions || [] };
        saveDatabase();
        if (typeof callback === 'function') callback({ success: true });
    });

    socket.on('assign_role', (data, callback) => {
        if (!hasPermission(socket.username, 'manage_roles') && db.profiles[socket.username]?.rank !== 'Admin') return;
        const { targetUser, newRole } = data;
        if (!db.profiles[targetUser] || !db.roles[newRole]) return;

        db.profiles[targetUser].rank = newRole;
        saveDatabase();

        for (let [id, s] of io.sockets.sockets) {
            if (s.username === targetUser) {
                s.emit('role_updated', { role: newRole });
                break;
            }
        }
        broadcastOnlineUsers();
        if (typeof callback === 'function') callback({ success: true });
    });

    socket.on('admin_kick', (data, callback) => {
        const { targetUser } = data;
        if (!hasPermission(socket.username, 'kick')) {
            if (typeof callback === 'function') callback({ success: false, message: 'Keine Berechtigung zum Kicken.' });
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
        const { targetUser, reason } = data;
        if (!hasPermission(socket.username, 'ban')) {
            if (typeof callback === 'function') callback({ success: false, message: 'Keine Berechtigung zum Bannen.' });
            return;
        }

        delete db.profiles[targetUser];
        saveDatabase();

        for (let [id, s] of io.sockets.sockets) {
            if (s.username === targetUser) {
                s.emit('banned_notification', { reason: reason || 'Kein Grund angegeben' });
                s.disconnect(true);
                break;
            }
        }
        broadcastOnlineUsers();
        if (typeof callback === 'function') callback({ success: true, message: `${targetUser} wurde gebannt. Grund: ${reason || 'Keiner'}` });
    });

    socket.on('delete_message', (data) => {
        const { messageId } = data;
        if (!hasPermission(socket.username, 'delete_messages')) return;

        chatMessages = chatMessages.filter(m => m.id !== messageId);
        saveMessages();
        io.emit('message_deleted', { messageId });
    });

    socket.on('toggle_mark_message', (data) => {
        const { messageId } = data;
        if (!hasPermission(socket.username, 'mark_messages')) return;

        const msg = chatMessages.find(m => m.id === messageId);
        if (msg) {
            msg.marked = !msg.marked;
            saveMessages();
            io.emit('message_marked', { messageId, marked: msg.marked });
        }
    });

    socket.on('private_message', (data) => {
        const { recipient, text } = data;
        const sender = socket.username;
        if (!sender || !recipient || !text) return;

        const pmObj = {
            id: 'pm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            sender: sender,
            recipient: recipient,
            text: text,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        privateMessages.push(pmObj);
        if (privateMessages.length > 500) privateMessages.shift();
        savePrivateMessages();

        for (let [id, s] of io.sockets.sockets) {
            if (s.username === recipient || s.username === sender) {
                s.emit('private_message', pmObj);
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
                id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                channel: channel,
                user: username,
                message: messageHTML,
                text: messageHTML,
                marked: false,
                avatar: db.profiles[username]?.avatar || '/default-avatar.png',
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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
app.get('/api/view-messages', (req, res) => {
    if (fs.existsSync(messagesFile)) {
        const data = fs.readFileSync(messagesFile, 'utf8');
        res.setHeader('Content-Type', 'application/json');
        res.send(data);
    } else {
        res.status(404).json({ success: false, message: 'Keine messages.json gefunden.' });
    }
});

app.get('/api/view-private-messages', (req, res) => {
    if (fs.existsSync(privateMessagesFile)) {
        const data = fs.readFileSync(privateMessagesFile, 'utf8');
        res.setHeader('Content-Type', 'application/json');
        res.send(data);
    } else {
        res.status(404).json({ success: false, message: 'Keine privatemessage.json gefunden.' });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`HTTP Server läuft auf Port ${PORT}`);
});
```[cite: 2]

---

### 2. `index.html`

```html
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <title>Outer Heaven Codec</title>
    <link rel="stylesheet" href="style.css">
    <style>
        #private-chat-container {
            position: fixed;
            bottom: 20px;
            right: 220px;
            width: 320px;
            height: 400px;
            background: #36393f;
            border: 1px solid #202225;
            border-radius: 8px 8px 0 0;
            display: flex;
            flex-direction: column;
            box-shadow: 0 5px 15px rgba(0,0,0,0.5);
            z-index: 1000;
            overflow: hidden;
        }
        .private-chat-header {
            background: #2f3136;
            padding: 10px;
            font-weight: bold;
            color: #fff;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid #202225;
            cursor: pointer;
        }
        .private-chat-messages {
            flex: 1;
            padding: 10px;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 8px;
            font-size: 13px;
        }
        .private-chat-input-area {
            padding: 10px;
            background: #2f3136;
            display: flex;
            gap: 5px;
            border-top: 1px solid #202225;
        }
        .private-chat-input-area input {
            flex: 1;
            background: #40444b;
            border: none;
            padding: 6px;
            color: #fff;
            border-radius: 4px;
            font-size: 12px;
        }
    </style>
</head>
<body>

    <div id="auth-screen">
        <div class="auth-box">
            <h2 id="auth-title">Outer Heaven - Login</h2>
            <input type="text" id="username" placeholder="Benutzername">
            <input type="password" id="passwort" placeholder="Passwort">
            
            <input type="password" id="admin-secret-input" placeholder="Admin-Schlüssel (optional)" style="display:none;">

            <button id="auth-submit-btn" onclick="handleAuth()">Einloggen</button>
            <button class="switch-btn" id="switch-mode-btn" onclick="toggleAuthMode()">Noch kein Konto? Registrieren</button>
        </div>
    </div>

    <div id="create-channel-modal" class="modal" style="display:none;">
        <div class="modal-content" style="width: 350px;">
            <h3>Kanal erstellen</h3>
            <label>Kanalname:</label>
            <input type="text" id="new-channel-name-input" placeholder="z. B. einsatz-delta">
            <div class="modal-buttons">
                <button class="control-btn" onclick="closeCreateChannelModal()">Abbrechen</button>
                <button class="control-btn" style="background: #5865f2;" onclick="submitCreateChannel()">Erstellen</button>
            </div>
        </div>
    </div>

    <div id="admin-menu-modal" class="modal" style="display:none;">
        <div class="modal-content" style="width: 480px; max-height: 85vh; overflow-y: auto;">
            <h2>Admin Management</h2>
            <div class="settings-section">
                <h3>Rolle erstellen & Berechtigungen zuweisen</h3>
                <label>Rollenname:</label>
                <input type="text" id="new-role-name" placeholder="z. B. Moderator, Supporter">
                
                <label style="margin-top: 10px; display: block; font-weight: bold; color: #b9bbbe;">Berechtigungen wählen:</label>
                <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 5px; background: #202225; padding: 10px; border-radius: 4px;">
                    <label><input type="checkbox" class="role-perm-cb" value="kick"> Nutzer aus Kanälen kicken</label>
                    <label><input type="checkbox" class="role-perm-cb" value="ban"> Nutzer vom Server bannen</label>
                    <label><input type="checkbox" class="role-perm-cb" value="delete_messages"> Nachrichten löschen</label>
                    <label><input type="checkbox" class="role-perm-cb" value="mark_messages"> Nachrichten als wichtig markieren</label>
                    <label><input type="checkbox" class="role-perm-cb" value="create_channel"> Neue Kanäle erstellen</label>
                    <label><input type="checkbox" class="role-perm-cb" value="manage_roles"> Andere Rollen verwalten</label>
                </div>
                <button class="control-btn" style="background: #5865f2; margin-top: 10px; width: 100%;" onclick="createNewRole()">Rolle mit Berechtigungen erstellen</button>
            </div>

            <div class="settings-section" style="margin-top: 15px;">
                <h3>Nutzer Rollen zuweisen</h3>
                <label>Benutzername:</label>
                <input type="text" id="admin-target-user" placeholder="Exakter Benutzername">
                <label>Rolle zuweisen:</label>
                <select id="admin-role-select">
                    <option value="Admin">Admin</option>
                    <option value="Mod">Mod</option>
                    <option value="Agent">Agent</option>
                </select>
                <button class="control-btn" style="background: #2ecc71; margin-top: 8px; width: 100%;" onclick="assignUserRole()">Rolle speichern</button>
            </div>
            <div class="modal-buttons" style="margin-top: 15px;">
                <button class="control-btn" onclick="closeAdminMenu()">Schließen</button>
            </div>
        </div>
    </div>

    <div id="settings-modal" class="modal" style="display:none;">
        <div class="modal-content">
            <h2>Einstellungen</h2>
            <div class="settings-section">
                <h3>Profil</h3>
                <label>Avatar Bild-URL:</label>
                <input type="text" id="setting-avatar" placeholder="https://beispiel.de/bild.png">

                <label>Oder Bild hochladen:</label>
                <input type="file" id="avatar-file-input" accept="image/*">

                <label>Rahmen:</label>
                <select id="setting-frame">
                    <option value="none">Keiner</option>
                    <option value="gold">Gold</option>
                    <option value="codec">Codec Grün</option>
                </select>
            </div>

            <div class="settings-section">
                <h3>Audio Geräte</h3>
                <label>Mikrofon:</label>
                <select id="audio-input-select"></select>
                <label>Ausgabe:</label>
                <select id="audio-output-select"></select>
                <button class="control-btn" onclick="testMicrophone()">Mikrofon testen</button>
                <span id="mic-test-status" style="font-size: 12px; margin-top: 5px;"></span>

                <label style="margin-top: 10px;">
                    <input type="checkbox" id="monitoring-toggle"> Mich selbst hören (Monitoring)
                </label>
            </div>

            <div class="modal-buttons">
                <button class="control-btn" onclick="closeSettings()">Abbrechen</button>
                <button class="control-btn" style="background: #5865f2;" onclick="saveSettings()">Speichern</button>
            </div>
        </div>
    </div>

    <div id="user-profile-modal" class="modal" style="display:none;">
        <div class="modal-content" style="width: 300px; text-align: center;">
            <h3 id="modal-username">User Profil</h3>
            <img id="modal-avatar" src="" alt="Avatar" style="width: 80px; height: 80px; border-radius: 50%; object-fit: cover; margin: 10px auto; border: 2px solid #2ecc71;">
            <p style="color: #b9bbbe;"><strong>Rang:</strong> <span id="modal-rank" style="color: #fff;">Agent</span></p>
            <p style="color: #b9bbbe;"><strong>Bio:</strong> <span id="modal-bio-text" style="color: #fff;">Keine Bio hinterlegt.</span></p>

            <div id="admin-actions-container" style="margin-top: 10px; display: none; flex-direction: column; gap: 5px;">
                <button class="control-btn" style="background: #e67e22; width: 100%; font-size: 11px;" onclick="adminKickUser()">Aus Kanal kicken</button>
                <button class="control-btn" style="background: #ed4245; width: 100%; font-size: 11px;" onclick="adminBanUserPrompt()">Vom Server bannen</button>
            </div>

            <button class="control-btn" style="background: #5865f2; width: 100%; margin-top: 10px;" onclick="openPrivateChatFromProfile()">Privatchat öffnen</button>
            <button id="modal-friend-action-btn" class="control-btn" style="width: 100%; margin-top: 8px; background: #2ecc71;" onclick="handleProfileFriendAction()">Als Freund hinzufügen</button>
            <button class="control-btn" style="background: #ed4245; width: 100%; margin-top: 8px;" onclick="closeProfileModal()">Schließen</button>
        </div>
    </div>

    <div id="private-chat-container" style="display: none;">
        <div class="private-chat-header">
            <span id="private-chat-title">Direktnachricht</span>
            <span onclick="closePrivateChat()" style="cursor: pointer; color: #b9bbbe; font-size: 14px;" title="Schließen">✖</span>
        </div>
        <div id="private-chat-messages" class="private-chat-messages"></div>
        <div class="private-chat-input-area">
            <input type="text" id="private-msg-input" placeholder="Nachricht schreiben..." onkeydown="checkSendPrivate(event)">
            <button onclick="sendPrivateMessage()" style="background: #5865f2; border: none; color: #fff; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;">Senden</button>
        </div>
    </div>

    <div class="sidebar">
        <div class="sidebar-header">OUTER HEAVEN</div>
        <div class="channels-list">
            <div class="section-title">
                Textkanäle
                <button onclick="openCreateChannelModal('text')" style="background:none; border:none; color:#b9bbbe; cursor:pointer; font-size:14px;" title="Textkanal erstellen">+</button>
            </div>
            <div id="text-channels">
                <div class="channel-item active" onclick="switchChannel('text', 'allgemein')"># allgemein</div>
            </div>
            <div class="section-title">
                Sprachkanäle
                <button onclick="openCreateChannelModal('voice')" style="background:none; border:none; color:#b9bbbe; cursor:pointer; font-size:14px;" title="Sprachkanal erstellen">+</button>
            </div>
            <div id="voice-channels">
                <div class="channel-item" onclick="joinVoiceChannel('Lobby')">🔊 Lobby</div>
            </div>

            <button id="admin-menu-btn" class="control-btn" style="background: #e67e22; width: 100%; margin-top: 10px; display: none; font-size: 11px;" onclick="openAdminMenu()">Admin-Menü</button>

            <div class="section-title" style="margin-top: 15px; color: #f1c40f;">Anfragen</div>
            <div id="friend-requests-list" style="padding: 0 5px; max-height: 100px; overflow-y: auto;">
                <div style="color: #888; font-size: 11px;">Keine Anfragen.</div>
            </div>

            <div class="section-title" style="margin-top: 15px;">Freunde</div>
            <div id="friends-list" style="padding: 0 5px; max-height: 120px; overflow-y: auto;">
                <div style="color: #888; font-size: 11px;">Lade Freunde...</div>
            </div>
            <div style="padding: 5px 5px; display: flex; gap: 4px;">
                <input type="text" id="add-friend-input" placeholder="Name..." style="flex: 1; padding: 3px; font-size: 11px; background: #202225; border: 1px solid #444; color: #fff;">
                <button onclick="addFriendInput()" style="padding: 3px 8px; font-size: 11px; cursor: pointer; background: #2ecc71; border: none; color: #fff; border-radius: 3px;">+</button>
            </div>
        </div>

        <div class="user-panel">
            <div class="user-info" onclick="openSettings()" style="cursor: pointer;" title="Einstellungen öffnen">
                <div id="user-avatar-disp" class="avatar-container"></div>
                <div class="username" id="user-name-disp">Lade...</div>
            </div>
            <button class="logout-btn" onclick="logout()">X</button>
        </div>
    </div>

    <div class="main-content">
        <div class="chat-header">
            <span id="current-channel-title"># allgemein</span>
            <button id="leave-voice-btn" class="control-btn active" style="display:none; margin-left: auto;" onclick="leaveVoiceChannel()">Verbindung verlassen</button>
        </div>

        <div id="chat-messages" class="chat-messages"></div>

        <div id="video-grid" style="display: none;"></div>

        <div class="chat-input-area" id="chat-input-area-box" style="display: flex; flex-direction: column; gap: 5px; padding: 10px;">
            <div class="chat-input-wrapper" style="display: flex; gap: 5px; width: 100%;">
                <input type="text" id="msg-input" placeholder="Nachricht an #allgemein senden..." onkeydown="checkSend(event)" style="flex: 1;">

                <label title="Datei senden (Bild, Audio, Video bis 3GB)" style="cursor: pointer; background: #2f3136; padding: 6px 10px; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: #b9bbbe;">
                    📁 <input type="file" id="general-file-input" accept="image/*,audio/*,video/*" style="display: none;" onchange="handleGeneralUpload(this)">
                </label>

                <button id="voice-record-btn" onclick="toggleVoiceRecording()" title="Sprachnachricht aufnehmen" style="cursor: pointer; background: #2f3136; border: 1px solid #444; border-radius: 4px; padding: 6px 10px; color: #b9bbbe;">
                    🎤
                </button>

                <button class="send-btn" onclick="sendMessage()">Senden</button>
            </div>
            <div id="recording-status" style="font-size: 11px; color: #ed4245; display: none;">🔴 Aufnahme läuft... (Klicke erneut auf das Mikrofon zum Beenden)</div>
        </div>
    </div>

    <div style="width: 200px; background: #2f3136; border-left: 1px solid #202225; display: flex; flex-direction: column;">
        <div style="padding: 15px; font-weight: bold; color: #8e9297; font-size: 12px; border-bottom: 2px solid #202225;">ONLINE USERS</div>
        <div id="online-users-list" style="flex: 1; padding: 10px; overflow-y: auto;">
            <div style="color: #888; font-size: 11px;">Lade...</div>
        </div>
    </div>

    <script src="/socket.io/socket.io.js"></script>
    <script src="script.js"></script>
    <script>
        socket.off('chat_message');
        socket.off('chat message');

        function handleIncomingMessageEvent(data) {
            window.allLoadedMessages = window.allLoadedMessages || [];
            if (!window.allLoadedMessages.some(m => m.id === data.id)) {
                window.allLoadedMessages.push(data);
            }

            const targetChannel = data.channel || 'allgemein';
            if (targetChannel === currentChannel) {
                renderMessagesForCurrentChannel();
            }
        }

        socket.on('chat_message', handleIncomingMessageEvent);
        socket.on('chat message', handleIncomingMessageEvent);

        socket.on('message_deleted', (data) => {
            if (window.allLoadedMessages) {
                window.allLoadedMessages = window.allLoadedMessages.filter(m => m.id !== data.messageId);
                renderMessagesForCurrentChannel();
            }
        });

        socket.on('message_marked', (data) => {
            if (window.allLoadedMessages) {
                const msg = window.allLoadedMessages.find(m => m.id === data.messageId);
                if (msg) {
                    msg.marked = data.marked;
                    renderMessagesForCurrentChannel();
                }
            }
        });

        socket.on('banned_notification', (data) => {
            alert(`Du wurdest vom Server gebannt!\nGrund: ${data.reason}`);
            logout();
        });

        let activePrivateChatUser = null;
        let privateMessagesStore = {};

        // Empfängt den gespeicherten privaten Verlauf beim Verbindungsaufbau
        socket.on('load_private_history', (messages) => {
            privateMessagesStore = {};
            messages.forEach(msg => {
                const currentUserName = (typeof currentUser !== 'undefined' && currentUser.username) ? currentUser.username : (document.getElementById('user-name-disp')?.innerText);
                const chatPartner = (msg.sender === currentUserName) ? msg.recipient : msg.sender;

                if (!privateMessagesStore[chatPartner]) {
                    privateMessagesStore[chatPartner] = [];
                }
                if (!privateMessagesStore[chatPartner].some(m => m.id === msg.id)) {
                    privateMessagesStore[chatPartner].push(msg);
                }
            });

            if (activePrivateChatUser) {
                renderPrivateMessages();
            }
        });

        window.openPrivateChat = function(username) {
            const currentUserName = (typeof currentUser !== 'undefined' && currentUser.username) ? currentUser.username : (document.getElementById('user-name-disp')?.innerText);
            if (username === currentUserName) return;

            activePrivateChatUser = username;
            document.getElementById('private-chat-title').innerText = `Direktnachricht: ${username}`;
            document.getElementById('private-chat-container').style.display = 'flex';
            renderPrivateMessages();
        }

        window.closePrivateChat = function() {
            document.getElementById('private-chat-container').style.display = 'none';
            activePrivateChatUser = null;
        }

        window.openPrivateChatFromProfile = function() {
            if (activeProfileUser) {
                closeProfileModal();
                openPrivateChat(activeProfileUser);
            }
        }

        window.sendPrivateMessage = function() {
            const input = document.getElementById('private-msg-input');
            if (!input || !activePrivateChatUser) return;
            const text = input.value.trim();
            if (text === '') return;

            socket.emit('private_message', {
                recipient: activePrivateChatUser,
                text: text
            });

            input.value = '';
        }

        window.checkSendPrivate = function(event) {
            if (event.key === 'Enter') {
                sendPrivateMessage();
            }
        }

        socket.on('private_message', (msg) => {
            const currentUserName = (typeof currentUser !== 'undefined' && currentUser.username) ? currentUser.username : (document.getElementById('user-name-disp')?.innerText);
            const chatPartner = (msg.sender === currentUserName) ? msg.recipient : msg.sender;

            if (!privateMessagesStore[chatPartner]) {
                privateMessagesStore[chatPartner] = [];
            }
            if (!privateMessagesStore[chatPartner].some(m => m.id === msg.id)) {
                privateMessagesStore[chatPartner].push(msg);
            }

            if (activePrivateChatUser === chatPartner) {
                renderPrivateMessages();
            }
        });

        function renderPrivateMessages() {
            const container = document.getElementById('private-chat-messages');
            if (!container || !activePrivateChatUser) return;

            container.innerHTML = '';
            const messages = privateMessagesStore[activePrivateChatUser] || [];

            if (messages.length === 0) {
                container.innerHTML = '<div style="color: #888; text-align: center; font-size: 11px; margin-top: 20px;">Noch keine Nachrichten. Schreibe etwas!</div>';
                return;
            }

            const currentUserName = (typeof currentUser !== 'undefined' && currentUser.username) ? currentUser.username : (document.getElementById('user-name-disp')?.innerText);

            messages.forEach(m => {
                const isMe = m.sender === currentUserName;
                container.innerHTML += `
                    <div style="background: ${isMe ? '#2f3136' : '#40444b'}; padding: 6px 10px; border-radius: 6px; align-self: ${isMe ? 'flex-end' : 'flex-start'}; max-width: 85%;">
                        <div style="font-size: 10px; color: #b9bbbe; margin-bottom: 2px;"><b>${m.sender}</b> - ${m.timestamp}</div>
                        <div style="color: #fff; word-break: break-word;">${m.text}</div>
                    </div>
                `;
            });
            container.scrollTop = container.scrollHeight;
        }

        window.sendMessage = function() {
            const input = document.getElementById('msg-input');
            if (!input) return;
            const text = input.value.trim();

            if (text !== '') {
                const currentUserName = (typeof currentUser !== 'undefined' && currentUser.username) ? currentUser.username : (document.getElementById('user-name-disp')?.innerText || 'Agent');

                socket.emit('chat_message', {
                    channel: currentChannel,
                    username: currentUserName,
                    message: text
                });

                input.value = '';
            }
        };

        window.checkSend = function(event) {
            if (event.key === 'Enter') {
                sendMessage();
            }
        };

        let activeProfileUser = '';

        function openUserProfile(username) {
            activeProfileUser = username;
            const currentUserName = (typeof currentUser !== 'undefined' && currentUser.username) ? currentUser.username : (document.getElementById('user-name-disp')?.innerText);

            socket.emit('get_user_profile', username, (profile) => {
                document.getElementById('modal-username').innerText = profile.username || username;
                document.getElementById('modal-avatar').src = profile.avatar || 'https://via.placeholder.com/80';
                document.getElementById('modal-rank').innerText = profile.rank || 'Agent';
                document.getElementById('modal-bio-text').innerText = profile.bio || 'Keine Bio angegeben.';

                const adminActions = document.getElementById('admin-actions-container');
                const isUserAdmin = currentUser && (currentUser.role === 'Admin' || currentUser.role === 'Mod');
                if (isUserAdmin && username !== currentUserName) {
                    adminActions.style.display = 'flex';
                } else {
                    adminActions.style.display = 'none';
                }

                const actionBtn = document.getElementById('modal-friend-action-btn');
                if (username === currentUserName) {
                    actionBtn.style.display = 'none';
                } else {
                    actionBtn.style.display = 'block';
                    socket.emit('check_friendship_status', { username: currentUserName, targetUser: username }, (status) => {
                        if (status.isFriend) {
                            actionBtn.innerText = 'Bereits befreundet (Entfernen)';
                            actionBtn.style.background = '#ed4245';
                        } else if (status.requestSent) {
                            actionBtn.innerText = 'Anfrage gesendet...';
                            actionBtn.style.background = '#72767d';
                        } else if (status.requestReceived) {
                            actionBtn.innerText = 'Anfrage annehmen';
                            actionBtn.style.background = '#2ecc71';
                        } else {
                            actionBtn.innerText = 'Freundschaftsanfrage senden';
                            actionBtn.style.background = '#2ecc71';
                        }
                    });
                }

                document.getElementById('user-profile-modal').style.display = 'flex';
            });
        }

        function adminKickUser() {
            if (!activeProfileUser) return;
            socket.emit('admin_kick', { targetUser: activeProfileUser, channel: currentChannel }, (res) => {
                alert(res.message);
                closeProfileModal();
            });
        }

        function adminBanUserPrompt() {
            if (!activeProfileUser) return;
            const reason = prompt(`Gib den Banngrund für ${activeProfileUser} an:`, "Regelverstoß");
            if (reason !== null) {
                socket.emit('admin_ban', { targetUser: activeProfileUser, reason: reason }, (res) => {
                    alert(res.message);
                    closeProfileModal();
                });
            }
        }

        function openAdminMenu() {
            document.getElementById('admin-menu-modal').style.display = 'flex';
            socket.emit('get_roles_data', (res) => {
                if (res.success) {
                    const select = document.getElementById('admin-role-select');
                    select.innerHTML = '';
                    Object.keys(res.roles).forEach(role => {
                        select.innerHTML += `<option value="${role}">${role}</option>`;
                    });
                }
            });
        }

        function closeAdminMenu() {
            document.getElementById('admin-menu-modal').style.display = 'none';
        }

        function createNewRole() {
            const roleName = document.getElementById('new-role-name').value.trim();
            if (!roleName) return alert('Bitte Rollennamen eingeben.');

            const checkboxes = document.querySelectorAll('.role-perm-cb:checked');
            const permissions = Array.from(checkboxes).map(cb => cb.value);

            socket.emit('create_role', { roleName, permissions }, () => {
                alert(`Rolle "${roleName}" mit ausgewählten Berechtigungen erstellt!`);
                document.getElementById('new-role-name').value = '';
                checkboxes.forEach(cb => cb.checked = false);
                openAdminMenu();
            });
        }

        function assignUserRole() {
            const targetUser = document.getElementById('admin-target-user').value.trim();
            const newRole = document.getElementById('admin-role-select').value;
            if (!targetUser) return alert('Bitte Zielbenutzer eingeben.');
            socket.emit('assign_role', { targetUser, newRole }, () => {
                alert(`Rolle ${newRole} an ${targetUser} zugewiesen!`);
                document.getElementById('admin-target-user').value = '';
            });
        }

        function closeProfileModal() {
            document.getElementById('user-profile-modal').style.display = 'none';
        }

        function handleProfileFriendAction() {
            const currentUserName = (typeof currentUser !== 'undefined' && currentUser.username) ? currentUser.username : (document.getElementById('user-name-disp')?.innerText);
            if (!currentUserName || !activeProfileUser) return;

            socket.emit('send_friend_request', { username: currentUserName, targetName: activeProfileUser }, (res) => {
                alert(res.message);
                closeProfileModal();
                loadFriendsAndRequests();
            });
        }

        let creatingChannelType = 'text';

        function openCreateChannelModal(type) {
            creatingChannelType = type;
            document.getElementById('new-channel-name-input').value = '';
            document.getElementById('create-channel-modal').style.display = 'flex';
        }

        function closeCreateChannelModal() {
            document.getElementById('create-channel-modal').style.display = 'none';
        }

        function submitCreateChannel() {
            const nameInput = document.getElementById('new-channel-name-input');
            const channelName = nameInput.value.trim().toLowerCase().replace(/\s+/g, '-');
            if (!channelName) return;

            socket.emit('create_channel', { type: creatingChannelType, name: channelName }, (response) => {
                if (response && response.success) {
                    closeCreateChannelModal();
                    loadChannels();
                } else {
                    alert(response?.message || 'Fehler beim Erstellen des Kanals.');
                }
            });
        }

        function loadChannels() {
            socket.emit('get_channels', (channels) => {
                const textContainer = document.getElementById('text-channels');
                const voiceContainer = document.getElementById('voice-channels');
                if (!textContainer || !voiceContainer) return;

                textContainer.innerHTML = '';
                voiceContainer.innerHTML = '';

                (channels.text || ['allgemein']).forEach(ch => {
                    const isActive = (currentChannel === ch);
                    textContainer.innerHTML += `<div class="channel-item ${isActive ? 'active' : ''}" onclick="switchChannel('text', '${ch}')"># ${ch}</div>`;
                });

                (channels.voice || ['Lobby']).forEach(ch => {
                    voiceContainer.innerHTML += `<div class="channel-item" onclick="joinVoiceChannel('${ch}')">🔊 ${ch}</div>`;
                });
            });
        }

        window.switchChannel = function(type, name) {
            if (type === 'text') {
                currentChannel = name;
                document.getElementById('current-channel-title').innerText = `# ${name}`;
                document.getElementById('chat-messages').style.display = 'flex';
                document.getElementById('video-grid').style.display = 'none';
                document.getElementById('chat-input-area-box').style.display = 'flex';
                document.getElementById('leave-voice-btn').style.display = 'none';

                const msgInput = document.getElementById('msg-input');
                if(msgInput) msgInput.placeholder = `Nachricht an #${name} senden...`;

                loadChannels();
                if(typeof renderMessagesForCurrentChannel === 'function') {
                    renderMessagesForCurrentChannel();
                }
            }
        }

        setInterval(loadChannels, 5000);

        function loadFriendsAndRequests() {
            const currentUserName = (typeof currentUser !== 'undefined' && currentUser.username) ? currentUser.username : (document.getElementById('user-name-disp')?.innerText);
            if (!currentUserName || currentUserName === 'Lade...') return;

            socket.emit('get_friends', currentUserName, (friends) => {
                const container = document.getElementById('friends-list');
                if (!container) return;

                container.innerHTML = '';
                if (!friends || friends.length === 0) {
                    container.innerHTML = '<div style="color: #888; font-size: 11px; padding: 2px 0;">Keine Freunde.</div>';
                    return;
                }

                friends.forEach(friend => {
                    container.innerHTML += `
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; font-size: 12px; background: rgba(255,255,255,0.05); padding: 3px 6px; border-radius: 3px;">
                            <span onclick="openUserProfile('${friend}')" style="color: #2ecc71; cursor: pointer; text-decoration: underline;" title="Profil anzeigen">${friend}</span>
                            <div style="display: flex; gap: 4px;">
                                <button onclick="openPrivateChat('${friend}')" style="background: #5865f2; color: white; border: none; border-radius: 3px; cursor: pointer; padding: 1px 5px; font-size: 10px;" title="Privatchat">💬</button>
                                <button onclick="startDirectCall('${friend}')" style="background: #2ecc71; color: white; border: none; border-radius: 3px; cursor: pointer; padding: 1px 5px; font-size: 10px;" title="Anrufen">📞</button>
                                <button onclick="removeFriend('${friend}')" style="background: #ed4245; color: white; border: none; border-radius: 3px; cursor: pointer; padding: 1px 5px; font-size: 10px;" title="Entfernen">X</button>
                            </div>
                        </div>
                    `;
                });
            });

            socket.emit('get_friend_requests', currentUserName, (requests) => {
                const container = document.getElementById('friend-requests-list');
                if (!container) return;
                container.innerHTML = '';
                if (!requests || requests.length === 0) {
                    container.innerHTML = '<div style="color: #888; font-size: 11px; padding: 2px 0;">Keine Anfragen.</div>';
                    return;
                }
                requests.forEach(sender => {
                    container.innerHTML += `
                        <div style="margin-bottom: 4px; font-size: 11px; background: rgba(241,196,15,0.1); padding: 4px; border-radius: 3px; border-left: 3px solid #f1c40f;">
                            <div style="color: #fff; margin-bottom: 2px;"><b>${sender}</b></div>
                            <div style="display: flex; gap: 4px;">
                                <button onclick="respondRequest('${sender}', true)" style="background: #2ecc71; color: white; border: none; border-radius: 2px; cursor: pointer; padding: 2px 6px; font-size: 10px; flex: 1;">Annehmen</button>
                                <button onclick="respondRequest('${sender}', false)" style="background: #ed4245; color: white; border: none; border-radius: 2px; cursor: pointer; padding: 2px 6px; font-size: 10px; flex: 1;">Ablehnen</button>
                            </div>
                        </div>
                    `;
                });
            });
        }

        function respondRequest(senderName, accept) {
            const currentUserName = (typeof currentUser !== 'undefined' && currentUser.username) ? currentUser.username : (document.getElementById('user-name-disp')?.innerText);
            socket.emit('respond_friend_request', { username: currentUserName, senderName, accept }, () => {
                loadFriendsAndRequests();
            });
        }

        function addFriendInput() {
            const input = document.getElementById('add-friend-input');
            const friendName = input.value.trim();
            const currentUserName = (typeof currentUser !== 'undefined' && currentUser.username) ? currentUser.username : (document.getElementById('user-name-disp')?.innerText);

            if (friendName && currentUserName) {
                socket.emit('send_friend_request', { username: currentUserName, targetName: friendName }, (response) => {
                    alert(response.message);
                    if (response.success) {
                        input.value = '';
                        loadFriendsAndRequests();
                    }
                });
            }
        }

        function removeFriend(friendName) {
            const currentUserName = (typeof currentUser !== 'undefined' && currentUser.username) ? currentUser.username : (document.getElementById('user-name-disp')?.innerText);

            if (currentUserName) {
                socket.emit('remove_friend', { username: currentUserName, friendName }, (response) => {
                    if (response.success) {
                        loadFriendsAndRequests();
                    }
                });
            }
        }

        setInterval(loadFriendsAndRequests, 3000);

        function handleGeneralUpload(input) {
            if (input.files && input.files[0]) {
                const file = input.files[0];
                const maxSize = 3 * 1024 * 1024 * 1024;

                if (file.size > maxSize) {
                    alert('Die Datei ist zu groß! Die maximale Dateigröße beträgt 3 GB.');
                    input.value = '';
                    return;
                }

                const reader = new FileReader();

                let mediaType = 'image';
                if (file.type.startsWith('audio/')) {
                    mediaType = 'audiofile';
                } else if (file.type.startsWith('video/')) {
                    mediaType = 'video';
                }

                reader.onload = function(e) {
                    const currentUserName = (typeof currentUser !== 'undefined' && currentUser.username) ? currentUser.username : (document.getElementById('user-name-disp')?.innerText || 'Agent');
                    socket.emit('chat_media', {
                        channel: currentChannel,
                        username: currentUserName,
                        type: mediaType,
                        fileData: e.target.result,
                        fileName: file.name
                    });
                };
                reader.readAsDataURL(file);
                input.value = '';
            }
        }

        let mediaRecorder;
        let audioChunks = [];
        let isRecording = false;

        function toggleVoiceRecording() {
            const statusIndicator = document.getElementById('recording-status');
            const recordBtn = document.getElementById('voice-record-btn');

            if (!isRecording) {
                const audioConstraint = (typeof currentUser !== 'undefined' && currentUser.audioInputId)
                    ? { deviceId: { exact: currentUser.audioInputId } }
                    : true;

                navigator.mediaDevices.getUserMedia({ audio: audioConstraint })
                    .then(stream => {
                        mediaRecorder = new MediaRecorder(stream);
                        audioChunks = [];

                        mediaRecorder.ondataavailable = event => {
                            audioChunks.push(event.data);
                        };

                        mediaRecorder.onstop = () => {
                            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                            const reader = new FileReader();
                            reader.onload = function(e) {
                                const currentUserName = (typeof currentUser !== 'undefined' && currentUser.username) ? currentUser.username : (document.getElementById('user-name-disp')?.innerText || 'Agent');
                                socket.emit('chat_media', {
                                    channel: currentChannel,
                                    username: currentUserName,
                                    type: 'audio',
                                    fileData: e.target.result
                                });
                            };
                            reader.readAsDataURL(audioBlob);

                            stream.getTracks().forEach(track => track.stop());
                        };

                        mediaRecorder.start();
                        isRecording = true;
                        recordBtn.style.background = '#ed4245';
                        if (statusIndicator) statusIndicator.style.display = 'block';
                    })
                    .catch(err => {
                        console.error('Mikrofon konnte nicht geöffnet werden:', err);
                        alert('Mikrofon-Zugriff verweigert oder nicht verfügbar.');
                    });
            } else {
                if (mediaRecorder) {
                    mediaRecorder.stop();
                }
                isRecording = false;
                recordBtn.style.background = '#2f3136';
                if (statusIndicator) statusIndicator.style.display = 'none';
            }
        }

        function applySavedAudioDevice() {
            if (typeof currentUser === 'undefined' || !currentUser.audioInputId) return;

            navigator.mediaDevices.getUserMedia({
                audio: { deviceId: { exact: currentUser.audioInputId } }
            })
            .then(stream => {
                stream.getTracks().forEach(track => track.stop());
            })
            .catch(err => {
                console.warn("Konnte exaktes Audiogerät nicht erzwingen:", err);
            });
        }

        window.openSettings = function() {
            document.getElementById('settings-modal').style.display = 'flex';

            navigator.mediaDevices.enumerateDevices().then(devices => {
                const micSelect = document.getElementById('audio-input-select');
                const outSelect = document.getElementById('audio-output-select');

                micSelect.innerHTML = '';
                outSelect.innerHTML = '';

                devices.forEach(device => {
                    const option = document.createElement('option');
                    option.value = device.deviceId;
                    option.text = device.label || (device.kind === 'audioinput' ? 'Mikrofon' : 'Lautsprecher');

                    if (device.kind === 'audioinput') {
                        micSelect.appendChild(option);
                    } else if (device.kind === 'audiooutput') {
                        outSelect.appendChild(option);
                    }
                });

                if (typeof currentUser !== 'undefined') {
                    if (currentUser.audioInputId) micSelect.value = currentUser.audioInputId;
                    if (currentUser.audioOutputId) outSelect.value = currentUser.audioOutputId;
                }
            });
        };

        const originalSaveSettings = window.saveSettings;
        window.saveSettings = function() {
            const selectedInputId = document.getElementById('audio-input-select')?.value || '';
            const selectedOutputId = document.getElementById('audio-output-select')?.value || '';
            const currentUserName = (typeof currentUser !== 'undefined' && currentUser.username) ? currentUser.username : 'Agent';

            if (typeof currentUser !== 'undefined') {
                currentUser.audioInputId = selectedInputId;
                currentUser.audioOutputId = selectedOutputId;
            }

            applySavedAudioDevice();

            socket.emit('set_audio_settings', {
                username: currentUserName,
                audioInputId: selectedInputId,
                audioOutputId: selectedOutputId
            });

            const fileInput = document.getElementById('avatar-file-input');
            if (fileInput && fileInput.files.length > 0) {
                const file = fileInput.files[0];
                const reader = new FileReader();
                reader.onload = function(event) {
                    const imageBase64 = event.target.result;

                    fetch('/api/upload-avatar', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ username: currentUserName, imageBase64 })
                    })
                    .then(res => res.json())
                    .then(data => {
                        if (data.success) {
                            if (typeof currentUser !== 'undefined') currentUser.avatar = data.avatarUrl;
                            if (originalSaveSettings) originalSaveSettings();
                            else document.getElementById('settings-modal').style.display = 'none';
                        }
                    });
                };
                reader.readAsDataURL(file);
            } else {
                if (originalSaveSettings) originalSaveSettings();
                else document.getElementById('settings-modal').style.display = 'none';
            }
        };
    </script>
</body>
</html>
```[cite: 2, 3]
