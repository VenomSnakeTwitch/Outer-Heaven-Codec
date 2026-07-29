// --- Globale Variablen & Initialisierung ---
const socket = io();
let currentUser = null;
let currentChannel = 'allgemein';
let currentVoiceChannel = null;
let localStream = null;
let peerConnections = {};
let remoteStreams = {};

// Standard-ICE-Server für WebRTC (STUN)
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// --- Authentifizierung ---
let isRegisterMode = false;

function toggleAuthMode() {
    isRegisterMode = !isRegisterMode;
    const title = document.getElementById('auth-title');
    const btn = document.getElementById('auth-submit-btn');
    const switchBtn = document.getElementById('switch-mode-btn');
    const adminSecretInput = document.getElementById('admin-secret-input');

    if (isRegisterMode) {
        title.innerText = 'Outer Heaven - Registrierung';
        btn.innerText = 'Registrieren';
        switchBtn.innerText = 'Bereits ein Konto? Einloggen';
        if (adminSecretInput) adminSecretInput.style.display = 'block';
    } else {
        title.innerText = 'Outer Heaven - Login';
        btn.innerText = 'Einloggen';
        switchBtn.innerText = 'Noch kein Konto? Registrieren';
        if (adminSecretInput) adminSecretInput.style.display = 'none';
    }
}

function handleAuth() {
    const usernameInput = document.getElementById('username').value.trim();
    const passwordInput = document.getElementById('passwort').value;
    const adminSecretInput = document.getElementById('admin-secret-input');
    const adminSecret = adminSecretInput ? adminSecretInput.value.trim() : '';

    if (!usernameInput || !passwordInput) {
        alert('Bitte Benutzername und Passwort eingeben.');
        return;
    }

    const eventName = isRegisterMode ? 'register' : 'login';
    const payload = isRegisterMode 
        ? { username: usernameInput, password: passwordInput, adminSecret }
        : { username: usernameInput, password: passwordInput };

    socket.emit(eventName, payload, (response) => {
        if (response.success) {
            currentUser = response.user;
            document.getElementById('auth-screen').style.display = 'none';
            document.getElementById('user-name-disp').innerText = currentUser.username;
            
            updateUserAvatarDisplay();
            
            if (currentUser.role === 'Admin' || currentUser.role === 'Mod') {
                const adminBtn = document.getElementById('admin-menu-btn');
                if (adminBtn) adminBtn.style.display = 'block';
            }

            socket.emit('get_history', { channel: currentChannel });
            loadChannels();
        } else {
            alert(response.message || 'Authentifizierungsfehler');
        }
    });
}

function logout() {
    currentUser = null;
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    location.reload();
}

function updateUserAvatarDisplay() {
    const disp = document.getElementById('user-avatar-disp');
    if (!disp) return;
    const avatarUrl = (currentUser && currentUser.avatar) ? currentUser.avatar : 'https://via.placeholder.com/40';
    let frameStyle = '';
    if (currentUser && currentUser.frame === 'gold') {
        frameStyle = 'border: 2px solid #f1c40f;';
    } else if (currentUser && currentUser.frame === 'codec') {
        frameStyle = 'border: 2px solid #2ecc71;';
    }
    disp.innerHTML = `<img src="${avatarUrl}" alt="Avatar" style="width: 36px; height: 36px; border-radius: 50%; object-fit: cover; ${frameStyle}">`;
}

// --- Chat & Nachrichten Rendering ---
window.allLoadedMessages = [];

socket.on('history', (messages) => {
    window.allLoadedMessages = messages;
    renderMessagesForCurrentChannel();
});

function renderMessagesForCurrentChannel() {
    const container = document.getElementById('chat-messages');
    if (!container) return;
    container.innerHTML = '';

    const channelMsgs = window.allLoadedMessages.filter(m => (m.channel || 'allgemein') === currentChannel);

    if (channelMsgs.length === 0) {
        container.innerHTML = '<div style="color: #888; text-align: center; margin-top: 20px; font-size: 12px;">Keine Nachrichten in diesem Kanal. Starte die Konversation!</div>';
        return;
    }

    channelMsgs.forEach(m => {
        let contentHtml = '';
        if (m.type === 'image') {
            contentHtml = `<img src="${m.fileData}" style="max-width: 250px; max-height: 250px; border-radius: 6px; margin-top: 5px; display: block; cursor: pointer;" onclick="window.open('${m.fileData}')">`;
        } else if (m.type === 'audio') {
            contentHtml = `<audio controls src="${m.fileData}" style="margin-top: 5px; max-width: 100%; height: 32px;"></audio>`;
        } else if (m.type === 'audiofile') {
            contentHtml = `<div style="margin-top: 5px;"><a href="${m.fileData}" download="${m.fileName || 'audio.mp3'}" style="color: #2ecc71; text-decoration: underline;">🎵 ${m.fileName || 'Audiodatei herunterladen'}</a><audio controls src="${m.fileData}" style="display:block; margin-top:5px; max-width: 100%; height: 28px;"></audio></div>`;
        } else if (m.type === 'video') {
            contentHtml = `<video controls src="${m.fileData}" style="max-width: 300px; max-height: 200px; border-radius: 6px; margin-top: 5px; display: block;"></video>`;
        } else {
            contentHtml = `<div style="color: #dcddde; word-break: break-word; margin-top: 2px;">${escapeHtml(m.message || '')}</div>`;
        }

        const isMarked = m.marked ? 'border-left: 4px solid #f1c40f; background: rgba(241,196,15,0.05);' : '';
        const userAdminOrMod = currentUser && (currentUser.role === 'Admin' || currentUser.role === 'Mod');

        let adminControls = '';
        if (userAdminOrMod) {
            adminControls = `
                <div style="margin-left: auto; display: flex; gap: 5px; opacity: 0.7;">
                    <button onclick="toggleMarkMessage('${m.id}')" style="background: none; border: none; cursor: pointer; font-size: 11px;" title="Wichtig markieren">⭐</button>
                    <button onclick="deleteMessage('${m.id}')" style="background: none; border: none; cursor: pointer; font-size: 11px;" title="Löschen">🗑️</button>
                </div>
            `;
        }

        container.innerHTML += `
            <div style="display: flex; gap: 10px; margin-bottom: 12px; padding: 4px 8px; border-radius: 4px; ${isMarked}">
                <div style="flex: 1;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span onclick="openUserProfile('${m.username}')" style="color: #2ecc71; font-weight: bold; cursor: pointer; font-size: 13px;" title="Profil ansehen">${escapeHtml(m.username)}</span>
                        <span style="font-size: 10px; color: #72767d;">${m.timestamp || ''}</span>
                        ${adminControls}
                    </div>
                    ${contentHtml}
                </div>
            </div>
        `;
    });

    container.scrollTop = container.scrollHeight;
}

function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function deleteMessage(messageId) {
    socket.emit('delete_message', { messageId });
}

function toggleMarkMessage(messageId) {
    socket.emit('toggle_mark_message', { messageId });
}

// --- Online-Benutzer & Sprachkanäle (WebRTC) ---
socket.on('update_online_users', (users) => {
    const list = document.getElementById('online-users-list');
    if (!list) return;
    list.innerHTML = '';

    if (!users || users.length === 0) {
        list.innerHTML = '<div style="color: #888; font-size: 11px;">Keine Benutzer online.</div>';
        return;
    }

    users.forEach(u => {
        const roleColor = u.role === 'Admin' ? '#e67e22' : (u.role === 'Mod' ? '#3498db' : '#2ecc71');
        list.innerHTML += `
            <div onclick="openUserProfile('${u.username}')" style="display: flex; align-items: center; gap: 8px; padding: 4px 0; cursor: pointer; font-size: 12px;" title="Profil anzeigen">
                <div style="width: 8px; height: 8px; background: #2ecc71; border-radius: 50%;"></div>
                <span style="color: #fff; flex: 1;">${escapeHtml(u.username)}</span>
                <span style="font-size: 9px; background: ${roleColor}; color: #fff; padding: 1px 4px; border-radius: 3px;">${u.role}</span>
            </div>
        `;
    });
});

window.joinVoiceChannel = function(channelName) {
    currentVoiceChannel = channelName;
    document.getElementById('chat-messages').style.display = 'none';
    document.getElementById('video-grid').style.display = 'grid';
    document.getElementById('chat-input-area-box').style.display = 'none';
    document.getElementById('current-channel-title').innerText = `🔊 Sprachkanal: ${channelName}`;
    document.getElementById('leave-voice-btn').style.display = 'block';

    const audioConstraint = (currentUser && currentUser.audioInputId)
        ? { deviceId: { exact: currentUser.audioInputId } }
        : true;

    navigator.mediaDevices.getUserMedia({ audio: audioConstraint, video: true })
        .then(stream => {
            localStream = stream;
            addVideoStream('local', stream, currentUser.username, true);
            socket.emit('join_voice', { channel: channelName });
        })
        .catch(err => {
            console.error('Medienzugriff fehlgeschlagen:', err);
            alert('Kamera/Mikrofon konnte nicht geöffnet werden.');
        });
}

window.leaveVoiceChannel = function() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    Object.values(peerConnections).forEach(pc => pc.close());
    peerConnections = {};
    remoteStreams = {};

    document.getElementById('video-grid').innerHTML = '';
    socket.emit('leave_voice');

    switchChannel('text', 'allgemein');
}

function addVideoStream(id, stream, username, isLocal = false) {
    const grid = document.getElementById('video-grid');
    if (!grid) return;

    let container = document.getElementById(`video-container-${id}`);
    if (!container) {
        container = document.createElement('div');
        container.id = `video-container-${id}`;
        container.style.cssText = 'position: relative; background: #202225; border-radius: 8px; overflow: hidden; display: flex; align-items: center; justify-content: center; min-height: 200px;';
        
        const video = document.createElement('video');
        video.id = `video-${id}`;
        video.autoplay = true;
        video.playsInline = true;
        if (isLocal) video.muted = true;
        video.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';
        video.srcObject = stream;

        const label = document.createElement('div');
        label.style.cssText = 'position: absolute; bottom: 8px; left: 8px; background: rgba(0,0,0,0.6); color: #fff; padding: 2px 6px; border-radius: 4px; font-size: 11px;';
        label.innerText = username;

        container.appendChild(video);
        container.appendChild(label);
        grid.appendChild(container);
    } else {
        const video = document.getElementById(`video-${id}`);
        if (video) video.srcObject = stream;
    }
}

// WebRTC Signaling Events
socket.on('voice_peers', async (peers) => {
    for (const peerId of peers) {
        const pc = createPeerConnection(peerId);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('webrtc_offer', { target: peerId, offer });
    }
});

socket.on('webrtc_offer', async (data) => {
    const pc = createPeerConnection(data.sender);
    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('webrtc_answer', { target: data.sender, answer });
});

socket.on('webrtc_answer', async (data) => {
    const pc = peerConnections[data.sender];
    if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
    }
});

socket.on('webrtc_ice', async (data) => {
    const pc = peerConnections[data.sender];
    if (pc && data.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
});

socket.on('peer_left', (data) => {
    if (peerConnections[data.peerId]) {
        peerConnections[data.peerId].close();
        delete peerConnections[data.peerId];
    }
    const container = document.getElementById(`video-container-${data.peerId}`);
    if (container) container.remove();
});

function createPeerConnection(peerId) {
    const pc = new RTCPeerConnection(rtcConfig);
    peerConnections[peerId] = pc;

    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('webrtc_ice', { target: peerId, candidate: event.candidate });
        }
    };

    pc.ontrack = (event) => {
        remoteStreams[peerId] = event.streams[0];
        addVideoStream(peerId, event.streams[0], `Agent (${peerId.substring(0,4)})`);
    };

    return pc;
}

// Mikrofon-Test
window.testMicrophone = function() {
    const statusSpan = document.getElementById('mic-test-status');
    const micSelect = document.getElementById('audio-input-select');
    const deviceId = micSelect ? micSelect.value : undefined;

    const constraints = deviceId ? { audio: { deviceId: { exact: deviceId } } } : { audio: true };

    navigator.mediaDevices.getUserMedia(constraints)
        .then(stream => {
            statusSpan.style.color = '#2ecc71';
            statusSpan.innerText = 'Mikrofon funktioniert! Audio wird erkannt.';
            setTimeout(() => {
                stream.getTracks().forEach(track => track.stop());
                statusSpan.innerText = '';
            }, 3000);
        })
        .catch(err => {
            statusSpan.style.color = '#ed4245';
            statusSpan.innerText = 'Fehler: Mikrofon konnte nicht getestet werden.';
            console.error(err);
        });
}

window.startDirectCall = function(friendName) {
    alert(`Direktanruf zu ${friendName} wird vorbereitet... (Nutze die Sprachkanäle für vollwertige Audio/Video-Calls).`);
}
