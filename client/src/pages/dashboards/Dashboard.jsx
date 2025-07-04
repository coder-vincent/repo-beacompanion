import React, {
  useRef,
  useState,
  useEffect,
  useContext,
  useCallback,
} from "react";
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

const SPEECH_CHECK_INTERVAL = 60000;
const RAPID_TALKING_MIN_WPM = 150;
const RAPID_TALKING_MAX_WPM = 200;
const MIN_TRANSCRIPT_CONFIDENCE = 0.5;

const MAX_CONCURRENT_ANALYSES = 2;
const BATCH_BEHAVIORS = [
  "eye_gaze",
  "tapping_hands",
  "tapping_feet",
  "sit_stand",
];

const Dashboard = () => {
  const { backendUrl, userData } = useContext(AppContext);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const [monitoring, setMonitoring] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [timer, setTimer] = useState(0);
  const [stream, setStream] = useState(null);
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
  const timerIntervalIdRef = useRef(null);
  const [isLoadingAnalytics, setIsLoadingAnalytics] = useState(false);

  const [currentBehaviors, setCurrentBehaviors] = useState({
    eye_gaze: { detected: false, confidence: 0 },
    sit_stand: { detected: false, confidence: 0 },
    tapping_hands: { detected: false, confidence: 0 },
    tapping_feet: { detected: false, confidence: 0 },
    rapid_talking: { detected: false, confidence: 0 },
  });

  const [_tapCounter, setTapCounter] = useState({
    taps: 0,
    claps: 0,
    startTime: null,
    isActive: false,
    displayResults: false,
    lastDisplayTime: 0,
  });

  const tapTimerRef = useRef(null);

  const [manualAnalysisIntervalId, setManualAnalysisIntervalId] =
    useState(null);

  const [lastFrame, setLastFrame] = useState(null);
  const [motionThreshold] = useState(60);

  const analysisInFlightRef = useRef(0);
  const monitoringRef = useRef(monitoring);

  const [, setRapidTalkingStatus] = useState("Ready");
  const wordCountRef = useRef(0);
  const [, setSessionStartTime] = useState(null);
  const speechIntervalRef = useRef(null);
  const [currentWpm, setCurrentWpm] = useState(0);
  const wpm30IntervalRef = useRef(null);
  const interimTranscriptRef = useRef("");

  const recognizerRef = useRef(null);
  const sessionStartRef = useRef(null);

  const wpmListRef = useRef([]);

  const streamFailCountRef = useRef(0);

  const animationFrameIdRef = useRef(null);

  const abortControllersRef = useRef(new Set());

  const fetchWithAbort = useCallback(async (url, options = {}) => {
    const controller = new AbortController();
    abortControllersRef.current.add(controller);
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      abortControllersRef.current.delete(controller);
      return response;
    } catch (err) {
      abortControllersRef.current.delete(controller);
      throw err;
    }
  }, []);

  const loadSessionHistory = useCallback(async () => {
    if (!userData?.id) {
      console.warn("loadSessionHistory: No user ID available");
      return;
    }

    try {
      const authTokenHistory = localStorage.getItem("authToken");
      const response = await fetch(
        `${backendUrl}/api/session/user/${userData.id}`,
        {
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(authTokenHistory
              ? { Authorization: `Bearer ${authTokenHistory}` }
              : {}),
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
          `Failed to load session history:`,
          response.status,
          errorData
        );
        if (response.status === 401) {
          console.warn("Authentication required for session history");
        }
      }
    } catch (error) {
      console.error("Error loading session history:", error);
    }
  }, [userData?.id, backendUrl]);

  const detectMotion = () => {
    if (!videoRef.current || !canvasRef.current) return false;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const video = videoRef.current;

    if (!video.videoWidth || !video.videoHeight) {
      return false;
    }

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
      return false;
    }

    const bodyStartY = Math.floor(canvas.height * 0.25);
    const bodyEndY = Math.floor(canvas.height * 0.9);
    const bodyStartX = Math.floor(canvas.width * 0.15);
    const bodyEndX = Math.floor(canvas.width * 0.85);

    let pixelDifference = 0;
    let pixelsChecked = 0;
    const sampleRate = 6;

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

  const captureFrameSequence = (
    numFrames = 4,
    imageQuality = 0.5,
    scaleFactor = 0.5
  ) => {
    return new Promise((resolve) => {
      const frames = [];
      const captureInterval = 100;

      const captureFrame = () => {
        if (!videoRef.current || frames.length >= numFrames) {
          resolve(frames);
          return;
        }

        try {
          const canvas = canvasRef.current;
          const video = videoRef.current;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });

          const targetW = (video.videoWidth || 1280) * scaleFactor;
          const targetH = (video.videoHeight || 720) * scaleFactor;

          canvas.width = targetW;
          canvas.height = targetH;

          ctx.drawImage(video, 0, 0, targetW, targetH);

          const dataURL = canvas.toDataURL("image/jpeg", imageQuality);
          frames.push(dataURL);

          setTimeout(captureFrame, captureInterval);
        } catch (error) {
          console.error("Frame capture error:", error);
          resolve(frames);
        }
      };

      captureFrame();
    });
  };

  const analyzeBehavior = async (behaviorType) => {
    try {
      if (
        ["eye_gaze", "tapping_hands", "tapping_feet", "sit_stand"].includes(
          behaviorType
        )
      ) {
        if (!videoRef.current) {
          return null;
        }

        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        canvas.width = videoRef.current.videoWidth || 1280;
        canvas.height = videoRef.current.videoHeight || 720;

        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        const frameData = canvas.toDataURL("image/jpeg", 0.9);

        const frameSequence =
          behaviorType === "sit_stand"
            ? await captureFrameSequence(10, 0.7, 0.8)
            : await captureFrameSequence(4, 0.5, 0.5);

        if (!frameSequence || frameSequence.length === 0) {
          return null;
        }

        const requestBody = {
          behaviorType: behaviorType,
          frame_sequence: frameSequence,
          frame: frameData,
        };

        let response;
        for (let attempt = 0; attempt < 3; attempt++) {
          response = await fetchWithAbort(`${backendUrl}/api/ml/analyze`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            credentials: "include",
            body: JSON.stringify(requestBody),
          });

          if (response.status !== 429) break;
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        }

        if (!response.ok) {
          throw new Error(`ML API error: ${response.status}`);
        }

        const result = await response.json();

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
      }

      return null;
    } catch (error) {
      if (error.name === "AbortError") {
        return null;
      }
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

  const runBehavioralAnalysis = async (frameCount = 12) => {
    if (!monitoring) {
      return;
    }

    if (analysisInFlightRef.current >= MAX_CONCURRENT_ANALYSES) {
      return;
    }
    analysisInFlightRef.current += 1;

    try {
      const frameSequence = await captureFrameSequence(frameCount, 0.6, 0.6);
      const representativeFrame = frameSequence[0];

      const behaviorsPayload = BATCH_BEHAVIORS.map((bt) => ({
        type: bt,
        frame_sequence: frameSequence,
        frame: representativeFrame,
      }));

      let analysisResults = [];

      try {
        const response = await fetchWithAbort(`${backendUrl}/api/ml/batch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ behaviors: behaviorsPayload }),
        });

        if (!response.ok) {
          throw new Error(`Batch ML error: ${response.status}`);
        }

        const batchData = await response.json();
        analysisResults = batchData.results || [];
      } catch (error) {
        if (error.name !== "AbortError") {
          console.error("Batch analysis error:", error);
        }
        analysisResults = behaviorsPayload.map((b) => ({
          behavior_type: b.type,
          detected: false,
          confidence: 0,
          timestamp: new Date().toISOString(),
          message: `Batch analysis failed: ${error.message}`,
        }));
      }

      const newBehaviors = { ...currentBehaviors };

      const newAlerts = [...alerts];
      const incrementMap = {};

      analysisResults.forEach((result) => {
        const behaviorType = result?.behavior_type || result?.type;

        if (!result) {
          return;
        }

        newBehaviors[behaviorType] = {
          detected: Boolean(result.detected),
          confidence: parseFloat(result.confidence || result.probability || 0),
        };
        if (behaviorType === "tapping_hands") {
          if (result.analysis_type === "pattern_recognition") {
            if (result.detected) {
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
          }
        }

        if (!incrementMap[behaviorType]) {
          incrementMap[behaviorType] = { inc: 0, conf: 0 };
        }
        const rawConf = result.confidence ?? result.probability ?? 0;
        const numericConf = parseFloat(rawConf) || 0;

        if (result.detected) {
          incrementMap[behaviorType].inc += 1;
          incrementMap[behaviorType].conf += numericConf;
        }

        const confidence = numericConf;
        if (result.detected && confidence > 0.4) {
          const alert = {
            id: Date.now() + Math.random(),
            behavior: behaviorType,
            confidence: confidence,
            timestamp: new Date().toISOString(),
          };
          newAlerts.unshift(alert);

          if (newAlerts.length > 10) {
            newAlerts.pop();
          }
        }
      });

      setCurrentBehaviors(newBehaviors);
      setAlerts(newAlerts);

      setBehaviorData((prev) => {
        const updated = { ...prev };
        Object.entries(incrementMap).forEach(([behavior]) => {
          if (!updated[behavior]) {
            updated[behavior] = { count: 0, totalConfidence: 0 };
          }
          const incInfo = incrementMap[behavior];
          if (incInfo) {
            updated[behavior].count += incInfo.inc;
            const prevTotal =
              parseFloat(updated[behavior].totalConfidence) || 0;
            updated[behavior].totalConfidence = prevTotal + incInfo.conf;
          }
        });
        return updated;
      });

      setCurrentBehaviors((prev) => ({ ...prev, ...newBehaviors }));
      setAlerts(newAlerts.slice(-10));
    } catch (error) {
      console.error("Behavioral analysis failed:", error);
    } finally {
      analysisInFlightRef.current = Math.max(
        0,
        analysisInFlightRef.current - 1
      );
    }
  };

  useEffect(() => {
    if (userData?.id) {
      loadSessionHistory();
    }
  }, [userData?.id, loadSessionHistory]);

  useEffect(() => {
    const currentVideo = videoRef.current;
    return () => {
      if (timerIntervalIdRef.current) {
        clearInterval(timerIntervalIdRef.current);
      }
      if (speechIntervalRef.current) {
        clearInterval(speechIntervalRef.current);
      }
      if (currentVideo) {
        currentVideo.srcObject = null;
      }
    };
  }, []);

  useEffect(() => {
    const currentVideoRef = videoRef.current;
    if (currentVideoRef && stream && stream.active) {
      if (currentVideoRef.srcObject !== stream) {
        currentVideoRef.srcObject = stream;
        currentVideoRef.muted = true;
        currentVideoRef.playsInline = true;
        currentVideoRef.autoplay = true;
        currentVideoRef.play().catch(() => {
          toast("Click anywhere on the page to enable camera playback.");
        });
      }
    }
  }, [stream]);

  const loadSessionAnalytics = async (sessionId) => {
    try {
      setIsLoadingAnalytics(true);
      setSelectedSessionAnalytics(null);
      setShowSessionAnalyticsModal(true);

      const authToken = localStorage.getItem("authToken");
      const response = await fetch(
        `${backendUrl}/api/session/${sessionId}/analytics`,
        {
          method: "GET",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
        }
      );

      if (response.ok) {
        const data = await response.json();

        setTimeout(() => {
          setSelectedSessionAnalytics(data.analytics);
          setIsLoadingAnalytics(false);
        }, 300);
      } else {
        const errorData = await response.text();
        console.error(
          `Failed to load session analytics: ${response.status}`,
          errorData
        );

        setIsLoadingAnalytics(false);
        setShowSessionAnalyticsModal(false);

        if (response.status === 401) {
          console.warn("Authentication required for session analytics");
          toast.error("Please log in to view session analytics");
        } else {
          toast.error(`Failed to load session analytics (${response.status})`);
        }
      }
    } catch (error) {
      console.error("Error loading session analytics:", error);
      setIsLoadingAnalytics(false);
      setShowSessionAnalyticsModal(false);
      toast.error("Error loading session analytics");
    }
  };

  const createSession = async () => {
    try {
      const authTokenCreate = localStorage.getItem("authToken");
      const response = await fetch(`${backendUrl}/api/session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authTokenCreate
            ? { Authorization: `Bearer ${authTokenCreate}` }
            : {}),
        },
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
        return null;
      }
    } catch {
      toast.error("Session creation failed, but monitoring will continue");
      return null;
    }
  };

  const startMonitoring = async () => {
    console.log("[RapidTalking] startMonitoring called");
    setError("");
    setAlerts([]);
    setBehaviorData({
      eye_gaze: { count: 0, totalConfidence: 0 },
      tapping_hands: { count: 0, totalConfidence: 0 },
      tapping_feet: { count: 0, totalConfidence: 0 },
      sit_stand: { count: 0, totalConfidence: 0 },
      rapid_talking: { count: 0, totalConfidence: 0 },
    });
    setCurrentBehaviors({
      eye_gaze: { detected: false, confidence: 0 },
      sit_stand: { detected: false, confidence: 0 },
      tapping_hands: { detected: false, confidence: 0 },
      tapping_feet: { detected: false, confidence: 0 },
      rapid_talking: { detected: false, confidence: 0 },
    });

    if (monitoring && stream) {
      await stopMonitoring();
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    try {
      const userStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1920, min: 640 },
          height: { ideal: 1080, min: 480 },
          frameRate: { ideal: 30, min: 15 },
          facingMode: "user",
        },
        audio: true,
      });
      setStream(userStream);
      setMonitoring(true);
      setIsAnalyzing(true);
      const newSessionId = await createSession();
      setSessionId(newSessionId);
      const startTime = Date.now();
      const interval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        setTimer(elapsed);
      }, 1000);
      timerIntervalIdRef.current = interval;

      const startRealTimeAnalysis = () => {
        let lastAnalysisTime = 0;
        let lastMotionCheckTime = 0;
        let lastSitStandTime = 0;
        const analysisThrottle = 600;
        const motionCheckThrottle = 500;
        const sitStandCooldown = 8000;

        const analyzeFrame = () => {
          const now = Date.now();

          if (
            now - lastAnalysisTime >= analysisThrottle &&
            videoRef.current &&
            !videoRef.current.paused &&
            !videoRef.current.ended
          ) {
            runFrequentBehaviorAnalysis();
            lastAnalysisTime = now;
          }

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

          if (monitoringRef.current) {
            animationFrameIdRef.current = requestAnimationFrame(analyzeFrame);
          }
        };

        animationFrameIdRef.current = requestAnimationFrame(analyzeFrame);
      };

      startRealTimeAnalysis();

      setTimeout(() => {
        runFrequentBehaviorAnalysis();
        setTimeout(() => {
          runSitStandAnalysis();
        }, 500);
      }, 1000);

      toast.success("Camera Connected");
    } catch {
      let errorMessage = "Could not access camera.";
      setError(errorMessage);
      setMonitoring(false);
      setIsAnalyzing(false);
      setVideoPlaying(false);
      toast.error("Failed to start monitoring: " + errorMessage);
    }
  };

  const stopMonitoring = async () => {
    try {
      setMonitoring(false);
      setIsAnalyzing(false);

      if (manualAnalysisIntervalId) {
        clearInterval(manualAnalysisIntervalId);
        setManualAnalysisIntervalId(null);
      }

      if (timerIntervalIdRef.current) {
        clearInterval(timerIntervalIdRef.current);
        timerIntervalIdRef.current = null;
      }

      if (speechIntervalRef.current) {
        clearInterval(speechIntervalRef.current);
      }

      if (tapTimerRef.current) {
        clearTimeout(tapTimerRef.current);
        tapTimerRef.current = null;
      }

      setTapCounter({
        taps: 0,
        claps: 0,
        startTime: null,
        isActive: false,
        displayResults: false,
        lastDisplayTime: 0,
      });

      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        setStream(null);
      }

      stopSpeechMonitoring();

      if (sessionId) {
        const authTokenEnd = localStorage.getItem("authToken");
        const sessionPayload = {
          endTime: new Date().toISOString(),
          duration: formatDuration(timer),
          status: "completed",
          behaviorData: behaviorData,
          alerts: alerts,
        };

        await fetchWithAbort(`${backendUrl}/api/session/${sessionId}/end`, {
          method: "PUT",
          headers: authTokenEnd
            ? {
                Authorization: `Bearer ${authTokenEnd}`,
                "Content-Type": "application/json",
              }
            : { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(sessionPayload),
        });
        setSessionId(null);
        await loadSessionHistory();
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

      // Cancel the animation loop so no further analysis runs after stopping.
      if (animationFrameIdRef.current !== null) {
        cancelAnimationFrame(animationFrameIdRef.current);
        animationFrameIdRef.current = null;
      }

      // Abort all pending network requests related to analysis.
      abortControllersRef.current.forEach((controller) => controller.abort());
      abortControllersRef.current.clear();
    } catch (error) {
      console.error("Error stopping monitoring:", error);
      toast.error("Error stopping monitoring");
    }
  };

  const formatDuration = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const getBehaviorStatusColor = (behavior) => {
    const data = currentBehaviors[behavior];
    if (data.detected && data.confidence > 0.7) return "destructive";
    if (data.detected) return "secondary";
    return "default";
  };
  const monitorStreamHealth = useCallback(() => {
    if (!stream || !monitoring) return true;
    return stream.active;
  }, [stream, monitoring]);

  useEffect(() => {
    if (monitoring && stream) {
      const healthInterval = setInterval(async () => {
        const isHealthy = monitorStreamHealth();
        if (!isHealthy) {
          streamFailCountRef.current += 1;
        } else {
          streamFailCountRef.current = 0;
        }

        if (streamFailCountRef.current >= 3) {
          streamFailCountRef.current = 0;
          toast.error("Camera stream lost. Attempting to reacquire...");
          try {
            const newStream = await navigator.mediaDevices.getUserMedia({
              video: {
                width: { ideal: 1920, min: 640 },
                height: { ideal: 1080, min: 480 },
                frameRate: { ideal: 30, min: 15 },
                facingMode: "user",
              },
              audio: true,
            });
            if (stream) {
              stream.getTracks().forEach((track) => track.stop());
            }
            setStream(newStream);
            if (videoRef.current) {
              videoRef.current.srcObject = newStream;
              videoRef.current.play().catch(() => {});
            }
            toast.success("Camera stream reacquired successfully");
          } catch {
            toast.error(
              "Failed to reacquire camera. Please check your camera."
            );
          }
        }
      }, 10000);

      return () => {
        clearInterval(healthInterval);
      };
    }
  }, [monitoring, stream, monitorStreamHealth]);

  const handleAnalyzeNow = () => {
    if (!monitoring) return;
    if (manualAnalysisIntervalId) return;

    if (!speechIntervalRef.current) {
      startSpeechMonitoring();
    }

    runBehavioralAnalysis(3);

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

  useEffect(() => {
    if (!monitoring && manualAnalysisIntervalId) {
      clearInterval(manualAnalysisIntervalId);
      setManualAnalysisIntervalId(null);
    }
  }, [monitoring, manualAnalysisIntervalId]);

  const runFrequentBehaviorAnalysis = async () => {
    if (!monitoring) {
      return;
    }

    if (analysisInFlightRef.current >= MAX_CONCURRENT_ANALYSES) {
      return;
    }
    analysisInFlightRef.current += 1;

    try {
      const frameSequence = await captureFrameSequence(12, 0.6, 0.6);

      const representativeFrame = frameSequence[0];

      const behaviorsPayload = BATCH_BEHAVIORS.map((bt) => ({
        type: bt,
        frame_sequence: frameSequence,
        frame: representativeFrame,
      }));

      let analysisResults = [];

      try {
        const response = await fetchWithAbort(`${backendUrl}/api/ml/batch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ behaviors: behaviorsPayload }),
        });

        if (!response.ok) {
          throw new Error(`Batch ML error: ${response.status}`);
        }

        const batchData = await response.json();
        analysisResults = batchData.results || [];
      } catch (error) {
        if (error.name !== "AbortError") {
          console.error("Batch analysis error:", error);
        }
        analysisResults = behaviorsPayload.map((b) => ({
          behavior_type: b.type,
          detected: false,
          confidence: 0,
          timestamp: new Date().toISOString(),
          message: `Batch analysis failed: ${error.message}`,
        }));
      }

      const newBehaviors = { ...currentBehaviors };

      const newAlerts = [...alerts];
      const incrementMap = {};

      analysisResults.forEach((result) => {
        const behaviorType = result?.behavior_type || result?.type;

        if (!result) {
          return;
        }

        newBehaviors[behaviorType] = {
          detected: Boolean(result.detected),
          confidence: parseFloat(result.confidence || result.probability || 0),
        };

        if (result.detected) {
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

      setCurrentBehaviors((prev) => ({ ...prev, ...newBehaviors }));
      setAlerts(newAlerts.slice(-10));
    } catch (error) {
      console.error("Frequent behavior analysis failed:", error);
    } finally {
      analysisInFlightRef.current = Math.max(
        0,
        analysisInFlightRef.current - 1
      );
    }
  };

  const runSitStandAnalysis = async () => {
    if (!monitoring) return;

    if (analysisInFlightRef.current >= MAX_CONCURRENT_ANALYSES) return;
    analysisInFlightRef.current += 1;

    try {
      const result = await analyzeBehavior("sit_stand");

      if (
        result &&
        result.detected &&
        result.analysis_type === "action_detected"
      ) {
        setCurrentBehaviors((prev) => ({
          ...prev,
          sit_stand: {
            detected: true,
            confidence: parseFloat(result.confidence || 0),
          },
        }));

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
        setCurrentBehaviors((prev) => ({
          ...prev,
          sit_stand: {
            detected: false,
            confidence: parseFloat(result?.confidence || 0),
          },
        }));
      }
    } catch (error) {
      console.error("Sit-stand analysis error:", error);
    } finally {
      analysisInFlightRef.current = Math.max(
        0,
        analysisInFlightRef.current - 1
      );
    }
  };

  const formatBehaviorLabel = (behavior) => {
    if (behavior === "sit_stand") return "Sitting/Standing";

    const titled = behavior
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    return titled;
  };

  const startSpeechRecognition = () => {
    if (recognizerRef.current) {
      try {
        recognizerRef.current.onend = null;
        recognizerRef.current.onerror = null;
        recognizerRef.current.onresult = null;
        recognizerRef.current.stop();
      } catch (e) {
        console.error("Speech recognition stop error:", e);
      }
      recognizerRef.current = null;
    }

    try {
      const SpeechRecognition =
        window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        setRapidTalkingStatus("Speech recognition not supported");
        return;
      }

      const recognizer = new SpeechRecognition();
      recognizer.continuous = true;
      recognizer.interimResults = true;
      recognizer.lang = "en-US";

      recognizer.onstart = () => {
        setRapidTalkingStatus("Listening...");
        if (!sessionStartRef.current) {
          wordCountRef.current = 0;
          setSessionStartTime(Date.now());
          sessionStartRef.current = Date.now();
        }
        interimTranscriptRef.current = "";
      };

      recognizer.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            const words = result[0].transcript
              .trim()
              .split(/\s+/)
              .filter(Boolean);
            wordCountRef.current += words.length;
          }
        }
      };

      recognizer.onerror = (event) => {
        if (event.error === "aborted") {
          console.log("[RapidTalking] Speech recognition aborted (not fatal)");
        } else if (event.error !== "no-speech") {
          setRapidTalkingStatus("Speech recognition error: " + event.error);
        }
      };

      recognizer.onend = () => {
        setRapidTalkingStatus("Speech recognition ended");
        if (
          sessionStartRef.current &&
          Date.now() - sessionStartRef.current < SPEECH_CHECK_INTERVAL
        ) {
          setTimeout(() => {
            startSpeechRecognition();
          }, 500);
        }
      };

      recognizerRef.current = recognizer;
      recognizer.start();
    } catch {
      setRapidTalkingStatus("Failed to start");
    }
  };

  const stopSpeechRecognition = () => {
    setRapidTalkingStatus("Stopped");
    if (recognizerRef.current) {
      try {
        recognizerRef.current.onend = null;
        recognizerRef.current.onerror = null;
        recognizerRef.current.onresult = null;
        recognizerRef.current.stop();
      } catch (e) {
        console.error("Speech recognition stop error:", e);
      }
      recognizerRef.current = null;
    }
    sessionStartRef.current = null;
  };

  const checkRapidTalking = async () => {
    if (wordCountRef.current === 0) {
      setRapidTalkingStatus("No speech detected");
      console.warn(
        "[RapidTalking] No speech detected in last interval. wordCount:",
        wordCountRef.current
      );
      return;
    }

    const averageWpm = (wordCountRef.current * 60000) / SPEECH_CHECK_INTERVAL;

    wpmListRef.current = [averageWpm];
    setCurrentWpm(averageWpm);
    console.log(
      `[RapidTalking] Minute summary → avgWpm=${averageWpm.toFixed(1)} (words=${
        wordCountRef.current
      })`
    );

    let backendDetected = false;
    let backendConfidence = 0;

    try {
      const response = await fetchWithAbort(`${backendUrl}/api/ml/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          behaviorType: "rapid_talking",
          data: wpmListRef.current,
        }),
      });
      const result = await response.json();
      backendDetected = Boolean(result.detected);

      const backendConfObj = result.confidence;
      if (backendConfObj && typeof backendConfObj === "object") {
        backendConfidence = parseFloat(
          backendConfObj.rapidTalking ?? backendConfObj.rapid_talking ?? 0
        );
      } else {
        backendConfidence = parseFloat(result.confidence || 0);
      }

      if (Number.isNaN(backendConfidence)) backendConfidence = 0;

      if (backendDetected) {
        setRapidTalkingStatus(
          `RAPID TALKING DETECTED (ML): ${(backendConfidence * 100).toFixed(
            1
          )}%`
        );
        setCurrentBehaviors((prev) => ({
          ...prev,
          rapid_talking: { detected: true, confidence: backendConfidence },
        }));
        setBehaviorData((prev) => ({
          ...prev,
          rapid_talking: {
            count: (prev.rapid_talking?.count || 0) + 1,
            totalConfidence:
              (parseFloat(prev.rapid_talking?.totalConfidence) || 0) +
              backendConfidence,
          },
        }));
        setAlerts((prev) => [
          ...prev.slice(-9),
          {
            id: Date.now() + Math.random(),
            behavior: "rapid_talking",
            confidence: backendConfidence,
            timestamp: new Date().toISOString(),
            message: `Rapid talking detected (ML): ${(
              backendConfidence * 100
            ).toFixed(1)}%`,
          },
        ]);
      }
    } catch (e) {
      console.error("Rapid talking ML API error:", e);
    }

    if (
      !backendDetected &&
      averageWpm >= RAPID_TALKING_MIN_WPM &&
      averageWpm < RAPID_TALKING_MAX_WPM
    ) {
      console.log(
        `[RapidTalking][Fallback] Triggered → avgWpm=${averageWpm.toFixed(1)}`
      );
      setRapidTalkingStatus(
        `RAPID TALKING DETECTED (local): ${Math.round(averageWpm)} WPM`
      );
      setCurrentBehaviors((prev) => ({
        ...prev,
        rapid_talking: { detected: true, confidence: 0.5 },
      }));
      setBehaviorData((prev) => ({
        ...prev,
        rapid_talking: {
          count: (prev.rapid_talking?.count || 0) + 1,
          totalConfidence:
            (parseFloat(prev.rapid_talking?.totalConfidence) || 0) + 0.5,
        },
      }));
      setAlerts((prev) => [
        ...prev.slice(-9),
        {
          id: Date.now() + Math.random(),
          behavior: "rapid_talking",
          confidence: 0.5,
          timestamp: new Date().toISOString(),
          message: `Rapid talking detected locally at ${Math.round(
            averageWpm
          )} WPM`,
        },
      ]);
    } else {
      console.log("[RapidTalking] Normal speech (local heuristic)");
      setRapidTalkingStatus(`Normal speech: ${Math.round(averageWpm)} WPM`);
      setCurrentBehaviors((prev) => ({
        ...prev,
        rapid_talking: { detected: false, confidence: 0.4 },
      }));
    }
    wordCountRef.current = 0;
    console.log("[RapidTalking] Resetting counters for next 1-minute interval");
  };

  const startSpeechMonitoring = () => {
    console.log("[RapidTalking] startSpeechMonitoring called");
    if (speechIntervalRef.current) {
      clearInterval(speechIntervalRef.current);
    }
    wpmListRef.current = [];
    setCurrentWpm(0);
    if (wpm30IntervalRef.current) {
      clearInterval(wpm30IntervalRef.current);
    }

    startSpeechRecognition();
    console.log(
      "[RapidTalking] Speech monitoring started, interval set for",
      SPEECH_CHECK_INTERVAL,
      "ms"
    );

    wpm30IntervalRef.current = setInterval(() => {
      if (sessionStartRef.current) {
        const elapsedMinutes = (Date.now() - sessionStartRef.current) / 60000;
        if (elapsedMinutes > 0) {
          const wpmCalc = wordCountRef.current / elapsedMinutes;
          setCurrentWpm(wpmCalc);
        }
      }
    }, 60000);

    speechIntervalRef.current = setInterval(() => {
      stopSpeechRecognition();
      setTimeout(() => {
        checkRapidTalking();
        startSpeechRecognition();
      }, 500);
      console.log("[RapidTalking] Speech monitoring interval tick");
    }, SPEECH_CHECK_INTERVAL);
  };

  const stopSpeechMonitoring = () => {
    if (speechIntervalRef.current) {
      clearInterval(speechIntervalRef.current);
      speechIntervalRef.current = null;
    }
    if (wpm30IntervalRef.current) {
      clearInterval(wpm30IntervalRef.current);
      wpm30IntervalRef.current = null;
    }
    stopSpeechRecognition();
    setCurrentWpm(0);
    setRapidTalkingStatus("Stopped");
  };

  useEffect(() => {
    monitoringRef.current = monitoring;
  }, [monitoring]);

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
                      currentWpm={currentWpm}
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
                                const formattedConfidence =
                                  avgConfidence === 0
                                    ? "—"
                                    : `${Math.round(avgConfidence * 100)}%`;

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
                                          {formattedConfidence}
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
                                          {avgConfidence === 0
                                            ? "—"
                                            : `${Math.round(
                                                avgConfidence * 100
                                              )}%`}
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
