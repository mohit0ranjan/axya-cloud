const fs = require('fs');
const path = require('path');

const filePath = path.resolve('d:/Projects/teledrive/web/app/s/[slug]/share-v2-client.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Replace imports
content = content.replace(
    "import styles from './share-v2.module.css';",
    `import { ShareHeader } from '../../../../components/share/ShareHeader';
import { ShareCard } from '../../../../components/share/ShareCard';
import { FileGrid } from '../../../../components/share/FileGrid';
import { PreviewModal } from '../../../../components/share/PreviewModal';
import { Lock, EyeOff, Search, FolderOpen, ChevronDown, ChevronRight } from 'lucide-react';`
);

// 2. Replace renderLoadingScreen and everything below it
const splitMarker = '  const renderLoadingScreen = () => (';
const parts = content.split(splitMarker);

if (parts.length === 2) {
    const topPart = parts[0];

    const bottomPart = `  const renderLoadingScreen = () => (
    <div className="min-h-screen bg-brand-bg flex flex-col font-sans">
      <header className="flex items-center justify-between py-4 px-6 mb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-neutral-200 to-neutral-300 animate-pulse" />
          <div className="h-6 w-32 bg-neutral-200 rounded animate-pulse" />
        </div>
      </header>
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <div className="h-32 w-full bg-white rounded-2xl shadow-sm animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
           {Array.from({ length: 8 }).map((_, i) => (
             <div key={i} className="h-48 bg-white rounded-2xl shadow-sm animate-pulse" />
           ))}
        </div>
      </main>
    </div>
  );

  if (loading) {
    return renderLoadingScreen();
  }

  return (
    <div className="min-h-screen bg-brand-bg text-brand-text font-sans antialiased pb-24 selection:bg-brand-start/20 selection:text-brand-start">
      <ShareHeader 
        share={share} 
        totalSizeText={share ? formatSize(Number(allLoadedFiles.reduce((acc, f) => acc + (f.size_bytes || 0), 0))) : undefined} 
      />
      
      <main className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {share && (
          <ShareCard 
            share={share} 
            onDownloadAll={share.resourceType === 'folder' && share.allowDownload ? handleDownloadAll : undefined} 
            downloading={zipState.loading} 
          />
        )}

        {requiresPassword && (
          <div className="max-w-md mx-auto mt-12 bg-white rounded-2xl p-8 shadow-card border border-neutral-100 text-center">
             <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-6 text-amber-500">
               <Lock className="w-8 h-8" />
             </div>
             <h2 className="text-2xl font-bold mb-2">Protected Share</h2>
             <p className="text-brand-muted mb-6">This shared page is locked. Enter the password to continue.</p>
             <form onSubmit={(e) => { e.preventDefault(); void openShare(password); }} className="space-y-4">
               <div className="relative">
                 <input
                   className="w-full pl-4 pr-12 py-3 rounded-xl border border-neutral-200 focus:outline-none focus:ring-2 focus:ring-brand-start/50 transition-all bg-neutral-50 focus:bg-white"
                   type={showPassword ? 'text' : 'password'}
                   value={password}
                   onChange={(e) => setPassword(e.target.value)}
                   placeholder="Enter password"
                 />
                 <button
                   type="button"
                   className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-muted hover:text-brand-text"
                   onClick={() => setShowPassword((curr) => !curr)}
                   aria-label={showPassword ? 'Hide password' : 'Show password'}
                 >
                   {showPassword ? <EyeOff className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
                 </button>
               </div>
               {error && <p className="text-red-500 text-sm">{error}</p>}
               <button 
                 type="submit" 
                 disabled={opening}
                 className="w-full py-3 rounded-xl bg-gradient-to-r from-brand-start to-brand-end text-white font-medium hover:shadow-lg hover:-translate-y-0.5 transition-all disabled:opacity-70"
               >
                 {opening ? 'Unlocking...' : 'Unlock Share'}
               </button>
             </form>
          </div>
        )}

        {error && !requiresPassword && (
          <div className="p-4 mb-6 rounded-xl bg-red-50 text-red-600 border border-red-100 max-w-3xl mx-auto text-center">{error}</div>
        )}

        {sessionToken && !requiresPassword && (
          <div className="space-y-8 animate-in fade-in duration-500">
            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white/50 p-2 rounded-2xl backdrop-blur-md border border-white">
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-muted" />
                <input
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-transparent border-transparent focus:bg-white focus:border-brand-start/30 focus:ring-2 focus:ring-brand-start/20 transition-all shadow-sm"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search files..."
                />
              </div>
              <select 
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-transparent focus:bg-white border-transparent focus:ring-2 focus:ring-brand-start/20 shadow-sm cursor-pointer text-brand-text font-medium transition-all" 
                value={sort} 
                onChange={(e) => setSort(e.target.value)}
              >
                <option value="name_asc">Name A-Z</option>
                <option value="name_desc">Name Z-A</option>
                <option value="size_desc">Largest first</option>
                <option value="size_asc">Smallest first</option>
                <option value="date_desc">Newest first</option>
                <option value="date_asc">Oldest first</option>
              </select>
            </div>

            {Object.entries(sections).length === 0 && !loading && (
              <div className="text-center py-12 text-brand-muted">No content loaded.</div>
            )}

            {Object.entries(sections).map(([key, section]) => (
              <section key={key} className="space-y-4">
                {key && key !== '/' && (
                  <button
                    type="button"
                    className="flex items-center gap-2 group w-full text-left"
                    onClick={() => {
                      setSections((curr) => ({ ...curr, [key]: { ...curr[key], expanded: !curr[key].expanded } }));
                      if (!sections[key]?.expanded && !sections[key]?.files.length && !sections[key]?.folders.length) {
                        void loadSection(key, true);
                      }
                    }}
                  >
                    <div className="p-1.5 rounded-lg bg-brand-light text-brand-start group-hover:bg-brand-start group-hover:text-white transition-colors">
                      {section.expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </div>
                    <span className="font-semibold text-lg text-brand-text">{section.path}</span>
                  </button>
                )}

                {section.expanded && (
                  <div className="space-y-6">
                    {section.error && <p className="text-red-500">{section.error}</p>}
                    
                    {section.folders.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {section.folders.map((folder) => (
                          <button
                            key={\`\${key}-\${folder.path}\`}
                            className="flex items-center gap-4 p-4 rounded-2xl bg-white border border-neutral-100 shadow-sm hover:shadow-md hover:border-brand-start/30 transition-all text-left"
                            onClick={() => {
                              const nextPath = String(folder.path || '/');
                              if (sections[nextPath]) {
                                setSections((curr) => ({ ...curr, [nextPath]: { ...curr[nextPath], expanded: !curr[nextPath].expanded } }));
                              } else {
                                void loadSection(nextPath, true);
                              }
                            }}
                          >
                            <div className="p-3 bg-brand-light rounded-xl text-brand-start">
                              <FolderOpen className="w-6 h-6" />
                            </div>
                            <div>
                              <div className="font-semibold text-brand-text truncate break-all">{folder.name}</div>
                              <div className="text-sm text-brand-muted">{folder.fileCount} files</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}

                    {section.files.length > 0 && (
                      <FileGrid 
                        files={section.files} 
                        share={share as ShareMeta} 
                        onPreview={(file) => openImageModal(file)} 
                        onDownload={(file) => handleDownloadItem(file)} 
                        ticketMap={ticketLoadingMap} 
                      />
                    )}

                    {!section.loading && section.files.length === 0 && section.folders.length === 0 && (
                      <p className="text-brand-muted text-center py-8">Empty folder.</p>
                    )}

                    {section.page?.hasMore && (
                      <div className="flex justify-center pt-4">
                        <button 
                          type="button" 
                          className="px-6 py-2.5 rounded-xl bg-white border border-neutral-200 text-brand-text font-medium hover:bg-neutral-50 shadow-sm transition-all" 
                          onClick={() => void loadSection(key, false)}
                        >
                          Load more files
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
      </main>

      <PreviewModal
        isOpen={imageModal.open}
        onClose={() => setImageModal({ open: false, items: [], index: 0 })}
        files={imageModal.items}
        currentIndex={imageModal.index}
        onNext={() => handleImageNav(1)}
        onPrev={() => handleImageNav(-1)}
        onDownload={handleDownloadItem}
        share={share as ShareMeta}
      />
    </div>
  );
}
`;

    fs.writeFileSync(filePath, topPart + bottomPart);
    console.log("Successfully patched file.");
} else {
    console.log("Could not find split marker.");
}
