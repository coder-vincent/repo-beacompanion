import React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Play, Square, XCircle } from "lucide-react";

const MonitoringControls = ({
  monitoring,
  startMonitoring,
  stopMonitoring,
  handleAnalyzeNow,
  manualAnalysisIntervalId,
  error,
}) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Play className="h-5 w-5" />
          Behavior Monitoring
        </CardTitle>
        <CardDescription>
          Monitor behaviors using computer vision and ML analysis. Monitoring
          will continue until manually stopped.
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
                <span className="h-4 w-4">🧠</span>
                Analyze Now (+ Speech)
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
                    <strong>Check Browser Permissions:</strong> Click the camera
                    icon in your browser's address bar and ensure camera access
                    is allowed
                  </li>
                  <li>
                    <strong>Close Other Apps:</strong> Make sure no other
                    applications (Zoom, Teams, etc.) are using your camera
                  </li>
                  <li>
                    <strong>Try Different Browser:</strong> Use Chrome, Firefox,
                    or Edge for best compatibility
                  </li>
                  <li>
                    <strong>Check HTTPS:</strong> Ensure you're using HTTPS
                    (required for camera access)
                  </li>
                  <li>
                    <strong>Test Camera:</strong> Click "Test Camera" button to
                    verify camera access
                  </li>
                  <li>
                    <strong>Advanced Test:</strong> Use "Advanced Test" for
                    detailed camera diagnostics
                  </li>
                  <li>
                    <strong>Refresh Page:</strong> Try refreshing the page or
                    restarting your browser
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
  );
};

export default MonitoringControls;
