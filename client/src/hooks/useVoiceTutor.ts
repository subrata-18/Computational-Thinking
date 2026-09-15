import { useState, useRef, useCallback } from "react";

const getWebSocketUrl = (): string => {
  if (import.meta.env.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${window.location.hostname}:8001/ws/voice`;
};

export const useVoiceTutor = () => {
  const [status, setStatus] = useState<string>("Disconnected");
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [userBars, setUserBars] = useState<number[]>([15, 15, 15, 15, 15]);
  const [aiLevel, setAiLevel] = useState<number>(0);
  
  // Use a Ref for mute state so the audio processor closure always has the latest value
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const isMutedRef = useRef<boolean>(false); 

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const playContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const userAnalyserRef = useRef<AnalyserNode | null>(null);
  const aiAnalyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const turnEndingRef = useRef<boolean>(false);
  const playbackSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  const toggleMute = useCallback(() => {
    if (mediaStreamRef.current) {
      const track = mediaStreamRef.current.getAudioTracks()[0];
      if (track) {
        // 1. Physically mute the hardware track (outputs digital silence)
        track.enabled = !track.enabled; 
        
        // 2. Sync the React state with the hardware state
        const isNowMuted = !track.enabled;
        isMutedRef.current = isNowMuted;
        setIsMuted(isNowMuted);
        
        // 3. If muted, instantly tell Gemini the turn is over to prevent hallucination
        if (isNowMuted && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          if (!turnEndingRef.current) {
            turnEndingRef.current = true;
            wsRef.current.send("END_OF_SPEECH");
          }
        }
      }
    }
  }, []);

  const clearScheduledPlayback = useCallback(() => {
    for (const source of playbackSourcesRef.current) {
      try {
        source.stop();
      } catch {
        // The source may already have completed.
      }
    }

    playbackSourcesRef.current.clear();

    if (playContextRef.current) {
      nextPlayTimeRef.current = playContextRef.current.currentTime;
    } else {
      nextPlayTimeRef.current = 0;
    }
  }, []);

  const stopSession = useCallback(() => {
    clearScheduledPlayback();

    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    if (playContextRef.current) {
      playContextRef.current.close().catch(() => {});
      playContextRef.current = null;
    }

    setIsRecording(false);
    setUserBars([15, 15, 15, 15, 15]);
    setAiLevel(0);
    setStatus("Disconnected");

    turnEndingRef.current = false;
    isMutedRef.current = false;
    setIsMuted(false);
  }, [clearScheduledPlayback]);

  const startSession = useCallback(async () => {
    setStatus("Connecting...");
    turnEndingRef.current = false;
    isMutedRef.current = false;
    setIsMuted(false);

    try {
      const wsUrl = getWebSocketUrl();
      wsRef.current = new WebSocket(wsUrl);
      wsRef.current.binaryType = "arraybuffer";

      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

      // Playback context for AI (24kHz)
      const playCtx = new AudioCtx({ sampleRate: 24000 });
      playContextRef.current = playCtx;
      nextPlayTimeRef.current = 0;

      const aiAnalyser = playCtx.createAnalyser();
      aiAnalyser.fftSize = 64;
      aiAnalyser.smoothingTimeConstant = 0.8;
      aiAnalyser.connect(playCtx.destination);
      aiAnalyserRef.current = aiAnalyser;

      const updateVisuals = () => {
        if (aiAnalyserRef.current) {
          const aiData = new Uint8Array(aiAnalyserRef.current.frequencyBinCount);
          aiAnalyserRef.current.getByteFrequencyData(aiData);
          let sum = 0;
          for (let i = 0; i < aiData.length; i++) sum += aiData[i];
          const avg = sum / (aiData.length * 255);
          setAiLevel(avg);
        }

        if (userAnalyserRef.current) {
          const userData = new Uint8Array(userAnalyserRef.current.frequencyBinCount);
          userAnalyserRef.current.getByteFrequencyData(userData);
          const step = Math.floor(userData.length / 5) || 1;
          const bars = [0, 1, 2, 3, 4].map((i) => {
            const raw = userData[i * step] || 0;
            return Math.max(14, Math.min(85, Math.round((raw / 255) * 85)));
          });
          setUserBars(bars);
        }
        animFrameRef.current = requestAnimationFrame(updateVisuals);
      };

      wsRef.current.onopen = async () => {
        setStatus("Connected! Listening...");
        setIsRecording(true);

        try {
          mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ 
            audio: { echoCancellation: true, noiseSuppression: true } 
          });
          
          const recCtx = new AudioCtx({ sampleRate: 16000 });
          audioContextRef.current = recCtx;

          const source = recCtx.createMediaStreamSource(mediaStreamRef.current);
          const userAnalyser = recCtx.createAnalyser();
          userAnalyser.fftSize = 32;
          userAnalyser.smoothingTimeConstant = 0.7;
          source.connect(userAnalyser);
          userAnalyserRef.current = userAnalyser;

          const scriptProcessor = recCtx.createScriptProcessor(4096, 1, 1);
          scriptProcessorRef.current = scriptProcessor;

          source.connect(scriptProcessor);
          
          const gainNode = recCtx.createGain();
          gainNode.gain.value = 0; // Prevent hardware echo
          scriptProcessor.connect(gainNode);
          gainNode.connect(recCtx.destination);

          // Smart Noise Gate / VAD variables
          let silenceCount = 0;
          let isSpeaking = false;
          const SILENCE_THRESHOLD = 0.015; // Volume threshold
          const MAX_SILENCE_FRAMES = 6;    // ~1.5 seconds of silence

          scriptProcessor.onaudioprocess = (e) => {
            if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
            
            // 1. If muted, completely stop sending data.
            if (isMutedRef.current) return;

            // If the AI is actively speaking (or queued to speak) through the speakers,
            // drop the mic data completely to prevent an infinite Echo Loop!
            if (playbackSourcesRef.current.size > 0) {
              silenceCount = 0;
              isSpeaking = false;
              turnEndingRef.current = false;
              return; 
            }

            const inputData = e.inputBuffer.getChannelData(0);
            
            // 2. Check how loud the user is currently speaking
            let maxVol = 0;
            for (let i = 0; i < inputData.length; i++) {
              if (Math.abs(inputData[i]) > maxVol) maxVol = Math.abs(inputData[i]);
            }

            if (maxVol > SILENCE_THRESHOLD) {
              // User is actively talking
              silenceCount = 0;
              isSpeaking = true;
              turnEndingRef.current = false;
              
              const pcmData = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) {
                pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 32767;
              }
              wsRef.current.send(pcmData.buffer);
            } else {
              // User is quiet
              if (isSpeaking) {
                silenceCount++;
                if (
                  silenceCount > MAX_SILENCE_FRAMES &&
                  !turnEndingRef.current &&
                  wsRef.current.readyState === WebSocket.OPEN
                ) {
                  turnEndingRef.current = true;
                  wsRef.current.send("END_OF_SPEECH");
                  isSpeaking = false;
                } else {
                  // Send the trailing silence so words aren't cut off abruptly
                  const pcmData = new Int16Array(inputData.length);
                  for (let i = 0; i < inputData.length; i++) {
                    pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 32767;
                  }
                  wsRef.current.send(pcmData.buffer);
                }
              }
            }
          };

          animFrameRef.current = requestAnimationFrame(updateVisuals);
        } catch (err) {
          console.error("Microphone access denied:", err);
          setStatus("Microphone access denied.");
          stopSession();
        }
      };

      wsRef.current.onmessage = (event) => {
        if (!playContextRef.current || !aiAnalyserRef.current) return;

        const buffer = new Int16Array(event.data);
        const floatData = new Float32Array(buffer.length);
        for (let i = 0; i < buffer.length; i++) {
          floatData[i] = buffer[i] / 32768.0;
        }

        const audioBuffer = playContextRef.current.createBuffer(1, floatData.length, 24000);
        audioBuffer.copyToChannel(floatData, 0);

        const source = playContextRef.current.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(aiAnalyserRef.current);

        playbackSourcesRef.current.add(source);

        source.onended = () => {
          playbackSourcesRef.current.delete(source);
        };

        const currentTime = playContextRef.current.currentTime;
        if (nextPlayTimeRef.current < currentTime) {
          nextPlayTimeRef.current = currentTime;
        }

        source.start(nextPlayTimeRef.current);
        nextPlayTimeRef.current += audioBuffer.duration;
      };

      wsRef.current.onclose = () => {
        stopSession();
      };
    } catch (error) {
      console.error("WebSocket connection failed:", error);
      setStatus("Connection failed.");
      stopSession();
    }
  }, [stopSession]);

  return { status, isRecording, userBars, aiLevel, isMuted, startSession, stopSession, toggleMute };
};