document.addEventListener('DOMContentLoaded', () => {
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const testSoundBtn = document.getElementById('testSoundBtn');
    
    const thresholdSlider = document.getElementById('thresholdSlider');
    const thresholdValue = document.getElementById('thresholdValue');
    const delaySlider = document.getElementById('delaySlider');
    const delayValue = document.getElementById('delayValue');
    
    const volumeBar = document.getElementById('volumeBar');
    const thresholdLine = document.getElementById('thresholdLine');
    
    const statusPanel = document.getElementById('statusPanel');
    const statusText = document.getElementById('statusText');

    let audioContext = null;
    let analyser = null;
    let microphone = null;
    let mediaStream = null;
    let animationFrameId = null;
    
    let isMonitoring = false;
    let isAlerting = false;
    
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
    if (testSoundBtn) {
        testSoundBtn.addEventListener('click', async () => {
            await ensureAudioContext();
            playBeep();
        });
    }

    function updateStatus(state, message) {
        statusPanel.className = 'status-panel'; // reset
        if (state) statusPanel.classList.add(state);
        statusText.textContent = message;
    }

    async function ensureAudioContext() {
        if (!audioContext || audioContext.state === 'closed') {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            audioContext = new AudioContextClass();
        }
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }
        return audioContext;
    }

    async function startMonitoring() {
        try {
            updateStatus('active', 'Requesting microphone...');
            
            // Ensure AudioContext is created/resumed immediately in user-gesture callstack
            await ensureAudioContext();

            mediaStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: false,
                    autoGainControl: true
                }, 
                video: false 
            });
            
            // Re-verify audio context is active
            if (audioContext.state === 'suspended') {
                await audioContext.resume();
            }

            analyser = audioContext.createAnalyser();
            analyser.smoothingTimeConstant = 0.3;
            analyser.fftSize = 512;
            
            microphone = audioContext.createMediaStreamSource(mediaStream);
            // Connect mic ONLY to analyser (not to destination to avoid feedback)
            microphone.connect(analyser);
            
            isMonitoring = true;
            startBtn.disabled = true;
            stopBtn.disabled = false;
            
            updateStatus('active', 'Monitoring: Keep talking!');
            silenceStart = Date.now();
            
            // Start audio monitoring loop
            monitorAudio();
            
        } catch (err) {
            console.error("Error accessing microphone or audio context", err);
            updateStatus('error', 'Microphone access denied or audio unavailable.');
            startBtn.disabled = false;
            stopBtn.disabled = true;
        }
    }

    function monitorAudio() {
        if (!isMonitoring || !analyser) return;

        const timeData = new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(timeData);

        // Calculate Root Mean Square (RMS) volume from time-domain waveform
        let sumSquares = 0;
        for (let i = 0; i < timeData.length; i++) {
            const normalized = (timeData[i] - 128) / 128; // -1.0 to 1.0
            sumSquares += normalized * normalized;
        }
        const rms = Math.sqrt(sumSquares / timeData.length);
        
        // Also sample frequency data for quick transient voice detection
        const freqData = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(freqData);
        let freqSum = 0;
        // Focus on vocal range (first 60 bins ~ up to 3kHz)
        const vocalBins = Math.min(60, freqData.length);
        for (let i = 0; i < vocalBins; i++) {
            freqSum += freqData[i];
        }
        const vocalAvg = freqSum / vocalBins; // 0 to 255
        
        // Scale combined metric smoothly to 0 - 100%
        const rmsScaled = rms * 300;
        const freqScaled = (vocalAvg / 180) * 100;
        const currentVolume = Math.min(100, Math.round(Math.max(rmsScaled, freqScaled)));

        volumeBar.style.width = `${currentVolume}%`;

        if (currentVolume >= threshold) {
            // Voice detected above threshold
            silenceStart = Date.now();
            if (isAlerting) {
                isAlerting = false;
                updateStatus('active', 'Monitoring: Keep talking!');
            }
        } else {
            // Volume is below threshold
            const silentFor = (Date.now() - silenceStart) / 1000;
            if (silentFor >= delaySeconds) {
                triggerAlert();
                silenceStart = Date.now(); // Reset interval for next alert beep
            }
        }

        animationFrameId = requestAnimationFrame(monitorAudio);
    }
    
    function stopMonitoring() {
        isMonitoring = false;
        
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
        
        volumeBar.style.width = '0%';
        startBtn.disabled = false;
        stopBtn.disabled = true;
        isAlerting = false;
        updateStatus('', 'Idle - Ready to start');
    }
    
    async function triggerAlert() {
        if (!isAlerting) {
            isAlerting = true;
            updateStatus('alerting', 'Silence detected! Think out loud!');
        }
        await playBeep();
    }
    
    async function playBeep() {
        try {
            const ctx = await ensureAudioContext();
            const now = ctx.currentTime;
            
            // Create a clear, pleasant, distinct two-tone alert chime (F5 698Hz -> A5 880Hz)
            const osc1 = ctx.createOscillator();
            const osc2 = ctx.createOscillator();
            const gainNode = ctx.createGain();

            osc1.type = 'sine';
            osc1.frequency.setValueAtTime(698.46, now); // F5
            osc1.frequency.exponentialRampToValueAtTime(880.00, now + 0.15); // A5

            osc2.type = 'triangle';
            osc2.frequency.setValueAtTime(1396.9, now); // F6 overtone
            osc2.frequency.exponentialRampToValueAtTime(1760.0, now + 0.15);

            // Envelope with audible gain
            gainNode.gain.setValueAtTime(0.0001, now);
            gainNode.gain.exponentialRampToValueAtTime(0.35, now + 0.03); // Quick crisp attack
            gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.35); // Smooth decay

            osc1.connect(gainNode);
            osc2.connect(gainNode);
            gainNode.connect(ctx.destination);

            osc1.start(now);
            osc2.start(now);
            osc1.stop(now + 0.36);
            osc2.stop(now + 0.36);
        } catch (e) {
            console.error("Failed to play alert sound:", e);
        }
    }
});
