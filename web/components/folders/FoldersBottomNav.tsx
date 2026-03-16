import { FolderOpen, HardDrive, Star, Upload, User } from 'lucide-react';

export default function FoldersBottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-100 bg-white/85 px-6 py-4 backdrop-blur-md">
      <div className="relative mx-auto flex w-full max-w-md items-center justify-between">
        <a className="flex flex-col items-center gap-1 text-slate-400 transition hover:text-blue-600" href="#" aria-label="Home">
          <HardDrive className="h-5 w-5" />
          <span className="text-[10px] font-medium">Home</span>
        </a>

        <a className="flex flex-col items-center gap-1 text-blue-600" href="#" aria-current="page" aria-label="Folders">
          <FolderOpen className="h-5 w-5" />
          <span className="text-[10px] font-medium">Folders</span>
        </a>

        <div className="w-12" aria-hidden />

        <a className="flex flex-col items-center gap-1 text-slate-400 transition hover:text-blue-600" href="#" aria-label="Starred">
          <Star className="h-5 w-5" />
          <span className="text-[10px] font-medium">Starred</span>
        </a>

        <a className="flex flex-col items-center gap-1 text-slate-400 transition hover:text-blue-600" href="#" aria-label="Profile">
          <User className="h-5 w-5" />
          <span className="text-[10px] font-medium">Profile</span>
        </a>

        <button
          type="button"
          aria-label="Upload file"
          className="absolute -top-7 left-1/2 flex h-16 w-16 -translate-x-1/2 items-center justify-center rounded-full border-4 border-[#F8FAFC] bg-gradient-to-tr from-[#5B7CFF] to-[#6A5CFF] text-white shadow-[0_10px_25px_-5px_rgba(59,130,246,0.5)] transition hover:-translate-y-0.5"
        >
          <Upload className="h-6 w-6" />
        </button>
      </div>
    </nav>
  );
}
