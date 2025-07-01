"use client";

import React, { useContext } from "react";
import { LayoutDashboard } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { NavMain } from "./NavMain";
import { NavUser } from "./NavUser";
import { AppContext } from "@/context/AppContext";
import { useLocation } from "react-router-dom";

export function AppSidebar(props) {
  const { userData } = useContext(AppContext);
  const location = useLocation();

  const navItems = [
    {
      title: "Dashboard",
      url: "/dashboard",
      icon: LayoutDashboard,
      isActive: location.pathname === "/dashboard",
    },
  ];

  return (
    <Sidebar
      className="top-[var(--header-height)] h-[calc(100svh-var(--header-height))]!"
      {...props}
    >
      <SidebarContent>
        <NavMain items={navItems} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={userData || { name: "Guest", email: "", avatar: "" }} />
      </SidebarFooter>
    </Sidebar>
  );
}
