import React, { useContext, useState } from "react";
import { Input } from "./ui/input";
import { AtSign, Lock, User } from "lucide-react";
import { Button } from "./ui/button";
import { useNavigate } from "react-router-dom";
import { AppContext } from "@/context/AppContext";
import axios from "axios";
import toast from "react-hot-toast";

const LoginForm = ({
  state,
  setState,
  name,
  setName,
  email,
  setEmail,
  password,
  setPassword,
}) => {
  const navigate = useNavigate();
  const { backendUrl, setIsLoggedIn, getUserData } = useContext(AppContext);
  const [isLoading, setIsLoading] = useState(false);

  const validateForm = () => {
    if (state === "Sign Up") {
      if (name.trim().length < 2) {
        toast.error("Name must be at least 2 characters long");
        return false;
      }
      if (password.length < 6) {
        toast.error("Password must be at least 6 characters long");
        return false;
      }
    }
    if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      toast.error("Please enter a valid email address");
      return false;
    }
    return true;
  };

  const onSubmitHandler = async (e) => {
    try {
      e.preventDefault();

      if (!validateForm()) {
        return;
      }

      setIsLoading(true);
      axios.defaults.withCredentials = true;

      if (state === "Sign Up") {
        const { data } = await axios.post(backendUrl + "/api/auth/register", {
          name: name.trim(),
          email: email.trim(),
          password,
        });

        if (data.success) {
          toast.success("Account created successfully!");
          setIsLoggedIn(true);
          await getUserData();
          navigate("/dashboard");
        } else {
          toast.error(data.message || "Registration failed");
        }
      } else {
        const { data } = await axios.post(backendUrl + "/api/auth/login", {
          email: email.trim(),
          password,
        });

        if (data.success) {
          toast.success("Logged in successfully!");
          setIsLoggedIn(true);
          await getUserData();
          navigate("/dashboard");
        } else {
          toast.error(data.message || "Login failed");
        }
      }
    } catch (error) {
      console.error("Login/Register error:", error);
      const errorMessage =
        error.response?.data?.message || error.message || "An error occurred";
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-card text-card-foreground p-6 rounded-md w-full text-sm border shadow-sm">
      <h2 className="text-2xl font-semibold text-foreground text-center mb-3">
        {state === "Sign Up" ? "Create Your Account" : "Welcome Back"}
      </h2>
      <p className="text-center text-sm mb-6 text-muted-foreground font-medium tracking-wide">
        {state === "Sign Up"
          ? "Join BEACompanion to access personalized healthcare support"
          : "Sign in to continue your healthcare journey"}
      </p>

      <form className="w-full" onSubmit={onSubmitHandler}>
        {state === "Sign Up" && (
          <div className="flex items-center gap-3 w-full px-0 sm:px-5 py-2.5">
            <User className="text-muted-foreground" />
            <Input
              type="text"
              placeholder="Full Name"
              required
              className="w-full"
              onChange={(e) => setName(e.target.value)}
              value={name}
            />
          </div>
        )}

        <div className="flex items-center gap-3 w-full px-0 sm:px-5 py-2.5">
          <AtSign className="text-muted-foreground" />
          <Input
            type="email"
            placeholder="Email"
            required
            className="w-full"
            onChange={(e) => setEmail(e.target.value)}
            value={email}
          />
        </div>
        <div className="mb-4 flex items-center gap-3 w-full px-0 sm:px-5 py-2.5">
          <Lock className="text-muted-foreground" />
          <Input
            type="password"
            placeholder="Password"
            required
            className="w-full"
            onChange={(e) => setPassword(e.target.value)}
            value={password}
          />
        </div>

        {state === "Sign Up" ? null : (
          <div className="flex justify-end">
            <p
              className="mb-4 cursor-pointer inline-block text-primary hover:text-primary/80"
              onClick={() => navigate("/reset-password")}
            >
              Forgot Password?
            </p>
          </div>
        )}

        <Button className="mb-4 w-full py-2.5" disabled={isLoading}>
          {isLoading ? "Processing..." : state}
        </Button>
      </form>

      {state === "Sign Up" ? (
        <div className="mb-4 after:border-border relative text-center text-sm after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t">
          <span className="bg-card text-muted-foreground relative z-10 px-2">
            Already have an account?
          </span>
        </div>
      ) : (
        <div className="mb-4 after:border-border relative text-center text-sm after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t">
          <span className="bg-card text-muted-foreground relative z-10 px-2">
            Don't have an account?
          </span>
        </div>
      )}

      {state === "Sign Up" ? (
        <Button
          className="mb-4 w-full py-2.5"
          variant="secondary"
          onClick={() => setState("Login")}
          disabled={isLoading}
        >
          Sign In
        </Button>
      ) : (
        <Button
          className="mb-4 w-full py-2.5"
          variant="secondary"
          onClick={() => setState("Sign Up")}
          disabled={isLoading}
        >
          Create An Account
        </Button>
      )}
    </div>
  );
};

export default LoginForm;
