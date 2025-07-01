import React, { useContext, useEffect, useState, useCallback } from "react";
import { AppContext } from "@/context/AppContext";
import axios from "axios";
import toast from "react-hot-toast";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { format } from "date-fns";

const SessionManager = () => {
  const { backendUrl, userData } = useContext(AppContext);
  const [sessions, setSessions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchSessions = useCallback(async () => {
    try {
      setIsLoading(true);
      const { data } = await axios.get(backendUrl + "/api/auth/sessions", {
        params: { userId: userData.id },
      });

      if (data.success) {
        setSessions(data.sessions);
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      toast.error(error.message || "Failed to fetch sessions");
    } finally {
      setIsLoading(false);
    }
  }, [backendUrl, userData?.id]);

  const handleTerminateSession = async (sessionId) => {
    try {
      setIsLoading(true);
      const { data } = await axios.post(
        backendUrl + "/api/auth/terminate-session",
        {
          sessionId,
          userId: userData.id,
        }
      );

      if (data.success) {
        toast.success("Session terminated successfully");
        fetchSessions();
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      toast.error(error.message || "Failed to terminate session");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>Active Sessions</CardTitle>
        <CardDescription>
          Manage your active sessions across different devices
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {sessions.map((session) => (
            <div
              key={session.id}
              className="flex items-center justify-between p-4 border rounded-lg"
            >
              <div className="space-y-1">
                <p className="font-medium">{session.deviceInfo}</p>
                <p className="text-sm text-muted-foreground">
                  Last active: {format(new Date(session.lastActive), "PPp")}
                </p>
                <p className="text-sm text-muted-foreground">
                  Expires: {format(new Date(session.expiresAt), "PPp")}
                </p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => handleTerminateSession(session.id)}
                disabled={isLoading}
              >
                Terminate
              </Button>
            </div>
          ))}
          {sessions.length === 0 && (
            <p className="text-center text-muted-foreground">
              No active sessions found
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default SessionManager;
