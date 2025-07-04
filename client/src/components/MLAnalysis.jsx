import React, { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Badge } from "./ui/badge";
import { Separator } from "./ui/separator";
import { Alert, AlertDescription } from "./ui/alert";
import {
  Loader2,
  Brain,
  CheckCircle,
  XCircle,
  AlertTriangle,
} from "lucide-react";

const MLAnalysis = () => {
  const [behaviorType, setBehaviorType] = useState("");
  const [inputData, setInputData] = useState("");
  const [analysisResult, setAnalysisResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [modelStatus, setModelStatus] = useState(null);
  const [systemReady, setSystemReady] = useState(false);

  const behaviorTypes = [
    {
      value: "eye_gaze",
      label: "Eye Gaze Detection",
      description: "Analyze eye movement patterns",
    },
    {
      value: "sit_stand",
      label: "Sit-Stand Detection",
      description: "Detect sitting and standing behavior",
    },
    {
      value: "tapping_hands",
      label: "Hand Tapping",
      description: "Detect hand tapping behavior",
    },
    {
      value: "tapping_feet",
      label: "Foot Tapping",
      description: "Detect foot tapping behavior",
    },
    {
      value: "rapid_talking",
      label: "Rapid Talking",
      description: "Analyze speech patterns and speed",
    },
  ];

  useEffect(() => {
    checkModelStatus();
  }, []);

  const checkModelStatus = async () => {
    try {
      const response = await fetch("/api/ml/status", {
        method: "GET",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (response.ok) {
        const data = await response.json();
        setModelStatus(data.models);
        setSystemReady(data.system_ready);
      } else {
        setError("Failed to check model status");
      }
    } catch (err) {
      setError("Error checking model status: " + err.message);
    }
  };

  const analyzeBehavior = async () => {
    if (!behaviorType || !inputData.trim()) {
      setError("Please select a behavior type and provide data");
      return;
    }

    setLoading(true);
    setError("");
    setAnalysisResult(null);

    try {
      let parsedData;
      try {
        parsedData = JSON.parse(inputData);
      } catch {
        setError("Invalid data format. Please provide valid JSON array.");
        setLoading(false);
        return;
      }

      const response = await fetch("/api/ml/analyze", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          behaviorType,
          data: parsedData,
        }),
      });

      const result = await response.json();

      if (response.ok) {
        setAnalysisResult(result.analysis);
      } else {
        setError(result.message || "Analysis failed");
      }
    } catch (err) {
      setError("Error during analysis: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (available) => {
    return available ? (
      <CheckCircle className="h-4 w-4 text-green-500" />
    ) : (
      <XCircle className="h-4 w-4 text-red-500" />
    );
  };

  const getConfidenceColor = (confidence) => {
    if (confidence >= 0.8) return "bg-green-100 text-green-800";
    if (confidence >= 0.6) return "bg-yellow-100 text-yellow-800";
    return "bg-red-100 text-red-800";
  };

  const getDetectionIcon = (detected) => {
    return detected ? (
      <AlertTriangle className="h-4 w-4 text-orange-500" />
    ) : (
      <CheckCircle className="h-4 w-4 text-green-500" />
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            ML Behavior Analysis
          </CardTitle>
          <CardDescription>
            Analyze behavior patterns using machine learning models for ADHD
            detection
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* System Status */}
          <div className="space-y-2">
            <Label>System Status</Label>
            <div className="flex items-center gap-2">
              {systemReady ? (
                <Badge
                  variant="default"
                  className="bg-green-100 text-green-800"
                >
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Ready
                </Badge>
              ) : (
                <Badge variant="destructive">
                  <XCircle className="h-3 w-3 mr-1" />
                  Not Ready
                </Badge>
              )}
            </div>
          </div>

          {/* Model Status */}
          {modelStatus && (
            <div className="space-y-2">
              <Label>Model Availability</Label>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {Object.entries(modelStatus).map(([model, status]) => (
                  <div
                    key={model}
                    className="flex items-center justify-between p-2 bg-gray-50 rounded"
                  >
                    <span className="capitalize">
                      {model.replace("_", " ")}
                    </span>
                    {getStatusIcon(status.available)}
                  </div>
                ))}
              </div>
            </div>
          )}

          <Separator />

          {/* Analysis Form */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="behavior-type">Behavior Type</Label>
              <Select value={behaviorType} onValueChange={setBehaviorType}>
                <SelectTrigger>
                  <SelectValue placeholder="Select behavior type" />
                </SelectTrigger>
                <SelectContent>
                  {behaviorTypes.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      <div>
                        <div className="font-medium">{type.label}</div>
                        <div className="text-xs text-gray-500">
                          {type.description}
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="input-data">Input Data (JSON Array)</Label>
              <Input
                id="input-data"
                placeholder="Enter data as JSON array, e.g., [1, 2, 3, 4, 5]"
                value={inputData}
                onChange={(e) => setInputData(e.target.value)}
              />
              <p className="text-xs text-gray-500">
                Provide sensor data as a JSON array. Format depends on behavior
                type.
              </p>
            </div>

            <Button
              onClick={analyzeBehavior}
              disabled={loading || !systemReady}
              className="w-full"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Brain className="mr-2 h-4 w-4" />
                  Analyze Behavior
                </>
              )}
            </Button>
          </div>

          {/* Error Display */}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Results Display */}
          {analysisResult && (
            <div className="space-y-4">
              <Separator />
              <div className="space-y-2">
                <Label>Analysis Results</Label>
                <Card>
                  <CardContent className="pt-6">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">Behavior Type:</span>
                        <Badge variant="outline" className="capitalize">
                          {analysisResult.behavior_type?.replace("_", " ")}
                        </Badge>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="font-medium">Detection:</span>
                        <div className="flex items-center gap-2">
                          {getDetectionIcon(analysisResult.detected)}
                          <span
                            className={
                              analysisResult.detected
                                ? "text-orange-600"
                                : "text-green-600"
                            }
                          >
                            {analysisResult.detected
                              ? "Detected"
                              : "Not Detected"}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="font-medium">Probability:</span>
                        <span className="font-mono">
                          {(analysisResult.probability * 100).toFixed(2)}%
                        </span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="font-medium">Confidence:</span>
                        <Badge
                          className={getConfidenceColor(
                            analysisResult.confidence
                          )}
                        >
                          {(analysisResult.confidence * 100).toFixed(1)}%
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default MLAnalysis;
