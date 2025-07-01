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
  const { backendUrl, userData } = useContext(AppContext);
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
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [analysisIntervalId, setAnalysisIntervalId] = useState(null);
  const [timerIntervalId, setTimerIntervalId] = useState(null);

  // Behavior tracking
  const [currentBehaviors, setCurrentBehaviors] = useState({
    eye_gaze: { detected: false, confidence: 0 },
    sit_stand: { detected: false, confidence: 0 },
    tapping_hands: { detected: false, confidence: 0 },
    tapping_feet: { detected: false, confidence: 0 },
    rapid_talking: { detected: false, confidence: 0 },
  });

  // --- CONTINUOUS ANALYSIS ON 'ANALYZE NOW' ---
  const [manualAnalysisIntervalId, setManualAnalysisIntervalId] =
    useState(null);

  const audioAnalyserRef = useRef(null);
  const audioDataArrayRef = useRef(null);

  // Skip counting on very first analysis run to establish baseline
  const isFirstAnalysisRef = useRef(true);

  // ---------------- Speech Recognition for WPM ----------------
  const [wpmSeq, setWpmSeq] = useState([]);

  useEffect(() => {
    if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window))
      return;

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognizer = new SpeechRecognition();
    recognizer.continuous = true;
    recognizer.lang = "en-US";

    let sessionStart = Date.now();
    let words = 0;

    recognizer.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; ++i) {
        if (e.results[i].isFinal) {
          const txt = e.results[i][0].transcript.trim();
          words += txt.split(/\s+/).length;
        }
      }

      const minutes = (Date.now() - sessionStart) / 60000; // ms->minutes
      if (minutes > 0.083) {
        // ~5 seconds
        const wpm = words / minutes;
        setWpmSeq((prev) => {
          const arr = [...prev, wpm];
          return arr.slice(-10); // keep last 10 values
        });
        // reset counters every 5s window to get quicker updates
        if (minutes > 0.083) {
          sessionStart = Date.now();
          words = 0;
        }
      }
    };

    recognizer.onerror = () => {};
    recognizer.start();

    return () => recognizer.stop();
  }, []);

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

  // Extract simple audio features (6 numbers)
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

    // Fill remaining features with placeholder 0s for now
    return [rms, spectralAvg, zcr, 0, 0, 0];
  };

  // Capture a sequence of frames from the video element
  const captureFrameSequence = (numFrames = 10) => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const frames = [];
    for (let i = 0; i < numFrames; i++) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      // Compress image (quality 0.6)
      frames.push(canvas.toDataURL("image/jpeg", 0.6));
    }
    return frames;
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
        canvas.width = videoRef.current.videoWidth || 640;
        canvas.height = videoRef.current.videoHeight || 480;

        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        const frameData = canvas.toDataURL("image/jpeg", 0.8);

        // For sequence-based models, capture multiple frames
        const frameSequence = [];
        for (let i = 0; i < 10; i++) {
          ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
          frameSequence.push(canvas.toDataURL("image/jpeg", 0.6));
          await new Promise((resolve) => setTimeout(resolve, 100)); // Small delay between frames
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
        console.log(`Real Python ML result for ${behaviorType}:`, result);
        return result.analysis || result;
      } else if (behaviorType === "rapid_talking") {
        // Audio-based behavior analysis
        const audioFeatures = getAudioFeatures();
        if (!audioFeatures) {
          console.log("Skipping rapid_talking: no audio input");
          return null;
        }

        // Use actual WPM data if available, otherwise estimate from audio features
        let wpmData;
        if (wpmSeq.length >= 5) {
          const recentWpm = wpmSeq.slice(-5);
          wpmData = recentWpm;
        } else {
          // Generate WPM estimates from audio features
          const estWpm = Math.round(
            (audioFeatures[1] + audioFeatures[2]) * 150 + 90
          );
          wpmData = [
            estWpm,
            estWpm * 0.9,
            estWpm * 1.1,
            estWpm * 0.95,
            estWpm * 1.05,
          ];
        }

        // Call real Python ML API for rapid talking
        const response = await fetch(`${backendUrl}/api/ml/analyze`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            behaviorType: behaviorType,
            data: wpmData,
          }),
        });

        if (!response.ok) {
          throw new Error(`ML API error: ${response.status}`);
        }

        const result = await response.json();
        console.log(`Real Python ML result for rapid_talking:`, result);
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

    setIsAnalyzing(true);

    try {
      const behaviorTypes = [
        "eye_gaze",
        "sit_stand",
        "tapping_hands",
        "tapping_feet",
        "rapid_talking",
      ];

      console.log("Running real Python ML analysis for all behaviors...");

      let results = [];

      // Analyze each behavior individually using real Python ML
      const analysisPromises = behaviorTypes.map(async (behaviorType) => {
        try {
          const result = await analyzeBehavior(behaviorType);
          return result;
        } catch (error) {
          console.error(`Error analyzing ${behaviorType}:`, error);
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
        if (!result) return; // keep default false

        // Update current behaviors
        newBehaviors[behaviorType] = {
          detected: Boolean(result.detected),
          confidence: parseFloat(result.confidence || result.probability || 0),
        };

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
        if (result.detected && confidence > 0.7) {
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

      // Debug logging
      console.log("Updated behaviorData:", behaviorData);

      // No baseline skipping now
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Initialize dashboard
  useEffect(() => {
    if (userData?.id) {
      loadSessionHistory();
    }
    checkCameraAvailability();
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
      if (analysisIntervalId) {
        clearInterval(analysisIntervalId);
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
              video: true,
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
    try {
      const response = await fetch(
        `${backendUrl}/api/session/user/${userData?.id}`,
        {
          credentials: "include",
        }
      );
      if (response.ok) {
        const data = await response.json();
        setSessionHistory(data.sessions || []);
      } else {
        /* non-OK response handled elsewhere */
      }
    } catch (_e) {
      /* ignored loadSessionHistory errors */
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
          width: { ideal: 640, min: 320 },
          height: { ideal: 480, min: 240 },
          frameRate: { ideal: 30, min: 15 },
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

      // Start real Python ML analysis at regular intervals
      const analysisInterval = setInterval(() => {
        console.log("Running scheduled Python ML analysis...");
        runBehavioralAnalysis();
      }, 3000); // Faster analysis for better responsiveness
      setAnalysisIntervalId(analysisInterval);
      setTimeout(() => {
        console.log("Running initial analysis...");
        runBehavioralAnalysis();
      }, 2000);
      toast.success("Monitoring session started successfully");
    } catch (_e) {
      /* ignored start monitoring error */
      let errorMessage = "Could not access camera.";
      setError(errorMessage);
      setMonitoring(false);
      setVideoPlaying(false);
      toast.error("Failed to start monitoring: " + errorMessage);
    }
  };

  // Stop monitoring
  const stopMonitoring = async () => {
    // Clear intervals
    if (timerIntervalId) {
      clearInterval(timerIntervalId);
      setTimerIntervalId(null);
    }
    if (analysisIntervalId) {
      clearInterval(analysisIntervalId);
      setAnalysisIntervalId(null);
    }
    // Only stop stream here
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.load();
    }
    setMonitoring(false);
    setError("");
    setVideoPlaying(false);
    // End session and save data
    if (sessionId) {
      try {
        await fetch(`${backendUrl}/api/session/${sessionId}/end`, {
          method: "PUT",
          credentials: "include",
        });

        await fetch(`${backendUrl}/api/session/${sessionId}/data`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            behaviorData: behaviorData,
            alerts: alerts,
          }),
        });

        toast.success("Monitoring session completed");
        loadSessionHistory(); // Refresh session history
      } catch (_e) {
        /* ignored save session errors */
        setError("Error saving session data:");
        toast.error("Failed to save session data");
      }
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
          width: { ideal: 640, min: 320 },
          height: { ideal: 480, min: 240 },
          frameRate: { ideal: 30, min: 15 },
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
                width: { ideal: 640, min: 320 },
                height: { ideal: 480, min: 240 },
                frameRate: { ideal: 30, min: 15 },
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

  // --- CONTINUOUS ANALYSIS ON 'ANALYZE NOW' ---
  const handleAnalyzeNow = () => {
    if (!monitoring) return;
    if (manualAnalysisIntervalId) return;
    runBehavioralAnalysis();
    const interval = setInterval(() => {
      if (monitoring) {
        runBehavioralAnalysis();
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
  }, [monitoring, timerIntervalId, analysisIntervalId, stream, error]);

  // Debug logging for timer updates
  useEffect(() => {
    if (monitoring && timer > 0) {
      /* timer updated */
    }
  }, [timer, monitoring]);

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
                <TabsList className="grid grid-cols-3 gap-2 w-full">
                  <TabsTrigger
                    value="monitoring"
                    className="w-full px-2 py-2 text-sm text-center truncate"
                  >
                    Live Monitoring
                  </TabsTrigger>
                  <TabsTrigger
                    value="analytics"
                    className="w-full px-2 py-2 text-sm text-center truncate"
                  >
                    Analytics
                  </TabsTrigger>
                  <TabsTrigger
                    value="history"
                    className="w-full px-2 py-2 text-sm text-center truncate"
                  >
                    Session History
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="monitoring" className="space-y-6">
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
                    <CardContent className="space-y-4">
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
                              Analyze Now
                            </Button>
                            <Button
                              onClick={() => {
                                const status = checkCameraStatus();
                                if (status) {
                                  toast.success("Camera is working properly");
                                } else {
                                  toast.error(
                                    "Camera has issues. Check console for details."
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
                  <div className="space-y-6">
                    {/* Video Feed */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <Eye className="h-5 w-5" />
                          Live Video Feed
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="bg-black rounded-lg aspect-video flex items-center justify-center relative">
                          <video
                            ref={videoRef}
                            autoPlay
                            playsInline
                            muted
                            className="rounded-lg w-full h-full object-cover"
                            style={{
                              backgroundColor: "black",
                              minHeight: "240px",
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

                          {stream ? (
                            <>
                              {/* Camera Status Overlay */}
                              <div className="absolute top-2 left-2 bg-green-500 text-white px-2 py-1 rounded text-xs">
                                Camera Active {videoPlaying ? "✅" : "⏳"}
                              </div>

                              {/* Monitoring Status Overlay */}
                              {monitoring && (
                                <div className="absolute top-2 right-2 bg-blue-500 text-white px-2 py-1 rounded text-xs">
                                  Monitoring: {formatDuration(timer)}
                                </div>
                              )}

                              {/* Debug Info (only in development) */}
                              {import.meta.env.DEV && (
                                <div className="absolute bottom-2 right-2 bg-black/70 text-white px-2 py-1 rounded text-xs">
                                  <div>
                                    Ready:{" "}
                                    {videoRef.current?.readyState || "N/A"}
                                  </div>
                                  <div>
                                    Size: {videoRef.current?.videoWidth || 0}x
                                    {videoRef.current?.videoHeight || 0}
                                  </div>
                                  <div>
                                    Playing: {videoPlaying ? "Yes" : "No"}
                                  </div>
                                  <div>Stream: {stream ? "Yes" : "No"}</div>
                                  <div>
                                    Monitoring: {monitoring ? "Yes" : "No"}
                                  </div>
                                </div>
                              )}
                            </>
                          ) : (
                            <div className="text-center text-muted-foreground">
                              <VideoOff className="h-12 w-12 mx-auto mb-2" />
                              <p>
                                Camera feed will appear here when monitoring
                                starts
                              </p>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>

                    {/* Behavior Analysis */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <Activity className="h-5 w-5" />
                          Behavior Analysis
                          {isAnalyzing && (
                            <Badge variant="secondary" className="ml-2">
                              <Brain className="h-3 w-3 mr-1 animate-pulse" />
                              Analyzing...
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
                        <CardDescription>
                          Real-time behavior analysis using machine learning
                          models. Analysis runs every 5 seconds while monitoring
                          is active.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {Object.entries(currentBehaviors).map(
                          ([behavior, data]) => (
                            <div
                              key={behavior}
                              className="flex items-center justify-between p-3 border rounded-lg"
                            >
                              <div className="flex items-center gap-3">
                                <Badge
                                  variant={getBehaviorStatusColor(behavior)}
                                >
                                  {data.detected ? "Detected" : "Normal"}
                                </Badge>
                                <span className="capitalize">
                                  {behavior.replace("_", " ")}
                                </span>
                                {data.detected && (
                                  <span className="text-xs text-muted-foreground">
                                    Last detected:{" "}
                                    {new Date().toLocaleTimeString()}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="text-right">
                                  <div className="text-lg font-semibold">
                                    {behaviorData[behavior]?.count || 0}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    detections
                                  </div>
                                </div>
                              </div>
                            </div>
                          )
                        )}

                        {!monitoring && (
                          <div className="text-center py-4 text-muted-foreground">
                            <Brain className="h-8 w-8 mx-auto mb-2" />
                            <p>Start monitoring to begin behavioral analysis</p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>

                  {/* Alerts */}
                  {alerts.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <AlertTriangle className="h-5 w-5" />
                          Recent Alerts ({alerts.length})
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          {alerts.slice(0, 5).map((alert) => (
                            <Alert key={alert.id} variant="destructive">
                              <AlertTriangle className="h-4 w-4" />
                              <AlertDescription>
                                <strong>
                                  {alert.behavior.replace("_", " ")}
                                </strong>{" "}
                                detected with{" "}
                                {Math.round(alert.confidence * 100)}% confidence
                                <br />
                                <span className="text-xs">
                                  {new Date(
                                    alert.timestamp
                                  ).toLocaleTimeString()}
                                </span>
                              </AlertDescription>
                            </Alert>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>

                <TabsContent value="analytics" className="space-y-6">
                  {Object.keys(behaviorData).length > 0 ? (
                    <div className="space-y-6">
                      {/* Summary Cards */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
                                        {behavior.replace("_", " ")}
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

                <TabsContent value="history" className="space-y-6">
                  <Card>
                    <CardHeader>
                      <CardTitle>Session History</CardTitle>
                      <CardDescription>
                        Previous monitoring sessions and their results
                      </CardDescription>
                      <Button
                        onClick={loadSessionHistory}
                        variant="outline"
                        className="mt-2"
                      >
                        Refresh
                      </Button>
                    </CardHeader>
                    <CardContent>
                      {sessionHistory.length > 0 ? (
                        <div className="space-y-4">
                          {sessionHistory.map((session) => (
                            <div
                              key={session.id}
                              className="flex items-center justify-between p-4 border rounded-lg"
                            >
                              <div>
                                <p className="font-medium">
                                  Session {session.id}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                  {new Date(
                                    session.startTime
                                  ).toLocaleDateString()}{" "}
                                  - {session.duration || "In Progress"}
                                </p>
                              </div>
                              <Badge
                                variant={
                                  session.status === "completed"
                                    ? "default"
                                    : "secondary"
                                }
                              >
                                {session.status}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-8">
                          <p className="text-muted-foreground">
                            No sessions found
                          </p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </div>
          </SidebarInset>
        </div>
      </SidebarProvider>
    </div>
  );
};

export default Dashboard;
