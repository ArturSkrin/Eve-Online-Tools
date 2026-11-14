import { ArrowDown, ArrowUp } from "lucide-react";

export type SortDir = "asc" | "desc";

/**
 * Table header cell that sorts by its column: the active one shows an arrow and flips on a second click.
 * Numbers start high to low, names A to Z (pass `firstDir`).
 */
export function SortHeader<K extends string>({
  id,
  label,
  sort,
  onSort,
  align = "right",
  title,
}: {
  id: K;
  label: string;
  sort: { key: K; dir: SortDir };
  onSort: (key: K) => void;
  align?: "left" | "right";
  title?: string;
}) {
  const active = sort.key === id;
  const Arrow = sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      className={`font-normal px-3 py-2 ${align === "right" ? "text-right" : "text-left"}`}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      title={title}
    >
      <button
        onClick={() => onSort(id)}
        className={`inline-flex items-center gap-1 uppercase tracking-wider hover:text-foreground ${
          align === "right" ? "flex-row-reverse" : ""
        } ${active ? "text-foreground" : ""}`}
        data-testid={`sort-${id}`}
      >
        {label}
        <Arrow className={`w-3 h-3 shrink-0 ${active ? "opacity-100 text-primary" : "opacity-0"}`} />
      </button>
    </th>
  );
}

/** Click handler state: same column flips direction, a new one starts at `firstDir`. */
export function nextSort<K extends string>(s: { key: K; dir: SortDir }, key: K, firstDir: SortDir = "desc") {
  return s.key === key ? { key, dir: (s.dir === "asc" ? "desc" : "asc") as SortDir } : { key, dir: firstDir };
}
