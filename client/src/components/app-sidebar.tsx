import { Search, Factory, History, BookmarkCheck, TrendingUp, FlaskConical, Beaker, Cpu } from "lucide-react";
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

const contractItems = [
  {
    title: "Contract Scanner",
    url: "/contracts",
    icon: Search,
  },
  {
    title: "Manufacturing",
    url: "/contracts/manufacturing",
    icon: Factory,
  },
  {
    title: "Saved Deals",
    url: "/contracts/saved",
    icon: BookmarkCheck,
  },
  {
    title: "Scan History",
    url: "/contracts/history",
    icon: History,
  },
];

const reactionItems = [
  {
    title: "Neuralink Enhancer",
    url: "/reactions",
    icon: Beaker,
  },
];

const implantItems = [
  {
    title: "Rapture Alpha",
    url: "/implants",
    icon: Cpu,
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
                Market Intelligence
              </p>
            </div>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground">
            Contracts
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {contractItems.map((item) => {
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
          <SidebarGroupLabel className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground flex items-center gap-2">
            <FlaskConical className="w-3 h-3" />
            Reactions
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {reactionItems.map((item) => {
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
          <SidebarGroupLabel className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground flex items-center gap-2">
            <Cpu className="w-3 h-3" />
            Implants
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {implantItems.map((item) => {
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
