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

    let isMonitoring = false;
    let isAlerting = false;

    let silenceStart = 0;
    let threshold = parseInt(thresholdSlider.value);
    let delaySeconds = parseFloat(delaySlider.value);

    // UI Updates for sliders
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

    function updateStatus(state, message) {
        statusPanel.className = 'status-panel'; // reset
        if (state) statusPanel.classList.add(state);
        statusText.textContent = message;
    }

    async function startMonitoring() {
        try {
            updateStatus('active', 'Requesting microphone...');

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: false
            });

            audioContext = new (
                window.AudioContext || window.webkitAudioContext
            )();

            analyser = audioContext.createAnalyser();
            microphone = audioContext.createMediaStreamSource(stream);
            javascriptNode = audioContext.createScriptProcessor(2048, 1, 1);

            analyser.smoothingTimeConstant = 0.8;
            analyser.fftSize = 1024;

            microphone.connect(analyser);
            analyser.connect(javascriptNode);
            javascriptNode.connect(audioContext.destination);

            isMonitoring = true;
            startBtn.disabled = true;
            stopBtn.disabled = false;

            updateStatus('active', 'Monitoring: Keep talking!');

            silenceStart = Date.now();

            javascriptNode.onaudioprocess = function() {
                if (!isMonitoring) return;

                const array = new Uint8Array(analyser.frequencyBinCount);
                analyser.getByteFrequencyData(array);

                let values = 0;
                const length = array.length;

                for (let i = 0; i < length; i++) {
                    values += (array[i]);
                }

                const average = values / length;

                // Average usually goes from 0 to about 100 roughly for normal talking,
                // normalize it to 0-100 scale more effectively for visualizer.
                const volumePercent = Math.min(
                    100,
                    Math.round((average / 128) * 100)
                );

                volumeBar.style.width = `${volumePercent}%`;

                if (volumePercent >= threshold) {
                    // We are talking above threshold
                    silenceStart = Date.now();

                    if (isAlerting) {
                        isAlerting = false;
                        updateStatus('active', 'Monitoring: Keep talking!');
                    }
                } else {
                    // We are silent
                    const silentFor =
                        (Date.now() - silenceStart) / 1000; // in seconds

                    if (silentFor >= delaySeconds) {
                        triggerAlert();
                        silenceStart = Date.now(); // Reset to beep again after delay
                    }
                }
            };

        } catch (err) {
            console.error("Error accessing microphone", err);
            updateStatus(
                'error',
                'Microphone access denied or unavailable.'
            );
            startBtn.disabled = false;
            stopBtn.disabled = true;
        }
    }

    function stopMonitoring() {
        isMonitoring = false;

        if (javascriptNode) {
            javascriptNode.disconnect();
            javascriptNode.onaudioprocess = null;
        }

        if (analyser) analyser.disconnect();

        if (microphone) {
            microphone.disconnect();
            microphone.mediaStream
                .getTracks()
                .forEach(track => track.stop());
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
            updateStatus(
                'alerting',
                'Silence detected! Think out loud!'
            );
        }

        playBeep();
    }

    function playBeep() {
        const ctx =
            audioContext && audioContext.state !== 'closed'
                ? audioContext
                : new (
                    window.AudioContext || window.webkitAudioContext
                )();

        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();

        osc.connect(gainNode);
        gainNode.connect(ctx.destination);

        // Louder and more noticeable beep
        osc.type = 'square';
        osc.frequency.setValueAtTime(900, ctx.currentTime);

        // Maximum practical Web Audio gain
        gainNode.gain.setValueAtTime(1.0, ctx.currentTime);

        gainNode.gain.exponentialRampToValueAtTime(
            0.001,
            ctx.currentTime + 0.3
        );

        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.3);
    }
});
