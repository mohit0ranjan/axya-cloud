import { ArrowLeft, Filter, Plus } from 'lucide-react';

interface FoldersHeaderProps {
  sortLabel: string;
}

export default function FoldersHeader({ sortLabel }: FoldersHeaderProps) {
  return (
    <header className="sticky top-0 z-20 border-b border-[rgba(91,124,255,0.08)] bg-[#F8FAFC]/80 px-6 py-4 backdrop-blur-md">
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="Go back"
          className="flex h-10 w-10 items-center justify-center rounded-full text-slate-600 transition hover:bg-white/80"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-3">
          <button
            type="button"
            className="flex items-center gap-2 rounded-full border border-slate-100 bg-white px-4 py-2 text-sm font-medium text-blue-600 shadow-sm transition hover:shadow"
          >
            <Filter className="h-4 w-4" />
            <span>{sortLabel}</span>
          </button>

          <button
            type="button"
            aria-label="Add folder"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-100 bg-white text-slate-600 shadow-sm transition hover:shadow"
          >
            <Plus className="h-5 w-5" />
          </button>
        </div>
      </div>
    </header>
  );
}
