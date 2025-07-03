/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable no-unused-vars */
/* eslint-disable no-empty */
import React, { useRef, useState, useEffect, useContext } from "react";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSideBar";
import { SiteHeader } from "@/components/SiteHeader";
import { AppContext } from "@/context/AppContext";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import SessionAnalyticsModal from "@/components/SessionAnalyticsModal";
import {
  Activity,
  Clock,
  AlertTriangle,
  RotateCcw,
  BarChart3,
} from "lucide-react";
import toast from "react-hot-toast";
import VideoFeed from "@/components/VideoFeed";
import BehaviorAnalysisPanel from "@/components/BehaviorAnalysisPanel";
import MonitoringControls from "@/components/MonitoringControls";

const Dashboard = () => {
  const { backendUrl, userData, isLoggedIn } = useContext(AppContext);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  // State management
  const [monitoring, setMonitoring] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [timer, setTimer] = useState(0);
  const [stream, setStream] = useState(null);
  const [audioStream, setAudioStream] = useState(null);
  const [behaviorData, setBehaviorData] = useState({});
  const [alerts, setAlerts] = useState([]);
  const [error, setError] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [sessionHistory, setSessionHistory] = useState([]);
  const [selectedSessionAnalytics, setSelectedSessionAnalytics] =
    useState(null);
  const [showSessionAnalyticsModal, setShowSessionAnalyticsModal] =
    useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [timerIntervalId, setTimerIntervalId] = useState(null);
  const [isLoadingAnalytics, setIsLoadingAnalytics] = useState(false);

  // Behavior tracking
  const [currentBehaviors, setCurrentBehaviors] = useState({
    eye_gaze: { detected: false, confidence: 0 },
    sit_stand: { detected: false, confidence: 0 },
    tapping_hands: { detected: false, confidence: 0 },
    tapping_feet: { detected: false, confidence: 0 },
    rapid_talking: { detected: false, confidence: 0 },
  });

  // Tap counting state - tracks taps over 5 second periods
  const [tapCounter, setTapCounter] = useState({
    taps: 0,
    claps: 0,
    startTime: null,
    isActive: false,
    displayResults: false,
    lastDisplayTime: 0,
  });

  // Tap counter timer ref
  const tapTimerRef = useRef(null);

  // --- CONTINUOUS ANALYSIS ON 'ANALYZE NOW' ---
  const [manualAnalysisIntervalId, setManualAnalysisIntervalId] =
    useState(null);

  const audioAnalyserRef = useRef(null);
  const audioDataArrayRef = useRef(null);

  // Skip counting on very first analysis run to establish baseline
  const isFirstAnalysisRef = useRef(true);

  // ---------------- Speech Recognition for WPM ----------------
  const [wpmSeq, setWpmSeq] = useState([]);
  const [lastSpeechActivity, setLastSpeechActivity] = useState(Date.now());
  const [rapidTalkingStatus, setRapidTalkingStatus] =
    useState("⏸️ Click to start");
  const [speechRecognitionActive, setSpeechRecognitionActive] = useState(false);
  const [speechSessionStartTime, setSpeechSessionStartTime] = useState(null);
  // Duration for each speech-collection session (milliseconds)
  const SPEECH_SESSION_MS = 20_000; // 20-second window instead of full minute
  const [shouldKeepSpeechActive, setShouldKeepSpeechActive] = useState(false);
  const [sessionWordCount, setSessionWordCount] = useState(0);
  const sessionStartTimeRef = useRef(null);
  const speechRestartIntervalRef = useRef(null);

  // Motion detection for efficient sit-stand analysis
  const [lastFrame, setLastFrame] = useState(null);
  const [motionThreshold, setMotionThreshold] = useState(60); // Much higher - only major movements (was 30)

  // Declare ref near speechRecognizer ref
  const [speechRecognizer, setSpeechRecognizer] = useState(null);
  const speechStartingRef = useRef(false);

  const detectMotion = () => {
    if (!videoRef.current || !canvasRef.current) return false;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const video = videoRef.current;

    // Guard: video not ready yet
    if (!video.videoWidth || !video.videoHeight) {
      return false;
    }

    // Capture current frame
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);

    const currentImageData = ctx.getImageData(
      0,
      0,
      canvas.width,
      canvas.height
    );
    const currentPixels = currentImageData.data;

    if (!lastFrame) {
      setLastFrame(currentPixels);
      return false; // No comparison possible yet
    }

    // Focus on body/torso area for sit-stand detection (ignore hand/face movements)
    const bodyStartY = Math.floor(canvas.height * 0.25); // Start from neck/shoulders
    const bodyEndY = Math.floor(canvas.height * 0.9); // Include full legs
    const bodyStartX = Math.floor(canvas.width * 0.15); // Focus on center body area
    const bodyEndX = Math.floor(canvas.width * 0.85);

    let pixelDifference = 0;
    let pixelsChecked = 0;
    const sampleRate = 6; // More aggressive sampling for performance (was 4)

    // Only check body area for sit-stand motion
    for (let y = bodyStartY; y < bodyEndY; y += sampleRate) {
      for (let x = bodyStartX; x < bodyEndX; x += sampleRate) {
        const i = (y * canvas.width + x) * 4;
        if (i + 2 < currentPixels.length && i + 2 < lastFrame.length) {
          const rDiff = Math.abs(currentPixels[i] - lastFrame[i]);
          const gDiff = Math.abs(currentPixels[i + 1] - lastFrame[i + 1]);
          const bDiff = Math.abs(currentPixels[i + 2] - lastFrame[i + 2]);
          pixelDifference += (rDiff + gDiff + bDiff) / 3;
          pixelsChecked++;
        }
      }
    }

    const averageChange =
      pixelsChecked > 0 ? pixelDifference / pixelsChecked : 0;
    setLastFrame(currentPixels);

    const motionDetected = averageChange > motionThreshold;

    return motionDetected;
  };

  // Manual speech recognition starter with forced 1-minute session
  const startSpeechRecognitionManually = async () => {
    try {
      // If already in a session, don't start another
      if (shouldKeepSpeechActive) {
        setRapidTalkingStatus("🔄 Session already running...");
        return;
      }
      setRapidTalkingStatus("🔄 Requesting microphone access...");

      // Check if speech recognition is supported first
      if (
        !("webkitSpeechRecognition" in window || "SpeechRecognition" in window)
      ) {
        setRapidTalkingStatus("❌ Speech Recognition not supported");
        return;
      }

      // Request microphone permission first
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        setRapidTalkingStatus("✅ Starting 20-second collection...");
        stream.getTracks().forEach((track) => track.stop());
      } catch (permError) {
        setRapidTalkingStatus("❌ Microphone denied - click to retry");
        return;
      }

      // Start the speech collection session (20 s)
      const sessionStart = Date.now();
      setSpeechSessionStartTime(sessionStart);
      setShouldKeepSpeechActive(true);
      setSessionWordCount(0);
      sessionStartTimeRef.current = sessionStart;

      // Start the actual speech recognition
      startSpeechRecognition();

      // Restart recognizer automatically inside its 'onend' handler.
    } catch (error) {
      setSpeechRecognitionActive(false);
      setShouldKeepSpeechActive(false);
      setSpeechSessionStartTime(null);
      setSessionWordCount(0);
      setRapidTalkingStatus("❌ Microphone denied - click to retry");
    }
  };

  // Internal function to start actual speech recognition
  const startSpeechRecognition = () => {
    try {
      if (speechRecognitionActive || speechStartingRef.current) {
        // Already running or starting
        return;
      }
      speechStartingRef.current = true;

      const SpeechRecognition =
        window.SpeechRecognition || window.webkitSpeechRecognition;
      const recognizer = new SpeechRecognition();
      recognizer.continuous = true;
      recognizer.interimResults = true;
      recognizer.maxAlternatives = 1;
      recognizer.lang = "en-US";

      recognizer.onstart = () => {
        console.log("[Speech] recognizer started");
        setSpeechRecognitionActive(true);
        speechStartingRef.current = false;
      };

      recognizer.onresult = (e) => {
        setLastSpeechActivity(Date.now());

        let finalWordsInThisBatch = 0;
        let latestText = "";

        for (let i = e.resultIndex; i < e.results.length; ++i) {
          const transcript = e.results[i][0].transcript.trim();
          latestText = transcript;

          if (e.results[i].isFinal) {
            if (transcript.length > 0) {
              finalWordsInThisBatch += transcript.split(/\s+/).length;
            }
          }
        }

        // Debug: live WPM estimate
        const elapsedSec =
          (Date.now() - (sessionStartTimeRef.current || Date.now())) / 1000 ||
          1;
        const liveWpm =
          (sessionWordCount + finalWordsInThisBatch) / (elapsedSec / 60);
        console.log(
          `[Speech] live words=${
            sessionWordCount + finalWordsInThisBatch
          }  WPM≈${liveWpm.toFixed(1)}`
        );

        // Add final words to session count
        if (finalWordsInThisBatch > 0) {
          setSessionWordCount((prev) => prev + finalWordsInThisBatch);
        }

        // Update status with progress
        if (shouldKeepSpeechActive && sessionStartTimeRef.current) {
          const elapsedMs = Date.now() - sessionStartTimeRef.current;
          const remaining = Math.max(
            0,
            Math.ceil((SPEECH_SESSION_MS - elapsedMs) / 1000)
          );
          if (remaining > 0) {
            setRapidTalkingStatus(
              `🕐 Collecting... ${
                sessionWordCount + finalWordsInThisBatch
              } words (${remaining}s left)`
            );
          }
        }
      };

      recognizer.onerror = (event) => {
        // Chrome often emits benign 'aborted' / 'no-speech' errors when restarting – treat them as warnings
        if (event.error === "aborted" || event.error === "no-speech") {
          console.warn(`[Speech] benign error: ${event.error}`);
        } else {
          console.error("[Speech] recognizer error", event);
          toast.error(`Speech recognition error: ${event.error || "unknown"}`);
        }
        setSpeechRecognitionActive(false);
        speechStartingRef.current = false;

        // Auto-restart on benign errors (aborted / no-speech)
        const stillInWindow =
          shouldKeepSpeechActive &&
          speechSessionStartTime &&
          Date.now() - speechSessionStartTime < SPEECH_SESSION_MS;

        if (stillInWindow) {
          setTimeout(() => startSpeechRecognition(), 500);
        } else if (shouldKeepSpeechActive) {
          completeSpeechSession();
        }
      };

      recognizer.onend = () => {
        console.log("[Speech] recognizer ended");
        setSpeechRecognitionActive(false);
        speechStartingRef.current = false;
        // Auto-restart if session still active within window
        const stillInWindow =
          shouldKeepSpeechActive &&
          speechSessionStartTime &&
          Date.now() - speechSessionStartTime < SPEECH_SESSION_MS;

        if (stillInWindow) {
          setTimeout(() => startSpeechRecognition(), 500);
        } else if (shouldKeepSpeechActive) {
          completeSpeechSession();
        }
      };

      recognizer.start();
      setSpeechRecognizer(recognizer);
    } catch (error) {
      setSpeechRecognitionActive(false);
    }
  };

  // Complete the speech session and calculate WPM
  const completeSpeechSession = () => {
    // Stop everything
    setShouldKeepSpeechActive(false);
    setSpeechSessionStartTime(null);
    setSpeechRecognitionActive(false);

    console.log(
      `[Speech] session complete – words=${sessionWordCount}, duration=${SPEECH_SESSION_MS} ms`
    );

    // Calculate final WPM based on actual session duration
    const minutes = SPEECH_SESSION_MS / 60000;
    const finalWpm = minutes > 0 ? sessionWordCount / minutes : 0;

    // Updated thresholds – Rapid talking ≥ 180 WPM, Fast talking ≥ 150 WPM
    const rapidTalkingThreshold = 180;
    const fastTalkingThreshold = 150;

    if (finalWpm >= rapidTalkingThreshold) {
      setRapidTalkingStatus(`🚨 RAPID TALKING: ${finalWpm.toFixed(1)} WPM!`);

      setWpmSeq((prev) => {
        const newArr = [...prev, finalWpm].slice(-10);

        // Trigger rapid talking analysis
        setTimeout(() => {
          analyzeBehavior("rapid_talking");
        }, 10);

        return newArr;
      });
    } else if (finalWpm >= fastTalkingThreshold) {
      setRapidTalkingStatus(`⚡ Fast: ${finalWpm.toFixed(1)} WPM`);
      setWpmSeq((prev) => [...prev, finalWpm].slice(-10));
    } else {
      setRapidTalkingStatus(`🎤 Normal: ${finalWpm.toFixed(1)} WPM`);
      setWpmSeq((prev) => [...prev, finalWpm].slice(-10));
    }

    // Reset for next session
    setSessionWordCount(0);
  };

  // Stop speech recognition
  const stopSpeechRecognition = () => {
    setShouldKeepSpeechActive(false);
    setSpeechSessionStartTime(null);
    setSessionWordCount(0);
    setSpeechRecognitionActive(false);

    // No restart interval now

    setRapidTalkingStatus("⏸️ Stopped - click to start");
  };

  // Clear old WPM data after 30 seconds of silence
  useEffect(() => {
    const interval = setInterval(() => {
      const timeSinceLastSpeech = Date.now() - lastSpeechActivity;
      if (timeSinceLastSpeech > 30000 && wpmSeq.length > 0) {
        // 30 seconds
        setWpmSeq([]);
      }
    }, 5000); // Check every 5 seconds

    return () => clearInterval(interval);
  }, [lastSpeechActivity, wpmSeq.length]);

  // Helper to start microphone stream
  const initAudio = async () => {
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(micStream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      const bufferLength = analyser.fftSize;
      const dataArray = new Uint8Array(bufferLength);

      source.connect(analyser);

      audioAnalyserRef.current = analyser;
      audioDataArrayRef.current = dataArray;
      setAudioStream(micStream);
    } catch (_e) {
      toast.error(
        "Microphone access denied – rapid talking detection disabled"
      );
    }
  };

  // Check microphone permissions and capabilities
  const checkMicrophoneStatus = async () => {
    try {
      // Check if Web Speech API is supported
      const speechSupported =
        "webkitSpeechRecognition" in window || "SpeechRecognition" in window;

      // Check microphone permission
      if (navigator.permissions) {
        const permission = await navigator.permissions.query({
          name: "microphone",
        });
      }

      // Test if we can access microphone
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });

        // Test audio levels
        const audioContext = new (window.AudioContext ||
          window.webkitAudioContext)();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        // Monitor audio levels for 2 seconds
        let maxVolume = 0;
        const testDuration = 2000; // 2 seconds
        const startTime = Date.now();

        const checkAudio = () => {
          analyser.getByteFrequencyData(dataArray);
          const volume =
            dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
          maxVolume = Math.max(maxVolume, volume);

          if (Date.now() - startTime < testDuration) {
            requestAnimationFrame(checkAudio);
          } else {
            // Clean up
            audioContext.close();
            stream.getTracks().forEach((track) => track.stop());
          }
        };

        checkAudio();

        return true;
      } catch (error) {
        return false;
      }
    } catch (error) {
      return false;
    }
  };

  // Extract audio features and detect actual speech
  const getAudioFeatures = () => {
    const analyser = audioAnalyserRef.current;
    const dataArray = audioDataArrayRef.current;
    if (!analyser || !dataArray) return null;

    analyser.getByteTimeDomainData(dataArray);
    // Compute RMS volume
    let sumSquares = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const centered = dataArray[i] - 128;
      sumSquares += centered * centered;
    }
    const rms = Math.sqrt(sumSquares / dataArray.length) / 128; // 0-1

    // Frequency domain
    const freqArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(freqArray);
    let spectralSum = 0;
    for (let i = 0; i < freqArray.length; i++) spectralSum += freqArray[i];
    const spectralAvg = spectralSum / freqArray.length / 255; // 0-1

    // Simple zero-cross rate approximation
    let zeroCross = 0;
    for (let i = 1; i < dataArray.length; i++) {
      const prev = dataArray[i - 1] - 128;
      const curr = dataArray[i] - 128;
      if ((prev >= 0 && curr < 0) || (prev < 0 && curr >= 0)) zeroCross += 1;
    }
    const zcr = zeroCross / dataArray.length; // 0-1

    // SPEECH DETECTION: Check if there's actual speech activity
    const speechThreshold = 0.03; // Minimum RMS for speech (increased from 0.02)
    const spectralThreshold = 0.08; // Minimum spectral activity for speech (increased from 0.05)
    const combinedActivity = (rms + spectralAvg) / 2; // Combined activity metric
    const isSpeaking =
      rms > speechThreshold &&
      spectralAvg > spectralThreshold &&
      combinedActivity > 0.04;

    return {
      features: [rms, spectralAvg, zcr, 0, 0, 0],
      isSpeaking: isSpeaking,
      volume: rms,
      spectralActivity: spectralAvg,
    };
  };

  // Capture a sequence of frames from the video element
  const captureFrameSequence = (numFrames = 10) => {
    return new Promise((resolve) => {
      const frames = [];
      const captureInterval = 33; // 30fps - much faster for better tap detection (was 150ms)
      const imageQuality = 0.9; // Higher quality for better full-body analysis

      const captureFrame = () => {
        if (!videoRef.current || frames.length >= numFrames) {
          resolve(frames);
          return;
        }

        try {
          const canvas = canvasRef.current;
          const video = videoRef.current;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });

          // Set canvas size to match video (now supporting higher resolution)
          canvas.width = video.videoWidth || 1280;
          canvas.height = video.videoHeight || 720;

          // Draw current frame
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          // Convert to base64 with higher quality for better full-body analysis
          const dataURL = canvas.toDataURL("image/jpeg", imageQuality);
          frames.push(dataURL);

          // Capture next frame faster for better temporal resolution
          setTimeout(captureFrame, captureInterval);
        } catch (error) {
          console.error("Frame capture error:", error);
          resolve(frames);
        }
      };

      captureFrame();
    });
  };

  // Analyze behavior using server-side Python ML with real video frame analysis
  const analyzeBehavior = async (behaviorType) => {
    try {
      // Image-based behaviors - use current video frame
      if (
        ["eye_gaze", "tapping_hands", "tapping_feet", "sit_stand"].includes(
          behaviorType
        )
      ) {
        if (!videoRef.current) {
          return null;
        }

        // Capture current video frame as base64
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        canvas.width = videoRef.current.videoWidth || 1280;
        canvas.height = videoRef.current.videoHeight || 720;

        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        const frameData = canvas.toDataURL("image/jpeg", 0.9);

        // Use the improved frame capture with better temporal resolution
        const frameSequence = await captureFrameSequence(12); // 12 frames for better accuracy

        if (!frameSequence || frameSequence.length === 0) {
          return null;
        }
        // Call real Python ML API
        const response = await fetch(`${backendUrl}/api/ml/analyze`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            behaviorType: behaviorType,
            frame_sequence: frameSequence,
            frame: frameData,
          }),
        });

        if (!response.ok) {
          throw new Error(`ML API error: ${response.status}`);
        }

        const result = await response.json();

        // Convert server response to expected format based on behavior type
        let detected = false;
        let confidence = 0;

        if (behaviorType === "tapping_hands") {
          detected = result.handTapping || false;
          confidence = result.confidence?.handTapping || 0;
        } else if (behaviorType === "eye_gaze") {
          detected = result.eyeGaze || false;
          confidence = result.confidence?.eyeGaze || 0;
        } else if (behaviorType === "tapping_feet") {
          detected = result.footTapping || false;
          confidence = result.confidence?.footTapping || 0;
        } else if (behaviorType === "sit_stand") {
          detected = result.sitStand || false;
          confidence = result.confidence?.sitStand || 0;
        } else if (behaviorType === "rapid_talking") {
          detected = result.rapidTalking || false;
          confidence = result.confidence?.rapidTalking || 0;
        }

        const analysis = {
          behavior_type: behaviorType,
          detected: detected,
          confidence: confidence,
          tap_count: result.tapCount || 0,
          clap_count: result.clapCount || 0,
          timestamp: result.timestamp || new Date().toISOString(),
        };

        return analysis;
      } else if (behaviorType === "rapid_talking") {
        // Audio-based behavior analysis - only when actually speaking
        const audioData = getAudioFeatures();
        if (!audioData) {
          return null;
        }

        // Always compute audio activity fallback
        const activityScore =
          (audioData.volume + audioData.spectralActivity) / 2;

        // Slightly lower threshold so fallback triggers more reliably
        if (activityScore > 0.07 && audioData.isSpeaking) {
          const estimatedConfidence = Math.min(0.5, activityScore * 3);
          return {
            behavior_type: behaviorType,
            confidence: estimatedConfidence,
            detected: estimatedConfidence > 0.25,
            timestamp: new Date().toISOString(),
            fallback: true,
            audioActivity: activityScore,
          };
        }

        let wpmData = null;

        if (wpmSeq.length >= 1) {
          // Use WPM data from 20-second collections
          const recentWpm = wpmSeq.slice(-3);
          const avgWpm =
            recentWpm.reduce((a, b) => a + b, 0) / recentWpm.length;
          wpmData = recentWpm;

          // Only proceed if speech exceeds 180 WPM threshold for rapid talking
          if (avgWpm < 180) {
            let status = "";
            if (avgWpm >= 150) {
              status = `⚡ Fast: ${avgWpm.toFixed(1)} WPM`;
            } else {
              status = `🎤 Normal: ${avgWpm.toFixed(1)} WPM`;
            }
            setRapidTalkingStatus(status);
            return {
              behavior_type: behaviorType,
              confidence: 0.1,
              detected: false,
              timestamp: new Date().toISOString(),
              message: `Normal speaking pace (${avgWpm.toFixed(1)} WPM)`,
              wpm: avgWpm,
            };
          }

          setRapidTalkingStatus(`🚨 RAPID TALKING: ${avgWpm.toFixed(1)} WPM`);
        } else {
          // NO FAKE DATA - return no detection if no real speech
          setRapidTalkingStatus(
            `⏸️ No 1-min data (${wpmSeq.length} measurements)`
          );
          return {
            behavior_type: behaviorType,
            confidence: 0,
            detected: false,
            timestamp: new Date().toISOString(),
            message: `No 1-minute speech data for analysis`,
          };
        }

        const requestBody = {
          behaviorType: behaviorType,
          data: wpmData,
        };

        const response = await fetch(`${backendUrl}/api/ml/analyze`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`❌ API Error Response:`, errorText);
          throw new Error(`ML API error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();

        // Enhanced debugging for rapid talking results
        if (result.detected) {
          setRapidTalkingStatus(
            `🎯 DETECTED! ${(result.confidence * 100).toFixed(1)}% confidence`
          );
        } else {
          setRapidTalkingStatus(
            `❌ Not detected (${(result.confidence * 100).toFixed(
              1
            )}% confidence)`
          );
        }

        return result.analysis || result;
      }

      return null;
    } catch (error) {
      // Fallback to basic detection if API fails
      const confidence = Math.random() * 0.3 + 0.1;
      return {
        behavior_type: behaviorType,
        confidence: confidence,
        detected: confidence > 0.25,
        timestamp: new Date().toISOString(),
        message: `Fallback detection (Python ML API failed): ${error.message}`,
      };
    }
  };

  // Run behavioral analysis using real Python ML
  const runBehavioralAnalysis = async () => {
    if (!monitoring) {
      return;
    }

    // Don't set isAnalyzing here - it should stay true during entire monitoring session

    try {
      const behaviorTypes = [
        "eye_gaze",
        "tapping_hands",
        "tapping_feet",
        "rapid_talking",
        "sit_stand", // Added back - continuous monitoring with transition-only logic
      ];

      let results = [];

      // Analyze each behavior individually using real Python ML
      const analysisPromises = behaviorTypes.map(async (behaviorType) => {
        try {
          const result = await analyzeBehavior(behaviorType);

          return result;
        } catch (error) {
          console.error(`❌ Error analyzing ${behaviorType}:`, error);
          return {
            behavior_type: behaviorType,
            confidence: 0,
            detected: false,
            timestamp: new Date().toISOString(),
            message: `Python ML analysis failed: ${error.message}`,
          };
        }
      });

      // Wait for all analyses to complete
      const analysisResults = await Promise.all(analysisPromises);
      results = analysisResults.filter((r) => r !== null);

      // Reset current behavior snapshot for this cycle
      const newBehaviors = {};

      behaviorTypes.forEach((bt) => {
        newBehaviors[bt] = { detected: false, confidence: 0 };
      });

      const newAlerts = [...alerts];
      const incrementMap = {};

      results.forEach((result, idx) => {
        const behaviorType = result?.behavior_type || behaviorTypes[idx];

        if (!result) {
          return; // keep default false
        }

        // Update current behaviors
        newBehaviors[behaviorType] = {
          detected: Boolean(result.detected),
          confidence: parseFloat(result.confidence || result.probability || 0),
        };
        // SPECIAL DEBUGGING for hand_tapping pattern analysis
        if (behaviorType === "tapping_hands") {
          if (result.analysis_type === "pattern_recognition") {
            if (result.detected) {
              // TAP COUNTING LOGIC - Accumulate taps over 5 seconds
              const currentTime = Date.now();
              const tapCount = result.tap_count || 0;
              const clapCount = result.clap_count || 0;

              if (tapCount > 0 || clapCount > 0) {
                setTapCounter((prev) => {
                  let newCounter = { ...prev };

                  // Start new counting session if not active
                  if (!prev.isActive || currentTime - prev.startTime > 6000) {
                    newCounter = {
                      taps: tapCount,
                      claps: clapCount,
                      startTime: currentTime,
                      isActive: true,
                      displayResults: false,
                      lastDisplayTime: 0,
                    };

                    // Clear any existing timer
                    if (tapTimerRef.current) {
                      clearTimeout(tapTimerRef.current);
                    }

                    // Set timer to display results after 5 seconds
                    tapTimerRef.current = setTimeout(() => {
                      setTapCounter((counter) => ({
                        ...counter,
                        displayResults: true,
                        lastDisplayTime: Date.now(),
                      }));

                      // Auto-hide results after 3 seconds
                      setTimeout(() => {
                        setTapCounter((counter) => ({
                          ...counter,
                          displayResults: false,
                          isActive: false,
                        }));
                      }, 3000);
                    }, 5000);
                  } else {
                    // Add to existing session
                    newCounter.taps += tapCount;
                    newCounter.claps += clapCount;
                  }

                  return newCounter;
                });
              }
            }
          }
        }

        // Record increments to apply after loop to avoid stale closure
        if (!incrementMap[behaviorType]) {
          incrementMap[behaviorType] = { inc: 0, conf: 0 };
        }
        if (result.detected) {
          incrementMap[behaviorType].inc += 1;
          incrementMap[behaviorType].conf +=
            result.confidence || result.probability || 0;
        }

        // Create alert if confidence is high enough
        const confidence = result.confidence || result.probability || 0;
        if (result.detected && confidence > 0.4) {
          const alert = {
            id: Date.now() + Math.random(),
            behavior: behaviorType,
            confidence: confidence,
            timestamp: new Date().toISOString(),
          };
          newAlerts.unshift(alert);

          // Keep only last 10 alerts
          if (newAlerts.length > 10) {
            newAlerts.pop();
          }
        }
      });

      setCurrentBehaviors(newBehaviors);
      setAlerts(newAlerts);

      // Apply increments using functional state update to get latest counts
      setBehaviorData((prev) => {
        const updated = { ...prev };
        behaviorTypes.forEach((bt) => {
          if (!updated[bt]) {
            updated[bt] = { count: 0, totalConfidence: 0 };
          }
          const incInfo = incrementMap[bt];
          if (incInfo) {
            updated[bt].count += incInfo.inc;
            updated[bt].totalConfidence += incInfo.conf;
          }
        });
        return updated;
      });

      // No baseline skipping now
    } catch (error) {}
  };

  // Initialize dashboard
  useEffect(() => {
    if (userData?.id) {
      loadSessionHistory();
    }
    checkCameraAvailability();
    checkMicrophoneStatus();
  }, [userData?.id]);

  // Cleanup effect to stop camera when component unmounts
  useEffect(() => {
    return () => {
      // Only clean up on unmount, not on every stream change!
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      if (timerIntervalId) {
        clearInterval(timerIntervalId);
      }
    };
  }, []);

  // Attach stream to video element and play when stream changes
  useEffect(() => {
    if (videoRef.current && stream && stream.active) {
      if (videoRef.current.srcObject !== stream) {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true;
        videoRef.current.playsInline = true;
        videoRef.current.autoplay = true;
        videoRef.current.play().catch(() => {
          toast("Click anywhere on the page to enable camera playback.");
        });
      }
    }
  }, [stream]);

  // Monitor stream health and reacquire if lost
  useEffect(() => {
    if (monitoring && stream) {
      const healthInterval = setInterval(async () => {
        const videoTracks = stream.getVideoTracks();
        if (
          !stream.active ||
          videoTracks.length === 0 ||
          videoTracks[0].readyState !== "live"
        ) {
          toast.error("Camera stream lost. Attempting to reacquire...");
          try {
            const newStream = await navigator.mediaDevices.getUserMedia({
              video: {
                width: { ideal: 1920, min: 640 }, // Wide resolution, fallback to lower if needed
                height: { ideal: 1080, min: 480 }, // Wide height, fallback to lower if needed
                frameRate: { ideal: 30, min: 15 },
                facingMode: "user", // Front-facing camera
              },
              audio: false,
            });
            setStream(newStream);
            if (videoRef.current) {
              videoRef.current.srcObject = newStream;
              videoRef.current.play().catch(() => {
                /* ignored autoplay failure */
              });
            }
            toast.success("Camera stream reacquired!");
          } catch (_e) {
            toast.error(
              "Failed to reacquire camera. Please check your camera."
            );
          }
        }
      }, 5000);
      return () => clearInterval(healthInterval);
    }
  }, [monitoring, stream]);

  // Load session history
  const loadSessionHistory = async () => {
    if (!userData?.id) {
      console.warn("⚠️ loadSessionHistory: No user ID available");
      return;
    }

    try {
      const response = await fetch(
        `${backendUrl}/api/session/user/${userData.id}`,
        {
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (response.ok) {
        const data = await response.json();

        setSessionHistory(data.sessions || []);
      } else {
        const errorData = await response
          .json()
          .catch(() => ({ message: "Unknown error" }));
        console.error(
          `❌ Failed to load session history:`,
          response.status,
          errorData
        );

        if (response.status === 401) {
          console.warn("🔐 Authentication required for session history");
        }
      }
    } catch (error) {
      console.error("🚨 Error loading session history:", error);
    }
  };

  // Load analytics for a specific session
  const loadSessionAnalytics = async (sessionId) => {
    try {
      setIsLoadingAnalytics(true);
      setSelectedSessionAnalytics(null);
      setShowSessionAnalyticsModal(true); // Show modal immediately with loading state

      const response = await fetch(
        `${backendUrl}/api/session/${sessionId}/analytics`,
        {
          method: "GET",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (response.ok) {
        const data = await response.json();

        // Add a small delay for smooth transition
        setTimeout(() => {
          setSelectedSessionAnalytics(data.analytics);
          setIsLoadingAnalytics(false);
        }, 300);
      } else {
        const errorData = await response.text();
        console.error(
          `❌ Failed to load session analytics: ${response.status}`,
          errorData
        );

        setIsLoadingAnalytics(false);
        setShowSessionAnalyticsModal(false);

        if (response.status === 401) {
          console.warn("🔐 Authentication required for session analytics");
          toast.error("Please log in to view session analytics");
        } else {
          toast.error(`Failed to load session analytics (${response.status})`);
        }
      }
    } catch (error) {
      console.error("🚨 Error loading session analytics:", error);
      setIsLoadingAnalytics(false);
      setShowSessionAnalyticsModal(false);
      toast.error("Error loading session analytics");
    }
  };

  // Create new monitoring session
  const createSession = async () => {
    try {
      const response = await fetch(`${backendUrl}/api/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          userId: userData?.id,
          userName: userData?.name || userData?.email,
          startTime: new Date().toISOString(),
          status: "active",
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setSessionId(data.session.id);
        return data.session.id;
      } else {
        /* return null on non-OK */
        return null;
      }
    } catch (_e) {
      /* ignored session creation error */
      toast.error("Session creation failed, but monitoring will continue");
      return null;
    }
  };

  // Start monitoring
  const startMonitoring = async () => {
    setError("");
    setAlerts([]);
    setBehaviorData({}); // Reset behavior data for new session
    setCurrentBehaviors({
      eye_gaze: { detected: false, confidence: 0 },
      sit_stand: { detected: false, confidence: 0 },
      tapping_hands: { detected: false, confidence: 0 },
      tapping_feet: { detected: false, confidence: 0 },
      rapid_talking: { detected: false, confidence: 0 },
    });

    // If already monitoring, stop first
    if (monitoring && stream) {
      await stopMonitoring();
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    try {
      const userStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1920, min: 640 }, // Wide resolution, fallback to lower if needed
          height: { ideal: 1080, min: 480 }, // Wide height, fallback to lower if needed
          frameRate: { ideal: 30, min: 15 },
          facingMode: "user", // Front-facing camera
        },
        audio: false,
      });
      setStream(userStream);
      initAudio();
      // 3. Attach stream to video element if not already attached
      if (videoRef.current && videoRef.current.srcObject !== userStream) {
        videoRef.current.srcObject = userStream;
        videoRef.current.muted = true;
        videoRef.current.playsInline = true;
        videoRef.current.autoplay = true;
        try {
          await videoRef.current.play();
          setVideoPlaying(true);
        } catch (_e) {
          setVideoPlaying(false);
          toast("Click anywhere on the page to enable camera playback.");
        }
      }
      // 5. Set monitoring state
      setMonitoring(true);
      setIsAnalyzing(true); // Set analyzing state to true for entire monitoring session
      // 6. Start session
      const newSessionId = await createSession();
      setSessionId(newSessionId);
      // 7. Start timer and analysis intervals
      const startTime = Date.now();
      const interval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        setTimer(elapsed);
      }, 1000);
      setTimerIntervalId(interval);

      // Start real-time ML analysis using continuous frame processing
      const startRealTimeAnalysis = () => {
        let lastAnalysisTime = 0;
        let lastMotionCheckTime = 0;
        let lastSitStandTime = 0;
        const analysisThrottle = 200; // Process every 200ms for responsive real-time feel
        const motionCheckThrottle = 500; // Check for motion every 500ms
        const sitStandCooldown = 8000; // Minimum 8 s between sit-stand analyses to prevent frequent state polling

        const analyzeFrame = () => {
          const now = Date.now();

          // Run frequent behaviors (eye gaze, tapping, rapid talking) every 200ms
          if (
            now - lastAnalysisTime >= analysisThrottle &&
            videoRef.current &&
            !videoRef.current.paused &&
            !videoRef.current.ended
          ) {
            runFrequentBehaviorAnalysis();
            lastAnalysisTime = now;
          }

          // Check for motion every 500ms and trigger sit-stand analysis only when motion is detected
          if (
            now - lastMotionCheckTime >= motionCheckThrottle &&
            now - lastSitStandTime >= sitStandCooldown &&
            videoRef.current &&
            !videoRef.current.paused &&
            !videoRef.current.ended
          ) {
            const motionDetected = detectMotion();
            lastMotionCheckTime = now;

            if (motionDetected) {
              runSitStandAnalysis();
              lastSitStandTime = now;
            }
          }

          // Continue the real-time loop if still monitoring
          if (monitoring) {
            requestAnimationFrame(analyzeFrame);
          }
        };

        // Start the real-time analysis loop
        requestAnimationFrame(analyzeFrame);
      };

      // Start real-time analysis
      startRealTimeAnalysis();

      // Auto-start speech recognition for monitoring session
      if (!shouldKeepSpeechActive) {
        setTimeout(() => {
          startSpeechRecognitionManually();
        }, 1500); // Longer delay to ensure monitoring is fully started
      }

      // Initial analysis after 1 second (faster initial response)
      setTimeout(() => {
        runFrequentBehaviorAnalysis(); // Start with frequent behaviors
        setTimeout(() => {
          runSitStandAnalysis(); // Add sit-stand shortly after
        }, 500);
      }, 1000);

      toast.success("Camera Connected");
    } catch (_e) {
      /* ignored start monitoring error */
      let errorMessage = "Could not access camera.";
      setError(errorMessage);
      setMonitoring(false);
      setIsAnalyzing(false); // Reset analyzing state on error
      setVideoPlaying(false);
      toast.error("Failed to start monitoring: " + errorMessage);
    }
  };

  // Stop monitoring
  const stopMonitoring = async () => {
    try {
      setMonitoring(false);
      setIsAnalyzing(false); // Stop analyzing state when monitoring stops

      // Real-time analysis stops automatically when monitoring becomes false (uses requestAnimationFrame)

      // Clear manual analysis interval
      if (manualAnalysisIntervalId) {
        clearInterval(manualAnalysisIntervalId);
        setManualAnalysisIntervalId(null);
      }

      // Clear timer interval
      if (timerIntervalId) {
        clearInterval(timerIntervalId);
        setTimerIntervalId(null);
      }

      // Clear tap counter timer
      if (tapTimerRef.current) {
        clearTimeout(tapTimerRef.current);
        tapTimerRef.current = null;
      }

      // Reset tap counter state
      setTapCounter({
        taps: 0,
        claps: 0,
        startTime: null,
        isActive: false,
        displayResults: false,
        lastDisplayTime: 0,
      });

      // Stop video stream
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        setStream(null);
      }

      // Stop audio stream
      if (audioStream) {
        audioStream.getTracks().forEach((track) => track.stop());
        setAudioStream(null);
      }

      // Clear video element
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }

      // Stop speech recognition when monitoring stops
      if (speechRecognitionActive || shouldKeepSpeechActive) {
        stopSpeechRecognition();
      }

      // Update session if active
      if (sessionId) {
        // Also log the raw JSON that will be sent
        const sessionPayload = {
          endTime: new Date().toISOString(),
          duration: formatDuration(timer),
          status: "completed",
          behaviorData: behaviorData,
          alerts: alerts,
        };

        await fetch(`${backendUrl}/api/session/${sessionId}/end`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify(sessionPayload),
        });
        setSessionId(null);
      }

      setTimer(0);
      setVideoPlaying(false);
      setError("");
      setCurrentBehaviors({
        eye_gaze: { detected: false, confidence: 0 },
        sit_stand: { detected: false, confidence: 0 },
        tapping_hands: { detected: false, confidence: 0 },
        tapping_feet: { detected: false, confidence: 0 },
        rapid_talking: { detected: false, confidence: 0 },
      });

      toast.success("Monitoring stopped successfully");
    } catch (error) {
      console.error("❌ Error stopping monitoring:", error);
      toast.error("Error stopping monitoring");
    }
  };

  // Format duration
  const formatDuration = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Get behavior status color
  const getBehaviorStatusColor = (behavior) => {
    const data = currentBehaviors[behavior];
    if (data.detected && data.confidence > 0.7) return "destructive";
    if (data.detected) return "secondary";
    return "default";
  };

  // Check camera availability on mount
  const checkCameraAvailability = async () => {
    try {
      // Check if getUserMedia is supported
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return;
      }

      // Check if we're on HTTPS (required for camera access)
      if (
        window.location.protocol !== "https:" &&
        window.location.hostname !== "localhost"
      ) {
        return;
      }

      // Try to enumerate devices to check camera availability
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(
        (device) => device.kind === "videoinput"
      );

      // If no cameras, nothing to do (handled by UI)
      if (videoDevices.length === 0) {
        /* no video devices */
      }
    } catch (_err) {
      /* ignore device enumeration errors */
    }
  };

  // Check if camera is working
  const checkCameraStatus = () => {
    if (!videoRef.current) {
      return false;
    }

    const video = videoRef.current;
    const isStreamActive = stream && stream.active;
    const hasVideoTracks = stream && stream.getVideoTracks().length > 0;
    const videoTrackActive =
      hasVideoTracks && stream.getVideoTracks()[0].readyState === "live";
    const videoReady = video.readyState >= 2;
    const videoPlaying = !video.paused && !video.ended && videoReady;
    const hasVideoDimensions = video.videoWidth > 0 && video.videoHeight > 0;

    const _status = {
      streamActive: isStreamActive,
      hasVideoTracks,
      videoTrackActive,
      videoReady,
      videoPlaying,
      hasVideoDimensions,
      videoReadyState: video.readyState,
      videoPaused: video.paused,
      videoEnded: video.ended,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      trackCount: stream?.getVideoTracks().length || 0,
    };

    // More lenient check - camera is working if stream is active and we have video tracks
    const cameraWorking = isStreamActive && hasVideoTracks && videoTrackActive;

    return cameraWorking;
  };

  const monitorStreamHealth = () => {
    if (!stream || !monitoring) return true; // Return true if not monitoring

    const isActive = stream.active;
    const videoTracks = stream.getVideoTracks();
    const trackCount = videoTracks.length;
    const trackActive = trackCount > 0 && videoTracks[0].readyState === "live";

    if (!isActive || !trackActive) {
      return false;
    }

    return true;
  };

  // Start stream health monitoring
  useEffect(() => {
    if (monitoring && stream) {
      const healthInterval = setInterval(async () => {
        const isHealthy = monitorStreamHealth();
        if (!isHealthy) {
          try {
            const newStream = await navigator.mediaDevices.getUserMedia({
              video: {
                width: { ideal: 1920, min: 640 }, // Wide resolution, fallback to lower if needed
                height: { ideal: 1080, min: 480 }, // Wide height, fallback to lower if needed
                frameRate: { ideal: 30, min: 15 },
                facingMode: "user", // Front-facing camera
              },
              audio: false,
            });

            // Stop old stream tracks
            if (stream) {
              stream.getTracks().forEach((track) => track.stop());
            }

            // Set new stream
            setStream(newStream);

            // Reattach to video element
            if (videoRef.current) {
              videoRef.current.srcObject = newStream;
              videoRef.current.play().catch(() => {
                /* ignored autoplay failure */
              });
            }

            toast.success("Camera stream reacquired successfully");
          } catch (_e) {
            toast.error(
              "Failed to reacquire camera. Monitoring will continue with current stream."
            );
          }
        }
      }, 5000);

      // Cleanup on unmount or when monitoring stops
      return () => {
        clearInterval(healthInterval);
      };
    }
  }, [monitoring, stream]);

  // Manual analysis function that includes sit-stand detection

  const handleAnalyzeNow = () => {
    if (!monitoring) return;
    if (manualAnalysisIntervalId) return;

    // Start speech recognition automatically when analyze now is clicked
    if (!shouldKeepSpeechActive) {
      startSpeechRecognitionManually();
    }

    // Run regular analysis including sit-stand detection
    runBehavioralAnalysis();

    // Continue with regular continuous analysis every 5 seconds
    const interval = setInterval(() => {
      if (monitoring) {
        runBehavioralAnalysis(); // Regular analysis including sit-stand
      } else {
        clearInterval(interval);
        setManualAnalysisIntervalId(null);
      }
    }, 5000);
    setManualAnalysisIntervalId(interval);
  };

  // Stop manual analysis interval when monitoring stops
  useEffect(() => {
    if (!monitoring && manualAnalysisIntervalId) {
      clearInterval(manualAnalysisIntervalId);
      setManualAnalysisIntervalId(null);
    }
  }, [monitoring]);

  // Debug logging for monitoring state changes
  useEffect(() => {
    if (!monitoring) {
      /* monitoring stopped */
    }
  }, [monitoring, timerIntervalId, stream, error]);

  // Debug logging for timer updates
  useEffect(() => {
    if (monitoring && timer > 0) {
      /* timer updated */
    }
  }, [timer, monitoring]);

  // Frequent behaviors that need real-time analysis (every 200ms)
  const runFrequentBehaviorAnalysis = async () => {
    if (!monitoring) {
      return;
    }

    try {
      const behaviorTypes = [
        "eye_gaze",
        "tapping_hands",
        "tapping_feet",
        "rapid_talking",
        // Excluding sit_stand for efficiency
      ];

      const analysisPromises = behaviorTypes.map(async (behaviorType) => {
        try {
          const result = await analyzeBehavior(behaviorType);

          return result;
        } catch (error) {
          console.error(`❌ Error analyzing ${behaviorType}:`, error);
          return {
            behavior_type: behaviorType,
            confidence: 0,
            detected: false,
            timestamp: new Date().toISOString(),
            message: `Python ML analysis failed: ${error.message}`,
          };
        }
      });

      const analysisResults = await Promise.all(analysisPromises);
      const results = analysisResults.filter((r) => r !== null);

      // Process results (same logic as original runBehavioralAnalysis)
      const newBehaviors = {};
      behaviorTypes.forEach((bt) => {
        newBehaviors[bt] = { detected: false, confidence: 0 };
      });

      const newAlerts = [...alerts];
      const incrementMap = {};

      results.forEach((result, idx) => {
        const behaviorType = result?.behavior_type || behaviorTypes[idx];

        if (!result) {
          return;
        }

        newBehaviors[behaviorType] = {
          detected: Boolean(result.detected),
          confidence: parseFloat(result.confidence || result.probability || 0),
        };

        // Count detections and handle special behaviors (tap counting, etc.)
        if (result.detected) {
          // ... (same logic as original for tap counting, alerts, etc.)
          if (
            behaviorType === "tapping_hands" &&
            result.analysis_type === "pattern_recognition"
          ) {
            const currentTime = Date.now();
            const tapCount = result.tap_count || 0;
            const clapCount = result.clap_count || 0;

            if (tapCount > 0 || clapCount > 0) {
              setTapCounter((prev) => {
                let newCounter = { ...prev };
                if (!prev.isActive || currentTime - prev.startTime > 6000) {
                  newCounter = {
                    taps: tapCount,
                    claps: clapCount,
                    startTime: currentTime,
                    isActive: true,
                    displayResults: false,
                    lastDisplayTime: 0,
                  };
                  if (tapTimerRef.current) {
                    clearTimeout(tapTimerRef.current);
                  }
                  tapTimerRef.current = setTimeout(() => {
                    setTapCounter((counter) => ({
                      ...counter,
                      displayResults: true,
                      lastDisplayTime: Date.now(),
                    }));
                    setTimeout(() => {
                      setTapCounter((counter) => ({
                        ...counter,
                        displayResults: false,
                        isActive: false,
                      }));
                    }, 3000);
                  }, 5000);
                } else {
                  newCounter.taps += tapCount;
                  newCounter.claps += clapCount;
                }
                return newCounter;
              });
            }
          }

          incrementMap[behaviorType] = (incrementMap[behaviorType] || 0) + 1;

          newAlerts.push({
            id: Date.now() + Math.random(),
            behavior: behaviorType,
            confidence: parseFloat(
              result.confidence || result.probability || 0
            ),
            timestamp: new Date().toISOString(),
            message: `${behaviorType.replace("_", " ")} detected`,
          });
        }
      });

      // Update behavior data
      if (Object.keys(incrementMap).length > 0) {
        setBehaviorData((prevData) => {
          const newData = { ...prevData };
          Object.entries(incrementMap).forEach(([behavior, count]) => {
            if (!newData[behavior]) {
              newData[behavior] = { count: 0, totalConfidence: 0 };
            }
            newData[behavior].count += count;
            newData[behavior].totalConfidence +=
              (newBehaviors[behavior]?.confidence || 0) * count;
          });
          return newData;
        });
      }

      // Update current behaviors and alerts
      setCurrentBehaviors((prev) => ({ ...prev, ...newBehaviors }));
      setAlerts(newAlerts.slice(-10));
    } catch (error) {
      console.error("❌ Frequent behavior analysis failed:", error);
    }
  };

  // Sit-stand detection that runs less frequently (every 2-3 seconds)
  const runSitStandAnalysis = async () => {
    if (!monitoring) return;

    try {
      const result = await analyzeBehavior("sit_stand");

      if (
        result &&
        result.detected &&
        result.analysis_type === "action_detected"
      ) {
        // Update sit-stand behavior state
        setCurrentBehaviors((prev) => ({
          ...prev,
          sit_stand: {
            detected: true,
            confidence: parseFloat(result.confidence || 0),
          },
        }));

        // Add to behavior data
        setBehaviorData((prevData) => {
          const newData = { ...prevData };
          if (!newData.sit_stand) {
            newData.sit_stand = { count: 0, totalConfidence: 0 };
          }
          newData.sit_stand.count += 1;
          newData.sit_stand.totalConfidence += parseFloat(
            result.confidence || 0
          );
          return newData;
        });

        // Add alert for sit-stand actions (not states)
        setAlerts((prev) => [
          ...prev.slice(-9),
          {
            id: Date.now() + Math.random(),
            behavior: "sit_stand",
            confidence: parseFloat(result.confidence || 0),
            timestamp: new Date().toISOString(),
            message:
              result.action_description ||
              result.message ||
              `Action: ${result.action || "transition"}`,
          },
        ]);
      } else {
        // Update to show no action detected (maintaining same posture)
        setCurrentBehaviors((prev) => ({
          ...prev,
          sit_stand: {
            detected: false,
            confidence: parseFloat(result?.confidence || 0),
          },
        }));
      }
    } catch (error) {
      console.error("❌ Sit-stand analysis error:", error);
    }
  };

  // Utility: human-friendly label for behaviors
  const formatBehaviorLabel = (behavior) => {
    if (behavior === "sit_stand") return "Sitting/Standing";

    // Convert snake_case to "Title Case"
    const titled = behavior
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    return titled;
  };

  return (
    <div className="min-h-screen flex flex-col">
      <SidebarProvider className="flex flex-col">
        <SiteHeader />
        <div className="flex flex-1">
          <AppSidebar />
          <SidebarInset>
            <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6">
              {/* Header */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <h1 className="text-2xl sm:text-3xl font-bold">Dashboard</h1>
                  <p className="text-muted-foreground">
                    Welcome back, {userData?.name || userData?.email}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={monitoring ? "destructive" : "secondary"}>
                    {monitoring ? "Monitoring Active" : "Ready"}
                  </Badge>
                  {monitoring && (
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="h-4 w-4" />
                      {formatDuration(timer)}
                      <div className="flex items-center gap-1">
                        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                        <span className="text-xs text-green-600">Live</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Main Content */}
              <Tabs defaultValue="monitoring" className="flex-1">
                <TabsList className="grid grid-cols-2 gap-2 w-full">
                  <TabsTrigger
                    value="monitoring"
                    className="w-full px-2 py-2 text-sm text-center truncate"
                  >
                    Live Monitoring
                  </TabsTrigger>
                  <TabsTrigger
                    value="history"
                    className="w-full px-2 py-2 text-sm text-center truncate"
                    disabled={monitoring}
                  >
                    Session History
                  </TabsTrigger>
                </TabsList>

                <TabsContent
                  value="monitoring"
                  className="space-y-3 md:space-y-4"
                >
                  {/* Monitoring Controls */}
                  <MonitoringControls
                    monitoring={monitoring}
                    startMonitoring={startMonitoring}
                    stopMonitoring={stopMonitoring}
                    handleAnalyzeNow={handleAnalyzeNow}
                    manualAnalysisIntervalId={manualAnalysisIntervalId}
                    checkCameraStatus={checkCameraStatus}
                    error={error}
                  />

                  {/* Video Feed and Analysis */}
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 md:gap-4">
                    {/* Video Feed */}
                    <VideoFeed
                      videoRef={videoRef}
                      canvasRef={canvasRef}
                      stream={stream}
                      videoPlaying={videoPlaying}
                      setError={setError}
                      setVideoPlaying={setVideoPlaying}
                    />

                    {/* Behavior Analysis */}
                    <BehaviorAnalysisPanel
                      isAnalyzing={isAnalyzing}
                      monitoring={monitoring}
                      currentBehaviors={currentBehaviors}
                      behaviorData={behaviorData}
                      getBehaviorStatusColor={getBehaviorStatusColor}
                      formatBehaviorLabel={formatBehaviorLabel}
                    />
                  </div>

                  {/* Analytics Section */}
                  {Object.keys(behaviorData).length > 0 ? (
                    <div className="space-y-4">
                      {/* Summary Cards */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <Card>
                          <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                              <Clock className="h-5 w-5" />
                              Session Duration
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <p className="text-2xl font-bold">
                              {formatDuration(timer)}
                            </p>
                          </CardContent>
                        </Card>

                        <Card>
                          <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                              <Activity className="h-5 w-5" />
                              Total Detections
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <p className="text-2xl font-bold">
                              {Object.values(behaviorData).reduce(
                                (sum, data) => sum + (data.count || 0),
                                0
                              )}
                            </p>
                          </CardContent>
                        </Card>

                        <Card>
                          <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                              <AlertTriangle className="h-5 w-5" />
                              Alerts Generated
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <p className="text-2xl font-bold">
                              {alerts.length}
                            </p>
                          </CardContent>
                        </Card>
                      </div>

                      {/* Behavior Frequency Details */}
                      <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2">
                            <BarChart3 className="h-5 w-5" />
                            Behavior Frequency Analysis
                          </CardTitle>
                          <CardDescription>
                            Detailed frequency statistics for each detected
                            behavior
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-4">
                            {Object.entries(behaviorData).map(
                              ([behavior, data]) => {
                                const avgConfidence =
                                  data.count > 0
                                    ? data.totalConfidence / data.count
                                    : 0;

                                return (
                                  <div
                                    key={behavior}
                                    className="border rounded-lg p-4"
                                  >
                                    <div className="flex items-center justify-between mb-3">
                                      <h3 className="text-lg font-semibold capitalize">
                                        {formatBehaviorLabel(behavior)}
                                      </h3>
                                      <Badge variant="outline">
                                        {data.count} detections
                                      </Badge>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                      <div className="text-center">
                                        <div className="text-2xl font-bold text-blue-600">
                                          {data.count}
                                        </div>
                                        <div className="text-sm text-muted-foreground">
                                          Total Detections
                                        </div>
                                      </div>

                                      <div className="text-center">
                                        <div className="text-2xl font-bold text-purple-600">
                                          {Math.round(avgConfidence * 100)}%
                                        </div>
                                        <div className="text-sm text-muted-foreground">
                                          Avg Confidence
                                        </div>
                                      </div>
                                    </div>

                                    {data.count > 0 && (
                                      <div className="mt-3 pt-3 border-t">
                                        <div className="text-sm text-muted-foreground">
                                          <strong>Analysis:</strong> This
                                          behavior was detected {data.count}{" "}
                                          times with{" "}
                                          {Math.round(avgConfidence * 100)}%
                                          average confidence.
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              }
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  ) : (
                    <Card>
                      <CardContent className="text-center py-12">
                        <BarChart3 className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                        <p className="text-muted-foreground">
                          Start monitoring to see behavior frequency analytics
                        </p>
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>

                <TabsContent value="history" className="space-y-4">
                  <Card>
                    <CardHeader>
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                          <CardTitle className="text-lg md:text-xl">
                            Session History
                          </CardTitle>
                          <CardDescription className="text-sm">
                            Previous monitoring sessions and their results
                          </CardDescription>
                        </div>
                        <Button
                          onClick={loadSessionHistory}
                          variant="outline"
                          size="sm"
                          className="flex items-center gap-2 w-fit"
                        >
                          <RotateCcw className="h-4 w-4" />
                          Refresh
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {sessionHistory.length > 0 ? (
                        <div className="space-y-3 md:space-y-4">
                          {sessionHistory.map((session) => (
                            <div
                              key={session.id}
                              className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 p-3 md:p-4 border rounded-lg bg-card hover:bg-accent/50 transition-colors"
                            >
                              <div className="flex-1 space-y-1">
                                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                                  <p className="font-medium text-sm md:text-base">
                                    Session {session.id}
                                  </p>
                                  <Badge
                                    variant={
                                      session.status === "completed"
                                        ? "default"
                                        : "secondary"
                                    }
                                    className="text-xs w-fit"
                                  >
                                    {session.status}
                                  </Badge>
                                </div>
                                <div className="text-xs md:text-sm text-muted-foreground space-y-1">
                                  <p>
                                    <span className="font-medium">Date:</span>{" "}
                                    {new Date(
                                      session.startTime
                                    ).toLocaleDateString()}
                                  </p>
                                  <p>
                                    <span className="font-medium">
                                      Duration:
                                    </span>{" "}
                                    {session.duration || "In Progress"}
                                  </p>
                                  <p>
                                    <span className="font-medium">User:</span>{" "}
                                    {session.userName || "Unknown"}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 justify-end">
                                <Button
                                  onClick={() => {
                                    console.log(
                                      `🎯 Attempting to load analytics for session ${session.id}`
                                    );
                                    console.log(
                                      `👤 Current user data:`,
                                      userData
                                    );
                                    console.log(
                                      `🔐 User logged in:`,
                                      isLoggedIn
                                    );
                                    loadSessionAnalytics(session.id);
                                  }}
                                  variant="outline"
                                  size="sm"
                                  className="text-xs flex items-center gap-1"
                                  disabled={session.status !== "completed"}
                                >
                                  <BarChart3 className="h-3 w-3" />
                                  <span className="hidden sm:inline">
                                    View Analytics
                                  </span>
                                  <span className="sm:hidden">Analytics</span>
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-8 md:py-12">
                          <div className="mx-auto w-12 h-12 md:w-16 md:h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                            <Activity className="h-6 w-6 md:h-8 md:w-8 text-muted-foreground" />
                          </div>
                          <p className="text-muted-foreground mb-2 text-sm md:text-base">
                            No sessions found
                          </p>
                          <p className="text-xs md:text-sm text-muted-foreground">
                            Start a monitoring session to see your history here
                          </p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>

              {/* Session Analytics Modal */}
              <SessionAnalyticsModal
                open={showSessionAnalyticsModal}
                setOpen={setShowSessionAnalyticsModal}
                selectedSessionAnalytics={selectedSessionAnalytics}
                isLoading={isLoadingAnalytics}
                formatBehaviorLabel={formatBehaviorLabel}
              />
            </div>
          </SidebarInset>
        </div>
      </SidebarProvider>
    </div>
  );
};

export default Dashboard;
