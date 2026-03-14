import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import HomePage from "@/pages/home";
import ScannerPage from "@/pages/scanner";
import ManufacturingPage from "@/pages/manufacturing";
import SavedPage from "@/pages/saved";
import HistoryPage from "@/pages/history";
import ReactionsPage from "@/pages/reactions";
import ImplantsPage from "@/pages/implants";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={HomePage} />
      <Route path="/contracts" component={ScannerPage} />
      <Route path="/contracts/manufacturing" component={ManufacturingPage} />
      <Route path="/contracts/saved" component={SavedPage} />
      <Route path="/contracts/history" component={HistoryPage} />
      <Route path="/reactions" component={ReactionsPage} />
      <Route path="/implants" component={ImplantsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppLayout() {
  const [location] = useLocation();
  const isHome = location === "/";

  if (isHome) {
    return (
      <main className="min-h-screen">
        <Router />
      </main>
    );
  }

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center gap-2 p-2 border-b sticky top-0 z-50 bg-background">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <span className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground">
              EVE Analyzer
            </span>
          </header>
          <main className="flex-1 overflow-auto">
            <Router />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AppLayout />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
