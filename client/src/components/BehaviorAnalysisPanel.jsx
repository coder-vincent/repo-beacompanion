import React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, Brain, VideoOff } from "lucide-react";

const BehaviorAnalysisPanel = ({
  isAnalyzing,
  monitoring,
  currentBehaviors,
  behaviorData,
  getBehaviorStatusColor,
  formatBehaviorLabel,
  currentWpm = 0,
}) => {
  return (
    <Card>
      <CardHeader className="pb-2 md:pb-3">
        <CardTitle className="flex items-center gap-2 text-sm md:text-base">
          <Activity className="h-4 w-4" />
          Behavior Analysis
          {isAnalyzing && (
            <Badge variant="secondary" className="ml-2">
              <Brain className="h-3 w-3 mr-1 animate-pulse" />
              <span className="hidden sm:inline">Analyzing...</span>
              <span className="sm:hidden">...</span>
            </Badge>
          )}
          {monitoring && !isAnalyzing && (
            <Badge variant="default" className="ml-2">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse mr-1" />
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
          Real-time behavior analysis using machine learning models. Analysis
          runs continuously (5x per second) while monitoring is active.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Physical Behaviors */}
        <div className="space-y-2">
          <h3 className="text-xs md:text-sm font-semibold text-muted-foreground uppercase tracking-wide border-b pb-2">
            Physical Behaviors
          </h3>
          <div className="grid gap-2">
            {["eye_gaze", "tapping_hands", "tapping_feet", "sit_stand"].map(
              (behavior) => {
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
                            variant={getBehaviorStatusColor(behavior)}
                            className={`text-xs transition-all duration-300 ${
                              data.detected ? "animate-pulse shadow-sm" : ""
                            }`}
                          >
                            {data.detected ? "Detected" : "Normal"}
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
              }
            )}
          </div>
        </div>

        {/* Speech Behaviors */}
        <div className="space-y-2">
          <h3 className="text-xs md:text-sm font-semibold text-muted-foreground uppercase tracking-wide border-b pb-2">
            Speech Analysis
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
                    <div className="text-base md:text-lg">🗣️</div>
                    <div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={getBehaviorStatusColor(behavior)}
                          className="text-xs"
                        >
                          {data.detected ? "Detected" : "Normal"}
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
                  <div className="flex items-center gap-3">
                    {/* Current WPM */}
                    <div className="text-xs text-muted-foreground">
                      {currentWpm > 0
                        ? `${Math.round(currentWpm)} WPM`
                        : "-- WPM"}
                    </div>
                    {/* Detection count */}
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
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default BehaviorAnalysisPanel;
