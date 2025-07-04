import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  BarChart3,
  Activity,
  AlertTriangle,
  Brain,
  Clock,
  Settings,
} from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription as CardDesc,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const SessionAnalyticsModal = ({
  open,
  setOpen,
  selectedSessionAnalytics,
  isLoading,
  formatBehaviorLabel,
}) => {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
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
          {isLoading ? (
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
          ) : selectedSessionAnalytics ? (
            <div className="space-y-4 md:space-y-6 animate-in fade-in-0 slide-in-from-bottom-4 duration-300">
              {/* Summary metrics */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                {[
                  {
                    icon: Clock,
                    label: "Duration",
                    value: selectedSessionAnalytics.sessionDuration || "N/A",
                    color: "blue",
                  },
                  {
                    icon: Activity,
                    label: "Total Detections",
                    value: selectedSessionAnalytics.totalBehaviors || 0,
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
                          selectedSessionAnalytics.averageConfidence * 100
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
                <Card className="animate-in fade-in-0 slide-in-from-left-4 duration-500">
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
                      {[
                        {
                          label: "Start Time",
                          value: selectedSessionAnalytics.sessionSummary
                            .startTime
                            ? new Date(
                                selectedSessionAnalytics.sessionSummary.startTime
                              ).toLocaleString()
                            : "N/A",
                        },
                        {
                          label: "End Time",
                          value: selectedSessionAnalytics.sessionSummary.endTime
                            ? new Date(
                                selectedSessionAnalytics.sessionSummary.endTime
                              ).toLocaleString()
                            : "N/A",
                        },
                        {
                          label: "Status",
                          value: selectedSessionAnalytics.sessionSummary.status,
                          badge: true,
                        },
                      ].map((item) => (
                        <div
                          key={item.label}
                          className="space-y-1 p-3 bg-muted/30 rounded-lg transition-colors hover:bg-muted/50"
                        >
                          <span className="font-medium text-muted-foreground">
                            {item.label}:
                          </span>
                          {item.badge ? (
                            <div className="pt-1">
                              <Badge
                                variant={
                                  item.value === "completed"
                                    ? "default"
                                    : "secondary"
                                }
                              >
                                {item.value}
                              </Badge>
                            </div>
                          ) : (
                            <p className="font-mono text-xs md:text-sm">
                              {item.value}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Behavior Breakdown */}
              {selectedSessionAnalytics.behaviorBreakdown &&
                Object.keys(selectedSessionAnalytics.behaviorBreakdown).length >
                  0 && (
                  <Card className="animate-in fade-in-0 slide-in-from-right-4 duration-500">
                    <CardHeader className="pb-3 md:pb-4">
                      <CardTitle className="flex items-center gap-2 text-lg md:text-xl">
                        <div className="p-2 bg-primary/10 rounded-lg">
                          <Brain className="h-4 w-4 md:h-5 md:w-5 text-primary" />
                        </div>
                        Behavior Breakdown
                      </CardTitle>
                      <CardDesc className="text-sm">
                        Detailed analysis of detected behaviors during this
                        session
                      </CardDesc>
                    </CardHeader>
                    <CardContent>
                      {Object.entries(
                        selectedSessionAnalytics.behaviorBreakdown
                      ).map(([behavior, data], index) => {
                        if (data.count === 0) return null;

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

                        return (
                          <div
                            key={behavior}
                            className="border rounded-lg p-3 md:p-4 bg-gradient-to-r from-card to-card/90 hover:from-accent/5 hover:to-accent/10 transition-all duration-300 hover:shadow-lg hover:scale-[1.02] animate-in fade-in-0 slide-in-from-bottom-2"
                            style={{ animationDelay: `${400 + index * 100}ms` }}
                          >
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                              <div className="flex items-center gap-3">
                                <div
                                  className="text-2xl md:text-3xl animate-bounce"
                                  style={{ animationDelay: `${index * 200}ms` }}
                                >
                                  {getBehaviorIcon()}
                                </div>
                                <h3 className="text-base md:text-lg font-semibold">
                                  {formatBehaviorLabel
                                    ? formatBehaviorLabel(behavior)
                                    : behavior}
                                </h3>
                              </div>
                              <Badge
                                variant="outline"
                                className="text-xs w-fit animate-pulse"
                              >
                                {data.count} detections
                              </Badge>
                            </div>
                            {/* stats grid */}
                            <div className="grid grid-cols-3 gap-2 md:gap-4">
                              <div className="text-center p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200/50 dark:border-blue-800/50">
                                <div className="text-lg md:text-2xl font-bold text-blue-600 dark:text-blue-400">
                                  {data.count}
                                </div>
                                <div className="text-xs md:text-sm text-muted-foreground mt-1">
                                  Total Detections
                                </div>
                              </div>
                              <div className="text-center p-3 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200/50 dark:border-green-800/50">
                                <div className="text-lg md:text-2xl font-bold text-green-600 dark:text-green-400">
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
                              <div className="text-center p-3 bg-purple-50 dark:bg-purple-950/20 rounded-lg border border-purple-200/50 dark:border-purple-800/50">
                                <div className="text-lg md:text-2xl font-bold text-purple-600 dark:text-purple-400">
                                  {data.totalConfidence
                                    ? Math.round(data.totalConfidence * 100) /
                                      100
                                    : 0}
                                </div>
                                <div className="text-xs md:text-sm text-muted-foreground mt-1">
                                  Total Confidence
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                )}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SessionAnalyticsModal;
