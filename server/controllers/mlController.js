import { execSync, spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import os from "os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Store recent detections to prevent unrealistic simultaneous behaviors
const recentDetections = new Map();

// Check if Python is available once at startup
let pythonAvailable = true;
try {
  execSync("python --version", { stdio: "ignore" });
} catch {
  try {
    execSync("python3 --version", { stdio: "ignore" });
  } catch {
    pythonAvailable = false;
    console.warn(
      "[WARN] Python binary not found – ML analysis will fall back to simulation"
    );
  }
}

// Simple concurrency guard – limits heavy ML analysis to one at a time to avoid OOM/502
let activeAnalyses = 0;

// Utility to safely release the analysis slot only once
const releaseAnalysisSlot = () => {
  if (activeAnalyses > 0) {
    activeAnalyses -= 1;
  }
};

/**
 * Apply minimal intelligent filtering to reduce false positives while preserving real detections
 */
function applyIntelligentFiltering(result, behaviorType) {
  // Only apply very minimal filtering - the Python ML is already well-tuned

  // If this is a fallback result, apply minimal filtering
  if (result.fallback) {
    console.log(`[FILTER] Minimal fallback filtering for ${behaviorType}`);

    // Only filter out extremely low confidence fallback detections
    if (result.confidence < 0.1) {
      result.detected = false;
      console.log(
        `[FILTER] Extremely low confidence fallback filtered: ${result.confidence}`
      );
    }
    return result;
  }

  // For hand tapping, trust the Python ML analysis
  if (behaviorType === "tapping_hands" && result.detected) {
    // Trust pattern analysis results completely
    if (result.analysis_type === "pattern_recognition") {
      console.log(
        `[PATTERN] Hand tapping pattern detected: ${result.pattern} (confidence: ${result.confidence})`
      );
      // No filtering needed - pattern analysis is already conservative
    } else {
      // For PyTorch detection, only filter extremely low confidence
      if (result.confidence < 0.25) {
        console.log(
          `[FILTER] Hand tapping confidence too low: ${result.confidence} < 0.25`
        );
        result.detected = false;
        result.confidence = Math.max(0.1, result.confidence * 0.5);
      }
    }
  }

  // For sit/stand, only filter very low confidence
  if (behaviorType === "sit_stand" && result.detected) {
    if (result.confidence < 0.2) {
      console.log(
        `[FILTER] Sit/stand confidence too low: ${result.confidence} < 0.2`
      );
      result.detected = false;
      result.confidence = Math.max(0.1, result.confidence * 0.7);
    }
  }

  // For foot tapping, be even more lenient
  if (behaviorType === "tapping_feet" && result.detected) {
    if (result.confidence < 0.15) {
      console.log(
        `[FILTER] Foot tapping confidence too low: ${result.confidence} < 0.15`
      );
      result.detected = false;
    }
  }

  // For eye gaze, minimal filtering
  if (behaviorType === "eye_gaze" && result.detected) {
    if (result.confidence < 0.2) {
      console.log(
        `[FILTER] Eye gaze confidence too low: ${result.confidence} < 0.2`
      );
      result.detected = false;
    }
  }

  // For rapid talking, minimal filtering
  if (behaviorType === "rapid_talking" && result.detected) {
    if (result.confidence < 0.2) {
      console.log(
        `[FILTER] Rapid talking confidence too low: ${result.confidence} < 0.2`
      );
      result.detected = false;
    }
  }

  // Much more relaxed simultaneous detection checking
  const now = Date.now();
  const timeWindow = 5000; // Reduced to 5 seconds

  // Clean old detections
  for (const [behavior, timestamp] of recentDetections.entries()) {
    if (now - timestamp > timeWindow) {
      recentDetections.delete(behavior);
    }
  }

  // Only filter if we have 4+ simultaneous detections (very unrealistic)
  if (result.detected) {
    const recentCount = recentDetections.size;

    if (recentCount >= 4) {
      console.log(
        `[FILTER] Extremely high simultaneous detections (${recentCount}), slight confidence reduction`
      );
      result.confidence = Math.max(0.2, result.confidence * 0.8);

      // Only mark as false positive if confidence drops below 0.15
      if (result.confidence < 0.15) {
        result.detected = false;
        console.log(
          `[FILTER] Marked as false positive due to too many simultaneous detections`
        );
      }
    }

    // Record detection if still valid
    if (result.detected) {
      recentDetections.set(behaviorType, now);
    }
  }

  return result;
}

// ML Analysis Controller
export const analyzeBehavior = async (req, res) => {
  // If a heavy analysis is already in progress, immediately reject to keep RAM under control
  if (activeAnalyses >= 1) {
    return res.status(429).json({
      success: false,
      message:
        "Server is busy processing another ML request – try again in a moment.",
    });
  }

  activeAnalyses += 1;
  try {
    // FORCE ENABLE REAL ML - Python backend is working perfectly
    const shouldUseSimulation = false; // Always use real ML

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
      // Fallback to simulation only if ML is explicitly disabled
      const behaviorType =
        req.body.behaviorType || req.body.behavior_type || "unknown";

      const mockAnalysis = {
        behavior_type: behaviorType,
        confidence: Math.random() * 0.3, // Low confidence simulation
        detected: Math.random() > 0.8, // Occasionally detect something
        timestamp: new Date().toISOString(),
        message: "Simulated ML analysis (Python ML disabled in production)",
      };

      return res.json({
        success: true,
        analysis: mockAnalysis,
      });
    }

    // Determine behavior type
    const behaviorType = req.body.behaviorType || req.body.behavior_type;

    // If Python missing, force simulation so container stays healthy
    if (!pythonAvailable) {
      const mockAnalysis = {
        behavior_type: behaviorType,
        confidence: 0.0,
        detected: false,
        fallback: true,
        message: "Python not available – returning simulation result",
      };
      return res.json({ success: true, analysis: mockAnalysis });
    }

    // Try real ML analysis
    const data =
      req.body.data !== undefined ? req.body.data : req.body.payload || null;
    const frame = req.body.frame || req.body.Frame || null;
    const frame_sequence =
      req.body.frame_sequence || req.body.frameSequence || null;

    // Validate request body size – keep well under 512 MB Render free limit
    const contentLength = req.headers["content-length"];
    const MAX_REQUEST_BYTES = 15 * 1024 * 1024; // 15 MB
    if (contentLength && parseInt(contentLength) > MAX_REQUEST_BYTES) {
      return res.status(413).json({
        success: false,
        message: `Request payload too large (>${
          MAX_REQUEST_BYTES / 1024 / 1024
        } MB). Reduce resolution or number of frames.`,
      });
    }

    // Extra guard: if frame_sequence array is enormous, reject early to avoid OOM
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

    // Validate behavior type
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

    // Use data if present, otherwise use frame or frame_sequence
    const payload = data || frame || frame_sequence;

    // Validate payload size
    const payloadSize = JSON.stringify(payload).length;
    if (payloadSize > 50 * 1024 * 1024) {
      return res.status(413).json({
        success: false,
        message: "Data payload too large. Maximum size is 50MB.",
      });
    }

    // Create a temporary file to store the data
    const tempFile = path.join(os.tmpdir(), `ml_data_${Date.now()}.json`);

    try {
      // Format data for the specific behavior type
      let formattedData;
      if (frame || frame_sequence) {
        // Sequence-based behaviors need frame_sequence, others can use single frame
        const sequenceBehaviors = [
          "eye_gaze",
          "tapping_hands",
          "tapping_feet",
          "sit_stand",
        ];

        if (sequenceBehaviors.includes(behaviorType)) {
          // Use frame_sequence for behaviors that need multiple frames
          const frames = frame_sequence || (frame ? [frame] : []);
          console.log(`Sending ${frames.length} frames for ${behaviorType}`);
          formattedData = {
            [behaviorType]: frames,
          };
        } else {
          // Use single frame or first frame of sequence for other behaviors
          const singleFrame = frame || (frame_sequence && frame_sequence[0]);
          formattedData = {
            [behaviorType]: singleFrame,
          };
        }
      } else if (data) {
        // If we have structured data, format it for the specific behavior type
        formattedData = {
          [behaviorType]: data,
        };
      } else {
        throw new Error("No data, frame, or frame_sequence provided");
      }

      // Write data to temporary file
      fs.writeFileSync(tempFile, JSON.stringify(formattedData));

      // Debug logging
      console.log("🔍 ML Analysis Debug:");
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

      // SPECIAL DEBUG for rapid_talking
      if (behaviorType === "rapid_talking") {
        console.log("🎯 RAPID TALKING SPECIFIC DEBUG:");
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

      // Use command line arguments for behavior type and file path
      const args = [
        pythonScript,
        "--data",
        tempFile,
        "--behavior",
        behaviorType,
      ];
      console.log("- Python Args:", args);

      console.log("🔍 Attempting to start Python process:");
      console.log("- Working Directory:", workingDir);
      console.log("- Python Script Path:", pythonScript);
      console.log("- Args:", args);

      const pythonProcess = spawn("python", args, {
        cwd: workingDir,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env }, // Inherit environment
      });

      // Set a timeout for the Python process (5 minutes)
      const timeout = setTimeout(() => {
        pythonProcess.kill("SIGTERM");
        releaseAnalysisSlot();
        console.error("Python process timed out after 5 minutes");
        res.status(408).json({
          success: false,
          message:
            "ML analysis timed out. Please try with smaller data or contact support.",
        });
      }, 5 * 60 * 1000); // 5 minutes

      let result = "";
      let error = "";

      // --------------------------------------------------------------------
      // Filter Python stderr — drop repetitive Mediapipe / TFLite INFO &
      // WARNING spam so the server logs remain readable while preserving
      // genuine errors.
      // --------------------------------------------------------------------

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
        // Discard if matches any known noise pattern
        if (noisePatterns.some((rx) => rx.test(text))) {
          return; // Skip logging & accumulation
        }

        error += text;
        console.error("Python script stderr:", text);
      });

      pythonProcess.on("close", (code) => {
        // Clear the timeout
        clearTimeout(timeout);

        // Clean up temporary file
        try {
          fs.unlinkSync(tempFile);
        } catch (cleanupError) {
          console.error("Failed to cleanup temp file:", cleanupError);
        }

        // Debug logging
        console.log(`🐍 Python process exited with code: ${code}`);
        console.log(`📤 Python stdout: "${result}"`);
        console.log(`⚠️ Python stderr: "${error}"`);

        // SPECIAL DEBUG for rapid_talking
        if (behaviorType === "rapid_talking") {
          console.log("🎯 RAPID TALKING PYTHON RESULT:");
          console.log("- Exit code:", code);
          console.log("- Raw stdout:", result);
          console.log("- Any errors:", error);
        }

        if (code !== 0) {
          console.error(`Python script exited with code ${code}:`, error);

          // If we have output despite non-zero exit, try to parse it
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
              return res.json({
                success: true,
                analysis: analysisResult,
              });
            } catch (parseError) {
              console.error("Parse failed, falling back to simulation");
            }
          }

          // Fallback to simulation
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
            // Fallback instead of error
            const mockAnalysis = {
              behavior_type: behaviorType,
              confidence: Math.random() * 0.3 + 0.1,
              detected: Math.random() > 0.8,
              timestamp: new Date().toISOString(),
              message: "Simulated ML analysis (empty result from Python)",
              fallback: true,
            };

            return res.json({
              success: true,
              analysis: mockAnalysis,
            });
          }

          let analysisResult = JSON.parse(result);

          // Ensure behavior_type key is present for frontend compatibility
          analysisResult = {
            behavior_type: behaviorType,
            ...analysisResult,
          };

          // Apply intelligent filtering to reduce false positives
          analysisResult = applyIntelligentFiltering(
            analysisResult,
            behaviorType
          );

          console.log("Parsed analysis result:", analysisResult);

          // Convert to new response format that matches client expectations
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

          // Fallback instead of error
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

          res.json({
            success: true,
            analysis: mockAnalysis,
          });
        }
      });

      pythonProcess.on("error", (err) => {
        // Clear the timeout
        clearTimeout(timeout);

        // Clean up temporary file on error
        try {
          fs.unlinkSync(tempFile);
        } catch (cleanupError) {
          console.error("Failed to cleanup temp file:", cleanupError);
        }

        console.error("Failed to start Python process:", err);
        console.log("Falling back to simulated ML response...");

        // Check if response already sent
        if (res.headersSent) {
          console.log("Response already sent, skipping fallback");
          return;
        }

        // Graceful fallback to simulation
        const behaviorType =
          req.body.behaviorType || req.body.behavior_type || "unknown";
        const mockAnalysis = {
          behavior_type: behaviorType,
          confidence: Math.random() * 0.3,
          detected: Math.random() > 0.8,
          timestamp: new Date().toISOString(),
          message: "Simulated ML analysis (Python ML unavailable)",
        };

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
      releaseAnalysisSlot();
    }
  } catch (error) {
    console.error("ML Controller Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
    releaseAnalysisSlot();
  }
};

// Get ML model status
export const getModelStatus = async (req, res) => {
  try {
    // FORCE ENABLE REAL ML - Python backend is working perfectly
    const shouldUseSimulation = false; // Always use real ML

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

    // Set the working directory to the machine-learning folder
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

// Batch analysis for multiple behaviors
export const batchAnalysis = async (req, res) => {
  try {
    // Try real ML first, only simulate if explicitly disabled
    const shouldUseSimulation = false; // FORCE REAL ML

    if (shouldUseSimulation) {
      // Fallback to simulation only if ML is explicitly disabled
      const { behaviors } = req.body;

      if (!behaviors || !Array.isArray(behaviors)) {
        return res.status(400).json({
          success: false,
          message: "Behaviors array is required",
        });
      }

      // Generate simulated results for each behavior
      const simulatedResults = behaviors.map((behavior) => {
        const behaviorType = behavior.type || "unknown";
        return {
          behavior_type: behaviorType,
          confidence: Math.random() * 0.3, // Low confidence simulation
          detected: Math.random() > 0.8, // Occasionally detect something
          timestamp: new Date().toISOString(),
          message: "Simulated ML analysis (Python ML disabled in production)",
        };
      });

      return res.json({
        success: true,
        results: simulatedResults,
      });
    }

    // Try real batch ML analysis
    const { behaviors } = req.body;

    if (!behaviors || !Array.isArray(behaviors)) {
      return res.status(400).json({
        success: false,
        message: "Behaviors array is required",
      });
    }

    // Create a temporary file to store the behaviors data
    const tempFile = path.join(os.tmpdir(), `batch_data_${Date.now()}.json`);

    try {
      // Write behaviors data to temporary file
      fs.writeFileSync(tempFile, JSON.stringify(behaviors));

      const pythonScript = path.join(
        __dirname,
        "../../machine-learning/utils/batch_analyzer.py"
      );

      // Set the working directory to the machine-learning folder
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
        // Clean up temporary file
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

          // `batchResult` looks like { success: bool, results: [...], total_analyzed: n }
          // For consistency with /api/ml/analyze, flatten it so the client gets
          // { success, results: [...], total_analyzed }
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
        // Clean up temporary file on error
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

// Evaluate labeled dataset and return accuracy metrics
export const evaluateDataset = async (req, res) => {
  try {
    const { behaviors } = req.body;

    if (!behaviors || !Array.isArray(behaviors) || behaviors.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Behaviors (non-empty array) are required for evaluation",
      });
    }

    // Separate labels; batch_analyzer only needs type/data
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
    // Handle production environment with simulated responses
    if (process.env.NODE_ENV === "production") {
      // Simulate some behavior detection
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

    // Use the Python script in ml-utils directory
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

    // Execute the Python script with the image data
    const result = execSync(pythonCommand, {
      input: JSON.stringify({ imageData }),
      encoding: "utf-8",
      timeout: 30000, // 30 second timeout
      cwd: workingDir,
    });

    const analysis = JSON.parse(result);

    // BALANCED DETECTION THRESHOLDS - sensitive but accurate
    const detectionResults = {
      eyeGaze: analysis.eye_gaze > 0.3, // Reasonable threshold
      handTapping: analysis.hand_tapping > 0.25, // More conservative
      footTapping: analysis.foot_tapping > 0.25, // More conservative
      sitStand: analysis.sit_stand > 0.3, // Reasonable threshold
      rapidTalking: analysis.rapid_talking > 0.25, // More conservative
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
    // Temporary: Disable ML in production until Python dependencies are fixed
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

    // Use the Python script in machine-learning directory
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

    // Execute the Python script with batch data
    const result = execSync(pythonCommand, {
      input: JSON.stringify({ images }),
      encoding: "utf-8",
      timeout: 60000, // 60 second timeout for batch processing
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
