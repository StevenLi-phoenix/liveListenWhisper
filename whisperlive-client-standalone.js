/**
 * Standalone WhisperLive JavaScript Client
 * Complete implementation in a single file to avoid CORS issues
 * Mirrors the functionality of the Python whisperlive_client.py
 */

class WhisperLiveClient {
    static INSTANCES = {};
    static END_OF_AUDIO = "END_OF_AUDIO";

    constructor(options = {}) {
        // Default configuration matching Python client
        this.host = options.host || 'localhost';
        this.port = options.port || 9090;
        this.language = options.lang || null;
        this.translate = options.translate || false;
        this.model = options.model || 'small';
        this.useVad = options.use_vad !== false; // Default true
        this.useWss = options.use_wss || false;
        this.logTranscription = options.log_transcription !== false; // Default true
        this.sendLastNSegments = options.send_last_n_segments || 10;
        this.noSpeechThresh = options.no_speech_thresh || 0.45;
        this.clipAudio = options.clip_audio || false;
        this.sameOutputThreshold = options.same_output_threshold || 10;
        this.transcriptionCallback = options.transcription_callback || null;
        this.enableTranslation = options.enable_translation || false;
        this.targetLanguage = options.target_language || 'fr';
        this.translationCallback = options.translation_callback || null;

        // Internal state
        this.uid = this.generateUID();
        this.recording = false;
        this.waiting = false;
        this.serverError = false;
        this.lastResponseReceived = null;
        this.disconnectIfNoResponseFor = 15000; // 15 seconds
        this.task = this.translate ? 'translate' : 'transcribe';
        this.lastSegment = null;
        this.lastReceivedSegment = null;
        this.transcript = [];
        this.translatedTranscript = [];
        this.serverBackend = null;

        // Audio processing
        this.audioContext = null;
        this.mediaStream = null;
        this.audioWorkletNode = null;
        this.sampleRate = 16000;
        this.chunkSize = 4096;

        // WebSocket
        this.websocket = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;

        // Audio processing state
        this.buffer = [];
        this.resampleBuffer = [];
        this.resampleIndex = 0;
        this.vadEnabled = true;
        this.silenceThreshold = 0.01;
        this.minSpeechSamples = 1600;
        this.speechBuffer = [];
        this.isSpeaking = false;

        WhisperLiveClient.INSTANCES[this.uid] = this;
    }

    generateUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    async start() {
        try {
            console.log('[INFO]: Starting WhisperLive client...');
            await this.initializeAudio();
            await this.connectWebSocket();
            console.log('[INFO]: * recording');
        } catch (error) {
            console.error('[ERROR]: Failed to start client:', error);
            throw error;
        }
    }

    async initializeAudio() {
        try {
            // Request microphone access
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: this.sampleRate,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });

            // Create AudioContext with fallback for older browsers
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContextClass({
                sampleRate: this.sampleRate
            });

            // Create inline AudioWorklet processor to avoid CORS
            const audioWorkletCode = `
                class AudioProcessor extends AudioWorkletProcessor {
                    constructor() {
                        super();
                        this.chunkSize = 4096;
                        this.sampleRate = 16000;
                        this.channels = 1;
                        this.buffer = [];
                        this.resampleBuffer = [];
                        this.inputSampleRate = globalThis.sampleRate;
                        this.resampleRatio = this.inputSampleRate / this.sampleRate;
                        this.resampleIndex = 0;
                        this.vadEnabled = true;
                        this.silenceThreshold = 0.01;
                        this.minSpeechSamples = 1600;
                        this.speechBuffer = [];
                        this.isSpeaking = false;
                        console.log(\`[AudioProcessor]: Initialized - Input: \${this.inputSampleRate}Hz, Output: \${this.sampleRate}Hz, Ratio: \${this.resampleRatio}\`);
                    }

                    process(inputs, outputs, parameters) {
                        const input = inputs[0];
                        if (!input || !input[0]) return true;

                        const inputData = input[0];
                        let processedData;

                        if (this.inputSampleRate !== this.sampleRate) {
                            processedData = this.resample(inputData);
                        } else {
                            processedData = inputData;
                        }

                        if (processedData && processedData.length > 0) {
                            this.buffer.push(...processedData);
                            
                            while (this.buffer.length >= this.chunkSize) {
                                const chunk = this.buffer.splice(0, this.chunkSize);
                                this.processChunk(chunk);
                            }
                        }

                        return true;
                    }

                    resample(inputData) {
                        const output = [];
                        
                        for (let i = 0; i < inputData.length; i++) {
                            this.resampleBuffer.push(inputData[i]);
                            
                            while (this.resampleIndex < this.resampleBuffer.length - 1) {
                                const index = Math.floor(this.resampleIndex);
                                const fraction = this.resampleIndex - index;
                                
                                if (index + 1 < this.resampleBuffer.length) {
                                    const sample = this.resampleBuffer[index] * (1 - fraction) + 
                                                 this.resampleBuffer[index + 1] * fraction;
                                    output.push(sample);
                                }
                                
                                this.resampleIndex += this.resampleRatio;
                            }
                            
                            if (this.resampleBuffer.length > 2) {
                                const samplesToRemove = Math.floor(this.resampleIndex);
                                this.resampleBuffer.splice(0, samplesToRemove);
                                this.resampleIndex -= samplesToRemove;
                            }
                        }
                        
                        return output;
                    }

                    processChunk(samples) {
                        let shouldSend = true;
                        
                        if (this.vadEnabled) {
                            shouldSend = this.applyVAD(samples);
                        }

                        if (shouldSend) {
                            const float32Array = new Float32Array(samples);
                            const arrayBuffer = float32Array.buffer.slice();
                            
                            this.port.postMessage({
                                type: 'audioData',
                                audioData: arrayBuffer,
                                sampleRate: this.sampleRate,
                                channels: this.channels,
                                samples: samples.length
                            });
                        }
                    }

                    applyVAD(samples) {
                        let sum = 0;
                        for (let i = 0; i < samples.length; i++) {
                            sum += samples[i] * samples[i];
                        }
                        const rms = Math.sqrt(sum / samples.length);
                        const isSpeech = rms > this.silenceThreshold;
                        
                        if (isSpeech) {
                            this.speechBuffer.push(...samples);
                            this.isSpeaking = true;
                            return true;
                        } else {
                            if (this.isSpeaking && this.speechBuffer.length > 0) {
                                if (this.speechBuffer.length >= this.minSpeechSamples) {
                                    const float32Array = new Float32Array(this.speechBuffer);
                                    const arrayBuffer = float32Array.buffer.slice();
                                    
                                    this.port.postMessage({
                                        type: 'audioData',
                                        audioData: arrayBuffer,
                                        sampleRate: this.sampleRate,
                                        channels: this.channels,
                                        samples: this.speechBuffer.length
                                    });
                                }
                                
                                this.speechBuffer = [];
                                this.isSpeaking = false;
                            }
                            
                            return false;
                        }
                    }

                    static get parameterDescriptors() {
                        return [];
                    }
                }

                registerProcessor('audio-processor', AudioProcessor);
            `;

            // Create blob URL for AudioWorklet
            const blob = new Blob([audioWorkletCode], { type: 'application/javascript' });
            const workletURL = URL.createObjectURL(blob);
            
            try {
                await this.audioContext.audioWorklet.addModule(workletURL);
            } finally {
                URL.revokeObjectURL(workletURL); // Clean up blob URL
            }

            this.audioWorkletNode = new AudioWorkletNode(this.audioContext, 'audio-processor');
            
            // Connect audio pipeline
            const source = this.audioContext.createMediaStreamSource(this.mediaStream);
            source.connect(this.audioWorkletNode);
            
            // Handle processed audio data
            this.audioWorkletNode.port.onmessage = (event) => {
                if (event.data.type === 'audioData' && this.recording) {
                    this.sendAudioData(event.data.audioData);
                }
            };

        } catch (error) {
            console.error('[ERROR]: Failed to initialize audio:', error);
            throw error;
        }
    }

    async connectWebSocket() {
        const protocol = this.useWss ? 'wss' : 'ws';
        const url = `${protocol}://${this.host}:${this.port}`;
        
        return new Promise((resolve, reject) => {
            this.websocket = new WebSocket(url);

            this.websocket.onopen = () => {
                console.log('[INFO]: Opened connection');
                this.onOpen();
                resolve();
            };

            this.websocket.onmessage = (event) => {
                this.onMessage(event.data);
            };

            this.websocket.onerror = (error) => {
                console.error('[ERROR]: WebSocket Error:', error);
                this.serverError = true;
                reject(error);
            };

            this.websocket.onclose = (event) => {
                console.log(`[INFO]: WebSocket connection closed: ${event.code}: ${event.reason}`);
                this.recording = false;
                this.waiting = false;
            };
        });
    }

    onOpen() {
        const config = {
            uid: this.uid,
            language: this.language,
            task: this.task,
            model: this.model,
            use_vad: this.useVad,
            send_last_n_segments: this.sendLastNSegments,
            no_speech_thresh: this.noSpeechThresh,
            clip_audio: this.clipAudio,
            same_output_threshold: this.sameOutputThreshold,
            enable_translation: this.enableTranslation,
            target_language: this.targetLanguage,
        };
        
        this.websocket.send(JSON.stringify(config));
    }

    onMessage(message) {
        try {
            const data = JSON.parse(message);

            if (this.uid !== data.uid) {
                console.error('[ERROR]: invalid client uid');
                return;
            }

            if (data.status) {
                this.handleStatusMessages(data);
                return;
            }

            if (data.message === 'DISCONNECT') {
                console.log('[INFO]: Server disconnected due to overtime.');
                this.recording = false;
                return;
            }

            if (data.message === 'SERVER_READY') {
                this.lastResponseReceived = Date.now();
                this.recording = true;
                this.serverBackend = data.backend;
                console.log(`[INFO]: Server Running with backend ${this.serverBackend}`);
                return;
            }

            if (data.language) {
                this.language = data.language;
                const langProb = data.language_prob;
                console.log(`[INFO]: Server detected language ${this.language} with probability ${langProb}`);
                return;
            }

            if (data.segments) {
                this.processSegments(data.segments, false);
            }

            if (data.translated_segments) {
                this.processSegments(data.translated_segments, true);
            }

        } catch (error) {
            console.error('[ERROR]: Failed to parse message:', error);
        }
    }

    handleStatusMessages(messageData) {
        const status = messageData.status;
        if (status === 'WAIT') {
            this.waiting = true;
            console.log(`[INFO]: Server is full. Estimated wait time ${Math.round(messageData.message)} minutes.`);
        } else if (status === 'ERROR') {
            console.log(`Message from Server: ${messageData.message}`);
            this.serverError = true;
        } else if (status === 'WARNING') {
            console.log(`Message from Server: ${messageData.message}`);
        }
    }

    processSegments(segments, translated = false) {
        const text = [];
        
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            if (text.length === 0 || text[text.length - 1] !== seg.text) {
                text.push(seg.text.trim());
                
                if (i === segments.length - 1 && !seg.completed) {
                    this.lastSegment = seg;
                } else if (this.serverBackend === 'faster_whisper' && seg.completed) {
                    if (translated) {
                        if (!this.translatedTranscript.length || 
                            parseFloat(seg.start) >= parseFloat(this.translatedTranscript[this.translatedTranscript.length - 1].end)) {
                            this.translatedTranscript.push(seg);
                        }
                    } else {
                        if (!this.transcript.length || 
                            parseFloat(seg.start) >= parseFloat(this.transcript[this.transcript.length - 1].end)) {
                            this.transcript.push(seg);
                        }
                    }
                }
            }
        }

        // Update last received segment and response time
        if (!translated && segments.length > 0) {
            const lastText = segments[segments.length - 1].text;
            if (!this.lastReceivedSegment || this.lastReceivedSegment !== lastText) {
                this.lastResponseReceived = Date.now();
                this.lastReceivedSegment = lastText;
            }
        }

        // Call callbacks
        if (translated) {
            if (this.translationCallback && typeof this.translationCallback === 'function') {
                try {
                    this.translationCallback(text.join(' '), segments);
                } catch (error) {
                    console.warn(`[WARN] translation_callback raised: ${error}`);
                }
            }
        } else {
            if (this.transcriptionCallback && typeof this.transcriptionCallback === 'function') {
                try {
                    this.transcriptionCallback(text.join(' '), segments);
                } catch (error) {
                    console.warn(`[WARN] transcription_callback raised: ${error}`);
                }
            }
        }

        // Log transcription if enabled
        if (this.logTranscription) {
            this.displayTranscription();
        }
    }

    displayTranscription() {
        const originalText = this.transcript.slice(-4).map(seg => seg.text);
        if (this.lastSegment && !originalText.includes(this.lastSegment.text)) {
            originalText.push(this.lastSegment.text);
        }

        console.clear();
        console.log('TRANSCRIPTION:');
        originalText.forEach(text => console.log(text));

        if (this.enableTranslation) {
            console.log(`\n\nTRANSLATION to ${this.targetLanguage}:`);
            this.translatedTranscript.slice(-4).forEach(seg => console.log(seg.text));
        }
    }

    sendAudioData(audioData) {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN && this.recording) {
            try {
                this.websocket.send(audioData);
            } catch (error) {
                console.error('[ERROR]: Failed to send audio data:', error);
            }
        }
    }

    stop() {
        console.log('[INFO]: Stopping WhisperLive client...');
        
        this.recording = false;

        // Send end of audio signal
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            const endSignal = new TextEncoder().encode(WhisperLiveClient.END_OF_AUDIO);
            this.websocket.send(endSignal);
        }

        // Clean up audio resources
        if (this.audioWorkletNode) {
            this.audioWorkletNode.disconnect();
            this.audioWorkletNode = null;
        }

        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }

        // Close WebSocket
        if (this.websocket) {
            this.websocket.close();
            this.websocket = null;
        }

        // Remove from instances
        delete WhisperLiveClient.INSTANCES[this.uid];

        console.log('[INFO]: Client stopped');
    }

    getTranscript() {
        return this.transcript;
    }

    getTranslatedTranscript() {
        return this.translatedTranscript;
    }

    isRecording() {
        return this.recording;
    }

    isWaiting() {
        return this.waiting;
    }

    hasServerError() {
        return this.serverError;
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WhisperLiveClient;
}