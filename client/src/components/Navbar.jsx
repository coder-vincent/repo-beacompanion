import React from "react";
import { assets } from "../assets/assets";
import ThemeChange from "./theme/ThemeChange";

const Navbar = () => {
  return (
    <div className="w-full flex items-center justify-between p-2 sm:p-4 sm:px-24 select-none">
      <div className="flex items-center gap-2">
        <img
          src={assets.Logo}
          alt="Logo"
          className="w-14 sm:w-16 pointer-events-none dark:invert"
        />

        <h1 className="hidden md:block lg:text-lg dark:text-sky-300 text-sky-500">
          BEA
          <span className="font-bold dark:text-white text-black">
            Companion
          </span>
        </h1>
      </div>

      <ThemeChange />
    </div>
  );
};

export default Navbar;
