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
    let javascriptNode;
    let mediaStream;

    let isMonitoring = false;
    let isAlerting = false;

    let silenceStart = 0;
    let threshold = parseInt(thresholdSlider.value);
    let delaySeconds = parseFloat(delaySlider.value);

    // =========================
    // SLIDER CONTROLS
    // =========================

    thresholdSlider.addEventListener('input', (e) => {
        threshold = parseInt(e.target.value);
        thresholdValue.textContent = threshold;
        thresholdLine.style.left = `${threshold}%`;
    });

    delaySlider.addEventListener('input', (e) => {
        delaySeconds = parseFloat(e.target.value);
        delayValue.textContent = delaySeconds.toFixed(1);
    });

    startBtn.addEventListener('click', startMonitoring);
    stopBtn.addEventListener('click', stopMonitoring);

    // =========================
    // STATUS
    // =========================

    function updateStatus(state, message) {
        statusPanel.className = 'status-panel';

        if (state) {
            statusPanel.classList.add(state);
        }

        statusText.textContent = message;
    }

    // =========================
    // START MONITORING
    // =========================

    async function startMonitoring() {
        try {
            updateStatus('active', 'Requesting microphone...');

            mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: false
            });

            audioContext = new (
                window.AudioContext ||
                window.webkitAudioContext
            )();

            // Make sure the AudioContext is running
            if (audioContext.state === 'suspended') {
                await audioContext.resume();
            }

            analyser = audioContext.createAnalyser();

            microphone = audioContext.createMediaStreamSource(mediaStream);

            javascriptNode = audioContext.createScriptProcessor(
                2048,
                1,
                1
            );

            analyser.smoothingTimeConstant = 0.8;
            analyser.fftSize = 1024;

            microphone.connect(analyser);
            analyser.connect(javascriptNode);

            // Required so onaudioprocess continues firing
            javascriptNode.connect(audioContext.destination);

            isMonitoring = true;

            startBtn.disabled = true;
            stopBtn.disabled = false;

            updateStatus('active', 'Monitoring: Keep talking!');

            silenceStart = Date.now();

            // =========================
            // AUDIO PROCESSING
            // =========================

            javascriptNode.onaudioprocess = function () {
                if (!isMonitoring) return;

                const array = new Uint8Array(
                    analyser.frequencyBinCount
                );

                analyser.getByteFrequencyData(array);

                let values = 0;

                for (let i = 0; i < array.length; i++) {
                    values += array[i];
                }

                const average = values / array.length;

                const volumePercent = Math.min(
                    100,
                    Math.round((average / 128) * 100)
                );

                volumeBar.style.width = `${volumePercent}%`;

                // =========================
                // TALKING DETECTED
                // =========================

                if (volumePercent >= threshold) {
                    silenceStart = Date.now();

                    if (isAlerting) {
                        isAlerting = false;
                        updateStatus(
                            'active',
                            'Monitoring: Keep talking!'
                        );
                    }
                }

                // =========================
                // SILENCE DETECTED
                // =========================

                else {
                    const silentFor =
                        (Date.now() - silenceStart) / 1000;

                    if (silentFor >= delaySeconds) {
                        triggerAlert();

                        // Reset timer so the beep repeats
                        // after another silence period
                        silenceStart = Date.now();
                    }
                }
            };

        } catch (err) {
            console.error(
                'Error accessing microphone:',
                err
            );

            updateStatus(
                'error',
                'Microphone access denied or unavailable.'
            );

            startBtn.disabled = false;
            stopBtn.disabled = true;
        }
    }

    // =========================
    // STOP MONITORING
    // =========================

    function stopMonitoring() {
        isMonitoring = false;

        if (javascriptNode) {
            javascriptNode.disconnect();
            javascriptNode.onaudioprocess = null;
        }

        if (analyser) {
            analyser.disconnect();
        }

        if (microphone) {
            microphone.disconnect();
        }

        if (mediaStream) {
            mediaStream.getTracks().forEach((track) => {
                track.stop();
            });

            mediaStream = null;
        }

        if (
            audioContext &&
            audioContext.state !== 'closed'
        ) {
            audioContext.close();
        }

        audioContext = null;
        analyser = null;
        microphone = null;
        javascriptNode = null;

        volumeBar.style.width = '0%';

        startBtn.disabled = false;
        stopBtn.disabled = true;

        isAlerting = false;

        updateStatus(
            '',
            'Idle - Ready to start'
        );
    }

    // =========================
    // TRIGGER ALERT
    // =========================

    function triggerAlert() {
        if (!isAlerting) {
            isAlerting = true;

            updateStatus(
                'alerting',
                'Silence detected! Think out loud!'
            );
        }

        playBeep();
    }

    // =========================
    // MAXIMUM BEEP
    // =========================

    function playBeep() {
        if (!audioContext || audioContext.state === 'closed') {
            return;
        }

        // Resume AudioContext if necessary
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }

        const ctx = audioContext;

        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        const compressor = ctx.createDynamicsCompressor();

        // Connect:
        // Oscillator -> Gain -> Compressor -> Speakers
        oscillator.connect(gainNode);
        gainNode.connect(compressor);
        compressor.connect(ctx.destination);

        // Sharp alarm tone
        oscillator.type = 'square';

        // 900 Hz is much more noticeable than 400 Hz
        oscillator.frequency.setValueAtTime(
            900,
            ctx.currentTime
        );

        // Very strong compression helps make
        // the alarm consistently loud
        compressor.threshold.setValueAtTime(
            -10,
            ctx.currentTime
        );

        compressor.knee.setValueAtTime(
            0,
            ctx.currentTime
        );

        compressor.ratio.setValueAtTime(
            20,
            ctx.currentTime
        );

        compressor.attack.setValueAtTime(
            0.001,
            ctx.currentTime
        );

        compressor.release.setValueAtTime(
            0.05,
            ctx.currentTime
        );

        // HIGH OUTPUT LEVEL
        gainNode.gain.setValueAtTime(
            1.0,
            ctx.currentTime
        );

        // Very short fade-out
        gainNode.gain.exponentialRampToValueAtTime(
            0.001,
            ctx.currentTime + 0.18
        );

        oscillator.start(ctx.currentTime);

        oscillator.stop(
            ctx.currentTime + 0.18
        );
    }
});
