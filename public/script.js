const socket = io();

const methodSelector = document.getElementById('method-selector');
const phoneInputSection = document.getElementById('phone-input-section');
const pairingDisplay = document.getElementById('pairing-display');

const btnQr = document.getElementById('btn-qr');
const btnCode = document.getElementById('btn-code');
const btnSubmitPhone = document.getElementById('btn-submit-phone');
const backLinks = document.querySelectorAll('.back-link');

const statusMessage = document.getElementById('status-message');
const qrContainer = document.getElementById('qr-container');
const codeContainer = document.getElementById('code-container');
const qrImg = document.getElementById('qr-img');
const displayCode = document.getElementById('display-code');
const loadingSpinner = document.getElementById('loading-spinner');
const successBox = document.getElementById('success-box');
const sessionOutput = document.getElementById('session-output');
const btnCopy = document.getElementById('btn-copy');

let currentMethod = '';

btnQr.addEventListener('click', () => {
    currentMethod = 'qr';
    showSection(pairingDisplay);
    statusMessage.textContent = 'Generating QR Code...';
    socket.emit('start-pairing', { method: 'qr' });
});

btnCode.addEventListener('click', () => {
    currentMethod = 'pairing-code';
    showSection(phoneInputSection);
});

btnSubmitPhone.addEventListener('click', () => {
    const phoneNumber = document.getElementById('phone-number').value.replace(/\D/g, '');
    if (!phoneNumber) return alert('Please enter a valid phone number');

    showSection(pairingDisplay);
    statusMessage.textContent = 'Requesting Pairing Code...';
    loadingSpinner.classList.remove('hidden');
    socket.emit('start-pairing', { method: 'pairing-code', phoneNumber });
});

backLinks.forEach(link => {
    link.addEventListener('click', () => {
        location.reload(); // Simplest way to reset state
    });
});

socket.on('qr', (dataURL) => {
    statusMessage.textContent = 'Scan this QR code with WhatsApp';
    qrImg.src = dataURL;
    qrContainer.classList.remove('hidden');
    loadingSpinner.classList.add('hidden');
});

socket.on('pairing-code', (data) => {
    statusMessage.textContent = 'Enter this code in your WhatsApp notifications';
    displayCode.textContent = data.code;
    codeContainer.classList.remove('hidden');
    loadingSpinner.classList.add('hidden');
});

socket.on('success', (data) => {
    statusMessage.classList.add('hidden');
    qrContainer.classList.add('hidden');
    codeContainer.classList.add('hidden');
    loadingSpinner.classList.add('hidden');

    successBox.classList.remove('hidden');
    sessionOutput.value = data.session;
});

socket.on('error', (msg) => {
    alert(msg);
    location.reload();
});

btnCopy.addEventListener('click', () => {
    sessionOutput.select();
    document.execCommand('copy');
    btnCopy.textContent = 'Copied!';
    setTimeout(() => btnCopy.textContent = 'Copy Session ID', 2000);
});

function showSection(section) {
    [methodSelector, phoneInputSection, pairingDisplay].forEach(s => s.classList.add('hidden'));
    section.classList.remove('hidden');
    section.classList.add('fade-in');
}
