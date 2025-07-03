import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Eye, VideoOff } from "lucide-react";
import toast from "react-hot-toast";

const VideoFeed = ({
  videoRef,
  canvasRef,
  stream,
  videoPlaying,
  setError,
  setVideoPlaying,
}) => {
  return (
    <Card>
      <CardHeader className="pb-2 md:pb-3">
        <CardTitle className="flex items-center gap-2 text-sm md:text-base">
          <Eye className="h-4 w-4" />
          Live Video Feed
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="bg-black rounded-lg aspect-[4/3] flex items-center justify-center relative overflow-hidden group">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`rounded-lg w-full h-full object-cover transition-all duration-500 ease-out ${
              stream ? "opacity-100 scale-100" : "opacity-0 scale-95"
            }`}
            style={{
              backgroundColor: "black",
              minHeight: "180px",
              display: stream ? "block" : "none",
            }}
            onError={() =>
              setError(
                "Video element failed to load. Please check camera permissions."
              )
            }
            onCanPlay={() => {
              if (videoRef.current) {
                videoRef.current.play().catch(() => {
                  toast(
                    "Click anywhere on the page to enable camera playback."
                  );
                });
              }
            }}
            onPlaying={() => setVideoPlaying(true)}
            onPause={() => setVideoPlaying(false)}
            onStalled={() => setVideoPlaying(false)}
            onWaiting={() => setVideoPlaying(false)}
          />
          <canvas ref={canvasRef} className="hidden" />

          {/* Video Status Overlay */}
          {stream && videoPlaying && (
            <div className="absolute top-3 right-3 z-10">
              <div className="flex items-center gap-2 bg-black/60 backdrop-blur-sm rounded-full px-3 py-1 text-white text-xs animate-in fade-in-0 slide-in-from-top-2 duration-300">
                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                LIVE
              </div>
            </div>
          )}

          {/* Camera Placeholder Overlay */}
          {!stream && (
            <div className="absolute inset-0 flex items-center justify-center text-center text-muted-foreground p-4 animate-in fade-in-0 zoom-in-95 duration-500">
              <div className="space-y-3">
                <div className="mx-auto w-16 h-16 bg-muted/20 rounded-full flex items-center justify-center animate-pulse">
                  <VideoOff className="h-8 w-8 md:h-10 md:w-10" />
                </div>
                <div>
                  <p className="text-sm md:text-base font-medium">
                    Camera feed will appear here
                  </p>
                  <p className="text-xs text-muted-foreground/80 mt-1">
                    Start monitoring to begin
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Loading Overlay */}
          {stream && !videoPlaying && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in-0 duration-300">
              <div className="text-center text-white">
                <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                <p className="text-xs">Initializing camera...</p>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default VideoFeed;
