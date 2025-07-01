import { AtSign, Lock } from "lucide-react";
import React, { useContext, useRef, useState } from "react";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import axios from "axios";
import { AppContext } from "@/context/AppContext";

const ResetPasswordForm = ({
  email,
  setEmail,
  newPassword,
  setNewPassword,
}) => {
  axios.defaults.withCredentials = true;

  const navigate = useNavigate();
  const [isEmailSent, setIsEmailSent] = useState("");
  const [isOtpSubmitted, setIsOtpSubmitted] = useState(false);

  const { backendUrl } = useContext(AppContext);

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

  const onSubmitEmail = async (e) => {
    e.preventDefault();

    try {
      const { data } = await axios.post(
        backendUrl + "/api/auth/send-reset-otp",
        { email }
      );

      data.success ? toast.success(data.message) : toast.error(data.message);
      data.success && setIsEmailSent(true);
    } catch (error) {
      toast.error(error.message);
    }
  };

  const onSubmitOTP = async (e) => {
    e.preventDefault();

    const otpArray = inputRefs.current.map((e) => e.value);
    setOtp(otpArray.join(""));
    setIsOtpSubmitted(true);
  };

  const onSubmitNewPassword = async (e) => {
    e.preventDefault();

    try {
      const { data } = await axios.post(
        backendUrl + "/api/auth/reset-password",
        { email, otp, newPassword }
      );

      data.success ? toast.success(data.message) : toast.error(data.message);
      data.success && navigate("/");
    } catch (error) {
      toast.error(error.message);
    }
  };

  return (
    <div className="bg-card text-card-foreground p-6 rounded-md w-full text-sm border shadow-sm">
      <div>
        {!isEmailSent && (
          <>
            <h2 className="text-2xl font-semibold text-foreground text-center mb-3">
              Reset Password
            </h2>
            <p className="text-center text-sm mb-6 text-muted-foreground font-medium tracking-wide">
              Enter your registered email address
            </p>
            <form className="w-full" onSubmit={onSubmitEmail}>
              <div className="flex items-center gap-3 w-full px-0 sm:px-5 py-2.5">
                <AtSign className="text-muted-foreground" />
                <Input
                  type="email"
                  placeholder="Email"
                  required
                  className="w-full mb-4"
                  onChange={(e) => setEmail(e.target.value)}
                  value={email}
                />
              </div>
              <Button className="mb-4 w-full py-2.5">Reset Password</Button>
            </form>
            <div className="mb-4 after:border-border relative text-center text-sm after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t">
              <span className="bg-card text-muted-foreground relative z-10 px-2">
                Change of mind?
              </span>
            </div>
            <Button
              className="mb-4 w-full py-2.5"
              variant="outline"
              onClick={() => navigate("/")}
            >
              Go Back
            </Button>
          </>
        )}

        {!isOtpSubmitted && isEmailSent && (
          <form onPaste={handlePaste} onSubmit={onSubmitOTP}>
            <h1 className="text-foreground text-xl sm:text-2xl font-semibold text-center mb-2">
              Reset Password OTP
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
            <Button className="mb-4 w-full h-10 sm:h-11 text-sm sm:text-base font-medium">
              Submit
            </Button>
          </form>
        )}

        {isOtpSubmitted && isEmailSent && (
          <form onSubmit={onSubmitNewPassword}>
            <h1 className="text-foreground text-xl sm:text-2xl font-semibold text-center mb-2">
              New Password
            </h1>
            <p className="text-center mb-6 sm:mb-8 text-muted-foreground text-xs sm:text-sm">
              Enter the new password below
            </p>
            <div className="mb-4 flex items-center gap-3 w-full px-0 sm:px-5 py-2.5">
              <Lock className="text-muted-foreground" />
              <Input
                type="password"
                placeholder="New Password"
                required
                className="w-full"
                onChange={(e) => setNewPassword(e.target.value)}
                value={newPassword}
              />
            </div>
            <Button className="mb-4 w-full h-10 sm:h-11 text-sm sm:text-base font-medium">
              Submit
            </Button>
          </form>
        )}
      </div>
    </div>
  );
};

export default ResetPasswordForm;
