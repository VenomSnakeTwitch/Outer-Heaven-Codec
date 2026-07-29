const socket = io();
let currentUser = null;
let currentChannel = 'allgemein';
let currentVoiceChannel = null;
let localStream = null;
let peerConnections = {};
let activePrivateChatUser = null;
let privateMessagesStore = {};
let allLoadedMessages = [];
let channelsData = { text: ['allgemein', 'gta-online'], voice: ['Lobby'] };

const rtcConfig = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

// --- Authentifizierung ---
let isRegisterMode = false;
function toggleAuthMode() {
    isRegisterMode = !isRegisterMode;
    document.getElementById('auth-title').innerText = isRegisterMode ? 'Outer Heaven - Registrierung' : 'Outer Heaven - Login';
    document.getElementById('auth-submit-btn').innerText = isRegisterMode ? 'Registrieren' : 'Einloggen';
    document.getElementById('switch-mode-btn').innerText = isRegisterMode ? 'Bereits ein Konto? Einloggen' : 'Noch kein Konto? Registrieren';
    document.getElementById('admin-secret-input').style.display = isRegisterMode ? 'block' : 'none';
}

function handleAuth() {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('passwort').value;
    const adminSecret = document.getElementById('admin-secret-input').value.trim();

    if (!username || !password) return alert('Bitte Benutzername und Passwort eingeben.');

    const endpoint = isRegisterMode ? '/api/register' : '/api/login';
    fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, adminSecret })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            currentUser = {
                username: data.username || username,
                role: data.role || data.rank || 'Agent',
                avatar: data.avatar || '/default-avatar.png',
                bio: data.bio || ''
            };
            document.getElementById('auth-screen').style.display = 'none';
            document.getElementById('user-name-disp').innerText = currentUser.username;
            updateUserAvatarDisplay();

            if (currentUser.role === 'Admin' || currentUser.role === 'Mod') {
                document.getElementById('admin-menu-btn').style.display = 'block';
            }

            socket.emit('set_user_info', currentUser);
            loadFriendsAndRequests();
        } else {
            alert(data.message || 'Fehler');
        }
    });
}

function logout() {
    location.reload();
}

function updateUserAvatarDisplay() {
    const disp = document.getElementById('user-avatar-disp');
    if (!disp) return;
    disp.innerHTML = `<img src="${currentUser.avatar || '/default-avatar.png'}" alt="Avatar" style="width:36px; height:36px; border-radius:50%; object-fit:cover;">`;
}

// --- Initialisierung & Events ---
socket.on('init state', (data) => {
    if (data.channels) {
        channelsData = data.channels;
        renderChannels();
    }
});

socket.on('load_history', (messages) => {
    allLoadedMessages = messages;
    renderMessagesForCurrentChannel();
});

socket.on('chat message', (msg) => {
    if (!allLoadedMessages.some(m => m.id === msg.id)) {
        allLoadedMessages.push(msg);
    }
    renderMessagesForCurrentChannel();
});

socket.on('load_private_history', (messages) => {
    messages.forEach(msg => {
        const partner = msg.sender === currentUser?.username ? msg.recipient : msg.sender;
        if (!privateMessagesStore[partner]) privateMessagesStore[partner] = [];
        if (!privateMessagesStore[partner].some(m => m.id === msg.id)) {
            privateMessagesStore[partner].push(msg);
        }
    });
});

socket.on('private_message', (msg) => {
    const partner = msg.sender === currentUser?.username ? msg.recipient : msg.sender;
    if (!privateMessagesStore[partner]) privateMessagesStore[partner] = [];
    privateMessagesStore[partner].push(msg);
    if (activePrivateChatUser === partner) renderPrivateMessages();
});

socket.on('update_online_users', (users) => {
    const list = document.getElementById('online-users-list');
    if (!list) return;
    list.innerHTML = users.length ? '' : '<div style="color: #888; font-size: 11px;">Keine Benutzer online.</div>';
    users.forEach(u => {
        list.innerHTML += `
            <div onclick="openUserProfile('${u.username}')" style="display: flex; align-items: center; gap: 8px; padding: 4px 0; cursor: pointer; font-size: 12px;">
                <div style="width: 8px; height: 8px; background: #2ecc71; border-radius: 50%;"></div>
                <span style="color: #fff; flex: 1;">${u.username}</span>
                <span style="font-size: 9px; background: #5865f2; color: #fff; padding: 1px 4px; border-radius: 3px;">${u.role}</span>
            </div>`;
    });
});

// --- Channels & Messaging ---
function renderChannels() {
    const textContainer = document.getElementById('text-channels');
    const voiceContainer = document.getElementById('voice-channels');
    if (!textContainer || !voiceContainer) return;

    textContainer.innerHTML = '';
    (channelsData.text || []).forEach(ch => {
        textContainer.innerHTML += `<div class="channel-item ${currentChannel === ch ? 'active' : ''}" onclick="switchChannel('text', '${ch}')"># ${ch}</div>`;
    });

    voiceContainer.innerHTML = '';
    (channelsData.voice || []).forEach(ch => {
        voiceContainer.innerHTML += `<div class="channel-item" onclick="joinVoiceChannel('${ch}')">🔊 ${ch}</div>`;
    });
}

function switchChannel(type, name) {
    if (type === 'text') {
        currentChannel = name;
        document.getElementById('current-channel-title').innerText = `# ${name}`;
        document.getElementById('chat-messages').style.display = 'flex';
        document.getElementById('video-grid').style.display = 'none';
        document.getElementById('chat-input-area-box').style.display = 'flex';
        document.getElementById('leave-voice-btn').style.display = 'none';
        renderChannels();
        renderMessagesForCurrentChannel();
    }
}

function renderMessagesForCurrentChannel() {
    const container = document.getElementById('chat-messages');
    if (!container) return;
    container.innerHTML = '';

    const channelMsgs = allLoadedMessages.filter(m => (m.channel || 'allgemein') === currentChannel);
    if (channelMsgs.length === 0) {
        container.innerHTML = '<div style="color: #888; text-align: center; margin-top: 20px; font-size: 12px;">Keine Nachrichten in diesem Kanal.</div>';
        return;
    }

    channelMsgs.forEach(m => {
        container.innerHTML += `
            <div style="display: flex; flex-direction: column; margin-bottom: 10px;">
                <div style="display: flex; gap: 8px; align-items: center;">
                    <span onclick="openUserProfile('${m.user}')" style="color: #2ecc71; font-weight: bold; cursor: pointer; font-size: 13px;">${m.user}</span>
                    <span style="font-size: 10px; color: #72767d;">${m.timestamp || ''}</span>
                </div>
                <div style="font-size: 14px; color: #dcddde; margin-top: 2px;">${m.message || m.text}</div>
            </div>`;
    });
    container.scrollTop = container.scrollHeight;
}

function sendMessage() {
    const input = document.getElementById('msg-input');
    if (!input || !input.value.trim()) return;
    socket.emit('chat message', { channel: currentChannel, text: input.value.trim() });
    input.value = '';
}

function checkSend(event) {
    if (event.key === 'Enter') sendMessage();
}

// --- Private Chats & Profil ---
function openPrivateChat(username) {
    if (username === currentUser?.username) return;
    activePrivateChatUser = username;
    document.getElementById('private-chat-title').innerText = `Direktnachricht: ${username}`;
    document.getElementById('private-chat-container').style.display = 'flex';
    renderPrivateMessages();
}

function closePrivateChat() {
    document.getElementById('private-chat-container').style.display = 'none';
    activePrivateChatUser = null;
}

function sendPrivateMessage() {
    const input = document.getElementById('private-msg-input');
    if (!input || !input.value.trim() || !activePrivateChatUser) return;
    socket.emit('private_message', { recipient: activePrivateChatUser, text: input.value.trim() });
    input.value = '';
}

function checkSendPrivate(event) {
    if (event.key === 'Enter') sendPrivateMessage();
}

function renderPrivateMessages() {
    const container = document.getElementById('private-chat-messages');
    if (!container || !activePrivateChatUser) return;
    container.innerHTML = '';
    (privateMessagesStore[activePrivateChatUser] || []).forEach(m => {
        const isMe = m.sender === currentUser?.username;
        container.innerHTML += `
            <div style="background: ${isMe ? '#2f3136' : '#40444b'}; padding: 6px 10px; border-radius: 6px; align-self: ${isMe ? 'flex-end' : 'flex-start'}; max-width: 85%;">
                <div style="font-size: 10px; color: #b9bbbe;"><b>${m.sender}</b> - ${m.timestamp}</div>
                <div style="color: #fff;">${m.text}</div>
            </div>`;
    });
    container.scrollTop = container.scrollHeight;
}

function openUserProfile(username) {
    socket.emit('get_user_profile', username, (profile) => {
        document.getElementById('modal-username').innerText = profile.username || username;
        document.getElementById('modal-avatar').src = profile.avatar || '/default-avatar.png';
        document.getElementById('modal-rank').innerText = profile.rank || 'Agent';
        document.getElementById('modal-bio-text').innerText = profile.bio || 'Keine Bio.';
        document.getElementById('user-profile-modal').style.display = 'flex';
    });
}

function closeProfileModal() {
    document.getElementById('user-profile-modal').style.display = 'none';
}

function openPrivateChatFromProfile() {
    const username = document.getElementById('modal-username').innerText;
    closeProfileModal();
    openPrivateChat(username);
}

// --- Sprachkanäle & WebRTC ---
function joinVoiceChannel(channelName) {
    currentVoiceChannel = channelName;
    document.getElementById('chat-messages').style.display = 'none';
    document.getElementById('video-grid').style.display = 'grid';
    document.getElementById('chat-input-area-box').style.display = 'none';
    document.getElementById('current-channel-title').innerText = `🔊 Sprachkanal: ${channelName}`;
    document.getElementById('leave-voice-btn').style.display = 'block';

    navigator.mediaDevices.getUserMedia({ audio: true, video: true })
        .then(stream => {
            localStream = stream;
            addVideoStream('local', stream, currentUser.username, true);
            socket.emit('join_voice_channel', { channelName });
        })
        .catch(() => alert('Medienzugriff fehlgeschlagen.'));
}

function leaveVoiceChannel() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    Object.values(peerConnections).forEach(pc => pc.close());
    peerConnections = {};
    document.getElementById('video-grid').innerHTML = '';
    socket.emit('leave_voice_channel');
    switchChannel('text', 'allgemein');
}

function addVideoStream(id, stream, username, isLocal = false) {
    const grid = document.getElementById('video-grid');
    if (!grid) return;
    let container = document.getElementById(`video-container-${id}`);
    if (!container) {
        container = document.createElement('div');
        container.className = 'video-card';
        container.id = `video-container-${id}`;
        
        const video = document.createElement('video');
        video.autoplay = true;
        video.playsInline = true;
        if (isLocal) video.muted = true;
        video.srcObject = stream;

        const label = document.createElement('div');
        label.className = 'peer-name';
        label.innerText = username;

        container.appendChild(video);
        container.appendChild(label);
        grid.appendChild(container);
    }
}

// --- Freunde & Anfragen ---
function loadFriendsAndRequests() {
    if (!currentUser) return;
    socket.emit('get_friends', currentUser.username, (friends) => {
        const container = document.getElementById('friends-list');
        if (!container) return;
        container.innerHTML = friends.length ? '' : '<div style="color: #888; font-size: 11px;">Keine Freunde.</div>';
        friends.forEach(f => {
            container.innerHTML += `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; font-size: 12px; background: rgba(255,255,255,0.05); padding: 3px 6px; border-radius: 3px;">
                    <span onclick="openUserProfile('${f}')" style="color: #2ecc71; cursor: pointer;">${f}</span>
                    <button onclick="openPrivateChat('${f}')" style="background: #5865f2; color: white; border: none; border-radius: 3px; cursor: pointer; padding: 1px 5px; font-size: 10px;">💬</button>
                </div>`;
        });
    });

    socket.emit('get_friend_requests', currentUser.username, (requests) => {
        const container = document.getElementById('friend-requests-list');
        if (!container) return;
        container.innerHTML = requests.length ? '' : '<div style="color: #888; font-size: 11px;">Keine Anfragen.</div>';
        requests.forEach(sender => {
            container.innerHTML += `
                <div style="margin-bottom: 4px; font-size: 11px; background: rgba(241,196,15,0.1); padding: 4px; border-radius: 3px;">
                    <b>${sender}</b>
                    <button onclick="respondRequest('${sender}', true)" style="background: #2ecc71; color: white; border: none; padding: 2px; font-size: 9px;">Annehmen</button>
                </div>`;
        });
    });
}

function respondRequest(senderName, accept) {
    socket.emit('respond_friend_request', { username: currentUser.username, senderName, accept }, () => loadFriendsAndRequests());
}

function addFriendInput() {
    const input = document.getElementById('add-friend-input');
    if (!input || !input.value.trim()) return;
    socket.emit('send_friend_request', { username: currentUser.username, targetName: input.value.trim() }, (res) => {
        alert(res.message);
        if (res.success) { input.value = ''; loadFriendsAndRequests(); }
    });
}

// --- Uploads & Medien ---
function handleGeneralUpload(input) {
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = function(e) {
        let type = 'image';
        if (file.type.startsWith('audio/')) type = 'audiofile';
        else if (file.type.startsWith('video/')) type = 'video';

        socket.emit('chat_media', {
            channel: currentChannel,
            username: currentUser.username,
            type: type,
            fileData: e.target.result,
            fileName: file.name
        });
    };
    reader.readAsDataURL(file);
    input.value = '';
}

function loadAudioDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        console.warn("MediaDevices API wird von diesem Browser nicht unterstützt.");
        return;
    }

    navigator.mediaDevices.enumerateDevices()
        .then(devices => {
            const micSelect = document.getElementById('audio-input-select');
            const outSelect = document.getElementById('audio-output-select');
            if (!micSelect || !outSelect) return;

            micSelect.innerHTML = '';
            outSelect.innerHTML = '';

            devices.forEach(device => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.text = device.label || (device.kind === 'audioinput' ? `Mikrofon (${device.deviceId.slice(0, 5)}...)` : `Ausgabe (${device.deviceId.slice(0, 5)}...)`);
                
                if (device.kind === 'audioinput') {
                    micSelect.appendChild(option);
                } else if (device.kind === 'audiooutput') {
                    outSelect.appendChild(option);
                }
            });

            if (micSelect.options.length === 0) {
                micSelect.innerHTML = '<option>Kein Mikrofon gefunden</option>';
            }
            if (outSelect.options.length === 0) {
                outSelect.innerHTML = '<option>Kein Ausgabegerät gefunden</option>';
            }
        })
        .catch(err => console.error("Fehler beim Laden der Audiogeräte:", err));
}

// Erweitere deine bestehende openSettings-Funktion so:
function openSettings() { 
    document.getElementById('settings-modal').style.display = 'flex';
    loadAudioDevices(); // Geräte direkt beim Öffnen laden
}

// --- Einstellungen & Admin ---
function openSettings() { document.getElementById('settings-modal').style.display = 'flex'; }
function closeSettings() { document.getElementById('settings-modal').style.display = 'none'; }
function openAdminMenu() { document.getElementById('admin-menu-modal').style.display = 'flex'; }
function closeAdminMenu() { document.getElementById('admin-menu-modal').style.display = 'none'; }
function openCreateChannelModal(type) { document.getElementById('create-channel-modal').style.display = 'flex'; window.creatingType = type; }
function closeCreateChannelModal() { document.getElementById('create-channel-modal').style.display = 'none'; }

function submitCreateChannel() {
    const nameInput = document.getElementById('new-channel-name-input');
    if (!nameInput || !nameInput.value.trim()) return;
    socket.emit('create_channel', { type: window.creatingType || 'text', name: nameInput.value.trim().toLowerCase() }, (res) => {
        if (res.success) closeCreateChannelModal();
        else alert(res.message);
    });
}

function testMicrophone() {
    const status = document.getElementById('mic-test-status');
    navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
            status.style.color = '#2ecc71';
            status.innerText = 'Mikrofon funktioniert!';
            setTimeout(() => { stream.getTracks().forEach(t => t.stop()); status.innerText = ''; }, 3000);
        })
        .catch(() => { status.style.color = '#ed4245;'; status.innerText = 'Fehler beim Zugriff.'; });
}
