"use client";

import { ChevronsUpDown, LogOut, Sparkles } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

import { useContext } from "react";
import { AppContext } from "@/context/AppContext";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

export function NavUser({ user }) {
  const { isMobile } = useSidebar();
  const { userData, backendUrl, setUserData, setIsLoggedIn } =
    useContext(AppContext);

  const displayName = userData?.name || "Guest";
  const avatarInitial = displayName[0]?.toUpperCase() || "G";

  const navigate = useNavigate();

  const sendVerificationOtp = async () => {
    try {
      axios.defaults.withCredentials = true;

      const { data } = await axios.post(
        backendUrl + "/api/auth/send-verify-otp"
      );

      if (data.success) {
        navigate("/email-verify");
        toast.success(data.message);
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      toast.error(error?.message || "Verification failed");
    }
  };

  const logout = async () => {
    try {
      axios.defaults.withCredentials = true;
      localStorage.removeItem("authToken");
      delete axios.defaults.headers.common["Authorization"];
      const { data } = await axios.post(backendUrl + "/api/auth/logout");

      data.success && setIsLoggedIn(false);
      data.success && setUserData(false);
      navigate("/");
    } catch (error) {
      toast.error(error?.message || "Logout failed");
    }
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarImage src={user?.avatar || ""} alt={displayName} />
                <AvatarFallback className="rounded-lg">
                  {avatarInitial}
                </AvatarFallback>
              </Avatar>

              <div className="flex flex-col flex-1 text-left text-sm leading-tight ml-2">
                <span className="truncate font-medium">{displayName}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {userData?.email}
                </span>
              </div>

              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            className="min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            {!userData?.isAccountVerified && (
              <>
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={sendVerificationOtp}>
                    <Sparkles className="mr-2 size-4" />
                    Verify Email
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
              </>
            )}

            <DropdownMenuItem onClick={logout}>
              <LogOut className="mr-2 size-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
