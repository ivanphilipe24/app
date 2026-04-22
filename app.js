const PREFIX = 'vis-';

// UI Elements
const screens = {
    home: document.getElementById('screen-home'),
    txSetup: document.getElementById('screen-transmitter-setup'),
    txActive: document.getElementById('screen-transmitter-active'),
    rxSetup: document.getElementById('screen-receiver-setup'),
    rxActive: document.getElementById('screen-receiver-active')
};

const buttons = {
    transmitter: document.getElementById('btn-transmitter'),
    receiver: document.getElementById('btn-receiver'),
    back: document.querySelectorAll('.back-btn'),
    shareCamera: document.getElementById('btn-share-camera'),
    shareScreen: document.getElementById('btn-share-screen'),
    connect: document.getElementById('btn-connect')
};

const inputs = {
    roomCode: document.getElementById('input-room-code')
};

const displays = {
    roomCode: document.getElementById('room-code-display'),
    txStatus: document.getElementById('tx-status'),
    rxStatus: document.getElementById('rx-status'),
    localVideo: document.getElementById('local-video'),
    remoteVideo: document.getElementById('remote-video'),
    txError: document.getElementById('tx-error'),
    rxError: document.getElementById('rx-error')
};

// State
let peer = null;
let currentConnection = null;
let localStream = null;
let wakeLock = null;

// Navigation
function showScreen(screenId) {
    Object.values(screens).forEach(screen => {
        if (screen) screen.classList.remove('active');
    });
    if (screens[screenId]) {
        screens[screenId].classList.add('active');
    }
}

// Keep screen on
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log('Wake Lock ativo');
        }
    } catch (err) {
        console.error(`${err.name}, ${err.message}`);
    }
}

function releaseWakeLock() {
    if (wakeLock) {
        wakeLock.release();
        wakeLock = null;
    }
}

// Reset everything
function resetState() {
    releaseWakeLock();
    if (currentConnection) {
        currentConnection.close();
        currentConnection = null;
    }
    if (peer) {
        peer.destroy();
        peer = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    displays.localVideo.srcObject = null;
    displays.remoteVideo.srcObject = null;
    displays.txError.classList.add('hidden');
    displays.rxError.classList.add('hidden');
    displays.txStatus.className = 'status-indicator waiting';
    displays.txStatus.innerText = 'Aguardando receptor...';
    displays.rxStatus.className = 'status-indicator connecting';
    displays.rxStatus.innerText = 'Aguardando...';
    inputs.roomCode.value = '';
}

// Navigation Events
buttons.transmitter.addEventListener('click', () => showScreen('txSetup'));
buttons.receiver.addEventListener('click', () => showScreen('rxSetup'));
buttons.back.forEach(btn => btn.addEventListener('click', () => {
    resetState();
    showScreen('home');
}));

// --- Transmitter Logic ---

async function startTransmission(type) {
    displays.txError.classList.add('hidden');
    
    try {
        if (type === 'camera') {
            localStream = await navigator.mediaDevices.getUserMedia({ 
                video: { facingMode: 'user' }, 
                audio: true 
            });
            displays.localVideo.parentElement.classList.remove('is-screen');
        } else {
            // CHECK FOR DISPLAY MEDIA SUPPORT
            if (!navigator.mediaDevices.getDisplayMedia) {
                throw new Error('Seu navegador não suporta compartilhamento de tela.');
            }
            
            localStream = await navigator.mediaDevices.getDisplayMedia({ 
                video: true, 
                audio: true 
            });
            displays.localVideo.parentElement.classList.add('is-screen');
        }
        
        displays.localVideo.srcObject = localStream;
        await requestWakeLock(); // Manter tela ligada durante transmissão
        
        const code = Math.floor(10000 + Math.random() * 90000).toString();
        const peerId = PREFIX + code;
        
        displays.roomCode.innerText = code;
        showScreen('txActive');
        
        initTransmitterPeer(peerId);

        // Se o usuário parar de compartilhar pelo aviso do sistema (Android/PC)
        localStream.getVideoTracks()[0].onended = () => {
            resetState();
            showScreen('home');
        };

    } catch (err) {
        console.error(err);
        let errorMsg = 'Erro ao acessar mídia: ' + err.message;
        if (err.name === 'NotAllowedError') errorMsg = 'Permissão negada pelo usuário.';
        displays.txError.innerText = errorMsg;
        displays.txError.classList.remove('hidden');
    }
}

buttons.shareCamera.addEventListener('click', () => startTransmission('camera'));
buttons.shareScreen.addEventListener('click', () => startTransmission('screen'));

function initTransmitterPeer(peerId) {
    peer = new Peer(peerId, { debug: 1 });

    peer.on('error', (err) => {
        displays.txError.innerText = 'Erro de conexão: ' + err.message;
        displays.txError.classList.remove('hidden');
    });

    peer.on('connection', (conn) => {
        if (currentConnection) {
            conn.close();
            return;
        }
        
        currentConnection = conn;
        displays.txStatus.className = 'status-indicator connected';
        displays.txStatus.innerText = 'Receptor conectado! Transmitindo...';
        
        conn.on('open', () => {
            const call = peer.call(conn.peer, localStream);
            call.on('close', () => {
                displays.txStatus.className = 'status-indicator waiting';
                displays.txStatus.innerText = 'Receptor desconectado. Aguardando novo...';
                currentConnection = null;
            });
        });

        conn.on('close', () => {
            displays.txStatus.className = 'status-indicator waiting';
            displays.txStatus.innerText = 'Receptor desconectado.';
            currentConnection = null;
        });
    });
}

// --- Receiver Logic ---

buttons.connect.addEventListener('click', () => {
    const code = inputs.roomCode.value.trim();
    if (code.length < 5) {
        displays.rxError.innerText = 'Digite o código de 5 dígitos.';
        displays.rxError.classList.remove('hidden');
        return;
    }
    
    displays.rxError.classList.add('hidden');
    showScreen('rxActive');
    displays.rxStatus.innerText = 'Conectando ao transmissor...';
    
    initReceiverPeer(PREFIX + code);
});

function initReceiverPeer(targetId) {
    peer = new Peer({ debug: 1 });

    peer.on('open', async (id) => {
        await requestWakeLock(); // Manter tela ligada ao assistir
        currentConnection = peer.connect(targetId);
        
        currentConnection.on('open', () => {
            displays.rxStatus.innerText = 'Aguardando vídeo...';
        });

        currentConnection.on('close', () => {
            displays.rxStatus.className = 'status-indicator waiting';
            displays.rxStatus.innerText = 'Conexão encerrada.';
            displays.remoteVideo.srcObject = null;
            releaseWakeLock();
        });
    });

    peer.on('call', (call) => {
        displays.rxStatus.className = 'status-indicator connected';
        displays.rxStatus.innerText = 'Recebendo transmissão ao vivo!';
        call.answer(); 
        call.on('stream', (remoteStream) => {
            displays.remoteVideo.srcObject = remoteStream;
            displays.remoteVideo.muted = false;
        });
    });

    peer.on('error', (err) => {
        let msg = err.message;
        if (err.type === 'peer-unavailable') msg = 'Código inválido ou transmissor offline.';
        displays.rxStatus.className = 'status-indicator';
        displays.rxStatus.style.color = 'var(--danger)';
        displays.rxStatus.innerText = 'Erro: ' + msg;
    });
}

// Reiniciar Wake Lock se a aba voltar a ficar visível
document.addEventListener('visibilitychange', async () => {
    if (wakeLock !== null && document.visibilityState === 'visible') {
        await requestWakeLock();
    }
});
