export function formatISK(value: number): string {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2)}B ISK`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M ISK`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(2)}K ISK`;
  }
  return `${value.toFixed(2)} ISK`;
}

export function formatISKCompact(value: number): string {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)}B`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return value.toFixed(0);
}

export function formatPercent(value: number): string {
  const sign = value >= 0 ? "+" : "";
  if (Math.abs(value) >= 10000) {
    return `${sign}${(value / 1000).toFixed(0)}K%`;
  }
  if (Math.abs(value) >= 1000) {
    return `${sign}${(value / 1000).toFixed(1)}K%`;
  }
  return `${sign}${value.toFixed(1)}%`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

export function formatVolume(value: number): string {
  return `${new Intl.NumberFormat("en-US").format(Math.round(value))} m³`;
}

export function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

export function timeUntil(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  if (diffMs <= 0) return "expired";
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays > 0) return `${diffDays}d ${diffHours % 24}h`;
  return `${diffHours}h`;
}
