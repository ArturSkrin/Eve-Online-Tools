import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Search, FlaskConical, ArrowRight, TrendingUp, Zap } from "lucide-react";

const sections = [
  {
    title: "Contracts",
    description: "Scan public contracts across New Eden regions. Compare contract prices with market values to find profitable deals.",
    icon: Search,
    href: "/contracts",
    accentColor: "text-primary",
    accentBg: "bg-primary/10 border-primary/30",
    glowColor: "shadow-[0_0_30px_-5px_hsl(190,80%,45%,0.15)]",
    features: ["Region scanning", "Profit analysis", "Deal bookmarks", "Scan history"],
  },
  {
    title: "Reactions",
    description: "Calculate reaction profitability using live market data. Optimize your production chains for maximum ISK/hr.",
    icon: FlaskConical,
    href: "/reactions",
    accentColor: "text-chart-4",
    accentBg: "bg-chart-4/10 border-chart-4/30",
    glowColor: "shadow-[0_0_30px_-5px_hsl(270,60%,55%,0.15)]",
    features: ["Neuralink Enhancer", "Live prices", "Profit margins"],
  },
];

export default function HomePage() {
  return (
    <div className="min-h-full flex flex-col items-center justify-center p-6 md:p-12" data-testid="page-home">
      <div className="max-w-4xl w-full space-y-12">
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center gap-3 mb-6">
            <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-primary/15 border border-primary/30">
              <TrendingUp className="w-7 h-7 text-primary" />
            </div>
          </div>
          <h1
            className="font-['Oxanium'] text-3xl md:text-4xl font-bold tracking-wider text-foreground"
            data-testid="text-home-title"
          >
            EVE ANALYZER
          </h1>
          <p className="font-mono text-sm text-muted-foreground tracking-wide max-w-md mx-auto">
            Market intelligence tools for New Eden
          </p>
          <div className="flex items-center justify-center gap-2 pt-2">
            <Zap className="w-3 h-3 text-chart-2" />
            <span className="text-[10px] font-mono tracking-widest uppercase text-chart-2">
              All data via public ESI API
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {sections.map((section) => (
            <Link key={section.title} href={section.href}>
              <Card
                className={`group cursor-pointer transition-all duration-300 hover:border-primary/40 ${section.glowColor} hover:shadow-lg h-full`}
                data-testid={`card-section-${section.title.toLowerCase()}`}
              >
                <CardContent className="p-6 space-y-5">
                  <div className="flex items-start justify-between">
                    <div className={`flex items-center justify-center w-11 h-11 rounded-lg border ${section.accentBg}`}>
                      <section.icon className={`w-5 h-5 ${section.accentColor}`} />
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all duration-300" />
                  </div>

                  <div className="space-y-2">
                    <h2 className="font-['Oxanium'] text-xl font-semibold tracking-wide text-foreground">
                      {section.title}
                    </h2>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {section.description}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2 pt-1">
                    {section.features.map((feature) => (
                      <span
                        key={feature}
                        className="text-[10px] font-mono tracking-wider uppercase px-2 py-1 rounded border border-border bg-muted/50 text-muted-foreground"
                      >
                        {feature}
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        <div className="text-center">
          <p className="text-[10px] text-muted-foreground font-mono tracking-wider">
            EVE Online &copy; CCP Games &middot; Not affiliated with CCP
          </p>
        </div>
      </div>
    </div>
  );
}
