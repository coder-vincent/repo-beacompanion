import React, { useState, useRef, useContext, useEffect } from "react";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSideBar";
import { SiteHeader } from "@/components/SiteHeader";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import toast from "react-hot-toast";
import axios from "axios";
import { AppContext } from "@/context/AppContext";
import { useNavigate } from "react-router-dom";

const EmailVerify = () => {
  axios.defaults.withCredentials = true;
  const navigate = useNavigate();
  const { backendUrl, getUserData, userData, isLoggedIn } =
    useContext(AppContext);

  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const inputRefs = useRef([]);

  const handleKeyDown = (e, index) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      inputRefs.current[index - 1].focus();
    }
  };

  const handleInput = (e, index) => {
    const value = e.target.value;
    if (value && index < 5) {
      inputRefs.current[index + 1].focus();
    }

    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData("text").trim();
    const numbers = pastedData
      .replace(/[^0-9]/g, "")
      .split("")
      .slice(0, 6);

    const newOtp = [...otp];
    numbers.forEach((num, index) => {
      if (index < 6) {
        newOtp[index] = num;
      }
    });
    setOtp(newOtp);

    const nextEmptyIndex = newOtp.findIndex((value) => value === "");
    const focusIndex = nextEmptyIndex === -1 ? 5 : nextEmptyIndex;
    inputRefs.current[focusIndex]?.focus();
  };

  const onSubmitHandler = async (e) => {
    try {
      e.preventDefault();

      if (otp.some((digit) => digit === "")) {
        toast.error("Please enter all 6 digits");
        return;
      }

      const otpString = otp.join("");

      const { data } = await axios.post(
        backendUrl + "/api/auth/verify-account",
        {
          userId: userData.id,
          otp: otpString,
        }
      );

      if (data.success) {
        toast.success(data.message);
        getUserData();
        navigate("/dashboard");
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      toast.error(error.message || "Something went wrong");
    }
  };

  useEffect(() => {
    isLoggedIn && userData && userData.isAccountVerified && navigate("/");
  }, [isLoggedIn, userData, navigate]);

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-background to-muted/20">
      <SidebarProvider className="flex flex-col">
        <SiteHeader />
        <div className="flex flex-1 overflow-hidden">
          <AppSidebar />
          <SidebarInset className="flex-1 overflow-auto">
            <div className="flex flex-col h-full">
              <div className="flex-1 flex items-center justify-center p-2 sm:p-4">
                <div className="w-full max-w-[95%] sm:max-w-[90%] md:max-w-[85%] lg:max-w-[80%]">
                  <form
                    className="bg-card p-4 sm:p-6 md:p-8 rounded-xl shadow-xl w-full max-w-md mx-auto text-sm border border-border/50 backdrop-blur-sm"
                    onPaste={handlePaste}
                    onSubmit={onSubmitHandler}
                  >
                    <div className="flex justify-center mb-4 sm:mb-6">
                      <div className="relative">
                        <div className="absolute inset-0 bg-primary/20 rounded-full blur-xl animate-pulse"></div>
                        <Sparkles className="w-16 h-16 sm:w-20 sm:h-20 md:w-24 md:h-24 text-primary drop-shadow-lg relative z-10 animate-pulse" />
                      </div>
                    </div>
                    <h1 className="text-foreground text-xl sm:text-2xl font-semibold text-center mb-2">
                      Email Verification
                    </h1>
                    <p className="text-center mb-6 sm:mb-8 text-muted-foreground text-xs sm:text-sm">
                      Enter the 6-digit code sent to your email
                    </p>
                    <div className="flex justify-between gap-1 sm:gap-2 mb-6 sm:mb-8">
                      {Array(6)
                        .fill(0)
                        .map((_, index) => (
                          <input
                            ref={(el) => (inputRefs.current[index] = el)}
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            maxLength={1}
                            key={index}
                            value={otp[index]}
                            autoFocus={index === 0}
                            className="w-8 h-10 sm:w-10 sm:h-12 md:w-12 bg-background text-foreground text-center text-lg sm:text-xl rounded-lg border border-input focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all hover:border-primary/50"
                            onKeyDown={(e) => handleKeyDown(e, index)}
                            onChange={(e) => handleInput(e, index)}
                          />
                        ))}
                    </div>
                    <Button className="w-full h-10 sm:h-11 text-sm sm:text-base font-medium">
                      Verify Email
                    </Button>
                  </form>
                </div>
              </div>
            </div>
          </SidebarInset>
        </div>
      </SidebarProvider>
    </div>
  );
};

export default EmailVerify;
