// public/audio-manager.js

let localStream = null;
let audioContext = null;
let processorNode = null;
let sourceNode = null;
let monitoringAudio = null;
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

// 1. Audiogeräte laden (Mikrofone & Lautsprecher)
async function loadAudioDevices() {
    try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        const devices = await navigator.mediaDevices.enumerateDevices();
        const micSelect = document.getElementById('audio-input-select');
        const outputSelect = document.getElementById('audio-output-select');

        if (micSelect) micSelect.innerHTML = '';
        if (outputSelect) outputSelect.innerHTML = '';

        devices.forEach(device => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.text = device.label || `${device.kind} - ${device.deviceId.substring(0, 5)}`;
            if (device.kind === 'audioinput' && micSelect) {
                micSelect.appendChild(option);
            } else if (device.kind === 'audiooutput' && outputSelect) {
                outputSelect.appendChild(option);
            }
        });

        // Gespeicherte Einstellungen wiederherstellen falls vorhanden
        if (typeof currentUser !== 'undefined') {
            if (currentUser.audioInputId && micSelect) micSelect.value = currentUser.audioInputId;
            if (currentUser.audioOutputId && outputSelect) outputSelect.value = currentUser.audioOutputId;
        }
    } catch (e) {
        console.error('Fehler beim Laden der Audiogeräte:', e);
    }
}

// 2. Mikrofon-Testfunktion
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

// 3. Audio-Stream Engine für Sprachkanäle und Direktanrufe
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

            if (mode === 'channel' && typeof currentVoiceChannel !== 'undefined' && currentVoiceChannel) {
                socket.emit('voice data', {
                    channel: currentVoiceChannel,
                    audioBuffer: Array.from(bufferCopy)
                });
            } else if (mode === 'direct' && typeof activeCallTarget !== 'undefined' && activeCallTarget) {
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

// 4. Sprach- und Audiostreams sauber stoppen/verlassen
function stopAudioStreamEngine() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    if (processorNode) {
        processorNode.disconnect();
        processorNode = null;
    }
    if (sourceNode) {
        sourceNode.disconnect();
        sourceNode = null;
    }
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
    if (monitoringAudio) {
        monitoringAudio.remove();
        monitoringAudio = null;
    }
}

// 5. Eingehendes Audio abspielen (für Sprachkanäle & Anrufe)
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

        // Falls Ausgabegerät unterstützt wird und ausgewählt ist
        if (selectedOutputId && typeof playCtx.setSinkId === 'function') {
            playCtx.setSinkId(selectedOutputId).catch(err => console.log('Ausgabe SinkId Fehler:', err));
        }

        source.connect(destination);
        source.start();
    } catch (e) {
        console.error('Fehler beim Abspielen von eingehendem Audio:', e);
    }
}

// 6. Sprachnachrichten aufnehmen (Chat)
function toggleVoiceRecording() {
    const statusIndicator = document.getElementById('recording-status');
    const recordBtn = document.getElementById('voice-record-btn');

    if (!isRecording) {
        const selectedMicId = document.getElementById('audio-input-select')?.value;
        const audioConstraint = selectedMicId
            ? { deviceId: { exact: selectedMicId }, echoCancellation: true, noiseSuppression: true }
            : { echoCancellation: true, noiseSuppression: true };

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
                            channel: typeof currentChannel !== 'undefined' ? currentChannel : 'allgemein',
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
                if (recordBtn) recordBtn.style.background = '#ed4245';
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
        if (recordBtn) recordBtn.style.background = '#2f3136';
        if (statusIndicator) statusIndicator.style.display = 'none';
    }
}

// 7. Gespeichertes Audiogerät erzwingen
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
