import { LayoutDashboard, Binoculars, TableProperties, Settings, Plus, LogOut } from "lucide-react"
import { useEffect, useState } from "react"
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
import { ColonyDropdown } from "./ColonyDropdown"
import { supabase } from "@/lib/supabaseClient"

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
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setEmail(data.session?.user?.email ?? null))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    navigate("/login")
  }

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
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {/* Colony switcher lives outside SidebarMenuButton to avoid nested-button click interception */}
          <SidebarMenuItem className="px-2 pt-1">
            <ColonyDropdown />
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

          {email && (
            <SidebarMenuItem className="mt-1">
              <Button
                variant="ghost"
                size={state === "collapsed" ? "icon" : "sm"}
                className={state === "collapsed"
                  ? "w-full justify-center text-zinc-400 hover:text-zinc-100"
                  : "w-full justify-start text-zinc-400 hover:text-zinc-100 px-2 h-auto py-1.5"
                }
                onClick={handleSignOut}
                title={state === "collapsed" ? `Sign out (${email})` : undefined}
              >
                <LogOut className={state === "collapsed" ? "size-4" : "mr-2 size-3.5 shrink-0"} />
                {state !== "collapsed" && (
                  <div className="flex flex-col items-start min-w-0 flex-1">
                    <span className="text-xs leading-tight truncate w-full">Sign out</span>
                    <span className="text-[10px] leading-tight text-zinc-500 truncate w-full">{email}</span>
                  </div>
                )}
              </Button>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
