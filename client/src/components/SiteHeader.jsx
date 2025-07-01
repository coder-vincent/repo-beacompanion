"use client";

import { SidebarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useSidebar } from "@/components/ui/sidebar";
import { assets } from "../assets/assets";
import ThemeChange from "./theme/ThemeChange";

export function SiteHeader() {
  const { toggleSidebar } = useSidebar();

  return (
    <header className="bg-background sticky top-0 z-50 flex w-full items-center border-b min-h-[96px]">
      <div className="flex w-full items-center gap-2 px-4 py-4">
        <Button
          className="w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14 relative overflow-hidden cursor-pointer"
          variant="secondary"
          size="icon"
          onClick={toggleSidebar}
        >
          <SidebarIcon />
        </Button>
        <Separator orientation="vertical" className="mr-2 h-4" />
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
        <Separator orientation="vertical" className="mx-2 h-4" />
        <div className="flex-grow"></div>
        <ThemeChange />
      </div>
    </header>
  );
}
