import * as tf from "@tensorflow/tfjs";

class ClientMLService {
  constructor() {
    this.isInitialized = false;
    this.models = {};
    this.detectionCallbacks = new Set();
    this.isDetecting = false;
    this.lastAnalysisTime = 0;
    this.analysisInterval = 5000; // 5 seconds
  }

  async initialize() {
    if (this.isInitialized) return;

    try {
      // Set TensorFlow.js backend
      await tf.ready();
      console.log("TensorFlow.js initialized with backend:", tf.getBackend());

      // Initialize models for different behaviors
      await this.initializeBehaviorModels();

      this.isInitialized = true;
      console.log("Client-side ML service initialized successfully");
    } catch (error) {
      console.error("Failed to initialize client-side ML:", error);
      throw error;
    }
  }

  async initializeBehaviorModels() {
    // Create simple models for different behaviors
    // These would normally be pre-trained models loaded from files

    // Eye gaze detection model (simplified)
    this.models.eye_gaze = await this.createEyeGazeModel();

    // Hand tapping detection model
    this.models.tapping_hands = await this.createHandTappingModel();

    // Foot tapping detection model
    this.models.tapping_feet = await this.createFootTappingModel();

    // Sit/stand detection model
    this.models.sit_stand = await this.createSitStandModel();

    // Rapid talking detection (audio-based)
    this.models.rapid_talking = await this.createRapidTalkingModel();
  }

  async createEyeGazeModel() {
    // Simple CNN model for eye gaze pattern detection
    const model = tf.sequential({
      layers: [
        tf.layers.conv2d({
          inputShape: [64, 64, 3],
          filters: 32,
          kernelSize: 3,
          activation: "relu",
        }),
        tf.layers.maxPooling2d({ poolSize: 2 }),
        tf.layers.conv2d({
          filters: 64,
          kernelSize: 3,
          activation: "relu",
        }),
        tf.layers.maxPooling2d({ poolSize: 2 }),
        tf.layers.flatten(),
        tf.layers.dense({ units: 128, activation: "relu" }),
        tf.layers.dropout({ rate: 0.5 }),
        tf.layers.dense({ units: 1, activation: "sigmoid" }),
      ],
    });

    // Compile model
    model.compile({
      optimizer: "adam",
      loss: "binaryCrossentropy",
      metrics: ["accuracy"],
    });

    return model;
  }

  async createHandTappingModel() {
    // Model for detecting repetitive hand movements
    const model = tf.sequential({
      layers: [
        tf.layers.lstm({
          inputShape: [10, 21 * 2], // 10 frames, 21 hand landmarks * 2 coords
          units: 64,
          returnSequences: true,
        }),
        tf.layers.lstm({ units: 32 }),
        tf.layers.dense({ units: 16, activation: "relu" }),
        tf.layers.dense({ units: 1, activation: "sigmoid" }),
      ],
    });

    model.compile({
      optimizer: "adam",
      loss: "binaryCrossentropy",
      metrics: ["accuracy"],
    });

    return model;
  }

  async createFootTappingModel() {
    // Model for detecting foot tapping from pose landmarks
    const model = tf.sequential({
      layers: [
        tf.layers.lstm({
          inputShape: [10, 6], // 10 frames, 6 coordinates (both ankles + knees)
          units: 32,
          returnSequences: true,
        }),
        tf.layers.lstm({ units: 16 }),
        tf.layers.dense({ units: 8, activation: "relu" }),
        tf.layers.dense({ units: 1, activation: "sigmoid" }),
      ],
    });

    model.compile({
      optimizer: "adam",
      loss: "binaryCrossentropy",
      metrics: ["accuracy"],
    });

    return model;
  }

  async createSitStandModel() {
    // Model for detecting sitting vs standing posture
    const model = tf.sequential({
      layers: [
        tf.layers.dense({
          inputShape: [33 * 2], // 33 pose landmarks * 2 coordinates
          units: 128,
          activation: "relu",
        }),
        tf.layers.dropout({ rate: 0.3 }),
        tf.layers.dense({ units: 64, activation: "relu" }),
        tf.layers.dense({ units: 32, activation: "relu" }),
        tf.layers.dense({ units: 1, activation: "sigmoid" }),
      ],
    });

    model.compile({
      optimizer: "adam",
      loss: "binaryCrossentropy",
      metrics: ["accuracy"],
    });

    return model;
  }

  async createRapidTalkingModel() {
    // Model for detecting rapid speech patterns (would need audio analysis)
    const model = tf.sequential({
      layers: [
        tf.layers.dense({
          inputShape: [128], // Audio features
          units: 64,
          activation: "relu",
        }),
        tf.layers.dropout({ rate: 0.3 }),
        tf.layers.dense({ units: 32, activation: "relu" }),
        tf.layers.dense({ units: 1, activation: "sigmoid" }),
      ],
    });

    model.compile({
      optimizer: "adam",
      loss: "binaryCrossentropy",
      metrics: ["accuracy"],
    });

    return model;
  }

  async analyzeFrame(imageData, behaviorType = "comprehensive") {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      // Convert image data to tensor
      const imageTensor = await this.preprocessImage(imageData);

      if (behaviorType === "comprehensive") {
        // Analyze all behaviors
        const results = {};
        for (const [behavior, model] of Object.entries(this.models)) {
          if (behavior !== "rapid_talking") {
            // Skip audio-based for image analysis
            results[behavior] = await this.analyzeWithModel(
              imageTensor,
              model,
              behavior
            );
          }
        }
        return this.formatComprehensiveResults(results);
      } else {
        // Analyze specific behavior
        const model = this.models[behaviorType];
        if (!model) {
          throw new Error(`Unknown behavior type: ${behaviorType}`);
        }
        return await this.analyzeWithModel(imageTensor, model, behaviorType);
      }
    } catch (error) {
      console.error("Client-side ML analysis failed:", error);
      throw error;
    }
  }

  async preprocessImage(imageData) {
    let tensor;

    if (typeof imageData === "string") {
      // Handle base64 data URL
      const img = new Image();
      img.src = imageData;
      await new Promise((resolve) => (img.onload = resolve));

      // Create canvas and get image data
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, 64, 64);

      // Convert to tensor
      tensor = tf.browser.fromPixels(canvas);
    } else if (imageData instanceof HTMLVideoElement) {
      // Handle video element
      tensor = tf.browser.fromPixels(imageData);
      tensor = tf.image.resizeBilinear(tensor, [64, 64]);
    } else {
      // Handle other formats
      tensor = tf.tensor(imageData);
    }

    // Normalize to [0, 1]
    tensor = tensor.div(255.0);

    // Add batch dimension
    tensor = tensor.expandDims(0);

    return tensor;
  }

  async analyzeWithModel(imageTensor, model, behaviorType) {
    try {
      // Get prediction from model
      const prediction = await model.predict(imageTensor);
      const confidence = await prediction.data();

      // Determine if behavior is detected based on confidence threshold
      const threshold = this.getThresholdForBehavior(behaviorType);
      const detected = confidence[0] > threshold;

      // Clean up tensors
      prediction.dispose();

      return {
        behavior_type: behaviorType,
        confidence: confidence[0],
        detected: detected,
        timestamp: new Date().toISOString(),
        message: `Client-side ML analysis - ${
          detected ? "Behavior detected" : "No behavior detected"
        }`,
      };
    } catch (error) {
      console.error(`Analysis failed for ${behaviorType}:`, error);
      throw error;
    }
  }

  getThresholdForBehavior(behaviorType) {
    const thresholds = {
      eye_gaze: 0.7,
      tapping_hands: 0.6,
      tapping_feet: 0.6,
      sit_stand: 0.8,
      rapid_talking: 0.65,
    };
    return thresholds[behaviorType] || 0.7;
  }

  formatComprehensiveResults(results) {
    // Find the behavior with highest confidence
    let maxConfidence = 0;
    let primaryBehavior = "unknown";
    let detected = false;

    for (const [behavior, result] of Object.entries(results)) {
      if (result.confidence > maxConfidence) {
        maxConfidence = result.confidence;
        primaryBehavior = behavior;
        detected = result.detected;
      }
    }

    return {
      success: true,
      analysis: {
        behavior_type: primaryBehavior,
        confidence: maxConfidence,
        detected: detected,
        timestamp: new Date().toISOString(),
        message: `Client-side real-time ML analysis`,
        all_behaviors: results,
      },
    };
  }

  // Real-time detection with webcam
  async startRealTimeDetection(videoElement, callback) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    this.isDetecting = true;
    this.detectionCallbacks.add(callback);

    const detectLoop = async () => {
      if (!this.isDetecting) return;

      try {
        const now = Date.now();
        if (now - this.lastAnalysisTime >= this.analysisInterval) {
          const results = await this.analyzeFrame(
            videoElement,
            "comprehensive"
          );

          // Notify all callbacks
          this.detectionCallbacks.forEach((cb) => {
            try {
              cb(results);
            } catch (error) {
              console.error("Detection callback error:", error);
            }
          });

          this.lastAnalysisTime = now;
        }
      } catch (error) {
        console.error("Real-time detection error:", error);
      }

      // Continue loop
      requestAnimationFrame(detectLoop);
    };

    detectLoop();
  }

  stopRealTimeDetection() {
    this.isDetecting = false;
    this.detectionCallbacks.clear();
  }

  addDetectionCallback(callback) {
    this.detectionCallbacks.add(callback);
  }

  removeDetectionCallback(callback) {
    this.detectionCallbacks.delete(callback);
  }

  // Get model status
  getStatus() {
    return {
      success: true,
      status: {
        modelsLoaded: this.isInitialized,
        availableModels: Object.keys(this.models),
        systemStatus: this.isInitialized
          ? "Client-side ML active"
          : "Not initialized",
        backend: tf.getBackend(),
        version: tf.version_core,
      },
    };
  }
}

// Create singleton instance
const clientMLService = new ClientMLService();

export default clientMLService;
