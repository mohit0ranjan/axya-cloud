# 🚀 Production Uploader - Complete Implementation

A **production-ready, Google Drive-style upload system** with parallel uploads, pause/resume, retries, and real-time progress tracking.

## ✅ What You Get

- ✅ **Parallel Uploads**: Upload 3 files simultaneously (configurable)
- ✅ **Pause/Resume**: Users can pause and resume uploads anytime
- ✅ **Auto-Retry**: Automatic retry with exponential backoff (3 retries by default)
- ✅ **Real-Time Progress**: Speed, ETA, and percentage for each file
- ✅ **Drag & Drop**: Professional drag-drop interface
- ✅ **Queue Management**: Smart task queuing and prioritization
- ✅ **Error Handling**: Graceful error handling with user-friendly messages
- ✅ **Responsive UI**: Works on desktop and mobile
- ✅ **Zero Configuration**: Works out of the box

---

## 📁 Files Created

### Backend
```
server/src/controllers/upload/
├── upload.simple.ts          # Simple single-file upload handler
├── index.ts                  # Updated exports

server/src/routes/
└── upload.routes.ts          # Updated with new /upload/file endpoints
```

### Frontend
```
web/lib/upload/
├── production-types.ts               # TypeScript typings
├── productionUploadManager.ts        # Core upload queue manager
├── PRODUCTION_UPLOADER_GUIDE.md      # Detailed integration guide

web/hooks/
└── useProductionUpload.ts            # React hook for upload management

web/components/upload/
└── ProductionUploader.tsx            # Google Drive-style UI component

web/context/
└── UploadContext.tsx                 # Optional global context provider
```

---

## 🚀 Quick Start

### 1. Use the Built-in Component

```tsx
'use client';

import { ProductionUploader } from '@/components/upload/ProductionUploader';

export default function MyPage() {
  return (
    <div>
      <h1>My Upload Page</h1>
      <ProductionUploader
        folderId={123}
        telegramChatId="chat_xxx"
        onFilesAdded={(count) => console.log(`${count} files added`)}
      />
    </div>
  );
}
```

That's it! The uploader appears as a draggable panel in the bottom-right corner.

### 2. Or Use the Hook for Custom UI

```tsx
'use client';

import { useProductionUpload } from '@/hooks/useProductionUpload';

export function CustomUploader() {
  const { tasks, stats, addFiles, pauseTask, resumeTask, cancelTask } =
    useProductionUpload();

  return (
    <div>
      <input
        type="file"
        multiple
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          addFiles(files, { folderId: 123 });
        }}
      />
      
      <div>Progress: {stats.overallProgress}%</div>
      <div>Uploaded: {stats.uploadedFiles} / {stats.totalFiles}</div>
      
      {tasks.map((task) => (
        <div key={task.id}>
          <p>{task.name} - {task.progress}%</p>
          {task.status === 'uploading' && (
            <button onClick={() => pauseTask(task.id)}>Pause</button>
          )}
          {task.status === 'paused' && (
            <button onClick={() => resumeTask(task.id)}>Resume</button>
          )}
          <button onClick={() => cancelTask(task.id)}>Cancel</button>
        </div>
      ))}
    </div>
  );
}
```

### 3. Use Global Context (Optional)

```tsx
// app/layout.tsx
import { UploadProvider } from '@/context/UploadContext';
import { ProductionUploader } from '@/components/upload/ProductionUploader';

export default function RootLayout({ children }) {
  return (
    <UploadProvider config={{ maxConcurrent: 5 }}>
      {children}
      <ProductionUploader />
    </UploadProvider>
  );
}
```

---

## 📊 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      React Component                         │
│  (ProductionUploader or Custom UI using useProductionUpload) │
└────────────────────┬────────────────────────────────────────┘
                     │
┌─────────────────────┴────────────────────────────────────────┐
│           ProductionUploadManager                            │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ • Queue management                                   │   │
│  │ • Parallel upload processing (3 at a time)          │   │
│  │ • Pause/Resume logic                                │   │
│  │ • Retry handling                                     │   │
│  │ • Progress & speed tracking                         │   │
│  └──────────────────────────────────────────────────────┘   │
└────────────────────┬────────────────────────────────────────┘
                     │
┌─────────────────────┴────────────────────────────────────────┐
│                    HTTP/FormData                             │
│  POST /upload/file (multipart/form-data)                    │
└────────────────────┬────────────────────────────────────────┘
                     │
┌─────────────────────┴────────────────────────────────────────┐
│              Backend Upload Handler                          │
│  (server/src/controllers/upload/upload.simple.ts)           │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ • Validate file                                      │   │
│  │ • Save to temp directory                            │   │
│  │ • Store in database                                 │   │
│  │ • Enqueue for background processing                 │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 🎮 Configuration

### Default Config
```ts
{
  maxConcurrent: 3,      // Upload 3 files simultaneously
  maxRetries: 3,         // Retry 3 times on failure
  retryDelayMs: 2000,    // Wait 2 seconds between retries
  apiUrl: process.env.NEXT_PUBLIC_API_URL
}
```

### Custom Config
```ts
const { tasks, stats } = useProductionUpload({
  maxConcurrent: 5,      // Faster for good networks
  maxRetries: 5,         // More retries for unreliable networks
  retryDelayMs: 5000,    // Longer delay between retries
  apiUrl: 'https://api.example.com'
});
```

**Presets:**
- **Mobile**: `{ maxConcurrent: 1, maxRetries: 5, retryDelayMs: 3000 }`
- **WiFi**: `{ maxConcurrent: 3, maxRetries: 3, retryDelayMs: 2000 }`
- **Gigabit**: `{ maxConcurrent: 10, maxRetries: 2, retryDelayMs: 1000 }`

---

## 📱 Upload States

```
queued ──────→ uploading ──────→ completed ✓
  ↓              ↓
  └──→ paused ───┘
                 ↓
             retrying ─→ completed ✓
                 ↓
             failed ✗ (can retry manually)
```

**State Descriptions:**
- `queued` - Waiting in queue to start
- `uploading` - Currently uploading
- `paused` - User paused (can resume)
- `retrying` - Automatic retry in progress
- `completed` - ✓ Successfully uploaded
- `failed` - ✗ Failed after all retries
- `cancelled` - User cancelled

---

## 🎯 API Endpoints

### Upload a File
```
POST /upload/file
Content-Type: multipart/form-data

Form Data:
  file (File) - The file to upload
  folderId (optional, number) - Folder ID
  telegramChatId (optional, string) - Telegram chat ID
```

**Response:**
```json
{
  "success": true,
  "uploadId": "abc123...",
  "fileName": "document.pdf",
  "fileSize": 5242880,
  "status": "processing",
  "message": "File uploaded successfully and queued for processing"
}
```

### Get Upload Status
```
GET /upload/file/status/:uploadId
```

**Response:**
```json
{
  "uploadId": "abc123...",
  "fileName": "document.pdf",
  "fileSize": 5242880,
  "status": "processing",
  "createdAt": "2024-03-31T10:00:00Z",
  "updatedAt": "2024-03-31T10:00:05Z",
  "error": null
}
```

### Cancel Upload
```
POST /upload/file/cancel/:uploadId
```

---

## 💾 Database Schema

The uploader uses the existing `upload_sessions` table:

```sql
CREATE TABLE IF NOT EXISTS upload_sessions (
  id VARCHAR(128) PRIMARY KEY,
  user_id INTEGER NOT NULL,
  file_name VARCHAR(512) NOT NULL,
  file_size BIGINT NOT NULL,
  file_mime VARCHAR(256) NOT NULL,
  status VARCHAR(50) NOT NULL,
  folder_id INTEGER,
  telegram_chat_id VARCHAR(128),
  temp_file_path TEXT,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

---

## 🔧 Customization

### Custom Upload Component

```tsx
import { useDragAndDrop } from 'your-drag-drop-lib';
import { useProductionUpload } from '@/hooks/useProductionUpload';

export function MyUploader() {
  const { addFiles, tasks, stats } = useProductionUpload();
  const { isDragging, files } = useDragAndDrop();

  return (
    <div className={isDragging ? 'active' : ''}>
      {/* Your custom UI here */}
      <FileList tasks={tasks} />
      <ProgressBar progress={stats.overallProgress} />
    </div>
  );
}
```

### Custom Styling

The `ProductionUploader` component uses Tailwind CSS. To customize:

1. **Colors**: Modify the `bg-blue-500`, `text-blue-600` classes
2. **Sizing**: Change `w-96`, `bottom-4`, `right-4` values
3. **Position**: Change `fixed` positioning classes

```tsx
// Customize position and size
<ProductionUploader
  // Move to top-left
  className="fixed top-4 left-4 w-80"
/>
```

---

## 🐛 Troubleshooting

### Files not uploading
1. Check browser console for errors
2. Verify `process.env.NEXT_PUBLIC_API_URL` is correct
3. Ensure auth token is in localStorage
4. Check network tab in DevTools

### "Network error"
- Network interrupted
- Server not responding
- CORS issues (check backend config)
- **Solution**: Auto-retries after 2 seconds

### "File exceeds maximum size"
- Default max file size: 5GB
- To change: Edit `MAX_FILE_SIZE` in `upload.simple.ts`

### Uploads stuck in "Queued"
- Check `maxConcurrent` config
- Verify XHR request in Network tab
- Check if server is responding to POST /upload/file

---

## 🚀 Performance Tips

### For Slow Networks
```ts
useProductionUpload({
  maxConcurrent: 1,      // One at a time
  maxRetries: 5,         // More retries
  retryDelayMs: 5000,    // Longer wait
})
```

### For Fast Networks
```ts
useProductionUpload({
  maxConcurrent: 10,     // More parallel
  maxRetries: 2,         // Fewer retries
  retryDelayMs: 1000,    // Quick retry
})
```

### Monitor Upload Progress
```ts
const { manager } = useProductionUpload();

manager.on({
  onTaskUpdate: (task) => {
    console.log(`${task.name}: ${task.progress}%`);
  },
  onStatsUpdate: (stats) => {
    console.log(`Overall: ${stats.overallProgress}%`);
  },
});
```

---

## 📚 Examples

### Example 1: Simple File Upload Page
See `PRODUCTION_UPLOADER_GUIDE.md` for code examples.

### Example 2: Upload to Folder
```tsx
<ProductionUploader folderId={currentFolder.id} />
```

### Example 3: Upload with Metadata
```tsx
const { addFiles } = useProductionUpload();

addFiles([file], {
  folderId: 123,
  telegramChatId: 'chat_xyz'
});
```

### Example 4: Track Upload Progress
```tsx
const { manager } = useProductionUpload();

manager.on({
  onTaskUpdate: (task) => {
    if (task.status === 'completed') {
      console.log(`✓ ${task.name} uploaded!`);
    }
    if (task.status === 'failed') {
      console.error(`✗ ${task.name} failed: ${task.error}`);
    }
  },
});
```

---

## 🔐 Security

- ✅ Requires authentication (`requireAuth` middleware)
- ✅ User-scoped uploads (can't access other users' files)
- ✅ MIME type validation
- ✅ File size limits (5GB default)
- ✅ Rate limiting (2200 requests/15 mins)

---

## 🎯 Next Steps

1. **Test it**: Drop the component in a page and upload files
2. **Customize**: Adjust colors, size, position to match your design
3. **Integrate**: Wire up to your backend file storage (Telegram, S3, etc)
4. **Monitor**: Add progress tracking and analytics

---

## 📖 API Reference

### useProductionUpload(config?)

```ts
const {
  tasks,                    // UploadTask[]
  stats,                    // UploadStats
  addFiles,                 // (files, options) => UploadTask[]
  pauseTask,                // (taskId) => boolean
  resumeTask,               // (taskId) => boolean
  cancelTask,               // (taskId) => Promise<boolean>
  retryTask,                // (taskId) => boolean
  clearCompleted,           // () => void
  manager,                  // ProductionUploadManager
} = useProductionUpload(config);
```

### ProductionUploader props

```ts
interface ProductionUploaderProps {
  folderId?: number;
  telegramChatId?: string;
  onFilesAdded?: (count: number) => void;
}
```

---

**Made with ❤️ for reliable, user-friendly file uploads.**
