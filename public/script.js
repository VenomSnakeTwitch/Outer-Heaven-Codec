const socket = io();
let currentUser = null;
let currentChannel = 'allgemein';
let currentVoiceChannel = null;
let activeCallTarget = null;
let isRegistering = false;

let localStream = null;
let audioContext = null;
let processorNode = null;
let sourceNode = null;
let monitoringAudio = null;

window.addEventListener('DOMContentLoaded', () => {
    const savedUser = localStorage.getItem('outer_heaven_user');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        initApp();
    }
    loadAudioDevices();
});

function toggleAuthMode() {
    isRegistering = !isRegistering;
    document.getElementById('auth-title').innerText = isRegistering ? 'Outer Heaven - Registrieren' : 'Outer Heaven - Login';
    document.getElementById('auth-submit-btn').innerText = isRegistering ? 'Registrieren' : 'Einloggen';
    document.getElementById('switch-mode-btn').innerText = isRegistering ? 'Bereits ein Konto? Einloggen' : 'Noch kein Konto? Registrieren';
}

async function handleAuth() {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('passwort').value.trim();
    if(!username || !password) return alert('Bitte alle Felder ausfüllen!');

    const endpoint = isRegistering ? '/api/register' : '/api/login';
    const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    const data = await res.json();

    if(data.success) {
        if(isRegistering) {
            alert('Registrierung erfolgreich! Bitte nun einloggen.');
            toggleAuthMode();
        } else {
            currentUser = { 
                username: data.username, 
                role: data.role, 
                avatar: data.avatar || '', 
                frame: data.frame || 'none' 
            };
            localStorage.setItem('outer_heaven_user', JSON.stringify(currentUser));
            initApp();
        }
    } else {
        alert(data.message || 'Fehler aufgetreten');
    }
}

function logout() {
    localStorage.removeItem('outer_heaven_user');
    location.reload();
}

function initApp() {
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('user-name-disp').innerText = currentUser.username;
    updateUserAvatarUI();
    socket.emit('join chat', currentUser);
    socket.emit('set_user_info', { username: currentUser.username });
}

function updateUserAvatarUI() {
    const avatarContainer = document.getElementById('user-avatar-disp');
    avatarContainer.className = `avatar-container ${currentUser.frame || 'none'}`;
    if (currentUser.avatar) {
        avatarContainer.innerHTML = `<img src="${currentUser.avatar}" alt="Avatar">`;
    } else {
        avatarContainer.innerText = currentUser.username.charAt(0).toUpperCase();
    }
}

function openSettings() {
    if(!currentUser) return;
    document.getElementById('setting-avatar').value = currentUser.avatar || '';
    document.getElementById('setting-frame').value = currentUser.frame || 'none';
    document.getElementById('settings-modal').style.display = 'flex';
    loadAudioDevices();
}

function closeSettings() {
    document.getElementById('settings-modal').style.display = 'none';
}

function saveSettings() {
    currentUser.avatar = document.getElementById('setting-avatar').value.trim();
    currentUser.frame = document.getElementById('setting-frame').value;
    localStorage.setItem('outer_heaven_user', JSON.stringify(currentUser));
    updateUserAvatarUI();
    closeSettings();
    alert('Einstellungen erfolgreich gespeichert!');
}

async function loadAudioDevices() {
    try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        const devices = await navigator.mediaDevices.enumerateDevices();
        const micSelect = document.getElementById('audio-input-select');
        const outputSelect = document.getElementById('audio-output-select');

        if(micSelect) micSelect.innerHTML = '';
        if(outputSelect) outputSelect.innerHTML = '';

        devices.forEach(device => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.text = device.label || `${device.kind} - ${device.deviceId.substring(0,5)}`;
            if (device.kind === 'audioinput' && micSelect) {
                micSelect.appendChild(option);
            } else if (device.kind === 'audiooutput' && outputSelect) {
                outputSelect.appendChild(option);
            }
        });
    } catch(e) {
        console.error('Fehler beim Laden der Audiogeräte:', e);
    }
}

async function testMicrophone() {
    const status = document.getElementById('mic-test-status');
    try {
        const selectedMicId = document.getElementById('audio-input-select')?.value;
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                deviceId: selectedMicId ? { exact: selectedMicId } : undefined,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });

        status.innerText = 'Test läuft... Sprich ins Mikrofon!';
        status.style.color = '#2ecc71';

        const testAudio = document.createElement('audio');
        testAudio.srcObject = stream;
        testAudio.autoplay = true;

        setTimeout(() => {
            stream.getTracks().forEach(t => t.stop());
            testAudio.remove();
            status.innerText = 'Mikrofon funktioniert!';
        }, 3000);
    } catch(e) {
        status.innerText = 'Fehler: Kein Zugriff!';
        status.style.color = '#ed4245';
    }
}

socket.on('init state', (data) => {
    renderChannels(data.channels);
});

function renderChannels(channels) {
    const textDiv = document.getElementById('text-channels');
    const voiceDiv = document.getElementById('voice-channels');
    textDiv.innerHTML = '';
    voiceDiv.innerHTML = '';

    channels.text.forEach(ch => {
        textDiv.innerHTML += `<div class="channel-item ${currentChannel === ch ? 'active' : ''}" onclick="switchChannel('text', '${ch}')"># ${ch}</div>`;
    });

    channels.voice.forEach(ch => {
        voiceDiv.innerHTML += `<div class="channel-item" onclick="joinVoiceChannel('${ch}')">🔊 ${ch}</div>`;
    });
}

function switchChannel(type, name) {
    if (type === 'text') {
        currentChannel = name;
        document.getElementById('current-channel-title').innerText = `# ${name}`;
        document.getElementById('chat-messages').style.display = 'flex';
        document.getElementById('chat-input-area-box').style.display = 'flex';
        document.getElementById('video-grid').style.display = 'none';
        document.getElementById('leave-voice-btn').style.display = 'none';
    }
}

function checkSend(e) {
    if (e.key === 'Enter') sendMessage();
}

function sendMessage() {
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if(!text) return;
    
    socket.emit('chat message', { 
        channel: currentChannel, 
        user: currentUser ? currentUser.username : 'Anonym',
        text: text 
    });
    input.value = '';
}

// Chatverlauf laden (unterstützt universell alle Schlüssel-Varianten)
socket.on('load_history', (messages) => {
    const container = document.getElementById('chat-messages');
    container.innerHTML = '';
    
    messages.forEach(msg => {
        const targetChannel = msg.channel || 'allgemein';
        // Zeigt die Nachrichten des aktuellen Kanals an (oder fallback auf 'allgemein', falls kein Kanal gesetzt war)
        if (targetChannel === currentChannel || (!msg.channel && currentChannel === 'allgemein')) {
            const userName = msg.user || msg.username || 'Unbekannt';
            const msgText = msg.text || msg.message || '';
            container.innerHTML += `
                <div class="message">
                    <span class="msg-user">${userName}</span>
                    <span class="msg-text">${msgText}</span>
                </div>
            `;
        }
    });
    container.scrollTop = container.scrollHeight;
});

// Neue Nachrichten in Echtzeit empfangen
socket.on('chat message', (msg) => {
    const targetChannel = msg.channel || 'allgemein';
    if(targetChannel === currentChannel) {
        const container = document.getElementById('chat-messages');
        const userName = msg.user || msg.username || 'Unbekannt';
        const msgText = msg.text || msg.message || '';
        container.innerHTML += `
            <div class="message">
                <span class="msg-user">${userName}</span>
                <span class="msg-text">${msgText}</span>
            </div>
        `;
        container.scrollTop = container.scrollHeight;
    }
});

// --- SPRACHKANAL BEITRETEN ---
async function joinVoiceChannel(channelName) {
    if(currentVoiceChannel || activeCallTarget) leaveVoiceChannel();
    currentVoiceChannel = channelName;

    document.getElementById('chat-messages').style.display = 'none';
    document.getElementById('chat-input-area-box').style.display = 'none';
    document.getElementById('video-grid').style.display = 'grid';
    document.getElementById('current-channel-title').innerText = `Sprachkanal: ${channelName}`;
    document.getElementById('leave-voice-btn').style.display = 'block';

    await startAudioStreamEngine(channelName, 'channel');
    socket.emit('join_voice_channel', { channelName: channelName });
}

// --- DIREKT-ANRUF FÜR FREUNDE ---
async function startDirectCall(targetUsername) {
    if(currentVoiceChannel || activeCallTarget) leaveVoiceChannel();
    activeCallTarget = targetUsername;

    document.getElementById('chat-messages').style.display = 'none';
    document.getElementById('chat-input-area-box').style.display = 'none';
    document.getElementById('video-grid').style.display = 'grid';
    document.getElementById('current-channel-title').innerText = `Direktanruf mit: ${targetUsername}`;
    document.getElementById('leave-voice-btn').style.display = 'block';

    const callRoom = [currentUser.username, targetUsername].sort().join('_call_');
    await startAudioStreamEngine(callRoom, 'direct');
    socket.emit('start_direct_call', { targetUsername: targetUsername, room: callRoom });
}

socket.on('incoming_direct_call', (data) => {
    if (confirm(`Eingehender Anruf von ${data.callerName}. Annehmen?`)) {
        startDirectCall(data.callerName);
    }
});

socket.on('direct_call_ended', () => {
    alert('Der Anruf wurde beendet.');
    leaveVoiceChannel();
});

// --- GEMEINSAME AUDIO-ENGINE ---
async function startAudioStreamEngine(targetRoom, mode) {
    const selectedMicId = document.getElementById('audio-input-select')?.value;

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                deviceId: selectedMicId ? { exact: selectedMicId } : undefined,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            },
            video: false 
        });

        const monitoringEnabled = document.getElementById('monitoring-toggle')?.checked;
        if (monitoringEnabled) {
            monitoringAudio = document.createElement('audio');
            monitoringAudio.srcObject = localStream;
            monitoringAudio.autoplay = true;
            monitoringAudio.muted = false;

            const selectedOutputId = document.getElementById('audio-output-select')?.value;
            if (selectedOutputId && typeof monitoringAudio.setSinkId === 'function') {
                monitoringAudio.setSinkId(selectedOutputId).catch(err => console.log('Monitoring SinkId Fehler:', err));
            }
            document.body.appendChild(monitoringAudio);
        }

        audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
        sourceNode = audioContext.createMediaStreamSource(localStream);
        processorNode = audioContext.createScriptProcessor(2048, 1, 1);

        processorNode.onaudioprocess = (e) => {
            const inputData = e.inputBuffer.getChannelData(0);
            const bufferCopy = new Float32Array(inputData);

            if (mode === 'channel' && currentVoiceChannel) {
                socket.emit('voice data', {
                    channel: currentVoiceChannel,
                    audioBuffer: Array.from(bufferCopy)
                });
            } else if (mode === 'direct' && activeCallTarget) {
                socket.emit('direct_voice_data', {
                    targetUser: activeCallTarget,
                    audioBuffer: Array.from(bufferCopy)
                });
            }
        };

        sourceNode.connect(processorNode);
        processorNode.connect(audioContext.destination);

    } catch (err) {
        console.error('Mikrofon-Fehler:', err);
        alert('Fehler beim Zugriff auf das Mikrofon.');
    }
}

function leaveVoiceChannel() {
    if(localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    if(processorNode) {
        processorNode.disconnect();
        processorNode = null;
    }
    if(sourceNode) {
        sourceNode.disconnect();
        sourceNode = null;
    }
    if(audioContext) {
        audioContext.close();
        audioContext = null;
    }
    if(monitoringAudio) {
        monitoringAudio.remove();
        monitoringAudio = null;
    }
    document.getElementById('video-grid').innerHTML = '';

    if (currentVoiceChannel) {
        socket.emit('leave_voice_channel');
        currentVoiceChannel = null;
    }
    if (activeCallTarget) {
        socket.emit('end_direct_call', { targetUser: activeCallTarget });
        activeCallTarget = null;
    }

    document.getElementById('leave-voice-btn').style.display = 'none';
    switchChannel('text', 'allgemein');
}

socket.on('voice data', (data) => {
    playIncomingAudio(data.audioBuffer);
});

socket.on('direct_voice_data', (data) => {
    playIncomingAudio(data.audioBuffer);
});

function playIncomingAudio(bufferArray) {
    try {
        const playCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
        const floatData = new Float32Array(bufferArray);

        const audioBuffer = playCtx.createBuffer(1, floatData.length, playCtx.sampleRate);
        audioBuffer.copyToChannel(floatData, 0);

        const source = playCtx.createBufferSource();
        source.buffer = audioBuffer;

        const selectedOutputId = document.getElementById('audio-output-select')?.value;
        const destination = playCtx.destination;

        source.connect(destination);
        source.start();
    } catch(e) {
        console.error('Fehler beim Abspielen von eingehendem Audio:', e);
    }
}

socket.on('update_voice_channel_users', (data) => {
    if (currentVoiceChannel !== data.channelName) return;

    const grid = document.getElementById('video-grid');
    const activeUsernames = new Set(data.users.map(u => u.username));

    const cards = grid.getElementsByClassName('video-card');
    Array.from(cards).forEach(card => {
        const username = card.id.replace('user-card-', '');
        if (!activeUsernames.has(username)) {
            card.remove();
        }
    });

    data.users.forEach(user => {
        let cardId = `user-card-${user.username}`;
        if (!document.getElementById(cardId)) {
            const card = document.createElement('div');
            card.className = 'video-card';
            card.id = cardId;

            const label = document.createElement('div');
            label.className = 'peer-name';
            label.innerText = user.username === currentUser.username ? `${user.username} (Du)` : user.username;

            card.appendChild(label);
            grid.appendChild(card);
        }
    });
});

socket.on('peer joined', (data) => {});
socket.on('peer left', (socketId) => {});
