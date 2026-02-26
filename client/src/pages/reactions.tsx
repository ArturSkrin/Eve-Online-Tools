import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FlaskConical, Beaker, ArrowRight } from "lucide-react";

const reactions = [
  {
    name: "Neuralink Enhancer",
    type: "Biochemical",
    status: "coming-soon" as const,
  },
];

export default function ReactionsPage() {
  return (
    <div className="p-6 space-y-6" data-testid="page-reactions">
      <div className="space-y-1">
        <h1 className="font-['Oxanium'] text-2xl font-bold tracking-wider text-foreground flex items-center gap-3">
          <FlaskConical className="w-6 h-6 text-chart-4" />
          Reactions
        </h1>
        <p className="text-sm text-muted-foreground font-mono">
          Calculate reaction profitability with live market data
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {reactions.map((reaction) => (
          <Card
            key={reaction.name}
            className="group transition-all duration-200 hover:border-chart-4/40"
            data-testid={`card-reaction-${reaction.name.toLowerCase().replace(/\s/g, "-")}`}
          >
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-chart-4/10 border border-chart-4/30">
                  <Beaker className="w-5 h-5 text-chart-4" />
                </div>
                <Badge
                  variant="outline"
                  className="text-[10px] font-mono bg-chart-3/10 text-chart-3 border-chart-3/30"
                >
                  SOON
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <CardTitle className="font-['Oxanium'] text-lg tracking-wide">
                  {reaction.name}
                </CardTitle>
                <p className="text-xs text-muted-foreground font-mono mt-1">
                  {reaction.type} Reaction
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <ArrowRight className="w-3 h-3" />
                <span className="font-mono">Details coming soon</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
