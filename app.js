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
let mediaType = null; // 'camera' or 'screen'

// Navigation
function showScreen(screenId) {
    Object.values(screens).forEach(screen => {
        if (screen) screen.classList.remove('active');
    });
    if (screens[screenId]) {
        screens[screenId].classList.add('active');
    }
}

// Reset everything
function resetState() {
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

// Event Listeners for Navigation
buttons.transmitter.addEventListener('click', () => {
    showScreen('txSetup');
});

buttons.receiver.addEventListener('click', () => {
    showScreen('rxSetup');
});

buttons.back.forEach(btn => {
    btn.addEventListener('click', () => {
        resetState();
        showScreen('home');
    });
});

// --- Transmitter Logic ---

async function startTransmission(type) {
    mediaType = type;
    displays.txError.classList.add('hidden');
    
    try {
        if (type === 'camera') {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            displays.localVideo.parentElement.classList.remove('is-screen');
        } else {
            localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            displays.localVideo.parentElement.classList.add('is-screen');
        }
        
        displays.localVideo.srcObject = localStream;
        
        // Generate random 5-digit code
        const code = Math.floor(10000 + Math.random() * 90000).toString();
        const peerId = PREFIX + code;
        
        displays.roomCode.innerText = code;
        showScreen('txActive');
        
        initTransmitterPeer(peerId);

        // Listen for user stopping screen share via browser UI
        localStream.getVideoTracks()[0].onended = () => {
            resetState();
            showScreen('home');
        };

    } catch (err) {
        console.error(err);
        displays.txError.innerText = 'Erro ao acessar mídia: ' + err.message;
        displays.txError.classList.remove('hidden');
    }
}

buttons.shareCamera.addEventListener('click', () => startTransmission('camera'));
buttons.shareScreen.addEventListener('click', () => startTransmission('screen'));

function initTransmitterPeer(peerId) {
    peer = new Peer(peerId, {
        debug: 2
    });

    peer.on('open', (id) => {
        console.log('Transmitter Peer created with ID:', id);
    });

    peer.on('error', (err) => {
        displays.txError.innerText = 'Erro de conexão: ' + err.message;
        displays.txError.classList.remove('hidden');
    });

    // Wait for receiver to connect via data channel first
    peer.on('connection', (conn) => {
        if (currentConnection) {
            // Already connected to someone, reject
            conn.close();
            return;
        }
        
        currentConnection = conn;
        displays.txStatus.className = 'status-indicator connected';
        displays.txStatus.innerText = 'Receptor conectado! Transmitindo...';
        
        conn.on('open', () => {
            // Call the receiver
            console.log('Calling receiver:', conn.peer);
            const call = peer.call(conn.peer, localStream);
            
            call.on('error', (err) => {
                console.error('Call error', err);
            });
            
            call.on('close', () => {
                displays.txStatus.className = 'status-indicator waiting';
                displays.txStatus.innerText = 'Receptor desconectado. Aguardando novo...';
                currentConnection = null;
            });
        });

        conn.on('close', () => {
            displays.txStatus.className = 'status-indicator waiting';
            displays.txStatus.innerText = 'Receptor desconectado. Aguardando novo...';
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
    peer = new Peer({
        debug: 2
    });

    peer.on('open', (id) => {
        console.log('Receiver Peer created with ID:', id);
        
        // Connect to transmitter to trigger signaling
        displays.rxStatus.innerText = 'Sinalizando transmissor...';
        currentConnection = peer.connect(targetId);
        
        currentConnection.on('open', () => {
            displays.rxStatus.innerText = 'Aguardando vídeo...';
        });

        currentConnection.on('error', (err) => {
            displays.rxStatus.className = 'status-indicator error';
            displays.rxStatus.innerText = 'Falha ao conectar: ' + err.message;
        });
        
        currentConnection.on('close', () => {
            displays.rxStatus.className = 'status-indicator waiting';
            displays.rxStatus.innerText = 'Transmissor encerrou a conexão.';
            displays.remoteVideo.srcObject = null;
        });
    });

    // Receive the call
    peer.on('call', (call) => {
        displays.rxStatus.className = 'status-indicator connected';
        displays.rxStatus.innerText = 'Recebendo transmissão ao vivo!';
        
        // Answer without a stream
        call.answer(); 
        
        call.on('stream', (remoteStream) => {
            displays.remoteVideo.srcObject = remoteStream;
            // Unmute the video element so audio works
            displays.remoteVideo.muted = false;
        });
        
        call.on('close', () => {
            displays.rxStatus.className = 'status-indicator waiting';
            displays.rxStatus.innerText = 'Transmissão pausada/encerrada.';
        });
    });

    peer.on('error', (err) => {
        let msg = err.message;
        if (err.type === 'peer-unavailable') {
            msg = 'Código inválido ou transmissor offline.';
        }
        displays.rxStatus.className = 'status-indicator';
        displays.rxStatus.style.color = 'var(--danger)';
        displays.rxStatus.innerText = 'Erro: ' + msg;
    });
}
