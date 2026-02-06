const socket = io();

const inputView = document.getElementById('input-view');
const pairingView = document.getElementById('pairing-view');
const phoneNumberInput = document.getElementById('phone-number');
const btnSubmitPhone = document.getElementById('btn-submit-phone');
const btnShowQr = document.getElementById('btn-show-qr');
const btnRestart = document.getElementById('btn-restart');
const statusMessage = document.getElementById('status-message');
const loadingSpinner = document.getElementById('loading-spinner');
const codeContainer = document.getElementById('code-container');
const displayCode = document.getElementById('display-code');
const qrContainer = document.getElementById('qr-container');
const qrImg = document.getElementById('qr-img');
const successBox = document.getElementById('success-box');
const sessionOutput = document.getElementById('session-output');
const btnCopy = document.getElementById('btn-copy');

const charPool = "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";
let shuffleInterval = null;

function startShuffling(target, length) {
    if (shuffleInterval) clearInterval(shuffleInterval);
    shuffleInterval = setInterval(() => {
        let text = "";
        for (let i = 0; i < length; i++) {
            text += charPool.charAt(Math.floor(Math.random() * charPool.length));
        }
        target.textContent = text;
    }, 100);
}

function stopShuffling() {
    if (shuffleInterval) {
        clearInterval(shuffleInterval);
        shuffleInterval = null;
    }
}

btnSubmitPhone.addEventListener('click', () => {
    let raw = phoneNumberInput.value.trim();
    let num = raw.replace(/\D/g, '');

    if (num.length < 8) {
        return alert('Please enter your full country code + number. e.g. 919645991937');
    }

    inputView.classList.add('hidden');
    pairingView.classList.remove('hidden');
    loadingSpinner.classList.remove('hidden');
    codeContainer.classList.remove('hidden');

    statusMessage.textContent = 'CONNECTING TO WHATSAPP...';
    startShuffling(displayCode, 8);

    socket.emit('start-pairing', { method: 'pairing-code', phoneNumber: num });
});

btnShowQr.addEventListener('click', () => {
    inputView.classList.add('hidden');
    pairingView.classList.remove('hidden');
    loadingSpinner.classList.remove('hidden');
    qrContainer.classList.add('hidden');
    statusMessage.textContent = 'GENERATING QR CODE...';
    socket.emit('start-pairing', { method: 'qr' });
});

btnRestart.addEventListener('click', () => {
    location.reload();
});

// NEW: Real-time status updates from backend
socket.on('status', (msg) => {
    statusMessage.textContent = msg;
    console.log('[STATUS]', msg);
});

socket.on('pairing-code', (data) => {
    stopShuffling();
    statusMessage.textContent = 'ENTER THIS CODE ON YOUR PHONE';
    displayCode.textContent = data.code;
    displayCode.style.color = '#00f2fe';
    loadingSpinner.classList.add('hidden');
});

socket.on('qr', (url) => {
    statusMessage.textContent = 'SCAN THIS CODE IN WHATSAPP';
    qrImg.src = url;
    qrContainer.classList.remove('hidden');
    loadingSpinner.classList.add('hidden');
});

socket.on('success', (data) => {
    stopShuffling();
    statusMessage.textContent = 'CONNECTED!';
    codeContainer.classList.add('hidden');
    qrContainer.classList.add('hidden');
    loadingSpinner.classList.add('hidden');
    successBox.classList.remove('hidden');
    sessionOutput.value = data.session;
});

socket.on('error', (msg) => {
    stopShuffling();
    alert(msg);
    location.reload();
});

btnCopy.addEventListener('click', () => {
    sessionOutput.select();
    document.execCommand('copy');
    btnCopy.textContent = 'COPIED!';
    setTimeout(() => btnCopy.textContent = 'COPY SESSION ID', 2000);
});
