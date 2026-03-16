'use client';

import { Inter } from 'next/font/google';
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import FolderCard, { FolderCardData } from '../../components/folders/FolderCard';
import FoldersBottomNav from '../../components/folders/FoldersBottomNav';
import FoldersHeader from '../../components/folders/FoldersHeader';

const inter = Inter({ subsets: ['latin'] });

const folders: FolderCardData[] = [
  {
    id: 'all-files',
    name: 'All Files',
    meta: 'Empty folder',
    bgClass: 'bg-[#EEF2FF]',
    iconClass: 'text-blue-500',
  },
  {
    id: 'sem-6',
    name: 'Sem 6',
    meta: '3 subfolders',
    bgClass: 'bg-[#F0FDF4]',
    iconClass: 'text-emerald-500',
  },
  {
    id: 'diwali',
    name: 'Diwali',
    meta: '320 files',
    bgClass: 'bg-[#FFFBEB]',
    iconClass: 'text-amber-500',
  },
  {
    id: 'gaya-trip',
    name: 'Gaya Trip',
    meta: '178 files',
    bgClass: 'bg-[#FFF1F2]',
    iconClass: 'text-rose-500',
  },
];

export default function FoldersPage() {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredFolders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return folders;
    return folders.filter(folder => folder.name.toLowerCase().includes(q));
  }, [searchQuery]);

  return (
    <div className={`${inter.className} min-h-screen bg-[#F8FAFC] pb-24 text-slate-800 antialiased`}>
      <FoldersHeader sortLabel="Newest First" />

      <main className="mx-auto w-full max-w-md px-6 pt-2">
        <section className="mb-6" aria-label="Page title">
          <h1 className="text-3xl font-normal leading-tight text-slate-900">
            Your <span className="font-bold">Folders</span>
          </h1>
          <p className="mt-1 text-sm text-slate-400">{folders.length} folders | Newest First</p>
        </section>

        <section className="mb-8" aria-label="Search folders">
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
              <Search className="h-4 w-4 text-slate-400" />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search folders"
              className="block w-full rounded-2xl border border-slate-100 bg-white py-3.5 pl-11 pr-4 text-sm shadow-sm transition-all focus:border-blue-500 focus:ring-blue-500"
            />
          </div>
        </section>

        <section className="grid grid-cols-2 gap-4" aria-label="Folder grid">
          {filteredFolders.map(folder => (
            <FolderCard key={folder.id} folder={folder} />
          ))}
        </section>
      </main>

      <FoldersBottomNav />
    </div>
  );
}
