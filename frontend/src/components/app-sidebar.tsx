import { LayoutDashboard, Binoculars, TableProperties, Settings, Plus } from "lucide-react"
import { useLocation, useNavigate } from "react-router-dom"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"

const navItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Surveys", url: "/surveys", icon: Binoculars },
  { title: "Detections", url: "/detections", icon: TableProperties },
  { title: "Settings", url: "/settings", icon: Settings },
]

export function AppSidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { state } = useSidebar()

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              onClick={() => navigate("/dashboard")}
              className="cursor-pointer"
            >
              <div className="flex aspect-square size-12 items-center justify-center">
                <img src="/databird.png" alt="DataBirdLab" className="size-10" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-bold">
                  DataBird<span className="font-extralight text-muted-foreground"></span>
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  Boeung Sne Monitoring
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive =
                  location.pathname === item.url ||
                  (item.url !== "/dashboard" && location.pathname.startsWith(item.url))

                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.title}
                    >
                      <a
                        href={item.url}
                        onClick={(e) => {
                          e.preventDefault()
                          navigate(item.url)
                        }}
                      >
                        <item.icon />
                        <span>{item.title}</span>
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <Button
              variant={state === "collapsed" ? "ghost" : "default"}
              size={state === "collapsed" ? "icon" : "default"}
              className={state === "collapsed"
                ? "w-full justify-center"
                : "w-full bg-zinc-900 hover:bg-zinc-800 text-white justify-start pl-3"
              }
              onClick={() => navigate("/surveys?new=true")}
            >
              <Plus className={state === "collapsed" ? "size-5" : "mr-2 size-4"} />
              {state !== "collapsed" && <span>New Survey</span>}
            </Button>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
