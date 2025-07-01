import React from "react";
import { useTheme } from "@/components/theme/theme-provider";
import { Sun, Moon } from "lucide-react";
import { Button } from "../ui/button";

function ThemeChange() {
  const { theme, setTheme } = useTheme();
  const themes = ["light", "dark"];

  const handleThemeChange = () => {
    const newTheme = themes[(themes.indexOf(theme) + 1) % themes.length];
    setTheme(newTheme);
  };

  return (
    <Button
      variant="secondary"
      size="icon"
      className="w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14 relative overflow-hidden cursor-pointer"
      onClick={handleThemeChange}
    >
      <div className="absolute inset-0 flex items-center justify-center transition-transform duration-500">
        <Moon
          className={`w-5 h-5 sm:w-6 sm:h-6 transition-all duration-500 ${
            theme === "dark" ? "opacity-100 rotate-0" : "opacity-0 -rotate-90"
          }`}
        />
        <Sun
          className={`w-5 h-5 sm:w-6 sm:h-6 absolute transition-all duration-500 ${
            theme === "light" ? "opacity-100 rotate-0" : "opacity-0 rotate-90"
          }`}
        />
      </div>
    </Button>
  );
}

export default ThemeChange;
