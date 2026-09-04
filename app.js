document.addEventListener('DOMContentLoaded', () => {
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    
    const thresholdSlider = document.getElementById('thresholdSlider');
    const thresholdValue = document.getElementById('thresholdValue');
    const delaySlider = document.getElementById('delaySlider');
    const delayValue = document.getElementById('delayValue');
    
    const volumeBar = document.getElementById('volumeBar');
    const thresholdLine = document.getElementById('thresholdLine');
    
    const statusPanel = document.getElementById('statusPanel');
    const statusText = document.getElementById('statusText');

    let audioContext;
    let analyser;
    let microphone;
    let animationFrameId;
    let mediaStream;
    
    let isMonitoring = false;
    let isAlerting = false;
    let isBeeping = false;
    
    let silenceStart = 0;
    let threshold = parseInt(thresholdSlider.value, 10);
    let delaySeconds = parseFloat(delaySlider.value);
    
    // UI Updates for sliders
    thresholdSlider.addEventListener('input', (e) => {
        threshold = parseInt(e.target.value, 10);
        thresholdValue.textContent = threshold;
        thresholdLine.style.left = `${threshold}%`;
    });
    
    delaySlider.addEventListener('input', (e) => {
        delaySeconds = parseFloat(e.target.value);
        delayValue.textContent = delaySeconds.toFixed(1);
    });
    
    startBtn.addEventListener('click', startMonitoring);
    stopBtn.addEventListener('click', stopMonitoring);

    function updateStatus(state, message) {
        statusPanel.className = 'status-panel'; // reset
        if (state) statusPanel.classList.add(state);
        statusText.textContent = message;
    }

    async function startMonitoring() {
        try {
            updateStatus('active', 'Requesting microphone...');
            
            // Disable echoCancellation, noiseSuppression, and autoGainControl
            // to prevent the browser/OS from ducking or cutting audio volume when mic is active
            mediaStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                }, 
                video: false 
            });
            
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            if (audioContext.state === 'suspended') {
                await audioContext.resume();
            }

            analyser = audioContext.createAnalyser();
            analyser.smoothingTimeConstant = 0.8;
            analyser.fftSize = 1024;

            microphone = audioContext.createMediaStreamSource(mediaStream);
            // Connect microphone ONLY to analyser.
            // Do NOT connect to audioContext.destination (which causes feedback & volume cutting)
            microphone.connect(analyser);
            
            isMonitoring = true;
            startBtn.disabled = true;
            stopBtn.disabled = false;
            
            updateStatus('active', 'Monitoring: Keep talking!');
            silenceStart = Date.now();
            
            processAudio();
            
        } catch (err) {
            console.error("Error accessing microphone", err);
            updateStatus('error', 'Microphone access denied or unavailable.');
            startBtn.disabled = false;
            stopBtn.disabled = true;
        }
    }

    function processAudio() {
        if (!isMonitoring || !analyser) return;

        // If the beep is currently playing, ignore mic input so the app doesn't detect its own beep
        if (isBeeping) {
            animationFrameId = requestAnimationFrame(processAudio);
            return;
        }

        const array = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(array);
        
        let values = 0;
        const length = array.length;
        for (let i = 0; i < length; i++) {
            values += array[i];
        }
        
        const average = values / length;
        const volumePercent = Math.min(100, Math.round((average / 128) * 100)); 
        
        volumeBar.style.width = `${volumePercent}%`;
        
        if (volumePercent >= threshold) {
            // Talking above threshold
            silenceStart = Date.now();
            if (isAlerting) {
                isAlerting = false;
                updateStatus('active', 'Monitoring: Keep talking!');
            }
        } else {
            // Silent
            const silentFor = (Date.now() - silenceStart) / 1000;
            if (silentFor >= delaySeconds) {
                triggerAlert();
                silenceStart = Date.now(); // Reset to beep again after delay
            }
        }

        animationFrameId = requestAnimationFrame(processAudio);
    }
    
    function stopMonitoring() {
        isMonitoring = false;
        isBeeping = false;
        
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }

        if (microphone) {
            microphone.disconnect();
            microphone = null;
        }

        if (analyser) {
            analyser.disconnect();
            analyser = null;
        }

        if (mediaStream) {
            mediaStream.getTracks().forEach(track => track.stop());
            mediaStream = null;
        }

        if (audioContext && audioContext.state !== 'closed') {
            audioContext.close();
        }
        
        volumeBar.style.width = '0%';
        startBtn.disabled = false;
        stopBtn.disabled = true;
        isAlerting = false;
        updateStatus('', 'Idle - Ready to start');
    }
    
    function triggerAlert() {
        if (!isAlerting) {
            isAlerting = true;
            updateStatus('alerting', 'Silence detected! Think out loud!');
        }
        playBeep();
    }
    
    function playBeep() {
        const ctx = audioContext && audioContext.state !== 'closed' 
            ? audioContext 
            : new (window.AudioContext || window.webkitAudioContext)();
        
        if (ctx.state === 'suspended') {
            ctx.resume();
        }

        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();
        osc.connect(gainNode);
        gainNode.connect(ctx.destination);
        
        osc.type = 'square';
        osc.frequency.setValueAtTime(400, now);
        
        // Maintain solid, clear volume throughout the 0.3s beep without premature exponential drop
        gainNode.gain.setValueAtTime(0.4, now);
        gainNode.gain.setValueAtTime(0.4, now + 0.25);
        gainNode.gain.linearRampToValueAtTime(0.001, now + 0.3);
        
        isBeeping = true;
        osc.start(now);
        osc.stop(now + 0.3);

        setTimeout(() => {
            isBeeping = false;
        }, 320);
    }
});
