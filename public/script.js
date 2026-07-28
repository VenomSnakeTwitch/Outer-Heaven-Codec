const socket = io();

let currentUser = null;
let currentChannel = 'allgemein';
let currentChannelType = 'text';

// Authentifizierung / Login / Register prüfen beim Start
window.addEventListener('DOMContentLoaded', () => {
    const savedUser = localStorage.getItem('outer_heaven_user');
    if (savedUser) {
        try {
            currentUser = JSON.parse(savedUser);
            document.getElementById('auth-screen').style.display = 'none';
            initApp();
        } catch (e) {
            localStorage.removeItem('outer_heaven_user');
        }
    }
});

let isRegisterMode = false;
function toggleAuthMode() {
    isRegisterMode = !isRegisterMode;
    const title = document.getElementById('auth-title');
    const btn = document.getElementById('auth-submit-btn');
    const switchBtn = document.getElementById('switch-mode-btn');
    const adminSecretInput = document.getElementById('admin-secret-input');

    if (isRegisterMode) {
        title.innerText = "Outer Heaven - Registrieren";
        btn.innerText = "Registrieren";
        switchBtn.innerText = "Bereits ein Konto? Einloggen";
        adminSecretInput.style.display = 'block';
    } else {
        title.innerText = "Outer Heaven - Login";
        btn.innerText = "Einloggen";
        switchBtn.innerText = "Noch kein Konto? Registrieren";
        adminSecretInput.style.display = 'none';
    }
}

async function handleAuth() {
    const usernameInput = document.getElementById('username').value.trim();
    const passwordInput = document.getElementById('passwort').value.trim();
    const adminSecretInput = document.getElementById('admin-secret-input').value.trim();

    if (!usernameInput || !passwordInput) {
        alert('Bitte Benutzername und Passwort eingeben.');
        return;
    }

    const endpoint = isRegisterMode ? '/api/register' : '/api/login';
    const payload = { username: usernameInput, password: passwordInput };
    if (isRegisterMode && adminSecretInput) {
        payload.adminSecret = adminSecretInput;
    }

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();

        if (data.success) {
            if (isRegisterMode) {
                alert(data.message || 'Registrierung erfolgreich! Bitte jetzt einloggen.');
                toggleAuthMode();
            } else {
                currentUser = {
                    username: data.username,
                    role: data.role,
                    avatar: data.avatar || '/default-avatar.png',
                    bio: data.bio || '',
                    audioInputId: data.audioInputId || '',
                    audioOutputId: data.audioOutputId || ''
                };
                localStorage.setItem('outer_heaven_user', JSON.stringify(currentUser));
                document.getElementById('auth-screen').style.display = 'none';
                initApp();
            }
        } else {
            alert(data.message || 'Ein Fehler ist aufgetreten.');
        }
    } catch (err) {
        console.error(err);
        alert('Verbindungsfehler zum Server.');
    }
}

function initApp() {
    if (!currentUser) return;

    document.getElementById('user-name-disp').innerText = `${currentUser.username} (${currentUser.role || 'Agent'})`;
    const avatarDiv = document.getElementById('user-avatar-disp');
    if (currentUser.avatar) {
        avatarDiv.innerHTML = `<img src="${currentUser.avatar}" alt="Avatar" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
    }

    socket.emit('set_user_info', {
        username: currentUser.username,
        role: currentUser.role,
        avatar: currentUser.avatar,
        bio: currentUser.bio
    });

    socket.emit('get_online_users', (users) => {
        renderOnlineUsersList(users);
    });

    checkAdminUIVisibility();
}

function logout() {
    localStorage.removeItem('outer_heaven_user');
    window.location.reload();
}

// --- Nachrichten & Chat ---
function switchChannel(type, name) {
    currentChannelType = type;
    currentChannel = name;
    document.getElementById('current-channel-title').innerText = `# ${name}`;
    
    // Aktiven Kanal optisch markieren
    document.querySelectorAll('.channel-item').forEach(el => el.classList.remove('active'));
    event && event.target && event.target.classList.add('active');

    // Chat leeren und Verlauf für diesen Kanal laden (wird über socket events gesteuert)
    document.getElementById('chat-messages').innerHTML = '';
}

function checkSend(e) {
    if (e.key === 'Enter') {
        sendMessage();
    }
}

function sendMessage() {
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text) return;

    socket.emit('chat message', {
        channel: currentChannel,
        user: currentUser.username,
        text: text
    });

    input.value = '';
}

// Chat Nachrichten empfangen
socket.on('chat message', (msg) => {
    if (msg.channel && msg.channel !== currentChannel) return;
    appendMessage(msg);
});

socket.on('chat_message', (msg) => {
    if (msg.channel && msg.channel !== currentChannel) return;
    appendMessage(msg);
});

socket.on('load_history', (messages) => {
    const container = document.getElementById('chat-messages');
    container.innerHTML = '';
    messages.forEach(msg => {
        if (!msg.channel || msg.channel === currentChannel) {
            appendMessage(msg);
        }
    });
});

function appendMessage(msg) {
    const container = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = 'chat-message' + (msg.marked ? ' marked-message' : '');
    div.id = msg.id;

    let adminActions = '';
    if (currentUser && (currentUser.role === 'Admin' || currentUser.role === 'Mod')) {
        adminActions = `
            <span style="margin-left: auto; display: flex; gap: 5px;">
                <button onclick="toggleMarkMessage('${msg.id}')" style="background:none; border:none; color:#f1c40f; cursor:pointer; font-size:11px;" title="Markieren">⭐</button>
                <button onclick="deleteMessage('${msg.id}')" style="background:none; border:none; color:#e74c3c; cursor:pointer; font-size:11px;" title="Löschen">🗑️</button>
            </span>
        `;
    }

    div.innerHTML = `
        <div class="avatar-container" style="width: 32px; height: 32px; flex-shrink: 0;">
            <img src="${msg.avatar || '/default-avatar.png'}" alt="" onerror="this.style.display='none'">
        </div>
        <div style="flex: 1; overflow: hidden;">
            <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-weight: bold; color: #fff; font-size: 13px;">${msg.user}</span>
                <span style="font-size: 10px; color: #8e9297;">${msg.timestamp || ''}</span>
                ${adminActions}
            </div>
            <div style="color: #dcddde; font-size: 14px; word-break: break-word; margin-top: 2px;">${escapeHtml(msg.text || msg.message)}</div>
        </div>
    `;

    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function deleteMessage(messageId) {
    if (confirm("Möchtest du diese Nachricht wirklich löschen?")) {
        socket.emit('delete_message', { messageId });
    }
}

function toggleMarkMessage(messageId) {
    socket.emit('toggle_mark_message', { messageId });
}

socket.on('message_deleted', (data) => {
    const el = document.getElementById(data.messageId);
    if (el) el.remove();
});

socket.on('message_marked', (data) => {
    const el = document.getElementById(data.messageId);
    if (el) {
        if (data.marked) {
            el.classList.add('marked-message');
        } else {
            el.classList.remove('marked-message');
        }
    }
});

// --- Online User Liste & Admin-Verwaltung ---
socket.on('update_online_users', (users) => {
    renderOnlineUsersList(users);
});

socket.on('role_updated', (data) => {
    if (currentUser) {
        currentUser.role = data.newRole;
        localStorage.setItem('outer_heaven_user', JSON.stringify(currentUser));
        document.getElementById('user-name-disp').innerText = `${currentUser.username} (${currentUser.role || 'Agent'})`;
        checkAdminUIVisibility();
    }
});

function renderOnlineUsersList(users) {
    const container = document.getElementById('online-users-list');
    if (!container) return;
    container.innerHTML = '';

    if (!users || users.length === 0) {
        container.innerHTML = '<div style="color: #888; font-size: 11px; padding: 5px;">Keine Benutzer online.</div>';
        return;
    }

    users.forEach(user => {
        container.innerHTML += `
            <div class="online-user-item" style="display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: 4px; margin-bottom: 2px;">
                <div class="avatar-container" style="width: 24px; height: 24px; font-size: 10px;">
                    <img src="${user.avatar}" alt="" onerror="this.style.display='none'">
                </div>
                <div style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    <span style="font-size: 13px; color: #fff;">${user.username}</span>
                    <span style="font-size: 10px; color: #8e9297; display: block;">${user.role}</span>
                </div>
            </div>
        `;
    });
}

function checkAdminUIVisibility() {
    const adminPanel = document.getElementById('admin-sidebar-panel');
    if (adminPanel) {
        if (currentUser && currentUser.role === 'Admin') {
            adminPanel.style.display = 'block';
        } else {
            adminPanel.style.display = 'none';
        }
    }
}

function adminUpdateUserRolePrompt() {
    const targetUser = prompt("Gib den Benutzernamen ein, dessen Rang du anpassen möchtest:");
    if (!targetUser) return;
    const newRole = prompt("Welchen neuen Rang soll der Benutzer erhalten? (Admin / Mod / Agent):");
    if (!newRole) return;

    socket.emit('admin_update_user_role', { targetUser, newRole }, (res) => {
        alert(res.message);
    });
}

function joinVoiceChannel(channelName) {
    alert(`Sprachkanal ${channelName} beigetreten.`);
}

function leaveVoiceChannel() {
    alert("Sprachkanal verlassen.");
}

function openSettings() {
    alert("Einstellungen-Menü.");
}

function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
