import { Check, X } from "lucide-react";

interface ProjectRowProps {
  lesson: string;
  complete: boolean;
  type: "Core" | "Elective";
}

export function ProjectRow({ lesson, complete, type }: ProjectRowProps) {
  return (
    <div className="flex items-center justify-between py-1.5 px-1">
      <div className="flex items-center gap-2 min-w-0">
        {complete ? (
          <Check size={15} className="text-green-600 dark:text-green-500 shrink-0" />
        ) : (
          <X size={15} className="text-muted-foreground shrink-0" />
        )}
        <span className="text-sm truncate">{lesson}</span>
        {type === "Elective" && (
          <span className="text-xs text-muted-foreground shrink-0">(elective)</span>
        )}
      </div>
      <span
        className={
          complete
            ? "text-xs text-green-700 dark:text-green-400 font-medium shrink-0 ml-4"
            : "text-xs text-muted-foreground shrink-0 ml-4"
        }
      >
        {complete ? "Done" : "Pending"}
      </span>
    </div>
  );
}
