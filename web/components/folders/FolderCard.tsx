import { Ellipsis, FolderClosed } from 'lucide-react';

export interface FolderCardData {
  id: string;
  name: string;
  meta: string;
  bgClass: string;
  iconClass: string;
}

interface FolderCardProps {
  folder: FolderCardData;
}

export default function FolderCard({ folder }: FolderCardProps) {
  return (
    <article className={`group h-44 rounded-[24px] p-5 shadow-sm transition duration-200 ease-out active:scale-[0.98] hover:-translate-y-0.5 hover:shadow-md ${folder.bgClass}`}>
      <div className="flex h-full flex-col justify-between">
        <div className="flex items-start justify-between">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/85 shadow-sm">
            <FolderClosed className={`h-5 w-5 ${folder.iconClass}`} />
          </div>
          <button
            type="button"
            aria-label={`More options for ${folder.name}`}
            className="rounded-full p-1.5 text-slate-400 transition hover:bg-white/70 hover:text-slate-600"
          >
            <Ellipsis className="h-4.5 w-4.5" />
          </button>
        </div>

        <div>
          <h3 className="text-base font-semibold tracking-[-0.01em] text-slate-800">{folder.name}</h3>
          <p className="mt-0.5 text-xs font-medium text-slate-500">{folder.meta}</p>
        </div>
      </div>
    </article>
  );
}
