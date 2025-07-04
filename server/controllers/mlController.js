import { execSync, spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import os from "os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const recentDetections = new Map();

let pythonAvailable = true;
try {
  execSync("python --version", { stdio: "ignore" });
} catch {
  try {
    execSync("python3 --version", { stdio: "ignore" });
  } catch {
    pythonAvailable = false;
    console.warn(
      "Python binary not found – ML analysis will fall back to simulation"
    );
  }
}

let activeAnalyses = 0;
const MAX_CONCURRENT_ANALYSES = parseInt(
  process.env.MAX_CONCURRENT_ANALYSES || "1",
  10
);

const analysisStartTimes = new Map();

setInterval(() => {
  const now = Date.now();
  const stuckThreshold = 10 * 60 * 1000;

  if (activeAnalyses > 0) {
    let hasStuckAnalyses = false;
    for (const [analysisId, startTime] of analysisStartTimes.entries()) {
      if (now - startTime > stuckThreshold) {
        console.warn(
          `Auto-reset: Found stuck analysis ${analysisId} running for ${Math.floor(
            (now - startTime) / 60000
          )} minutes`
        );
        hasStuckAnalyses = true;
        analysisStartTimes.delete(analysisId);
      }
    }

    if (hasStuckAnalyses || analysisStartTimes.size === 0) {
      console.warn(
        `Auto-reset: Resetting stuck analysis counter from ${activeAnalyses} to 0`
      );
      activeAnalyses = 0;
      analysisStartTimes.clear();
    }
  }
}, 5 * 60 * 1000);

const releaseAnalysisSlot = (analysisId = null) => {
  if (activeAnalyses > 0) {
    activeAnalyses -= 1;
    if (analysisId && analysisStartTimes.has(analysisId)) {
      const duration = Date.now() - analysisStartTimes.get(analysisId);
      analysisStartTimes.delete(analysisId);
      console.log(
        `Released ML analysis slot ${analysisId} after ${Math.floor(
          duration / 1000
        )}s (${activeAnalyses}/${MAX_CONCURRENT_ANALYSES} active)`
      );
    } else {
      console.log(
        `Released ML analysis slot (${activeAnalyses}/${MAX_CONCURRENT_ANALYSES} active)`
      );
    }
  } else {
    console.warn(`Attempted to release analysis slot but none were active`);
  }
};

function applyIntelligentFiltering(result, behaviorType) {
  if (result.fallback) {
    console.log(`[FILTER] Minimal fallback filtering for ${behaviorType}`);

    if (result.confidence < 0.1) {
      result.detected = false;
      console.log(
        `[FILTER] Extremely low confidence fallback filtered: ${result.confidence}`
      );
    }
    return result;
  }

  if (behaviorType === "tapping_hands" && result.detected) {
    if (result.analysis_type === "pattern_recognition") {
      console.log(
        `[PATTERN] Hand tapping pattern detected: ${result.pattern} (confidence: ${result.confidence})`
      );
    } else {
      if (result.confidence < 0.25) {
        console.log(
          `[FILTER] Hand tapping confidence too low: ${result.confidence} < 0.25`
        );
        result.detected = false;
        result.confidence = Math.max(0.1, result.confidence * 0.5);
      }
    }
  }

  if (behaviorType === "sit_stand" && result.detected) {
    if (result.confidence < 0.2) {
      console.log(
        `[FILTER] Sit/stand confidence too low: ${result.confidence} < 0.2`
      );
      result.detected = false;
      result.confidence = Math.max(0.1, result.confidence * 0.7);
    }
  }

  if (behaviorType === "tapping_feet" && result.detected) {
    if (result.confidence < 0.15) {
      console.log(
        `[FILTER] Foot tapping confidence too low: ${result.confidence} < 0.15`
      );
      result.detected = false;
    }
  }

  if (behaviorType === "eye_gaze" && result.detected) {
    if (result.confidence < 0.2) {
      console.log(
        `[FILTER] Eye gaze confidence too low: ${result.confidence} < 0.2`
      );
      result.detected = false;
    }
  }

  if (behaviorType === "rapid_talking" && result.detected) {
    if (result.confidence < 0.2) {
      console.log(
        `[FILTER] Rapid talking confidence too low: ${result.confidence} < 0.2`
      );
      result.detected = false;
    }
  }

  const now = Date.now();
  const timeWindow = 5000;

  for (const [behavior, timestamp] of recentDetections.entries()) {
    if (now - timestamp > timeWindow) {
      recentDetections.delete(behavior);
    }
  }

  if (result.detected) {
    const recentCount = recentDetections.size;

    if (recentCount >= 4) {
      console.log(
        `[FILTER] Extremely high simultaneous detections (${recentCount}), slight confidence reduction`
      );
      result.confidence = Math.max(0.2, result.confidence * 0.8);

      if (result.confidence < 0.15) {
        result.detected = false;
        console.log(
          `[FILTER] Marked as false positive due to too many simultaneous detections`
        );
      }
    }

    if (result.detected) {
      recentDetections.set(behaviorType, now);
    }
  }

  return result;
}

export const analyzeBehavior = async (req, res) => {
  if (activeAnalyses >= MAX_CONCURRENT_ANALYSES) {
    console.warn(
      `Rate limit: ${activeAnalyses}/${MAX_CONCURRENT_ANALYSES} concurrent analyses running`
    );
    return res.status(429).json({
      success: false,
      message: `Server is busy processing ${activeAnalyses} ML requests. Max concurrent: ${MAX_CONCURRENT_ANALYSES}. Try again in a moment.`,
    });
  }

  activeAnalyses += 1;
  const analysisId = `analysis_${Date.now()}_${Math.random()
    .toString(36)
    .substr(2, 9)}`;
  analysisStartTimes.set(analysisId, Date.now());
  console.log(
    `Starting ML analysis ${analysisId} (${activeAnalyses}/${MAX_CONCURRENT_ANALYSES} active)`
  );
  try {
    const shouldUseSimulation = false;

    console.log("🔧 FORCED ML ENABLED - Using real Python ML backend");
    console.log(
      "Environment check bypassed - ML_ENABLED:",
      process.env.ML_ENABLED
    );
    console.log(
      "Environment check bypassed - DISABLE_ML:",
      process.env.DISABLE_ML
    );

    if (shouldUseSimulation) {
      const behaviorType =
        req.body.behaviorType || req.body.behavior_type || "unknown";

      const mockAnalysis = {
        behavior_type: behaviorType,
        confidence: Math.random() * 0.3,
        detected: Math.random() > 0.8,
        timestamp: new Date().toISOString(),
        message: "Simulated ML analysis (Python ML disabled in production)",
      };

      releaseAnalysisSlot(analysisId);
      return res.json({
        success: true,
        analysis: mockAnalysis,
      });
    }

    const behaviorType = req.body.behaviorType || req.body.behavior_type;

    if (!pythonAvailable) {
      const mockAnalysis = {
        behavior_type: behaviorType,
        confidence: 0.0,
        detected: false,
        fallback: true,
        message: "Python not available – returning simulation result",
      };
      releaseAnalysisSlot(analysisId);
      return res.json({ success: true, analysis: mockAnalysis });
    }

    const data =
      req.body.data !== undefined ? req.body.data : req.body.payload || null;
    const frame = req.body.frame || req.body.Frame || null;
    const frame_sequence =
      req.body.frame_sequence || req.body.frameSequence || null;

    const contentLength = req.headers["content-length"];
    const MAX_REQUEST_BYTES = 15 * 1024 * 1024;
    if (contentLength && parseInt(contentLength) > MAX_REQUEST_BYTES) {
      return res.status(413).json({
        success: false,
        message: `Request payload too large (>${
          MAX_REQUEST_BYTES / 1024 / 1024
        } MB). Reduce resolution or number of frames.`,
      });
    }

    if (Array.isArray(frame_sequence) && frame_sequence.length > 40) {
      return res.status(413).json({
        success: false,
        message: `Frame sequence too long (${frame_sequence.length}). Max 40 frames allowed per request.`,
      });
    }

    const pythonScript = path.join(
      __dirname,
      "../../machine-learning/utils/ml_analyzer.py"
    );
    const workingDir = path.join(__dirname, "../../machine-learning/utils");

    if (!behaviorType || (!data && !frame && !frame_sequence)) {
      return res.status(400).json({
        success: false,
        message:
          "Behavior type and data, frame, or frame_sequence are required",
      });
    }

    const validTypes = [
      "eye_gaze",
      "sit_stand",
      "tapping_hands",
      "tapping_feet",
      "rapid_talking",
    ];
    if (!validTypes.includes(behaviorType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid behavior type",
      });
    }

    const payload = data || frame || frame_sequence;

    const payloadSize = JSON.stringify(payload).length;
    if (payloadSize > 50 * 1024 * 1024) {
      return res.status(413).json({
        success: false,
        message: "Data payload too large. Maximum size is 50MB.",
      });
    }

    const tempFile = path.join(os.tmpdir(), `ml_data_${Date.now()}.json`);

    try {
      let formattedData;
      if (frame || frame_sequence) {
        const sequenceBehaviors = [
          "eye_gaze",
          "tapping_hands",
          "tapping_feet",
          "sit_stand",
        ];

        if (sequenceBehaviors.includes(behaviorType)) {
          const frames = frame_sequence || (frame ? [frame] : []);
          console.log(`Sending ${frames.length} frames for ${behaviorType}`);
          formattedData = {
            [behaviorType]: frames,
          };
        } else {
          const singleFrame = frame || (frame_sequence && frame_sequence[0]);
          formattedData = {
            [behaviorType]: singleFrame,
          };
        }
      } else if (data) {
        formattedData = {
          [behaviorType]: data,
        };
      } else {
        throw new Error("No data, frame, or frame_sequence provided");
      }

      fs.writeFileSync(tempFile, JSON.stringify(formattedData));

      console.log("ML Analysis Debug:");
      console.log("- Behavior Type:", behaviorType);
      console.log("- Temp File:", tempFile);
      console.log("- Python Script:", pythonScript);
      console.log("- Working Dir:", workingDir);
      console.log("- Formatted Data Keys:", Object.keys(formattedData));
      console.log("- Formatted Data:", formattedData);
      console.log(
        "- Payload Size:",
        (payloadSize / 1024 / 1024).toFixed(2),
        "MB"
      );

      if (behaviorType === "rapid_talking") {
        console.log("RAPID TALKING SPECIFIC DEBUG:");
        console.log("- Raw data received:", data);
        console.log("- Formatted data for Python:", formattedData);
        console.log(
          "- Data array length:",
          Array.isArray(data) ? data.length : "not array"
        );
        console.log(
          "- First few values:",
          Array.isArray(data) ? data.slice(0, 5) : data
        );
      }

      const args = [
        pythonScript,
        "--data",
        tempFile,
        "--behavior",
        behaviorType,
      ];
      console.log("- Python Args:", args);

      console.log("Attempting to start Python process:");
      console.log("- Working Directory:", workingDir);
      console.log("- Python Script Path:", pythonScript);
      console.log("- Args:", args);

      const pythonProcess = spawn("python", args, {
        cwd: workingDir,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });

      const timeout = setTimeout(() => {
        pythonProcess.kill("SIGTERM");
        releaseAnalysisSlot(analysisId);
        console.error(`Python process ${analysisId} timed out after 5 minutes`);
        res.status(408).json({
          success: false,
          message:
            "ML analysis timed out. Please try with smaller data or contact support.",
        });
      }, 5 * 60 * 1000);

      let result = "";
      let error = "";

      const noisePatterns = [
        /INFO: Created TensorFlow Lite XNNPACK delegate/i,
        /Feedback manager requires a model with a single signature inference/i,
        /All log messages before absl::InitializeLog\(\) is called/i,
        /Using NORM_RECT without IMAGE_DIMENSIONS is only supported/i,
      ];

      pythonProcess.stdout.on("data", (data) => {
        result += data.toString();
      });

      pythonProcess.stderr.on("data", (data) => {
        const text = data.toString();

        if (noisePatterns.some((rx) => rx.test(text))) {
          return;
        }

        error += text;
        console.error("Python script stderr:", text);
      });

      pythonProcess.on("close", (code) => {
        clearTimeout(timeout);

        try {
          fs.unlinkSync(tempFile);
        } catch (cleanupError) {
          console.error("Failed to cleanup temp file:", cleanupError);
        }

        console.log(`Python process exited with code: ${code}`);
        console.log(`Python stdout: "${result}"`);
        console.log(`Python stderr: "${error}"`);

        if (behaviorType === "rapid_talking") {
          console.log("RAPID TALKING PYTHON RESULT:");
          console.log("- Exit code:", code);
          console.log("- Raw stdout:", result);
          console.log("- Any errors:", error);
        }

        if (code !== 0) {
          console.error(`Python script exited with code ${code}:`, error);
          if (result.trim()) {
            console.log(
              "Attempting to parse result despite non-zero exit code..."
            );
            try {
              let analysisResult = JSON.parse(result);
              analysisResult = {
                behavior_type: behaviorType,
                ...analysisResult,
              };
              console.log(
                "Successfully parsed result despite error:",
                analysisResult
              );
              releaseAnalysisSlot(analysisId);
              return res.json({
                success: true,
                analysis: analysisResult,
              });
            } catch (parseError) {
              console.error("Parse failed, falling back to simulation");
            }
          }

          console.log(
            "Falling back to simulated ML response due to Python error..."
          );
          const mockAnalysis = {
            behavior_type: behaviorType,
            confidence: Math.random() * 0.4 + 0.1,
            detected: Math.random() > 0.7,
            timestamp: new Date().toISOString(),
            message: "Simulated ML analysis (Python script error)",
            fallback: true,
          };

          releaseAnalysisSlot(analysisId);
          return res.json({
            success: true,
            analysis: mockAnalysis,
          });
        }

        try {
          if (!result.trim()) {
            console.error(
              "Python script returned empty result, using fallback"
            );

            const mockAnalysis = {
              behavior_type: behaviorType,
              confidence: Math.random() * 0.3 + 0.1,
              detected: Math.random() > 0.8,
              timestamp: new Date().toISOString(),
              message: "Simulated ML analysis (empty result from Python)",
              fallback: true,
            };

            releaseAnalysisSlot(analysisId);
            return res.json({
              success: true,
              analysis: mockAnalysis,
            });
          }

          let analysisResult = JSON.parse(result);

          analysisResult = {
            behavior_type: behaviorType,
            ...analysisResult,
          };

          analysisResult = applyIntelligentFiltering(
            analysisResult,
            behaviorType
          );

          console.log("Parsed analysis result:", analysisResult);

          const detectionResults = {
            eyeGaze: behaviorType === "eye_gaze" && analysisResult.detected,
            handTapping:
              behaviorType === "tapping_hands" && analysisResult.detected,
            footTapping:
              behaviorType === "tapping_feet" && analysisResult.detected,
            sitStand: behaviorType === "sit_stand" && analysisResult.detected,
            rapidTalking:
              behaviorType === "rapid_talking" && analysisResult.detected,
          };

          releaseAnalysisSlot(analysisId);

          res.json({
            detected: Object.values(detectionResults).some(Boolean),
            eyeGaze: detectionResults.eyeGaze,
            handTapping: detectionResults.handTapping,
            footTapping: detectionResults.footTapping,
            sitStand: detectionResults.sitStand,
            rapidTalking: detectionResults.rapidTalking,
            confidence: {
              eyeGaze:
                behaviorType === "eye_gaze" ? analysisResult.confidence : 0,
              handTapping:
                behaviorType === "tapping_hands"
                  ? analysisResult.confidence
                  : 0,
              footTapping:
                behaviorType === "tapping_feet" ? analysisResult.confidence : 0,
              sitStand:
                behaviorType === "sit_stand" ? analysisResult.confidence : 0,
              rapidTalking:
                behaviorType === "rapid_talking"
                  ? analysisResult.confidence
                  : 0,
            },
            tapCount: analysisResult.tap_count || 0,
            clapCount: analysisResult.clap_count || 0,
            timestamp: new Date().toISOString(),
          });
        } catch (parseError) {
          console.error("JSON parse error:", parseError);
          console.error("Raw result:", result);

          console.log(
            "Falling back to simulated response due to parse error..."
          );
          const mockAnalysis = {
            behavior_type: behaviorType,
            confidence: Math.random() * 0.3 + 0.1,
            detected: Math.random() > 0.8,
            timestamp: new Date().toISOString(),
            message: "Simulated ML analysis (JSON parse error)",
            fallback: true,
          };

          releaseAnalysisSlot(analysisId);
          res.json({
            success: true,
            analysis: mockAnalysis,
          });
        }
      });

      pythonProcess.on("error", (err) => {
        clearTimeout(timeout);

        try {
          fs.unlinkSync(tempFile);
        } catch (cleanupError) {
          console.error("Failed to cleanup temp file:", cleanupError);
        }

        console.error("Failed to start Python process:", err);
        console.log("Falling back to simulated ML response...");

        if (res.headersSent) {
          console.log("Response already sent, skipping fallback");
          return;
        }

        const behaviorType =
          req.body.behaviorType || req.body.behavior_type || "unknown";
        const mockAnalysis = {
          behavior_type: behaviorType,
          confidence: Math.random() * 0.3,
          detected: Math.random() > 0.8,
          timestamp: new Date().toISOString(),
          message: "Simulated ML analysis (Python ML unavailable)",
        };

        releaseAnalysisSlot(analysisId);
        res.json({
          success: true,
          analysis: mockAnalysis,
        });
      });
    } catch (fileError) {
      console.error("File operation error:", fileError);
      res.status(500).json({
        success: false,
        message: "Failed to prepare data for ML analysis",
        error: fileError.message,
      });
      releaseAnalysisSlot(analysisId);
    }
  } catch (error) {
    console.error("ML Controller Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
    releaseAnalysisSlot(analysisId);
  }
};

export const resetAnalysisCounter = async (req, res) => {
  const previousCount = activeAnalyses;
  activeAnalyses = 0;
  console.log(`Reset analysis counter from ${previousCount} to 0`);
  res.json({
    success: true,
    message: `Analysis counter reset from ${previousCount} to 0`,
    previousCount,
    currentCount: 0,
    maxConcurrent: MAX_CONCURRENT_ANALYSES,
  });
};

export const getModelStatus = async (req, res) => {
  try {
    const shouldUseSimulation = false;

    if (shouldUseSimulation) {
      return res.json({
        success: true,
        status: {
          modelsLoaded: false,
          availableModels: [],
          systemStatus: "ML temporarily disabled in production",
          pythonVersion: "N/A",
          torchVersion: "N/A",
        },
      });
    }

    const pythonScript = path.join(
      __dirname,
      "../../machine-learning/utils/model_status.py"
    );

    const workingDir = path.join(__dirname, "../../machine-learning");

    const pythonProcess = spawn("python", [pythonScript], {
      cwd: workingDir,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let result = "";
    let error = "";

    pythonProcess.stdout.on("data", (data) => {
      result += data.toString();
    });

    pythonProcess.stderr.on("data", (data) => {
      error += data.toString();
    });

    pythonProcess.on("close", (code) => {
      if (code !== 0) {
        console.error("Python script error:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to get model status",
          error: error,
        });
      }

      try {
        const status = JSON.parse(result);
        res.json({
          success: true,
          models: status,
        });
      } catch (parseError) {
        res.status(500).json({
          success: false,
          message: "Failed to parse model status",
          error: parseError.message,
        });
      }
    });

    pythonProcess.on("error", (err) => {
      console.error("Failed to start Python process:", err);
      res.status(500).json({
        success: false,
        message: "Failed to get model status",
        error: err.message,
      });
    });
  } catch (error) {
    console.error("Model Status Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

export const batchAnalysis = async (req, res) => {
  try {
    const shouldUseSimulation = false;

    if (shouldUseSimulation) {
      const { behaviors } = req.body;

      if (!behaviors || !Array.isArray(behaviors)) {
        return res.status(400).json({
          success: false,
          message: "Behaviors array is required",
        });
      }

      const simulatedResults = behaviors.map((behavior) => {
        const behaviorType = behavior.type || "unknown";
        return {
          behavior_type: behaviorType,
          confidence: Math.random() * 0.3,
          detected: Math.random() > 0.8,
          timestamp: new Date().toISOString(),
          message: "Simulated ML analysis (Python ML disabled in production)",
        };
      });

      return res.json({
        success: true,
        results: simulatedResults,
      });
    }

    const { behaviors } = req.body;

    if (!behaviors || !Array.isArray(behaviors)) {
      return res.status(400).json({
        success: false,
        message: "Behaviors array is required",
      });
    }

    const tempFile = path.join(os.tmpdir(), `batch_data_${Date.now()}.json`);

    try {
      fs.writeFileSync(tempFile, JSON.stringify(behaviors));

      const pythonScript = path.join(
        __dirname,
        "../../machine-learning/utils/batch_analyzer.py"
      );

      const workingDir = path.join(__dirname, "../../machine-learning");

      const pythonProcess = spawn("python", [pythonScript, tempFile], {
        cwd: workingDir,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let result = "";
      let error = "";

      pythonProcess.stdout.on("data", (data) => {
        result += data.toString();
      });

      pythonProcess.stderr.on("data", (data) => {
        error += data.toString();
      });

      pythonProcess.on("close", (code) => {
        try {
          fs.unlinkSync(tempFile);
        } catch (cleanupError) {
          console.error("Failed to cleanup temp file:", cleanupError);
        }

        if (code !== 0) {
          console.error("Python script error:", error);
          return res.status(500).json({
            success: false,
            message: "Batch analysis failed",
            error: error,
          });
        }

        try {
          const batchResult = JSON.parse(result);
          res.json({
            success: Boolean(batchResult.success),
            results: batchResult.results || [],
            total_analyzed: batchResult.total_analyzed || 0,
          });
        } catch (parseError) {
          res.status(500).json({
            success: false,
            message: "Failed to parse batch results",
            error: parseError.message,
          });
        }
      });

      pythonProcess.on("error", (err) => {
        try {
          fs.unlinkSync(tempFile);
        } catch (cleanupError) {
          console.error("Failed to cleanup temp file:", cleanupError);
        }

        console.error("Failed to start Python process:", err);
        res.status(500).json({
          success: false,
          message: "Failed to start batch analysis",
          error: err.message,
        });
      });
    } catch (fileError) {
      console.error("File operation error:", fileError);
      res.status(500).json({
        success: false,
        message: "Failed to prepare data for batch analysis",
        error: fileError.message,
      });
    }
  } catch (error) {
    console.error("Batch Analysis Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

export const evaluateDataset = async (req, res) => {
  try {
    const { behaviors } = req.body;

    if (!behaviors || !Array.isArray(behaviors) || behaviors.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Behaviors (non-empty array) are required for evaluation",
      });
    }

    const unlabeled = behaviors.map((b) => ({ type: b.type, data: b.data }));

    const tempFile = path.join(os.tmpdir(), `eval_data_${Date.now()}.json`);

    fs.writeFileSync(tempFile, JSON.stringify(unlabeled));

    const pythonScript = path.join(
      __dirname,
      "../../machine-learning/utils/batch_analyzer.py"
    );

    const workingDir = path.join(__dirname, "../../machine-learning");

    const pythonProcess = spawn("python", [pythonScript, tempFile], {
      cwd: workingDir,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let result = "";
    let error = "";

    pythonProcess.stdout.on("data", (d) => (result += d.toString()));
    pythonProcess.stderr.on("data", (d) => (error += d.toString()));

    pythonProcess.on("close", (code) => {
      fs.unlink(tempFile, () => {});

      if (code !== 0) {
        return res.status(500).json({
          success: false,
          message: "Evaluation failed",
          error,
        });
      }

      try {
        const batchRes = JSON.parse(result);
        const predictions = batchRes.results || [];

        let correct = 0;
        predictions.forEach((pred, idx) => {
          const expectedLabel = behaviors[idx].label;
          if (expectedLabel !== undefined) {
            const matches = pred.label == expectedLabel;
            if (matches) correct += 1;
          }
        });

        const totalLabeled = behaviors.filter(
          (b) => b.label !== undefined
        ).length;

        const accuracy = totalLabeled ? correct / totalLabeled : null;

        res.json({
          success: true,
          total_samples: behaviors.length,
          labeled_samples: totalLabeled,
          correct,
          accuracy,
          predictions,
        });
      } catch (e) {
        res
          .status(500)
          .json({ success: false, message: "Parse error", error: e.message });
      }
    });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

export const analyzeImage = async (req, res) => {
  try {
    if (process.env.NODE_ENV === "production") {
      const simulatedBehaviors = [
        {
          type: "eye_gaze",
          detected: Math.random() > 0.7,
          confidence: Math.random() * 0.4,
          timestamp: new Date().toISOString(),
        },
        {
          type: "sit_stand",
          detected: Math.random() > 0.8,
          confidence: Math.random() * 0.3,
          timestamp: new Date().toISOString(),
        },
      ].filter((b) => b.detected);

      return res.json({
        success: true,
        message: "Simulated analysis (Python ML disabled in production)",
        analysis: {
          behaviors: simulatedBehaviors,
          alerts: simulatedBehaviors.length > 0 ? ["Behavior detected"] : [],
          confidence:
            simulatedBehaviors.length > 0
              ? Math.max(...simulatedBehaviors.map((b) => b.confidence))
              : 0,
          timestamp: new Date().toISOString(),
        },
      });
    }

    const { imageData, analysisType = "comprehensive" } = req.body;

    if (!imageData) {
      return res.json({
        success: false,
        message: "Image data is required",
      });
    }

    const scriptPath = path.join(
      __dirname,
      "..",
      "..",
      "machine-learning",
      "utils",
      "ml_analyzer.py"
    );
    const workingDir = path.join(__dirname, "../../machine-learning/utils");

    const pythonCommand = `python "${scriptPath}" --analysis-type ${analysisType}`;

    const result = execSync(pythonCommand, {
      input: JSON.stringify({ imageData }),
      encoding: "utf-8",
      timeout: 30000,
      cwd: workingDir,
    });

    const analysis = JSON.parse(result);

    const detectionResults = {
      eyeGaze: analysis.eye_gaze > 0.3,
      handTapping: analysis.hand_tapping > 0.25,
      footTapping: analysis.foot_tapping > 0.25,
      sitStand: analysis.sit_stand > 0.3,
      rapidTalking: analysis.rapid_talking > 0.25,
    };

    res.json({
      detected: Object.values(detectionResults).some(Boolean),
      eyeGaze: detectionResults.eyeGaze,
      handTapping: detectionResults.handTapping,
      footTapping: detectionResults.footTapping,
      sitStand: detectionResults.sitStand,
      rapidTalking: detectionResults.rapidTalking,
      confidence: {
        eyeGaze: analysis.eye_gaze,
        handTapping: analysis.hand_tapping,
        footTapping: analysis.foot_tapping,
        sitStand: analysis.sit_stand,
        rapidTalking: analysis.rapid_talking,
      },
      tapCount: analysis.tap_count || 0,
      clapCount: analysis.clap_count || 0,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("ML Analysis error:", error);
    res.json({
      success: false,
      message: "Analysis failed",
      error: error.message,
    });
  }
};

export const batchAnalyze = async (req, res) => {
  try {
    if (process.env.NODE_ENV === "production") {
      return res.json({
        success: true,
        message: "Batch analysis temporarily disabled in production",
        results: [],
      });
    }

    const { images, analysisType = "comprehensive" } = req.body;

    if (!images || !Array.isArray(images)) {
      return res.json({
        success: false,
        message: "Images array is required",
      });
    }

    const scriptPath = path.join(
      __dirname,
      "..",
      "..",
      "machine-learning",
      "utils",
      "batch_analyzer.py"
    );

    const pythonCommand = `python "${scriptPath}" --analysis-type ${analysisType}`;

    const workingDir = path.join(__dirname, "../../machine-learning/utils");

    const result = execSync(pythonCommand, {
      input: JSON.stringify({ images }),
      encoding: "utf-8",
      timeout: 60000,
      cwd: workingDir,
    });

    const analysis = JSON.parse(result);

    res.json({
      success: true,
      results: analysis,
    });
  } catch (error) {
    console.error("Batch ML Analysis error:", error);
    res.json({
      success: false,
      message: "Batch analysis failed",
      error: error.message,
    });
  }
};
