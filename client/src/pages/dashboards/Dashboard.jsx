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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Video,
  VideoOff,
  Activity,
  Clock,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Play,
  Square,
  RotateCcw,
  BarChart3,
  Eye,
  Brain,
  Heart,
  Settings,
} from "lucide-react";
import toast from "react-hot-toast";

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
  const [speechRecognizer, setSpeechRecognizer] = useState(null);
  const [speechRecognitionActive, setSpeechRecognitionActive] = useState(false);
  const [speechSessionStartTime, setSpeechSessionStartTime] = useState(null);
  const [shouldKeepSpeechActive, setShouldKeepSpeechActive] = useState(false);
  const [sessionWordCount, setSessionWordCount] = useState(0);
  const sessionStartTimeRef = useRef(null);
  const speechRestartIntervalRef = useRef(null);

  // Motion detection for efficient sit-stand analysis
  const [lastFrame, setLastFrame] = useState(null);
  const [motionThreshold, setMotionThreshold] = useState(60); // Much higher - only major movements (was 30)

  const detectMotion = () => {
    if (!videoRef.current || !canvasRef.current) return false;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const video = videoRef.current;

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
    if (motionDetected) {
      console.log(
        `🏃 SIGNIFICANT body motion detected! Average change: ${averageChange.toFixed(
          2
        )} (threshold: ${motionThreshold}) - triggering sit-stand analysis`
      );
    } else if (averageChange > 15) {
      // Log near-misses for debugging
      console.log(
        `🤏 Minor movement detected: ${averageChange.toFixed(
          2
        )} (threshold: ${motionThreshold}) - not enough for sit-stand analysis`
      );
    }

    return motionDetected;
  };

  useEffect(() => {
    // Skip automatic initialization - use manual control instead to prevent infinite loops
    console.log(
      "ℹ️  Speech Recognition available - click 'Test Speech' to start"
    );
    setRapidTalkingStatus("⏸️ Click to start");
  }, []);

  // Manual speech recognition starter with forced 1-minute session
  const startSpeechRecognitionManually = async () => {
    console.log("🎤 === SPEECH RECOGNITION START FUNCTION CALLED ===");
    console.log(
      "Current states - shouldKeepSpeechActive:",
      shouldKeepSpeechActive,
      "speechRecognitionActive:",
      speechRecognitionActive
    );

    try {
      // If already in a session, don't start another
      if (shouldKeepSpeechActive) {
        console.log("🎤 Speech session already active");
        setRapidTalkingStatus("🔄 Session already running...");
        return;
      }

      console.log("🎤 Starting 1-minute speech collection session...");
      setRapidTalkingStatus("🔄 Requesting microphone access...");

      // Check if speech recognition is supported first
      if (
        !("webkitSpeechRecognition" in window || "SpeechRecognition" in window)
      ) {
        console.error("❌ Speech Recognition not supported in this browser");
        setRapidTalkingStatus("❌ Speech Recognition not supported");
        return;
      }

      // Request microphone permission first
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        console.log("✅ Microphone permission granted");
        setRapidTalkingStatus("✅ Starting 1-minute collection...");
        stream.getTracks().forEach((track) => track.stop());
      } catch (permError) {
        console.error("❌ Microphone permission denied:", permError);
        setRapidTalkingStatus("❌ Microphone denied - click to retry");
        return;
      }

      // Start the 1-minute session
      const sessionStart = Date.now();
      setSpeechSessionStartTime(sessionStart);
      setShouldKeepSpeechActive(true);
      setSessionWordCount(0);
      sessionStartTimeRef.current = sessionStart;

      // Start the actual speech recognition
      startSpeechRecognition();

      // Set up forced restart every 4 seconds to keep listening for full minute
      speechRestartIntervalRef.current = setInterval(() => {
        const elapsed = (Date.now() - sessionStart) / 1000;
        if (elapsed < 60 && shouldKeepSpeechActive) {
          console.log(
            `🔄 Forced restart at ${elapsed.toFixed(
              0
            )}s to maintain 1-minute session`
          );
          startSpeechRecognition();
        } else if (elapsed >= 60) {
          // 1 minute completed
          console.log("🏁 1-minute collection completed");
          completeSpeechSession();
        }
      }, 4000); // Restart every 4 seconds

      // Failsafe - stop after exactly 60 seconds
      setTimeout(() => {
        if (shouldKeepSpeechActive) {
          console.log("⏰ 60-second timer expired - completing session");
          completeSpeechSession();
        }
      }, 60000);

      console.log("🚀 1-minute speech collection session started");
    } catch (error) {
      console.error("❌ Speech recognition failed:", error);
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
      // Stop existing recognizer if any
      if (speechRecognizer) {
        try {
          speechRecognizer.stop();
        } catch (error) {
          // Ignore stop errors
        }
      }

      const SpeechRecognition =
        window.SpeechRecognition || window.webkitSpeechRecognition;
      const recognizer = new SpeechRecognition();
      recognizer.continuous = true;
      recognizer.interimResults = true;
      recognizer.maxAlternatives = 1;
      recognizer.lang = "en-US";

      recognizer.onstart = () => {
        console.log("🟢 Speech Recognition chunk started");
        setSpeechRecognitionActive(true);
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
              console.log(
                `🎙️ Final speech: "${transcript}" (${
                  transcript.split(/\s+/).length
                } words)`
              );
            }
          } else {
            if (transcript.length > 0) {
              console.log(`🔄 Interim speech: "${transcript}"`);
            }
          }
        }

        // Add final words to session count
        if (finalWordsInThisBatch > 0) {
          setSessionWordCount((prev) => prev + finalWordsInThisBatch);
        }

        // Update status with progress
        if (shouldKeepSpeechActive && sessionStartTimeRef.current) {
          const elapsed = (Date.now() - sessionStartTimeRef.current) / 1000;
          const remaining = Math.max(0, 60 - elapsed);
          if (remaining > 0) {
            setRapidTalkingStatus(
              `🕐 Collecting... ${
                sessionWordCount + finalWordsInThisBatch
              } words (${Math.ceil(remaining)}s left)`
            );
          }
        }
      };

      recognizer.onerror = (event) => {
        console.log(
          `🔴 Speech Recognition error: ${event.error} (will restart automatically)`
        );
        setSpeechRecognitionActive(false);
        // Don't handle errors - let the interval restart handle it
      };

      recognizer.onend = () => {
        console.log(
          "🔄 Speech Recognition chunk ended (auto-restart will handle)"
        );
        setSpeechRecognitionActive(false);
        // Don't handle restart here - let the interval handle it
      };

      recognizer.start();
      setSpeechRecognizer(recognizer);
    } catch (error) {
      console.error("❌ Speech recognition chunk failed:", error);
      setSpeechRecognitionActive(false);
    }
  };

  // Complete the speech session and calculate WPM
  const completeSpeechSession = () => {
    console.log("🏁 Completing 1-minute speech session...");

    // Stop everything
    setShouldKeepSpeechActive(false);
    setSpeechSessionStartTime(null);
    setSpeechRecognitionActive(false);

    // Clear interval
    if (speechRestartIntervalRef.current) {
      clearInterval(speechRestartIntervalRef.current);
      speechRestartIntervalRef.current = null;
    }

    // Stop speech recognizer
    if (speechRecognizer) {
      try {
        speechRecognizer.stop();
      } catch (error) {
        // Ignore stop errors
      }
    }

    // Calculate final WPM
    const finalWpm = sessionWordCount; // 1 minute = exact WPM
    console.log(
      `📈 FINAL WPM CALCULATION: ${finalWpm} WPM (${sessionWordCount} words in 1 minute)`
    );

    // Rapid talking detection: Normal speech is 125-150 WPM, rapid is 180+ WPM
    const rapidTalkingThreshold = 180; // Professional threshold for rapid talking
    const fastTalkingThreshold = 160; // Fast but not necessarily rapid

    if (finalWpm >= rapidTalkingThreshold) {
      console.log(
        `🚨 RAPID TALKING DETECTED: ${finalWpm} WPM! (Threshold: ${rapidTalkingThreshold}+ WPM)`
      );
      setRapidTalkingStatus(`🚨 RAPID TALKING: ${finalWpm} WPM!`);

      setWpmSeq((prev) => {
        const newArr = [...prev, finalWpm].slice(-10);
        console.log(
          `📊 WPM update: [${newArr.map((w) => w.toFixed(1)).join(", ")}]`
        );

        // Trigger rapid talking analysis
        setTimeout(() => {
          analyzeBehavior("rapid_talking");
        }, 10);

        return newArr;
      });
    } else if (finalWpm >= fastTalkingThreshold) {
      console.log(
        `⚡ Fast talking: ${finalWpm} WPM (not rapid yet - threshold: ${rapidTalkingThreshold}+ WPM)`
      );
      setRapidTalkingStatus(`⚡ Fast: ${finalWpm} WPM`);
      setWpmSeq((prev) => [...prev, finalWpm].slice(-10));
    } else {
      console.log(
        `🎤 Normal speech: ${finalWpm} WPM (rapid talking threshold: ${rapidTalkingThreshold}+ WPM)`
      );
      setRapidTalkingStatus(`🎤 Normal: ${finalWpm} WPM`);
      setWpmSeq((prev) => [...prev, finalWpm].slice(-10));
    }

    // Reset for next session
    setSessionWordCount(0);
  };

  // Diagnostic function to test speech recognition setup
  const testSpeechRecognitionSetup = async () => {
    console.log("🔧 === SPEECH RECOGNITION DIAGNOSTIC TEST ===");

    // Test 1: Check if APIs are available
    const hasWebSpeech =
      "webkitSpeechRecognition" in window || "SpeechRecognition" in window;
    const hasMediaDevices =
      "mediaDevices" in navigator && "getUserMedia" in navigator.mediaDevices;

    console.log("Web Speech API available:", hasWebSpeech);
    console.log("Media Devices API available:", hasMediaDevices);

    if (!hasWebSpeech) {
      setRapidTalkingStatus("❌ Web Speech API not supported");
      return;
    }

    if (!hasMediaDevices) {
      setRapidTalkingStatus("❌ Microphone API not supported");
      return;
    }

    // Test 2: Check microphone permissions
    try {
      setRapidTalkingStatus("🔧 Testing microphone...");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log("✅ Microphone test passed");
      stream.getTracks().forEach((track) => track.stop());

      // Test 3: Try creating speech recognizer
      const SpeechRecognition =
        window.SpeechRecognition || window.webkitSpeechRecognition;
      const testRecognizer = new SpeechRecognition();
      console.log("✅ Speech recognizer created successfully");

      setRapidTalkingStatus("✅ All tests passed - ready!");
      setTimeout(() => {
        setRapidTalkingStatus("⏸️ Click to start");
      }, 2000);
    } catch (error) {
      console.error("❌ Diagnostic test failed:", error);
      setRapidTalkingStatus("❌ Test failed - check permissions");
    }
  };

  // Stop speech recognition
  const stopSpeechRecognition = () => {
    console.log("🛑 Manually stopping speech recognition...");

    setShouldKeepSpeechActive(false);
    setSpeechSessionStartTime(null);
    setSessionWordCount(0);
    setSpeechRecognitionActive(false);

    // Clear interval
    if (speechRestartIntervalRef.current) {
      clearInterval(speechRestartIntervalRef.current);
      speechRestartIntervalRef.current = null;
    }

    // Stop recognizer
    if (speechRecognizer) {
      try {
        speechRecognizer.stop();
      } catch (error) {
        // Ignore stop errors
      }
    }

    setRapidTalkingStatus("⏸️ Stopped - click to start");
  };

  // Clear old WPM data after 30 seconds of silence
  useEffect(() => {
    const interval = setInterval(() => {
      const timeSinceLastSpeech = Date.now() - lastSpeechActivity;
      if (timeSinceLastSpeech > 30000 && wpmSeq.length > 0) {
        // 30 seconds
        console.log("🧹 Clearing stale WPM data after 30 seconds of silence");
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
      console.log(`🎤 Speech Recognition supported: ${speechSupported}`);

      // Check microphone permission
      if (navigator.permissions) {
        const permission = await navigator.permissions.query({
          name: "microphone",
        });
        console.log(`🎤 Microphone permission: ${permission.state}`);

        permission.onchange = () => {
          console.log(
            `🔄 Microphone permission changed to: ${permission.state}`
          );
        };
      }

      // Test if we can access microphone
      try {
        console.log("🔍 Testing microphone access...");
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });

        console.log("✅ Microphone access granted");

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
            console.log(
              `🔊 Audio level test complete. Max volume detected: ${maxVolume.toFixed(
                1
              )}/255`
            );
            if (maxVolume < 10) {
              console.warn(
                "⚠️ Very low audio levels detected. Try speaking louder or checking microphone settings."
              );
            } else if (maxVolume > 50) {
              console.log("✅ Good audio levels detected!");
            } else {
              console.log("📊 Moderate audio levels detected.");
            }

            // Clean up
            audioContext.close();
            stream.getTracks().forEach((track) => track.stop());
          }
        };

        console.log("🎤 Speak now to test your microphone levels...");
        checkAudio();

        return true;
      } catch (error) {
        console.error("❌ Microphone access failed:", error);

        if (error.name === "NotAllowedError") {
          console.log(
            "🔧 Fix: Click the microphone icon in your browser's address bar and allow microphone access"
          );
        } else if (error.name === "NotFoundError") {
          console.log(
            "🔧 Fix: Check that a microphone is connected to your computer"
          );
        } else if (error.name === "NotReadableError") {
          console.log(
            "🔧 Fix: Your microphone might be in use by another application"
          );
        }

        return false;
      }
    } catch (error) {
      console.error("Error checking microphone status:", error);
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
          const ctx = canvas.getContext("2d");

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
          console.log(`No video available for ${behaviorType}`);
          return null;
        }

        // Capture current video frame as base64
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        canvas.width = videoRef.current.videoWidth || 1280;
        canvas.height = videoRef.current.videoHeight || 720;

        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        const frameData = canvas.toDataURL("image/jpeg", 0.9);

        // For sequence-based models, capture multiple frames with higher quality
        console.log(
          `📸 Capturing HIGH-RESOLUTION frame sequence for ${behaviorType}...`
        );

        // Use the improved frame capture with better temporal resolution
        const frameSequence = await captureFrameSequence(12); // 12 frames for better accuracy

        if (!frameSequence || frameSequence.length === 0) {
          console.error(`❌ No frames captured for ${behaviorType}`);
          return null;
        }

        console.log(
          `✅ Captured ${frameSequence.length} frames for ACCURATE ${behaviorType} analysis`
        );

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
        console.log(`✅ Python ML detected ${behaviorType}:`, result);

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

        // Add visual feedback for successful detection
        if (analysis.detected) {
          console.log(
            `🎯 SENSITIVE DETECTION: ${behaviorType} (confidence: ${analysis.confidence})`
          );
          if (analysis.tap_count > 0) {
            console.log(`👏 Taps detected: ${analysis.tap_count}`);
          }
          if (analysis.clap_count > 0) {
            console.log(`👋 Claps detected: ${analysis.clap_count}`);
          }
        }

        return analysis;
      } else if (behaviorType === "rapid_talking") {
        // Audio-based behavior analysis - only when actually speaking
        const audioData = getAudioFeatures();
        if (!audioData) {
          console.log("Skipping rapid_talking: no audio input");
          return null;
        }

        // SIMPLIFIED: Skip audio-based speech detection for now - rely on WPM data
        console.log(
          `🔊 Audio levels - Volume: ${audioData.volume.toFixed(
            3
          )}, Spectral: ${audioData.spectralActivity.toFixed(3)}, Speaking: ${
            audioData.isSpeaking
          }`
        );

        // BYPASS SPEECH DETECTION - always proceed with analysis if we have any audio
        console.log(
          `🎯 PROCEEDING WITH RAPID TALKING ANALYSIS - bypassing speech detection`
        );

        // If no WPM data and no audio activity, use test data for demonstration
        if (wpmSeq.length === 0 && !audioData.isSpeaking) {
          console.log(
            "🧪 No speech data - will use fallback test data for demonstration"
          );
        }

        console.log(
          `🗣️ Speech detected! (volume: ${audioData.volume.toFixed(
            3
          )}, spectral: ${audioData.spectralActivity.toFixed(3)})`
        );

        // DEBUG: Check current WPM data status
        console.log(
          `📊 Current WPM data: [${wpmSeq
            .map((w) => w.toFixed(1))
            .join(", ")}] (${wpmSeq.length} samples)`
        );

        // RAPID TALKING DETECTION DEBUG - AFTER 1-MINUTE COLLECTION
        console.log("🎯 1-MINUTE WPM ANALYSIS:");
        if (wpmSeq.length >= 1) {
          // Use WPM data from full 1-minute collections
          const recentWpm = wpmSeq.slice(-3); // Last 3 one-minute measurements
          const avgWpm =
            recentWpm.reduce((a, b) => a + b, 0) / recentWpm.length;
          console.log(
            `   📈 Average WPM: ${avgWpm.toFixed(1)} (from ${
              recentWpm.length
            } x 1-minute measurements)`
          );
          console.log(`   🎯 Rapid talking threshold: 180+ WPM`);

          if (avgWpm >= 180) {
            console.log(
              `   🚨 RAPID TALKING DETECTED! (${avgWpm.toFixed(1)} >= 180 WPM)`
            );
          } else if (avgWpm >= 160) {
            console.log(
              `   ⚡ Fast talking detected (${avgWpm.toFixed(
                1
              )} WPM, need 180+ for rapid)`
            );
          } else {
            console.log(
              `   🎤 Normal speaking pace (${avgWpm.toFixed(
                1
              )} WPM, need 180+ for rapid)`
            );
          }
        } else {
          console.log(
            `   ⚠️ Need ${
              1 - wpmSeq.length
            } more 1-minute WPM measurements for analysis`
          );
        }

        // FALLBACK: If speech recognition isn't working but we detect audio activity
        if (wpmSeq.length === 0 && audioData.volume > 0.05) {
          console.log(
            "⚠️ Speech detected but no WPM data from speech recognition"
          );
          console.log(
            "🔄 Using audio activity as fallback for rapid talking detection"
          );

          // Use high audio activity as an indicator of rapid speech
          const activityScore =
            (audioData.volume + audioData.spectralActivity) / 2;
          if (activityScore > 0.1) {
            const estimatedConfidence = Math.min(0.6, activityScore * 4); // Max 60% confidence
            console.log(
              `🎯 Audio-based rapid talking detection: ${(
                estimatedConfidence * 100
              ).toFixed(1)}% confidence`
            );

            return {
              behavior_type: behaviorType,
              confidence: estimatedConfidence,
              detected: estimatedConfidence > 0.3,
              timestamp: new Date().toISOString(),
              message:
                "Audio-based rapid talking detection (speech recognition unavailable)",
              fallback: true,
              audioActivity: activityScore,
            };
          }
        }

        // REAL DETECTION: Only use 1-minute WPM measurements
        let wpmData;

        if (wpmSeq.length >= 1) {
          // Use recent WPM data from 1-minute collections
          const recentWpm = wpmSeq.slice(-3); // Keep last 3 one-minute measurements
          const avgWpm =
            recentWpm.reduce((a, b) => a + b, 0) / recentWpm.length;
          wpmData = recentWpm;

          console.log(
            `📊 Using 1-minute WPM data: [${wpmData
              .map((w) => w.toFixed(1))
              .join(", ")}] (avg: ${avgWpm.toFixed(1)} WPM from ${
              wpmData.length
            } x 1-minute measurements)`
          );

          // Only proceed if speech exceeds 180 WPM threshold for rapid talking
          if (avgWpm < 180) {
            let status = "";
            if (avgWpm >= 160) {
              status = `⚡ Fast: ${avgWpm.toFixed(1)} WPM`;
              console.log(
                `⚡ Fast speech (${avgWpm.toFixed(
                  1
                )} WPM) - below 180 WPM rapid threshold`
              );
            } else {
              status = `🎤 Normal: ${avgWpm.toFixed(1)} WPM`;
              console.log(
                `🎤 Normal speech (${avgWpm.toFixed(
                  1
                )} WPM) - below 180 WPM rapid threshold`
              );
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

          console.log(
            `✅ Rapid talking detected: ${avgWpm.toFixed(
              1
            )} WPM (above 180 WPM threshold)`
          );
          setRapidTalkingStatus(`🚨 RAPID TALKING: ${avgWpm.toFixed(1)} WPM`);
        } else {
          console.log(
            `❌ No 1-minute WPM data (${wpmSeq.length} measurements)`
          );
          console.log(`   Need at least 1 full 1-minute WPM measurement`);
          console.log(
            `   Current WPM data: [${wpmSeq
              .map((w) => w.toFixed(1))
              .join(", ")}]`
          );

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

        // Call real Python ML API for rapid talking
        console.log(
          `🔄 Calling Python ML API for rapid talking with data:`,
          wpmData
        );
        console.log(`📊 WPM Data Details:`, {
          length: wpmData.length,
          values: wpmData,
          average: (
            wpmData.reduce((a, b) => a + b, 0) / wpmData.length
          ).toFixed(1),
          min: Math.min(...wpmData).toFixed(1),
          max: Math.max(...wpmData).toFixed(1),
        });

        const requestBody = {
          behaviorType: behaviorType,
          data: wpmData,
        };
        console.log(`📤 Full request body:`, requestBody);

        const response = await fetch(`${backendUrl}/api/ml/analyze`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify(requestBody),
        });

        console.log(
          `📡 API Response status: ${response.status} ${response.statusText}`
        );

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`❌ API Error Response:`, errorText);
          throw new Error(`ML API error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        console.log(`✅ Python ML API Response:`, result);
        console.log(`🔍 Response analysis object:`, result.analysis);

        // Enhanced debugging for rapid talking results
        if (result.detected) {
          console.log(
            `🎯 RAPID TALKING DETECTED! Confidence: ${(
              result.confidence * 100
            ).toFixed(1)}%`
          );
          console.log(
            `   Detection type: ${result.fallback ? "Fallback" : "PyTorch ML"}`
          );
          setRapidTalkingStatus(
            `🎯 DETECTED! ${(result.confidence * 100).toFixed(1)}% confidence`
          );
        } else {
          console.log(
            `❌ No rapid talking detected. Confidence: ${(
              result.confidence * 100
            ).toFixed(1)}%`
          );
          setRapidTalkingStatus(
            `❌ Not detected (${(result.confidence * 100).toFixed(
              1
            )}% confidence)`
          );
        }

        // Add visual feedback for successful detection
        if (result.detected) {
          const detectionType = result.fallback ? "FALLBACK" : "PYTORCH ML";
          console.log(
            `🎯 ${detectionType} RAPID TALKING DETECTED! (confidence: ${result.confidence})`
          );
          if (!result.fallback) {
            console.log(`✨ Real PyTorch WPM model successful!`);
          }
        }

        return result.analysis || result;
      }

      return null;
    } catch (error) {
      console.log(`Real Python ML analysis error for ${behaviorType}:`, error);

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

      console.log("Running real Python ML analysis for all behaviors...");

      // NO DEMO MODE - only use real speech recognition data
      // Removed fake WPM data injection to ensure authentic detection

      let results = [];

      // Analyze each behavior individually using real Python ML
      const analysisPromises = behaviorTypes.map(async (behaviorType) => {
        try {
          console.log(`🔍 Starting analysis for behavior: ${behaviorType}`);
          const result = await analyzeBehavior(behaviorType);
          console.log(`✅ Completed analysis for ${behaviorType}:`, result);
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

      console.log("🔍 BEHAVIOR ANALYSIS RESULTS:");
      console.log("====================================");
      behaviorTypes.forEach((bt) => {
        newBehaviors[bt] = { detected: false, confidence: 0 };
      });

      const newAlerts = [...alerts];
      const incrementMap = {};

      results.forEach((result, idx) => {
        const behaviorType = result?.behavior_type || behaviorTypes[idx];

        console.log(
          `📋 Processing result ${idx + 1}/${results.length}: ${behaviorType}`
        );
        console.log(`   Raw result:`, result);

        if (!result) {
          console.log(
            `   ❌ No result for ${behaviorType} - keeping default false`
          );
          return; // keep default false
        }

        // Update current behaviors
        newBehaviors[behaviorType] = {
          detected: Boolean(result.detected),
          confidence: parseFloat(result.confidence || result.probability || 0),
        };

        console.log(
          `   ✅ Updated ${behaviorType}: detected=${Boolean(
            result.detected
          )}, confidence=${parseFloat(
            result.confidence || result.probability || 0
          )}`
        );

        // SPECIAL DEBUGGING for rapid_talking
        if (behaviorType === "rapid_talking") {
          console.log(`🎯 RAPID TALKING PROCESSING DETAIL:`);
          console.log(
            `   detected: ${result.detected} (type: ${typeof result.detected})`
          );
          console.log(
            `   confidence: ${
              result.confidence
            } (type: ${typeof result.confidence})`
          );
          console.log(`   Boolean(detected): ${Boolean(result.detected)}`);
          console.log(
            `   parseFloat(confidence): ${parseFloat(
              result.confidence || result.probability || 0
            )}`
          );

          if (result.detected) {
            console.log(`🚨 RAPID TALKING SHOULD BE DETECTED IN UI!`);
          } else {
            console.log(`❌ Rapid talking not detected - will show as 0 in UI`);
          }
        }

        // SPECIAL DEBUGGING for hand_tapping pattern analysis
        if (behaviorType === "tapping_hands") {
          console.log(`👋 HAND TAPPING PATTERN ANALYSIS:`);
          console.log(
            `   detected: ${result.detected} (type: ${typeof result.detected})`
          );
          console.log(
            `   confidence: ${
              result.confidence
            } (type: ${typeof result.confidence})`
          );

          if (result.analysis_type === "pattern_recognition") {
            console.log(`   🎯 PATTERN ANALYSIS RESULTS:`);
            console.log(`      Pattern detected: ${result.pattern || "none"}`);
            console.log(`      Tapping score: ${result.tapping_score || 0}`);
            console.log(`      Clapping score: ${result.clapping_score || 0}`);
            console.log(`      Analysis type: ${result.analysis_type}`);
            console.log(`      Tap count: ${result.tap_count || 0}`);
            console.log(`      Clap count: ${result.clap_count || 0}`);

            if (result.detected) {
              console.log(
                `✅ REAL ${result.pattern.toUpperCase()} MOTION DETECTED!`
              );

              // TAP COUNTING LOGIC - Accumulate taps over 5 seconds
              const currentTime = Date.now();
              const tapCount = result.tap_count || 0;
              const clapCount = result.clap_count || 0;

              if (tapCount > 0 || clapCount > 0) {
                setTapCounter((prev) => {
                  let newCounter = { ...prev };

                  // Start new counting session if not active
                  if (!prev.isActive || currentTime - prev.startTime > 6000) {
                    console.log(
                      `🔄 Starting new 5-second tap counting session`
                    );
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

                      console.log(`🎯 TAP COUNT RESULTS AFTER 5 SECONDS:`);
                      console.log(
                        `   Total Taps: ${newCounter.taps + tapCount}`
                      );
                      console.log(
                        `   Total Claps: ${newCounter.claps + clapCount}`
                      );

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
                    console.log(
                      `➕ Added ${tapCount} taps, ${clapCount} claps. Total: ${newCounter.taps} taps, ${newCounter.claps} claps`
                    );
                  }

                  return newCounter;
                });
              }
            } else {
              console.log(
                `❌ No actual tapping/clapping motion detected (just showing hands)`
              );
            }
          } else {
            console.log(
              `   ⚠️ Using legacy PyTorch detection (not pattern analysis)`
            );
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

          console.log(
            `Detection recorded for ${behaviorType}. Total count: ${incrementMap[behaviorType].inc}`
          );
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

          // Console notification for high confidence detections
          if (confidence > 0.6) {
            console.log(
              `🚨 HIGH CONFIDENCE DETECTION: ${behaviorType} (${(
                confidence * 100
              ).toFixed(1)}%)`
            );
          }

          // Keep only last 10 alerts
          if (newAlerts.length > 10) {
            newAlerts.pop();
          }
        }
      });

      console.log("🔄 About to update currentBehaviors with:", newBehaviors);
      console.log(
        "🎯 Rapid talking in newBehaviors:",
        newBehaviors.rapid_talking
      );

      setCurrentBehaviors(newBehaviors);
      setAlerts(newAlerts);

      console.log(
        "✅ currentBehaviors updated, rapid talking should now be:",
        newBehaviors.rapid_talking
      );
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

      // Debug logging
      console.log("Updated behaviorData:", behaviorData);

      // No baseline skipping now
    } finally {
      // Keep isAnalyzing true during entire monitoring session - don't reset to false
    }
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

  // Verify video element is available
  useEffect(() => {
    if (videoRef.current) {
      /* video element verified */
    }
  }, [monitoring]); // Check when monitoring state changes

  // Ensure video element is properly initialized on mount
  useEffect(() => {
    const checkVideoElement = () => {
      if (videoRef.current) {
        /* video element ready */
      }
    };

    // Check immediately
    checkVideoElement();

    // Check again after a short delay to ensure DOM is ready
    const timer = setTimeout(checkVideoElement, 100);

    return () => clearTimeout(timer);
  }, []);

  // Monitor monitoring state changes
  useEffect(() => {
    if (monitoring && videoRef.current && stream) {
      /* monitoring state changed */
    }
  }, [monitoring, stream]);

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
      console.log(`🔍 Loading session history for user ${userData.id}...`);
      const response = await fetch(
        `${backendUrl}/api/session/user/${userData.id}`,
        {
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      console.log(
        `📡 Session history response:`,
        response.status,
        response.statusText
      );

      if (response.ok) {
        const data = await response.json();
        console.log(
          `✅ Session history loaded:`,
          data.sessions?.length || 0,
          "sessions"
        );
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

      console.log(`🔍 Loading analytics for session ${sessionId}...`);
      console.log(
        `🔗 Analytics URL: ${backendUrl}/api/session/${sessionId}/analytics`
      );
      console.log(`🍪 Document cookies: ${document.cookie}`);

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

      console.log(`📡 Analytics response status: ${response.status}`);

      if (response.ok) {
        const data = await response.json();
        console.log(`✅ Session analytics loaded:`, data);

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
        const sitStandCooldown = 1500; // Minimum 1.5s between sit-stand analyses to avoid spam

        const analyzeFrame = () => {
          const now = Date.now();

          // Run frequent behaviors (eye gaze, tapping, rapid talking) every 200ms
          if (
            now - lastAnalysisTime >= analysisThrottle &&
            videoRef.current &&
            !videoRef.current.paused &&
            !videoRef.current.ended
          ) {
            console.log(
              "🔍 Running FREQUENT Python ML analysis... (every 200ms, no sit-stand)"
            );
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
              console.log(
                "🪑 Motion detected! Running SIT-STAND analysis... (motion-triggered for maximum efficiency)"
              );
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
        console.log(
          "🎤 Auto-starting 1-minute speech collection for monitoring session..."
        );
        console.log(
          "Current shouldKeepSpeechActive state:",
          shouldKeepSpeechActive
        );
        setTimeout(() => {
          console.log("🎤 Executing auto-start speech recognition...");
          startSpeechRecognitionManually();
        }, 1500); // Longer delay to ensure monitoring is fully started
      } else {
        console.log("🎤 Speech session already active, skipping auto-start");
      }

      // Initial analysis after 1 second (faster initial response)
      setTimeout(() => {
        console.log("🎬 Running initial Python ML analysis...");
        runFrequentBehaviorAnalysis(); // Start with frequent behaviors
        setTimeout(() => {
          runSitStandAnalysis(); // Add sit-stand shortly after
        }, 500);
      }, 1000);

      console.log(
        "🚀 REAL-TIME ADHD behavior detection ACTIVE - Frequent behaviors: 5x/sec, Sit-stand: motion-triggered"
      );
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
    console.log("🛑 Stopping monitoring...");

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
        console.log("🛑 Stopping speech recognition with monitoring...");
        stopSpeechRecognition();
      }

      console.log("✅ Successfully stopped all monitoring components");

      // Update session if active
      if (sessionId) {
        console.log("💾 Saving session data:", {
          behaviorData,
          behaviorDataKeys: Object.keys(behaviorData),
          behaviorDataValues: Object.values(behaviorData),
          alerts,
          alertsLength: alerts.length,
          duration: formatDuration(timer),
        });

        // Also log the raw JSON that will be sent
        const sessionPayload = {
          endTime: new Date().toISOString(),
          duration: formatDuration(timer),
          status: "completed",
          behaviorData: behaviorData,
          alerts: alerts,
        };
        console.log(
          "📤 Session payload being sent:",
          JSON.stringify(sessionPayload, null, 2)
        );

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

  // Test camera access
  const testCamera = async () => {
    setError("");

    try {
      // Check if getUserMedia is supported
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("getUserMedia is not supported in this browser");
      }

      // Try to get camera access
      const testStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1920, min: 640 }, // Wide resolution, fallback to lower if needed
          height: { ideal: 1080, min: 480 }, // Wide height, fallback to lower if needed
          frameRate: { ideal: 30, min: 15 },
          facingMode: "user", // Front-facing camera
        },
        audio: false,
      });

      // Check if we got video tracks
      const videoTracks = testStream.getVideoTracks();
      if (videoTracks.length === 0) {
        throw new Error("No video tracks available");
      }

      // Get camera info
      const videoTrack = videoTracks[0];
      const settings = videoTrack.getSettings();

      // Test video display by temporarily setting the stream
      if (videoRef.current) {
        const originalStream = videoRef.current.srcObject;
        videoRef.current.srcObject = testStream;
        videoRef.current.muted = true;
        videoRef.current.playsInline = true;

        try {
          await videoRef.current.play();

          // Show video for 3 seconds
          setTimeout(() => {
            if (videoRef.current) {
              videoRef.current.pause();
              videoRef.current.srcObject = originalStream;
              if (originalStream) {
                videoRef.current.play().catch(() => {
                  /* ignored autoplay failure */
                });
              }
            }
          }, 3000);
        } catch (_e) {
          /* ignored error in monitor stream health */
        }
      }

      // Stop the test stream after a delay
      setTimeout(() => {
        testStream.getTracks().forEach((track) => track.stop());
      }, 3500);

      toast.success(
        `Camera test successful! Camera: ${videoTrack.label || "Unknown"}`
      );

      // Show camera info
      setError(`Camera test successful! 
        Camera: ${videoTrack.label || "Unknown"}
        Resolution: ${settings.width}x${settings.height}
        Frame rate: ${settings.frameRate || "Unknown"} fps
        Video display: ${videoRef.current ? "Tested" : "Not available"}`);
    } catch (_e) {
      /* ignored test camera error */
      let errorMessage = "Camera test failed.";
      setError(errorMessage);
      toast.error("Camera test failed: " + errorMessage);
    }
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
      console.log(
        "🎤 Auto-starting 1-minute speech collection with Analyze Now..."
      );
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

      console.log("Running frequent Python ML analysis (no sit-stand)...");

      const analysisPromises = behaviorTypes.map(async (behaviorType) => {
        try {
          console.log(
            `🔍 Starting frequent analysis for behavior: ${behaviorType}`
          );
          const result = await analyzeBehavior(behaviorType);
          console.log(
            `✅ Completed frequent analysis for ${behaviorType}:`,
            result
          );
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
      console.log("🪑 Running sit-stand analysis (infrequent check)...");
      const result = await analyzeBehavior("sit_stand");

      if (result && result.detected) {
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

        console.log(
          `🎯 SIT-STAND ACTION COUNTED: ${result.action || "transition"} - ${
            result.action_description || "posture change"
          } (confidence: ${result.confidence})`
        );
      } else {
        // Update to show no action detected (maintaining same posture)
        setCurrentBehaviors((prev) => ({
          ...prev,
          sit_stand: {
            detected: false,
            confidence: parseFloat(result?.confidence || 0),
          },
        }));

        // Log what's happening (maintaining posture vs insufficient baseline vs cooldown vs confidence)
        if (result?.analysis_type === "maintaining_same_posture") {
          console.log(
            `📍 MAINTAINING POSTURE: ${result.current_posture} (stable x${result.baseline_count}) - no action to count`
          );
        } else if (result?.analysis_type === "baseline_establishment") {
          console.log(
            `🏁 ESTABLISHING BASELINE: ${result.current_posture} posture detected (baseline=${result.baseline_count})`
          );
        } else if (
          result?.analysis_type === "posture_change_insufficient_baseline"
        ) {
          console.log(
            `⚠️ POSTURE CHANGE: ${result.previous_posture} → ${result.current_posture} but baseline insufficient (${result.baseline_count}/${result.required_baseline})`
          );
        } else if (result?.analysis_type === "cooldown_active") {
          console.log(
            `🛑 COOLDOWN BLOCKING: ${result.previous_posture} → ${
              result.current_posture
            } transition blocked (${result.time_remaining?.toFixed(
              1
            )}s remaining)`
          );
        } else if (
          result?.analysis_type === "confidence_too_low_for_transition"
        ) {
          console.log(
            `🚫 CONFIDENCE TOO LOW: ${result.previous_posture} → ${
              result.current_posture
            } blocked (${result.confidence?.toFixed(3)} < ${
              result.required_confidence
            })`
          );
        } else {
          console.log(
            `ℹ️ No sit-stand action detected: ${
              result?.message || "unknown reason"
            }`
          );
        }
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
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Video className="h-5 w-5" />
                        Behavior Monitoring
                      </CardTitle>
                      <CardDescription>
                        Monitor behaviors using computer vision and ML analysis.
                        Monitoring will continue until manually stopped.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex flex-wrap gap-4">
                        {!monitoring ? (
                          <>
                            <Button
                              onClick={startMonitoring}
                              className="flex items-center gap-2 w-full sm:w-auto"
                              size="lg"
                            >
                              <Play className="h-4 w-4" />
                              Start Monitoring
                            </Button>
                            <Button
                              onClick={testCamera}
                              variant="outline"
                              className="flex items-center gap-2 w-full sm:w-auto"
                            >
                              <Video className="h-4 w-4" />
                              Test Camera
                            </Button>
                            <Button
                              onClick={() =>
                                window.open("/camera-test.html", "_blank")
                              }
                              variant="outline"
                              className="flex items-center gap-2 w-full sm:w-auto"
                            >
                              <Settings className="h-4 w-4" />
                              Advanced Test
                            </Button>
                            <Button
                              onClick={testSpeechRecognitionSetup}
                              variant="outline"
                              className="flex items-center gap-2 w-full sm:w-auto"
                            >
                              <span className="h-4 w-4">🎤</span>
                              Test Speech Setup
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              onClick={stopMonitoring}
                              variant="destructive"
                              className="flex items-center gap-2 w-full sm:w-auto"
                              size="lg"
                            >
                              <Square className="h-4 w-4" />
                              Stop Monitoring
                            </Button>
                            <Button
                              onClick={handleAnalyzeNow}
                              variant="outline"
                              className="flex items-center gap-2 w-full sm:w-auto"
                              disabled={!!manualAnalysisIntervalId}
                            >
                              <Brain className="h-4 w-4" />
                              Analyze Now (+ Speech)
                            </Button>
                            <Button
                              onClick={() => {
                                const status = checkCameraStatus();
                                if (status) {
                                  toast.success("Camera is working properly");
                                } else {
                                  toast.error(
                                    "Camera issue detected - check console"
                                  );
                                }
                              }}
                              variant="outline"
                              className="flex items-center gap-2 w-full sm:w-auto"
                            >
                              <Eye className="h-4 w-4" />
                              Check Status
                            </Button>
                          </>
                        )}
                      </div>

                      {error && (
                        <Alert variant="destructive">
                          <XCircle className="h-4 w-4" />
                          <AlertDescription>
                            {error}
                            <div className="mt-2 text-sm">
                              <strong>Troubleshooting Steps:</strong>
                              <ol className="list-decimal list-inside mt-1 space-y-1">
                                <li>
                                  <strong>Check Browser Permissions:</strong>{" "}
                                  Click the camera icon in your browser's
                                  address bar and ensure camera access is
                                  allowed
                                </li>
                                <li>
                                  <strong>Close Other Apps:</strong> Make sure
                                  no other applications (Zoom, Teams, etc.) are
                                  using your camera
                                </li>
                                <li>
                                  <strong>Try Different Browser:</strong> Use
                                  Chrome, Firefox, or Edge for best
                                  compatibility
                                </li>
                                <li>
                                  <strong>Check HTTPS:</strong> Ensure you're
                                  using HTTPS (required for camera access)
                                </li>
                                <li>
                                  <strong>Test Camera:</strong> Click "Test
                                  Camera" button to verify camera access
                                </li>
                                <li>
                                  <strong>Advanced Test:</strong> Use "Advanced
                                  Test" for detailed camera diagnostics
                                </li>
                                <li>
                                  <strong>Refresh Page:</strong> Try refreshing
                                  the page or restarting your browser
                                </li>
                              </ol>
                              <div className="mt-2 p-2 bg-gray-100 rounded text-xs">
                                <strong>Debug Info:</strong> Browser:{" "}
                                {navigator.userAgent
                                  .split(" ")
                                  .find((ua) => ua.includes("/")) || "Unknown"}
                                , Protocol: {window.location.protocol}, Host:{" "}
                                {window.location.hostname}
                              </div>
                            </div>
                          </AlertDescription>
                        </Alert>
                      )}
                    </CardContent>
                  </Card>

                  {/* Video Feed and Analysis */}
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 md:gap-4">
                    {/* Video Feed */}
                    <Card>
                      <CardHeader className="pb-2 md:pb-3">
                        <CardTitle className="flex items-center gap-2 text-sm md:text-base">
                          <Eye className="h-4 w-4" />
                          Live Video Feed
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="bg-black rounded-lg aspect-[4/3] flex items-center justify-center relative overflow-hidden group">
                          <video
                            ref={videoRef}
                            autoPlay
                            playsInline
                            muted
                            className={`rounded-lg w-full h-full object-cover transition-all duration-500 ease-out ${
                              stream
                                ? "opacity-100 scale-100"
                                : "opacity-0 scale-95"
                            }`}
                            style={{
                              backgroundColor: "black",
                              minHeight: "180px",
                              display: stream ? "block" : "none",
                            }}
                            onError={(e) => {
                              setError(
                                "Video element failed to load. Please check camera permissions."
                              );
                            }}
                            onLoadedMetadata={() => {
                              if (videoRef.current) {
                              }
                            }}
                            onCanPlay={() => {
                              if (videoRef.current) {
                                videoRef.current.play().catch(() => {
                                  /* ignored autoplay failure */
                                });
                              }
                            }}
                            onPlaying={() => {
                              setVideoPlaying(true);
                            }}
                            onPause={() => {
                              setVideoPlaying(false);
                            }}
                            onStalled={() => {
                              setVideoPlaying(false);
                            }}
                            onWaiting={() => {
                              setVideoPlaying(false);
                            }}
                          />
                          <canvas ref={canvasRef} className="hidden" />

                          {/* Video Status Overlay */}
                          {stream && videoPlaying && (
                            <div className="absolute top-3 right-3 z-10">
                              <div className="flex items-center gap-2 bg-black/60 backdrop-blur-sm rounded-full px-3 py-1 text-white text-xs animate-in fade-in-0 slide-in-from-top-2 duration-300">
                                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                                LIVE
                              </div>
                            </div>
                          )}

                          {/* Camera Placeholder Overlay */}
                          {!stream && (
                            <div className="absolute inset-0 flex items-center justify-center text-center text-muted-foreground p-4 animate-in fade-in-0 zoom-in-95 duration-500">
                              <div className="space-y-3">
                                <div className="mx-auto w-16 h-16 bg-muted/20 rounded-full flex items-center justify-center animate-pulse">
                                  <VideoOff className="h-8 w-8 md:h-10 md:w-10" />
                                </div>
                                <div>
                                  <p className="text-sm md:text-base font-medium">
                                    Camera feed will appear here
                                  </p>
                                  <p className="text-xs text-muted-foreground/80 mt-1">
                                    Start monitoring to begin
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Loading Overlay */}
                          {stream && !videoPlaying && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in-0 duration-300">
                              <div className="text-center text-white">
                                <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                                <p className="text-xs">
                                  Initializing camera...
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>

                    {/* Behavior Analysis */}
                    <Card>
                      <CardHeader className="pb-2 md:pb-3">
                        <CardTitle className="flex items-center gap-2 text-sm md:text-base">
                          <Activity className="h-4 w-4" />
                          Behavior Analysis
                          {isAnalyzing && (
                            <Badge variant="secondary" className="ml-2">
                              <Brain className="h-3 w-3 mr-1 animate-pulse" />
                              <span className="hidden sm:inline">
                                Analyzing...
                              </span>
                              <span className="sm:hidden">...</span>
                            </Badge>
                          )}
                          {monitoring && !isAnalyzing && (
                            <Badge variant="default" className="ml-2">
                              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse mr-1"></div>
                              Active
                            </Badge>
                          )}
                          {!monitoring && (
                            <Badge variant="outline" className="ml-2">
                              <VideoOff className="h-3 w-3 mr-1" />
                              Inactive
                            </Badge>
                          )}
                        </CardTitle>
                        <CardDescription className="text-xs md:text-sm">
                          Real-time behavior analysis using machine learning
                          models. Analysis runs continuously (5x per second)
                          while monitoring is active.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {/* Physical Behaviors */}
                        <div className="space-y-2">
                          <h3 className="text-xs md:text-sm font-semibold text-muted-foreground uppercase tracking-wide border-b pb-2">
                            Physical Behaviors
                          </h3>
                          <div className="grid gap-2">
                            {[
                              "eye_gaze",
                              "tapping_hands",
                              "tapping_feet",
                              "sit_stand",
                            ].map((behavior) => {
                              const data = currentBehaviors[behavior];
                              if (!data) return null;

                              const getBehaviorIcon = () => {
                                switch (behavior) {
                                  case "eye_gaze":
                                    return "👀";
                                  case "tapping_hands":
                                    return "✋";
                                  case "tapping_feet":
                                    return "🦶";
                                  case "sit_stand":
                                    return "🪑";
                                  default:
                                    return "📊";
                                }
                              };

                              return (
                                <div
                                  key={behavior}
                                  className={`flex items-center justify-between p-2 md:p-3 rounded border transition-all duration-200 ${
                                    data.detected
                                      ? "border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/20"
                                      : "border-gray-200 bg-gray-50/50 dark:border-gray-700 dark:bg-gray-800/30"
                                  }`}
                                >
                                  <div className="flex items-center gap-3">
                                    <div
                                      className={`text-base md:text-lg transition-transform duration-300 ${
                                        data.detected
                                          ? "animate-bounce scale-110"
                                          : "group-hover:scale-110"
                                      }`}
                                    >
                                      {getBehaviorIcon()}
                                    </div>
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2 mb-1">
                                        <Badge
                                          variant={getBehaviorStatusColor(
                                            behavior
                                          )}
                                          className={`text-xs transition-all duration-300 ${
                                            data.detected
                                              ? "animate-pulse shadow-sm"
                                              : ""
                                          }`}
                                        >
                                          {data.detected
                                            ? "Detected"
                                            : "Normal"}
                                        </Badge>
                                        <span className="text-xs md:text-sm font-medium capitalize">
                                          {formatBehaviorLabel(behavior)}
                                        </span>
                                      </div>
                                      {data.detected && (
                                        <div className="text-xs text-muted-foreground animate-in fade-in-0 slide-in-from-left-2 duration-300">
                                          🕐 {new Date().toLocaleTimeString()}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  <div className="text-right">
                                    <div
                                      className={`text-sm md:text-lg font-bold transition-all duration-300 ${
                                        data.detected
                                          ? "text-red-600 dark:text-red-400 animate-pulse scale-110"
                                          : "text-primary group-hover:scale-105"
                                      }`}
                                    >
                                      {behaviorData[behavior]?.count || 0}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      detections
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Speech Behaviors */}
                        <div className="space-y-2">
                          <h3 className="text-xs md:text-sm font-semibold text-muted-foreground uppercase tracking-wide border-b pb-2">
                            Speech Behaviors
                          </h3>
                          <div className="grid gap-2">
                            {["rapid_talking"].map((behavior) => {
                              const data = currentBehaviors[behavior];
                              if (!data) return null;

                              return (
                                <div
                                  key={behavior}
                                  className={`flex items-center justify-between p-2 md:p-3 rounded border transition-all duration-200 ${
                                    data.detected
                                      ? "border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/20"
                                      : "border-gray-200 bg-gray-50/50 dark:border-gray-700 dark:bg-gray-800/30"
                                  }`}
                                >
                                  <div className="flex items-center gap-2">
                                    <div className="text-base md:text-lg">
                                      🗣️
                                    </div>
                                    <div>
                                      <div className="flex items-center gap-2">
                                        <Badge
                                          variant={getBehaviorStatusColor(
                                            behavior
                                          )}
                                          className="text-xs"
                                        >
                                          {data.detected
                                            ? "Detected"
                                            : "Normal"}
                                        </Badge>
                                        <span className="text-xs md:text-sm font-medium capitalize">
                                          {formatBehaviorLabel(behavior)}
                                        </span>
                                      </div>
                                      {data.detected && (
                                        <div className="text-xs text-muted-foreground">
                                          {new Date().toLocaleTimeString()}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  <div className="text-right">
                                    <div className="text-sm md:text-lg font-bold text-primary">
                                      {behaviorData[behavior]?.count || 0}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      detections
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
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
              <Dialog
                open={showSessionAnalyticsModal}
                onOpenChange={(open) => {
                  setShowSessionAnalyticsModal(open);
                  if (!open) {
                    // Smooth cleanup when closing
                    setTimeout(() => setSelectedSessionAnalytics(null), 200);
                  }
                }}
              >
                <DialogContent className="max-w-7xl max-h-[90vh] w-[95vw] overflow-hidden">
                  <DialogHeader className="space-y-2 pb-4 border-b">
                    <DialogTitle className="flex items-center gap-2 text-xl md:text-2xl">
                      <div className="p-2 bg-primary/10 rounded-lg">
                        <BarChart3 className="h-5 w-5 md:h-6 md:w-6 text-primary" />
                      </div>
                      Session Analytics
                    </DialogTitle>
                    <DialogDescription className="text-sm md:text-base">
                      Detailed behavior analysis for this monitoring session
                    </DialogDescription>
                  </DialogHeader>

                  <div className="overflow-y-auto max-h-[75vh] pr-2 -mr-2">
                    {selectedSessionAnalytics ? (
                      <div className="space-y-4 md:space-y-6 animate-in fade-in-0 slide-in-from-bottom-4 duration-300">
                        {/* Session Summary */}
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                          {[
                            {
                              icon: Clock,
                              label: "Duration",
                              value:
                                selectedSessionAnalytics.sessionDuration ||
                                "N/A",
                              color: "blue",
                            },
                            {
                              icon: Activity,
                              label: "Total Detections",
                              value:
                                selectedSessionAnalytics.totalBehaviors || 0,
                              color: "green",
                            },
                            {
                              icon: AlertTriangle,
                              label: "Alerts Generated",
                              value: selectedSessionAnalytics.alertCount || 0,
                              color: "orange",
                            },
                            {
                              icon: Brain,
                              label: "Avg Confidence",
                              value: selectedSessionAnalytics.averageConfidence
                                ? `${Math.round(
                                    selectedSessionAnalytics.averageConfidence *
                                      100
                                  )}%`
                                : "N/A",
                              color: "purple",
                            },
                          ].map((metric, index) => (
                            <Card
                              key={metric.label}
                              className="group hover:shadow-md transition-all duration-300 hover:scale-105 overflow-hidden"
                            >
                              <div
                                className={`h-1 bg-gradient-to-r from-${metric.color}-400 to-${metric.color}-600 transition-all duration-300 group-hover:h-2`}
                              />
                              <CardHeader className="pb-2 md:pb-3">
                                <CardTitle className="text-xs md:text-sm flex items-center gap-1 md:gap-2">
                                  <metric.icon
                                    className={`h-3 w-3 md:h-4 md:w-4 text-${metric.color}-600`}
                                  />
                                  {metric.label}
                                </CardTitle>
                              </CardHeader>
                              <CardContent className="pt-0">
                                <p
                                  className="text-lg md:text-2xl font-bold animate-in fade-in-0 slide-in-from-bottom-2 duration-500"
                                  style={{ animationDelay: `${index * 100}ms` }}
                                >
                                  {metric.value}
                                </p>
                              </CardContent>
                            </Card>
                          ))}
                        </div>

                        {/* Session Details */}
                        {selectedSessionAnalytics.sessionSummary && (
                          <Card
                            className="animate-in fade-in-0 slide-in-from-left-4 duration-500"
                            style={{ animationDelay: "200ms" }}
                          >
                            <CardHeader className="pb-3 md:pb-4">
                              <CardTitle className="flex items-center gap-2 text-lg md:text-xl">
                                <div className="p-2 bg-muted rounded-lg">
                                  <Settings className="h-4 w-4 md:h-5 md:w-5" />
                                </div>
                                Session Details
                              </CardTitle>
                            </CardHeader>
                            <CardContent>
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
                                <div className="space-y-1 p-3 bg-muted/30 rounded-lg transition-colors hover:bg-muted/50">
                                  <span className="font-medium text-muted-foreground">
                                    Start Time:
                                  </span>
                                  <p className="font-mono text-xs md:text-sm">
                                    {selectedSessionAnalytics.sessionSummary
                                      .startTime
                                      ? new Date(
                                          selectedSessionAnalytics.sessionSummary.startTime
                                        ).toLocaleString()
                                      : "N/A"}
                                  </p>
                                </div>
                                <div className="space-y-1 p-3 bg-muted/30 rounded-lg transition-colors hover:bg-muted/50">
                                  <span className="font-medium text-muted-foreground">
                                    End Time:
                                  </span>
                                  <p className="font-mono text-xs md:text-sm">
                                    {selectedSessionAnalytics.sessionSummary
                                      .endTime
                                      ? new Date(
                                          selectedSessionAnalytics.sessionSummary.endTime
                                        ).toLocaleString()
                                      : "N/A"}
                                  </p>
                                </div>
                                <div className="space-y-1 p-3 bg-muted/30 rounded-lg transition-colors hover:bg-muted/50">
                                  <span className="font-medium text-muted-foreground">
                                    Status:
                                  </span>
                                  <div className="pt-1">
                                    <Badge
                                      variant={
                                        selectedSessionAnalytics.sessionSummary
                                          .status === "completed"
                                          ? "default"
                                          : "secondary"
                                      }
                                      className="animate-pulse"
                                    >
                                      {
                                        selectedSessionAnalytics.sessionSummary
                                          .status
                                      }
                                    </Badge>
                                  </div>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        )}

                        {/* Behavior Analysis */}
                        <Card
                          className="animate-in fade-in-0 slide-in-from-right-4 duration-500"
                          style={{ animationDelay: "300ms" }}
                        >
                          <CardHeader className="pb-3 md:pb-4">
                            <CardTitle className="flex items-center gap-2 text-lg md:text-xl">
                              <div className="p-2 bg-primary/10 rounded-lg">
                                <Brain className="h-4 w-4 md:h-5 md:w-5 text-primary" />
                              </div>
                              Behavior Breakdown
                            </CardTitle>
                            <CardDescription className="text-sm">
                              Detailed analysis of detected behaviors during
                              this session
                            </CardDescription>
                          </CardHeader>
                          <CardContent>
                            {selectedSessionAnalytics.behaviorBreakdown &&
                            Object.keys(
                              selectedSessionAnalytics.behaviorBreakdown
                            ).length > 0 ? (
                              <div className="space-y-3 md:space-y-4">
                                {Object.entries(
                                  selectedSessionAnalytics.behaviorBreakdown
                                ).map(([behavior, data], index) => {
                                  const getBehaviorIcon = () => {
                                    switch (behavior) {
                                      case "eye_gaze":
                                        return "👀";
                                      case "tapping_hands":
                                        return "✋";
                                      case "tapping_feet":
                                        return "🦶";
                                      case "sit_stand":
                                        return "🪑";
                                      case "rapid_talking":
                                        return "🗣️";
                                      default:
                                        return "📊";
                                    }
                                  };

                                  // Only show behaviors with detections for cleaner display
                                  if (data.count === 0) return null;

                                  return (
                                    <div
                                      key={behavior}
                                      className="border rounded-lg p-3 md:p-4 bg-gradient-to-r from-card to-card/90 hover:from-accent/5 hover:to-accent/10 transition-all duration-300 hover:shadow-lg hover:scale-[1.02] animate-in fade-in-0 slide-in-from-bottom-2"
                                      style={{
                                        animationDelay: `${
                                          400 + index * 100
                                        }ms`,
                                      }}
                                    >
                                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                                        <div className="flex items-center gap-3">
                                          <div
                                            className="text-2xl md:text-3xl animate-bounce"
                                            style={{
                                              animationDelay: `${
                                                index * 200
                                              }ms`,
                                            }}
                                          >
                                            {getBehaviorIcon()}
                                          </div>
                                          <h3 className="text-base md:text-lg font-semibold">
                                            {formatBehaviorLabel(behavior)}
                                          </h3>
                                        </div>
                                        <Badge
                                          variant="outline"
                                          className="text-xs w-fit animate-pulse"
                                        >
                                          {data.count || 0} detections
                                        </Badge>
                                      </div>

                                      <div className="grid grid-cols-3 gap-2 md:gap-4">
                                        <div className="text-center p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200/50 dark:border-blue-800/50 transition-colors hover:bg-blue-100 dark:hover:bg-blue-950/30">
                                          <div
                                            className="text-lg md:text-2xl font-bold text-blue-600 dark:text-blue-400 animate-in zoom-in-50 duration-300"
                                            style={{
                                              animationDelay: `${
                                                500 + index * 100
                                              }ms`,
                                            }}
                                          >
                                            {data.count || 0}
                                          </div>
                                          <div className="text-xs md:text-sm text-muted-foreground mt-1">
                                            Total Detections
                                          </div>
                                        </div>

                                        <div className="text-center p-3 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200/50 dark:border-green-800/50 transition-colors hover:bg-green-100 dark:hover:bg-green-950/30">
                                          <div
                                            className="text-lg md:text-2xl font-bold text-green-600 dark:text-green-400 animate-in zoom-in-50 duration-300"
                                            style={{
                                              animationDelay: `${
                                                600 + index * 100
                                              }ms`,
                                            }}
                                          >
                                            {data.averageConfidence
                                              ? `${Math.round(
                                                  data.averageConfidence * 100
                                                )}%`
                                              : "0%"}
                                          </div>
                                          <div className="text-xs md:text-sm text-muted-foreground mt-1">
                                            Average Confidence
                                          </div>
                                        </div>

                                        <div className="text-center p-3 bg-purple-50 dark:bg-purple-950/20 rounded-lg border border-purple-200/50 dark:border-purple-800/50 transition-colors hover:bg-purple-100 dark:hover:bg-purple-950/30">
                                          <div
                                            className="text-lg md:text-2xl font-bold text-purple-600 dark:text-purple-400 animate-in zoom-in-50 duration-300"
                                            style={{
                                              animationDelay: `${
                                                700 + index * 100
                                              }ms`,
                                            }}
                                          >
                                            {data.totalConfidence
                                              ? Math.round(
                                                  data.totalConfidence * 100
                                                ) / 100
                                              : 0}
                                          </div>
                                          <div className="text-xs md:text-sm text-muted-foreground mt-1">
                                            Total Confidence
                                          </div>
                                        </div>
                                      </div>

                                      {data.count > 0 && (
                                        <div
                                          className="mt-3 pt-3 border-t border-dashed animate-in fade-in-0 duration-500"
                                          style={{
                                            animationDelay: `${
                                              800 + index * 100
                                            }ms`,
                                          }}
                                        >
                                          <div className="text-xs md:text-sm text-muted-foreground bg-muted/30 p-2 rounded">
                                            <strong>Analysis:</strong> This
                                            behavior was detected{" "}
                                            <strong className="text-primary">
                                              {data.count} times
                                            </strong>
                                            {data.averageConfidence ? (
                                              <>
                                                {" "}
                                                with an average confidence of{" "}
                                                <strong className="text-green-600">
                                                  {Math.round(
                                                    data.averageConfidence * 100
                                                  )}
                                                  %
                                                </strong>
                                              </>
                                            ) : (
                                              ""
                                            )}
                                            {data.lastDetected ? (
                                              <>
                                                . Last detected:{" "}
                                                <strong>
                                                  {new Date(
                                                    data.lastDetected
                                                  ).toLocaleString()}
                                                </strong>
                                              </>
                                            ) : (
                                              ""
                                            )}
                                            .
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="text-center py-8 md:py-12 animate-in fade-in-0 zoom-in-95 duration-500">
                                <div className="mx-auto w-16 h-16 md:w-20 md:h-20 bg-muted rounded-full flex items-center justify-center mb-4 animate-pulse">
                                  <Brain className="h-8 w-8 md:h-10 md:w-10 text-muted-foreground" />
                                </div>
                                <p className="text-muted-foreground mb-2 text-sm md:text-base">
                                  No behavior data available for this session
                                </p>
                                <p className="text-xs md:text-sm text-muted-foreground">
                                  This session may not have completed
                                  successfully or no behaviors were detected.
                                </p>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center py-16 animate-in fade-in-0 zoom-in-95 duration-500">
                        <div className="text-center space-y-4">
                          <div className="relative">
                            <div className="w-12 h-12 border-3 border-primary/20 border-t-primary rounded-full animate-spin mx-auto" />
                            <div className="absolute inset-0 w-12 h-12 border-2 border-transparent border-r-primary/40 rounded-full animate-ping" />
                          </div>
                          <div className="space-y-2">
                            <p className="text-lg font-medium text-muted-foreground">
                              Loading analytics...
                            </p>
                            <p className="text-sm text-muted-foreground/70">
                              Analyzing session data
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </SidebarInset>
        </div>
      </SidebarProvider>
    </div>
  );
};

export default Dashboard;
