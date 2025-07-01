import { execSync, spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import os from "os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ML Analysis Controller
export const analyzeBehavior = async (req, res) => {
  try {
    const isProduction =
      process.env.NODE_ENV === "production" ||
      process.env.DISABLE_ML === "true";

    if (isProduction) {
      // In production, return a simulated response for now
      // This can be enhanced to actual ML when Python dependencies are confirmed working
      const behaviorType =
        req.body.behaviorType || req.body.behavior_type || "unknown";

      // Simulate some basic detection logic without Python
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

    // Support both camelCase and snake_case keys coming from frontend / tests
    const behaviorType = req.body.behaviorType || req.body.behavior_type;
    const data =
      req.body.data !== undefined ? req.body.data : req.body.payload || null;
    // Frame or sequence may come in different casings
    const frame = req.body.frame || req.body.Frame || null;
    const frame_sequence =
      req.body.frame_sequence || req.body.frameSequence || null;

    // Validate request body size
    const contentLength = req.headers["content-length"];
    if (contentLength && parseInt(contentLength) > 50 * 1024 * 1024) {
      // 50MB limit
      return res.status(413).json({
        success: false,
        message: "Request payload too large. Maximum size is 50MB.",
      });
    }

    const pythonScript = path.join(__dirname, "../ml-utils/ml_analyzer.py");
    const workingDir = path.join(__dirname, "..");

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
      // 50MB limit
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
        // If we have frame data, format it for the specific behavior type
        formattedData = {
          [behaviorType]: frame || frame_sequence,
        };
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
      console.log("ML Analysis Debug:");
      console.log("- Behavior Type:", behaviorType);
      console.log("- Temp File:", tempFile);
      console.log("- Python Script:", pythonScript);
      console.log("- Working Dir:", workingDir);
      console.log("- Formatted Data Keys:", Object.keys(formattedData));
      console.log(
        "- Payload Size:",
        (payloadSize / 1024 / 1024).toFixed(2),
        "MB"
      );

      // Use command line arguments for behavior type and file path
      const args = [
        pythonScript,
        "--data",
        tempFile,
        "--behavior",
        behaviorType,
      ];
      console.log("- Python Args:", args);

      const pythonProcess = spawn("python", args, {
        cwd: workingDir,
        stdio: ["pipe", "pipe", "pipe"],
      });

      // Set a timeout for the Python process (5 minutes)
      const timeout = setTimeout(() => {
        pythonProcess.kill("SIGTERM");
        console.error("Python process timed out after 5 minutes");
        res.status(408).json({
          success: false,
          message:
            "ML analysis timed out. Please try with smaller data or contact support.",
        });
      }, 5 * 60 * 1000); // 5 minutes

      let result = "";
      let error = "";

      pythonProcess.stdout.on("data", (data) => {
        result += data.toString();
      });

      pythonProcess.stderr.on("data", (data) => {
        error += data.toString();
        // Log full stderr output for debugging
        console.error("Python script stderr:", data.toString());
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
        console.log(`Python process exited with code: ${code}`);
        console.log(`Python stdout: "${result}"`);
        console.log(`Python stderr: "${error}"`);

        if (code !== 0) {
          console.error("Python script error:", error);
          return res.status(500).json({
            success: false,
            message: "ML analysis failed",
            error: error,
          });
        }

        try {
          if (!result.trim()) {
            console.error("Python script returned empty result");
            return res.status(500).json({
              success: false,
              message: "ML analysis returned empty result",
              error: "No output from Python script",
            });
          }

          let analysisResult = JSON.parse(result);

          // Ensure behavior_type key is present for frontend compatibility
          analysisResult = {
            behavior_type: behaviorType,
            ...analysisResult,
          };

          console.log("Parsed analysis result:", analysisResult);
          res.json({
            success: true,
            analysis: analysisResult,
          });
        } catch (parseError) {
          console.error("JSON parse error:", parseError);
          console.error("Raw result:", result);
          res.status(500).json({
            success: false,
            message: "Failed to parse ML results",
            error: parseError.message,
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
        res.status(500).json({
          success: false,
          message: "Failed to start ML analysis",
          error: err.message,
        });
      });
    } catch (fileError) {
      console.error("File operation error:", fileError);
      res.status(500).json({
        success: false,
        message: "Failed to prepare data for ML analysis",
        error: fileError.message,
      });
    }
  } catch (error) {
    console.error("ML Controller Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Get ML model status
export const getModelStatus = async (req, res) => {
  try {
    // Temporary: Return mock status in production
    if (process.env.NODE_ENV === "production") {
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
    // Temporary: Return simulated ML responses in production instead of disabling
    if (process.env.NODE_ENV === "production") {
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
    const scriptPath = path.join(__dirname, "..", "ml-utils", "ml_analyzer.py");

    const pythonCommand = `python "${scriptPath}" --analysis-type ${analysisType}`;

    // Execute the Python script with the image data
    const result = execSync(pythonCommand, {
      input: JSON.stringify({ imageData }),
      encoding: "utf-8",
      timeout: 30000, // 30 second timeout
    });

    const analysis = JSON.parse(result);

    res.json({
      success: true,
      analysis,
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

    // Use the Python script in ml-utils directory
    const scriptPath = path.join(
      __dirname,
      "..",
      "ml-utils",
      "batch_analyzer.py"
    );

    const pythonCommand = `python "${scriptPath}" --analysis-type ${analysisType}`;

    // Execute the Python script with batch data
    const result = execSync(pythonCommand, {
      input: JSON.stringify({ images }),
      encoding: "utf-8",
      timeout: 60000, // 60 second timeout for batch processing
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
