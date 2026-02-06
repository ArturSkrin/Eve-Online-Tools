import { Search, Factory, History, BookmarkCheck, TrendingUp } from "lucide-react";
import { useLocation, Link } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";

const navItems = [
  {
    title: "Contract Scanner",
    url: "/",
    icon: Search,
    description: "Find profitable contracts",
  },
  {
    title: "Manufacturing",
    url: "/manufacturing",
    icon: Factory,
    description: "Calculate production costs",
  },
  {
    title: "Saved Deals",
    url: "/saved",
    icon: BookmarkCheck,
    description: "Your bookmarked contracts",
  },
  {
    title: "Scan History",
    url: "/history",
    icon: History,
    description: "Previous scan results",
  },
];

export function AppSidebar() {
  const [location] = useLocation();

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link href="/">
          <div className="flex items-center gap-3 cursor-pointer">
            <div className="flex items-center justify-center w-9 h-9 rounded-md bg-primary/15 border border-primary/30">
              <TrendingUp className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1
                className="font-mono text-sm font-semibold tracking-wider text-foreground"
                data-testid="text-app-title"
              >
                EVE ANALYZER
              </h1>
              <p className="text-xs text-muted-foreground font-mono">
                Contract Scanner
              </p>
            </div>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground">
            Navigation
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive = location === item.url;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      data-testid={`nav-${item.title.toLowerCase().replace(/\s/g, "-")}`}
                    >
                      <Link href={item.url}>
                        <item.icon className="w-4 h-4" />
                        <span className="font-mono text-xs">{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground">
            Market Status
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <div className="px-3 py-2 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground font-mono">ESI API</span>
                <Badge variant="outline" className="text-[10px] font-mono bg-chart-2/10 text-chart-2 border-chart-2/30">
                  ONLINE
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground font-mono">Prices</span>
                <Badge variant="outline" className="text-[10px] font-mono bg-primary/10 text-primary border-primary/30">
                  CACHED
                </Badge>
              </div>
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-4">
        <div className="text-[10px] text-muted-foreground font-mono text-center leading-relaxed">
          Data via ESI API
          <br />
          EVE Online &copy; CCP Games
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
